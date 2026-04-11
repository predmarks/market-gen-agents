import { db } from '@/db/client';
import { markets, activityLog } from '@/db/schema';
import { and, eq, isNotNull, isNull, inArray } from 'drizzle-orm';
import { createPublicClient, http, decodeFunctionData, erc20Abi, parseEventLogs } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { PRECOG_MASTER_ABI, COLLATERAL_TOKENS, MASTER_ADDRESSES } from './contracts';
import { MAINNET_CHAIN_ID } from './chains';
import { getOwnedAddresses } from './owned-addresses';
import { fetchOwnedPositionsDetailed, fetchMarketTxHashes, type OwnedPositionDetail } from './indexer';
import type { Resolution } from '@/db/types';

// --- Types ---

export interface MarketPnL {
  marketId: string;
  onchainId: string | null;
  title: string;
  category: string;
  status: string;
  date: Date | null;
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

// --- Fetch and cache withdrawn amounts from withdrawal tx receipts ---

export async function fetchAndCacheWithdrawnAmounts(chainId: number): Promise<Map<string, bigint>> {
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

  const result = new Map<string, bigint>();
  const missingTxHash: { id: string; onchainAddress: string; txHash: string }[] = [];
  const missingNoTxHash: { id: string; onchainAddress: string }[] = [];
  const allMissingIds = new Set<string>();

  for (const m of allDeployed) {
    if (!m.onchainAddress) continue;
    const addr = m.onchainAddress.toLowerCase();

    if (m.withdrawnAmount) {
      result.set(addr, BigInt(m.withdrawnAmount));
      continue;
    }

    allMissingIds.add(m.id);
    const res = m.resolution as Resolution | null;
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

        if (withdrawTransfer) {
          const amount = withdrawTransfer.args.value;
          result.set(m.onchainAddress, amount);
          allMissingIds.delete(m.id);
          await db
            .update(markets)
            .set({ withdrawnAmount: amount.toString() })
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

      result.set(market.onchainAddress, BigInt(raw));
      allMissingIds.delete(market.id);
      await db
        .update(markets)
        .set({ withdrawnAmount: raw.toString() })
        .where(eq(markets.id, market.id));
    }
  }

  // Pass 3: Onchain scan via Alchemy getAssetTransfers API
  // Catches direct contract withdrawals not logged through the UI
  if (allMissingIds.size > 0) {
    const collateralToken = COLLATERAL_TOKENS[chainId];
    const rpcUrl = chainId === MAINNET_CHAIN_ID ? process.env.PREDMARKS_RPC_URL : process.env.PREDMARKS_RPC_URL_SEPOLIA;
    if (collateralToken && rpcUrl) {
      const ownedAddresses = await getOwnedAddresses();
      const targetSet = new Set(ownedAddresses.map((a) => a.toLowerCase()));
      // Include Master contract — marketWithdraw sends tokens to Master (msg.sender)
      const masterAddr = MASTER_ADDRESSES[chainId]?.toLowerCase();
      if (masterAddr) targetSet.add(masterAddr);

      // Only scan markets with near-zero balance (likely withdrawn)
      const candidates = allDeployed.filter((m) => {
        if (!m.onchainAddress || !allMissingIds.has(m.id)) return false;
        const pending = Number(BigInt(m.pendingBalance ?? '0'));
        const seeded = Number(BigInt(m.seededAmount ?? '0'));
        return seeded > 0 && pending < seeded * 0.1;
      });

      for (const m of candidates) {
        try {
          const addr = m.onchainAddress!.toLowerCase();
          const resp = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1,
              method: 'alchemy_getAssetTransfers',
              params: [{
                fromAddress: addr,
                contractAddresses: [collateralToken.toLowerCase()],
                category: ['erc20'],
                withMetadata: false,
                order: 'asc',
                maxCount: '0x3e8',
              }],
            }),
          });
          const json = await resp.json() as {
            result?: { transfers: Array<{ to: string; rawContract: { value: string } }> };
            error?: { message: string };
          };
          if (json.error) throw new Error(json.error.message);

          let totalWithdrawn = BigInt(0);
          for (const t of json.result?.transfers ?? []) {
            if (targetSet.has(t.to.toLowerCase())) {
              totalWithdrawn += BigInt(t.rawContract.value);
            }
          }

          if (totalWithdrawn > BigInt(0)) {
            result.set(addr, totalWithdrawn);
            await db
              .update(markets)
              .set({ withdrawnAmount: totalWithdrawn.toString() })
              .where(eq(markets.id, m.id));
          }
        } catch (err) {
          console.warn(`[analytics] Failed to scan transfers for ${m.onchainAddress}:`, err);
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
  // Parallel fetch
  const [dbMarketRows, seededMap, withdrawnMap, ownedAddresses] = await Promise.all([
    db
      .select({
        id: markets.id,
        title: markets.title,
        category: markets.category,
        status: markets.status,
        publishedAt: markets.publishedAt,
        createdAt: markets.createdAt,
        onchainId: markets.onchainId,
        onchainAddress: markets.onchainAddress,
        pendingBalance: markets.pendingBalance,
        seededAmount: markets.seededAmount,
        withdrawnAmount: markets.withdrawnAmount,
        outcomes: markets.outcomes,
      })
      .from(markets)
      .where(
        and(
          eq(markets.chainId, chainId),
          isNotNull(markets.onchainAddress),
        ),
      ),
    fetchAndCacheSeededAmounts(chainId),
    fetchAndCacheWithdrawnAmounts(chainId),
    getOwnedAddresses(),
  ]);

  // Fetch owned positions from subgraph
  const ownedPositions = await fetchOwnedPositionsDetailed(chainId, ownedAddresses);

  // Compute owned positions PnL (only actually redeemed positions count as value)
  const ownedPnLMap = computeOwnedPositionsPnL(ownedPositions);

  // Build per-market PnL
  const marketPnLs: MarketPnL[] = dbMarketRows.map((m) => {
    const addr = m.onchainAddress?.toLowerCase() ?? '';
    const seeded = toUsdc(seededMap.get(addr)?.toString());
    const withdrawn = toUsdc(withdrawnMap.get(addr)?.toString());
    const pending = toUsdc(m.pendingBalance);
    const owned = ownedPnLMap.get(addr);
    const ownedInvested = owned ? Number(owned.invested) / USDC_DECIMALS : 0;
    const ownedSellProceeds = owned ? Number(owned.sellProceeds) / USDC_DECIMALS : 0;
    const ownedValue = owned ? Number(owned.value) / USDC_DECIMALS : 0;
    const ownedPnL = (ownedValue + ownedSellProceeds) - ownedInvested;
    const liquidityPnL = (withdrawn + pending) - seeded;
    const netPnL = liquidityPnL + ownedPnL;

    return {
      marketId: m.id,
      onchainId: m.onchainId,
      title: m.title,
      category: m.category,
      status: m.status,
      date: m.publishedAt ?? m.createdAt,
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
