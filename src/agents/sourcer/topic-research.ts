import { db } from '@/db/client';
import { signals as signalsTable, topicSignals } from '@/db/schema';
import { isNotNull } from 'drizzle-orm';
import { callClaudeWithSearch } from '@/lib/llm';
import type { SourceSignal } from './types';
import type { MarketCategory } from '@/db/types';

const RESEARCH_SCHEMA = {
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const, description: 'Nombre corto del tema' },
    summary: {
      type: 'string' as const,
      description: 'Resumen detallado (3-5 oraciones): contexto actual, datos relevantes, tensiones',
    },
    category: {
      type: 'string' as const,
      enum: ['Política', 'Economía', 'Deportes', 'Entretenimiento', 'Clima', 'Otros'],
    },
    suggestedAngles: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: '3-5 preguntas específicas para mercados predictivos (binarios o multi-opción)',
    },
    score: { type: 'number' as const, description: 'Potencial de mercado 0-10' },
    sources: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          title: { type: 'string' as const, description: 'Título del artículo o fuente' },
          url: { type: 'string' as const, description: 'URL de la fuente' },
          summary: { type: 'string' as const, description: 'Resumen breve de lo relevante (1-2 oraciones)' },
          source: { type: 'string' as const, description: 'Nombre del medio: Clarín, La Nación, BCRA, etc.' },
          publishedAt: { type: 'string' as const, description: 'Fecha de publicación ISO si está disponible' },
        },
        required: ['title', 'url', 'summary', 'source'] as const,
      },
      description: 'Las fuentes principales que encontraste durante la investigación (3-10 artículos/datos)',
    },
  },
  required: ['name', 'summary', 'category', 'suggestedAngles', 'score', 'sources'] as const,
};

const SYSTEM_PROMPT = `Sos un investigador para Predmarks, una plataforma argentina de mercados de predicción.
El usuario describe un tema para mercados predictivos argentinos.
Investigá usando web search para obtener contexto actual: fechas, datos, estado actual, tensiones.
Devolvé un análisis estructurado del tema.

IMPORTANTE:
- El nombre debe ser corto y descriptivo (máximo 8 palabras)
- El resumen debe tener 3-5 oraciones con contexto actual verificado
- Los ángulos sugeridos deben ser preguntas concretas y resolubles (binarias sí/no o multi-opción)
- El score refleja el potencial como mercado predictivo (interés público, resolución clara, timing)
- Incluí todas las fuentes que consultaste (artículos, datos, páginas) con URL, título, resumen breve y fecha si la tenés
- Todo en español argentino`;

interface ResearchSource {
  title: string;
  url: string;
  summary: string;
  source: string;
  publishedAt?: string;
}

interface LLMResearchResult {
  name: string;
  summary: string;
  category: MarketCategory;
  suggestedAngles: string[];
  score: number;
  sources: ResearchSource[];
}

export interface TopicResearchResult {
  signals: SourceSignal[];
  name: string;
  summary: string;
  category: MarketCategory;
  suggestedAngles: string[];
  score: number;
}

/**
 * Pipeline 1: Research a topic by searching the web and saving discovered signals.
 * Does NOT create or coalesce topics — only gathers signals.
 */
export async function researchTopic(opts: {
  description: string;
  topicId?: string;
  category?: string;
}): Promise<TopicResearchResult> {
  // Step 1: Web search via Claude
  const { result: research } = await callClaudeWithSearch<LLMResearchResult>({
    system: SYSTEM_PROMPT,
    userMessage: opts.description,
    outputSchema: RESEARCH_SCHEMA,
    model: 'opus',
    operation: 'research_topic',
  });

  // Step 2: Save discovered sources as signals
  const savedSignals: SourceSignal[] = [];
  for (const source of research.sources ?? []) {
    if (!source.url) continue;
    try {
      const [signal] = await db
        .insert(signalsTable)
        .values({
          type: 'news',
          text: source.title,
          summary: source.summary,
          url: source.url,
          source: source.source,
          publishedAt: source.publishedAt ? new Date(source.publishedAt) : new Date(),
          category: research.category,
        })
        .onConflictDoUpdate({
          target: signalsTable.url,
          targetWhere: isNotNull(signalsTable.url),
          set: { summary: source.summary },
        })
        .returning({ id: signalsTable.id });

      savedSignals.push({
        id: signal.id,
        type: 'news',
        text: source.title,
        summary: source.summary,
        url: source.url,
        source: source.source,
        publishedAt: source.publishedAt ?? new Date().toISOString(),
        entities: [],
        category: research.category,
      });
    } catch {
      // Skip individual signal failures
    }
  }

  // Step 3: If topicId provided, link signals to it
  if (opts.topicId) {
    for (const s of savedSignals) {
      if (s.id) {
        await db
          .insert(topicSignals)
          .values({ topicId: opts.topicId, signalId: s.id })
          .onConflictDoNothing();
      }
    }
  }

  return {
    signals: savedSignals,
    name: research.name,
    summary: research.summary,
    category: research.category,
    suggestedAngles: research.suggestedAngles,
    score: research.score,
  };
}
