import { db } from '@/db/client';
import { topics as topicsTable, topicSignals } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { updateTopics, markStaleTopics } from './topic-extractor';
import { getEmbeddings, cosineSimilarity } from './deduplication';
import OpenAI from 'openai';
import type { Topic, SourceSignal } from './types';
import type { TopicUpdate } from './topic-extractor';
import { logActivity } from '@/lib/activity-log';

const TOPIC_DEDUP_THRESHOLD = 0.80;

export interface CoalesceResult {
  topicIds: string[];
  actions: TopicUpdate[];
}

/**
 * Pipeline 2: Coalesce signals into topics.
 * Loads existing topics, asks LLM to match/create/merge/split, applies embedding dedup,
 * then executes all DB mutations.
 */
export async function coalesceTopics(opts: {
  signals: SourceSignal[];
  placeholderTopicId?: string;
}): Promise<CoalesceResult> {
  const { signals, placeholderTopicId } = opts;

  if (signals.length === 0) return { topicIds: [], actions: [] };

  // Load existing active/regular topics
  const existingTopicRows = await db
    .select()
    .from(topicsTable)
    .where(inArray(topicsTable.status, ['active', 'regular']));

  // Exclude placeholder from existing topics so LLM doesn't match against it
  const existingTopics: Topic[] = existingTopicRows
    .filter((row) => row.id !== placeholderTopicId)
    .map((row) => ({
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

  // LLM matching
  const topicUpdates = await updateTopics(signals, existingTopics) ?? [];

  // Embedding-based dedup for CREATE actions
  const creates = topicUpdates.filter((u) => u.action === 'create');
  if (creates.length > 0 && process.env.OPENAI_API_KEY) {
    const openai = new OpenAI();

    // Get or compute embeddings for existing topics
    const existingWithEmbeddings = existingTopicRows.filter((t) => t.embedding && t.id !== placeholderTopicId);
    const existingWithoutEmbeddings = existingTopicRows.filter((t) => !t.embedding && t.id !== placeholderTopicId);

    const existingEmbeddings: { slug: string; embedding: number[] }[] =
      existingWithEmbeddings.map((t) => ({ slug: t.slug, embedding: t.embedding as number[] }));

    if (existingWithoutEmbeddings.length > 0) {
      const texts = existingWithoutEmbeddings.map((t) => `${t.name}: ${t.summary}`);
      const newEmbeddings = await getEmbeddings(openai, texts);
      for (let i = 0; i < existingWithoutEmbeddings.length; i++) {
        const topic = existingWithoutEmbeddings[i];
        existingEmbeddings.push({ slug: topic.slug, embedding: newEmbeddings[i] });
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

  // Build signal index → DB ID map (1-based, as updateTopics uses)
  const signalIdMap = new Map<number, string>();
  signals.forEach((s, i) => {
    if (s.id) signalIdMap.set(i + 1, s.id);
  });

  const now = new Date();
  const updatedTopicIds: string[] = [];

  for (const update of topicUpdates) {
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

      await linkSignals(existing.id, update.signalIndices, signalIdMap);
      updatedTopicIds.push(existing.id);

    } else if (update.action === 'merge' && update.existingTopicSlug && update.mergeFromSlugs?.length) {
      // Merges are destructive — log as suggestion
      const target = existingTopicRows.find((t) => t.slug === update.existingTopicSlug);
      const sourceNames = update.mergeFromSlugs
        .map((slug) => existingTopicRows.find((t) => t.slug === slug)?.name ?? slug)
        .join(', ');

      console.log(`Merge suggested: "${sourceNames}" → "${target?.name ?? update.existingTopicSlug}"`);
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

      if (target) {
        await linkSignals(target.id, update.signalIndices, signalIdMap);
        updatedTopicIds.push(target.id);
      }

    } else if (update.action === 'split' && update.splitFromSlug) {
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
        await linkSignals(inserted.id, update.signalIndices, signalIdMap);
        updatedTopicIds.push(inserted.id);
      }

    } else if (update.action === 'create') {
      // If there's a placeholder topic, update it instead of creating
      if (placeholderTopicId) {
        await db
          .update(topicsTable)
          .set({
            name: update.name,
            slug: update.slug,
            summary: update.summary,
            category: update.category,
            suggestedAngles: update.suggestedAngles,
            score: update.score,
            status: 'active',
            signalCount: update.signalIndices.length,
            lastSignalAt: now,
            updatedAt: now,
          })
          .where(eq(topicsTable.id, placeholderTopicId));

        await linkSignals(placeholderTopicId, update.signalIndices, signalIdMap);
        updatedTopicIds.push(placeholderTopicId);
      } else {
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
          await linkSignals(inserted.id, update.signalIndices, signalIdMap);
          updatedTopicIds.push(inserted.id);
        }
      }
    }
  }

  // Mark stale topics
  await markStaleTopics();

  return { topicIds: updatedTopicIds, actions: topicUpdates };
}

async function linkSignals(
  topicId: string,
  signalIndices: number[],
  signalIdMap: Map<number, string>,
): Promise<void> {
  for (const idx of signalIndices) {
    const signalId = signalIdMap.get(idx);
    if (signalId) {
      await db
        .insert(topicSignals)
        .values({ topicId, signalId })
        .onConflictDoNothing();
    }
  }
}
