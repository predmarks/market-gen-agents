import Parser from 'rss-parser';
import { RSS_FEEDS } from '@/config/sources';
import type { SourceSignal } from './types';

const parser = new Parser({ timeout: 10_000 });
const MAX_ITEMS_PER_FEED = 15;
const MAX_TOTAL_SIGNALS = 80;
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

export async function ingestNews(): Promise<SourceSignal[]> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);
      return { feed, items: parsed.items };
    }),
  );

  const signals: SourceSignal[] = [];
  const seenUrls = new Set<string>();
  const cutoff = Date.now() - MAX_AGE_MS;

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`RSS feed failed:`, result.reason);
      continue;
    }

    const { feed, items } = result.value;
    const sorted = items
      .filter((item) => {
        if (!item.isoDate) return true; // include items without date
        return new Date(item.isoDate).getTime() > cutoff;
      })
      .sort((a, b) => {
        const da = a.isoDate ? new Date(a.isoDate).getTime() : 0;
        const db = b.isoDate ? new Date(b.isoDate).getTime() : 0;
        return db - da;
      })
      .slice(0, MAX_ITEMS_PER_FEED);

    for (const item of sorted) {
      if (item.link && seenUrls.has(item.link)) continue;
      if (item.link) seenUrls.add(item.link);

      signals.push({
        type: 'news',
        text: item.title || '',
        summary: (item.contentSnippet || item.content || '').slice(0, 500),
        url: item.link,
        source: feed.name,
        publishedAt: item.isoDate || new Date().toISOString(),
        entities: [],
        category: feed.category,
      });
    }
  }

  return signals.slice(0, MAX_TOTAL_SIGNALS);
}
