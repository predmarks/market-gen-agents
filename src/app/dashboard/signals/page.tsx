'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePageContext } from '@/app/_components/PageContext';
import { SourcingTrigger, SourcingLog, useSourcingData } from '../monitoring/_components/SourcingPanel';
import { SearchInput } from '@/app/dashboard/_components/SearchInput';
import { FilterCombobox, type FilterGroup, type ActiveFilter } from '@/app/dashboard/_components/FilterCombobox';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

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
  news: { label: 'Noticia', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  data: { label: 'Dato', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  social: { label: 'Social', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  event: { label: 'Evento', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
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

  // Build filter combobox data
  const filterGroups: FilterGroup[] = useMemo(() => {
    const groups: FilterGroup[] = [];
    if (sources.length > 0) {
      groups.push({
        key: 'source',
        label: 'Fuente',
        options: sources.map(([source, count]) => ({ value: source, label: source, count })),
      });
    }
    const typeEntries = Object.entries(TYPE_BADGE)
      .map(([type, badge]) => ({ value: type, label: badge.label, count: typeCounts[type] ?? 0 }))
      .filter(o => o.count > 0);
    if (typeEntries.length > 0) {
      groups.push({ key: 'type', label: 'Tipo', options: typeEntries });
    }
    const catEntries = CATEGORIES
      .map(cat => ({ value: cat, label: cat, count: categoryCounts[cat] ?? 0 }))
      .filter(o => o.count > 0);
    if (catEntries.length > 0) {
      groups.push({ key: 'category', label: 'Categoría', options: catEntries });
    }
    return groups;
  }, [sources, typeCounts, categoryCounts]);

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const filters: ActiveFilter[] = [];
    if (sourceFilter) filters.push({ group: 'source', value: sourceFilter, label: sourceFilter });
    if (typeFilter) filters.push({ group: 'type', value: typeFilter, label: TYPE_BADGE[typeFilter]?.label ?? typeFilter });
    if (categoryFilter) filters.push({ group: 'category', value: categoryFilter, label: categoryFilter });
    return filters;
  }, [sourceFilter, typeFilter, categoryFilter]);

  const handleFilterSelect = useCallback((group: string, value: string) => {
    if (group === 'source') setSourceFilter(prev => prev === value ? null : value);
    else if (group === 'type') setTypeFilter(prev => prev === value ? null : value);
    else if (group === 'category') setCategoryFilter(prev => prev === value ? null : value);
  }, []);

  const handleFilterRemove = useCallback((group: string) => {
    if (group === 'source') setSourceFilter(null);
    else if (group === 'type') setTypeFilter(null);
    else if (group === 'category') setCategoryFilter(null);
  }, []);

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
        <h1 className="text-2xl font-bold">Señales {counts && <span className="text-sm font-normal text-muted-foreground">({counts.total.toLocaleString()})</span>}</h1>
        <SourcingTrigger
          triggering={triggering}
          hasRunning={hasRunning}
          runningStep={runningStep}
          onTrigger={handleTrigger}
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Buscar por texto, resumen o fuente..." />
        </div>
        <div className="flex-1">
          <FilterCombobox
            groups={filterGroups}
            active={activeFilters}
            onSelect={handleFilterSelect}
            onRemove={handleFilterRemove}
            placeholder="Filtrar por fuente, tipo o categoría..."
          />
        </div>
      </div>

      {/* Signal list */}
      {loading && <div className="text-sm text-muted-foreground">Cargando señales...</div>}

      {!loading && signals.length === 0 && (
        <div className="text-sm text-muted-foreground">
          {debouncedQuery ? 'Sin resultados para la búsqueda' : 'No hay señales ingresadas'}
        </div>
      )}

      {signals.length > 0 && (
        <Card className="divide-y divide-border">
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
                        s.score >= 7 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                        s.score >= 4 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                        'bg-muted text-muted-foreground'
                      }`}
                      title={s.scoreReason ?? undefined}
                    >
                      {s.score.toFixed(1)}
                    </span>
                  )}
                  <span className="hidden md:inline shrink-0 text-muted-foreground mt-0.5">{s.source}</span>
                  <span className="hidden md:inline shrink-0 text-muted-foreground/50 mt-0.5">{formatDate(s.publishedAt)}</span>
                  <div className="min-w-0 flex-1 mt-0.5">
                    <span className="text-foreground/80">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline">
                          {s.text}
                        </a>
                      ) : s.text}
                    </span>
                    {s.dataPoints && s.dataPoints.length > 0 && (
                      <span className="text-muted-foreground ml-1">
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
                        s.score >= 7 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                        s.score >= 4 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                        'bg-muted text-muted-foreground'
                      }`}
                      title={s.scoreReason ?? undefined}
                    >
                      {s.score.toFixed(1)}
                    </span>
                  )}
                  <span className="shrink-0 text-muted-foreground">{s.source}</span>
                  <span className="shrink-0 text-muted-foreground/50">{formatDate(s.publishedAt)}</span>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <div className="flex justify-center">
          <Button
            onClick={() => fetchSignals(true)}
            disabled={loadingMore}
            variant="outline"
            className="cursor-pointer"
          >
            {loadingMore ? 'Cargando...' : `Cargar más (${signals.length} de ${total.toLocaleString()})`}
          </Button>
        </div>
      )}

      {/* Ingestion log */}
      <div className="pt-4">
        <Separator className="mb-4" />
        <SourcingLog runs={runs} loading={runsLoading} />
      </div>
    </div>
  );
}
