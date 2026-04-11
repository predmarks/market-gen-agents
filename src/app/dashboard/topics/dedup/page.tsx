'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TopicInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  score: number;
  summary: string;
  suggestedAngles: string[];
  signalCount: number;
  category: string;
}

interface DedupPair {
  a: TopicInfo;
  b: TopicInfo;
  similarity: number;
}

interface Signal {
  id: string;
  type: string;
  text: string;
  summary?: string;
  url?: string;
  source: string;
  publishedAt?: string;
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  regular: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  stale: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
};

function TopicSide({
  topic,
  signals,
  onLoadSignals,
  onMerge,
  merging,
}: {
  topic: TopicInfo;
  signals: Signal[] | null;
  onLoadSignals: () => void;
  onMerge: () => void;
  merging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex-1 min-w-0 p-4 space-y-2">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Link href={`/dashboard/topics/${topic.slug}`} className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline flex-1">
          {topic.name}
        </Link>
        <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', STATUS_BADGE[topic.status] ?? 'bg-muted text-muted-foreground')}>
          {topic.status}
        </span>
      </div>

      {/* Meta */}
      <div className="flex gap-3 text-[10px] text-muted-foreground/60">
        <span>Score: {topic.score.toFixed(1)}</span>
        <span>{topic.category}</span>
        <span>{topic.signalCount} signals</span>
      </div>

      {/* Summary */}
      <p className="text-xs text-muted-foreground leading-relaxed">{topic.summary}</p>

      {/* Angles */}
      {topic.suggestedAngles.length > 0 && (
        <div className="space-y-0.5">
          <span className="text-[10px] text-muted-foreground/60">Angles:</span>
          {topic.suggestedAngles.map((a, i) => (
            <p key={i} className="text-[11px] text-muted-foreground pl-2">- {a}</p>
          ))}
        </div>
      )}

      {/* Signals (expandable) */}
      <div>
        <button
          onClick={() => {
            if (!expanded && !signals) onLoadSignals();
            setExpanded(!expanded);
          }}
          className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
        >
          {expanded ? '▼' : '▶'} {topic.signalCount} señales
        </button>
        {expanded && (
          <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
            {signals === null ? (
              <p className="text-[10px] text-muted-foreground/60">Cargando...</p>
            ) : signals.length === 0 ? (
              <p className="text-[10px] text-muted-foreground/60">Sin señales</p>
            ) : (
              signals.map((s) => (
                <div key={s.id} className="text-[11px] text-muted-foreground py-0.5">
                  <span className="text-muted-foreground/60">[{s.source}]</span>{' '}
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                      {s.text.slice(0, 120)}
                    </a>
                  ) : (
                    s.text.slice(0, 120)
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Merge button */}
      <Button
        variant="outline"
        size="sm"
        onClick={onMerge}
        disabled={merging}
        className="w-full mt-2 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/30"
      >
        {merging ? 'Fusionando...' : '◀ Conservar este'}
      </Button>
    </div>
  );
}

export default function DedupPage() {
  const [pairs, setPairs] = useState<DedupPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState<string | null>(null);
  const [signalCache, setSignalCache] = useState<Record<string, Signal[]>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchProcessing, setBatchProcessing] = useState(false);

  const fetchPairs = useCallback(async () => {
    try {
      const res = await fetch('/api/topics/dedup');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Error ${res.status}`);
      }
      const data = await res.json();
      setPairs(data.pairs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPairs(); }, [fetchPairs]);

  async function loadSignals(topicId: string) {
    if (signalCache[topicId]) return;
    try {
      const res = await fetch(`/api/topics/${topicId}`);
      if (res.ok) {
        const data = await res.json();
        setSignalCache((prev) => ({ ...prev, [topicId]: data.signals ?? [] }));
      }
    } catch { /* ignore */ }
  }

  async function handleMerge(targetId: string, sourceId: string, pairKey: string) {
    setMerging(pairKey);
    try {
      const res = await fetch(`/api/topics/${targetId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTopicId: sourceId }),
      });
      if (res.ok) {
        setDismissed((prev) => new Set([...prev, pairKey]));
      }
    } catch { /* ignore */ }
    setMerging(null);
  }

  function handleDismiss(pairKey: string) {
    setDismissed((prev) => new Set([...prev, pairKey]));
  }

  function toggleSelect(pairKey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pairKey)) next.delete(pairKey);
      else next.add(pairKey);
      return next;
    });
  }

  const activePairs = pairs.filter((_, i) => !dismissed.has(String(i)));
  const activeKeys = activePairs.map((_, i) => String(pairs.indexOf(activePairs[i] as DedupPair)));
  const allSelected = activeKeys.length > 0 && activeKeys.every((k) => selected.has(k));

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(activeKeys));
    }
  }

  async function batchDismiss() {
    setDismissed((prev) => new Set([...prev, ...selected]));
    setSelected(new Set());
  }

  async function batchAutoMerge() {
    setBatchProcessing(true);

    // Build merge pairs: keep topic with more signals (tie-break: higher score)
    const mergePairs: { targetId: string; sourceId: string }[] = [];
    const seenSourceIds = new Set<string>();

    for (const key of selected) {
      const idx = parseInt(key);
      const pair = pairs[idx];
      if (!pair || dismissed.has(key)) continue;

      const keepA = pair.a.signalCount > pair.b.signalCount ||
        (pair.a.signalCount === pair.b.signalCount && pair.a.score >= pair.b.score);
      const targetId = keepA ? pair.a.id : pair.b.id;
      const sourceId = keepA ? pair.b.id : pair.a.id;

      // Skip if source was already targeted in this batch
      if (seenSourceIds.has(sourceId)) continue;
      seenSourceIds.add(sourceId);

      mergePairs.push({ targetId, sourceId });
    }

    try {
      const res = await fetch('/api/topics/batch-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs: mergePairs }),
      });

      if (res.ok) {
        const data = await res.json();
        const mergedSourceIds = new Set(
          (data.results as { sourceId: string; status: string }[])
            .filter((r) => r.status === 'merged')
            .map((r) => r.sourceId),
        );

        // Dismiss all pairs involving merged-away topics
        setDismissed((prev) => {
          const next = new Set(prev);
          pairs.forEach((p, i) => {
            if (mergedSourceIds.has(p.a.id) || mergedSourceIds.has(p.b.id)) next.add(String(i));
          });
          return next;
        });
      }
    } catch { /* ignore */ }

    setSelected(new Set());
    setBatchProcessing(false);
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-bold">Temas duplicados</h1>
        <Link href="/dashboard/topics" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          ← Volver a temas
        </Link>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Calculando similitud...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Batch action bar */}
      {!loading && activePairs.length > 0 && (
        <div className="sticky top-0 z-10 bg-card border border-border rounded-lg p-3 flex items-center gap-3 shadow-sm">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="rounded border-border" />
            {allSelected ? 'Deseleccionar' : 'Seleccionar'} todos
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground/60">{selected.size} seleccionados</span>
              <Button
                variant="outline"
                size="xs"
                onClick={batchDismiss}
                disabled={batchProcessing}
              >
                Descartar {selected.size}
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={batchAutoMerge}
                disabled={batchProcessing}
                className="border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:bg-blue-900/20 dark:hover:bg-blue-900/40"
              >
                {batchProcessing ? 'Fusionando...' : `Auto-merge ${selected.size} (mayor señales)`}
              </Button>
            </>
          )}
        </div>
      )}

      {!loading && activePairs.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay duplicados pendientes de revisión.</p>
      )}

      <div className="space-y-4">
        {pairs.map((pair, i) => {
          if (dismissed.has(String(i))) return null;
          const pairKey = String(i);

          return (
            <div key={pairKey} className="bg-card rounded-lg border border-border overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2 bg-muted border-b border-border">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(pairKey)}
                    onChange={() => toggleSelect(pairKey)}
                    className="rounded border-border"
                  />
                  <span className="text-xs font-mono text-muted-foreground">
                    {Math.round(pair.similarity * 100)}% similar
                  </span>
                </div>
                <button
                  onClick={() => handleDismiss(pairKey)}
                  className="text-xs text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
                >
                  No son duplicados
                </button>
              </div>

              {/* Side by side */}
              <div className="flex divide-x divide-border">
                <TopicSide
                  topic={pair.a}
                  signals={signalCache[pair.a.id] ?? null}
                  onLoadSignals={() => loadSignals(pair.a.id)}
                  onMerge={() => handleMerge(pair.a.id, pair.b.id, pairKey)}
                  merging={merging === pairKey}
                />
                <TopicSide
                  topic={pair.b}
                  signals={signalCache[pair.b.id] ?? null}
                  onLoadSignals={() => loadSignals(pair.b.id)}
                  onMerge={() => handleMerge(pair.b.id, pair.a.id, pairKey)}
                  merging={merging === pairKey}
                />
              </div>
            </div>
          );
        })}
      </div>

      {!loading && activePairs.length > 0 && (
        <p className="text-xs text-muted-foreground/60 mt-4 text-center">
          {activePairs.length} pares pendientes de {pairs.length} totales
        </p>
      )}
    </div>
  );
}
