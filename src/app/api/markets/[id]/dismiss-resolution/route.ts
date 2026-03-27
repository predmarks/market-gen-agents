import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { Resolution } from '@/db/types';
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

  const dismissed = market.resolution as Resolution | null;

  await db
    .update(markets)
    .set({ resolution: null })
    .where(eq(markets.id, id));

  await logActivity('resolution_dismissed', {
    entityType: 'market',
    entityId: id,
    entityLabel: market.title,
    detail: {
      suggestedOutcome: dismissed?.suggestedOutcome,
      confidence: dismissed?.confidence,
      evidence: dismissed?.evidence,
    },
    source: 'ui',
  });

  return NextResponse.json({ dismissed: true });
}
