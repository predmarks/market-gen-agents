import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  real,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import type { SourceContext, Review, Resolution, Iteration, MarketSnapshot, SourcingStep, MarketEventType } from './types';
import type { SourceSignal } from '@/agents/sourcer/types';

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
    outcomes: jsonb('outcomes').notNull().default(['Si', 'No']).$type<string[]>(),
    endTimestamp: integer('end_timestamp').notNull(),
    expectedResolutionDate: varchar('expected_resolution_date', { length: 10 }),
    timingSafety: varchar('timing_safety', { length: 10 }).notNull().default('safe'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    publishedAt: timestamp('published_at'),
    closedAt: timestamp('closed_at'),
    resolvedAt: timestamp('resolved_at'),
    outcome: varchar('outcome', { length: 200 }),
    sourceContext: jsonb('source_context').notNull().$type<SourceContext>(),
    review: jsonb('review').$type<Review>(),
    iterations: jsonb('iterations').$type<Iteration[]>(),
    pendingSuggestion: jsonb('pending_suggestion').$type<MarketSnapshot>(),
    resolution: jsonb('resolution').$type<Resolution>(),
    isArchived: boolean('is_archived').notNull().default(false),
    onchainId: varchar('onchain_id', { length: 20 }),
    onchainAddress: varchar('onchain_address', { length: 42 }),
    volume: varchar('volume', { length: 40 }),
    participants: integer('participants'),
    ownedParticipants: integer('owned_participants').default(0),
    pendingBalance: varchar('pending_balance', { length: 40 }),
    seededAmount: varchar('seeded_amount', { length: 40 }),
    chainId: integer('chain_id').notNull().default(8453),
  },
  (table) => [
    index('markets_status_idx').on(table.status),
    index('markets_status_created_idx').on(table.status, table.createdAt),
    uniqueIndex('markets_onchain_id_chain_idx').on(table.onchainId, table.chainId),
    index('markets_chain_id_idx').on(table.chainId),
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
  signals: jsonb('signals').$type<SourceSignal[]>(),
  topics: jsonb('topics').$type<import('@/agents/sourcer/types').Topic[]>(),
  signalsCount: integer('signals_count'),
  candidatesGenerated: integer('candidates_generated'),
  candidatesSaved: integer('candidates_saved'),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}).enableRLS();

export const signals = pgTable(
  'signals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: varchar('type', { length: 10 }).notNull(),
    text: text('text').notNull(),
    summary: text('summary'),
    url: text('url'),
    source: varchar('source', { length: 50 }).notNull(),
    category: varchar('category', { length: 30 }),
    publishedAt: timestamp('published_at').notNull(),
    dataPoints: jsonb('data_points').$type<import('@/agents/sourcer/types').DataPoint[]>(),
    score: real('score'),
    scoreReason: text('score_reason'),
    scoredAt: timestamp('scored_at'),
    usedInRun: uuid('used_in_run').references(() => sourcingRuns.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('signals_url_idx').on(table.url),
    index('signals_created_idx').on(table.createdAt),
    index('signals_score_idx').on(table.score),
  ],
).enableRLS();

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    summary: text('summary').notNull(),
    category: varchar('category', { length: 30 }).notNull(),
    suggestedAngles: jsonb('suggested_angles').notNull().default([]).$type<string[]>(),
    score: real('score').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    signalCount: integer('signal_count').notNull().default(0),
    lastSignalAt: timestamp('last_signal_at'),
    lastGeneratedAt: timestamp('last_generated_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    feedback: jsonb('feedback').default([]).$type<{ text: string; createdAt: string }[]>(),
    embedding: jsonb('embedding').$type<number[]>(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('topics_status_idx').on(table.status),
    index('topics_score_idx').on(table.score),
  ],
).enableRLS();

export const topicSignals = pgTable(
  'topic_signals',
  {
    topicId: uuid('topic_id').notNull().references(() => topics.id),
    signalId: uuid('signal_id').notNull().references(() => signals.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.topicId, table.signalId] }),
    index('topic_signals_topic_idx').on(table.topicId),
  ],
).enableRLS();

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    contextType: varchar('context_type', { length: 20 }).notNull().default('global'),
    contextId: uuid('context_id'),
    title: text('title').notNull(),
    messages: jsonb('messages').notNull().default([]).$type<{ role: 'user' | 'assistant'; content: string }[]>(),
    // Full Anthropic API messages including tool_use/tool_result blocks for multi-turn context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiMessages: jsonb('api_messages').$type<any[]>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('conversations_context_idx').on(table.contextType, table.contextId),
  ],
).enableRLS();

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    action: varchar('action', { length: 50 }).notNull(),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: uuid('entity_id'),
    entityLabel: text('entity_label'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    source: varchar('source', { length: 20 }).notNull().default('ui'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('activity_log_created_idx').on(table.createdAt),
  ],
).enableRLS();

export const rules = pgTable('rules', {
  id: varchar('id', { length: 10 }).primaryKey(),
  type: varchar('type', { length: 10 }).notNull(),
  description: text('description').notNull(),
  check: text('check').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}).enableRLS();

export const config = pgTable('config', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}).enableRLS();

export const llmUsage = pgTable(
  'llm_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    operation: varchar('operation', { length: 50 }).notNull(),
    model: varchar('model', { length: 50 }).notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    runId: varchar('run_id', { length: 100 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('llm_usage_operation_idx').on(table.operation),
    index('llm_usage_created_idx').on(table.createdAt),
  ],
).enableRLS();

export const globalFeedback = pgTable('global_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}).enableRLS();

export const resolutionFeedback = pgTable('resolution_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  text: text('text').notNull(),
  marketId: uuid('market_id').references(() => markets.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}).enableRLS();

export const newsletters = pgTable(
  'newsletters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    date: varchar('date', { length: 10 }).notNull(), // YYYY-MM-DD
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    subjectLine: text('subject_line').notNull(),
    markdown: text('markdown').notNull(),
    html: text('html').notNull(),
    featuredMarketIds: jsonb('featured_market_ids').notNull().default([]).$type<string[]>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('newsletters_date_idx').on(table.date),
    index('newsletters_status_idx').on(table.status),
  ],
).enableRLS();

export const newsletterRuns = pgTable('newsletter_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: varchar('status', { length: 20 }).notNull().default('running'),
  currentStep: varchar('current_step', { length: 30 }).notNull().default('load-open-markets'),
  steps: jsonb('steps').notNull().default([]).$type<SourcingStep[]>(),
  error: text('error'),
  newsletterId: uuid('newsletter_id'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}).enableRLS();

export const signalSources = pgTable('signal_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // 'rss' | 'scrape' | 'api' | 'social'
  url: text('url').notNull(),
  category: varchar('category', { length: 30 }),
  enabled: boolean('enabled').notNull().default(true),
  config: jsonb('config').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('signal_sources_type_idx').on(table.type),
]).enableRLS();

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: varchar('username', { length: 50 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}).enableRLS();

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('sessions_token_idx').on(table.token)],
).enableRLS();
