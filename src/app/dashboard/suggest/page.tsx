'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const REQUIRED_FIELDS = [
  'title', 'description', 'resolutionCriteria', 'resolutionSource',
  'category', 'endTimestamp', 'tags', 'expectedResolutionDate',
];

const PLACEHOLDER = `({
  title: "¿Milei va a vetar la ley de presupuesto 2026?",
  description: "Contexto...",
  resolutionCriteria: "Se resuelve Sí si...",
  resolutionSource: "Boletín Oficial",
  category: "Política",
  endTimestamp: Math.floor(new Date("2026-04-13").getTime() / 1000),
  tags: ["milei", "presupuesto"],
  expectedResolutionDate: "2026-04-13",
})`;

interface MarketPayload {
  title: string;
  description: string;
  resolutionCriteria: string;
  resolutionSource: string;
  category: string;
  endTimestamp: number;
  contingencies?: string;
  tags: string[];
  expectedResolutionDate: string;
}

export default function SuggestPage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<MarketPayload | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPreview(null);
    setExpanded(false);

    // Parse JS expression client-side
    let parsed: Record<string, unknown>;
    try {
      parsed = new Function(`return (${input})`)() as Record<string, unknown>;
    } catch {
      setError('Expresión inválida — usá sintaxis JS (objeto literal)');
      setLoading(false);
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      setError('La expresión debe devolver un objeto');
      setLoading(false);
      return;
    }

    // Check which required fields are missing
    const missing = REQUIRED_FIELDS.filter((f) => {
      const val = parsed[f];
      return val === undefined || val === null || val === '';
    });

    if (missing.length === 0) {
      // All fields present — no LLM needed
      setPreview(parsed as unknown as MarketPayload);
      setLoading(false);
      return;
    }

    // Call LLM to fill missing fields only
    try {
      const res = await fetch('/api/markets/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partial: parsed }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al completar campos');
      }

      const result = await res.json();
      setPreview(result as MarketPayload);
      setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);

    try {
      const createRes = await fetch('/api/markets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preview),
      });

      if (!createRes.ok) {
        const data = await createRes.json();
        throw new Error(data.error || 'Error al crear el mercado');
      }

      const market = await createRes.json();

      const reviewRes = await fetch(`/api/review/${market.id}`, {
        method: 'POST',
      });

      if (!reviewRes.ok) {
        const data = await reviewRes.json();
        throw new Error(data.error || 'Error al iniciar revisión');
      }

      router.push(`/dashboard/markets/${market.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Sugerir mercado</h1>

      <form onSubmit={handleGenerate} className="space-y-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={12}
          placeholder={PLACEHOLDER}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
        />

        <p className="text-xs text-gray-500">
          Acepta expresiones JS. Los campos faltantes se completan con IA.
        </p>

        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="w-full px-4 py-2 text-sm font-medium rounded-md bg-gray-800 hover:bg-gray-900 text-white disabled:opacity-50 transition-colors"
        >
          {loading ? 'Procesando...' : 'Generar preview'}
        </button>
      </form>

      {error && (
        <p className="mt-4 text-sm text-red-600 bg-red-50 rounded-md px-4 py-2">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-6 space-y-4">
          {expanded && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-2">
              Algunos campos fueron completados por IA. Revisá antes de enviar.
            </p>
          )}

          <div className="border border-gray-200 rounded-md p-4 space-y-3 bg-white">
            <div>
              <label className="text-xs font-medium text-gray-500">Título</label>
              <p className="text-sm font-medium">{preview.title}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Descripción</label>
              <p className="text-sm text-gray-700">{preview.description}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Criterios de resolución</label>
              <p className="text-sm text-gray-700">{preview.resolutionCriteria}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500">Fuente</label>
                <p className="text-sm text-gray-700">{preview.resolutionSource}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Categoría</label>
                <p className="text-sm text-gray-700">{preview.category}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500">Cierre</label>
                <p className="text-sm text-gray-700">
                  {new Date(preview.endTimestamp * 1000).toLocaleDateString('es-AR')}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Resolución esperada</label>
                <p className="text-sm text-gray-700">{preview.expectedResolutionDate}</p>
              </div>
            </div>
            {preview.contingencies && (
              <div>
                <label className="text-xs font-medium text-gray-500">Contingencias</label>
                <p className="text-sm text-gray-700">{preview.contingencies}</p>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-gray-500">Tags</label>
              <div className="flex gap-1 mt-1">
                {preview.tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 text-xs bg-gray-100 rounded-full text-gray-600">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Enviando...' : 'Enviar a revisión'}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
