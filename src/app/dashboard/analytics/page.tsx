export const dynamic = 'force-dynamic';

import { getAnalyticsData } from '@/lib/analytics';
import { validateChainId } from '@/lib/chains';
import { cn } from '@/lib/utils';
import PnLChart from './_components/PnLChart';
import PnLTable from './_components/PnLTable';

interface Props {
  searchParams: Promise<{ chain?: string }>;
}

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs >= 1000
    ? `$${(abs / 1000).toFixed(1)}K`
    : `$${abs.toFixed(2)}`;
  return value < 0 ? `-${formatted}` : formatted;
}

function PnLValue({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        'font-mono',
        value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
        className,
      )}
    >
      {value >= 0 ? '+' : ''}{formatUsd(value)}
    </span>
  );
}

export default async function AnalyticsPage({ searchParams }: Props) {
  const params = await searchParams;
  const chainId = validateChainId(params.chain ? Number(params.chain) : undefined);

  let data;
  try {
    data = await getAnalyticsData(chainId);
  } catch (err) {
    console.error('[analytics] Failed to load analytics data:', err);
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">PnL</h1>
        <p className="text-sm text-muted-foreground/60">Error cargando datos de PnL.</p>
      </div>
    );
  }

  const { summary, markets } = data;

  // Recovery ratio: (withdrawn + pending) / seeded
  const totalRecovered = summary.totalWithdrawn + summary.totalPending;
  const recoveryPct = summary.totalSeeded > 0
    ? ((totalRecovered / summary.totalSeeded) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">PnL</h1>

      {/* Section 1: Global Summary */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex flex-wrap gap-8 items-start mb-4">
          <Metric label="Total Fondeado" value={formatUsd(summary.totalSeeded)} />
          <Metric label="Total Retirado" value={formatUsd(summary.totalWithdrawn)} />
          <Metric label="Balance Pendiente" value={formatUsd(summary.totalPending)} />
          <Metric
            label="PnL LP"
            value={<PnLValue value={summary.totalLiquidityPnL} />}
          />
          <Metric
            label="PnL Trading"
            value={<PnLValue value={summary.totalOwnedPnL} />}
          />
          <Metric
            label="PnL Neto"
            value={<PnLValue value={summary.netPnL} className="text-lg font-bold" />}
          />
        </div>

        {/* Recovery bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground/60">
            <span>Recuperado (retirado + pendiente) vs fondeado</span>
            <span className="font-mono">{recoveryPct.toFixed(0)}%</span>
          </div>
          <div className="bg-muted rounded-full h-3 overflow-hidden">
            <div
              className={cn(
                'h-3 rounded-full transition-all',
                recoveryPct >= 80 ? 'bg-green-400 dark:bg-green-500' :
                recoveryPct >= 50 ? 'bg-amber-400 dark:bg-amber-500' :
                'bg-red-400 dark:bg-red-500',
              )}
              style={{ width: `${Math.min(recoveryPct, 100)}%` }}
            />
          </div>
        </div>

        <div className="mt-3 text-xs text-muted-foreground/60">
          {summary.marketCount} mercados desplegados
        </div>
      </div>

      {/* Section 2: Chart */}
      <PnLChart
        data={markets.map((m) => ({
          title: m.title,
          seeded: m.seeded,
          withdrawn: m.withdrawn,
          pending: m.pending,
          ownedPnL: m.ownedPnL,
          liquidityPnL: m.liquidityPnL,
          netPnL: m.netPnL,
          cumulativePnL: m.cumulativePnL,
          status: m.status,
        }))}
      />

      {/* Section 3: Per-market breakdown */}
      <PnLTable
        markets={markets.map((m) => ({
          marketId: m.marketId,
          onchainId: m.onchainId,
          title: m.title,
          status: m.status,
          seeded: m.seeded,
          withdrawn: m.withdrawn,
          pending: m.pending,
          liquidityPnL: m.liquidityPnL,
          ownedPnL: m.ownedPnL,
          netPnL: m.netPnL,
        }))}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground/60">{label}</div>
      <div className="text-lg font-mono">{value}</div>
    </div>
  );
}
