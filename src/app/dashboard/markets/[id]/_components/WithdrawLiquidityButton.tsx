'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { encodeFunctionData } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';
import { PRECOG_MASTER_ABI, PRECOG_MARKET_ABI, ERC20_ABI, MASTER_ADDRESSES } from '@/lib/contracts';
import { getBasescanUrl } from '@/lib/chains';
import type { WithdrawalProgress } from '@/db/types';

interface Props {
  marketId: string;
  onchainId: number;
  marketAddress: `0x${string}`;
  chainId: number;
  withdrawal?: WithdrawalProgress | null;
}

type Step =
  | 'idle'
  | 'checking'
  | 'preview-transfer' | 'transferring' | 'confirming-transfer'
  | 'preview-withdraw' | 'withdrawing' | 'confirming-withdraw'
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
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-800 font-mono">{value}</span>
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

export function WithdrawLiquidityButton({ marketId, onchainId, marketAddress, chainId, withdrawal }: Props) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [tokenAddress, setTokenAddress] = useState<`0x${string}` | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  const masterAddress = MASTER_ADDRESSES[chainId];

  // Auto-resume: if ownership transferred but not withdrawn, go to preview-withdraw
  useEffect(() => {
    if (withdrawal?.ownershipTransferredAt && !withdrawal?.withdrawnAt && step === 'idle') {
      if (withdrawal.tokenAddress) {
        setTokenAddress(withdrawal.tokenAddress as `0x${string}`);
      }
    }
  }, [withdrawal, step]);

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
      });

      setTxHash(null);
      setStep('preview-withdraw');
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
      });

      setStep('refreshing');
      setTxHash(null);
      await new Promise((r) => setTimeout(r, 2000));
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
      setStep('transferring');
      const data = encodeFunctionData({
        abi: PRECOG_MASTER_ABI,
        functionName: 'marketTransferOwnership',
        args: [BigInt(onchainId), masterAddress],
      });
      const tx = await sendTx(masterAddress, data, address);
      setTxHash(tx);
      setStep('confirming-transfer');
      await publicClient.waitForTransactionReceipt({ hash: tx });
      await logTx('market_ownership_returned', {
        txHash: tx,
        masterAddress,
      });

      setTxHash(null);
      setStep('refreshing');
      await new Promise((r) => setTimeout(r, 2000));
      router.refresh();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    }
  }

  const busy = ['checking', 'transferring', 'confirming-transfer', 'withdrawing', 'confirming-withdraw', 'refreshing'].includes(step);

  // Preview: Transfer ownership
  if (step === 'preview-transfer') {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3 text-sm">
          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">TX 1: Transferir ownership</p>
          <div className="space-y-1">
            <Param label="Contrato" value={addr(masterAddress)} />
            <Param label="Funcion" value="marketTransferOwnership" />
            <Param label="Market ID" value={String(onchainId)} />
            <Param label="Nuevo owner" value={addr(address!)} />
          </div>
          {balance && <p className="text-[10px] text-gray-400">Balance del mercado: ${balance}</p>}
          <div className="flex items-center gap-2">
            <button onClick={handleTransfer} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 cursor-pointer">Confirmar y firmar</button>
            <button onClick={() => setStep('idle')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer">Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  // Preview: Withdraw
  if (step === 'preview-withdraw' && tokenAddress) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3 text-sm">
          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
            {withdrawal?.ownershipTransferredAt ? 'TX 2' : 'TX 1'}: Retirar liquidez
          </p>
          <div className="space-y-1">
            <Param label="Contrato" value={addr(marketAddress)} />
            <Param label="Funcion" value="withdraw" />
            <Param label="Token" value={addr(tokenAddress)} />
          </div>
          {balance && <p className="text-[10px] text-gray-400">Balance: ${balance}</p>}
          <div className="flex items-center gap-2">
            <button onClick={handleWithdraw} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 cursor-pointer">Confirmar y firmar</button>
            <button onClick={() => setStep('idle')} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer">Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  // Status display
  const label = step === 'checking' ? 'Verificando...'
    : step === 'transferring' ? 'Firmando...'
    : step === 'confirming-transfer' ? 'Confirmando transferencia...'
    : step === 'withdrawing' ? 'Firmando...'
    : step === 'confirming-withdraw' ? 'Confirmando retiro...'
    : step === 'refreshing' ? 'Actualizando...'
    : step === 'done' ? 'Liquidez retirada'
    : step === 'error' ? 'Reintentar'
    : withdrawal?.withdrawnAt ? 'Liquidez retirada'
    : withdrawal?.ownershipTransferredAt ? 'Continuar retiro'
    : 'Retirar liquidez';

  const alreadyWithdrawn = withdrawal?.withdrawnAt || step === 'done';
  const showReturnOwnership = withdrawal?.ownershipTransferredAt && !withdrawal?.ownershipReturnedAt && !alreadyWithdrawn;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => {
            if (alreadyWithdrawn) return;
            if (step === 'idle' || step === 'error') {
              if (withdrawal?.ownershipTransferredAt && !withdrawal?.withdrawnAt) {
                // Resume: skip to withdraw preview
                handleCheck();
              } else {
                handleCheck();
              }
            }
          }}
          disabled={busy || !!alreadyWithdrawn}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 cursor-pointer"
        >
          {label}
        </button>
        {txHash && <TxLink hash={txHash} chainId={chainId} />}
        {alreadyWithdrawn && <span className="text-xs text-green-600">OK</span>}
        {error && <span className="text-xs text-red-500 max-w-xs truncate" title={error}>Error: {error.slice(0, 60)}</span>}
      </div>
      {showReturnOwnership && (
        <button
          onClick={handleReturnOwnership}
          disabled={busy}
          className="text-[10px] text-gray-400 hover:text-gray-600 underline cursor-pointer disabled:opacity-50"
        >
          Devolver ownership al Master
        </button>
      )}
    </div>
  );
}
