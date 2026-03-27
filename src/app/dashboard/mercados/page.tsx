'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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
  proposal: { label: 'Propuesta', className: 'bg-purple-100 text-purple-700' },
  approved: { label: 'Aprobado', className: 'bg-green-100 text-green-700' },
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
  { key: 'proposal', label: 'Propuestas', statuses: ['proposal'] },
  { key: 'open', label: 'Abiertos', statuses: ['approved', 'open'] },
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
    <span className={`px-1 py-0.5 rounded text-[10px] font-mono shrink-0 ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

export default function MercadosPage() {
  const [markets, setMarkets] = useState<MarketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
  const filtered = activeFilter.statuses
    ? markets.filter((m) => activeFilter.statuses!.includes(m.status))
    : markets.filter((m) => !ARCHIVED_STATUSES.includes(m.status));

  async function handleApprove(id: string) {
    setActionLoading(id);
    try {
      await fetch(`/api/markets/${id}/approve`, { method: 'POST' });
      fetchAll();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: string) {
    setActionLoading(id);
    try {
      await fetch(`/api/markets/${id}/reject`, { method: 'POST' });
      fetchAll();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-4 p-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Mercados</h1>

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

      {loading && <div className="text-sm text-gray-500">Cargando...</div>}

      {!loading && markets.length === 0 && (
        <div className="text-sm text-gray-500">No hay mercados</div>
      )}

      {filtered.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-50">
          {filtered.map((m) => {
            const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE.candidate;
            return (
              <div key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>
                  {badge.label}
                </span>
                {m.score != null && <ScoreBadge score={m.score} />}
                <Link
                  href={`/dashboard/markets/${m.id}`}
                  className="text-gray-800 hover:text-blue-600 truncate flex-1 min-w-0"
                >
                  {m.title}
                </Link>
                <span className="text-[10px] text-gray-400 shrink-0">{m.category}</span>
                {m.stale && (
                  <span className="text-[10px] text-orange-500 shrink-0">stale</span>
                )}
                {m.status === 'proposal' && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleApprove(m.id)}
                      disabled={actionLoading === m.id}
                      className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {actionLoading === m.id ? '...' : 'Aprobar'}
                    </button>
                    <button
                      onClick={() => handleReject(m.id)}
                      disabled={actionLoading === m.id}
                      className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {actionLoading === m.id ? '...' : 'Rechazar'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
