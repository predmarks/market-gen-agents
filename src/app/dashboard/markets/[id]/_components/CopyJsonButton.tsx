'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyJsonButton({ json }: { json: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      onClick={handleCopy}
      variant="outline"
      size="sm"
    >
      {copied ? 'Copiado' : 'Copiar JSON'}
    </Button>
  );
}
