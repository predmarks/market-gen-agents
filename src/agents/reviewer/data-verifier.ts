import { callClaudeWithSearch } from '@/lib/llm';
import type { DataVerification, ResolutionSourceCheck } from '@/db/types';
import type { MarketRecord } from './types';

export interface DataVerificationResult {
  claims: DataVerification[];
  resolutionSource: ResolutionSourceCheck;
}

const SYSTEM_PROMPT = `You are a fact-checker for Predmarks, an Argentine prediction market platform.
Your job is to verify every numerical claim and factual assertion in candidate markets.
Be thorough — our previous system hallucinated numbers constantly.
Always search for current real-world data to verify claims.`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    claims: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          claim: { type: 'string' as const },
          currentValue: { type: 'string' as const },
          source: { type: 'string' as const },
          sourceUrl: { type: 'string' as const },
          isAccurate: { type: 'boolean' as const },
          severity: { type: 'string' as const, enum: ['critical', 'minor'] },
        },
        required: ['claim', 'currentValue', 'source', 'isAccurate', 'severity'] as const,
      },
    },
    resolutionSource: {
      type: 'object' as const,
      properties: {
        exists: { type: 'boolean' as const },
        accessible: { type: 'boolean' as const },
        publishesRelevantData: { type: 'boolean' as const },
        url: { type: 'string' as const },
        note: { type: 'string' as const },
      },
      required: ['exists', 'accessible', 'publishesRelevantData', 'url', 'note'] as const,
    },
  },
  required: ['claims', 'resolutionSource'] as const,
};

export async function verifyData(
  market: MarketRecord,
): Promise<DataVerificationResult> {
  const marketSummary = {
    title: market.title,
    description: market.description,
    resolutionCriteria: market.resolutionCriteria,
    resolutionSource: market.resolutionSource,
    contingencies: market.contingencies,
    category: market.category,
    endTimestamp: market.endTimestamp,
    endDate: new Date(market.endTimestamp * 1000).toISOString(),
  };

  const userMessage = `Verify every numerical claim and factual assertion in this candidate market.

Market:
${JSON.stringify(marketSummary, null, 2)}

For EACH number, statistic, or factual claim:
1. Search for the current real-world value
2. Compare to what the market claims or implies
3. Flag any discrepancy

Also verify the resolution source:
1. Does it exist?
2. Is it publicly accessible (not paywalled)?
3. Does it actually publish the data type referenced?

If there are no numerical claims to verify, return an empty claims array but still verify the resolution source.

Today's date: ${new Date().toISOString().split('T')[0]}`;

  const { result } = await callClaudeWithSearch<DataVerificationResult>({
    system: SYSTEM_PROMPT,
    userMessage,
    outputSchema: OUTPUT_SCHEMA,
    model: 'opus',
    operation: 'data_verify',
  });

  return result;
}
