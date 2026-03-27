import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { rules } from '@/db/schema';
import { HARD_RULES, SOFT_RULES } from '@/config/rules';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.select().from(rules);
    if (rows.length > 0) {
      return NextResponse.json({ rules: rows });
    }
  } catch {
    // fallback
  }

  // Fallback to config
  const allRules = [...HARD_RULES, ...SOFT_RULES].map((r) => ({
    ...r,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  return NextResponse.json({ rules: allRules });
}
