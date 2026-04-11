'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';

interface EditableFieldProps {
  marketId: string;
  field: string;
  value: string;
  type?: 'text' | 'textarea' | 'datetime' | 'date';
  className?: string;
  displayValue?: string;
  renderMarkdown?: boolean;
}

export function EditableField({
  marketId,
  field,
  value,
  type = 'text',
  className = '',
  displayValue,
  renderMarkdown = false,
}: EditableFieldProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setCurrent(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ('select' in inputRef.current) inputRef.current.select();
    }
  }, [editing]);

  async function save() {
    if (current === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let payload: Record<string, unknown> = { [field]: current };
      if (field === 'endTimestamp') {
        payload = { endTimestamp: Math.floor(new Date(current).getTime() / 1000) };
      }
      const res = await fetch(`/api/markets/${marketId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setCurrent(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setCurrent(value);
      setEditing(false);
    }
    if (e.key === 'Enter' && type !== 'textarea') {
      save();
    }
  }

  if (!editing) {
    return (
      <div>
        {error && <p className="text-xs text-destructive mb-1">{error}</p>}
        <div
          onClick={() => { setError(null); setEditing(true); }}
          className={cn(
            'cursor-pointer hover:bg-yellow-50 dark:hover:bg-yellow-950/30 hover:outline hover:outline-1 hover:outline-yellow-300 dark:hover:outline-yellow-700 rounded px-0.5 -mx-0.5 transition-colors',
            className
          )}
          title="Click para editar"
        >
        {displayValue
          ? <span>{displayValue}</span>
          : current
            ? (renderMarkdown ? <Markdown>{current}</Markdown> : <span>{current}</span>)
            : <span className="text-muted-foreground italic">Sin contenido</span>
        }
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {type === 'textarea' ? (
        <Textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          disabled={saving}
          rows={4}
        />
      ) : (
        <Input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={type === 'datetime' ? 'datetime-local' : type}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          disabled={saving}
        />
      )}
    </div>
  );
}
