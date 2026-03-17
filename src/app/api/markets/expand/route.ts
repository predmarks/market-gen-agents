import { NextRequest, NextResponse } from 'next/server';
import { callClaude } from '@/lib/llm';
import { MARKET_CATEGORIES } from '@/db/types';

const REQUIRED_FIELDS = [
  'title', 'description', 'resolutionCriteria', 'resolutionSource',
  'category', 'endTimestamp', 'contingencies', 'tags', 'expectedResolutionDate',
] as const;

type MarketField = (typeof REQUIRED_FIELDS)[number];

function getMissingFields(partial: Record<string, unknown>): MarketField[] {
  return REQUIRED_FIELDS.filter((f) => {
    const val = partial[f];
    return val === undefined || val === null || val === '';
  });
}

function buildOutputSchema(missing: MarketField[]) {
  const fieldSchemas: Record<string, Record<string, unknown>> = {
    title: { type: 'string', description: 'Pregunta cerrada sí/no' },
    description: { type: 'string', description: 'Contexto del mercado' },
    resolutionCriteria: { type: 'string', description: 'Criterios inequívocos de resolución' },
    resolutionSource: { type: 'string', description: 'Fuente oficial para resolver' },
    category: { type: 'string', enum: [...MARKET_CATEGORIES] },
    endTimestamp: { type: 'number', description: 'Unix timestamp (segundos) de cierre del mercado' },
    contingencies: { type: 'string', description: 'Contingencias (vacío si no aplica)' },
    tags: { type: 'array', items: { type: 'string' } },
    expectedResolutionDate: { type: 'string', description: 'Fecha esperada de resolución YYYY-MM-DD' },
  };

  const properties: Record<string, Record<string, unknown>> = {};
  for (const f of missing) {
    properties[f] = fieldSchemas[f];
  }

  return {
    type: 'object' as const,
    properties,
    required: [...missing],
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { partial } = body as { partial: Record<string, unknown> };

  if (!partial || typeof partial !== 'object') {
    return NextResponse.json({ error: 'Se requiere el campo "partial" (objeto)' }, { status: 400 });
  }

  const missing = getMissingFields(partial);

  // Nothing missing — return as-is
  if (missing.length === 0) {
    return NextResponse.json(partial);
  }

  const provided = Object.entries(partial)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join('\n');

  const system = `Sos un experto en mercados de predicción para Argentina.
El usuario ya definió parte de un mercado de predicción binario (Sí/No).
Tu trabajo es completar SOLO los campos faltantes, basándote en la información proporcionada.

Campos ya definidos por el usuario (NO modificar):
${provided}

Reglas para los campos que generes:
- El título DEBE ser una pregunta cerrada que se responda con Sí o No
- La descripción da contexto sobre el evento
- Los criterios de resolución deben ser inequívocos y verificables
- La fuente de resolución debe ser una autoridad o URL verificable
- La categoría debe ser una de: ${MARKET_CATEGORIES.join(', ')}
- endTimestamp es Unix timestamp (segundos) para cierre del mercado (antes de la resolución)
- expectedResolutionDate en formato YYYY-MM-DD
- Todo el contenido en español argentino
- Hoy es ${new Date().toISOString().split('T')[0]}

REGLAS CRÍTICAS para contingencias:
- NUNCA mencionar reembolsos, devoluciones, ni declarar mercados como "inválidos"
- Los mercados SIEMPRE se resuelven como "Sí" o "No", sin excepciones
- Si un evento se cancela, pospone indefinidamente, o no ocurre → se resuelve como "No"
- Si la fuente no publica datos, usar el último dato disponible o fuente alternativa
- Predmarks se reserva el derecho de modificar fechas de cierre ante cambios en la programación`;

  try {
    const { result } = await callClaude<Record<string, unknown>>({
      system,
      userMessage: `Completá los campos faltantes: ${missing.join(', ')}`,
      outputSchema: buildOutputSchema(missing),
    });

    // Merge: user-provided fields take precedence
    const merged = { ...result, ...partial };
    return NextResponse.json(merged);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error al completar campos' },
      { status: 500 },
    );
  }
}
