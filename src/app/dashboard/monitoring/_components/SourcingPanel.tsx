'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SourcingStep } from '@/db/types';

interface SourcingRun {
  id: string;
  status: string;
  currentStep: string;
  steps: SourcingStep[];
  signalsCount: number | null;
  candidatesGenerated: number | null;
  candidatesSaved: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

const STEP_LABELS: Record<string, string> = {
  'check-cap': 'Verificar capacidad',
  'ingest': 'Ingerir señales',
  'update-topics': 'Actualizar temas',
};

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr));
}

function StepIndicator({ step }: { step: SourcingStep }) {
  const icon = step.status === 'done' ? '\u2713' :
    step.status === 'running' ? '\u25CF' :
    step.status === 'error' ? '\u2717' : '\u25CB';

  const color = step.status === 'done' ? 'text-green-600 dark:text-green-400' :
    step.status === 'running' ? 'text-blue-600 dark:text-blue-400 animate-pulse' :
    step.status === 'error' ? 'text-destructive' : 'text-muted-foreground/60';

  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={cn('text-xs font-mono w-3 text-center', color)}>{icon}</span>
      <span className={cn('text-xs', step.status === 'pending' ? 'text-muted-foreground/60' : 'text-foreground')}>
        {STEP_LABELS[step.name] || step.name}
      </span>
      {step.detail && (
        <span className="text-xs text-muted-foreground/60 ml-auto">{step.detail}</span>
      )}
    </div>
  );
}

function useSourcingData() {
  const [runs, setRuns] = useState<SourcingRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [justTriggered, setJustTriggered] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/sourcing/status');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const hasRunning = runs.some((r) => r.status === 'running');

  // Clear justTriggered once a running run is detected
  useEffect(() => {
    if (hasRunning && justTriggered) {
      setJustTriggered(false);
      if (triggerTimeoutRef.current) {
        clearTimeout(triggerTimeoutRef.current);
        triggerTimeoutRef.current = null;
      }
    }
  }, [hasRunning, justTriggered]);

  // Poll while hasRunning OR justTriggered (waiting for run to appear)
  const shouldPoll = hasRunning || justTriggered;
  useEffect(() => {
    if (shouldPoll) {
      pollRef.current = setInterval(fetchRuns, 3000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [shouldPoll, fetchRuns]);

  async function handleTrigger() {
    setTriggering(true);
    try {
      const res = await fetch('/api/sourcing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed');
      setJustTriggered(true);
      setLoading(true);
      setTimeout(() => setLoading(false), 2000);
      // Safety timeout: clear justTriggered after 30s if run never appears
      triggerTimeoutRef.current = setTimeout(() => {
        setJustTriggered(false);
      }, 30000);
    } catch {
      // ignore
    } finally {
      setTriggering(false);
    }
  }

  const runningRun = runs.find((r) => r.status === 'running');
  const runningStep = runningRun?.currentStep;

  return { runs, loading, triggering: triggering || justTriggered, hasRunning, runningStep, handleTrigger };
}

export function SourcingTrigger({
  triggering,
  hasRunning,
  runningStep,
  onTrigger,
}: {
  triggering: boolean;
  hasRunning: boolean;
  runningStep?: string;
  onTrigger: () => void;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={() => onTrigger()}
        disabled={triggering || hasRunning}
      >
        {triggering ? 'Iniciando...' : hasRunning ? 'En progreso...' : 'Ingerir señales'}
      </Button>
      {hasRunning && runningStep && (
        <span className="text-xs text-blue-600 dark:text-blue-400 animate-pulse">
          {STEP_LABELS[runningStep] || runningStep}...
        </span>
      )}
    </div>
  );
}

function RunSummary({ run }: { run: SourcingRun }) {
  const statusColor = run.status === 'complete' ? 'text-green-600 dark:text-green-400' :
    run.status === 'running' ? 'text-blue-600 dark:text-blue-400' :
    run.status === 'error' ? 'text-destructive' :
    run.status === 'skipped' ? 'text-muted-foreground' : 'text-muted-foreground';

  const statusLabel = run.status === 'complete' ? 'Completado' :
    run.status === 'running' ? 'En progreso' :
    run.status === 'error' ? 'Error' :
    run.status === 'skipped' ? 'Omitido' : run.status;

  const stats = [
    run.signalsCount != null ? `${run.signalsCount} señales` : null,
  ].filter(Boolean).join(' \u00B7 ');

  return (
    <span className="flex items-center gap-2 text-xs">
      <span className={cn('font-medium', statusColor)}>{statusLabel}</span>
      <span className="text-muted-foreground/60">{formatDate(run.startedAt)}</span>
      {stats && <span className="text-muted-foreground">{stats}</span>}
      {run.error && <span className="text-destructive truncate max-w-48">{run.error}</span>}
    </span>
  );
}

interface Signal {
  type: 'news' | 'social' | 'event' | 'data';
  text: string;
  summary?: string;
  url?: string;
  source: string;
  publishedAt: string;
  category?: string;
  dataPoints?: { metric: string; currentValue: number; previousValue?: number; unit: string }[];
  score?: number;
  scoreReason?: string;
}

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  news: { label: 'Noticia', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  data: { label: 'Dato', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  social: { label: 'Social', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  event: { label: 'Evento', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
};

function SignalList({ runId }: { runId: string }) {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const signalRes = await fetch(`/api/sourcing/status?runId=${runId}`);
        if (signalRes.ok) {
          const data = await signalRes.json();
          if (!cancelled) {
            setSignals(data.run?.signals ?? null);
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [runId]);

  if (loading) return <div className="text-xs text-muted-foreground/60 py-2">Cargando...</div>;

  if (!signals || signals.length === 0) return <div className="text-xs text-muted-foreground/60 py-2">Sin datos registrados</div>;

  const grouped = new Map<string, Signal[]>();
  for (const s of signals) {
    const list = grouped.get(s.source) ?? [];
    list.push(s);
    grouped.set(s.source, list);
  }

  return (
    <div className="space-y-3 mt-2">
      {Array.from(grouped.entries()).map(([source, items]) => (
        <div key={source}>
          <div className="text-xs font-medium text-muted-foreground mb-1">{source} ({items.length})</div>
          <div className="space-y-1">
            {items.map((s, i) => {
              const badge = TYPE_BADGE[s.type] ?? TYPE_BADGE.news;
              return (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={cn('shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium', badge.className)}>
                    {badge.label}
                  </span>
                  {s.score != null && (
                    <span className={cn('shrink-0 px-1 py-0.5 rounded text-[10px] font-mono',
                      s.score >= 7 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      s.score >= 4 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                      'bg-muted text-muted-foreground'
                    )} title={s.scoreReason}>
                      {s.score.toFixed(1)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <span className="text-foreground">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {s.text}
                        </a>
                      ) : s.text}
                    </span>
                    {s.dataPoints && s.dataPoints.length > 0 && (
                      <span className="text-muted-foreground/60 ml-1">
                        {s.dataPoints.map((dp) => {
                          const prev = dp.previousValue != null ? ` (ant: ${dp.previousValue})` : '';
                          return `${dp.currentValue} ${dp.unit}${prev}`;
                        }).join(', ')}
                      </span>
                    )}
                    <span className="text-muted-foreground/50 ml-1">{formatDate(s.publishedAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SourcingLog({ runs, loading }: { runs: SourcingRun[]; loading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (runs.length === 0 && !loading) return null;

  return (
    <div className="bg-card rounded-lg border border-border">
      <div className="px-4 py-2 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">Ingestion</h3>
      </div>
      {loading && runs.length === 0 && (
        <div className="px-4 py-3 text-xs text-muted-foreground">Iniciando pipeline...</div>
      )}
      <div className="divide-y divide-border">
        {runs.map((run) => {
          const isExpanded = expandedId === run.id;
          return (
            <div key={run.id}>
              <button
                onClick={() => setExpandedId(isExpanded ? null : run.id)}
                className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted transition-colors"
              >
                <RunSummary run={run} />
                <span className="text-muted-foreground/60 text-xs ml-2">{isExpanded ? '\u25B2' : '\u25BC'}</span>
              </button>
              {isExpanded && (
                <div className="px-4 pb-3 pt-1 bg-muted">
                  {run.steps.length > 0 && (
                    <div className="mb-2">
                      {run.steps.map((step) => (
                        <StepIndicator key={step.name} step={step} />
                      ))}
                    </div>
                  )}
                  {run.error && (
                    <p className="text-xs text-destructive bg-destructive/10 rounded p-2">{run.error}</p>
                  )}
                  <SignalList runId={run.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SourcingPanel() {
  const { runs, loading, triggering, hasRunning, runningStep, handleTrigger } = useSourcingData();

  return (
    <SourcingPanelView
      runs={runs}
      loading={loading}
      triggering={triggering}
      hasRunning={hasRunning}
      runningStep={runningStep}
      onTrigger={handleTrigger}
    />
  );
}

export function SourcingPanelView({
  runs,
  loading,
  triggering,
  hasRunning,
  runningStep,
  onTrigger,
}: {
  runs: SourcingRun[];
  loading: boolean;
  triggering: boolean;
  hasRunning: boolean;
  runningStep?: string;
  onTrigger: () => void;
}) {
  return (
    <>
      <SourcingTrigger
        triggering={triggering}
        hasRunning={hasRunning}
        runningStep={runningStep}
        onTrigger={onTrigger}
      />
      <SourcingLog runs={runs} loading={loading} />
    </>
  );
}

export { useSourcingData, SourcingLog };
