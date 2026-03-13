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
    second: '2-digit',
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
    <div className="flex items-center gap-2 py-1">
      <span className={`text-sm font-mono w-4 text-center ${color}`}>{icon}</span>
      <span className={`text-sm ${step.status === 'pending' ? 'text-gray-400' : 'text-gray-900'}`}>
        {STEP_LABELS[step.name] || step.name}
      </span>
      {step.detail && (
        <span className="text-xs text-gray-500 ml-auto">{step.detail}</span>
      )}
    </div>
  );
}

function RunCard({ run, isLatest }: { run: SourcingRun; isLatest: boolean }) {
  const statusColor = run.status === 'complete' ? 'bg-green-100 text-green-800' :
    run.status === 'running' ? 'bg-blue-100 text-blue-800' :
    run.status === 'error' ? 'bg-red-100 text-red-800' :
    run.status === 'skipped' ? 'bg-gray-100 text-gray-600' : 'bg-gray-100 text-gray-800';

  const statusLabel = run.status === 'complete' ? 'Completado' :
    run.status === 'running' ? 'En progreso' :
    run.status === 'error' ? 'Error' :
    run.status === 'skipped' ? 'Omitido' : run.status;

  return (
    <div className={`bg-white rounded-lg border p-4 ${isLatest && run.status === 'running' ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor}`}>
            {statusLabel}
          </span>
          <span className="text-xs text-gray-500">{formatDate(run.startedAt)}</span>
        </div>
        {run.completedAt && (
          <span className="text-xs text-gray-400">
            Finalizado: {formatDate(run.completedAt)}
          </span>
        )}
      </div>

      {/* Step progress */}
      {run.steps.length > 0 && (
        <div className="mb-3">
          {run.steps.map((step) => (
            <StepIndicator key={step.name} step={step} />
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-4 text-xs text-gray-500 border-t border-gray-100 pt-2">
        {run.signalsCount != null && (
          <span>Señales: <strong className="text-gray-700">{run.signalsCount}</strong></span>
        )}
        {run.candidatesGenerated != null && (
          <span>Generados: <strong className="text-gray-700">{run.candidatesGenerated}</strong></span>
        )}
        {run.candidatesSaved != null && (
          <span>Guardados: <strong className="text-gray-700">{run.candidatesSaved}</strong></span>
        )}
      </div>

      {run.error && (
        <p className="mt-2 text-sm text-red-600 bg-red-50 rounded p-2">{run.error}</p>
      )}
    </div>
  );
}

export function SourcingPanel() {
  const [runs, setRuns] = useState<SourcingRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/sourcing/status');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs);
      }
    } catch {
      // ignore fetch errors
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Poll while there's a running job
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
      // Start polling immediately
      setTimeout(fetchRuns, 1000);
      setTimeout(() => setLoading(false), 2000);
    } catch {
      // ignore
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Sourcer</h1>
          <p className="text-sm text-gray-500 mt-1">Genera candidatos a partir de noticias y datos argentinos</p>
        </div>
        <button
          onClick={handleTrigger}
          disabled={triggering || hasRunning}
          className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
        >
          {triggering ? 'Iniciando...' : hasRunning ? 'En progreso...' : 'Ejecutar Sourcer'}
        </button>
      </div>

      {loading && runs.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          Iniciando pipeline...
        </div>
      )}

      <div className="space-y-4">
        {runs.map((run, i) => (
          <RunCard key={run.id} run={run} isLatest={i === 0} />
        ))}
      </div>

      {runs.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-500">
          No hay ejecuciones registradas. Hacé click en &quot;Ejecutar Sourcer&quot; para comenzar.
        </div>
      )}
    </div>
  );
}
