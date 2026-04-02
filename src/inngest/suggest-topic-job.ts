import { inngest } from './client';
import { db } from '@/db/client';
import { topics as topicsTable, markets as marketsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { SourceContext } from '@/db/types';
import { researchTopic } from '@/agents/sourcer/topic-research';
import { coalesceTopics } from '@/agents/sourcer/topic-coalescence';
import { slugify } from '@/agents/sourcer/types';
import { logActivity, inngestRunUrl } from '@/lib/activity-log';
import { setCurrentRunId } from '@/lib/llm';
import { getRunCost } from '@/lib/usage';

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

    // Pipeline 1: Research — web search + save signals
    const research = await step.run('research', async () => {
      return researchTopic({ description, topicId: placeholderTopicId });
    });

    // Pipeline 2: Coalesce — match/create/merge topics from discovered signals
    const coalesced = await step.run('coalesce', async () => {
      return coalesceTopics({
        signals: research.signals,
        placeholderTopicId,
      });
    });

    // Resolve the final topic ID
    const resolvedTopicId = await step.run('resolve-topic', async () => {
      // If coalescence produced results, use the first topic
      if (coalesced.topicIds.length > 0) {
        // If placeholder was merged into an existing topic, clean up
        if (placeholderTopicId && !coalesced.topicIds.includes(placeholderTopicId)) {
          const [check] = await db
            .select({ status: topicsTable.status })
            .from(topicsTable)
            .where(eq(topicsTable.id, placeholderTopicId));
          if (check?.status === 'researching') {
            // Placeholder wasn't used — update it with research data as fallback
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
                signalCount: research.signals.length,
                lastSignalAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(topicsTable.id, placeholderTopicId));
            return placeholderTopicId;
          }
        }
        return coalesced.topicIds[0];
      }

      // Fallback: update placeholder directly with research data
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
            signalCount: research.signals.length,
            lastSignalAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(topicsTable.id, placeholderTopicId));
        return placeholderTopicId;
      }

      return null;
    });

    // Link market to topic if marketId was provided
    const marketId = event.data.marketId as string | undefined;
    if (marketId && resolvedTopicId) {
      await step.run('link-market', async () => {
        const [market] = await db
          .select({ id: marketsTable.id, sourceContext: marketsTable.sourceContext })
          .from(marketsTable)
          .where(eq(marketsTable.id, marketId));

        if (market) {
          const ctx = (market.sourceContext as SourceContext) ?? { originType: 'manual' as const, generatedAt: new Date().toISOString() };
          const existingTopicIds = ctx.topicIds ?? [];
          if (!existingTopicIds.includes(resolvedTopicId!)) {
            const [topic] = await db.select({ name: topicsTable.name }).from(topicsTable).where(eq(topicsTable.id, resolvedTopicId!));
            await db.update(marketsTable).set({
              sourceContext: {
                ...ctx,
                topicIds: [...existingTopicIds, resolvedTopicId!],
                topicNames: [...(ctx.topicNames ?? []), topic?.name ?? ''],
              },
            }).where(eq(marketsTable.id, marketId));
          }
        }
      });
    }

    // Log completion
    await step.run('log-completion', async () => {
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

      const costUsd = await getRunCost(`suggest-topic/${runId}`);
      await logActivity('topic_research_completed', {
        entityType: 'topic',
        entityId: resolvedTopicId ?? undefined,
        entityLabel: topicName,
        detail: {
          description,
          topicSlug,
          signalCount: research.signals.length,
          signals: research.signals.map((s) => ({ source: s.source, text: s.text.slice(0, 150), url: s.url ?? null })),
          ...(marketId ? { linkedMarketId: marketId } : {}),
          inngestRunUrl: runUrl,
          costUsd,
        },
        source: 'pipeline',
      });
    });

    return { topicId: resolvedTopicId };
  },
);
