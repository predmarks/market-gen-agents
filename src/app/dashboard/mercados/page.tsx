'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface MarketEntry {
  id: string;
  title: string;
  status: string;
  category: string;
  score: number | null;
  createdAt: string;
  stale: boolean;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  candidate: { label: 'Candidato', className: 'bg-gray-100 text-gray-600' },
  processing: { label: 'Revisando', className: 'bg-blue-100 text-blue-700' },
  open: { label: 'Abierto', className: 'bg-green-100 text-green-700' },
  resolved: { label: 'Resuelto', className: 'bg-gray-100 text-gray-500' },
  rejected: { label: 'Rechazado', className: 'bg-red-100 text-red-600' },
  cancelled: { label: 'Cancelado', className: 'bg-orange-100 text-orange-600' },
};

const ARCHIVED_STATUSES = ['resolved', 'rejected', 'cancelled'];

const FILTERS = [
  { key: 'all', label: 'Activos', statuses: null },
  { key: 'candidate', label: 'Candidatos', statuses: ['candidate'] },
  { key: 'processing', label: 'En revisión', statuses: ['processing'] },
  { key: 'open', label: 'Abiertos', statuses: ['open'] },
  { key: 'archived', label: 'Archivados', statuses: ARCHIVED_STATUSES },
];

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 7
      ? 'bg-green-100 text-green-700'
      : score >= 4
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-gray-100 text-gray-500';
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-mono shrink-0 ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

export default function MercadosPage() {
  const router = useRouter();
  const [markets, setMarkets] = useState<MarketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'score' | 'date'>('score');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch('/api/monitoring/activity');
      if (res.ok) {
        const json = await res.json();
        setMarkets(json.markets ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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
  const baseFiltered = activeFilter.statuses
    ? markets.filter((m) => activeFilter.statuses!.includes(m.status))
    : markets.filter((m) => !ARCHIVED_STATUSES.includes(m.status));

  // Sort
  const filtered = [...baseFiltered].sort((a, b) => {
    if (sortBy === 'score') return (b.score ?? 0) - (a.score ?? 0);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

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
  const selectedRejectable = markets.filter((m) => selectedIds.has(m.id) && ['candidate', 'open'].includes(m.status));

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
        <h1 className="text-2xl font-bold">Mercados</h1>
        {selectableMarkets.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="rounded border-gray-300"
            />
            Seleccionar todos
          </label>
        )}
      </div>

      {/* Status filters */}
      {markets.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => {
            const count = filterCounts[f.key];
            if (f.key !== 'all' && count === 0) return null;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(filter === f.key ? 'all' : f.key)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                  filter === f.key
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                }`}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Sort controls */}
      {markets.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Ordenar:</span>
          {([['score', 'Score'], ['date', 'Recientes']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors cursor-pointer ${
                sortBy === key
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <span className="text-sm text-blue-700 font-medium">
            {selectedIds.size} mercado{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleBulkReject}
              disabled={bulkLoading || selectedRejectable.length === 0}
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors cursor-pointer"
            >
              {bulkLoading ? '...' : `Rechazar ${selectedRejectable.length}`}
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">Cargando...</div>}

      {!loading && markets.length === 0 && (
        <div className="text-sm text-gray-500">No hay mercados</div>
      )}

      <div className="grid gap-1">
        {filtered.map((m) => {
          const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE.candidate;
          const isArchived = ARCHIVED_STATUSES.includes(m.status);
          const isRejectable = ['candidate', 'open'].includes(m.status);
          const isSelected = selectedIds.has(m.id);

          return (
            <div
              key={m.id}
              onClick={() => router.push(`/dashboard/markets/${m.id}`)}
              className={`bg-white border rounded-lg cursor-pointer hover:border-gray-400 transition-colors ${
                isSelected
                  ? 'border-blue-400 ring-1 ring-blue-200'
                  : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                {!isArchived ? (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(m.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-gray-300 shrink-0"
                  />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                  {badge.label}
                </span>
                {m.score != null && <ScoreBadge score={m.score} />}
                <span className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">
                  {m.title}
                </span>
                <span className="text-xs text-gray-400 shrink-0">{m.category}</span>
                {m.stale && (
                  <span className="text-[10px] text-orange-500 shrink-0">stale</span>
                )}
                <div className="ml-auto flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {isRejectable && (
                    <button
                      onClick={() => handleReject(m.id)}
                      disabled={actionLoading === m.id || bulkLoading}
                      className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {actionLoading === m.id ? '...' : 'Rechazar'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
