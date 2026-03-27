import { callClaude } from '@/lib/llm';
import { HARD_RULES, SOFT_RULES } from '@/config/rules';
import { db } from '@/db/client';
import { marketEvents, markets, globalFeedback, config } from '@/db/schema';
import { eq, desc, and, gte, isNotNull } from 'drizzle-orm';
import type { DataPoint, GeneratedCandidate, Topic } from './types';

const DEFAULT_SYSTEM_PROMPT = `Sos un creador de mercados predictivos para Predmarks, una plataforma
argentina de mercados de predicción. Recibís TEMAS ya analizados con ángulos
sugeridos y tu trabajo es convertirlos en mercados formales y operables.

IDIOMA: Todos los mercados deben estar en español argentino.

REGLAS CRÍTICAS DE TIMING (LMSR):
- El mercado NO DEBE poder resolverse mientras está abierto
- endTimestamp debe ser ANTES de que el resultado sea conocido

PATRONES DE TIMING POR CATEGORÍA:
- Deportes (partidos): cerrar 30 minutos después del inicio del partido
- Deportes (no-partido, ej: "¿Será X el DT?"): EVITAR salvo que sea
  excepcionalmente atractivo. Si lo generás, usar ventana corta (días)
- Economía (datos diarios como dólar, riesgo país): cerrar la NOCHE
  ANTERIOR al día del dato (ej: cierra jueves noche para dato del viernes)
- Economía (datos rezagados como reservas BCRA, IPC): enmarcar como
  PERÍODO ("al cierre de febrero"), nunca como fecha puntual
- Clima: SIEMPRE día único, NUNCA rangos multi-día. "¿La mínima del
  viernes baja de X?" con cierre jueves noche. PROHIBIDO: "en algún
  día del 11 al 15" porque el Sí puede cumplirse el día 1
- Política: cerrar antes del voto o anuncio esperado. Mercados "antes
  de X" con ventana >1 semana son riesgosos — solo si muy atractivos
- Si no podés garantizar timing seguro, NO generes el mercado

REGLAS DE CONTENIDO:
- Evitar mercados globales cubiertos por Polymarket/Kalshi
  (EXCEPCIÓN: eventos de altísima importancia como elecciones)
- NUNCA inventar números. Si no tenés el dato actual, marcá como
  "requiere verificación" y dejá el campo vacío
- Todos los resultados deben ser plausibles

TIPO DE MERCADO:
- Decidí si el mercado es binario (Sí/No) o multi-opción
- Para preguntas con más de 2 respuestas naturales (ej: quién gana una elección,
  en qué rango cae un indicador), usá multi-opción con outcomes explícitos
- Los mercados binarios usan outcomes: ["Si", "No"]
- Multi-opción: entre 3 y 8 outcomes. Si hay más de 8, agrupá en "Otro"
- SIEMPRE incluí "Otro" salvo que los outcomes sean matemáticamente exhaustivos
  (ej: rangos numéricos contiguos que cubren todas las posibilidades)
- Al menos 2 outcomes deben tener >10% de probabilidad. Si uno domina >85%,
  reformulá la pregunta o usá formato binario

CONTINGENCIAS ESTÁNDAR (incluir las que apliquen):
- Si la fuente no publica: usar fuente alternativa o última disponible
- Si el evento se cancela: resolver según las opciones del mercado (en binarios: "No")
- Si hay revisión de datos: usar primera publicación
- Deportes partidos: resultado en tiempo reglamentario + cláusula de
  reprogramación ("si se reprograma a fecha anterior, cierre anticipado")
- Deportes partidos: cancelación/suspensión/posterga a otro día → "No"
- Clima: siempre referenciar timeanddate.com como fuente

REGLAS DE VALIDACIÓN:
{rules}

FORMATO DE DESCRIPCIÓN:
La descripción ES la especificación completa del mercado en Markdown.
NO incluir contexto adicional, narrativa ni explicaciones de por qué el mercado
es interesante. SOLO las secciones requeridas:
  ## Criterio de resolución — dato exacto, fecha, fuente, cómo se determina el resultado
  ## Contingencias — qué pasa si la fuente no publica, evento se cancela, etc.
  ## Fuente de resolución — nombre + URL
Los campos resolutionCriteria, resolutionSource y contingencies son resúmenes
de una línea extraídos de la descripción.

EJEMPLO 1 (Dólar Blue):
Título: ¿En qué rango cerrará el dólar blue el Viernes 3 de Abril?
Descripción:
## Criterio de resolución

Este mercado se resolverá según la **cotización de venta de cierre** del dólar blue el **viernes 3 de abril de 2026**, publicada por Ámbito Financiero. Los rangos son contiguos, mutuamente excluyentes y cubren todos los valores posibles.

## Contingencias

- Si el 3 de abril es feriado o no hay cotización, se utiliza la cotización de cierre del último día hábil anterior.
- En caso de discrepancia entre fuentes, prevalece el valor publicado en la página de cotización del dólar informal de Ámbito Financiero.

## Fuente de resolución

Ámbito Financiero — [www.ambito.com/contenidos/dolar-informal.html](https://www.ambito.com/contenidos/dolar-informal.html)

EJEMPLO 2 (Reservas BCRA):
Título: ¿En qué rango estarán las Reservas del BCRA al Viernes 3 de Abril?
Descripción:
## Criterio de resolución

Este mercado se resolverá según el **último dato publicado** de Reservas Internacionales del BCRA en la sección "Estadísticas e Indicadores" del sitio del BCRA al **viernes 3 de abril de 2026**. El dato puede corresponder a un día hábil anterior debido al rezago habitual de publicación del BCRA (2-5 días). Los rangos son contiguos, mutuamente excluyentes y cubren todos los valores posibles.

## Contingencias

- Si el 3 de abril es feriado o no hay nueva publicación, se utiliza el último dato disponible en el sitio del BCRA.
- En caso de revisión posterior de los datos, se utilizará el dato publicado originalmente (primera publicación).
- El dato de reservas es provisorio y está sujeto a cambios de valuación según lo indica el propio BCRA.

## Fuente de resolución

BCRA — [www.bcra.gob.ar/estadisticas-indicadores/](https://www.bcra.gob.ar/estadisticas-indicadores/)

INSTRUCCIONES:
- Cada tema viene con ángulos sugeridos. Usá esos ángulos como guía pero
  podés mejorarlos, combinarlos o descartarlos si encontrás algo mejor.
- Generá exactamente {targetCount} mercados eligiendo los mejores temas/ángulos.
- Priorizá temas con score más alto.
- NO generes más de 1 mercado por tema salvo que tenga ángulos muy distintos.`;

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
          outcomes: { type: 'array' as const, items: { type: 'string' as const }, description: 'Opciones del mercado. Binarios: ["Si", "No"]. Multi-opción: listar todas las opciones.' },
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

function formatRules(): string {
  const hard = HARD_RULES.map((r) => `- ${r.id}: ${r.description}`).join('\n');
  const soft = SOFT_RULES.map((r) => `- ${r.id}: ${r.description}`).join('\n');
  return `Reglas estrictas (rechazo automático si falla):\n${hard}\n\nAdvertencias:\n${soft}`;
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

  const [triageFeedback, globalFeedbackText, promptTemplate] = await Promise.all([
    loadTriageFeedback(),
    loadGlobalFeedback(),
    loadGenerationPrompt(),
  ]);
  const today = new Date().toISOString().split('T')[0];

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
    .replace('{rules}', formatRules())
    .replace('{targetCount}', String(targetCount))
    + editorBlock;

  const userMessage = `DATOS ACTUALES (no inventar otros):
${formatDataPoints(dataPoints)}

HOY: ${today}
AÑO ACTUAL: ${new Date().getFullYear()}
IMPORTANTE: Todos los endTimestamp y expectedResolutionDate deben ser en el año ${new Date().getFullYear()}.
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
