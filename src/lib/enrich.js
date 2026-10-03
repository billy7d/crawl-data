// Fetches product pages (or source-specific detail APIs) to fill in price, image, ingredients, storage...
import { remember, del } from './cache.js';
import { fetchText } from './http.js';
import { extractDetail } from './extract.js';
import { throttled } from './limiter.js';

const SKIP_HOSTS = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.com|tiktok\.com|instagram\.com|shopee\.[a-z.]+|pinterest\.[a-z.]+|twitter\.com|x\.com|reddit\.com|bing\.com|google\.[a-z.]+|wikipedia\.org|lazada\.[a-z.]+|zalo\.me|webtretho\.com)$/;
const NO_GENERIC = new Set(['lazada', 'bingshop', 'gshop']);

export function canEnrich(item, src) {
  if (src?.detail) return true;
  if (NO_GENERIC.has(item.source) || !item.url) return false;
  if (/\.(pdf|docx?|xlsx?)($|\?)/i.test(item.url)) return false;
  return !SKIP_HOSTS.test(item.domain || '');
}

const keyOf = (item) => 'detail:v3:' + (item.extra?.tikiId ? `tiki:${item.extra.tikiId}` : item.source === 'off' ? `off:${item.gtin}` : item.url);

export async function getDetail(item, src, { signal, fresh = false } = {}) {
  const key = keyOf(item);
  if (fresh) del(key);
  const host = src?.detail ? item.source : item.domain;
  const { value } = await remember(key, 24 * 3600e3, () => throttled(`detail:${host}`, { concurrency: 3, gap: 150, cooldown: 2 * 60e3 }, async () => {
    if (src?.detail) return (await src.detail(item, { signal })) || {};
    const { text, url } = await fetchText(item.url, { signal, timeout: 7000 });
    const d = extractDetail(text, url);
    delete d.textSample;
    return d;
  }));
  return value;
}

// Blocks requests to the local network when the server fetches a user-supplied URL.
export function isPublicHttpUrl(u) {
  try {
    const { protocol, hostname } = new URL(u);
    if (!/^https?:$/.test(protocol)) return false;
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return false;
    return true;
  } catch {
    return false;
  }
}
