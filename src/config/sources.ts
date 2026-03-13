import type { MarketCategory } from '@/db/types';

export interface RSSFeed {
  name: string;
  url: string;
  category?: MarketCategory;
}

export const RSS_FEEDS: RSSFeed[] = [
  { name: 'Clarín', url: 'https://www.clarin.com/rss/lo-ultimo/' },
  { name: 'La Nación', url: 'https://www.lanacion.com.ar/arcio/rss/' },
  { name: 'Infobae', url: 'https://www.infobae.com/arc/outboundfeeds/rss/' },
  { name: 'El Cronista', url: 'https://www.cronista.com/arc/outboundfeeds/rss/', category: 'Economía' },
  { name: 'Olé', url: 'https://www.ole.com.ar/arc/outboundfeeds/rss/', category: 'Deportes' },
  { name: 'Ámbito Financiero', url: 'https://www.ambito.com/rss/pages/economia.xml', category: 'Economía' },
];

// BCRA API v4.0: /estadisticas/v4.0/Monetarias/{idVariable}?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Variable IDs: 1 = Reservas Internacionales, 4 = Tipo de Cambio Minorista, 15 = Base Monetaria
export interface BCRAVariable {
  id: number;
  metric: string;
  unit: string;
}

export const BCRA_VARIABLES: BCRAVariable[] = [
  { id: 1, metric: 'Reservas Internacionales BCRA', unit: 'USD millones' },
  { id: 4, metric: 'Dólar Oficial (minorista)', unit: 'ARS' },
  { id: 15, metric: 'Base Monetaria', unit: 'ARS millones' },
];

export const BCRA_API_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias';

export const AMBITO_DOLAR_BLUE_URL = 'https://mercados.ambito.com/dolar/informal/variacion';
