'use client';

import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const CAT_COLORS: Record<string, string> = {
  'Economía': '#f59e0b',
  'Política': '#3b82f6',
  'Deportes': '#22c55e',
  'Entretenimiento': '#a78bfa',
  'Clima': '#06b6d4',
  'Otros': '#9ca3af',
};

interface MarketTimePoint {
  date: string;
  category: string;
  volume: number;
  participants: number;
}

// Aggregate time points by week + category for volume chart
function aggregateByWeek(points: MarketTimePoint[]) {
  const categories = Array.from(new Set(points.map((p) => p.category)));
  const weekMap = new Map<string, Record<string, number>>();

  for (const p of points) {
    // Get Monday of the week
    const d = new Date(p.date);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const weekKey = monday.toISOString().split('T')[0];

    const row = weekMap.get(weekKey) ?? {};
    row[p.category] = (row[p.category] ?? 0) + p.volume;
    weekMap.set(weekKey, row);
  }

  return {
    categories,
    rows: Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, cats]) => ({
        week: week.slice(5), // MM-DD
        ...cats,
      })),
  };
}

// Aggregate cumulative participants by week
function aggregateParticipants(points: MarketTimePoint[]) {
  const weekMap = new Map<string, number>();

  for (const p of points) {
    const d = new Date(p.date);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const weekKey = monday.toISOString().split('T')[0];

    weekMap.set(weekKey, (weekMap.get(weekKey) ?? 0) + p.participants);
  }

  let cumulative = 0;
  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => {
      cumulative += count;
      return { week: week.slice(5), participants: cumulative };
    });
}

export function VolumeOverTimeChart({ data }: { data: MarketTimePoint[] }) {
  if (data.length === 0) return <p className="text-sm text-gray-400">Sin datos de volumen</p>;

  const { categories, rows } = aggregateByWeek(data);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={rows}>
        <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`} width={50} />
        <Tooltip
          contentStyle={{ fontSize: '11px', borderRadius: '8px', border: '1px solid #e5e7eb' }}
          formatter={(value: unknown, name: unknown) => [`$${Number(value).toFixed(0)}`, String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} iconSize={10} iconType="square" />
        {categories.map((cat) => (
          <Area
            key={cat}
            type="monotone"
            dataKey={cat}
            stackId="volume"
            fill={CAT_COLORS[cat] ?? '#9ca3af'}
            stroke={CAT_COLORS[cat] ?? '#9ca3af'}
            fillOpacity={0.6}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ParticipantTrendChart({ data }: { data: MarketTimePoint[] }) {
  if (data.length === 0) return <p className="text-sm text-gray-400">Sin datos de participantes</p>;

  const rows = aggregateParticipants(data);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows}>
        <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          contentStyle={{ fontSize: '11px', borderRadius: '8px', border: '1px solid #e5e7eb' }}
          formatter={(value: unknown) => [Number(value), 'Participantes']}
        />
        <Line type="monotone" dataKey="participants" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
