import type { MarketStatus } from '@/db/types';

const STATUS_STYLES: Record<MarketStatus, string> = {
  candidate: 'bg-blue-100 text-blue-800',
  processing: 'bg-amber-100 text-amber-800',
  proposal: 'bg-blue-100 text-blue-800',
  approved: 'bg-indigo-100 text-indigo-800',
  open: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-gray-100 text-gray-800',
  resolved: 'bg-purple-100 text-purple-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-orange-100 text-orange-800',
};

const STATUS_LABELS: Record<MarketStatus, string> = {
  candidate: 'Candidato',
  processing: 'Procesando',
  proposal: 'Propuesta',
  approved: 'Aprobado',
  open: 'Abierto',
  closed: 'Cerrado',
  resolved: 'Resuelto',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
};

export function StatusBadge({ status }: { status: MarketStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
