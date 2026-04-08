import { createPublicClient, http, parseAbi, erc20Abi } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { MAINNET_CHAIN_ID } from './chains';
import { COLLATERAL_TOKENS } from './contracts';

const PRECOG_MASTER_ABI = parseAbi([
  'function markets(uint256 marketId) view returns (string name, string description, string category, string outcomes, uint256 startTimestamp, uint256 endTimestamp, address creator, address market)',
  'function marketPrices(uint256 marketId) view returns (uint256[] buyPrices, uint256[] sellPrices)',
]);

export interface OnchainMarketData {
  name: string;
  description: string;
  category: string;
  outcomes: string[];
  startTimestamp: number;
  endTimestamp: number;
  creator: string;
  marketAddress: string;
}

function getClient(chainId: number) {
  const envKey = chainId === MAINNET_CHAIN_ID ? 'PREDMARKS_RPC_URL' : 'PREDMARKS_RPC_URL_SEPOLIA';
  const rpcUrl = process.env[envKey];
  if (!rpcUrl) throw new Error(`${envKey} is not set`);
  const chain = chainId === MAINNET_CHAIN_ID ? base : baseSepolia;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

function getMasterAddress(chainId: number): `0x${string}` {
  const envKey = chainId === MAINNET_CHAIN_ID ? 'PREDMARKS_MASTER_ADDRESS' : 'PREDMARKS_MASTER_ADDRESS_SEPOLIA';
  const addr = process.env[envKey];
  if (!addr) throw new Error(`${envKey} is not set`);
  return addr as `0x${string}`;
}

function parseOutcomes(raw: string): string[] {
  // Try JSON array first, then comma-separated
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const MARKET_RESULT_ABI = parseAbi(['function result() view returns (uint256)']);

export async function fetchMarketResult(marketAddress: `0x${string}`, chainId: number = MAINNET_CHAIN_ID): Promise<number> {
  const client = getClient(chainId);
  const result = await client.readContract({
    address: marketAddress,
    abi: MARKET_RESULT_ABI,
    functionName: 'result',
  });
  return Number(result);
}

export async function fetchOnchainMarketData(onchainId: number, chainId: number = MAINNET_CHAIN_ID): Promise<OnchainMarketData> {
  const client = getClient(chainId);
  const result = await client.readContract({
    address: getMasterAddress(chainId),
    abi: PRECOG_MASTER_ABI,
    functionName: 'markets',
    args: [BigInt(onchainId)],
  });

  const [name, description, category, outcomesRaw, startTimestamp, endTimestamp, creator, marketAddress] = result;

  return {
    name,
    description,
    category,
    outcomes: parseOutcomes(outcomesRaw),
    startTimestamp: Number(startTimestamp),
    endTimestamp: Number(endTimestamp),
    creator,
    marketAddress,
  };
}

export async function fetchPendingBalances(
  marketAddresses: `0x${string}`[],
  chainId: number = MAINNET_CHAIN_ID,
): Promise<Map<string, bigint>> {
  const balances = new Map<string, bigint>();
  const collateralToken = COLLATERAL_TOKENS[chainId];
  if (!collateralToken || marketAddresses.length === 0) return balances;

  try {
    const client = getClient(chainId);
    const results = await client.multicall({
      contracts: marketAddresses.map((addr) => ({
        address: collateralToken,
        abi: erc20Abi,
        functionName: 'balanceOf' as const,
        args: [addr],
      })),
    });

    for (let i = 0; i < marketAddresses.length; i++) {
      const result = results[i];
      if (result.status === 'success') {
        balances.set(marketAddresses[i].toLowerCase(), result.result as bigint);
      }
    }
  } catch (err) {
    console.warn('Failed to fetch pending balances:', err);
  }

  return balances;
}

/**
 * Fetch buy prices for a market's outcomes from the PrecogMaster contract.
 * Returns an array of percentages (0-100) per outcome (1-indexed on-chain, mapped to 0-indexed here).
 * USDC collateral has 6 decimals, and prices represent the cost to buy one full share (1e6 = 100%).
 */
export async function fetchMarketPrices(
  onchainId: number,
  outcomeCount: number,
  chainId: number = MAINNET_CHAIN_ID,
): Promise<number[]> {
  const client = getClient(chainId);
  const [buyPrices] = await client.readContract({
    address: getMasterAddress(chainId),
    abi: PRECOG_MASTER_ABI,
    functionName: 'marketPrices',
    args: [BigInt(onchainId)],
  });

  // buyPrices is 1-indexed (index 0 unused), values in collateral decimals (6 for USDC)
  // Convert to percentages: price / 1e6 * 100
  const prices: number[] = [];
  for (let i = 1; i <= outcomeCount; i++) {
    const raw = buyPrices[i] ?? BigInt(0);
    prices.push(Math.round(Number(raw) / 1e4)); // 1e6 * 100 / 1e4 = percentage
  }
  return prices;
}
