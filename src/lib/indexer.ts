export interface OnchainMarket {
  id: string;
  onchainId: string;
  name: string;
  category: string;
  startTimestamp: number;
  endTimestamp: number;
  resolvedTo: number;
  volume: string;
  participants: number;
}

// Subgraph returns numeric fields as strings — coerce after fetch
type RawOnchainMarket = {
  [K in keyof OnchainMarket]: OnchainMarket[K] extends number ? string | number : OnchainMarket[K];
};

function coerceMarket(raw: RawOnchainMarket): OnchainMarket {
  return {
    ...raw,
    startTimestamp: Number(raw.startTimestamp),
    endTimestamp: Number(raw.endTimestamp),
    resolvedTo: Number(raw.resolvedTo),
    participants: Number(raw.participants),
  };
}

const PAGE_SIZE = 100;

const MARKET_LIST_QUERY = `
  query MarketList(
    $limit: Int!
    $skip: Int!
    $where: Market_filter
    $orderBy: Market_orderBy!
    $orderDirection: OrderDirection!
  ) {
    markets(
      first: $limit
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
      where: $where
    ) {
      id
      onchainId
      name
      category
      startTimestamp
      endTimestamp
      resolvedTo
      volume
      participants
    }
  }
`;

interface IndexerResponse<T> {
  data: T;
  errors?: { message: string }[];
}

import { MAINNET_CHAIN_ID } from './chains';

function getIndexerUrl(chainId: number): string {
  if (chainId === MAINNET_CHAIN_ID) {
    const url = process.env.INDEXER_URL;
    if (!url) throw new Error('INDEXER_URL is not set');
    return url;
  }
  const url = process.env.INDEXER_URL_SEPOLIA;
  if (!url) throw new Error('INDEXER_URL_SEPOLIA is not set');
  return url;
}

async function queryIndexer<T>(chainId: number, query: string, variables: Record<string, unknown>): Promise<T> {
  const url = getIndexerUrl(chainId);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const apiKey = process.env.INDEXER_API_KEY;
  if (apiKey) {
    const headerName = process.env.INDEXER_AUTH_HEADER ?? 'Authorization';
    const prefix = process.env.INDEXER_AUTH_PREFIX ?? 'Bearer';
    headers[headerName] = `${prefix} ${apiKey}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Indexer request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as IndexerResponse<T>;

  if (json.errors?.length) {
    throw new Error(`Indexer GraphQL error: ${json.errors[0].message}`);
  }

  return json.data;
}

interface FetchMarketsOptions {
  where?: Record<string, unknown>;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

// --- Unredeemed positions ---

export interface UnredeemedPosition {
  id: string;
  account: string;
  shares: string;
  invested: string;
  lastEventTimestamp: number;
}

const UNREDEEMED_POSITIONS_QUERY = `
  query UnredeemedPositions(
    $limit: Int!
    $skip: Int!
    $market: String!
    $outcome: Int!
  ) {
    accountPositions(
      first: $limit
      skip: $skip
      where: {
        market: $market
        outcome: $outcome
        isRedeemed: false
        shares_gt: "10000"
      }
      orderBy: shares
      orderDirection: desc
    ) {
      id
      account
      shares
      invested
      lastEventTimestamp
    }
  }
`;

type RawUnredeemedPosition = {
  id: string;
  account: string;
  shares: string;
  invested: string;
  lastEventTimestamp: string | number;
};

export async function fetchUnredeemedPositions(
  chainId: number,
  marketAddress: string,
  winningOutcome: number,
): Promise<UnredeemedPosition[]> {
  const all: UnredeemedPosition[] = [];
  let skip = 0;
  const market = marketAddress.toLowerCase();

  while (true) {
    const { accountPositions } = await queryIndexer<{ accountPositions: RawUnredeemedPosition[] }>(
      chainId,
      UNREDEEMED_POSITIONS_QUERY,
      { limit: PAGE_SIZE, skip, market, outcome: winningOutcome },
    );
    all.push(
      ...accountPositions.map((p) => ({
        ...p,
        lastEventTimestamp: Number(p.lastEventTimestamp),
      })),
    );
    if (accountPositions.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  return all;
}

const ALL_UNREDEEMED_QUERY = `
  query AllUnredeemedPositions($limit: Int!, $skip: Int!) {
    accountPositions(
      first: $limit
      skip: $skip
      where: {
        isRedeemed: false
        shares_gt: "10000"
      }
      orderBy: shares
      orderDirection: desc
    ) {
      id
      account
      shares
      invested
      outcome
      market {
        id
        onchainId
        name
        resolvedTo
      }
    }
  }
`;

type RawUnredeemedWithMarket = RawUnredeemedPosition & {
  outcome: number;
  market: { id: string; onchainId: string; name: string; resolvedTo: number };
};

export interface MarketRedemptionSummary {
  marketAddress: string;
  onchainId: string;
  marketName: string;
  resolvedTo: number;
  unredeemedCount: number;
  totalUnredeemedShares: bigint;
  totalUnredeemedInvested: bigint;
  positions: UnredeemedPosition[];
}

export async function fetchMarketsWithUnredeemedWinners(
  chainId: number,
): Promise<MarketRedemptionSummary[]> {
  // Fetch all unredeemed positions
  const all: RawUnredeemedWithMarket[] = [];
  let skip = 0;

  while (true) {
    const { accountPositions } = await queryIndexer<{ accountPositions: RawUnredeemedWithMarket[] }>(
      chainId,
      ALL_UNREDEEMED_QUERY,
      { limit: PAGE_SIZE, skip },
    );
    all.push(...accountPositions);
    if (accountPositions.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  // Keep only winning positions on resolved markets
  // Both outcome and resolvedTo use the same 1-indexed scheme from the contract
  const winning = all.filter(
    (p) => Number(p.market.resolvedTo) > 0 && Number(p.outcome) === Number(p.market.resolvedTo),
  );

  // Group by market
  const byMarket = new Map<string, { market: RawUnredeemedWithMarket['market']; positions: RawUnredeemedWithMarket[] }>();
  for (const p of winning) {
    const key = p.market.id;
    if (!byMarket.has(key)) {
      byMarket.set(key, { market: p.market, positions: [] });
    }
    byMarket.get(key)!.positions.push(p);
  }

  return Array.from(byMarket.values()).map(({ market, positions }) => ({
    marketAddress: market.id,
    onchainId: market.onchainId,
    marketName: market.name,
    resolvedTo: market.resolvedTo,
    unredeemedCount: positions.length,
    totalUnredeemedShares: positions.reduce((sum, p) => sum + BigInt(p.shares), BigInt(0)),
    totalUnredeemedInvested: positions.reduce((sum, p) => sum + BigInt(p.invested), BigInt(0)),
    positions: positions.map((p) => ({
      id: p.id,
      account: p.account,
      shares: p.shares,
      invested: p.invested,
      lastEventTimestamp: Number(p.lastEventTimestamp),
    })),
  }));
}

// --- Owned participants per market ---

const OWNED_POSITIONS_QUERY = `
  query OwnedPositions($limit: Int!, $skip: Int!, $accounts: [String!]!) {
    accountPositions(
      first: $limit
      skip: $skip
      where: { account_in: $accounts, shares_gt: "0" }
    ) {
      market { id }
      account
    }
  }
`;

/**
 * Fetch how many owned addresses participate in each market.
 * Returns a Map of marketAddress (lowercase) -> distinct owned participant count.
 */
export async function fetchOwnedParticipantsByMarket(
  chainId: number,
  ownedAddresses: string[],
): Promise<Map<string, number>> {
  if (ownedAddresses.length === 0) return new Map();

  const accounts = ownedAddresses.map((a) => a.toLowerCase());
  const all: { market: { id: string }; account: string }[] = [];
  let skip = 0;

  while (true) {
    const { accountPositions } = await queryIndexer<{
      accountPositions: { market: { id: string }; account: string }[];
    }>(chainId, OWNED_POSITIONS_QUERY, { limit: PAGE_SIZE, skip, accounts });
    all.push(...accountPositions);
    if (accountPositions.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  // Group by market, count distinct accounts
  const byMarket = new Map<string, Set<string>>();
  for (const p of all) {
    const key = p.market.id.toLowerCase();
    if (!byMarket.has(key)) byMarket.set(key, new Set());
    byMarket.get(key)!.add(p.account.toLowerCase());
  }

  const result = new Map<string, number>();
  for (const [marketAddr, accounts] of byMarket) {
    result.set(marketAddr, accounts.size);
  }
  return result;
}

// --- Detailed owned positions (for PnL analytics) ---

export interface OwnedPositionDetail {
  marketAddress: string;
  onchainId: string;
  resolvedTo: number;
  account: string;
  outcome: number;
  shares: string;
  invested: string;
  withdrew: string;
  isRedeemed: boolean;
}

const OWNED_POSITIONS_DETAILED_QUERY = `
  query OwnedPositionsDetailed($limit: Int!, $skip: Int!, $accounts: [String!]!) {
    accountPositions(
      first: $limit
      skip: $skip
      where: { account_in: $accounts, shares_gt: "0" }
    ) {
      market { id onchainId resolvedTo }
      account
      outcome
      shares
      invested
      withdrew
      isRedeemed
    }
  }
`;

type RawOwnedPositionDetail = {
  market: { id: string; onchainId: string; resolvedTo: string | number };
  account: string;
  outcome: string | number;
  shares: string;
  invested: string;
  withdrew: string;
  isRedeemed: boolean;
};

export async function fetchOwnedPositionsDetailed(
  chainId: number,
  ownedAddresses: string[],
): Promise<OwnedPositionDetail[]> {
  if (ownedAddresses.length === 0) return [];

  const accounts = ownedAddresses.map((a) => a.toLowerCase());
  const all: OwnedPositionDetail[] = [];
  let skip = 0;

  while (true) {
    const { accountPositions } = await queryIndexer<{ accountPositions: RawOwnedPositionDetail[] }>(
      chainId,
      OWNED_POSITIONS_DETAILED_QUERY,
      { limit: PAGE_SIZE, skip, accounts },
    );
    all.push(
      ...accountPositions.map((p) => ({
        marketAddress: p.market.id.toLowerCase(),
        onchainId: p.market.onchainId,
        resolvedTo: Number(p.market.resolvedTo),
        account: p.account,
        outcome: Number(p.outcome),
        shares: p.shares,
        invested: p.invested,
        withdrew: p.withdrew,
        isRedeemed: p.isRedeemed,
      })),
    );
    if (accountPositions.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  return all;
}

// --- Market creation tx hashes (for seeded amount lookup) ---

const MARKET_TX_HASHES_QUERY = `
  query MarketTxHashes($addresses: [String!]!) {
    markets(where: { id_in: $addresses }) {
      id
      txHash
    }
  }
`;

/**
 * Fetch creation transaction hashes for markets by their onchain address.
 * Returns a Map of marketAddress (lowercase) -> txHash.
 */
export async function fetchMarketTxHashes(
  chainId: number,
  marketAddresses: string[],
): Promise<Map<string, string>> {
  if (marketAddresses.length === 0) return new Map();

  const addresses = marketAddresses.map((a) => a.toLowerCase());
  const result = new Map<string, string>();

  // Query in batches (subgraph may limit array size)
  for (let i = 0; i < addresses.length; i += PAGE_SIZE) {
    const batch = addresses.slice(i, i + PAGE_SIZE);
    const { markets } = await queryIndexer<{ markets: { id: string; txHash: string }[] }>(
      chainId,
      MARKET_TX_HASHES_QUERY,
      { addresses: batch },
    );
    for (const m of markets) {
      result.set(m.id.toLowerCase(), m.txHash);
    }
  }

  return result;
}

export async function fetchOnchainMarkets(chainId: number, options?: FetchMarketsOptions): Promise<OnchainMarket[]> {
  const all: OnchainMarket[] = [];
  let skip = 0;

  const variables = {
    limit: PAGE_SIZE,
    skip: 0,
    where: options?.where ?? {},
    orderBy: options?.orderBy ?? 'startTimestamp',
    orderDirection: options?.orderDirection ?? 'desc',
  };

  while (true) {
    variables.skip = skip;
    const { markets } = await queryIndexer<{ markets: RawOnchainMarket[] }>(chainId, MARKET_LIST_QUERY, variables);
    all.push(...markets.map(coerceMarket));
    if (markets.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  return all;
}

