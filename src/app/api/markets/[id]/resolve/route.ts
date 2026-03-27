import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { Resolution } from '@/db/types';
import { logActivity } from '@/lib/activity-log';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [market] = await db.select().from(markets).where(eq(markets.id, id));

  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  if (market.status !== 'closed' && market.status !== 'open') {
    return NextResponse.json(
      { error: `Cannot resolve a market with status "${market.status}". Must be "closed" or "open".` },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { outcome, confirmedBy } = body;

  const validOutcomes = (market.outcomes as string[]) ?? ['Si', 'No'];
  if (!validOutcomes.includes(outcome)) {
    return NextResponse.json(
      { error: `Outcome must be one of: ${validOutcomes.join(', ')}` },
      { status: 400 },
    );
  }

  const now = new Date();
  const existingResolution = market.resolution as Resolution | null;

  const resolution: Resolution = {
    evidence: existingResolution?.evidence ?? '',
    evidenceUrls: existingResolution?.evidenceUrls ?? [],
    confidence: existingResolution?.confidence ?? 'high',
    suggestedOutcome: outcome,
    flaggedAt: existingResolution?.flaggedAt ?? now.toISOString(),
    confirmedBy: confirmedBy ?? 'admin',
    confirmedAt: now.toISOString(),
  };

  const [updated] = await db
    .update(markets)
    .set({
      status: 'resolved',
      outcome,
      resolvedAt: now,
      resolution,
    })
    .where(eq(markets.id, id))
    .returning();

  await logActivity('resolution_confirmed', {
    entityType: 'market',
    entityId: id,
    entityLabel: market.title,
    detail: {
      outcome,
      confidence: resolution.confidence,
      evidence: resolution.evidence,
      confirmedBy: resolution.confirmedBy,
    },
    source: 'ui',
  });

  return NextResponse.json(updated);
}
