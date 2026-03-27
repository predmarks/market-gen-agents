import { inngest } from './client';
import { db } from '@/db/client';
import { topics as topicsTable, signals as signalsTable, topicSignals } from '@/db/schema';
import { eq, inArray, isNotNull } from 'drizzle-orm';
import { callClaudeWithSearch } from '@/lib/llm';
import { updateTopics } from '@/agents/sourcer/topic-extractor';
import { slugify } from '@/agents/sourcer/types';
import type { Topic, SourceSignal } from '@/agents/sourcer/types';
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

interface ResearchSource {
  title: string;
  url: string;
  summary: string;
  source: string;
  publishedAt?: string;
}

interface ResearchResult {
  name: string;
  summary: string;
  category: MarketCategory;
  suggestedAngles: string[];
  score: number;
  sources: ResearchSource[];
}

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

export const suggestTopicJob = inngest.createFunction(
  { id: 'suggest-topic', retries: 1 },
  { event: 'topics/suggest.requested' },
  async ({ event, step }) => {
    const description = event.data.description as string;
    const placeholderTopicId = event.data.topicId as string | undefined;

    // Step 1: Research the topic via web search
    const research = await step.run('research', async () => {
      const { result } = await callClaudeWithSearch<ResearchResult>({
        system: SYSTEM_PROMPT,
        userMessage: description,
        outputSchema: RESEARCH_SCHEMA,
        model: 'opus',
      });
      return result;
    });

    // Step 2: Save signals from research sources, then consolidate topic (dedup with existing)
    const topicId = await step.run('consolidate-topic', async () => {
      // Save research sources as signals
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

      // Load existing active/stale topics for dedup
      const existingTopicRows = await db
        .select()
        .from(topicsTable)
        .where(inArray(topicsTable.status, ['active', 'stale']));

      // Filter out the placeholder topic from existing topics
      const existingTopics: Topic[] = existingTopicRows
        .filter((row) => row.id !== placeholderTopicId)
        .map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          summary: row.summary,
          signalIndices: [],
          suggestedAngles: row.suggestedAngles,
          category: row.category as Topic['category'],
          score: row.score,
          status: row.status as Topic['status'],
          signalCount: row.signalCount,
          lastSignalAt: row.lastSignalAt?.toISOString(),
          lastGeneratedAt: row.lastGeneratedAt?.toISOString(),
        }));

      // Let the LLM decide: update existing topic or create new
      const topicUpdates = await updateTopics(savedSignals, existingTopics);

      const now = new Date();

      // Build signal index → DB ID map (1-based, as updateTopics uses)
      const signalIdMap = new Map<number, string>();
      savedSignals.forEach((s, i) => {
        if (s.id) signalIdMap.set(i + 1, s.id);
      });

      let resolvedTopicId = placeholderTopicId;

      if (topicUpdates.length > 0) {
        const update = topicUpdates[0]; // Take the primary result

        if (update.action === 'update' && update.existingTopicSlug) {
          // Matches an existing topic — merge into it
          const existing = existingTopicRows.find((t) => t.slug === update.existingTopicSlug);
          if (existing) {
            await db
              .update(topicsTable)
              .set({
                summary: update.summary,
                score: update.score,
                suggestedAngles: update.suggestedAngles,
                signalCount: existing.signalCount + update.signalIndices.length,
                lastSignalAt: now,
                status: 'active',
                updatedAt: now,
              })
              .where(eq(topicsTable.id, existing.id));

            resolvedTopicId = existing.id;

            // Delete the placeholder since we merged into existing
            if (placeholderTopicId && placeholderTopicId !== existing.id) {
              await db.delete(topicsTable).where(eq(topicsTable.id, placeholderTopicId));
            }
          }
        }

        if (update.action === 'create' || !resolvedTopicId || resolvedTopicId === placeholderTopicId) {
          // New topic — update the placeholder with research data
          if (placeholderTopicId) {
            await db
              .update(topicsTable)
              .set({
                name: update.name ?? research.name,
                slug: slugify(update.name ?? research.name),
                summary: update.summary ?? research.summary,
                category: (update.category ?? research.category) as MarketCategory,
                suggestedAngles: update.suggestedAngles ?? research.suggestedAngles,
                score: update.score ?? research.score,
                status: 'active',
                signalCount: savedSignals.length,
                lastSignalAt: now,
                updatedAt: now,
              })
              .where(eq(topicsTable.id, placeholderTopicId));
            resolvedTopicId = placeholderTopicId;
          }
        }
      } else {
        // No topic updates from LLM — just update the placeholder with research data
        if (placeholderTopicId) {
          await db
            .update(topicsTable)
            .set({
              name: research.name,
              slug: slugify(research.name),
              summary: research.summary,
              category: research.category,
              suggestedAngles: research.suggestedAngles,
              score: research.score,
              status: 'active',
              signalCount: savedSignals.length,
              lastSignalAt: now,
              updatedAt: now,
            })
            .where(eq(topicsTable.id, placeholderTopicId));
        }
      }

      // Link signals to the resolved topic
      if (resolvedTopicId) {
        for (const idx of topicUpdates[0]?.signalIndices ?? []) {
          const signalId = signalIdMap.get(idx);
          if (signalId) {
            await db
              .insert(topicSignals)
              .values({ topicId: resolvedTopicId, signalId })
              .onConflictDoNothing();
          }
        }

        // Also link any signals not captured by indices (fallback)
        for (const s of savedSignals) {
          if (s.id) {
            await db
              .insert(topicSignals)
              .values({ topicId: resolvedTopicId, signalId: s.id })
              .onConflictDoNothing();
          }
        }
      }

      return resolvedTopicId;
    });

    return { topicId };
  },
);
