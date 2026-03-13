import { BCRA_VARIABLES, BCRA_API_BASE, AMBITO_DOLAR_BLUE_URL } from '@/config/sources';
import type { SourceSignal, DataPoint } from './types';

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getDateRange(): { desde: string; hasta: string } {
  const hasta = new Date();
  const desde = new Date();
  desde.setDate(desde.getDate() - 7); // 7 days back to cover weekends/holidays
  return { desde: formatDate(desde), hasta: formatDate(hasta) };
}

async function fetchBCRAVariable(variableId: number, metric: string, unit: string): Promise<DataPoint | null> {
  const { desde, hasta } = getDateRange();
  const url = `${BCRA_API_BASE}/${variableId}?desde=${desde}&hasta=${hasta}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    console.warn(`BCRA API failed for variable ${variableId}: ${res.status}`);
    return null;
  }

  const data = await res.json();
  // v4.0 uses results[0].detalle, v2.0 used results directly
  const detalle = data.results?.[0]?.detalle ?? data.results;
  const entries = detalle as { fecha: string; valor: number }[];

  if (!entries || entries.length === 0) return null;

  const current = entries[entries.length - 1];
  const previous = entries.length > 1 ? entries[entries.length - 2] : undefined;

  return {
    metric,
    currentValue: current.valor,
    previousValue: previous?.valor,
    unit,
  };
}

async function fetchDolarBlue(): Promise<DataPoint | null> {
  try {
    const res = await fetch(AMBITO_DOLAR_BLUE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    // Ámbito returns: { compra, venta, fecha, variacion, ... }
    const venta = parseFloat(data.venta?.replace(',', '.'));
    const compra = parseFloat(data.compra?.replace(',', '.'));

    if (isNaN(venta)) return null;

    return {
      metric: 'Dólar Blue',
      currentValue: venta,
      previousValue: compra !== venta ? compra : undefined,
      unit: 'ARS (venta)',
    };
  } catch (err) {
    console.warn('Dolar blue fetch failed:', err);
    return null;
  }
}

export async function ingestData(): Promise<SourceSignal[]> {
  const bcraPromises = BCRA_VARIABLES.map((v) =>
    fetchBCRAVariable(v.id, v.metric, v.unit),
  );

  const results = await Promise.allSettled([
    ...bcraPromises,
    fetchDolarBlue(),
  ]);

  const signals: SourceSignal[] = [];

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Data fetch failed:', result.reason);
      continue;
    }

    const dataPoint = result.value;
    if (!dataPoint) continue;

    const prevText = dataPoint.previousValue != null
      ? ` (anterior: ${dataPoint.previousValue})`
      : '';

    signals.push({
      type: 'data',
      text: `${dataPoint.metric}: ${dataPoint.currentValue} ${dataPoint.unit}${prevText}`,
      source: dataPoint.metric.includes('BCRA') || dataPoint.metric.includes('Base Monetaria')
        ? 'BCRA API'
        : 'Ámbito Financiero',
      publishedAt: new Date().toISOString(),
      entities: [],
      dataPoints: [dataPoint],
    });
  }

  return signals;
}
