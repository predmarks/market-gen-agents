export const dynamic = 'force-dynamic';

import { db } from '@/db/client';
import { llmUsage } from '@/db/schema';
import { sql, gte } from 'drizzle-orm';

const COST_PER_MTOK = {
  input: { 'claude-sonnet-4-20250514': 3, 'claude-opus-4-20250514': 15 },
  output: { 'claude-sonnet-4-20250514': 15, 'claude-opus-4-20250514': 75 },
} as const;

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const inputRate = (COST_PER_MTOK.input as Record<string, number>)[model] ?? 3;
  const outputRate = (COST_PER_MTOK.output as Record<string, number>)[model] ?? 15;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface UsageRow {
  operation: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

async function getUsage(since: Date): Promise<UsageRow[]> {
  try {
    const rows = await db
      .select({
        operation: llmUsage.operation,
        model: llmUsage.model,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`sum(${llmUsage.inputTokens})::int`,
        outputTokens: sql<number>`sum(${llmUsage.outputTokens})::int`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, since))
      .groupBy(llmUsage.operation, llmUsage.model)
      .orderBy(sql`sum(${llmUsage.inputTokens}) + sum(${llmUsage.outputTokens}) desc`);

    return rows;
  } catch {
    return [];
  }
}

export default async function UsagePage() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [day, week, month] = await Promise.all([
    getUsage(oneDayAgo),
    getUsage(sevenDaysAgo),
    getUsage(thirtyDaysAgo),
  ]);

  function renderTable(rows: UsageRow[], label: string) {
    const totalInput = rows.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutput = rows.reduce((s, r) => s + r.outputTokens, 0);
    const totalCost = rows.reduce((s, r) => s + estimateCost(r.model, r.inputTokens, r.outputTokens), 0);
    const totalCalls = rows.reduce((s, r) => s + r.calls, 0);

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-500">{label}</h2>
          <div className="text-xs text-gray-400">
            {totalCalls} llamadas &middot; {formatTokens(totalInput + totalOutput)} tokens &middot; ~${totalCost.toFixed(2)}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400">Sin datos</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="pb-2">Operación</th>
                <th className="pb-2">Modelo</th>
                <th className="pb-2 text-right">Llamadas</th>
                <th className="pb-2 text-right">Input</th>
                <th className="pb-2 text-right">Output</th>
                <th className="pb-2 text-right">Costo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cost = estimateCost(r.model, r.inputTokens, r.outputTokens);
                const modelShort = r.model.includes('opus') ? 'Opus' : 'Sonnet';
                return (
                  <tr key={`${r.operation}-${r.model}`} className="border-b border-gray-50">
                    <td className="py-1.5 font-mono text-xs">{r.operation}</td>
                    <td className="py-1.5 text-xs text-gray-500">{modelShort}</td>
                    <td className="py-1.5 text-right">{r.calls}</td>
                    <td className="py-1.5 text-right text-gray-600">{formatTokens(r.inputTokens)}</td>
                    <td className="py-1.5 text-right text-gray-600">{formatTokens(r.outputTokens)}</td>
                    <td className="py-1.5 text-right font-mono">${cost.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Uso de LLM</h1>
      {renderTable(day, 'Últimas 24 horas')}
      {renderTable(week, 'Últimos 7 días')}
      {renderTable(month, 'Últimos 30 días')}
    </div>
  );
}
