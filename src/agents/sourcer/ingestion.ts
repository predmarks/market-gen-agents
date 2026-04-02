import { ingestNews } from './ingestion-news';
import { ingestData } from './ingestion-data';
import { ingestTwitter } from './ingestion-twitter';
import { ingestScraped } from './ingestion-scrape';
import { loadSignalSources } from '@/config/sources';
import { db } from '@/db/client';
import { signals as signalsTable } from '@/db/schema';
import { eq, and, gte, inArray, isNotNull } from 'drizzle-orm';
import type { IngestionResult, DataPoint, SourceSignal } from './types';

export async function ingestAllSources(): Promise<IngestionResult> {
  const sources = await loadSignalSources();

  const rssSources = sources.filter((s) => s.type === 'rss');
  const scrapeSources = sources.filter((s) => s.type === 'scrape');
  const apiSources = sources.filter((s) => s.type === 'api');
  const socialSources = sources.filter((s) => s.type === 'social');

  const [newsSignals, scrapeSignals, dataSignals, twitterSignals] = await Promise.all([
    ingestNews(rssSources),
    ingestScraped(scrapeSources),
    ingestData(apiSources),
    ingestTwitter(socialSources),
  ]);

  const allSignals = [...newsSignals, ...scrapeSignals, ...dataSignals, ...twitterSignals];

  // Extract all data points from data signals for the generator prompt
  const dataPoints: DataPoint[] = dataSignals.flatMap(
    (s) => s.dataPoints ?? [],
  );

  // Persist to signals table — upsert by URL, always return all signals
  const persistedSignals: SourceSignal[] = [];
  for (const signal of allSignals) {
    try {
      if (signal.url) {
        // Try insert, on conflict just update text to get the existing row back
        const [row] = await db
          .insert(signalsTable)
          .values({
            type: signal.type,
            text: signal.text,
            summary: signal.summary ?? null,
            url: signal.url,
            source: signal.source,
            category: signal.category ?? null,
            publishedAt: new Date(signal.publishedAt),
            dataPoints: signal.dataPoints ?? null,
          })
          .onConflictDoUpdate({
            target: signalsTable.url,
            targetWhere: isNotNull(signalsTable.url),
            set: { text: signal.text },
          })
          .returning({ id: signalsTable.id });

        persistedSignals.push({ ...signal, id: row.id });
      } else {
        // No URL (e.g., data signals) — insert only if value changed recently
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const [existing] = await db
          .select({ id: signalsTable.id })
          .from(signalsTable)
          .where(
            and(
              eq(signalsTable.source, signal.source),
              eq(signalsTable.text, signal.text),
              gte(signalsTable.createdAt, twoHoursAgo),
            ),
          )
          .limit(1);

        if (existing) {
          // Same source + same text within 2h — skip duplicate
          persistedSignals.push({ ...signal, id: existing.id });
        } else {
          const [row] = await db
            .insert(signalsTable)
            .values({
              type: signal.type,
              text: signal.text,
              summary: signal.summary ?? null,
              source: signal.source,
              category: signal.category ?? null,
              publishedAt: new Date(signal.publishedAt),
              dataPoints: signal.dataPoints ?? null,
            })
            .returning({ id: signalsTable.id });
          persistedSignals.push({ ...signal, id: row.id });
        }
      }
    } catch (err) {
      console.warn('Signal persist failed:', err);
      // Still include the signal even if DB persist fails
      persistedSignals.push(signal);
    }
  }

  return {
    signals: persistedSignals,
    dataPoints,
  };
}

export async function markSignalsUsed(signalIds: string[], runId: string): Promise<void> {
  if (signalIds.length === 0) return;
  await db
    .update(signalsTable)
    .set({ usedInRun: runId })
    .where(inArray(signalsTable.id, signalIds));
}
