import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { topics } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { logActivity } from '@/lib/activity-log';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [topic] = await db.select({ name: topics.name, slug: topics.slug }).from(topics).where(eq(topics.id, id));

  let reason: string | undefined;
  try {
    const body = await request.json();
    reason = body.reason;
  } catch {
    // no body or invalid JSON — proceed without reason
  }

  if (reason) {
    const entry = JSON.stringify([{ text: reason, createdAt: new Date().toISOString() }]);
    await db
      .update(topics)
      .set({
        status: 'dismissed',
        updatedAt: new Date(),
        feedback: sql`COALESCE(${topics.feedback}, '[]'::jsonb) || ${entry}::jsonb`,
      })
      .where(eq(topics.id, id));
  } else {
    await db
      .update(topics)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(eq(topics.id, id));
  }

  await logActivity('topic_dismissed', {
    entityType: 'topic',
    entityId: id,
    entityLabel: topic?.name,
    detail: { reason, contextLabel: topic?.name, contextUrl: topic ? `/dashboard/topics/${topic.slug}` : undefined },
    source: 'ui',
  });

  return NextResponse.json({ ok: true });
}
