import { inngest } from './client';
import { db } from '@/db/client';
import { topics as topicsTable, signals as signalsTable, topicSignals, markets as marketsTable } from '@/db/schema';
import { eq, inArray, isNotNull, gte, desc } from 'drizzle-orm';
import type { SourceContext } from '@/db/types';
import { callClaudeWithSearch } from '@/lib/llm';
import { updateTopics } from '@/agents/sourcer/topic-extractor';
import { slugify } from '@/agents/sourcer/types';
import type { Topic, SourceSignal } from '@/agents/sourcer/types';
import type { MarketCategory } from '@/db/types';
import { logActivity, inngestRunUrl } from '@/lib/activity-log';
import { setCurrentRunId } from '@/lib/llm';
import { getRunCost } from '@/lib/usage';

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
  {
    id: 'suggest-topic',
    retries: 8,
    concurrency: { limit: 1 },
    throttle: { limit: 1, period: '1m' },
    onFailure: async ({ event }) => {
      const topicId = event.data.event.data.topicId as string | undefined;
      if (topicId) {
        await db.update(topicsTable).set({ status: 'active' }).where(eq(topicsTable.id, topicId));
        await logActivity('research_failed', {
          entityType: 'topic',
          entityId: topicId,
          entityLabel: '',
          detail: { error: (event.data as Record<string, unknown>).error },
          source: 'pipeline',
        });
      }
    },
  },
  { event: 'topics/suggest.requested' },
  async ({ event, step, runId }) => {
    const runUrl = inngestRunUrl('suggest-topic', runId);
    setCurrentRunId(`suggest-topic/${runId}`);
    const description = event.data.description as string;
    const placeholderTopicId = event.data.topicId as string | undefined;

    // Step 1: Research the topic via web search
    const research = await step.run('research', async () => {
      const { result } = await callClaudeWithSearch<ResearchResult>({
        system: SYSTEM_PROMPT,
        userMessage: description,
        outputSchema: RESEARCH_SCHEMA,
        model: 'opus',
        operation: 'research_topic',
      });
      return result;
    });

    // Step 2: Save signals, load existing related signals, consolidate topic
    const result = await step.run('consolidate-topic', async () => {
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

      // Load existing signals in the same category (last 30 days) for richer context
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const existingSignals = await db
        .select({
          id: signalsTable.id,
          type: signalsTable.type,
          text: signalsTable.text,
          summary: signalsTable.summary,
          url: signalsTable.url,
          source: signalsTable.source,
          publishedAt: signalsTable.publishedAt,
          category: signalsTable.category,
        })
        .from(signalsTable)
        .where(gte(signalsTable.publishedAt, thirtyDaysAgo))
        .orderBy(desc(signalsTable.publishedAt))
        .limit(100);

      // Combine: research signals first, then existing (deduped by ID)
      const seenIds = new Set(savedSignals.map((s) => s.id).filter(Boolean));
      const allSignals: SourceSignal[] = [...savedSignals];
      for (const s of existingSignals) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
        allSignals.push({
          id: s.id,
          type: s.type as SourceSignal['type'],
          text: s.text,
          summary: s.summary ?? undefined,
          url: s.url ?? undefined,
          source: s.source,
          publishedAt: s.publishedAt.toISOString(),
          entities: [],
          category: (s.category ?? undefined) as SourceSignal['category'],
        });
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
      const topicUpdates = await updateTopics(allSignals, existingTopics);

      const now = new Date();

      // Build signal index → DB ID map (1-based, as updateTopics uses)
      const signalIdMap = new Map<number, string>();
      allSignals.forEach((s, i) => {
        if (s.id) signalIdMap.set(i + 1, s.id);
      });

      let resolvedTopicId = placeholderTopicId;
      let action: 'created' | 'updated' | 'merged' = 'created';

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
                signalCount: existing.signalCount + savedSignals.length,
                lastSignalAt: now,
                status: 'active',
                updatedAt: now,
              })
              .where(eq(topicsTable.id, existing.id));

            resolvedTopicId = existing.id;
            action = 'merged';

            // Delete the placeholder since we merged into existing
            if (placeholderTopicId && placeholderTopicId !== existing.id) {
              await db.delete(topicSignals).where(eq(topicSignals.topicId, placeholderTopicId));
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
            action = update.action === 'update' ? 'updated' : 'created';
          }
        }
      } else {
        // No topic updates from LLM — update the placeholder with research data directly
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

      // Safety: ensure placeholder is never left in "researching" status
      if (placeholderTopicId) {
        const [check] = await db
          .select({ status: topicsTable.status })
          .from(topicsTable)
          .where(eq(topicsTable.id, placeholderTopicId));
        if (check && check.status === 'researching') {
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
          resolvedTopicId = placeholderTopicId;
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

        // Also link all saved signals (research sources) directly
        for (const s of savedSignals) {
          if (s.id) {
            await db
              .insert(topicSignals)
              .values({ topicId: resolvedTopicId, signalId: s.id })
              .onConflictDoNothing();
          }
        }
      }

      // Get resolved topic details for logging
      let topicName = research.name;
      let topicSlug = slugify(research.name);
      if (resolvedTopicId) {
        const [resolved] = await db
          .select({ name: topicsTable.name, slug: topicsTable.slug })
          .from(topicsTable)
          .where(eq(topicsTable.id, resolvedTopicId));
        if (resolved) {
          topicName = resolved.name;
          topicSlug = resolved.slug;
        }
      }

      return {
        topicId: resolvedTopicId,
        topicName,
        topicSlug,
        action,
        signals: savedSignals.map((s) => ({ source: s.source, text: s.text.slice(0, 150), url: s.url ?? null })),
      };
    });

    // Step 3: Link market to topic if marketId was provided
    const marketId = event.data.marketId as string | undefined;
    if (marketId && result.topicId) {
      await step.run('link-market', async () => {
        const [market] = await db
          .select({ id: marketsTable.id, sourceContext: marketsTable.sourceContext })
          .from(marketsTable)
          .where(eq(marketsTable.id, marketId));

        if (market) {
          const ctx = (market.sourceContext as SourceContext) ?? { originType: 'manual' as const, generatedAt: new Date().toISOString() };
          const existingTopicIds = ctx.topicIds ?? [];
          if (!existingTopicIds.includes(result.topicId!)) {
            await db.update(marketsTable).set({
              sourceContext: {
                ...ctx,
                topicIds: [...existingTopicIds, result.topicId!],
                topicNames: [...(ctx.topicNames ?? []), result.topicName],
              },
            }).where(eq(marketsTable.id, marketId));
          }
        }
      });
    }

    // Step 4: Log completion
    await step.run('log-completion', async () => {
      const costUsd = await getRunCost(`suggest-topic/${runId}`);
      await logActivity('topic_research_completed', {
        entityType: 'topic',
        entityId: result.topicId ?? undefined,
        entityLabel: result.topicName,
        detail: {
          description,
          action: result.action,
          topicSlug: result.topicSlug,
          signalCount: result.signals.length,
          signals: result.signals,
          ...(marketId ? { linkedMarketId: marketId } : {}),
          inngestRunUrl: runUrl,
          costUsd,
        },
        source: 'pipeline',
      });
    });

    return { topicId: result.topicId };
  },
);
