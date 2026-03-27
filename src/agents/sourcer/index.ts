import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { ingestAllSources } from './ingestion';
import { extractTopics } from './topic-extractor';
import { generateMarkets } from './generator';
import { deduplicateCandidates } from './deduplication';
import type { GeneratedCandidate } from './types';

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

  // Extract topics
  const topics = await extractTopics(signals);
  console.log(`Extracted ${topics.length} topics`);

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
