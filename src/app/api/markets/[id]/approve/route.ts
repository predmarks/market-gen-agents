import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logMarketEvent } from '@/lib/market-events';
import { logActivity } from '@/lib/activity-log';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [market] = await db.select().from(markets).where(eq(markets.id, id));

  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  if (market.status !== 'proposal') {
    return NextResponse.json(
      { error: `Cannot approve a market with status "${market.status}". Must be "proposal".` },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(markets)
    .set({ status: 'approved', publishedAt: new Date() })
    .where(eq(markets.id, id))
    .returning();

  await logMarketEvent(id, 'human_approved');
  await logActivity('market_approved', { entityType: 'market', entityId: id, entityLabel: market.title, source: 'ui' });

  return NextResponse.json(updated);
}
