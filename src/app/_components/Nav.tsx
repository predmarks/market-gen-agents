'use client';

import { useEffect, type ComponentType } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import { useTheme } from 'next-themes';
import dynamic from 'next/dynamic';
import { logout } from '../login/actions';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from '@/lib/chains';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Zap, BookOpen, TrendingUp, Wallet, Mail,
  Radio, Scale, Activity, BarChart3,
  Settings, ChevronDown, Moon, Sun, Monitor,
  type LucideProps,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const { setTheme } = useTheme();

  const chainParam = searchParams.get('chain');

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
        className={cn(
          'flex items-center gap-1.5 text-sm',
          isActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Icon size={16} />
        {label}
      </Link>
    );
  }

  const systemActive = systemLinks.some((l) => pathname.startsWith(l.href));

  return (
    <nav className="bg-background border-b border-border px-4 md:px-6 py-3">
      <div className="flex items-center gap-4 md:gap-6">
        <div className="flex items-center gap-4 md:gap-6 overflow-x-auto min-w-0 flex-1">
          <Link href={withChain('/')} className="text-lg font-bold text-foreground shrink-0">
            Predmarks
          </Link>
          {Number(searchParams.get('chain')) === TESTNET_CHAIN_ID && (
            <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 shrink-0">Testnet</Badge>
          )}

          {navLink('/', 'Live', Zap)}
          {navLink('/dashboard/mercados', 'Mercados', TrendingUp)}
          {navLink('/dashboard/redemptions', 'Liquidity', Wallet)}
          {navLink('/dashboard/topics', 'Temas', BookOpen)}
          {navLink('/dashboard/newsletter', 'Newsletter', Mail)}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Sistema dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'flex items-center gap-1.5 text-sm outline-none',
                systemActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Settings size={16} />
              Sistema
              <ChevronDown size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8}>
              {systemLinks.map(({ href, label, icon: Icon }) => {
                const isActive = pathname.startsWith(href);
                return (
                  <DropdownMenuItem
                    key={href}
                    className={cn(isActive && 'font-medium')}
                    onClick={() => router.push(withChain(href))}
                  >
                    <Icon size={16} />
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Theme toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" />}>
              <Sun size={14} className="rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon size={14} className="absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Cambiar tema</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme('light')}>
                <Sun size={14} />
                Claro
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('dark')}>
                <Moon size={14} />
                Oscuro
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('system')}>
                <Monitor size={14} />
                Sistema
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <WalletButton />
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
              Salir
            </Button>
          </form>
        </div>
      </div>
    </nav>
  );
}
