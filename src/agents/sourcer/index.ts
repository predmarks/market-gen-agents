import { db } from '@/db/client';
import { markets, topics as topicsTable } from '@/db/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { ingestAllSources } from './ingestion';
import { coalesceTopics } from './topic-coalescence';
import { generateMarkets } from './generator';
import { deduplicateCandidates } from './deduplication';
import type { GeneratedCandidate, Topic } from './types';

export const CANDIDATE_CAP = 5;

export async function runSourcing(): Promise<{ candidateIds: string[] }> {
  // Check candidate cap
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(markets)
    .where(eq(markets.status, 'candidate'));

  if (count >= CANDIDATE_CAP) {
    console.log(`Candidate cap reached (${count}/${CANDIDATE_CAP}), skipping sourcing`);
    return { candidateIds: [] };
  }

  // Ingest signals
  const { signals, dataPoints } = await ingestAllSources();
  console.log(`Ingested ${signals.length} signals, ${dataPoints.length} data points`);

  if (signals.length === 0) {
    console.log('No signals ingested, skipping generation');
    return { candidateIds: [] };
  }

  // Coalesce signals into topics
  const coalesced = await coalesceTopics({ signals });
  console.log(`Coalesced into ${coalesced.topicIds.length} topics`);

  // Load coalesced topics for generation
  const topics: Topic[] = coalesced.topicIds.length > 0
    ? (await db
        .select()
        .from(topicsTable)
        .where(inArray(topicsTable.id, coalesced.topicIds))
      ).map((row) => ({
        name: row.name,
        slug: row.slug,
        summary: row.summary,
        signalIndices: [],
        suggestedAngles: row.suggestedAngles,
        category: row.category as Topic['category'],
        score: row.score,
      }))
    : [];
  console.log(`Loaded ${topics.length} topics for generation`);

  // Load open market titles for dedup context
  const openMarkets = await db
    .select({ id: markets.id, title: markets.title })
    .from(markets)
    .where(eq(markets.status, 'open'));

  // Generate candidates
  const candidates = await generateMarkets(
    topics,
    dataPoints,
    openMarkets.map((m) => m.title),
  );
  console.log(`Generated ${candidates.length} candidates`);

  if (candidates.length === 0) {
    return { candidateIds: [] };
  }

  // Deduplicate
  const unique = await deduplicateCandidates(candidates, openMarkets);
  console.log(`${unique.length} candidates after deduplication`);

  if (unique.length === 0) {
    return { candidateIds: [] };
  }

  // Save to DB
  const candidateIds = await saveCandidates(unique);
  console.log(`Saved ${candidateIds.length} candidates to DB`);

  return { candidateIds };
}

async function saveCandidates(candidates: GeneratedCandidate[]): Promise<string[]> {
  const ids: string[] = [];

  for (const candidate of candidates) {
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

  return ids;
}
