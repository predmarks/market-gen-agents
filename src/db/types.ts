export const MARKET_STATUSES = [
  'candidate',
  'processing',
  'open',
  'closed',
  'resolved',
  'rejected',
  'cancelled',
] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];

export const MARKET_CATEGORIES = [
  'Política',
  'Economía',
  'Deportes',
  'Entretenimiento',
  'Clima',
  'Otros',
] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

export type TimingSafety = 'safe' | 'caution' | 'dangerous';

export interface SourceContext {
  originType: 'news' | 'social' | 'event_calendar' | 'trending' | 'data_api' | 'manual';
  originUrl?: string;
  originText?: string;
  generatedAt: string;
  topicIds?: string[];
  topicNames?: string[];
}

export interface ReviewScores {
  ambiguity: number;
  timingSafety: number;
  timeliness: number;
  volumePotential: number;
  overallScore: number;
}

export interface RuleResult {
  ruleId: string;
  passed: boolean;
  explanation: string;
}

export interface DataVerification {
  claim: string;
  currentValue: string;
  source: string;
  sourceUrl?: string;
  isAccurate: boolean;
  severity: 'critical' | 'minor';
}

export interface ResolutionSourceCheck {
  exists: boolean;
  accessible: boolean;
  publishesRelevantData: boolean;
  url: string;
  note: string;
}

export interface ReviewResult {
  scores: ReviewScores;
  hardRuleResults: RuleResult[];
  softRuleResults: RuleResult[];
  dataVerification: DataVerification[];
  resolutionSourceCheck?: ResolutionSourceCheck;
  recommendation: 'publish' | 'rewrite_then_publish' | 'hold' | 'reject';
  reviewedAt: string;
}

// Keep Review as alias for backward compatibility with existing DB data
export type Review = ReviewResult;

export interface MarketSnapshot {
  title: string;
  description: string;
  resolutionCriteria: string;
  resolutionSource: string;
  contingencies: string;
  category: MarketCategory;
  tags: string[];
  endTimestamp: number;
  expectedResolutionDate: string;
  timingSafety: TimingSafety;
}

export interface Iteration {
  version: number;
  market: MarketSnapshot;
  review: ReviewResult;
  feedback?: string;
}

export interface Resolution {
  evidence: string;
  evidenceUrls: string[];
  confidence: 'high' | 'medium' | 'low';
  suggestedOutcome: string;
  flaggedAt: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface Market {
  id: string;
  status: MarketStatus;
  title: string;
  description: string;
  resolutionCriteria: string;
  resolutionSource: string;
  contingencies: string;
  category: MarketCategory;
  tags: string[];
  outcomes: string[];
  endTimestamp: number;
  expectedResolutionDate?: string | null;
  timingSafety: TimingSafety;
  createdAt: Date;
  publishedAt?: Date | null;
  closedAt?: Date | null;
  resolvedAt?: Date | null;
  outcome?: string | null;
  sourceContext: SourceContext;
  review?: Review | null;
  iterations?: Iteration[] | null;
  resolution?: Resolution | null;
  isArchived?: boolean;
}

export interface SourcingStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

export const ARCHIVABLE_STATUSES = ['rejected', 'cancelled', 'resolved'] as const;

export const EVENT_TYPES = [
  'pipeline_started', 'pipeline_resumed',
  'data_verified', 'rules_checked', 'scored', 'improved',
  'pipeline_opened', 'pipeline_rejected',
  'human_rejected', 'human_edited',
  'human_feedback', 'human_archived', 'human_unarchived',
  'pipeline_cancelled',
  'status_changed',
] as const;
export type MarketEventType = (typeof EVENT_TYPES)[number];

export interface MarketEvent {
  id: string;
  marketId: string;
  type: MarketEventType;
  iteration?: number | null;
  detail?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface DeployableMarket {
  name: string;
  description: string;
  category: string;
  outcomes: string[];
  endTimestamp: number;
}
