export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/db/client';
import { topics, topicSignals, signals, activityLog } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { TopicActions } from './_components/TopicActions';
import { ActivityCard } from '@/app/_components/ActivityCard';

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  news: { label: 'Noticia', className: 'bg-blue-100 text-blue-700' },
  data: { label: 'Dato', className: 'bg-amber-100 text-amber-700' },
  social: { label: 'Social', className: 'bg-purple-100 text-purple-700' },
  event: { label: 'Evento', className: 'bg-green-100 text-green-700' },
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date);
}

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function TopicDetailPage({ params }: Props) {
  const { slug } = await params;

  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.slug, slug))
    .limit(1);

  if (!topic) notFound();

  const linkedSignals = await db
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

  const scoreColor = topic.score >= 7 ? 'bg-green-100 text-green-700' :
    topic.score >= 4 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500';

  const statusLabel = topic.status === 'active' ? 'Activo' :
    topic.status === 'regular' ? 'Recurrente' :
    topic.status === 'stale' ? 'Inactivo' : topic.status === 'used' ? 'Usado' : 'Descartado';

  const statusColor = topic.status === 'active' ? 'bg-green-100 text-green-600' :
    topic.status === 'regular' ? 'bg-blue-100 text-blue-600' :
    topic.status === 'stale' ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500';

  const feedbackEntries = (topic.feedback ?? []) as { text: string; createdAt: string }[];

  const activity = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.entityId, topic.id))
    .orderBy(desc(activityLog.createdAt))
    .limit(50);

  return (
    <div className="max-w-4xl">
        <Link href="/dashboard/topics" className="text-sm text-gray-500 hover:text-gray-900 mb-4 inline-block">
          &larr; Volver
        </Link>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{topic.name}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${scoreColor}`}>
                {topic.score.toFixed(1)}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
                {statusLabel}
              </span>
              <span className="text-xs text-gray-400">{topic.category}</span>
              <span className="text-xs text-gray-400">{linkedSignals.length} señales</span>
            </div>
          </div>
          <TopicActions topicId={topic.id} status={topic.status} />
        </div>

        {/* Summary */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-medium text-gray-500 mb-2">Resumen</h2>
          <p className="text-sm text-gray-700 leading-relaxed">{topic.summary}</p>
        </div>

        {/* Suggested angles */}
        {topic.suggestedAngles.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
            <h2 className="text-sm font-medium text-gray-500 mb-2">Ángulos sugeridos</h2>
            <ul className="space-y-1.5">
              {topic.suggestedAngles.map((angle, i) => (
                <li key={i} className="text-sm text-blue-600 flex items-start gap-2">
                  <span className="text-gray-300 mt-0.5">{'\u2192'}</span>
                  <span>{angle}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Feedback history */}
        {feedbackEntries.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
            <h2 className="text-sm font-medium text-gray-500 mb-2">Feedback</h2>
            <ul className="space-y-2">
              {feedbackEntries.map((f, i) => (
                <li key={i} className="text-sm text-gray-700">
                  <span className="text-gray-400 text-xs mr-2">
                    {new Intl.DateTimeFormat('es-AR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      timeZone: 'America/Argentina/Buenos_Aires',
                    }).format(new Date(f.createdAt))}
                  </span>
                  {f.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Linked signals */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-medium text-gray-500">Señales ({linkedSignals.length})</h2>
          </div>
          {linkedSignals.length === 0 ? (
            <div className="px-5 py-8 text-sm text-gray-400 text-center">Sin señales vinculadas</div>
          ) : (
            <div className="divide-y divide-gray-50">
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
                          <span className="text-xs text-gray-400">{s.source}</span>
                          <span className="text-[10px] text-gray-300">{formatDate(s.publishedAt)}</span>
                        </div>
                        <p className="text-sm text-gray-800 mt-0.5">
                          {s.url ? (
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">
                              {s.text}
                            </a>
                          ) : s.text}
                        </p>
                        {s.summary && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{s.summary}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Activity */}
        {activity.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 mt-6">
            <div className="px-5 py-3 border-b border-gray-100">
              <h2 className="text-sm font-medium text-gray-500">Actividad</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {activity.map((entry) => (
                <div key={entry.id} className="px-4 py-2.5">
                  <ActivityCard entry={{ ...entry, detail: entry.detail as Record<string, unknown> | null, createdAt: entry.createdAt.toISOString() }} />
                </div>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}
