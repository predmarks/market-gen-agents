'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface Props {
  marketId: string;
  outcomes: string[];
}

export function SuggestResolutionButton({ marketId, outcomes }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(outcomes[0] ?? '');
  const [evidence, setEvidence] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!evidence.trim() || !outcome) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/markets/${marketId}/suggest-resolution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestedOutcome: outcome, evidence: evidence.trim() }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        variant="outline"
        size="sm"
      >
        Sugerir resolución
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Resultado:</span>
        {outcomes.map((o) => (
          <Button
            key={o}
            onClick={() => setOutcome(o)}
            variant="outline"
            size="sm"
            className={cn(
              'rounded-full',
              outcome === o
                ? 'bg-green-100 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300'
                : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
            )}
          >
            {o}
          </Button>
        ))}
      </div>
      <Textarea
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="Evidencia: ¿por qué este resultado? (ej: Según [fuente], el valor fue X el día Y...)"
        className="resize-none focus-visible:ring-amber-400"
        rows={2}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Button
          onClick={handleSubmit}
          disabled={loading || !evidence.trim()}
          size="sm"
          className="bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-600 dark:hover:bg-amber-500"
        >
          {loading ? 'Enviando...' : 'Sugerir'}
        </Button>
        <Button
          onClick={() => { setOpen(false); setEvidence(''); }}
          variant="ghost"
          size="sm"
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
