'use client';

import ReactMarkdown from 'react-markdown';

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`prose dark:prose-invert prose-sm max-w-none prose-headings:text-sm prose-headings:font-semibold ${className ?? ''}`}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
