'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePageContext } from '@/app/_components/PageContext';
import { SourcingTrigger, SourcingLog, useSourcingData } from '../monitoring/_components/SourcingPanel';

interface SignalData {
  id: string;
  type: string;
  text: string;
  summary: string | null;
  url: string | null;
  source: string;
  category: string | null;
  publishedAt: string;
  score: number | null;
  scoreReason: string | null;
  dataPoints: { metric: string; currentValue: number; previousValue?: number; unit: string }[] | null;
}

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  news: { label: 'Noticia', className: 'bg-blue-100 text-blue-700' },
  data: { label: 'Dato', className: 'bg-amber-100 text-amber-700' },
  social: { label: 'Social', className: 'bg-purple-100 text-purple-700' },
  event: { label: 'Evento', className: 'bg-green-100 text-green-700' },
};

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr));
}

export default function SignalsPage() {
  const { runs, loading: runsLoading, triggering, hasRunning, runningStep, handleTrigger } = useSourcingData();
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [loadingSignals, setLoadingSignals] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const prevHasRunning = useRef(hasRunning);

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/signals');
      if (res.ok) {
        const data = await res.json();
        setSignals(data.signals ?? []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSignals().finally(() => setLoadingSignals(false));
  }, [fetchSignals]);

  // Refetch signals when ingestion completes (hasRunning transitions true → false)
  useEffect(() => {
    if (prevHasRunning.current && !hasRunning) {
      fetchSignals();
    }
    prevHasRunning.current = hasRunning;
  }, [hasRunning, fetchSignals]);

  // Source counts
  const sourceCounts = signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.source] = (acc[s.source] ?? 0) + 1;
    return acc;
  }, {});
  const sources = Object.entries(sourceCounts).sort(([, a], [, b]) => b - a);

  const CATEGORIES = ['Política', 'Economía', 'Deportes', 'Entretenimiento', 'Clima', 'Otros'];

  const categoryCounts = CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = signals.filter((s) => s.category === cat).length;
    return acc;
  }, {});

  const typeCounts = signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.type] = (acc[s.type] ?? 0) + 1;
    return acc;
  }, {});

  const filteredSignals = signals.filter((s) => {
    if (sourceFilter && s.source !== sourceFilter) return false;
    if (categoryFilter && s.category !== categoryFilter) return false;
    if (typeFilter && s.type !== typeFilter) return false;
    return true;
  });

  // Push visible data to MiniChat context
  const { setPageData } = usePageContext();
  const pageContent = useMemo(() => filteredSignals.map((s, i) => `${i + 1}. [${s.id}] ${s.type} | ${s.text.slice(0, 120)} | ${s.source} | ${s.category}`).join('\n'), [filteredSignals]);
  useEffect(() => {
    setPageData({ label: `Señales (${filteredSignals.length})`, content: pageContent });
    return () => setPageData(null);
  }, [pageContent, filteredSignals.length, setPageData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Señales</h1>
        <SourcingTrigger
          triggering={triggering}
          hasRunning={hasRunning}
          runningStep={runningStep}
          onTrigger={handleTrigger}
        />
      </div>

      {/* Source filters */}
      {signals.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSourceFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              sourceFilter === null
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            Todos ({signals.length})
          </button>
          {sources.map(([source, count]) => (
            <button
              key={source}
              onClick={() => setSourceFilter(sourceFilter === source ? null : source)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                sourceFilter === source
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
              }`}
            >
              {source} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Type filters */}
      {signals.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setTypeFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              typeFilter === null
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            Todos tipos ({signals.length})
          </button>
          {Object.entries(TYPE_BADGE).map(([type, badge]) => {
            const count = typeCounts[type] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                  typeFilter === type
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                }`}
              >
                {badge.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Category filters */}
      {signals.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              categoryFilter === null
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            Todas ({signals.length})
          </button>
          {CATEGORIES.map((cat) => {
            const catCount = categoryCounts[cat];
            if (catCount === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                }`}
              >
                {cat} ({catCount})
              </button>
            );
          })}
        </div>
      )}

      {/* Signal list */}
      {loadingSignals && (
        <div className="text-sm text-gray-500">Cargando señales...</div>
      )}

      {!loadingSignals && signals.length === 0 && (
        <div className="text-sm text-gray-500">No hay señales ingresadas</div>
      )}

      {filteredSignals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-50">
          {filteredSignals.map((s) => {
            const badge = TYPE_BADGE[s.type] ?? TYPE_BADGE.news;
            return (
              <div key={s.id} className="px-3 py-2 text-xs">
                {/* Primary: type badge + text */}
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${badge.className}`}>
                    {badge.label}
                  </span>
                  {s.score != null && (
                    <span
                      className={`hidden md:inline shrink-0 px-1 py-0.5 rounded text-[10px] font-mono mt-0.5 ${
                        s.score >= 7 ? 'bg-green-100 text-green-700' :
                        s.score >= 4 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-500'
                      }`}
                      title={s.scoreReason ?? undefined}
                    >
                      {s.score.toFixed(1)}
                    </span>
                  )}
                  <span className="hidden md:inline shrink-0 text-gray-400 mt-0.5">{s.source}</span>
                  <span className="hidden md:inline shrink-0 text-gray-300 mt-0.5">{formatDate(s.publishedAt)}</span>
                  <div className="min-w-0 flex-1 mt-0.5">
                    <span className="text-gray-700">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">
                          {s.text}
                        </a>
                      ) : s.text}
                    </span>
                    {s.dataPoints && s.dataPoints.length > 0 && (
                      <span className="text-gray-400 ml-1">
                        {s.dataPoints.map((dp) => {
                          const prev = dp.previousValue != null ? ` (ant: ${dp.previousValue})` : '';
                          return `${dp.currentValue} ${dp.unit}${prev}`;
                        }).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                {/* Secondary: metadata (mobile only) */}
                <div className="flex md:hidden items-center gap-2 mt-1 pl-10">
                  {s.score != null && (
                    <span
                      className={`shrink-0 px-1 py-0.5 rounded text-[10px] font-mono ${
                        s.score >= 7 ? 'bg-green-100 text-green-700' :
                        s.score >= 4 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-500'
                      }`}
                      title={s.scoreReason ?? undefined}
                    >
                      {s.score.toFixed(1)}
                    </span>
                  )}
                  <span className="shrink-0 text-gray-400">{s.source}</span>
                  <span className="shrink-0 text-gray-300">{formatDate(s.publishedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ingestion log */}
      <div className="pt-4 border-t border-gray-200">
        <SourcingLog runs={runs} loading={runsLoading} />
      </div>
    </div>
  );
}
