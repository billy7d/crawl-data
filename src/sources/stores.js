// Retailers whose search page is server-rendered: parsed with the generic listing extractor
// (schema.org JSON-LD first, product-card heuristic as fallback).
import { fetchText } from '../lib/http.js';
import { extractListing } from '../lib/extract.js';

function storeSource({ id, name, group, markets, currency, searchUrl, timeout = 8000, lang, proxy = 'fallback', needsKey, filterIrrelevant }) {
  return {
    id,
    filterIrrelevant,
    limit: { concurrency: 2, gap: 400 },
    name,
    kind: 'shop',
    group,
    markets,
    needsKey,
    async search({ q, signal }) {
      const url = searchUrl(encodeURIComponent(q));
      const { text, url: finalUrl } = await fetchText(url, { signal, timeout, lang, proxy });
      return extractListing(text, finalUrl).map((p) => ({
        ...p,
        currency: p.currency || currency,
        seller: name,
      }));
    },
  };
}

export const concung = storeSource({
  id: 'concung',
  name: 'Con Cưng',
  group: 'Chuỗi mẹ & bé VN',
  markets: ['vn'],
  currency: 'VND',
  searchUrl: (q) => `https://concung.com/search?search_query=${q}`,
});

export const kidsplaza = storeSource({
  id: 'kidsplaza',
  name: 'Kids Plaza',
  group: 'Chuỗi mẹ & bé VN',
  markets: ['vn'],
  currency: 'VND',
  searchUrl: (q) => `https://www.kidsplaza.vn/search?q=${q}`,
});

// Retailers behind bot walls (PerimeterX, Akamai, Cloudflare…). They are read through the scraping proxy
// configured in SCRAPE_PROXY; without it they are covered by the "Shop khác (qua Bing)" source instead.
const viaProxy = (id, name, markets, currency, lang, searchUrl) => storeSource({
  id, name, group: 'Shop nước ngoài (cần proxy)', markets, currency, lang, searchUrl, timeout: 60000, proxy: 'always', needsKey: 'SCRAPE_PROXY',
});
// Asda, Boots, Carrefour, Chemist Warehouse, eBay and Shopee were removed: through a normal proxy they return
// bot pages or JS shells (Shopee needs ScraperAPI ultra premium). They are covered by siteshop (Google index).
export const proxied = [
  viaProxy('walmart', 'Walmart', ['us'], 'USD', 'en-US,en;q=0.9', (q) => `https://www.walmart.com/search?q=${q}`),
  { ...viaProxy('iherb', 'iHerb', ['us'], 'USD', 'en-US,en;q=0.9', (q) => `https://www.iherb.com/search?kw=${q}`), filterIrrelevant: true }, // page also has promo cards
  viaProxy('coles', 'Coles', ['au'], 'AUD', 'en-AU,en;q=0.9', (q) => `https://www.coles.com.au/search/products?q=${q}`),
  viaProxy('coupang', 'Coupang', ['kr'], 'KRW', 'ko-KR,ko;q=0.9', (q) => `https://www.coupang.com/np/search?q=${q}`),
];

export const rakuten = storeSource({
  id: 'rakuten',
  name: 'Rakuten',
  group: 'Sàn TMĐT',
  markets: ['jp'],
  currency: 'JPY',
  timeout: 10000,
  lang: 'ja-JP,ja;q=0.9,en;q=0.5',
  searchUrl: (q) => `https://search.rakuten.co.jp/search/mall/${q}/`,
});

// Monoprix (France): server-rendered search page with schema.org data, readable without a proxy.
export const monoprix = storeSource({
  id: 'monoprix',
  name: 'Monoprix',
  group: 'Shop nước ngoài',
  markets: ['fr'],
  currency: 'EUR',
  timeout: 10000,
  lang: 'fr-FR,fr;q=0.9',
  filterIrrelevant: true,
  searchUrl: (q) => `https://courses.monoprix.fr/search?q=${q}`,
});
