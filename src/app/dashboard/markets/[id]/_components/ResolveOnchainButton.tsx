'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { encodeFunctionData } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';
import { PRECOG_MARKET_ABI, REPORTER_ABI, REPORTER_ADDRESSES } from '@/lib/contracts';
import { getBasescanUrl } from '@/lib/chains';
import { Button } from '@/components/ui/button';

interface Props {
  marketId: string;
  onchainId: number;
  outcome: string;
  outcomes: string[];
  marketAddress: `0x${string}`;
  chainId: number;
  reportOnly?: boolean;
}

type Step =
  | 'idle'
  | 'preview-resolve'
  | 'resolving' | 'confirming-resolve'
  | 'preview-report'
  | 'reporting' | 'confirming-report'
  | 'refreshing' | 'done' | 'error';

function TxLink({ hash, chainId }: { hash: string; chainId: number }) {
  return (
    <a href={`${getBasescanUrl(chainId)}/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline font-mono">
      {hash.slice(0, 10)}...
    </a>
  );
}

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-mono">{value}</span>
    </div>
  );
}

async function sendTx(to: `0x${string}`, data: `0x${string}`, from: `0x${string}`): Promise<`0x${string}`> {
  const ethereum = (window as unknown as { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<string> } }).ethereum;
  if (!ethereum) throw new Error('No wallet found');
  const hash = await ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from, to, data }],
  });
  return hash as `0x${string}`;
}

export function ResolveOnchainButton({ marketId, onchainId, outcome, outcomes, marketAddress, chainId, reportOnly }: Props) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!isConnected) return null;

  const outcomeIndex = outcomes.indexOf(outcome) + 1;
  if (outcomeIndex <= 0) return null;

  const reporterAddress = REPORTER_ADDRESSES[chainId];
  const basescanBase = getBasescanUrl(chainId);

  const logTx = (action: string, detail: Record<string, unknown>) =>
    fetch(`/api/markets/${marketId}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, detail }),
    });

  async function handleResolve() {
    if (!address || !publicClient) return;
    setError(null);
    setTxHash(null);

    try {
      setStep('resolving');
      const resolveData = encodeFunctionData({
        abi: PRECOG_MARKET_ABI,
        functionName: 'reportResult',
        args: [BigInt(onchainId), BigInt(outcomeIndex)],
      });
      const resolveTx = await sendTx(marketAddress, resolveData, address);
      setTxHash(resolveTx);
      setStep('confirming-resolve');
      await publicClient.waitForTransactionReceipt({ hash: resolveTx });
      await logTx('market_resolved_onchain', {
        txHash: resolveTx,
        outcome,
        outcomeIndex,
        marketAddress,
        reporterPending: !!reporterAddress,
      });

      // If reporter configured, show preview for TX2
      if (reporterAddress) {
        setTxHash(null);
        setStep('preview-report');
        return; // Wait for user to confirm TX2
      }

      // No reporter — go straight to refresh
      setStep('refreshing');
      setTxHash(null);
      await new Promise((r) => setTimeout(r, 2000));
      await fetch(`/api/markets/${marketId}/refresh?full=true`, { method: 'POST' });
      router.refresh();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    }
  }

  async function handleReport() {
    if (!address || !publicClient || !reporterAddress) return;
    setError(null);
    setTxHash(null);

    try {
      setStep('reporting');
      const reportData = encodeFunctionData({
        abi: REPORTER_ABI,
        functionName: 'reportResult',
        args: [marketAddress, BigInt(onchainId), BigInt(outcomeIndex)],
      });
      const reportTx = await sendTx(reporterAddress, reportData, address);
      setTxHash(reportTx);
      setStep('confirming-report');
      await publicClient.waitForTransactionReceipt({ hash: reportTx });
      await logTx('market_reported_onchain', {
        txHash: reportTx,
        reporterAddress,
      });

      setStep('refreshing');
      setTxHash(null);
      await new Promise((r) => setTimeout(r, 2000));
      await fetch(`/api/markets/${marketId}/refresh?full=true`, { method: 'POST' });
      router.refresh();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    }
  }

  const busy = ['resolving', 'confirming-resolve', 'reporting', 'confirming-report', 'refreshing'].includes(step);

  // Preview: TX1 resolve
  if (step === 'preview-resolve') {
    return (
      <div className="rounded-md border border-border bg-card p-3 space-y-3 text-sm">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">TX 1: Resolver mercado</p>
        <div className="space-y-1">
          <Param label="Contrato" value={`${marketAddress.slice(0, 6)}...${marketAddress.slice(-4)}`} />
          <Param label="Funcion" value="reportResult" />
          <Param label="Market ID" value={String(onchainId)} />
          <Param label="Outcome" value={`${outcomeIndex} (${outcome})`} />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleResolve} size="sm" className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600">Confirmar y firmar</Button>
          <Button onClick={() => setStep('idle')} variant="outline" size="sm">Cancelar</Button>
        </div>
      </div>
    );
  }

  // Preview: TX2 reporter
  if (step === 'preview-report' && reporterAddress) {
    return (
      <div className="rounded-md border border-border bg-card p-3 space-y-3 text-sm">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">TX 2: Reportar resultado</p>
        <div className="space-y-1">
          <Param label="Contrato" value={`${reporterAddress.slice(0, 6)}...${reporterAddress.slice(-4)}`} />
          <Param label="Funcion" value="reportResult" />
          <Param label="Market" value={`${marketAddress.slice(0, 6)}...${marketAddress.slice(-4)}`} />
          <Param label="Market ID" value={String(onchainId)} />
          <Param label="Outcome" value={`${outcomeIndex} (${outcome})`} />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleReport} size="sm" className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600">Confirmar y firmar</Button>
          <Button onClick={() => { setStep('refreshing'); fetch(`/api/markets/${marketId}/refresh?full=true`, { method: 'POST' }).then(() => { router.refresh(); setStep('done'); }); }} variant="outline" size="sm">Omitir</Button>
        </div>
      </div>
    );
  }

  // Status display during tx processing
  const label = step === 'resolving' ? 'Firmando...'
    : step === 'confirming-resolve' ? 'Confirmando resolución...'
    : step === 'reporting' ? 'Firmando reporte...'
    : step === 'confirming-report' ? 'Confirmando reporte...'
    : step === 'refreshing' ? 'Actualizando...'
    : step === 'done' ? 'Resuelto onchain'
    : step === 'error' ? 'Reintentar'
    : 'Resolve onchain';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        onClick={() => step === 'idle' || step === 'error' ? setStep(reportOnly ? 'preview-report' : 'preview-resolve') : undefined}
        disabled={busy || step === 'done'}
        variant="outline"
        size="sm"
        className="border-green-300 text-green-700 bg-green-50 hover:bg-green-100 dark:border-green-700 dark:text-green-300 dark:bg-green-900/30 dark:hover:bg-green-900/50"
      >
        {label}
      </Button>
      {txHash && <TxLink hash={txHash} chainId={chainId} />}
      {step === 'done' && <span className="text-xs text-green-600">OK</span>}
      {error && <span className="text-xs text-destructive max-w-xs truncate" title={error}>Error: {error.slice(0, 60)}</span>}
    </div>
  );
}
