import { inngest } from './client';
import { db } from '@/db/client';
import { topics as topicsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { researchTopic } from '@/agents/sourcer/topic-research';
import { logActivity, inngestRunUrl } from '@/lib/activity-log';
import { setCurrentRunId } from '@/lib/llm';
import { getRunCost } from '@/lib/usage';

export const researchJob = inngest.createFunction(
  {
    id: 'topic-research',
    retries: 8,
    concurrency: { limit: 2 },
    throttle: { limit: 1, period: '1m' },
    onFailure: async ({ event }) => {
      const topicId = event.data.event.data.topicId as string | undefined;
      if (topicId) {
        // Reset status back to active if research fails
        await db.update(topicsTable).set({ status: 'active' }).where(eq(topicsTable.id, topicId));
        await logActivity('research_failed', {
          entityType: 'topic',
          entityId: topicId,
          detail: { error: (event.data as Record<string, unknown>).error },
          source: 'pipeline',
        });
      }
    },
  },
  { event: 'topics/research.requested' },
  async ({ event, step, runId }) => {
    const runUrl = inngestRunUrl('topic-research', runId);
    setCurrentRunId(`topic-research/${runId}`);
    const description = event.data.description as string;
    const topicId = event.data.topicId as string | undefined;

    // Set topic to researching status
    if (topicId) {
      await step.run('set-researching', async () => {
        await db.update(topicsTable).set({ status: 'researching', updatedAt: new Date() }).where(eq(topicsTable.id, topicId));
      });
    }

    // Run research (web search + save signals)
    const result = await step.run('research', async () => {
      return researchTopic({ description, topicId });
    });

    // Update topic with research metadata if it exists
    if (topicId) {
      await step.run('update-topic', async () => {
        const [topic] = await db.select({ status: topicsTable.status }).from(topicsTable).where(eq(topicsTable.id, topicId));
        // Only update if still in researching status (not modified by another process)
        if (topic?.status === 'researching') {
          await db
            .update(topicsTable)
            .set({
              summary: result.summary,
              suggestedAngles: result.suggestedAngles,
              score: result.score,
              signalCount: result.signals.length,
              lastSignalAt: new Date(),
              status: 'active',
              updatedAt: new Date(),
            })
            .where(eq(topicsTable.id, topicId));
        }
      });
    }

    // Log completion
    await step.run('log-completion', async () => {
      const costUsd = await getRunCost(`topic-research/${runId}`);
      await logActivity('topic_research_completed', {
        entityType: 'topic',
        entityId: topicId,
        entityLabel: result.name,
        detail: {
          description,
          signalCount: result.signals.length,
          signals: result.signals.map((s) => ({ source: s.source, text: s.text.slice(0, 150), url: s.url ?? null })),
          inngestRunUrl: runUrl,
          costUsd,
        },
        source: 'pipeline',
      });
    });

    return { topicId, signalCount: result.signals.length };
  },
);
