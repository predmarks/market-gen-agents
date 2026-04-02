import { X_BEARER_TOKEN } from '@/config/sources';
import type { SignalSource } from '@/config/sources';
import type { SourceSignal } from './types';

interface XTrendV2 {
  trend_name: string;
}

export async function ingestTwitter(sources: SignalSource[]): Promise<SourceSignal[]> {
  if (!X_BEARER_TOKEN) {
    console.warn('X_BEARER_TOKEN not set, skipping Twitter ingestion');
    return [];
  }

  const allSignals: SourceSignal[] = [];

  for (const source of sources) {
    const woeid = (source.config as { woeid?: number })?.woeid ?? 23424747;

    try {
      const res = await fetch(
        `https://api.twitter.com/2/trends/by/woeid/${woeid}`,
        {
          headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!res.ok) {
        console.warn(`Twitter API failed: ${res.status} ${res.statusText}`);
        continue;
      }

      const data = await res.json();
      const trends: XTrendV2[] = data.data ?? [];

      for (const t of trends) {
        allSignals.push({
          type: 'social',
          text: t.trend_name,
          url: `https://twitter.com/search?q=${encodeURIComponent(t.trend_name)}`,
          source: source.name,
          publishedAt: new Date().toISOString(),
          entities: [],
        });
      }
    } catch (err) {
      console.warn(`Twitter ingestion failed for ${source.name}:`, err);
    }
  }

  return allSignals;
}
