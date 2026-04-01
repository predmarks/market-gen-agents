'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  marketId: string;
  checkingAt?: string;
}

export function CheckResolutionTrigger({ marketId, checkingAt }: Props) {
  const router = useRouter();
  const isRecentlyChecking = checkingAt && (Date.now() - new Date(checkingAt).getTime() < 10 * 60 * 1000);
  const [status, setStatus] = useState<'idle' | 'loading' | 'triggered' | 'error'>(isRecentlyChecking ? 'triggered' : 'idle');

  async function trigger() {
    setStatus('loading');
    try {
      const res = await fetch(`/api/markets/${marketId}/check-resolution`, { method: 'POST' });
      if (res.ok) {
        setStatus('triggered');
        // Poll for resolution to appear (check every 10s for 5 min)
        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          if (attempts > 30) { clearInterval(interval); return; }
          router.refresh();
        }, 10000);
        return () => clearInterval(interval);
      } else {
        const data = await res.json().catch(() => ({}));
        // Already triggered recently — still show as triggered
        if (res.status === 409 || data.error?.includes('already')) {
          setStatus('triggered');
        } else {
          setStatus('error');
        }
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-bold">En resolución</h2>
        <p className="text-sm text-gray-600 mt-1">
          {status === 'loading' ? 'Lanzando verificación...' :
           status === 'triggered' ? 'Verificación en curso. La página se actualizará automáticamente.' :
           status === 'error' ? 'Error al lanzar verificación.' :
           'Este mercado está en período de resolución.'}
        </p>
      </div>
      {(status === 'idle' || status === 'error') && (
        <button
          onClick={trigger}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 text-amber-700 bg-amber-100 hover:bg-amber-200 cursor-pointer"
        >
          Verificar resolución
        </button>
      )}
      {status === 'loading' && (
        <span className="text-xs text-amber-600 animate-pulse">Procesando...</span>
      )}
      {status === 'triggered' && (
        <span className="text-xs text-green-600 animate-pulse">Esperando resultado...</span>
      )}
    </div>
  );
}
