'use client';

import { useState, useRef, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer"
      >
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    );
  }

  // Filter to named connectors only
  const available = connectors.filter((c) => c.name && c.name !== 'Injected');

  if (available.length <= 1) {
    const connector = available[0] ?? connectors[0];
    return (
      <button
        onClick={() => connector && connect({ connector })}
        disabled={isPending || !connector}
        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 cursor-pointer disabled:opacity-50"
      >
        {isPending ? 'Conectando...' : 'Conectar'}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 cursor-pointer disabled:opacity-50"
      >
        {isPending ? 'Conectando...' : 'Conectar'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[180px]">
          {available.map((connector) => (
            <button
              key={connector.uid}
              onClick={() => {
                connect({ connector });
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              {connector.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
