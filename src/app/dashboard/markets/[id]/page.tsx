export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db/client';
import { markets, marketEvents, activityLog, topics, topicSignals, signals } from '@/db/schema';
import { eq, asc, desc, inArray } from 'drizzle-orm';
import type { Market, Iteration, MarketEventType } from '@/db/types';
import { toDeployableMarket } from '@/lib/export';
import { StatusBadge } from '../../_components/StatusBadge';
import { TimingSafetyIndicator } from '../../_components/TimingSafetyIndicator';
import { MarketActions } from './_components/MarketActions';

import { CopyJsonButton } from './_components/CopyJsonButton';
import { Markdown } from '../../../_components/Markdown';
import { ActivityCard } from '@/app/_components/ActivityCard';
import { ResolutionConfirmButton, ResolutionDismissButton } from './_components/ResolutionActions';

function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(ts * 1000));
}

const RECOMMENDATION_STYLES: Record<string, { color: string; label: string }> = {
  publish: { color: 'bg-green-100 text-green-800', label: 'Publicar' },
  rewrite_then_publish: { color: 'bg-yellow-100 text-yellow-800', label: 'Reescribir y publicar' },
  hold: { color: 'bg-orange-100 text-orange-800', label: 'Esperar' },
  reject: { color: 'bg-red-100 text-red-800', label: 'Rechazar' },
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MarketDetailPage({ params }: Props) {
  const { id } = await params;
  const [[market], events, activity] = await Promise.all([
    db.select().from(markets).where(eq(markets.id, id)),
    db.select().from(marketEvents).where(eq(marketEvents.marketId, id)).orderBy(asc(marketEvents.createdAt)),
    db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(desc(activityLog.createdAt)).limit(50),
  ]);

  if (!market) notFound();

  const deployable = toDeployableMarket(market as unknown as Market);
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
        href="/dashboard"
        className="text-sm text-gray-500 hover:text-gray-900 mb-4 inline-block"
      >
        &larr; Volver
      </Link>

      {/* Actions */}
      <div className="mb-4">
        <MarketActions
          marketId={market.id}
          status={market.status as Market['status']}
          review={review ?? null}
          iterations={iterations.length > 0 ? iterations : null}
          isArchived={!!market.isArchived}
        />
      </div>

      <div className="max-w-3xl">

      {/* Resolution Suggestion — top of page */}
      {resolution && !market.outcome && (
        <div className={`mb-6 rounded-lg border p-6 ${
          market.status === 'open' && resolution.suggestedOutcome
            ? 'bg-amber-50 border-amber-300'
            : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Resolución sugerida</h2>
            <div className="flex items-center gap-2">
              {resolution.flaggedAt && (
                <span className="text-[10px] text-gray-400">
                  {new Intl.DateTimeFormat('es-AR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    timeZone: 'America/Argentina/Buenos_Aires',
                  }).format(new Date(resolution.flaggedAt))}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                resolution.confidence === 'high' ? 'bg-green-100 text-green-700' :
                resolution.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                {resolution.confidence === 'high' ? 'Alta confianza' :
                 resolution.confidence === 'medium' ? 'Confianza media' : 'Baja confianza'}
              </span>
            </div>
          </div>

          {market.status === 'open' && resolution.suggestedOutcome && (
            <div className="bg-amber-100 border border-amber-200 rounded-md px-3 py-2 mb-3 text-sm text-amber-800">
              El mercado sigue abierto y hay evidencia de resolución.
            </div>
          )}

          {resolution.suggestedOutcome && (
            <div className="mb-3">
              <span className="text-sm text-gray-500">Resultado:</span>{' '}
              <span className="text-lg font-bold">{resolution.suggestedOutcome}</span>
            </div>
          )}

          <p className="text-sm text-gray-700 mb-3">{resolution.evidence}</p>

          {resolution.evidenceUrls && resolution.evidenceUrls.length > 0 && (
            <div className="mb-3">
              <a href={resolution.evidenceUrls[0]} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">
                Fuente principal
              </a>
              {resolution.evidenceUrls.length > 1 && (
                <div className="mt-1 space-y-0.5">
                  {resolution.evidenceUrls.slice(1).map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-gray-400 hover:text-blue-600 hover:underline truncate">
                      {url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {resolution.suggestedOutcome && !resolution.confirmedAt && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
              <ResolutionConfirmButton marketId={market.id} outcome={resolution.suggestedOutcome} />
              <ResolutionDismissButton marketId={market.id} />
            </div>
          )}
        </div>
      )}

      {/* Resolution (confirmed) */}
      {resolution && market.outcome && (
        <div className="mb-6 bg-green-50 rounded-lg border border-green-200 p-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">Resuelto: {market.outcome}</span>
            {resolution.confirmedAt && (
              <span className="text-xs text-gray-400">
                {new Intl.DateTimeFormat('es-AR', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  timeZone: 'America/Argentina/Buenos_Aires',
                }).format(new Date(resolution.confirmedAt))}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-700 mt-1">{resolution.evidence}</p>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="text-xl font-bold">{market.title}</h1>
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
          <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
            <span>Tema{sourceTopics.length > 1 ? 's' : ''}:</span>
            {sourceTopics.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                <Link href={`/dashboard/topics/${t.slug}`} className="text-blue-600 hover:underline">{t.name}</Link>
              </span>
            ))}
          </div>
        )}

        {/* Outcomes */}
        {(() => {
          const outcomes = (market.outcomes as string[]) ?? ['Si', 'No'];
          const DOT_COLORS = ['bg-blue-400', 'bg-amber-400', 'bg-purple-400', 'bg-emerald-400', 'bg-rose-400', 'bg-cyan-400', 'bg-orange-400', 'bg-gray-400'];
          return (
            <div className="mb-4 space-y-0.5">
              {outcomes.map((o: string, i: number) => (
                <div key={o} className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${market.outcome === o ? 'bg-green-500' : DOT_COLORS[i % DOT_COLORS.length]}`} />
                  <span className={`text-sm ${market.outcome === o ? 'font-semibold text-green-700' : 'text-gray-700'}`}>{o}</span>
                  {market.outcome === o && <span className="text-[10px] text-green-500 ml-1">resultado</span>}
                </div>
              ))}
            </div>
          );
        })()}

        <div className="space-y-4">
          <Section title="Categoría">
            <span>{market.category}</span>
            <span className="mx-2">&middot;</span>
            <TimingSafetyIndicator safety={market.timingSafety as Market['timingSafety']} />
          </Section>

          <Section title="Descripción">
            <Markdown className="text-gray-700">{market.description}</Markdown>
          </Section>

          <Section title="Cierre del mercado">
            <p className="text-gray-700">{formatTimestamp(market.endTimestamp)}</p>
          </Section>

          {market.expectedResolutionDate && (
            <Section title="Fecha esperada de resolución">
              <p className="text-gray-700">{market.expectedResolutionDate}</p>
            </Section>
          )}

          {(market.tags as string[]).length > 0 && (
            <Section title="Tags">
              <div className="flex gap-1 flex-wrap">
                {(market.tags as string[]).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
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
      </div>

      {/* Deployable JSON Preview */}
      <details className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
        <summary className="flex items-center justify-between cursor-pointer list-none">
          <h2 className="text-lg font-bold">JSON</h2>
          <CopyJsonButton json={JSON.stringify(deployable, null, 2)} />
        </summary>
        <pre className="bg-gray-50 rounded-lg p-4 text-sm overflow-x-auto mt-3">
          {JSON.stringify(deployable, null, 2)}
        </pre>
      </details>

      {/* Iteration History */}
      {iterations.length > 0 && (
        <details className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <summary className="text-lg font-bold cursor-pointer list-none">Historial de iteraciones</summary>
          <div className="mt-4"></div>
          <div className="space-y-4">
            {iterations.map((iter) => (
              <details key={iter.version} className="border border-gray-100 rounded-lg">
                <summary className="px-4 py-3 cursor-pointer hover:bg-gray-50 flex items-center justify-between">
                  <span className="font-medium text-sm">
                    Versión {iter.version}
                  </span>
                  <span className="text-sm text-gray-500">
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
                      <pre className="mt-1 text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded p-2">
                        {iter.feedback}
                      </pre>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>Ambigüedad: {iter.review.scores.ambiguity}/10</div>
                    <div>Timing: {iter.review.scores.timingSafety}/10</div>
                    <div>Actualidad: {iter.review.scores.timeliness}/10</div>
                    <div>Volumen: {iter.review.scores.volumePotential}/10</div>
                  </div>
                  {iter.review.hardRuleResults.filter((r) => !r.passed).length > 0 && (
                    <div className="text-xs">
                      <strong>Reglas fallidas:</strong>{' '}
                      {iter.review.hardRuleResults
                        .filter((r) => !r.passed)
                        .map((r) => r.ruleId)
                        .join(', ')}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </details>
      )}

      {/* Activity Timeline */}
      {(events.length > 0 || activity.length > 0) && (
        <details className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <summary className="text-lg font-bold cursor-pointer list-none">Actividad</summary>
          <div className="mt-4"></div>
          {events.length > 0 && (
            <ul className="border-l-2 border-gray-200 ml-2 space-y-0">
              {events.map((event) => (
                <li key={event.id} className="relative pl-5 py-1.5">
                  <span className="absolute -left-[5px] top-2.5 w-2 h-2 rounded-full bg-gray-400" />
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-gray-400 shrink-0 font-mono">
                      {formatEventTime(event.createdAt)}
                    </span>
                    <span className="text-sm text-gray-700">
                      {formatEvent(event.type as MarketEventType, event.iteration, event.detail as Record<string, unknown> | null)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {activity.length > 0 && (
            <div className={`divide-y divide-gray-50 ${events.length > 0 ? 'mt-4 pt-4 border-t border-gray-100' : ''}`}>
              {activity.map((entry) => (
                <div key={entry.id} className="px-0 py-2">
                  <ActivityCard entry={{ ...entry, detail: entry.detail as Record<string, unknown> | null, createdAt: entry.createdAt.toISOString() }} />
                </div>
              ))}
            </div>
          )}
        </details>
      )}

      {/* Review Section */}
      {review && (
        <details className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <summary className="text-lg font-bold cursor-pointer list-none">Revisión final</summary>
          <div className="mt-4"></div>

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
              <h3 className="text-sm font-medium text-gray-500 mb-2">Reglas estrictas</h3>
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
              <h3 className="text-sm font-medium text-gray-500 mb-2">Advertencias</h3>
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
              <h3 className="text-sm font-medium text-gray-500 mb-2">
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
                  <p className="text-gray-600">{review.resolutionSourceCheck.note}</p>
                )}
              </div>
            </div>
          )}

          {/* Data Verification */}
          {review.dataVerification.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-500 mb-2">
                Verificación de datos
              </h3>
              {review.dataVerification.map((v, i) => (
                <div key={i} className="text-sm text-gray-600 mb-1">
                  {v.isAccurate ? '\u2705' : '\u274C'}{' '}
                  <span className={!v.isAccurate && v.severity === 'critical' ? 'text-red-600 font-medium' : ''}>
                    {v.claim}: {v.currentValue}
                  </span>
                  {v.source && (
                    <span className="text-gray-400"> ({v.source})</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </details>
      )}

      {/* Related Signals */}
      {relatedSignals.length > 0 && (
        <details className="mt-6 bg-white rounded-lg border border-gray-200">
          <summary className="px-5 py-3 border-b border-gray-100 cursor-pointer list-none">
            <h2 className="text-lg font-bold">Señales relacionadas ({relatedSignals.length})</h2>
          </summary>
          <div className="divide-y divide-gray-50">
            {relatedSignals.map((s) => {
              const badge = { news: { label: 'Noticia', cls: 'bg-blue-100 text-blue-700' }, data: { label: 'Dato', cls: 'bg-amber-100 text-amber-700' }, social: { label: 'Social', cls: 'bg-purple-100 text-purple-700' }, event: { label: 'Evento', cls: 'bg-green-100 text-green-700' } }[s.type] ?? { label: s.type, cls: 'bg-gray-100 text-gray-600' };
              return (
                <div key={s.id} className="px-5 py-3">
                  <div className="flex items-start gap-2">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${badge.cls}`}>{badge.label}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{s.source}</span>
                        <span className="text-[10px] text-gray-300">{formatEventTime(s.publishedAt)}</span>
                      </div>
                      <p className="text-sm text-gray-800 mt-0.5">
                        {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">{s.text}</a> : s.text}
                      </p>
                      {s.summary && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{s.summary}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      </div>
    </div>
  );
}

function formatEventTime(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
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
  'Descripción': 'border-blue-400',
  'Criterios de resolución': 'border-amber-400',
  'Fuente de resolución': 'border-green-400',
  'Contingencias': 'border-orange-400',
  'Opciones': 'border-purple-400',
  'Resultado': 'border-green-500',
  'Cierre del mercado': 'border-gray-300',
  'Fecha esperada de resolución': 'border-gray-300',
};

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const borderColor = SECTION_COLORS[title] ?? 'border-gray-300';
  return (
    <details open={defaultOpen} className={`border-l-3 ${borderColor} pl-3 group`}>
      <summary className="text-base font-semibold text-gray-700 mb-1 cursor-pointer list-none flex items-center gap-1">
        <span className="text-[10px] text-gray-400 group-open:rotate-90 transition-transform">&#9654;</span>
        {title}
      </summary>
      <div className="text-sm">{children}</div>
    </details>
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
        <span className="text-gray-700">
          {label} <span className="text-gray-400">({weight})</span>
        </span>
        <span className="font-medium">{score}/10</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
