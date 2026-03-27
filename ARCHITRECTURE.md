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
candidate → processing → open → closed → resolved
                ↓          ↘ rejected
            cancelled
```

- `candidate`: awaiting review (fresh or re-queued after cancellation)
- `processing`: review pipeline running in Inngest
- `open`: pipeline passed, market is live
- `rejected`: pipeline rejected or human rejected
- `cancelled`: pipeline cancelled manually or due to stale processing
- `closed` → `resolved`: market betting closed, then outcome determined

No VOID state. Markets always resolve Si or No. Markets are never refunded or declared invalid.

### Deployment format (final output)

The system must produce markets in this exact format for deployment:

```typescript
interface DeployableMarket {
  name: string;          // "¿Vencerá River Plate a Vélez por la Fecha 6?"
  description: string;   // Resolution criteria, edge cases, source — all in one field
  category: string;      // "Deportes", "Política", "Economía", "Entretenimiento", "Clima"
  outcomes: ['Si', 'No'];
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
  status: 'candidate' | 'processing' | 'open' | 'closed' | 'resolved' | 'rejected' | 'cancelled';

  // Core content (Spanish) — kept separate for agent validation
  title: string;                    // Maps to `name` on export
  description: string;              // Context and background
  resolutionCriteria: string;       // "Se resolverá como Sí si..."
  resolutionSource: string;         // Name + URL of the source
  contingencies: string;            // Edge case handling
  category: MarketCategory;
  tags: string[];
  outcomes: ['Si', 'No'];

  // Timing
  endTimestamp: number;             // Unix seconds — when market closes
  expectedResolutionDate?: string;  // When the real-world event is expected to settle
  timingSafety: 'safe' | 'caution' | 'dangerous';

  // Lifecycle timestamps
  createdAt: string;
  publishedAt?: string;
  closedAt?: string;
  resolvedAt?: string;
  outcome?: 'Si' | 'No';

  // Sourcing metadata
  sourceContext: {
    originType: 'news' | 'social' | 'event_calendar' | 'trending' | 'data_api' | 'manual';
    originUrl?: string;
    originText?: string;
    generatedAt: string;
  };

  // Review results
  review?: {
    scores: ReviewScores;
    hardRuleResults: RuleResult[];
    softRuleResults: RuleResult[];
    dataVerification: DataVerification[];
    suggestedRewrites?: {
      title?: string;
      description?: string;
      resolutionCriteria?: string;
      contingencies?: string;
    };
    reviewedAt: string;
  };

  // Resolution tracking
  resolution?: {
    evidence: string;
    evidenceUrls: string[];
    confidence: 'high' | 'medium' | 'low';
    suggestedOutcome: 'Si' | 'No';
    flaggedAt: string;
    confirmedBy?: string;
    confirmedAt?: string;
  };
}

type MarketCategory = 'Política' | 'Economía' | 'Deportes' | 'Entretenimiento' | 'Clima';
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

## Market rules (skill module: `rules.ts`)

Rules are a standalone module loaded by agents at runtime. Iterate on rules without touching agent code.

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
    description: 'Both Si and No must be plausible outcomes',
    check: `Evaluate whether both outcomes are genuinely possible. Flag if one
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

Three ingestion streams run in parallel, all persisted to the `signals` table (upsert by URL):

| Stream | File | Source | Signal type |
|--------|------|--------|-------------|
| News | `ingestion-news.ts` | RSS feeds (Clarín, La Nación, Infobae, El Cronista, Olé, Ámbito) | `news` |
| Economic data | `ingestion-data.ts` | BCRA API (reserves, official dollar, monetary base) + Ámbito Financiero (dólar blue) | `data` |
| Twitter/X trends | `ingestion-twitter.ts` | X API v2 trending topics (Argentina WOEID) | `social` |

Feed URLs, BCRA variables, and X API config are in `src/config/sources.ts`.

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
Monitor open markets for settling events. Flag for human confirmation. Emergency detection for LMSR safety. **Also monitors schedule/fixture changes that could create early-settlement risk.**

### Scanning tiers

| Tier | Frequency | Targets |
|------|-----------|---------|
| Regular | Every 6 hours | All open markets — check for resolution evidence |
| Urgent | Every 1 hour | Markets closing within 72h, or `timingSafety: 'caution'` |
| Emergency | Every 15 minutes | Markets previously flagged as `unclear` with partial evidence |
| Fixture watch | Every 2 hours | Sports/event markets — check if the event has been rescheduled |

With 15-20 concurrent markets, this is lightweight — a few LLM calls per scan.

### Fixture / schedule monitoring (sports + events)

For any open market tied to a scheduled event (match, vote, announcement), the Resolution Checker must monitor for rescheduling. This is separate from the resolution check — it's about detecting LMSR timing risk.

```typescript
// Runs every 2 hours for open sports/event markets
async function checkFixtureChanges(market: Market) {
  // Search for schedule changes
  const queries = [
    `${extractEventName(market)} reprogramado`,
    `${extractEventName(market)} nueva fecha`,
    `${extractEventName(market)} cambio horario`,
  ];
  const results = await webSearch(queries);

  const evaluation = await llm.evaluate({
    prompt: `¿Se reprogramó este evento? Si sí, ¿a qué fecha/hora?
             Evento original: ${market.title}
             Fecha original: ${timestampToART(market.endTimestamp)}
             Resultados de búsqueda: ${results}`,
  });

  if (evaluation.rescheduled && evaluation.newDate < market.endTimestamp) {
    // Event moved EARLIER — EMERGENCY
    await sendEmergencyAlert(market, {
      type: 'fixture_rescheduled_earlier',
      originalDate: market.endTimestamp,
      newDate: evaluation.newDate,
      source: evaluation.sourceUrl,
      action: 'CLOSE MARKET IMMEDIATELY and update endTimestamp',
    });
  }
}

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

### Emergency alert flow

If `isEmergency: true`:
1. Immediate Slack notification with market details, evidence, and recommended action
2. Optional: WhatsApp/Telegram alert to admin
3. Log everything for audit

**For fixture rescheduling emergencies specifically:**
The alert must include:
- The market name and current endTimestamp
- The new event date/time
- A direct link to update the market's closing date
- Urgency level: if the new date is within 24h, this is critical

The human must then:
1. Update the market's `endTimestamp` to before the rescheduled event
2. Optionally notify active traders of the schedule change

### Deadline handling

Markets past `endTimestamp` where the YES condition was not met → auto-flag as `suggestedOutcome: 'No'` with `confidence: 'high'`.

---

## Tech stack (Vercel-deployable)

```
Framework:         Next.js 16 (App Router) + TypeScript strict + Tailwind v4
Deployment:        Vercel
Database:          Supabase Postgres (RLS enabled on all tables)
ORM:               Drizzle (postgres.js driver)
Job orchestration: Inngest (step functions, throttle, cancelOn, concurrency, cron)
LLM:               Claude API (claude-sonnet-4-20250514, maxRetries: 2)
Web search:        Anthropic tool-use web search (web_search_20250305)
Embeddings:        OpenAI text-embedding-3-small (deduplication)
X/Twitter:         X API v2 (trending topics)
Auth:              Cookie-based sessions (users + sessions tables)
Notifications:     TODO (Slack webhook planned)
```

### Why this stack

- **Vercel + Next.js**: Zero infra management. Dashboard UI + API routes in one project.
- **Inngest over raw Vercel Cron**: Vercel Cron triggers functions but doesn't handle retries, queuing, or step functions. Inngest gives reliable retries, step functions (critical for pipelines exceeding 60s), event-driven triggers, throttling, and cancellation.
- **Claude Sonnet for all agents**: Best reasoning-to-cost ratio. Strong Spanish. Structured output via tool_use.

### Project structure

```
predmarks-market-agents/
├── src/
│   ├── app/
│   │   ├── layout.tsx                        # Root layout with session-aware nav
│   │   ├── _components/                      # Shared UI components
│   │   ├── api/
│   │   │   ├── markets/
│   │   │   │   ├── route.ts                  # GET list, POST create
│   │   │   │   ├── expand/route.ts           # POST — LLM fills missing market fields
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts              # GET detail, PATCH update
│   │   │   │       ├── approve/route.ts      # POST approve
│   │   │   │       ├── reject/route.ts       # POST reject
│   │   │   │       ├── resolve/route.ts      # POST confirm resolution
│   │   │   │       ├── edit/route.ts         # POST edit + optional auto-approve
│   │   │   │       ├── feedback/route.ts     # POST conversational feedback (Claude agent)
│   │   │   │       ├── cancel/route.ts       # POST cancel processing
│   │   │   │       ├── resume/route.ts       # POST resume cancelled
│   │   │   │       ├── archive/route.ts      # POST archive completed market
│   │   │   │       └── unarchive/route.ts    # POST restore archived market
│   │   │   ├── review/[id]/route.ts          # POST trigger review pipeline
│   │   │   ├── export/[id]/route.ts          # GET deployable JSON
│   │   │   ├── topics/
│   │   │   │   ├── route.ts                  # GET list active/stale topics
│   │   │   │   ├── suggest/route.ts          # POST trigger topic suggestion job
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts              # GET topic + linked signals
│   │   │   │       ├── dismiss/route.ts      # POST dismiss topic
│   │   │   │       └── feedback/route.ts     # POST add feedback + auto-rescore
│   │   │   ├── generate/route.ts             # POST trigger market generation from topics
│   │   │   ├── feedback/
│   │   │   │   └── all/route.ts              # GET unified feed of all feedback types
│   │   │   ├── global-feedback/
│   │   │   │   ├── route.ts                  # GET/POST global instructions
│   │   │   │   └── [id]/route.ts             # DELETE global feedback entry
│   │   │   ├── monitoring/
│   │   │   │   └── activity/route.ts         # GET market monitor data + counts
│   │   │   ├── sourcing/
│   │   │   │   ├── route.ts                  # POST trigger ingestion pipeline
│   │   │   │   └── status/route.ts           # GET sourcing run history
│   │   │   └── inngest/route.ts              # Inngest webhook
│   │   └── dashboard/
│   │       ├── page.tsx                      # Kanban board (Topics → Candidates → Proposals → Open)
│   │       ├── _components/                  # Shared: StatusBadge, TimingSafetyIndicator
│   │       ├── signals/page.tsx              # Signal ingestion: trigger + run log
│   │       ├── topics/page.tsx               # Topic management: list, generate, dismiss, suggest
│   │       ├── feedback/page.tsx             # Unified feedback feed + global instructions
│   │       ├── mercados/page.tsx              # Markets list
│   │       ├── open/page.tsx                 # Open markets with time-remaining indicator
│   │       ├── archive/page.tsx              # Archived markets with search/filter
│   │       ├── markets/[id]/
│   │       │   ├── page.tsx                  # Market detail + feedback chat + JSON export
│   │       │   └── _components/
│   │       │       ├── MarketActions.tsx      # Review/cancel/resume/approve/reject/resolve
│   │       │       └── CopyJsonButton.tsx    # Copy deployable JSON to clipboard
│   │       ├── monitoring/page.tsx           # Redirects to /signals
│   │       └── suggest/page.tsx              # Redirects to /topics
│   ├── agents/
│   │   ├── sourcer/
│   │   │   ├── index.ts                      # Pipeline orchestrator + CANDIDATE_CAP
│   │   │   ├── types.ts                      # SourceSignal, DataPoint, Topic, GeneratedCandidate
│   │   │   ├── ingestion.ts                  # Coordinator: runs all 3 streams in parallel
│   │   │   ├── ingestion-news.ts             # RSS feed parser (6 Argentine publications)
│   │   │   ├── ingestion-data.ts             # BCRA API + Ámbito Financiero (dólar blue)
│   │   │   ├── ingestion-twitter.ts          # X API v2 trending topics
│   │   │   ├── scorer.ts                     # LLM signal scoring + topic rescoring
│   │   │   ├── topic-extractor.ts            # LLM topic clustering + stale detection
│   │   │   ├── generator.ts                  # LLM market generation (loads feedback + rejections)
│   │   │   └── deduplication.ts              # OpenAI embedding cosine similarity
│   │   └── reviewer/
│   │       ├── index.ts
│   │       ├── types.ts                      # MarketRecord type
│   │       ├── data-verifier.ts
│   │       ├── rules-checker.ts
│   │       ├── scorer.ts
│   │       └── improver.ts                   # Iterative market improvement
│   ├── config/
│   │   ├── rules.ts                          # H1-H9 hard rules, S1-S6 soft rules
│   │   ├── contingencies.ts                  # Standard contingency templates
│   │   ├── scoring.ts                        # Weights and thresholds
│   │   └── sources.ts                        # RSS_FEEDS, BCRA_VARIABLES, X API config
│   ├── db/
│   │   ├── schema.ts                         # All 8 tables (see schema section)
│   │   ├── types.ts                          # All shared types (Market, Review, EventTypes, etc.)
│   │   └── client.ts                         # Drizzle client (postgres.js driver)
│   ├── lib/
│   │   ├── llm.ts                            # Claude API wrapper (maxRetries: 2)
│   │   ├── market-events.ts                  # logMarketEvent() helper
│   │   └── export.ts                         # toDeployableMarket()
│   └── inngest/
│       ├── client.ts                         # Inngest singleton (id: 'predmarks-agents')
│       ├── review-job.ts                     # Event-driven review with throttle + cancelOn
│       ├── ingestion-job.ts                  # Cron (Mon/Wed/Fri 9am) + manual signal ingestion
│       ├── generation-job.ts                 # Manual market generation from topics
│       └── suggest-topic-job.ts              # Manual topic suggestion via Claude web search
├── drizzle.config.ts
├── package.json
└── .env                                      # POSTGRES_URL + ANTHROPIC_API_KEY + OPENAI_API_KEY + X_BEARER_TOKEN
```

### Inngest job orchestration

Four jobs registered in the Inngest webhook (`src/app/api/inngest/route.ts`):

```typescript
// src/inngest/ingestion-job.ts
export const ingestionJob = inngest.createFunction(
  { id: 'ingestion-pipeline', retries: 1 },
  [
    { cron: '0 9 * * 1,3,5' },              // Mon/Wed/Fri 9am
    { event: 'signals/ingest.requested' },   // Manual from dashboard
  ],
  async ({ step }) => {
    // Tracked in sourcingRuns table with step-by-step progress
    const signals = await step.run('ingest', () => ingestAllSources());
    await step.run('mark-used', () => markSignalsUsed(runId));
    const topics = await step.run('extract-topics', () => updateTopics(signals));
    await step.run('mark-stale', () => markStaleTopics());
    // Returns: { status, runId, topicIds }
  }
);

// src/inngest/generation-job.ts
export const generationJob = inngest.createFunction(
  { id: 'generation-pipeline' },
  { event: 'markets/generate.requested' },   // Manual or post-ingestion
  async ({ event, step }) => {
    // event.data: { topicIds?: string[], count?: number }
    const topics = await step.run('load-topics', () => /* by ID or active with fresh signals */);
    const openMarkets = await step.run('load-open', () => /* open markets */);

    const candidates = await step.run('generate', () => generateMarkets(topics, dataPoints, openTitles));
    const unique = await step.run('dedup', () => deduplicateCandidates(candidates, openMarkets));
    const ids = await step.run('save', () => saveCandidates(unique));
    await step.run('update-topics', () => /* set lastGeneratedAt on used topics */);
    // Returns: { status, candidates: count, savedIds }
    // Each saved candidate triggers market/candidate.created → review pipeline
  }
);

// src/inngest/suggest-topic-job.ts
export const suggestTopicJob = inngest.createFunction(
  { id: 'suggest-topic' },
  { event: 'topics/suggest.requested' },     // Manual from dashboard
  async ({ event, step }) => {
    // event.data: { description: string, count?: number }
    const research = await step.run('research', () => /* Claude web search */);
    const topic = await step.run('save-topic', () => /* persist to topics table */);
    const candidates = await step.run('generate', () => /* generate N markets from topic */);
    await step.run('save-candidates', () => /* persist to markets table */);
    // Returns: { topicId, candidatesCount }
  }
);

// src/inngest/review-job.ts
export const reviewJob = inngest.createFunction(
  {
    id: 'review-pipeline',
    retries: 5,
    concurrency: { limit: 1 },              // Only 1 review at a time
    throttle: { limit: 1, period: '2m' },    // Max 1 start per 2 min (rate limit protection)
    cancelOn: [{                             // Cancel via event from dashboard
      event: 'market/review.cancel',
      if: 'async.data.id == event.data.id',
    }],
  },
  { event: 'market/candidate.created' },
  async ({ event, step }) => {
    // Iterative pipeline: verify → check rules → score → (improve → re-check → re-score) → propose/reject
    // Loads human feedback, global feedback, and triage rejections for context
    // Supports resume: loads iteration state from DB, skips completed iterations
    // Emits marketEvents at each step for monitoring dashboard
    // Max 3 iterations of improve → re-check → re-score before final decision
    // Hard rule failure on unfixable rules → immediate rejection
    // Score >= passingScore threshold → promote to 'open'
    // Returns: { status: 'open'|'rejected', marketId, iteration, score }
  }
);

// Resolution jobs — TODO (see Agent 3: Resolution Checker spec)
```

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

### Feedback page (`/dashboard/feedback`)

Unified feedback feed showing all types:
- Global instructions (add/view/delete)
- Market rejections with reasons
- Market-specific conversational feedback
- Topic feedback and dismissals

### Other pages

- `/dashboard/mercados` — markets list
- `/dashboard/open` — open markets sorted by `endTimestamp` with time-remaining indicator
- `/dashboard/archive` — archived markets with search/filter by title and status
- `/dashboard/monitoring` → redirects to `/dashboard/signals`
- `/dashboard/suggest` → redirects to `/dashboard/topics`

### Market detail page (`/dashboard/markets/[id]`)

Full market info + activity timeline + conversational feedback chat:
- All review data, iteration history, scores
- **Human feedback chat** — conversational interface powered by Claude agent with tool-use (`save_feedback` tool). Editors can discuss the market; Claude provides analysis and persists key insights.
- **Copy JSON button** — copies deployable JSON to clipboard
- Context-aware action buttons: review, cancel, resume, approve, reject, edit, resolve, archive

Events are logged via `logMarketEvent()` at each pipeline step and API action:
- Pipeline events: `pipeline_started`, `pipeline_resumed`, `data_verified`, `rules_checked`, `scored`, `improved`, `pipeline_proposed`, `pipeline_rejected`, `pipeline_cancelled`
- Human actions: `human_rejected`, `human_edited`, `human_feedback`, `archived`, `unarchived`

Stale detection: processing markets with no events in 5+ min are flagged as "Estancado" with a resume button.

### API endpoints

**Markets**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/markets` | List markets (with `?status=` filter), create new market |
| GET/PATCH | `/api/markets/:id` | Full detail / generic update |
| POST | `/api/markets/:id/reject` | Reject market |
| POST | `/api/markets/:id/reject` | Reject with optional reason |
| POST | `/api/markets/:id/edit` | Human edits + optional auto-approve |
| POST | `/api/markets/:id/feedback` | Conversational feedback (Claude agent with `save_feedback` tool) |
| POST | `/api/markets/:id/resolve` | Confirm resolution (Si or No) |
| POST | `/api/markets/:id/cancel` | Cancel processing → sends Inngest cancel event |
| POST | `/api/markets/:id/resume` | Resume cancelled → back to candidate |
| POST | `/api/markets/:id/archive` | Archive completed market |
| POST | `/api/markets/:id/unarchive` | Restore archived market |
| POST | `/api/markets/expand` | LLM fills missing fields for manual market creation |
| POST | `/api/review/:id` | Trigger review pipeline for a candidate |
| GET | `/api/export/:id` | Get deployable JSON for a market |

**Topics**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/topics` | List active/stale topics ordered by score |
| GET | `/api/topics/:id` | Topic detail + linked signals |
| POST | `/api/topics/:id/dismiss` | Dismiss topic (optional reason → feedback) |
| POST | `/api/topics/:id/feedback` | Add feedback + auto-rescore via LLM |
| POST | `/api/topics/suggest` | Trigger topic suggestion job (Claude web search) |

**Generation & Sourcing**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/generate` | Trigger market generation from topics |
| POST | `/api/sourcing` | Trigger signal ingestion pipeline |
| GET | `/api/sourcing/status` | Sourcing run history (list or single-run detail) |

**Feedback**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/global-feedback` | List / add global instructions |
| DELETE | `/api/global-feedback/:id` | Delete global feedback entry |
| GET | `/api/feedback/all` | Unified feed of all feedback types |

**Monitoring**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/monitoring/activity` | Market monitor data with status counts, stale detection |

---

## Database schema

8 tables, all with RLS enabled:

| Table | Purpose |
|-------|---------|
| `markets` | Core market data: content, timing, status, review results (JSONB), iterations (JSONB), resolution (JSONB), `isArchived` flag |
| `marketEvents` | Audit trail: every pipeline step + human action with type, iteration, detail (JSONB) |
| `sourcingRuns` | Ingestion pipeline runs with step-by-step progress, signal/candidate counts, error tracking |
| `signals` | Ingested signals from all sources. Upsert by URL. Includes `dataPoints[]`, `score`, `scoreReason`, `usedInRun` FK |
| `topics` | Extracted themes: name, slug (unique), summary, `suggestedAngles[]`, category, score, status (active/stale/dismissed), `feedback` (JSONB array), `lastSignalAt`, `lastGeneratedAt` |
| `topicSignals` | Junction table linking topics ↔ signals |
| `globalFeedback` | Persistent editor instructions loaded by generation agent |
| `users` / `sessions` | Authentication: username/password hash, cookie-based session tokens |

Key indexes: `markets(status)`, `markets(status, createdAt)`, `signals(url)` unique, `signals(createdAt)`, `signals(score)`, `topics(status)`, `topics(score)`.

---

## Feedback & learning system

The system has a multi-layered feedback loop that improves market generation over time:

1. **Global feedback** (`globalFeedback` table) — Persistent editor instructions (e.g., "avoid markets about cryptocurrency"). Loaded by the generator agent on every run.
2. **Rejection feedback** — When editors reject markets, the reason is logged as a `marketEvent`. The generator loads recent rejections (30 days) to avoid repeating mistakes.
3. **Market conversational feedback** — Claude-powered chat on each market's detail page. The editor discusses the market; Claude analyzes it and uses a `save_feedback` tool to persist key insights.
4. **Topic feedback** — Editors can leave feedback on topics. `rescoreTopic()` re-evaluates the topic's score considering the new feedback.
5. **Topic dismissal** — Editors can dismiss topics entirely (with optional reason), preventing further market generation from them.

This creates a learning loop: editor feedback → persisted insights → loaded into generation prompts → better candidates.

---

## Authentication

Cookie-based session auth with `users` and `sessions` tables. Basic auth middleware protects dashboard and API routes. Nav only renders when `session_token` cookie exists.

---

## Observability

### Market events (audit trail)

Every state transition and pipeline step is logged to the `market_events` table:

```typescript
const EVENT_TYPES = [
  'pipeline_started', 'pipeline_resumed',
  'data_verified', 'rules_checked', 'scored', 'improved',
  'pipeline_proposed', 'pipeline_rejected',
  'human_rejected', 'human_edited',
  'human_feedback', 'pipeline_cancelled',
  'archived', 'unarchived',
  'status_changed',
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
- Hard rules checker (H1-H9)
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
- Cron-based ingestion (Mon/Wed/Fri 9am) + manual trigger
- Separate ingestion and generation jobs for flexibility
- Topic suggestion via Claude web search
- Configurable CANDIDATE_CAP
- Wire to Reviewer via Inngest events (`market/candidate.created`)

### Phase 3.5: Dashboard & UX — DONE
- Kanban pipeline board (Topics → Candidates → Proposals → Open)
- Signals page with ingestion trigger + run log
- Topics page with management, generation trigger, suggestion
- Conversational market feedback (Claude agent with tool-use)
- Unified feedback page (all types)
- Market archive system
- Authentication (users, sessions, cookie-based)
- Copy-to-clipboard deployable JSON

### Phase 4: Resolution Checker — TODO
- Search query builder
- Resolution evaluator
- Emergency settlement detector
- Fixture/schedule change monitoring
- Tiered scheduling (6h / 1h / 15min)
- Dashboard: resolution confirmation
- Slack alerts

### Phase 5: Polish — TODO
- Prompt tuning from real results
- Multiple-choice market support
- Weather market pipeline optimization
- Cost tracking and metrics dashboard
