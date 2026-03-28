import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/db/client';
import { llmUsage } from '@/db/schema';

const client = new Anthropic({ maxRetries: 5 });

const MODEL_SONNET = 'claude-sonnet-4-20250514';
const MODEL_OPUS = 'claude-opus-4-20250514';
const MAX_TOKENS = 32000;

const MODELS = { sonnet: MODEL_SONNET, opus: MODEL_OPUS } as const;

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
  usage: { inputTokens: number; outputTokens: number };
}

async function logUsage(operation: string, model: string, inputTokens: number, outputTokens: number) {
  try {
    await db.insert(llmUsage).values({ operation, model, inputTokens, outputTokens });
  } catch (err) {
    console.warn('[llm-usage] Failed to log:', operation, err);
  }
}

export { client };

export async function callClaude<T>(
  options: CallClaudeOptions,
): Promise<CallClaudeResult<T>> {
  const toolName = options.outputToolName ?? 'output';
  const model = MODELS[options.model ?? 'sonnet'];

  const response = await client.messages
    .stream({
      model,
      max_tokens: options.maxTokens ?? MAX_TOKENS,
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
  };

  if (options.operation) {
    await logUsage(options.operation, model, usage.inputTokens, usage.outputTokens);
  }

  return { result: toolBlock.input as T, usage };
}

export async function callClaudeWithSearch<T>(
  options: CallClaudeOptions,
): Promise<CallClaudeResult<T>> {
  const toolName = options.outputToolName ?? 'output';
  const model = MODELS[options.model ?? 'sonnet'];

  const response = await client.messages
    .stream({
      model,
      max_tokens: options.maxTokens ?? MAX_TOKENS,
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
  };

  if (options.operation) {
    await logUsage(options.operation, model, usage.inputTokens, usage.outputTokens);
  }

  return { result: toolBlock.input as T, usage };
}

export { logUsage };
