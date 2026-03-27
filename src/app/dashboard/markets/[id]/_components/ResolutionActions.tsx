'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ResolutionConfirmButton({ marketId, outcome }: { marketId: string; outcome: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await fetch(`/api/markets/${marketId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      router.refresh();
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleConfirm}
      disabled={loading}
      className="px-4 py-2 text-sm font-medium rounded-md bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors cursor-pointer"
    >
      {loading ? 'Confirmando...' : `Confirmar: ${outcome}`}
    </button>
  );
}

export function ResolutionDismissButton({ marketId }: { marketId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDismiss() {
    setLoading(true);
    try {
      await fetch(`/api/markets/${marketId}/dismiss-resolution`, { method: 'POST' });
      router.refresh();
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleDismiss}
      disabled={loading}
      className="px-4 py-2 text-sm font-medium rounded-md bg-gray-200 hover:bg-gray-300 text-gray-800 disabled:opacity-50 transition-colors cursor-pointer"
    >
      {loading ? '...' : 'Descartar sugerencia'}
    </button>
  );
}
