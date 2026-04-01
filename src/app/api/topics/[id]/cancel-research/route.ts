import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { topics } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logActivity } from '@/lib/activity-log';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [topic] = await db
    .select({ name: topics.name, slug: topics.slug, status: topics.status })
    .from(topics)
    .where(eq(topics.id, id));

  if (!topic) {
    return NextResponse.json({ error: 'Topic not found' }, { status: 404 });
  }

  if (topic.status !== 'researching') {
    return NextResponse.json({ error: 'Topic is not researching' }, { status: 400 });
  }

  await db
    .update(topics)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(topics.id, id));

  await logActivity('research_cancelled', {
    entityType: 'topic',
    entityId: id,
    entityLabel: topic.name,
    detail: { contextLabel: topic.name, contextUrl: `/dashboard/topics/${topic.slug}` },
    source: 'ui',
  });

  return NextResponse.json({ ok: true });
}
