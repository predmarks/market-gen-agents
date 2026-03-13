import { config } from 'dotenv';
config({ path: ['.env.local', '.env'] });

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';

const sql = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(sql, { schema });

async function test() {
  const [testMarket] = await db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.status, 'candidate'));

  if (!testMarket) {
    console.log('No candidate market found');
    process.exit(1);
  }

  console.log(`Testing full review pipeline for: ${testMarket.title}`);
  console.log(`Market ID: ${testMarket.id}`);
  console.log('');

  // Step 1: Data Verification
  console.log('=== Step 1: Data Verification ===');
  const { verifyData } = await import('../src/agents/reviewer/data-verifier');
  const verification = await verifyData(testMarket as any);
  console.log('Claims:', JSON.stringify(verification.claims, null, 2));
  console.log('Resolution source:', JSON.stringify(verification.resolutionSource, null, 2));
  console.log('✅ Data verification done\n');

  // Step 2: Rules Check
  console.log('=== Step 2: Rules Check ===');
  const { checkRules } = await import('../src/agents/reviewer/rules-checker');
  const openMarkets = await db
    .select({ id: schema.markets.id, title: schema.markets.title })
    .from(schema.markets)
    .where(eq(schema.markets.status, 'open'));
  const rulesCheck = await checkRules(testMarket as any, verification, openMarkets);
  console.log('Rejected:', rulesCheck.rejected);
  console.log('Hard rules:', JSON.stringify(rulesCheck.hardRuleResults, null, 2));
  console.log('Soft rules:', JSON.stringify(rulesCheck.softRuleResults, null, 2));
  console.log('✅ Rules check done\n');

  if (rulesCheck.rejected) {
    console.log('⛔ Market rejected by hard rules. Stopping pipeline.');
    process.exit(0);
  }

  // Step 3: Scoring
  console.log('=== Step 3: Scoring ===');
  const { scoreMarket } = await import('../src/agents/reviewer/scorer');
  const scoring = await scoreMarket(testMarket as any, verification, rulesCheck);
  console.log('Scores:', JSON.stringify(scoring.scores, null, 2));
  console.log('Recommendation:', scoring.recommendation);
  console.log('✅ Scoring done\n');

  // Step 4: Improver (conditional)
  const needsImprovement =
    scoring.recommendation === 'rewrite_then_publish' ||
    scoring.scores.ambiguity < 7 ||
    scoring.scores.timingSafety < 7;

  if (needsImprovement) {
    console.log('=== Step 4: Improver ===');
    const { improveMarket } = await import('../src/agents/reviewer/improver');
    const improved = await improveMarket(testMarket as any, 'Test feedback', []);
    console.log('Improved market:', JSON.stringify(improved, null, 2));
    console.log('✅ Improvement done\n');
  } else {
    console.log('=== Step 4: Improver (skipped — not needed) ===\n');
  }

  // Save review to DB
  console.log('=== Saving Review ===');
  const review = {
    scores: scoring.scores,
    hardRuleResults: rulesCheck.hardRuleResults,
    softRuleResults: rulesCheck.softRuleResults,
    dataVerification: verification.claims,
    resolutionSourceCheck: verification.resolutionSource,
    recommendation: scoring.recommendation,
    reviewedAt: new Date().toISOString(),
  };
  await db
    .update(schema.markets)
    .set({ review, status: 'processing' })
    .where(eq(schema.markets.id, testMarket.id));
  console.log('✅ Review saved to database');
  console.log('\nFull review:', JSON.stringify(review, null, 2));

  process.exit(0);
}

test().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
