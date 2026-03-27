import { config } from 'dotenv';
config({ path: ['.env.local', '.env'] });
import postgres from 'postgres';
import { HARD_RULES, SOFT_RULES } from '../src/config/rules';

const sql = postgres(process.env.POSTGRES_URL!);

async function main() {
  // Create table
  await sql`
    CREATE TABLE IF NOT EXISTS rules (
      id VARCHAR(10) PRIMARY KEY,
      type VARCHAR(10) NOT NULL,
      description TEXT NOT NULL,
      "check" TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;
  await sql`ALTER TABLE rules ENABLE ROW LEVEL SECURITY`;

  const allRules = [...HARD_RULES, ...SOFT_RULES];
  for (const rule of allRules) {
    await sql`
      INSERT INTO rules (id, type, description, "check")
      VALUES (${rule.id}, ${rule.type}, ${rule.description}, ${rule.check})
      ON CONFLICT (id) DO UPDATE SET
        description = EXCLUDED.description,
        "check" = EXCLUDED."check",
        type = EXCLUDED.type,
        updated_at = NOW()
    `;
  }

  console.log(`Seeded ${allRules.length} rules`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
