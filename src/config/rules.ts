export interface Rule {
  id: string;
  type: 'hard' | 'soft';
  description: string;
  check: string;
}

export const HARD_RULES: Rule[] = [
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
    description: 'Both Si and No must be plausible outcomes',
    check: `Evaluate whether both outcomes are genuinely possible. Flag if one
      outcome is >95% likely based on current data. CRITICAL: verify any
      numbers mentioned against current real-world data — do NOT trust
      the candidate's numbers at face value.`,
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
    description: 'Resolution must be binary and unambiguous',
    check: `Verify criteria define a clear binary boundary. Flag if there are
      scenarios where the outcome could be argued either way and no
      contingency clause covers them.`,
  },
  {
    id: 'H7',
    type: 'hard',
    description: 'Title must be a clear yes/no question in Spanish',
    check: 'Verify the title is a well-formed Spanish question answerable with Sí or No.',
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
];

export const SOFT_RULES: Rule[] = [
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
];

// Hard rules that cannot be fixed by rewriting — immediate rejection
export const UNFIXABLE_HARD_RULES = ['H4', 'H5', 'H8'] as const;
