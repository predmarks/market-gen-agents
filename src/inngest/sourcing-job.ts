import { inngest } from './client';
import { db } from '@/db/client';
import { markets, sourcingRuns } from '@/db/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { ingestAllSources } from '@/agents/sourcer/ingestion';
import { generateMarkets } from '@/agents/sourcer/generator';
import { deduplicateCandidates } from '@/agents/sourcer/deduplication';
import type { SourcingStep } from '@/db/types';

const CANDIDATE_CAP = 50;

const STEP_NAMES = ['check-cap', 'ingest', 'generate', 'dedup', 'save', 'trigger-reviews'] as const;

function buildSteps(currentIdx: number, detail?: string): SourcingStep[] {
  return STEP_NAMES.map((name, i) => ({
    name,
    status: i < currentIdx ? 'done' : i === currentIdx ? 'running' : 'pending',
    ...(i === currentIdx && detail ? { detail } : {}),
  }));
}

export const sourcingJob = inngest.createFunction(
  { id: 'sourcing-pipeline', retries: 1 },
  [
    { cron: '0 9 * * 1,3,5' },
    { event: 'market/sourcing.requested' },
  ],
  async ({ step }) => {
    // Create run record
    const runId = await step.run('init-run', async () => {
      const [run] = await db
        .insert(sourcingRuns)
        .values({
          status: 'running',
          currentStep: 'check-cap',
          steps: buildSteps(0),
        })
        .returning({ id: sourcingRuns.id });
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
      // Step 0: Check cap
      const shouldRun = await step.run('check-cap', async () => {
        await updateRun(0);
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(markets)
          .where(eq(markets.status, 'candidate'));
        return count < CANDIDATE_CAP;
      });

      if (!shouldRun) {
        await step.run('mark-skipped', async () => {
          await db
            .update(sourcingRuns)
            .set({
              status: 'skipped',
              currentStep: 'done',
              steps: STEP_NAMES.map((name) => ({ name, status: 'done' as const, detail: name === 'check-cap' ? 'Cap alcanzado' : 'Omitido' })),
              completedAt: new Date(),
            })
            .where(eq(sourcingRuns.id, runId));
        });
        return { status: 'skipped', reason: 'cap_reached', runId };
      }

      // Step 1: Ingest
      const ingestionResult = await step.run('ingest', async () => {
        await updateRun(1);
        const result = await ingestAllSources();
        await db
          .update(sourcingRuns)
          .set({ signalsCount: result.signals.length })
          .where(eq(sourcingRuns.id, runId));
        return result;
      });

      // Load open markets (part of generate step visually)
      const openMarkets = await step.run('load-open-markets', async () => {
        return db
          .select({ id: markets.id, title: markets.title })
          .from(markets)
          .where(inArray(markets.status, ['open', 'approved']));
      });

      // Step 2: Generate
      const candidates = await step.run('generate', async () => {
        await updateRun(2);
        const result = await generateMarkets(
          ingestionResult.signals,
          ingestionResult.dataPoints,
          openMarkets.map((m) => m.title),
        );
        await db
          .update(sourcingRuns)
          .set({ candidatesGenerated: result.length })
          .where(eq(sourcingRuns.id, runId));
        return result;
      });

      if (candidates.length === 0) {
        await step.run('mark-empty', async () => {
          await db
            .update(sourcingRuns)
            .set({
              status: 'complete',
              currentStep: 'done',
              candidatesGenerated: 0,
              candidatesSaved: 0,
              steps: STEP_NAMES.map((name) => ({ name, status: 'done' as const })),
              completedAt: new Date(),
            })
            .where(eq(sourcingRuns.id, runId));
        });
        return { status: 'complete', candidates: 0, runId };
      }

      // Step 3: Dedup
      const unique = await step.run('dedup', async () => {
        await updateRun(3);
        return deduplicateCandidates(candidates, openMarkets);
      });

      if (unique.length === 0) {
        await step.run('mark-deduped', async () => {
          await db
            .update(sourcingRuns)
            .set({
              status: 'complete',
              currentStep: 'done',
              candidatesSaved: 0,
              steps: STEP_NAMES.map((name) => ({ name, status: 'done' as const })),
              completedAt: new Date(),
            })
            .where(eq(sourcingRuns.id, runId));
        });
        return { status: 'complete', candidates: 0, runId };
      }

      // Step 4: Save
      const savedIds = await step.run('save', async () => {
        await updateRun(4);
        const ids: string[] = [];
        for (const candidate of unique) {
          const [inserted] = await db
            .insert(markets)
            .values({
              title: candidate.title,
              description: candidate.description,
              resolutionCriteria: candidate.resolutionCriteria,
              resolutionSource: candidate.resolutionSource,
              contingencies: candidate.contingencies,
              category: candidate.category,
              tags: candidate.tags,
              endTimestamp: candidate.endTimestamp,
              expectedResolutionDate: candidate.expectedResolutionDate,
              timingSafety: 'caution',
              sourceContext: {
                originType: 'news' as const,
                generatedAt: new Date().toISOString(),
              },
              status: 'candidate',
            })
            .returning({ id: markets.id });
          ids.push(inserted.id);
        }
        await db
          .update(sourcingRuns)
          .set({ candidatesSaved: ids.length })
          .where(eq(sourcingRuns.id, runId));
        return ids;
      });

      // Step 5: Trigger reviews
      await step.run('trigger-reviews', async () => {
        await updateRun(5);
        await inngest.send(
          savedIds.map((id) => ({
            name: 'market/candidate.created' as const,
            data: { id },
          })),
        );
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

      return { status: 'complete', candidates: savedIds.length, runId };
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
      throw err;
    }
  },
);
