import { inngest } from './client';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { MAINNET_CHAIN_ID } from '@/lib/chains';

export const cronResolution = inngest.createFunction(
  { id: 'cron-resolution-check' },
  { cron: '0 */6 * * *' },
  async ({ step }) => {
    const now = Math.floor(Date.now() / 1000);
    const in72h = now + 72 * 60 * 60;

    const eligible = await step.run('find-eligible', async () => {
      // Open markets closing within 72h
      const openMarkets = await db
        .select({ id: markets.id, endTimestamp: markets.endTimestamp, expectedResolutionDate: markets.expectedResolutionDate })
        .from(markets)
        .where(and(eq(markets.status, 'open'), eq(markets.chainId, MAINNET_CHAIN_ID)));

      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const nearDeadline = openMarkets
        .filter((m) => m.endTimestamp <= in72h && (!m.expectedResolutionDate || m.expectedResolutionDate <= today))
        .map((m) => m.id);

      // In-resolution markets without a resolution suggestion yet (mainnet only)
      const inResolution = await db
        .select({ id: markets.id })
        .from(markets)
        .where(and(eq(markets.status, 'in_resolution'), eq(markets.chainId, MAINNET_CHAIN_ID)));

      const needsCheck = inResolution
        .map((m) => m.id);

      // Deduplicate
      return [...new Set([...nearDeadline, ...needsCheck])];
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
