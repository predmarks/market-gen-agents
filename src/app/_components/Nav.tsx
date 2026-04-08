'use client';

import { useEffect, useState, useRef, type ComponentType } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import dynamic from 'next/dynamic';
import { logout } from '../login/actions';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@/lib/chains';
import {
  BookOpen, TrendingUp, Wallet, Mail,
  Radio, Scale, Activity, BarChart3,
  Settings, ChevronDown,
  type LucideProps,
} from 'lucide-react';

const WalletButton = dynamic(
  () => import('./WalletButton').then((m) => ({ default: m.WalletButton })),
  { ssr: false },
);

const systemLinks: { href: string; label: string; icon: ComponentType<LucideProps> }[] = [
  { href: '/dashboard/signals', label: 'Señales', icon: Radio },
  { href: '/dashboard/rules', label: 'Reglas', icon: Scale },
  { href: '/dashboard/activity', label: 'Log', icon: Activity },
  { href: '/dashboard/usage', label: 'Uso', icon: BarChart3 },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { chainId: walletChainId, isConnected } = useAccount();
  const [systemOpen, setSystemOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSystemOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Preserve chain param across nav links
  function withChain(href: string): string {
    if (!chainParam) return href;
    return `${href}?chain=${chainParam}`;
  }

  function navLink(href: string, label: string, Icon: ComponentType<LucideProps>) {
    const isActive = href === '/'
      ? pathname === '/' || pathname.startsWith('/dashboard/markets')
      : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={withChain(href)}
        className={`flex items-center gap-1.5 text-sm ${isActive ? 'text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
      >
        <Icon size={16} />
        {label}
      </Link>
    );
  }

  const systemActive = systemLinks.some((l) => pathname.startsWith(l.href));

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

          {navLink('/dashboard/topics', 'Temas', BookOpen)}
          {navLink('/dashboard/mercados', 'Mercados', TrendingUp)}
          {navLink('/dashboard/redemptions', 'Retiros', Wallet)}
          {navLink('/dashboard/newsletter', 'Newsletter', Mail)}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Sistema dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setSystemOpen((o) => !o)}
              className={`flex items-center gap-1.5 text-sm ${systemActive ? 'text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <Settings size={16} />
              Sistema
              <ChevronDown size={14} className={`transition-transform ${systemOpen ? 'rotate-180' : ''}`} />
            </button>
            {systemOpen && (
              <div className="absolute right-0 top-full mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
                {systemLinks.map(({ href, label, icon: Icon }) => {
                  const isActive = pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={withChain(href)}
                      onClick={() => setSystemOpen(false)}
                      className={`flex items-center gap-2 px-3 py-2 text-sm ${isActive ? 'text-gray-900 font-medium bg-gray-50' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}
                    >
                      <Icon size={16} />
                      {label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

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
