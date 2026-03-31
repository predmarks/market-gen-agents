import { inngest } from './client';
import { db } from '@/db/client';
import { markets, marketEvents, globalFeedback, signals } from '@/db/schema';
import { eq, and, asc, desc, gte, sql } from 'drizzle-orm';
import type { ReviewResult, Iteration, MarketSnapshot } from '@/db/types';
import { THRESHOLDS } from '@/config/scoring';
import { verifyData } from '@/agents/reviewer/data-verifier';
import { checkRules } from '@/agents/reviewer/rules-checker';
import { scoreMarket } from '@/agents/reviewer/scorer';
import { improveMarket } from '@/agents/reviewer/improver';
import { logMarketEvent } from '@/lib/market-events';
import { logActivity, inngestRunUrl } from '@/lib/activity-log';
import { setCurrentRunId } from '@/lib/llm';
import { validateMarket } from '@/lib/validate-market';
import type { MarketRecord } from '@/agents/reviewer/types';

function buildFeedback(
  scoring: { scores: ReviewResult['scores']; recommendation: string },
  rulesCheck: { hardRuleResults: ReviewResult['hardRuleResults']; softRuleResults: ReviewResult['softRuleResults'] },
  verification: { claims: ReviewResult['dataVerification'] },
  previousFeedback?: string,
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

  // Tag items that appeared in the previous iteration's feedback as unfixed
  if (previousFeedback) {
    const prevLines = new Set(
      previousFeedback.split('\n').filter(Boolean).map((l) => l.replace(/^\[NO CORREGIDO\] /, '')),
    );
    return lines.map((line) => prevLines.has(line) ? `[NO CORREGIDO] ${line}` : line).join('\n');
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
    outcomes: market.outcomes,
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
    onFailure: async ({ event }) => {
      const marketId = event.data.event.data.id as string;
      await db
        .update(markets)
        .set({ status: 'candidate' })
        .where(eq(markets.id, marketId));
      await logActivity('review_failed', {
        entityType: 'market',
        entityId: marketId,
        entityLabel: '',
        detail: { error: (event.data as Record<string, unknown>).error },
        source: 'pipeline',
      });
    },
  },
  { event: 'market/candidate.created' },
  async ({ event, step, runId }) => {
    const marketId = event.data.id as string;
    const runUrl = inngestRunUrl('review-pipeline', runId);
    setCurrentRunId(`review-pipeline/${runId}`);

    // Init: load market, set status to processing, log start
    const initResult = await step.run('init', async () => {
      const [m] = await db
        .select()
        .from(markets)
        .where(eq(markets.id, marketId));
      if (!m) throw new Error(`Market ${marketId} not found`);

      if (m.chainId !== 8453) {
        return { market: m, isResume: false, skipped: true as const };
      }

      await db
        .update(markets)
        .set({ status: 'processing' })
        .where(eq(markets.id, marketId));

      const existingIterations = (m.iterations as Iteration[] | null) ?? [];
      const isResume = existingIterations.length > 0;

      await logMarketEvent(marketId, isResume ? 'pipeline_resumed' : 'pipeline_started', {
        detail: { existingIterations: existingIterations.length },
      });

      return { market: m, isResume, skipped: false as const };
    });

    if (initResult.skipped) {
      return { status: 'skipped', reason: 'testnet market' };
    }

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

      // Early termination: if score delta < 0.5 from previous iteration, stop iterating
      const isPlateaued = i >= 2 && iterations.length > 0 && (() => {
        const prevReview = iterations[iterations.length - 1].review;
        return (scoring.scores.overallScore - prevReview.scores.overallScore) < 0.5;
      })();
      const effectivelyLastIteration = i === THRESHOLDS.maxIterations || isPlateaued;

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

      const previousFeedback = iterations.length > 0 ? iterations[iterations.length - 1].feedback : undefined;
      const feedback = buildFeedback(scoring, rulesCheck, verification, previousFeedback);

      // Save iteration
      const iteration: Iteration = {
        version: i,
        market: marketToSnapshot(currentMarket),
        review,
        feedback: feedback || undefined,
      };
      const updatedIterations = [...iterations, iteration];

      // Check if good enough → reviewed (stays as candidate for human to promote)
      const isPassing = scoring.scores.overallScore >= THRESHOLDS.passingScore && scoring.recommendation !== 'reject';

      if (isPassing && (!feedback || effectivelyLastIteration)) {
        // No feedback to address, or last iteration — finish now
        await step.run(`finish-v${i}`, async () => {
          await db
            .update(markets)
            .set({ review, iterations: updatedIterations, status: 'candidate' })
            .where(eq(markets.id, marketId));

          await logMarketEvent(marketId, 'pipeline_opened', {
            iteration: i,
            detail: { score: scoring.scores.overallScore },
          });
        });
        await logActivity('review_completed', { entityType: 'market', entityId: marketId, entityLabel: initResult.market.title, detail: { result: 'opened', score: scoring.scores.overallScore, iteration: i, inngestRunUrl: runUrl }, source: 'pipeline' });
        return { status: 'candidate', marketId, iteration: i, score: scoring.scores.overallScore };
      }

      // Last iteration (or plateaued) — finish as candidate for human review
      if (effectivelyLastIteration) {
        await step.run(`finish-low-score-v${i}`, async () => {
          await db
            .update(markets)
            .set({ review, iterations: updatedIterations, status: 'candidate' })
            .where(eq(markets.id, marketId));

          const reason = isPlateaued ? 'Score plateaued — stopping early' : 'Below threshold after max iterations';
          await logMarketEvent(marketId, 'pipeline_opened', {
            iteration: i,
            detail: { score: scoring.scores.overallScore, reason },
          });
        });
        const reason = isPlateaued ? 'Score plateaued — stopping early' : 'Below threshold after max iterations';
        await logActivity('review_completed', { entityType: 'market', entityId: marketId, entityLabel: initResult.market.title, detail: { result: 'needs_review', reason, score: scoring.scores.overallScore, inngestRunUrl: runUrl }, source: 'pipeline' });
        return { status: 'candidate', marketId, reason, score: scoring.scores.overallScore };
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

        // Validate and fix LLM output
        const validation = validateMarket(improved);
        if (Object.keys(validation.fixes).length > 0) {
          console.log(`[review] Validation fixes for "${improved.title}":`, validation.fixes);
          improved.timingSafety = 'caution';
        }
        if (validation.warnings.length > 0) {
          console.warn(`[review] Validation warnings:`, validation.warnings);
        }

        // Compute what changed for logging
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const trackFields = ['title', 'description', 'resolutionCriteria', 'resolutionSource', 'contingencies', 'category', 'outcomes', 'endTimestamp', 'expectedResolutionDate', 'timingSafety'] as const;
        for (const field of trackFields) {
          const prev = currentMarket[field];
          const next = improved[field];
          if (JSON.stringify(prev) !== JSON.stringify(next)) {
            changes[field] = { from: prev, to: next };
          }
        }

        // Store changes in the iteration for visibility
        if (Object.keys(changes).length > 0 && updatedIterations.length > 0) {
          updatedIterations[updatedIterations.length - 1].changes = changes;
          // Re-save iterations with changes included
          await db
            .update(markets)
            .set({ iterations: updatedIterations })
            .where(eq(markets.id, marketId));
        }

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
            outcomes: improved.outcomes,
            endTimestamp: improved.endTimestamp,
            expectedResolutionDate: improved.expectedResolutionDate,
            timingSafety: improved.timingSafety,
          })
          .where(eq(markets.id, marketId));

        await logMarketEvent(marketId, 'improved', {
          iteration: i,
          detail: { changes },
        });
      });
    }
  },
);
