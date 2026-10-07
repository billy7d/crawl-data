// Shops whose search pages are JavaScript apps backed by a public search service, or whose pages embed the
// product data as JSON. The pages themselves are blocked for direct requests from many IPs (so they go through
// SCRAPE_PROXY when needed), but the search services answer directly:
//   • Prenatal (IT)  — Meilisearch      • eFarma (IT), Asda and Boots (UK) — Algolia
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

// ---------------------------------------------------------------- Asda (Algolia)

export const readAsdaConfig = (html) => {
  const m = html.match(/"algolia":{"appId":"([^"]+)","searchAPIKey":"([^"]+)","writeAPIKey":"[^"]*","productsIndex":"([^"]+)"/);
  return m ? { app: m[1], key: m[2], index: m[3] } : null;
};

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const asdaJSON = (v) => {
  try {
    return typeof v === 'string' ? JSON.parse(v) : v || {};
  } catch {
    return {};
  }
};

export function parseAsda(hits) {
  return hits.filter((h) => h?.NAME && h.CIN && h.DISPLAY_ONLINE !== 'false').map((h) => {
    const prices = asdaJSON(h.PRICES);
    const p = prices.EN || Object.values(prices)[0] || {};
    const aisle = asdaJSON(h.PRIMARY_TAXONOMY).AISLE_NAME || asdaJSON(h.PRIMARY_TAXONOMY).DEPT_NAME || 'groceries';
    const name = clean([h.BRAND, h.NAME].filter(Boolean).filter((x, i, a) => i === 0 || !String(h.NAME).toLowerCase().startsWith(String(a[0]).toLowerCase())).join(' '));
    const lifestyles = asdaJSON(h.LIFESTYLES);
    return {
      title: name,
      url: `https://www.asda.com/groceries/product/${slug(aisle)}/${slug(name).replace(/-+/g, '-').replace(/^-|-$/g, '')}/${h.CIN}`,
      image: h.IMAGE_ID ? `https://asdagroceries.scene7.com/is/image/asdagroceries/${h.IMAGE_ID}?$ProdListProd$` : null,
      price: p.PRICE ?? null,
      currency: 'GBP',
      brand: h.BRAND || null,
      rating: Number(h.AVG_RATING) > 0 ? Math.round(Number(h.AVG_RATING) * 10) / 10 : null,
      reviews: Number(h.RATING_COUNT) || null,
      snippet: [h.PACK_SIZE, p.PRICEPERUOMFORMATTED].filter(Boolean).join(' · ') || null,
      seller: 'Asda',
      sponsored: String(h.IS_SPONSORED) === 'true',
      extra: { lifestyles: Array.isArray(lifestyles) ? lifestyles : [] },
    };
  });
}

export const asda = {
  id: 'asda',
  name: 'Asda',
  kind: 'shop',
  group,
  markets: ['gb'],
  filterIrrelevant: true,
  limit: { concurrency: 2, gap: 200 },
  async search({ q, signal }) {
    const cfg = () => pageConfig('asda', 'https://www.asda.com/groceries/search/baby', readAsdaConfig, { lang: 'en-GB,en;q=0.9', signal, proxyExtra: '&country_code=uk' });
    const d = await withConfig('asda', cfg, async ({ app, key, index }) => {
      const res = await request(`https://${app}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/query`, {
        method: 'POST', signal, timeout: 10000, accept: 'application/json',
        headers: { 'X-Algolia-Application-Id': app, 'X-Algolia-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, hitsPerPage: 40 }),
      });
      return res.json();
    });
    return parseAsda(d.hits || []);
  },
};

// ---------------------------------------------------------------- Boots (Algolia)

export const readBootsConfig = (html) => {
  const m = html.match(/algoliaConfig=\{appID:"([^"]+)",APIKey:"([^"]+)",productIndex:"([^"]+)"/);
  return m ? { app: m[1], key: m[2], index: m[3], filters: html.match(/defaultFilter:"([^"]+)"/)?.[1] || '' } : null;
};

export function parseBoots(hits) {
  return hits.filter((h) => h?.offerName && h.actionURL).map((h) => {
    const price = Number(h.currentPrice) || null;
    const regular = Number(h.regularPrice) || null;
    const attrs = (() => {
      try {
        return JSON.parse(h.productAttributes || '{}');
      } catch {
        return {};
      }
    })();
    return {
      title: clean(h.offerName),
      url: `https://www.boots.com${h.actionURL}`,
      image: h.referenceImageURL || h.thumbnailImage || null,
      price,
      originalPrice: regular && price && regular > price ? regular : null,
      currency: 'GBP',
      brand: h.brand || null,
      gtin: h.upc || null,
      rating: Number(h.numberOfReviews) > 0 ? Math.round(Number(h.averageReviewScore) * 10) / 10 || null : null,
      reviews: Number(h.numberOfReviews) || null,
      snippet: [h.ppuVolume, h.pricePerUnit, attrs.suitable_from ? `từ ${attrs.suitable_from}` : ''].filter(Boolean).join(' · ') || null,
      seller: 'Boots',
      extra: { inStock: h.inStock === true || h.inStock === 'true' },
    };
  });
}

export const boots = {
  id: 'boots',
  name: 'Boots',
  kind: 'shop',
  group,
  markets: ['gb'],
  filterIrrelevant: true,
  limit: { concurrency: 2, gap: 200 },
  async search({ q, signal }) {
    const cfg = () => pageConfig('boots', 'https://www.boots.com/sitesearch?searchTerm=baby', readBootsConfig, { lang: 'en-GB,en;q=0.9', signal, proxyExtra: '&country_code=uk' });
    const d = await withConfig('boots', cfg, async ({ app, key, index, filters }) => {
      const res = await request(`https://${app}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/query`, {
        method: 'POST', signal, timeout: 10000, accept: 'application/json',
        headers: { 'X-Algolia-Application-Id': app, 'X-Algolia-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, hitsPerPage: 40, ...(filters ? { filters } : {}) }),
      });
      return res.json();
    });
    return parseBoots(d.hits || []);
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

// ---------------------------------------------------------------- REWE (with store context)

// Store cookie and marketId are unverified guesses.
const REWE_STORE_COOKIE = 'lr_market_id=1764010; isMarketSelected=true; marketId=1764010; rewe_zip=10115; rewe_market=1764010';

export function parseRewe(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const out = [];
  $('[class*="a-pt__product-tile_"], [class*="product-tile"]').each((_, el) => {
    const $el = $(el);
    const title = clean($el.find('h4, [class*="product-title"]').first().text());
    const href = $el.find('a[href^="/shop/p/"]').first().attr('href');
    if (!title || !href || seen.has(href)) return;
    seen.add(href);
    const img = $el.find('img').first().attr('src');
    const grammage = clean($el.find('[class*="grammage"]').first().text());

    // Only the item price: unit prices (Grundpreis, per kg/l) are skipped; prices show only with a chosen market.
    let price = null;
    $el.find('[class*="price"], [class*="Price"], [data-testid*="price"]').each((__, p) => {
      const t = clean($(p).text());
      if (!t || /kg|l =|grundpreis|\/100|1 kg|1 l/i.test(t)) return;
      const m = t.match(/(\d+)[,.](\d{2})\s*€/) || t.match(/€\s*(\d+)[,.](\d{2})/);
      if (m) {
        price = Number(`${m[1]}.${m[2]}`);
        return false;
      }
    });

    out.push({
      title: grammage && !title.includes(grammage) ? `${title} ${grammage}` : title,
      url: new URL(href, 'https://shop.rewe.de').href,
      image: img || null,
      price,
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
    const { text } = await fetchText(`https://shop.rewe.de/productList?search=${encodeURIComponent(q)}&marketId=1764010`, {
      signal, timeout: 15000, lang: 'de-DE,de;q=0.9', proxy: 'always', proxyExtra: '&country_code=de&keep_headers=true', proxyTimeout: 50000,
      headers: { Cookie: REWE_STORE_COOKIE },
    });
    return parseRewe(text);
  },
};

export const apiShops = [prenatal, efarma, asda, boots, shoppers, lotteon, rewe];
