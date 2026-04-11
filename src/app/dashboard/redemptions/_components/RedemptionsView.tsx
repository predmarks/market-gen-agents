'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface LiquidityMarket {
  marketAddress: string;
  onchainId: string;
  marketName: string;
  resolvedTo: number;
  unredeemedCount: number;
  totalUnredeemedShares: string;
  totalUnredeemedInvested: string;
  positions: { id: string; account: string; shares: string; invested: string; lastEventTimestamp: number }[];
  dbId?: string;
  dbTitle?: string;
  outcomes: string[];
  pendingBalance?: string | null;
  withdrawal: { ownershipTransferredAt?: string; withdrawnAt?: string } | null;
}

interface Props {
  markets: LiquidityMarket[];
  ownedAddresses: string[];
  basescanUrl: string;
}

function formatUsdc(raw: string): string {
  const n = Number(raw) / 1e6;
  if (n === 0) return '$0';
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function addr(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

// --- Modal ---

function OwnedAddressesModal({
  addresses,
  onClose,
}: {
  addresses: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [list, setList] = useState<string[]>(addresses);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const val = input.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(val)) {
      setError('Dirección inválida (debe ser 0x + 40 hex chars)');
      return;
    }
    if (list.includes(val)) {
      setError('Dirección ya agregada');
      return;
    }
    setList([...list, val]);
    setInput('');
    setError(null);
  }

  function handleRemove(addr: string) {
    setList(list.filter((a) => a !== addr));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/config/owned-addresses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: list }),
      });
      if (!res.ok) throw new Error('Failed to save');
      router.refresh();
      onClose();
    } catch {
      setError('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      {/* Modal */}
      <div className="relative bg-card rounded-lg border border-border shadow-lg w-full max-w-md mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Direcciones propias</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer text-lg leading-none">&times;</button>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Las posiciones de estas direcciones se muestran por separado y no cuentan como retiros pendientes.
        </p>

        {/* Address list */}
        {list.length > 0 ? (
          <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
            {list.map((a) => (
              <div key={a} className="flex items-center justify-between bg-muted rounded px-2 py-1">
                <span className="text-xs font-mono text-foreground">{a}</span>
                <button
                  onClick={() => handleRemove(a)}
                  className="text-destructive/60 hover:text-destructive text-xs cursor-pointer ml-2"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/60 mb-3">Sin direcciones configuradas.</p>
        )}

        {/* Add input */}
        <div className="flex gap-2 mb-3">
          <Input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="0x..."
            className="flex-1 text-xs font-mono"
          />
          <Button variant="secondary" size="sm" onClick={handleAdd}>
            Agregar
          </Button>
        </div>

        {error && <p className="text-xs text-destructive mb-3">{error}</p>}

        {/* Save */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Positions table ---

function PositionsTable({
  positions,
  basescanUrl,
  muted,
}: {
  positions: LiquidityMarket['positions'];
  basescanUrl: string;
  muted?: boolean;
}) {
  if (positions.length === 0) return null;
  const textClass = muted ? 'text-muted-foreground/60' : 'text-foreground';
  const linkClass = muted ? 'text-muted-foreground/60 hover:text-muted-foreground' : 'text-blue-600 dark:text-blue-400 hover:underline';

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground/60 border-b border-border">
          <th className="px-4 py-1.5 font-medium">Cuenta</th>
          <th className="px-4 py-1.5 font-medium text-right">Shares</th>
          <th className="px-4 py-1.5 font-medium text-right">Invertido</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {positions.map((p) => (
          <tr key={p.id} className="hover:bg-muted">
            <td className="px-4 py-1.5">
              <a
                href={`${basescanUrl}/address/${p.account}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn('font-mono', linkClass)}
              >
                {addr(p.account)}
              </a>
            </td>
            <td className={cn('px-4 py-1.5 text-right font-mono', textClass)}>
              {formatUsdc(p.shares)}
            </td>
            <td className={cn('px-4 py-1.5 text-right font-mono', textClass)}>
              {formatUsdc(p.invested)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Main view ---

export function RedemptionsView({ markets, ownedAddresses, basescanUrl }: Props) {
  const [showModal, setShowModal] = useState(false);
  const ownedSet = useMemo(() => new Set(ownedAddresses.map((a) => a.toLowerCase())), [ownedAddresses]);

  // Split positions per market into external vs owned
  const filtered = useMemo(() => {
    return markets.map((m) => {
      const external = m.positions.filter((p) => !ownedSet.has(p.account.toLowerCase()));
      const owned = m.positions.filter((p) => ownedSet.has(p.account.toLowerCase()));
      return { ...m, external, owned };
    });
  }, [markets, ownedSet]);

  const hasAnyOwned = filtered.some((m) => m.owned.length > 0);
  const [showOwned, setShowOwned] = useState(false);

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Liquidity</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowModal(true)}
        >
          Direcciones propias{ownedAddresses.length > 0 ? ` (${ownedAddresses.length})` : ''}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        {filtered.length === 0
          ? 'No hay mercados con liquidez o retiros pendientes.'
          : `${filtered.length} mercado${filtered.length !== 1 ? 's' : ''} con liquidez o retiros pendientes.`}
      </p>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground/60">Sin pendientes</div>
      ) : (
        <>
          <div className="space-y-4">
            {filtered.map((s) => {
              const resolvedOutcome = s.outcomes.length >= s.resolvedTo && s.resolvedTo > 0
                ? s.outcomes[s.resolvedTo - 1]
                : s.resolvedTo > 0 ? `#${s.resolvedTo}` : null;

              const hasPendingBalance = s.pendingBalance && parseFloat(s.pendingBalance) > 0;
              const withdrawalStatus = s.withdrawal?.withdrawnAt
                ? 'withdrawn'
                : s.withdrawal?.ownershipTransferredAt
                ? 'in_progress'
                : 'pending';

              return (
                <div key={s.onchainId || s.marketAddress} className="bg-card rounded-lg border border-border">
                  <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {s.dbId ? (
                        <Link href={`/dashboard/markets/${s.dbId}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium text-sm">
                          {s.dbTitle ?? s.marketName}
                        </Link>
                      ) : (
                        <span className="text-foreground font-medium text-sm">{s.marketName}</span>
                      )}
                      {s.marketAddress && (
                        <span className="block text-xs text-muted-foreground/60 font-mono mt-0.5">{addr(s.marketAddress)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {resolvedOutcome && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          {resolvedOutcome}
                        </span>
                      )}
                      {hasPendingBalance && (
                        <span className="text-xs text-foreground font-mono font-semibold">
                          {formatUsdc(s.pendingBalance!)}
                        </span>
                      )}
                      {hasPendingBalance && withdrawalStatus === 'in_progress' && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          Retiro en progreso
                        </span>
                      )}
                      {hasPendingBalance && withdrawalStatus === 'pending' && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          Liquidez pendiente
                        </span>
                      )}
                      {s.external.length > 0 && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
                          {s.external.length} sin redimir
                        </span>
                      )}
                      {s.owned.length > 0 && (
                        <span className="text-xs text-muted-foreground/60">
                          +{s.owned.length} propias
                        </span>
                      )}
                    </div>
                  </div>
                  {s.external.length > 0 && (
                    <PositionsTable positions={s.external} basescanUrl={basescanUrl} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Owned-only section */}
          {hasAnyOwned && (
            <div className="mt-6">
              <button
                onClick={() => setShowOwned(!showOwned)}
                className="text-xs text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
              >
                {showOwned ? '▼' : '▶'} Direcciones propias ({filtered.reduce((s, m) => s + m.owned.length, 0)} posiciones en {filtered.filter((m) => m.owned.length > 0).length} mercados)
              </button>

              {showOwned && (
                <div className="space-y-3 mt-3">
                  {filtered.filter((m) => m.owned.length > 0).map((s) => {
                    const resolvedOutcome = s.outcomes.length >= s.resolvedTo && s.resolvedTo > 0
                      ? s.outcomes[s.resolvedTo - 1]
                      : s.resolvedTo > 0 ? `#${s.resolvedTo}` : null;

                    return (
                      <div key={`owned-${s.onchainId || s.marketAddress}`} className="bg-muted rounded-lg border border-border">
                        <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-4">
                          <span className="text-xs text-muted-foreground truncate">
                            {s.dbTitle ?? s.marketName}
                          </span>
                          <span className="text-xs text-muted-foreground/60">
                            {resolvedOutcome ?? '—'} — {s.owned.length} posicion{s.owned.length !== 1 ? 'es' : ''}
                          </span>
                        </div>
                        <PositionsTable positions={s.owned} basescanUrl={basescanUrl} muted />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {showModal && (
        <OwnedAddressesModal
          addresses={ownedAddresses}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
