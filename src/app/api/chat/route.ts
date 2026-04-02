import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/db/client';
import { topics, markets, signals, conversations, topicSignals, globalFeedback, resolutionFeedback, rules as rulesTable, activityLog, config, signalSources } from '@/db/schema';
import { eq, desc, sql, and, gt, inArray } from 'drizzle-orm';
import { rescoreTopic } from '@/agents/sourcer/scorer';
import { loadRules } from '@/config/rules';
import { slugify } from '@/agents/sourcer/types';
import { inngest } from '@/inngest/client';
import { logActivity } from '@/lib/activity-log';
import { logMarketEvent } from '@/lib/market-events';
import { logUsage } from '@/lib/llm';
import type { SourceContext } from '@/db/types';
import { getUserTimezone } from '@/lib/timezone';
import { loadGenerationPrompt, saveGenerationPrompt } from '@/agents/sourcer/generator';
import { loadResolutionPrompt, saveResolutionPrompt } from '@/agents/resolver/evaluator';
import { syncDeployedMarkets } from '@/lib/sync-deployed';
import { revalidatePath } from 'next/cache';

const client = new Anthropic({ maxRetries: 5 });

async function loadChatPrompt(): Promise<string> {
  try {
    const [row] = await db.select().from(config).where(eq(config.key, 'chat_prompt'));
    if (row?.value) return row.value;
  } catch { /* fallback */ }
  return DEFAULT_CHAT_PROMPT;
}

async function saveChatPrompt(prompt: string): Promise<void> {
  await db
    .insert(config)
    .values({ key: 'chat_prompt', value: prompt })
    .onConflictDoUpdate({ target: config.key, set: { value: prompt, updatedAt: new Date() } });
}

export const maxDuration = 300; // 5 min timeout for multi-turn tool loops

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  activityIds?: string[];
}

type ContextType = 'topic' | 'market' | 'signal' | 'global';

// --- System prompt builders ---

const DEFAULT_CHAT_PROMPT = `Sos el copiloto de Predmarks, una plataforma argentina de mercados de predicción.

PERSONALIDAD:
- Hablás en español argentino, breve y directo. Nada de listas de capacidades ni explicaciones de qué podés hacer.
- Si te preguntan qué podés hacer, respondé algo como "Puedo consultar, editar y analizar todo lo que ves en la plataforma. Preguntame lo que necesites."
- NUNCA listes tus herramientas ni hagas bullet points de capacidades. Sos un colega, no un manual.

OPERACIONES BARATAS (ejecutar sin pedir confirmación):
- Consultas (lookup_topic, lookup_market, lookup_signals): usá proactivamente cuando el usuario menciona un tema o mercado.
- Modificaciones directas (update_topic, update_market, save_feedback, link_signal_to_topic, add_angle): ejecutá inmediatamente.
- Para feedback: guardalo con save_feedback. Si tiene valor general, extraé aprendizajes globales.

OPERACIONES COSTOSAS (sugerir pero SIEMPRE pedir confirmación):
- create_market, review_market, ingest_signals, research_topic, check_resolution, sync_deployed
- Sugerí estas acciones proactivamente cuando sea relevante, pero SIEMPRE preguntá "¿Querés que lance X?" antes de ejecutar.
- NUNCA ejecutes estas herramientas sin confirmación explícita del usuario.

ÁNGULOS DE MERCADO:
- Cuando discutas ideas o ángulos de mercado para un tema, guardá cada ángulo automáticamente usando add_angle. No esperes a que el usuario lo pida.
- Guardar un ángulo NO crea un mercado. Es solo una idea guardada para referencia futura.
- Los ángulos son preguntas concretas para mercados predictivos (binarios sí/no o multi-opción).
- Discutir ángulos es brainstorming libre. Crear mercados (create_market) es un paso separado que requiere confirmación.

FECHAS DE CIERRE:
- El cierre de un mercado se guarda como endTimestamp (Unix timestamp en segundos).
- NUNCA calcules timestamps vos mismo — siempre usá la herramienta date_to_timestamp para convertir fechas.
- Flujo: 1) llamá date_to_timestamp con la fecha deseada, 2) usá el timestamp devuelto en update_market.
- Ejemplo: usuario pide "cerrar el 31 de julio 2026" → llamá date_to_timestamp("2026-07-31T23:00:00-03:00") → recibís el timestamp → llamá update_market con ese endTimestamp.

COMPORTAMIENTO GENERAL:
- Respuestas cortas. Si la acción se completó, confirmá en una oración.
- Tenés acceso a todos los temas, mercados, señales, reglas.
- Cuando el usuario quiera modificar cómo se generan los mercados, guardalo como global_learnings con save_feedback.`;

async function buildTopicContext(topicId: string): Promise<string> {
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
  if (!topic) return 'Tema no encontrado.';

  const linkedSignals = await db
    .select({ text: signals.text, source: signals.source, url: signals.url, publishedAt: signals.publishedAt })
    .from(topicSignals)
    .innerJoin(signals, eq(topicSignals.signalId, signals.id))
    .where(eq(topicSignals.topicId, topicId))
    .orderBy(desc(signals.publishedAt))
    .limit(20);

  const feedbackEntries = (topic.feedback ?? []) as { text: string; createdAt: string }[];

  // Find markets linked to this topic
  const allMarkets = await db
    .select({ id: markets.id, title: markets.title, status: markets.status, category: markets.category, onchainId: markets.onchainId, sourceContext: markets.sourceContext })
    .from(markets)
    .where(eq(markets.isArchived, false));
  const relatedMarkets = allMarkets.filter((m) => {
    const ctx = m.sourceContext as { topicIds?: string[] } | null;
    return ctx?.topicIds?.includes(topicId);
  });

  let marketsSection = '';
  if (relatedMarkets.length > 0) {
    marketsSection = `\n\nMERCADOS VINCULADOS (${relatedMarkets.length}):\n${relatedMarkets.map((m) => `- [${m.status}] ${m.title} (${m.category}${m.onchainId ? `, #${m.onchainId}` : ''})`).join('\n')}`;
  }

  return `CONTEXTO: TEMA
- Nombre: ${topic.name}
- Categoría: ${topic.category}
- Score: ${topic.score}/10
- Estado: ${topic.status}
- Resumen: ${topic.summary}

ÁNGULOS SUGERIDOS:
${topic.suggestedAngles.length > 0 ? topic.suggestedAngles.map((a) => `- ${a}`).join('\n') : 'Sin ángulos.'}

SEÑALES VINCULADAS (${linkedSignals.length}):
${linkedSignals.length > 0 ? linkedSignals.map((s, i) => `${i + 1}. [${s.source}] ${s.text} (${s.publishedAt.toISOString().split('T')[0]})${s.url ? ` ${s.url}` : ''}`).join('\n') : 'Sin señales.'}

FEEDBACK PREVIO:
${feedbackEntries.length > 0 ? feedbackEntries.map((f) => `- ${f.text}`).join('\n') : 'Sin feedback.'}${marketsSection}`;
}

async function buildMarketContext(marketId: string, tz: string = 'America/Argentina/Buenos_Aires'): Promise<string> {
  const [market] = await db.select().from(markets).where(eq(markets.id, marketId));
  if (!market) return 'Mercado no encontrado.';

  const sourceContext = market.sourceContext as { topicIds?: string[]; topicNames?: string[] } | null;
  const sourceTopicIds = sourceContext?.topicIds ?? [];

  // Fetch source topics
  let topicsContext = '';
  if (sourceTopicIds.length > 0) {
    const sourceTopics = await db
      .select({ id: topics.id, name: topics.name, slug: topics.slug })
      .from(topics)
      .where(inArray(topics.id, sourceTopicIds));
    if (sourceTopics.length > 0) {
      topicsContext = `\n\nTEMAS VINCULADOS (${sourceTopics.length}):\n${sourceTopics.map((t) => `- ${t.name}`).join('\n')}`;
    }
  }

  // Fetch related signals through source topics
  let signalsContext = '';
  if (sourceTopicIds.length > 0) {
    const relatedSignals = await db
      .select({ text: signals.text, source: signals.source, url: signals.url, publishedAt: signals.publishedAt })
      .from(topicSignals)
      .innerJoin(signals, eq(topicSignals.signalId, signals.id))
      .where(inArray(topicSignals.topicId, sourceTopicIds))
      .orderBy(desc(signals.publishedAt))
      .limit(20);

    if (relatedSignals.length > 0) {
      signalsContext = `\n\nSEÑALES RELACIONADAS (${relatedSignals.length}):\n${relatedSignals.map((s, i) => `${i + 1}. [${s.source}] ${s.text} (${s.publishedAt.toISOString().split('T')[0]})${s.url ? ` ${s.url}` : ''}`).join('\n')}`;
    }
  }

  // Fetch onchain data for diff comparison
  let diffContext = '';
  if (market.onchainId) {
    try {
      const { fetchOnchainMarketData } = await import('@/lib/onchain');
      const onchain = await fetchOnchainMarketData(Number(market.onchainId), market.chainId);
      const diffs: string[] = [];
      if (market.title !== onchain.name) diffs.push(`  Título: local="${market.title}" vs onchain="${onchain.name}"`);
      if (market.description !== onchain.description) diffs.push(`  Descripción: local="${market.description.slice(0, 100)}..." vs onchain="${onchain.description.slice(0, 100)}..."`);
      if (market.category !== onchain.category) diffs.push(`  Categoría: local="${market.category}" vs onchain="${onchain.category}"`);
      if (JSON.stringify(market.outcomes) !== JSON.stringify(onchain.outcomes)) diffs.push(`  Opciones: local=[${(market.outcomes as string[]).join(', ')}] vs onchain=[${onchain.outcomes.join(', ')}]`);
      if (market.endTimestamp !== onchain.endTimestamp) diffs.push(`  Fecha cierre: local=${new Date(market.endTimestamp * 1000).toISOString().split('T')[0]} vs onchain=${new Date(onchain.endTimestamp * 1000).toISOString().split('T')[0]}`);
      if (diffs.length > 0) {
        diffContext = `\n\nDIFERENCIAS LOCAL vs ONCHAIN (${diffs.length}):\n${diffs.join('\n')}`;
      } else {
        diffContext = '\n\nEstado onchain: EN SYNC (sin diferencias)';
      }
    } catch { /* RPC failure — skip */ }
  }

  // Resolution & review info
  const resolution = market.resolution as { suggestedOutcome?: string; confidence?: string; confirmedAt?: string } | null;
  const review = market.review as { scores?: { overallScore?: number }; recommendation?: string } | null;

  let resolutionContext = '';
  if (market.outcome) {
    resolutionContext = `\n- Resultado: ${market.outcome}${market.status === 'closed' ? ' (confirmado onchain)' : ' (pendiente onchain)'}`;
  }
  if (resolution?.suggestedOutcome && !market.outcome) {
    resolutionContext = `\n- Resolución sugerida: ${resolution.suggestedOutcome} (confianza: ${resolution.confidence ?? 'unknown'})`;
  }

  let reviewContext = '';
  if (review?.scores?.overallScore != null) {
    reviewContext = `\n- Score revisión: ${review.scores.overallScore}/10${review.recommendation ? ` (${review.recommendation})` : ''}`;
  }

  let onchainContext = '';
  if (market.onchainId) {
    onchainContext = `\n- Onchain ID: #${market.onchainId}${market.volume ? `, Volumen: ${market.volume}` : ''}${market.participants ? `, Participantes: ${market.participants}` : ''}`;
  }

  return `CONTEXTO: MERCADO
- Título: ${market.title}
- Categoría: ${market.category}
- Estado: ${market.status}
- Outcomes: ${(market.outcomes as string[]).join(', ')}
- Descripción: ${market.description}
- Criterios de resolución: ${market.resolutionCriteria}
- Fuente de resolución: ${market.resolutionSource}
- Contingencias: ${market.contingencies}
- Cierre: ${new Date(market.endTimestamp * 1000).toLocaleString('es-AR', { timeZone: tz })} (timestamp: ${market.endTimestamp})
- Fecha resolución esperada: ${market.expectedResolutionDate ?? 'no definida'}${resolutionContext}${reviewContext}${onchainContext}${topicsContext}${signalsContext}${diffContext}`;
}

async function buildSignalContext(signalId: string): Promise<string> {
  const [signal] = await db.select().from(signals).where(eq(signals.id, signalId));
  if (!signal) return 'Señal no encontrada.';

  return `CONTEXTO: SEÑAL
- Tipo: ${signal.type}
- Texto: ${signal.text}
- Fuente: ${signal.source}
- Categoría: ${signal.category ?? 'Sin categoría'}
- Score: ${signal.score ?? 'Sin score'}
- Publicada: ${signal.publishedAt.toISOString().split('T')[0]}
${signal.summary ? `- Resumen: ${signal.summary}` : ''}`;
}

// --- Global data summaries ---

async function loadTopicsSummary(): Promise<string> {
  const allTopics = await db
    .select({ id: topics.id, name: topics.name, category: topics.category, score: topics.score, signalCount: topics.signalCount, status: topics.status })
    .from(topics)
    .where(sql`${topics.status} IN ('active', 'stale', 'researching', 'regular')`)
    .orderBy(desc(topics.score))
    .limit(100);

  if (allTopics.length === 0) return '';
  const lines = allTopics.map((t) => `- [${t.id}] ${t.name} | ${t.category} | score:${t.score} | ${t.signalCount} señales | ${t.status}`);
  return `\nTODOS LOS TEMAS (${allTopics.length}):\n${lines.join('\n')}`;
}

async function loadMarketsSummary(): Promise<string> {
  const allMarkets = await db
    .select({ id: markets.id, title: markets.title, category: markets.category, status: markets.status, outcomes: markets.outcomes })
    .from(markets)
    .where(eq(markets.isArchived, false))
    .orderBy(desc(markets.createdAt))
    .limit(100);

  if (allMarkets.length === 0) return '';
  const lines = allMarkets.map((m) => `- [${m.id}] ${m.title} | ${m.category} | ${m.status} | outcomes: ${(m.outcomes as string[]).join(', ')}`);
  return `\nTODOS LOS MERCADOS (${allMarkets.length}):\n${lines.join('\n')}`;
}

async function loadSignalsSummary(): Promise<string> {
  const allSignals = await db
    .select({ id: signals.id, type: signals.type, text: signals.text, source: signals.source, category: signals.category, score: signals.score, publishedAt: signals.publishedAt })
    .from(signals)
    .orderBy(desc(signals.publishedAt))
    .limit(100);

  if (allSignals.length === 0) return '';
  const lines = allSignals.map((s) => `- [${s.id}] ${s.type} | ${s.text.slice(0, 120)} | ${s.source} | ${s.category} | score:${s.score} | ${s.publishedAt?.toISOString().split('T')[0] ?? ''}`);
  return `\nSEÑALES RECIENTES (${allSignals.length}):\n${lines.join('\n')}`;
}

// --- Claude tools ---

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'lookup_topic',
    description: 'Get full details of a specific topic (summary, signals, feedback, angles)',
    input_schema: {
      type: 'object' as const,
      properties: { topicId: { type: 'string' as const } },
      required: ['topicId'],
    },
  },
  {
    name: 'lookup_market',
    description: 'Get full details of a specific market (description, criteria, contingencies, review)',
    input_schema: {
      type: 'object' as const,
      properties: { marketId: { type: 'string' as const } },
      required: ['marketId'],
    },
  },
  {
    name: 'lookup_signals',
    description: 'Search signals by text query or category. Returns up to 20 matching signals.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Text search (matches signal text)' },
        category: { type: 'string' as const, description: 'Filter by category' },
        limit: { type: 'number' as const, description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'save_feedback',
    description: 'Save feedback about an entity, or save global generation guidelines. Use global_learnings for instructions that should apply to ALL future market generation (format, resolution criteria, descriptions, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {
        feedback: { type: 'string' as const, description: 'Clear, actionable feedback' },
        global_learnings: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Generalizable learnings for ALL future entities. Empty if entity-specific only.',
        },
      },
      required: ['feedback', 'global_learnings'],
    },
  },
  {
    name: 'update_topic',
    description: 'Modify a topic\'s properties',
    input_schema: {
      type: 'object' as const,
      properties: {
        topicId: { type: 'string' as const },
        name: { type: 'string' as const },
        summary: { type: 'string' as const },
        category: { type: 'string' as const },
        suggestedAngles: { type: 'array' as const, items: { type: 'string' as const } },
        score: { type: 'number' as const },
        status: { type: 'string' as const, enum: ['active', 'stale', 'dismissed', 'regular'] },
      },
      required: ['topicId'],
    },
  },
  {
    name: 'add_angle',
    description: 'Save a new market angle/question to a topic. Use this automatically when discussing potential market ideas for a topic. Saving an angle does NOT create a market.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topicId: { type: 'string' as const, description: 'ID del tema' },
        angle: { type: 'string' as const, description: 'Pregunta concreta para mercado predictivo (binario o multi-opción)' },
      },
      required: ['topicId', 'angle'],
    },
  },
  {
    name: 'link_market_topic',
    description: 'Associate a market with a topic. Adds the topic to the market\'s sourceContext.topicIds.',
    input_schema: {
      type: 'object' as const,
      properties: {
        marketId: { type: 'string' as const, description: 'ID del mercado' },
        topicId: { type: 'string' as const, description: 'ID del tema a asociar' },
      },
      required: ['marketId', 'topicId'],
    },
  },
  {
    name: 'unlink_market_topic',
    description: 'Dissociate a market from a topic. Removes the topic from the market\'s sourceContext.topicIds.',
    input_schema: {
      type: 'object' as const,
      properties: {
        marketId: { type: 'string' as const, description: 'ID del mercado' },
        topicId: { type: 'string' as const, description: 'ID del tema a desasociar' },
      },
      required: ['marketId', 'topicId'],
    },
  },
  {
    name: 'date_to_timestamp',
    description: 'Convert a date string to Unix timestamp (seconds). ALWAYS use this tool before calling update_market with endTimestamp — never compute timestamps yourself.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string' as const, description: 'Fecha en formato ISO, ej: "2026-07-31T23:00:00-03:00" o "2026-07-31". Si no se especifica hora, usa 23:59 AR.' },
      },
      required: ['date'],
    },
  },
  {
    name: 'update_market',
    description: 'Modify a market\'s properties',
    input_schema: {
      type: 'object' as const,
      properties: {
        marketId: { type: 'string' as const },
        title: { type: 'string' as const },
        description: { type: 'string' as const },
        resolutionCriteria: { type: 'string' as const },
        resolutionSource: { type: 'string' as const },
        contingencies: { type: 'string' as const },
        category: { type: 'string' as const },
        tags: { type: 'array' as const, items: { type: 'string' as const } },
        outcomes: { type: 'array' as const, items: { type: 'string' as const } },
        endTimestamp: { type: 'number' as const, description: 'Unix timestamp en segundos para el cierre del mercado' },
        expectedResolutionDate: { type: 'string' as const, description: 'Fecha esperada de resolución YYYY-MM-DD' },
        status: { type: 'string' as const },
      },
      required: ['marketId'],
    },
  },
  {
    name: 'update_signal',
    description: 'Modify a signal\'s properties',
    input_schema: {
      type: 'object' as const,
      properties: {
        signalId: { type: 'string' as const },
        category: { type: 'string' as const },
        score: { type: 'number' as const },
      },
      required: ['signalId'],
    },
  },
  {
    name: 'merge_topics',
    description: 'Merge duplicate topics into one. Moves all signals from source topics to target, dismisses sources.',
    input_schema: {
      type: 'object' as const,
      properties: {
        targetTopicId: { type: 'string' as const, description: 'ID of the topic to keep' },
        sourceTopicIds: { type: 'array' as const, items: { type: 'string' as const }, description: 'IDs of topics to merge into target' },
      },
      required: ['targetTopicId', 'sourceTopicIds'],
    },
  },
  {
    name: 'link_signal_to_topic',
    description: 'Associate existing signals to a topic',
    input_schema: {
      type: 'object' as const,
      properties: {
        topicId: { type: 'string' as const },
        signalIds: { type: 'array' as const, items: { type: 'string' as const }, description: 'Signal IDs to link' },
      },
      required: ['topicId', 'signalIds'],
    },
  },
  {
    name: 'research_topic',
    description: 'Trigger web research for a topic — searches for new signals and links them. Does NOT create or modify topics, only gathers signals. Runs in background.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topicId: { type: 'string' as const, description: 'Topic to link discovered signals to (optional)' },
        description: { type: 'string' as const, description: 'What to research (guides the web search)' },
      },
      required: ['description'],
    },
  },
  {
    name: 'coalesce_topics',
    description: 'Trigger topic coalescence — takes existing signals and creates/updates/merges topics from them. If topicId is provided, coalesces around that topic\'s signals. Runs in background.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topicId: { type: 'string' as const, description: 'Optional: coalesce around this topic\'s signals' },
      },
    },
  },
  {
    name: 'suggest_topic',
    description: 'Full topic generation pipeline: researches a description via web search, saves signals, then creates or matches a topic. Use this when the user wants to explore a new topic idea. Runs in background.',
    input_schema: {
      type: 'object' as const,
      properties: {
        description: { type: 'string' as const, description: 'What to research and generate a topic for' },
        topicId: { type: 'string' as const, description: 'Optional: placeholder topic to update with results' },
      },
      required: ['description'],
    },
  },
  {
    name: 'update_rule',
    description: 'Modify an existing rule\'s description, check, or enabled status',
    input_schema: {
      type: 'object' as const,
      properties: {
        ruleId: { type: 'string' as const, description: 'Rule ID (e.g. H1, S3)' },
        description: { type: 'string' as const },
        check: { type: 'string' as const },
        enabled: { type: 'boolean' as const },
      },
      required: ['ruleId'],
    },
  },
  {
    name: 'create_rule',
    description: 'Create a new rule',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const, description: 'Rule ID (e.g. H13, S9)' },
        type: { type: 'string' as const, enum: ['hard', 'soft'] },
        description: { type: 'string' as const },
        check: { type: 'string' as const },
      },
      required: ['id', 'type', 'description', 'check'],
    },
  },
  {
    name: 'ingest_signals',
    description: 'Trigger signal ingestion from all sources (RSS, Twitter, economic data). Runs in background.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'sync_deployed',
    description: 'Sync all deployed onchain markets — pulls latest data from the indexer and blockchain, updates descriptions, links topics.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'create_market',
    description: 'Create a single market candidate linked to a topic. Use this when the user wants to suggest or create a specific market.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topicId: { type: 'string' as const, description: 'Topic ID to link the market to' },
        title: { type: 'string' as const, description: 'Market question (in Spanish)' },
        description: { type: 'string' as const, description: 'Market description with context' },
        category: { type: 'string' as const, description: 'Category: Política, Economía, Sociedad, Deportes, Tecnología, Entretenimiento' },
        outcomes: { type: 'array' as const, items: { type: 'string' as const }, description: 'Possible outcomes. Defaults to ["Sí", "No"]' },
        closingDate: { type: 'string' as const, description: 'Closing date in ISO format (e.g. "2026-07-31"). Converted to endTimestamp.' },
        resolutionCriteria: { type: 'string' as const, description: 'How the market resolves' },
        resolutionSource: { type: 'string' as const, description: 'Source for resolution verification' },
      },
      required: ['topicId', 'title'],
    },
  },
  {
    name: 'review_market',
    description: 'Trigger the review pipeline for a market candidate. Runs in background.',
    input_schema: {
      type: 'object' as const,
      properties: {
        marketId: { type: 'string' as const },
      },
      required: ['marketId'],
    },
  },
  {
    name: 'check_resolution',
    description: 'Trigger resolution check for an open market — searches for evidence that the resolution event occurred. Runs in background.',
    input_schema: {
      type: 'object' as const,
      properties: {
        marketId: { type: 'string' as const },
      },
      required: ['marketId'],
    },
  },
  {
    name: 'rescore_topic',
    description: 'Re-evaluate a topic\'s score based on its current state and feedback',
    input_schema: {
      type: 'object' as const,
      properties: {
        topicId: { type: 'string' as const },
      },
      required: ['topicId'],
    },
  },
  {
    name: 'get_generation_prompt',
    description: 'Read the current market generation system prompt template. Returns the full prompt text with {rules} and {targetCount} placeholders.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'update_generation_prompt',
    description: 'Update the market generation system prompt template. Keep {rules} and {targetCount} placeholders intact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string' as const, description: 'The full updated prompt template' },
        summary: { type: 'string' as const, description: 'Short description of what was changed (e.g. "added example for political markets")' },
      },
      required: ['prompt', 'summary'],
    },
  },
  {
    name: 'get_chat_prompt',
    description: 'Read the current MiniChat system prompt.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'update_chat_prompt',
    description: 'Update the MiniChat system prompt. Changes take effect on the next message.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string' as const, description: 'The full updated chat prompt' },
        summary: { type: 'string' as const, description: 'Short description of what was changed' },
      },
      required: ['prompt', 'summary'],
    },
  },
  {
    name: 'get_resolution_prompt',
    description: 'Read the current resolution evaluator system prompt.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'update_resolution_prompt',
    description: 'Update the resolution evaluator system prompt.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string' as const, description: 'The full updated resolution prompt' },
        summary: { type: 'string' as const, description: 'Short description of what was changed' },
      },
      required: ['prompt', 'summary'],
    },
  },
  {
    name: 'save_resolution_feedback',
    description: 'Save feedback about a market resolution for future resolution evaluations. Use for corrections, patterns to watch for, or general resolution guidelines.',
    input_schema: {
      type: 'object' as const,
      properties: {
        feedback: { type: 'string' as const, description: 'Clear, actionable feedback about resolution' },
        marketId: { type: 'string' as const, description: 'Optional: market ID this feedback relates to' },
      },
      required: ['feedback'],
    },
  },
  {
    name: 'list_signal_sources',
    description: 'List all signal sources (RSS feeds, scraped sites, APIs, social). Optionally filter by type or enabled status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string' as const, description: 'Filter by type: rss, scrape, api, social' },
        enabled: { type: 'boolean' as const, description: 'Filter by enabled status' },
      },
    },
  },
  {
    name: 'create_signal_source',
    description: 'Add a new signal source (RSS feed, scraped site, API endpoint, or social). For scrape type, config should include linkSelector, titleSelector, and baseUrl.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Display name for the source' },
        type: { type: 'string' as const, enum: ['rss', 'scrape', 'api', 'social'], description: 'Source type' },
        url: { type: 'string' as const, description: 'Source URL' },
        category: { type: 'string' as const, description: 'Market category (Política, Economía, Deportes, etc.)' },
        config: { type: 'object' as const, description: 'Type-specific config (e.g. CSS selectors for scrape, provider/metric/unit for api, woeid for social)' },
      },
      required: ['name', 'type', 'url'],
    },
  },
  {
    name: 'update_signal_source',
    description: 'Update a signal source — change name, URL, category, config, or toggle enabled/disabled.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sourceId: { type: 'string' as const, description: 'Signal source ID' },
        name: { type: 'string' as const },
        url: { type: 'string' as const },
        category: { type: 'string' as const },
        enabled: { type: 'boolean' as const },
        config: { type: 'object' as const },
      },
      required: ['sourceId'],
    },
  },
];

// --- Tool execution ---
// Returns tool_result content string for multi-turn

async function executeTool(block: Anthropic.ToolUseBlock, contextType: ContextType, contextId: string | null, tz: string = 'America/Argentina/Buenos_Aires'): Promise<string> {
  // Lookup tools — return data for Claude to use
  if (block.name === 'lookup_topic') {
    const { topicId } = block.input as { topicId: string };
    return await buildTopicContext(topicId);
  }

  if (block.name === 'lookup_market') {
    const { marketId: providedId } = block.input as { marketId: string };
    const marketId = (contextType === 'market' && contextId) ? contextId : providedId;
    return await buildMarketContext(marketId, tz);
  }

  if (block.name === 'lookup_signals') {
    const { query, category, limit: lim } = block.input as { query?: string; category?: string; limit?: number };
    const maxResults = Math.min(lim ?? 20, 50);

    let rows;
    if (query) {
      rows = await db.select().from(signals)
        .where(sql`${signals.text} ILIKE ${'%' + query + '%'}`)
        .orderBy(desc(signals.publishedAt))
        .limit(maxResults);
    } else if (category) {
      rows = await db.select().from(signals)
        .where(eq(signals.category, category))
        .orderBy(desc(signals.publishedAt))
        .limit(maxResults);
    } else {
      rows = await db.select().from(signals)
        .orderBy(desc(signals.publishedAt))
        .limit(maxResults);
    }

    if (rows.length === 0) return 'No se encontraron señales.';
    return rows.map((s) =>
      `- [${s.id}] [${s.type}] [${s.source}] ${s.text} | cat:${s.category ?? '?'} | score:${s.score ?? '?'} | ${s.publishedAt.toISOString().split('T')[0]}`
    ).join('\n');
  }

  // Write tools — execute side effects
  if (block.name === 'save_feedback') {
    const { feedback, global_learnings } = block.input as { feedback: string; global_learnings: string[] };

    if (contextType === 'topic' && contextId) {
      const entry = JSON.stringify([{ text: feedback, createdAt: new Date().toISOString() }]);
      await db
        .update(topics)
        .set({
          feedback: sql`COALESCE(${topics.feedback}, '[]'::jsonb) || ${entry}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(topics.id, contextId));

      const [topic] = await db.select().from(topics).where(eq(topics.id, contextId));
      if (topic) {
        const allFeedback = (topic.feedback ?? []) as { text: string; createdAt: string }[];
        const { score } = await rescoreTopic(
          { name: topic.name, summary: topic.summary, category: topic.category },
          allFeedback,
        );
        await db.update(topics).set({ score, status: score < 2 ? 'stale' : topic.status, updatedAt: new Date() }).where(eq(topics.id, contextId));
      }
    }

    if (global_learnings.length > 0) {
      await db.insert(globalFeedback).values(global_learnings.map((text) => ({ text })));
    }
    // Get entity name for activity log
    let contextLabel: string | undefined;
    let contextUrl: string | undefined;
    if (contextType === 'topic' && contextId) {
      const [t] = await db.select({ name: topics.name, slug: topics.slug }).from(topics).where(eq(topics.id, contextId));
      if (t) { contextLabel = t.name; contextUrl = `/dashboard/topics/${t.slug}`; }
    } else if (contextType === 'market' && contextId) {
      const [m] = await db.select({ title: markets.title }).from(markets).where(eq(markets.id, contextId));
      if (m) { contextLabel = m.title; contextUrl = `/dashboard/markets/${contextId}`; }
    }
    await logActivity('feedback_saved', { entityType: contextType, entityId: contextId ?? undefined, entityLabel: contextLabel, detail: { feedback, entityType: contextType, contextLabel, contextUrl, globalLearnings: global_learnings.length }, source: 'chat' });
    return 'Feedback guardado.';
  }

  if (block.name === 'update_topic') {
    const { topicId, ...fields } = block.input as Record<string, unknown>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (fields.name) { updates.name = fields.name; updates.slug = slugify(fields.name as string); }
    if (fields.summary) updates.summary = fields.summary;
    if (fields.category) updates.category = fields.category;
    if (fields.suggestedAngles) updates.suggestedAngles = fields.suggestedAngles;
    if (fields.score !== undefined) updates.score = fields.score;
    if (fields.status) updates.status = fields.status;
    await db.update(topics).set(updates).where(eq(topics.id, topicId as string));
    const [updatedT] = await db.select({ slug: topics.slug, name: topics.name }).from(topics).where(eq(topics.id, topicId as string));
    await logActivity('topic_updated', { entityType: 'topic', entityId: topicId as string, entityLabel: updatedT?.name ?? (fields.name as string), detail: { ...fields as Record<string, unknown>, topicSlug: updatedT?.slug }, source: 'chat' });
    return 'Tema actualizado.';
  }

  if (block.name === 'add_angle') {
    const { topicId, angle } = block.input as { topicId: string; angle: string };
    const [topic] = await db.select({ suggestedAngles: topics.suggestedAngles, name: topics.name, slug: topics.slug }).from(topics).where(eq(topics.id, topicId));
    if (!topic) return 'Tema no encontrado.';
    const existing = topic.suggestedAngles ?? [];
    if (existing.includes(angle)) return 'Ángulo ya existe.';
    const updated = [...existing, angle];
    await db.update(topics).set({ suggestedAngles: updated, updatedAt: new Date() }).where(eq(topics.id, topicId));
    return `Ángulo guardado: "${angle}"`;
  }

  if (block.name === 'date_to_timestamp') {
    const { date: dateStr } = block.input as { date: string };
    let d: Date;
    if (dateStr.includes('T') || dateStr.includes('+') || dateStr.includes('Z')) {
      d = new Date(dateStr);
    } else {
      // Date only — assume 23:59 Argentina time (UTC-3)
      d = new Date(`${dateStr}T23:59:00-03:00`);
    }
    if (isNaN(d.getTime())) return `Fecha inválida: "${dateStr}". Usá formato ISO, ej: "2026-07-31T23:00:00-03:00"`;
    const timestamp = Math.floor(d.getTime() / 1000);
    return `Timestamp: ${timestamp} (${d.toISOString()})`;
  }

  if (block.name === 'link_market_topic') {
    const { marketId: providedId, topicId } = block.input as { marketId: string; topicId: string };
    const marketId = (contextType === 'market' && contextId) ? contextId : providedId;
    const [market] = await db.select({ title: markets.title, sourceContext: markets.sourceContext }).from(markets).where(eq(markets.id, marketId));
    if (!market) return 'Mercado no encontrado.';
    const [topic] = await db.select({ name: topics.name }).from(topics).where(eq(topics.id, topicId));
    if (!topic) return 'Tema no encontrado.';
    const ctx = (market.sourceContext as { topicIds?: string[] } | null) ?? {};
    const existing = ctx.topicIds ?? [];
    if (existing.includes(topicId)) return `El mercado ya está asociado a "${topic.name}".`;
    const updated = { ...ctx, topicIds: [...existing, topicId] } as SourceContext;
    await db.update(markets).set({ sourceContext: updated }).where(eq(markets.id, marketId));
    await logMarketEvent(marketId, 'human_edited', { detail: { action: 'link_topic', topicId, topicName: topic.name, source: 'chat' } });
    await logActivity('market_updated', { entityType: 'market', entityId: marketId, entityLabel: market.title, detail: { action: 'linked_topic', topicId, topicName: topic.name }, source: 'chat' });
    return `Mercado "${market.title}" asociado a tema "${topic.name}".`;
  }

  if (block.name === 'unlink_market_topic') {
    const { marketId: providedId, topicId } = block.input as { marketId: string; topicId: string };
    const marketId = (contextType === 'market' && contextId) ? contextId : providedId;
    const [market] = await db.select({ title: markets.title, sourceContext: markets.sourceContext }).from(markets).where(eq(markets.id, marketId));
    if (!market) return 'Mercado no encontrado.';
    const [topic] = await db.select({ name: topics.name }).from(topics).where(eq(topics.id, topicId));
    const ctx = (market.sourceContext as { topicIds?: string[] } | null) ?? {};
    const existing = ctx.topicIds ?? [];
    if (!existing.includes(topicId)) return 'El mercado no está asociado a ese tema.';
    const updated = { ...ctx, topicIds: existing.filter((id) => id !== topicId) } as SourceContext;
    await db.update(markets).set({ sourceContext: updated }).where(eq(markets.id, marketId));
    await logMarketEvent(marketId, 'human_edited', { detail: { action: 'unlink_topic', topicId, topicName: topic?.name, source: 'chat' } });
    await logActivity('market_updated', { entityType: 'market', entityId: marketId, entityLabel: market.title, detail: { action: 'unlinked_topic', topicId, topicName: topic?.name }, source: 'chat' });
    return `Mercado "${market.title}" desasociado de tema "${topic?.name ?? topicId}".`;
  }

  if (block.name === 'update_market') {
    const { marketId: providedMarketId, ...fields } = block.input as Record<string, unknown>;
    // Always use the current page's market when on a market page — prevents operating on wrong market
    const marketId = (contextType === 'market' && contextId) ? contextId : providedMarketId;
    const allowedFields = ['title', 'description', 'resolutionCriteria', 'resolutionSource', 'contingencies', 'category', 'tags', 'outcomes', 'endTimestamp', 'expectedResolutionDate', 'timingSafety', 'status'];
    const updates: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (fields[key] !== undefined) {
        // Coerce numeric fields
        if (key === 'endTimestamp') {
          updates[key] = Number(fields[key]);
        } else {
          updates[key] = fields[key];
        }
      }
    }
    if (Object.keys(updates).length === 0) return 'Sin cambios.';
    const [updated] = await db.update(markets).set(updates).where(eq(markets.id, marketId as string)).returning({ id: markets.id, title: markets.title, endTimestamp: markets.endTimestamp });
    if (!updated) return 'Mercado no encontrado.';
    await logMarketEvent(marketId as string, 'human_edited', { detail: { fields: Object.keys(updates), source: 'chat' } });
    await logActivity('market_updated', { entityType: 'market', entityId: marketId as string, entityLabel: updated.title, detail: updates, source: 'chat' });
    revalidatePath(`/dashboard/markets/${marketId}`);
    const confirmParts = Object.keys(updates).map((k) => {
      if (k === 'endTimestamp') return `cierre: ${new Date(Number(updates[k]) * 1000).toISOString()}`;
      return k;
    });
    return `Mercado actualizado: ${confirmParts.join(', ')}`;
  }

  if (block.name === 'update_signal') {
    const { signalId, ...fields } = block.input as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (fields.category) updates.category = fields.category;
    if (fields.score !== undefined) updates.score = fields.score;
    if (Object.keys(updates).length > 0) {
      await db.update(signals).set(updates).where(eq(signals.id, signalId as string));
    }
    return 'Señal actualizada.';
  }

  if (block.name === 'merge_topics') {
    const { targetTopicId, sourceTopicIds } = block.input as { targetTopicId: string; sourceTopicIds: string[] };
    const now = new Date();

    for (const sourceId of sourceTopicIds) {
      // Delete signals that already exist on target to avoid PK conflicts
      await db.execute(sql`
        DELETE FROM topic_signals
        WHERE topic_id = ${sourceId}
        AND signal_id IN (SELECT signal_id FROM topic_signals WHERE topic_id = ${targetTopicId})
      `);
      // Move remaining signals from source to target
      await db.update(topicSignals).set({ topicId: targetTopicId }).where(eq(topicSignals.topicId, sourceId));
      // Dismiss source topic
      await db.update(topics).set({ status: 'dismissed', updatedAt: now }).where(eq(topics.id, sourceId));
    }

    // Recount target signals
    const [{ count: totalSignals }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(topicSignals)
      .where(eq(topicSignals.topicId, targetTopicId));

    await db.update(topics).set({ signalCount: totalSignals, updatedAt: now }).where(eq(topics.id, targetTopicId));
    const [mergedT] = await db.select({ slug: topics.slug, name: topics.name }).from(topics).where(eq(topics.id, targetTopicId));
    await logActivity('topics_merged', { entityType: 'topic', entityId: targetTopicId, entityLabel: mergedT?.name, detail: { sourceTopicIds, totalSignals, topicSlug: mergedT?.slug }, source: 'chat' });
    return `Merge completado. ${sourceTopicIds.length} tema(s) fusionados. Total señales: ${totalSignals}.`;
  }

  if (block.name === 'link_signal_to_topic') {
    const { topicId, signalIds } = block.input as { topicId: string; signalIds: string[] };
    let linked = 0;
    for (const signalId of signalIds) {
      try {
        await db.insert(topicSignals).values({ topicId, signalId }).onConflictDoNothing();
        linked++;
      } catch { /* skip */ }
    }

    // Update signal count and lastSignalAt
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(topicSignals)
      .where(eq(topicSignals.topicId, topicId));

    await db.update(topics).set({ signalCount: count, lastSignalAt: new Date(), updatedAt: new Date() }).where(eq(topics.id, topicId));
    const [linkedT] = await db.select({ slug: topics.slug, name: topics.name }).from(topics).where(eq(topics.id, topicId));
    await logActivity('signals_linked', { entityType: 'topic', entityId: topicId, entityLabel: linkedT?.name, detail: { linked, total: count, topicSlug: linkedT?.slug }, source: 'chat' });
    return `${linked} señal(es) vinculada(s) al tema. Total: ${count}.`;
  }

  if (block.name === 'research_topic') {
    const { topicId, description } = block.input as { topicId?: string; description: string };

    // Set topic to researching status if provided
    if (topicId) {
      await db.update(topics).set({ status: 'researching', updatedAt: new Date() }).where(eq(topics.id, topicId));
    }

    // Trigger research-only pipeline (gathers signals, does not create/modify topics)
    await inngest.send({
      name: 'topics/research.requested',
      data: { description, topicId },
    });

    if (topicId) {
      const [researchT] = await db.select({ slug: topics.slug }).from(topics).where(eq(topics.id, topicId));
      await logActivity('topic_research_started', { entityType: 'topic', entityId: topicId, entityLabel: description, detail: { topicSlug: researchT?.slug }, source: 'chat' });
    } else {
      await logActivity('topic_research_started', { entityType: 'system', entityLabel: description, source: 'chat' });
    }
    return `Investigación iniciada para "${description}". Se buscarán señales relacionadas.`;
  }

  if (block.name === 'coalesce_topics') {
    const { topicId } = block.input as { topicId?: string };

    await inngest.send({
      name: 'topics/coalesce.requested',
      data: { topicId },
    });

    await logActivity('topic_coalescence_started', { entityType: topicId ? 'topic' : 'system', entityId: topicId, source: 'chat' });
    return topicId
      ? `Coalescencia de temas iniciada para el tema ${topicId}. Se analizarán las señales vinculadas.`
      : 'Coalescencia de temas iniciada. Se analizarán las señales recientes para crear/actualizar temas.';
  }

  if (block.name === 'suggest_topic') {
    const { description, topicId } = block.input as { description: string; topicId?: string };

    // Trigger the full pipeline: research + coalesce
    await inngest.send({
      name: 'topics/suggest.requested',
      data: { description, topicId },
    });

    await logActivity('topic_suggest_started', { entityType: 'system', entityLabel: description, detail: { topicId }, source: 'chat' });
    return `Generación de tema iniciada para "${description}". Se investigará y creará/actualizará un tema.`;
  }

  if (block.name === 'update_rule') {
    const { ruleId, ...fields } = block.input as { ruleId: string; description?: string; check?: string; enabled?: boolean };
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (fields.description !== undefined) updates.description = fields.description;
    if (fields.check !== undefined) updates.check = fields.check;
    if (fields.enabled !== undefined) updates.enabled = fields.enabled;
    await db.update(rulesTable).set(updates).where(eq(rulesTable.id, ruleId));
    await logActivity('rule_updated', { entityType: 'rule', entityLabel: ruleId, detail: fields as Record<string, unknown>, source: 'chat' });
    return `Regla ${ruleId} actualizada.`;
  }

  if (block.name === 'create_rule') {
    const { id, type, description, check } = block.input as { id: string; type: string; description: string; check: string };
    await db.insert(rulesTable).values({ id, type, description, check }).onConflictDoNothing();
    await logActivity('rule_created', { entityType: 'rule', entityLabel: id, detail: { type, description }, source: 'chat' });
    return `Regla ${id} creada.`;
  }

  if (block.name === 'ingest_signals') {
    // Guard: skip if ingestion was already triggered in the last 10 minutes
    const [recentIngest] = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.action, 'ingestion_started'),
          gt(activityLog.createdAt, new Date(Date.now() - 10 * 60 * 1000)),
        ),
      )
      .limit(1);
    if (recentIngest) {
      return 'Ya hay una ingesta en curso (lanzada hace menos de 10 minutos).';
    }
    await inngest.send({ name: 'signals/ingest.requested', data: {} });
    await logActivity('ingestion_started', { entityType: 'system', entityLabel: 'RSS, datos económicos, Twitter', source: 'chat' });
    return 'Ingesta de señales iniciada. Se actualizarán señales y temas cuando termine.';
  }

  if (block.name === 'sync_deployed') {
    const result = await syncDeployedMarkets();
    await logActivity('sync_deployed', { entityType: 'system', entityLabel: `${result.created} nuevos, ${result.updated} actualizados`, detail: result as unknown as Record<string, unknown>, source: 'chat' });
    return `Sync completado: ${result.created} creados, ${result.updated} actualizados, ${result.expanded} expandidos, ${result.resolved} resueltos onchain, ${result.topicLinked} temas vinculados.`;
  }

  if (block.name === 'create_market') {
    const input = block.input as {
      topicId: string; title: string; description?: string; category?: string;
      outcomes?: string[]; closingDate?: string; resolutionCriteria?: string; resolutionSource?: string;
    };

    // Validate topic
    const [topic] = await db.select({ id: topics.id, name: topics.name, slug: topics.slug, category: topics.category }).from(topics).where(eq(topics.id, input.topicId));
    if (!topic) return `Tema "${input.topicId}" no encontrado.`;

    // Convert closing date to timestamp
    let endTimestamp = 0;
    if (input.closingDate) {
      const dateStr = input.closingDate.includes('T') ? input.closingDate : `${input.closingDate}T23:00:00-03:00`;
      endTimestamp = Math.floor(new Date(dateStr).getTime() / 1000);
    }

    const sourceContext: SourceContext = {
      originType: 'manual',
      generatedAt: new Date().toISOString(),
      topicIds: [topic.id],
      topicNames: [topic.name],
    };

    const [created] = await db.insert(markets).values({
      title: input.title,
      description: input.description ?? '',
      category: input.category ?? topic.category,
      outcomes: input.outcomes ?? ['Sí', 'No'],
      endTimestamp: endTimestamp || 0,
      ...(input.closingDate ? { expectedResolutionDate: input.closingDate.split('T')[0] } : {}),
      resolutionCriteria: input.resolutionCriteria ?? '',
      resolutionSource: input.resolutionSource ?? '',
      status: 'candidate',
      sourceContext,
    }).returning({ id: markets.id });

    await logActivity('market_created', {
      entityType: 'market',
      entityId: created.id,
      entityLabel: input.title,
      detail: { topicId: topic.id, topicName: topic.name },
      source: 'chat',
    });

    return `Mercado creado: "${input.title}" (candidato). [Ver mercado](/dashboard/markets/${created.id})`;
  }

  if (block.name === 'review_market') {
    const { marketId: providedId } = block.input as { marketId: string };
    const marketId = (contextType === 'market' && contextId) ? contextId : providedId;
    // Guard: skip if a review was already triggered for this market in the last 10 minutes
    const [recentReview] = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.action, 'review_started'),
          eq(activityLog.entityId, marketId),
          gt(activityLog.createdAt, new Date(Date.now() - 10 * 60 * 1000)),
        ),
      )
      .limit(1);
    if (recentReview) {
      return `Ya hay una revisión en curso para este mercado (lanzada hace menos de 10 minutos).`;
    }
    await inngest.send({
      name: 'market/review.requested',
      data: { marketId },
    });
    await logActivity('review_started', { entityType: 'market', entityId: marketId, source: 'chat' });
    return `Revisión del mercado ${marketId} iniciada.`;
  }

  if (block.name === 'check_resolution') {
    const { marketId: providedId } = block.input as { marketId: string };
    const marketId = (contextType === 'market' && contextId) ? contextId : providedId;
    // Guard: skip if a resolution check was already triggered for this market in the last 10 minutes
    const [recent] = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.action, 'resolution_check_started'),
          eq(activityLog.entityId, marketId),
          gt(activityLog.createdAt, new Date(Date.now() - 10 * 60 * 1000)),
        ),
      )
      .limit(1);
    if (recent) {
      return `Ya hay una verificación de resolución en curso para este mercado (lanzada hace menos de 10 minutos).`;
    }
    await inngest.send({
      name: 'markets/resolution.check',
      data: { id: marketId },
    });
    await logActivity('resolution_check_started', { entityType: 'market', entityId: marketId, source: 'chat' });
    return `Verificación de resolución iniciada para mercado ${marketId}.`;
  }

  if (block.name === 'rescore_topic') {
    const { topicId } = block.input as { topicId: string };
    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
    if (!topic) return 'Tema no encontrado.';

    const feedback = (topic.feedback ?? []) as { text: string; createdAt: string }[];
    const { score, reason } = await rescoreTopic(
      { name: topic.name, summary: topic.summary, category: topic.category },
      feedback,
    );
    await db.update(topics).set({
      score,
      status: score < 2 ? 'stale' : topic.status,
      updatedAt: new Date(),
    }).where(eq(topics.id, topicId));

    await logActivity('topic_rescored', { entityType: 'topic', entityId: topicId, entityLabel: topic.name, detail: { score, reason, topicSlug: topic.slug }, source: 'chat' });
    return `Tema re-puntuado: ${score.toFixed(1)}/10. ${reason}`;
  }

  if (block.name === 'get_generation_prompt') {
    const prompt = await loadGenerationPrompt();
    return prompt;
  }

  if (block.name === 'update_generation_prompt') {
    const { prompt, summary } = block.input as { prompt: string; summary: string };
    await saveGenerationPrompt(prompt);
    await logActivity('generation_prompt_updated', { entityType: 'system', entityLabel: summary, detail: { summary }, source: 'chat' });
    return 'Prompt de generación actualizado.';
  }

  if (block.name === 'get_chat_prompt') {
    const prompt = await loadChatPrompt();
    return prompt;
  }

  if (block.name === 'update_chat_prompt') {
    const { prompt, summary } = block.input as { prompt: string; summary: string };
    await saveChatPrompt(prompt);
    await logActivity('chat_prompt_updated', { entityType: 'system', entityLabel: summary, detail: { summary }, source: 'chat' });
    return 'Prompt del chat actualizado. Los cambios se aplican en el próximo mensaje.';
  }

  if (block.name === 'get_resolution_prompt') {
    const prompt = await loadResolutionPrompt();
    return prompt;
  }

  if (block.name === 'update_resolution_prompt') {
    const { prompt, summary } = block.input as { prompt: string; summary: string };
    await saveResolutionPrompt(prompt);
    await logActivity('resolution_prompt_updated', { entityType: 'system', entityLabel: summary, detail: { summary }, source: 'chat' });
    return 'Prompt de resolución actualizado.';
  }

  if (block.name === 'save_resolution_feedback') {
    const { feedback, marketId } = block.input as { feedback: string; marketId?: string };
    await db.insert(resolutionFeedback).values({ text: feedback, marketId: marketId ?? null });
    await logActivity('resolution_feedback_saved', {
      entityType: marketId ? 'market' : 'system',
      entityId: marketId,
      entityLabel: feedback.slice(0, 80),
      detail: { feedback },
      source: 'chat',
    });
    return 'Feedback de resolución guardado. Se usará en futuras evaluaciones.';
  }

  if (block.name === 'list_signal_sources') {
    const { type: filterType, enabled: filterEnabled } = block.input as { type?: string; enabled?: boolean };
    let query = db.select().from(signalSources);
    const conditions = [];
    if (filterType) conditions.push(eq(signalSources.type, filterType));
    if (filterEnabled !== undefined) conditions.push(eq(signalSources.enabled, filterEnabled));
    const rows = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;
    if (rows.length === 0) return 'No hay fuentes de señales configuradas.';
    return rows.map((s) =>
      `- [${s.id.slice(0, 8)}] ${s.enabled ? '✓' : '✗'} [${s.type}] **${s.name}** — ${s.url}${s.category ? ` (${s.category})` : ''}`
    ).join('\n');
  }

  if (block.name === 'create_signal_source') {
    const { name, type, url, category, config: sourceConfig } = block.input as {
      name: string; type: string; url: string; category?: string; config?: Record<string, unknown>;
    };
    const [created] = await db.insert(signalSources).values({
      name,
      type,
      url,
      category: category ?? null,
      config: sourceConfig ?? null,
    }).returning({ id: signalSources.id });
    await logActivity('signal_source_created', { entityType: 'signal_source', entityId: created.id, entityLabel: name, detail: { type, url, category }, source: 'chat' });
    return `Fuente creada: "${name}" (${type}). ID: ${created.id}`;
  }

  if (block.name === 'update_signal_source') {
    const { sourceId, ...fields } = block.input as Record<string, unknown>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (fields.name !== undefined) updates.name = fields.name;
    if (fields.url !== undefined) updates.url = fields.url;
    if (fields.category !== undefined) updates.category = fields.category;
    if (fields.enabled !== undefined) updates.enabled = fields.enabled;
    if (fields.config !== undefined) updates.config = fields.config;
    await db.update(signalSources).set(updates).where(eq(signalSources.id, sourceId as string));
    await logActivity('signal_source_updated', { entityType: 'signal_source', entityId: sourceId as string, entityLabel: (fields.name as string) ?? undefined, detail: fields as Record<string, unknown>, source: 'chat' });
    return `Fuente ${sourceId} actualizada.`;
  }

  return 'Tool no reconocido.';
}

// --- GET: list conversations ---

export async function GET(request: NextRequest) {
  const contextType = request.nextUrl.searchParams.get('contextType') as ContextType | null;
  const contextId = request.nextUrl.searchParams.get('contextId');
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit')) || 10, 50);
  const offset = Number(request.nextUrl.searchParams.get('offset')) || 0;

  const whereClause = contextType && contextId
    ? and(eq(conversations.contextType, contextType), eq(conversations.contextId, contextId))
    : contextType
      ? eq(conversations.contextType, contextType)
      : undefined;

  const [rows, [{ total }]] = await Promise.all([
    whereClause
      ? db.select().from(conversations).where(whereClause).orderBy(desc(conversations.updatedAt)).limit(limit + 1).offset(offset)
      : db.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(limit + 1).offset(offset),
    whereClause
      ? db.select({ total: sql<number>`count(*)::int` }).from(conversations).where(whereClause)
      : db.select({ total: sql<number>`count(*)::int` }).from(conversations),
  ]);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    conversations: sliced.map((c) => ({
      id: c.id,
      contextType: c.contextType,
      contextId: c.contextId,
      title: c.title,
      messages: c.messages,
      updatedAt: c.updatedAt.toISOString(),
    })),
    hasMore,
    total,
  });
}

// --- POST: send message ---

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const messages: ChatMessage[] = body.messages ?? [];
  const contextType: ContextType = body.contextType ?? 'global';
  const contextId: string | null = body.contextId ?? null;
  const conversationId: string | undefined = body.conversationId;
  const pageContext: { label: string; content: string } | null = body.pageContext ?? null;

  console.log(`[chat POST] contextType=${contextType} contextId=${contextId} conversationId=${conversationId}`);

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Last message must be from user' }, { status: 400 });
  }

  try {

  // Build context
  const tz = await getUserTimezone();
  let entityContext = '';
  if (contextType === 'topic' && contextId) {
    entityContext = await buildTopicContext(contextId);
  } else if (contextType === 'market' && contextId) {
    entityContext = await buildMarketContext(contextId, tz);
  } else if (contextType === 'signal' && contextId) {
    entityContext = await buildSignalContext(contextId);
  }

  // Load global feedback as generation guidelines
  const existingGlobal = await db.select().from(globalFeedback).limit(50);
  const globalContext = existingGlobal.length > 0
    ? `\nINSTRUCCIONES DE GENERACIÓN (aplicar siempre):\n${existingGlobal.map((r) => `- ${r.text}`).join('\n')}`
    : '';

  const { hard: hardRules, soft: softRules } = await loadRules();
  const rulesContext = `\nREGLAS DE MERCADOS:\nEstrictas:\n${hardRules.map((r) => `- ${r.id}: ${r.description}\n  Check: ${r.check}`).join('\n')}\n\nAdvertencias:\n${softRules.map((r) => `- ${r.id}: ${r.description}\n  Check: ${r.check}`).join('\n')}`;

  // Load all topics, markets, and signals for global awareness
  const [topicsSummary, marketsSummary, signalsSummary, chatPrompt] = await Promise.all([
    loadTopicsSummary(),
    loadMarketsSummary(),
    loadSignalsSummary(),
    loadChatPrompt(),
  ]);

  const pageContextBlock = pageContext
    ? `\nCONTENIDO VISIBLE EN LA PÁGINA (${pageContext.label}):\n${pageContext.content}\n`
    : '';

  const systemMessage = `${chatPrompt}\n\n${entityContext}${pageContextBlock}${topicsSummary}${marketsSummary}${signalsSummary}${rulesContext}${globalContext}`;

  // Multi-turn tool loop — continues until Claude stops calling tools
  let apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
  let reply = '';
  let redirect: string | null = null;
  const activityIds: string[] = [];

  for (let turn = 0; turn < 20; turn++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemMessage,
      tools: TOOLS,
      messages: apiMessages,
    });

    logUsage('chat', 'claude-sonnet-4-20250514', response.usage.input_tokens, response.usage.output_tokens);

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    // Collect any text from this response
    const textParts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        textParts.push(block.text.trim());
      }
    }

    if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
      console.log(`[chat] turn=${turn} tool_use: ${toolUseBlocks.map(b => b.name).join(', ')}`);
      // Execute all tools and feed results back to Claude
      apiMessages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        let result: string;
        try {
          result = await executeTool(block, contextType, contextId, tz);
        } catch (err) {
          console.error(`[chat] tool ${block.name} failed:`, err);
          result = `Error ejecutando ${block.name}: ${err instanceof Error ? err.message : String(err)}`;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }
      apiMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    // End turn — extract text reply
    console.log(`[chat] turn=${turn} end_turn text="${textParts.join(' ').slice(0, 100)}"`);

    // Execute any remaining tool calls (side effects on end_turn)
    for (const block of toolUseBlocks) {
      try {
        await executeTool(block, contextType, contextId, tz);
      } catch (err) {
        console.error(`[chat] end-turn tool ${block.name} failed:`, err);
      }
    }

    reply = textParts.join('\n\n');
    break;
  }

  console.log(`[chat] final reply length=${reply.length} preview="${reply.slice(0, 100)}"`);
  if (!reply) reply = 'No entendí, ¿podés reformular?';

  // Collect activity IDs created during this request (by source=chat, last 30 seconds)
  try {
    const recentActivity = await db.select({ id: activityLog.id }).from(activityLog)
      .where(and(eq(activityLog.source, 'chat'), gt(activityLog.createdAt, new Date(Date.now() - 30_000))))
      .orderBy(desc(activityLog.createdAt))
      .limit(10);
    activityIds.push(...recentActivity.map((r) => r.id));
  } catch { /* ignore */ }

  // Include activityIds in the assistant message for persistence
  const assistantMessage: ChatMessage = { role: 'assistant', content: reply, ...(activityIds.length > 0 ? { activityIds } : {}) };
  const fullConversation: ChatMessage[] = [...messages, assistantMessage];

  // Persist conversation
  const title = messages[0].content.slice(0, 80);
  let resultConvId = conversationId;

  if (conversationId) {
    await db
      .update(conversations)
      .set({ messages: fullConversation, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  } else {
    const [created] = await db
      .insert(conversations)
      .values({ contextType, contextId, title, messages: fullConversation })
      .returning({ id: conversations.id });
    resultConvId = created.id;
  }

  // Check if the current topic was renamed (slug changed)
  if (contextType === 'topic' && contextId) {
    const [updatedTopic] = await db.select({ slug: topics.slug }).from(topics).where(eq(topics.id, contextId));
    if (updatedTopic) {
      redirect = `/dashboard/topics/${updatedTopic.slug}`;
    }
  }

  return NextResponse.json({ reply, conversation: fullConversation, conversationId: resultConvId, redirect, activityIds });

  } catch (err) {
    console.error('[chat POST] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- DELETE: delete conversation ---

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  await db.delete(conversations).where(eq(conversations.id, id));
  return NextResponse.json({ ok: true });
}
