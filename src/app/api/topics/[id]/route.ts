import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { topics, topicSignals, signals } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Accept both UUID and slug
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const [topic] = isUuid
    ? await db.select().from(topics).where(eq(topics.id, id)).limit(1)
    : await db.select().from(topics).where(eq(topics.slug, id)).limit(1);
  if (!topic) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const linkedSignals = await db
    .select({
      id: signals.id,
      type: signals.type,
      text: signals.text,
      summary: signals.summary,
      url: signals.url,
      source: signals.source,
      category: signals.category,
      publishedAt: signals.publishedAt,
      dataPoints: signals.dataPoints,
    })
    .from(topicSignals)
    .innerJoin(signals, eq(topicSignals.signalId, signals.id))
    .where(eq(topicSignals.topicId, topic.id))
    .orderBy(desc(signals.publishedAt));

  return NextResponse.json({ topic, signals: linkedSignals });
}
