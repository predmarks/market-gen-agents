import { config } from 'dotenv';
config({ path: ['.env.local', '.env'] });
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';

const sql = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(sql, { schema });

const seedMarkets = [
  {
    title: '¿Racing vence a Sarmiento el Martes 10 de Marzo?',
    description:
      'Racing visita a Sarmiento en Junín por la Fecha 10 del Torneo Apertura 2026.',
    resolutionCriteria:
      'Este mercado se resolverá como "Sí" si Racing Club gana a Sarmiento en tiempo reglamentario (90 minutos más adición) el Martes 10 de Marzo de 2026 (Fecha 10 Torneo Apertura). Se resolverá como "No" si Racing empata o pierde.',
    resolutionSource:
      'Resultados oficiales publicados por la Liga Profesional de Fútbol (www.ligaprofesional.ar).',
    contingencies:
      'Si el partido se reprograma a una fecha anterior a la prevista, el mercado se cerrará anticipadamente antes del inicio del partido y se resolverá según el resultado en la nueva fecha. Si se posterga a una fecha posterior al cierre del mercado, o se cancela o suspende, se resolverá como "No". Un cambio de horario dentro del mismo día no afecta al mercado. Predmarks se reserva el derecho de modificar la fecha de cierre del mercado ante cambios en la programación del evento. Se considera únicamente el resultado en tiempo reglamentario (90 minutos más tiempo adicionado).',
    category: 'Deportes',
    tags: ['fútbol', 'liga-profesional', 'racing', 'sarmiento'],
    endTimestamp: Math.floor(
      new Date(Date.UTC(2026, 2, 11, 1, 30, 0)).getTime() / 1000,
    ),
    expectedResolutionDate: '2026-03-11',
    timingSafety: 'safe',
    status: 'open',
    publishedAt: new Date('2026-03-04'),
    sourceContext: {
      originType: 'event_calendar' as const,
      originText: 'Fixture Fecha 10 Torneo Apertura 2026',
      generatedAt: '2026-03-03T12:00:00Z',
    },
  },
  {
    title:
      '¿Superarán las Reservas Internacionales del BCRA los USD 47.400M al cierre de febrero 2026?',
    description:
      'Las reservas internacionales del BCRA han mostrado una tendencia creciente en los últimos meses.',
    resolutionCriteria:
      'Este mercado se resolverá como "Sí" si las Reservas Internacionales del BCRA superan USD 47.400 millones al último día hábil de febrero de 2026, según lo publique el Informe Monetario Diario del BCRA. Se resolverá como "No" si el valor es igual o inferior a USD 47.400M.',
    resolutionSource:
      'BCRA Informe Monetario Diario, sección Reservas Internacionales (www.bcra.gob.ar).',
    contingencies:
      'La resolución se basará en el valor de Reservas Internacionales correspondiente al cierre de febrero 2026, según lo publique el BCRA. Este dato se publica habitualmente con un rezago de varios días hábiles posteriores al cierre del mercado. Si el BCRA no publica los datos en tiempo y forma, se utilizará el último dato publicado disponible. En caso de revisión posterior de los datos, se utilizará el dato publicado originalmente (primera publicación).',
    category: 'Economía',
    tags: ['bcra', 'reservas', 'economía'],
    endTimestamp: Math.floor(
      new Date(Date.UTC(2026, 1, 28, 23, 0, 0)).getTime() / 1000,
    ),
    expectedResolutionDate: '2026-03-04',
    timingSafety: 'safe',
    status: 'closed',
    publishedAt: new Date('2026-01-20'),
    closedAt: new Date('2026-02-28T23:00:00Z'),
    sourceContext: {
      originType: 'data_api' as const,
      originUrl: 'https://www.bcra.gob.ar',
      generatedAt: '2026-01-18T15:00:00Z',
    },
  },
  {
    title: '¿El dólar blue cierra por debajo de $1400 el Viernes 13 de Marzo?',
    description:
      'El dólar blue se ha mantenido relativamente estable en las últimas semanas, cotizando en torno a $1.340.',
    resolutionCriteria:
      'Este mercado se resolverá como "Sí" si el precio de venta del dólar blue cierra en menos de $1,400.00 el Viernes 13 de Marzo de 2026, según la cotización de venta publicada por Ámbito Financiero. Se resolverá como "No" si iguala o supera ese valor al cierre.',
    resolutionSource:
      'Cotizaciones diarias publicadas en Ámbito Financiero (www.ambito.com/dolar).',
    contingencies:
      'Si Ámbito Financiero no publica los datos en tiempo y forma, se utilizará el último dato publicado disponible. Si la fecha de resolución cae en feriado o día no hábil y Ámbito Financiero no publica, se utiliza el dato correspondiente al último día hábil del período.',
    category: 'Economía',
    tags: ['dólar', 'blue', 'economía'],
    endTimestamp: Math.floor(
      new Date(Date.UTC(2026, 2, 13, 0, 0, 0)).getTime() / 1000,
    ),
    expectedResolutionDate: '2026-03-13',
    timingSafety: 'safe',
    status: 'approved',
    sourceContext: {
      originType: 'data_api' as const,
      originUrl: 'https://www.ambito.com/dolar',
      generatedAt: '2026-03-05T10:00:00Z',
    },
  },
  {
    title:
      '¿La temperatura mínima en CABA baja de 19°C el viernes 14 de marzo?',
    description:
      'Los pronósticos anticipan una ola de calor para mediados de marzo, pero con posible ingreso de un frente frío.',
    resolutionCriteria:
      'Este mercado se resolverá como "Sí" si la temperatura mínima oficial de la estación Observatorio Central Buenos Aires es inferior a 19°C el viernes 14 de Marzo de 2026. Se resolverá como "No" si la mínima alcanza o supera 19°C.',
    resolutionSource:
      'timeanddate.com, sección "Clima histórico" para Buenos Aires (https://www.timeanddate.com/weather/argentina/buenos-aires/historic).',
    contingencies:
      'Si timeanddate.com no publica los datos en tiempo y forma, se utilizará el último dato publicado disponible.',
    category: 'Clima',
    tags: ['clima', 'temperatura', 'caba'],
    endTimestamp: Math.floor(
      new Date(Date.UTC(2026, 2, 13, 23, 0, 0)).getTime() / 1000,
    ),
    expectedResolutionDate: '2026-03-15',
    timingSafety: 'safe',
    status: 'candidate',
    sourceContext: {
      originType: 'data_api' as const,
      originUrl:
        'https://www.timeanddate.com/weather/argentina/buenos-aires/historic',
      generatedAt: '2026-03-10T08:00:00Z',
    },
  },
  {
    title:
      '¿El Congreso sancionará el proyecto de Régimen Penal Juvenil antes de que terminen las sesiones extraordinarias (28/02)?',
    description:
      'El proyecto de Régimen Penal Juvenil ha generado intenso debate parlamentario. El Senado aún no lo trató en el recinto.',
    resolutionCriteria:
      'Este mercado se resolverá como "Sí" si el Senado de la Nación Argentina aprueba el proyecto de Régimen Penal Juvenil sin modificaciones mediante votación afirmativa formal en el recinto antes de la finalización del período de sesiones extraordinarias (28 de Febrero). Se resolverá como "No" si el proyecto no es aprobado antes de ese momento; es rechazado; es aprobado pero con modificaciones, por lo que vuelve a su cámara de origen (Diputados) sin ser sancionado; no se trata en el recinto; la sesión pasa a cuarto intermedio y la votación definitiva ocurre fuera del plazo indicado.',
    resolutionSource: 'https://www.senado.gob.ar/',
    contingencies:
      'Si el Senado se cancela o pospone indefinidamente, el mercado se resolverá como "No". Si el Senado se pospone pero se reprograma dentro del período del mercado, se utilizará el resultado de la fecha reprogramada.',
    category: 'Política',
    tags: ['congreso', 'senado', 'régimen-penal-juvenil'],
    endTimestamp: Math.floor(
      new Date(Date.UTC(2026, 1, 26, 11, 0, 0)).getTime() / 1000,
    ),
    expectedResolutionDate: '2026-02-28',
    timingSafety: 'caution',
    status: 'resolved',
    outcome: 'No',
    publishedAt: new Date('2026-02-10'),
    closedAt: new Date('2026-02-26T11:00:00Z'),
    resolvedAt: new Date('2026-03-01T15:00:00Z'),
    sourceContext: {
      originType: 'news' as const,
      originUrl: 'https://www.senado.gob.ar/',
      generatedAt: '2026-02-08T14:00:00Z',
    },
    resolution: {
      evidence:
        'El proyecto no fue tratado en el recinto durante el período de sesiones extraordinarias que finalizó el 28 de febrero. El Senado no incluyó el tema en la agenda de la última sesión.',
      evidenceUrls: [
        'https://www.senado.gob.ar/sesiones',
        'https://www.lanacion.com.ar/',
      ],
      confidence: 'high' as const,
      suggestedOutcome: 'No' as const,
      flaggedAt: '2026-02-28T20:00:00Z',
      confirmedBy: 'admin',
      confirmedAt: '2026-03-01T15:00:00Z',
    },
  },
  {
    title:
      '¿River Plate vencerá a Vélez por la Fecha 6 del Torneo Apertura?',
    description:
      'River visita a Vélez en Liniers en un partido clave para las aspiraciones de ambos equipos.',
    resolutionCriteria:
      'Este mercado se resolverá como "Sí" si River Plate gana a Vélez Sarsfield en tiempo reglamentario. Se resolverá como "No" si empata o pierde.',
    resolutionSource:
      'Liga Profesional de Fútbol (www.ligaprofesional.ar).',
    contingencies:
      'Si el partido se reprograma a una fecha anterior a la prevista, el mercado se cerrará anticipadamente. Si se posterga o cancela, se resolverá como "No".',
    category: 'Deportes',
    tags: ['fútbol', 'river', 'vélez'],
    endTimestamp: Math.floor(
      new Date(Date.UTC(2026, 2, 16, 0, 30, 0)).getTime() / 1000,
    ),
    expectedResolutionDate: '2026-03-16',
    timingSafety: 'safe',
    status: 'rejected',
    sourceContext: {
      originType: 'event_calendar' as const,
      generatedAt: '2026-03-08T10:00:00Z',
    },
    review: {
      scores: {
        ambiguity: 8,
        timingSafety: 9,
        timeliness: 6,
        volumePotential: 7,
        overallScore: 7.5,
      },
      hardRuleResults: [
        { ruleId: 'H8', passed: false, explanation: 'Mercado similar al de Racing ya abierto — demasiados mercados de fútbol simultáneos.' },
      ],
      softRuleResults: [],
      dataVerification: [],
      recommendation: 'reject' as const,
      reviewedAt: '2026-03-08T14:00:00Z',
    },
  },
];

async function seed() {
  console.log('Seeding markets...');

  for (const market of seedMarkets) {
    await db.insert(schema.markets).values(market);
    console.log(`  ✓ ${market.title}`);
  }

  console.log(`\nSeeded ${seedMarkets.length} markets.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
