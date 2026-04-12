import { callClaude } from '@/lib/llm';
import { todayAR, formatDateAR } from '@/lib/dates';
import { CONTINGENCY_TEMPLATES } from '@/config/contingencies';
import type { MarketSnapshot, Iteration } from '@/db/types';
import type { MarketRecord } from './types';

const SYSTEM_PROMPT = `Sos un corrector minimalista de mercados predictivos para Predmarks.
Tu trabajo es aplicar correcciones QUIRÚRGICAS a los problemas específicos del feedback. Nada más.

PRINCIPIO CENTRAL: Cambiá lo MÍNIMO posible. Si un campo no está mencionado en el feedback, copialo TEXTUALMENTE sin modificar.

REGLAS ESTRICTAS:
- TÍTULO: NO tocar NUNCA salvo que el feedback cite explícitamente la regla H7. Si H7 falló, hacé la corrección mínima (agregar signo de pregunta, corregir gramática). NUNCA reescribir desde cero.
- DESCRIPCIÓN: NUNCA agregar información nueva, noticias, contexto actual, ni datos que no estaban. Solo podés: corregir datos inexactos señalados en el feedback, aclarar frases ambiguas, o acortar. La descripción debe REDUCIRSE o mantenerse igual, nunca crecer.
- NUNCA inventar datos. Si necesitás un número que no tenés, escribí "[VERIFICAR: descripción del dato necesario]".
- NUNCA cambies el tipo de mercado: si es multi-opción, mantenelo multi-opción. Si es binario, mantenelo binario.
- Items marcados [NO CORREGIDO] son problemas que NO se resolvieron en la iteración anterior. Intentá una corrección más PRECISA del mismo problema — no reencuadres ni cambies el ángulo.
- Los mercados NUNCA se anulan. Toda contingencia debe resolverse a uno de los outcomes definidos, nunca a "anulado" o "void".
- Números decimales en outcomes con PUNTO (.) no coma: "34.5%" no "34,5%". Crítico para parseo onchain.
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
    outcomes: { type: 'array' as const, items: { type: 'string' as const }, description: 'Opciones del mercado. Binarios: ["Si", "No"]. Multi-opción: listar todas las opciones (3-8). Incluir "Otro" salvo que sean matemáticamente exhaustivas. IMPORTANTE: usar punto (.) como separador decimal, nunca coma.' },
    endTimestamp: { type: 'number' as const, description: 'Unix timestamp del cierre (ajustar si timing es inseguro)' },
    expectedResolutionDate: { type: 'string' as const, description: 'Fecha esperada YYYY-MM-DD' },
    timingSafety: { type: 'string' as const, enum: ['safe', 'caution', 'dangerous'] },
  },
  required: [
    'title', 'description', 'resolutionCriteria', 'resolutionSource',
    'contingencies', 'category', 'tags', 'outcomes', 'endTimestamp',
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
      const changesStr = iter.changes
        ? `\n  Campos cambiados: ${Object.keys(iter.changes).join(', ')}`
        : '';
      return `Versión ${iter.version} (score: ${score}/10):\n  Título: ${iter.market.title}${changesStr}\n  Feedback: ${iter.feedback || 'N/A'}`;
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
    outcomes: market.outcomes,
    endTimestamp: market.endTimestamp,
    endDate: formatDateAR(market.endTimestamp),
    expectedResolutionDate: market.expectedResolutionDate,
    timingSafety: market.timingSafety,
  };

  const humanFeedbackSection = humanFeedback && humanFeedback.length > 0
    ? `\nFEEDBACK HUMANO (prioritario):\n${humanFeedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n`
    : '';

  const isBinary = Array.isArray(market.outcomes) &&
    market.outcomes.length === 2 &&
    market.outcomes.includes('Si') &&
    market.outcomes.includes('No');
  const marketTypeLabel = isBinary
    ? 'Binario (Si/No)'
    : `Multi-opción (${market.outcomes.length} opciones: ${market.outcomes.join(', ')})`;

  const originalTitle = iterationHistory.length > 0
    ? iterationHistory[0].market.title
    : null;

  const userMessage = `Corregí SOLO los problemas listados en el feedback. No toques nada más.

REGLA DE ORO: Si un campo NO aparece mencionado en el feedback, copialo TEXTUALMENTE del mercado actual. Sin mejoras, sin retoques, sin embellecimiento.

TIPO DE MERCADO: ${marketTypeLabel} — NO cambiar el tipo.

FEEDBACK DE LA REVISIÓN:
${feedback}
${humanFeedbackSection}
HISTORIAL DE ITERACIONES:
${formatHistory(iterationHistory)}

MERCADO ACTUAL:
${JSON.stringify(marketSummary, null, 2)}

QUÉ CORREGIR (solo si el feedback lo menciona):
1. TIMING: Si el feedback menciona timing inseguro, ajustá endTimestamp para que el mercado NO pueda resolverse mientras está abierto.
2. CRITERIOS: Si el feedback menciona ambigüedad, hacé la resolución más precisa y concisa. No agregar texto — aclarar o recortar.
3. CONTINGENCIAS: Si faltan, aplicar las cláusulas estándar que correspondan.
4. TÍTULO: NO tocar salvo que el feedback cite H7 explícitamente. En ese caso, corrección mínima.
5. DESCRIPCIÓN: NO agregar información nueva, noticias, ni contexto. Solo corregir datos inexactos señalados o acortar.

Cláusulas de contingencia estándar disponibles:
${formatContingencyTemplates()}

${(() => {
  const now = Math.floor(Date.now() / 1000);
  const today = todayAR();
  return `HOY: ${today} (Unix timestamp: ${now})
REFERENCIA TIMESTAMPS (para calcular endTimestamp):
- Hoy ${today} = ${now}
- En 7 días = ${now + 7 * 86400}
- En 30 días = ${now + 30 * 86400}
- En 90 días = ${now + 90 * 86400}
- En 120 días = ${now + 120 * 86400}
IMPORTANTE: endTimestamp DEBE ser mayor que ${now} (hoy). Si el timestamp actual del mercado es menor, corregilo.`;
})()}

Devolvé el mercado COMPLETO. Los campos sin problemas deben ser IDÉNTICOS al mercado actual.`;

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
