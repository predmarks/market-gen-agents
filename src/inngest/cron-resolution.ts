import { inngest } from './client';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const cronResolution = inngest.createFunction(
  { id: 'cron-resolution-check' },
  { cron: '0 8 * * *' },
  async ({ step }) => {
    const now = Math.floor(Date.now() / 1000);
    const in72h = now + 72 * 60 * 60;

    // Find open markets closing within 72h OR already past deadline
    const eligible = await step.run('find-eligible', async () => {
      const openMarkets = await db
        .select({ id: markets.id, endTimestamp: markets.endTimestamp })
        .from(markets)
        .where(eq(markets.status, 'open'));

      return openMarkets
        .filter((m) => m.endTimestamp <= in72h)
        .map((m) => m.id);
    });

    if (eligible.length > 0) {
      await step.sendEvent('dispatch-checks',
        eligible.map((id) => ({
          name: 'markets/resolution.check' as const,
          data: { id },
        })),
      );
    }

    return { dispatched: eligible.length };
  },
);
