import { callClaude } from '@/lib/llm';
import { todayAR } from '@/lib/dates';
import { loadRules } from '@/config/rules';
import { db } from '@/db/client';
import { marketEvents, markets, globalFeedback, config } from '@/db/schema';
import { eq, desc, and, gte, isNotNull, sql, like } from 'drizzle-orm';
import type { DataPoint, GeneratedCandidate, Topic } from './types';

const DEFAULT_SYSTEM_PROMPT = `Sos un creador de mercados predictivos para Predmarks (Argentina). Recibís TEMAS
analizados con ángulos sugeridos y los convertís en mercados formales y operables.

IDIOMA: Español argentino.

TIMING (LMSR — CRÍTICO):
- El mercado NO DEBE resolverse mientras está abierto. endTimestamp ANTES del resultado.
- Deportes partidos: cerrar 30min después del inicio. No-partido: ventana corta (días), solo si muy atractivo.
- Economía datos diarios (dólar, riesgo país): cerrar NOCHE ANTERIOR al dato.
- Economía datos rezagados (BCRA, IPC): enmarcar como PERÍODO, no fecha puntual.
- Clima: día único, NUNCA rangos multi-día. Cierre noche anterior.
- Política: cerrar antes del voto/anuncio. Ventana >1 semana = riesgoso.
- Si no podés garantizar timing seguro, NO generes el mercado.

CONTENIDO:
- Evitar mercados globales de Polymarket/Kalshi (excepción: altísima importancia).
- NUNCA inventar números. Sin dato actual → "requiere verificación".
- Todos los resultados deben ser plausibles.

TIPO DE MERCADO:
- Binario (["Si","No"]) o multi-opción (3-8 outcomes).
- Multi-opción: incluir "Otro" salvo outcomes matemáticamente exhaustivos.
- Al menos 2 outcomes >10% probabilidad. Si uno domina >85%, reformular.

FORMATO NUMÉRICO EN OUTCOMES:
- SIEMPRE usar punto (.) como separador decimal: "34.5%" no "34,5%". Crítico para evitar errores de parseo onchain.

CONTINGENCIAS (incluir las que apliquen):
- Fuente no publica → alternativa o última disponible.
- Evento cancelado → "No" (binarios) o según opciones.
- Revisión de datos → primera publicación.
- Deportes: tiempo reglamentario + reprogramación/cancelación → "No".
- Clima: referenciar timeanddate.com.
- Los mercados NUNCA se anulan. Siempre deben resolverse a uno de los outcomes definidos. Diseñar contingencias que cubran todos los escenarios sin recurrir a anulación.

REGLAS DE VALIDACIÓN:
{rules}

FORMATO DE DESCRIPCIÓN (solo estas 3 secciones en Markdown, sin narrativa):
  ## Criterio de resolución — dato exacto, fecha, fuente, determinación del resultado
  ## Contingencias — fuente no publica, evento cancelado, etc.
  ## Fuente de resolución — nombre + URL
Los campos resolutionCriteria, resolutionSource y contingencies son resúmenes
de una línea extraídos de la descripción.

EJEMPLO:
Título: ¿En qué rango cerrará el dólar blue el Viernes 3 de Abril?
Descripción:
## Criterio de resolución
Este mercado se resolverá según la **cotización de venta de cierre** del dólar blue el **viernes 3 de abril de 2026**, publicada por Ámbito Financiero. Rangos contiguos, mutuamente excluyentes, cubren todos los valores posibles.
## Contingencias
- Si es feriado o no hay cotización, se usa el cierre del último día hábil anterior.
- Discrepancia entre fuentes: prevalece Ámbito Financiero.
## Fuente de resolución
Ámbito Financiero — [www.ambito.com/contenidos/dolar-informal.html](https://www.ambito.com/contenidos/dolar-informal.html)

INSTRUCCIONES:
- Usá los ángulos sugeridos como guía, podés mejorarlos o descartarlos.
- Generá exactamente {targetCount} mercados eligiendo los mejores temas/ángulos.
- Priorizá temas con score más alto.
- NO generes más de 1 mercado por tema salvo ángulos muy distintos.`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    candidates: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'Pregunta clara en español argentino, con signos de interrogación' },
          description: { type: 'string' as const, description: 'Especificación completa del mercado en Markdown con secciones ## Criterio de resolución, ## Contingencias, ## Fuente de resolución. Ver ejemplos en el prompt.' },
          outcomes: { type: 'array' as const, items: { type: 'string' as const }, description: 'Opciones del mercado. Binarios: ["Si", "No"]. Multi-opción: listar todas las opciones. IMPORTANTE: usar punto (.) como separador decimal, nunca coma.' },
          resolutionCriteria: { type: 'string' as const, description: 'Resumen de una línea del criterio de resolución (extraído de la descripción)' },
          resolutionSource: { type: 'string' as const, description: 'Nombre y URL de la fuente de resolución (extraído de la descripción)' },
          contingencies: { type: 'string' as const, description: 'Resumen de una línea de las contingencias (extraído de la descripción)' },
          category: {
            type: 'string' as const,
            enum: ['Política', 'Economía', 'Deportes', 'Entretenimiento', 'Clima', 'Otros'],
          },
          tags: { type: 'array' as const, items: { type: 'string' as const } },
          endTimestamp: { type: 'number' as const, description: 'Unix timestamp en segundos para el cierre del mercado' },
          expectedResolutionDate: { type: 'string' as const, description: 'Fecha esperada de resolución YYYY-MM-DD' },
          timingAnalysis: { type: 'string' as const, description: 'Por qué el timing es seguro para LMSR' },
          requiresVerification: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Datos que necesitan verificación externa',
          },
        },
        required: [
          'title', 'description', 'outcomes', 'resolutionCriteria', 'resolutionSource',
          'contingencies', 'category', 'tags', 'endTimestamp',
          'expectedResolutionDate', 'timingAnalysis',
        ] as const,
      },
    },
  },
  required: ['candidates'] as const,
};

export async function loadGenerationPrompt(): Promise<string> {
  try {
    const [row] = await db.select().from(config).where(eq(config.key, 'generation_prompt'));
    if (row?.value) return row.value;
  } catch { /* fallback */ }
  return DEFAULT_SYSTEM_PROMPT;
}

export async function saveGenerationPrompt(prompt: string): Promise<void> {
  // Version the current prompt before overwriting
  try {
    const [current] = await db.select().from(config).where(eq(config.key, 'generation_prompt'));
    if (current?.value) {
      const [versionRows] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(config)
        .where(like(config.key, 'generation_prompt:v%'));
      const nextVersion = (versionRows?.count ?? 0) + 1;
      await db
        .insert(config)
        .values({ key: `generation_prompt:v${nextVersion}`, value: current.value })
        .onConflictDoUpdate({ target: config.key, set: { value: current.value, updatedAt: new Date() } });
    }
  } catch { /* versioning is best-effort */ }

  await db
    .insert(config)
    .values({ key: 'generation_prompt', value: prompt })
    .onConflictDoUpdate({ target: config.key, set: { value: prompt, updatedAt: new Date() } });
}

async function loadTriageFeedback(): Promise<string> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const rejections = await db
    .select({
      title: markets.title,
      reason: marketEvents.detail,
    })
    .from(marketEvents)
    .innerJoin(markets, eq(marketEvents.marketId, markets.id))
    .where(
      and(
        eq(marketEvents.type, 'human_rejected'),
        gte(marketEvents.createdAt, thirtyDaysAgo),
        isNotNull(marketEvents.detail),
      ),
    )
    .orderBy(desc(marketEvents.createdAt))
    .limit(50);

  const withReasons = rejections.filter(
    (r) => r.reason && typeof r.reason === 'object' && 'reason' in r.reason && (r.reason as Record<string, unknown>).reason,
  );

  if (withReasons.length === 0) return '';

  const lines = withReasons.map((r) => {
    const reason = (r.reason as Record<string, string>).reason;
    return `- "${r.title}" → ${reason}`;
  });

  return `\nDESCARTES RECIENTES DEL EDITOR (evitar patrones similares):\n${lines.join('\n')}\n`;
}

async function loadGlobalFeedback(): Promise<string> {
  const entries = await db
    .select({ text: globalFeedback.text })
    .from(globalFeedback)
    .orderBy(desc(globalFeedback.createdAt))
    .limit(50);

  if (entries.length === 0) return '';

  const lines = entries.map((e) => `- ${e.text}`);
  return `\nINSTRUCCIONES GLOBALES DEL EDITOR:\n${lines.join('\n')}\n`;
}

function formatDataPoints(dataPoints: DataPoint[]): string {
  if (dataPoints.length === 0) return 'No hay datos actuales disponibles.';
  return dataPoints
    .map((dp) => {
      const prev = dp.previousValue != null ? ` (anterior: ${dp.previousValue})` : '';
      return `- ${dp.metric}: ${dp.currentValue} ${dp.unit}${prev}`;
    })
    .join('\n');
}

async function formatRules(): Promise<string> {
  const { hard, soft } = await loadRules();
  const hardText = hard.map((r) => `- ${r.id}: ${r.description}`).join('\n');
  const softText = soft.map((r) => `- ${r.id}: ${r.description}`).join('\n');
  return `Reglas estrictas (rechazo automático si falla):\n${hardText}\n\nAdvertencias:\n${softText}`;
}

function formatTopics(topics: Topic[]): string {
  return topics
    .map((t, i) => {
      const angles = t.suggestedAngles.map((a) => `   - ${a}`).join('\n');
      return `${i + 1}. [${t.category}] ${t.name} (score: ${t.score}/10)\n   ${t.summary}\n   Ángulos sugeridos:\n${angles}`;
    })
    .join('\n\n');
}

export async function generateMarkets(
  topics: Topic[],
  dataPoints: DataPoint[],
  openMarketTitles: string[],
  targetCount: number = 10,
  marketType?: 'binary' | 'multi-outcome',
  instruction?: string,
): Promise<GeneratedCandidate[]> {
  if (topics.length === 0) return [];

  const [triageFeedback, globalFeedbackText, promptTemplate, rulesText] = await Promise.all([
    loadTriageFeedback(),
    loadGlobalFeedback(),
    loadGenerationPrompt(),
    formatRules(),
  ]);
  const today = todayAR();

  const editorInstructions: string[] = [];
  if (marketType === 'multi-outcome') {
    editorInstructions.push('Generá SOLO mercados multi-opción (3-8 outcomes). NO uses formato binario (Si/No).');
  } else if (marketType === 'binary') {
    editorInstructions.push('Generá SOLO mercados binarios con outcomes ["Si", "No"].');
  }
  if (instruction) {
    editorInstructions.push(`${instruction}\nPriorizá esta instrucción sobre los ángulos sugeridos del tema.`);
  }

  const editorBlock = editorInstructions.length > 0
    ? '\n\nINSTRUCCIÓN DEL EDITOR:\n' + editorInstructions.join('\n')
    : '';

  const system = promptTemplate
    .replace('{rules}', rulesText)
    .replace('{targetCount}', String(targetCount))
    + editorBlock;

  const userMessage = `DATOS ACTUALES (no inventar otros):
${formatDataPoints(dataPoints)}

${(() => {
  const now = Math.floor(Date.now() / 1000);
  return `HOY: ${today} (Unix timestamp: ${now})
AÑO ACTUAL: ${new Date().getFullYear()}
REFERENCIA TIMESTAMPS (para calcular endTimestamp):
- Hoy = ${now}
- En 7 días = ${now + 7 * 86400}
- En 30 días = ${now + 30 * 86400}
- En 90 días = ${now + 90 * 86400}
- En 120 días = ${now + 120 * 86400}
IMPORTANTE: endTimestamp DEBE ser mayor que ${now}. Usá las referencias de arriba para calcular.`;
})()}
${globalFeedbackText}${triageFeedback}
MERCADOS ABIERTOS (no duplicar):
${openMarketTitles.length > 0 ? openMarketTitles.map((t) => `- ${t}`).join('\n') : 'Ninguno'}

TEMAS EXTRAÍDOS (${topics.length} temas, ordenados por score):
${formatTopics(topics)}`;

  const { result } = await callClaude<{ candidates: GeneratedCandidate[] }>({
    system,
    userMessage,
    outputSchema: OUTPUT_SCHEMA,
    outputToolName: 'generate_markets',
    model: 'opus',
    operation: 'generate_markets',
  });

  return result.candidates;
}
