export const dynamic = 'force-dynamic';

import { getMarketAnalytics, formatVolume } from '@/lib/analytics';
import { VolumeOverTimeChart, ParticipantTrendChart } from './_components/Charts';

export default async function AnalyticsPage() {
  let data;
  try {
    data = await getMarketAnalytics();
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-gray-400">Error cargando datos.</p>
      </div>
    );
  }

  const { totalVolume, totalParticipants, activeMarkets, totalPublished, byCategory, overTime } = data;
  const avgVolume = totalPublished > 0 ? totalVolume / totalPublished : 0;
  const maxCatVolume = byCategory[0]?.volume ?? 0.01;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-400">Volumen total</div>
          <div className="text-xl font-mono font-bold text-gray-900">{formatVolume(totalVolume)}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-400">Participantes</div>
          <div className="text-xl font-mono font-bold text-gray-900">{totalParticipants.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-400">Mercados activos</div>
          <div className="text-xl font-mono font-bold text-gray-900">{activeMarkets}</div>
          <div className="text-[10px] text-gray-400">{totalPublished} publicados</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-xs text-gray-400">Vol. promedio</div>
          <div className="text-xl font-mono font-bold text-gray-900">{formatVolume(avgVolume)}</div>
          <div className="text-[10px] text-gray-400">por mercado</div>
        </div>
      </div>

      {/* Volume by category */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-medium text-gray-500 mb-4">Volumen por categor&iacute;a</h2>
        {byCategory.length === 0 ? (
          <p className="text-sm text-gray-400">Sin datos</p>
        ) : (
          <div className="space-y-2.5">
            {byCategory.map((cat) => {
              const pct = Math.max((cat.volume / maxCatVolume) * 100, 3);
              return (
                <div key={cat.category} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 w-28 shrink-0">{cat.category}</span>
                  <div className="flex-1 bg-gray-50 rounded-full h-4 overflow-hidden">
                    <div className="h-4 rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-mono text-gray-700 w-16 text-right">{formatVolume(cat.volume)}</span>
                  <span className="text-xs text-gray-400 w-20 text-right">{cat.participants} parts.</span>
                  <span className="text-xs text-gray-400 w-12 text-right">{cat.marketCount} mkts</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Volume over time */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-medium text-gray-500 mb-4">Volumen por semana</h2>
        <VolumeOverTimeChart data={overTime} />
      </div>

      {/* Participant trend */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-sm font-medium text-gray-500 mb-4">Participantes (acumulado)</h2>
        <ParticipantTrendChart data={overTime} />
      </div>
    </div>
  );
}
