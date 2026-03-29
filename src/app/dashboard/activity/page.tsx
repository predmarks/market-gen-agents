'use client';

import { useState, useEffect, useCallback } from 'react';
import { ActivityCard } from '../../_components/ActivityCard';
import type { ActivityEntry } from '../../_components/ActivityCard';

const FILTERS = ['all', 'topic', 'market', 'feedback', 'signal', 'rule', 'system'] as const;
const FILTER_LABELS: Record<string, string> = {
  all: 'Todos', topic: 'Tema', market: 'Mercado', feedback: 'Feedback', signal: 'Señal', rule: 'Regla', system: 'Sistema',
};
const FEEDBACK_ACTIONS = new Set(['feedback_saved', 'global_feedback_added']);

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  const fetchEntries = useCallback(async () => {
    const params = filter !== 'all' && filter !== 'feedback' ? `?entityType=${filter}` : '';
    try {
      const res = await fetch(`/api/activity${params}`);
      if (res.ok) {
        const data = await res.json();
        let results = data.entries ?? [];
        if (filter === 'feedback') {
          results = results.filter((e: ActivityEntry) => FEEDBACK_ACTIONS.has(e.action));
        }
        setEntries(results);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-4">Actividad</h1>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              filter === f
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {FILTER_LABELS[f] ?? f}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-gray-500">Cargando...</div>}

      {!loading && entries.length === 0 && (
        <div className="text-sm text-gray-500">No hay actividad registrada</div>
      )}

      {entries.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-50">
          {entries.map((entry) => (
            <div key={entry.id} id={`entry-${entry.id}`} className="px-4 py-2.5">
              <ActivityCard entry={entry} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
