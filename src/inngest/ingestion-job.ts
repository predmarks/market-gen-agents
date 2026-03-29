import { inngest } from './client';
import { db } from '@/db/client';
import { sourcingRuns, topics as topicsTable, topicSignals, markets } from '@/db/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { ingestAllSources, markSignalsUsed } from '@/agents/sourcer/ingestion';
import { updateTopics, markStaleTopics } from '@/agents/sourcer/topic-extractor';
import { getEmbeddings, cosineSimilarity } from '@/agents/sourcer/deduplication';
import OpenAI from 'openai';
import type { SourcingStep } from '@/db/types';
import type { Topic } from '@/agents/sourcer/types';
import type { TopicUpdate } from '@/agents/sourcer/topic-extractor';
import { logActivity, inngestRunUrl } from '@/lib/activity-log';
import { setCurrentRunId } from '@/lib/llm';

const TOPIC_DEDUP_THRESHOLD = 0.80;

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

        // Embedding-based dedup for CREATE actions
        const creates = topicUpdates.filter((u) => u.action === 'create');
        if (creates.length > 0 && process.env.OPENAI_API_KEY) {
          const openai = new OpenAI();

          // Get or compute embeddings for existing topics
          const existingWithEmbeddings = existingTopicRows.filter((t) => t.embedding);
          const existingWithoutEmbeddings = existingTopicRows.filter((t) => !t.embedding);

          // Embed any existing topics missing embeddings
          let existingEmbeddings: { slug: string; embedding: number[] }[] =
            existingWithEmbeddings.map((t) => ({ slug: t.slug, embedding: t.embedding as number[] }));

          if (existingWithoutEmbeddings.length > 0) {
            const texts = existingWithoutEmbeddings.map((t) => `${t.name}: ${t.summary}`);
            const newEmbeddings = await getEmbeddings(openai, texts);
            for (let i = 0; i < existingWithoutEmbeddings.length; i++) {
              const topic = existingWithoutEmbeddings[i];
              existingEmbeddings.push({ slug: topic.slug, embedding: newEmbeddings[i] });
              // Cache embedding in DB
              await db
                .update(topicsTable)
                .set({ embedding: newEmbeddings[i] })
                .where(eq(topicsTable.id, topic.id));
            }
          }

          // Embed new CREATE candidates
          const createTexts = creates.map((c) => `${c.name}: ${c.summary}`);
          const createEmbeddings = await getEmbeddings(openai, createTexts);

          // Check each CREATE against existing topics
          for (let i = 0; i < creates.length; i++) {
            const create = creates[i];
            const createEmb = createEmbeddings[i];
            let bestMatch: { slug: string; similarity: number } | null = null;

            for (const existing of existingEmbeddings) {
              const sim = cosineSimilarity(createEmb, existing.embedding);
              if (sim > TOPIC_DEDUP_THRESHOLD && (!bestMatch || sim > bestMatch.similarity)) {
                bestMatch = { slug: existing.slug, similarity: sim };
              }
            }

            if (bestMatch) {
              console.log(`Topic dedup: "${create.name}" is ${(bestMatch.similarity * 100).toFixed(0)}% similar to existing topic "${bestMatch.slug}" — converting CREATE to UPDATE`);
              create.action = 'update' as TopicUpdate['action'];
              create.existingTopicSlug = bestMatch.slug;
            }
          }
        }

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
            // Merges are destructive — log as suggestion instead of executing
            const target = existingTopicRows.find((t) => t.slug === update.existingTopicSlug);
            const sourceNames = update.mergeFromSlugs
              .map((slug) => existingTopicRows.find((t) => t.slug === slug)?.name ?? slug)
              .join(', ');
            console.log(`Merge suggested: "${sourceNames}" → "${target?.name ?? update.existingTopicSlug}" (not executed — requires manual approval)`);
            await logActivity('merge_suggested', {
              entityType: 'topic',
              entityId: target?.id,
              entityLabel: target?.name ?? update.existingTopicSlug,
              detail: {
                targetSlug: update.existingTopicSlug,
                sourceSlugs: update.mergeFromSlugs,
                sourceNames,
                summary: update.summary,
              },
              source: 'pipeline',
            });
            // Still link new signals to the target topic if it exists
            if (target) {
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
            }
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
      // Fetch topic details for the log
      const freshTopicDetails = freshTopicIds.length > 0
        ? await db
            .select({ id: topicsTable.id, name: topicsTable.name, slug: topicsTable.slug })
            .from(topicsTable)
            .where(inArray(topicsTable.id, freshTopicIds))
        : [];

      const topicNames = freshTopicDetails.map((t) => t.name);
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
        },
        source: 'pipeline',
      });
      // Check if any open markets are linked to fresh topics → trigger resolution checks
      if (freshTopicIds.length > 0) {
        await step.run('dispatch-resolution-checks', async () => {
          const openMarkets = await db
            .select({ id: markets.id, sourceContext: markets.sourceContext })
            .from(markets)
            .where(eq(markets.status, 'open'));

          const topicSet = new Set(freshTopicIds);
          const matched = openMarkets.filter((m) => {
            const ctx = m.sourceContext as { topicIds?: string[] } | null;
            return ctx?.topicIds?.some((tid) => topicSet.has(tid));
          });

          if (matched.length > 0) {
            await inngest.send(
              matched.map((m) => ({
                name: 'markets/resolution.check' as const,
                data: { id: m.id },
              })),
            );
          }

          return { dispatched: matched.length };
        });
      }

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
