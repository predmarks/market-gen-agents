import { callClaudeWithSearch } from '@/lib/llm';

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
}

const SYSTEM_PROMPT = `Sos un evaluador de resolución para Predmarks, una plataforma argentina de mercados de predicción.
Tu trabajo es verificar si el evento de resolución de un mercado ya ocurrió, y si es así, cuál es el resultado.

REGLAS:
- Buscá información actualizada usando web search. No adivines.
- Basate EXCLUSIVAMENTE en los criterios de resolución definidos en el mercado.
- Si no encontrás evidencia clara, reportá "unresolved" o "unclear".
- EMERGENCIA: Si el evento ya se resolvió pero la fecha de cierre del mercado es futura, marcá isEmergency = true (riesgo de arbitraje LMSR).
- La evidencia debe ser CONCISA: 1-2 oraciones directas con el dato clave. Sin rodeos ni contexto innecesario.
- La primera URL en evidenceUrls debe ser la fuente principal de resolución. El resto son secundarias.
- Todo el contenido en español argentino.`;

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

  const userMessage = `Evaluá si este mercado se puede resolver.

MERCADO:
- Título: ${market.title}
- Descripción: ${market.description}
- Opciones: ${market.outcomes.join(', ')}
- Criterios de resolución: ${market.resolutionCriteria}
- Fuente de resolución: ${market.resolutionSource}
- Cierre del mercado: ${endDate.toISOString()} ${isPastDeadline ? '(YA PASÓ)' : ''}

HOY: ${now.toISOString().split('T')[0]}

INSTRUCCIONES:
1. Buscá en la web si el evento de resolución ya ocurrió.
2. Si encontrás evidencia clara, indicá el resultado exacto (debe ser una de las opciones: ${market.outcomes.join(', ')}).
3. Si el evento ya ocurrió pero la fecha de cierre es futura → EMERGENCIA.
${isPastDeadline ? '4. El mercado ya pasó su fecha de cierre. Si no hay evidencia de que la condición se cumplió, sugerí el resultado por defecto según los criterios.' : ''}

Buscá en la fuente de resolución indicada y en fuentes complementarias.`;

  const { result } = await callClaudeWithSearch<ResolutionCheck>({
    system: SYSTEM_PROMPT,
    userMessage,
    outputSchema: OUTPUT_SCHEMA,
    outputToolName: 'resolution_check',
    model: 'sonnet',
    operation: 'resolve_check',
  });

  return result;
}
