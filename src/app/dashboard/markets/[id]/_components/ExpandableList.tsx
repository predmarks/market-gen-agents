'use client';

import { useState, Children, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function ExpandableList({ children, pageSize = 10 }: { children: ReactNode; pageSize?: number }) {
  const items = Children.toArray(children);
  const [visible, setVisible] = useState(pageSize);
  const remaining = items.length - visible;

  return (
    <>
      {items.slice(0, visible)}
      {remaining > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setVisible((v) => v + pageSize)}
          className="mt-3 text-muted-foreground"
        >
          Mostrar más ({remaining} restantes)
        </Button>
      )}
    </>
  );
}
