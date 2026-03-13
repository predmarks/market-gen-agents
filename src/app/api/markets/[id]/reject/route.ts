import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logMarketEvent } from '@/lib/market-events';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [market] = await db.select().from(markets).where(eq(markets.id, id));

  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  if (market.status !== 'proposal' && market.status !== 'candidate') {
    return NextResponse.json(
      { error: `Cannot reject a market with status "${market.status}". Must be "proposal" or "candidate".` },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));

  const [updated] = await db
    .update(markets)
    .set({ status: 'rejected' })
    .where(eq(markets.id, id))
    .returning();

  await logMarketEvent(id, 'human_rejected', {
    detail: body.reason ? { reason: body.reason } : undefined,
  });

  return NextResponse.json({ ...updated, rejectionReason: body.reason });
}
