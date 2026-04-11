'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePageContext } from '@/app/_components/PageContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SourcingStep } from '@/db/types';

interface NewsletterRow {
  id: string;
  date: string;
  status: string;
  subjectLine: string;
  featuredMarketIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface NewsletterRun {
  id: string;
  status: string;
  currentStep: string;
  steps: SourcingStep[];
  error: string | null;
  newsletterId: string | null;
  startedAt: string;
  completedAt: string | null;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: 'Borrador', className: 'bg-muted text-foreground' },
  sent: { label: 'Enviado', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
};

const STEP_LABELS: Record<string, string> = {
  'load-open-markets': 'Cargando mercados abiertos',
  'load-resolved': 'Cargando mercados resueltos',
  'load-signals': 'Cargando señales',
  'load-topics': 'Cargando temas',
  'write-newsletter': 'Escribiendo newsletter',
  'save-newsletter': 'Guardando newsletter',
  'log': 'Registrando actividad',
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
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
    </div>
  );
}

function useNewsletterStatus(onComplete: () => void) {
  const [runs, setRuns] = useState<NewsletterRun[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [justTriggered, setJustTriggered] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHasRunningRef = useRef(false);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/newsletter/status');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const hasRunning = runs.some((r) => r.status === 'running');

  // Detect transition from running → not running → refetch newsletters
  useEffect(() => {
    if (prevHasRunningRef.current && !hasRunning) {
      onComplete();
    }
    prevHasRunningRef.current = hasRunning;
  }, [hasRunning, onComplete]);

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

  // Poll while running or just triggered
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

  async function handleGenerate() {
    setTriggering(true);
    try {
      const res = await fetch('/api/newsletter', { method: 'POST' });
      if (res.status === 409) {
        // Already running — just start polling
        await fetchRuns();
      } else if (res.ok) {
        setJustTriggered(true);
        triggerTimeoutRef.current = setTimeout(() => {
          setJustTriggered(false);
        }, 30000);
      }
    } catch { /* ignore */ } finally {
      setTriggering(false);
    }
  }

  const runningRun = runs.find((r) => r.status === 'running');

  return { runs, triggering: triggering || justTriggered, hasRunning, runningRun, handleGenerate };
}

export default function NewsletterListPage() {
  const [newsletters, setNewsletters] = useState<NewsletterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { setPageData } = usePageContext();

  const fetchNewsletters = useCallback(async () => {
    try {
      const res = await fetch('/api/newsletters');
      if (res.ok) {
        const data = await res.json();
        setNewsletters(data.newsletters ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNewsletters();
  }, [fetchNewsletters]);

  const { triggering, hasRunning, runningRun, handleGenerate } = useNewsletterStatus(fetchNewsletters);

  useEffect(() => {
    if (newsletters.length > 0) {
      const content = newsletters.map((n, i) =>
        `${i + 1}. [${n.date}] ${n.subjectLine} (${STATUS_STYLES[n.status]?.label ?? n.status})`
      ).join('\n');
      setPageData({ label: `Newsletters (${newsletters.length})`, content });
    } else {
      setPageData({ label: 'Newsletter', content: 'No hay newsletters generados todavía.' });
    }
    return () => setPageData(null);
  }, [newsletters, setPageData]);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Newsletter</h1>
        <div className="flex flex-col items-end gap-1">
          <Button
            onClick={handleGenerate}
            disabled={triggering || hasRunning}
          >
            {triggering ? 'Iniciando...' : hasRunning ? 'En progreso...' : 'Generar newsletter'}
          </Button>
          {hasRunning && runningRun && (
            <span className="text-xs text-blue-600 dark:text-blue-400 animate-pulse">
              {STEP_LABELS[runningRun.currentStep] || runningRun.currentStep}...
            </span>
          )}
        </div>
      </div>

      {hasRunning && runningRun && (
        <div className="mb-4 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">Generando newsletter...</div>
          <div className="space-y-0.5">
            {runningRun.steps.map((step) => (
              <StepIndicator key={step.name} step={step} />
            ))}
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-muted-foreground">Cargando...</div>}

      {!loading && newsletters.length === 0 && !hasRunning && (
        <div className="text-sm text-muted-foreground">
          No hay newsletters todavía. Generá el primero con el botón de arriba.
        </div>
      )}

      {newsletters.length > 0 && (
        <div className="bg-card border border-border rounded-lg divide-y divide-border">
          {newsletters.map((n) => {
            const style = STATUS_STYLES[n.status] ?? { label: n.status, className: 'bg-muted text-foreground' };
            return (
              <Link
                key={n.id}
                href={`/dashboard/newsletter/${n.id}`}
                className="block px-4 py-3 hover:bg-muted transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {n.subjectLine}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">{n.date}</span>
                      <span className="text-xs text-muted-foreground/60">&middot;</span>
                      <span className="text-xs text-muted-foreground">
                        {n.featuredMarketIds.length} mercado{n.featuredMarketIds.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', style.className)}>
                      {style.label}
                    </span>
                    <span className="text-xs text-muted-foreground/60">{formatDate(n.createdAt)}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
