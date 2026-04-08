import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { newsletterRuns } from '@/db/schema';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const runs = await db
    .select({
      id: newsletterRuns.id,
      status: newsletterRuns.status,
      currentStep: newsletterRuns.currentStep,
      steps: newsletterRuns.steps,
      error: newsletterRuns.error,
      newsletterId: newsletterRuns.newsletterId,
      startedAt: newsletterRuns.startedAt,
      completedAt: newsletterRuns.completedAt,
    })
    .from(newsletterRuns)
    .orderBy(desc(newsletterRuns.startedAt))
    .limit(10);

  return NextResponse.json({ runs });
}
