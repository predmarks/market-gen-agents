import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { globalFeedback } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { logActivity } from '@/lib/activity-log';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await db
    .select()
    .from(globalFeedback)
    .orderBy(desc(globalFeedback.createdAt));

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!text || text.length > 2000) {
    return NextResponse.json(
      { error: 'Feedback must be between 1 and 2000 characters' },
      { status: 400 },
    );
  }

  const [row] = await db
    .insert(globalFeedback)
    .values({ text })
    .returning();

  await logActivity('global_feedback_added', { entityType: 'system', detail: { text }, source: 'ui' });

  return NextResponse.json(row);
}
