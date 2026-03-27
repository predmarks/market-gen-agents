'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import type { MarketStatus, Review, Iteration } from '@/db/types';
import { ARCHIVABLE_STATUSES } from '@/db/types';

interface MarketActionsProps {
  marketId: string;
  status: MarketStatus;
  review: Review | null;
  iterations?: Iteration[] | null;
  isArchived: boolean;
}

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
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {status === 'candidate' && (
          <ActionButton
            label="Iniciar Revisión"
            loading={loading === 'review'}
            onClick={() => handleAction(`/api/review/${marketId}`)}
            variant="primary"
          />
        )}

        {status === 'processing' && (
          <>
            <p className="text-sm text-amber-700 bg-amber-50 px-4 py-2 rounded-md">
              Procesando… {iterationCount > 0 ? `(iteración ${iterationCount})` : ''}
            </p>
            <ActionButton
              label="Cancelar"
              loading={loading === 'cancel'}
              onClick={() => handleAction('cancel')}
              variant="danger"
            />
          </>
        )}

        {status === 'cancelled' && (
          <ActionButton
            label="Reanudar"
            loading={loading === 'resume'}
            onClick={() => handleAction('resume')}
            variant="primary"
          />
        )}

        {(status === 'candidate' || status === 'open') && (
          <ActionButton
            label="Rechazar"
            loading={loading === 'reject'}
            onClick={() =>
              handleAction('reject', {
                body: JSON.stringify({ reason: 'Rejected by reviewer' }),
              })
            }
            variant="danger"
          />
        )}

        {(status === 'closed' || status === 'open') && (
          <>
            <ActionButton
              label="Resolver Sí"
              loading={loading === 'resolve-si'}
              onClick={() =>
                handleAction('resolve', {
                  body: JSON.stringify({ outcome: 'Si' }),
                })
              }
              variant="primary"
            />
            <ActionButton
              label="Resolver No"
              loading={loading === 'resolve-no'}
              onClick={() =>
                handleAction('resolve', {
                  body: JSON.stringify({ outcome: 'No' }),
                })
              }
              variant="secondary"
            />
          </>
        )}

        {(ARCHIVABLE_STATUSES as readonly string[]).includes(status) && !isArchived && (
          <ActionButton
            label="Archivar"
            loading={loading === 'archive'}
            onClick={() => handleAction('archive')}
            variant="secondary"
          />
        )}

        {isArchived && (
          <ActionButton
            label="Desarchivar"
            loading={loading === 'unarchive'}
            onClick={() => handleAction('unarchive')}
            variant="secondary"
          />
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function ActionButton({
  label,
  loading,
  onClick,
  variant,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  variant: 'primary' | 'success' | 'danger' | 'secondary';
}) {
  const styles = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    success: 'bg-green-600 hover:bg-green-700 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800',
  };

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 ${styles[variant]}`}
    >
      {loading ? 'Procesando...' : label}
    </button>
  );
}
