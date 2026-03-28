'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface MarketEntry {
  id: string;
  title: string;
  category: string;
  status: string;
  endTimestamp: number;
  onchainId: string | null;
  volume: string | null;
  participants: number | null;
  resolution: { suggestedOutcome?: string; confidence?: string; flaggedAt?: string; evidenceUrls?: string[] } | null;
}

const LIVE_STATUSES = ['open'];

const STATUS_DOT: Record<string, string> = {
  open: 'bg-indigo-400',
  in_resolution: 'bg-yellow-400',
};

function formatEndDate(ts: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(ts * 1000));
}

function formatVolume(vol: string): string {
  // Volume is in smallest token unit (6 decimals for USDC)
  const n = parseFloat(vol) / 1e6;
  if (isNaN(n) || n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function timeRemaining(ts: number): string {
  const diff = ts * 1000 - Date.now();
  if (diff <= 0) return 'Cerrado';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

export function MarketList({ markets }: { markets: MarketEntry[] }) {
  const [query, setQuery] = useState('');
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const prevMarketsRef = useRef(markets);

  // Clear verifying state when markets data refreshes (new props from server)
  useEffect(() => {
    if (markets !== prevMarketsRef.current) {
      setVerifyingIds(new Set());
      prevMarketsRef.current = markets;
    }
  }, [markets]);

  async function handleCheckResolution(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setVerifyingIds((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/markets/${id}/check-resolution`, { method: 'POST' });
    } catch { /* ignore */ }
  }

  const filtered = query
    ? markets.filter((m) => m.title.toLowerCase().includes(query.toLowerCase()))
    : markets;

  const live = filtered.filter((m) => LIVE_STATUSES.includes(m.status)).sort((a, b) => a.endTimestamp - b.endTimestamp);
  const inResolution = filtered.filter((m) => m.status === 'in_resolution');

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-8">
        <h1 className="text-3xl font-bold shrink-0">Live</h1>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar mercado..."
          className="w-full max-w-md text-xl px-3 py-1.5 border-0 border-b border-gray-200 focus:border-gray-400 focus:outline-none focus:ring-0 bg-transparent placeholder:text-gray-300 transition-colors"
        />
      </div>

      {live.length === 0 && inResolution.length === 0 ? (
        <p className="text-gray-500">
          {query ? 'No hay mercados que coincidan.' : 'No hay mercados activos.'}
        </p>
      ) : (
        <div className="space-y-12">
          {inResolution.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                </span>
                <h2 className="text-sm font-medium text-amber-600 uppercase tracking-wide">
                  Pendientes de resolución ({inResolution.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {inResolution.map((m) => (
                  <MarketCard key={m.id} market={m} urgent onCheck={(e) => handleCheckResolution(m.id, e)} verifying={verifyingIds.has(m.id)} />
                ))}
              </div>
            </section>
          )}

          {live.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                  Activos ({live.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {live.map((m) => (
                  <MarketCard key={m.id} market={m} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function MarketCard({ market: m, urgent = false, onCheck, verifying }: { market: MarketEntry; urgent?: boolean; onCheck?: (e: React.MouseEvent) => void; verifying?: boolean }) {
  const dotColor = STATUS_DOT[m.status] ?? 'bg-gray-400';

  const verifyButton = urgent && onCheck ? (
    <button
      onClick={onCheck}
      disabled={verifying}
      className="px-3 py-1 text-xs font-medium rounded-md bg-amber-300 hover:bg-amber-400 text-amber-900 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
    >
      {verifying ? 'Verificando...' : 'Verificar'}
    </button>
  ) : null;

  return (
    <Link
      href={`/dashboard/markets/${m.id}`}
      className={`rounded-xl border p-6 transition-all block ${
        urgent
          ? 'bg-amber-50 border-amber-300 hover:border-amber-400 hover:shadow-md'
          : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-full h-2 w-2 shrink-0 ${urgent ? 'bg-amber-500' : dotColor}`} />
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            urgent ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {m.category}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {m.onchainId && (
            <span className="text-[10px] font-mono text-gray-400">#{m.onchainId}</span>
          )}
          {!urgent && (
            <span className="text-xs text-gray-500">
              {timeRemaining(m.endTimestamp)}
            </span>
          )}
        </div>
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-3 line-clamp-3">
        {m.title}
      </h2>
      {(m.resolution?.suggestedOutcome || verifyButton) && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-200">
          {m.resolution?.suggestedOutcome ? (
            <>
              <span className="text-sm font-medium text-amber-800">
                Resolución: {m.resolution.suggestedOutcome}
              </span>
              {m.resolution.evidenceUrls?.[0] ? (
                <a
                  href={m.resolution.evidenceUrls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] text-blue-600 hover:underline truncate max-w-[150px]"
                >
                  {new URL(m.resolution.evidenceUrls[0]).hostname.replace('www.', '')}
                </a>
              ) : (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                  m.resolution.confidence === 'high' ? 'bg-green-100 text-green-700' :
                  m.resolution.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {m.resolution.confidence === 'high' ? 'Alta' :
                   m.resolution.confidence === 'medium' ? 'Media' : 'Baja'}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-amber-600">Sin resolución sugerida</span>
          )}
          {verifyButton && <span className="ml-auto">{verifyButton}</span>}
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-gray-500 pt-3 border-t border-gray-100">
        <span className="text-xs text-gray-400">Cierre: {formatEndDate(m.endTimestamp)}</span>
        <div className="flex items-center gap-4 ml-auto">
          {m.volume && (
            <span className="font-medium" title="Volumen">${formatVolume(m.volume)}</span>
          )}
          {m.participants != null && m.participants > 0 && (
            <span title="Participantes">{m.participants} participante{m.participants !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
