import { config } from 'dotenv';
config({ path: ['.env.local', '.env'] });
import postgres from 'postgres';

const sql = postgres(process.env.POSTGRES_URL!);

async function main() {
  // 1. Create new conversations table
  await sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      context_type VARCHAR(20) NOT NULL DEFAULT 'global',
      context_id UUID,
      title TEXT NOT NULL,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS conversations_context_idx ON conversations(context_type, context_id)`;
  await sql`ALTER TABLE conversations ENABLE ROW LEVEL SECURITY`;
  console.log('Created conversations table');

  // 2. Migrate existing topic_conversations
  const existing = await sql`SELECT count(*)::int as count FROM topic_conversations`;
  if (existing[0].count > 0) {
    await sql`
      INSERT INTO conversations (id, context_type, context_id, title, messages, created_at, updated_at)
      SELECT id, 'topic', topic_id, title, messages, created_at, updated_at
      FROM topic_conversations
      ON CONFLICT (id) DO NOTHING
    `;
    console.log(`Migrated ${existing[0].count} topic conversations`);
  }

  // 3. Migrate market feedback conversations from marketEvents
  const marketConvs = await sql`
    SELECT me.id, me.market_id, me.detail, me.created_at
    FROM market_events me
    WHERE me.type = 'human_feedback'
    AND me.detail->>'conversation' IS NOT NULL
  `;

  let migrated = 0;
  for (const mc of marketConvs) {
    const detail = mc.detail as { text?: string; conversation?: { role: string; content: string }[] };
    if (!detail.conversation?.length) continue;

    const title = detail.conversation.find((m: { role: string }) => m.role === 'user')?.content?.slice(0, 80) ?? detail.text?.slice(0, 80) ?? 'Feedback';

    await sql`
      INSERT INTO conversations (context_type, context_id, title, messages, created_at, updated_at)
      VALUES ('market', ${mc.market_id}, ${title}, ${JSON.stringify(detail.conversation)}, ${mc.created_at}, ${mc.created_at})
    `;
    migrated++;
  }
  console.log(`Migrated ${migrated} market feedback conversations`);

  // 4. Drop old table
  await sql`DROP TABLE IF EXISTS topic_conversations`;
  console.log('Dropped topic_conversations table');

  await sql.end();
  console.log('Migration complete');
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
