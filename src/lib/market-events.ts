import { db } from '@/db/client';
import { marketEvents } from '@/db/schema';
import type { MarketEventType } from '@/db/types';

export async function logMarketEvent(
  marketId: string,
  type: MarketEventType,
  opts?: { iteration?: number; detail?: Record<string, unknown> },
): Promise<void> {
  await db.insert(marketEvents).values({
    marketId,
    type,
    iteration: opts?.iteration,
    detail: opts?.detail,
  });
}
