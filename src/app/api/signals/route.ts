import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { signals } from '@/db/schema';
import { desc, and, or, eq, ilike, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get('q')?.trim() || null;
  const source = params.get('source') || null;
  const category = params.get('category') || null;
  const type = params.get('type') || null;
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const limit = Math.min(500, Math.max(1, Number(params.get('limit')) || 100));

  // Build filter conditions
  const conditions: SQL[] = [];
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(signals.text, pattern),
        ilike(signals.summary, pattern),
        ilike(signals.source, pattern),
      )!,
    );
  }
  if (source) conditions.push(eq(signals.source, source));
  if (category) conditions.push(eq(signals.category, category));
  if (type) conditions.push(eq(signals.type, type));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch page + total count in parallel
  const [rows, [{ total }], counts] = await Promise.all([
    db
      .select({
        id: signals.id,
        type: signals.type,
        text: signals.text,
        summary: signals.summary,
        url: signals.url,
        source: signals.source,
        category: signals.category,
        publishedAt: signals.publishedAt,
        score: signals.score,
        scoreReason: signals.scoreReason,
        dataPoints: signals.dataPoints,
      })
      .from(signals)
      .where(where)
      .orderBy(desc(signals.publishedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(signals)
      .where(where),
    // Unfiltered counts for filter pills
    db
      .select({
        source: signals.source,
        type: signals.type,
        category: signals.category,
        count: sql<number>`count(*)::int`,
      })
      .from(signals)
      .groupBy(signals.source, signals.type, signals.category),
  ]);

  // Aggregate counts
  const bySource: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalAll = 0;
  for (const row of counts) {
    bySource[row.source] = (bySource[row.source] ?? 0) + row.count;
    byType[row.type] = (byType[row.type] ?? 0) + row.count;
    if (row.category) byCategory[row.category] = (byCategory[row.category] ?? 0) + row.count;
    totalAll += row.count;
  }

  return NextResponse.json({
    signals: rows,
    total,
    counts: { bySource, byType, byCategory, total: totalAll },
  });
}
