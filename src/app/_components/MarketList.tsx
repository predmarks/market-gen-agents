'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { MAINNET_CHAIN_ID } from '@/lib/chains';
import { strip } from '@/lib/strip-diacritics';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface MarketEntry {
  id: string;
  title: string;
  category: string;
  status: string;
  endTimestamp: number;
  onchainId: string | null;
  volume: string | null;
  participants: number | null;
  resolution: { suggestedOutcome?: string; confidence?: string; flaggedAt?: string; evidenceUrls?: string[]; checkingAt?: string } | null;
  pendingBalance: string | null;
  outcome: string | null;
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
  }).format(new Date(ts * 1000));
}

function formatVolume(vol: string): string {
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

export function MarketList({ markets, chainId }: { markets: MarketEntry[]; chainId: number }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number } | null>(null);
  const prevMarketsRef = useRef(markets);

  const isTestnet = chainId !== MAINNET_CHAIN_ID;

  useEffect(() => {
    if (markets !== prevMarketsRef.current) {
      setVerifyingIds(new Set());
      prevMarketsRef.current = markets;
    }
  }, [markets]);

  useEffect(() => {
    setSyncing(true);
    fetch('/api/sync-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainId }),
    })
      .then(async (res) => {
        if (res.ok) {
          const result = await res.json();
          setSyncResult(result);
          if (result.created > 0 || result.updated > 0) {
            router.refresh();
          }
        }
      })
      .catch(() => {})
      .finally(() => setSyncing(false));
  }, [router, chainId]);

  async function handleCheckResolution(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setVerifyingIds((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/markets/${id}/check-resolution`, { method: 'POST' });
    } catch { /* ignore */ }
  }

  const filtered = query
    ? markets.filter((m) => strip(m.title).includes(strip(query)))
    : markets;

  const live = filtered.filter((m) => LIVE_STATUSES.includes(m.status)).sort((a, b) => a.endTimestamp - b.endTimestamp);
  const inResolution = filtered.filter((m) => m.status === 'in_resolution');
  const resolved = filtered.filter((m) => m.status === 'closed');

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-3xl font-bold">Live</h1>
          {isTestnet && (
            <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">Testnet</Badge>
          )}
          {syncing && (
            <span className="text-xs text-muted-foreground animate-pulse">Sincronizando...</span>
          )}
          {!syncing && syncResult && (syncResult.created > 0 || syncResult.updated > 0) && (
            <span className="text-xs text-green-600 dark:text-green-400">
              {syncResult.created > 0 && `+${syncResult.created} nuevos`}
              {syncResult.created > 0 && syncResult.updated > 0 && ', '}
              {syncResult.updated > 0 && `${syncResult.updated} actualizados`}
            </span>
          )}
        </div>
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar mercado..."
          className="max-w-md text-xl border-0 border-b border-border rounded-none bg-transparent focus-visible:ring-0 focus-visible:border-foreground"
        />
      </div>

      {live.length === 0 && inResolution.length === 0 && resolved.length === 0 ? (
        <p className="text-muted-foreground">
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
                <h2 className="text-sm font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">
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
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
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

          {resolved.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500" />
                </span>
                <h2 className="text-sm font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wide">
                  Resueltos ({resolved.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {resolved.map((m) => (
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
  const router = useRouter();
  const dotColor = STATUS_DOT[m.status] ?? 'bg-gray-400 dark:bg-gray-600';
  const isChecking = verifying || (m.resolution?.checkingAt && Date.now() - new Date(m.resolution.checkingAt).getTime() < 10 * 60 * 1000);

  const verifyButton = urgent && onCheck ? (
    <Button
      onClick={onCheck}
      disabled={!!isChecking}
      size="sm"
      className="bg-amber-300 hover:bg-amber-400 text-amber-900 dark:bg-amber-600 dark:hover:bg-amber-500 dark:text-amber-50 shrink-0"
    >
      {isChecking ? 'Verificando...' : 'Verificar'}
    </Button>
  ) : null;

  return (
    <Card
      onClick={() => router.push(`/dashboard/markets/${m.id}`)}
      role="link"
      className={cn(
        'p-6 transition-all cursor-pointer',
        urgent
          ? 'bg-amber-50 border-amber-300 hover:border-amber-400 hover:shadow-md dark:bg-amber-950/30 dark:border-amber-700 dark:hover:border-amber-600'
          : 'hover:border-blue-300 hover:shadow-md dark:hover:border-blue-700'
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex rounded-full h-2 w-2 shrink-0', urgent ? 'bg-amber-500' : dotColor)} />
          <Badge variant={urgent ? 'processing' : 'secondary'} className={urgent ? '' : undefined}>
            {m.category}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {m.onchainId && (
            <span className="text-[10px] font-mono text-muted-foreground">#{m.onchainId}</span>
          )}
          {!urgent && (
            <span className="text-xs text-muted-foreground">
              {timeRemaining(m.endTimestamp)}
            </span>
          )}
        </div>
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-3 line-clamp-3">
        {m.title}
      </h2>
      {(m.resolution?.suggestedOutcome || verifyButton) && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800">
          {m.resolution?.suggestedOutcome ? (
            <>
              <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Resolución: {m.resolution.suggestedOutcome}
              </span>
              {m.resolution.evidenceUrls?.[0] ? (
                <a
                  href={m.resolution.evidenceUrls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] text-blue-600 hover:underline truncate max-w-[150px] dark:text-blue-400"
                >
                  {new URL(m.resolution.evidenceUrls[0]).hostname.replace('www.', '')}
                </a>
              ) : (
                <Badge className={cn(
                  m.resolution.confidence === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                  m.resolution.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                  'bg-muted text-muted-foreground'
                )}>
                  {m.resolution.confidence === 'high' ? 'Alta' :
                   m.resolution.confidence === 'medium' ? 'Media' : 'Baja'}
                </Badge>
              )}
            </>
          ) : (
            <span className="text-sm text-amber-600 dark:text-amber-400">Sin resolución sugerida</span>
          )}
          {verifyButton && <span className="ml-auto">{verifyButton}</span>}
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-muted-foreground pt-3 border-t border-border">
        <span className="text-xs text-muted-foreground">
          {m.status === 'closed' && m.outcome ? `Resultado: ${m.outcome}` : `Cierre: ${formatEndDate(m.endTimestamp)}`}
        </span>
        <div className="flex items-center gap-4 ml-auto">
          {m.pendingBalance && parseFloat(m.pendingBalance) > 0 ? (
            <span className={cn('font-medium', m.status === 'closed' && 'text-amber-600 dark:text-amber-400')} title={m.status === 'closed' ? 'Liquidez pendiente' : 'Liquidez'}>
              {m.status === 'closed' ? 'Liquidez pendiente ' : ''}${formatVolume(m.pendingBalance)}
            </span>
          ) : m.volume ? (
            <span className="font-medium" title="Volumen">${formatVolume(m.volume)}</span>
          ) : null}
          {m.participants != null && m.participants > 0 && (
            <span title="Participantes">{m.participants} participante{m.participants !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
