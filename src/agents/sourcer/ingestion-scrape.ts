import * as cheerio from 'cheerio';
import type { SignalSource } from '@/config/sources';
import type { SourceSignal } from './types';

interface ScrapeConfig {
  /** Scrape mode: 'links' extracts article links, 'content' extracts page content (default: 'links') */
  mode?: 'links' | 'content';
  /** CSS selector for article links (default: 'a[href*="/notas/"]') */
  linkSelector?: string;
  /** CSS selector for title within or near the link (default: 'h2, h3') */
  titleSelector?: string;
  /** Base URL for resolving relative links */
  baseUrl?: string;
  /** Regex to extract date from URL (must have named groups: year, month, day) */
  urlDatePattern?: string;
  /** Max age in hours for articles (default: 168 = 7 days) */
  maxAgeHours?: number;
  /** CSS selector for content area (content mode only) */
  contentSelector?: string;
  /** Descriptive label stored as signal.text (content mode only) */
  contentLabel?: string;
  /** Max chars for extracted content (default: 5000) */
  maxContentLength?: number;
  /** If true, fall back to LLM web search when cheerio yields minimal content */
  llmFallback?: boolean;
  /** Search query hint for LLM fallback (defaults to contentLabel) */
  llmSearchQuery?: string;
}

function extractDateFromUrl(href: string, pattern?: string): string | null {
  const regex = pattern
    ? new RegExp(pattern)
    : /\/(\d{4})\/(\d{2})\/(\d{2})\//;

  const match = href.match(regex);
  if (!match) return null;

  // Support named groups or positional
  const year = match.groups?.year ?? match[1];
  const month = match.groups?.month ?? match[2];
  const day = match.groups?.day ?? match[3];

  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}T12:00:00.000Z`;
}

export async function ingestScraped(sources: SignalSource[]): Promise<SourceSignal[]> {
  const results = await Promise.allSettled(
    sources.map((source) => scrapeSingleSource(source)),
  );

  const signals: SourceSignal[] = [];
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Scrape failed:', result.reason);
      continue;
    }
    signals.push(...result.value);
  }

  return signals;
}

async function scrapeSingleSource(source: SignalSource): Promise<SourceSignal[]> {
  const config = (source.config ?? {}) as ScrapeConfig;

  if (config.mode === 'content') {
    return scrapeContentSource(source, config);
  }

  return scrapeLinksSource(source, config);
}

// --- Content mode: extract structured text from a page section ---

async function scrapeContentSource(source: SignalSource, config: ScrapeConfig): Promise<SourceSignal[]> {
  const maxLen = config.maxContentLength ?? 5000;
  const label = config.contentLabel ?? source.name;

  // Step 1: Try cheerio extraction
  let content = '';
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PredmarksBot/1.0)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      const selector = config.contentSelector ?? 'main';
      // Extract text preserving some structure via newlines between block elements
      const $area = $(selector);
      if ($area.length > 0) {
        // Replace block-level elements with newlines for readability
        $area.find('br').replaceWith('\n');
        $area.find('tr').each((_i, el) => { $(el).append('\n'); });
        $area.find('li, dt, dd').each((_i, el) => { $(el).append('\n'); });
        $area.find('p, div, h1, h2, h3, h4, h5, h6').each((_i, el) => {
          $(el).prepend('\n');
          $(el).append('\n');
        });
        content = $area.text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      }
    }
  } catch (err) {
    console.warn(`Content scrape fetch failed for ${source.name}:`, err);
  }

  // Step 2: If cheerio yielded minimal content and LLM fallback is enabled, use web search
  if (content.length < 50 && config.llmFallback) {
    try {
      const { callClaudeWithSearch } = await import('@/lib/llm');
      const searchQuery = config.llmSearchQuery ?? label;
      const { result } = await callClaudeWithSearch<{ content: string }>({
        system: `Sos un extractor de datos. Buscá la información solicitada y devolvé el contenido estructurado en texto plano.
Incluí todos los datos relevantes: fechas, nombres, resultados, horarios, etc.
Respondé en español argentino. Sé exhaustivo pero conciso.`,
        userMessage: `Extraé los datos actualizados de: ${searchQuery}\nFuente principal: ${source.url}\nFecha actual: ${new Date().toISOString().split('T')[0]}`,
        outputSchema: {
          type: 'object' as const,
          properties: {
            content: { type: 'string' as const, description: 'Contenido estructurado extraído' },
          },
          required: ['content'] as const,
        },
        operation: 'content_scrape',
      });
      content = result.content;
    } catch (err) {
      console.warn(`Content scrape LLM fallback failed for ${source.name}:`, err);
    }
  }

  if (!content) return [];

  return [{
    type: 'news',
    text: label,
    summary: content.slice(0, maxLen),
    url: source.url,
    source: source.name,
    publishedAt: new Date().toISOString(),
    entities: [],
    category: source.category,
  }];
}

// --- Links mode: extract article titles from page (original behavior) ---

async function scrapeLinksSource(source: SignalSource, config: ScrapeConfig): Promise<SourceSignal[]> {
  const linkSelector = config.linkSelector ?? 'a[href*="/notas/"]';
  const titleSelector = config.titleSelector ?? 'h2, h3';
  const baseUrl = config.baseUrl ?? source.url.replace(/\/$/, '');
  const maxAgeMs = (config.maxAgeHours ?? 168) * 60 * 60 * 1000; // default 7 days

  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PredmarksBot/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    console.warn(`Scrape failed for ${source.name}: ${res.status}`);
    return [];
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const signals: SourceSignal[] = [];
  const seenUrls = new Set<string>();
  const cutoff = Date.now() - maxAgeMs;

  // First pass: collect all titles per URL (some sites have image link + title link separately)
  const titlesByUrl = new Map<string, string>();

  $(linkSelector).each((_i, el) => {
    const $el = $(el);
    let href = $el.attr('href');
    if (!href) return;

    if (href.startsWith('/')) {
      href = baseUrl + href;
    }

    let title = $el.find(titleSelector).first().text().trim();
    if (!title) title = $el.text().trim();
    if (!title) return;

    // Keep the first non-empty title found for each URL
    if (!titlesByUrl.has(href)) {
      titlesByUrl.set(href, title);
    }
  });

  // Second pass: build signals from deduplicated URL→title map
  for (const [href, title] of titlesByUrl) {
    if (seenUrls.has(href)) continue;
    seenUrls.add(href);

    const publishedAt = extractDateFromUrl(href, config.urlDatePattern);
    if (publishedAt && new Date(publishedAt).getTime() < cutoff) continue;

    signals.push({
      type: 'news',
      text: title,
      url: href,
      source: source.name,
      publishedAt: publishedAt ?? new Date().toISOString(),
      entities: [],
      category: source.category,
    });
  }

  return signals;
}
