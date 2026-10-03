// Builds the normalized product row the UI consumes, and recomputes derived fields after enrichment.
import { hash } from './cache.js';
import { toVND } from './currency.js';
import { countryFromCurrency, countryFromText, countryFromUrl, hostOf } from './markets.js';
import {
  NON_FOOD, fold, clean, detectAllergens, detectClaims, detectType, guessBrand, normalizeBrand, parseAgeMonths,
  parsePrice, parseQuantity, relevance, truncate,
} from './normalize.js';

export function parseSold(s) {
  if (s == null) return null;
  if (typeof s === 'number') return s;
  const m = String(s).toLowerCase().replace(/\s/g, '').match(/(\d+(?:[.,]\d+)?)(k|m|nghìn|tr)?/);
  if (!m) return null;
  let n = Number(m[1].replace(',', '.'));
  if (m[2] === 'k' || m[2] === 'nghìn') n *= 1000;
  if (m[2] === 'm' || m[2] === 'tr') n *= 1e6;
  return Math.round(n);
}

export function makeItem(raw, ctx) {
  const market = raw.market || ctx.market;
  let price = raw.price;
  let currency = raw.currency;
  if (price != null && typeof price !== 'number') {
    const p = parsePrice(price, market, currency);
    price = p?.value ?? null;
    currency = p?.currency || currency;
  }
  let originalPrice = raw.originalPrice;
  if (originalPrice != null && typeof originalPrice !== 'number') originalPrice = parsePrice(originalPrice, market, currency)?.value ?? null;

  // Shops sometimes put their own name in the brand field ("KidsPlaza"); that is not a product brand.
  const squash = (s) => fold(s || '').replace(/[^a-z0-9]/g, '');
  const brandRaw = raw.brand && ![squash(raw.seller), squash(raw.source)].includes(squash(raw.brand)) ? raw.brand : null;

  const item = {
    id: hash(`${raw.source}|${raw.url || raw.title}`),
    source: raw.source,
    kind: raw.kind || 'web',
    market,
    title: clean(raw.title),
    url: raw.url || null,
    domain: hostOf(raw.url),
    image: raw.image || null,
    brand: normalizeBrand(brandRaw),
    seller: clean(raw.seller) || null,
    price: price ?? null,
    currency: currency || null,
    originalPrice: originalPrice && originalPrice > (price || 0) ? originalPrice : null,
    rating: raw.rating ? Math.round(Number(raw.rating) * 10) / 10 : null,
    reviews: raw.reviews != null ? Number(raw.reviews) || null : null,
    sold: parseSold(raw.sold),
    snippet: raw.snippet ? truncate(raw.snippet, 300) : null,
    description: raw.description ? truncate(raw.description, 700) : null,
    sections: { ...(raw.sections || {}) },
    countries: raw.countries || null,
    origin: raw.origin || null,
    nutriscore: raw.nutriscore || null,
    nova: raw.nova || null,
    gtin: raw.gtin || null,
    sponsored: !!raw.sponsored,
    extra: raw.extra || null,
    country: raw.country || null,
    enriched: !!raw.enriched,
    relBonus: raw.relBonus || 0,
  };
  return finalize(item, ctx);
}

// Recompute everything that depends on other fields (call again after merging enrichment data).
export function finalize(item, ctx) {
  if (!item.currency && item.price != null) item.currency = countryFromUrl(item.url) === 'vn' ? 'VND' : null;
  item.priceVND = toVND(item.price, item.currency);
  // A parse slip (a phone number read as a price, a currency mix-up) shows up as an absurd value; drop it.
  if (item.priceVND > 30e6) {
    item.price = null;
    item.priceVND = null;
  }
  item.originalPriceVND = toVND(item.originalPrice, item.currency);
  item.discount = item.originalPrice && item.price ? Math.round((1 - item.price / item.originalPrice) * 100) : null;

  const s = item.sections || {};
  const all = [item.title, item.snippet, item.description, s.age, s.weight].filter(Boolean).join(' \n ');
  item.qty = parseQuantity(item.title) || parseQuantity(s.weight) || parseQuantity(item.snippet);
  item.pricePer100VND = item.priceVND && item.qty?.total >= 20 ? Math.round((item.priceVND / item.qty.total) * 100) : null;
  item.ageMonths = parseAgeMonths(s.age) ?? parseAgeMonths(item.title) ?? parseAgeMonths(all);
  item.type = detectType(item.title) || detectType(item.snippet) || null;
  item.nonFood = item.type === NON_FOOD;
  item.claims = detectClaims([item.title, item.snippet, item.description, s.ingredients].filter(Boolean).join(' '));
  item.allergens = detectAllergens(s.ingredients);
  if (!item.brand) item.brand = guessBrand(item.title) || guessBrand(item.snippet);

  if (!item.country) {
    item.country = countryFromUrl(item.url) || countryFromCurrency(item.currency) || item.market || null;
  }
  item.originCountry = countryFromText(item.origin || s.origin) || null;
  if (ctx?.queries) {
    const r = relevance(item.title, `${item.snippet || ''} ${item.description || ''}`, ctx.queries);
    item.relevance = Math.round(Math.min(1.4, r + (item.relBonus || 0)) * 100) / 100;
  }
  return item;
}

// Merge enrichment output into an item without overwriting better data from the source.
export function mergeDetail(item, d, ctx) {
  if (!d) return item;
  if (!item.image && d.image) item.image = d.image;
  if (item.price == null && d.price != null) {
    item.price = d.price;
    item.currency = d.currency || item.currency;
  }
  if (!item.brand && d.brand) item.brand = normalizeBrand(d.brand);
  if (!item.description && d.description) item.description = truncate(d.description, 700);
  if (item.rating == null && d.rating) item.rating = Math.round(d.rating * 10) / 10;
  if (item.reviews == null && d.reviews) item.reviews = d.reviews;
  if (!item.gtin && d.gtin) item.gtin = d.gtin;
  if (!item.origin && d.origin) item.origin = d.origin;
  if (d.sold != null && item.sold == null) item.sold = d.sold;
  item.sections = { ...(d.sections || {}), ...Object.fromEntries(Object.entries(item.sections || {}).filter(([, v]) => v)) };
  if (d.images?.length) item.images = d.images;
  item.enriched = true;
  return finalize(item, ctx);
}
