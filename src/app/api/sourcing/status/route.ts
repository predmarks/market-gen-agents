import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { sourcingRuns } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { CANDIDATE_CAP } from '@/agents/sourcer';

export async function GET() {
  const runs = await db
    .select()
    .from(sourcingRuns)
    .orderBy(desc(sourcingRuns.startedAt))
    .limit(10);

  return NextResponse.json({ runs, candidateCap: CANDIDATE_CAP });
}
