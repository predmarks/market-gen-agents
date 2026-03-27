'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

function useResizableColumns(count: number, initialWidths?: number[]) {
  const defaults = initialWidths ?? Array(count).fill(100 / count);
  const [widths, setWidths] = useState<number[]>(defaults);
  const dragging = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);

  const onMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { index, startX: e.clientX, startWidths: [...widths] };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const { index: i, startX, startWidths: sw } = dragging.current;
      const container = (ev.target as HTMLElement).closest('[data-kanban]');
      if (!container) return;
      const totalWidth = container.getBoundingClientRect().width;
      const deltaPct = ((ev.clientX - startX) / totalWidth) * 100;
      const newWidths = [...sw];
      const minW = 10;
      newWidths[i] = Math.max(minW, sw[i] + deltaPct);
      newWidths[i + 1] = Math.max(minW, sw[i + 1] - deltaPct);
      setWidths(newWidths);
    };

    const onMouseUp = () => {
      dragging.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [widths]);

  return { widths, onMouseDown };
}

// --- Types ---

interface TopicEntry {
  id: string;
  name: string;
  slug: string;
  score: number;
  category: string;
  status: string;
  lastSignalAt: string | null;
  lastGeneratedAt: string | null;
}

interface MarketEntry {
  id: string;
  title: string;
  status: string;
  category: string;
  score: number | null;
  createdAt: string;
}

interface PipelineData {
  topics: TopicEntry[];
  candidates: MarketEntry[];
  openMarkets: MarketEntry[];
  loading: boolean;
  refresh: () => void;
}

// --- Data hook ---

function usePipelineData(): PipelineData {
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [candidates, setCandidates] = useState<MarketEntry[]>([]);
  const [openMarkets, setOpenMarkets] = useState<MarketEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [topicsRes, candidatesRes, openRes] = await Promise.all([
        fetch('/api/topics'),
        fetch('/api/monitoring/activity?status=candidate'),
        fetch('/api/monitoring/activity?status=open'),
      ]);

      if (topicsRes.ok) {
        const data = await topicsRes.json();
        setTopics((data.topics ?? []).filter((t: TopicEntry) => t.status === 'active'));
      }
      if (candidatesRes.ok) {
        const data = await candidatesRes.json();
        setCandidates(data.markets ?? []);
      }
      if (openRes.ok) {
        const data = await openRes.json();
        setOpenMarkets(data.markets ?? []);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return { topics, candidates, openMarkets, loading, refresh: fetchAll };
}

// --- Score badge ---

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

// --- Time remaining helper ---

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff <= 0) return 'Cerrado';
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  return `${hours}h`;
}

// --- Main page ---

export default function DashboardPage() {
  const { topics, candidates, openMarkets, loading, refresh } = usePipelineData();
  const { widths, onMouseDown } = useResizableColumns(3, [35, 30, 35]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const toggleCollapse = (i: number) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  // Topic selection
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<string>>(new Set());
  const [topicCount, setTopicCount] = useState(10);
  const [generatingTopics, setGeneratingTopics] = useState(false);
  const [dismissingTopics, setDismissingTopics] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  // Candidate selection
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [reviewingCandidates, setReviewingCandidates] = useState(false);
  const [rejectingCandidates, setRejectingCandidates] = useState(false);

  // --- Handlers ---

  function toggleTopic(id: string) {
    setSelectedTopicIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleCandidate(id: string) {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleIngest() {
    setIngesting(true);
    try {
      await fetch('/api/sourcing', { method: 'POST' });
    } catch { /* ignore */ } finally {
      setIngesting(false);
    }
  }

  async function handleGenerate() {
    if (selectedTopicIds.size === 0) return;
    setGeneratingTopics(true);
    try {
      await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicIds: Array.from(selectedTopicIds), count: topicCount }),
      });
      setSelectedTopicIds(new Set());
      refresh();
    } catch { /* ignore */ } finally {
      setGeneratingTopics(false);
    }
  }

  async function handleDismissTopics() {
    if (selectedTopicIds.size === 0) return;
    const reason = prompt('Motivo del descarte (opcional):');
    setDismissingTopics(true);
    try {
      await Promise.all(
        Array.from(selectedTopicIds).map((id) =>
          fetch(`/api/topics/${id}/dismiss`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason || undefined }),
          })
        )
      );
      setSelectedTopicIds(new Set());
      refresh();
    } catch { /* ignore */ } finally {
      setDismissingTopics(false);
    }
  }

  async function handleReviewCandidates() {
    if (selectedCandidateIds.size === 0) return;
    setReviewingCandidates(true);
    try {
      await Promise.all(
        Array.from(selectedCandidateIds).map((id) =>
          fetch(`/api/review/${id}`, { method: 'POST' })
        )
      );
      setSelectedCandidateIds(new Set());
      refresh();
    } catch { /* ignore */ } finally {
      setReviewingCandidates(false);
    }
  }

  async function handleRejectCandidates() {
    if (selectedCandidateIds.size === 0) return;
    const reason = prompt('Motivo de rechazo:');
    if (!reason) return;
    setRejectingCandidates(true);
    try {
      await Promise.all(
        Array.from(selectedCandidateIds).map((id) =>
          fetch(`/api/markets/${id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason, source: 'triage' }),
          })
        )
      );
      setSelectedCandidateIds(new Set());
      refresh();
    } catch { /* ignore */ } finally {
      setRejectingCandidates(false);
    }
  }

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
        <span className="text-sm text-gray-500">Cargando pipeline...</span>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-gray-50" data-kanban>
      {/* Column 1: Temas */}
      <div className={`flex flex-col min-w-0 ${collapsed.has(0) ? 'w-10 !flex-none' : ''}`} style={collapsed.has(0) ? {} : { width: `${widths[0]}%` }}>
        <div className="sticky top-0 bg-white px-3 py-2 border-b border-gray-200 flex items-center justify-between z-10">
          <button onClick={() => toggleCollapse(0)} className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-[10px] text-gray-400">{collapsed.has(0) ? '▶' : '▼'}</span>
            <h2 className="text-sm font-medium text-gray-900">{collapsed.has(0) ? 'T' : 'Temas'}</h2>
            {!collapsed.has(0) && <span className="text-gray-400 font-normal text-sm">({topics.length})</span>}
          </button>
          {!collapsed.has(0) && (
            <button
              onClick={handleIngest}
              disabled={ingesting}
              className="px-2 py-1 text-xs font-medium rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {ingesting ? '...' : 'Ingerir'}
            </button>
          )}
        </div>

        {!collapsed.has(0) && <><div className="flex-1 overflow-y-auto">
          {topics.length === 0 && (
            <div className="px-3 py-8 text-sm text-gray-400 text-center">No hay temas activos</div>
          )}
          {topics.map((t) => {
            const hasNewInfo =
              (t.lastSignalAt && t.lastGeneratedAt && t.lastSignalAt > t.lastGeneratedAt) ||
              (t.lastSignalAt && !t.lastGeneratedAt);
            return (
              <div
                key={t.id}
                className="flex items-start gap-1.5 px-3 py-2 hover:bg-white transition-colors border-b border-gray-100"
              >
                <input
                  type="checkbox"
                  checked={selectedTopicIds.has(t.id)}
                  onChange={() => toggleTopic(t.id)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 shrink-0 mt-0.5"
                />
                <ScoreBadge score={t.score} />
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/topics/${t.slug}`} className="text-sm text-gray-800 hover:text-blue-600 hover:underline">
                    {t.name}
                  </Link>
                  <div className="flex items-center gap-1 mt-0.5">
                    {hasNewInfo && (
                      <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                        nueva info
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400">{t.category}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {selectedTopicIds.size > 0 && (
          <div className="sticky bottom-0 bg-white px-3 py-2 border-t border-gray-200 flex items-center gap-2 z-10">
            <input
              type="number"
              min={1}
              max={50}
              value={topicCount}
              onChange={(e) => setTopicCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
              disabled={generatingTopics}
              className="w-14 px-1.5 py-1 text-xs border border-gray-300 rounded text-center disabled:opacity-50"
            />
            <button
              onClick={handleGenerate}
              disabled={generatingTopics}
              className="px-2 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors cursor-pointer"
            >
              {generatingTopics ? '...' : 'Generar'}
            </button>
            <button
              onClick={handleDismissTopics}
              disabled={dismissingTopics}
              className="px-2 py-1 text-xs font-medium rounded bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {dismissingTopics ? '...' : 'Descartar'}
            </button>
          </div>
        )}
        </>}
      </div>

      {/* Divider 1 */}
      <div className="w-1.5 bg-gray-300 hover:bg-blue-400 cursor-col-resize shrink-0 transition-colors" onMouseDown={(e) => onMouseDown(0, e)} />

      {/* Column 2: Candidatos */}
      <div className={`flex flex-col min-w-0 ${collapsed.has(1) ? 'w-10 !flex-none' : ''}`} style={collapsed.has(1) ? {} : { width: `${widths[1]}%` }}>
        <div className="sticky top-0 bg-white px-3 py-2 border-b border-gray-200 z-10">
          <button onClick={() => toggleCollapse(1)} className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-[10px] text-gray-400">{collapsed.has(1) ? '▶' : '▼'}</span>
            <h2 className="text-sm font-medium text-gray-900">{collapsed.has(1) ? 'C' : 'Candidatos'}</h2>
            {!collapsed.has(1) && <span className="text-gray-400 font-normal text-sm">({candidates.length})</span>}
          </button>
        </div>

        {!collapsed.has(1) && <><div className="flex-1 overflow-y-auto">
          {candidates.length === 0 && (
            <div className="px-3 py-8 text-sm text-gray-400 text-center">No hay candidatos</div>
          )}
          {candidates.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-1.5 px-3 py-2 hover:bg-white transition-colors border-b border-gray-100"
            >
              <input
                type="checkbox"
                checked={selectedCandidateIds.has(m.id)}
                onChange={() => toggleCandidate(m.id)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 shrink-0"
              />
              <Link
                href={`/dashboard/markets/${m.id}`}
                className="text-sm text-gray-800 truncate hover:text-blue-600 flex-1 min-w-0"
              >
                {m.title}
              </Link>
              <span className="text-[10px] text-gray-400 shrink-0">{m.category}</span>
            </div>
          ))}
        </div>

        {selectedCandidateIds.size > 0 && (
          <div className="sticky bottom-0 bg-white px-3 py-2 border-t border-gray-200 flex items-center gap-2 z-10">
            <button
              onClick={handleReviewCandidates}
              disabled={reviewingCandidates}
              className="px-2 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors cursor-pointer"
            >
              {reviewingCandidates ? '...' : 'Revisar'}
            </button>
            <button
              onClick={handleRejectCandidates}
              disabled={rejectingCandidates}
              className="px-2 py-1 text-xs font-medium rounded bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {rejectingCandidates ? '...' : 'Descartar'}
            </button>
          </div>
        )}
        </>}
      </div>

      {/* Divider 2 */}
      <div className="w-1.5 bg-gray-300 hover:bg-blue-400 cursor-col-resize shrink-0 transition-colors" onMouseDown={(e) => onMouseDown(1, e)} />

      {/* Column 3: Abiertos */}
      <div className={`flex flex-col min-w-0 ${collapsed.has(2) ? 'w-10 !flex-none' : ''}`} style={collapsed.has(2) ? {} : { width: `${widths[2]}%` }}>
        <div className="sticky top-0 bg-white px-3 py-2 border-b border-gray-200 z-10">
          <button onClick={() => toggleCollapse(2)} className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-[10px] text-gray-400">{collapsed.has(2) ? '▶' : '▼'}</span>
            <h2 className="text-sm font-medium text-gray-900">{collapsed.has(2) ? 'A' : 'Abiertos'}</h2>
            {!collapsed.has(2) && <span className="text-gray-400 font-normal text-sm">({openMarkets.length})</span>}
          </button>
        </div>

        {!collapsed.has(2) && <><div className="flex-1 overflow-y-auto">
          {openMarkets.length === 0 && (
            <div className="px-3 py-8 text-sm text-gray-400 text-center">No hay mercados abiertos</div>
          )}
          {openMarkets.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-1.5 px-3 py-2 hover:bg-white transition-colors border-b border-gray-100"
            >
              <Link
                href={`/dashboard/markets/${m.id}`}
                className="text-sm text-gray-800 truncate hover:text-blue-600 flex-1 min-w-0"
              >
                {m.title}
              </Link>
              <span className="text-[10px] text-gray-400 shrink-0">{formatDate(m.createdAt)}</span>
            </div>
          ))}
        </div></>}
      </div>
    </div>
  );
}
