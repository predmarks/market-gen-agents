'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { encodeFunctionData } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';
import { PRECOG_MASTER_ABI, PRECOG_MARKET_ABI, ERC20_ABI, MASTER_ADDRESSES } from '@/lib/contracts';
import { getBasescanUrl } from '@/lib/chains';
import { Button } from '@/components/ui/button';
import type { WithdrawalProgress } from '@/db/types';

interface Props {
  marketId: string;
  onchainId: number;
  marketAddress: `0x${string}`;
  chainId: number;
  withdrawal?: WithdrawalProgress | null;
  balanceLabel?: string;
  hasUnredeemedWinners?: boolean;
}

type Step =
  | 'idle'
  | 'checking'
  | 'preview-transfer' | 'transferring' | 'confirming-transfer'
  | 'preview-withdraw' | 'withdrawing' | 'confirming-withdraw'
  | 'preview-return' | 'returning' | 'confirming-return'
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

function addr(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

// Derive stepper state from both persisted withdrawal progress and live step
function getStepperState(step: Step, withdrawal?: WithdrawalProgress | null) {
  const TRANSFER_ACTIVE_STEPS: Step[] = ['checking', 'preview-transfer', 'transferring', 'confirming-transfer'];
  const TRANSFER_DONE_STEPS: Step[] = ['preview-withdraw', 'withdrawing', 'confirming-withdraw', 'refreshing', 'done'];
  const WITHDRAW_ACTIVE_STEPS: Step[] = ['preview-withdraw', 'withdrawing', 'confirming-withdraw'];
  const WITHDRAW_DONE_STEPS: Step[] = ['refreshing', 'done'];

  const step1Done = !!withdrawal?.ownershipTransferredAt || TRANSFER_DONE_STEPS.includes(step);
  const step1Active = TRANSFER_ACTIVE_STEPS.includes(step) && !step1Done;
  const step1Busy = step === 'transferring' || step === 'confirming-transfer' || step === 'checking';

  const step2Done = !!withdrawal?.withdrawnAt || WITHDRAW_DONE_STEPS.includes(step);
  const step2Active = WITHDRAW_ACTIVE_STEPS.includes(step) && !step2Done;
  const step2Busy = step === 'withdrawing' || step === 'confirming-withdraw';

  return { step1Done, step1Active, step1Busy, step2Done, step2Active, step2Busy };
}

export function WithdrawLiquidityButton({ marketId, onchainId, marketAddress, chainId, withdrawal, balanceLabel, hasUnredeemedWinners }: Props) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [tokenAddress, setTokenAddress] = useState<`0x${string}` | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  const masterAddress = MASTER_ADDRESSES[chainId];
  const basescanBase = getBasescanUrl(chainId);

  // Auto-resume: if ownership transferred but not withdrawn, go to preview-withdraw
  useEffect(() => {
    if (withdrawal?.ownershipTransferredAt && !withdrawal?.withdrawnAt && step === 'idle') {
      if (withdrawal.tokenAddress) {
        setTokenAddress(withdrawal.tokenAddress as `0x${string}`);
      }
    }
  }, [withdrawal, step]);

  // Reset done state when new liquidity is detected
  useEffect(() => {
    if (balanceLabel && step === 'done') setStep('idle');
  }, [balanceLabel, step]);

  if (!isConnected || !address) return null;

  const logTx = (action: string, detail: Record<string, unknown>) =>
    fetch(`/api/markets/${marketId}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, detail }),
    });

  async function handleCheck() {
    if (!publicClient) return;
    setError(null);
    setStep('checking');

    try {
      const [closeTs, owner, token] = await Promise.all([
        publicClient.readContract({
          address: marketAddress,
          abi: PRECOG_MARKET_ABI,
          functionName: 'closeTimestamp',
        }) as Promise<bigint>,
        publicClient.readContract({
          address: marketAddress,
          abi: PRECOG_MARKET_ABI,
          functionName: 'owner',
        }) as Promise<`0x${string}`>,
        publicClient.readContract({
          address: marketAddress,
          abi: PRECOG_MARKET_ABI,
          functionName: 'token',
        }) as Promise<`0x${string}`>,
      ]);

      if (closeTs === BigInt(0)) {
        setError('Mercado no resuelto (closeTimestamp = 0)');
        setStep('error');
        return;
      }

      setTokenAddress(token);

      // Read balance for display
      try {
        const bal = await publicClient.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [marketAddress],
        }) as bigint;
        const decimals = await publicClient.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }) as number;
        const formatted = (Number(bal) / 10 ** decimals).toFixed(2);
        setBalance(formatted);
      } catch { /* non-critical */ }

      // Check if owner is already the connected wallet
      if (owner.toLowerCase() === address!.toLowerCase()) {
        setStep('preview-withdraw');
        return;
      }

      // Check if ownership was already transferred (DB state)
      if (withdrawal?.ownershipTransferredAt && !withdrawal?.withdrawnAt) {
        setStep('preview-withdraw');
        return;
      }

      // Owner is master (or someone else) — need transfer
      setStep('preview-transfer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read contract');
      setStep('error');
    }
  }

  async function handleTransfer() {
    if (!address || !publicClient || !tokenAddress) return;
    setError(null);
    setTxHash(null);

    try {
      setStep('transferring');
      const data = encodeFunctionData({
        abi: PRECOG_MASTER_ABI,
        functionName: 'marketTransferOwnership',
        args: [BigInt(onchainId), address],
      });
      const tx = await sendTx(masterAddress, data, address);
      setTxHash(tx);
      setStep('confirming-transfer');
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await logTx('market_ownership_transferred', {
        txHash: tx,
        newOwner: address,
        tokenAddress,
        amount: balance,
      });

      setTxHash(null);
      setStep('preview-withdraw');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    }
  }

  async function handleWithdraw() {
    if (!address || !publicClient || !tokenAddress) return;
    setError(null);
    setTxHash(null);

    try {
      setStep('withdrawing');
      const data = encodeFunctionData({
        abi: PRECOG_MARKET_ABI,
        functionName: 'withdraw',
        args: [tokenAddress],
      });
      const tx = await sendTx(marketAddress, data, address);
      setTxHash(tx);
      setStep('confirming-withdraw');
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await logTx('market_liquidity_withdrawn', {
        txHash: tx,
        tokenAddress,
        amount: balance,
      });

      setStep('refreshing');
      setTxHash(null);
      router.refresh();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    }
  }

  async function handleReturnOwnership() {
    if (!address || !publicClient) return;
    setError(null);
    setTxHash(null);

    try {
      setStep('returning');
      const data = encodeFunctionData({
        abi: PRECOG_MARKET_ABI,
        functionName: 'transferOwnership',
        args: [masterAddress],
      });
      const tx = await sendTx(marketAddress, data, address);
      setTxHash(tx);
      setStep('confirming-return');
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await logTx('market_ownership_returned', {
        txHash: tx,
        masterAddress,
        amount: balance,
      });

      setTxHash(null);
      setStep('refreshing');
      router.refresh();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    }
  }

  const busy = ['checking', 'transferring', 'confirming-transfer', 'withdrawing', 'confirming-withdraw', 'returning', 'confirming-return', 'refreshing'].includes(step);
  const { step1Done, step1Active, step1Busy, step2Done, step2Active, step2Busy } = getStepperState(step, withdrawal);
  const allDone = step1Done && step2Done;
  const alreadyWithdrawn = (withdrawal?.withdrawnAt || step === 'done') && !balanceLabel;
  const showReturnOwnership = withdrawal?.ownershipTransferredAt && !withdrawal?.ownershipReturnedAt;

  // Determine which step's tx hash to show inline
  const transferTxHash = txHash && (step === 'confirming-transfer' || step === 'transferring') ? txHash : withdrawal?.ownershipTransferTxHash;
  const withdrawTxHash = txHash && (step === 'confirming-withdraw' || step === 'withdrawing') ? txHash : withdrawal?.withdrawTxHash;

  const borderColor = allDone ? 'border-green-200 dark:border-green-800' : 'border-purple-200 dark:border-purple-800';
  const bgColor = allDone ? 'bg-green-50 dark:bg-green-950/40' : 'bg-purple-50 dark:bg-purple-950/40';

  // Stepper data
  const steps = [
    { label: 'Transferir ownership', done: step1Done, active: step1Active, spinning: step1Busy, hash: transferTxHash },
    { label: 'Retirar liquidez', done: step2Done, active: step2Active, spinning: step2Busy, hash: withdrawTxHash },
  ];

  // Button label
  const label = step === 'checking' ? 'Verificando...'
    : step === 'transferring' ? 'Firmando...'
    : step === 'confirming-transfer' ? 'Confirmando transferencia...'
    : step === 'withdrawing' ? 'Firmando...'
    : step === 'confirming-withdraw' ? 'Confirmando retiro...'
    : step === 'returning' ? 'Firmando...'
    : step === 'confirming-return' ? 'Devolviendo ownership...'
    : step === 'refreshing' ? 'Actualizando...'
    : step === 'done' ? 'Liquidez retirada'
    : step === 'error' ? 'Reintentar'
    : alreadyWithdrawn ? 'Liquidez retirada'
    : withdrawal?.ownershipTransferredAt ? 'Continuar retiro'
    : 'Retirar liquidez';

  return (
    <div className={`rounded-lg border p-6 ${bgColor} ${borderColor}`}>
      {/* Stepper */}
      <div className="flex items-center gap-1 mb-4">
        {steps.map((s, i) => {
          const circleClass = s.done
            ? 'bg-green-500 text-white'
            : s.active || s.spinning
              ? 'bg-purple-500 text-white'
              : 'bg-muted text-muted-foreground';
          const labelClass = s.done
            ? 'text-green-700 dark:text-green-300'
            : s.active || s.spinning
              ? 'text-purple-700 dark:text-purple-300 font-semibold'
              : 'text-muted-foreground';
          const lineClass = s.done ? 'bg-green-300 dark:bg-green-700' : 'bg-border';

          return (
            <div key={s.label} className="flex items-center gap-1">
              {i > 0 && <div className={`w-4 h-px ${lineClass}`} />}
              <div className="flex items-center gap-1.5">
                <span className={`flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold ${circleClass}`}>
                  {s.done ? '\u2713' : s.spinning ? (
                    <span className="animate-spin inline-block w-2.5 h-2.5 border border-white border-t-transparent rounded-full" />
                  ) : i + 1}
                </span>
                {s.hash ? (
                  <a
                    href={`${basescanBase}/tx/${s.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-[10px] font-medium hover:underline ${labelClass}`}
                  >
                    {s.label}
                  </a>
                ) : (
                  <span className={`text-[10px] font-medium ${labelClass}`}>
                    {s.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasUnredeemedWinners && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 mb-3">
          Hay usuarios con posiciones ganadoras sin redimir. Retirar liquidez puede impedir que cobren.
        </p>
      )}

      <h3 className="text-sm font-semibold text-foreground mb-3">Retiro de liquidez{balanceLabel ? ` — ${balanceLabel}` : ''}</h3>

      {/* Preview: Transfer ownership */}
      {step === 'preview-transfer' && (
        <div className="rounded-md border border-border bg-card p-3 space-y-3 text-sm">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">TX 1: Transferir ownership</p>
          <div className="space-y-1">
            <Param label="Contrato" value={addr(masterAddress)} />
            <Param label="Funcion" value="marketTransferOwnership" />
            <Param label="Market ID" value={String(onchainId)} />
            <Param label="Nuevo owner" value={addr(address!)} />
          </div>
          {balance && <p className="text-[10px] text-muted-foreground">Balance del mercado: ${balance}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={handleTransfer} size="sm" className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600">Confirmar y firmar</Button>
            <Button onClick={() => setStep('idle')} variant="outline" size="sm">Cancelar</Button>
          </div>
        </div>
      )}

      {/* Preview: Withdraw */}
      {step === 'preview-withdraw' && tokenAddress && (
        <div className="rounded-md border border-border bg-card p-3 space-y-3 text-sm">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            {withdrawal?.ownershipTransferredAt ? 'TX 2' : 'TX 1'}: Retirar liquidez
          </p>
          <div className="space-y-1">
            <Param label="Contrato" value={addr(marketAddress)} />
            <Param label="Funcion" value="withdraw" />
            <Param label="Token" value={addr(tokenAddress)} />
          </div>
          {balance && <p className="text-[10px] text-muted-foreground">Balance: ${balance}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={handleWithdraw} size="sm" className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600">Confirmar y firmar</Button>
            <Button onClick={() => setStep('idle')} variant="outline" size="sm">Cancelar</Button>
          </div>
        </div>
      )}

      {/* Preview: Return ownership */}
      {step === 'preview-return' && (
        <div className="rounded-md border border-border bg-card p-3 space-y-3 text-sm">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Devolver ownership al Master</p>
          <div className="space-y-1">
            <Param label="Contrato" value={addr(marketAddress)} />
            <Param label="Funcion" value="transferOwnership" />
            <Param label="Nuevo owner" value={addr(masterAddress)} />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleReturnOwnership} size="sm" className="bg-orange-600 text-white hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-600">Confirmar y firmar</Button>
            <Button onClick={() => setStep('idle')} variant="outline" size="sm">Cancelar</Button>
          </div>
        </div>
      )}

      {/* Default state / busy state */}
      {step !== 'preview-transfer' && step !== 'preview-return' && !(step === 'preview-withdraw' && tokenAddress) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={() => {
                if (alreadyWithdrawn) return;
                if (step === 'idle' || step === 'error') {
                  handleCheck();
                }
              }}
              disabled={busy || !!alreadyWithdrawn}
              variant="outline"
              size="sm"
              className="border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 dark:border-purple-700 dark:text-purple-300 dark:bg-purple-900/30 dark:hover:bg-purple-900/50"
            >
              {label}
            </Button>
            {txHash && <TxLink hash={txHash} chainId={chainId} />}
            {alreadyWithdrawn && <span className="text-xs text-green-600">OK</span>}
            {error && <span className="text-xs text-destructive max-w-xs truncate" title={error}>Error: {error.slice(0, 60)}</span>}
          </div>
          {showReturnOwnership && (
            <Button
              onClick={() => setStep('preview-return')}
              disabled={busy}
              variant="link"
              className="text-[10px] text-muted-foreground hover:text-foreground underline h-auto p-0"
            >
              Devolver ownership al Master
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
