'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 cursor-pointer"
      >
        Sugerir resolución
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Resultado:</span>
        {outcomes.map((o) => (
          <button
            key={o}
            onClick={() => setOutcome(o)}
            className={`px-3 py-1 text-xs font-medium rounded-full border cursor-pointer transition-colors ${
              outcome === o
                ? 'bg-green-100 border-green-300 text-green-700'
                : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <textarea
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="Evidencia: ¿por qué este resultado? (ej: Según [fuente], el valor fue X el día Y...)"
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 resize-none"
        rows={2}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={loading || !evidence.trim()}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 transition-colors cursor-pointer"
        >
          {loading ? 'Enviando...' : 'Sugerir'}
        </button>
        <button
          onClick={() => { setOpen(false); setEvidence(''); }}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors cursor-pointer"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
