import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import type { SourceContext, Review, Resolution, Iteration, SourcingStep, MarketEventType } from './types';

export const markets = pgTable(
  'markets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    status: varchar('status', { length: 20 }).notNull().default('candidate'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    resolutionCriteria: text('resolution_criteria').notNull(),
    resolutionSource: text('resolution_source').notNull(),
    contingencies: text('contingencies').notNull().default(''),
    category: varchar('category', { length: 30 }).notNull(),
    tags: jsonb('tags').notNull().default([]).$type<string[]>(),
    outcomes: jsonb('outcomes').notNull().default(['Si', 'No']).$type<['Si', 'No']>(),
    endTimestamp: integer('end_timestamp').notNull(),
    expectedResolutionDate: varchar('expected_resolution_date', { length: 10 }),
    timingSafety: varchar('timing_safety', { length: 10 }).notNull().default('safe'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    publishedAt: timestamp('published_at'),
    closedAt: timestamp('closed_at'),
    resolvedAt: timestamp('resolved_at'),
    outcome: varchar('outcome', { length: 5 }),
    sourceContext: jsonb('source_context').notNull().$type<SourceContext>(),
    review: jsonb('review').$type<Review>(),
    iterations: jsonb('iterations').$type<Iteration[]>(),
    resolution: jsonb('resolution').$type<Resolution>(),
  },
  (table) => [
    index('markets_status_idx').on(table.status),
    index('markets_status_created_idx').on(table.status, table.createdAt),
  ],
).enableRLS();

export const marketEvents = pgTable(
  'market_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id').notNull().references(() => markets.id),
    type: varchar('type', { length: 30 }).notNull().$type<MarketEventType>(),
    iteration: integer('iteration'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('market_events_market_idx').on(table.marketId, table.createdAt),
  ],
).enableRLS();

export const sourcingRuns = pgTable('sourcing_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: varchar('status', { length: 20 }).notNull().default('running'),
  currentStep: varchar('current_step', { length: 30 }).notNull().default('check-cap'),
  steps: jsonb('steps').notNull().default([]).$type<SourcingStep[]>(),
  signalsCount: integer('signals_count'),
  candidatesGenerated: integer('candidates_generated'),
  candidatesSaved: integer('candidates_saved'),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}).enableRLS();
