import type { MarketCategory } from '@/db/types';

export interface DataPoint {
  metric: string;
  currentValue: number;
  previousValue?: number;
  unit: string;
}

export interface SourceSignal {
  id?: string;
  type: 'news' | 'social' | 'event' | 'data';
  text: string;
  summary?: string;
  url?: string;
  source: string;
  publishedAt: string;
  entities: string[];
  category?: MarketCategory;
  dataPoints?: DataPoint[];
  score?: number;
  scoreReason?: string;
}

export interface IngestionResult {
  signals: SourceSignal[];
  dataPoints: DataPoint[];
}

export interface Topic {
  id?: string;
  name: string;
  slug: string;
  summary: string;
  signalIndices: number[];  // used during extraction, not persisted
  suggestedAngles: string[];
  category: MarketCategory;
  score: number;
  status?: 'active' | 'stale' | 'used' | 'dismissed' | 'regular';
  signalCount?: number;
  lastSignalAt?: string;
  lastGeneratedAt?: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

export interface GeneratedCandidate {
  title: string;
  description: string;
  outcomes?: string[];
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
