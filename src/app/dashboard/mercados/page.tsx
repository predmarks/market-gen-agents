'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { validateChainId, MAINNET_CHAIN_ID } from '@/lib/chains';
import { usePageContext } from '@/app/_components/PageContext';
import { SearchInput } from '@/app/dashboard/_components/SearchInput';
import { strip } from '@/lib/strip-diacritics';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface MarketEntry {
  id: string;
  title: string;
  status: string;
  category: string;
  score: number | null;
  createdAt: string;
  stale: boolean;
  volume: string | null;
  participants: number | null;
  endTimestamp: number;
  resolution: { suggestedOutcome?: string; confidence?: string; checkingAt?: string } | null;
  outcome: string | null;
  withdrawal: { withdrawnAt?: string; ownershipTransferredAt?: string } | null;
  pendingBalance: string | null;
}

function formatTimeInfo(status: string, endTimestamp: number): string | null {
  const now = Date.now();
  const endMs = endTimestamp * 1000;
  const diff = endMs - now;

  if (status === 'open') {
    if (diff <= 0) return 'Cerrado';
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  }

  if (status === 'in_resolution') {
    const elapsed = now - endMs;
    if (elapsed <= 0) return null;
    const days = Math.floor(elapsed / 86_400_000);
    const hours = Math.floor((elapsed % 86_400_000) / 3_600_000);
    if (days > 0) return `hace ${days}d`;
    return `hace ${hours}h`;
  }

  return null;
}

function formatVolume(vol: string): string {
  const n = parseFloat(vol) / 1e6;
  if (isNaN(n) || n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  candidate: { label: 'Candidato', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  processing: { label: 'Revisando', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  open: { label: 'Abierto', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  in_resolution: { label: 'En resolución', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  closed: { label: 'Resuelto', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  rejected: { label: 'Rechazado', className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelado', className: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300' },
};

const ARCHIVED_STATUSES = ['closed', 'rejected', 'cancelled'];

const STATUS_ORDER: Record<string, number> = {
  in_resolution: 0,
  open: 1,
  processing: 2,
  candidate: 3,
  closed: 4,
  rejected: 5,
  cancelled: 6,
};

const FILTERS = [
  { key: 'all', label: 'Activos', statuses: null },
  { key: 'in_resolution', label: 'En resolución', statuses: ['in_resolution'] },
  { key: 'open', label: 'Abiertos', statuses: ['open'] },
  { key: 'candidate', label: 'Candidatos', statuses: ['candidate'] },
  { key: 'processing', label: 'En revisión', statuses: ['processing'] },
  { key: 'archived', label: 'Archivados', statuses: ARCHIVED_STATUSES },
];

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 7
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
      : score >= 4
      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
      : 'bg-muted text-muted-foreground';
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-mono shrink-0 ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

export default function MercadosPage() {
  const searchParams = useSearchParams();
  const chainId = validateChainId(Number(searchParams.get('chain')) || undefined);
  const isTestnet = chainId !== MAINNET_CHAIN_ID;
  const [markets, setMarkets] = useState<MarketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'status' | 'score' | 'date' | 'volume' | 'participants'>('status');
  const [sortAsc, setSortAsc] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`/api/monitoring/activity?chain=${chainId}`);
      if (res.ok) {
        const json = await res.json();
        setMarkets(json.markets ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [chainId]);

  useEffect(() => {
    fetchAll();
    // Background: sync fresh indexer data, then refetch
    setSyncing(true);
    setSyncResult(null);
    fetch('/api/sync-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId }),
    })
      .then(async (res) => {
        if (res.ok) {
          const result = await res.json();
          setSyncResult(result);
          if (result.created > 0 || result.updated > 0) {
            await fetchAll();
          }
        }
      })
      .catch(() => {})
      .finally(() => setSyncing(false));
  }, [fetchAll, chainId]);

  // Compute counts per filter
  const filterCounts: Record<string, number> = {};
  for (const f of FILTERS) {
    if (!f.statuses) {
      filterCounts[f.key] = markets.filter((m) => !ARCHIVED_STATUSES.includes(m.status)).length;
    } else {
      filterCounts[f.key] = markets.filter((m) => f.statuses!.includes(m.status)).length;
    }
  }

  // Apply filter
  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const statusFiltered = activeFilter.statuses
    ? markets.filter((m) => activeFilter.statuses!.includes(m.status))
    : markets.filter((m) => !ARCHIVED_STATUSES.includes(m.status));
  const baseFiltered = showPendingOnly
    ? statusFiltered.filter((m) => m.pendingBalance && parseFloat(m.pendingBalance) > 0)
    : statusFiltered;
  const searchFiltered = searchQuery
    ? baseFiltered.filter((m) => {
        const q = strip(searchQuery);
        return strip(m.title).includes(q) || strip(m.category).includes(q);
      })
    : baseFiltered;

  // Sort — selected sort takes precedence; 'status' groups by status priority
  const dir = sortAsc ? 1 : -1;
  const filtered = [...searchFiltered].sort((a, b) => {
    if (sortBy === 'status') {
      const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      if (statusDiff !== 0) return statusDiff * dir;
      return ((b.score ?? 0) - (a.score ?? 0)) * dir;
    }
    if (sortBy === 'score') return ((b.score ?? 0) - (a.score ?? 0)) * dir;
    if (sortBy === 'volume') return ((parseFloat(b.volume ?? '0') - parseFloat(a.volume ?? '0'))) * dir;
    if (sortBy === 'participants') return ((b.participants ?? 0) - (a.participants ?? 0)) * dir;
    return (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) * dir;
  });

  // Push visible data to MiniChat context
  const { setPageData } = usePageContext();
  const pageContent = useMemo(() => filtered.map((m, i) => `${i + 1}. [${m.id}] ${m.title} | ${m.status} | ${m.category}${m.score ? ` | score:${m.score}` : ''}`).join('\n'), [filtered]);
  useEffect(() => {
    setPageData({ label: `Mercados — ${activeFilter.label} (${filtered.length})`, content: pageContent });
    return () => setPageData(null);
  }, [pageContent, activeFilter.label, filtered.length, setPageData]);

  // Selection — all non-archived markets are selectable
  const selectableMarkets = filtered.filter((m) => !ARCHIVED_STATUSES.includes(m.status));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === selectableMarkets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableMarkets.map((m) => m.id)));
    }
  }

  const allSelected = selectableMarkets.length > 0 && selectedIds.size === selectableMarkets.length;

  async function handleReject(id: string) {
    setActionLoading(id);
    try {
      await fetch(`/api/markets/${id}/reject`, { method: 'POST' });
      fetchAll();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  }

  // Rejectable statuses
  const selectedRejectable = markets.filter((m) => selectedIds.has(m.id) && m.status === 'candidate');

  async function handleBulkReject() {
    if (selectedRejectable.length === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all(
        selectedRejectable.map((m) =>
          fetch(`/api/markets/${m.id}/reject`, { method: 'POST' })
        )
      );
      setSelectedIds(new Set());
      fetchAll();
    } catch { /* ignore */ } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Mercados</h1>
          {isTestnet && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">Testnet</span>
          )}
          {syncing && (
            <span className="text-xs text-muted-foreground/60 animate-pulse">Sincronizando...</span>
          )}
          {!syncing && syncResult && (syncResult.created > 0 || syncResult.updated > 0) && (
            <span className="text-xs text-green-600 dark:text-green-400">
              {syncResult.created > 0 && `+${syncResult.created} nuevos`}
              {syncResult.created > 0 && syncResult.updated > 0 && ', '}
              {syncResult.updated > 0 && `${syncResult.updated} actualizados`}
            </span>
          )}
        </div>
        {selectableMarkets.length > 0 && (
          <Label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="rounded border-border"
            />
            Seleccionar todos
          </Label>
        )}
      </div>

      {/* Status filters */}
      {markets.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => {
            const count = filterCounts[f.key];
            if (f.key !== 'all' && count === 0) return null;
            return (
              <Button
                key={f.key}
                onClick={() => setFilter(filter === f.key ? 'all' : f.key)}
                variant={filter === f.key ? 'default' : 'outline'}
                size="xs"
                className="rounded-full cursor-pointer"
              >
                {f.label} ({count})
              </Button>
            );
          })}
          {(() => {
            const totalPending = statusFiltered.reduce((sum, m) => {
              if (m.pendingBalance && parseFloat(m.pendingBalance) > 0) {
                return sum + parseFloat(m.pendingBalance);
              }
              return sum;
            }, 0);
            const totalLabel = totalPending > 0 ? ` ($${formatVolume(String(totalPending))})` : '';
            return (
              <Button
                onClick={() => setShowPendingOnly((v) => !v)}
                variant={showPendingOnly ? 'secondary' : 'outline'}
                size="xs"
                className={`rounded-full cursor-pointer ${
                  showPendingOnly
                    ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'
                    : ''
                }`}
              >
                Con liquidez pendiente{totalLabel}
              </Button>
            );
          })()}
        </div>
      )}

      <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Buscar por título o categoría..." />

      {/* Sort controls */}
      {markets.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground/60">Ordenar:</span>
          {([['status', 'Estado'], ['score', 'Score'], ['date', 'Recientes'], ['volume', 'Volumen'], ['participants', 'Participantes']] as const).map(([key, label]) => (
            <Button
              key={key}
              onClick={() => {
                if (sortBy === key) setSortAsc(!sortAsc);
                else { setSortBy(key); setSortAsc(key === 'status' || key === 'volume' || key === 'participants'); }
              }}
              variant={sortBy === key ? 'default' : 'outline'}
              size="xs"
              className="cursor-pointer"
            >
              {label} {sortBy === key ? (sortAsc ? '\u2191' : '\u2193') : ''}
            </Button>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3">
          <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
            {selectedIds.size} mercado{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              onClick={handleBulkReject}
              disabled={bulkLoading || selectedRejectable.length === 0}
              variant="destructive"
              size="sm"
              className="cursor-pointer"
            >
              {bulkLoading ? '...' : `Rechazar ${selectedRejectable.length}`}
            </Button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-muted-foreground">Cargando...</div>}

      {!loading && markets.length === 0 && (
        <div className="text-sm text-muted-foreground">No hay mercados</div>
      )}

      <div className="grid gap-1">
        {filtered.map((m) => {
          const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE.candidate;
          const isArchived = ARCHIVED_STATUSES.includes(m.status);
          const isRejectable = m.status === 'candidate';
          const isSelected = selectedIds.has(m.id);

          return (
            <Link
              key={m.id}
              href={`/dashboard/markets/${m.id}`}
              className={`block border rounded-lg cursor-pointer hover:border-foreground/20 transition-colors ${
                isSelected
                  ? 'border-blue-400 dark:border-blue-600 ring-1 ring-blue-200 dark:ring-blue-800 bg-card'
                  : m.status === 'in_resolution'
                  ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10'
                  : 'border-border bg-card'
              }`}
            >
              {/* Primary row: checkbox, status, title */}
              <div className="flex items-center gap-2 px-3 pt-2 pb-1 md:pb-2">
                {!isArchived ? (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(m.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-border shrink-0"
                  />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                  {badge.label}
                </span>
                {m.score != null && <span className="hidden md:inline"><ScoreBadge score={m.score} /></span>}
                <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
                  {m.title}
                </span>
                {m.outcome ? (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                    ✓ {m.outcome}
                  </span>
                ) : m.resolution?.suggestedOutcome ? (
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    m.resolution.confidence === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                    m.resolution.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    → {m.resolution.suggestedOutcome}
                  </span>
                ) : null}
                {m.resolution?.checkingAt && Date.now() - new Date(m.resolution.checkingAt).getTime() < 10 * 60 * 1000 && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 animate-pulse">Verificando...</span>
                )}
                {m.status === 'closed' ? (
                  m.withdrawal?.withdrawnAt ? (
                    <span className="hidden md:inline shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Liquidez retirada</span>
                  ) : m.withdrawal?.ownershipTransferredAt ? (
                    <span className="hidden md:inline shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 animate-pulse">Retiro en progreso</span>
                  ) : m.pendingBalance && parseFloat(m.pendingBalance) > 0 ? (
                    <span className="hidden md:inline shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">Liquidez pendiente ${formatVolume(m.pendingBalance)}</span>
                  ) : null
                ) : m.pendingBalance && parseFloat(m.pendingBalance) > 0 ? (
                  <span className="hidden md:inline shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">Liquidez ${formatVolume(m.pendingBalance)}</span>
                ) : null}
                <span className="hidden md:inline text-xs text-muted-foreground/60 shrink-0">{m.category}</span>
                {m.volume && (
                  <span className="hidden md:inline shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">${formatVolume(m.volume)}</span>
                )}
                {m.participants != null && m.participants > 0 && (
                  <span className="hidden md:inline shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">{m.participants} participantes</span>
                )}
                {m.stale && (
                  <span className="hidden md:inline text-[10px] text-orange-500 dark:text-orange-400 shrink-0">stale</span>
                )}
                {(() => {
                  const timeInfo = formatTimeInfo(m.status, m.endTimestamp);
                  if (!timeInfo) return null;
                  return (
                    <span className={`hidden md:inline shrink-0 text-[10px] ${m.status === 'in_resolution' ? 'text-amber-500 dark:text-amber-400' : 'text-muted-foreground/60'}`}>
                      {timeInfo}
                    </span>
                  );
                })()}
                <div className="hidden md:flex ml-auto items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {isRejectable && (
                    <button
                      onClick={() => handleReject(m.id)}
                      disabled={actionLoading === m.id || bulkLoading}
                      className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {actionLoading === m.id ? '...' : 'Rechazar'}
                    </button>
                  )}
                </div>
              </div>
              {/* Secondary row: metadata (mobile only) */}
              <div className="flex md:hidden items-center gap-2 px-3 pb-2 pl-9 flex-wrap">
                {m.score != null && <ScoreBadge score={m.score} />}
                <span className="text-xs text-muted-foreground/60 shrink-0">{m.category}</span>
                {m.volume && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">${formatVolume(m.volume)}</span>
                )}
                {m.participants != null && m.participants > 0 && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">{m.participants}</span>
                )}
                {m.stale && (
                  <span className="text-[10px] text-orange-500 dark:text-orange-400 shrink-0">stale</span>
                )}
                {(() => {
                  const timeInfo = formatTimeInfo(m.status, m.endTimestamp);
                  if (!timeInfo) return null;
                  return (
                    <span className={`shrink-0 text-[10px] ${m.status === 'in_resolution' ? 'text-amber-500 dark:text-amber-400' : 'text-muted-foreground/60'}`}>
                      {timeInfo}
                    </span>
                  );
                })()}
                <div className="ml-auto flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {isRejectable && (
                    <button
                      onClick={() => handleReject(m.id)}
                      disabled={actionLoading === m.id || bulkLoading}
                      className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {actionLoading === m.id ? '...' : 'Rechazar'}
                    </button>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
