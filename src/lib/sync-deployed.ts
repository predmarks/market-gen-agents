import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { fetchOnchainMarkets } from './indexer';
import { expandMarket } from './expand-market';
import { fetchOnchainMarketData } from './onchain';
import { matchMarketsToTopics } from './match-market-topic';
import { inngest } from '@/inngest/client';
import { logActivity } from '@/lib/activity-log';
import { isTestnet, MAINNET_CHAIN_ID } from './chains';
import type { SourceContext } from '@/db/types';

function toDateString(ts: number): string {
  return new Date(ts * 1000).toISOString().split('T')[0];
}

function mapResolvedOutcome(resolvedTo: number, outcomes: string[]): string | null {
  if (resolvedTo <= 0 || resolvedTo > outcomes.length) return null;
  return outcomes[resolvedTo - 1]; // 1-indexed
}

/**
 * Lightweight sync: fetches indexer data and upserts volume/participants/status.
 * Creates new markets with basic data (no LLM expansion).
 * Designed to run on every dashboard page load (~1-2s).
 */
export async function syncMarketStats(chainId: number = MAINNET_CHAIN_ID): Promise<{
  created: number;
  updated: number;
}> {
  const onchainMarkets = await fetchOnchainMarkets(chainId);
  const now = Math.floor(Date.now() / 1000);
  let created = 0;
  let updated = 0;

  for (const om of onchainMarkets) {
    const [existing] = await db
      .select({ id: markets.id, status: markets.status, endTimestamp: markets.endTimestamp })
      .from(markets)
      .where(and(eq(markets.onchainId, om.onchainId), eq(markets.chainId, chainId)));

    if (existing) {
      const isResolved = om.resolvedTo > 0;
      // Use DB endTimestamp for status (DB is source of truth for content fields)
      const endTs = existing.endTimestamp;
      const status = isResolved
        ? 'closed'
        : endTs && now > endTs
          ? 'in_resolution'
          : 'open';
      // Only preserve 'rejected' unconditionally; 'closed' is preserved only if onchain confirms
      const preserveStatus = existing.status === 'rejected' || (existing.status === 'closed' && isResolved);

      await db
        .update(markets)
        .set({
          volume: om.volume,
          participants: om.participants,
          ...(preserveStatus ? {} : { status }),
        })
        .where(eq(markets.id, existing.id));
      updated++;
    } else {
      // Check if a DB market with the same title exists (candidate deployed but not yet linked)
      const [titleMatch] = await db
        .select({ id: markets.id })
        .from(markets)
        .where(eq(markets.title, om.name))
        .limit(1);

      const isResolved = om.resolvedTo > 0;
      const status = isResolved
        ? 'closed'
        : om.endTimestamp && now > om.endTimestamp
          ? 'in_resolution'
          : 'open';

      if (titleMatch) {
        // Link existing candidate to onchain market
        await db
          .update(markets)
          .set({
            onchainId: om.onchainId,
            onchainAddress: om.id,
            category: om.category,
            endTimestamp: om.endTimestamp,
            expectedResolutionDate: toDateString(om.endTimestamp),
            volume: om.volume,
            participants: om.participants,
            status,
            chainId,
          })
          .where(eq(markets.id, titleMatch.id));
        updated++;
      } else {
        // New market — insert with basic indexer data
        const sourceContext: SourceContext = {
          originType: 'manual',
          generatedAt: new Date().toISOString(),
        };

        await db.insert(markets).values({
          onchainId: om.onchainId,
          onchainAddress: om.id,
          title: om.name,
          description: '',
          resolutionCriteria: '',
          resolutionSource: '',
          category: om.category,
          endTimestamp: om.endTimestamp,
          expectedResolutionDate: toDateString(om.endTimestamp),
          volume: om.volume,
          participants: om.participants,
          status,
          chainId,
          sourceContext,
        });
        created++;
      }
    }
  }

  return { created, updated };
}

export async function syncDeployedMarkets(chainId: number = MAINNET_CHAIN_ID): Promise<{
  created: number;
  updated: number;
  expanded: number;
  resolved: number;
  topicLinked: number;
  topicResearchDispatched: number;
  resolutionTriggered: number;
}> {
  const onchainMarkets = await fetchOnchainMarkets(chainId);
  const now = Math.floor(Date.now() / 1000);
  let created = 0;
  let updated = 0;
  let expanded = 0;
  let resolved = 0;
  let topicLinked = 0;
  let topicResearchDispatched = 0;
  const closedMarketIds: string[] = [];
  const toExpand: { id: string; onchainId: string; title: string; category: string; endTimestamp: number }[] = [];

  for (const om of onchainMarkets) {
    // If resolved onchain, handle separately
    if (om.resolvedTo > 0) {
      const [existing] = await db
        .select({ id: markets.id, status: markets.status, outcomes: markets.outcomes })
        .from(markets)
        .where(and(eq(markets.onchainId, om.onchainId), eq(markets.chainId, chainId)));

      if (existing && existing.status !== 'closed') {
        // Get outcomes from DB or fetch from contract
        let outcomes = (existing.outcomes as string[]) ?? [];
        if (outcomes.length === 0) {
          try {
            const onchainData = await fetchOnchainMarketData(Number(om.onchainId), chainId);
            outcomes = onchainData.outcomes;
          } catch { /* use empty */ }
        }

        const outcome = mapResolvedOutcome(om.resolvedTo, outcomes);
        if (outcome) {
          await db.update(markets).set({
            status: 'closed',
            outcome,
            resolvedAt: new Date(),
            volume: om.volume,
            participants: om.participants,
          }).where(eq(markets.id, existing.id));

          logActivity('market_resolved_onchain', {
            entityType: 'market',
            entityId: existing.id,
            entityLabel: om.name,
            detail: { outcome, resolvedTo: om.resolvedTo },
            source: 'pipeline',
          }).catch(() => {});

          resolved++;
        }
      } else if (existing) {
        // Already closed — just update volume/participants
        await db.update(markets).set({
          volume: om.volume,
          participants: om.participants,
        }).where(eq(markets.id, existing.id));
        updated++;
      } else {
        // Resolved market not yet in DB — import it
        let outcomes: string[] = [];
        try {
          const onchainData = await fetchOnchainMarketData(Number(om.onchainId), chainId);
          outcomes = onchainData.outcomes;
        } catch { /* use empty */ }

        const outcome = mapResolvedOutcome(om.resolvedTo, outcomes);
        const expectedResolutionDate = toDateString(om.endTimestamp);
        const sourceContext: SourceContext = {
          originType: 'manual',
          generatedAt: new Date().toISOString(),
        };

        // Check for existing candidate by title before inserting
        const [titleMatch] = await db.select({ id: markets.id }).from(markets).where(eq(markets.title, om.name)).limit(1);
        let inserted: { id: string };

        if (titleMatch) {
          await db.update(markets).set({
            onchainId: om.onchainId, onchainAddress: om.id, category: om.category,
            endTimestamp: om.endTimestamp, expectedResolutionDate,
            volume: om.volume, participants: om.participants,
            status: 'closed', outcome: outcome ?? undefined,
            outcomes: outcomes.length > 0 ? outcomes : undefined,
            resolvedAt: new Date(), chainId,
          }).where(eq(markets.id, titleMatch.id));
          inserted = titleMatch;
          updated++;
        } else {
          const [created_] = await db.insert(markets).values({
            onchainId: om.onchainId, onchainAddress: om.id,
            title: om.name, description: '', resolutionCriteria: '', resolutionSource: '',
            category: om.category, endTimestamp: om.endTimestamp, expectedResolutionDate,
            volume: om.volume, participants: om.participants,
            status: 'closed', outcome: outcome ?? undefined,
            outcomes: outcomes.length > 0 ? outcomes : undefined,
            resolvedAt: new Date(), chainId, sourceContext,
          }).returning({ id: markets.id });
          inserted = created_;
          created++;
        }
        resolved++;

        logActivity('market_synced', {
          entityType: 'market',
          entityId: inserted.id,
          entityLabel: om.name,
          detail: { onchainId: om.onchainId, status: 'closed', outcome, resolvedTo: om.resolvedTo },
          source: 'pipeline',
        }).catch(() => {});

        toExpand.push({ id: inserted.id, onchainId: om.onchainId, title: om.name, category: om.category, endTimestamp: om.endTimestamp });
      }
      continue;
    }

    const status = om.endTimestamp && now > om.endTimestamp ? 'in_resolution' : 'open';
    const expectedResolutionDate = toDateString(om.endTimestamp);

    const [existing] = await db
      .select({ id: markets.id, status: markets.status, description: markets.description, expectedResolutionDate: markets.expectedResolutionDate })
      .from(markets)
      .where(and(eq(markets.onchainId, om.onchainId), eq(markets.chainId, chainId)));

    if (existing) {
      // This block only runs for unresolved markets (resolvedTo <= 0),
      // so 'closed' DB status is stale — only preserve 'rejected'
      const preserveStatus = existing.status === 'rejected';
      const needsExpand = !existing.description;
      await db
        .update(markets)
        .set({
          title: om.name,
          category: om.category,
          endTimestamp: om.endTimestamp,
          volume: om.volume,
          participants: om.participants,
          onchainAddress: om.id,
          ...(!existing.expectedResolutionDate ? { expectedResolutionDate } : {}),
          ...(preserveStatus ? {} : { status }),
        })
        .where(eq(markets.id, existing.id));
      updated++;
      // Log status transition
      if (!preserveStatus && existing.status !== status) {
        logActivity('market_status_changed', {
          entityType: 'market',
          entityId: existing.id,
          entityLabel: om.name,
          detail: { from: existing.status, to: status },
          source: 'pipeline',
        }).catch(() => {});
      }
      if (!preserveStatus && status === 'in_resolution') closedMarketIds.push(existing.id);
      if (needsExpand) {
        toExpand.push({ id: existing.id, onchainId: om.onchainId, title: om.name, category: om.category, endTimestamp: om.endTimestamp });
      }
    } else {
      // Check for existing candidate by title before inserting
      const [titleMatch] = await db.select({ id: markets.id }).from(markets).where(eq(markets.title, om.name)).limit(1);
      let inserted: { id: string };

      if (titleMatch) {
        await db.update(markets).set({
          onchainId: om.onchainId, onchainAddress: om.id, category: om.category,
          endTimestamp: om.endTimestamp, expectedResolutionDate,
          volume: om.volume, participants: om.participants,
          status, chainId,
        }).where(eq(markets.id, titleMatch.id));
        inserted = titleMatch;
        updated++;
      } else {
        const sourceContext: SourceContext = {
          originType: 'manual',
          generatedAt: new Date().toISOString(),
        };

        const [created_] = await db.insert(markets).values({
          onchainId: om.onchainId, onchainAddress: om.id,
          title: om.name, description: '', resolutionCriteria: '', resolutionSource: '',
          category: om.category, endTimestamp: om.endTimestamp, expectedResolutionDate,
          volume: om.volume, participants: om.participants,
          status, chainId, sourceContext,
        }).returning({ id: markets.id });
        inserted = created_;
        created++;
      }
      logActivity('market_synced', {
        entityType: 'market',
        entityId: inserted.id,
        entityLabel: om.name,
        detail: { onchainId: om.onchainId, status },
        source: 'pipeline',
      }).catch(() => {});
      if (status === 'in_resolution') closedMarketIds.push(inserted.id);
      toExpand.push({ id: inserted.id, onchainId: om.onchainId, title: om.name, category: om.category, endTimestamp: om.endTimestamp });
    }
  }

  // Phase 2: Fetch real descriptions from contract, then LLM-expand remaining fields
  for (const market of toExpand) {
    try {
      const updates: Record<string, unknown> = {};

      // Try to fetch real description from onchain contract
      let realDescription = '';
      let realOutcomes: string[] | undefined;
      try {
        const onchainData = await fetchOnchainMarketData(Number(market.onchainId), chainId);
        if (onchainData.description) {
          realDescription = onchainData.description;
          updates.description = realDescription;
        }
        if (onchainData.outcomes.length > 0) {
          realOutcomes = onchainData.outcomes;
          updates.outcomes = realOutcomes;
        }
      } catch (err) {
        console.warn(`[sync] Could not fetch onchain data for market ${market.onchainId}:`, err);
      }

      // Skip LLM expansion for testnet markets
      if (!isTestnet(chainId)) {
        const generated = await expandMarket({
          title: market.title,
          category: market.category,
          endTimestamp: market.endTimestamp,
          ...(realDescription ? { description: realDescription } : {}),
          ...(realOutcomes ? { outcomes: realOutcomes } : {}),
        });

        if (!realDescription && generated.description) updates.description = generated.description;
        if (generated.resolutionCriteria) updates.resolutionCriteria = generated.resolutionCriteria;
        if (generated.resolutionSource) updates.resolutionSource = generated.resolutionSource;
        if (generated.contingencies) updates.contingencies = generated.contingencies;
        if (generated.tags) updates.tags = generated.tags;
        if (generated.expectedResolutionDate) updates.expectedResolutionDate = generated.expectedResolutionDate;
      }

      if (Object.keys(updates).length > 0) {
        await db.update(markets).set(updates).where(eq(markets.id, market.id));
        expanded++;
      }
    } catch {
      // Expansion is best-effort
    }
  }

  // Phase 3: Associate markets with topics (mainnet only)
  if (!isTestnet(chainId)) {
    const allSyncedIds = onchainMarkets.map((om) => om.onchainId);
    const needsTopicRows = allSyncedIds.length > 0
      ? await db
          .select({ id: markets.id, title: markets.title, category: markets.category, description: markets.description, sourceContext: markets.sourceContext })
          .from(markets)
          .where(eq(markets.isArchived, false))
      : [];

    const needsTopic = needsTopicRows.filter((m) => {
      const ctx = m.sourceContext as SourceContext | null;
      return !ctx?.topicIds?.length && m.description;
    });

    if (needsTopic.length > 0) {
      const topicMatches = await matchMarketsToTopics(
        needsTopic.map((m) => ({
          id: m.id,
          title: m.title,
          category: m.category,
          description: m.description,
        })),
      );

      for (const m of needsTopic) {
        const match = topicMatches.get(m.id);
        if (!match) continue;

        const ctx = (m.sourceContext as SourceContext) ?? { originType: 'manual' as const, generatedAt: new Date().toISOString() };
        await db.update(markets).set({
          sourceContext: {
            ...ctx,
            topicIds: [...(ctx.topicIds ?? []), match.topicId],
            topicNames: [...(ctx.topicNames ?? []), match.topicName],
          },
        }).where(eq(markets.id, m.id));
        topicLinked++;
      }
    }
  }

  // Phase 4: Trigger resolution checks for closed markets (mainnet only)
  if (!isTestnet(chainId) && closedMarketIds.length > 0) {
    await inngest.send(
      closedMarketIds.map((id) => ({
        name: 'markets/resolution.check' as const,
        data: { id },
      })),
    );
  }

  return { created, updated, expanded, resolved, topicLinked, topicResearchDispatched, resolutionTriggered: closedMarketIds.length };
}
