import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { newsletters } from '@/db/schema';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await db
    .select({
      id: newsletters.id,
      date: newsletters.date,
      status: newsletters.status,
      subjectLine: newsletters.subjectLine,
      featuredMarketIds: newsletters.featuredMarketIds,
      createdAt: newsletters.createdAt,
      updatedAt: newsletters.updatedAt,
    })
    .from(newsletters)
    .orderBy(desc(newsletters.createdAt))
    .limit(50);

  return NextResponse.json({ newsletters: rows });
}
