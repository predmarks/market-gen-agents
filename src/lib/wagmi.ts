import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createAppKit } from '@reown/appkit';
import { base, baseSepolia } from '@reown/appkit/networks';

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '';

const networks: [typeof base, typeof baseSepolia] = [base, baseSepolia];

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
});

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: 'Predmarks',
    description: 'Mercado de predicciones de Argentina',
    url: 'https://predmarks.com',
    icons: [],
  },
  themeMode: 'light',
  customRpcUrls: {
    'eip155:8453': [{ url: 'https://mainnet.base.org' }],
    'eip155:84532': [{ url: 'https://sepolia.base.org' }],
  },
  features: {
    swaps: false,
    onramp: false,
    send: false,
    receive: false,
    analytics: false,
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
