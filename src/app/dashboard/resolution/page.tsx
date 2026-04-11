export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { MarketStatus, TimingSafety, Resolution } from '@/db/types';
import { StatusBadge } from '../_components/StatusBadge';
import { getUserTimezone } from '@/lib/timezone';

function formatTimestamp(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(ts * 1000));
}

export default async function ResolutionPage() {
  const tz = await getUserTimezone();
  const results = await db
    .select()
    .from(markets)
    .where(and(eq(markets.status, 'in_resolution'), eq(markets.isArchived, false)))
    .orderBy(desc(markets.createdAt));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Resolución</h1>

      {results.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No hay mercados cerrados pendientes de resolución.
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border divide-y divide-border">
          {results.map((market) => {
            const resolution = market.resolution as Resolution | null;

            return (
              <Link
                key={market.id}
                href={`/dashboard/markets/${market.id}`}
                className="block px-4 py-3 hover:bg-muted transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">
                      {market.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <StatusBadge status={market.status as MarketStatus} />
                      <span className="text-xs text-muted-foreground">
                        {market.category}
                      </span>
                      {resolution && (
                        <span className="text-xs text-muted-foreground">
                          Sugerido: {resolution.suggestedOutcome} ({resolution.confidence})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div>Cerró: {formatTimestamp(market.endTimestamp, tz)}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
