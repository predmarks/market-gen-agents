'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import dynamic from 'next/dynamic';
import { logout } from '../login/actions';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@/lib/chains';

const WalletButton = dynamic(
  () => import('./WalletButton').then((m) => ({ default: m.WalletButton })),
  { ssr: false },
);

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { chainId: walletChainId, isConnected } = useAccount();

  const chainParam = searchParams.get('chain');

  // Sync wallet chain to URL search param
  useEffect(() => {
    if (!isConnected || !walletChainId) return;
    const targetChain = walletChainId === TESTNET_CHAIN_ID ? TESTNET_CHAIN_ID : MAINNET_CHAIN_ID;
    const currentChain = Number(chainParam) || MAINNET_CHAIN_ID;
    if (targetChain !== currentChain) {
      const params = new URLSearchParams(searchParams.toString());
      if (targetChain === MAINNET_CHAIN_ID) {
        params.delete('chain');
      } else {
        params.set('chain', String(targetChain));
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
    }
  }, [walletChainId, isConnected, pathname, chainParam, searchParams, router]);

  // Preserve chain param across nav links
  function withChain(href: string): string {
    if (!chainParam) return href;
    return `${href}?chain=${chainParam}`;
  }

  function navLink(href: string, label: string) {
    const isActive = href === '/'
      ? pathname === '/' || pathname.startsWith('/dashboard/markets')
      : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={withChain(href)}
        className={`text-sm ${isActive ? 'text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
      >
        {label}
      </Link>
    );
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-4 md:px-6 py-3">
      <div className="flex items-center gap-4 md:gap-6">
        <div className="flex items-center gap-4 md:gap-6 overflow-x-auto min-w-0 flex-1">
          <Link href={withChain('/')} className="text-lg font-bold text-gray-900 shrink-0">
            Predmarks
          </Link>
          {Number(searchParams.get('chain')) === TESTNET_CHAIN_ID && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 shrink-0">Testnet</span>
          )}

          {navLink('/dashboard/topics', 'Temas')}
          {navLink('/dashboard/mercados', 'Mercados')}
          {navLink('/dashboard/signals', 'Señales')}
          {navLink('/dashboard/rules', 'Reglas')}
          {navLink('/dashboard/activity', 'Log')}
          {navLink('/dashboard/redemptions', 'Retiros')}
          {navLink('/dashboard/usage', 'Uso')}
          {navLink('/dashboard/newsletter', 'Newsletter')}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <WalletButton />
          <form action={logout}>
            <button
              type="submit"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Salir
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
