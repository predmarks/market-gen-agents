export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import type { MarketStatus, Iteration, Review } from '@/db/types';
import { StatusBadge } from '../_components/StatusBadge';
import { SourcingPanel } from './_components/SourcingPanel';

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
}

export default async function MonitoringPage() {
  const [processing, rejected, stats] = await Promise.all([
    db
      .select()
      .from(markets)
      .where(eq(markets.status, 'processing'))
      .orderBy(desc(markets.createdAt)),
    db
      .select()
      .from(markets)
      .where(eq(markets.status, 'rejected'))
      .orderBy(desc(markets.createdAt))
      .limit(20),
    db
      .select({
        status: markets.status,
        count: sql<number>`count(*)::int`,
      })
      .from(markets)
      .groupBy(markets.status),
  ]);

  const statMap = Object.fromEntries(stats.map((s) => [s.status, s.count]));

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Monitoreo</h1>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Procesando" value={statMap['processing'] ?? 0} color="text-amber-600" />
        <StatCard label="Propuestas" value={statMap['proposal'] ?? 0} color="text-blue-600" />
        <StatCard label="Rechazados" value={statMap['rejected'] ?? 0} color="text-red-600" />
        <StatCard label="Abiertos" value={(statMap['approved'] ?? 0) + (statMap['open'] ?? 0)} color="text-emerald-600" />
      </div>

      {/* Pipeline Activity */}
      <section>
        <h2 className="text-lg font-bold mb-3">Pipeline activo</h2>
        {processing.length === 0 ? (
          <p className="text-sm text-gray-500">No hay mercados en proceso.</p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
            {processing.map((market) => {
              const iterations = (market.iterations as Iteration[] | null) ?? [];
              const lastIter = iterations[iterations.length - 1];

              return (
                <Link
                  key={market.id}
                  href={`/dashboard/markets/${market.id}`}
                  className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate text-sm">
                        {market.title}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <StatusBadge status={market.status as MarketStatus} />
                        <span className="text-xs text-gray-500">
                          Iteración {iterations.length}
                        </span>
                        {lastIter && (
                          <span className="text-xs text-gray-500">
                            Score: {lastIter.review.scores.overallScore.toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">{formatDate(market.createdAt)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Rejections */}
      <section>
        <h2 className="text-lg font-bold mb-3">Rechazos recientes</h2>
        {rejected.length === 0 ? (
          <p className="text-sm text-gray-500">No hay rechazos recientes.</p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
            {rejected.map((market) => {
              const review = market.review as Review | null;
              const iterations = (market.iterations as Iteration[] | null) ?? [];

              return (
                <Link
                  key={market.id}
                  href={`/dashboard/markets/${market.id}`}
                  className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate text-sm">
                        {market.title}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-500">
                          {market.category}
                        </span>
                        {iterations.length > 0 && (
                          <span className="text-xs text-gray-500">
                            {iterations.length} iteraciones
                          </span>
                        )}
                        {review?.scores?.overallScore != null && review.scores.overallScore > 0 && (
                          <span className="text-xs text-gray-500">
                            Score: {review.scores.overallScore.toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">{formatDate(market.createdAt)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Sourcing */}
      <section>
        <SourcingPanel />
      </section>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}
