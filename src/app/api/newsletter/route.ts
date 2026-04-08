import { NextRequest, NextResponse } from 'next/server';
import { inngest } from '@/inngest/client';
import { db } from '@/db/client';
import { newsletterRuns } from '@/db/schema';
import { eq } from 'drizzle-orm';

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const date = (body.date as string) ?? new Date().toISOString().split('T')[0];

  // Check for already-running job
  const [running] = await db
    .select({ id: newsletterRuns.id, startedAt: newsletterRuns.startedAt })
    .from(newsletterRuns)
    .where(eq(newsletterRuns.status, 'running'))
    .limit(1);

  if (running) {
    const age = Date.now() - running.startedAt.getTime();
    if (age < STALE_THRESHOLD_MS) {
      return NextResponse.json(
        { triggered: false, reason: 'already_running', runId: running.id },
        { status: 409 },
      );
    }
    // Stale run — mark as error and allow new trigger
    await db
      .update(newsletterRuns)
      .set({ status: 'error', error: 'Timed out (stale)', completedAt: new Date() })
      .where(eq(newsletterRuns.id, running.id));
  }

  await inngest.send({
    name: 'newsletter/generate.requested',
    data: { date },
  });

  return NextResponse.json({ triggered: true, date });
}
