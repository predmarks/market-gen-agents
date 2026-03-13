export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { inArray, asc } from 'drizzle-orm';
import type { MarketStatus, TimingSafety } from '@/db/types';
import { StatusBadge } from '../_components/StatusBadge';
import { TimingSafetyIndicator } from '../_components/TimingSafetyIndicator';

function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(ts * 1000));
}

function timeRemaining(ts: number): { text: string; urgent: boolean } {
  const now = Date.now() / 1000;
  const diff = ts - now;
  if (diff <= 0) return { text: 'Cerrado', urgent: true };
  const hours = Math.floor(diff / 3600);
  const days = Math.floor(hours / 24);
  if (days > 0) return { text: `${days}d ${hours % 24}h`, urgent: days < 3 };
  return { text: `${hours}h`, urgent: true };
}

export default async function OpenMarketsPage() {
  const results = await db
    .select()
    .from(markets)
    .where(inArray(markets.status, ['approved', 'open']))
    .orderBy(asc(markets.endTimestamp));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Abiertos</h1>
        <span className="text-sm text-gray-500">{results.length} mercados</span>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No hay mercados abiertos.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          {results.map((market) => {
            const remaining = timeRemaining(market.endTimestamp);

            return (
              <Link
                key={market.id}
                href={`/dashboard/markets/${market.id}`}
                className="block px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 truncate">
                      {market.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <StatusBadge status={market.status as MarketStatus} />
                      <span className="text-xs text-gray-500">
                        {market.category}
                      </span>
                      <TimingSafetyIndicator
                        safety={market.timingSafety as TimingSafety}
                      />
                    </div>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    <div className="text-gray-500">
                      Cierre: {formatTimestamp(market.endTimestamp)}
                    </div>
                    <div className={remaining.urgent ? 'text-red-600 font-medium' : 'text-gray-500'}>
                      {remaining.text}
                    </div>
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
