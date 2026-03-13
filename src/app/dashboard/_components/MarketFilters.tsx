'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { MARKET_STATUSES } from '@/db/types';
import type { MarketStatus } from '@/db/types';

const STATUS_LABELS: Record<MarketStatus, string> = {
  candidate: 'Candidatos',
  processing: 'Procesando',
  proposal: 'Propuestas',
  approved: 'Aprobados',
  open: 'Abiertos',
  closed: 'Cerrados',
  resolved: 'Resueltos',
  rejected: 'Rechazados',
};

export function MarketFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentStatus = searchParams.get('status');

  function setFilter(status: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (status) {
      params.set('status', status);
    } else {
      params.delete('status');
    }
    router.push(`/dashboard?${params.toString()}`);
  }

  return (
    <div className="flex gap-1 flex-wrap">
      <button
        onClick={() => setFilter(null)}
        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
          !currentStatus
            ? 'bg-gray-900 text-white'
            : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
        }`}
      >
        Todos
      </button>
      {MARKET_STATUSES.map((status) => (
        <button
          key={status}
          onClick={() => setFilter(status)}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            currentStatus === status
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          {STATUS_LABELS[status]}
        </button>
      ))}
    </div>
  );
}
