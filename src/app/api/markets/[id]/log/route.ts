import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logActivity } from '@/lib/activity-log';
import type { Resolution } from '@/db/types';

const ALLOWED_ACTIONS = [
  'market_deployed_onchain',
  'market_updated_onchain',
  'market_resolved_onchain',
  'market_reported_onchain',
  'market_ownership_transferred',
  'market_liquidity_withdrawn',
  'market_ownership_returned',
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { action, detail } = body;

  if (!ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const [market] = await db
    .select({ id: markets.id, title: markets.title, resolution: markets.resolution })
    .from(markets)
    .where(eq(markets.id, id));

  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  // Link deployed market: set onchainId, chainId, status
  if (action === 'market_deployed_onchain' && detail?.onchainId) {
    const updates: Record<string, unknown> = {
      onchainId: String(detail.onchainId),
      status: 'open',
    };
    if (detail.chainId) updates.chainId = Number(detail.chainId);
    if (detail.onchainAddress) updates.onchainAddress = String(detail.onchainAddress);
    await db.update(markets).set(updates).where(eq(markets.id, id));
  }

  // Track reporter pending state in resolution object
  if (action === 'market_resolved_onchain' && detail?.reporterPending) {
    const resolution = (market.resolution as Record<string, unknown> | null) ?? {};
    await db.update(markets).set({
      resolution: { ...resolution, reporterPending: true } as unknown as Resolution,
    }).where(eq(markets.id, id));
  }

  if (action === 'market_reported_onchain') {
    const resolution = (market.resolution as Record<string, unknown> | null) ?? {};
    const { reporterPending: _, ...cleanResolution } = resolution;
    await db.update(markets).set({
      resolution: cleanResolution as unknown as Resolution,
    }).where(eq(markets.id, id));
  }

  // Withdrawal flow state persistence
  if (action === 'market_ownership_transferred') {
    const resolution = (market.resolution as Record<string, unknown> | null) ?? {};
    const withdrawal = (resolution.withdrawal as Record<string, unknown> | null) ?? {};
    await db.update(markets).set({
      resolution: {
        ...resolution,
        withdrawal: {
          ...withdrawal,
          ownershipTransferredAt: new Date().toISOString(),
          ownershipTransferTxHash: detail?.txHash,
          tokenAddress: detail?.tokenAddress,
        },
      } as unknown as Resolution,
    }).where(eq(markets.id, id));
  }

  if (action === 'market_liquidity_withdrawn') {
    const resolution = (market.resolution as Record<string, unknown> | null) ?? {};
    const withdrawal = (resolution.withdrawal as Record<string, unknown> | null) ?? {};
    await db.update(markets).set({
      resolution: {
        ...resolution,
        withdrawal: {
          ...withdrawal,
          withdrawnAt: new Date().toISOString(),
          withdrawTxHash: detail?.txHash,
        },
      } as unknown as Resolution,
    }).where(eq(markets.id, id));
  }

  if (action === 'market_ownership_returned') {
    const resolution = (market.resolution as Record<string, unknown> | null) ?? {};
    const withdrawal = (resolution.withdrawal as Record<string, unknown> | null) ?? {};
    await db.update(markets).set({
      resolution: {
        ...resolution,
        withdrawal: {
          ...withdrawal,
          ownershipReturnedAt: new Date().toISOString(),
          ownershipReturnTxHash: detail?.txHash,
          ownershipTransferredAt: undefined,
          ownershipTransferTxHash: undefined,
        },
      } as unknown as Resolution,
    }).where(eq(markets.id, id));
  }

  await logActivity(action, {
    entityType: 'market',
    entityId: id,
    entityLabel: market.title,
    detail: detail ?? {},
    source: 'ui',
  });

  return NextResponse.json({ ok: true });
}
