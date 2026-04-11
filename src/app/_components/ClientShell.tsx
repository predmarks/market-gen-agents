'use client';

import dynamic from 'next/dynamic';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Nav } from './Nav';
import { PageContextProvider } from './PageContext';

const WalletProvider = dynamic(() => import('./WalletProvider').then(m => m.WalletProvider), { ssr: false });
const MiniChat = dynamic(() => import('./MiniChat').then(m => m.MiniChat), { ssr: false });

export function ClientShell({ hasSession, children }: { hasSession: boolean; children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <TooltipProvider>
    <WalletProvider>
      <PageContextProvider>
        {hasSession && <Nav />}
        <div className={`flex ${hasSession ? 'h-[calc(100vh-3.25rem)]' : ''}`}>
          <main className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">{children}</main>
          {hasSession && <MiniChat />}
        </div>
      </PageContextProvider>
    </WalletProvider>
    </TooltipProvider>
    </ThemeProvider>
  );
}
