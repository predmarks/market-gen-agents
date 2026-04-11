import type { MarketStatus } from '@/db/types';
import { Badge } from '@/components/ui/badge';

const STATUS_LABELS: Record<MarketStatus, string> = {
  candidate: 'Candidato',
  processing: 'Procesando',
  open: 'Abierto',
  in_resolution: 'En resolución',
  closed: 'Resuelto',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
};

export function StatusBadge({ status }: { status: MarketStatus }) {
  return <Badge variant={status}>{STATUS_LABELS[status]}</Badge>;
}
