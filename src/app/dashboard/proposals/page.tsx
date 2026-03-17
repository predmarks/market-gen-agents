export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { MarketStatus, TimingSafety, Review } from '@/db/types';
import { StatusBadge } from '../_components/StatusBadge';
import { TimingSafetyIndicator } from '../_components/TimingSafetyIndicator';

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export default async function ProposalsPage() {
  const results = await db
    .select()
    .from(markets)
    .where(eq(markets.status, 'proposal'))
    .orderBy(desc(markets.createdAt));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Propuestas</h1>
        <span className="text-sm text-gray-500">{results.length} propuestas</span>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No hay propuestas pendientes.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          {results.map((market) => {
            const review = market.review as Review | null;
            const score = review?.scores?.overallScore;

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
                      {score != null && (
                        <span className="text-xs text-gray-500">
                          Score: {score.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500 shrink-0">
                    <div>Creado: {formatDate(market.createdAt)}</div>
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
