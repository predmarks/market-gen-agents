import { inngest } from './client';
import { db } from '@/db/client';
import { markets, marketEvents, globalFeedback, signals } from '@/db/schema';
import { eq, and, asc, desc, gte, sql } from 'drizzle-orm';
import type { ReviewResult, Iteration, MarketSnapshot } from '@/db/types';
import { UNFIXABLE_HARD_RULES } from '@/config/rules';
import { THRESHOLDS } from '@/config/scoring';
import { verifyData } from '@/agents/reviewer/data-verifier';
import { checkRules } from '@/agents/reviewer/rules-checker';
import { scoreMarket } from '@/agents/reviewer/scorer';
import { improveMarket } from '@/agents/reviewer/improver';
import { logMarketEvent } from '@/lib/market-events';
import type { MarketRecord } from '@/agents/reviewer/types';

function buildFeedback(
  scoring: { scores: ReviewResult['scores']; recommendation: string },
  rulesCheck: { hardRuleResults: ReviewResult['hardRuleResults']; softRuleResults: ReviewResult['softRuleResults'] },
  verification: { claims: ReviewResult['dataVerification'] },
): string {
  const lines: string[] = [];

  for (const r of rulesCheck.hardRuleResults) {
    if (!r.passed) lines.push(`${r.ruleId} (HARD FAIL): ${r.explanation}`);
  }
  for (const r of rulesCheck.softRuleResults) {
    if (!r.passed) lines.push(`${r.ruleId} (soft): ${r.explanation}`);
  }

  if (scoring.scores.ambiguity < 7) {
    lines.push(`Ambigüedad baja (${scoring.scores.ambiguity}/10) — mejorar criterios de resolución`);
  }
  if (scoring.scores.timingSafety < 7) {
    lines.push(`Timing inseguro (${scoring.scores.timingSafety}/10) — reencuadrar para que no se resuelva con mercado abierto`);
  }
  if (scoring.scores.timeliness < 5) {
    lines.push(`Actualidad baja (${scoring.scores.timeliness}/10)`);
  }
  if (scoring.scores.volumePotential < 5) {
    lines.push(`Potencial de volumen bajo (${scoring.scores.volumePotential}/10)`);
  }

  for (const claim of verification.claims) {
    if (!claim.isAccurate) {
      lines.push(`Dato inexacto: "${claim.claim}" (valor actual: ${claim.currentValue}, fuente: ${claim.source})`);
    }
  }

  return lines.join('\n');
}

function marketToSnapshot(market: MarketRecord): MarketSnapshot {
  return {
    title: market.title,
    description: market.description,
    resolutionCriteria: market.resolutionCriteria,
    resolutionSource: market.resolutionSource,
    contingencies: market.contingencies,
    category: market.category as MarketSnapshot['category'],
    tags: market.tags,
    endTimestamp: market.endTimestamp,
    expectedResolutionDate: market.expectedResolutionDate ?? '',
    timingSafety: market.timingSafety as MarketSnapshot['timingSafety'],
  };
}

export const reviewJob = inngest.createFunction(
  {
    id: 'review-pipeline',
    retries: 5,
    concurrency: { limit: 1 },
    throttle: { limit: 1, period: '2m' },
    cancelOn: [{ event: 'market/review.cancel', if: 'async.data.id == event.data.id' }],
  },
  { event: 'market/candidate.created' },
  async ({ event, step }) => {
    const marketId = event.data.id as string;

    // Init: load market, set status to processing, log start
    const initResult = await step.run('init', async () => {
      const [m] = await db
        .select()
        .from(markets)
        .where(eq(markets.id, marketId));
      if (!m) throw new Error(`Market ${marketId} not found`);

      await db
        .update(markets)
        .set({ status: 'processing' })
        .where(eq(markets.id, marketId));

      const existingIterations = (m.iterations as Iteration[] | null) ?? [];
      const isResume = existingIterations.length > 0;

      await logMarketEvent(marketId, isResume ? 'pipeline_resumed' : 'pipeline_started', {
        detail: { existingIterations: existingIterations.length },
      });

      return { market: m, isResume };
    });

    // Data verification — only on first run (not resume)
    const verification = await step.run('verify-data', async () => {
      const result = await verifyData(initResult.market as MarketRecord);

      await logMarketEvent(marketId, 'data_verified', {
        detail: {
          claimsCount: result.claims.length,
          inaccurateCount: result.claims.filter((c) => !c.isAccurate).length,
        },
      });

      return result;
    });

    // Load open markets for H8 dedup check
    const openMarketsList = await step.run('load-open-markets', async () => {
      return db
        .select({ id: markets.id, title: markets.title })
        .from(markets)
        .where(eq(markets.status, 'open'));
    });

    // Load human feedback for this market
    const humanFeedback = await step.run('load-human-feedback', async () => {
      const feedbackEvents = await db
        .select()
        .from(marketEvents)
        .where(and(eq(marketEvents.marketId, marketId), eq(marketEvents.type, 'human_feedback')))
        .orderBy(asc(marketEvents.createdAt));
      return feedbackEvents.map((e) => ((e.detail as Record<string, unknown>)?.text as string) ?? '');
    });

    // Load global feedback
    const globalFeedbackEntries = await step.run('load-global-feedback', async () => {
      const rows = await db.select().from(globalFeedback).orderBy(asc(globalFeedback.createdAt));
      return rows.map((r) => r.text);
    });

    // Load triage rejection patterns
    const triageFeedback = await step.run('load-triage-feedback', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const rejections = await db
        .select({ detail: marketEvents.detail })
        .from(marketEvents)
        .where(
          and(
            eq(marketEvents.type, 'human_rejected'),
            gte(marketEvents.createdAt, thirtyDaysAgo),
          ),
        )
        .orderBy(desc(marketEvents.createdAt))
        .limit(20);
      return rejections
        .filter((r) => r.detail && typeof r.detail === 'object' && 'reason' in r.detail && (r.detail as Record<string, unknown>).reason)
        .map((r) => `Descarte del editor: ${(r.detail as Record<string, string>).reason}`);
    });

    for (let i = 1; i <= THRESHOLDS.maxIterations; i++) {
      // Load current state from DB (idempotent, works on resume)
      const state = await step.run(`load-state-v${i}`, async () => {
        const [m] = await db
          .select()
          .from(markets)
          .where(eq(markets.id, marketId));
        return {
          currentMarket: m as MarketRecord,
          iterations: (m!.iterations as Iteration[] | null) ?? [],
        };
      });

      // Skip already-completed iteration (resume case)
      if (state.iterations.length >= i) {
        continue;
      }

      const currentMarket = state.currentMarket;
      const iterations = state.iterations;

      // Check rules
      const rulesCheck = await step.run(`check-rules-v${i}`, async () => {
        const result = await checkRules(currentMarket, verification, openMarketsList);

        const failedHard = result.hardRuleResults.filter((r) => !r.passed).map((r) => r.ruleId);
        const failedSoft = result.softRuleResults.filter((r) => !r.passed).map((r) => r.ruleId);
        await logMarketEvent(marketId, 'rules_checked', {
          iteration: i,
          detail: { failedHard, failedSoft },
        });

        return result;
      });

      // Check for unfixable hard rule failures → immediate reject
      const unfixableFail = rulesCheck.hardRuleResults.find(
        (r) => !r.passed && (UNFIXABLE_HARD_RULES as readonly string[]).includes(r.ruleId),
      );

      if (unfixableFail) {
        await step.run(`reject-unfixable-v${i}`, async () => {
          const review: ReviewResult = {
            scores: { ambiguity: 0, timingSafety: 0, timeliness: 0, volumePotential: 0, overallScore: 0 },
            hardRuleResults: rulesCheck.hardRuleResults,
            softRuleResults: rulesCheck.softRuleResults,
            dataVerification: verification.claims,
            resolutionSourceCheck: verification.resolutionSource,
            recommendation: 'reject',
            reviewedAt: new Date().toISOString(),
          };
          await db
            .update(markets)
            .set({ review, iterations, status: 'rejected' })
            .where(eq(markets.id, marketId));

          await logMarketEvent(marketId, 'pipeline_rejected', {
            iteration: i,
            detail: { reason: `Unfixable rule: ${unfixableFail.ruleId}` },
          });
        });
        return { status: 'rejected', marketId, reason: `Unfixable rule: ${unfixableFail.ruleId}`, iteration: i };
      }

      // Score — include related signal count for volume potential
      const scoring = await step.run(`score-v${i}`, async () => {
        // Count recent signals in the same category as a proxy for topic relevance
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const [{ count: signalCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(signals)
          .where(and(
            eq(signals.category, currentMarket.category),
            gte(signals.publishedAt, thirtyDaysAgo),
          ));

        const result = await scoreMarket(currentMarket, verification, rulesCheck, signalCount);

        await logMarketEvent(marketId, 'scored', {
          iteration: i,
          detail: { overallScore: result.scores.overallScore, recommendation: result.recommendation },
        });

        return result;
      });

      // Build review for this iteration
      const review: ReviewResult = {
        scores: scoring.scores,
        hardRuleResults: rulesCheck.hardRuleResults,
        softRuleResults: rulesCheck.softRuleResults,
        dataVerification: verification.claims,
        resolutionSourceCheck: verification.resolutionSource,
        recommendation: scoring.recommendation,
        reviewedAt: new Date().toISOString(),
      };

      const feedback = buildFeedback(scoring, rulesCheck, verification);

      // Save iteration
      const iteration: Iteration = {
        version: i,
        market: marketToSnapshot(currentMarket),
        review,
        feedback: feedback || undefined,
      };
      const updatedIterations = [...iterations, iteration];

      // Check if good enough → open
      if (scoring.scores.overallScore >= THRESHOLDS.passingScore && scoring.recommendation !== 'reject') {
        await step.run(`promote-v${i}`, async () => {
          await db
            .update(markets)
            .set({ review, iterations: updatedIterations, status: 'open', publishedAt: new Date() })
            .where(eq(markets.id, marketId));

          await logMarketEvent(marketId, 'pipeline_opened', {
            iteration: i,
            detail: { score: scoring.scores.overallScore },
          });
        });
        return { status: 'open', marketId, iteration: i, score: scoring.scores.overallScore };
      }

      // Last iteration and still not good enough → reject
      if (i === THRESHOLDS.maxIterations) {
        await step.run('reject-low-score', async () => {
          await db
            .update(markets)
            .set({ review, iterations: updatedIterations, status: 'rejected' })
            .where(eq(markets.id, marketId));

          await logMarketEvent(marketId, 'pipeline_rejected', {
            iteration: i,
            detail: { score: scoring.scores.overallScore, reason: 'Below threshold after max iterations' },
          });
        });
        return { status: 'rejected', marketId, reason: 'Below threshold after max iterations', score: scoring.scores.overallScore };
      }

      // Improve for next iteration
      await step.run(`improve-v${i}`, async () => {
        // Save iteration progress to DB for monitoring visibility
        await db
          .update(markets)
          .set({ review, iterations: updatedIterations })
          .where(eq(markets.id, marketId));

        const allHumanFeedback = [...globalFeedbackEntries, ...humanFeedback, ...triageFeedback];
        const improved = await improveMarket(currentMarket, feedback, updatedIterations, allHumanFeedback);

        // Apply improved snapshot to market
        await db
          .update(markets)
          .set({
            title: improved.title,
            description: improved.description,
            resolutionCriteria: improved.resolutionCriteria,
            resolutionSource: improved.resolutionSource,
            contingencies: improved.contingencies,
            category: improved.category,
            tags: improved.tags,
            endTimestamp: improved.endTimestamp,
            expectedResolutionDate: improved.expectedResolutionDate,
            timingSafety: improved.timingSafety,
          })
          .where(eq(markets.id, marketId));

        await logMarketEvent(marketId, 'improved', {
          iteration: i,
          detail: { titleChanged: improved.title !== currentMarket.title },
        });
      });
    }
  },
);
