import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { markets, activityLog } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { inngest } from '@/inngest/client';
import { logActivity } from '@/lib/activity-log';
import type { Resolution } from '@/db/types';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [market] = await db.select().from(markets).where(eq(markets.id, id));

  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  const checkable = ['open', 'in_resolution'];
  if (!checkable.includes(market.status)) {
    return NextResponse.json(
      { error: `Cannot check resolution for status "${market.status}". Must be one of: ${checkable.join(', ')}.` },
      { status: 400 },
    );
  }

  // Dedup: skip if already triggered in the last 10 minutes
  const [recent] = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.action, 'resolution_check_started'),
        eq(activityLog.entityId, id),
        gt(activityLog.createdAt, new Date(Date.now() - 10 * 60 * 1000)),
      ),
    )
    .limit(1);

  if (recent) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Mark resolution check as in-progress
  const existing = (market.resolution as Record<string, unknown> | null) ?? {};
  await db.update(markets).set({
    resolution: { ...existing, checkingAt: new Date().toISOString() } as unknown as Resolution,
  }).where(eq(markets.id, id));

  try {
    await inngest.send({
      name: 'markets/resolution.check',
      data: { id },
    });
  } catch {
    // Inngest may not be available in all environments
  }

  await logActivity('resolution_check_started', {
    entityType: 'market',
    entityId: id,
    entityLabel: market.title,
    source: 'ui',
  });

  return NextResponse.json({ ok: true });
}
