import type { SourceContext, Review, Resolution, Iteration } from '@/db/types';

/**
 * Market record type that works with both Drizzle select results (Date fields)
 * and Inngest-serialized data (Date fields become strings).
 */
export interface MarketRecord {
  id: string;
  status: string;
  title: string;
  description: string;
  resolutionCriteria: string;
  resolutionSource: string;
  contingencies: string;
  category: string;
  tags: string[];
  outcomes: ['Si', 'No'];
  endTimestamp: number;
  expectedResolutionDate: string | null;
  timingSafety: string;
  createdAt: Date | string;
  publishedAt: Date | string | null;
  closedAt: Date | string | null;
  resolvedAt: Date | string | null;
  outcome: string | null;
  sourceContext: SourceContext;
  review: Review | null;
  iterations?: Iteration[] | null;
  resolution: Resolution | null;
}
