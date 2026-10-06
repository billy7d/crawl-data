// Shops whose search pages are JavaScript apps backed by a public search service, or whose pages embed the
// product data as JSON. The pages themselves are blocked for direct requests from many IPs (so they go through
// SCRAPE_PROXY when needed), but the search services answer directly:
//   • Prenatal (IT)  — Meilisearch      • eFarma (IT) — Algolia (Magento extension)
//   • Shoppers Drug Mart (CA) — Next.js page data      • Lotte ON (KR) — product JSON in the page
//   • REWE (DE) — server-rendered tiles (prices depend on the chosen market, so none)
// The search services need a search-only key that the shop's own page hands to every visitor. It is read from
// the page, cached for a month and re-read when the service rejects it.
import * as cheerio from 'cheerio';
import { fetchJSON, fetchText, HttpError, request } from '../lib/http.js';
import { remember, del } from '../lib/cache.js';
import { clean, truncate } from '../lib/normalize.js';
import { textFromHtml } from '../lib/extract.js';

const group = 'Shop nước ngoài';
const MONTH = 30 * 24 * 3600e3;

// Page config (search key…) cached on disk; `read(html)` returns the config object or null.
export const configKey = (id) => `cfg:v1:${id}`;
async function pageConfig(id, pageUrl, read, { lang, signal, proxyExtra } = {}) {
  const { value } = await remember(configKey(id), MONTH, async () => {
    const { text } = await fetchText(pageUrl, { signal, timeout: 15000, lang, proxy: 'fallback', proxyExtra, proxyTimeout: 50000 });
    const cfg = read(text);
    if (!cfg) throw new HttpError('Không đọc được khóa tìm kiếm từ trang (trang bị chặn hoặc đã đổi cấu trúc)', 502);
    return cfg;
  });
  return value;
}

// Call a keyed search service; when the key is rejected, drop the cached config and retry once with a fresh one.
async function withConfig(id, getConfig, call) {
  try {
    return await call(await getConfig());
  } catch (e) {
    if (![400, 401, 403].includes(e.status)) throw e;
    del(configKey(id));
    return call(await getConfig());
  }
}

// ---------------------------------------------------------------- Prenatal (Meilisearch)

export const readPrenatalConfig = (html) => {
  const m = html.match(/"meilisearch":\{"client":\{"url":"([^"]+)","apiKey":"([^"]+)"/);
  return m ? { url: m[1].replaceAll('\\/', '/'), key: m[2] } : null;
};

export function parsePrenatal(hits) {
  return hits.filter((h) => h?.title && h.permalink).map((h) => {
    const price = h.analytics_item?.price ?? (h.price?.min != null ? h.price.min / 100 : null);
    const regular = h.regular_price?.min != null ? h.regular_price.min / 100 : null;
    const brand = h.brand?.name || h.form?.brand?.name || null;
    return {
      title: clean(h.title),
      url: h.permalink,
      image: h.image_url || h.images?.[0]?.src || null,
      price,
      originalPrice: regular && price && regular > price ? regular : null,
      currency: 'EUR',
      brand,
      gtin: h.form?.ean || null,
      rating: h.rating_count > 0 ? Number(h.average_rating) || null : null,
      reviews: h.rating_count > 0 ? Number(h.rating_count) : null,
      sold: Number(h.total_sales) || null, // lifetime units sold on prenatal.com
      snippet: h.unit_data?.per_unit_price_label || null,
      description: h.short_description ? clean(textFromHtml(h.short_description)) : null,
      seller: 'Prenatal',
      extra: { inStock: h.stock_status === 'instock' },
    };
  });
}

export const prenatal = {
  id: 'prenatal',
  name: 'Prenatal',
  kind: 'shop',
  group,
  markets: ['it'],
  filterIrrelevant: true,
  limit: { concurrency: 2, gap: 200 },
  async search({ q, signal }) {
    const cfg = () => pageConfig('prenatal', 'https://www.prenatal.com/?s=plasmon&post_type=product', readPrenatalConfig, { lang: 'it-IT,it;q=0.9', signal, proxyExtra: '&country_code=it' });
    const d = await withConfig('prenatal', cfg, async ({ url, key }) => {
      const res = await request(`${url}/indexes/products/search`, {
        method: 'POST', signal, timeout: 10000, accept: 'application/json',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, limit: 40 }),
      });
      return res.json();
    });
    return parsePrenatal(d.hits || []);
  },
};

// ---------------------------------------------------------------- eFarma (Algolia)

export const readAlgoliaConfig = (html) => {
  const app = html.match(/"applicationId":"([A-Z0-9]{8,12})"/)?.[1];
  const index = html.match(/"indexName":"([^"]+)"/)?.[1];
  const key = html.match(/"indexName":"[^"]+","apiKey":"([^"]+)"/)?.[1];
  return app && index && key ? { app, index, key } : null;
};

const money = (p) => {
  const e = p && typeof p === 'object' ? Object.values(p)[0] : null;
  return e ? { price: e.default ?? null, original: Number(String(e.default_original_formated || '').replace(/[^\d,]/g, '').replace(',', '.')) || null } : { price: null, original: null };
};

export function parseEfarma(hits) {
  return hits.filter((h) => h?.name && h.url).map((h) => {
    const { price, original } = money(h.price);
    const sections = {};
    if (h.ingredient_list) sections.ingredients = truncate(clean(textFromHtml(h.ingredient_list)), 500);
    return {
      title: clean(h.name),
      url: h.url,
      image: h.image_url || h.thumbnail_url || null,
      price,
      originalPrice: original && price && original > price ? original : null,
      currency: 'EUR',
      brand: h.brand || h.manufacturer || null,
      gtin: h.ean || null,
      rating: h.rating_count > 0 ? Number(h.rating_summary) / 20 || null : null,
      reviews: Number(h.rating_count) || null,
      sold: Math.round(Number(h.total_ordered)) || null,
      description: h.characteristics ? clean(textFromHtml(h.characteristics)) : null,
      sections,
      seller: 'eFarma',
      extra: { inStock: String(h.in_stock) === '1', soldLastDays: h.sales_last_days ? Number(h.sales_last_days) : null },
    };
  });
}

export const efarma = {
  id: 'efarma',
  name: 'eFarma',
  kind: 'shop',
  group,
  markets: ['it'],
  filterIrrelevant: true,
  limit: { concurrency: 2, gap: 200 },
  async search({ q, signal }) {
    const cfg = () => pageConfig('efarma', 'https://www.efarma.com/catalogsearch/result/?q=plasmon', readAlgoliaConfig, { lang: 'it-IT,it;q=0.9', signal, proxyExtra: '&country_code=it' });
    const d = await withConfig('efarma', cfg, async ({ app, index, key }) => {
      const res = await request(`https://${app}-dsn.algolia.net/1/indexes/${encodeURIComponent(`${index}_products`)}/query`, {
        method: 'POST', signal, timeout: 10000, accept: 'application/json',
        headers: { 'X-Algolia-Application-Id': app, 'X-Algolia-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, hitsPerPage: 40 }),
      });
      return res.json();
    });
    return parseEfarma(d.hits || []);
  },
};

// ---------------------------------------------------------------- Shoppers Drug Mart (Next.js data)

export function parseShoppers(html) {
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return null;
  let tiles;
  try {
    const d = JSON.parse(raw);
    const comps = d.props?.pageProps?.viewDefinitionResults?.viewDefinition?.layout?.sections?.mainContentCollection?.components || [];
    tiles = comps.flatMap((c) => c.data?.productTiles || []);
  } catch {
    return null;
  }
  const seen = new Set();
  return tiles.filter((t) => t?.title && t.link && !t.isSponsored && !seen.has(t.productId) && seen.add(t.productId)).map((t) => ({
    title: clean(t.title),
    url: `https://shop.shoppersdrugmart.ca${t.link.split('?')[0]}`,
    image: t.productImage?.[0]?.mediumUrl || t.productImage?.[0]?.imageUrl || null,
    price: Number(t.pricing?.price) || null,
    currency: 'CAD',
    brand: t.brand || null,
    rating: t.ratings?.average_rating ?? null,
    reviews: t.ratings?.review_count ?? null,
    snippet: t.pricingUnits?.unit || null,
    seller: 'Shoppers Drug Mart',
    extra: { deal: t.deal?.text || null },
  }));
}

export const shoppers = {
  id: 'shoppers',
  name: 'Shoppers Drug Mart',
  kind: 'shop',
  group,
  markets: ['ca'],
  filterIrrelevant: true,
  needsKey: 'SCRAPE_PROXY',
  limit: { concurrency: 2, gap: 400 },
  async search({ q, signal }) {
    const { text } = await fetchText(`https://shop.shoppersdrugmart.ca/search?text=${encodeURIComponent(q)}`, {
      signal, timeout: 15000, lang: 'en-CA,en;q=0.9', proxy: 'always', proxyExtra: '&country_code=ca', proxyTimeout: 50000,
    });
    const items = parseShoppers(text);
    if (!items) throw new HttpError('Shoppers Drug Mart: không đọc được dữ liệu trang', 502);
    return items;
  },
};

// ---------------------------------------------------------------- Lotte ON (product JSON in the page)

export function parseLotteon(html) {
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/"brazeData":\s*\{([^{}]*)\}/g)) {
    let r;
    try {
      r = JSON.parse(`{${m[1]}}`);
    } catch {
      continue;
    }
    if (!r.spdNm || !r.spdNo || seen.has(r.spdNo)) continue;
    seen.add(r.spdNo);
    out.push({
      title: clean(r.spdNm),
      url: `https://www.lotteon.com/p/product/${r.spdNo}`,
      image: r.image || null,
      price: Number(r.discountPrice) || Number(r.price) || null,
      originalPrice: Number(r.price) > Number(r.discountPrice) ? Number(r.price) : null,
      currency: 'KRW',
      brand: r.brandName || null,
      rating: r.reviewCount > 0 ? Number(r.reviewScore) || null : null,
      reviews: Number(r.reviewCount) || null,
      seller: 'Lotte ON',
    });
  }
  return out;
}

export const lotteon = {
  id: 'lotteon',
  name: 'Lotte ON',
  kind: 'shop',
  group,
  markets: ['kr'],
  filterIrrelevant: true,
  needsKey: 'SCRAPE_PROXY',
  limit: { concurrency: 2, gap: 400 },
  async search({ q, signal }) {
    const { text } = await fetchText(`https://www.lotteon.com/search/search/search.ecn?render=search&q=${encodeURIComponent(q)}`, {
      signal, timeout: 15000, lang: 'ko-KR,ko;q=0.9', proxy: 'always', proxyExtra: '&country_code=kr', proxyTimeout: 50000,
    });
    return parseLotteon(text);
  },
};

// ---------------------------------------------------------------- REWE (server-rendered tiles, no price)

export function parseRewe(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const out = [];
  $('[class*="a-pt__product-tile_"]').each((_, el) => {
    const $el = $(el);
    const title = clean($el.find('h4').first().text());
    const href = $el.find('a[href^="/shop/p/"]').first().attr('href');
    if (!title || !href || seen.has(href)) return;
    seen.add(href);
    const img = $el.find('img').first().attr('src');
    const grammage = clean($el.find('[class*="grammage"]').first().text());
    out.push({
      title: grammage && !title.includes(grammage) ? `${title} ${grammage}` : title,
      url: `https://shop.rewe.de${href}`,
      image: img || null,
      price: null, // "Konkreter Preis abhängig vom Standort": REWE shows prices only for a chosen market
      currency: 'EUR',
      seller: 'REWE',
    });
  });
  return out;
}

export const rewe = {
  id: 'rewe',
  name: 'REWE',
  kind: 'shop',
  group,
  markets: ['de'],
  filterIrrelevant: true,
  needsKey: 'SCRAPE_PROXY',
  limit: { concurrency: 2, gap: 400 },
  async search({ q, signal }) {
    const { text } = await fetchText(`https://shop.rewe.de/productList?search=${encodeURIComponent(q)}`, {
      signal, timeout: 15000, lang: 'de-DE,de;q=0.9', proxy: 'always', proxyExtra: '&country_code=de', proxyTimeout: 50000,
    });
    return parseRewe(text);
  },
};

export const apiShops = [prenatal, efarma, shoppers, lotteon, rewe];
