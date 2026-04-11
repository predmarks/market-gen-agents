'use client';

export type DiffSegment = { type: 'equal' | 'add' | 'remove'; text: string };

export function wordDiff(a: string, b: string): DiffSegment[] {
  const wordsA = a.split(/(\s+)/);
  const wordsB = b.split(/(\s+)/);

  const m = wordsA.length;
  const n = wordsB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = wordsA[i - 1] === wordsB[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const segments: DiffSegment[] = [];
  let i = m, j = n;
  const raw: DiffSegment[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsA[i - 1] === wordsB[j - 1]) {
      raw.push({ type: 'equal', text: wordsA[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: 'add', text: wordsB[j - 1] });
      j--;
    } else {
      raw.push({ type: 'remove', text: wordsA[i - 1] });
      i--;
    }
  }

  raw.reverse();

  for (const seg of raw) {
    const last = segments[segments.length - 1];
    if (last && last.type === seg.type) {
      last.text += seg.text;
    } else {
      segments.push({ ...seg });
    }
  }

  return segments;
}

export function DiffTextAdded({ a, b }: { a: string; b: string }) {
  const segments = wordDiff(a, b);
  return (
    <span className="text-sm leading-relaxed">
      {segments.map((seg, i) => {
        if (seg.type === 'equal') return <span key={i} className="text-foreground">{seg.text}</span>;
        if (seg.type === 'add') return <span key={i} className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">{seg.text}</span>;
        return null;
      })}
    </span>
  );
}

export function DiffTextRemoved({ a, b }: { a: string; b: string }) {
  const segments = wordDiff(a, b);
  return (
    <span className="text-sm leading-relaxed">
      {segments.map((seg, i) => {
        if (seg.type === 'equal') return <span key={i} className="text-foreground">{seg.text}</span>;
        if (seg.type === 'remove') return <span key={i} className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 line-through">{seg.text}</span>;
        return null;
      })}
    </span>
  );
}
