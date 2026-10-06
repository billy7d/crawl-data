// French supermarkets read directly from their search pages (each has its own markup).
// Auchan: server-rendered schema.org cards, readable without a proxy, but prices appear only after choosing
// a store, so rows come without a price. Chronodrive: answers only through the proxy, with prices.
import * as cheerio from 'cheerio';
import { fetchText, HttpError } from '../lib/http.js';
import { clean } from '../lib/normalize.js';

const group = 'Shop nước ngoài';
const lang = 'fr-FR,fr;q=0.9,en;q=0.5';

export const auchan = {
  id: 'auchan',
  name: 'Auchan',
  kind: 'shop',
  group,
  markets: ['fr'],
  limit: { concurrency: 2, gap: 500 },
  filterIrrelevant: true,
  async search({ q, signal }) {
    const { text } = await fetchText(`https://www.auchan.fr/recherche?text=${encodeURIComponent(q)}`, { signal, timeout: 10000, lang, proxy: 'fallback' });
    const $ = cheerio.load(text);
    const out = [];
    $('article[itemtype*="schema.org/Product"]').each((_, el) => {
      const $el = $(el);
      const href = $el.find('a.productThumbnailLink, a[href*="/pr-"]').first().attr('href');
      // The first images are badges ('Age aliments bébé'); the product picture is inside <picture>.
      const title = clean($el.find('picture source[alt], picture img[alt]').first().attr('alt') || $el.find('[itemprop="name"]').attr('content') || '');
      if (!href || !title) return;
      const rating = Number($el.find('[itemprop="ratingValue"]').attr('content') || 0) || null;
      const reviews = Number($el.find('[itemprop="reviewCount"], [itemprop="ratingCount"]').attr('content') || 0) || null;
      out.push({
        title,
        url: new URL(href, 'https://www.auchan.fr').href,
        image: $el.find('meta[itemprop="image"]').attr('content') || null,
        price: null, // shown only once a store is chosen
        currency: 'EUR',
        rating,
        reviews,
        seller: 'Auchan',
        extra: { outOfStock: /outOfStock/.test($el.attr('class') || '') },
      });
    });
    if (!out.length && text.length < 40000) throw new HttpError('Auchan trả về trang chặn (tạm thời)', 429);
    return out;
  },
};

export const chronodrive = {
  id: 'chronodrive',
  name: 'Chronodrive',
  kind: 'shop',
  group,
  markets: ['fr'],
  needsKey: 'SCRAPE_PROXY',
  limit: { concurrency: 2, gap: 300 },
  filterIrrelevant: true,
  async search({ q, signal }) {
    const { text } = await fetchText(`https://www.chronodrive.com/search/${encodeURIComponent(q)}`, { signal, lang, proxy: 'always', proxyTimeout: 45000 });
    const $ = cheerio.load(text);
    const out = [];
    $('article.product-card').each((_, el) => {
      const $el = $(el);
      const href = $el.find('a.card-content-link').attr('href');
      const title = clean($el.attr('aria-label') || $el.find('.card-label').text());
      if (!href || !title) return;
      const price = clean($el.find('.product-actions-value').first().text());
      const img = $el.find('.media img').attr('src') || $el.find('img').first().attr('src');
      out.push({
        title,
        url: new URL(href, 'https://www.chronodrive.com').href,
        image: img || null,
        price: price || null,
        currency: 'EUR',
        seller: 'Chronodrive',
      });
    });
    return out;
  },
};

// Carrefour keeps its search results in window.__INITIAL_STATE__.routeData: a JSON array where every value
// is the index of another entry (devalue-style), which also deduplicates repeated strings.
function hydrateIndexed(arr) {
  const memo = new Map();
  const h = (n) => {
    if (typeof n !== 'number' || n < 0) return n;
    if (memo.has(n)) return memo.get(n);
    const v = arr[n];
    if (v === null || typeof v !== 'object') {
      memo.set(n, v);
      return v;
    }
    const out = Array.isArray(v) ? [] : {};
    memo.set(n, out);
    if (Array.isArray(v)) v.forEach((x) => out.push(h(x)));
    else for (const k of Object.keys(v)) out[k] = h(v[k]);
    return out;
  };
  return h(0);
}

function carrefourProducts(html) {
  const start = html.indexOf('window.__INITIAL_STATE__=');
  if (start < 0) return null;
  const end = html.indexOf('</script>', start);
  try {
    const state = JSON.parse(html.slice(start + 25, end).trim().replace(/;\s*$/, ''));
    const raw = state.vuex?.routeData ?? state.routeData;
    const root = hydrateIndexed(typeof raw === 'string' ? JSON.parse(raw) : raw);
    return (root?.data || []).filter((d) => d?.type === 'product');
  } catch {
    return null;
  }
}

export const carrefour = {
  id: 'carrefour',
  name: 'Carrefour',
  kind: 'shop',
  group,
  markets: ['fr'],
  needsKey: 'SCRAPE_PROXY',
  limit: { concurrency: 2, gap: 300 },
  filterIrrelevant: true,
  async search({ q, signal }) {
    const url = `https://www.carrefour.fr/s?q=${encodeURIComponent(q)}`;
    // DataDome blocks direct requests; a French proxy IP usually passes, the premium pool when it doesn't.
    let products = null;
    for (const proxyExtra of ['&country_code=fr', '&premium=true&country_code=fr']) {
      try {
        const { text } = await fetchText(url, { signal, lang, proxy: 'always', proxyExtra, proxyTimeout: 45000 });
        products = carrefourProducts(text);
        if (products) break;
      } catch (e) {
        if (signal?.aborted || e.status === 402) throw e; // 402 = proxy out of credits: report that, not "blocked"
      }
    }
    if (!products) throw new HttpError('Carrefour chặn truy cập (tạm thời)', 429);
    return products.map(({ attributes: a = {}, links = {} }) => {
      const offer = Object.values(Object.values(a.offers || {})[0] || {})[0]?.attributes || {};
      const reviews = a.customerReviews || {};
      return {
        title: clean(a.title),
        url: links.self ? `https://www.carrefour.fr${links.self}` : null,
        image: a.images?.paths?.[0]?.replace('FORMAT', '540x540') || null,
        price: offer.price?.price ?? null,
        currency: 'EUR',
        brand: a.brand ? clean(a.brand) : null,
        gtin: a.ean || null,
        rating: reviews.average ?? null,
        reviews: reviews.count ?? null,
        seller: 'Carrefour',
        snippet: [a.packaging, offer.price?.perUnitLabel, a.categories?.at(-1)?.label].filter(Boolean).join(' · '),
        extra: { unitPrice: offer.price?.perUnitLabel || null, nutriscore: a.nutriscore?.letter || a.nutriscore || null, available: offer.availability?.purchasable ?? null },
      };
    }).filter((p) => p.title && p.url);
  },
};

// E.Leclerc: server-rendered product cards carrying the EAN; the price is split into euro / cent spans
// ("15 € , 99"), followed by the price per kg.
export const leclerc = {
  id: 'leclerc',
  name: 'E.Leclerc',
  kind: 'shop',
  group,
  markets: ['fr'],
  limit: { concurrency: 2, gap: 500 },
  filterIrrelevant: true,
  async search({ q, signal }) {
    const { text } = await fetchText(`https://www.e.leclerc/recherche?q=${encodeURIComponent(q)}`, { signal, timeout: 12000, lang, proxy: 'fallback' });
    const $ = cheerio.load(text);
    return $('article[data-product-card]').map((_, el) => {
      const $el = $(el);
      const a = $el.find('a[data-product-card-title], a[href^="/fp/"]').first();
      const priceText = clean($el.find('[currency]').first().text());
      const m = priceText.match(/(\d+)\s*€\s*,\s*(\d{2})/) || priceText.match(/(\d+)[,.](\d{2})\s*€/);
      return {
        title: clean(a.attr('title') || a.text()),
        url: a.attr('href') ? `https://www.e.leclerc${a.attr('href')}` : null,
        image: $el.find('img').first().attr('src') || null,
        price: m ? Number(`${m[1]}.${m[2]}`) : null,
        currency: 'EUR',
        brand: clean($el.find('.p-small').first().text()) || null,
        gtin: $el.attr('data-ean') || null,
        snippet: priceText.match(/[\d,.]+\s*€\s*\/\s*\w+/)?.[0] || null,
        seller: 'E.Leclerc',
      };
    }).get().filter((p) => p.title && p.url);
  },
};
