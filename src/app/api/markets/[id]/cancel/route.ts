import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { inngest } from '@/inngest/client';
import { logMarketEvent } from '@/lib/market-events';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [market] = await db.select().from(markets).where(eq(markets.id, id));

  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  if (market.status !== 'processing') {
    return NextResponse.json(
      { error: `Cannot cancel a market with status "${market.status}". Must be "processing".` },
      { status: 400 },
    );
  }

  // Send cancel event to Inngest — this triggers cancelOn in the review job
  await inngest.send({ name: 'market/review.cancel', data: { id } });

  await db
    .update(markets)
    .set({ status: 'cancelled' })
    .where(eq(markets.id, id));

  await logMarketEvent(id, 'pipeline_cancelled');

  return NextResponse.json({ id, status: 'cancelled' });
}
