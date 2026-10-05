// More national retailers whose search pages carry structured product data (schema.org JSON-LD or embedded
// app state) that the generic listing extractor reads. Some answer directly; the others only to a visitor
// from their own country, so they go through SCRAPE_PROXY with that country's IP (1 credit per search).
import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http.js';
import { clean } from '../lib/normalize.js';
import { storeSource } from './stores.js';

const group = 'Shop nước ngoài';
const direct = (o) => storeSource({ group, filterIrrelevant: true, timeout: 12000, ...o });
// ScraperAPI country codes (UK is "uk", not "gb").
const local = (cc, o) => storeSource({
  group, filterIrrelevant: true, proxy: 'always', proxyExtra: `&country_code=${cc}`, proxyTimeout: 50000, needsKey: 'SCRAPE_PROXY', ...o,
});

const de = 'de-DE,de;q=0.9,en;q=0.5';
const en = (c) => `en-${c},en;q=0.9`;

export const moreShops = [
  // Germany
  direct({ id: 'shopapotheke', name: 'Shop Apotheke', markets: ['de'], currency: 'EUR', lang: de, searchUrl: (q) => `https://www.shop-apotheke.com/search.htm?q=${q}` }),
  // Italy: online pharmacies carry most of the baby-food range (Plasmon, Mellin, HiPP…) and answer directly;
  // the supermarkets (Esselunga, Conad, Carrefour) load results with JavaScript or block.
  direct({ id: 'farmae', name: 'Farmaè', markets: ['it'], currency: 'EUR', lang: 'it-IT,it;q=0.9', searchUrl: (q) => `https://www.farmae.it/search?q=${q}` }),
  direct({ id: 'farmaciaigea', name: 'Farmacia Igea', markets: ['it'], currency: 'EUR', lang: 'it-IT,it;q=0.9', searchUrl: (q) => `https://farmaciaigea.com/index.php?route=product/search&search=${q}` }),
  direct({ id: 'amicafarmacia', name: 'Amica Farmacia', markets: ['it'], currency: 'EUR', lang: 'it-IT,it;q=0.9', searchUrl: (q) => `https://www.amicafarmacia.com/search?q=${q}` }),
  // Japan
  local('jp', { id: 'yahoojp', name: 'Yahoo!ショッピング', markets: ['jp'], currency: 'JPY', lang: 'ja-JP,ja;q=0.9', searchUrl: (q) => `https://shopping.yahoo.co.jp/search?p=${q}` }),
  // Korea
  local('kr', { id: 'ssg', name: 'SSG.COM', markets: ['kr'], currency: 'KRW', lang: 'ko-KR,ko;q=0.9', searchUrl: (q) => `https://www.ssg.com/search.ssg?query=${q}` }),
  // Canada
  direct({ id: 'wellca', name: 'Well.ca', markets: ['ca'], currency: 'CAD', lang: en('CA'), searchUrl: (q) => `https://well.ca/searchresult.html?keyword=${q}` }),
  local('ca', { id: 'walmartca', name: 'Walmart Canada', markets: ['ca'], currency: 'CAD', lang: en('CA'), searchUrl: (q) => `https://www.walmart.ca/en/search?q=${q}` }),
  local('ca', { id: 'loblaws', name: 'Loblaws', markets: ['ca'], currency: 'CAD', lang: en('CA'), searchUrl: (q) => `https://www.loblaws.ca/search?search-bar=${q}` }),
];

// Retailers whose cards need their own reading (the generic extractor picks the wrong text).

const cardSource = ({ id, name, markets, currency, lang, url, fetch: fo = {}, read }) => ({
  id, name, kind: 'shop', group, markets, filterIrrelevant: true, needsKey: fo.proxy === 'always' ? 'SCRAPE_PROXY' : undefined,
  limit: { concurrency: 2, gap: 400 },
  async search({ q, signal }) {
    const { text } = await fetchText(url(encodeURIComponent(q)), { signal, timeout: 12000, lang, proxyTimeout: 50000, ...fo });
    const $ = cheerio.load(text);
    return read($).filter((p) => p.title && p.url).map((p) => ({ currency, seller: name, ...p }));
  },
});

// Aldi UK: brand and product name are separate fields; the generic reader only saw the brand.
moreShops.push(cardSource({
  id: 'aldiuk', name: 'Aldi UK', markets: ['gb'], currency: 'GBP', lang: en('GB'),
  url: (q) => `https://www.aldi.co.uk/results?q=${q}`,
  fetch: { proxy: 'fallback' },
  read: ($) => $('.product-tile').map((_, el) => {
    const $el = $(el);
    const brand = clean($el.find('.product-tile__brandname').text());
    const nm = clean($el.find('.product-tile__name').text()) || $el.attr('title');
    const size = clean($el.find('.product-tile__unit-of-measurement').text());
    return {
      title: clean(`${brand && !nm.toLowerCase().startsWith(brand.toLowerCase()) ? brand + ' ' : ''}${nm}${size ? ' ' + size : ''}`),
      brand: brand || null,
      url: new URL($el.find('a').first().attr('href') || '', 'https://www.aldi.co.uk').href,
      image: $el.find('img').attr('src') || null,
      price: clean($el.find('.base-price__discounted, .base-price__regular').first().text()) || null,
      originalPrice: clean($el.find('.base-price__was-price').text()) || null,
      snippet: clean($el.find('.product-tile__comparison-price').text()) || null,
    };
  }).get(),
}));

// Kroger: the product name is the card's aria-label; the UPC is the last part of the product link.
moreShops.push(cardSource({
  id: 'kroger', name: 'Kroger', markets: ['us'], currency: 'USD', lang: en('US'),
  url: (q) => `https://www.kroger.com/search?query=${q}`,
  fetch: { proxy: 'always', proxyExtra: '&country_code=us' },
  read: ($) => $('.ProductCard').map((_, el) => {
    const $el = $(el);
    const href = $el.find('a[href*="/p/"]').first().attr('href') || '';
    const upc = href.match(/\/(\d{8,14})(?:\?|$)/)?.[1];
    return {
      title: clean($el.attr('aria-label')),
      url: href ? new URL(href.split('?')[0], 'https://www.kroger.com').href : null,
      image: $el.find('img').attr('src') || null,
      price: clean($el.find('[data-testid="product-item-unit-price"]').text()).match(/\$\s?\d+(?:\.\d{2})?/)?.[0] || null,
      gtin: upc || null,
      snippet: clean($el.find('[data-testid="product-item-sizing"]').text()) || null,
      sponsored: /Sponsored/.test($el.find('.ProductCard-tags').text()),
    };
  }).get(),
}));

// Rakuten Ichiba: 45 result cards per page (the JSON-LD block lists only 10); price, rating, review count and
// the shop name are on each card.
moreShops.push(cardSource({
  id: 'rakuten', name: 'Rakuten', markets: ['jp'], currency: 'JPY', lang: 'ja-JP,ja;q=0.9,en;q=0.5',
  url: (q) => `https://search.rakuten.co.jp/search/mall/${q}/`,
  fetch: { proxy: 'fallback' },
  read: ($) => $('.searchresultitem[data-card-type="item"]').map((_, el) => {
    const $el = $(el);
    const review = $el.find('[class*="review"]').first().text().match(/(\d(?:\.\d+)?)\s*\(([\d,]+)件\)/);
    const shop = clean($el.find('[class*="merchant"] a').first().text());
    return {
      title: clean($el.find('img').first().attr('alt')),
      url: ($el.find('a[href*="item.rakuten.co.jp"]').first().attr('href') || '').split('?')[0] || null,
      image: $el.find('img').first().attr('src') || null,
      price: Number($el.attr('data-track-price')) || null,
      rating: review ? Number(review[1]) : null,
      reviews: review ? Number(review[2].replace(/,/g, '')) : null,
      seller: shop ? `Rakuten · ${shop}` : 'Rakuten',
    };
  }).get(),
}));
