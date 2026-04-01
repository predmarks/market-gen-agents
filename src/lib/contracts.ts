export const PRECOG_MASTER_ABI = [
  // Read
  {
    name: 'markets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'outcomes', type: 'string' },
      { name: 'startTimestamp', type: 'uint256' },
      { name: 'endTimestamp', type: 'uint256' },
      { name: 'creator', type: 'address' },
      { name: 'market', type: 'address' },
    ],
  },
  {
    name: 'ADMIN_ROLE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'MARKET_CREATOR_ROLE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'hasRole',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  // Write
  {
    name: 'marketTransferOwnership',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'newOwner', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'marketWithdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'marketToken', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'updateMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'outcomes', type: 'string[]' },
      { name: 'startTimestamp', type: 'uint256' },
      { name: 'endTimestamp', type: 'uint256' },
      { name: 'marketCreator', type: 'address' },
      { name: 'marketOracle', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'createCustomMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'outcomes', type: 'string[]' },
      { name: 'startTimestamp', type: 'uint256' },
      { name: 'endTimestamp', type: 'uint256' },
      { name: 'marketCreator', type: 'address' },
      { name: 'funding', type: 'uint256' },
      { name: 'overround', type: 'uint256' },
      { name: 'collateralToken', type: 'address' },
      { name: 'creatorAddress', type: 'address' },
      { name: 'marketOracle', type: 'address' },
    ],
    outputs: [],
  },
  // Events
  {
    name: 'MarketCreated',
    type: 'event',
    inputs: [
      { name: 'marketId', type: 'uint256', indexed: true },
      { name: 'market', type: 'address', indexed: false },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

export const PRECOG_MARKET_ABI = [
  {
    name: 'reportResult',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'outcome', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'result',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'oracle',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'closeTimestamp',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'token',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenAddress', type: 'address' }],
    outputs: [],
  },
] as const;

export const REPORTER_ABI = [
  {
    name: 'reportResult',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'market', type: 'address' },
      { name: 'marketId', type: 'uint256' },
      { name: 'outcome', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export const REPORTER_ADDRESSES: Record<number, `0x${string}` | null> = {
  8453: (process.env.NEXT_PUBLIC_REPORTER_ADDRESS_BASE ?? null) as `0x${string}` | null,
  84532: (process.env.NEXT_PUBLIC_REPORTER_ADDRESS_SEPOLIA ?? null) as `0x${string}` | null,
};

// Master contract addresses per chain
export const MASTER_ADDRESSES: Record<number, `0x${string}`> = {
  8453: (process.env.NEXT_PUBLIC_MASTER_ADDRESS_BASE ??
    '0x2297b780508cf997aaff9ad28254006e131599e5') as `0x${string}`,
  84532: (process.env.NEXT_PUBLIC_MASTER_ADDRESS_SEPOLIA ??
    '0x0000000000000000000000000000000000000000') as `0x${string}`,
};

export const COLLATERAL_TOKENS: Record<number, `0x${string}` | null> = {
  8453: (process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_BASE ?? null) as `0x${string}` | null,
  84532: (process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_SEPOLIA ?? null) as `0x${string}` | null,
};

export const ORACLE_ADDRESSES: Record<number, `0x${string}` | null> = {
  8453: (process.env.NEXT_PUBLIC_ORACLE_ADDRESS_BASE ?? null) as `0x${string}` | null,
  84532: (process.env.NEXT_PUBLIC_ORACLE_ADDRESS_SEPOLIA ?? null) as `0x${string}` | null,
};
