import { db } from '@/db/client';
import { config } from '@/db/schema';
import { eq } from 'drizzle-orm';

/** Load owned addresses from config table, normalized to lowercase. */
export async function getOwnedAddresses(): Promise<string[]> {
  const [row] = await db.select().from(config).where(eq(config.key, 'owned_addresses'));
  if (!row?.value) return [];
  const parsed: string[] = JSON.parse(row.value);
  return parsed.map((a) => a.toLowerCase());
}
