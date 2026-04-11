'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import type { MarketStatus, Review, Iteration } from '@/db/types';
import { ARCHIVABLE_STATUSES } from '@/db/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MarketActionsProps {
  marketId: string;
  status: MarketStatus;
  review: Review | null;
  iterations?: Iteration[] | null;
  isArchived: boolean;
}

const actionStyles = {
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-950',
  violet: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300 dark:hover:bg-violet-950',
  rose: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-950',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-950',
  slate: 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800',
} as const;

export function MarketActions({ marketId, status, iterations, isArchived }: MarketActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const processing = status === 'processing';

  useEffect(() => {
    if (processing) {
      pollRef.current = setInterval(() => router.refresh(), 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [processing, router]);

  async function handleAction(action: string, options?: RequestInit) {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(
        action.startsWith('/') ? action : `/api/markets/${marketId}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          ...options,
        },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Action failed');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(null);
    }
  }

  const iterationCount = iterations?.length ?? 0;

  return (
    <>
      <>
        {status === 'candidate' && (
          <Button
            variant="outline"
            className={cn(actionStyles.indigo)}
            disabled={loading === 'review'}
            onClick={() => handleAction(`/api/review/${marketId}`)}
          >
            {loading === 'review' ? 'Procesando...' : 'Iniciar Revisión'}
          </Button>
        )}

        {status === 'processing' && (
          <>
            <p className="text-sm text-amber-700 bg-amber-50 px-4 py-2 rounded-md dark:bg-amber-950/50 dark:text-amber-300">
              Procesando… {iterationCount > 0 ? `(iteración ${iterationCount})` : ''}
            </p>
            <Button
              variant="outline"
              className={cn(actionStyles.amber)}
              disabled={loading === 'cancel'}
              onClick={() => handleAction('cancel')}
            >
              {loading === 'cancel' ? 'Procesando...' : 'Cancelar'}
            </Button>
          </>
        )}

        {status === 'cancelled' && (
          <Button
            variant="outline"
            className={cn(actionStyles.violet)}
            disabled={loading === 'resume'}
            onClick={() => handleAction('resume')}
          >
            {loading === 'resume' ? 'Procesando...' : 'Reanudar'}
          </Button>
        )}

        {status === 'candidate' && (
          <Button
            variant="outline"
            className={cn(actionStyles.rose)}
            disabled={loading === 'reject'}
            onClick={() =>
              handleAction('reject', {
                body: JSON.stringify({ reason: 'Rejected by reviewer' }),
              })
            }
          >
            {loading === 'reject' ? 'Procesando...' : 'Rechazar'}
          </Button>
        )}

        {(ARCHIVABLE_STATUSES as readonly string[]).includes(status) && !isArchived && (
          <Button
            variant="outline"
            className={cn(actionStyles.slate)}
            disabled={loading === 'archive'}
            onClick={() => handleAction('archive')}
          >
            {loading === 'archive' ? 'Procesando...' : 'Archivar'}
          </Button>
        )}

        {isArchived && (
          <Button
            variant="outline"
            className={cn(actionStyles.slate)}
            disabled={loading === 'unarchive'}
            onClick={() => handleAction('unarchive')}
          >
            {loading === 'unarchive' ? 'Procesando...' : 'Desarchivar'}
          </Button>
        )}
      </>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}
