import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { newsletters } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logActivity } from '@/lib/activity-log';
import { markdownToEmailHtml } from '@/lib/markdown-to-html';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const [newsletter] = await db.select().from(newsletters).where(eq(newsletters.id, id));
  if (!newsletter) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ newsletter });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.subjectLine === 'string') updates.subjectLine = body.subjectLine;
  if (typeof body.markdown === 'string') updates.markdown = body.markdown;
  if (typeof body.html === 'string') updates.html = body.html;
  if (typeof body.status === 'string') updates.status = body.status;

  // Auto-regenerate HTML preview when markdown changes without explicit HTML
  if (updates.markdown && !updates.html) {
    updates.html = markdownToEmailHtml(updates.markdown as string);
  }

  const [updated] = await db
    .update(newsletters)
    .set(updates)
    .where(eq(newsletters.id, id))
    .returning({ id: newsletters.id, subjectLine: newsletters.subjectLine });

  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await logActivity('newsletter_updated', {
    entityType: 'newsletter',
    entityId: id,
    entityLabel: updated.subjectLine,
    detail: { fields: Object.keys(updates).filter((k) => k !== 'updatedAt') },
    source: 'ui',
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const [deleted] = await db
    .delete(newsletters)
    .where(eq(newsletters.id, id))
    .returning({ id: newsletters.id, subjectLine: newsletters.subjectLine });

  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await logActivity('newsletter_deleted', {
    entityType: 'newsletter',
    entityId: id,
    entityLabel: deleted.subjectLine,
    source: 'ui',
  });

  return NextResponse.json({ ok: true });
}
