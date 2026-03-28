import { inngest } from './client';
import { db } from '@/db/client';
import { markets, resolutionFeedback, signals as signalsTable } from '@/db/schema';
import { eq, desc, isNotNull } from 'drizzle-orm';
import { evaluateResolution } from '@/agents/resolver/evaluator';
import { logActivity } from '@/lib/activity-log';
import type { Resolution } from '@/db/types';

function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'<>)}\]]+/g;
  return [...new Set(text.match(urlRegex) ?? [])];
}

async function fetchSourceContent(url: string): Promise<{ url: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Predmarks Bot)' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';

    if (contentType.includes('json')) {
      const json = await res.json();
      return { url, text: JSON.stringify(json, null, 2).slice(0, 3000) };
    }

    const html = await res.text();
    // Strip HTML tags, collapse whitespace
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    return { url, text };
  } catch (err) {
    console.warn(`[resolution-job] Failed to fetch source ${url}:`, err);
    return null;
  }
}

export const resolutionJob = inngest.createFunction(
  { id: 'resolution-check', retries: 2, concurrency: [{ limit: 3 }, { limit: 1, key: 'event.data.id' }] },
  { event: 'markets/resolution.check' },
  async ({ event, step }) => {
    const marketId = event.data.id as string;

    const market = await step.run('load-market', async () => {
      const [m] = await db.select().from(markets).where(eq(markets.id, marketId));
      return m;
    });

    if (!market || !['open', 'in_resolution'].includes(market.status)) {
      return { status: 'skipped', reason: `status: ${market?.status ?? 'not found'}` };
    }

    // Fetch resolution source content and save as signal
    const sourceContent = await step.run('fetch-resolution-source', async () => {
      const urls = extractUrls(`${market.resolutionSource} ${market.description}`);
      if (urls.length === 0) return null;

      for (const url of urls.slice(0, 3)) {
        const content = await fetchSourceContent(url);
        if (!content) continue;

        // Save as signal for audit trail
        try {
          await db
            .insert(signalsTable)
            .values({
              type: 'data',
              text: `Fuente de resolución: ${market.title.slice(0, 100)}`,
              summary: content.text.slice(0, 500),
              url: content.url,
              source: 'resolution_source',
              publishedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: signalsTable.url,
              targetWhere: isNotNull(signalsTable.url),
              set: { summary: content.text.slice(0, 500), publishedAt: new Date() },
            });
        } catch {
          // Signal persistence is best-effort
        }

        return content;
      }
      return null;
    });

    const check = await step.run('evaluate', async () => {
      // Load market-specific feedback (graceful if table doesn't exist yet)
      let feedbackTexts: string[] = [];
      try {
        const marketFeedback = await db
          .select({ text: resolutionFeedback.text })
          .from(resolutionFeedback)
          .where(eq(resolutionFeedback.marketId, marketId))
          .orderBy(desc(resolutionFeedback.createdAt))
          .limit(10);
        feedbackTexts = marketFeedback.map((r) => r.text);
      } catch {
        console.warn('[resolution-job] Could not load resolution feedback, proceeding without it');
      }

      return evaluateResolution({
        title: market.title,
        description: market.description,
        outcomes: (market.outcomes as string[]) ?? ['Si', 'No'],
        resolutionCriteria: market.resolutionCriteria,
        resolutionSource: market.resolutionSource,
        endTimestamp: market.endTimestamp,
        feedback: feedbackTexts,
        sourceContent,
      });
    });

    if (check.status === 'unresolved') {
      await step.run('log-unresolved', async () => {
        await logActivity('resolution_check_unresolved', {
          entityType: 'market',
          entityId: marketId,
          entityLabel: market.title,
          detail: {
            status: check.status,
            confidence: check.confidence,
            evidence: check.evidence,
            evidenceUrls: check.evidenceUrls,
          },
          source: 'pipeline',
        });
      });
      return { status: 'unresolved', marketId };
    }

    // Save resolution data on the market
    await step.run('save-resolution', async () => {
      const existing = market.resolution as Resolution | null;
      const resolution: Resolution = {
        evidence: check.evidence,
        evidenceUrls: check.evidenceUrls,
        confidence: check.confidence,
        suggestedOutcome: check.suggestedOutcome ?? '',
        flaggedAt: existing?.flaggedAt ?? new Date().toISOString(),
      };

      await db
        .update(markets)
        .set({ resolution })
        .where(eq(markets.id, marketId));

      const action = check.isEmergency
        ? 'resolution_emergency'
        : check.status === 'resolved'
          ? 'resolution_flagged'
          : 'resolution_unclear';

      await logActivity(action, {
        entityType: 'market',
        entityId: marketId,
        entityLabel: market.title,
        detail: {
          status: check.status,
          suggestedOutcome: check.suggestedOutcome,
          confidence: check.confidence,
          evidence: check.evidence,
          evidenceUrls: check.evidenceUrls,
          isEmergency: check.isEmergency,
          emergencyReason: check.emergencyReason,
        },
        source: 'pipeline',
      });
    });

    return {
      status: check.status,
      marketId,
      suggestedOutcome: check.suggestedOutcome,
      confidence: check.confidence,
      isEmergency: check.isEmergency,
    };
  },
);
