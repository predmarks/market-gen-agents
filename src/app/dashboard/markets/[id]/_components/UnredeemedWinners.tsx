import type { UnredeemedPosition } from '@/lib/indexer';
import { getBasescanUrl } from '@/lib/chains';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function addr(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function formatUsdc(raw: string): string {
  const n = Number(raw) / 1e6;
  if (n === 0) return '0';
  return n.toFixed(2);
}

interface Props {
  positions: UnredeemedPosition[];
  chainId: number;
}

export function UnredeemedWinners({ positions, chainId }: Props) {
  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-4 py-3 mb-4">
        <p className="text-xs text-green-700 dark:text-green-300">Todas las posiciones ganadoras fueron redimidas</p>
      </div>
    );
  }

  const totalShares = positions.reduce((sum, p) => sum + Number(p.shares) / 1e6, 0);
  const basescanUrl = getBasescanUrl(chainId);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 mb-4">
      <h4 className="text-sm font-semibold text-foreground mb-1">
        Posiciones ganadoras sin redimir
      </h4>
      <p className="text-xs text-muted-foreground mb-3">
        {positions.length} usuario{positions.length !== 1 ? 's' : ''} con ${totalShares.toFixed(2)} en shares ganadoras sin redimir
      </p>
      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="border-amber-200 dark:border-amber-800">
              <TableHead className="text-muted-foreground font-medium">Cuenta</TableHead>
              <TableHead className="text-muted-foreground font-medium text-right">Shares</TableHead>
              <TableHead className="text-muted-foreground font-medium text-right">Invertido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((p) => (
              <TableRow key={p.id} className="border-amber-100 dark:border-amber-900 last:border-0">
                <TableCell className="py-1">
                  <a
                    href={`${basescanUrl}/address/${p.account}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {addr(p.account)}
                  </a>
                </TableCell>
                <TableCell className="py-1 text-right font-mono">${formatUsdc(p.shares)}</TableCell>
                <TableCell className="py-1 text-right font-mono">${formatUsdc(p.invested)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
