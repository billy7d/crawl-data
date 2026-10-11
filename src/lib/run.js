// Runs one source search with the shared cache and per-source politeness limits.
import { remember, del, get, set } from './cache.js';
import { throttled, CooldownError } from './limiter.js';
import { proxyEnabled, HttpError } from './http.js';
import { browserCtx, browserUsable } from './browser.js';

export const searchTtl = () => Number(process.env.SEARCH_CACHE_HOURS || 6) * 3600e3;
const keyOf = (src, market, query) => `s:v3:${src.id}:${market}:${query.toLowerCase()}`;

export async function runSearch(src, market, query, { signal, fresh = false } = {}) {
  if (src.browserOnly) throw new HttpError('Chỉ đọc được bằng trình duyệt thật', 0);
  const key = keyOf(src, market, query);
  if (fresh) del(key);
  const lim = src.limit || {};
  const limitKey = lim.perMarket ? `${src.id}:${market}` : lim.key || src.id;
  const r = await remember(key, searchTtl(), () => throttled(limitKey, lim, () => src.search({
    q: query, market: market === 'world' ? 'us' : market, signal,
  })));
  return { ...r, key };
}

export const forget = (key) => del(key);

// ---------- Real-browser fallback ----------
// Shops only: search engines are covered by each other, and the browser is for pages a person would open.
export const canBrowse = (src) => src.kind === 'shop' && !src.noBrowser && browserUsable();
// Sources that can't be read without it right now: browser-only shops, and proxy-only shops while the proxy
// is missing or out of credits.
export const needsBrowser = (src) => !!src.browserOnly || (src.needsKey === 'SCRAPE_PROXY' && !proxyEnabled());
// Failures a real browser may get past: bot walls, rate limits, the proxy being down, a cool-down after a block.
const blocked = (e) => e instanceof CooldownError || [202, 402, 403, 429, 503].includes(e?.status)
  || /captcha|chặn|blocked|proxy|không phải JSON/i.test(e?.message || '');

// browser: { session, consent(), onAttention(info), onStart(), onEnd() } from the search request.
export async function searchSource(src, market, query, { signal, fresh = false, browser } = {}) {
  const usable = browser && canBrowse(src);
  if (!(usable && needsBrowser(src))) {
    try {
      return await runSearch(src, market, query, { signal, fresh });
    } catch (e) {
      if (!usable || signal?.aborted || !blocked(e)) throw e;
    }
  }
  const key = keyOf(src, market, query);
  const hit = fresh ? undefined : get(key);
  if (hit !== undefined) return { value: hit, cached: true, key, via: 'browser' };
  browser.onStart?.();
  try {
    await browser.consent();
    const value = await browserCtx.run({ signal, session: browser.session, onAttention: browser.onAttention }, () => src.search({
      q: query, market: market === 'world' ? 'us' : market, signal,
    }));
    if (value.length) set(key, value, searchTtl());
    return { value, cached: false, key, via: 'browser' };
  } finally {
    browser.onEnd?.();
  }
}
