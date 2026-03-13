import { config } from 'dotenv';
config({ path: ['.env.local', '.env'] });

async function test() {
  // Step 1: Test ingestion
  console.log('=== Step 1: Ingestion ===');
  const { ingestAllSources } = await import('../src/agents/sourcer/ingestion');
  const { signals, dataPoints } = await ingestAllSources();
  console.log(`News signals: ${signals.filter((s) => s.type === 'news').length}`);
  console.log(`Data signals: ${signals.filter((s) => s.type === 'data').length}`);
  console.log('Data points:');
  for (const dp of dataPoints) {
    const prev = dp.previousValue != null ? ` (anterior: ${dp.previousValue})` : '';
    console.log(`  - ${dp.metric}: ${dp.currentValue} ${dp.unit}${prev}`);
  }
  console.log('');

  // Show a few news headlines
  const news = signals.filter((s) => s.type === 'news').slice(0, 5);
  console.log('Sample headlines:');
  for (const s of news) {
    console.log(`  [${s.source}] ${s.text}`);
  }
  console.log('');

  // Step 2: Generate markets
  console.log('=== Step 2: Generation ===');
  const { generateMarkets } = await import('../src/agents/sourcer/generator');

  // Load open market titles
  const postgres = (await import('postgres')).default;
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { eq, inArray } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');

  const sql = postgres(process.env.POSTGRES_URL!, { prepare: false });
  const db = drizzle(sql, { schema });

  const openMarkets = await db
    .select({ id: schema.markets.id, title: schema.markets.title })
    .from(schema.markets)
    .where(inArray(schema.markets.status, ['open', 'approved']));

  const candidates = await generateMarkets(
    signals,
    dataPoints,
    openMarkets.map((m) => m.title),
  );
  console.log(`Generated ${candidates.length} candidates:`);
  for (const c of candidates) {
    console.log(`  - [${c.category}] ${c.title}`);
    console.log(`    Timing: ${c.timingAnalysis}`);
    console.log(`    End: ${new Date(c.endTimestamp * 1000).toISOString()}`);
    console.log('');
  }

  // Step 3: Deduplication
  if (candidates.length > 0 && process.env.OPENAI_API_KEY) {
    console.log('=== Step 3: Deduplication ===');
    const { deduplicateCandidates } = await import('../src/agents/sourcer/deduplication');
    const unique = await deduplicateCandidates(candidates, openMarkets);
    console.log(`${unique.length}/${candidates.length} candidates survived dedup`);
  } else if (!process.env.OPENAI_API_KEY) {
    console.log('=== Step 3: Deduplication (skipped — no OPENAI_API_KEY) ===');
  }

  process.exit(0);
}

test().catch((err) => {
  console.error('Sourcing test failed:', err);
  process.exit(1);
});
