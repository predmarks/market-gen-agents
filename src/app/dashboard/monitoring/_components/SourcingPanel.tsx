'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  'generate': 'Generar candidatos',
  'dedup': 'Deduplicar',
  'save': 'Guardar en DB',
  'trigger-reviews': 'Iniciar revisiones',
};

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(dateStr));
}

function StepIndicator({ step }: { step: SourcingStep }) {
  const icon = step.status === 'done' ? '✓' :
    step.status === 'running' ? '●' :
    step.status === 'error' ? '✗' : '○';

  const color = step.status === 'done' ? 'text-green-600' :
    step.status === 'running' ? 'text-blue-600 animate-pulse' :
    step.status === 'error' ? 'text-red-600' : 'text-gray-400';

  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={`text-xs font-mono w-3 text-center ${color}`}>{icon}</span>
      <span className={`text-xs ${step.status === 'pending' ? 'text-gray-400' : 'text-gray-700'}`}>
        {STEP_LABELS[step.name] || step.name}
      </span>
      {step.detail && (
        <span className="text-xs text-gray-400 ml-auto">{step.detail}</span>
      )}
    </div>
  );
}

function useSourcingData() {
  const [runs, setRuns] = useState<SourcingRun[]>([]);
  const [candidateCap, setCandidateCap] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/sourcing/status');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs);
        if (data.candidateCap) setCandidateCap(data.candidateCap);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const hasRunning = runs.some((r) => r.status === 'running');
  useEffect(() => {
    if (hasRunning) {
      pollRef.current = setInterval(fetchRuns, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasRunning, fetchRuns]);

  async function handleTrigger() {
    setTriggering(true);
    try {
      const res = await fetch('/api/sourcing', { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      setLoading(true);
      setTimeout(fetchRuns, 1000);
      setTimeout(() => setLoading(false), 2000);
    } catch {
      // ignore
    } finally {
      setTriggering(false);
    }
  }

  return { runs, candidateCap, loading, triggering, hasRunning, handleTrigger };
}

export function SourcingTrigger({
  candidateCap,
  triggering,
  hasRunning,
  onTrigger,
}: {
  candidateCap: number;
  triggering: boolean;
  hasRunning: boolean;
  onTrigger: () => void;
}) {
  return (
    <button
      onClick={onTrigger}
      disabled={triggering || hasRunning}
      className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
    >
      {triggering ? 'Iniciando...' : hasRunning ? 'En progreso...' : `Sugerir ${candidateCap || '?'} mercados nuevos`}
    </button>
  );
}

function RunSummary({ run }: { run: SourcingRun }) {
  const statusColor = run.status === 'complete' ? 'text-green-600' :
    run.status === 'running' ? 'text-blue-600' :
    run.status === 'error' ? 'text-red-600' :
    run.status === 'skipped' ? 'text-gray-500' : 'text-gray-500';

  const statusLabel = run.status === 'complete' ? 'Completado' :
    run.status === 'running' ? 'En progreso' :
    run.status === 'error' ? 'Error' :
    run.status === 'skipped' ? 'Omitido' : run.status;

  const stats = [
    run.signalsCount != null ? `${run.signalsCount} señales` : null,
    run.candidatesGenerated != null ? `${run.candidatesGenerated} generados` : null,
    run.candidatesSaved != null ? `${run.candidatesSaved} guardados` : null,
  ].filter(Boolean).join(' · ');

  return (
    <span className="flex items-center gap-2 text-xs">
      <span className={`font-medium ${statusColor}`}>{statusLabel}</span>
      <span className="text-gray-400">{formatDate(run.startedAt)}</span>
      {stats && <span className="text-gray-500">{stats}</span>}
      {run.error && <span className="text-red-500 truncate max-w-48">{run.error}</span>}
    </span>
  );
}

function SourcingLog({ runs, loading }: { runs: SourcingRun[]; loading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (runs.length === 0 && !loading) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-2 border-b border-gray-100">
        <h3 className="text-sm font-medium text-gray-700">Sourcing</h3>
      </div>
      {loading && runs.length === 0 && (
        <div className="px-4 py-3 text-xs text-gray-500">Iniciando pipeline...</div>
      )}
      <div className="divide-y divide-gray-50">
        {runs.map((run) => {
          const isExpanded = expandedId === run.id;
          return (
            <div key={run.id}>
              <button
                onClick={() => setExpandedId(isExpanded ? null : run.id)}
                className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-50 transition-colors"
              >
                <RunSummary run={run} />
                <span className="text-gray-400 text-xs ml-2">{isExpanded ? '▲' : '▼'}</span>
              </button>
              {isExpanded && (
                <div className="px-4 pb-3 pt-1 bg-gray-50">
                  {run.steps.length > 0 && (
                    <div className="mb-2">
                      {run.steps.map((step) => (
                        <StepIndicator key={step.name} step={step} />
                      ))}
                    </div>
                  )}
                  {run.error && (
                    <p className="text-xs text-red-600 bg-red-50 rounded p-2">{run.error}</p>
                  )}
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
  const { runs, candidateCap, loading, triggering, hasRunning, handleTrigger } = useSourcingData();

  return (
    <SourcingPanelView
      runs={runs}
      candidateCap={candidateCap}
      loading={loading}
      triggering={triggering}
      hasRunning={hasRunning}
      onTrigger={handleTrigger}
    />
  );
}

export function SourcingPanelView({
  runs,
  candidateCap,
  loading,
  triggering,
  hasRunning,
  onTrigger,
}: {
  runs: SourcingRun[];
  candidateCap: number;
  loading: boolean;
  triggering: boolean;
  hasRunning: boolean;
  onTrigger: () => void;
}) {
  return (
    <>
      <SourcingTrigger
        candidateCap={candidateCap}
        triggering={triggering}
        hasRunning={hasRunning}
        onTrigger={onTrigger}
      />
      <SourcingLog runs={runs} loading={loading} />
    </>
  );
}

export { useSourcingData, SourcingLog };
