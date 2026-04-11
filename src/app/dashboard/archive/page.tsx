export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { MarketStatus, Review } from '@/db/types';
import { StatusBadge } from '../_components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

interface Props {
  searchParams: Promise<{ q?: string; status?: string }>;
}

export default async function ArchivePage({ searchParams }: Props) {
  const { q, status } = await searchParams;

  const conditions = [eq(markets.isArchived, true)];
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(sql`unaccent(${markets.title}) ilike unaccent(${pattern})`);
  }
  if (status) {
    conditions.push(eq(markets.status, status));
  }

  const results = await db
    .select()
    .from(markets)
    .where(and(...conditions))
    .orderBy(desc(markets.createdAt))
    .limit(100);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Archivo</h1>

      <form className="mb-6 flex gap-3">
        <Input
          name="q"
          type="text"
          defaultValue={q ?? ''}
          placeholder="Buscar por título..."
          className="flex-1"
        />
        <select
          name="status"
          defaultValue={status ?? ''}
          className="px-3 py-2 border border-border rounded-md text-sm bg-background"
        >
          <option value="">Todos los estados</option>
          <option value="rejected">Rechazados</option>
          <option value="cancelled">Cancelados</option>
          <option value="closed">Resueltos</option>
        </select>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>

      {results.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No hay mercados archivados{q ? ` que coincidan con "${q}"` : ''}.
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border divide-y divide-border">
          {results.map((market) => {
            const review = market.review as Review | null;
            const score = review?.scores?.overallScore;

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
                      {score != null && (
                        <span className="text-xs text-muted-foreground">
                          Score: {score.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div>{formatDate(market.createdAt)}</div>
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
