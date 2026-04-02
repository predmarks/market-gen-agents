export interface Rule {
  id: string;
  type: 'hard' | 'soft';
  description: string;
  check: string;
}

// Default rules — used as fallback when DB is unavailable and for seeding
export const DEFAULT_HARD_RULES: Rule[] = [
  {
    id: 'H1',
    type: 'hard',
    description: 'Resolution criteria must cite a specific, verifiable, publicly accessible source',
    check: `Verify the named resolution source exists, is publicly accessible (not
      paywalled), and publishes the type of data referenced. If it's a government
      agency, verify it publishes the specific metric. Web-search the source URL
      to confirm it works.`,
  },
  {
    id: 'H2',
    type: 'hard',
    description: 'Market closing date must be between 7 days and 4 months from creation',
    check: 'Check that endTimestamp falls within 7-120 days from today.',
  },
  {
    id: 'H3',
    type: 'hard',
    description: 'All listed outcomes must be plausible',
    check: `Evaluate whether all outcomes are genuinely possible. Flag if any
      outcome is >95% likely or <1% likely based on current data. CRITICAL:
      verify any numbers mentioned against current real-world data — do NOT
      trust the candidate's numbers at face value.`,
  },
  {
    id: 'H4',
    type: 'hard',
    description: 'No markets on individual deaths, self-harm, or violence',
    check: 'Reject if resolution depends on someone dying, being harmed, or violence.',
  },
  {
    id: 'H5',
    type: 'hard',
    description: 'No markets that incentivize illegal activity',
    check: 'Reject if a trader could profit by causing the outcome.',
  },
  {
    id: 'H6',
    type: 'hard',
    description: 'Resolution must be unambiguous — exactly one outcome must match',
    check: `Verify criteria clearly map to exactly one outcome from the listed
      options. Flag if there are scenarios where multiple outcomes could match
      or no outcome matches and no contingency clause covers them.`,
  },
  {
    id: 'H7',
    type: 'hard',
    description: 'Title must be a clear question in Spanish appropriate for the outcome type',
    check: 'Verify the title is a well-formed Spanish question. Binary markets should be yes/no questions. Multi-outcome markets should clearly frame what is being predicted.',
  },
  {
    id: 'H8',
    type: 'hard',
    description: 'No exact duplicate of an existing open market',
    check: `Compare against currently open markets. Reject ONLY if there is already an
      open market asking the exact same question about the same specific event on
      the same date. This is strictly about duplicates, not similar markets.`,
  },
  {
    id: 'H9',
    type: 'hard',
    description: 'All numerical claims must be verified against current data',
    check: `Search for the CURRENT real-world value of every number mentioned
      (economic indicators, reserves, inflation, prices, poll numbers,
      statistics). Flag any discrepancy. This is critical — our previous
      system hallucinated numbers constantly.`,
  },
  {
    id: 'H11',
    type: 'hard',
    description: 'Multi-outcome markets must have 3-8 outcomes',
    check: `For non-binary markets: verify there are between 3 and 8 outcomes.
      Less than 3 means it should be binary (Si/No). More than 8 means
      low-probability options should be grouped into "Otro".
      Binary markets (exactly ["Si", "No"]) are exempt from this rule.`,
  },
  {
    id: 'H12',
    type: 'hard',
    description: 'Multi-outcome markets must include "Otro" unless outcomes are mathematically exhaustive',
    check: `For non-binary markets: verify "Otro" is included as an outcome UNLESS
      the outcomes are mathematically exhaustive (e.g., contiguous numeric ranges
      that cover all possibilities, or a complete set of known options).
      Binary markets are exempt from this rule.`,
  },
];

export const DEFAULT_SOFT_RULES: Rule[] = [
  {
    id: 'S1',
    type: 'soft',
    description: 'Prefer markets that resolve on a specific date vs. open-ended',
    check: 'Markets with specific resolution dates are safer for LMSR. Flag open-ended ones.',
  },
  {
    id: 'S2',
    type: 'soft',
    description: "Avoid markets dependent on a single individual's private decision",
    check: "Flag if resolution depends on one person's unannounced decision.",
  },
  {
    id: 'S3',
    type: 'soft',
    description: 'Avoid globally interesting topics already covered by Polymarket/Kalshi',
    check: `Flag if this market likely exists on international platforms, UNLESS
      it's extremely high-importance (presidential elections, World Cup final).
      Predmarks' niche is Argentina-specific markets.`,
  },
  {
    id: 'S4',
    type: 'soft',
    description: 'Prefer markets with probability swings that drive trading volume',
    check: `Score higher if the outcome is likely to shift based on ongoing events
      (negotiations, seasons, economic data) vs. one-shot events.`,
  },
  {
    id: 'S5',
    type: 'soft',
    description: 'Prefer controversial or debate-generating markets',
    check: 'Score higher if reasonable people would disagree on the outcome.',
  },
  {
    id: 'S6',
    type: 'soft',
    description: 'Avoid markets easily manipulable by few actors',
    check: 'Flag if a small group could influence the outcome and profit from it.',
  },
  {
    id: 'S7',
    type: 'soft',
    description: 'Penalize topic saturation for correlated categories',
    check: `Check if there are many open markets in the same category. For categories
      where markets are correlated (economics, politics), score down if there are
      already several open markets on similar indicators or themes. For categories
      where events are independent (sports, entertainment), multiple concurrent
      markets are fine and should NOT be penalized.`,
  },
  {
    id: 'S8',
    type: 'soft',
    description: 'At least 2 outcomes should have >10% probability; if one dominates >85%, suggest reformulating',
    check: `For multi-outcome markets, estimate rough probabilities. Flag if fewer
      than 2 outcomes have >10% probability, or if one outcome dominates with >85%.
      Suggest reformulating (e.g., grouping unlikely options or reframing the question).
      Binary markets are exempt from this rule.`,
  },
];

// Hard rules that cannot be fixed by rewriting — immediate rejection
export const UNFIXABLE_HARD_RULES = ['H4', 'H5', 'H8'] as const;

// Load rules from DB, fallback to hardcoded
export async function loadRules(): Promise<{ hard: Rule[]; soft: Rule[] }> {
  try {
    const { db } = await import('@/db/client');
    const { rules: rulesTable } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const rows = await db.select().from(rulesTable).where(eq(rulesTable.enabled, true));

    if (rows.length > 0) {
      return {
        hard: rows.filter((r) => r.type === 'hard').map((r) => ({ id: r.id, type: 'hard' as const, description: r.description, check: r.check })),
        soft: rows.filter((r) => r.type === 'soft').map((r) => ({ id: r.id, type: 'soft' as const, description: r.description, check: r.check })),
      };
    }
  } catch {
    // DB not available, use hardcoded
  }
  return { hard: DEFAULT_HARD_RULES, soft: DEFAULT_SOFT_RULES };
}
