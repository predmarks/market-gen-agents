import { db } from '@/db/client';
import { markets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { fetchOnchainMarkets } from './indexer';
import { expandMarket } from './expand-market';
import { fetchOnchainMarketData } from './onchain';
import { matchMarketsToTopics } from './match-market-topic';
import { inngest } from '@/inngest/client';
import { logActivity } from '@/lib/activity-log';
import type { SourceContext } from '@/db/types';

function toDateString(ts: number): string {
  return new Date(ts * 1000).toISOString().split('T')[0];
}

function mapResolvedOutcome(resolvedTo: number, outcomes: string[]): string | null {
  if (resolvedTo <= 0 || resolvedTo > outcomes.length) return null;
  return outcomes[resolvedTo - 1]; // 1-indexed
}

export async function syncDeployedMarkets(): Promise<{
  created: number;
  updated: number;
  expanded: number;
  resolved: number;
  topicLinked: number;
  topicResearchDispatched: number;
  resolutionTriggered: number;
}> {
  const onchainMarkets = await fetchOnchainMarkets();
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
        .where(eq(markets.onchainId, om.onchainId));

      if (existing && existing.status !== 'closed') {
        // Get outcomes from DB or fetch from contract
        let outcomes = (existing.outcomes as string[]) ?? [];
        if (outcomes.length === 0) {
          try {
            const onchainData = await fetchOnchainMarketData(Number(om.onchainId));
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
          const onchainData = await fetchOnchainMarketData(Number(om.onchainId));
          outcomes = onchainData.outcomes;
        } catch { /* use empty */ }

        const outcome = mapResolvedOutcome(om.resolvedTo, outcomes);
        const expectedResolutionDate = toDateString(om.endTimestamp);
        const sourceContext: SourceContext = {
          originType: 'manual',
          generatedAt: new Date().toISOString(),
        };

        const [inserted] = await db.insert(markets).values({
          onchainId: om.onchainId,
          onchainAddress: om.id,
          title: om.name,
          description: '',
          resolutionCriteria: '',
          resolutionSource: '',
          category: om.category,
          endTimestamp: om.endTimestamp,
          expectedResolutionDate,
          volume: om.volume,
          participants: om.participants,
          status: 'closed',
          outcome: outcome ?? undefined,
          outcomes: outcomes.length > 0 ? outcomes : undefined,
          resolvedAt: new Date(),
          sourceContext,
        }).returning({ id: markets.id });

        created++;
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
      .where(eq(markets.onchainId, om.onchainId));

    if (existing) {
      const preserveStatus = ['closed', 'rejected'].includes(existing.status);
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
      const sourceContext: SourceContext = {
        originType: 'manual',
        generatedAt: new Date().toISOString(),
      };

      const [inserted] = await db.insert(markets).values({
        onchainId: om.onchainId,
        onchainAddress: om.id,
        title: om.name,
        description: '',
        resolutionCriteria: '',
        resolutionSource: '',
        category: om.category,
        endTimestamp: om.endTimestamp,
        expectedResolutionDate,
        volume: om.volume,
        participants: om.participants,
        status,
        sourceContext,
      }).returning({ id: markets.id });
      created++;
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
        const onchainData = await fetchOnchainMarketData(Number(market.onchainId));
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

      // LLM-expand remaining fields (resolutionCriteria, resolutionSource, contingencies, tags)
      // Pass real description if available for better context
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

      if (Object.keys(updates).length > 0) {
        await db.update(markets).set(updates).where(eq(markets.id, market.id));
        expanded++;
      }
    } catch {
      // Expansion is best-effort
    }
  }

  // Phase 3: Associate markets with topics
  // Find all synced markets missing topic association
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

    const inngestEvents: { name: 'topics/suggest.requested'; data: { description: string; marketId: string } }[] = [];

    for (const m of needsTopic) {
      const match = topicMatches.get(m.id);
      const ctx = (m.sourceContext as SourceContext) ?? { originType: 'manual' as const, generatedAt: new Date().toISOString() };

      if (match) {
        // Matched existing topic — link immediately
        await db.update(markets).set({
          sourceContext: {
            ...ctx,
            topicIds: [...(ctx.topicIds ?? []), match.topicId],
            topicNames: [...(ctx.topicNames ?? []), match.topicName],
          },
        }).where(eq(markets.id, m.id));
        topicLinked++;
      } else {
        // No match — dispatch async research to create topic + signals
        inngestEvents.push({
          name: 'topics/suggest.requested',
          data: {
            description: `${m.title}. ${m.description.slice(0, 300)}`,
            marketId: m.id,
          },
        });
        topicResearchDispatched++;
      }
    }

    if (inngestEvents.length > 0) {
      await inngest.send(inngestEvents);
    }
  }

  // Phase 4: Trigger resolution checks for closed markets
  if (closedMarketIds.length > 0) {
    await inngest.send(
      closedMarketIds.map((id) => ({
        name: 'markets/resolution.check' as const,
        data: { id },
      })),
    );
  }

  return { created, updated, expanded, resolved, topicLinked, topicResearchDispatched, resolutionTriggered: closedMarketIds.length };
}
