import { NextResponse } from 'next/server';
import { loadRules } from '@/config/rules';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { hard, soft } = await loadRules();
  const allRules = [...hard, ...soft].map((r) => ({
    ...r,
    enabled: true,
  }));
  return NextResponse.json({ rules: allRules });
}
