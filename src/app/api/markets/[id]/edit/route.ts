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

  const editable = ['candidate', 'open'];
  if (!editable.includes(market.status)) {
    return NextResponse.json(
      { error: `Cannot edit a market with status "${market.status}". Must be one of: ${editable.join(', ')}.` },
      { status: 400 },
    );
  }

  const body = await request.json();

  const allowedFields = [
    'title',
    'description',
    'resolutionCriteria',
    'resolutionSource',
    'contingencies',
    'category',
    'tags',
    'endTimestamp',
    'expectedResolutionDate',
    'timingSafety',
  ];

  const updates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (body[key] !== undefined) {
      updates[key] = body[key];
    }
  }

  const [updated] = await db
    .update(markets)
    .set(updates)
    .where(eq(markets.id, id))
    .returning();

  await logMarketEvent(id, 'human_edited', {
    detail: { fields: Object.keys(updates) },
  });

  return NextResponse.json(updated);
}
