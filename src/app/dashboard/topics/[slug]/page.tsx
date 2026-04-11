export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db/client';
import { topics, topicSignals, signals, activityLog, markets } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { TopicActions } from './_components/TopicActions';
import { ActivityCard } from '@/app/_components/ActivityCard';
import { getUserTimezone } from '@/lib/timezone';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  news: { label: 'Noticia', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  data: { label: 'Dato', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  social: { label: 'Social', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  event: { label: 'Evento', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
};

function formatDate(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(date);
}

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function TopicDetailPage({ params }: Props) {
  const tz = await getUserTimezone();
  const { slug } = await params;

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.slug, slug))
    .limit(1);

  if (!topic) notFound();

  const rawLinkedSignals = await db
    .select({
      id: signals.id,
      type: signals.type,
      text: signals.text,
      summary: signals.summary,
      url: signals.url,
      source: signals.source,
      category: signals.category,
      publishedAt: signals.publishedAt,
    })
    .from(topicSignals)
    .innerJoin(signals, eq(topicSignals.signalId, signals.id))
    .where(eq(topicSignals.topicId, topic.id))
    .orderBy(desc(signals.publishedAt));

  const seen = new Set<string>();
  const linkedSignals = rawLinkedSignals.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  // Related markets (linked via sourceContext.topicIds)
  const relatedMarkets = await db
    .select({ id: markets.id, title: markets.title, status: markets.status, category: markets.category })
    .from(markets)
    .where(sql`${markets.sourceContext}->'topicIds' @> ${JSON.stringify([topic.id])}::jsonb`)
    .orderBy(desc(markets.createdAt));

  const scoreColor = topic.score >= 7 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
    topic.score >= 4 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' : 'bg-muted text-muted-foreground';

  const statusLabel = topic.status === 'active' ? 'Activo' :
    topic.status === 'regular' ? 'Recurrente' :
    topic.status === 'stale' ? 'Inactivo' : topic.status === 'used' ? 'Usado' : 'Descartado';

  const statusColor = topic.status === 'active' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300' :
    topic.status === 'regular' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' :
    topic.status === 'stale' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300' : 'bg-muted text-muted-foreground';

  const feedbackEntries = (topic.feedback ?? []) as { text: string; createdAt: string }[];

  const activity = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.entityId, topic.id))
    .orderBy(desc(activityLog.createdAt))
    .limit(50);

  return (
    <div className="max-w-4xl mx-auto">
        <Link href="/dashboard/topics" className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">
          &larr; Volver
        </Link>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">{topic.name}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${scoreColor}`}>
                {topic.score.toFixed(1)}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
                {statusLabel}
              </span>
              <span className="text-xs text-muted-foreground/60">{topic.category}</span>
              <span className="text-xs text-muted-foreground/60">{linkedSignals.length} señales</span>
            </div>
          </div>
          <TopicActions topicId={topic.id} status={topic.status} />
        </div>

        {/* Summary */}
        <Card className="mb-6">
          <CardContent>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Resumen</h2>
            <p className="text-sm text-foreground/80 leading-relaxed">{topic.summary}</p>
          </CardContent>
        </Card>

        {/* Suggested angles */}
        {topic.suggestedAngles.length > 0 && (
          <Card className="mb-6">
            <CardContent>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">Ángulos sugeridos</h2>
              <ul className="space-y-1.5">
                {topic.suggestedAngles.map((angle, i) => (
                  <li key={i} className="text-sm text-blue-600 dark:text-blue-400 flex items-start gap-2">
                    <span className="text-muted-foreground/50 mt-0.5">{'\u2192'}</span>
                    <span>{angle}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Related markets */}
        {relatedMarkets.length > 0 && (
          <Card className="mb-6">
            <CardContent>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">Mercados ({relatedMarkets.length})</h2>
              <div className="space-y-1.5">
                {relatedMarkets.map((m) => {
                  const statusBadge =
                    m.status === 'open' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' :
                    m.status === 'closed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                    m.status === 'candidate' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
                    m.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                    'bg-muted text-muted-foreground';
                  return (
                    <div key={m.id} className="flex items-center gap-2">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusBadge}`}>
                        {m.status}
                      </span>
                      <Link href={`/dashboard/markets/${m.id}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate">
                        {m.title}
                      </Link>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Feedback history */}
        {feedbackEntries.length > 0 && (
          <Card className="mb-6">
            <CardContent>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">Feedback</h2>
              <ul className="space-y-2">
                {feedbackEntries.map((f, i) => (
                  <li key={i} className="text-sm text-foreground/80">
                    <span className="text-muted-foreground/60 text-xs mr-2">
                      {new Intl.DateTimeFormat('es-AR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                        timeZone: tz,
                      }).format(new Date(f.createdAt))}
                    </span>
                    {f.text}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Activity */}
        {activity.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="border-b">
              <CardTitle className="text-sm font-medium text-muted-foreground">Actividad</CardTitle>
            </CardHeader>
            <div className="divide-y divide-border">
              {activity.map((entry) => (
                <div key={entry.id} className="px-4 py-2.5">
                  <ActivityCard entry={{ ...entry, detail: entry.detail as Record<string, unknown> | null, createdAt: entry.createdAt.toISOString() }} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Linked signals */}
        <Card className="mt-6">
          <CardHeader className="border-b">
            <CardTitle className="text-sm font-medium text-muted-foreground">Señales ({linkedSignals.length})</CardTitle>
          </CardHeader>
          {linkedSignals.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted-foreground/60 text-center">Sin señales vinculadas</div>
          ) : (
            <div className="divide-y divide-border">
              {linkedSignals.map((s) => {
                const badge = TYPE_BADGE[s.type] ?? TYPE_BADGE.news;
                return (
                  <div key={s.id} className="px-5 py-3">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${badge.className}`}>
                        {badge.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground/60">{s.source}</span>
                          <span className="text-[10px] text-muted-foreground/50">{formatDate(s.publishedAt, tz)}</span>
                        </div>
                        <p className="text-sm text-foreground mt-0.5">
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline">
                              {s.text}
                            </a>
                          ) : s.text}
                        </p>
                        {s.summary && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.summary}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
    </div>
  );
}
