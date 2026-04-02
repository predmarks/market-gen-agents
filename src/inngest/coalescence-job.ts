import { inngest } from './client';
import { db } from '@/db/client';
import { signals as signalsTable, topics as topicsTable, topicSignals } from '@/db/schema';
import { eq, inArray, gte, desc } from 'drizzle-orm';
import { coalesceTopics } from '@/agents/sourcer/topic-coalescence';
import { logActivity, inngestRunUrl } from '@/lib/activity-log';
import { setCurrentRunId } from '@/lib/llm';
import { getRunCost } from '@/lib/usage';
import type { SourceSignal } from '@/agents/sourcer/types';

export const coalescenceJob = inngest.createFunction(
  {
    id: 'topic-coalescence',
    retries: 3,
    concurrency: { limit: 1 },
  },
  { event: 'topics/coalesce.requested' },
  async ({ event, step, runId }) => {
    const runUrl = inngestRunUrl('topic-coalescence', runId);
    setCurrentRunId(`topic-coalescence/${runId}`);
    const topicId = event.data.topicId as string | undefined;

    // Load signals: either topic-specific or recent uncoalesced
    const signals = await step.run('load-signals', async () => {
      let rows: typeof signalsTable.$inferSelect[] = [];

      if (topicId) {
        // Load signals linked to this topic
        const linkedSignalIds = await db
          .select({ signalId: topicSignals.signalId })
          .from(topicSignals)
          .where(eq(topicSignals.topicId, topicId));

        if (linkedSignalIds.length > 0) {
          rows = await db
            .select()
            .from(signalsTable)
            .where(inArray(signalsTable.id, linkedSignalIds.map((r) => r.signalId)));
        } else {
          rows = [];
        }
      } else {
        // Load recent signals (last 48h)
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
        rows = await db
          .select()
          .from(signalsTable)
          .where(gte(signalsTable.publishedAt, cutoff))
          .orderBy(desc(signalsTable.publishedAt))
          .limit(200);
      }

      return rows.map((r): SourceSignal => ({
        id: r.id,
        type: r.type as SourceSignal['type'],
        text: r.text,
        summary: r.summary ?? undefined,
        url: r.url ?? undefined,
        source: r.source,
        publishedAt: r.publishedAt.toISOString(),
        entities: [],
        category: (r.category ?? undefined) as SourceSignal['category'],
        dataPoints: r.dataPoints ?? undefined,
      }));
    });

    if (signals.length === 0) {
      return { topicIds: [], message: 'No signals to coalesce' };
    }

    // Run coalescence
    const result = await step.run('coalesce', async () => {
      return coalesceTopics({ signals, placeholderTopicId: topicId });
    });

    // Log completion
    await step.run('log-completion', async () => {
      const topicDetails = result.topicIds.length > 0
        ? await db
            .select({ id: topicsTable.id, name: topicsTable.name, slug: topicsTable.slug })
            .from(topicsTable)
            .where(inArray(topicsTable.id, result.topicIds))
        : [];

      const costUsd = await getRunCost(`topic-coalescence/${runId}`);
      await logActivity('topic_coalescence_completed', {
        entityType: 'system',
        entityLabel: topicDetails.map((t) => t.name).join(', ') || 'no topics',
        detail: {
          topicCount: result.topicIds.length,
          signalCount: signals.length,
          topics: topicDetails.map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
          inngestRunUrl: runUrl,
          costUsd,
        },
        source: 'pipeline',
      });
    });

    return { topicIds: result.topicIds };
  },
);
