export const dynamic = 'force-dynamic';

import { getUsageData, getDailyChartData, getUsageLog, formatTokens, type OperationUsage, type DailyOpCost, type UsageLogEntry } from '@/lib/usage';
import { TOKEN_BUDGETS } from '@/lib/llm';
import { getUserTimezone } from '@/lib/timezone';
import Link from 'next/link';
import nextDynamic from 'next/dynamic';
import { cn } from '@/lib/utils';

const DailyChart = nextDynamic(() => import('./_components/DailyChart'));

const OP_COLORS: Record<string, string> = {
  data_verify:          'bg-blue-500',
  rules_check:          'bg-indigo-400',
  score_market:         'bg-purple-400',
  improve_market:       'bg-pink-500',
  extract_topics:       'bg-amber-500',
  generate_markets:     'bg-orange-500',
  research_topic:       'bg-teal-500',
  resolve_check:        'bg-green-500',
  score_signals:        'bg-cyan-400',
  rescore_topic:        'bg-lime-500',
  match_markets_topics: 'bg-muted-foreground/40',
  expand_market:        'bg-rose-400',
};

// Build Inngest URL from composite runId stored as "functionId/runId"
function buildInngestUrl(compositeRunId: string): string {
  const slashIdx = compositeRunId.indexOf('/');
  if (slashIdx === -1) {
    // No slash — treat entire string as runId
    if (process.env.NODE_ENV !== 'production') return `http://localhost:8288/run?runID=${compositeRunId}`;
    return `https://app.inngest.com/env/production/runs/${compositeRunId}`;
  }
  const functionId = compositeRunId.slice(0, slashIdx);
  const runId = compositeRunId.slice(slashIdx + 1);
  if (process.env.NODE_ENV !== 'production') return `http://localhost:8288/run?runID=${runId}`;
  return `https://app.inngest.com/env/production/functions/${functionId}/logs/${runId}`;
}

// Aggregate operation rows across models for bar chart display
function aggregateByOperation(ops: OperationUsage[]) {
  const map = new Map<string, { operation: string; cost: number; calls: number; models: Set<string> }>();
  for (const op of ops) {
    const existing = map.get(op.operation);
    if (existing) {
      existing.cost += op.cost;
      existing.calls += op.calls;
      existing.models.add(op.model.includes('opus') ? 'Opus' : 'Sonnet');
    } else {
      map.set(op.operation, {
        operation: op.operation,
        cost: op.cost,
        calls: op.calls,
        models: new Set([op.model.includes('opus') ? 'Opus' : 'Sonnet']),
      });
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.cost - a.cost)
    .map((r) => ({ ...r, models: Array.from(r.models).join(', ') }));
}

// Aggregate avg output tokens per operation (across models, weighted by calls)
function aggregateAvgOutput(ops: OperationUsage[]) {
  const map = new Map<string, { operation: string; totalOutput: number; totalCalls: number }>();
  for (const op of ops) {
    const existing = map.get(op.operation);
    if (existing) {
      existing.totalOutput += op.avgOutput * op.calls;
      existing.totalCalls += op.calls;
    } else {
      map.set(op.operation, { operation: op.operation, totalOutput: op.avgOutput * op.calls, totalCalls: op.calls });
    }
  }
  return Array.from(map.values()).map((r) => ({
    operation: r.operation,
    avgOutput: Math.round(r.totalOutput / r.totalCalls),
  }));
}

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const params = await searchParams;
  const tz = await getUserTimezone();
  const sortBy = params.sort === 'cost' ? 'cost' : 'date';

  let data;
  let dailyChart: DailyOpCost[] = [];
  let usageLog: UsageLogEntry[] = [];
  try {
    [data, dailyChart, usageLog] = await Promise.all([
      getUsageData(),
      getDailyChartData(30),
      getUsageLog(30),
    ]);
  } catch (err) {
    console.error('[usage] Failed to load usage data:', err);
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Uso de LLM</h1>
        <p className="text-sm text-muted-foreground/60">Error cargando datos de uso.</p>
      </div>
    );
  }

  const { thisWeek, prevWeek, wowDelta, month, costPerMarket } = data;
  const maxWeekCost = Math.max(thisWeek.cost, prevWeek.cost, 0.01);

  // Section 2: Cost by operation
  const aggOps = aggregateByOperation(thisWeek.byOperation);
  const totalOpCost = aggOps.reduce((s, r) => s + r.cost, 0);
  const maxOpCost = aggOps[0]?.cost ?? 0.01;

  // Section 3: Token budget calibration
  const avgOutputByOp = aggregateAvgOutput(month.byOperation);

  // Section 4: Cost per market
  const maxMarketCost = costPerMarket.markets.reduce((m, r) => Math.max(m, r.cost), 0.01);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Uso de LLM</h1>

      {/* Section 1: WoW Summary */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex gap-8 items-center mb-4">
          <div>
            <div className="text-xs text-muted-foreground/60">Esta semana</div>
            <div className="text-lg font-mono font-bold">${thisWeek.cost.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground/60">Semana anterior</div>
            <div className="text-lg font-mono">${prevWeek.cost.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground/60">Cambio</div>
            <div className={cn('text-lg font-mono font-bold', wowDelta <= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive')}>
              {wowDelta > 0 ? '+' : ''}{wowDelta.toFixed(1)}%
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/60 w-20 shrink-0">Esta sem.</span>
            <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
              <div
                className="h-3 rounded-full bg-green-400 dark:bg-green-500 transition-all"
                style={{ width: `${(thisWeek.cost / maxWeekCost) * 100}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/60 w-20 shrink-0">Sem. ant.</span>
            <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
              <div
                className="h-3 rounded-full bg-muted-foreground/50 transition-all"
                style={{ width: `${(prevWeek.cost / maxWeekCost) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Cost by Operation */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-medium text-muted-foreground">Costo por operaci&oacute;n (7 d&iacute;as)</h2>
          <span className="text-xs text-muted-foreground/60 font-mono">Total: ${totalOpCost.toFixed(2)}</span>
        </div>
        {aggOps.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">Sin datos</p>
        ) : (
          <div className="space-y-2.5">
            {aggOps.map((op) => {
              const pct = Math.max((op.cost / maxOpCost) * 100, 3);
              const sharePct = totalOpCost > 0 ? (op.cost / totalOpCost * 100).toFixed(0) : '0';
              return (
                <div key={op.operation} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-foreground w-36 shrink-0 truncate">{op.operation}</span>
                  <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                    <div className="h-4 rounded-full bg-blue-400 dark:bg-blue-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-mono text-foreground w-14 text-right">${op.cost.toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground/60 w-10 text-right">{sharePct}%</span>
                  <span className="text-xs text-muted-foreground/60 w-16 text-right">{op.calls}</span>
                  <span className="text-xs text-muted-foreground/60 w-16 truncate">{op.models}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Token Budget Calibration */}
      <div className="bg-card rounded-lg border border-border p-5">
        <h2 className="text-sm font-medium text-muted-foreground mb-4">Calibraci&oacute;n TOKEN_BUDGETS (30 d&iacute;as)</h2>
        {avgOutputByOp.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">Sin datos</p>
        ) : (
          <div className="space-y-2">
            {avgOutputByOp
              .filter((op) => op.operation in TOKEN_BUDGETS)
              .sort((a, b) => {
                const utilA = a.avgOutput / (TOKEN_BUDGETS[a.operation] ?? 1);
                const utilB = b.avgOutput / (TOKEN_BUDGETS[b.operation] ?? 1);
                return utilB - utilA;
              })
              .map((op) => {
                const budget = TOKEN_BUDGETS[op.operation] ?? 0;
                if (!budget) return null;
                const utilPct = Math.min((op.avgOutput / budget) * 100, 100);
                const barColor = utilPct > 80 ? 'bg-red-400 dark:bg-red-500' : utilPct > 50 ? 'bg-amber-400 dark:bg-amber-500' : 'bg-green-400 dark:bg-green-500';
                const textColor = utilPct > 80 ? 'text-red-600 dark:text-red-400' : utilPct > 50 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400';
                return (
                  <div key={op.operation} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-foreground w-36 shrink-0 truncate">{op.operation}</span>
                    <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                      <div className={cn('h-3 rounded-full', barColor)} style={{ width: `${utilPct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground w-28 text-right">
                      {formatTokens(op.avgOutput)} / {formatTokens(budget)}
                    </span>
                    <span className={cn('text-xs font-mono w-10 text-right', textColor)}>
                      {utilPct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Section 4: Cost per Market */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-medium text-muted-foreground">Costo por mercado (30 d&iacute;as)</h2>
          <span className="text-xs text-muted-foreground/60 font-mono">
            Promedio: ${costPerMarket.average.toFixed(2)}/mercado
          </span>
        </div>
        {costPerMarket.markets.length === 0 ? (
          <p className="text-sm text-muted-foreground/60">Sin datos</p>
        ) : (
          <div className="space-y-1.5">
            {costPerMarket.markets.map((m) => {
              const pct = Math.max((m.cost / maxMarketCost) * 100, 3);
              const avgPct = (costPerMarket.average / maxMarketCost) * 100;
              const isAboveAvg = m.cost > costPerMarket.average;
              const statusColor =
                m.status === 'open' ? 'bg-indigo-400 dark:bg-indigo-500' :
                m.status === 'rejected' ? 'bg-muted-foreground/50' :
                m.status === 'candidate' ? 'bg-purple-400 dark:bg-purple-500' : 'bg-green-400 dark:bg-green-500';
              return (
                <div key={m.marketId} className="flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', statusColor)} />
                  <span className="text-xs text-foreground w-48 truncate" title={m.title}>
                    {m.title}
                  </span>
                  <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden relative">
                    <div
                      className={cn('h-2.5 rounded-full', isAboveAvg ? 'bg-amber-300 dark:bg-amber-400' : 'bg-blue-300 dark:bg-blue-400')}
                      style={{ width: `${pct}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-px bg-muted-foreground/40"
                      style={{ left: `${avgPct}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-12 text-right">${m.cost.toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground/60 w-14 text-right">{m.calls} calls</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 5: Daily Stacked Bar Chart */}
      <DailyChart data={dailyChart} />

      {/* Section 6: Operation Log */}
      <OperationLog entries={usageLog} sortBy={sortBy} tz={tz} />
    </div>
  );
}


// --- Operation Log ---

function OperationLog({ entries, sortBy, tz }: { entries: UsageLogEntry[]; sortBy: 'date' | 'cost'; tz: string }) {
  const dateFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); // YYYY-MM-DD
  const timeFmt = new Intl.DateTimeFormat('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

  // Group by day
  const byDay = new Map<string, UsageLogEntry[]>();
  for (const e of entries) {
    const day = dateFmt.format(e.createdAt);
    const existing = byDay.get(day) ?? [];
    existing.push(e);
    byDay.set(day, existing);
  }

  let days = Array.from(byDay.entries()).map(([date, ops]) => ({
    date,
    ops,
    totalCost: ops.reduce((s, o) => s + o.cost, 0),
  }));

  if (sortBy === 'cost') {
    days = days.sort((a, b) => b.totalCost - a.totalCost);
  } else {
    days = days.sort((a, b) => b.date.localeCompare(a.date));
  }

  return (
    <div className="bg-card rounded-lg border border-border p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-medium text-muted-foreground">Log de operaciones (30 d&iacute;as)</h2>
        <div className="flex gap-2">
          <Link
            href="/dashboard/usage?sort=date"
            className={cn('text-xs px-2 py-0.5 rounded-full border', sortBy === 'date' ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:border-foreground/30')}
          >
            Por fecha
          </Link>
          <Link
            href="/dashboard/usage?sort=cost"
            className={cn('text-xs px-2 py-0.5 rounded-full border', sortBy === 'cost' ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:border-foreground/30')}
          >
            Por costo
          </Link>
        </div>
      </div>

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">Sin datos</p>
      ) : (
        <div className="space-y-4">
          {days.map(({ date, ops, totalCost }) => (
            <div key={date} id={`day-${date}`}>
              <div className="flex items-baseline justify-between mb-1.5 border-b border-border pb-1">
                <h3 className="text-xs font-medium text-foreground">{date.split('-').reverse().join('/')}</h3>
                <span className="text-xs font-mono text-muted-foreground/60">{ops.length} ops &middot; ${totalCost.toFixed(2)}</span>
              </div>
              <div className="space-y-0.5">
                {ops.map((e) => {
                  const modelShort = e.model.includes('opus') ? 'Opus' : 'Sonnet';
                  const time = timeFmt.format(e.createdAt);
                  const inngestUrl = e.runId ? buildInngestUrl(e.runId) : null;
                  return (
                    <div key={e.id} className="flex items-center gap-2 text-xs py-0.5">
                      <span className="text-muted-foreground/60 font-mono w-16 shrink-0">{time}</span>
                      <div className={cn('w-2 h-2 rounded-sm shrink-0', OP_COLORS[e.operation] ?? 'bg-muted-foreground/40')} />
                      <span className="font-mono text-foreground w-36 shrink-0 truncate">{e.operation}</span>
                      <span className="text-muted-foreground/60 w-12 shrink-0">{modelShort}</span>
                      <span className="text-muted-foreground/60 w-16 text-right shrink-0">{formatTokens(e.inputTokens)}</span>
                      <span className="text-muted-foreground/60 w-16 text-right shrink-0">{formatTokens(e.outputTokens)}</span>
                      <span className="font-mono text-foreground w-14 text-right shrink-0">${e.cost.toFixed(3)}</span>
                      {inngestUrl ? (
                        <a href={inngestUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 shrink-0">
                          inngest
                        </a>
                      ) : (
                        <span className="text-muted-foreground/50 shrink-0">&mdash;</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
