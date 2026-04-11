'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';

export interface PnLChartRow {
  title: string;
  seeded: number;
  withdrawn: number;
  pending: number;
  ownedPnL: number;
  liquidityPnL: number;
  netPnL: number;
  cumulativePnL: number;
  status: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Array<{ name: string; value: number; color: string; dataKey: string; payload: any }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0]?.payload as PnLChartRow | undefined;
  if (!data) return null;

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-xs max-w-xs">
      <p className="font-medium text-foreground mb-2 truncate">{label}</p>
      <div className="space-y-1">
        <Row label="Fondeado" value={data.seeded} />
        <Row label="Retirado" value={data.withdrawn} />
        <Row label="Balance pendiente" value={data.pending} />
        <Row label="PnL LP" value={data.liquidityPnL} colored />
        <Row label="PnL trading" value={data.ownedPnL} colored />
        <div className="border-t border-border pt-1 mt-1">
          <Row label="PnL neto" value={data.netPnL} colored bold />
          <Row label="PnL acumulado" value={data.cumulativePnL} colored />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, colored, bold }: { label: string; value: number; colored?: boolean; bold?: boolean }) {
  const color = colored
    ? value >= 0
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400'
    : 'text-foreground';
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${color} ${bold ? 'font-bold' : ''}`}>
        {value >= 0 ? '' : '-'}${Math.abs(value).toFixed(2)}
      </span>
    </div>
  );
}

export default function PnLChart({ data }: { data: PnLChartRow[] }) {
  if (data.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-5">
        <h2 className="text-sm font-medium text-muted-foreground mb-2">PnL por mercado</h2>
        <p className="text-sm text-muted-foreground/60">Sin datos</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <h2 className="text-sm font-medium text-muted-foreground mb-4">PnL por mercado</h2>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data}>
          <XAxis
            dataKey="title"
            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={80}
            tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 18) + '…' : v}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v}`}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
          <Legend
            wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
            iconSize={10}
            iconType="square"
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <Bar dataKey="netPnL" name="PnL neto" radius={[2, 2, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.netPnL >= 0 ? '#22c55e' : '#ef4444'}
              />
            ))}
          </Bar>
          <Line
            dataKey="cumulativePnL"
            name="PnL acumulado"
            type="monotone"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
