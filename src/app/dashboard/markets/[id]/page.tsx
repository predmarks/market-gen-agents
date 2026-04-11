export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db/client';
import { markets, marketEvents, activityLog, topics, topicSignals, signals } from '@/db/schema';
import { eq, asc, desc, inArray } from 'drizzle-orm';
import type { Market, Iteration, MarketSnapshot, MarketEventType, ReviewResult } from '@/db/types';
import { toDeployableMarket } from '@/lib/export';
import { marketToSnapshot } from '@/lib/market-snapshot';
import { getBasescanUrl, getPredmarksUrl } from '@/lib/chains';
import { REPORTER_ADDRESSES as REPORTER_ADDRESSES_PUBLIC } from '@/lib/contracts';
import { fetchOnchainMarketData, fetchMarketResult } from '@/lib/onchain';
import { fetchOnchainMarkets, fetchUnredeemedPositions } from '@/lib/indexer';
import type { UnredeemedPosition } from '@/lib/indexer';
import { getOwnedAddresses } from '@/lib/owned-addresses';
import { StatusBadge } from '../../_components/StatusBadge';
import { TimingSafetyIndicator } from '../../_components/TimingSafetyIndicator';
import { MarketActions } from './_components/MarketActions';

import { CopyJsonButton } from './_components/CopyJsonButton';
import { ExpandableList } from './_components/ExpandableList';
import { CheckResolutionTrigger } from './_components/CheckResolutionTrigger';
import { SuggestResolutionButton } from './_components/SuggestResolutionButton';
import { DeployMarketButton } from './_components/DeployMarketButton';
import { OnchainActionsWrapper as OnchainActions } from './_components/OnchainActionsWrapper';
import { ResolveOnchainButton } from './_components/ResolveOnchainButton';
import { WithdrawLiquidityButton } from './_components/WithdrawLiquidityButton';
import { UnredeemedWinners } from './_components/UnredeemedWinners';
import { Markdown } from '../../../_components/Markdown';
import { PendingSuggestion } from './_components/PendingSuggestion';

import { ActivityCard } from '@/app/_components/ActivityCard';
import { CitedText } from '@/app/_components/CitedText';
import { EditableField } from '@/app/_components/EditableField';
import { ResolutionConfirmButton, ResolutionFeedbackButton } from './_components/ResolutionActions';
import { getUserTimezone } from '@/lib/timezone';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

function formatVolume(vol: string): string {
  const n = parseFloat(vol) / 1e6;
  if (isNaN(n) || n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatTimestamp(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(ts * 1000));
}

const RECOMMENDATION_STYLES: Record<string, { color: string; label: string }> = {
  publish: { color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', label: 'Publicar' },
  rewrite_then_publish: { color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', label: 'Reescribir y publicar' },
  hold: { color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', label: 'Esperar' },
  reject: { color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', label: 'Rechazar' },
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MarketDetailPage({ params }: Props) {
  const { id } = await params;
  const tz = await getUserTimezone();
  const [[market], events, activity] = await Promise.all([
    db.select().from(markets).where(eq(markets.id, id)),
    db.select().from(marketEvents).where(eq(marketEvents.marketId, id)).orderBy(asc(marketEvents.createdAt)),
    db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(desc(activityLog.createdAt)).limit(50),
  ]);

  if (!market) notFound();

  // Fetch onchain data and sync market status/fields on every page load
  let onchainData: { name: string; description: string; category: string; outcomes: string[]; endTimestamp: number; marketAddress: string } | null = null;
  let resolvedTo = 0;
  if (market.onchainId) {
    try {
      const [data, indexerMarkets] = await Promise.all([
        fetchOnchainMarketData(Number(market.onchainId), market.chainId),
        fetchOnchainMarkets(market.chainId, { where: { onchainId: market.onchainId } }).catch(() => []),
      ]);

      onchainData = {
        name: data.name,
        description: data.description,
        category: data.category,
        outcomes: data.outcomes,
        endTimestamp: data.endTimestamp,
        marketAddress: data.marketAddress,
      };

      // Compute correct status from onchain state
      const now = Math.floor(Date.now() / 1000);
      resolvedTo = indexerMarkets.find((m) => m.onchainId === market.onchainId)?.resolvedTo ?? 0;
      // Fallback: check contract directly if indexer is behind
      if (resolvedTo === 0 && data.marketAddress && data.marketAddress !== '0x0000000000000000000000000000000000000000') {
        try {
          resolvedTo = await fetchMarketResult(data.marketAddress as `0x${string}`, market.chainId);
        } catch { /* contract read failed */ }
      }
      const correctStatus = resolvedTo > 0 ? 'closed'
        : data.endTimestamp && now > data.endTimestamp ? 'in_resolution'
        : 'open';

      // Only sync status-related fields from onchain (not content — that's the editable draft)
      const dbUpdates: Record<string, unknown> = {};
      if (market.status !== 'rejected' && market.status !== correctStatus) dbUpdates.status = correctStatus;
      if (resolvedTo > 0 && !market.outcome && data.outcomes.length >= resolvedTo) {
        dbUpdates.outcome = data.outcomes[resolvedTo - 1];
        dbUpdates.resolvedAt = new Date();
      }
      // Record when onchain resolution is first detected
      const resObj = (market.resolution as Record<string, unknown> | null) ?? {};
      if (resolvedTo > 0 && !resObj.resolvedOnchainAt) {
        dbUpdates.resolution = { ...resObj, resolvedOnchainAt: new Date().toISOString() };
      }

      // Apply to local object for rendering + fire-and-forget DB update
      if (Object.keys(dbUpdates).length > 0) {
        Object.assign(market, dbUpdates);
        await db.update(markets).set(dbUpdates).where(eq(markets.id, id));
      }
    } catch { /* RPC/indexer failure — use DB data as-is */ }
  } else {
    // Non-onchain markets: still correct status from endTimestamp
    const now = Math.floor(Date.now() / 1000);
    if (market.status === 'open' && market.endTimestamp && now > market.endTimestamp) {
      market.status = 'in_resolution';
      await db.update(markets).set({ status: 'in_resolution' }).where(eq(markets.id, id));
    }
  }

  // Fetch unredeemed winning positions for resolved markets
  let unredeemedPositions: UnredeemedPosition[] = [];
  if (resolvedTo > 0 && market.onchainAddress) {
    try {
      unredeemedPositions = await fetchUnredeemedPositions(
        market.chainId,
        market.onchainAddress,
        resolvedTo,
      );
    } catch { /* indexer failure — skip */ }
  }

  // Filter out owned addresses from unredeemed positions
  if (unredeemedPositions.length > 0) {
    const ownedAddresses = await getOwnedAddresses();
    if (ownedAddresses.length > 0) {
      const ownedSet = new Set(ownedAddresses);
      unredeemedPositions = unredeemedPositions.filter((p) => !ownedSet.has(p.account.toLowerCase()));
    }
  }

  const deployable = toDeployableMarket(market as unknown as Market);
  const isEditable = !['closed', 'rejected'].includes(market.status);
  const review = market.review as Market['review'];
  const resolution = market.resolution as Market['resolution'];
  const sourceContext = market.sourceContext as Market['sourceContext'];

  // Resolve source topics for back-links
  const sourceTopicIds = sourceContext?.topicIds ?? [];
  const sourceTopics = sourceTopicIds.length > 0
    ? await db.select({ id: topics.id, name: topics.name, slug: topics.slug }).from(topics).where(inArray(topics.id, sourceTopicIds))
    : [];
  // Fetch related signals through source topics
  const rawSignals = sourceTopicIds.length > 0
    ? await db
        .select({
          id: signals.id,
          type: signals.type,
          text: signals.text,
          summary: signals.summary,
          url: signals.url,
          source: signals.source,
          publishedAt: signals.publishedAt,
        })
        .from(topicSignals)
        .innerJoin(signals, eq(topicSignals.signalId, signals.id))
        .where(inArray(topicSignals.topicId, sourceTopicIds))
        .orderBy(desc(signals.publishedAt))
        .limit(60)
    : [];
  // Dedup by signal ID
  const seen = new Set<string>();
  const relatedSignals = rawSignals.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  }).slice(0, 30);

  const iterations = (market.iterations as Iteration[] | null) ?? [];

  return (
    <div>
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
      >
        &larr; Volver
      </Link>

      {/* Actions */}
      <div className="mb-4 flex gap-2 flex-wrap items-center">
        <MarketActions
          marketId={market.id}
          status={market.status as Market['status']}
          review={review ?? null}
          iterations={iterations.length > 0 ? iterations : null}
          isArchived={!!market.isArchived}
        />
        {market.status === 'candidate' && !market.onchainId && (
          <DeployMarketButton marketId={market.id} />
        )}
      </div>

      <div className="max-w-3xl">

      {/* Auto-trigger resolution check when market is in_resolution but no suggestion yet */}
      {market.status === 'in_resolution' && (!resolution || !resolution.suggestedOutcome) && (
        <div className="mb-6 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6">
          <CheckResolutionTrigger marketId={market.id} checkingAt={resolution?.checkingAt} />
          <SuggestResolutionButton marketId={market.id} outcomes={(market.outcomes as string[]) ?? ['Si', 'No']} />
        </div>
      )}

      {/* Resolution — unified stepper */}
      {resolution?.suggestedOutcome && (() => {
        const hasReporter = !!REPORTER_ADDRESSES_PUBLIC[market.chainId];
        const reporterDone = activity.some((a) => a.action === 'market_reported_onchain');
        const step1 = !!resolution.suggestedOutcome;
        const step2 = !!resolution.confirmedAt;
        const step3 = market.status === 'closed';
        const step4 = step3 && reporterDone;
        const hasMarketAddress = market.onchainId && onchainData?.marketAddress && onchainData.marketAddress !== '0x0000000000000000000000000000000000000000';

        // Extract tx hashes from activity log
        const basescanBase = getBasescanUrl(market.chainId);
        const resolveTxHash = (activity.find((a) => a.action === 'market_resolved_onchain')?.detail as Record<string, unknown> | null)?.txHash as string | undefined;
        const reportTxHash = (activity.find((a) => a.action === 'market_reported_onchain')?.detail as Record<string, unknown> | null)?.txHash as string | undefined;

        const steps = [
          { label: 'Sugerida', done: step1, txHash: undefined as string | undefined },
          { label: 'Confirmada', done: step2, txHash: undefined as string | undefined },
          { label: 'Resuelta onchain', done: step3, txHash: resolveTxHash },
          ...(hasReporter ? [{ label: 'Reportada', done: step4, txHash: reportTxHash }] : []),
        ];

        const allDone = steps.every((s) => s.done);
        const borderColor = allDone ? 'border-green-200 dark:border-green-800' : 'border-amber-200 dark:border-amber-800';
        const bgColor = allDone ? 'bg-green-50 dark:bg-green-900/20' : 'bg-amber-50 dark:bg-amber-900/20';

        return (
          <div className={`mb-6 rounded-lg border p-6 ${bgColor} ${borderColor}`}>
            {/* Stepper */}
            <div className="flex items-center gap-1 mb-4">
              {steps.map((s, i) => (
                <div key={s.label} className="flex items-center gap-1">
                  {i > 0 && <div className={`w-4 h-px ${s.done ? 'bg-green-300 dark:bg-green-700' : 'bg-border'}`} />}
                  <div className="flex items-center gap-1.5">
                    <span className={`flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold ${
                      s.done ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
                    }`}>
                      {s.done ? '\u2713' : i + 1}
                    </span>
                    {s.txHash ? (
                      <a
                        href={`${basescanBase}/tx/${s.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-[10px] font-medium hover:underline ${s.done ? 'text-green-700 dark:text-green-300' : 'text-muted-foreground'}`}
                      >
                        {s.label}
                      </a>
                    ) : (
                      <span className={`text-[10px] font-medium ${s.done ? 'text-green-700 dark:text-green-300' : 'text-muted-foreground'}`}>
                        {s.label}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Outcome + confidence */}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-lg font-bold">
                {resolution.suggestedOutcome || market.outcome || 'Sin resultado'}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                resolution.confidence === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                resolution.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                'bg-muted text-muted-foreground'
              }`}>
                {resolution.confidence === 'high' ? 'Alta' :
                 resolution.confidence === 'medium' ? 'Media' : 'Baja'}
              </span>
              {resolution.confirmedAt && (
                <span className="text-[10px] text-muted-foreground/60">
                  {new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(resolution.confirmedAt))}
                </span>
              )}
            </div>

            {/* Evidence */}
            {typeof resolution.evidence === 'string' && <p className="text-sm text-foreground/80 mb-3"><CitedText>{resolution.evidence}</CitedText></p>}

            {resolution.evidenceUrls && resolution.evidenceUrls.length > 0 && (
              <div className="mb-3">
                {resolution.evidenceUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className={`block ${i === 0 ? 'text-sm text-blue-600 dark:text-blue-400' : 'text-[11px] text-muted-foreground/60'} hover:underline truncate`}>
                    {(() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })()}
                  </a>
                ))}
              </div>
            )}

            {/* Action for current step */}
            {!step2 && resolution.suggestedOutcome && (
              <div className="flex items-center gap-2 pt-3 border-t border-border">
                <ResolutionConfirmButton marketId={market.id} outcome={resolution.suggestedOutcome} />
                <ResolutionFeedbackButton marketId={market.id} />
              </div>
            )}

            {step2 && !step3 && hasMarketAddress && (
              <div className="pt-3 border-t border-border">
                <ResolveOnchainButton
                  marketId={market.id}
                  onchainId={Number(market.onchainId)}
                  outcome={market.outcome!}
                  outcomes={(market.outcomes as string[]) ?? ['Si', 'No']}
                  marketAddress={onchainData!.marketAddress as `0x${string}`}
                  chainId={market.chainId}
                />
              </div>
            )}

            {step3 && hasReporter && !reporterDone && hasMarketAddress && (
              <div className="pt-3 border-t border-orange-200 dark:border-orange-800">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-orange-700 dark:text-orange-300 font-medium">Reporter TX pendiente</span>
                </div>
                <ResolveOnchainButton
                  marketId={market.id}
                  onchainId={Number(market.onchainId)}
                  outcome={market.outcome!}
                  outcomes={(market.outcomes as string[]) ?? ['Si', 'No']}
                  marketAddress={onchainData!.marketAddress as `0x${string}`}
                  chainId={market.chainId}
                  reportOnly
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* Withdrawal — for closed markets */}
      {market.status === 'closed' && market.onchainId && market.onchainAddress && market.onchainAddress !== '0x0000000000000000000000000000000000000000' && (() => {
        const withdrawal = (resolution as Record<string, unknown> | undefined)?.withdrawal as import('@/db/types').WithdrawalProgress | undefined;
        const pendingLabel = market.pendingBalance && parseFloat(market.pendingBalance) > 0
          ? `$${formatVolume(market.pendingBalance)}`
          : undefined;

        return (
          <div className="mb-6">
            <UnredeemedWinners positions={unredeemedPositions} chainId={market.chainId} />
            <WithdrawLiquidityButton
              marketId={market.id}
              onchainId={Number(market.onchainId)}
              marketAddress={market.onchainAddress as `0x${string}`}
              chainId={market.chainId}
              withdrawal={withdrawal ?? null}
              balanceLabel={pendingLabel}
              hasUnredeemedWinners={unredeemedPositions.length > 0}
            />
          </div>
        );
      })()}

      <Card className="p-6">
        <CardContent className="p-0">
        <div className="flex items-start justify-between gap-4 mb-4">
          {isEditable ? (
            <EditableField
              marketId={market.id}
              field="title"
              value={market.title}
              className="text-xl font-bold"
            />
          ) : (
            <h1 className="text-xl font-bold">{market.title}</h1>
          )}
          <div className="flex items-center gap-2 shrink-0">
            {review?.recommendation && !(market.status === 'rejected' && review.recommendation === 'reject') && (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${RECOMMENDATION_STYLES[review.recommendation]?.color ?? ''}`}
              >
                {RECOMMENDATION_STYLES[review.recommendation]?.label ?? review.recommendation}
              </span>
            )}
            <StatusBadge status={market.status as Market['status']} />
          </div>
        </div>

        {sourceTopics.length > 0 && (
          <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
            <span>Tema{sourceTopics.length > 1 ? 's' : ''}:</span>
            {sourceTopics.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                <Link href={`/dashboard/topics/${t.slug}`} className="text-blue-600 dark:text-blue-400 hover:underline">{t.name}</Link>
              </span>
            ))}
          </div>
        )}

        {/* Outcomes */}
        {(() => {
          const outcomes = (market.outcomes as string[]) ?? ['Si', 'No'];
          const DOT_COLORS = ['bg-blue-400', 'bg-amber-400', 'bg-purple-400', 'bg-emerald-400', 'bg-rose-400', 'bg-cyan-400', 'bg-orange-400', 'bg-muted-foreground'];
          return (
            <div className="mb-4 space-y-0.5">
              {outcomes.map((o: string, i: number) => (
                <div key={o} className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${market.outcome === o ? 'bg-green-500' : DOT_COLORS[i % DOT_COLORS.length]}`} />
                  <span className={`text-sm ${market.outcome === o ? 'font-semibold text-green-700 dark:text-green-300' : 'text-foreground/80'}`}>{o}</span>
                  {market.outcome === o && <span className="text-[10px] text-green-500 dark:text-green-400 ml-1">resultado</span>}
                </div>
              ))}
            </div>
          );
        })()}

        {/* On-chain info */}
        {market.onchainId && (
          <div className="mb-4 rounded-md bg-muted border border-border px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">On-chain</span>
                {onchainData && JSON.stringify({ t: market.title, d: market.description, c: market.category, o: market.outcomes, e: market.endTimestamp }) === JSON.stringify({ t: onchainData.name, d: onchainData.description, c: onchainData.category, o: onchainData.outcomes, e: onchainData.endTimestamp }) && (
                  <span className="text-xs text-green-600 dark:text-green-400">En sync</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {market.onchainAddress && (
                  <a
                    href={`${getBasescanUrl(market.chainId)}/address/${market.onchainAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Basescan
                  </a>
                )}
                <a
                  href={`${getPredmarksUrl(market.chainId)}/mercados/${market.onchainId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Predmarks
                </a>
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-muted-foreground/60 text-xs">ID</span>
                <p className="font-mono font-medium text-foreground/80">#{market.onchainId}</p>
              </div>
              {market.volume && (
                <div>
                  <span className="text-muted-foreground/60 text-xs">Volumen</span>
                  <p className="font-medium text-foreground/80">${formatVolume(market.volume)}</p>
                </div>
              )}
              {market.participants != null && (
                <div>
                  <span className="text-muted-foreground/60 text-xs">Participantes</span>
                  <p className="font-medium text-foreground/80">{Math.max(0, (market.participants ?? 0) - (market.ownedParticipants ?? 0))}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending pipeline suggestion */}
        {market.pendingSuggestion && (
          <PendingSuggestion
            marketId={market.id}
            current={marketToSnapshot(market)}
            suggestion={market.pendingSuggestion as MarketSnapshot}
          />
        )}

        {/* Diff card: local vs onchain */}
        {market.onchainId && (
          <OnchainActions
            marketId={market.id}
            onchainId={Number(market.onchainId)}
            title={market.title}
            description={market.description}
            category={market.category}
            outcomes={(market.outcomes as string[]) ?? ['Si', 'No']}
            endTimestamp={market.endTimestamp}
            onchainData={onchainData}
          />
        )}

        <details open className="group">
          <summary className="text-sm font-medium text-muted-foreground cursor-pointer list-none flex items-center gap-1 mb-3">
            <span className="text-[10px] text-muted-foreground/60 group-open:rotate-90 transition-transform">&#9654;</span>
            Detalles
          </summary>
          <div className="space-y-4">
            <Section title="Categoría">
              <span>{market.category}</span>
              <span className="mx-2">&middot;</span>
              <TimingSafetyIndicator safety={market.timingSafety as Market['timingSafety']} />
              <span className="mx-2">&middot;</span>
              <span className="text-xs text-muted-foreground/60">Creado {new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }).format(market.createdAt)}</span>
            </Section>

            <Section title="Descripción">
              {isEditable ? (
                <EditableField
                  marketId={market.id}
                  field="description"
                  value={market.description}
                  type="textarea"
                  className="text-foreground/80"
                  renderMarkdown
                />
              ) : (
                <Markdown className="text-foreground/80">{market.description}</Markdown>
              )}
            </Section>

            <Section title="Cierre del mercado">
              {isEditable ? (
                <EditableField
                  marketId={market.id}
                  field="endTimestamp"
                  value={new Date(market.endTimestamp * 1000).toISOString().slice(0, 16)}
                  type="datetime"
                  className="text-foreground/80"
                  displayValue={formatTimestamp(market.endTimestamp, tz)}
                />
              ) : (
                <p className="text-foreground/80">{formatTimestamp(market.endTimestamp, tz)}</p>
              )}
            </Section>

            <Section title="Fecha esperada de resolución">
              {isEditable ? (
                <EditableField
                  marketId={market.id}
                  field="expectedResolutionDate"
                  value={market.expectedResolutionDate ?? ''}
                  type="date"
                  className="text-foreground/80"
                  displayValue={market.expectedResolutionDate ?? undefined}
                />
              ) : market.expectedResolutionDate ? (
                <p className="text-foreground/80">{market.expectedResolutionDate}</p>
              ) : (
                <p className="text-muted-foreground/60 italic text-xs">No definida</p>
              )}
            </Section>

            {(market.tags as string[]).length > 0 && (
              <Section title="Tags">
                <div className="flex gap-1 flex-wrap">
                  {(market.tags as string[]).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {market.outcome && (
              <Section title="Resultado">
                <span className="font-bold text-lg">{market.outcome}</span>
              </Section>
            )}
          </div>
        </details>
        <div className="mt-4">
          <CopyJsonButton json={JSON.stringify(deployable, null, 2)} />
        </div>
        </CardContent>
      </Card>

      {/* Reviews */}
      {(() => {
        const iterationDates = new Map(
          events.filter(e => e.type === 'scored' && e.iteration != null)
            .map(e => [e.iteration!, e.createdAt] as const)
        );
        const hasIterations = iterations.length > 0;
        const hasReviewOnly = !hasIterations && review;

        if (!hasIterations && !hasReviewOnly) return null;

        return (
          <details open className="mt-6">
            <Card className="p-6">
            <summary className="text-lg font-bold cursor-pointer list-none">Revisiones</summary>
            <div className="mt-4 space-y-4">
              {hasReviewOnly && (
                <div className="border border-border rounded-lg px-4 py-4">
                  <ReviewDetail review={review} />
                </div>
              )}
              {iterations.map((iter, idx) => (
                <details key={iter.version} className="border border-border rounded-lg" open={idx === iterations.length - 1}>
                  <summary className="px-4 py-3 cursor-pointer hover:bg-muted flex items-center justify-between">
                    <span className="font-medium text-sm">
                      Versión {iter.version}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {iterationDates.get(iter.version) && (
                        <span className="mr-3 text-muted-foreground/60">{formatEventTime(iterationDates.get(iter.version)!, tz)}</span>
                      )}
                      Score: {iter.review.scores.overallScore.toFixed(1)}/10
                    </span>
                  </summary>
                  <div className="px-4 pb-4 space-y-3">
                    <div className="text-sm">
                      <strong>Título:</strong> {iter.market.title}
                    </div>
                    {iter.feedback && (
                      <div>
                        <strong className="text-sm">Feedback:</strong>
                        <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap bg-muted rounded p-2">
                          {iter.feedback}
                        </pre>
                      </div>
                    )}
                    <ReviewDetail review={iter.review} />
                  </div>
                </details>
              ))}
            </div>
            </Card>
          </details>
        );
      })()}

      {/* Activity Timeline */}
      {(() => {
        // Merge market events + activity log into unified timeline
        type TimelineEntry = { id: string; time: Date; source: 'event' | 'activity'; event?: typeof events[0]; activity?: typeof activity[0] };
        const timeline: TimelineEntry[] = [
          ...events.map((e) => ({ id: `ev-${e.id}`, time: e.createdAt, source: 'event' as const, event: e })),
          ...activity.map((a) => ({ id: `act-${a.id}`, time: a.createdAt, source: 'activity' as const, activity: a })),
        ].sort((a, b) => b.time.getTime() - a.time.getTime());

        if (timeline.length === 0) return null;

        return (
          <details open className="mt-6">
            <Card className="p-6">
            <summary className="text-lg font-bold cursor-pointer list-none">Actividad</summary>
            <div className="mt-4">
              <ul className="border-l-2 border-border ml-2 space-y-0">
                <ExpandableList>
                  {timeline.map((entry) => (
                    <li key={entry.id} className="relative pl-5 py-1.5">
                      <span className="absolute -left-[5px] top-2.5 w-2 h-2 rounded-full bg-muted-foreground" />
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-muted-foreground/60 shrink-0 font-mono">
                          {formatEventTime(entry.time, tz)}
                        </span>
                        {entry.source === 'event' && entry.event && (
                          <span className="text-sm text-foreground/80">
                            {formatEvent(entry.event.type as MarketEventType, entry.event.iteration, entry.event.detail as Record<string, unknown> | null)}
                          </span>
                        )}
                        {entry.source === 'activity' && entry.activity && (
                          <div className="flex-1 -mt-0.5">
                            <ActivityCard entry={{ ...entry.activity, detail: entry.activity.detail as Record<string, unknown> | null, createdAt: entry.activity.createdAt.toISOString() }} />
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ExpandableList>
              </ul>
            </div>
            </Card>
          </details>
        );
      })()}


      {/* Related Signals */}
      {relatedSignals.length > 0 && (
        <details open className="mt-6">
          <Card>
          <summary className="px-5 py-3 border-b border-border cursor-pointer list-none">
            <h2 className="text-lg font-bold">Señales relacionadas ({relatedSignals.length})</h2>
          </summary>
          <div className="divide-y divide-border">
            <ExpandableList>
              {relatedSignals.map((s) => {
                const badge = { news: { label: 'Noticia', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' }, data: { label: 'Dato', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' }, social: { label: 'Social', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' }, event: { label: 'Evento', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' } }[s.type] ?? { label: s.type, cls: 'bg-muted text-muted-foreground' };
                return (
                  <div key={s.id} className="px-5 py-3">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${badge.cls}`}>{badge.label}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground/60">{s.source}</span>
                          <span className="text-[10px] text-muted-foreground/50">{formatEventTime(s.publishedAt, tz)}</span>
                        </div>
                        <p className="text-sm text-foreground mt-0.5">
                          {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline">{s.text}</a> : s.text}
                        </p>
                        {s.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.summary}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </ExpandableList>
          </div>
          </Card>
        </details>
      )}

      </div>
    </div>
  );
}

function formatEventTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    timeZone: tz,
  }).format(date);
}

const EVENT_LABELS: Record<MarketEventType, string> = {
  pipeline_started: 'Pipeline iniciado',
  pipeline_resumed: 'Pipeline reanudado',
  data_verified: 'Datos verificados',
  rules_checked: 'Reglas verificadas',
  scored: 'Scoring',
  improved: 'Mejora aplicada',
  pipeline_opened: 'Abierto por pipeline',
  pipeline_rejected: 'Rechazado por pipeline',
  human_rejected: 'Rechazado',
  human_edited: 'Editado',
  human_feedback: 'Feedback humano',
  human_archived: 'Archivado',
  human_unarchived: 'Desarchivado',
  pipeline_cancelled: 'Cancelado',
  status_changed: 'Estado cambiado',
};

function formatEvent(
  type: MarketEventType,
  iteration: number | null,
  detail: Record<string, unknown> | null,
): string {
  const label = EVENT_LABELS[type] ?? type;
  const parts: string[] = [];

  if (iteration) parts.push(`v${iteration}`);
  parts.push(label);

  if (detail) {
    switch (type) {
      case 'data_verified':
        parts.push(`(${detail.claimsCount} claims, ${detail.inaccurateCount} inexactos)`);
        break;
      case 'rules_checked': {
        const failed = detail.failedHard as string[] | undefined;
        if (failed?.length) parts.push(`(${failed.join(', ')} fallidas)`);
        else parts.push('(todas ok)');
        break;
      }
      case 'scored':
        parts.push(`${detail.overallScore}/10`);
        break;
      case 'pipeline_opened':
        parts.push(`(score: ${detail.score})`);
        break;
      case 'pipeline_rejected':
        if (detail.reason) parts.push(`— ${detail.reason}`);
        break;
      case 'human_rejected':
        if (detail.reason) parts.push(`— ${detail.reason}`);
        break;
      case 'human_edited': {
        const fields = detail.fields as string[] | undefined;
        if (fields?.length) parts.push(`(${fields.join(', ')})`);
        if (detail.approved) parts.push('+ aprobado');
        break;
      }
      case 'human_feedback': {
        const text = detail.text as string | undefined;
        if (text) {
          const snippet = text.length > 80 ? text.slice(0, 80) + '…' : text;
          parts.push(`— "${snippet}"`);
        }
        break;
      }
    }
  }

  return parts.join(' ');
}

const SECTION_COLORS: Record<string, string> = {
  'Descripción': 'border-blue-400 dark:border-blue-600',
  'Criterios de resolución': 'border-amber-400 dark:border-amber-600',
  'Fuente de resolución': 'border-green-400 dark:border-green-600',
  'Contingencias': 'border-orange-400 dark:border-orange-600',
  'Opciones': 'border-purple-400 dark:border-purple-600',
  'Resultado': 'border-green-500 dark:border-green-600',
  'Cierre del mercado': 'border-border',
  'Fecha esperada de resolución': 'border-border',
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const borderColor = SECTION_COLORS[title] ?? 'border-border';
  return (
    <div className={`border-l-3 ${borderColor} pl-3`}>
      <h3 className="text-base font-semibold text-foreground/80 mb-1">{title}</h3>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function ReviewDetail({ review }: { review: ReviewResult }) {
  return (
    <>
      {/* Scores */}
      {review.scores.overallScore > 0 && (
        <div className="mb-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <ScoreBar label="Ambigüedad" score={review.scores.ambiguity} weight="35%" />
            <ScoreBar label="Timing" score={review.scores.timingSafety} weight="25%" />
            <ScoreBar label="Actualidad" score={review.scores.timeliness} weight="20%" />
            <ScoreBar label="Volumen" score={review.scores.volumePotential} weight="20%" />
          </div>
          <div className="mt-2 text-sm font-semibold">
            Score general: {review.scores.overallScore.toFixed(1)}/10
          </div>
        </div>
      )}

      {/* Hard Rules */}
      {review.hardRuleResults.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Reglas estrictas</h3>
          <div className="space-y-1">
            {review.hardRuleResults.map((r) => (
              <div key={r.ruleId} className="text-sm flex gap-2">
                <span>{r.passed ? '\u2705' : '\u274C'}</span>
                <span>
                  <strong>{r.ruleId}</strong>: {r.explanation}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Soft Rules */}
      {review.softRuleResults.filter((r) => !r.passed).length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Advertencias</h3>
          <div className="space-y-1">
            {review.softRuleResults
              .filter((r) => !r.passed)
              .map((r) => (
                <div key={r.ruleId} className="text-sm flex gap-2">
                  <span>{'\u26A0\uFE0F'}</span>
                  <span>
                    <strong>{r.ruleId}</strong>: {r.explanation}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Resolution Source Check */}
      {review.resolutionSourceCheck && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Verificación de fuente
          </h3>
          <div className="text-sm space-y-1">
            <div>
              {review.resolutionSourceCheck.exists ? '\u2705' : '\u274C'} Existe
              {' \u00B7 '}
              {review.resolutionSourceCheck.accessible ? '\u2705' : '\u274C'} Accesible
              {' \u00B7 '}
              {review.resolutionSourceCheck.publishesRelevantData ? '\u2705' : '\u274C'} Publica datos relevantes
            </div>
            {review.resolutionSourceCheck.note && (
              <p className="text-muted-foreground">{review.resolutionSourceCheck.note}</p>
            )}
          </div>
        </div>
      )}

      {/* Data Verification */}
      {review.dataVerification.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Verificación de datos
          </h3>
          {review.dataVerification.map((v, i) => (
            <div key={i} className="text-sm text-muted-foreground mb-1">
              {v.isAccurate ? '\u2705' : '\u274C'}{' '}
              <span className={!v.isAccurate && v.severity === 'critical' ? 'text-destructive font-medium' : ''}>
                {v.claim}: {v.currentValue}
              </span>
              {v.source && (
                <span className="text-muted-foreground/60"> ({v.source})</span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ScoreBar({
  label,
  score,
  weight,
}: {
  label: string;
  score: number;
  weight: string;
}) {
  const percentage = (score / 10) * 100;
  const color =
    score >= 7 ? 'bg-green-500' : score >= 4 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div>
      <div className="flex justify-between mb-0.5">
        <span className="text-foreground/80">
          {label} <span className="text-muted-foreground/60">({weight})</span>
        </span>
        <span className="font-medium">{score}/10</span>
      </div>
      <div className="w-full bg-muted rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
