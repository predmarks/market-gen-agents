import type { TimingSafety } from '@/db/types';
import { Badge } from '@/components/ui/badge';

const TIMING_CONFIG: Record<TimingSafety, { className: string; label: string }> = {
  safe: { className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', label: 'Seguro' },
  caution: { className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', label: 'Precaución' },
  dangerous: { className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', label: 'Peligroso' },
};

export function TimingSafetyIndicator({ safety }: { safety: TimingSafety }) {
  const { className, label } = TIMING_CONFIG[safety];
  return <Badge className={className}>{label}</Badge>;
}
