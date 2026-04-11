'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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
    <Button
      onClick={handleConfirm}
      disabled={loading}
      size="sm"
      className="bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600"
    >
      {loading ? 'Confirmando...' : `Confirmar: ${outcome}`}
    </Button>
  );
}

export function ResolutionDiscardButton({ marketId }: { marketId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDiscard() {
    setLoading(true);
    try {
      await fetch(`/api/markets/${marketId}/dismiss-resolution`, { method: 'POST' });
      router.refresh();
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      onClick={handleDiscard}
      disabled={loading}
      variant="ghost"
      size="sm"
    >
      {loading ? '...' : 'Descartar'}
    </Button>
  );
}

export function ResolutionFeedbackButton({ marketId }: { marketId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!feedback.trim()) return;
    setLoading(true);
    try {
      await fetch(`/api/markets/${marketId}/dismiss-resolution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      router.refresh();
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        variant="secondary"
        size="sm"
      >
        Reconsiderar
      </Button>
    );
  }

  return (
    <div className="flex-1 space-y-2">
      <Textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="¿Por qué debería reconsiderarse? (ej: la fuente no es confiable, el dato cambió...)"
        className="resize-none focus-visible:ring-amber-400"
        rows={2}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Button
          onClick={handleSubmit}
          disabled={loading || !feedback.trim()}
          size="sm"
          className="bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-600 dark:hover:bg-amber-500"
        >
          {loading ? 'Enviando...' : 'Enviar y re-evaluar'}
        </Button>
        <Button
          onClick={() => { setOpen(false); setFeedback(''); }}
          variant="ghost"
          size="sm"
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
