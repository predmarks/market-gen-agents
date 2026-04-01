'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { usePageContext } from '@/app/_components/PageContext';

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

  const CATEGORIES = ['Política', 'Economía', 'Deportes', 'Entretenimiento', 'Clima', 'Otros'];

  const filteredTopics = topics
    .filter((t) => {
      if (categoryFilter && t.category !== categoryFilter && t.status !== 'researching') return false;
      if (marketFilter === 'with' && !(t.marketCount && t.marketCount > 0)) return false;
      if (marketFilter === 'without' && t.marketCount && t.marketCount > 0) return false;
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
          <Link href="/dashboard/topics/dedup" className="text-xs px-2 py-1 rounded-full border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100">
            Revisar duplicados
          </Link>
        </div>
        {topics.length > 0 && (
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

      {/* Category filters */}
      {topics.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              categoryFilter === null
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            Todos ({topics.filter((t) => t.status !== 'researching').length})
          </button>
          {CATEGORIES.map((cat) => {
            const count = categoryCounts[cat];
            if (count === 0) return null;
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
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Sort controls */}
      {topics.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Ordenar:</span>
          {([['score', 'Score'], ['signals', 'Señales'], ['markets', 'Mercados'], ['recency', 'Recientes']] as const).map(([key, label]) => (
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
          <span className="text-xs text-gray-300 mx-1">|</span>
          {([['all', 'Todos'], ['with', 'Con mercados'], ['without', 'Sin mercados']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMarketFilter(key)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors cursor-pointer ${
                marketFilter === key
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
        <div className="flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <span className="text-sm text-blue-700 font-medium">
            {selectedIds.size} tema{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handleBulkIngest}
              disabled={bulkLoading}
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors cursor-pointer"
            >
              {bulkLoading ? '...' : 'Buscar señales'}
            </button>
            <button
              onClick={handleBulkDismiss}
              disabled={bulkLoading}
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors cursor-pointer"
            >
              {bulkLoading ? '...' : 'Descartar seleccionados'}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-500">Cargando...</div>
      )}

      {!loading && topics.length === 0 && (
        <div className="text-sm text-gray-500">No hay temas activos</div>
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
              className={`block bg-white border rounded-lg ${!isResearching ? 'cursor-pointer hover:border-gray-400 transition-colors' : ''} ${
                isResearching
                  ? 'border-purple-300 bg-purple-50/30'
                  : isSelected
                  ? 'border-blue-400 ring-1 ring-blue-200'
                  : isStale
                  ? 'border-gray-200 bg-gray-50'
                  : 'border-gray-200'
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
                    className="rounded border-gray-300 shrink-0"
                  />
                )}
                {!isResearching && (
                  <span
                    className={`hidden md:inline px-1.5 py-0.5 rounded text-xs font-mono shrink-0 ${
                      t.score >= 7
                        ? 'bg-green-100 text-green-700'
                        : t.score >= 4
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {t.score.toFixed(1)}
                  </span>
                )}
                <span
                  className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${
                    isResearching
                      ? 'bg-purple-100 text-purple-600 animate-pulse'
                      : isRegular
                      ? 'bg-blue-100 text-blue-600'
                      : isStale
                      ? 'bg-orange-100 text-orange-600'
                      : 'bg-green-100 text-green-600'
                  }`}
                >
                  {isResearching ? 'investigando...' : isRegular ? 'recurrente' : isStale ? 'inactivo' : 'activo'}
                </span>
                {isResearching && t.updatedAt && Date.now() - new Date(t.updatedAt).getTime() > RESEARCH_STALE_MS && (
                  <button
                    onClick={(e) => cancelResearch(t.id, e)}
                    className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 hover:bg-red-200 text-red-600 shrink-0 cursor-pointer"
                  >
                    Cancelar
                  </button>
                )}
                <span className={`text-sm truncate flex-1 min-w-0 ${isResearching ? 'text-gray-500' : 'font-medium text-gray-800'}`}>{t.name}</span>
                {hasNewInfo && !isResearching && (
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 shrink-0">
                    nueva info
                  </span>
                )}
                {!isResearching && (
                  <>
                    <span className="hidden md:inline text-xs text-gray-400 shrink-0">{t.category}</span>
                    <span className={`hidden md:inline text-[10px] shrink-0 px-1 py-0.5 rounded ${
                      t.signalCount >= 50 ? 'bg-purple-100 text-purple-700' :
                      t.signalCount >= 20 ? 'bg-green-100 text-green-700' :
                      t.signalCount >= 10 ? 'bg-blue-100 text-blue-700' :
                      t.signalCount >= 5 ? 'bg-yellow-100 text-yellow-700' :
                      'text-gray-300'
                    }`}>{t.signalCount} señales</span>
                    {(t.marketCount ?? 0) > 0 && (
                      <span className="hidden md:inline shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-600">{t.marketCount} mercado{t.marketCount !== 1 ? 's' : ''}</span>
                    )}
                  </>
                )}
                <div className="ml-auto flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!isResearching && (
                    <button
                      onClick={() => openDismissPrompt(t.id)}
                      disabled={dismissing === t.id}
                      className="hidden md:inline text-xs text-gray-400 hover:text-red-500 disabled:opacity-50 cursor-pointer"
                      title="Descartar tema"
                    >
                      {dismissing === t.id ? '...' : 'descartar'}
                    </button>
                  )}
                  {!isResearching && (
                    <button
                      onClick={() => toggleExpand(t.id)}
                      className="text-[10px] text-gray-400 hover:text-gray-600 w-5 h-5 flex items-center justify-center cursor-pointer"
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
                        ? 'bg-green-100 text-green-700'
                        : t.score >= 4
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {t.score.toFixed(1)}
                  </span>
                  <span className="text-xs text-gray-400 shrink-0">{t.category}</span>
                  <span className={`text-[10px] shrink-0 px-1 py-0.5 rounded ${
                    t.signalCount >= 50 ? 'bg-purple-100 text-purple-700' :
                    t.signalCount >= 20 ? 'bg-green-100 text-green-700' :
                    t.signalCount >= 10 ? 'bg-blue-100 text-blue-700' :
                    t.signalCount >= 5 ? 'bg-yellow-100 text-yellow-700' :
                    'text-gray-300'
                  }`}>{t.signalCount} señales</span>
                  {(t.marketCount ?? 0) > 0 && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-600">{t.marketCount} mercado{t.marketCount !== 1 ? 's' : ''}</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); openDismissPrompt(t.id); }}
                    disabled={dismissing === t.id}
                    className="ml-auto text-xs text-gray-400 hover:text-red-500 disabled:opacity-50 cursor-pointer"
                    title="Descartar tema"
                  >
                    {dismissing === t.id ? '...' : 'descartar'}
                  </button>
                </div>
              )}

              {/* Expanded content */}
              {isResearching && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-gray-200 rounded animate-pulse w-1/2" />
                </div>
              )}

              {!isResearching && isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-100 pt-2">
                  <p className="text-sm text-gray-600 mb-3">{t.summary}</p>

                  {t.suggestedAngles.length > 0 && (
                    <ul className="space-y-1 mb-3">
                      {t.suggestedAngles.map((angle, i) => (
                        <li key={i} className="text-sm text-blue-600">
                          {'\u2192'} {angle}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center gap-3 text-xs text-gray-400">
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
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-5 w-full max-w-md mx-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Motivo del descarte</h3>
            <textarea
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="¿Por qué descartás este tema?"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setDismissPromptId(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleDismiss}
                disabled={!dismissReason.trim()}
                className="px-4 py-1.5 text-sm font-medium rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors cursor-pointer"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
