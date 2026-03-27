import { callClaude } from '@/lib/llm';
import { CONTINGENCY_TEMPLATES } from '@/config/contingencies';
import type { MarketSnapshot, Iteration } from '@/db/types';
import type { MarketRecord } from './types';

const SYSTEM_PROMPT = `Sos un editor experto de mercados predictivos para Predmarks, una plataforma argentina de mercados de predicción.
Tu trabajo es mejorar mercados que fallaron la revisión automática, corrigiendo los problemas específicos señalados.

REGLAS:
- NUNCA inventar datos. Si necesitás un número que no tenés, escribí "[VERIFICAR: descripción del dato necesario]".
- Corregí SOLAMENTE los problemas señalados en el feedback. No cambies lo que estaba bien.
- Devolvé el mercado completo con todas las mejoras aplicadas.
- Todo el contenido en español argentino.`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const, description: 'Título mejorado del mercado' },
    description: { type: 'string' as const, description: 'Descripción mejorada' },
    resolutionCriteria: { type: 'string' as const, description: 'Criterios de resolución mejorados' },
    resolutionSource: { type: 'string' as const, description: 'Fuente de resolución' },
    contingencies: { type: 'string' as const, description: 'Contingencias mejoradas' },
    category: { type: 'string' as const, enum: ['Política', 'Economía', 'Deportes', 'Entretenimiento', 'Clima', 'Otros'] },
    tags: { type: 'array' as const, items: { type: 'string' as const } },
    endTimestamp: { type: 'number' as const, description: 'Unix timestamp del cierre (ajustar si timing es inseguro)' },
    expectedResolutionDate: { type: 'string' as const, description: 'Fecha esperada YYYY-MM-DD' },
    timingSafety: { type: 'string' as const, enum: ['safe', 'caution', 'dangerous'] },
  },
  required: [
    'title', 'description', 'resolutionCriteria', 'resolutionSource',
    'contingencies', 'category', 'tags', 'endTimestamp',
    'expectedResolutionDate', 'timingSafety',
  ] as const,
};

function formatContingencyTemplates(): string {
  const examples: Record<string, string> = {
    lagged_data_period: CONTINGENCY_TEMPLATES.lagged_data_period('reservas internacionales', 'cierre de febrero 2026', 'el BCRA'),
    source_unavailable: CONTINGENCY_TEMPLATES.source_unavailable('la fuente principal'),
    holiday_fallback: CONTINGENCY_TEMPLATES.holiday_fallback('la fuente'),
    sports_rescheduling: CONTINGENCY_TEMPLATES.sports_rescheduling('el partido'),
    regulation_time_only: CONTINGENCY_TEMPLATES.regulation_time_only(),
    event_cancelled: CONTINGENCY_TEMPLATES.event_cancelled('el evento'),
    event_postponed: CONTINGENCY_TEMPLATES.event_postponed('el evento'),
    event_rescheduled_earlier: CONTINGENCY_TEMPLATES.event_rescheduled_earlier('el evento'),
    data_revision: CONTINGENCY_TEMPLATES.data_revision(),
  };
  return Object.entries(examples)
    .map(([name, text]) => `- ${name}: "${text}"`)
    .join('\n');
}

function formatHistory(history: Iteration[]): string {
  if (history.length === 0) return 'Primera iteración.';
  return history
    .map((iter) => {
      const score = iter.review.scores.overallScore.toFixed(1);
      return `Versión ${iter.version} (score: ${score}/10):\n  Feedback: ${iter.feedback || 'N/A'}`;
    })
    .join('\n');
}

export async function improveMarket(
  market: MarketRecord,
  feedback: string,
  iterationHistory: Iteration[],
  humanFeedback?: string[],
): Promise<MarketSnapshot> {
  const marketSummary = {
    title: market.title,
    description: market.description,
    resolutionCriteria: market.resolutionCriteria,
    resolutionSource: market.resolutionSource,
    contingencies: market.contingencies,
    category: market.category,
    tags: (market as unknown as { tags: string[] }).tags,
    endTimestamp: market.endTimestamp,
    endDate: new Date(market.endTimestamp * 1000).toISOString(),
    expectedResolutionDate: market.expectedResolutionDate,
    timingSafety: market.timingSafety,
  };

  const humanFeedbackSection = humanFeedback && humanFeedback.length > 0
    ? `\nFEEDBACK HUMANO (prioritario):\n${humanFeedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n`
    : '';

  const userMessage = `Mejorá este mercado corrigiendo los problemas detectados.

FEEDBACK DE LA REVISIÓN:
${feedback}
${humanFeedbackSection}
HISTORIAL DE ITERACIONES:
${formatHistory(iterationHistory)}

MERCADO ACTUAL:
${JSON.stringify(marketSummary, null, 2)}

PRIORIDADES:
1. TIMING: Si el feedback menciona timing inseguro, reenmarcá para que el mercado
   NO pueda resolverse mientras está abierto. Ajustá endTimestamp si es necesario.
2. CRITERIOS: Hacé la resolución hermética con fuente pública, hora argentina, casos borde.
3. CONTINGENCIAS: Incluí las cláusulas estándar que apliquen.
4. TÍTULO: Hacelo claro, atractivo, y como pregunta en español argentino. Para binarios: pregunta sí/no. Para multi-opción: pregunta clara sobre lo que se predice.
5. DESCRIPCIÓN: Contexto en Markdown (negritas, links, listas). Incluir datos actuales y por qué importa.

Cláusulas de contingencia estándar disponibles:
${formatContingencyTemplates()}

HOY: ${new Date().toISOString().split('T')[0]}

Devolvé el mercado COMPLETO con todas las mejoras aplicadas.`;

  const { result } = await callClaude<MarketSnapshot>({
    system: SYSTEM_PROMPT,
    userMessage,
    outputSchema: OUTPUT_SCHEMA,
    outputToolName: 'improve_market',
    model: 'opus',
    operation: 'improve_market',
  });

  return result;
}
