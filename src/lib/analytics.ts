import { db } from '@/db/client';
import { markets, activityLog } from '@/db/schema';
import { and, eq, isNotNull, isNull, inArray } from 'drizzle-orm';
import { createPublicClient, http, decodeFunctionData, erc20Abi, parseEventLogs } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { PRECOG_MASTER_ABI, COLLATERAL_TOKENS } from './contracts';
import { MAINNET_CHAIN_ID } from './chains';
import { getOwnedAddresses } from './owned-addresses';
import { refreshPendingBalances } from './sync-deployed';
import { fetchOwnedPositionsDetailed, fetchMarketTxHashes, type OwnedPositionDetail } from './indexer';
import type { Resolution } from '@/db/types';

// --- Types ---

export interface MarketPnL {
  marketId: string;
  onchainId: string | null;
  onchainAddress: string | null;
  title: string;
  category: string;
  status: string;
  date: Date | null;
  resolvedDate: Date | null;
  withdrawnAt: Date | null;
  seeded: number;         // USDC (divided by 1e6)
  withdrawn: number;      // USDC withdrawn from market
  pending: number;        // USDC still in market contract
  ownedInvested: number;
  ownedSellProceeds: number;
  ownedValue: number;
  ownedPnL: number;
  liquidityPnL: number;   // (withdrawn + pending) - seeded
  netPnL: number;         // liquidityPnL + ownedPnL
  cumulativePnL: number;  // running total (set after sort)
}

export interface PnLSummary {
  totalSeeded: number;
  totalWithdrawn: number;
  totalPending: number;
  totalOwnedPnL: number;
  totalLiquidityPnL: number;
  netPnL: number;
  marketCount: number;
}

export interface AnalyticsData {
  summary: PnLSummary;
  markets: MarketPnL[];
}

// --- Helpers ---

const USDC_DECIMALS = 1e6;

function toUsdc(raw: string | null | undefined): number {
  if (!raw) return 0;
  return Number(BigInt(raw)) / USDC_DECIMALS;
}

function getClient(chainId: number) {
  const envKey = chainId === MAINNET_CHAIN_ID ? 'PREDMARKS_RPC_URL' : 'PREDMARKS_RPC_URL_SEPOLIA';
  const rpcUrl = process.env[envKey];
  if (!rpcUrl) throw new Error(`${envKey} is not set`);
  const chain = chainId === MAINNET_CHAIN_ID ? base : baseSepolia;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

// --- Fetch and cache seeded amounts from createCustomMarket calldata ---

export async function fetchAndCacheSeededAmounts(chainId: number): Promise<Map<string, bigint>> {
  // Find markets missing seededAmount
  const missing = await db
    .select({ id: markets.id, onchainAddress: markets.onchainAddress })
    .from(markets)
    .where(
      and(
        eq(markets.chainId, chainId),
        isNotNull(markets.onchainAddress),
        isNull(markets.seededAmount),
      ),
    );

  if (missing.length === 0) {
    // All cached — return from DB
    const all = await db
      .select({ onchainAddress: markets.onchainAddress, seededAmount: markets.seededAmount })
      .from(markets)
      .where(and(eq(markets.chainId, chainId), isNotNull(markets.onchainAddress)));

    const result = new Map<string, bigint>();
    for (const m of all) {
      if (m.onchainAddress && m.seededAmount) {
        result.set(m.onchainAddress.toLowerCase(), BigInt(m.seededAmount));
      }
    }
    return result;
  }

  // Fetch creation tx hashes from subgraph, then decode funding from calldata
  const client = getClient(chainId);
  const missingAddresses = missing
    .map((m) => m.onchainAddress)
    .filter((a): a is string => !!a);

  const txHashMap = await fetchMarketTxHashes(chainId, missingAddresses);

  const fundingMap = new Map<string, bigint>();

  for (const [marketAddr, txHash] of txHashMap) {
    try {
      const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
      const decoded = decodeFunctionData({
        abi: PRECOG_MASTER_ABI,
        data: tx.input,
      });

      if (decoded.functionName === 'createCustomMarket') {
        const args = decoded.args as readonly [string, string, string, string[], bigint, bigint, string, bigint, bigint, string, string, string];
        const funding = args[7]; // funding is the 8th param (0-indexed: 7)
        fundingMap.set(marketAddr, funding);
      }
    } catch {
      // Skip if we can't decode (e.g., different function signature)
    }
  }

  // Cache in DB
  for (const m of missing) {
    if (!m.onchainAddress) continue;
    const funding = fundingMap.get(m.onchainAddress.toLowerCase());
    if (funding !== undefined) {
      await db
        .update(markets)
        .set({ seededAmount: funding.toString() })
        .where(eq(markets.id, m.id));
    }
  }

  // Return full map (cached + newly fetched)
  const all = await db
    .select({ onchainAddress: markets.onchainAddress, seededAmount: markets.seededAmount })
    .from(markets)
    .where(and(eq(markets.chainId, chainId), isNotNull(markets.onchainAddress)));

  const result = new Map<string, bigint>();
  for (const m of all) {
    if (m.onchainAddress && m.seededAmount) {
      result.set(m.onchainAddress.toLowerCase(), BigInt(m.seededAmount));
    }
  }
  return result;
}

// --- Fetch and cache deployment dates from creation tx block timestamps ---

export async function fetchAndCacheDeploymentDates(chainId: number): Promise<void> {
  const missing = await db
    .select({ id: markets.id, onchainAddress: markets.onchainAddress })
    .from(markets)
    .where(
      and(
        eq(markets.chainId, chainId),
        isNotNull(markets.onchainAddress),
        isNull(markets.publishedAt),
      ),
    );

  if (missing.length === 0) return;

  const missingAddresses = missing
    .map((m) => m.onchainAddress)
    .filter((a): a is string => !!a);

  const txHashMap = await fetchMarketTxHashes(chainId, missingAddresses);
  if (txHashMap.size === 0) return;

  // Batch-fetch transactions to get blockNumber
  const rpcUrl = chainId === MAINNET_CHAIN_ID ? process.env.PREDMARKS_RPC_URL : process.env.PREDMARKS_RPC_URL_SEPOLIA;
  if (!rpcUrl) return;

  const entries = [...txHashMap.entries()];
  const txBlockMap = new Map<string, string>(); // marketAddr -> blockNumber hex

  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch.map(([, txHash], idx) => ({
        jsonrpc: '2.0', id: idx,
        method: 'eth_getTransactionByHash',
        params: [txHash],
      }))),
    });
    const json = await resp.json() as Array<{
      id: number;
      result?: { blockNumber: string } | null;
    }>;
    for (const item of json) {
      if (item.result?.blockNumber) {
        txBlockMap.set(batch[item.id][0], item.result.blockNumber);
      }
    }
  }

  // Batch-fetch blocks to get timestamps
  const uniqueBlocks = [...new Set(txBlockMap.values())];
  const blockTimestampMap = new Map<string, number>(); // blockNumber hex -> unix timestamp

  for (let i = 0; i < uniqueBlocks.length; i += 50) {
    const batch = uniqueBlocks.slice(i, i + 50);
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch.map((blockNum, idx) => ({
        jsonrpc: '2.0', id: idx,
        method: 'eth_getBlockByNumber',
        params: [blockNum, false],
      }))),
    });
    const json = await resp.json() as Array<{
      id: number;
      result?: { timestamp: string } | null;
    }>;
    for (const item of json) {
      if (item.result?.timestamp) {
        blockTimestampMap.set(batch[item.id], Number(item.result.timestamp));
      }
    }
  }

  // Store publishedAt for each market
  for (const m of missing) {
    if (!m.onchainAddress) continue;
    const addr = m.onchainAddress.toLowerCase();
    const blockHex = txBlockMap.get(addr);
    if (!blockHex) continue;
    const timestamp = blockTimestampMap.get(blockHex);
    if (!timestamp) continue;

    await db
      .update(markets)
      .set({ publishedAt: new Date(timestamp * 1000) })
      .where(eq(markets.id, m.id));
  }
}

// --- Fetch and cache withdrawn amounts from withdrawal tx receipts ---

export interface WithdrawnData {
  amount: bigint;
  withdrawnAt?: string; // ISO timestamp
}

export async function fetchAndCacheWithdrawnAmounts(chainId: number): Promise<Map<string, WithdrawnData>> {
  const allDeployed = await db
    .select({
      id: markets.id,
      onchainAddress: markets.onchainAddress,
      pendingBalance: markets.pendingBalance,
      seededAmount: markets.seededAmount,
      resolution: markets.resolution,
      withdrawnAmount: markets.withdrawnAmount,
    })
    .from(markets)
    .where(and(eq(markets.chainId, chainId), isNotNull(markets.onchainAddress)));

  const result = new Map<string, WithdrawnData>();
  const missingTxHash: { id: string; onchainAddress: string; txHash: string }[] = [];
  const missingNoTxHash: { id: string; onchainAddress: string }[] = [];
  const allMissingIds = new Set<string>();

  for (const m of allDeployed) {
    if (!m.onchainAddress) continue;
    const addr = m.onchainAddress.toLowerCase();
    const res = m.resolution as Resolution | null;

    if (m.withdrawnAmount && m.withdrawnAmount !== '0') {
      const cachedWithdrawnAt = res?.withdrawal?.withdrawnAt;
      result.set(addr, { amount: BigInt(m.withdrawnAmount), withdrawnAt: cachedWithdrawnAt });
      if (cachedWithdrawnAt) continue;
      // Have amount but no date — fall through to passes to find the timestamp
    }

    allMissingIds.add(m.id);
    const txHash = res?.withdrawal?.withdrawTxHash;
    if (txHash) {
      missingTxHash.push({ id: m.id, onchainAddress: addr, txHash });
    } else if (res?.withdrawal?.withdrawnAt) {
      missingNoTxHash.push({ id: m.id, onchainAddress: addr });
    }
  }

  // Pass 1: Decode withdrawal amounts from tx receipts
  if (missingTxHash.length > 0) {
    const client = getClient(chainId);

    for (const m of missingTxHash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: m.txHash as `0x${string}` });
        const transferLogs = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: 'Transfer' });

        const withdrawTransfer = transferLogs.find(
          (log) => log.args.from.toLowerCase() === m.onchainAddress,
        );

        if (withdrawTransfer && withdrawTransfer.args.value > BigInt(0)) {
          const amount = withdrawTransfer.args.value;
          // Get block timestamp for the withdrawal
          const block = await client.getBlock({ blockNumber: receipt.blockNumber });
          const withdrawnAt = new Date(Number(block.timestamp) * 1000).toISOString();
          // Update result — use existing amount if already cached (backfill case)
          const existing = result.get(m.onchainAddress);
          result.set(m.onchainAddress, { amount: existing?.amount ?? amount, withdrawnAt });
          allMissingIds.delete(m.id);
          // Persist both amount and withdrawnAt to DB
          const mRow = allDeployed.find((d) => d.id === m.id);
          const mRes = (mRow?.resolution as Resolution | null) ?? {} as Resolution;
          await db
            .update(markets)
            .set({
              withdrawnAmount: (existing?.amount ?? amount).toString(),
              resolution: { ...mRes, withdrawal: { ...mRes.withdrawal, withdrawnAt, withdrawTxHash: m.txHash } },
            })
            .where(eq(markets.id, m.id));
        }
      } catch {
        // Skip if receipt unavailable
      }
    }
  }

  // Pass 2: Backfill from activity log for markets without tx hash
  if (missingNoTxHash.length > 0) {
    const ids = missingNoTxHash.map((m) => m.id);
    const logs = await db
      .select({ entityId: activityLog.entityId, detail: activityLog.detail })
      .from(activityLog)
      .where(and(
        eq(activityLog.action, 'market_liquidity_withdrawn'),
        inArray(activityLog.entityId, ids),
      ));

    for (const log of logs) {
      if (!log.entityId || !log.detail) continue;
      const amount = (log.detail as Record<string, unknown>).amount;
      if (!amount) continue;

      const raw = Math.round(parseFloat(String(amount)) * 1e6);
      if (raw <= 0) continue;

      const market = missingNoTxHash.find((m) => m.id === log.entityId);
      if (!market) continue;

      // Get existing withdrawnAt from resolution for this market
      const mRow = allDeployed.find((d) => d.id === market.id);
      const mRes = mRow?.resolution as Resolution | null;
      result.set(market.onchainAddress, { amount: BigInt(raw), withdrawnAt: mRes?.withdrawal?.withdrawnAt });
      allMissingIds.delete(market.id);
      await db
        .update(markets)
        .set({ withdrawnAmount: raw.toString() })
        .where(eq(markets.id, market.id));
    }
  }

  // Pass 3: Onchain scan — find withdraw(address) calls via Alchemy
  const WITHDRAW_SELECTOR = '0x51cff8d9'; // withdraw(address)
  if (allMissingIds.size > 0) {
    const collateralToken = COLLATERAL_TOKENS[chainId];
    const rpcUrl = chainId === MAINNET_CHAIN_ID ? process.env.PREDMARKS_RPC_URL : process.env.PREDMARKS_RPC_URL_SEPOLIA;
    if (collateralToken && rpcUrl) {
      const candidates = allDeployed.filter(
        (m) => m.onchainAddress && allMissingIds.has(m.id),
      );

      // Collect all transfers for all candidates in parallel
      type TransferInfo = { marketId: string; addr: string; hash: string; value: string; blockTimestamp?: string };
      const allTransfers: TransferInfo[] = [];

      await Promise.all(candidates.map(async (m) => {
        try {
          const addr = m.onchainAddress!.toLowerCase();
          const resp = await fetch(rpcUrl!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1,
              method: 'alchemy_getAssetTransfers',
              params: [{
                fromAddress: addr,
                contractAddresses: [collateralToken!.toLowerCase()],
                category: ['erc20'],
                withMetadata: true,
                order: 'desc',
                maxCount: '0x3e8',
              }],
            }),
          });
          const json = await resp.json() as {
            result?: { transfers: Array<{ hash: string; to: string; rawContract: { value: string }; metadata: { blockTimestamp: string } }> };
            error?: { message: string };
          };
          if (json.error) throw new Error(json.error.message);
          for (const t of json.result?.transfers ?? []) {
            allTransfers.push({ marketId: m.id, addr, hash: t.hash, value: t.rawContract.value, blockTimestamp: t.metadata?.blockTimestamp });
          }
        } catch (err) {
          console.warn(`[analytics] Failed to scan transfers for ${m.onchainAddress}:`, err);
        }
      }));

      // Deduplicate tx hashes and batch-fetch transactions
      const uniqueHashes = [...new Set(allTransfers.map((t) => t.hash))];
      const txInputMap = new Map<string, string>();

      // Batch in groups of 50 to avoid RPC limits
      for (let i = 0; i < uniqueHashes.length; i += 50) {
        const batch = uniqueHashes.slice(i, i + 50);
        try {
          const batchResp = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch.map((hash, idx) => ({
              jsonrpc: '2.0', id: idx,
              method: 'eth_getTransactionByHash',
              params: [hash],
            }))),
          });
          if (!batchResp.ok) continue;
          const batchJson = await batchResp.json() as Array<{
            id: number;
            result?: { input: string } | null;
          }>;
          for (const item of batchJson) {
            if (item.result?.input) {
              txInputMap.set(batch[item.id], item.result.input);
            }
          }
        } catch {
          // Skip batch if RPC returns invalid response
        }
      }

      // Match withdraw() calls to markets and extract timestamps
      const resolved = new Set<string>();
      for (const t of allTransfers) {
        if (resolved.has(t.marketId)) continue;
        const input = txInputMap.get(t.hash);
        if (input?.startsWith(WITHDRAW_SELECTOR)) {
          const amount = BigInt(t.value);
          if (amount > BigInt(0)) {
            const withdrawnAt = t.blockTimestamp ?? undefined;
            // Use existing amount if already cached (backfill case)
            const existing = result.get(t.addr);
            result.set(t.addr, { amount: existing?.amount ?? amount, withdrawnAt });
            resolved.add(t.marketId);

            // Cache amount + withdrawal date in DB
            const mRow = allDeployed.find((d) => d.id === t.marketId);
            const mRes = (mRow?.resolution as Resolution | null) ?? {} as Resolution;
            const updatedResolution = {
              ...mRes,
              withdrawal: {
                ...mRes.withdrawal,
                withdrawnAt: withdrawnAt ?? mRes.withdrawal?.withdrawnAt,
                withdrawTxHash: t.hash,
              },
            };
            await db
              .update(markets)
              .set({
                withdrawnAmount: (existing?.amount ?? amount).toString(),
                resolution: updatedResolution,
              })
              .where(eq(markets.id, t.marketId));
          }
        }
      }
    }
  }

  return result;
}

// --- Compute owned positions PnL ---

interface PositionsByMarket {
  invested: bigint;
  sellProceeds: bigint;
  value: bigint;
}

function computeOwnedPositionsPnL(
  positions: OwnedPositionDetail[],
): Map<string, PositionsByMarket> {
  const result = new Map<string, PositionsByMarket>();

  // Group positions by market address
  const byMarket = new Map<string, OwnedPositionDetail[]>();
  for (const p of positions) {
    const key = p.marketAddress;
    const existing = byMarket.get(key) ?? [];
    existing.push(p);
    byMarket.set(key, existing);
  }

  // Only count actually redeemed positions as value (not unredeemed winners).
  // Unredeemed winning positions stay in the market contract and are
  // recovered through LP withdrawal — counting them here would double-count.
  // Sell proceeds (withdrew) are always counted — they represent actual cash received.
  for (const [marketAddr, marketPositions] of byMarket) {
    let totalInvested = BigInt(0);
    let totalSellProceeds = BigInt(0);
    let totalValue = BigInt(0);

    for (const p of marketPositions) {
      totalInvested += BigInt(p.invested);
      totalSellProceeds += BigInt(p.withdrew);

      if (p.isRedeemed && p.resolvedTo > 0 && p.outcome === p.resolvedTo) {
        totalValue += BigInt(p.shares);
      }
    }

    result.set(marketAddr, { invested: totalInvested, sellProceeds: totalSellProceeds, value: totalValue });
  }

  return result;
}

// --- Main analytics function ---

export async function getAnalyticsData(chainId: number): Promise<AnalyticsData> {
  // Phase 1: Cache deployment dates, seeded/withdrawn/pending balances (writes to DB)
  const [, seededMap, withdrawnMap, , ownedAddresses] = await Promise.all([
    fetchAndCacheDeploymentDates(chainId),
    fetchAndCacheSeededAmounts(chainId),
    fetchAndCacheWithdrawnAmounts(chainId),
    refreshPendingBalances(chainId),
    getOwnedAddresses(),
  ]);

  // Phase 2: Read market rows AFTER caching so publishedAt is populated
  const dbMarketRows = await db
    .select({
      id: markets.id,
      title: markets.title,
      category: markets.category,
      status: markets.status,
      publishedAt: markets.publishedAt,
      createdAt: markets.createdAt,
      onchainId: markets.onchainId,
      onchainAddress: markets.onchainAddress,
      resolvedAt: markets.resolvedAt,
      closedAt: markets.closedAt,
      pendingBalance: markets.pendingBalance,
      seededAmount: markets.seededAmount,
      withdrawnAmount: markets.withdrawnAmount,
      resolution: markets.resolution,
      outcomes: markets.outcomes,
    })
    .from(markets)
    .where(
      and(
        eq(markets.chainId, chainId),
        isNotNull(markets.onchainAddress),
      ),
    );

  // Fetch owned positions from subgraph
  const ownedPositions = await fetchOwnedPositionsDetailed(chainId, ownedAddresses);

  // Compute owned positions PnL (only actually redeemed positions count as value)
  const ownedPnLMap = computeOwnedPositionsPnL(ownedPositions);

  // Build per-market PnL
  const marketPnLs: MarketPnL[] = dbMarketRows.map((m) => {
    const addr = m.onchainAddress?.toLowerCase() ?? '';
    const seeded = toUsdc(seededMap.get(addr)?.toString());
    const withdrawnData = withdrawnMap.get(addr);
    const withdrawn = toUsdc(withdrawnData?.amount.toString());
    const pending = toUsdc(m.pendingBalance);
    const owned = ownedPnLMap.get(addr);
    const ownedInvested = owned ? Number(owned.invested) / USDC_DECIMALS : 0;
    const ownedSellProceeds = owned ? Number(owned.sellProceeds) / USDC_DECIMALS : 0;
    const ownedValue = owned ? Number(owned.value) / USDC_DECIMALS : 0;
    const ownedPnL = (ownedValue + ownedSellProceeds) - ownedInvested;
    const liquidityPnL = (withdrawn + pending) - seeded;
    const netPnL = liquidityPnL + ownedPnL;

    // Prefer chain-derived timestamp from withdrawnMap, fall back to DB resolution JSONB
    const res = m.resolution as Resolution | null;
    const withdrawnAtStr = withdrawnData?.withdrawnAt ?? res?.withdrawal?.withdrawnAt;

    return {
      marketId: m.id,
      onchainId: m.onchainId,
      onchainAddress: m.onchainAddress,
      title: m.title,
      category: m.category,
      status: m.status,
      date: m.publishedAt ?? m.createdAt,
      resolvedDate: m.resolvedAt ?? m.closedAt ?? null,
      withdrawnAt: withdrawnAtStr ? new Date(withdrawnAtStr) : null,
      seeded,
      withdrawn,
      pending,
      ownedInvested,
      ownedSellProceeds,
      ownedValue,
      ownedPnL,
      liquidityPnL,
      netPnL,
      cumulativePnL: 0,
    };
  });

  // Sort by date and compute cumulative
  marketPnLs.sort((a, b) => {
    const da = a.date?.getTime() ?? 0;
    const db_ = b.date?.getTime() ?? 0;
    return da - db_;
  });

  let cumulative = 0;
  for (const m of marketPnLs) {
    cumulative += m.netPnL;
    m.cumulativePnL = cumulative;
  }

  // Summary
  const summary: PnLSummary = {
    totalSeeded: marketPnLs.reduce((s, m) => s + m.seeded, 0),
    totalWithdrawn: marketPnLs.reduce((s, m) => s + m.withdrawn, 0),
    totalPending: marketPnLs.reduce((s, m) => s + m.pending, 0),
    totalOwnedPnL: marketPnLs.reduce((s, m) => s + m.ownedPnL, 0),
    totalLiquidityPnL: marketPnLs.reduce((s, m) => s + m.liquidityPnL, 0),
    netPnL: cumulative,
    marketCount: marketPnLs.length,
  };

  return { summary, markets: marketPnLs };
}
