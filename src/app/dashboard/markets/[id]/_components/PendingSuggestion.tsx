'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MarketSnapshot } from '@/db/types';
import { DiffTextAdded, DiffTextRemoved } from '@/app/_components/WordDiff';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  marketId: string;
  current: MarketSnapshot;
  suggestion: MarketSnapshot;
}

interface FieldDiff {
  key: string;
  label: string;
  current: string;
  suggested: string;
  isText: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Título',
  description: 'Descripción',
  resolutionCriteria: 'Criterios de resolución',
  resolutionSource: 'Fuente de resolución',
  contingencies: 'Contingencias',
  category: 'Categoría',
  tags: 'Tags',
  outcomes: 'Opciones',
  endTimestamp: 'Fecha de cierre',
  expectedResolutionDate: 'Fecha esperada de resolución',
  timingSafety: 'Timing safety',
};

const TEXT_FIELDS = new Set([
  'title', 'description', 'resolutionCriteria', 'resolutionSource', 'contingencies',
]);

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const parts = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

function stringify(key: string, value: unknown): string {
  if (key === 'endTimestamp' && typeof value === 'number') return formatTimestamp(value);
  if (Array.isArray(value)) return value.join(', ');
  return String(value ?? '');
}

function computeDiffs(current: MarketSnapshot, suggestion: MarketSnapshot): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const fields = Object.keys(FIELD_LABELS) as (keyof MarketSnapshot)[];

  for (const key of fields) {
    const c = current[key];
    const s = suggestion[key];
    if (JSON.stringify(c) !== JSON.stringify(s)) {
      diffs.push({
        key,
        label: FIELD_LABELS[key],
        current: stringify(key, c),
        suggested: stringify(key, s),
        isText: TEXT_FIELDS.has(key),
      });
    }
  }

  return diffs;
}

export function PendingSuggestion({ marketId, current, suggestion }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<'accept' | 'discard' | null>(null);
  const [isOpen, setIsOpen] = useState(true);

  const diffs = computeDiffs(current, suggestion);

  if (diffs.length === 0) return null;

  async function handleAccept() {
    setLoading('accept');
    try {
      await fetch(`/api/markets/${marketId}/suggestion`, { method: 'POST' });
      router.refresh();
    } catch {
      setLoading(null);
    }
  }

  async function handleDiscard() {
    setLoading('discard');
    try {
      await fetch(`/api/markets/${marketId}/suggestion`, { method: 'DELETE' });
      router.refresh();
    } catch {
      setLoading(null);
    }
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-4 rounded-md border border-indigo-200 bg-indigo-50/30 dark:border-indigo-800 dark:bg-indigo-950/30">
      <div className="flex items-center justify-between px-4 py-3">
        <CollapsibleTrigger className="flex items-center gap-2 cursor-pointer">
          <ChevronRight className={cn('size-3 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
          <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">Sugerencia del pipeline</span>
          <span className="text-[10px] text-indigo-500 dark:text-indigo-400">{diffs.length} cambio{diffs.length !== 1 ? 's' : ''}</span>
        </CollapsibleTrigger>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDiscard}
            disabled={loading !== null}
          >
            {loading === 'discard' ? 'Descartando...' : 'Descartar'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAccept}
            disabled={loading !== null}
            className="border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-700 dark:text-indigo-300 dark:bg-indigo-950/50 dark:hover:bg-indigo-950"
          >
            {loading === 'accept' ? 'Aceptando...' : 'Aceptar'}
          </Button>
        </div>
      </div>

      <CollapsibleContent>
        <div className="px-4 pb-3 space-y-3">
          {diffs.map((d) => (
            <div key={d.key}>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{d.label}</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <div className="rounded bg-card border border-border px-2 py-1.5">
                  <span className="text-[10px] text-muted-foreground block mb-0.5">Actual</span>
                  {d.isText
                    ? <DiffTextRemoved a={d.current} b={d.suggested} />
                    : <span className="text-sm text-foreground">{d.current}</span>
                  }
                </div>
                <div className="rounded bg-card border border-indigo-100 dark:border-indigo-800 px-2 py-1.5">
                  <span className="text-[10px] text-indigo-400 dark:text-indigo-500 block mb-0.5">Sugerido</span>
                  {d.isText
                    ? <DiffTextAdded a={d.current} b={d.suggested} />
                    : <span className="text-sm text-foreground">{d.suggested}</span>
                  }
                </div>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
