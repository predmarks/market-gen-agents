import { inngest } from './client';
import { db } from '@/db/client';
import { markets, signals, topics, topicSignals, newsletters, newsletterRuns } from '@/db/schema';
import { eq, and, gte, desc, inArray } from 'drizzle-orm';
import { writeNewsletter } from '@/agents/newsletter/writer';
import type { NewsletterMarket, ResolvedMarket, Topic, Signal, HottestTopic } from '@/agents/newsletter/writer';
import type { ReviewScores, SourceContext, Resolution, SourcingStep } from '@/db/types';
import { logActivity, inngestRunUrl } from '@/lib/activity-log';
import { setCurrentRunId } from '@/lib/llm';
import { getRunCost } from '@/lib/usage';
import { fetchMarketPrices } from '@/lib/onchain';
import { getPredmarksUrl } from '@/lib/chains';

const STEP_NAMES = [
  'load-open-markets',
  'load-resolved',
  'load-topics',
  'write-newsletter',
  'save-newsletter',
  'log',
] as const;

function buildSteps(currentIdx: number, detail?: string): SourcingStep[] {
  return STEP_NAMES.map((name, i) => ({
    name,
    status: i < currentIdx ? 'done' : i === currentIdx ? 'running' : 'pending',
    ...(i === currentIdx && detail ? { detail } : {}),
  }));
}

export const newsletterJob = inngest.createFunction(
  {
    id: 'newsletter-writer',
    retries: 3,
    concurrency: { limit: 1 },
  },
  { event: 'newsletter/generate.requested' },
  async ({ event, step, runId: inngestId }) => {
    const runUrl = inngestRunUrl('newsletter-writer', inngestId);
    setCurrentRunId(`newsletter-writer/${inngestId}`);

    const date = (event.data?.date as string) ?? new Date().toISOString().split('T')[0];

    // Init: create run record
    const runId = await step.run('init-run', async () => {
      const [run] = await db
        .insert(newsletterRuns)
        .values({
          status: 'running',
          currentStep: 'load-open-markets',
          steps: buildSteps(0),
        })
        .returning({ id: newsletterRuns.id });
      await logActivity('newsletter_generation_started', {
        entityType: 'system',
        detail: { date, inngestRunUrl: runUrl },
        source: 'pipeline',
      });
      return run.id;
    });

    async function updateRun(stepIdx: number, updates: Partial<typeof newsletterRuns.$inferInsert> = {}) {
      await db
        .update(newsletterRuns)
        .set({
          currentStep: STEP_NAMES[stepIdx] ?? 'done',
          steps: buildSteps(stepIdx),
          ...updates,
        })
        .where(eq(newsletterRuns.id, runId));
    }

    try {
      // Step 0: Load deployed markets with on-chain prices
      const deployedMarkets = await step.run('load-open-markets', async () => {
        await updateRun(0);
        const rows = await db
          .select()
          .from(markets)
          .where(and(
            inArray(markets.status, ['open', 'in_resolution', 'closed']),
            eq(markets.isArchived, false),
          ))
          .orderBy(desc(markets.publishedAt));

        // Fetch on-chain prices for each market with an onchainId
        const marketsWithPrices = await Promise.all(
          rows.map(async (m): Promise<NewsletterMarket> => {
            const outcomes = m.outcomes as string[];
            let prices: number[] | null = null;
            if (m.onchainId) {
              try {
                prices = await fetchMarketPrices(Number(m.onchainId), outcomes.length, m.chainId);
              } catch {
                // Price fetch failed — continue without prices
              }
            }
            const url = m.onchainId
              ? `${getPredmarksUrl(m.chainId)}/mercados/${m.onchainId}`
              : null;

            return {
              id: m.id,
              title: m.title,
              description: m.description,
              category: m.category,
              status: m.status as 'open' | 'in_resolution' | 'closed',
              outcomes,
              endTimestamp: m.endTimestamp,
              volume: m.volume,
              participants: m.participants,
              publishedAt: m.publishedAt?.toISOString() ?? null,
              review: m.review ? { scores: (m.review as { scores: ReviewScores }).scores } : null,
              sourceContext: m.sourceContext as SourceContext,
              prices,
              url,
              topics: [], // populated in load-topics step
            };
          }),
        );

        return marketsWithPrices;
      });

      if (deployedMarkets.length === 0) {
        await step.run('mark-skipped', async () => {
          await db
            .update(newsletterRuns)
            .set({
              status: 'skipped',
              currentStep: 'done',
              steps: STEP_NAMES.map((name) => ({ name, status: 'done' as const })),
              completedAt: new Date(),
            })
            .where(eq(newsletterRuns.id, runId));
        });
        return { status: 'skipped', reason: 'no_deployed_markets' };
      }

      // Step 1: Load recently resolved markets
      const resolvedMarkets = await step.run('load-resolved', async () => {
        await updateRun(1);
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const rows = await db
          .select()
          .from(markets)
          .where(and(
            eq(markets.status, 'closed'),
            gte(markets.resolvedAt, oneWeekAgo),
          ))
          .orderBy(desc(markets.resolvedAt));

        return rows.map((m): ResolvedMarket => ({
          title: m.title,
          outcome: m.outcome,
          resolvedAt: m.resolvedAt?.toISOString() ?? null,
          volume: m.volume,
          participants: m.participants,
          resolution: m.resolution as Resolution | null,
        }));
      });

      // Step 2: Load active topics with signals and attach to markets
      const { marketsWithTopics, hottestTopic } = await step.run('load-topics', async () => {
        await updateRun(2);
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        // Load all active topics (no cap)
        const topicRows = await db
          .select()
          .from(topics)
          .where(eq(topics.status, 'active'))
          .orderBy(desc(topics.score));

        // Load signals for each topic
        const topicsWithSignals = await Promise.all(topicRows.map(async (t): Promise<Topic & { id: string }> => {
          const signalRows = await db
            .select({ signal: signals })
            .from(topicSignals)
            .innerJoin(signals, eq(signals.id, topicSignals.signalId))
            .where(and(
              eq(topicSignals.topicId, t.id),
              gte(signals.createdAt, oneWeekAgo),
            ))
            .orderBy(desc(signals.score))
            .limit(5);

          return {
            id: t.id,
            name: t.name,
            summary: t.summary,
            category: t.category,
            suggestedAngles: t.suggestedAngles as string[],
            score: t.score,
            signals: signalRows.map((r): Signal => ({
              text: r.signal.text,
              summary: r.signal.summary,
              url: r.signal.url,
              source: r.signal.source,
              category: r.signal.category,
              score: r.signal.score,
              publishedAt: r.signal.publishedAt.toISOString(),
            })),
          };
        }));

        const topicById = new Map(topicsWithSignals.map((t) => [t.id, t]));

        // Attach topics to each market via sourceContext.topicIds
        const enriched: NewsletterMarket[] = deployedMarkets.map((m) => {
          const topicIds = (m.sourceContext.topicIds ?? []) as string[];
          const matched: Topic[] = topicIds
            .map((id) => topicById.get(id))
            .filter((t): t is Topic & { id: string } => t != null)
            .map(({ id: _id, ...rest }) => rest);
          return { ...m, topics: matched };
        });

        // Compute hottest topic: only topics linked to at least one open market
        const now = Math.floor(Date.now() / 1000);
        const twoWeeks = 14 * 24 * 60 * 60;
        const linkedTopicIds = new Set(enriched.flatMap((m) => (m.sourceContext.topicIds ?? []) as string[]));

        let best: HottestTopic | null = null;
        let bestScore = -Infinity;

        for (const t of topicsWithSignals) {
          if (!linkedTopicIds.has(t.id)) continue;

          const linkedMarkets = enriched.filter((m) =>
            ((m.sourceContext.topicIds ?? []) as string[]).includes(t.id),
          );
          const hasUrgent = linkedMarkets.some((m) => m.endTimestamp - now <= twoWeeks && m.endTimestamp - now > 0);

          // Weighted score: topic score + signal freshness + urgency bonus
          const composite = t.score + t.signals.length * 2 + (hasUrgent ? 5 : 0);

          if (composite > bestScore) {
            bestScore = composite;
            best = {
              name: t.name,
              summary: t.summary,
              category: t.category,
              score: t.score,
              signalCount: t.signals.length,
              linkedMarketTitles: linkedMarkets.map((m) => m.title),
            };
          }
        }

        return { marketsWithTopics: enriched, hottestTopic: best };
      });

      // Step 3: Generate newsletter via LLM
      const newsletter = await step.run('write-newsletter', async () => {
        await updateRun(3);
        const raw = await writeNewsletter({
          deployedMarkets: marketsWithTopics,
          resolvedMarkets,
          hottestTopic,
          date,
        });

        const featuredRaw = Array.isArray(raw.featuredMarkets) ? raw.featuredMarkets : [];
        const resolvedRaw = Array.isArray(raw.resolvedEntries) ? raw.resolvedEntries : [];

        // Validate: every featured market must exist in the input
        const deployedMarketIds = new Set(marketsWithTopics.map((m) => m.id));
        const deployedMarketById = new Map(marketsWithTopics.map((m) => [m.id, m]));

        const validatedFeatured = featuredRaw
          .filter((fm) => deployedMarketIds.has(fm.marketId))
          .map((fm) => {
            // Fix URL to match our ground-truth data
            const source = deployedMarketById.get(fm.marketId)!;
            return { ...fm, url: source.url ?? fm.url };
          });

        const strippedCount = featuredRaw.length - validatedFeatured.length;
        if (strippedCount > 0) {
          const badIds = featuredRaw
            .filter((fm) => !deployedMarketIds.has(fm.marketId))
            .map((fm) => `${fm.marketId} ("${fm.title}")`);
          console.warn(`[newsletter] Stripped ${strippedCount} hallucinated market(s): ${badIds.join(', ')}`);
        }

        if (validatedFeatured.length === 0) {
          throw new Error('Newsletter generation failed: all featured markets were hallucinated (no valid market IDs)');
        }

        return {
          ...raw,
          featuredMarkets: validatedFeatured,
          resolvedEntries: resolvedRaw,
        };
      });

      // Step 4: Save to DB
      const newsletterId = await step.run('save-newsletter', async () => {
        await updateRun(4);
        const [row] = await db.insert(newsletters).values({
          date,
          status: 'draft',
          subjectLine: newsletter.subjectLine,
          markdown: newsletter.markdown,
          html: newsletter.html ?? '',
          featuredMarketIds: newsletter.featuredMarkets.map((m) => m.marketId),
          metadata: {
            deployedMarketsCount: deployedMarkets.length,
            resolvedCount: newsletter.resolvedEntries.length,
            hottestTopic: hottestTopic?.name ?? null,
            featuredMarkets: newsletter.featuredMarkets,
            resolvedEntries: newsletter.resolvedEntries,
            openingHook: newsletter.openingHook,
            closingCta: newsletter.closingCta,
          },
        }).returning({ id: newsletters.id });

        await db
          .update(newsletterRuns)
          .set({ newsletterId: row.id })
          .where(eq(newsletterRuns.id, runId));

        return row.id;
      });

      // Step 5: Log activity & mark complete
      await step.run('log', async () => {
        await updateRun(5);
        const costUsd = await getRunCost(`newsletter-writer/${inngestId}`);
        await logActivity('newsletter_generation_completed', {
          entityType: 'newsletter',
          entityId: newsletterId,
          entityLabel: `Newsletter ${date}`,
          detail: {
            date,
            subjectLine: newsletter.subjectLine,
            featuredCount: newsletter.featuredMarkets.length,
            resolvedCount: newsletter.resolvedEntries.length,
            inngestRunUrl: runUrl,
            costUsd,
          },
          source: 'pipeline',
        });

        await db
          .update(newsletterRuns)
          .set({
            status: 'complete',
            currentStep: 'done',
            steps: STEP_NAMES.map((name) => ({ name, status: 'done' as const })),
            completedAt: new Date(),
          })
          .where(eq(newsletterRuns.id, runId));
      });

      return {
        status: 'complete',
        newsletterId,
        date,
        subjectLine: newsletter.subjectLine,
      };
    } catch (err) {
      await db
        .update(newsletterRuns)
        .set({
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        })
        .where(eq(newsletterRuns.id, runId));
      await logActivity('newsletter_generation_failed', {
        entityType: 'system',
        detail: { error: err instanceof Error ? err.message : String(err), inngestRunUrl: runUrl },
        source: 'pipeline',
      });
      throw err;
    }
  },
);
