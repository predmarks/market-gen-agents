import { callClaude } from '@/lib/llm';
import { HARD_RULES, SOFT_RULES } from '@/config/rules';
import type { SourceSignal, DataPoint, GeneratedCandidate } from './types';

const SYSTEM_PROMPT = `Sos un creador de mercados predictivos para Predmarks, una plataforma
argentina de mercados de predicción. Tu trabajo es convertir señales de
noticias y datos en mercados atractivos y operables.

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
- Enfoque Argentina: política, economía, deportes, entretenimiento, clima
  (temas de "sociedad" van en Política)
- Evitar mercados globales cubiertos por Polymarket/Kalshi
  (EXCEPCIÓN: eventos de altísima importancia como elecciones)
- NUNCA inventar números. Si no tenés el dato actual, marcá como
  "requiere verificación" y dejá el campo vacío
- Preferir mercados controversiales con potencial de oscilaciones
- Ambos resultados (Sí y No) deben ser plausibles

CONTINGENCIAS ESTÁNDAR (incluir las que apliquen):
- Si la fuente no publica: usar fuente alternativa o última disponible
- Si el evento se cancela: resolver como "No"
- Si hay revisión de datos: usar primera publicación
- Deportes partidos: resultado en tiempo reglamentario + cláusula de
  reprogramación ("si se reprograma a fecha anterior, cierre anticipado")
- Deportes partidos: cancelación/suspensión/posterga a otro día → "No"
- Clima: siempre referenciar timeanddate.com como fuente

REGLAS DE VALIDACIÓN (tu output será verificado contra estas):
{rules}

Generá entre 8 y 15 mercados candidatos a partir de estas señales.
Intentá cubrir la mayor variedad de categorías y temas posible.
Salteá señales que claramente no dan buenos mercados, pero sé generoso:
si una señal tiene potencial razonable, generá el mercado.
Cada señal puede inspirar más de un mercado (ej: distintos ángulos o plazos).`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    candidates: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'Pregunta sí/no en español argentino, con signos de interrogación' },
          description: { type: 'string' as const, description: 'Contexto breve del mercado' },
          resolutionCriteria: { type: 'string' as const, description: 'Criterios de resolución claros y binarios' },
          resolutionSource: { type: 'string' as const, description: 'Nombre y URL de la fuente de resolución' },
          contingencies: { type: 'string' as const, description: 'Cláusulas de contingencia aplicables' },
          category: {
            type: 'string' as const,
            enum: ['Política', 'Economía', 'Deportes', 'Entretenimiento', 'Clima'],
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
          'title', 'description', 'resolutionCriteria', 'resolutionSource',
          'contingencies', 'category', 'tags', 'endTimestamp',
          'expectedResolutionDate', 'timingAnalysis',
        ] as const,
      },
    },
  },
  required: ['candidates'] as const,
};

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

function formatSignals(signals: SourceSignal[]): string {
  return signals
    .map((s, i) => {
      const parts = [`${i + 1}. [${s.source}] ${s.text}`];
      if (s.summary) parts.push(`   ${s.summary}`);
      if (s.url) parts.push(`   ${s.url}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

const BATCH_SIZE = 20;

async function generateBatch(
  signals: SourceSignal[],
  dataPoints: DataPoint[],
  openMarketTitles: string[],
  batchIndex: number,
): Promise<GeneratedCandidate[]> {
  const today = new Date().toISOString().split('T')[0];

  const system = SYSTEM_PROMPT
    .replace('{rules}', formatRules());

  const userMessage = `DATOS ACTUALES (no inventar otros):
${formatDataPoints(dataPoints)}

HOY: ${today}
AÑO ACTUAL: ${new Date().getFullYear()}
IMPORTANTE: Todos los endTimestamp y expectedResolutionDate deben ser en el año ${new Date().getFullYear()}.

MERCADOS ABIERTOS (no duplicar):
${openMarketTitles.length > 0 ? openMarketTitles.map((t) => `- ${t}`).join('\n') : 'Ninguno'}

SEÑALES (lote ${batchIndex + 1}):
${formatSignals(signals)}`;

  const { result } = await callClaude<{ candidates: GeneratedCandidate[] }>({
    system,
    userMessage,
    outputSchema: OUTPUT_SCHEMA,
    outputToolName: 'generate_markets',
  });

  return result.candidates;
}

export async function generateMarkets(
  signals: SourceSignal[],
  dataPoints: DataPoint[],
  openMarketTitles: string[],
): Promise<GeneratedCandidate[]> {
  if (signals.length === 0) return [];

  // Split signals into batches for parallel generation
  const batches: SourceSignal[][] = [];
  for (let i = 0; i < signals.length; i += BATCH_SIZE) {
    batches.push(signals.slice(i, i + BATCH_SIZE));
  }

  console.log(`Generating candidates from ${batches.length} batch(es) of signals...`);

  const results = await Promise.allSettled(
    batches.map((batch, i) => generateBatch(batch, dataPoints, openMarketTitles, i)),
  );

  const allCandidates: GeneratedCandidate[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allCandidates.push(...result.value);
    } else {
      console.warn('Generation batch failed:', result.reason);
    }
  }

  return allCandidates;
}
