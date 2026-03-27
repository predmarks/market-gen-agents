import { inngest } from './client';
import { db } from '@/db/client';
import { sourcingRuns, topics as topicsTable, topicSignals } from '@/db/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { ingestAllSources, markSignalsUsed } from '@/agents/sourcer/ingestion';
import { updateTopics, markStaleTopics } from '@/agents/sourcer/topic-extractor';
import type { SourcingStep } from '@/db/types';
import type { Topic } from '@/agents/sourcer/types';
import { logActivity } from '@/lib/activity-log';

const STEP_NAMES = ['ingest', 'update-topics'] as const;

function buildSteps(currentIdx: number, detail?: string): SourcingStep[] {
  return STEP_NAMES.map((name, i) => ({
    name,
    status: i < currentIdx ? 'done' : i === currentIdx ? 'running' : 'pending',
    ...(i === currentIdx && detail ? { detail } : {}),
  }));
}

export const ingestionJob = inngest.createFunction(
  { id: 'ingestion-pipeline', retries: 1 },
  { event: 'signals/ingest.requested' },
  async ({ step }) => {
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
      await logActivity('ingestion_started', { entityType: 'system', source: 'pipeline' });
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

      // Step 1: Update topics
      const freshTopicIds = await step.run('update-topics', async () => {
        await updateRun(1);

        // Load existing active topics from DB
        const existingTopicRows = await db
          .select()
          .from(topicsTable)
          .where(inArray(topicsTable.status, ['active', 'regular']));

        const existingTopics: Topic[] = existingTopicRows.map((row) => ({
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

        // Call LLM to match/create topics
        const topicUpdates = await updateTopics(ingestionResult.signals, existingTopics);

        const now = new Date();
        const updatedTopicIds: string[] = [];

        // Build a map of signal indices to signal DB IDs
        const signalIdMap = new Map<number, string>();
        ingestionResult.signals.forEach((s, i) => {
          if (s.id) signalIdMap.set(i + 1, s.id);
        });

        const signalsWithIds = ingestionResult.signals.filter((s) => s.id).length;
        console.log(`Signal ID map: ${signalIdMap.size} of ${ingestionResult.signals.length} signals have DB IDs`);

        for (const update of topicUpdates) {
          const linkedCount = update.signalIndices.filter((idx) => signalIdMap.has(idx)).length;
          console.log(`Topic "${update.name}" (${update.action}): ${update.signalIndices.length} signal indices, ${linkedCount} resolved to DB IDs`);
          if (update.signalIndices.length === 0) {
            console.warn(`Topic "${update.name}" has EMPTY signalIndices — signals won't be linked`);
          }

          if (update.action === 'update' && update.existingTopicSlug) {
            const existing = existingTopicRows.find((t) => t.slug === update.existingTopicSlug);
            if (!existing) continue;

            await db
              .update(topicsTable)
              .set({
                name: update.name,
                slug: update.slug,
                summary: update.summary,
                score: update.score,
                suggestedAngles: update.suggestedAngles,
                signalCount: existing.signalCount + update.signalIndices.length,
                lastSignalAt: now,
                updatedAt: now,
              })
              .where(eq(topicsTable.id, existing.id));

            for (const idx of update.signalIndices) {
              const signalId = signalIdMap.get(idx);
              if (signalId) {
                await db
                  .insert(topicSignals)
                  .values({ topicId: existing.id, signalId })
                  .onConflictDoNothing();
              }
            }

            updatedTopicIds.push(existing.id);
          } else if (update.action === 'merge' && update.existingTopicSlug && update.mergeFromSlugs?.length) {
            // Merge: absorb source topics into target
            const target = existingTopicRows.find((t) => t.slug === update.existingTopicSlug);
            if (!target) continue;

            // Move signals from source topics to target
            for (const sourceSlug of update.mergeFromSlugs) {
              const source = existingTopicRows.find((t) => t.slug === sourceSlug);
              if (!source) continue;

              // Reassign signals
              await db
                .update(topicSignals)
                .set({ topicId: target.id })
                .where(eq(topicSignals.topicId, source.id));

              // Dismiss source topic
              await db
                .update(topicsTable)
                .set({ status: 'dismissed', updatedAt: now })
                .where(eq(topicsTable.id, source.id));

              console.log(`Merged topic "${source.name}" into "${target.name}"`);
            }

            // Count total signals after merge
            const [{ count: totalSignals }] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(topicSignals)
              .where(eq(topicSignals.topicId, target.id));

            // Update target with new info
            await db
              .update(topicsTable)
              .set({
                name: update.name,
                slug: update.slug,
                summary: update.summary,
                score: update.score,
                suggestedAngles: update.suggestedAngles,
                signalCount: totalSignals,
                lastSignalAt: now,
                updatedAt: now,
              })
              .where(eq(topicsTable.id, target.id));

            // Link new signals
            for (const idx of update.signalIndices) {
              const signalId = signalIdMap.get(idx);
              if (signalId) {
                await db
                  .insert(topicSignals)
                  .values({ topicId: target.id, signalId })
                  .onConflictDoNothing();
              }
            }

            updatedTopicIds.push(target.id);
          } else if (update.action === 'split' && update.splitFromSlug) {
            // Split: create new topic from part of an existing one
            const source = existingTopicRows.find((t) => t.slug === update.splitFromSlug);

            const [inserted] = await db
              .insert(topicsTable)
              .values({
                name: update.name,
                slug: update.slug,
                summary: update.summary,
                category: update.category,
                suggestedAngles: update.suggestedAngles,
                score: update.score,
                status: 'active',
                signalCount: update.signalIndices.length,
                lastSignalAt: now,
              })
              .onConflictDoNothing()
              .returning({ id: topicsTable.id });

            if (inserted) {
              // Link signals to new topic
              for (const idx of update.signalIndices) {
                const signalId = signalIdMap.get(idx);
                if (signalId) {
                  await db
                    .insert(topicSignals)
                    .values({ topicId: inserted.id, signalId })
                    .onConflictDoNothing();
                }
              }

              if (source) {
                console.log(`Split topic "${source.name}" → new topic "${update.name}"`);
              }

              updatedTopicIds.push(inserted.id);
            }
          } else if (update.action === 'create') {
            const [inserted] = await db
              .insert(topicsTable)
              .values({
                name: update.name,
                slug: update.slug,
                summary: update.summary,
                category: update.category,
                suggestedAngles: update.suggestedAngles,
                score: update.score,
                status: 'active',
                signalCount: update.signalIndices.length,
                lastSignalAt: now,
              })
              .onConflictDoNothing()
              .returning({ id: topicsTable.id });

            if (inserted) {
              for (const idx of update.signalIndices) {
                const signalId = signalIdMap.get(idx);
                if (signalId) {
                  await db
                    .insert(topicSignals)
                    .values({ topicId: inserted.id, signalId })
                    .onConflictDoNothing();
                }
              }
              updatedTopicIds.push(inserted.id);
            }
          }
        }

        // Mark stale topics
        await markStaleTopics();

        return updatedTopicIds;
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
      await logActivity('ingestion_completed', {
        entityType: 'system',
        detail: {
          signalsCount: ingestionResult.signals.length,
          topicCount: freshTopicIds.length,
          signalsBySource,
          signals: ingestionResult.signals.map((s) => ({ source: s.source, text: s.text.slice(0, 150) })),
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
      await logActivity('ingestion_failed', { entityType: 'system', detail: { error: err instanceof Error ? err.message : String(err) }, source: 'pipeline' });
      throw err;
    }
  },
);
