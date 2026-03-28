import { callClaudeWithSearch } from '@/lib/llm';
import { db } from '@/db/client';
import { config, resolutionFeedback } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export interface ResolutionCheck {
  status: 'resolved' | 'unresolved' | 'unclear';
  suggestedOutcome: string | null;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  evidenceUrls: string[];
  isEmergency: boolean;
  emergencyReason: string | null;
}

interface MarketForResolution {
  title: string;
  description: string;
  outcomes: string[];
  resolutionCriteria: string;
  resolutionSource: string;
  endTimestamp: number;
  feedback?: string[];
  sourceContent?: { url: string; text: string } | null;
}

const DEFAULT_RESOLUTION_PROMPT = `Sos un evaluador de resolución para Predmarks, una plataforma argentina de mercados de predicción.
Tu trabajo es verificar si el evento de resolución de un mercado ya ocurrió, y si es así, cuál es el resultado.

REGLAS CRÍTICAS — FUENTE DE RESOLUCIÓN:
- Cada mercado define una FUENTE DE RESOLUCIÓN obligatoria (ej: "BCRA", "INDEC", "JP Morgan EMBI", "FIFA"). Esta fuente es la ÚNICA autoridad válida.
- Buscá PRIMERO y EXCLUSIVAMENTE datos de esa fuente específica. No uses fuentes alternativas como evidencia primaria.
- La primera URL en evidenceUrls DEBE ser de la fuente de resolución indicada en el mercado.
- Si NO encontrás datos de la fuente obligatoria: podés usar fuentes alternativas PERO la confianza NUNCA puede ser "high" — debe ser "medium" como máximo, y "low" si la fuente alternativa no es confiable.
- En la evidencia, citá explícitamente de dónde viene el dato: "Según [fuente], el valor fue X al DD/MM".

REGLAS — CRITERIOS DE RESOLUCIÓN:
- Los criterios de resolución del mercado son OBLIGATORIOS. Verificá cada condición punto por punto.
- No interpretes libremente — aplicá los criterios TAL CUAL están escritos.
- Si los criterios dicen "cierre del viernes" y solo tenés datos del jueves, reportá "unresolved".

REGLAS GENERALES:
- Buscá información actualizada usando web search. No adivines.
- Si no encontrás evidencia clara, reportá "unresolved" o "unclear".
- EMERGENCIA: Si el evento ya se resolvió pero la fecha de cierre del mercado es futura, marcá isEmergency = true (riesgo de arbitraje LMSR).
- La evidencia debe ser CONCISA: 1-2 oraciones directas con el dato clave. Sin rodeos ni contexto innecesario.
- Si hay feedback de resoluciones previas, tenelo en cuenta para mejorar tu evaluación.
- Todo el contenido en español argentino.`;

export async function loadResolutionPrompt(): Promise<string> {
  try {
    const [row] = await db.select().from(config).where(eq(config.key, 'resolution_prompt'));
    if (row?.value) return row.value;
  } catch { /* fallback */ }
  return DEFAULT_RESOLUTION_PROMPT;
}

export async function saveResolutionPrompt(prompt: string): Promise<void> {
  await db
    .insert(config)
    .values({ key: 'resolution_prompt', value: prompt })
    .onConflictDoUpdate({ target: config.key, set: { value: prompt, updatedAt: new Date() } });
}

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    status: {
      type: 'string' as const,
      enum: ['resolved', 'unresolved', 'unclear'],
      description: 'resolved = evento ocurrió y resultado es claro. unresolved = no ocurrió. unclear = evidencia parcial.',
    },
    suggestedOutcome: {
      type: 'string' as const,
      description: 'Resultado sugerido — debe ser exactamente una de las opciones del mercado, o null si no se resolvió.',
    },
    confidence: {
      type: 'string' as const,
      enum: ['high', 'medium', 'low'],
    },
    evidence: {
      type: 'string' as const,
      description: 'Máximo 1-2 oraciones directas con el dato clave de resolución. Sin contexto ni rodeos.',
    },
    evidenceUrls: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'URLs de las fuentes. La primera debe ser la fuente principal de resolución.',
    },
    isEmergency: {
      type: 'boolean' as const,
      description: 'true si el evento se resolvió pero el mercado todavía está abierto (fecha de cierre futura).',
    },
    emergencyReason: {
      type: 'string' as const,
      description: 'Motivo de la emergencia, si aplica.',
    },
  },
  required: ['status', 'suggestedOutcome', 'confidence', 'evidence', 'evidenceUrls', 'isEmergency', 'emergencyReason'] as const,
};

export async function evaluateResolution(market: MarketForResolution): Promise<ResolutionCheck> {
  const now = new Date();
  const endDate = new Date(market.endTimestamp * 1000);
  const isPastDeadline = now > endDate;

  // Load editable prompt and feedback (graceful if table doesn't exist yet)
  let globalFeedbackTexts: string[] = [];
  const [systemPrompt] = await Promise.all([
    loadResolutionPrompt(),
    db.select({ text: resolutionFeedback.text }).from(resolutionFeedback).orderBy(desc(resolutionFeedback.createdAt)).limit(20)
      .then((rows) => { globalFeedbackTexts = rows.map((r) => r.text); })
      .catch(() => { /* table may not exist yet */ }),
  ]);

  const feedbackContext = [
    ...(market.feedback ?? []),
    ...globalFeedbackTexts,
  ];

  const userMessage = `Evaluá si este mercado se puede resolver.

MERCADO:
- Título: ${market.title}
- Descripción: ${market.description}
- Opciones: ${market.outcomes.join(', ')}
- Criterios de resolución: ${market.resolutionCriteria}
- Fuente de resolución: ${market.resolutionSource}
- Cierre del mercado: ${endDate.toISOString()} ${isPastDeadline ? '(YA PASÓ)' : ''}

HOY: ${now.toISOString().split('T')[0]}
${market.sourceContent ? `\nCONTENIDO DE LA FUENTE DE RESOLUCIÓN (pre-cargado de ${market.sourceContent.url}):\n${market.sourceContent.text}` : ''}
${feedbackContext.length > 0 ? `\nFEEDBACK DE RESOLUCIONES PREVIAS:\n${feedbackContext.map((f) => `- ${f}`).join('\n')}` : ''}

INSTRUCCIONES:
1. Leé los CRITERIOS DE RESOLUCIÓN del mercado. Estos son las condiciones exactas que determinan el resultado. No los ignores.
2. Identificá la FUENTE DE RESOLUCIÓN obligatoria (campo "Fuente de resolución" arriba). Esta es la ÚNICA fuente válida para la decisión.
3. Buscá datos EXCLUSIVAMENTE en esa fuente. Si hay una URL explícita en la descripción o criterios, navegá ahí directamente.
4. Verificá cada criterio de resolución punto por punto contra los datos de la fuente obligatoria.
5. Si encontrás evidencia clara EN LA FUENTE OBLIGATORIA, indicá el resultado exacto (debe ser una de las opciones: ${market.outcomes.join(', ')}).
6. Si NO encontrás la fuente obligatoria: podés usar alternativas, pero confidence = "medium" como máximo.
7. La primera URL en evidenceUrls DEBE ser de la fuente de resolución del mercado. Si usás una alternativa, explicá por qué.
8. La evidencia debe citar: "Según [FUENTE EXACTA], [dato concreto] al [fecha]".
9. Si el evento ya ocurrió pero la fecha de cierre es futura → EMERGENCIA.
${isPastDeadline ? '10. El mercado ya pasó su fecha de cierre. Si no hay evidencia de que la condición se cumplió, sugerí el resultado por defecto según los criterios.' : ''}`;

  const { result } = await callClaudeWithSearch<ResolutionCheck>({
    system: systemPrompt,
    userMessage,
    outputSchema: OUTPUT_SCHEMA,
    outputToolName: 'resolution_check',
    model: 'sonnet',
    operation: 'resolve_check',
  });

  return result;
}
