import { ingestNews } from './ingestion-news';
import { ingestData } from './ingestion-data';
import type { IngestionResult, DataPoint } from './types';

export async function ingestAllSources(): Promise<IngestionResult> {
  const [newsSignals, dataSignals] = await Promise.all([
    ingestNews(),
    ingestData(),
  ]);

  // Extract all data points from data signals for the generator prompt
  const dataPoints: DataPoint[] = dataSignals.flatMap(
    (s) => s.dataPoints ?? [],
  );

  return {
    signals: [...newsSignals, ...dataSignals],
    dataPoints,
  };
}
