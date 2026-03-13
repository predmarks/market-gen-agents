import type { MarketCategory } from '@/db/types';

export interface DataPoint {
  metric: string;
  currentValue: number;
  previousValue?: number;
  unit: string;
}

export interface SourceSignal {
  type: 'news' | 'social' | 'event' | 'data';
  text: string;
  summary?: string;
  url?: string;
  source: string;
  publishedAt: string;
  entities: string[];
  category?: MarketCategory;
  dataPoints?: DataPoint[];
}

export interface IngestionResult {
  signals: SourceSignal[];
  dataPoints: DataPoint[];
}

export interface GeneratedCandidate {
  title: string;
  description: string;
  resolutionCriteria: string;
  resolutionSource: string;
  contingencies: string;
  category: MarketCategory;
  tags: string[];
  endTimestamp: number;
  expectedResolutionDate: string;
  timingAnalysis: string;
  requiresVerification?: string[];
}
