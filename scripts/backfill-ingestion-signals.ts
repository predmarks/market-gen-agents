/**
 * Backfill historical `ingestion_completed` activity log entries
 * with signal texts from the corresponding `sourcing_runs` record.
 */
import { config } from 'dotenv';
config({ path: ['.env.local', '.env'] });

import postgres from 'postgres';

const sql = postgres(process.env.POSTGRES_URL!);

async function main() {
  // Find ingestion_completed entries that don't have signals in their detail
  const entries = await sql`
    SELECT id, detail, created_at
    FROM activity_log
    WHERE action = 'ingestion_completed'
    AND (detail->>'signals' IS NULL OR detail->'signals' = 'null'::jsonb)
    ORDER BY created_at DESC
  `;

  console.log(`Found ${entries.length} ingestion_completed entries without signals`);

  for (const entry of entries) {
    // Find the sourcing_runs entry closest to this activity entry's timestamp
    const [run] = await sql`
      SELECT signals
      FROM sourcing_runs
      WHERE signals IS NOT NULL
      AND completed_at IS NOT NULL
      ORDER BY ABS(EXTRACT(EPOCH FROM (completed_at - ${entry.created_at})))
      LIMIT 1
    `;

    if (!run?.signals) {
      console.log(`  [${entry.id}] No matching sourcing run found`);
      continue;
    }

    const signals = (run.signals as { source: string; text: string }[]).map((s) => ({
      source: s.source,
      text: (s.text || '').slice(0, 150),
    }));

    const updatedDetail = { ...entry.detail, signals };

    await sql`
      UPDATE activity_log
      SET detail = ${JSON.stringify(updatedDetail)}::jsonb
      WHERE id = ${entry.id}
    `;

    console.log(`  [${entry.id}] Backfilled ${signals.length} signals`);
  }

  console.log('Done');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
