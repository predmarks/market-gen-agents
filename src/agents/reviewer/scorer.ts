import { callClaude } from '@/lib/llm';
import { SCORING_WEIGHTS, THRESHOLDS } from '@/config/scoring';
import type { ReviewScores } from '@/db/types';
import type { DataVerificationResult } from './data-verifier';
import type { RulesCheckResult } from './rules-checker';
import type { MarketRecord } from './types';

export type Recommendation = 'publish' | 'rewrite_then_publish' | 'hold' | 'reject';

export interface ScoringResult {
  scores: ReviewScores;
  recommendation: Recommendation;
}

const SYSTEM_PROMPT = `Sos un evaluador de calidad para Predmarks, una plataforma argentina de mercados de predicción que usa LMSR como market maker.
Tu trabajo es puntuar mercados candidatos en 4 dimensiones.
CRÍTICO: Un mercado que puede resolverse mientras está abierto crea arbitraje gratis — esto es catastrófico para LMSR.`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    ambiguity: {
      type: 'object' as const,
      properties: {
        score: { type: 'number' as const },
        reasoning: { type: 'string' as const },
      },
      required: ['score', 'reasoning'] as const,
    },
    timingSafety: {
      type: 'object' as const,
      properties: {
        score: { type: 'number' as const },
        reasoning: { type: 'string' as const },
      },
      required: ['score', 'reasoning'] as const,
    },
    timeliness: {
      type: 'object' as const,
      properties: {
        score: { type: 'number' as const },
        reasoning: { type: 'string' as const },
      },
      required: ['score', 'reasoning'] as const,
    },
    volumePotential: {
      type: 'object' as const,
      properties: {
        score: { type: 'number' as const },
        reasoning: { type: 'string' as const },
      },
      required: ['score', 'reasoning'] as const,
    },
    recommendation: {
      type: 'string' as const,
      enum: ['publish', 'rewrite_then_publish', 'hold', 'reject'],
    },
  },
  required: ['ambiguity', 'timingSafety', 'timeliness', 'volumePotential', 'recommendation'] as const,
};

export async function scoreMarket(
  market: MarketRecord,
  dataVerification: DataVerificationResult,
  rulesCheck: RulesCheckResult,
  signalCount?: number,
): Promise<ScoringResult> {
  const marketSummary = {
    title: market.title,
    description: market.description,
    resolutionCriteria: market.resolutionCriteria,
    resolutionSource: market.resolutionSource,
    contingencies: market.contingencies,
    category: market.category,
    endTimestamp: market.endTimestamp,
    endDate: new Date(market.endTimestamp * 1000).toISOString(),
  };

  const userMessage = `Puntuá este mercado candidato para Predmarks.

Mercado:
${JSON.stringify(marketSummary, null, 2)}

Verificación de datos:
${JSON.stringify(dataVerification, null, 2)}

Resultados de reglas:
Reglas estrictas: ${rulesCheck.hardRuleResults.filter((r) => !r.passed).length} fallaron
Advertencias blandas: ${rulesCheck.softRuleResults.filter((r) => !r.passed).map((r) => r.ruleId).join(', ') || 'ninguna'}

Señales relacionadas: ${signalCount ?? 0} (cantidad de señales/noticias vinculadas al tema de este mercado)

RÚBRICA DE PUNTUACIÓN:

1. AMBIGÜEDAD (peso: ${SCORING_WEIGHTS.ambiguity * 100}%)
   10 = Cristalino: fuente específica, fecha exacta, contingencias cubiertas
   5 = Mayormente claro pero con 1-2 escenarios disputables
   1 = Vago, no queda claro qué significa "se resolverá como Sí"

2. SEGURIDAD DE TIMING (peso: ${SCORING_WEIGHTS.timingSafety * 100}%)
   10 = Imposible que se resuelva con el mercado abierto
        Ejemplos: partido de fútbol cierra 30min post-kickoff,
        dato económico cierra la noche anterior, clima single-day
   7 = Muy improbable que se resuelva con el mercado abierto
   4 = PODRÍA resolverse con el mercado abierto en ciertos escenarios
   2-3 = Mercado abierto tipo "¿Ocurrirá X antes de Y?" — solo
         permitido si es excepcionalmente atractivo
   1 = Alta probabilidad de resolverse con el mercado abierto

   ANTI-PATRONES (detectar y penalizar):
   - Clima con rango multi-día ("algún día del 11 al 15") → score 2
   - "¿Será X el próximo DT/ministro/CEO?" con ventana >5 días → score 2-3
   - Dato económico que se publica mientras el mercado está abierto → score 1
   - Mercado político "antes de Y" donde Y es >1 semana → score 3

3. ACTUALIDAD (peso: ${SCORING_WEIGHTS.timeliness * 100}%)
   10 = Sobre el titular del día, pico de interés
   5 = Relevante a una historia en curso
   1 = No conectado a ningún evento actual

4. POTENCIAL DE VOLUMEN (peso: ${SCORING_WEIGHTS.volumePotential * 100}%)
   10 = Controversial, oscilaciones probables, todos opinan
   7 = Buen potencial de debate
   5 = Nicho pero con audiencia interesada
   1 = Extremadamente nicho
   BONUS: Mercados donde la probabilidad va a oscilar puntúan más alto.
   BONUS: Más señales relacionadas = más interés público. 10+ señales = fuerte señal de relevancia, 20+ = tema caliente.

Fecha de hoy: ${new Date().toISOString().split('T')[0]}

Puntuá cada dimensión (0-10) con razonamiento, y dá una recomendación:
- "publish": listo para publicar
- "rewrite_then_publish": necesita mejoras pero vale la pena
- "hold": no publicar ahora, pero podría mejorar
- "reject": no vale la pena`;

  const { result } = await callClaude<{
    ambiguity: { score: number; reasoning: string };
    timingSafety: { score: number; reasoning: string };
    timeliness: { score: number; reasoning: string };
    volumePotential: { score: number; reasoning: string };
    recommendation: Recommendation;
  }>({
    system: SYSTEM_PROMPT,
    userMessage,
    outputSchema: OUTPUT_SCHEMA,
  });

  // Compute overallScore in code for mathematical accuracy
  const overallScore =
    result.ambiguity.score * SCORING_WEIGHTS.ambiguity +
    result.timingSafety.score * SCORING_WEIGHTS.timingSafety +
    result.timeliness.score * SCORING_WEIGHTS.timeliness +
    result.volumePotential.score * SCORING_WEIGHTS.volumePotential;

  const scores: ReviewScores = {
    ambiguity: result.ambiguity.score,
    timingSafety: result.timingSafety.score,
    timeliness: result.timeliness.score,
    volumePotential: result.volumePotential.score,
    overallScore: Math.round(overallScore * 10) / 10,
  };

  // Override recommendation if below thresholds
  let recommendation = result.recommendation;
  if (
    scores.overallScore < THRESHOLDS.minimumScore ||
    scores.timingSafety < THRESHOLDS.timingSafetyFloor
  ) {
    recommendation = 'reject';
  }

  return { scores, recommendation };
}
