import { NextResponse } from 'next/server';
import { inngest } from '@/inngest/client';

export async function POST() {
  await inngest.send({
    name: 'market/sourcing.requested',
    data: {},
  });

  return NextResponse.json({ triggered: true });
}
