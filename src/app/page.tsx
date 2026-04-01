export const dynamic = 'force-dynamic';

import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { MarketList } from './_components/MarketList';
import { validateChainId } from '@/lib/chains';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const params = await searchParams;
  const chainId = validateChainId(params.chain ? Number(params.chain) : undefined);

  const allMarkets = await db
    .select()
    .from(markets)
    .where(
      and(
        inArray(markets.status, ['open', 'in_resolution', 'closed']),
        eq(markets.isArchived, false),
        eq(markets.chainId, chainId),
      ),
    )
    .orderBy(desc(markets.createdAt));

  const serialized = allMarkets.map((m) => ({
    id: m.id,
    title: m.title,
    category: m.category,
    status: m.status,
    endTimestamp: m.endTimestamp,
    onchainId: m.onchainId,
    volume: m.volume,
    participants: m.participants,
    resolution: m.resolution as { suggestedOutcome?: string; confidence?: string; flaggedAt?: string; evidenceUrls?: string[]; checkingAt?: string } | null,
    pendingBalance: m.pendingBalance,
    outcome: m.outcome,
  }));

  return (
    <div className="max-w-5xl mx-auto py-10 px-4">
      <MarketList markets={serialized} chainId={chainId} />
    </div>
  );
}
