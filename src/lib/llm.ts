import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ maxRetries: 2 });

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 16000;

interface CallClaudeOptions {
  system: string;
  userMessage: string;
  outputSchema: Record<string, unknown>;
  outputToolName?: string;
  maxTokens?: number;
}

interface CallClaudeResult<T> {
  result: T;
  usage: { inputTokens: number; outputTokens: number };
}

export async function callClaude<T>(
  options: CallClaudeOptions,
): Promise<CallClaudeResult<T>> {
  const toolName = options.outputToolName ?? 'output';

  const response = await client.messages.create({
    model: MODEL,
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
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === toolName,
  );

  if (!toolBlock) {
    throw new Error(`Claude did not return a ${toolName} tool_use block`);
  }

  return {
    result: toolBlock.input as T,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

export async function callClaudeWithSearch<T>(
  options: CallClaudeOptions,
): Promise<CallClaudeResult<T>> {
  const toolName = options.outputToolName ?? 'output';

  const response = await client.messages.create({
    model: MODEL,
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
  });

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === toolName,
  );

  if (!toolBlock) {
    throw new Error(`Claude did not return a ${toolName} tool_use block`);
  }

  return {
    result: toolBlock.input as T,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
