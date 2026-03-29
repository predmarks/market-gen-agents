import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { sql, isNotNull, and, ne } from 'drizzle-orm';

export function parseVolume(vol: string | null): number {
  if (!vol) return 0;
  const n = parseFloat(vol) / 1e6;
  return isNaN(n) ? 0 : n;
}

export function formatVolume(n: number): string {
  if (n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

export interface CategoryStats {
  category: string;
  volume: number;
  participants: number;
  marketCount: number;
}

export interface MarketTimePoint {
  date: string;
  category: string;
  volume: number;
  participants: number;
}

export interface AnalyticsData {
  totalVolume: number;
  totalParticipants: number;
  activeMarkets: number;
  totalPublished: number;
  byCategory: CategoryStats[];
  overTime: MarketTimePoint[];
}

export async function getMarketAnalytics(): Promise<AnalyticsData> {
  // All published markets (have been deployed onchain)
  const publishedMarkets = await db
    .select({
      category: markets.category,
      volume: markets.volume,
      participants: markets.participants,
      publishedAt: markets.publishedAt,
      status: markets.status,
    })
    .from(markets)
    .where(isNotNull(markets.publishedAt));

  // Summary
  let totalVolume = 0;
  let totalParticipants = 0;
  let activeMarkets = 0;

  // By category
  const catMap = new Map<string, CategoryStats>();

  // Over time (by publishedAt date)
  const timePoints: MarketTimePoint[] = [];

  for (const m of publishedMarkets) {
    const vol = parseVolume(m.volume);
    const parts = m.participants ?? 0;

    totalVolume += vol;
    totalParticipants += parts;
    if (m.status === 'open' || m.status === 'in_resolution') activeMarkets++;

    // Category aggregation
    const cat = catMap.get(m.category) ?? { category: m.category, volume: 0, participants: 0, marketCount: 0 };
    cat.volume += vol;
    cat.participants += parts;
    cat.marketCount++;
    catMap.set(m.category, cat);

    // Time series
    if (m.publishedAt) {
      const date = m.publishedAt.toISOString().split('T')[0];
      timePoints.push({ date, category: m.category, volume: vol, participants: parts });
    }
  }

  const byCategory = Array.from(catMap.values()).sort((a, b) => b.volume - a.volume);

  return {
    totalVolume,
    totalParticipants,
    activeMarkets,
    totalPublished: publishedMarkets.length,
    byCategory,
    overTime: timePoints.sort((a, b) => a.date.localeCompare(b.date)),
  };
}
