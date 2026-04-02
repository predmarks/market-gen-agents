import type { SignalSource } from '@/config/sources';
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

async function fetchBCRAVariable(source: SignalSource): Promise<DataPoint | null> {
  const config = source.config as { variableId: number; metric: string; unit: string };
  const { desde, hasta } = getDateRange();
  const url = `${source.url}?desde=${desde}&hasta=${hasta}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    console.warn(`BCRA API failed for ${config.metric}: ${res.status}`);
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
    metric: config.metric,
    currentValue: current.valor,
    previousValue: previous?.valor,
    unit: config.unit,
  };
}

async function fetchAmbitoSource(source: SignalSource): Promise<DataPoint | null> {
  const config = source.config as { metric: string; unit: string };

  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const data = await res.json();

    if (config.metric === 'Riesgo País') {
      const valor = parseInt(data.ultimo, 10);
      if (isNaN(valor)) return null;
      return { metric: config.metric, currentValue: valor, unit: config.unit };
    }

    // Dólar Blue and similar currency sources
    const venta = parseFloat(data.venta?.replace(',', '.'));
    const compra = parseFloat(data.compra?.replace(',', '.'));
    if (isNaN(venta)) return null;

    return {
      metric: config.metric,
      currentValue: venta,
      previousValue: compra !== venta ? compra : undefined,
      unit: config.unit,
    };
  } catch (err) {
    console.warn(`Ámbito fetch failed for ${config.metric}:`, err);
    return null;
  }
}

export async function ingestData(sources: SignalSource[]): Promise<SourceSignal[]> {
  const promises = sources.map(async (source) => {
    const provider = (source.config as { provider?: string })?.provider;
    if (provider === 'bcra') return fetchBCRAVariable(source);
    if (provider === 'ambito') return fetchAmbitoSource(source);
    console.warn(`Unknown API provider for source "${source.name}"`);
    return null;
  });

  const results = await Promise.allSettled(promises);
  const signals: SourceSignal[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
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
      source: sources[i].name,
      publishedAt: new Date().toISOString(),
      entities: [],
      dataPoints: [dataPoint],
    });
  }

  return signals;
}
