import { callClaude } from '@/lib/llm';
import { todayAR, formatDateAR } from '@/lib/dates';
import { loadRules, type Rule } from '@/config/rules';
import type { RuleResult } from '@/db/types';
import type { DataVerificationResult } from './data-verifier';
import type { MarketRecord } from './types';

export interface RulesCheckResult {
  hardRuleResults: RuleResult[];
  softRuleResults: RuleResult[];
  rejected: boolean;
}

const SYSTEM_PROMPT = `Sos un revisor de calidad para Predmarks, una plataforma argentina de mercados de predicción.
Tu trabajo es verificar si un mercado candidato cumple con las reglas establecidas.
Sé riguroso — si una regla falla, el mercado debe ser rechazado.`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    hardRuleResults: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          ruleId: { type: 'string' as const },
          passed: { type: 'boolean' as const },
          explanation: { type: 'string' as const },
        },
        required: ['ruleId', 'passed', 'explanation'] as const,
      },
    },
    softRuleResults: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          ruleId: { type: 'string' as const },
          passed: { type: 'boolean' as const },
          explanation: { type: 'string' as const },
        },
        required: ['ruleId', 'passed', 'explanation'] as const,
      },
    },
  },
  required: ['hardRuleResults', 'softRuleResults'] as const,
};

function formatRules(rules: Rule[]): string {
  return rules
    .map((r) => `${r.id}: ${r.description}\nVerificación: ${r.check}`)
    .join('\n\n');
}

// Rules that only apply to multi-outcome markets (not binary Si/No)
const MULTI_OUTCOME_ONLY_RULES = new Set(['H11', 'H12', 'S8']);

function filterRulesForMarket(rules: Rule[], market: MarketRecord): Rule[] {
  const isBinary = Array.isArray(market.outcomes) &&
    market.outcomes.length === 2 &&
    market.outcomes.includes('Si') &&
    market.outcomes.includes('No');
  if (isBinary) {
    return rules.filter((r) => !MULTI_OUTCOME_ONLY_RULES.has(r.id));
  }
  return rules;
}

export async function checkRules(
  market: MarketRecord,
  dataVerification: DataVerificationResult,
  openMarkets: { id: string; title: string }[],
): Promise<RulesCheckResult> {
  const { hard, soft } = await loadRules();
  const applicableHard = filterRulesForMarket(hard, market);
  const applicableSoft = filterRulesForMarket(soft, market);

  const marketSummary = {
    title: market.title,
    description: market.description,
    resolutionCriteria: market.resolutionCriteria,
    resolutionSource: market.resolutionSource,
    contingencies: market.contingencies,
    category: market.category,
    tags: market.tags,
    outcomes: market.outcomes,
    endTimestamp: market.endTimestamp,
    endDate: formatDateAR(market.endTimestamp),
    createdAt: market.createdAt,
  };

  const userMessage = `Verificá si este mercado candidato pasa todas las reglas.

Mercado candidato:
${JSON.stringify(marketSummary, null, 2)}

Resultados de verificación de datos:
${JSON.stringify(dataVerification, null, 2)}

Mercados actualmente abiertos (para verificar duplicados, regla H8):
${openMarkets.map((m) => `- ${m.title}`).join('\n') || '(ninguno)'}

REGLAS ESTRICTAS (si CUALQUIERA falla, el mercado es RECHAZADO):
${formatRules(applicableHard)}

REGLAS BLANDAS (señalar como advertencia, no rechazar):
${formatRules(applicableSoft)}

Para cada regla (estricta y blanda), respondé con ruleId, passed (true/false), y explanation.

Fecha de hoy: ${todayAR()}`;

  const { result } = await callClaude<{
    hardRuleResults: RuleResult[];
    softRuleResults: RuleResult[];
  }>({
    system: SYSTEM_PROMPT,
    userMessage,
    outputSchema: OUTPUT_SCHEMA,
    operation: 'rules_check',
  });

  return {
    hardRuleResults: result.hardRuleResults,
    softRuleResults: result.softRuleResults,
    rejected: result.hardRuleResults.some((r) => !r.passed),
  };
}
