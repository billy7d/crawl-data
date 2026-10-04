// Optional: Google Search + Google Shopping via serper.dev (free tier: 2,500 queries, needs SERPER_API_KEY).
// Google itself requires JavaScript for search pages, so it can't be scraped directly. Google Shopping lists
// offers from virtually every retailer (Walmart, Tesco, Target, Amazon…) with prices and images per country.
import { request } from '../lib/http.js';
import { MARKETS } from '../lib/markets.js';

async function serper(endpoint, body, signal) {
  const res = await request(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    signal,
    timeout: 9000,
    accept: 'application/json',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const locale = (market) => (MARKETS[market] ? { gl: market, hl: MARKETS[market].lang.split('-')[0] } : {});

export async function serperWeb(q, market, signal) {
  // Free accounts reject operator queries (site:, OR) with more than 10 results ("Query pattern not allowed").
  const d = await serper('search', { q, ...locale(market), num: /\bsite:/.test(q) ? 10 : 30 }, signal);
  return (d.organic || []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    image: r.imageUrl || null,
    price: r.price || r.priceRange || null,
    rating: r.rating || null,
    reviews: r.ratingCount || null,
  }));
}

export const googleShopping = {
  id: 'gshop',
  name: 'Google Shopping',
  kind: 'shop',
  group: 'Search engine',
  markets: '*',
  needsKey: 'SERPER_API_KEY',
  limit: { concurrency: 3, gap: 100 },
  async search({ q, market, signal }) {
    const d = await serper('shopping', { q, ...locale(market), num: 40 }, signal);
    return (d.shopping || []).map((p) => ({
      title: p.title,
      url: p.link,
      image: p.imageUrl,
      price: p.price,
      seller: p.source,
      rating: p.rating || null,
      reviews: p.ratingCount || null,
      snippet: p.delivery || null,
    }));
  },
};

export const google = {
  id: 'google',
  name: 'Google',
  kind: 'web',
  group: 'Search engine',
  markets: '*',
  needsKey: 'SERPER_API_KEY',
  limit: { concurrency: 3, gap: 100 },
  search: ({ q, market, signal }) => serperWeb(q, market, signal),
};
