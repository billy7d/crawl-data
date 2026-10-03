// Optional search providers that are far more robust than scraping public result pages:
// - SearXNG (self-hosted, free): aggregates Google, Bing, DuckDuckGo, Brave, Qwant… → SEARXNG_URL
// - Brave Search API (free monthly credit) → BRAVE_API_KEY
import { fetchJSON } from '../lib/http.js';
import { MARKETS } from '../lib/markets.js';
import { PRICE_IN_TEXT } from './bing.js';

export async function searxngWeb(q, market, signal) {
  const base = process.env.SEARXNG_URL.replace(/\/$/, '');
  const lang = market === 'world' ? 'all' : MARKETS[market]?.mkt || 'all';
  const d = await fetchJSON(`${base}/search?q=${encodeURIComponent(q)}&format=json&language=${lang}&safesearch=0`, { signal, timeout: 12000 });
  return (d.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content || '',
    image: r.img_src || r.thumbnail || null,
    price: `${r.title} ${r.content}`.match(PRICE_IN_TEXT)?.[0] || null,
    engines: r.engines,
  }));
}

export async function braveWeb(q, market, signal) {
  const country = market && market !== 'world' ? market.toUpperCase() : 'ALL';
  const d = await fetchJSON(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20&country=${country}`, {
    signal, timeout: 9000, headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY },
  });
  return (d.web?.results || []).map((r) => ({
    title: r.title?.replace(/<\/?strong>/g, ''),
    url: r.url,
    snippet: r.description?.replace(/<\/?strong>/g, '') || '',
    image: r.thumbnail?.src || null,
    price: r.product?.price || `${r.title} ${r.description}`.match(PRICE_IN_TEXT)?.[0] || null,
  }));
}

export const searxng = {
  id: 'searxng',
  name: 'SearXNG (Google + nhiều engine)',
  kind: 'web',
  group: 'Search engine',
  markets: '*',
  needsKey: 'SEARXNG_URL',
  limit: { concurrency: 3, gap: 200 },
  search: ({ q, market, signal }) => searxngWeb(q, market, signal),
};

export const brave = {
  id: 'brave',
  name: 'Brave Search',
  kind: 'web',
  group: 'Search engine',
  markets: '*',
  needsKey: 'BRAVE_API_KEY',
  limit: { concurrency: 1, gap: 1100 },
  search: ({ q, market, signal }) => braveWeb(q, market, signal),
};
