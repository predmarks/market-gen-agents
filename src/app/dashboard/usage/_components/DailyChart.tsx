'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const OP_COLORS: Record<string, string> = {
  data_verify:          '#3b82f6',
  rules_check:          '#818cf8',
  score_market:         '#a78bfa',
  improve_market:       '#ec4899',
  extract_topics:       '#f59e0b',
  generate_markets:     '#f97316',
  research_topic:       '#14b8a6',
  resolve_check:        '#22c55e',
  score_signals:        '#22d3ee',
  rescore_topic:        '#84cc16',
  match_markets_topics: '#9ca3af',
  expand_market:        '#fb7185',
  chat:                 '#6b7280',
};

interface DailyOpCost {
  date: string;
  operation: string;
  cost: number;
  calls: number;
}

interface ChartRow {
  date: string;
  fullDate: string;
  [op: string]: number | string;
}

function transformData(data: DailyOpCost[]): { rows: ChartRow[]; operations: string[] } {
  const byDate = new Map<string, Map<string, number>>();
  const allOps = new Set<string>();

  for (const d of data) {
    allOps.add(d.operation);
    const dateOps = byDate.get(d.date) ?? new Map();
    dateOps.set(d.operation, (dateOps.get(d.operation) ?? 0) + d.cost);
    byDate.set(d.date, dateOps);
  }

  const dates = Array.from(byDate.keys()).sort();
  const operations = Array.from(allOps).sort();

  const rows: ChartRow[] = dates.map((date) => {
    const ops = byDate.get(date)!;
    const row: ChartRow = { date: date.slice(5), fullDate: date };
    for (const op of operations) {
      row[op] = Math.round((ops.get(op) ?? 0) * 1000) / 1000;
    }
    return row;
  });

  return { rows, operations };
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  const nonZero = payload.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs max-w-xs">
      <p className="font-medium text-gray-700 mb-1">{label} &middot; ${total.toFixed(2)}</p>
      {nonZero.map((p) => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600 flex-1 truncate">{p.name}</span>
          <span className="font-mono text-gray-700">${p.value.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

export default function DailyChart({ data }: { data: DailyOpCost[] }) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-medium text-gray-500 mb-2">Costo diario por operaci&oacute;n</h2>
        <p className="text-sm text-gray-400">Sin datos</p>
      </div>
    );
  }

  const { rows, operations } = transformData(data);

  const handleClick = (dateRow: ChartRow) => {
    const el = document.getElementById(`day-${dateRow.fullDate}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="text-sm font-medium text-gray-500 mb-4">Costo diario por operaci&oacute;n (30 d&iacute;as)</h2>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows} onClick={(e: Record<string, unknown>) => {
          const payload = (e?.activePayload as Array<{ payload: ChartRow }> | undefined)?.[0]?.payload;
          if (payload) handleClick(payload);
        }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v}`}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f9fafb' }} />
          <Legend
            wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
            iconSize={10}
            iconType="square"
          />
          {operations.map((op) => (
            <Bar
              key={op}
              dataKey={op}
              stackId="cost"
              fill={OP_COLORS[op] ?? '#9ca3af'}
              radius={0}
              cursor="pointer"
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
