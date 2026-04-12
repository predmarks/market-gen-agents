import { callClaude } from '@/lib/llm';
import { todayAR } from '@/lib/dates';
import type { SourceSignal } from './types';

const SYSTEM_PROMPT = `Sos un evaluador de señales para Predmarks, una plataforma argentina de mercados de predicción.
Tu trabajo es puntuar señales (noticias, tendencias, datos económicos) por su potencial para generar buenos mercados predictivos.

Criterios de puntuación (0-10):
- **Controversia**: ¿Los resultados posibles son plausibles y divisivos? (0 = obvio, 10 = muy divisivo)
- **Temporalidad**: ¿Se puede resolver en días/semanas? (0 = vago/lejano, 10 = fecha clara próxima)
- **Interés**: ¿Le importa a la audiencia argentina? (0 = irrelevante, 10 = tema caliente)
- **Medibilidad**: ¿Se puede verificar con fuente pública? (0 = subjetivo, 10 = dato duro)

Score final = promedio de los 4 criterios.

Descartá (score 0) señales que:
- Son puramente informativas sin ángulo predictivo
- Son demasiado vagas para generar un mercado concreto
- Ya ocurrieron (el resultado ya se conoce)`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    scores: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'number' as const, description: 'Índice de la señal (1-based)' },
          score: { type: 'number' as const, description: 'Score 0-10' },
          reason: { type: 'string' as const, description: 'Razón breve del score' },
        },
        required: ['index', 'score', 'reason'] as const,
      },
    },
  },
  required: ['scores'] as const,
};

interface ScoreResult {
  index: number;
  score: number;
  reason: string;
}

const RESCORE_SCHEMA = {
  type: 'object' as const,
  properties: {
    score: { type: 'number' as const, description: 'Nuevo score 0-10' },
    reason: { type: 'string' as const, description: 'Razón del nuevo score' },
  },
  required: ['score', 'reason'] as const,
};

export async function rescoreTopic(
  topic: { name: string; summary: string; category: string },
  feedback: { text: string; createdAt: string }[],
): Promise<{ score: number; reason: string }> {
  const feedbackLines = feedback.map((f) => `- ${f.text}`).join('\n');

  const { result } = await callClaude<{ score: number; reason: string }>({
    system: `Sos un evaluador de temas para Predmarks, una plataforma argentina de mercados de predicción.
Re-evaluá el score de este tema (0-10) considerando el feedback del editor.

Criterios:
- Controversia (0-10): ¿Ambos resultados son plausibles?
- Temporalidad (0-10): ¿Tiene fecha de resolución clara y próxima?
- Interés (0-10): ¿Le importa a la audiencia ARGENTINA? (temas no locales = score bajo)
- Medibilidad (0-10): ¿Se puede verificar con fuente pública?

Score = promedio. El feedback del editor tiene MÁXIMA prioridad.
Si el editor dice que algo no es relevante, el score debe bajar drásticamente.`,
    userMessage: `TEMA: ${topic.name}
CATEGORÍA: ${topic.category}
RESUMEN: ${topic.summary}

FEEDBACK DEL EDITOR:
${feedbackLines}

Re-evaluá el score considerando este feedback.`,
    outputSchema: RESCORE_SCHEMA,
    outputToolName: 'rescore_topic',
    operation: 'rescore_topic',
  });

  return result;
}

export async function scoreSignals(signals: SourceSignal[]): Promise<SourceSignal[]> {
  if (signals.length === 0) return [];

  const signalList = signals
    .map((s, i) => {
      const parts = [`${i + 1}. [${s.source}] [${s.type}] ${s.text}`];
      if (s.summary) parts.push(`   ${s.summary.slice(0, 200)}`);
      return parts.join('\n');
    })
    .join('\n');

  const today = todayAR();

  const { result } = await callClaude<{ scores: ScoreResult[] }>({
    system: SYSTEM_PROMPT,
    userMessage: `HOY: ${today}\n\nSEÑALES A EVALUAR:\n${signalList}`,
    outputSchema: OUTPUT_SCHEMA,
    outputToolName: 'score_signals',
    operation: 'score_signals',
  });

  // Apply scores to signals
  const scoreMap = new Map(result.scores.map((s) => [s.index, s]));
  return signals.map((signal, i) => {
    const scored = scoreMap.get(i + 1);
    return {
      ...signal,
      score: scored?.score ?? 0,
      scoreReason: scored?.reason ?? '',
    };
  });
}
