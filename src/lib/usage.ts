import { db } from '@/db/client';
import { llmUsage, markets, marketEvents } from '@/db/schema';
import { sql, gte, lte, eq, and, desc, asc, inArray } from 'drizzle-orm';

export const COST_PER_MTOK = {
  input: { 'claude-sonnet-4-20250514': 3, 'claude-opus-4-20250514': 15 } as Record<string, number>,
  output: { 'claude-sonnet-4-20250514': 15, 'claude-opus-4-20250514': 75 } as Record<string, number>,
} as const;

export function estimateCost(model: string, inputTokens: number, outputTokens: number, cacheCreationTokens = 0, cacheReadTokens = 0): number {
  const inputRate = COST_PER_MTOK.input[model] ?? 3;
  const outputRate = COST_PER_MTOK.output[model] ?? 15;
  return (
    inputTokens * inputRate +
    outputTokens * outputRate +
    cacheCreationTokens * inputRate * 1.25 +
    cacheReadTokens * inputRate * 0.1
  ) / 1_000_000;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export interface OperationUsage {
  operation: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  avgInput: number;
  avgOutput: number;
  cost: number;
}

export interface MarketCost {
  marketId: string;
  title: string;
  status: string;
  cost: number;
  calls: number;
}

export interface UsageData {
  thisWeek: { cost: number; byOperation: OperationUsage[] };
  prevWeek: { cost: number };
  wowDelta: number;
  month: { byOperation: OperationUsage[] };
  costPerMarket: { average: number; markets: MarketCost[] };
}

export async function getUsageData(): Promise<UsageData> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [thisWeekRaw, twoWeeksRaw, monthRaw, recentMarkets] = await Promise.all([
    db
      .select({
        operation: llmUsage.operation,
        model: llmUsage.model,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`sum(${llmUsage.inputTokens})::int`,
        outputTokens: sql<number>`sum(${llmUsage.outputTokens})::int`,
        cacheCreationTokens: sql<number>`coalesce(sum(${llmUsage.cacheCreationTokens}), 0)::int`,
        cacheReadTokens: sql<number>`coalesce(sum(${llmUsage.cacheReadTokens}), 0)::int`,
        avgInput: sql<number>`avg(${llmUsage.inputTokens})::int`,
        avgOutput: sql<number>`avg(${llmUsage.outputTokens})::int`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, sevenDaysAgo))
      .groupBy(llmUsage.operation, llmUsage.model),
    db
      .select({
        operation: llmUsage.operation,
        model: llmUsage.model,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`sum(${llmUsage.inputTokens})::int`,
        outputTokens: sql<number>`sum(${llmUsage.outputTokens})::int`,
        cacheCreationTokens: sql<number>`coalesce(sum(${llmUsage.cacheCreationTokens}), 0)::int`,
        cacheReadTokens: sql<number>`coalesce(sum(${llmUsage.cacheReadTokens}), 0)::int`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, fourteenDaysAgo))
      .groupBy(llmUsage.operation, llmUsage.model),
    db
      .select({
        operation: llmUsage.operation,
        model: llmUsage.model,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`sum(${llmUsage.inputTokens})::int`,
        outputTokens: sql<number>`sum(${llmUsage.outputTokens})::int`,
        cacheCreationTokens: sql<number>`coalesce(sum(${llmUsage.cacheCreationTokens}), 0)::int`,
        cacheReadTokens: sql<number>`coalesce(sum(${llmUsage.cacheReadTokens}), 0)::int`,
        avgInput: sql<number>`avg(${llmUsage.inputTokens})::int`,
        avgOutput: sql<number>`avg(${llmUsage.outputTokens})::int`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, thirtyDaysAgo))
      .groupBy(llmUsage.operation, llmUsage.model),
    db
      .select({ marketId: markets.id, title: markets.title, status: markets.status, createdAt: markets.createdAt })
      .from(markets)
      .where(gte(markets.createdAt, thirtyDaysAgo))
      .orderBy(desc(markets.createdAt))
      .limit(50),
  ]);

  const toOpUsage = (r: typeof thisWeekRaw[number]): OperationUsage => ({
    operation: r.operation,
    model: r.model,
    calls: r.calls,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheCreationTokens: r.cacheCreationTokens,
    cacheReadTokens: r.cacheReadTokens,
    avgInput: 'avgInput' in r ? (r as { avgInput: number }).avgInput : 0,
    avgOutput: 'avgOutput' in r ? (r as { avgOutput: number }).avgOutput : 0,
    cost: estimateCost(r.model, r.inputTokens, r.outputTokens, r.cacheCreationTokens, r.cacheReadTokens),
  });

  const thisWeek = thisWeekRaw.map(toOpUsage);
  const month = monthRaw.map(toOpUsage);

  // Cost per market attribution — single query instead of N+1
  const marketIds = recentMarkets.map((m) => m.marketId);
  const costPerMarketList: MarketCost[] = [];
  if (marketIds.length > 0) {
    const marketUsageRows = await db
      .select({
        marketId: markets.id,
        calls: sql<number>`count(${llmUsage.id})::int`,
        totalInput: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::int`,
        totalOutput: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::int`,
        totalCacheCreation: sql<number>`coalesce(sum(${llmUsage.cacheCreationTokens}), 0)::int`,
        totalCacheRead: sql<number>`coalesce(sum(${llmUsage.cacheReadTokens}), 0)::int`,
        models: sql<string>`string_agg(distinct ${llmUsage.model}, ',')`,
      })
      .from(markets)
      .innerJoin(
        marketEvents,
        and(
          eq(marketEvents.marketId, markets.id),
          inArray(marketEvents.type, ['pipeline_opened', 'pipeline_rejected']),
        ),
      )
      .innerJoin(
        llmUsage,
        and(
          gte(llmUsage.createdAt, markets.createdAt),
          lte(llmUsage.createdAt, marketEvents.createdAt),
          inArray(llmUsage.operation, ['data_verify', 'rules_check', 'score_market', 'improve_market']),
        ),
      )
      .where(inArray(markets.id, marketIds))
      .groupBy(markets.id);

    for (const row of marketUsageRows) {
      const m = recentMarkets.find((r) => r.marketId === row.marketId);
      if (!m || row.calls === 0) continue;
      const models = (row.models ?? '').split(',').filter(Boolean);
      const avgInputRate = models.length > 0
        ? models.reduce((s, model) => s + (COST_PER_MTOK.input[model] ?? 3), 0) / models.length
        : 3;
      const avgOutputRate = models.length > 0
        ? models.reduce((s, model) => s + (COST_PER_MTOK.output[model] ?? 15), 0) / models.length
        : 15;
      const cost = (
        row.totalInput * avgInputRate +
        row.totalOutput * avgOutputRate +
        row.totalCacheCreation * avgInputRate * 1.25 +
        row.totalCacheRead * avgInputRate * 0.1
      ) / 1_000_000;
      costPerMarketList.push({ marketId: m.marketId, title: m.title, status: m.status, cost, calls: row.calls });
    }
  }

  const thisWeekCost = thisWeek.reduce((s, r) => s + r.cost, 0);
  const twoWeeksCost = twoWeeksRaw.reduce((s, r) => s + estimateCost(r.model, r.inputTokens, r.outputTokens, r.cacheCreationTokens, r.cacheReadTokens), 0);
  const prevWeekCost = twoWeeksCost - thisWeekCost;
  const avgCostPerMarket = costPerMarketList.length > 0
    ? costPerMarketList.reduce((s, m) => s + m.cost, 0) / costPerMarketList.length
    : 0;

  return {
    thisWeek: { cost: thisWeekCost, byOperation: thisWeek },
    prevWeek: { cost: prevWeekCost },
    wowDelta: prevWeekCost > 0 ? ((thisWeekCost - prevWeekCost) / prevWeekCost * 100) : 0,
    month: { byOperation: month },
    costPerMarket: { average: avgCostPerMarket, markets: costPerMarketList.slice(0, 20) },
  };
}

// --- Daily chart + operation log ---

export interface DailyOpCost {
  date: string;
  operation: string;
  cost: number;
  calls: number;
}

export interface UsageLogEntry {
  id: string;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  runId: string | null;
  createdAt: Date;
}

export async function getDailyChartData(days: number = 30): Promise<DailyOpCost[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      date: sql<string>`to_char(${llmUsage.createdAt}::date, 'YYYY-MM-DD')`,
      operation: llmUsage.operation,
      model: llmUsage.model,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`sum(${llmUsage.inputTokens})::int`,
      outputTokens: sql<number>`sum(${llmUsage.outputTokens})::int`,
      cacheCreationTokens: sql<number>`coalesce(sum(${llmUsage.cacheCreationTokens}), 0)::int`,
      cacheReadTokens: sql<number>`coalesce(sum(${llmUsage.cacheReadTokens}), 0)::int`,
    })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, since))
    .groupBy(sql`${llmUsage.createdAt}::date`, llmUsage.operation, llmUsage.model)
    .orderBy(asc(sql`${llmUsage.createdAt}::date`));

  // Aggregate across models per day+operation
  const map = new Map<string, DailyOpCost>();
  for (const r of rows) {
    const key = `${r.date}:${r.operation}`;
    const existing = map.get(key);
    const cost = estimateCost(r.model, r.inputTokens, r.outputTokens, r.cacheCreationTokens, r.cacheReadTokens);
    if (existing) {
      existing.cost += cost;
      existing.calls += r.calls;
    } else {
      map.set(key, { date: r.date, operation: r.operation, cost, calls: r.calls });
    }
  }
  return Array.from(map.values());
}

export async function getUsageLog(days: number = 30): Promise<UsageLogEntry[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: llmUsage.id,
      operation: llmUsage.operation,
      model: llmUsage.model,
      inputTokens: llmUsage.inputTokens,
      outputTokens: llmUsage.outputTokens,
      cacheCreationTokens: llmUsage.cacheCreationTokens,
      cacheReadTokens: llmUsage.cacheReadTokens,
      runId: llmUsage.runId,
      createdAt: llmUsage.createdAt,
    })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, since))
    .orderBy(desc(llmUsage.createdAt))
    .limit(500);

  return rows.map((r) => ({
    ...r,
    cost: estimateCost(r.model, r.inputTokens, r.outputTokens, r.cacheCreationTokens, r.cacheReadTokens),
  }));
}
