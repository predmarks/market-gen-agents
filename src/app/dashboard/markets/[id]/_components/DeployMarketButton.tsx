'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useChainId, useWalletClient, usePublicClient, useReadContract } from 'wagmi';
import { parseUnits } from 'viem';
import { decodeEventLog } from 'viem';
import {
  PRECOG_MASTER_ABI,
  ERC20_ABI,
  MASTER_ADDRESSES,
  COLLATERAL_TOKENS,
  ORACLE_ADDRESSES,
} from '@/lib/contracts';
import { getBasescanUrl } from '@/lib/chains';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DeployableMarket {
  name: string;
  description: string;
  category: string;
  outcomes: string[];
  endTimestamp: number;
}

interface Props {
  marketId: string;
}

type Step =
  | 'idle'
  | 'preview'
  | 'approving' | 'confirming-approve'
  | 'deploying' | 'confirming-deploy'
  | 'syncing' | 'done' | 'error';

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-mono">{value}</span>
    </div>
  );
}

export function DeployMarketButton({ marketId }: Props) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [funding, setFunding] = useState('1000');
  const [overround, setOverround] = useState('500');
  const [deployable, setDeployable] = useState<DeployableMarket | null>(null);

  const masterAddress = MASTER_ADDRESSES[chainId];
  const collateralToken = COLLATERAL_TOKENS[chainId];
  const oracleAddress = ORACLE_ADDRESSES[chainId];

  const { data: tokenDecimals } = useReadContract({
    address: collateralToken ?? undefined,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!collateralToken },
  });

  if (!isConnected || !masterAddress || !collateralToken || !oracleAddress) return null;

  const decimals = tokenDecimals ?? 6;

  async function fetchDeployable(): Promise<DeployableMarket> {
    const res = await fetch(`/api/markets/${marketId}`);
    if (!res.ok) throw new Error('Failed to fetch market');
    const market = await res.json();
    const d: DeployableMarket = {
      name: market.title,
      description: market.description,
      category: market.category,
      outcomes: market.outcomes,
      endTimestamp: market.endTimestamp,
    };
    setDeployable(d);
    return d;
  }

  const logTx = (action: string, detail: Record<string, unknown>) =>
    fetch(`/api/markets/${marketId}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, detail }),
    });

  async function handleDeploy() {
    if (!walletClient || !publicClient || !address || !collateralToken || !oracleAddress) return;
    setError(null);
    setTxHash(null);

    try {
      const fresh = await fetchDeployable();
      const fundingAmount = parseUnits(funding, decimals);
      const startTimestamp = BigInt(Math.floor(Date.now() / 1000) - 3600);

      if (fundingAmount > BigInt(0)) {
        const allowance = await publicClient.readContract({
          address: collateralToken,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, masterAddress],
        }) as bigint;

        if (allowance < fundingAmount) {
          setStep('approving');
          const approveTx = await walletClient.writeContract({
            address: collateralToken,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [masterAddress, fundingAmount],
          });
          setStep('confirming-approve');
          await publicClient.waitForTransactionReceipt({ hash: approveTx });
        }
      }

      setStep('deploying');
      const deployTx = await walletClient.writeContract({
        address: masterAddress,
        abi: PRECOG_MASTER_ABI,
        functionName: 'createCustomMarket',
        args: [
          fresh.name,
          fresh.description,
          fresh.category,
          fresh.outcomes,
          startTimestamp,
          BigInt(fresh.endTimestamp),
          address,
          parseUnits(funding, decimals),
          BigInt(overround),
          collateralToken,
          address,
          oracleAddress,
        ],
      });
      setTxHash(deployTx);
      setStep('confirming-deploy');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });

      let onchainId: string | null = null;
      let onchainAddress: string | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: PRECOG_MASTER_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === 'MarketCreated') {
            const args = decoded.args as { marketId: bigint; market: string };
            onchainId = args.marketId.toString();
            onchainAddress = args.market;
            break;
          }
        } catch { /* not our event */ }
      }

      if (!onchainId) {
        setStep('syncing');
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const matchRes = await fetch(`/api/markets/${marketId}/match-onchain?chain=${chainId}`);
          if (matchRes.ok) {
            const matchData = await matchRes.json();
            onchainId = matchData.onchainId;
            onchainAddress = matchData.onchainAddress;
          }
        } catch { /* indexer not available */ }
      }

      await logTx('market_deployed_onchain', {
        txHash: deployTx,
        chainId,
        onchainId,
        onchainAddress,
        funding,
        overround,
        collateralToken,
        oracleAddress,
      });

      setStep('syncing');
      await new Promise((r) => setTimeout(r, 3000));
      await fetch(`/api/sync-deployed?chain=${chainId}`, { method: 'POST' });
      router.refresh();
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    }
  }

  const busy = ['approving', 'confirming-approve', 'deploying', 'confirming-deploy', 'syncing'].includes(step);
  const basescanBase = getBasescanUrl(chainId);

  if (step === 'preview' && deployable) {
    return (
      <Card className="p-4 space-y-3 text-sm">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Publicar mercado onchain</p>
        <div className="space-y-1">
          <Param label="Contrato" value={`${masterAddress.slice(0, 6)}...${masterAddress.slice(-4)}`} />
          <Param label="Función" value="createCustomMarket" />
          <Param label="Nombre" value={deployable.name.slice(0, 50) + (deployable.name.length > 50 ? '...' : '')} />
          <Param label="Categoría" value={deployable.category} />
          <Param label="Opciones" value={deployable.outcomes.join(', ')} />
          <Param label="Cierre" value={new Date(deployable.endTimestamp * 1000).toLocaleDateString('es-AR')} />
          <Param label="Oráculo" value={`${oracleAddress.slice(0, 6)}...${oracleAddress.slice(-4)}`} />
          <Param label="Token" value={`${collateralToken.slice(0, 6)}...${collateralToken.slice(-4)}`} />
        </div>
        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <Label className="text-[10px]">Funding (tokens)</Label>
            <Input
              type="number"
              value={funding}
              onChange={(e) => setFunding(e.target.value)}
              className="text-xs"
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-[10px]">Overround (bps)</Label>
            <Input
              type="number"
              value={overround}
              onChange={(e) => setOverround(e.target.value)}
              className="text-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleDeploy}>Confirmar y firmar</Button>
          <Button variant="outline" size="sm" onClick={() => setStep('idle')}>Cancelar</Button>
        </div>
      </Card>
    );
  }

  const label = step === 'approving' ? 'Aprobando token...'
    : step === 'confirming-approve' ? 'Confirmando aprobación...'
    : step === 'deploying' ? 'Firmando...'
    : step === 'confirming-deploy' ? 'Confirmando...'
    : step === 'syncing' ? 'Sincronizando...'
    : step === 'done' ? 'Publicado'
    : step === 'error' ? 'Reintentar'
    : 'Publicar onchain';

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          if (step === 'idle' || step === 'error') {
            fetchDeployable().then(() => setStep('preview')).catch((e) => { setError(e.message); setStep('error'); });
          }
        }}
        disabled={busy || step === 'done'}
        className="border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-950"
      >
        {label}
      </Button>
      {txHash && (
        <a href={`${basescanBase}/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 dark:text-blue-400 hover:underline font-mono">
          {txHash.slice(0, 10)}...
        </a>
      )}
      {step === 'done' && <span className="text-xs text-green-600 dark:text-green-400">OK</span>}
      {error && <span className="text-xs text-destructive max-w-xs truncate" title={error}>Error: {error.slice(0, 60)}</span>}
    </>
  );
}
