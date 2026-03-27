'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface MarketMonitorEntry {
  id: string;
  title: string;
  status: string;
  category: string;
  createdAt: string;
  iterationCount: number;
  score: number | null;
  currentStep: string | null;
  stepTimestamp: string | null;
  completedAt: string | null;
  stale: boolean;
}

const STEP_LABELS: Record<string, string> = {
  pipeline_started: 'Iniciado',
  pipeline_resumed: 'Reanudado',
  data_verified: 'Datos verificados',
  rules_checked: 'Reglas verificadas',
  scored: 'Puntuando',
  improved: 'Mejorando',
  pipeline_opened: 'Abierto',
  pipeline_rejected: 'Rechazado',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  candidate: { label: 'Candidato', color: 'text-gray-600', dot: 'bg-gray-400' },
  processing: { label: 'Revisando', color: 'text-amber-600', dot: 'bg-amber-500 animate-pulse' },
  open: { label: 'Abierto', color: 'text-emerald-600', dot: 'bg-emerald-500' },
  rejected: { label: 'Rechazado', color: 'text-red-600', dot: 'bg-red-500' },
  cancelled: { label: 'Cancelado', color: 'text-orange-600', dot: 'bg-orange-500' },
  resolved: { label: 'Resuelto', color: 'text-gray-500', dot: 'bg-gray-400' },
};

const FILTER_CARDS = [
  { key: 'review', label: 'En revisión', color: 'text-amber-600', border: 'border-amber-300', bg: 'bg-amber-50' },
  { key: 'open', label: 'Abiertos', color: 'text-emerald-600', border: 'border-emerald-300', bg: 'bg-emerald-50' },
  { key: 'rejected', label: 'Rechazados', color: 'text-red-600', border: 'border-red-300', bg: 'bg-red-50' },
  { key: 'cancelled', label: 'Cancelados', color: 'text-orange-600', border: 'border-orange-300', bg: 'bg-orange-50' },
];

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function parseStep(currentStep: string | null): { type: string; iteration: number | null } {
  if (!currentStep) return { type: '', iteration: null };
  const [type, iterStr] = currentStep.split(':');
  return { type, iteration: iterStr ? parseInt(iterStr, 10) : null };
}

function MarketDetail({ market }: { market: MarketMonitorEntry }) {
  const config = STATUS_CONFIG[market.status] ?? STATUS_CONFIG.candidate;

  if (market.status === 'processing') {
    if (market.stale) {
      return <span className="text-xs text-red-500">Estancado</span>;
    }
    const { type, iteration } = parseStep(market.currentStep);
    const stepLabel = STEP_LABELS[type] || type;
    return (
      <span className="text-xs text-gray-500">
        {stepLabel}
        {iteration && iteration > 1 ? ` (iteración ${iteration})` : ''}
      </span>
    );
  }

  if (market.status === 'rejected') {
    return (
      <span className={`text-xs ${config.color}`}>
        {market.score != null && market.score > 0 ? `Score ${market.score.toFixed(1)}` : ''}
        {market.iterationCount > 0 ? ` · ${market.iterationCount} iteraciones` : ''}
      </span>
    );
  }

  if (market.status === 'cancelled' && market.iterationCount > 0) {
    return <span className="text-xs text-orange-500">{market.iterationCount} iteraciones</span>;
  }

  if (market.status === 'candidate' && market.iterationCount > 0) {
    return <span className="text-xs text-gray-400">{market.iterationCount} iteraciones previas</span>;
  }

  if (market.iterationCount > 0) {
    return <span className="text-xs text-gray-400">{market.iterationCount} iteraciones</span>;
  }

  return null;
}

function ActionButton({
  label,
  onClick,
  variant,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  variant: 'cancel' | 'resume' | 'review' | 'reject';
}) {
  const styles = {
    cancel: 'text-red-600 hover:bg-red-50',
    resume: 'text-blue-600 hover:bg-blue-50',
    review: 'text-blue-600 hover:bg-blue-50',
    reject: 'text-red-600 hover:bg-red-50',
  };

  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 text-xs font-medium rounded transition-colors shrink-0 ${styles[variant]}`}
    >
      {label}
    </button>
  );
}

function MarketRow({
  market,
  now,
  selected,
  onSelect,
  onAction,
}: {
  market: MarketMonitorEntry;
  now: number;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onAction: (id: string, action: 'cancel' | 'resume' | 'review' | 'reject') => void;
}) {
  const config = STATUS_CONFIG[market.status] ?? STATUS_CONFIG.candidate;
  const isLive = market.status === 'processing' && !market.stale;
  const startTime = new Date(market.createdAt).getTime();
  const endTime = market.completedAt
    ? new Date(market.completedAt).getTime()
    : market.stepTimestamp
      ? new Date(market.stepTimestamp).getTime()
      : now;
  const elapsed = isLive ? now - startTime : endTime - startTime;
  const isCandidate = market.status === 'candidate';

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
      {/* Checkbox for candidates */}
      {isCandidate ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(market.id, e.target.checked)}
          className="w-3.5 h-3.5 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      ) : (
        <span className={`w-2 h-2 rounded-full shrink-0 ${config.dot} ml-0.5`} />
      )}

      {/* Title + detail (linked) */}
      <Link href={`/dashboard/markets/${market.id}`} className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 truncate">{market.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
          <MarketDetail market={market} />
        </div>
      </Link>

      {/* Actions */}
      {isCandidate && (
        <>
          <ActionButton
            label="Revisar"
            onClick={(e) => { e.preventDefault(); onAction(market.id, 'review'); }}
            variant="review"
          />
          <ActionButton
            label="Descartar"
            onClick={(e) => { e.preventDefault(); onAction(market.id, 'reject'); }}
            variant="reject"
          />
        </>
      )}
      {market.status === 'processing' && !market.stale && (
        <ActionButton
          label="Cancelar"
          onClick={(e) => { e.preventDefault(); onAction(market.id, 'cancel'); }}
          variant="cancel"
        />
      )}
      {(market.status === 'cancelled' || (market.status === 'processing' && market.stale)) && (
        <ActionButton
          label="Reanudar"
          onClick={(e) => { e.preventDefault(); onAction(market.id, 'resume'); }}
          variant="resume"
        />
      )}

      {/* Elapsed — live for processing, frozen for completed */}
      <span className={`text-xs font-mono shrink-0 w-16 text-right ${isLive ? 'text-amber-600' : 'text-gray-400'}`}>
        {formatElapsed(elapsed)}
      </span>

      {/* Category */}
      <span className="text-xs text-gray-400 shrink-0 w-24 text-right">{market.category}</span>
    </div>
  );
}

export function MonitoringDashboard() {
  const [markets, setMarkets] = useState<MarketMonitorEntry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const fetchData = useCallback(async (filter: string | null) => {
    try {
      let url = '/api/monitoring/activity';
      if (filter) {
        const statusParam = filter === 'review' ? 'candidate,processing' : filter;
        url += `?status=${statusParam}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setMarkets(data.markets);
        setCounts(data.counts);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchData(activeFilter);
  }, [activeFilter, fetchData]);

  const hasProcessing = markets.some((m) => m.status === 'processing');
  const candidateIds = markets.filter((m) => m.status === 'candidate').map((m) => m.id);
  const selectedCount = [...selected].filter((id) => candidateIds.includes(id)).length;
  const allCandidatesSelected = candidateIds.length > 0 && candidateIds.every((id) => selected.has(id));

  // Poll
  useEffect(() => {
    const interval = setInterval(() => fetchData(activeFilter), hasProcessing ? 5000 : 30000);
    return () => clearInterval(interval);
  }, [hasProcessing, activeFilter, fetchData]);

  // Timer tick
  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasProcessing]);

  function handleFilterClick(key: string) {
    setActiveFilter((prev) => (prev === key ? null : key));
    setSelected(new Set());
  }

  function handleSelect(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleSelectAll() {
    if (allCandidatesSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(candidateIds));
    }
  }

  async function handleAction(marketId: string, action: 'cancel' | 'resume' | 'review' | 'reject') {
    if (action === 'reject') {
      const reason = prompt('Motivo del descarte (opcional):');
      if (reason === null) return; // cancelled
      try {
        const res = await fetch(`/api/markets/${marketId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, source: 'triage' }),
        });
        if (res.ok) {
          setSelected((prev) => { const next = new Set(prev); next.delete(marketId); return next; });
          fetchData(activeFilter);
        }
      } catch { /* ignore */ }
      return;
    }

    try {
      const url = action === 'review'
        ? `/api/review/${marketId}`
        : `/api/markets/${marketId}/${action}`;
      const res = await fetch(url, { method: 'POST' });
      if (res.ok) {
        setSelected((prev) => { const next = new Set(prev); next.delete(marketId); return next; });
        fetchData(activeFilter);
      }
    } catch {
      // ignore
    }
  }

  async function handleBulkAction(action: 'review' | 'reject') {
    const ids = [...selected].filter((id) => candidateIds.includes(id));
    if (ids.length === 0) return;

    let reason = '';
    if (action === 'reject') {
      const input = prompt(`Motivo del descarte para ${ids.length} candidatos (opcional):`);
      if (input === null) return;
      reason = input;
    }

    setBulkBusy(true);
    try {
      for (const id of ids) {
        if (action === 'review') {
          await fetch(`/api/review/${id}`, { method: 'POST' });
        } else {
          await fetch(`/api/markets/${id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason, source: 'triage' }),
          });
        }
      }
      setSelected(new Set());
      fetchData(activeFilter);
    } catch {
      // ignore
    } finally {
      setBulkBusy(false);
    }
  }

  function getCount(key: string): number {
    if (key === 'review') return (counts['candidate'] ?? 0) + (counts['processing'] ?? 0);
    if (key === 'open') return counts['open'] ?? 0;
    return counts[key] ?? 0;
  }

  return (
    <div className="space-y-6">
      {/* Filter cards */}
      <div className="grid grid-cols-4 gap-3">
        {FILTER_CARDS.map((card) => {
          const isActive = activeFilter === card.key;
          const count = getCount(card.key);
          return (
            <button
              key={card.key}
              onClick={() => handleFilterClick(card.key)}
              className={`rounded-lg border p-3 text-left transition-all ${
                isActive
                  ? `${card.border} ${card.bg} ring-2 ${card.border}`
                  : activeFilter && !isActive
                    ? 'border-gray-100 bg-gray-50 opacity-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`text-2xl font-bold ${card.color}`}>{count}</div>
              <div className="text-xs text-gray-500">{card.label}</div>
            </button>
          );
        })}
      </div>

      {/* Bulk actions bar */}
      {candidateIds.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 rounded-lg border border-gray-200">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={allCandidatesSelected}
              onChange={handleSelectAll}
              className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {selectedCount > 0 ? `${selectedCount} seleccionados` : 'Seleccionar todos'}
          </label>
          {selectedCount > 0 && (
            <>
              <button
                onClick={() => handleBulkAction('review')}
                disabled={bulkBusy}
                className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {bulkBusy ? 'Procesando...' : `Revisar ${selectedCount}`}
              </button>
              <button
                onClick={() => handleBulkAction('reject')}
                disabled={bulkBusy}
                className="px-3 py-1 text-xs font-medium rounded text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                Descartar {selectedCount}
              </button>
            </>
          )}
        </div>
      )}

      {/* Market list */}
      {markets.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">No hay mercados{activeFilter ? ' con este estado' : ''}.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {markets.map((market) => (
            <MarketRow
              key={market.id}
              market={market}
              now={now}
              selected={selected.has(market.id)}
              onSelect={handleSelect}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
