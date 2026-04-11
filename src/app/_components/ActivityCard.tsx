'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CitedText } from './CitedText';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

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

const ACTION_BADGE: Record<string, { label: string; className: string }> = {
  feedback_saved: { label: 'Feedback', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  global_feedback_added: { label: 'Feedback', className: 'bg-muted text-muted-foreground' },
  topic_updated: { label: 'Tema actualizado', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  topic_dismissed: { label: 'Tema descartado', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  topics_merged: { label: 'Temas fusionados', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  signals_linked: { label: 'Señales vinculadas', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  topic_research_started: { label: 'Investigación', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  topic_research_completed: { label: 'Investigación completada', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  topic_rescored: { label: 'Re-puntuado', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  market_updated: { label: 'Mercado actualizado', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  market_approved: { label: 'Aprobado', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  market_rejected: { label: 'Rechazado', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  market_archived: { label: 'Archivado', className: 'bg-muted text-muted-foreground' },
  market_edited: { label: 'Editado', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  market_updated_onchain: { label: 'Actualizado onchain', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  market_resolved_onchain: { label: 'Resuelto onchain', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  market_reported_onchain: { label: 'Reportado onchain', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  signal_updated: { label: 'Señal actualizada', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  rule_updated: { label: 'Regla actualizada', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  rule_created: { label: 'Regla creada', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  ingestion_started: { label: 'Ingesta iniciada', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  ingestion_completed: { label: 'Ingesta completada', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  ingestion_failed: { label: 'Ingesta fallida', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  generation_started: { label: 'Generación iniciada', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  generation_completed: { label: 'Generación completada', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  review_started: { label: 'Revisión iniciada', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  review_completed: { label: 'Revisión completada', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  generation_prompt_updated: { label: 'Prompt generación', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  chat_prompt_updated: { label: 'Prompt chat', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  resolution_flagged: { label: 'Resolución sugerida', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  resolution_emergency: { label: 'Emergencia resolución', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  resolution_unclear: { label: 'Resolución parcial', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  resolution_confirmed: { label: 'Resolución confirmada', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  resolution_dismissed: { label: 'Resolución descartada', className: 'bg-muted text-muted-foreground' },
  resolution_check_started: { label: 'Check resolución', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  market_ownership_transferred: { label: 'Ownership transferido', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  market_liquidity_withdrawn: { label: 'Liquidez retirada', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  market_ownership_returned: { label: 'Ownership devuelto', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function CollapsibleList({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger onClick={(e) => e.stopPropagation()} className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
        {open ? '\u25BC' : '\u25B6'} {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ContentView({ action, detail }: { action: string; detail: Record<string, unknown> }) {
  if (action === 'ingestion_completed') {
    const signalsBySource = detail.signalsBySource as Record<string, number> | undefined;
    const signalsList = detail.signals as { source: string; text: string; url?: string | null }[] | undefined;
    const topicsList = detail.topics as { id: string; name: string; slug: string }[] | undefined;
    return (
      <div className="space-y-1">
        <p className="text-sm text-foreground">{detail.signalsCount as number} señales · {detail.topicCount as number} temas actualizados</p>
        {signalsBySource && (
          <div className="flex gap-2 flex-wrap">
            {Object.entries(signalsBySource).map(([source, count]) => (
              <Badge key={source} variant="secondary" className="text-[10px]">
                {source}: {count}
              </Badge>
            ))}
          </div>
        )}
        {topicsList && topicsList.length > 0 && (
          <CollapsibleList label={`${topicsList.length} temas`}>
            <div className="space-y-0.5">
              {topicsList.map((t) => (
                <Link key={t.id} href={`/dashboard/topics/${t.slug}`} onClick={(e) => e.stopPropagation()} className="block text-[11px] text-blue-600 dark:text-blue-400 hover:underline truncate">
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
                <p key={i} className="text-[11px] text-muted-foreground">
                  <span className="text-muted-foreground/60">[{s.source}]</span>{' '}
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 dark:text-blue-400 hover:underline">{s.text}</a>
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
        <p className="text-sm text-foreground">{actionLabel}</p>
        {typeof detail.description === 'string' && <p className="text-xs text-muted-foreground">Consulta: {detail.description}</p>}
        {signalsList && signalsList.length > 0 && (
          <CollapsibleList label={`${signalsList.length} señales encontradas`}>
            <div className="space-y-0.5">
              {signalsList.map((s, i) => (
                <p key={i} className="text-[11px] text-muted-foreground">
                  <span className="text-muted-foreground/60">[{s.source}]</span>{' '}
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-600 dark:text-blue-400 hover:underline">{s.text}</a>
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
        {suggestedOutcome && <p className="text-sm text-foreground">Resultado sugerido: <strong>{suggestedOutcome}</strong></p>}
        {confidence && (
          <Badge className={cn(
            confidence === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
            confidence === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
            'bg-muted text-muted-foreground'
          )}>
            {confidence === 'high' ? 'Alta confianza' : confidence === 'medium' ? 'Confianza media' : 'Baja confianza'}
          </Badge>
        )}
        {typeof detail.isEmergency === 'boolean' && detail.isEmergency && typeof detail.emergencyReason === 'string' && (
          <p className="text-sm text-destructive">{detail.emergencyReason}</p>
        )}
      </div>
    );
  }

  if (action === 'resolution_confirmed') {
    const outcome = detail.outcome as string | undefined;
    const confidence = detail.confidence as string | undefined;
    return (
      <div className="space-y-1">
        {outcome && <p className="text-sm text-foreground">Resultado: <strong>{outcome}</strong></p>}
        {confidence && <p className="text-xs text-muted-foreground">Confianza: {confidence}</p>}
        {typeof detail.evidence === 'string' && <p className="text-xs text-muted-foreground"><CitedText>{detail.evidence}</CitedText></p>}
      </div>
    );
  }

  if (action === 'resolution_dismissed') {
    const suggestedOutcome = detail.suggestedOutcome as string | undefined;
    const confidence = detail.confidence as string | undefined;
    return (
      <div className="space-y-1">
        {suggestedOutcome && <p className="text-sm text-foreground">Se descartó: <strong>{suggestedOutcome}</strong> ({confidence ?? '?'})</p>}
        {typeof detail.evidence === 'string' && <p className="text-xs text-muted-foreground"><CitedText>{detail.evidence}</CitedText></p>}
      </div>
    );
  }

  if (action === 'ingestion_failed') {
    return <p className="text-sm text-destructive">{detail.error as string}</p>;
  }

  if (action === 'generation_started') {
    const marketType = detail.marketType as string | undefined;
    const instruction = detail.instruction as string | undefined;
    return (
      <div className="space-y-1">
        {instruction && <p className="text-sm text-foreground">{instruction}</p>}
        {marketType && (
          <Badge className={cn(
            marketType === 'multi-outcome' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
          )}>
            {marketType === 'multi-outcome' ? 'Multi-opción' : 'Binario'}
          </Badge>
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
          <p className="text-sm text-foreground">{detail.candidateCount as number} mercados generados · {detail.duplicatesRemoved as number} duplicados eliminados</p>
        )}
        {topicNames && topicNames.length > 0 && (
          <p className="text-[11px] text-muted-foreground">Temas: {topicNames.join(', ')}</p>
        )}
        {savedMarkets && savedMarkets.length > 0 && (
          <div className="space-y-0.5">
            {savedMarkets.map((m) => (
              <Link key={m.id} href={`/dashboard/markets/${m.id}`} className="block text-blue-600 dark:text-blue-400 hover:underline truncate text-xs">
                {m.title}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (action === 'signals_linked') {
    return <p className="text-sm text-foreground">{detail.linked as number} señal(es) vinculada(s) · Total: {detail.total as number}</p>;
  }

  if (action === 'topics_merged') {
    return <p className="text-sm text-foreground">{(detail.sourceTopicIds as string[])?.length ?? 0} temas fusionados · {detail.totalSignals as number} señales totales</p>;
  }

  if (action === 'feedback_saved' || action === 'global_feedback_added') {
    const text = (detail.feedback ?? detail.text) as string;
    return <p className="text-sm text-foreground">{text}</p>;
  }

  if (action === 'topic_dismissed') {
    const reason = detail.reason as string | undefined;
    if (!reason) return null;
    return <p className="text-sm text-foreground">{reason}</p>;
  }

  if (action === 'topic_rescored') {
    return <p className="text-sm text-foreground">Score: {(detail.score as number)?.toFixed(1)} — {detail.reason as string}</p>;
  }

  if (action === 'market_rejected' && detail.reason) {
    return <p className="text-sm text-foreground">{detail.reason as string}</p>;
  }

  if (action === 'topic_updated' || action === 'market_updated' || action === 'signal_updated') {
    const entries = Object.entries(detail).filter(([k]) => k !== 'updatedAt');
    if (entries.length === 0) return null;
    return (
      <div className="space-y-0.5">
        {entries.map(([k, v]) => (
          <p key={k} className="text-sm text-foreground"><span className="text-muted-foreground">{k}:</span> {typeof v === 'string' ? v.slice(0, 100) : JSON.stringify(v)}</p>
        ))}
      </div>
    );
  }

  const entries = Object.entries(detail);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {entries.map(([k, v]) => (
        <p key={k} className="text-sm text-foreground"><span className="text-muted-foreground">{k}:</span> {typeof v === 'string' ? v.slice(0, 100) : JSON.stringify(v)}</p>
      ))}
    </div>
  );
}

function getEntityInfo(entry: ActivityEntry): { label: string | null; url: string | null; usedBy: string } {
  const { action, detail, entityLabel, entityId, entityType } = entry;

  if (action === 'global_feedback_added') {
    const text = (detail?.text ?? detail?.feedback) as string | undefined;
    const firstLine = text ? (text.length > 80 ? text.slice(0, 80) + '...' : text) : entityLabel;
    return { label: firstLine, url: null, usedBy: 'generador, revisor, extractor' };
  }
  if (action === 'feedback_saved') {
    const contextLabel = (detail?.contextLabel as string) ?? entityLabel;
    const contextUrl = (detail?.contextUrl as string) ?? null;
    const feedbackEntityType = (detail?.entityType as string) ?? entityType;
    const usedBy = feedbackEntityType === 'topic' ? 'extractor, generador' : 'revisor';
    return { label: contextLabel, url: contextUrl, usedBy };
  }
  if (action === 'topic_dismissed') {
    const contextLabel = (detail?.contextLabel as string) ?? entityLabel;
    const contextUrl = (detail?.contextUrl as string) ?? null;
    return { label: contextLabel, url: contextUrl, usedBy: 'extractor, generador' };
  }
  if (action === 'generation_started') {
    const topicNames = detail?.topicNames as string[] | undefined;
    const label = topicNames?.join(', ') ?? entityLabel;
    return { label, url: null, usedBy: 'generador' };
  }
  if (action === 'generation_completed') {
    if (entityType === 'market' && entityId) {
      return { label: entityLabel, url: `/dashboard/markets/${entityId}`, usedBy: 'generador' };
    }
    const savedMarkets = detail?.savedMarkets as { id: string; title: string }[] | undefined;
    if (savedMarkets && savedMarkets.length > 0) {
      const suffix = savedMarkets.length > 1 ? ` (+${savedMarkets.length - 1})` : '';
      return { label: savedMarkets[0].title + suffix, url: `/dashboard/markets/${savedMarkets[0].id}`, usedBy: 'generador' };
    }
    return { label: null, url: null, usedBy: 'generador' };
  }
  if (action === 'review_started') {
    return { label: entityLabel, url: entityId ? `/dashboard/markets/${entityId}` : null, usedBy: 'revisor' };
  }
  if (entityType === 'market' && entityId) {
    return { label: entityLabel, url: `/dashboard/markets/${entityId}`, usedBy: 'revisor' };
  }
  if (action === 'ingestion_completed') {
    return { label: entityLabel, url: '/dashboard/signals', usedBy: 'pipeline' };
  }
  if (entityType === 'topic' && entityId) {
    const topicSlug = detail?.topicSlug as string | undefined;
    const derivedSlug = !topicSlug && entityLabel
      ? entityLabel.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
      : null;
    const slug = topicSlug ?? derivedSlug;
    const url = slug ? `/dashboard/topics/${slug}` : null;
    return { label: entityLabel, url, usedBy: 'extractor, generador' };
  }
  return { label: entityLabel, url: null, usedBy: entry.source };
}

function getPreviewText(action: string, detail: Record<string, unknown>): string | null {
  if (action === 'feedback_saved' || action === 'global_feedback_added') {
    const text = (detail.feedback ?? detail.text) as string | undefined;
    return text ? (text.length > 80 ? text.slice(0, 80) + '...' : text) : null;
  }
  if (action === 'topic_dismissed') {
    const reason = detail.reason as string | undefined;
    return reason ? (reason.length > 80 ? reason.slice(0, 80) + '...' : reason) : null;
  }
  if (action === 'topic_rescored') {
    return `Score: ${((detail.score as number) ?? 0).toFixed(1)}`;
  }
  if (action === 'market_rejected' && detail.reason) {
    const reason = detail.reason as string;
    return reason.length > 80 ? reason.slice(0, 80) + '...' : reason;
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
    const desc = detail.description as string | undefined;
    return desc
      ? `${label} · ${desc.length > 60 ? desc.slice(0, 60) + '...' : desc}`
      : `${label} · ${detail.signalCount ?? 0} señales`;
  }
  if (action === 'topic_research_started') {
    const desc = detail.description as string | undefined;
    return desc ? (desc.length > 80 ? desc.slice(0, 80) + '...' : desc) : null;
  }
  if (action === 'ingestion_completed') {
    const topicsList = detail.topics as { name: string }[] | undefined;
    if (topicsList && topicsList.length > 0) {
      const names = topicsList.slice(0, 3).map((t) => t.name).join(', ');
      return `${detail.signalsCount ?? 0} señales -> ${names}${topicsList.length > 3 ? ` (+${topicsList.length - 3})` : ''}`;
    }
    return `${detail.signalsCount ?? 0} señales · ${detail.topicCount ?? 0} temas`;
  }
  if (action === 'review_completed') {
    const result = detail.result as string | undefined;
    const label = result === 'opened' ? 'Aprobado' : result === 'rejected' ? 'Rechazado' : result ?? '?';
    const score = detail.score as number | undefined;
    return score != null ? `${label} · Score: ${score.toFixed(1)}` : label;
  }
  if (action === 'generation_completed' && detail.candidateCount != null) {
    return `${detail.candidateCount} mercados generados`;
  }
  if (action === 'generation_started' && detail.instruction) {
    const instr = detail.instruction as string;
    return instr.length > 80 ? instr.slice(0, 80) + '...' : instr;
  }
  if (action === 'market_liquidity_withdrawn') {
    const amount = detail.amount as string | undefined;
    return amount ? `$${amount} retirados` : null;
  }
  if (action === 'market_ownership_transferred') {
    const amount = detail.amount as string | undefined;
    return amount ? `Balance: $${amount}` : null;
  }
  return null;
}

export function ActivityCard({ entry, defaultExpanded = false, compact = false }: {
  entry: ActivityEntry;
  defaultExpanded?: boolean;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const badge = ACTION_BADGE[entry.action] ?? { label: entry.action, className: 'bg-muted text-muted-foreground' };
  const { label, url, usedBy } = getEntityInfo(entry);
  const hasDetail = entry.detail && Object.keys(entry.detail).length > 0;

  return (
    <div className={cn(compact && 'text-xs', hasDetail && 'cursor-pointer')} onClick={() => hasDetail && setExpanded(!expanded)}>
      <div className="flex items-center gap-2 mb-1">
        <Badge className={badge.className}>
          {badge.label}
        </Badge>
        {label && (
          url ? (
            <Link href={url} onClick={(e) => e.stopPropagation()} className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate max-w-xs">{label}</Link>
          ) : (
            <span className="text-xs text-foreground truncate max-w-xs">{label}</span>
          )
        )}
        {hasDetail && <span className="text-[10px] text-muted-foreground/50 ml-auto shrink-0">{expanded ? '\u25B2' : '\u25BC'}</span>}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {formatTime(entry.createdAt)}
        {typeof entry.detail?.costUsd === 'number' && entry.detail.costUsd > 0 && (
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            {' · '}${entry.detail.costUsd < 0.01 ? '< 0.01' : (entry.detail.costUsd as number).toFixed(2)}
          </span>
        )}
        {' · '}Usado por: {usedBy}
        {typeof entry.detail?.inngestRunUrl === 'string' && (
          <span>
            {' · '}
            <a
              href={entry.detail.inngestRunUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-blue-500 dark:text-blue-400 hover:underline"
            >
              ver proceso
            </a>
          </span>
        )}
        {' · '}
        <Link
          href={`/dashboard/activity#entry-${entry.id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-blue-500 dark:text-blue-400 hover:underline"
        >
          ver en log
        </Link>
      </p>

      {hasDetail && (
        expanded ? (
          <div className="mt-1">
            <ContentView action={entry.action} detail={entry.detail!} />
          </div>
        ) : (
          (() => {
            const preview = getPreviewText(entry.action, entry.detail!);
            return preview ? <p className="text-xs text-muted-foreground mt-0.5 truncate">{preview}</p> : null;
          })()
        )
      )}
    </div>
  );
}
