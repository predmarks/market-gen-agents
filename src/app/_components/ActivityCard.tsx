'use client';

import { useState } from 'react';
import Link from 'next/link';

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  detail: Record<string, unknown> | null;
  source: string;
  createdAt: string;
}

// Badge config per action — color + label
const ACTION_BADGE: Record<string, { label: string; className: string }> = {
  // Feedback
  feedback_saved: { label: 'Feedback', className: 'bg-blue-100 text-blue-700' },
  global_feedback_added: { label: 'Feedback', className: 'bg-gray-100 text-gray-700' },
  // Topics
  topic_updated: { label: 'Tema actualizado', className: 'bg-green-100 text-green-700' },
  topic_dismissed: { label: 'Tema descartado', className: 'bg-orange-100 text-orange-700' },
  topics_merged: { label: 'Temas fusionados', className: 'bg-green-100 text-green-700' },
  signals_linked: { label: 'Señales vinculadas', className: 'bg-blue-100 text-blue-700' },
  topic_research_started: { label: 'Investigación', className: 'bg-purple-100 text-purple-700' },
  topic_research_completed: { label: 'Investigación completada', className: 'bg-purple-100 text-purple-700' },
  topic_rescored: { label: 'Re-puntuado', className: 'bg-green-100 text-green-700' },
  // Markets
  market_updated: { label: 'Mercado actualizado', className: 'bg-green-100 text-green-700' },
  market_approved: { label: 'Aprobado', className: 'bg-green-100 text-green-700' },
  market_rejected: { label: 'Rechazado', className: 'bg-red-100 text-red-700' },
  market_archived: { label: 'Archivado', className: 'bg-gray-100 text-gray-600' },
  signal_updated: { label: 'Señal actualizada', className: 'bg-blue-100 text-blue-700' },
  // Rules
  rule_updated: { label: 'Regla actualizada', className: 'bg-red-100 text-red-700' },
  rule_created: { label: 'Regla creada', className: 'bg-red-100 text-red-700' },
  // Pipeline
  ingestion_started: { label: 'Ingesta iniciada', className: 'bg-blue-100 text-blue-700' },
  ingestion_completed: { label: 'Ingesta completada', className: 'bg-blue-100 text-blue-700' },
  ingestion_failed: { label: 'Ingesta fallida', className: 'bg-red-100 text-red-700' },
  generation_started: { label: 'Generación iniciada', className: 'bg-amber-100 text-amber-700' },
  generation_completed: { label: 'Generación completada', className: 'bg-amber-100 text-amber-700' },
  review_started: { label: 'Revisión iniciada', className: 'bg-purple-100 text-purple-700' },
  generation_prompt_updated: { label: 'Prompt generación', className: 'bg-amber-100 text-amber-700' },
  chat_prompt_updated: { label: 'Prompt chat', className: 'bg-amber-100 text-amber-700' },
  // Resolution
  resolution_flagged: { label: 'Resolución sugerida', className: 'bg-green-100 text-green-700' },
  resolution_emergency: { label: 'Emergencia resolución', className: 'bg-red-100 text-red-700' },
  resolution_unclear: { label: 'Resolución parcial', className: 'bg-yellow-100 text-yellow-700' },
  resolution_confirmed: { label: 'Resolución confirmada', className: 'bg-green-100 text-green-700' },
  resolution_dismissed: { label: 'Resolución descartada', className: 'bg-gray-100 text-gray-600' },
  resolution_check_started: { label: 'Check resolución', className: 'bg-purple-100 text-purple-700' },
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(iso));
}

function CollapsibleList({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }} className="text-[10px] text-blue-600 hover:underline cursor-pointer">
        {open ? '▼' : '▶'} {label}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

// --- Per-action content renderers ---

function ContentView({ action, detail }: { action: string; detail: Record<string, unknown> }) {
  if (action === 'ingestion_completed') {
    const signalsBySource = detail.signalsBySource as Record<string, number> | undefined;
    const signalsList = detail.signals as { source: string; text: string; url?: string | null }[] | undefined;
    const topicsList = detail.topics as { id: string; name: string; slug: string }[] | undefined;
    return (
      <div className="space-y-1">
        <p className="text-sm text-gray-700">{detail.signalsCount as number} señales · {detail.topicCount as number} temas actualizados</p>
        {signalsBySource && (
          <div className="flex gap-2 flex-wrap">
            {Object.entries(signalsBySource).map(([source, count]) => (
              <span key={source} className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">
                {source}: {count}
              </span>
            ))}
          </div>
        )}
        {topicsList && topicsList.length > 0 && (
          <CollapsibleList label={`${topicsList.length} temas`}>
            <div className="space-y-0.5">
              {topicsList.map((t) => (
                <Link key={t.id} href={`/dashboard/topics/${t.slug}`} onClick={(e) => e.stopPropagation()} className="block text-[11px] text-blue-600 hover:underline truncate">
                  {t.name}
                </Link>
              ))}
            </div>
          </CollapsibleList>
        )}
        {signalsList && signalsList.length > 0 && (
          <CollapsibleList label={`${signalsList.length} señales`}>
            <div className="space-y-0.5">
              {signalsList.map((s, i) => (
                <p key={i} className="text-[11px] text-gray-600">
                  <span className="text-gray-400">[{s.source}]</span>{' '}
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">{s.text}</a>
                  ) : s.text}
                </p>
              ))}
            </div>
          </CollapsibleList>
        )}
      </div>
    );
  }

  if (action === 'topic_research_completed') {
    const resAction = detail.action as string | undefined;
    const signalsList = detail.signals as { source: string; text: string; url?: string | null }[] | undefined;
    const actionLabel = resAction === 'merged' ? 'Fusionado con tema existente' : resAction === 'updated' ? 'Tema actualizado' : 'Tema creado';
    return (
      <div className="space-y-1">
        <p className="text-sm text-gray-700">{actionLabel}</p>
        {typeof detail.description === 'string' && <p className="text-xs text-gray-500">Consulta: {detail.description}</p>}
        {signalsList && signalsList.length > 0 && (
          <CollapsibleList label={`${signalsList.length} señales encontradas`}>
            <div className="space-y-0.5">
              {signalsList.map((s, i) => (
                <p key={i} className="text-[11px] text-gray-600">
                  <span className="text-gray-400">[{s.source}]</span>{' '}
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:underline">{s.text}</a>
                  ) : s.text}
                </p>
              ))}
            </div>
          </CollapsibleList>
        )}
      </div>
    );
  }

  if (action === 'resolution_flagged' || action === 'resolution_emergency' || action === 'resolution_unclear') {
    const suggestedOutcome = detail.suggestedOutcome as string | undefined;
    const confidence = detail.confidence as string | undefined;
    const evidence = (detail as Record<string, unknown>).evidence as string | undefined;
    return (
      <div className="space-y-1">
        {suggestedOutcome && <p className="text-sm text-gray-700">Resultado sugerido: <strong>{suggestedOutcome}</strong></p>}
        {confidence && (
          <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-full ${
            confidence === 'high' ? 'bg-green-100 text-green-700' :
            confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
            'bg-gray-100 text-gray-500'
          }`}>
            {confidence === 'high' ? 'Alta confianza' : confidence === 'medium' ? 'Confianza media' : 'Baja confianza'}
          </span>
        )}
        {typeof detail.isEmergency === 'boolean' && detail.isEmergency && typeof detail.emergencyReason === 'string' && (
          <p className="text-sm text-red-600">{detail.emergencyReason}</p>
        )}
      </div>
    );
  }

  if (action === 'resolution_confirmed') {
    const outcome = detail.outcome as string | undefined;
    const confidence = detail.confidence as string | undefined;
    return (
      <div className="space-y-1">
        {outcome && <p className="text-sm text-gray-700">Resultado: <strong>{outcome}</strong></p>}
        {confidence && <p className="text-xs text-gray-500">Confianza: {confidence}</p>}
        {typeof detail.evidence === 'string' && <p className="text-xs text-gray-500">{detail.evidence}</p>}
      </div>
    );
  }

  if (action === 'resolution_dismissed') {
    const suggestedOutcome = detail.suggestedOutcome as string | undefined;
    const confidence = detail.confidence as string | undefined;
    return (
      <div className="space-y-1">
        {suggestedOutcome && <p className="text-sm text-gray-700">Se descartó: <strong>{suggestedOutcome}</strong> ({confidence ?? '?'})</p>}
        {typeof detail.evidence === 'string' && <p className="text-xs text-gray-500">{detail.evidence}</p>}
      </div>
    );
  }

  if (action === 'ingestion_failed') {
    return <p className="text-sm text-red-600">{detail.error as string}</p>;
  }

  if (action === 'generation_started') {
    const marketType = detail.marketType as string | undefined;
    const instruction = detail.instruction as string | undefined;
    return (
      <div className="space-y-1">
        {instruction && <p className="text-sm text-gray-700">{instruction}</p>}
        {marketType && (
          <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-full ${marketType === 'multi-outcome' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
            {marketType === 'multi-outcome' ? 'Multi-opción' : 'Binario'}
          </span>
        )}
      </div>
    );
  }

  if (action === 'generation_completed') {
    const savedMarkets = detail.savedMarkets as { id: string; title: string }[] | undefined;
    const topicNames = detail.topicNames as string[] | undefined;
    return (
      <div className="space-y-1">
        {detail.candidateCount != null && (
          <p className="text-sm text-gray-700">{detail.candidateCount as number} mercados generados · {detail.duplicatesRemoved as number} duplicados eliminados</p>
        )}
        {topicNames && topicNames.length > 0 && (
          <p className="text-[11px] text-gray-500">Temas: {topicNames.join(', ')}</p>
        )}
        {savedMarkets && savedMarkets.length > 0 && (
          <div className="space-y-0.5">
            {savedMarkets.map((m) => (
              <Link key={m.id} href={`/dashboard/markets/${m.id}`} className="block text-blue-600 hover:underline truncate text-xs">
                {m.title}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (action === 'signals_linked') {
    return <p className="text-sm text-gray-700">{detail.linked as number} señal(es) vinculada(s) · Total: {detail.total as number}</p>;
  }

  if (action === 'topics_merged') {
    return <p className="text-sm text-gray-700">{(detail.sourceTopicIds as string[])?.length ?? 0} temas fusionados · {detail.totalSignals as number} señales totales</p>;
  }

  if (action === 'feedback_saved' || action === 'global_feedback_added') {
    const text = (detail.feedback ?? detail.text) as string;
    return <p className="text-sm text-gray-700">{text}</p>;
  }

  if (action === 'topic_dismissed') {
    const reason = detail.reason as string | undefined;
    if (!reason) return null;
    return <p className="text-sm text-gray-700">{reason}</p>;
  }

  if (action === 'topic_rescored') {
    return <p className="text-sm text-gray-700">Score: {(detail.score as number)?.toFixed(1)} — {detail.reason as string}</p>;
  }

  if (action === 'market_rejected' && detail.reason) {
    return <p className="text-sm text-gray-700">{detail.reason as string}</p>;
  }

  if (action === 'topic_updated' || action === 'market_updated' || action === 'signal_updated') {
    const entries = Object.entries(detail).filter(([k]) => k !== 'updatedAt');
    if (entries.length === 0) return null;
    return (
      <div className="space-y-0.5">
        {entries.map(([k, v]) => (
          <p key={k} className="text-sm text-gray-700"><span className="text-gray-500">{k}:</span> {typeof v === 'string' ? v.slice(0, 100) : JSON.stringify(v)}</p>
        ))}
      </div>
    );
  }

  // Generic fallback
  const entries = Object.entries(detail);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {entries.map(([k, v]) => (
        <p key={k} className="text-sm text-gray-700"><span className="text-gray-500">{k}:</span> {typeof v === 'string' ? v.slice(0, 100) : JSON.stringify(v)}</p>
      ))}
    </div>
  );
}

// --- Resolve entity label and URL ---

function getEntityInfo(entry: ActivityEntry): { label: string | null; url: string | null; usedBy: string } {
  const { action, detail, entityLabel, entityId, entityType } = entry;

  // Feedback has custom "used by" logic
  if (action === 'global_feedback_added') {
    const text = (detail?.text ?? detail?.feedback) as string | undefined;
    const firstLine = text ? (text.length > 80 ? text.slice(0, 80) + '…' : text) : entityLabel;
    return { label: firstLine, url: null, usedBy: 'generador, revisor, extractor' };
  }
  if (action === 'feedback_saved') {
    const contextLabel = (detail?.contextLabel as string) ?? entityLabel;
    const contextUrl = (detail?.contextUrl as string) ?? null;
    const feedbackEntityType = (detail?.entityType as string) ?? entityType;
    const usedBy = feedbackEntityType === 'topic' ? 'extractor, generador' : 'revisor';
    return { label: contextLabel, url: contextUrl, usedBy };
  }

  // Topic dismissed
  if (action === 'topic_dismissed') {
    const contextLabel = (detail?.contextLabel as string) ?? entityLabel;
    const contextUrl = (detail?.contextUrl as string) ?? null;
    return { label: contextLabel, url: contextUrl, usedBy: 'extractor, generador' };
  }

  // Generation started — linked to topic
  if (action === 'generation_started') {
    const topicNames = detail?.topicNames as string[] | undefined;
    const label = topicNames?.join(', ') ?? entityLabel;
    return { label, url: null, usedBy: 'generador' };
  }

  // Generation completed — link to market
  if (action === 'generation_completed') {
    if (entityType === 'market' && entityId) {
      return { label: entityLabel, url: `/dashboard/markets/${entityId}`, usedBy: 'generador' };
    }
    // System summary — show first market as linked label
    const savedMarkets = detail?.savedMarkets as { id: string; title: string }[] | undefined;
    if (savedMarkets && savedMarkets.length > 0) {
      const suffix = savedMarkets.length > 1 ? ` (+${savedMarkets.length - 1})` : '';
      return { label: savedMarkets[0].title + suffix, url: `/dashboard/markets/${savedMarkets[0].id}`, usedBy: 'generador' };
    }
    return { label: null, url: null, usedBy: 'generador' };
  }

  // Review started — link to market
  if (action === 'review_started') {
    return { label: entityLabel, url: entityId ? `/dashboard/markets/${entityId}` : null, usedBy: 'revisor' };
  }

  // Market actions — always link to market page
  if (entityType === 'market' && entityId) {
    return { label: entityLabel, url: `/dashboard/markets/${entityId}`, usedBy: 'revisor' };
  }

  // Ingestion completed — link to signals page
  if (action === 'ingestion_completed') {
    return { label: entityLabel, url: '/dashboard/signals', usedBy: 'pipeline' };
  }

  // Topic actions — link to topic page via slug or derived from label
  if (entityType === 'topic' && entityId) {
    const topicSlug = detail?.topicSlug as string | undefined;
    const derivedSlug = !topicSlug && entityLabel
      ? entityLabel.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
      : null;
    const slug = topicSlug ?? derivedSlug;
    const url = slug ? `/dashboard/topics/${slug}` : null;
    return { label: entityLabel, url, usedBy: 'extractor, generador' };
  }

  // Default
  return { label: entityLabel, url: null, usedBy: entry.source };
}

function getPreviewText(action: string, detail: Record<string, unknown>): string | null {
  if (action === 'feedback_saved' || action === 'global_feedback_added') {
    const text = (detail.feedback ?? detail.text) as string | undefined;
    return text ? (text.length > 80 ? text.slice(0, 80) + '…' : text) : null;
  }
  if (action === 'topic_dismissed') {
    const reason = detail.reason as string | undefined;
    return reason ? (reason.length > 80 ? reason.slice(0, 80) + '…' : reason) : null;
  }
  if (action === 'topic_rescored') {
    return `Score: ${((detail.score as number) ?? 0).toFixed(1)}`;
  }
  if (action === 'market_rejected' && detail.reason) {
    const reason = detail.reason as string;
    return reason.length > 80 ? reason.slice(0, 80) + '…' : reason;
  }
  if (action === 'resolution_flagged' || action === 'resolution_emergency' || action === 'resolution_unclear') {
    const outcome = detail.suggestedOutcome as string | undefined;
    const confidence = detail.confidence as string | undefined;
    if (outcome) return `${outcome} (${confidence ?? '?'})`;
    return null;
  }
  if (action === 'resolution_confirmed') {
    return `Confirmado: ${detail.outcome ?? '?'}`;
  }
  if (action === 'resolution_dismissed') {
    return `Descartado: ${detail.suggestedOutcome ?? '?'}`;
  }
  if (action === 'topic_research_completed') {
    const resAction = detail.action as string | undefined;
    const label = resAction === 'merged' ? 'Fusionado' : resAction === 'updated' ? 'Actualizado' : 'Creado';
    return `${label} · ${detail.signalCount ?? 0} señales`;
  }
  if (action === 'ingestion_completed') {
    return `${detail.signalsCount ?? 0} señales · ${detail.topicCount ?? 0} temas`;
  }
  if (action === 'generation_completed' && detail.candidateCount != null) {
    return `${detail.candidateCount} mercados generados`;
  }
  if (action === 'generation_started' && detail.instruction) {
    const instr = detail.instruction as string;
    return instr.length > 80 ? instr.slice(0, 80) + '…' : instr;
  }
  return null;
}

export function ActivityCard({ entry, defaultExpanded = false, compact = false }: {
  entry: ActivityEntry;
  defaultExpanded?: boolean;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const badge = ACTION_BADGE[entry.action] ?? { label: entry.action, className: 'bg-gray-100 text-gray-600' };
  const { label, url, usedBy } = getEntityInfo(entry);
  const hasDetail = entry.detail && Object.keys(entry.detail).length > 0;

  return (
    <div className={`${compact ? 'text-xs' : ''} ${hasDetail ? 'cursor-pointer' : ''}`} onClick={() => hasDetail && setExpanded(!expanded)}>
      {/* Row 1: Badge + entity label */}
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded-full ${badge.className}`}>
          {badge.label}
        </span>
        {label && (
          url ? (
            <Link href={url} onClick={(e) => e.stopPropagation()} className="text-xs text-blue-600 hover:underline truncate max-w-xs">{label}</Link>
          ) : (
            <span className="text-xs text-gray-700 truncate max-w-xs">{label}</span>
          )
        )}
        {hasDetail && <span className="text-[10px] text-gray-300 ml-auto shrink-0">{expanded ? '▲' : '▼'}</span>}
      </div>

      {/* Row 2: Timestamp + used by */}
      <p className="text-[10px] text-gray-400">
        {formatTime(entry.createdAt)} · Usado por: {usedBy}
      </p>

      {/* Row 3: Content (collapsed by default) or preview */}
      {hasDetail && (
        expanded ? (
          <div className="mt-1">
            <ContentView action={entry.action} detail={entry.detail!} />
          </div>
        ) : (
          (() => {
            const preview = getPreviewText(entry.action, entry.detail!);
            return preview ? <p className="text-xs text-gray-400 mt-0.5 truncate">{preview}</p> : null;
          })()
        )
      )}
    </div>
  );
}
