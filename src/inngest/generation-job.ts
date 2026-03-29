import { inngest } from './client';
import { db } from '@/db/client';
import { markets, topics as topicsTable } from '@/db/schema';
import { eq, inArray, and, or, isNull, gt } from 'drizzle-orm';
import { generateMarkets } from '@/agents/sourcer/generator';
import { deduplicateCandidates } from '@/agents/sourcer/deduplication';
import type { Topic } from '@/agents/sourcer/types';
import { logActivity, inngestRunUrl } from '@/lib/activity-log';
import { setCurrentRunId } from '@/lib/llm';

export const generationJob = inngest.createFunction(
  { id: 'generation-pipeline', retries: 5, concurrency: { limit: 1 } },
  { event: 'markets/generate.requested' },
  async ({ event, step, runId }) => {
    const runUrl = inngestRunUrl('generation-pipeline', runId);
    setCurrentRunId(`generation-pipeline/${runId}`);
    const topicIds = (event.data?.topicIds as string[] | undefined) ?? [];
    const targetCount = Number(event.data?.count) || 10;
    const marketType = event.data?.marketType as 'binary' | 'multi-outcome' | undefined;
    const instruction = event.data?.instruction as string | undefined;

    // Step 1: Load topics
    const topicsForGeneration = await step.run('load-topics', async () => {
      let rows;

      if (topicIds.length > 0) {
        // Load specific topics by ID
        rows = await db
          .select()
          .from(topicsTable)
          .where(inArray(topicsTable.id, topicIds));
      } else {
        // Load all fresh topics (active + lastSignalAt > lastGeneratedAt)
        rows = await db
          .select()
          .from(topicsTable)
          .where(
            and(
              inArray(topicsTable.status, ['active', 'regular']),
              or(
                isNull(topicsTable.lastGeneratedAt),
                gt(topicsTable.lastSignalAt, topicsTable.lastGeneratedAt),
              ),
            ),
          );
      }

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        summary: row.summary,
        signalIndices: [] as number[],
        suggestedAngles: row.suggestedAngles,
        category: row.category as Topic['category'],
        score: row.score,
        status: row.status as Topic['status'],
        signalCount: row.signalCount,
        lastSignalAt: row.lastSignalAt?.toISOString(),
        lastGeneratedAt: row.lastGeneratedAt?.toISOString(),
      }));
    });

    if (topicsForGeneration.length === 0) {
      return { status: 'complete', candidates: 0, reason: 'no_fresh_topics' };
    }

    // Step 2: Load open markets for dedup context
    const openMarkets = await step.run('load-open-markets', async () => {
      return db
        .select({ id: markets.id, title: markets.title })
        .from(markets)
        .where(eq(markets.status, 'open'));
    });

    // Step 3: Generate candidates from topics
    const candidates = await step.run('generate', async () => {
      return generateMarkets(
        topicsForGeneration,
        [], // dataPoints — topics already contain summarized context
        openMarkets.map((m) => m.title),
        targetCount,
        marketType,
        instruction,
      );
    });

    if (candidates.length === 0) {
      return { status: 'complete', candidates: 0 };
    }

    // Step 4: Dedup
    const unique = await step.run('dedup', async () => {
      return deduplicateCandidates(candidates, openMarkets);
    });

    if (unique.length === 0) {
      return { status: 'complete', candidates: 0, reason: 'all_duplicates' };
    }

    // Step 5: Save candidates to markets table
    const savedIds = await step.run('save', async () => {
      const ids: string[] = [];
      for (const candidate of unique) {
        const [inserted] = await db
          .insert(markets)
          .values({
            title: candidate.title,
            description: candidate.description,
            outcomes: candidate.outcomes ?? ['Si', 'No'],
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
              topicIds: topicsForGeneration.map((t) => t.id).filter(Boolean) as string[],
              topicNames: topicsForGeneration.map((t) => t.name),
            },
            status: 'candidate',
          })
          .returning({ id: markets.id });
        ids.push(inserted.id);
      }
      return ids;
    });

    // Step 6: Append generated market titles to topic suggestedAngles
    await step.run('update-suggested-angles', async () => {
      for (const topic of topicsForGeneration) {
        if (!topic.id) continue;
        const newAngles = unique.map((c) => c.title);
        const existing = topic.suggestedAngles ?? [];
        const merged = [...new Set([...existing, ...newAngles])];
        await db
          .update(topicsTable)
          .set({ suggestedAngles: merged })
          .where(eq(topicsTable.id, topic.id));
      }
    });

    // Step 7: Update lastGeneratedAt on used topics
    await step.run('update-topic-timestamps', async () => {
      const usedTopicIds = topicsForGeneration.map((t) => t.id).filter(Boolean) as string[];
      if (usedTopicIds.length > 0) {
        await db
          .update(topicsTable)
          .set({ lastGeneratedAt: new Date(), updatedAt: new Date() })
          .where(inArray(topicsTable.id, usedTopicIds));
      }
    });

    // Log a summary entry for the global activity view
    await logActivity('generation_completed', {
      entityType: 'system',
      detail: {
        candidateCount: savedIds.length,
        savedMarkets: savedIds.map((id, i) => ({ id, title: unique[i]?.title ?? id })),
        topicNames: topicsForGeneration.map((t) => t.name),
        duplicatesRemoved: candidates.length - unique.length,
        inngestRunUrl: runUrl,
      },
      source: 'pipeline',
    });

    // Log one entry per market so it appears on each market's detail page
    for (let i = 0; i < savedIds.length; i++) {
      await logActivity('generation_completed', {
        entityType: 'market',
        entityId: savedIds[i],
        entityLabel: unique[i]?.title ?? savedIds[i],
        detail: { topicNames: topicsForGeneration.map((t) => t.name), inngestRunUrl: runUrl },
        source: 'pipeline',
      });
    }

    // Log one entry per topic so it appears on each topic's detail page
    const usedTopicIds = topicsForGeneration.map((t) => t.id).filter(Boolean) as string[];
    for (const t of topicsForGeneration) {
      if (!t.id) continue;
      await logActivity('generation_completed', {
        entityType: 'topic',
        entityId: t.id,
        entityLabel: t.name,
        detail: {
          savedMarkets: savedIds.map((id, i) => ({ id, title: unique[i]?.title ?? id })),
          topicSlug: t.slug,
          inngestRunUrl: runUrl,
        },
        source: 'pipeline',
      });
    }

    return { status: 'complete', candidates: savedIds.length, savedIds };
  },
);
