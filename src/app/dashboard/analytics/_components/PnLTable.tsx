'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface MarketRow {
  marketId: string;
  onchainId: string | null;
  title: string;
  status: string;
  seeded: number;
  withdrawn: number;
  pending: number;
  liquidityPnL: number;
  ownedPnL: number;
  netPnL: number;
}

type SortKey = 'id' | 'title' | 'seeded' | 'withdrawn' | 'pending' | 'liquidityPnL' | 'ownedPnL' | 'netPnL';
type SortDir = 'asc' | 'desc';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-indigo-400 dark:bg-indigo-500',
  in_resolution: 'bg-amber-400 dark:bg-amber-500',
  closed: 'bg-green-400 dark:bg-green-500',
  rejected: 'bg-muted-foreground/50',
  cancelled: 'bg-muted-foreground/50',
};

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs >= 1000
    ? `$${(abs / 1000).toFixed(1)}K`
    : `$${abs.toFixed(2)}`;
  return value < 0 ? `-${formatted}` : formatted;
}

function PnLValue({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        'font-mono',
        value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
        className,
      )}
    >
      {value >= 0 ? '+' : ''}{formatUsd(value)}
    </span>
  );
}

const COLUMNS: { key: SortKey; label: string; width: string }[] = [
  { key: 'id', label: 'ID', width: 'w-12' },
  { key: 'title', label: 'Mercado', width: 'flex-1 min-w-0' },
  { key: 'seeded', label: 'Fondeado', width: 'w-16' },
  { key: 'withdrawn', label: 'Retirado', width: 'w-16' },
  { key: 'pending', label: 'Pendiente', width: 'w-16' },
  { key: 'liquidityPnL', label: 'PnL LP', width: 'w-20' },
  { key: 'ownedPnL', label: 'PnL Trading', width: 'w-20' },
  { key: 'netPnL', label: 'PnL Neto', width: 'w-20' },
];

function sortMarkets(markets: MarketRow[], key: SortKey, dir: SortDir): MarketRow[] {
  const sorted = [...markets];
  sorted.sort((a, b) => {
    let cmp: number;
    if (key === 'id') {
      cmp = (Number(a.onchainId) || 0) - (Number(b.onchainId) || 0);
    } else if (key === 'title') {
      cmp = a.title.localeCompare(b.title);
    } else {
      cmp = a[key] - b[key];
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

export default function PnLTable({ markets }: { markets: MarketRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('netPnL');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = sortMarkets(markets, sortKey, sortDir);

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <h2 className="text-sm font-medium text-muted-foreground mb-4">Desglose por mercado</h2>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">Sin datos</p>
      ) : (
        <div className="space-y-1">
          {/* Header */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60 py-1 border-b border-border">
            <span className="w-3 shrink-0" />
            {COLUMNS.map((col) => (
              <button
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={cn(
                  'shrink-0 text-right cursor-pointer hover:text-foreground transition-colors',
                  col.width,
                  col.key === 'title' && 'text-left',
                  sortKey === col.key && 'text-foreground font-medium',
                )}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </button>
            ))}
          </div>

          {sorted.map((m) => (
            <Row key={m.marketId} market={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ market: m }: { market: MarketRow }) {
  const isUnrealized = m.status === 'open' || m.status === 'in_resolution';
  return (
    <div className="flex items-center gap-2 text-xs py-1.5">
      <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', STATUS_COLORS[m.status] ?? 'bg-muted-foreground/40')} />
      <span className="w-12 text-right font-mono text-muted-foreground/60 shrink-0">
        {m.onchainId ? `#${m.onchainId}` : '—'}
      </span>
      <Link
        href={`/dashboard/markets/${m.marketId}`}
        className="flex-1 min-w-0 truncate text-foreground hover:underline"
        title={m.title}
      >
        {m.title}
        {isUnrealized && (
          <span className="ml-1.5 text-amber-500 dark:text-amber-400 text-[10px]">(no realizado)</span>
        )}
      </Link>
      <span className="w-16 text-right font-mono text-muted-foreground shrink-0">
        {formatUsd(m.seeded)}
      </span>
      <span className="w-16 text-right font-mono text-muted-foreground shrink-0">
        {m.withdrawn > 0 ? formatUsd(m.withdrawn) : <span className="text-muted-foreground/40">—</span>}
      </span>
      <span className="w-16 text-right font-mono text-muted-foreground shrink-0">
        {formatUsd(m.pending)}
      </span>
      <span className="w-20 text-right shrink-0">
        <PnLValue value={m.liquidityPnL} />
      </span>
      <span className="w-20 text-right shrink-0">
        {m.ownedPnL !== 0 ? <PnLValue value={m.ownedPnL} /> : <span className="text-muted-foreground/40 font-mono">—</span>}
      </span>
      <span className="w-20 text-right shrink-0">
        <PnLValue value={m.netPnL} className="font-medium" />
      </span>
    </div>
  );
}
