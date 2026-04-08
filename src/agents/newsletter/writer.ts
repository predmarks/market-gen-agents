import { callClaudeWithSearch } from '@/lib/llm';
import type { ReviewScores, SourceContext, Resolution } from '@/db/types';

// --- Input types ---

export interface NewsletterMarket {
  id: string;
  title: string;
  description: string;
  category: string;
  status: 'open' | 'in_resolution' | 'closed';
  outcomes: string[];
  endTimestamp: number;
  volume: string | null;
  participants: number | null;
  publishedAt: string | null;
  review: { scores: ReviewScores } | null;
  sourceContext: SourceContext;
  prices: number[] | null; // percentage per outcome (0-100)
  url: string | null; // public market link
  topics: Topic[]; // topics linked via sourceContext.topicIds, each with signals
}

export interface ResolvedMarket {
  title: string;
  outcome: string | null;
  resolvedAt: string | null;
  volume: string | null;
  participants: number | null;
  resolution: Resolution | null;
}

export interface Signal {
  text: string;
  summary: string | null;
  url: string | null;
  source: string;
  category: string | null;
  score: number | null;
  publishedAt: string;
}

export interface Topic {
  name: string;
  summary: string;
  category: string;
  suggestedAngles: string[];
  score: number;
  signals: Signal[];
}

export interface HottestTopic {
  name: string;
  summary: string;
  category: string;
  score: number;
  signalCount: number;
  linkedMarketTitles: string[];
}

export interface NewsletterInput {
  deployedMarkets: NewsletterMarket[];
  resolvedMarkets: ResolvedMarket[];
  hottestTopic: HottestTopic | null;
  /** ISO date string for the newsletter edition, e.g. "2026-04-07" */
  date: string;
}

// --- Output types ---

export interface FeaturedMarket {
  marketId: string;
  title: string;
  url: string;
  whyNow: string;
  closingNote: string;
}

export interface ResolvedEntry {
  title: string;
  outcome: string;
  context: string;
}

export interface NewsletterOutput {
  subjectLine: string;
  openingHook: string;
  featuredMarkets: FeaturedMarket[];
  resolvedEntries: ResolvedEntry[];
  closingCta: string;
  /** Full newsletter as markdown */
  markdown: string;
  /** Full newsletter as inline-styled HTML email */
  html: string;
}

// --- Prompt ---

const SYSTEM_PROMPT = `Sos el redactor del newsletter semanal de Predmarks, una plataforma argentina de mercados de predicción.

Tu trabajo es producir un newsletter que haga que los usuarios beta vuelvan a la app y operen.

TONO: Amigo informado de Buenos Aires que sigue política, economía y fútbol. Directo, con algo de opinión, a veces gracioso. Nunca corporativo, nunca vendedor. Tuteo, nunca usted.

REGLAS DE CONTENIDO:
- Todo en español argentino
- Nunca inventar datos. Si un dato no está disponible, omitilo
- Nunca incluir sección de "novedades del producto"
- Nunca usar "estimados", "queridos usuarios", ni saludos formales
- No explicar qué es un mercado de predicción — los usuarios ya saben
- Máximo 800 palabras. Tiene que poder escanearse en 2 minutos
- Si la semana fue floja, 2 mercados destacados en vez de 3

SUBJECT LINE: Corto, genera curiosidad, referencia el hook más fuerte. Sin emojis. Sin signos de exclamación. Tiene que sentirse como un mensaje de WhatsApp de un amigo informado.
- ✅ "¿Milei llega al 40%? El mercado dice que sí"
- ✅ "El dólar blue ya tiene precio en Predmarks"
- ❌ "Tu resumen semanal de Predmarks"
- ❌ "¡Nuevos mercados disponibles!"

ESTRUCTURA:
1. HOOK DE APERTURA (2-3 oraciones): Arrancá con un dato provocador o una brecha de opinión que genere tensión — "el mercado dice X pero la realidad apunta a Y". Conectalo con un mercado concreto. Sin preámbulos, sin saludos — empezá con el golpe. El lector tiene que sentir que se está perdiendo algo si no sigue leyendo.
2. MERCADOS DESTACADOS (3 bloques, o 2 si la semana fue tranquila): Para cada uno:
   - Título del mercado con link (usar el URL provisto)
   - Párrafo "por qué ahora" (2-3 oraciones): contexto de las noticias + ángulo contrario. El objetivo es que el lector piense "hmm, yo no estoy de acuerdo" — eso genera operaciones.
   - Línea de odds + cierre juntos: mostrar solo la opción ganadora y su % junto con la cuenta regresiva. Formato: "Sí al 62% · Cierra en 5 días". Si no cierra pronto, solo las odds: "Sí al 62%".
   - ESTADO DEL MERCADO: cada mercado tiene un campo "estado". Adaptá el tono según el estado:
     * "open": comportamiento normal — odds, countdown, invitación a operar.
     * "in_resolution": el mercado está en proceso de resolución. Mostrá las últimas odds conocidas y mencioná que se está resolviendo. No invites a operar.
     * "closed": el mercado ya cerró y tiene resultado. Mencionalo brevemente como contexto, no como invitación a operar.
3. RESOLUCIONES DE LA SEMANA (si hubo): Formato scoreboard, bien corto.
   - Título → Resultado: "¿Baja el riesgo país de 700? → Sí"
   - Una oración de contexto
   - Omitir esta sección si no hubo resoluciones
4. CTA DE CIERRE: Una línea casual invitando a operar. Energía "dale, metete".

PALANCAS DE ENGAGEMENT (no como checklist, sino como corriente subterránea):
- Brecha de opinión: "El mercado le da solo 30% — ¿vos qué decís?"
- FOMO por movimiento: "Las odds se movieron fuerte — algo sabe el mercado"
- Aversión a pérdida por timing: "Te quedan 5 días para meter tu posición"
- Sensación de insider: El lector tiene que sentir que está recibiendo señal, no ruido

REGLAS CRÍTICAS DE DATOS:
- SOLO podés usar mercados de la lista provista. NUNCA inventes, combines ni menciones mercados que no estén en los datos de entrada.
- Cada mercado destacado DEBE usar el marketId, título y URL exactos de los datos provistos.
- TODOS los datos numéricos (odds, precios, volumen, participantes) DEBEN venir de los datos provistos. La búsqueda web es SOLO para contexto editorial (noticias de fondo, por qué un tema importa). NUNCA sobreescribas datos provistos con información de la web.
- NO relaciones mercados entre sí a menos que compartan un tema explícitamente en los datos provistos. Que dos temas estén en las noticias al mismo tiempo no significa que estén relacionados.

FORMATO DE SALIDA: Markdown y HTML. El HTML debe ser inline-styled, mobile-responsive, auto-contenido (sin assets externos). Texto oscuro sobre fondo claro.`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    subjectLine: { type: 'string' as const, description: 'Email subject line (Spanish, no emojis, no exclamation marks)' },
    openingHook: { type: 'string' as const, description: '2-3 sentence opening paragraph connecting the biggest story to a market' },
    featuredMarkets: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          marketId: { type: 'string' as const, description: 'The market UUID' },
          title: { type: 'string' as const, description: 'Market title' },
          url: { type: 'string' as const, description: 'Public URL to the market' },
          whyNow: { type: 'string' as const, description: '2-3 sentence paragraph with news context and contrarian angle' },
          closingNote: { type: 'string' as const, description: 'Closing countdown if within 2 weeks (e.g. "Cierra en 5 días"), empty string otherwise' },
        },
        required: ['marketId', 'title', 'url', 'whyNow', 'closingNote'] as const,
      },
      description: '2-3 featured markets',
    },
    resolvedEntries: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'Market title' },
          outcome: { type: 'string' as const, description: 'Winning outcome (e.g. "Sí")' },
          context: { type: 'string' as const, description: 'One sentence of context or stat' },
        },
        required: ['title', 'outcome', 'context'] as const,
      },
      description: 'Resolved markets this week (empty array if none)',
    },
    closingCta: { type: 'string' as const, description: 'One casual line inviting to trade' },
    markdown: { type: 'string' as const, description: 'Full newsletter formatted as markdown with market links and odds included' },
    html: { type: 'string' as const, description: 'Full newsletter as inline-styled HTML email, mobile-responsive, clean design. Must be self-contained with all styles inline. Dark text on light background. No external assets.' },
  },
  required: ['subjectLine', 'openingHook', 'featuredMarkets', 'resolvedEntries', 'closingCta', 'markdown', 'html'] as const,
};

// --- Agent ---

function formatDaysUntil(endTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = endTimestamp - now;
  if (diff <= 0) return 'ya cerró';
  const days = Math.ceil(diff / 86400);
  return `${days} día${days === 1 ? '' : 's'}`;
}

function formatOdds(outcomes: string[], prices: number[] | null): string {
  if (!prices || prices.length === 0) return 'Sin datos de odds';
  let maxIdx = 0;
  for (let i = 1; i < prices.length; i++) {
    if ((prices[i] ?? 0) > (prices[maxIdx] ?? 0)) maxIdx = i;
  }
  return `${outcomes[maxIdx]}: ${prices[maxIdx] ?? 0}%`;
}

function formatTopicSignals(topic: Topic): string {
  const header = `  Tema: ${topic.name} (${topic.category}, score: ${topic.score})`;
  if (topic.signals.length === 0) return header;
  const signalLines = topic.signals.map((s) => [
    `    [${s.source}] (score: ${s.score ?? '?'})`,
    `    ${s.summary ?? s.text.slice(0, 300)}`,
    s.url ? `    URL: ${s.url}` : null,
  ].filter(Boolean).join('\n')).join('\n    ---\n');
  return `${header}\n  Señales:\n${signalLines}`;
}

function buildUserMessage(input: NewsletterInput): string {
  const marketsBlock = input.deployedMarkets.map((m) => {
    const daysLeft = formatDaysUntil(m.endTimestamp);
    const scores = m.review?.scores;
    const odds = formatOdds(m.outcomes, m.prices);
    const statusLabels = { open: 'Abierto', in_resolution: 'En resolución', closed: 'Cerrado' } as const;
    const lines = [
      `ID: ${m.id}`,
      `Título: ${m.title}`,
      `Estado: ${statusLabels[m.status]}`,
      `Descripción: ${m.description}`,
      `Categoría: ${m.category}`,
      `Opciones: ${(m.outcomes).join(', ')}`,
      `Odds: ${odds}`,
      `Cierra en: ${daysLeft} (${new Date(m.endTimestamp * 1000).toISOString().split('T')[0]})`,
      m.volume ? `Volumen: ${m.volume}` : null,
      m.url ? `URL: ${m.url}` : null,
      scores ? `Scores: overall=${scores.overallScore}, volumePotential=${scores.volumePotential}, timeliness=${scores.timeliness}` : null,
    ].filter(Boolean);

    if (m.topics.length > 0) {
      lines.push(`Temas relacionados (${m.topics.length}):`);
      lines.push(...m.topics.map(formatTopicSignals));
    }

    return lines.join('\n');
  }).join('\n---\n');

  const resolvedBlock = input.resolvedMarkets.length > 0
    ? input.resolvedMarkets.map((m) => [
        `Título: ${m.title}`,
        `Resultado: ${m.outcome ?? 'N/A'}`,
        `Resuelto: ${m.resolvedAt?.split('T')[0] ?? 'N/A'}`,
        m.resolution ? `Confianza: ${m.resolution.confidence}` : null,
      ].filter(Boolean).join('\n')).join('\n---\n')
    : '(Ningún mercado se resolvió esta semana)';

  const hottestBlock = input.hottestTopic
    ? [
        `Tema: ${input.hottestTopic.name} (${input.hottestTopic.category})`,
        `Resumen: ${input.hottestTopic.summary}`,
        `Score: ${input.hottestTopic.score} · ${input.hottestTopic.signalCount} señales recientes`,
        `Mercados relacionados: ${input.hottestTopic.linkedMarketTitles.join(', ')}`,
      ].join('\n')
    : '(No hay un tema dominante esta semana)';

  return `Fecha del newsletter: ${input.date}

== TEMA MÁS CALIENTE ==
${hottestBlock}
Usá este tema como base para el hook de apertura. Conectalo con el mercado más relevante.

== MERCADOS DESPLEGADOS (${input.deployedMarkets.length}) ==
Cada mercado incluye su estado (abierto, en resolución, o cerrado) y sus temas y señales relacionadas.
${marketsBlock || '(No hay mercados desplegados)'}

== MERCADOS RESUELTOS ESTA SEMANA ==
${resolvedBlock}

== REGLAS ESTRICTAS ==
- Solo podés elegir mercados de la lista de MERCADOS DESPLEGADOS de arriba. NUNCA inventes mercados.
- El marketId, título, URL y odds de cada mercado destacado deben coincidir EXACTAMENTE con los datos provistos arriba.
- La búsqueda web es solo para contexto editorial (noticias). NUNCA uses datos numéricos (precios, odds, volumen) de la web — usá exclusivamente los provistos.
- NO relaciones mercados entre sí a menos que compartan un tema en los datos provistos.
- Respetá el estado de cada mercado: no invites a operar en mercados que están en resolución o cerrados.

Usá los datos de odds provistos para cada mercado. Incluí el link del mercado en el markdown.
Buscá noticias recientes de LATAM para darle contexto fresco a los mercados destacados.

Escribí el newsletter completo.`;
}

export async function writeNewsletter(input: NewsletterInput): Promise<NewsletterOutput> {
  const { result } = await callClaudeWithSearch<NewsletterOutput>({
    system: SYSTEM_PROMPT,
    userMessage: buildUserMessage(input),
    outputSchema: OUTPUT_SCHEMA,
    outputToolName: 'newsletter',
    operation: 'write_newsletter',
    maxTokens: 16000,
  });

  return result;
}
