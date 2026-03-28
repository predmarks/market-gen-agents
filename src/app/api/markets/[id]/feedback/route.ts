import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/db/client';
import { markets, globalFeedback } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { logMarketEvent } from '@/lib/market-events';
import { logUsage } from '@/lib/llm';
import { HARD_RULES, SOFT_RULES } from '@/config/rules';

const client = new Anthropic({ maxRetries: 5 });

const SYSTEM_PROMPT = `Sos un asistente de control de calidad para Predmarks, una plataforma argentina de mercados de predicción.
El usuario te da feedback sobre un mercado. Tenés una conversación natural:

- Respondé en español argentino, breve y directo.
- Si algo no queda claro, preguntá.
- Cuando entiendas el feedback, guardalo con save_feedback Y respondé confirmando qué guardaste. Podés guardar varias veces en la misma conversación si hay más feedback.
- Extraé aprendizajes globales que apliquen a TODOS los mercados futuros (no solo a este). Si no hay, dejá la lista vacía.
- No repitas aprendizajes que ya existan en el feedback global existente.
- Sé conversacional, no robótico. El usuario puede seguir hablando después de guardar.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'respond',
    description: 'Respond to the user with a message (ask questions, confirm understanding, etc.)',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string' as const, description: 'Your response to the user' },
      },
      required: ['message'],
    },
  },
  {
    name: 'save_feedback',
    description: 'Save the finalized feedback. Call this only when you fully understand the user\'s intent and they have confirmed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        market_feedback: {
          type: 'string' as const,
          description: 'Clear, actionable feedback specific to this market for the reviewer/improver agents',
        },
        global_learnings: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Generalizable learnings for ALL future markets. Empty array if feedback is market-specific only.',
        },
      },
      required: ['market_feedback', 'global_learnings'],
    },
  },
];

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const messages: ChatMessage[] = body.messages ?? [];

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Last message must be from user' }, { status: 400 });
  }

  const [market] = await db.select().from(markets).where(eq(markets.id, id));
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  // Load existing global feedback for dedup context
  const existingGlobal = await db.select().from(globalFeedback);
  const existingGlobalTexts = existingGlobal.map((r) => r.text);

  const systemMessage = `${SYSTEM_PROMPT}

MERCADO EN CUESTIÓN:
- Título: ${market.title}
- Categoría: ${market.category}
- Descripción: ${market.description}
- Criterios de resolución: ${market.resolutionCriteria}
- Estado: ${market.status}

REGLAS DE VALIDACIÓN (el usuario puede referirse a ellas por ID):
Reglas estrictas:
${HARD_RULES.map((r) => `- ${r.id}: ${r.description}`).join('\n')}
Advertencias:
${SOFT_RULES.map((r) => `- ${r.id}: ${r.description}`).join('\n')}

FEEDBACK GLOBAL EXISTENTE:
${existingGlobalTexts.length > 0 ? existingGlobalTexts.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'Ninguno.'}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemMessage,
    tools: TOOLS,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  logUsage('feedback', 'claude-sonnet-4-20250514', response.usage.input_tokens, response.usage.output_tokens);

  // Collect reply text and save actions — prioritize respond tool over raw text
  const textParts: string[] = [];
  const toolParts: string[] = [];
  const saveActions: { market_feedback: string; global_learnings: string[] }[] = [];

  for (const block of response.content) {
    if (block.type === 'text' && block.text.trim()) {
      textParts.push(block.text.trim());
    }
    if (block.type === 'tool_use' && block.name === 'respond') {
      toolParts.push((block.input as { message: string }).message);
    }
    if (block.type === 'tool_use' && block.name === 'save_feedback') {
      saveActions.push(block.input as { market_feedback: string; global_learnings: string[] });
    }
  }

  // Use tool responses if available, otherwise fall back to text blocks
  const replyParts = toolParts.length > 0 ? toolParts : textParts;
  const reply = replyParts.join('\n\n') || 'No entendí, ¿podés reformular?';
  const fullConversation = [...messages, { role: 'assistant' as const, content: reply }];

  // Persist save actions
  for (const action of saveActions) {
    await logMarketEvent(id, 'human_feedback', {
      detail: {
        text: action.market_feedback,
        conversation: fullConversation,
      },
    });

    if (action.global_learnings.length > 0) {
      await db.insert(globalFeedback).values(
        action.global_learnings.map((text) => ({ text })),
      );
    }
  }

  return NextResponse.json({ reply, conversation: fullConversation });
}
