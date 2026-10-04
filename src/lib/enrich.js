// Fetches product pages (or source-specific detail APIs) to fill in price, image, ingredients, storage...
// When a shop doesn't publish ingredients/storage, falls back to Open Food Facts by barcode.
import { remember, del } from './cache.js';
import { fetchText, fetchJSON } from './http.js';
import { extractDetail, textFromHtml } from './extract.js';
import { throttled } from './limiter.js';
import { clean, truncate } from './normalize.js';

const SKIP_HOSTS = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.com|tiktok\.com|instagram\.com|shopee\.[a-z.]+|pinterest\.[a-z.]+|twitter\.com|x\.com|reddit\.com|bing\.com|google\.[a-z.]+|wikipedia\.org|lazada\.[a-z.]+|zalo\.me|webtretho\.com)$/;
// Sources whose product pages need JavaScript (or are Bing/Google pages), so a plain fetch yields nothing.
const NO_GENERIC = new Set(['lazada', 'bingshop', 'gshop', 'sainsburys']);

// Valid EAN-8/UPC-A/EAN-13/GTIN-14 (checksum verified), normalised to digits.
export function gtinOf(code) {
  const c = String(code ?? '').replace(/\D/g, '');
  if (!/^(\d{8}|\d{12,14})$/.test(c)) return null;
  const digits = [...c].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? c : null;
}

function canFetch(item, src) {
  if (src?.detail) return true;
  if (NO_GENERIC.has(item.source) || !item.url) return false;
  if (/\.(pdf|docx?|xlsx?)($|\?)/i.test(item.url)) return false;
  return !SKIP_HOSTS.test(item.domain || '');
}

export const canEnrich = (item, src) => canFetch(item, src) || !!gtinOf(item.gtin);

const keyOf = (item) => 'detail:v6:' + (item.extra?.tikiId ? `tiki:${item.extra.tikiId}` : item.source === 'off' ? `off:${item.gtin}` : `${item.source}:${item.url}`);

async function fetchDetail(item, src, { signal, fresh }) {
  // A source detail API that needs an id the listing didn't carry: nothing to fetch, and nothing to cache.
  if (src?.detailNeeds && !src.detailNeeds(item)) return {};
  const key = keyOf(item);
  if (fresh) del(key);
  const host = src?.detail ? item.source : item.domain;
  const lim = src?.detailLimit || { concurrency: 3, gap: 150 };
  const { value } = await remember(key, 24 * 3600e3, () => throttled(`detail:${host}`, { cooldown: 2 * 60e3, ...lim }, async () => {
    if (src?.detail) return (await src.detail(item, { signal })) || {};
    const { text, url } = await fetchText(item.url, { signal, timeout: 8000, proxy: 'fallback' });
    const d = extractDetail(text, url);
    delete d.textSample;
    return d;
  }));
  return value;
}

const OFF_FIELDS = [
  'product_name', 'image_front_url', 'ingredients_text_vi', 'ingredients_text_en', 'ingredients_text', 'ingredients_text_de',
  'ingredients_text_fr', 'conservation_conditions_vi', 'conservation_conditions_en', 'conservation_conditions',
  'preparation_vi', 'preparation_en', 'preparation',
].join(',');

// Open Food Facts product by barcode; "not found" is cached too so we don't ask again for a week.
// OFF allows ~100 product reads/minute: stay under it, and pause only briefly if we still hit the limit.
async function offByBarcode(code, signal) {
  const { value } = await remember(`offbc:${code}`, 7 * 24 * 3600e3, () => throttled('off-product', { concurrency: 2, gap: 700, cooldown: 60e3 }, async () => {
    try {
      const d = await fetchJSON(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=${OFF_FIELDS}`, {
        signal, timeout: 7000, headers: { 'User-Agent': 'AnDamRadar/1.0 (baby food market research)' },
      });
      return d.status === 1 ? d.product : {};
    } catch (e) {
      if (e.status === 404) return {};
      throw e;
    }
  }));
  return value;
}

export async function getDetail(item, src, { signal, fresh = false } = {}) {
  let d = {};
  let pageError = null;
  if (canFetch(item, src)) {
    try {
      d = (await fetchDetail(item, src, { signal, fresh })) || {};
    } catch (e) {
      pageError = e;
    }
  }
  const has = (k) => d.sections?.[k] || item.sections?.[k];
  const code = gtinOf(item.gtin) || gtinOf(d.gtin);
  // OFF rarely has storage text, so only spend a lookup when the ingredients are missing.
  if (code && !has('ingredients')) {
    const o = await offByBarcode(code, signal).catch(() => ({}));
    const pick = (...keys) => keys.map((k) => o[k]).find((v) => typeof v === 'string' && v.trim().length > 5);
    const found = {
      ingredients: pick('ingredients_text_vi', 'ingredients_text_en', 'ingredients_text', 'ingredients_text_de', 'ingredients_text_fr'),
      storage: pick('conservation_conditions_vi', 'conservation_conditions_en', 'conservation_conditions'),
      usage: pick('preparation_vi', 'preparation_en', 'preparation'),
    };
    d = { ...d, sections: { ...(d.sections || {}) }, sectionSource: { ...(d.sectionSource || {}) } };
    for (const [k, v] of Object.entries(found)) {
      if (v && !has(k)) {
        d.sections[k] = truncate(clean(textFromHtml(v)), 500);
        d.sectionSource[k] = 'Open Food Facts';
      }
    }
    if (!d.image && o.image_front_url) d.image = o.image_front_url;
  }
  if (pageError && !Object.keys(d.sections || {}).length) throw pageError;
  return d;
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
