import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/db/client';
import { llmUsage, config } from '@/db/schema';
import { eq } from 'drizzle-orm';

const client = new Anthropic({ maxRetries: 5 });

const MODEL_SONNET = 'claude-sonnet-4-20250514';
const MODEL_OPUS = 'claude-opus-4-20250514';
const MAX_TOKENS = 32000;

const MODELS = { sonnet: MODEL_SONNET, opus: MODEL_OPUS } as const;

// Right-sized output token budgets per operation (most return structured JSON under 2k tokens)
export const TOKEN_BUDGETS: Record<string, number> = {
  data_verify:          4096,
  rules_check:          4096,
  score_market:         2048,
  improve_market:       8192,
  extract_topics:       8192,
  generate_markets:    16000,
  research_topic:       4096,
  resolve_check:        2048,
  score_signals:        4096,
  rescore_topic:        1024,
  match_markets_topics: 2048,
  expand_market:        4096,
};

function resolveMaxTokens(operation?: string, explicitMax?: number): number {
  if (explicitMax) return explicitMax;
  if (operation && operation in TOKEN_BUDGETS) return TOKEN_BUDGETS[operation];
  return MAX_TOKENS;
}

// Config-driven model overrides with in-memory cache (5-min TTL)
const modelOverrideCache = new Map<string, { model: string; expiry: number }>();
const MODEL_CACHE_TTL = 5 * 60 * 1000;

async function resolveModel(operation: string | undefined, defaultModel: 'opus' | 'sonnet'): Promise<string> {
  if (!operation) return MODELS[defaultModel];
  const cacheKey = `model_override:${operation}`;
  const cached = modelOverrideCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    return cached.model;
  }
  try {
    const [row] = await db.select().from(config).where(eq(config.key, cacheKey));
    if (row?.value && row.value in MODELS) {
      const resolved = MODELS[row.value as keyof typeof MODELS];
      modelOverrideCache.set(cacheKey, { model: resolved, expiry: Date.now() + MODEL_CACHE_TTL });
      return resolved;
    }
  } catch { /* fallback to default */ }
  modelOverrideCache.set(cacheKey, { model: MODELS[defaultModel], expiry: Date.now() + MODEL_CACHE_TTL });
  return MODELS[defaultModel];
}

// Run ID context — set from Inngest jobs, picked up by logUsage automatically
let _currentRunId: string | undefined;
export function setCurrentRunId(id: string | undefined) { _currentRunId = id; }

interface CallClaudeOptions {
  system: string;
  userMessage: string;
  outputSchema: Record<string, unknown>;
  outputToolName?: string;
  maxTokens?: number;
  model?: 'opus' | 'sonnet';
  operation?: string;
}

interface CallClaudeResult<T> {
  result: T;
  usage: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number };
}

async function logUsage(operation: string, model: string, inputTokens: number, outputTokens: number, cacheCreationTokens = 0, cacheReadTokens = 0) {
  try {
    await db.insert(llmUsage).values({ operation, model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, runId: _currentRunId ?? null });
  } catch (err) {
    console.warn('[llm-usage] Failed to log:', operation, err);
  }
}

export { client };

export async function callClaude<T>(
  options: CallClaudeOptions,
): Promise<CallClaudeResult<T>> {
  const toolName = options.outputToolName ?? 'output';
  const model = await resolveModel(options.operation, options.model ?? 'sonnet');

  const response = await client.messages
    .stream({
      model,
      max_tokens: resolveMaxTokens(options.operation, options.maxTokens),
      system: options.system,
      tools: [
        {
          name: toolName,
          description: 'Return the structured output',
          input_schema: options.outputSchema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool' as const, name: toolName },
      messages: [{ role: 'user', content: options.userMessage }],
    })
    .finalMessage();

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === toolName,
  );

  if (!toolBlock) {
    throw new Error(`Claude did not return a ${toolName} tool_use block`);
  }

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  };

  if (options.operation) {
    await logUsage(options.operation, model, usage.inputTokens, usage.outputTokens, usage.cacheCreationTokens, usage.cacheReadTokens);
  }

  return { result: toolBlock.input as T, usage };
}

export async function callClaudeWithSearch<T>(
  options: CallClaudeOptions,
): Promise<CallClaudeResult<T>> {
  const toolName = options.outputToolName ?? 'output';
  const model = await resolveModel(options.operation, options.model ?? 'sonnet');

  const response = await client.messages
    .stream({
      model,
      max_tokens: resolveMaxTokens(options.operation, options.maxTokens),
      system: options.system,
      tools: [
        { type: 'web_search_20250305', name: 'web_search' },
        {
          name: toolName,
          description: 'Return the structured output',
          input_schema: options.outputSchema as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'auto' as const },
      messages: [{ role: 'user', content: options.userMessage }],
    })
    .finalMessage();

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === toolName,
  );

  if (!toolBlock) {
    throw new Error(`Claude did not return a ${toolName} tool_use block`);
  }

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  };

  if (options.operation) {
    await logUsage(options.operation, model, usage.inputTokens, usage.outputTokens, usage.cacheCreationTokens, usage.cacheReadTokens);
  }

  return { result: toolBlock.input as T, usage };
}

export { logUsage };
