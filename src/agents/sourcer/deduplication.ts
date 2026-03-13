import OpenAI from 'openai';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import type { GeneratedCandidate } from './types';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbeddings(client: OpenAI, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function deduplicateCandidates(
  candidates: GeneratedCandidate[],
  openMarkets: { id: string; title: string }[],
): Promise<GeneratedCandidate[]> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not set, skipping deduplication');
    return candidates;
  }

  if (candidates.length === 0) return [];

  const client = new OpenAI();

  // Load recently rejected markets (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const rejectedMarkets = await db
    .select({ id: markets.id, title: markets.title })
    .from(markets)
    .where(
      and(
        eq(markets.status, 'rejected'),
        gt(markets.createdAt, thirtyDaysAgo),
      ),
    );

  // Collect all texts to embed
  const candidateTitles = candidates.map((c) => c.title);
  const openTitles = openMarkets.map((m) => m.title);
  const rejectedTitles = rejectedMarkets.map((m) => m.title);

  const allTexts = [...candidateTitles, ...openTitles, ...rejectedTitles];
  const embeddings = await getEmbeddings(client, allTexts);

  const candidateEmbeddings = embeddings.slice(0, candidateTitles.length);
  const openEmbeddings = embeddings.slice(
    candidateTitles.length,
    candidateTitles.length + openTitles.length,
  );
  const rejectedEmbeddings = embeddings.slice(
    candidateTitles.length + openTitles.length,
  );

  const kept: GeneratedCandidate[] = [];
  const excluded = new Set<number>();

  for (let i = 0; i < candidates.length; i++) {
    if (excluded.has(i)) continue;

    // Check vs open markets (reject at >0.85)
    let isDuplicate = false;
    for (const openEmb of openEmbeddings) {
      if (cosineSimilarity(candidateEmbeddings[i], openEmb) > 0.85) {
        console.log(`Dedup: "${candidates[i].title}" too similar to open market`);
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) continue;

    // Check vs recently rejected (warn at >0.80, but don't exclude)
    for (const rejEmb of rejectedEmbeddings) {
      if (cosineSimilarity(candidateEmbeddings[i], rejEmb) > 0.80) {
        console.warn(`Dedup warning: "${candidates[i].title}" similar to recently rejected market`);
        break;
      }
    }

    // Check vs other candidates in batch (keep higher quality)
    for (let j = i + 1; j < candidates.length; j++) {
      if (excluded.has(j)) continue;
      if (cosineSimilarity(candidateEmbeddings[i], candidateEmbeddings[j]) > 0.85) {
        // Keep the one with longer resolutionCriteria (proxy for quality)
        if (candidates[j].resolutionCriteria.length > candidates[i].resolutionCriteria.length) {
          excluded.add(i);
          isDuplicate = true;
          break;
        } else {
          excluded.add(j);
          console.log(`Dedup: batch duplicate "${candidates[j].title}"`);
        }
      }
    }
    if (isDuplicate) continue;

    kept.push(candidates[i]);
  }

  return kept;
}
