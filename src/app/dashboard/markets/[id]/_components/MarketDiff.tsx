'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { zeroAddress } from 'viem';
import { PRECOG_MASTER_ABI, MASTER_ADDRESSES } from '@/lib/contracts';
import { getBasescanUrl } from '@/lib/chains';
import { Button } from '@/components/ui/button';
import { CopyJsonButton } from './CopyJsonButton';
import { DiffTextAdded, DiffTextRemoved } from '@/app/_components/WordDiff';

interface OnchainData {
  name: string;
  description: string;
  category: string;
  outcomes: string[];
  endTimestamp: number;
}

interface Props {
  marketId: string;
  onchainId: number;
  title: string;
  description: string;
  category: string;
  outcomes: string[];
  endTimestamp: number;
  onchainData: OnchainData | null;
}

// --- Diff computation ---

interface FieldDiff {
  label: string;
  local: string;
  chain: string;
  isText: boolean; // true = use inline word diff, false = side-by-side
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const parts = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

function computeDiffs(props: Props): FieldDiff[] {
  const { onchainData } = props;
  if (!onchainData) return [];

  const diffs: FieldDiff[] = [];

  if (props.title !== onchainData.name) {
    diffs.push({ label: 'Titulo', local: props.title, chain: onchainData.name, isText: true });
  }
  if (props.description !== onchainData.description) {
    diffs.push({
      label: 'Descripcion',
      local: props.description || '(vacio)',
      chain: onchainData.description || '(vacio)',
      isText: true,
    });
  }
  if (props.category !== onchainData.category) {
    diffs.push({ label: 'Categoria', local: props.category, chain: onchainData.category, isText: false });
  }
  if (JSON.stringify(props.outcomes) !== JSON.stringify(onchainData.outcomes)) {
    diffs.push({
      label: 'Opciones',
      local: props.outcomes.join(', '),
      chain: onchainData.outcomes.join(', '),
      isText: false,
    });
  }
  if (props.endTimestamp !== onchainData.endTimestamp) {
    diffs.push({
      label: 'Fecha de cierre',
      local: formatDate(props.endTimestamp),
      chain: formatDate(onchainData.endTimestamp),
      isText: true,
    });
  }

  return diffs;
}

function buildPatchJson(props: Props, diffs: FieldDiff[]): string {
  if (diffs.length === 0) return '{}';
  const patch: Record<string, unknown> = {};
  for (const d of diffs) {
    if (d.label === 'Titulo') patch.name = props.title;
    if (d.label === 'Descripcion') patch.description = props.description;
    if (d.label === 'Categoria') patch.category = props.category;
    if (d.label === 'Opciones') patch.outcomes = props.outcomes;
    if (d.label === 'Fecha de cierre') patch.endTimestamp = props.endTimestamp;
  }
  return JSON.stringify({ [String(props.onchainId)]: patch }, null, 4);
}

// --- Component ---

export function MarketDiff(props: Props) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const masterAddress = MASTER_ADDRESSES[chainId];

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const [showPreview, setShowPreview] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  async function handleDiscard() {
    setDiscarding(true);
    try {
      await fetch(`/api/markets/${props.marketId}/refresh?full=true`, { method: 'POST' });
      window.location.reload();
    } catch {
      setDiscarding(false);
    }
  }

  useEffect(() => {
    if (!isSuccess) return;
    setShowPreview(false);
    const timer = setTimeout(async () => {
      // Log the onchain update
      await fetch(`/api/markets/${props.marketId}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'market_updated_onchain',
          detail: { txHash: hash, fields: computeDiffs(props).map((d) => d.label) },
        }),
      }).catch(() => {});
      await fetch(`/api/markets/${props.marketId}/refresh?full=true`, { method: 'POST' });
      router.refresh();
    }, 2000);
    return () => clearTimeout(timer);
  }, [isSuccess, hash, props, router]);

  const diffs = computeDiffs(props);

  if (!isConnected || !masterAddress || diffs.length === 0) return null;

  function handleUpdate() {
    setShowPreview(false);
    writeContract({
      address: masterAddress,
      abi: PRECOG_MASTER_ABI,
      functionName: 'updateMarket',
      args: [
        BigInt(props.onchainId),
        props.title,
        props.description,
        props.category,
        props.outcomes,
        BigInt(0),
        BigInt(props.endTimestamp),
        zeroAddress,
        zeroAddress,
      ],
    });
  }

  const truncate = (s: string, n = 50) => s.length > n ? s.slice(0, n) + '...' : s;

  return (
    <details className="mb-4 rounded-md border border-amber-200 bg-amber-50/30 group">
      <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground group-open:rotate-90 transition-transform">&#9654;</span>
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wide">Diff Local / Onchain</span>
          <span className="text-[10px] text-amber-500">{diffs.length} diferencia{diffs.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            onClick={handleDiscard}
            disabled={discarding || isPending || isConfirming}
            variant="outline"
            size="sm"
          >
            {discarding ? 'Descartando...' : 'Descartar'}
          </Button>
          <Button
            onClick={() => isPending || isConfirming ? undefined : showPreview ? handleUpdate() : setShowPreview(true)}
            disabled={isPending || isConfirming}
            variant="outline"
            size="sm"
            className="border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-700 dark:text-indigo-300 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50"
          >
            {isPending ? 'Firmando...' : isConfirming ? 'Confirmando...' : 'Update onchain'}
          </Button>
          {hash && (isPending || isConfirming) && (
            <a href={`${getBasescanUrl(chainId)}/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline font-mono">
              {hash.slice(0, 10)}...
            </a>
          )}
          {isSuccess && <span className="text-xs text-green-600">Confirmado</span>}
          {error && <span className="text-xs text-destructive max-w-xs truncate" title={error.message}>Error</span>}
        </div>
      </summary>

      <div className="px-4 pb-3 space-y-3">
        {/* Tx preview panel */}
        {showPreview && (
          <div className="rounded-md border border-border bg-card p-3 space-y-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Verificar transaccion</p>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Contrato</span><span className="font-mono text-foreground">{masterAddress.slice(0, 6)}...{masterAddress.slice(-4)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Funcion</span><span className="font-mono text-foreground">updateMarket</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Market ID</span><span className="font-mono text-foreground">{props.onchainId}</span></div>
              {diffs.map((d) => (
                <div key={d.label} className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">{d.label}</span><span className="text-foreground text-right truncate">{truncate(d.local)}</span></div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={handleUpdate} size="sm" className="bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600">Confirmar y firmar</Button>
              <Button onClick={() => setShowPreview(false)} variant="outline" size="sm">Cancelar</Button>
            </div>
          </div>
        )}

        {diffs.map((d) => (
          <div key={d.label}>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{d.label}</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <div className="rounded bg-card border border-blue-100 dark:border-blue-900 px-2 py-1.5">
                <span className="text-[10px] text-blue-400 block mb-0.5">Local</span>
                {d.isText
                  ? <DiffTextAdded a={d.chain} b={d.local} />
                  : <span className="text-sm text-foreground">{d.local}</span>
                }
              </div>
              <div className="rounded bg-card border border-border px-2 py-1.5">
                <span className="text-[10px] text-muted-foreground block mb-0.5">Onchain</span>
                {d.isText
                  ? <DiffTextRemoved a={d.chain} b={d.local} />
                  : <span className="text-sm text-foreground">{d.chain}</span>
                }
              </div>
            </div>
          </div>
        ))}

        {/* Patch JSON */}
        <details open className="group/json">
          <summary className="text-[10px] text-muted-foreground cursor-pointer list-none flex items-center gap-1">
            <span className="group-open/json:rotate-90 transition-transform">&#9654;</span>
            Patch JSON
          </summary>
          <div className="mt-1 relative">
            <pre className="text-[11px] bg-muted text-foreground border border-border rounded p-3 overflow-x-auto">{buildPatchJson(props, diffs)}</pre>
            <div className="absolute top-2 right-2">
              <CopyJsonButton json={buildPatchJson(props, diffs)} />
            </div>
          </div>
        </details>
      </div>
    </details>
  );
}
