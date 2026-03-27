import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { activityLog } from '@/db/schema';
import { desc, eq, and, inArray, gt } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ids = request.nextUrl.searchParams.get('ids');
  if (ids) {
    const idList = ids.split(',').filter(Boolean);
    const rows = await db.select().from(activityLog).where(inArray(activityLog.id, idList));
    return NextResponse.json({ entries: rows });
  }

  const entityType = request.nextUrl.searchParams.get('entityType');
  const source = request.nextUrl.searchParams.get('source');
  const action = request.nextUrl.searchParams.get('action');
  const since = request.nextUrl.searchParams.get('since');

  const conditions = [];
  if (entityType) conditions.push(eq(activityLog.entityType, entityType));
  if (source) conditions.push(eq(activityLog.source, source));
  if (action) conditions.push(eq(activityLog.action, action));
  if (since) conditions.push(gt(activityLog.createdAt, new Date(since)));

  const rows = conditions.length > 0
    ? await db.select().from(activityLog).where(and(...conditions)).orderBy(desc(activityLog.createdAt)).limit(200)
    : await db.select().from(activityLog).orderBy(desc(activityLog.createdAt)).limit(200);

  return NextResponse.json({ entries: rows });
}
