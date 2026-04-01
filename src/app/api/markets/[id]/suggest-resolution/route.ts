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

  if (market.status !== 'in_resolution' && market.status !== 'open') {
    return NextResponse.json(
      { error: `Cannot suggest resolution for status "${market.status}". Must be "in_resolution" or "open".` },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { suggestedOutcome, evidence, evidenceUrls, confidence } = body;

  if (!suggestedOutcome || !evidence) {
    return NextResponse.json({ error: 'suggestedOutcome and evidence are required' }, { status: 400 });
  }

  const validOutcomes = (market.outcomes as string[]) ?? ['Si', 'No'];
  if (!validOutcomes.includes(suggestedOutcome)) {
    return NextResponse.json(
      { error: `Outcome must be one of: ${validOutcomes.join(', ')}` },
      { status: 400 },
    );
  }

  const existing = market.resolution as Resolution | null;

  const resolution: Resolution = {
    evidence,
    evidenceUrls: evidenceUrls ?? [],
    confidence: confidence ?? 'medium',
    suggestedOutcome,
    flaggedAt: existing?.flaggedAt ?? new Date().toISOString(),
    checkingAt: undefined,
  };

  await db
    .update(markets)
    .set({ resolution })
    .where(eq(markets.id, id));

  await logActivity('resolution_manually_suggested', {
    entityType: 'market',
    entityId: id,
    entityLabel: market.title,
    detail: {
      suggestedOutcome,
      confidence: resolution.confidence,
      evidence,
    },
    source: 'ui',
  });

  return NextResponse.json({ ok: true });
}
