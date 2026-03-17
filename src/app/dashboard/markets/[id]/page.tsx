export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db/client';
import { markets, marketEvents } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import type { Market, Iteration, MarketEventType } from '@/db/types';
import { toDeployableMarket } from '@/lib/export';
import { StatusBadge } from '../../_components/StatusBadge';
import { TimingSafetyIndicator } from '../../_components/TimingSafetyIndicator';
import { MarketActions } from './_components/MarketActions';

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
  const [[market], events] = await Promise.all([
    db.select().from(markets).where(eq(markets.id, id)),
    db.select().from(marketEvents).where(eq(marketEvents.marketId, id)).orderBy(asc(marketEvents.createdAt)),
  ]);

  if (!market) notFound();

  const deployable = toDeployableMarket(market as unknown as Market);
  const review = market.review as Market['review'];
  const resolution = market.resolution as Market['resolution'];
  const sourceContext = market.sourceContext as Market['sourceContext'];
  const iterations = (market.iterations as Iteration[] | null) ?? [];

  return (
    <div className="max-w-3xl">
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
        />
      </div>

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

        <div className="space-y-4">
          <Section title="Categoría">
            <span>{market.category}</span>
            <span className="mx-2">&middot;</span>
            <TimingSafetyIndicator safety={market.timingSafety as Market['timingSafety']} />
          </Section>

          <Section title="Descripción">
            <p className="text-gray-700">{market.description}</p>
          </Section>

          <Section title="Criterios de resolución">
            <p className="text-gray-700">{market.resolutionCriteria}</p>
          </Section>

          <Section title="Fuente de resolución">
            <p className="text-gray-700">{market.resolutionSource}</p>
          </Section>

          {market.contingencies && (
            <Section title="Contingencias">
              <p className="text-gray-700">{market.contingencies}</p>
            </Section>
          )}

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

          <Section title="Origen">
            <p className="text-sm text-gray-500">
              Tipo: {sourceContext.originType}
              {sourceContext.originUrl && (
                <>
                  {' \u00B7 '}
                  <a
                    href={sourceContext.originUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Fuente
                  </a>
                </>
              )}
            </p>
          </Section>
        </div>
      </div>

      {/* Iteration History */}
      {iterations.length > 0 && (
        <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-bold mb-4">Historial de iteraciones</h2>
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
        </div>
      )}

      {/* Activity Timeline */}
      {events.length > 0 && (
        <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-bold mb-4">Actividad</h2>
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
        </div>
      )}

      {/* Review Section */}
      {review && (
        <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-bold mb-4">Revisión final</h2>

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
        </div>
      )}

      {/* Resolution Section */}
      {resolution && (
        <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-bold mb-3">Resolución</h2>
          <div className="space-y-1 text-sm">
            <div>
              Resultado sugerido: <strong>{resolution.suggestedOutcome}</strong>
            </div>
            <div>Confianza: {resolution.confidence}</div>
            <div className="text-gray-700">{resolution.evidence}</div>
          </div>
        </div>
      )}

      {/* Deployable JSON Preview */}
      {(market.status === 'proposal' || market.status === 'approved') && (
        <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-bold mb-3">Preview: JSON desplegable</h2>
          <pre className="bg-gray-50 rounded-lg p-4 text-sm overflow-x-auto">
            {JSON.stringify(deployable, null, 2)}
          </pre>
        </div>
      )}
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
  pipeline_proposed: 'Propuesto',
  pipeline_rejected: 'Rechazado por pipeline',
  human_approved: 'Aprobado',
  human_rejected: 'Rechazado',
  human_edited: 'Editado',
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
      case 'pipeline_proposed':
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
    }
  }

  return parts.join(' ');
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-500 mb-1">{title}</h3>
      <div>{children}</div>
    </div>
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
