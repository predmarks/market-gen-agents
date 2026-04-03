import type { MarketCategory } from '@/db/types';

export interface RSSFeed {
  name: string;
  url: string;
  category?: MarketCategory;
}

export interface SignalSource {
  id: string;
  name: string;
  type: 'rss' | 'scrape' | 'api' | 'social';
  url: string;
  category?: MarketCategory;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export const DEFAULT_RSS_FEEDS: RSSFeed[] = [
  // Clarín — section feeds (lo-ultimo only returns weather spam)
  { name: 'Clarín', url: 'https://www.clarin.com/rss/politica/', category: 'Política' },
  { name: 'Clarín', url: 'https://www.clarin.com/rss/economia/', category: 'Economía' },
  { name: 'Clarín', url: 'https://www.clarin.com/rss/deportes/', category: 'Deportes' },
  { name: 'Clarín', url: 'https://www.clarin.com/rss/sociedad/' },
  { name: 'Clarín', url: 'https://www.clarin.com/rss/mundo/' },
  { name: 'Clarín', url: 'https://www.clarin.com/rss/espectaculos/', category: 'Entretenimiento' },
  // La Nación — canonical redirect URL
  { name: 'La Nación', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml' },
  { name: 'Infobae', url: 'https://www.infobae.com/arc/outboundfeeds/rss/' },
  { name: 'El Cronista', url: 'https://www.cronista.com/arc/outboundfeeds/rss/', category: 'Economía' },
  { name: 'Ámbito Financiero', url: 'https://www.ambito.com/rss/pages/economia.xml', category: 'Economía' },
  // Additional sources
  { name: 'Chequeado', url: 'https://chequeado.com/feed/' },
  { name: 'Perfil', url: 'https://www.perfil.com/feed' },
  // Sports — official & specialized
  { name: 'CONMEBOL', url: 'https://www.conmebol.com/feed/', category: 'Deportes' },
  { name: 'Olé', url: 'https://www.ole.com.ar/rss/ultimas-noticias/', category: 'Deportes' },
];

// BCRA API v4.0: /estadisticas/v4.0/Monetarias/{idVariable}?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Variable IDs: 1 = Reservas Internacionales, 4 = Tipo de Cambio Minorista, 15 = Base Monetaria
export interface BCRAVariable {
  id: number;
  metric: string;
  unit: string;
}

export const DEFAULT_BCRA_VARIABLES: BCRAVariable[] = [
  { id: 1, metric: 'Reservas Internacionales BCRA', unit: 'USD millones' },
  { id: 4, metric: 'Dólar Oficial (minorista)', unit: 'ARS' },
  { id: 15, metric: 'Base Monetaria', unit: 'ARS millones' },
];

export const BCRA_API_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias';

export const DEFAULT_AMBITO_SOURCES = [
  { name: 'Dólar Blue', url: 'https://mercados.ambito.com/dolar/informal/variacion', metric: 'Dólar Blue', unit: 'ARS (venta)' },
  { name: 'Riesgo País', url: 'https://mercados.ambito.com/riesgopais/variacion', metric: 'Riesgo País', unit: 'puntos' },
];

// Twitter/X API
export const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN ?? '';
export const X_TRENDS_WOEID = 23424747; // Argentina

// --- DB-first loader with hardcoded fallback (same pattern as loadRules) ---

function defaultsToSignalSources(): SignalSource[] {
  const sources: SignalSource[] = [];

  for (const feed of DEFAULT_RSS_FEEDS) {
    sources.push({
      id: `default-rss-${feed.url}`,
      name: feed.name,
      type: 'rss',
      url: feed.url,
      category: feed.category,
      enabled: true,
    });
  }

  for (const v of DEFAULT_BCRA_VARIABLES) {
    sources.push({
      id: `default-api-bcra-${v.id}`,
      name: `BCRA: ${v.metric}`,
      type: 'api',
      url: `${BCRA_API_BASE}/${v.id}`,
      category: 'Economía',
      enabled: true,
      config: { provider: 'bcra', variableId: v.id, metric: v.metric, unit: v.unit },
    });
  }

  for (const a of DEFAULT_AMBITO_SOURCES) {
    sources.push({
      id: `default-api-ambito-${a.metric}`,
      name: a.name,
      type: 'api',
      url: a.url,
      category: 'Economía',
      enabled: true,
      config: { provider: 'ambito', metric: a.metric, unit: a.unit },
    });
  }

  sources.push({
    id: 'default-scrape-liga-profesional',
    name: 'Liga Profesional',
    type: 'scrape',
    url: 'https://www.ligaprofesional.ar/torneo-apertura-2026/',
    category: 'Deportes',
    enabled: true,
    config: {
      mode: 'content',
      contentSelector: '#Opta_0, #Opta_1, .fixture-container, main',
      contentLabel: 'Fixture Liga Profesional Argentina',
      maxContentLength: 5000,
      llmFallback: true,
      llmSearchQuery: 'fixture completo Liga Profesional Argentina fútbol fecha actual resultados y próximos partidos',
    },
  });

  sources.push({
    id: 'default-social-twitter',
    name: 'Twitter/X Argentina',
    type: 'social',
    url: `https://api.twitter.com/2/trends/by/woeid/${X_TRENDS_WOEID}`,
    enabled: true,
    config: { woeid: X_TRENDS_WOEID },
  });

  return sources;
}

export async function loadSignalSources(): Promise<SignalSource[]> {
  try {
    const { db } = await import('@/db/client');
    const { signalSources } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const rows = await db.select().from(signalSources).where(eq(signalSources.enabled, true));

    if (rows.length > 0) {
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type as SignalSource['type'],
        url: r.url,
        category: (r.category as MarketCategory) ?? undefined,
        enabled: r.enabled,
        config: r.config ?? undefined,
      }));
    }

    // Table empty — seed from defaults
    await seedSignalSources();
    const seeded = await db.select().from(signalSources).where(eq(signalSources.enabled, true));
    return seeded.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type as SignalSource['type'],
      url: r.url,
      category: (r.category as MarketCategory) ?? undefined,
      enabled: r.enabled,
      config: r.config ?? undefined,
    }));
  } catch {
    // DB not available, use hardcoded
  }
  return defaultsToSignalSources();
}

export async function seedSignalSources(): Promise<void> {
  const { db } = await import('@/db/client');
  const { signalSources } = await import('@/db/schema');

  const defaults = defaultsToSignalSources();

  for (const source of defaults) {
    await db.insert(signalSources).values({
      name: source.name,
      type: source.type,
      url: source.url,
      category: source.category ?? null,
      enabled: source.enabled,
      config: source.config ?? null,
    }).onConflictDoNothing();
  }
}

// Backward-compatible exports for any code still importing the old names
export const RSS_FEEDS = DEFAULT_RSS_FEEDS;
export const BCRA_VARIABLES = DEFAULT_BCRA_VARIABLES;
export const AMBITO_DOLAR_BLUE_URL = DEFAULT_AMBITO_SOURCES[0].url;
export const AMBITO_RIESGO_PAIS_URL = DEFAULT_AMBITO_SOURCES[1].url;
