import { inngest } from './client';
import { db } from '@/db/client';
import { sourcingRuns, topics as topicsTable } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { ingestAllSources, markSignalsUsed } from '@/agents/sourcer/ingestion';
import { coalesceTopics } from '@/agents/sourcer/topic-coalescence';
import type { SourcingStep } from '@/db/types';
import { logActivity, inngestRunUrl } from '@/lib/activity-log';
import { setCurrentRunId } from '@/lib/llm';
import { getRunCost } from '@/lib/usage';

const STEP_NAMES = ['ingest', 'update-topics'] as const;

function buildSteps(currentIdx: number, detail?: string): SourcingStep[] {
  return STEP_NAMES.map((name, i) => ({
    name,
    status: i < currentIdx ? 'done' : i === currentIdx ? 'running' : 'pending',
    ...(i === currentIdx && detail ? { detail } : {}),
  }));
}

export const ingestionJob = inngest.createFunction(
  { id: 'ingestion-pipeline', retries: 3, concurrency: { limit: 1 } },
  { event: 'signals/ingest.requested' },
  async ({ step, runId: inngestId }) => {
    const runUrl = inngestRunUrl('ingestion-pipeline', inngestId);
    setCurrentRunId(`ingestion-pipeline/${inngestId}`);
    // Create run record
    const runId = await step.run('init-run', async () => {
      const [run] = await db
        .insert(sourcingRuns)
        .values({
          status: 'running',
          currentStep: 'ingest',
          steps: buildSteps(0),
        })
        .returning({ id: sourcingRuns.id });
      await logActivity('ingestion_started', { entityType: 'system', detail: { inngestRunUrl: runUrl }, source: 'pipeline' });
      return run.id;
    });

    async function updateRun(stepIdx: number, updates: Partial<typeof sourcingRuns.$inferInsert> = {}) {
      await db
        .update(sourcingRuns)
        .set({
          currentStep: STEP_NAMES[stepIdx] ?? 'done',
          steps: buildSteps(stepIdx, updates.error ?? undefined),
          ...updates,
        })
        .where(eq(sourcingRuns.id, runId));
    }

    try {
      // Step 0: Ingest
      const ingestionResult = await step.run('ingest', async () => {
        await updateRun(0);
        const result = await ingestAllSources();
        await db
          .update(sourcingRuns)
          .set({ signals: result.signals, signalsCount: result.signals.length })
          .where(eq(sourcingRuns.id, runId));
        return result;
      });

      // Mark all signals as used in this run
      await step.run('mark-signals-used', async () => {
        const signalIds = ingestionResult.signals.map((s) => s.id).filter(Boolean) as string[];
        await markSignalsUsed(signalIds, runId);
      });

      // Step 1: Coalesce signals into topics
      const freshTopicIds = await step.run('update-topics', async () => {
        await updateRun(1);
        const result = await coalesceTopics({ signals: ingestionResult.signals });
        return result.topicIds;
      });

      // Mark complete
      await step.run('mark-complete', async () => {
        await db
          .update(sourcingRuns)
          .set({
            status: 'complete',
            currentStep: 'done',
            steps: STEP_NAMES.map((name) => ({ name, status: 'done' as const })),
            completedAt: new Date(),
          })
          .where(eq(sourcingRuns.id, runId));
      });

      const signalsBySource: Record<string, number> = {};
      for (const s of ingestionResult.signals) {
        signalsBySource[s.source] = (signalsBySource[s.source] ?? 0) + 1;
      }
      // Fetch topic details for the log
      const freshTopicDetails = freshTopicIds.length > 0
        ? await db
            .select({ id: topicsTable.id, name: topicsTable.name, slug: topicsTable.slug })
            .from(topicsTable)
            .where(inArray(topicsTable.id, freshTopicIds))
        : [];

      const topicNames = freshTopicDetails.map((t) => t.name);
      const costUsd = await getRunCost(`ingestion-pipeline/${inngestId}`);
      await logActivity('ingestion_completed', {
        entityType: 'system',
        entityLabel: topicNames.length > 0
          ? topicNames.slice(0, 5).join(', ') + (topicNames.length > 5 ? ` (+${topicNames.length - 5})` : '')
          : `${ingestionResult.signals.length} señales`,
        detail: {
          signalsCount: ingestionResult.signals.length,
          topicCount: freshTopicIds.length,
          signalsBySource,
          signals: ingestionResult.signals.map((s) => ({ source: s.source, text: s.text.slice(0, 150), url: s.url ?? null })),
          topics: freshTopicDetails.map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
          inngestRunUrl: runUrl,
          costUsd,
        },
        source: 'pipeline',
      });

      return { status: 'complete', runId, topicIds: freshTopicIds };
    } catch (err) {
      // Mark run as failed
      await db
        .update(sourcingRuns)
        .set({
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        })
        .where(eq(sourcingRuns.id, runId));
      await logActivity('ingestion_failed', { entityType: 'system', detail: { error: err instanceof Error ? err.message : String(err), inngestRunUrl: runUrl }, source: 'pipeline' });
      throw err;
    }
  },
);
