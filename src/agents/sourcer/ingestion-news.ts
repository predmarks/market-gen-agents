import Parser from 'rss-parser';
import type { SignalSource } from '@/config/sources';
import type { SourceSignal } from './types';

const parser = new Parser({ timeout: 10_000 });
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

export async function ingestNews(sources: SignalSource[]): Promise<SourceSignal[]> {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const parsed = await parser.parseURL(source.url);
      return { source, items: parsed.items };
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

    const { source, items } = result.value;
    const sorted = items
      .filter((item) => {
        if (!item.isoDate) return true; // include items without date
        return new Date(item.isoDate).getTime() > cutoff;
      })
      .sort((a, b) => {
        const da = a.isoDate ? new Date(a.isoDate).getTime() : 0;
        const db = b.isoDate ? new Date(b.isoDate).getTime() : 0;
        return db - da;
      });

    for (const item of sorted) {
      if (item.link && seenUrls.has(item.link)) continue;
      if (item.link) seenUrls.add(item.link);

      signals.push({
        type: 'news',
        text: item.title || '',
        summary: (item.contentSnippet || item.content || '').slice(0, 500),
        url: item.link,
        source: source.name,
        publishedAt: item.isoDate || new Date().toISOString(),
        entities: [],
        category: source.category,
      });
    }
  }

  return signals;
}
