'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { usePageContext } from '@/app/_components/PageContext';
import { SearchInput } from '@/app/dashboard/_components/SearchInput';
import { strip } from '@/lib/strip-diacritics';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface TopicData {
  id: string;
  name: string;
  slug: string;
  summary: string;
  suggestedAngles: string[];
  category: string;
  score: number;
  status: string;
  signalCount: number;
  lastSignalAt: string | null;
  lastGeneratedAt: string | null;
  updatedAt: string;
  marketCount?: number;
}

const RESEARCH_STALE_MS = 10 * 60 * 1000; // 10 minutes

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr));
}

export default function TopicsPage() {

  const [topics, setTopics] = useState<TopicData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [dismissPromptId, setDismissPromptId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTopics = useCallback(async () => {
    try {
      const res = await fetch('/api/topics');
      if (res.ok) {
        const data = await res.json();
        setTopics(data.topics ?? []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchTopics().finally(() => setLoading(false));
  }, [fetchTopics]);

  // Poll every 5s while any topic is researching
  useEffect(() => {
    const hasResearching = topics.some((t) => t.status === 'researching');
    if (hasResearching && !pollRef.current) {
      pollRef.current = setInterval(fetchTopics, 5000);
    } else if (!hasResearching && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [topics, fetchTopics]);

  function openDismissPrompt(topicId: string) {
    setDismissPromptId(topicId);
    setDismissReason('');
  }

  async function handleDismiss() {
    if (!dismissPromptId || !dismissReason.trim()) return;
    const topicId = dismissPromptId;
    setDismissing(topicId);
    setDismissPromptId(null);
    try {
      const res = await fetch(`/api/topics/${topicId}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: dismissReason.trim() }),
      });
      if (res.ok) {
        setTopics((prev) => prev.filter((t) => t.id !== topicId));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(topicId);
          return next;
        });
      }
    } catch {
      // ignore
    } finally {
      setDismissing(null);
      setDismissReason('');
    }
  }

  function toggleSelect(topicId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  }

  async function cancelResearch(topicId: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fetch(`/api/topics/${topicId}/cancel-research`, { method: 'POST' });
      fetchTopics();
    } catch { /* ignore */ }
  }

  const selectableTopics = topics.filter((t) => t.status !== 'researching');

  function toggleSelectAll() {
    if (selectedIds.size === selectableTopics.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableTopics.map((t) => t.id)));
    }
  }

  async function handleBulkDismiss() {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/topics/${id}/dismiss`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Descartado en lote' }),
          })
        )
      );
      setTopics((prev) => prev.filter((t) => !selectedIds.has(t.id)));
      setSelectedIds(new Set());
    } catch {
      // ignore
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkIngest() {
    setBulkLoading(true);
    try {
      await fetch('/api/sourcing', { method: 'POST' });
      setSelectedIds(new Set());
    } catch {
      // ignore
    } finally {
      setBulkLoading(false);
    }
  }

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpand(topicId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  }

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<'all' | 'with' | 'without'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'recency' | 'signals' | 'markets'>('score');
  const [searchQuery, setSearchQuery] = useState('');

  const CATEGORIES = ['Política', 'Economía', 'Deportes', 'Entretenimiento', 'Clima', 'Otros'];

  const filteredTopics = topics
    .filter((t) => {
      if (categoryFilter && t.category !== categoryFilter && t.status !== 'researching') return false;
      if (marketFilter === 'with' && !(t.marketCount && t.marketCount > 0)) return false;
      if (marketFilter === 'without' && t.marketCount && t.marketCount > 0) return false;
      if (searchQuery) {
        const q = strip(searchQuery);
        if (!strip(t.name).includes(q) && !strip(t.summary).includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.status === 'researching') return -1;
      if (b.status === 'researching') return 1;
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'signals') return b.signalCount - a.signalCount;
      if (sortBy === 'markets') return (b.marketCount ?? 0) - (a.marketCount ?? 0);
      // recency
      const aTime = a.lastSignalAt ? new Date(a.lastSignalAt).getTime() : 0;
      const bTime = b.lastSignalAt ? new Date(b.lastSignalAt).getTime() : 0;
      return bTime - aTime;
    });

  // Push visible data to MiniChat context
  const { setPageData } = usePageContext();
  const pageContent = useMemo(() => filteredTopics.map((t, i) => `${i + 1}. [${t.id}] ${t.name} | ${t.category} | score:${t.score} | ${t.signalCount} señales | ${t.status}`).join('\n'), [filteredTopics]);
  useEffect(() => {
    setPageData({ label: `Temas (${filteredTopics.length})`, content: pageContent });
    return () => setPageData(null);
  }, [pageContent, filteredTopics.length, setPageData]);

  const categoryCounts = CATEGORIES.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = topics.filter((t) => t.category === cat && t.status !== 'researching').length;
    return acc;
  }, {});

  const allSelected = selectableTopics.length > 0 && selectedIds.size === selectableTopics.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Temas</h1>
          <Link href="/dashboard/topics/dedup" className="text-xs px-2 py-1 rounded-full border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30">
            Revisar duplicados
          </Link>
        </div>
        {topics.length > 0 && (
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

      {/* Category filters */}
      {topics.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={() => setCategoryFilter(null)}
            variant={categoryFilter === null ? 'default' : 'outline'}
            size="xs"
            className="rounded-full cursor-pointer"
          >
            Todos ({topics.filter((t) => t.status !== 'researching').length})
          </Button>
          {CATEGORIES.map((cat) => {
            const count = categoryCounts[cat];
            if (count === 0) return null;
            return (
              <Button
                key={cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                variant={categoryFilter === cat ? 'default' : 'outline'}
                size="xs"
                className="rounded-full cursor-pointer"
              >
                {cat} ({count})
              </Button>
            );
          })}
        </div>
      )}

      <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Buscar por nombre o resumen..." />

      {/* Sort controls */}
      {topics.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground/60">Ordenar:</span>
          {([['score', 'Score'], ['signals', 'Señales'], ['markets', 'Mercados'], ['recency', 'Recientes']] as const).map(([key, label]) => (
            <Button
              key={key}
              onClick={() => setSortBy(key)}
              variant={sortBy === key ? 'default' : 'outline'}
              size="xs"
              className="cursor-pointer"
            >
              {label}
            </Button>
          ))}
          <span className="text-xs text-muted-foreground/50 mx-1">|</span>
          {([['all', 'Todos'], ['with', 'Con mercados'], ['without', 'Sin mercados']] as const).map(([key, label]) => (
            <Button
              key={key}
              onClick={() => setMarketFilter(key)}
              variant={marketFilter === key ? 'default' : 'outline'}
              size="xs"
              className="cursor-pointer"
            >
              {label}
            </Button>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3">
          <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
            {selectedIds.size} tema{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              onClick={handleBulkIngest}
              disabled={bulkLoading}
              size="sm"
              className="cursor-pointer"
            >
              {bulkLoading ? '...' : 'Buscar señales'}
            </Button>
            <Button
              onClick={handleBulkDismiss}
              disabled={bulkLoading}
              variant="destructive"
              size="sm"
              className="cursor-pointer"
            >
              {bulkLoading ? '...' : 'Descartar seleccionados'}
            </Button>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-sm text-muted-foreground">Cargando...</div>
      )}

      {!loading && topics.length === 0 && (
        <div className="text-sm text-muted-foreground">No hay temas activos</div>
      )}

      <div className="grid gap-1">
        {filteredTopics.map((t) => {
          const isResearching = t.status === 'researching';
          const isRegular = t.status === 'regular';
          const hasNewInfo = t.lastSignalAt && t.lastGeneratedAt && t.lastSignalAt > t.lastGeneratedAt;
          const isStale = t.status === 'stale';
          const isSelected = selectedIds.has(t.id);
          const isExpanded = expandedIds.has(t.id);

          return (
            <Link
              key={t.id}
              href={`/dashboard/topics/${t.slug}`}
              onClick={isResearching ? (e: React.MouseEvent) => e.preventDefault() : undefined}
              className={`block bg-card border rounded-lg ${!isResearching ? 'cursor-pointer hover:border-foreground/20 transition-colors' : ''} ${
                isResearching
                  ? 'border-purple-300 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10'
                  : isSelected
                  ? 'border-blue-400 dark:border-blue-600 ring-1 ring-blue-200 dark:ring-blue-800'
                  : isStale
                  ? 'border-border bg-muted'
                  : 'border-border'
              }`}
            >
              {/* Header row — always visible */}
              <div className="flex items-center gap-2 px-3 pt-2 pb-1 md:pb-2">
                {isResearching ? (
                  <span className="w-4 h-4 flex items-center justify-center shrink-0">
                    <span className="block w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(t.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-border shrink-0"
                  />
                )}
                {!isResearching && (
                  <span
                    className={`hidden md:inline px-1.5 py-0.5 rounded text-xs font-mono shrink-0 ${
                      t.score >= 7
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : t.score >= 4
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {t.score.toFixed(1)}
                  </span>
                )}
                <span
                  className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${
                    isResearching
                      ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300 animate-pulse'
                      : isRegular
                      ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                      : isStale
                      ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300'
                      : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300'
                  }`}
                >
                  {isResearching ? 'investigando...' : isRegular ? 'recurrente' : isStale ? 'inactivo' : 'activo'}
                </span>
                {isResearching && t.updatedAt && Date.now() - new Date(t.updatedAt).getTime() > RESEARCH_STALE_MS && (
                  <button
                    onClick={(e) => cancelResearch(t.id, e)}
                    className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 shrink-0 cursor-pointer"
                  >
                    Cancelar
                  </button>
                )}
                <span className={`text-sm truncate flex-1 min-w-0 ${isResearching ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>{t.name}</span>
                {hasNewInfo && !isResearching && (
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 shrink-0">
                    nueva info
                  </span>
                )}
                {!isResearching && (
                  <>
                    <span className="hidden md:inline text-xs text-muted-foreground/60 shrink-0">{t.category}</span>
                    <span className={`hidden md:inline text-[10px] shrink-0 px-1 py-0.5 rounded ${
                      t.signalCount >= 50 ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
                      t.signalCount >= 20 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      t.signalCount >= 10 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                      t.signalCount >= 5 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                      'text-muted-foreground/50'
                    }`}>{t.signalCount} señales</span>
                    {(t.marketCount ?? 0) > 0 && (
                      <span className="hidden md:inline shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">{t.marketCount} mercado{t.marketCount !== 1 ? 's' : ''}</span>
                    )}
                  </>
                )}
                <div className="ml-auto flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!isResearching && (
                    <button
                      onClick={() => openDismissPrompt(t.id)}
                      disabled={dismissing === t.id}
                      className="hidden md:inline text-xs text-muted-foreground hover:text-destructive disabled:opacity-50 cursor-pointer"
                      title="Descartar tema"
                    >
                      {dismissing === t.id ? '...' : 'descartar'}
                    </button>
                  )}
                  {!isResearching && (
                    <button
                      onClick={() => toggleExpand(t.id)}
                      className="text-[10px] text-muted-foreground hover:text-foreground w-5 h-5 flex items-center justify-center cursor-pointer"
                      title={isExpanded ? 'Colapsar' : 'Expandir'}
                    >
                      {isExpanded ? '\u25B2' : '\u25BC'}
                    </button>
                  )}
                </div>
              </div>
              {/* Secondary row: metadata (mobile only) */}
              {!isResearching && (
                <div className="flex md:hidden items-center gap-2 px-3 pb-2 pl-9 flex-wrap">
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-mono shrink-0 ${
                      t.score >= 7
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : t.score >= 4
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {t.score.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground/60 shrink-0">{t.category}</span>
                  <span className={`text-[10px] shrink-0 px-1 py-0.5 rounded ${
                    t.signalCount >= 50 ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
                    t.signalCount >= 20 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                    t.signalCount >= 10 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                    t.signalCount >= 5 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                    'text-muted-foreground/50'
                  }`}>{t.signalCount} señales</span>
                  {(t.marketCount ?? 0) > 0 && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">{t.marketCount} mercado{t.marketCount !== 1 ? 's' : ''}</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); openDismissPrompt(t.id); }}
                    disabled={dismissing === t.id}
                    className="ml-auto text-xs text-muted-foreground hover:text-destructive disabled:opacity-50 cursor-pointer"
                    title="Descartar tema"
                  >
                    {dismissing === t.id ? '...' : 'descartar'}
                  </button>
                </div>
              )}

              {/* Expanded content */}
              {isResearching && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                </div>
              )}

              {!isResearching && isExpanded && (
                <div className="px-3 pb-3 border-t border-border pt-2">
                  <p className="text-sm text-muted-foreground mb-3">{t.summary}</p>

                  {t.suggestedAngles.length > 0 && (
                    <ul className="space-y-1 mb-3">
                      {t.suggestedAngles.map((angle, i) => (
                        <li key={i} className="text-sm text-blue-600 dark:text-blue-400">
                          {'\u2192'} {angle}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                    <span>{t.signalCount} señales</span>
                    {(t.marketCount ?? 0) > 0 && (
                      <span>{t.marketCount} mercado{t.marketCount !== 1 ? 's' : ''}</span>
                    )}
                    {t.lastSignalAt && (
                      <span>última: {formatDate(t.lastSignalAt)}</span>
                    )}
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {/* Dismiss reason modal */}
      {dismissPromptId && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-lg p-5 w-full max-w-md mx-4 ring-1 ring-foreground/10">
            <h3 className="text-sm font-semibold text-foreground mb-3">Motivo del descarte</h3>
            <textarea
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="¿Por qué descartás este tema?"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:ring-1 focus:ring-ring outline-none resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button
                onClick={() => setDismissPromptId(null)}
                variant="ghost"
                size="sm"
                className="cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleDismiss}
                disabled={!dismissReason.trim()}
                variant="destructive"
                size="sm"
                className="cursor-pointer"
              >
                Descartar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
