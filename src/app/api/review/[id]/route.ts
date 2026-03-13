import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { inngest } from '@/inngest/client';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [market] = await db.select().from(markets).where(eq(markets.id, id));

  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  if (market.status !== 'candidate') {
    return NextResponse.json(
      { error: `Cannot review a market with status "${market.status}". Must be "candidate".` },
      { status: 400 },
    );
  }

  await db
    .update(markets)
    .set({ status: 'processing' })
    .where(eq(markets.id, id));

  await inngest.send({
    name: 'market/candidate.created',
    data: { id },
  });

  return NextResponse.json({ triggered: true, marketId: id });
}
