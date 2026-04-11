'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function TopicActions({ topicId, status }: { topicId: string; status: string }) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicIds: [topicId], count: 1 }),
      });
      router.push('/');
    } catch { /* ignore */ } finally {
      setGenerating(false);
    }
  }

  async function handleDismiss() {
    setDismissing(true);
    try {
      await fetch(`/api/topics/${topicId}/dismiss`, { method: 'POST' });
      router.push('/');
    } catch { /* ignore */ } finally {
      setDismissing(false);
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      {status === 'active' && (
        <Button
          onClick={handleGenerate}
          disabled={generating}
          size="sm"
        >
          {generating ? 'Generando...' : 'Generar mercado'}
        </Button>
      )}
      {(status === 'active' || status === 'stale') && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleDismiss}
          disabled={dismissing}
        >
          {dismissing ? '...' : 'Descartar'}
        </Button>
      )}
    </div>
  );
}
