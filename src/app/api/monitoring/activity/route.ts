import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { markets, marketEvents } from '@/db/schema';
import { eq, and, or, desc, sql, inArray } from 'drizzle-orm';
import type { Iteration, Review, Resolution } from '@/db/types';
import { validateChainId } from '@/lib/chains';

export const dynamic = 'force-dynamic';

const STALE_MS = 5 * 60 * 1000; // 5 minutes without events = stale

interface MarketMonitorEntry {
  id: string;
  title: string;
  status: string;
  category: string;
  createdAt: string;
  completedAt: string | null;
  iterationCount: number;
  score: number | null;
  currentStep: string | null;
  stepTimestamp: string | null;
  stale: boolean;
  volume: string | null;
  participants: number | null;
  endTimestamp: number;
  resolution: { suggestedOutcome?: string; confidence?: string } | null;
  outcome: string | null;
  pendingBalance: string | null;
}

export async function GET(request: NextRequest) {
  const filterStatus = request.nextUrl.searchParams.get('status');
  const chainId = validateChainId(Number(request.nextUrl.searchParams.get('chain')) || undefined);

  const chainFilter = and(
    eq(markets.isArchived, false),
    or(eq(markets.chainId, chainId), eq(markets.status, 'candidate')),
  );

  // Always get counts (excluding archived)
  const countRows = await db
    .select({
      status: markets.status,
      count: sql<number>`count(*)::int`,
    })
    .from(markets)
    .where(chainFilter)
    .groupBy(markets.status);

  const counts: Record<string, number> = {};
  for (const row of countRows) {
    counts[row.status] = row.count;
  }

  // Fetch markets (filtered or all — supports comma-separated statuses)
  const query = db
    .select()
    .from(markets)
    .orderBy(desc(markets.createdAt))
    .limit(500);

  let rows;
  if (filterStatus) {
    const statuses = filterStatus.split(',');
    const statusFilter = statuses.length > 1
      ? inArray(markets.status, statuses)
      : eq(markets.status, statuses[0]);
    rows = await query.where(and(chainFilter, statusFilter));
  } else {
    rows = await query.where(chainFilter);
  }

  // For processing markets, get their latest event
  const processingIds = rows
    .filter((m) => m.status === 'processing')
    .map((m) => m.id);

  const latestEvents = new Map<string, { type: string; iteration: number | null; createdAt: Date }>();

  if (processingIds.length > 0) {
    // Get latest event per market using a subquery approach
    const events = await db
      .select()
      .from(marketEvents)
      .where(inArray(marketEvents.marketId, processingIds))
      .orderBy(desc(marketEvents.createdAt));

    // Keep only the latest per market
    for (const ev of events) {
      if (!latestEvents.has(ev.marketId)) {
        latestEvents.set(ev.marketId, {
          type: ev.type,
          iteration: ev.iteration,
          createdAt: ev.createdAt,
        });
      }
    }
  }

  const entries: MarketMonitorEntry[] = rows.map((m) => {
    const iterations = (m.iterations as Iteration[] | null) ?? [];
    const review = m.review as Review | null;
    const latestEvent = latestEvents.get(m.id);

    let currentStep: string | null = null;
    let stepTimestamp: string | null = null;

    if (m.status === 'processing' && latestEvent) {
      currentStep = latestEvent.type;
      if (latestEvent.iteration) {
        currentStep += `:${latestEvent.iteration}`;
      }
      stepTimestamp = latestEvent.createdAt.toISOString();
    }

    // Detect stale processing markets (no events in 5+ min = Inngest job likely dead)
    let stale = false;
    if (m.status === 'processing') {
      const lastActivity = latestEvent?.createdAt ?? m.createdAt;
      stale = Date.now() - lastActivity.getTime() > STALE_MS;
    }

    // completedAt: use review timestamp for finished markets
    let completedAt: string | null = null;
    if (review?.reviewedAt && (m.status === 'open' || m.status === 'rejected')) {
      completedAt = review.reviewedAt;
    }

    const resolution = m.resolution as Resolution | null;

    return {
      id: m.id,
      title: m.title,
      status: m.status,
      category: m.category,
      createdAt: m.createdAt.toISOString(),
      completedAt,
      iterationCount: iterations.length,
      score: review?.scores?.overallScore ?? null,
      currentStep,
      stepTimestamp,
      stale,
      volume: m.volume,
      participants: m.participants,
      endTimestamp: m.endTimestamp,
      outcome: m.outcome,
      pendingBalance: m.pendingBalance,
      resolution: resolution?.suggestedOutcome || resolution?.checkingAt
        ? { suggestedOutcome: resolution?.suggestedOutcome, confidence: resolution?.confidence, checkingAt: resolution?.checkingAt }
        : null,
      withdrawal: resolution?.withdrawal
        ? { withdrawnAt: resolution.withdrawal.withdrawnAt, ownershipTransferredAt: resolution.withdrawal.ownershipTransferredAt }
        : null,
    };
  });

  return NextResponse.json({ markets: entries, counts });
}
