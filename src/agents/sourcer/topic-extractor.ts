import { callClaude } from '@/lib/llm';
import { db } from '@/db/client';
import { topics as topicsTable, globalFeedback } from '@/db/schema';
import { desc, gte, eq, and, isNotNull, lt } from 'drizzle-orm';
import type { SourceSignal, Topic } from './types';

export interface TopicUpdate {
  action: 'update' | 'create' | 'merge' | 'split';
  existingTopicSlug?: string;
  mergeFromSlugs?: string[];
  splitFromSlug?: string;
  name: string;
  slug: string;
  summary: string;
  signalIndices: number[];
  suggestedAngles: string[];
  category: string;
  score: number;
}

const SYSTEM_PROMPT = `Sos un analista de señales para Predmarks, una plataforma argentina de mercados de predicción.

Tu trabajo es tomar un conjunto de señales crudas (noticias, tendencias, datos económicos) y ACTUALIZAR una base de temas persistente.

PROCESO:
1. Revisar los TEMAS EXISTENTES activos
2. Para cada señal nueva, decidir si COINCIDE con un tema existente o si es un TEMA NUEVO
3. Para temas que coinciden: actualizar el nombre, resumen y ángulos incorporando la nueva información, re-puntuar
4. Para temas nuevos: crear con nombre, resumen, ángulos y puntaje
5. NO crear temas duplicados — si una señal habla del mismo tema que uno existente, usar UPDATE
6. Si dos temas existentes son en realidad el MISMO tema: usar MERGE para combinarlos
7. Si un tema creció demasiado y cubre ángulos no relacionados: usar SPLIT para separarlo

RESUMEN — CÓMO ESCRIBIR UN BUEN RESUMEN:
El resumen debe ser un DIGEST informativo de 3-5 oraciones que incluya:
- QUÉ PASÓ: los hechos clave extraídos de las señales
- POR QUÉ IMPORTA: relevancia para la audiencia argentina
- ESTADO ACTUAL: últimos datos, cifras o declaraciones relevantes
- TENSIÓN: qué está en disputa o es incierto (esto es lo que hace un buen mercado)
NO repetir titulares. SINTETIZAR la información de TODAS las señales del tema.
Cuando actualizás un tema existente, INCORPORÁ la nueva info al resumen previo, no lo reemplaces.

CRITERIOS DE PUNTUACIÓN:
- Controversia (0-10): ¿Ambos resultados son plausibles y divisivos?
- Temporalidad (0-10): ¿Tiene fecha de resolución clara y próxima?
- Interés (0-10): ¿Le importa a la audiencia argentina?
- Medibilidad (0-10): ¿Se puede verificar con fuente pública?
Score = promedio de los 4.

REGLAS:
- Enfoque Argentina (política, economía, deportes, entretenimiento, clima)
- Los ángulos deben ser preguntas específicas para mercados predictivos (binarios sí/no o multi-opción), no vagas
- Cada ángulo debe tener una fecha de resolución implícita
- Evitar temas puramente informativos sin ángulo predictivo
- Preferir temas donde hay TENSIÓN (dos posturas posibles)
- Para updates: existingTopicSlug DEBE coincidir con el slug del tema existente. Podés cambiar el nombre y slug del tema si evolucionó
- Para creates: generar un slug nuevo (lowercase, sin acentos, guiones, max 100 chars)
- Para merges: existingTopicSlug = tema destino, mergeFromSlugs = slugs de temas a absorber. El tema destino se queda con todo
- Para splits: splitFromSlug = slug del tema a dividir. Creás el nuevo tema con las señales que se separan

IMPORTANTE: Cada tema DEBE referenciar al menos una señal en signalIndices. NUNCA devolver signalIndices vacío.`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    topicUpdates: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string' as const,
            enum: ['update', 'create', 'merge', 'split'],
            description: '"update" para actualizar temas existentes, "create" para nuevos, "merge" para combinar duplicados, "split" para dividir temas amplios',
          },
          existingTopicSlug: {
            type: 'string' as const,
            description: 'Para update/merge: slug del tema existente destino',
          },
          mergeFromSlugs: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'Solo para action=merge: slugs de temas a absorber en el tema destino',
          },
          splitFromSlug: {
            type: 'string' as const,
            description: 'Solo para action=split: slug del tema que se está dividiendo',
          },
          name: { type: 'string' as const, description: 'Nombre corto del tema' },
          slug: {
            type: 'string' as const,
            description: 'Slug del tema (lowercase, sin acentos, guiones, max 100 chars)',
          },
          summary: {
            type: 'string' as const,
            description: 'Resumen detallado (3-5 oraciones): qué pasó, por qué importa, estado actual, qué está en tensión. Sintetizar todas las señales, no repetir titulares. Para updates: incorporar nueva info al resumen existente.',
          },
          signalIndices: {
            type: 'array' as const,
            items: { type: 'number' as const },
            description: 'Índices (1-based) de las señales NUEVAS que contribuyen a este tema',
          },
          suggestedAngles: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: '1-3 preguntas específicas para mercados predictivos (binarios o multi-opción)',
          },
          category: {
            type: 'string' as const,
            enum: ['Política', 'Economía', 'Deportes', 'Entretenimiento', 'Clima', 'Otros'],
          },
          score: { type: 'number' as const, description: 'Score 0-10 de potencial de mercado' },
        },
        required: ['action', 'name', 'slug', 'summary', 'signalIndices', 'suggestedAngles', 'category', 'score'] as const,
      },
    },
  },
  required: ['topicUpdates'] as const,
};

function formatSignalsForExtraction(signals: SourceSignal[]): string {
  return signals
    .map((s, i) => {
      const parts = [`${i + 1}. [${s.source}] [${s.type}] ${s.text}`];
      if (s.summary) parts.push(`   ${s.summary.slice(0, 800)}`);
      return parts.join('\n');
    })
    .join('\n');
}

async function loadEditorFeedback(): Promise<string> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [globalEntries, dismissedTopics] = await Promise.all([
    db
      .select({ text: globalFeedback.text })
      .from(globalFeedback)
      .orderBy(desc(globalFeedback.createdAt))
      .limit(50),
    db
      .select({ name: topicsTable.name, feedback: topicsTable.feedback })
      .from(topicsTable)
      .where(
        and(
          eq(topicsTable.status, 'dismissed'),
          isNotNull(topicsTable.feedback),
          gte(topicsTable.updatedAt, thirtyDaysAgo),
        ),
      )
      .orderBy(desc(topicsTable.updatedAt))
      .limit(50),
  ]);

  const lines: string[] = [];

  if (globalEntries.length > 0) {
    lines.push('Instrucciones globales:');
    for (const e of globalEntries) {
      lines.push(`- ${e.text}`);
    }
  }

  const dismissedWithReasons = dismissedTopics.filter(
    (t) => t.feedback && Array.isArray(t.feedback) && t.feedback.length > 0,
  );
  if (dismissedWithReasons.length > 0) {
    lines.push('');
    lines.push('Temas descartados (evitar patrones similares):');
    for (const t of dismissedWithReasons) {
      const reasons = (t.feedback as { text: string; createdAt: string }[])
        .map((f) => f.text)
        .join('; ');
      lines.push(`- Tema descartado: "${t.name}" — Motivo: ${reasons}`);
    }
  }

  if (lines.length === 0) return '';
  return `\nFEEDBACK DEL EDITOR:\n${lines.join('\n')}\n`;
}

function formatExistingTopics(topics: Topic[]): string {
  if (topics.length === 0) return 'No hay temas existentes.';
  return topics
    .map((t) => {
      const angles = t.suggestedAngles.map((a) => `   - ${a}`).join('\n');
      return `- [${t.slug}] [${t.category}] ${t.name} (score: ${t.score}/10, señales: ${t.signalCount ?? 0})\n   ${t.summary}\n   Ángulos:\n${angles}`;
    })
    .join('\n\n');
}

export async function updateTopics(
  signals: SourceSignal[],
  existingTopics: Topic[],
): Promise<TopicUpdate[]> {
  if (signals.length === 0) return [];

  const today = new Date().toISOString().split('T')[0];
  const editorFeedback = await loadEditorFeedback();

  const { result } = await callClaude<{ topicUpdates: TopicUpdate[] }>({
    system: SYSTEM_PROMPT,
    model: 'opus',
    operation: 'extract_topics',
    userMessage: `HOY: ${today}
${editorFeedback}
TEMAS EXISTENTES ACTIVOS (${existingTopics.length}):
${formatExistingTopics(existingTopics)}

SEÑALES NUEVAS (${signals.length} total):
${formatSignalsForExtraction(signals)}

Analizá las señales nuevas y devolvé las actualizaciones de temas (updates y creates).`,
    outputSchema: OUTPUT_SCHEMA,
    outputToolName: 'update_topics',
  });

  return result.topicUpdates;
}

export async function markStaleTopics(): Promise<void> {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  await db
    .update(topicsTable)
    .set({ status: 'stale', updatedAt: new Date() })
    .where(
      and(
        eq(topicsTable.status, 'active'),
        lt(topicsTable.lastSignalAt, fortyEightHoursAgo),
      ),
    );
}

// Keep backward-compatible export for any remaining references
export async function extractTopics(signals: SourceSignal[]): Promise<Topic[]> {
  const updates = await updateTopics(signals, []);
  return updates.map((u) => ({
    name: u.name,
    slug: u.slug,
    summary: u.summary,
    signalIndices: u.signalIndices,
    suggestedAngles: u.suggestedAngles,
    category: u.category as Topic['category'],
    score: u.score,
  }));
}
