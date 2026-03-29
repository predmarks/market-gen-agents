import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { topics } from '@/db/schema';
import { inArray } from 'drizzle-orm';
import { getEmbeddings, cosineSimilarity } from '@/agents/sourcer/deduplication';
import OpenAI from 'openai';

const SIMILARITY_THRESHOLD = 0.80;

export async function GET() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 });
  }

  const allTopics = await db
    .select({ id: topics.id, name: topics.name, slug: topics.slug, summary: topics.summary, status: topics.status, score: topics.score, embedding: topics.embedding })
    .from(topics)
    .where(inArray(topics.status, ['active', 'regular', 'stale']));

  if (allTopics.length < 2) {
    return NextResponse.json({ pairs: [], message: 'Not enough topics to compare' });
  }

  const openai = new OpenAI();

  // Get embeddings — use cached where available
  const needsEmbedding = allTopics.filter((t) => !t.embedding);
  const cachedEmbeddings = new Map<string, number[]>();
  for (const t of allTopics) {
    if (t.embedding) cachedEmbeddings.set(t.id, t.embedding as number[]);
  }

  if (needsEmbedding.length > 0) {
    const texts = needsEmbedding.map((t) => `${t.name}: ${t.summary}`);
    const embeddings = await getEmbeddings(openai, texts);
    for (let i = 0; i < needsEmbedding.length; i++) {
      cachedEmbeddings.set(needsEmbedding[i].id, embeddings[i]);
    }
  }

  // Find similar pairs
  const pairs: { a: { id: string; name: string; slug: string; status: string; score: number }; b: { id: string; name: string; slug: string; status: string; score: number }; similarity: number }[] = [];

  for (let i = 0; i < allTopics.length; i++) {
    for (let j = i + 1; j < allTopics.length; j++) {
      const embA = cachedEmbeddings.get(allTopics[i].id);
      const embB = cachedEmbeddings.get(allTopics[j].id);
      if (!embA || !embB) continue;

      const sim = cosineSimilarity(embA, embB);
      if (sim > SIMILARITY_THRESHOLD) {
        pairs.push({
          a: { id: allTopics[i].id, name: allTopics[i].name, slug: allTopics[i].slug, status: allTopics[i].status, score: allTopics[i].score },
          b: { id: allTopics[j].id, name: allTopics[j].name, slug: allTopics[j].slug, status: allTopics[j].status, score: allTopics[j].score },
          similarity: Math.round(sim * 100) / 100,
        });
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity);

  return NextResponse.json({
    totalTopics: allTopics.length,
    duplicatePairs: pairs.length,
    pairs,
  });
}
