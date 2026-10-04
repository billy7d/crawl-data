// Runs one source search with the shared cache and per-source politeness limits.
import { remember, del } from './cache.js';
import { throttled } from './limiter.js';

export const searchTtl = () => Number(process.env.SEARCH_CACHE_HOURS || 6) * 3600e3;

export async function runSearch(src, market, query, { signal, fresh = false } = {}) {
  const key = `s:v2:${src.id}:${market}:${query.toLowerCase()}`;
  if (fresh) del(key);
  const lim = src.limit || {};
  const limitKey = lim.perMarket ? `${src.id}:${market}` : lim.key || src.id;
  const r = await remember(key, searchTtl(), () => throttled(limitKey, lim, () => src.search({
    q: query, market: market === 'world' ? 'us' : market, signal,
  })));
  return { ...r, key };
}

export const forget = (key) => del(key);
