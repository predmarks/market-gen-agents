# Predmarks — agentic market pipeline architecture (v3 — final)

## Context

Predmarks is an Argentina-focused prediction market platform using LMSR as its automated market maker. Markets and resolution criteria are in **Spanish**. Supports both binary (`['Si', 'No']`) and multi-outcome markets — the LLM decides the appropriate outcome type. The current approach — feeding social media posts into an LLM wrapper — produces low-quality output with hallucinated data, made-up resolution criteria, and stale numbers. This system replaces that entirely.

### Critical constraint: LMSR and market timing

Because Predmarks uses LMSR, a market that is **open** but already **settled in the real world** creates free-money arbitrage. This is catastrophic.

> **Markets must not settle while open. Any possibility of this must score candidates down heavily.**

Design implications:
- Markets framed as "¿Ocurrirá X para la fecha Y?" where `endTimestamp` is BEFORE the result is known are ideal
- Open-ended markets ("¿Renunciará X?") are dangerous unless the closing window is very short
- Sports markets: close ~30 minutes after the event starts (result unknown until ~90+ min)
- Weather markets: close the day before the forecasted peak
- The Reviewer Agent treats timing risk as a near-hard-rule — high risk = heavy score penalty or rejection

### Market lifecycle

```
candidate → processing → candidate (reviewed)
                ↓                ↓
            cancelled      [deploy onchain]
                                ↓
                              open → in_resolution → closed
                                ↘ rejected
```

- `candidate`: awaiting review or reviewed and awaiting human decision
- `processing`: review pipeline running in Inngest
- `open`: deployed onchain, market is live (synced via `sync-deployed`)
- `in_resolution`: past `endTimestamp`, awaiting resolution confirmation
- `closed`: resolved onchain (`resolvedTo > 0`)
- `rejected`: pipeline rejected or human rejected
- `cancelled`: pipeline cancelled manually

Status transitions:
- **candidate → processing**: review pipeline starts (Inngest `market/candidate.created`)
- **processing → candidate**: review completes (market stays candidate with review data)
- **candidate → open**: market deployed onchain and synced
- **open → in_resolution**: `endTimestamp` passed but not yet resolved (set by `refresh` route)
- **open/in_resolution → closed**: `resolvedTo > 0` onchain (set by `refresh` route)
- **candidate → rejected**: human rejection or unfixable hard rule failure
- **processing → cancelled**: manual cancel via dashboard

No VOID state. Markets always resolve to one of their listed outcomes. Markets are never refunded or declared invalid.

### Topic lifecycle

```
active ← → researching
  ↓              ↓
stale        (back to active on complete/failure)
  ↓
dismissed
```

- `active`: primary status, eligible for market generation
- `regular`: standard topics qualifying for generation
- `researching`: undergoing web search research via `researchJob`
- `stale`: no new signals in extended period
- `dismissed`: editor dismissed, excluded from generation

Topics are created via `coalesceTopics()` (LLM clusters signals), then used by `generationJob` to produce market candidates. Each topic tracks `lastSignalAt` and `lastGeneratedAt` to determine freshness.

### Signal lifecycle

```
ingested → scored → linked to topics → marked as used
```

Signals don't have explicit status. Their lifecycle is:
1. **Ingested** via 4 source types: RSS news, BCRA/Ámbito APIs, HTML scraping, Twitter/X
2. **Scored** by LLM (0-10) on controversy, temporality, interest, measurability
3. **Linked** to topics during coalescence (via `topicSignals` junction table)
4. **Marked as used** (`usedInRun` FK) when processed in a sourcing run

### Deployment format (final output)

The system must produce markets in this exact format for deployment:

```typescript
interface DeployableMarket {
  name: string;          // "¿Vencerá River Plate a Vélez por la Fecha 6?"
  description: string;   // Resolution criteria, edge cases, source — all in one field
  category: string;      // "Deportes", "Política", "Economía", "Entretenimiento", "Clima", "Otros"
  outcomes: string[];    // ['Si', 'No'] for binary, or multiple outcomes
  endTimestamp: number;  // Unix timestamp (seconds) — when market stops accepting bets
}
```

**Example (sports — with rescheduling, cancellation, and postponement handling):**
```typescript
{
  name: '¿Racing vence a Sarmiento el Martes 10 de Marzo?',
  description: 'Este mercado se resolverá como "Sí" si Racing Club gana a Sarmiento en tiempo reglamentario (90 minutos más adición) el Martes 10 de Marzo de 2026 (Fecha 10 Torneo Apertura). Se resolverá como "No" si Racing empata o pierde. Si el partido se reprograma a una fecha anterior a la prevista, el mercado se cerrará anticipadamente antes del inicio del partido y se resolverá según el resultado en la nueva fecha. Si se posterga a una fecha posterior al cierre del mercado, o se cancela o suspende, se resolverá como "No". Un cambio de horario dentro del mismo día no afecta al mercado. Predmarks se reserva el derecho de modificar la fecha de cierre del mercado ante cambios en la programación del evento. Fuente de resolución: resultados oficiales publicados por la Liga Profesional de Fútbol (www.ligaprofesional.ar).',
  category: 'Deportes',
  outcomes: ['Si', 'No'],
  endTimestamp: Math.floor(new Date(Date.UTC(2026, 2, 11, 1, 30, 0)).getTime() / 1000),
  // 10/03/2026 22:30 ART = 11/03/2026 01:30 UTC (30 min after kickoff)
}
```

**Example (economy — period-based framing for lagged data):**
```typescript
{
  name: '¿Superarán las Reservas Internacionales del BCRA los USD 47.400M al cierre de febrero 2026?',
  description: 'Este mercado se resolverá como "Sí" si las Reservas Internacionales del BCRA superan USD 47.400 millones al último día hábil de febrero de 2026, según lo publique el Informe Monetario Diario del BCRA. Este dato se publica habitualmente con un rezago de varios días hábiles posteriores al cierre del mercado. Se resolverá como "No" si el valor es igual o inferior a USD 47.400M. En caso de revisión posterior de los datos, se utilizará el dato publicado originalmente (primera publicación). Fuente de resolución: BCRA Informe Monetario Diario, sección Reservas Internacionales (www.bcra.gob.ar).',
  category: 'Economía',
  outcomes: ['Si', 'No'],
  endTimestamp: Math.floor(new Date(Date.UTC(2026, 1, 28, 23, 0, 0)).getTime() / 1000),
  // Market closes Feb 28 at 20:00 ART. BCRA publishes Feb 28 data
  // around March 3-4. During the market's life, daily publications
  // (showing data from ~3 days ago) move probability but none
  // definitively settle it because Feb isn't over yet.
}
```

**Example (economy — day-before close for daily data):**
```typescript
{
  name: '¿El dólar blue cierra por debajo de $1400 el Viernes 13 de Marzo?',
  description: 'Este mercado se resolverá como "Sí" si el precio de venta del dólar blue cierra en menos de $1,400.00 el Viernes 13 de Marzo de 2026, según la cotización de venta publicada por Ámbito Financiero. El mercado se resolverá como "No" si iguala o supera ese valor al cierre. Fuente de resolución: Cotizaciones diarias publicadas en Ámbito Financiero (www.ambito.com/dolar).',
  category: 'Economía',
  outcomes: ['Si', 'No'],
  endTimestamp: Math.floor(new Date(Date.UTC(2026, 2, 13, 0, 0, 0)).getTime() / 1000),
  // Closes Thursday night (12/03 21:00 ART = 13/03 00:00 UTC).
  // Friday's closing rate is published Friday afternoon/evening.
  // Market was already closed — no free money.
}
```

**Example (weather — single-day, not range):**
```typescript
{
  name: '¿La temperatura mínima en CABA baja de 19°C el viernes 14 de marzo?',
  description: 'Este mercado se resolverá como "Sí" si la temperatura mínima oficial de la estación Observatorio Central Buenos Aires es inferior a 19°C el viernes 14 de Marzo de 2026. Se resolverá como "No" si la mínima alcanza o supera 19°C. Fuente de resolución: timeanddate.com, sección "Clima histórico" para Buenos Aires (https://www.timeanddate.com/weather/argentina/buenos-aires/historic).',
  category: 'Clima',
  outcomes: ['Si', 'No'],
  endTimestamp: Math.floor(new Date(Date.UTC(2026, 2, 13, 23, 0, 0)).getTime() / 1000),
  // Closes Thursday night (13/03 20:00 ART). Friday's min temp
  // is recorded overnight/morning and published later on timeanddate.com.
  // NEVER use multi-day ranges — YES can settle on day 1 while market
  // stays open.
}
```

**Example (politics):**
```typescript
{
  name: '¿El Congreso sancionará el proyecto de Régimen Penal Juvenil antes de que terminen las sesiones extraordinarias (28/12)?',
  description: 'Este mercado se resolverá como "Sí" si el Senado de la Nación Argentina aprueba el proyecto de Régimen Penal Juvenil sin modificaciones mediante votación afirmativa formal en el recinto antes de la finalización del período de sesiones extraordinarias (28 de Febrero). Se resolverá como "No" si el proyecto no es aprobado antes de ese momento; es rechazado; es aprobado pero con modificaciones, por lo que vuelve a su cámara de origen (Diputados) sin ser sancionado; no se trata en el recinto; la sesión pasa a cuarto intermedio y la votación definitiva ocurre fuera del plazo indicado. Fuente de resolución: https://www.senado.gob.ar/',
  category: 'Política',
  outcomes: ['Si', 'No'],
  endTimestamp: Math.floor(new Date(Date.UTC(2026, 1, 26, 11, 0, 0)).getTime() / 1000),
  // NOTE: This is an open-ended "before X" market. The vote could
  // happen any day while the market is open. Only deploy if
  // exceptionally newsworthy. See open-ended market policy.
}
```

---

## Internal data model

Internally, markets use a richer schema with separate fields. The `description` field is merged on export.

```typescript
interface Market {
  id: string;
  status: 'candidate' | 'processing' | 'open' | 'in_resolution' | 'closed' | 'rejected' | 'cancelled';

  // Core content (Spanish) — kept separate for agent validation
  title: string;                    // Maps to `name` on export
  description: string;              // Context and background
  resolutionCriteria: string;       // "Se resolverá como Sí si..."
  resolutionSource: string;         // Name + URL of the source
  contingencies: string;            // Edge case handling
  category: MarketCategory;
  tags: string[];
  outcomes: string[];               // ['Si', 'No'] for binary, or multiple outcomes

  // Timing
  endTimestamp: number;             // Unix seconds — when market closes
  expectedResolutionDate?: string;  // When the real-world event is expected to settle
  timingSafety: 'safe' | 'caution' | 'dangerous';

  // Lifecycle timestamps
  createdAt: Date;
  publishedAt?: Date;
  closedAt?: Date;
  resolvedAt?: Date;
  outcome?: string;                 // The winning outcome

  // Sourcing metadata
  sourceContext: {
    originType: 'news' | 'social' | 'event_calendar' | 'trending' | 'data_api' | 'manual';
    originUrl?: string;
    originText?: string;
    generatedAt: string;
    topicIds?: string[];            // Linked topic IDs
    topicNames?: string[];          // Linked topic names
  };

  // Review results (latest iteration)
  review?: ReviewResult;

  // Full iteration history
  iterations?: Iteration[];

  // Resolution tracking
  resolution?: {
    evidence: string;
    evidenceUrls: string[];
    confidence: 'high' | 'medium' | 'low';
    suggestedOutcome: string;
    flaggedAt: string;
    confirmedBy?: string;
    confirmedAt?: string;
    resolvedOnchainAt?: string;
    reporterPending?: boolean;
    withdrawal?: WithdrawalProgress;
    checkingAt?: string;            // Set while resolution check is running
  };

  // Onchain fields (synced from blockchain)
  onchainId?: string;
  onchainAddress?: string;
  volume?: string;
  participants?: number;
  pendingBalance?: string;
  chainId: number;                  // 8453 (Base mainnet) or 84532 (Base Sepolia)

  isArchived?: boolean;
}

// Iteration tracks each review cycle
interface Iteration {
  version: number;
  market: MarketSnapshot;           // Snapshot of market at this iteration
  review: ReviewResult;
  feedback?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

type MarketCategory = 'Política' | 'Economía' | 'Deportes' | 'Entretenimiento' | 'Clima' | 'Otros';
// Note: "Sociedad" topics (strikes, social events) fold into "Política"

interface ReviewScores {
  ambiguity: number;          // 0-10 (weight: 35%)
  timingSafety: number;       // 0-10 (weight: 25%)
  timeliness: number;         // 0-10 (weight: 20%)
  volumePotential: number;    // 0-10 (weight: 20%)
  overallScore: number;
}

interface RuleResult {
  ruleId: string;
  passed: boolean;
  explanation: string;
}

interface DataVerification {
  claim: string;
  currentValue: string;
  source: string;
  sourceUrl?: string;
  isAccurate: boolean;
  severity: 'critical' | 'minor';
}

interface ReviewResult {
  scores: ReviewScores;
  hardRuleResults: RuleResult[];
  softRuleResults: RuleResult[];
  dataVerification: DataVerification[];
  resolutionSourceCheck?: ResolutionSourceCheck;
  recommendation: 'publish' | 'rewrite_then_publish' | 'hold' | 'reject';
  reviewedAt: string;
}
```

### Export function

```typescript
function toDeployableMarket(market: Market): DeployableMarket {
  // Merge description, resolution criteria, contingencies, and source
  // into one description field matching the deployment format
  const descriptionParts = [
    market.resolutionCriteria,
    market.contingencies,
    `Fuente de resolución: ${market.resolutionSource}`,
  ].filter(Boolean);

  // Prepend context description if present
  const fullDescription = market.description
    ? `${market.description} ${descriptionParts.join(' ')}`
    : descriptionParts.join(' ');

  return {
    name: market.title,
    description: fullDescription,
    category: market.category,
    outcomes: ['Si', 'No'],
    endTimestamp: market.endTimestamp,
  };
}
```

---

## Market rules (`config/rules.ts` + `rules` table)

Rules are DB-backed and editable from the dashboard (`/dashboard/rules`) and MiniChat. Hardcoded defaults in `config/rules.ts` serve as fallback when DB is unavailable. `loadRules()` loads from DB first, falls back to defaults.

### Hard rules (auto-reject if violated)

```typescript
export const HARD_RULES: Rule[] = [
  {
    id: 'H1',
    type: 'hard',
    description: 'Resolution criteria must cite a specific, verifiable, publicly accessible source',
    check: `Verify the named resolution source exists, is publicly accessible (not
      paywalled), and publishes the type of data referenced. If it's a government
      agency, verify it publishes the specific metric. Web-search the source URL
      to confirm it works.`
  },
  {
    id: 'H2',
    type: 'hard',
    description: 'Market closing date must be between 7 days and 4 months from creation',
    check: 'Check that endTimestamp falls within 7-120 days from today.'
  },
  {
    id: 'H3',
    type: 'hard',
    description: 'All listed outcomes must be plausible',
    check: `Evaluate whether all outcomes are genuinely possible. Flag if one
      outcome is >95% likely based on current data. CRITICAL: verify any
      numbers mentioned against current real-world data — do NOT trust
      the candidate's numbers at face value.`
  },
  {
    id: 'H4',
    type: 'hard',
    description: 'No markets on individual deaths, self-harm, or violence',
    check: 'Reject if resolution depends on someone dying, being harmed, or violence.'
  },
  {
    id: 'H5',
    type: 'hard',
    description: 'No markets that incentivize illegal activity',
    check: 'Reject if a trader could profit by causing the outcome.'
  },
  {
    id: 'H6',
    type: 'hard',
    description: 'Resolution must be binary and unambiguous',
    check: `Verify criteria define a clear binary boundary. Flag if there are
      scenarios where the outcome could be argued either way and no
      contingency clause covers them.`
  },
  {
    id: 'H7',
    type: 'hard',
    description: 'Title must be a clear yes/no question in Spanish',
    check: 'Verify the title is a well-formed Spanish question answerable with Sí or No.'
  },
  {
    id: 'H8',
    type: 'hard',
    description: 'No duplicate or near-duplicate of an existing open market',
    check: 'Compare against currently open markets. Reject if substantially similar.'
  },
  {
    id: 'H9',
    type: 'hard',
    description: 'All numerical claims must be verified against current data',
    check: `Search for the CURRENT real-world value of every number mentioned
      (economic indicators, reserves, inflation, prices, poll numbers,
      statistics). Flag any discrepancy. This is critical — our previous
      system hallucinated numbers constantly.`
  },
  {
    id: 'H11',
    type: 'hard',
    description: 'Multi-outcome markets must have 3-8 outcomes',
    check: `For non-binary markets: verify there are between 3 and 8 outcomes.
      Less than 3 means it should be binary (Si/No). More than 8 means
      low-probability options should be grouped into "Otro".
      Binary markets (exactly ["Si", "No"]) are exempt.`
  },
  {
    id: 'H12',
    type: 'hard',
    description: 'Multi-outcome markets must include "Otro" unless outcomes are mathematically exhaustive',
    check: `For non-binary markets: verify "Otro" is included UNLESS the outcomes
      are mathematically exhaustive (e.g., contiguous numeric ranges).
      Binary markets are exempt.`
  },
];
```

### Timing safety (scored, not hard-reject — but scored HEAVILY)

Timing is scored as part of the review, not as a hard rule, because the appropriate closing strategy varies by category. However, a `timingSafety` score below 4 should effectively prevent publication.

**Timing patterns by category:**

| Category | Safe pattern | endTimestamp strategy |
|----------|-------------|---------------------|
| Deportes (partidos) | Close 30 min after kickoff | `kickoff + 30min`. Result unknown until ~90min. Resolution Checker monitors fixture changes — if match moves earlier, EMERGENCY for early closure. |
| Deportes (no-partido) | AVOID — see open-ended policy below | Personnel decisions, transfers, coaching changes are open-ended. Only deploy if exceptionally attractive. |
| Política | Close before vote/announcement | Day before expected event. If event moves earlier, early closure needed. |
| Economía (daily data) | Close the NIGHT BEFORE | Dólar blue, riesgo país, BCRA reserves: close Thursday night for Friday data. The data is published during Friday when the market is already closed. |
| Economía (monthly/lagged data) | Frame around a PERIOD | Close at end of the period (e.g., end of month). Actual data published days later due to lag. |
| Clima | Single-day predictions, close day before | "¿La mínima del viernes baja de X?" — close Thursday night. NEVER use multi-day ranges ("any day between X and Y") because the YES condition can be met on day 1 while the market stays open. |
| Entretenimiento | Close before event/announcement | Hours before or day before |

**Open-ended market policy ("¿Ocurrirá X antes de Y?"):**

Open-ended markets where the event can happen any day while the market is open
are inherently dangerous for LMSR. Real-world example: the "¿Será Coudet el DT
de River?" market was open for ~2 weeks, and the answer became known ~10 days
before close — creating free money.

Policy:
- **Default: AVOID.** The Reviewer should score `timingSafety` at 2-3 for these.
- **Exception:** If the market is exceptionally interesting/timely/attractive
  (high scores on timeliness + volumePotential), it CAN be deployed with:
  1. The shortest possible window (days, not weeks)
  2. Early closure as the safety net (Resolution Checker monitors aggressively)
  3. Description includes "Predmarks se reserva el derecho de modificar la
     fecha de cierre ante cambios en las circunstancias del evento"
  4. Accept the free money loss as customer acquisition cost at this stage
- **The Reviewer must flag the estimated exposure:** "If event settles on day 1,
  the market would be open for N more days at obvious odds. Estimated max
  exposure: [amount based on liquidity]."
- **Track these exceptions:** log every open-ended market deployed, whether
  it settled early, and the actual cost. This data tells you when you've
  outgrown the CAC strategy.

**Weather-specific guidance:**

WRONG: "¿La mínima baja de 19°C en algún día del 11 al 15 de marzo?"
- If temp drops below 19°C on March 11, the market resolves Sí but stays open until March 14. Free money for 3 days.

RIGHT: "¿La mínima del viernes 14 de marzo baja de 19°C?"
- Market closes Thursday night March 13. Temp is measured Friday.
  Result appears on timeanddate.com Saturday. Market was already closed.

For weather markets:
- Always use single-day predictions, never multi-day ranges
- Close the night before the predicted day
- Source: timeanddate.com, sección "Clima histórico" para Buenos Aires
  (https://www.timeanddate.com/weather/argentina/buenos-aires/historic)
- Always reference the same station for consistency across markets

### Soft rules (flag, don't auto-reject)

```typescript
export const SOFT_RULES: Rule[] = [
  {
    id: 'S1',
    description: 'Prefer markets that resolve on a specific date vs. open-ended',
    check: 'Markets with specific resolution dates are safer for LMSR. Flag open-ended ones.'
  },
  {
    id: 'S2',
    description: 'Avoid markets dependent on a single individual\'s private decision',
    check: 'Flag if resolution depends on one person\'s unannounced decision.'
  },
  {
    id: 'S3',
    description: 'Avoid globally interesting topics already covered by Polymarket/Kalshi',
    check: `Flag if this market likely exists on international platforms, UNLESS
      it's extremely high-importance (presidential elections, World Cup final).
      Predmarks' niche is Argentina-specific markets.`
  },
  {
    id: 'S4',
    description: 'Prefer markets with probability swings that drive trading volume',
    check: `Score higher if the outcome is likely to shift based on ongoing events
      (negotiations, seasons, economic data) vs. one-shot events.`
  },
  {
    id: 'S5',
    description: 'Prefer controversial or debate-generating markets',
    check: 'Score higher if reasonable people would disagree on the outcome.'
  },
  {
    id: 'S6',
    description: 'Avoid markets easily manipulable by few actors',
    check: 'Flag if a small group could influence the outcome and profit from it.'
  },
  {
    id: 'S7',
    description: 'Penalize topic saturation for correlated categories',
    check: `Check if there are many open markets in the same category. For correlated
      categories (economics, politics), score down if there are already several open
      markets on similar themes. Independent categories (sports, entertainment) are fine.`
  },
  {
    id: 'S8',
    description: 'At least 2 outcomes should have >10% probability; if one dominates >85%, suggest reformulating',
    check: `For multi-outcome markets, estimate rough probabilities. Flag if fewer
      than 2 outcomes have >10% probability, or if one dominates with >85%.
      Binary markets are exempt.`
  },
];
```

### Standard contingency clauses

**CRITICAL RULES:**
- Markets NEVER refund bets or declare results as "invalid"
- Markets ALWAYS resolve as "Sí" or "No", no exceptions
- If an event is cancelled, postponed indefinitely, or doesn't occur → resolves as "No"

Every market description should include applicable contingency clauses. These are derived from real edge cases encountered in production:

```typescript
export const CONTINGENCY_TEMPLATES = {

  // === LAGGED DATA (BCRA, INDEC, any source with publication delay) ===
  // CRITICAL: Government data sources publish with a lag. BCRA may report
  // Wednesday's reserves on Monday.
  //
  // WRONG APPROACH: "resolve based on last published value at closing time"
  // This is DANGEROUS because a new publication during open hours can
  // instantly settle the market, creating free money.
  //
  // CORRECT APPROACH: Frame the market around a PERIOD whose data won't
  // be published until AFTER the market closes. E.g., "reserves at end
  // of February" where the market closes Feb 28 and data is published
  // around March 3. During the market's life, daily publications move
  // probability, but none definitively settle it because the period
  // isn't over yet.
  lagged_data_period: (metric: string, period: string, source: string) =>
    `La resolución se basará en el valor de ${metric} correspondiente a ${period}, según lo publique ${source}. Este dato se publica habitualmente con un rezago de varios días hábiles posteriores al cierre del mercado.`,

  // === SOURCE UNAVAILABLE ===
  source_unavailable: (primary: string, alternative?: string) =>
    alternative
      ? `Si ${primary} no publica los datos en tiempo y forma, se utilizará ${alternative} como fuente alternativa, o el último dato publicado disponible.`
      : `Si ${primary} no publica los datos en tiempo y forma, se utilizará el último dato publicado disponible.`,

  // === HOLIDAYS / NON-BUSINESS DAYS ===
  holiday_fallback: (source: string) =>
    `Si la fecha de resolución cae en feriado o día no hábil y ${source} no publica, se utiliza el dato correspondiente al último día hábil del período.`,

  // === SPORTS: RESCHEDULING, CANCELLATION, POSTPONEMENT ===
  // Three scenarios, each handled differently:
  // 1. Match moved to EARLIER date → EMERGENCY: market must be closed
  //    early, then resolved normally based on the result
  // 2. Match moved to LATER date or cancelled → resolves "No"
  // 3. Same-day time change → no effect, market stays as-is
  //
  // NOTE: Early closure requires manual intervention (updating the
  // market's closing date). The Resolution Checker monitors fixture
  // changes and fires an EMERGENCY alert if a match is moved earlier.
  sports_rescheduling: (match: string) =>
    `Si ${match} se reprograma a una fecha anterior a la prevista, el mercado se cerrará anticipadamente antes del inicio del partido y se resolverá según el resultado en la nueva fecha. Si se posterga a una fecha posterior al cierre del mercado, o se cancela o suspende, se resolverá como "No". Un cambio de horario dentro del mismo día no afecta al mercado. Predmarks se reserva el derecho de modificar la fecha de cierre del mercado ante cambios en la programación del evento.`,

  // === SPORTS: REGULATION TIME ===
  regulation_time_only: () =>
    `Se considera únicamente el resultado en tiempo reglamentario (90 minutos más tiempo adicionado).`,

  // === EVENT CANCELLED (non-sports) ===
  event_cancelled: (event: string) =>
    `Si ${event} se cancela o pospone indefinidamente, el mercado se resolverá como "No".`,

  // === EVENT POSTPONED (non-sports) ===
  event_postponed: (event: string) =>
    `Si ${event} se pospone pero se reprograma dentro del período del mercado, se utilizará el resultado de la fecha reprogramada.`,

  // === EVENT RESCHEDULED EARLIER (non-sports) ===
  // Same LMSR risk as sports. If a political vote or announcement moves
  // earlier, the market must be closed early.
  event_rescheduled_earlier: (event: string) =>
    `Si ${event} se reprograma a una fecha anterior, el mercado se cerrará anticipadamente y se resolverá según el resultado. Predmarks se reserva el derecho de modificar la fecha de cierre del mercado ante cambios en la programación del evento.`,

  // === DATA REVISION ===
  // Use first published value, not later revisions (common with INDEC GDP, CPI)
  data_revision: () =>
    `En caso de revisión posterior de los datos, se utilizará el dato publicado originalmente (primera publicación).`,
};
```

**Which contingencies apply per category:**

| Category | Applicable contingencies |
|----------|-------------------------|
| Deportes (partidos) | `sports_rescheduling`, `regulation_time_only` |
| Deportes (no-partido: DT, transfers, etc.) | `event_cancelled`, `event_rescheduled_earlier` — treat as open-ended market, see policy above |
| Economía (daily: dólar, riesgo país) | `source_unavailable`, `holiday_fallback` |
| Economía (lagged: reservas, IPC) | `lagged_data_period`, `source_unavailable`, `holiday_fallback`, `data_revision` |
| Clima | `source_unavailable` — always single-day predictions, never ranges |
| Política | `event_cancelled`, `event_postponed`, `event_rescheduled_earlier` |
| Entretenimiento | `event_cancelled`, `event_postponed`, `event_rescheduled_earlier` |

---

## Data sources (Argentina-focused)

### News & publications

| Source | Type | Access |
|--------|------|--------|
| Clarín | News (general) | RSS |
| La Nación | News (politics, economy) | RSS |
| Infobae | Breaking news | RSS |
| El Cronista | Finance, markets, dollar | RSS |
| Olé | Sports | RSS |
| Ámbito Financiero | Dollar rates, economy | RSS |
| Chequeado | Fact-checking | RSS |

### X/Twitter accounts

Key accounts for Argentine news signals:
- Government: `@CasaRosada`, `@BancoCentral_AR`, `@INDECArgentina`
- News: `@claabornsn`, `@infabornsn`
- Finance: `@AmbitoFinanciero`, `@CronistaCom`
- Sports: `@abornsn` (Olé)
- Key journalists covering politics, economy

Access: X API v2 (Basic tier) or scraping library.

### Structured data APIs

| Source | Data | Access |
|--------|------|--------|
| BCRA API (bcra.gob.ar) | Reserves, dollar rates, monetary base | Public REST API |
| INDEC (indec.gob.ar) | CPI, GDP, employment (monthly reports) | Web scrape release schedule + PDFs |
| timeanddate.com | Weather forecasts, historical temps | Web scrape (primary weather source) |
| SMN (smn.gob.ar) | Weather data | Unreliable API — use as secondary verification only |
| Liga Profesional (ligaprofesional.ar) | Football fixtures, results | Web scrape |
| HCDN / Senado | Legislative agenda, votes | Web scrape |

### Event calendars

| Calendar | Events |
|----------|--------|
| INDEC release schedule | Monthly CPI, GDP, employment — known dates |
| BCRA calendar | Policy meetings, reserve reports |
| Liga Profesional calendar | Match fixtures, dates, times |
| Political calendar | Elections, legislative sessions |
| Entertainment calendar | Award shows, major events |

---

## Agent 1: Sourcer

### Purpose
Generate high-quality Argentine market candidates from local data sources, in Spanish.

### Architecture

```
Ingestion (news + data + Twitter)
  → Signal scoring (LLM rates 0-10)
    → Topic extraction (LLM clusters signals into topics)
      → Market generation (LLM converts topics into candidates)
        → Deduplication (embedding cosine similarity)
          → Save to DB as candidates
```

The pipeline is split into **two independent Inngest jobs** that can run separately:
1. **Ingestion job** — fetches signals, scores them, extracts/updates topics, marks stale topics. Runs on cron (Mon/Wed/Fri 9am) or manually.
2. **Generation job** — loads active topics, generates markets, deduplicates, saves candidates. Runs manually or after ingestion.

A third job, **suggest-topic**, lets the editor describe a topic; Claude researches it via web search, creates the topic, and generates markets from it.

Configurable `CANDIDATE_CAP` (currently 5 for development, target 50 for production).

### Ingestion layer

Four ingestion streams run in parallel, all persisted to the `signals` table (upsert by URL):

| Stream | File | Source | Signal type |
|--------|------|--------|-------------|
| News | `ingestion-news.ts` | RSS feeds (Clarín, La Nación, Infobae, Chequeado, etc.) | `news` |
| Economic data | `ingestion-data.ts` | BCRA API (reserves, official dollar, monetary base) + Ámbito Financiero (dólar blue, riesgo país) | `data` |
| Web scraping | `ingestion-scrape.ts` | HTML scraping via Cheerio (configurable targets) | `news` |
| Twitter/X trends | `ingestion-twitter.ts` | X API v2 trending topics (Argentina WOEID) | `social` |

Signal sources are **DB-backed** (`signalSources` table) with hardcoded fallback in `src/config/sources.ts`. Sources can be managed via the dashboard or MiniChat (`list/create/update_signal_source` tools). Each source has: name, type (rss/scrape/api/social), URL, category, enabled flag, and optional config JSONB.

```typescript
interface SourceSignal {
  type: 'news' | 'social' | 'event' | 'data';
  text: string;                    // Original text (Spanish)
  summary?: string;
  url?: string;
  source: string;                  // "clarin", "bcra_api", "x_trends"
  publishedAt: string;
  entities: string[];
  category?: MarketCategory;
  dataPoints?: DataPoint[];        // For BCRA, INDEC, weather
  score?: number;                  // 0-10, set by scorer
  scoreReason?: string;
}

interface DataPoint {
  metric: string;
  currentValue: number;
  previousValue?: number;
  unit: string;
}
```

**Critical:** For economic data sources (BCRA, Ámbito), always fetch **current values** and include them as `DataPoint[]` in the signal. The LLM gets real numbers, not stale training data. This directly prevents the hallucination problem.

### Signal scoring

After ingestion, `scorer.ts` sends signals to Claude for scoring on 4 dimensions: controversy, temporality, interest, and measurability. Signals scoring 0 (not predictive) are filtered out. Scores are persisted to the `signals` table.

### Topic extraction

`topic-extractor.ts` is the bridge between raw signals and market generation. Instead of generating markets directly from signals, the system:

1. **Clusters signals into topics** — LLM matches signals to existing active topics or creates new ones
2. **Each topic** has: name, slug, summary, suggested market angles, category, score, linked signals
3. **Stale detection** — topics with no new signals in 48h are auto-marked as stale
4. **Editor feedback** — topics can receive feedback from the dashboard; `rescoreTopic()` re-evaluates score considering editor input
5. **Dismissal** — editors can dismiss topics they don't want markets for

This intermediate layer gives editors control over *what themes* to generate markets for, rather than just accepting whatever the LLM produces.

### LLM generation prompt

```
Sos un creador de mercados predictivos para Predmarks, una plataforma
argentina de mercados de predicción. Tu trabajo es convertir señales de
noticias y datos en mercados atractivos y operables.

IDIOMA: Todos los mercados deben estar en español argentino.

FORMATO DE SALIDA:
{
  "title": "¿[pregunta sí/no en español]?",
  "description": "Contexto breve del mercado",
  "resolutionCriteria": "Este mercado se resolverá como \"Sí\" si... Se resolverá como \"No\" si...",
  "resolutionSource": "Nombre y URL de la fuente",
  "contingencies": "Cláusulas de contingencia aplicables",
  "category": "Política|Economía|Deportes|Entretenimiento|Clima",
  "tags": ["tag1", "tag2"],
  "endTimestamp": <unix seconds>,
  "expectedResolutionDate": "YYYY-MM-DD",
  "timingAnalysis": "Por qué el timing es seguro para LMSR",
  "requiresVerification": ["dato que necesita verificación"]
}

REGLAS CRÍTICAS DE TIMING (LMSR):
- El mercado NO DEBE poder resolverse mientras está abierto
- endTimestamp debe ser ANTES de que el resultado sea conocido

PATRONES DE TIMING POR CATEGORÍA:
- Deportes (partidos): cerrar 30 minutos después del inicio del partido
- Deportes (no-partido, ej: "¿Será X el DT?"): EVITAR salvo que sea
  excepcionalmente atractivo. Si lo generás, usar ventana corta (días)
- Economía (datos diarios como dólar, riesgo país): cerrar la NOCHE
  ANTERIOR al día del dato (ej: cierra jueves noche para dato del viernes)
- Economía (datos rezagados como reservas BCRA, IPC): enmarcar como
  PERÍODO ("al cierre de febrero"), nunca como fecha puntual
- Clima: SIEMPRE día único, NUNCA rangos multi-día. "¿La mínima del
  viernes baja de X?" con cierre jueves noche. PROHIBIDO: "en algún
  día del 11 al 15" porque el Sí puede cumplirse el día 1
- Política: cerrar antes del voto o anuncio esperado. Mercados "antes
  de X" con ventana >1 semana son riesgosos — solo si muy atractivos
- Si no podés garantizar timing seguro, NO generes el mercado

REGLAS DE CONTENIDO:
- Enfoque Argentina: política, economía, deportes, entretenimiento, clima
  (temas de "sociedad" van en Política)
- Evitar mercados globales cubiertos por Polymarket/Kalshi
  (EXCEPCIÓN: eventos de altísima importancia como elecciones)
- NUNCA inventar números. Si no tenés el dato actual, marcá como
  "requiere verificación" y dejá el campo vacío
- Preferir mercados controversiales con potencial de oscilaciones
- Ambos resultados (Sí y No) deben ser plausibles

CONTINGENCIAS ESTÁNDAR (incluir las que apliquen):
- Si la fuente no publica: usar fuente alternativa o última disponible
- Si el evento se cancela: resolver como "No"
- Si hay revisión de datos: usar primera publicación
- Deportes partidos: resultado en tiempo reglamentario + cláusula de
  reprogramación ("si se reprograma a fecha anterior, cierre anticipado")
- Deportes partidos: cancelación/suspensión/posterga a otro día → "No"
- Clima: siempre referenciar timeanddate.com como fuente

DATOS ACTUALES (no inventar otros):
{dataPoints}

HOY: {date}

MERCADOS ABIERTOS (no duplicar):
{openMarketTitles}

Generá candidatos de estas señales. Priorizá calidad sobre cantidad.
Salteá señales que no dan buenos mercados.
```

### Deduplication

Embedding similarity check (OpenAI `text-embedding-3-small`):
- vs. open markets: reject at cosine >0.85
- vs. batch candidates: keep highest-quality version (by `resolutionCriteria` length)
- vs. recently rejected (30 days): warn at >0.80 (don't exclude)

### Output
Write to database as `status: 'candidate'`. Sets `sourceContext.originType = 'news'`. Triggers `market/candidate.created` event → review pipeline picks it up automatically.

---

## Agent 2: Reviewer

### Purpose
Validate candidates against rules, verify factual claims, score quality, rewrite if needed, and surface the best candidates for human approval.

This is the most critical agent. It directly fixes the current system's failures.

### Pipeline

```
Data verification → Hard rules check → Quality scoring → Rewrite (if needed) → Rank → Human dashboard
```

### Step 1: Data verification

Before anything else, fact-check every claim. This step uses web search.

```
You are a fact-checker for Predmarks, an Argentine prediction market.
Verify every numerical claim and factual assertion in this candidate market.

Market:
{candidate JSON}

For EACH number, statistic, or factual claim:
1. Search for the current real-world value
2. Compare to what the market claims or implies
3. Flag any discrepancy

Also verify the resolution source:
1. Does it exist?
2. Is it publicly accessible (not paywalled)?
3. Does it actually publish the data type referenced?

Output:
{
  "claims": [
    {
      "claim": "What the market states",
      "currentValue": "Actual current value",
      "source": "Where you verified",
      "sourceUrl": "URL",
      "isAccurate": true/false,
      "severity": "critical" | "minor"
    }
  ],
  "resolutionSource": {
    "exists": true/false,
    "accessible": true/false,
    "publishesRelevantData": true/false,
    "url": "verified URL",
    "note": "What you found"
  }
}

Be thorough. Our previous system hallucinated numbers constantly.
```

### Step 2: Hard rules check

Load rules from `rules.ts`. Present each rule to the LLM with the candidate and verification results. Auto-reject on any failure.

```
Sos un revisor de calidad para Predmarks. Verificá si este mercado
candidato pasa todas las reglas estrictas.

Mercado candidato:
{candidate JSON}

Resultados de verificación de datos:
{dataVerification results from step 1}

Reglas estrictas:
{HARD_RULES from rules.ts}

Para cada regla, respondé:
{
  "rule": "H1",
  "passed": true/false,
  "explanation": "Razón breve"
}

Si CUALQUIER regla estricta falla, el mercado es RECHAZADO.
También señalá violaciones de reglas blandas como advertencias.
```

### Step 3: Quality scoring

```
Puntuá este mercado candidato para Predmarks.

1. AMBIGÜEDAD (peso: 35%)
   10 = Cristalino: fuente específica, fecha exacta, contingencias cubiertas
   5 = Mayormente claro pero con 1-2 escenarios disputables
   1 = Vago, no queda claro qué significa "se resolverá como Sí"

2. SEGURIDAD DE TIMING (peso: 25%)
   10 = Imposible que se resuelva con el mercado abierto
        Ejemplos: partido de fútbol cierra 30min post-kickoff,
        dato económico cierra la noche anterior, clima single-day
   7 = Muy improbable que se resuelva con el mercado abierto
   4 = PODRÍA resolverse con el mercado abierto en ciertos escenarios
   2-3 = Mercado abierto tipo "¿Ocurrirá X antes de Y?" — solo
         permitido si es excepcionalmente atractivo (ver política)
   1 = Alta probabilidad de resolverse con el mercado abierto

   NOTA: Un score de 4 o menos debería efectivamente bloquear la
   publicación, SALVO que sea una excepción aprobada bajo la política
   de mercados abiertos (alto timeliness + volumePotential).

   ANTI-PATRONES (detectar y penalizar):
   - Clima con rango multi-día ("algún día del 11 al 15") → score 2
   - "¿Será X el próximo DT/ministro/CEO?" con ventana >5 días → score 2-3
   - Dato económico que se publica mientras el mercado está abierto → score 1
   - Mercado político "antes de Y" donde Y es >1 semana → score 3

3. ACTUALIDAD (peso: 20%)
   10 = Sobre el titular del día, pico de interés
   5 = Relevante a una historia en curso
   1 = No conectado a ningún evento actual

4. POTENCIAL DE VOLUMEN (peso: 20%)
   10 = Controversial, oscilaciones probables, todos opinan
   7 = Buen potencial de debate
   5 = Nicho pero con audiencia interesada
   1 = Extremadamente nicho
   BONUS: Mercados donde la probabilidad va a oscilar (negociaciones
   legislativas, temporadas deportivas, incertidumbre económica)
   puntúan más alto que eventos de un solo momento.

Output:
{
  "ambiguity": { "score": N, "reasoning": "..." },
  "timingSafety": { "score": N, "reasoning": "..." },
  "timeliness": { "score": N, "reasoning": "..." },
  "volumePotential": { "score": N, "reasoning": "..." },
  "overallScore": N,
  "recommendation": "publish" | "rewrite_then_publish" | "hold" | "reject"
}
```

### Step 4: Improvement pass (`improver.ts`)

For markets scored `rewrite_then_publish` or with ambiguity < 7 or timingSafety < 7:

```
Sos un editor experto de mercados predictivos para Predmarks.
Mejorá este mercado. Prioridades:

1. TIMING: Si hay riesgo de que se resuelva con el mercado abierto,
   reenmarcá para eliminarlo. Ajustá el endTimestamp si es necesario.

2. CRITERIOS: Hacé la resolución hermética:
   - Citá fuente pública específica con URL
   - Incluí hora argentina (UTC-3) si aplica
   - Cubrí los casos borde con contingencias estándar
   - Formato: 'Este mercado se resolverá como "Sí" si... Se resolverá como "No" si...'

3. CONTINGENCIAS: Incluí las cláusulas estándar que apliquen:
   - Fuente no disponible → fuente alternativa o última disponible
   - Evento cancelado → "No"
   - Revisión de datos → primera publicación
   - Deportes → tiempo reglamentario

4. TÍTULO: Hacelo más claro y atractivo.

5. DESCRIPCIÓN: Agregá contexto relevante (1-2 oraciones).

NO inventar datos. Si necesitás un número que no tenés, escribí
"[VERIFICAR: descripción del dato necesario]".

Mercado original:
{market JSON}

Problemas detectados:
{rule violations + scoring notes}
```

### Step 5: Rank and surface

Sort by `overallScore` descending. Push to human dashboard with:
- Original candidate
- Data verification results with sources
- Suggested rewrites (if any)
- Scores with reasoning
- Timing safety analysis
- Soft rule warnings
- **Preview of the final deployable JSON** (so the human can see exactly what will ship)

---

## Agent 3: Resolution checker

### Purpose
Monitor open markets for settling events. Flag for human confirmation. Emergency detection for LMSR safety.

### Scanning strategy (implemented)

A single cron job (`cron-resolution-check`) runs every 6 hours and dispatches individual resolution checks:

1. **Find eligible markets**: open markets on mainnet closing within 72h + all `in_resolution` markets on mainnet
2. **Dispatch**: sends `markets/resolution.check` event for each eligible market
3. **Concurrency**: 2 concurrent checks total, 1 per market (prevents duplicate checks)

Testnet markets get random resolution outcomes for testing.

### Resolution source fetching

Before LLM evaluation, the job fetches content from URLs found in the market's `resolutionSource` and `description` fields:
- Fetches up to 3 URLs (10s timeout each)
- Strips HTML tags, extracts text (3000 char limit)
- Saves fetched content as a `signal` (type: `data`, source: `resolution_source`) for audit trail
- Passes content to evaluator as additional context

### Per-market evaluation prompt

```
Sos un analista de resolución para Predmarks, un mercado de predicción argentino.

Mercado:
- Título: {title}
- Criterios de resolución: {resolutionCriteria}
- Fuente de resolución: {resolutionSource}
- Cierre del mercado: {endTimestamp as readable date}
- Estado actual: {status}

Fecha y hora actual: {now} (Argentina, UTC-3)

Resultados de búsqueda:
{searchResults}

Determiná:

1. ¿Ocurrió el evento de resolución? (sí / no / no está claro)
2. Si sí, ¿cuál es el resultado? (Sí / No)
3. CRÍTICO: Si el mercado está ABIERTO y el evento se resolvió o está
   por resolverse, marcá como EMERGENCIA (arbitraje LMSR).
4. Evidencia con URLs de fuentes.
5. Nivel de confianza (alto / medio / bajo).

Output:
{
  "status": "resolved" | "unresolved" | "unclear" | "emergency",
  "suggestedOutcome": "Si" | "No" | null,
  "confidence": "high" | "medium" | "low",
  "evidence": "Resumen en español...",
  "evidenceUrls": ["url1", "url2"],
  "reasoning": "Análisis en español...",
  "isEmergency": false,
  "emergencyReason": null
}

Reglas:
- Solo marcá como resuelto con evidencia CLARA de fuente confiable
- "No está claro" es el default seguro
- Si el mercado cerró y la condición NO se cumplió → sugerir No
- EMERGENCIA: si el evento se resuelve AHORA y el mercado está ABIERTO
```

### Search query construction

```typescript
function buildSearchQueries(market: Market): string[] {
  return [
    extractKeyTerms(market.title),                    // "dólar blue 1500"
    `${market.resolutionSource} ${extractTopic(market)}`, // "BCRA reservas"
    `${extractTopic(market)} Argentina hoy`,          // "inflación Argentina hoy"
  ];
}
```

### Emergency detection

If the evaluator returns `isEmergency: true`, the job logs a `resolution_emergency` activity with full context (evidence, URLs, emergency reason). **Slack/webhook notifications are not yet implemented** — emergencies surface in the activity log and dashboard.

### Resolution feedback

The evaluator loads per-market feedback from the `resolutionFeedback` table (up to 10 entries). Editors can add feedback via `POST /api/markets/:id/feedback` or MiniChat's `save_resolution_feedback` tool to guide future resolution checks.

### Deadline handling

Markets past `endTimestamp` where the YES condition was not met → auto-flag as `suggestedOutcome: 'No'` with `confidence: 'high'`.

---

## Tech stack (Vercel-deployable)

```
Framework:         Next.js 16 (App Router) + TypeScript strict + Tailwind v4
Deployment:        Vercel
Database:          Supabase Postgres (RLS enabled on all 16 tables)
ORM:               Drizzle (postgres.js driver)
Job orchestration: Inngest (step functions, throttle, cancelOn, concurrency, cron)
LLM:               Claude API (claude-sonnet-4-20250514 default, claude-opus-4-20250514 configurable)
Web search:        Anthropic tool-use web search (web_search_20250305)
Embeddings:        OpenAI text-embedding-3-small (deduplication + topic coalescence)
X/Twitter:         X API v2 (trending topics)
Blockchain:        Base mainnet (8453) + Base Sepolia (84532), viem + wagmi
Auth:              Cookie-based sessions (30-day, bcrypt + random token)
Notifications:     TODO (Slack webhook planned)
```

### LLM integration (`src/lib/llm.ts`)

Two core functions power all agent LLM calls:

- **`callClaude<T>()`** — structured output via tool_choice forcing. Returns typed result + usage stats.
- **`callClaudeWithSearch<T>()`** — same, but adds `web_search_20250305` tool for real-time data access.

**Token budgets** per operation (configurable in `TOKEN_BUDGETS`):

| Operation | Max tokens |
|-----------|-----------|
| `generate_markets` | 16,000 |
| `improve_market`, `extract_topics` | 8,192 |
| `data_verify`, `rules_check`, `score_signals`, `expand_market`, `research_topic` | 4,096 |
| `score_market`, `resolve_check`, `match_markets_topics` | 2,048 |
| `rescore_topic` | 1,024 |

**Model overrides**: stored in the `config` table (key: `model_override:<operation>`). Can be set via MiniChat. Cached for 5 minutes.

**Usage tracking**: every LLM call logs to `llmUsage` table — operation, model, input/output/cache tokens, Inngest run ID. Dashboard at `/dashboard/usage` shows daily charts and per-operation breakdowns.

### Why this stack

- **Vercel + Next.js**: Zero infra management. Dashboard UI + API routes in one project.
- **Inngest over raw Vercel Cron**: Vercel Cron triggers functions but doesn't handle retries, queuing, or step functions. Inngest gives reliable retries, step functions (critical for pipelines exceeding 60s), event-driven triggers, throttling, and cancellation.
- **Claude Sonnet for all agents**: Best reasoning-to-cost ratio. Strong Spanish. Structured output via tool_use.

### Project structure

```
predmarks-market-agents/
├── src/
│   ├── middleware.ts                          # Auth middleware (session cookie check)
│   ├── app/
│   │   ├── layout.tsx                        # Root layout with MiniChat sidebar
│   │   ├── page.tsx                          # Home/redirect
│   │   ├── _components/                      # Shared: Nav, MiniChat, MarketList, Markdown, etc.
│   │   ├── login/                            # Login page + server actions
│   │   ├── api/
│   │   │   ├── chat/route.ts                 # MiniChat API (34 tools, multi-turn)
│   │   │   ├── markets/
│   │   │   │   ├── route.ts                  # GET list, POST create
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts              # GET detail
│   │   │   │       ├── reject/route.ts
│   │   │   │       ├── edit/route.ts
│   │   │   │       ├── cancel/route.ts
│   │   │   │       ├── resume/route.ts
│   │   │   │       ├── archive/route.ts
│   │   │   │       ├── unarchive/route.ts
│   │   │   │       ├── resolve/route.ts      # Confirm resolution
│   │   │   │       ├── suggest-resolution/route.ts
│   │   │   │       ├── check-resolution/route.ts
│   │   │   │       ├── dismiss-resolution/route.ts
│   │   │   │       ├── refresh/route.ts      # Sync onchain data
│   │   │   │       ├── match-onchain/route.ts
│   │   │   │       ├── feedback/route.ts     # Resolution feedback
│   │   │   │       └── log/route.ts          # Event history
│   │   │   ├── review/[id]/route.ts          # Trigger review pipeline
│   │   │   ├── topics/
│   │   │   │   ├── route.ts                  # GET/POST topics
│   │   │   │   ├── dedup/route.ts            # Deduplication candidates
│   │   │   │   ├── batch-merge/route.ts
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts              # GET/POST topic
│   │   │   │       ├── dismiss/route.ts
│   │   │   │       ├── feedback/route.ts
│   │   │   │       ├── merge/route.ts
│   │   │   │       └── cancel-research/route.ts
│   │   │   ├── signals/route.ts              # Search signals
│   │   │   ├── generate/route.ts             # Trigger generation
│   │   │   ├── sourcing/
│   │   │   │   ├── route.ts                  # Trigger ingestion
│   │   │   │   └── status/route.ts           # Run history
│   │   │   ├── rules/route.ts                # GET/POST rules
│   │   │   ├── global-feedback/
│   │   │   │   ├── route.ts                  # GET/POST
│   │   │   │   └── [id]/route.ts             # DELETE
│   │   │   ├── sync-deployed/route.ts        # Full onchain sync
│   │   │   ├── sync-stats/route.ts           # Lightweight stats sync
│   │   │   ├── activity/route.ts             # Activity log
│   │   │   ├── usage/route.ts                # LLM usage stats
│   │   │   ├── monitoring/activity/route.ts
│   │   │   └── inngest/route.ts              # Inngest webhook (11 functions)
│   │   └── dashboard/
│   │       ├── _components/                  # SearchInput, FilterCombobox, StatusBadge, TimingSafetyIndicator
│   │       ├── mercados/page.tsx             # Main markets list (deployed onchain)
│   │       ├── open/page.tsx                 # Open markets with timing indicators
│   │       ├── resolution/page.tsx           # Markets pending resolution
│   │       ├── archive/page.tsx              # Archived markets
│   │       ├── signals/page.tsx              # Signal search + ingestion trigger
│   │       ├── topics/
│   │       │   ├── page.tsx                  # Topic list + management
│   │       │   ├── dedup/page.tsx            # Deduplication UI
│   │       │   └── [slug]/page.tsx           # Topic detail
│   │       ├── markets/[id]/
│   │       │   ├── page.tsx                  # Market detail + actions
│   │       │   └── _components/              # MarketActions, ResolutionActions, OnchainActions, etc.
│   │       ├── activity/page.tsx
│   │       ├── redemptions/page.tsx           # Unredeemed winners + redemptions
│   │       ├── usage/page.tsx                # LLM token usage
│   │       ├── rules/page.tsx                # Rule management
│   │       └── monitoring/page.tsx
│   ├── agents/
│   │   ├── sourcer/
│   │   │   ├── index.ts                      # Pipeline orchestrator + CANDIDATE_CAP
│   │   │   ├── types.ts                      # SourceSignal, DataPoint, Topic, GeneratedCandidate
│   │   │   ├── ingestion.ts                  # Coordinator: runs all streams in parallel
│   │   │   ├── ingestion-news.ts             # RSS feed parser
│   │   │   ├── ingestion-data.ts             # BCRA API + Ámbito Financiero
│   │   │   ├── ingestion-twitter.ts          # X API v2 trending topics
│   │   │   ├── ingestion-scrape.ts           # HTML scraping (Cheerio)
│   │   │   ├── scorer.ts                     # LLM signal scoring + topic rescoring
│   │   │   ├── topic-extractor.ts            # LLM topic clustering
│   │   │   ├── topic-coalescence.ts          # LLM topic merging + embedding similarity
│   │   │   ├── topic-research.ts             # Web search for topic research
│   │   │   ├── generator.ts                  # LLM market generation
│   │   │   └── deduplication.ts              # OpenAI embedding cosine similarity
│   │   ├── reviewer/
│   │   │   ├── index.ts                      # verifyData, checkRules, scoreMarket, improveMarket
│   │   │   ├── types.ts                      # MarketRecord type
│   │   │   ├── data-verifier.ts              # Web search fact-checking
│   │   │   ├── rules-checker.ts              # Hard + soft rule validation
│   │   │   ├── scorer.ts                     # 4-dimension quality scoring
│   │   │   └── improver.ts                   # Iterative market improvement
│   │   └── resolver/
│   │       └── evaluator.ts                  # Resolution evaluation with web search
│   ├── config/
│   │   ├── rules.ts                          # H1-H12 hard rules, S1-S8 soft rules (DB-backed + fallback)
│   │   ├── contingencies.ts                  # Standard contingency templates
│   │   ├── scoring.ts                        # Weights and thresholds
│   │   └── sources.ts                        # Signal source config (DB-backed + fallback)
│   ├── db/
│   │   ├── schema.ts                         # 16 tables (see schema section)
│   │   ├── types.ts                          # All shared types
│   │   └── client.ts                         # Drizzle client (postgres.js driver)
│   ├── lib/
│   │   ├── llm.ts                            # Claude API: callClaude, callClaudeWithSearch, token budgets
│   │   ├── auth.ts                           # Session management (bcrypt, cookies)
│   │   ├── activity-log.ts                   # logActivity() helper
│   │   ├── market-events.ts                  # logMarketEvent() helper
│   │   ├── export.ts                         # toDeployableMarket()
│   │   ├── validate-market.ts                # Market validation rules
│   │   ├── expand-market.ts                  # LLM market field expansion
│   │   ├── match-market-topic.ts             # Topic matching for markets
│   │   ├── usage.ts                          # Usage stats + cost estimation
│   │   ├── analytics.ts                      # Analytics helpers
│   │   ├── timezone.ts                       # Timezone utilities
│   │   ├── onchain.ts                        # Fetch onchain market data via viem
│   │   ├── indexer.ts                        # GraphQL subgraph queries
│   │   ├── sync-deployed.ts                  # Sync deployed markets from chain
│   │   ├── contracts.ts                      # Contract ABIs + addresses
│   │   ├── chains.ts                         # Chain configs (Base mainnet/Sepolia)
│   │   └── wagmi.ts                          # Wagmi/wallet config
│   └── inngest/
│       ├── client.ts                         # Inngest singleton (id: 'predmarks-agents')
│       ├── review-job.ts                     # Iterative review with throttle + cancelOn
│       ├── ingestion-job.ts                  # Full signal ingestion pipeline
│       ├── ingestion-light-job.ts            # Light ingestion (fetch only)
│       ├── generation-job.ts                 # Market generation from topics
│       ├── resolution-job.ts                 # Resolution evaluation
│       ├── research-job.ts                   # Topic research via web search
│       ├── coalescence-job.ts                # Topic coalescence
│       ├── suggest-topic-job.ts              # Topic suggestion pipeline
│       ├── cron-ingest.ts                    # Every 12h → ingestion
│       ├── cron-ingest-light.ts              # Every 1h → light ingestion
│       └── cron-resolution.ts                # Every 6h → resolution checks
├── scripts/
│   ├── seed.ts                               # Database seeding
│   ├── seed-user.ts                          # User creation
│   ├── test-sourcing.ts                      # Sourcing test
│   └── test-review.ts                        # Review test
├── docs/
│   └── optimization-log.md                   # LLM token optimization log
├── drizzle.config.ts
├── package.json
└── .env
```

### Inngest job orchestration

11 functions registered in the Inngest webhook (`src/app/api/inngest/route.ts`):

#### Cron schedules

| Job ID | Cron | Purpose |
|--------|------|---------|
| `cron-signal-ingestion` | `0 0 * * *` | Daily at midnight: triggers full ingestion pipeline |
| `cron-signal-ingestion-light` | `0 * * * *` | Every hour: triggers light ingestion (fetch only, no coalescence) |
| `cron-resolution-check` | `0 */6 * * *` | Every 6h: finds eligible markets and dispatches resolution checks |

#### Event-driven jobs

| Job ID | Event | Concurrency | Steps |
|--------|-------|-------------|-------|
| `ingestion-pipeline` | `signals/ingest.requested` | limit: 1 | Init run → ingest all sources → mark used → coalesce topics → complete |
| `ingestion-light` | `signals/ingest-light.requested` | limit: 1 | Ingest only (no coalescence) |
| `generation-pipeline` | `markets/generate.requested` | limit: 1 | Load topics → load open markets → generate → dedup → save → update topic timestamps |
| `review-pipeline` | `market/candidate.created` | limit: 1, throttle: 1/2m | Iterative: verify → rules → score → (improve → re-check → re-score) ×3 max. Supports cancel + resume |
| `resolution-check` | `markets/resolution.check` | 2 total, 1 per market | Load market → fetch source → evaluate → save resolution |
| `topic-research` | `topics/research.requested` | limit: 2, throttle: 1/1m | Set researching → web search + save signals → update topic |
| `suggest-topic` | `topics/suggest.requested` | limit: 1, throttle: 1/1m | Research → coalesce → resolve topic → link market |
| `topic-coalescence` | `topics/coalesce.requested` | limit: 1 | Load signals → coalesce into topics |

#### Resolution cron logic (`cron-resolution.ts`)

The cron finds eligible markets for resolution checks:
- Open markets on mainnet (chainId 8453) closing within 72 hours
- All `in_resolution` markets on mainnet

Each eligible market gets a `markets/resolution.check` event dispatched.

#### Review pipeline details

The review pipeline is the most complex job:
- **cancelOn**: `market/review.cancel` event (fired by cancel API)
- **Resume support**: loads iteration state from DB, skips completed iterations
- **Feedback loading**: human feedback, global feedback, triage rejections
- **Iteration loop**: up to `maxIterations` (3) of improve → re-check → re-score
- **Early termination**: unfixable hard rule failure (H4, H5, H8) → immediate rejection
- **Score plateau**: stops if score doesn't improve between iterations
- **Final status**: remains `candidate` with review data for human decision

---

## Human review dashboard

### Kanban pipeline (default view at `/dashboard`)

The main page is a **4-column resizable Kanban board** for rapid triage:

```
Topics → Candidates → Proposals → Open Markets
```

Each column shows relevant items with inline actions and bulk operations. This replaces the previous monitoring-centric default view.

### Signals page (`/dashboard/signals`)

The operational hub for signal ingestion:
- Trigger ingestion button (sends `signals/ingest.requested` event)
- Run log with step-by-step progress (via `SourcingPanel` component)
- Each run shows: status, date, signal/candidate counts, expandable step detail

### Topics page (`/dashboard/topics`)

Topic management interface:
- List active/stale topics ordered by score
- Select topics and trigger market generation
- Dismiss topics (with optional reason)
- Suggest new topics (triggers `suggestTopicJob` via Claude web search)
- Bulk actions for efficiency

### Other pages

- `/dashboard/mercados` — deployed onchain markets with volume, participants, chain info
- `/dashboard/open` — open markets sorted by `endTimestamp` with timing safety indicators
- `/dashboard/resolution` — markets in `in_resolution` status with resolution suggestions, confirm/dismiss actions
- `/dashboard/archive` — archived markets with search/filter
- `/dashboard/activity` — system-wide activity log (paginated)
- `/dashboard/redemptions` — unredeemed winners tracking and redemptions
- `/dashboard/usage` — LLM token usage by operation/model with daily charts
- `/dashboard/rules` — rule management (edit hard/soft rules, enable/disable)
- `/dashboard/monitoring` — monitoring dashboard

### Market detail page (`/dashboard/markets/[id]`)

Full market info + review history + onchain integration:
- All review data, iteration history with diffs, scores
- **MiniChat sidebar** — context-aware chat (see Chat System section)
- **Copy JSON button** — copies deployable JSON to clipboard
- **Resolution actions** — suggest resolution, check resolution, confirm, dismiss
- **Onchain actions** — deploy market, resolve onchain, withdraw liquidity, match to onchain market
- Context-aware action buttons: review, cancel, resume, reject, edit, archive

### Topic detail page (`/dashboard/topics/[slug]`)

Topic info + linked signals + generation history:
- Topic summary, suggested angles, score, signal count
- **Topic actions** — research, generate markets, dismiss, merge
- Linked signals list

Events are logged via `logMarketEvent()` at each pipeline step and API action. Stale detection: processing markets with no events in 5+ min are flagged as "Estancado" with a resume button.

### API endpoints (40 routes)

**Markets**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/markets` | List markets (with `?status=` filter), create new market |
| GET | `/api/markets/:id` | Full market detail |
| POST | `/api/markets/:id/reject` | Reject with optional reason |
| POST | `/api/markets/:id/edit` | Human edits to market fields |
| POST | `/api/markets/:id/feedback` | Add resolution feedback |
| POST | `/api/markets/:id/resolve` | Confirm resolution (outcome + confirmedBy) |
| POST | `/api/markets/:id/suggest-resolution` | Trigger AI resolution suggestion |
| POST | `/api/markets/:id/check-resolution` | Trigger resolution check job |
| POST | `/api/markets/:id/dismiss-resolution` | Clear resolution suggestion |
| POST | `/api/markets/:id/cancel` | Cancel processing → sends Inngest cancel event |
| POST | `/api/markets/:id/resume` | Resume cancelled → back to candidate + re-review |
| POST | `/api/markets/:id/archive` | Archive completed market |
| POST | `/api/markets/:id/unarchive` | Restore archived market |
| POST | `/api/markets/:id/refresh` | Sync onchain data (status, volume, participants) |
| POST | `/api/markets/:id/match-onchain` | Find and link onchain market by title |
| GET | `/api/markets/:id/log` | Get market event history |
| POST | `/api/review/:id` | Trigger review pipeline for a candidate |

**Topics**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/topics` | List topics (with filters) / create new topic |
| GET/POST | `/api/topics/:id` | Topic detail + linked signals / update topic |
| POST | `/api/topics/:id/dismiss` | Dismiss topic |
| POST | `/api/topics/:id/feedback` | Add feedback |
| POST | `/api/topics/:id/merge` | Merge into another topic |
| POST | `/api/topics/:id/cancel-research` | Cancel ongoing research job |
| POST | `/api/topics/batch-merge` | Bulk merge multiple topics |
| GET | `/api/topics/dedup` | List deduplication candidates (embedding similarity) |

**Signals**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/signals` | Search signals (filters: q, source, category, type; pagination) |

**Generation & Sourcing**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/generate` | Trigger market generation from topics |
| POST | `/api/sourcing` | Trigger signal ingestion pipeline |
| GET | `/api/sourcing/status` | Sourcing run history |

**Feedback & Config**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/global-feedback` | List / add global instructions |
| DELETE | `/api/global-feedback/:id` | Delete global feedback entry |
| GET/POST | `/api/rules` | List / update market rules |

**Chat**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/DELETE | `/api/chat` | MiniChat: list conversations, send message, delete conversation |

**Sync & Monitoring**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sync-deployed` | Full sync: create/link markets from onchain |
| POST | `/api/sync-stats` | Lightweight sync: update volume/participants/status |
| GET | `/api/monitoring/activity` | Market monitor data with status counts |
| GET | `/api/activity` | Activity log (paginated) |
| GET | `/api/usage` | LLM usage statistics |

**Inngest**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST/PUT | `/api/inngest` | Inngest webhook handler |

---

## Database schema

16 tables, all with RLS enabled (`src/db/schema.ts`):

| Table | Purpose |
|-------|---------|
| `markets` | Core market data: content, timing, status, review results (JSONB), iterations (JSONB), resolution (JSONB), onchain fields, `isArchived` flag |
| `marketEvents` | Audit trail: every pipeline step + human action with type, iteration, detail (JSONB) |
| `sourcingRuns` | Ingestion pipeline runs with step-by-step progress, signal/candidate counts, error tracking |
| `signals` | Ingested signals from all sources. Upsert by URL. Includes `dataPoints[]`, `score`, `scoreReason`, `usedInRun` FK |
| `topics` | Extracted themes: name, slug (unique), summary, `suggestedAngles[]`, category, score, status, `feedback` (JSONB), `embedding` (JSONB), `lastSignalAt`, `lastGeneratedAt` |
| `topicSignals` | Junction table linking topics ↔ signals |
| `conversations` | MiniChat persistence: contextType (global/topic/market/signal), contextId, messages (JSONB array) |
| `activityLog` | System-wide activity: action, entityType, entityId, detail (JSONB), source (ui/chat/pipeline/webhook) |
| `rules` | Hard/soft rules loaded at runtime. Editable from dashboard and chat. Hardcoded fallback in `config/rules.ts` |
| `config` | Key-value store for prompts and settings (chat prompt, generation prompt, resolution prompt, model overrides) |
| `llmUsage` | Token tracking per operation/model for cost monitoring. Linked to Inngest run IDs |
| `globalFeedback` | Persistent editor instructions loaded by generation agent |
| `resolutionFeedback` | Per-market resolution feedback loaded by evaluator agent |
| `signalSources` | RSS feeds, APIs, scrapers — DB-backed signal source config (type: rss/scrape/api/social) |
| `users` / `sessions` | Authentication: username/password hash, cookie-based session tokens (30-day expiry) |

Key indexes: `markets(status)`, `markets(status, createdAt)`, `markets(onchainId, chainId)` unique, `signals(url)` unique, `signals(createdAt)`, `signals(score)`, `topics(status)`, `topics(score)`, `llmUsage(operation)`, `llmUsage(createdAt)`, `conversations(contextType, contextId)`.

---

## Feedback & learning system

The system has a multi-layered feedback loop that improves generation and resolution over time:

1. **Global feedback** (`globalFeedback` table) — Persistent editor instructions (e.g., "avoid markets about cryptocurrency"). Loaded by the generator and reviewer agents, and available as context in MiniChat. Managed via `POST /api/global-feedback` or MiniChat `save_feedback` tool.
2. **Rejection feedback** — When editors reject markets, the reason is logged as a `marketEvent`. The generator loads recent rejections (30 days) to avoid repeating mistakes.
3. **MiniChat feedback** — Context-aware chat sidebar (see Chat System section). Editors discuss markets, topics, or general strategy with Claude, which persists insights via tools.
4. **Topic feedback** — Editors leave feedback on topics via dashboard or MiniChat. Stored in the topic's `feedback` JSONB array. `rescoreTopic()` re-evaluates the topic's score considering the feedback.
5. **Topic dismissal** — Editors can dismiss topics entirely, preventing further generation.
6. **Resolution feedback** (`resolutionFeedback` table) — Per-market feedback for the resolution evaluator. Loaded by `evaluateResolution()` to guide future checks on that market.
7. **Prompt management** — System prompts for chat, generation, and resolution are stored in the `config` table and editable via MiniChat tools (`update_chat_prompt`, `update_generation_prompt`, `update_resolution_prompt`).

This creates a learning loop: editor feedback → persisted in DB → loaded into agent prompts → better candidates and resolutions.

---

## Chat system (MiniChat)

A context-aware AI copilot sidebar available on every dashboard page (`src/app/_components/MiniChat.tsx` + `src/app/api/chat/route.ts`).

### Architecture

- **Frontend**: resizable sidebar (280-600px), multi-turn conversation, activity card display, background job polling
- **Backend**: Claude with 34 tools in a multi-turn loop (up to 20 turns per message)
- **Persistence**: conversations stored in `conversations` table, scoped by contextType + contextId
- **Context detection**: automatically detects context from URL (topic, market, signal, or global)

### Tool categories (34 tools)

| Category | Tools | Behavior |
|----------|-------|----------|
| **Lookup** | `lookup_topic`, `lookup_market`, `lookup_signals` | Execute immediately |
| **Modification** | `update_topic`, `update_market`, `update_signal`, `add_angle`, `link_market_topic`, `unlink_market_topic`, `save_feedback`, `merge_topics`, `link_signal_to_topic`, `update_rule`, `create_rule`, `date_to_timestamp` | Execute immediately |
| **Async jobs** | `research_topic`, `coalesce_topics`, `suggest_topic`, `ingest_signals`, `sync_deployed`, `create_market`, `review_market`, `check_resolution`, `rescore_topic` | Trigger Inngest event, ask user first |
| **Prompt management** | `get/update_chat_prompt`, `get/update_generation_prompt`, `get/update_resolution_prompt` | Read/write `config` table |
| **Signal sources** | `list/create/update_signal_source` | Manage DB-backed signal sources |
| **Feedback** | `save_resolution_feedback` | Store per-market resolution feedback |

### System prompt

The chat system prompt is stored in the `config` table (key: `chat_prompt`) and editable via `update_chat_prompt` tool. Default personality: "Sos el copiloto de Predmarks" — brief, direct, Argentine Spanish.

**Cost-awareness**: cheap operations (lookups, updates, feedback) execute immediately. Expensive operations (create market, review, resolution check) require explicit user confirmation before triggering.

## Onchain integration

Markets are deployed to Base blockchain (mainnet: 8453, testnet: 84532) via the Predmarks smart contracts.

### Contract interaction (`src/lib/contracts.ts`, `src/lib/onchain.ts`)

- **Precog Master**: `createCustomMarket()`, `updateMarket()`, `marketTransferOwnership()`, `marketWithdraw()` — market lifecycle operations
- **Precog Market**: `reportResult()`, `result()`, `oracle()`, `withdraw()` — individual market resolution
- **Read operations**: `fetchOnchainMarketData()`, `fetchMarketResult()`, `fetchPendingBalances()` — via viem public client

### Indexer (`src/lib/indexer.ts`)

GraphQL subgraph for querying onchain market state:
- `fetchOnchainMarkets(chainId, options)` — paginated market list with filter/sort
- Returns: id, onchainId, name, category, timestamps, resolvedTo, volume, participants

### Sync flow (`src/lib/sync-deployed.ts`)

Two sync modes:
- **`syncMarketStats()`** — lightweight: updates volume, participants, status from indexer. Transitions: `open → in_resolution` (past endTimestamp), `open/in_resolution → closed` (resolvedTo > 0)
- **`syncDeployedMarkets()`** — full: creates/links new markets found onchain, fetches full contract data, expands descriptions via LLM if needed, links candidates to onchain markets by title match

### Dashboard components

- **DeployMarketButton** — deploy market to chain (builds and sends transaction)
- **ResolveOnchainButton** — report resolution result onchain
- **WithdrawLiquidityButton** — withdraw remaining liquidity after resolution
- **MarketDiff** — shows diff between local and onchain market data
- **OnchainActions** — wrapper for all onchain action buttons (wallet-connected)

## Authentication

Cookie-based session auth with `users` and `sessions` tables (30-day expiry, bcrypt hashing). Middleware protects all `/dashboard/*` and `/api/*` routes except `/login`, `/api/inngest`, and `/api/sync-deployed`. Nav only renders when `session_token` cookie exists.

---

## Observability

### Market events (audit trail)

Every state transition and pipeline step is logged to the `market_events` table:

```typescript
const EVENT_TYPES = [
  'pipeline_started', 'pipeline_resumed',
  'data_verified', 'rules_checked', 'scored', 'improved',
  'pipeline_opened', 'pipeline_rejected',
  'human_rejected', 'human_edited', 'human_feedback',
  'human_archived', 'human_unarchived',
  'pipeline_cancelled', 'status_changed',
] as const;
```

Each event includes: `marketId`, `type`, optional `iteration` number, optional `detail` (JSONB), and `createdAt` timestamp. Events are displayed in the market detail page's "Actividad" timeline and used by the monitoring dashboard for live pipeline step tracking and stale detection.

### Sourcing runs

Ingestion pipeline runs are tracked in the `sourcing_runs` table with step-by-step progress:

```typescript
interface SourcingStep {
  name: string;    // 'ingest' | 'mark-used' | 'extract-topics' | 'mark-stale'
  status: string;  // 'pending' | 'running' | 'done' | 'error'
  detail?: string;
}
```

Each run tracks: `status`, `currentStep`, `steps` (JSONB array), `signals` (JSONB), `topics` (JSONB), `signalsCount`, `candidatesGenerated`, `candidatesSaved`, `error`, timestamps.

### Rate limit protection

With a 30k input tokens/min limit on Claude API:
- Review pipeline: `concurrency: 1` (one job at a time) + `throttle: 1 per 2m` (queued, not dropped)
- Anthropic SDK: `maxRetries: 2` (combined with Inngest's 5 retries = max 10 attempts, prevents 5×5=25 cascading retries)

### Key metrics

| Metric | Target | Alert |
|--------|--------|-------|
| Candidates per run | 5-15 | <3 or >25 |
| Candidate → open | 20-40% | <10% |
| Data verification catches | Track | — |
| Timing safety rejects | Track | >50% = fix prompts |
| Resolution accuracy | >90% | <80% |
| Emergency detections | 0 | Any = immediate alert |
| Candidate → open time | <24h | >48h |
| Closed → resolved time | <24h | >48h |

### Audit log

Every state transition is recorded in `market_events` (see above). Each event includes timestamp, type, iteration number, and detail JSONB. The monitoring dashboard and market detail page both read from this table for real-time visibility.

### Cost tracking

Rough estimates (Claude Sonnet pricing at ~$3/M input, $15/M output):
- Sourcer: ~$0.50-1.00 per run (10-15 signals → candidates)
- Reviewer: ~$0.30-0.50 per candidate (verify + rules + score + rewrite)
- Resolver: ~$0.10-0.20 per market per check

**Realistic schedule (not running 24/7):**
With 15-20 concurrent markets lasting 1 week to 4 months, you only need
new candidates when slots open up — not every 3 hours.

| Component | Frequency | Weekly cost |
|-----------|-----------|-------------|
| Sourcer | 2-3 runs/week (on-demand when slots open) | ~$1.50-3.00 |
| Reviewer | ~20-30 candidates/week (triggered by Sourcer) | ~$6.00-15.00 |
| Resolver | Daily checks on 15-20 markets | ~$3.00-7.00 |
| **Total** | | **~$10-25/week ($1.50-3.50/day avg)** |

Spikes on sourcing days, near-zero on quiet days. The Sourcer and Reviewer
can also be triggered manually from the dashboard when you need fresh candidates,
rather than running on a fixed schedule.

---

## Implementation roadmap

### Phase 1: Foundation — DONE
- Next.js project + Vercel deployment
- Drizzle schema + Supabase Postgres
- Claude API wrapper with structured output (`callClaude`, `callClaudeWithSearch`)
- Rules module (`rules.ts`, `contingencies.ts`, `scoring.ts`)
- Dashboard UI
- `toDeployableMarket()` export function

### Phase 2: Reviewer Agent — DONE
- Data verification step (web search via Claude tool-use)
- Hard rules checker (H1-H12)
- Quality scorer with timing safety (weighted scoring)
- Iterative improvement pass (up to 3 iterations of improve → re-check → re-score)
- Inngest step function with throttle, concurrency, cancelOn
- Dashboard: approve/reject/edit/cancel/resume flow
- Deployable JSON preview + export
- Market events audit trail

### Phase 3: Sourcer Agent — DONE
- Multi-source ingestion: RSS (6 Argentine publications), BCRA API, Ámbito Financiero (dólar blue), X/Twitter trends
- Signal persistence in DB with scoring (LLM rates 0-10)
- Topic extraction layer (LLM clusters signals into topics)
- Topic management: feedback, rescoring, stale detection, dismissal
- LLM market generation with deduplication (OpenAI embeddings)
- Feedback learning loop: global instructions + rejection history + conversational feedback loaded into generation prompts
- Cron-based ingestion: daily midnight (full) + hourly (light) + manual trigger
- Separate ingestion and generation jobs for flexibility
- Topic suggestion via Claude web search
- Configurable CANDIDATE_CAP
- Wire to Reviewer via Inngest events (`market/candidate.created`)

### Phase 3.5: Dashboard & UX — DONE
- Dashboard pages: signals, topics, mercados/markets, resolution, monitoring, usage, redemptions, archive
- Signals page with ingestion trigger + run log
- Topics page with management, generation trigger, suggestion
- Conversational market feedback (Claude agent with tool-use)
- Unified feedback page (all types)
- Market archive system
- Authentication (users, sessions, cookie-based)
- Copy-to-clipboard deployable JSON

### Phase 4: Resolution Checker — DONE
- Resolution evaluator with web search + source content fetching
- Emergency settlement detector (LMSR safety)
- Cron-based scheduling (every 6h for eligible markets)
- Resolution feedback system (per-market feedback for evaluator)
- Dashboard: resolution confirmation, dismiss, suggest flows
- Testnet: random resolution for testing
- **Still TODO:** Discord alerts for emergencies

### Phase 5: Polish — PARTIAL
- ✅ Cost tracking and usage dashboard (`/dashboard/usage`)
- ✅ Multi-outcome market support (H11, H12 rules added)
- ✅ MiniChat copilot with 34 tools (global, topic, market, signal contexts)
- ✅ Onchain integration (deploy, resolve, withdraw, sync)
- ✅ DB-backed rules and signal sources (editable from dashboard and chat)
- ✅ Redemptions dashboard (`/dashboard/redemptions`)
- ✅ Prompt tuning from real results (resolution feedback + sourcer rejection history + conversational feedback)
- TODO: Discord notifications (emergencies, resolution events)
- TODO: Newsletter system for market updates to users
