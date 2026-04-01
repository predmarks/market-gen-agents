'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePageContext } from '@/app/_components/PageContext';
import { SourcingTrigger, SourcingLog, useSourcingData } from '../monitoring/_components/SourcingPanel';
import { SearchInput } from '@/app/dashboard/_components/SearchInput';

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

interface Counts {
  bySource: Record<string, number>;
  byType: Record<string, number>;
  byCategory: Record<string, number>;
  total: number;
}

const PAGE_SIZE = 100;

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

const CATEGORIES = ['Política', 'Economía', 'Deportes', 'Entretenimiento', 'Clima', 'Otros'];

export default function SignalsPage() {
  const { runs, loading: runsLoading, triggering, hasRunning, runningStep, handleTrigger } = useSourcingData();
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const prevHasRunning = useRef(hasRunning);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const buildUrl = useCallback((offset: number) => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (sourceFilter) params.set('source', sourceFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (typeFilter) params.set('type', typeFilter);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    return `/api/signals?${params}`;
  }, [debouncedQuery, sourceFilter, categoryFilter, typeFilter]);

  const fetchSignals = useCallback(async (append = false) => {
    const offset = append ? signals.length : 0;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const res = await fetch(buildUrl(offset));
      if (res.ok) {
        const data = await res.json();
        setSignals(prev => append ? [...prev, ...(data.signals ?? [])] : (data.signals ?? []));
        setTotal(data.total ?? 0);
        if (data.counts) setCounts(data.counts);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildUrl, signals.length]);

  // Fetch on filter/search change (reset)
  useEffect(() => {
    setSignals([]);
    setLoading(true);
    const offset = 0;
    const url = buildUrl(offset);
    fetch(url)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setSignals(data.signals ?? []);
          setTotal(data.total ?? 0);
          if (data.counts) setCounts(data.counts);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [debouncedQuery, sourceFilter, categoryFilter, typeFilter, buildUrl]);

  // Refetch when ingestion completes
  useEffect(() => {
    if (prevHasRunning.current && !hasRunning) {
      fetchSignals();
    }
    prevHasRunning.current = hasRunning;
  }, [hasRunning, fetchSignals]);

  const hasMore = signals.length < total;

  // Source counts from global counts
  const sources = counts
    ? Object.entries(counts.bySource).sort(([, a], [, b]) => b - a)
    : [];
  const typeCounts = counts?.byType ?? {};
  const categoryCounts = counts?.byCategory ?? {};

  // Push visible data to MiniChat context
  const { setPageData } = usePageContext();
  const pageContent = useMemo(
    () => signals.map((s, i) => `${i + 1}. [${s.id}] ${s.type} | ${s.text.slice(0, 120)} | ${s.source} | ${s.category}`).join('\n'),
    [signals],
  );
  useEffect(() => {
    setPageData({ label: `Señales (${signals.length}/${total})`, content: pageContent });
    return () => setPageData(null);
  }, [pageContent, signals.length, total, setPageData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Señales {counts && <span className="text-sm font-normal text-gray-400">({counts.total.toLocaleString()})</span>}</h1>
        <SourcingTrigger
          triggering={triggering}
          hasRunning={hasRunning}
          runningStep={runningStep}
          onTrigger={handleTrigger}
        />
      </div>

      {/* Source filters */}
      {sources.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSourceFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              sourceFilter === null
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            Todos ({counts?.total ?? 0})
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

      <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Buscar por texto, resumen o fuente..." />

      {/* Type filters */}
      {Object.keys(typeCounts).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setTypeFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              typeFilter === null
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            Todos tipos ({counts?.total ?? 0})
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
      {Object.keys(categoryCounts).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              categoryFilter === null
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            Todas ({counts?.total ?? 0})
          </button>
          {CATEGORIES.map((cat) => {
            const catCount = categoryCounts[cat] ?? 0;
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
      {loading && <div className="text-sm text-gray-500">Cargando señales...</div>}

      {!loading && signals.length === 0 && (
        <div className="text-sm text-gray-500">
          {debouncedQuery ? 'Sin resultados para la búsqueda' : 'No hay señales ingresadas'}
        </div>
      )}

      {signals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-50">
          {signals.map((s) => {
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

      {/* Load more */}
      {hasMore && !loading && (
        <div className="flex justify-center">
          <button
            onClick={() => fetchSignals(true)}
            disabled={loadingMore}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
          >
            {loadingMore ? 'Cargando...' : `Cargar más (${signals.length} de ${total.toLocaleString()})`}
          </button>
        </div>
      )}

      {/* Ingestion log */}
      <div className="pt-4 border-t border-gray-200">
        <SourcingLog runs={runs} loading={runsLoading} />
      </div>
    </div>
  );
}
