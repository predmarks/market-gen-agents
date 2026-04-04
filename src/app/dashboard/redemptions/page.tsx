export const dynamic = 'force-dynamic';

import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getOwnedAddresses } from '@/lib/owned-addresses';
import { validateChainId, getBasescanUrl } from '@/lib/chains';
import { fetchMarketsWithUnredeemedWinners } from '@/lib/indexer';
import { RedemptionsView } from './_components/RedemptionsView';
import type { MarketSummary } from './_components/RedemptionsView';

interface Props {
  searchParams: Promise<{ chain?: string }>;
}

export default async function RedemptionsPage({ searchParams }: Props) {
  const params = await searchParams;
  const chainId = validateChainId(params.chain ? Number(params.chain) : undefined);
  const basescanUrl = getBasescanUrl(chainId);

  // Load owned addresses from config
  const ownedAddresses = await getOwnedAddresses();

  // Fetch unredeemed winners from subgraph
  let summaries: Awaited<ReturnType<typeof fetchMarketsWithUnredeemedWinners>> = [];
  try {
    summaries = await fetchMarketsWithUnredeemedWinners(chainId);
  } catch {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Retiros pendientes</h1>
        <p className="text-sm text-red-500">Error al consultar el indexer. Intentá de nuevo.</p>
      </div>
    );
  }

  // Cross-reference with DB to get internal IDs and pending balances
  const closedMarkets = await db
    .select({
      id: markets.id,
      onchainId: markets.onchainId,
      title: markets.title,
      outcomes: markets.outcomes,
      pendingBalance: markets.pendingBalance,
    })
    .from(markets)
    .where(
      and(
        eq(markets.status, 'closed'),
        eq(markets.chainId, chainId),
      ),
    );

  const dbByOnchainId = new Map(
    closedMarkets
      .filter((m) => m.onchainId)
      .map((m) => [m.onchainId!, m]),
  );

  // Enrich and serialize (bigints → strings for client)
  const enriched: MarketSummary[] = summaries
    .map((s) => {
      const dbMarket = dbByOnchainId.get(s.onchainId);
      return {
        marketAddress: s.marketAddress,
        onchainId: s.onchainId,
        marketName: s.marketName,
        resolvedTo: s.resolvedTo,
        unredeemedCount: s.unredeemedCount,
        totalUnredeemedShares: s.totalUnredeemedShares.toString(),
        totalUnredeemedInvested: s.totalUnredeemedInvested.toString(),
        positions: s.positions,
        dbId: dbMarket?.id,
        dbTitle: dbMarket?.title,
        outcomes: (dbMarket?.outcomes as string[]) ?? [],
        pendingBalance: dbMarket?.pendingBalance,
      };
    })
    .sort((a, b) => b.unredeemedCount - a.unredeemedCount);

  return (
    <RedemptionsView
      markets={enriched}
      ownedAddresses={ownedAddresses}
      basescanUrl={basescanUrl}
    />
  );
}
