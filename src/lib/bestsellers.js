// Best-seller lists: what actually sells best in the baby-food category of each home market. They are the
// natural input for the official-import check: products popular abroad that may not be sold in Vietnam yet.
// Source: Amazon Best Sellers → Grocery → Baby Food (public pages, one request per page, no key needed).
import * as cheerio from 'cheerio';
import { fetchText, HttpError } from './http.js';
import { remember, del } from './cache.js';
import { throttled } from './limiter.js';
import { makeItem } from './item.js';
import { clean, fold } from './normalize.js';

// host, language, currency, the "Baby Food" node of the Grocery tree (found from each store's own category menu).
export const BESTSELLER_MARKETS = {
  us: ['www.amazon.com', 'en-US', 'USD', 'grocery', '16323111'],
  gb: ['www.amazon.co.uk', 'en-GB', 'GBP', 'grocery', '358581031'],
  de: ['www.amazon.de', 'de-DE', 'EUR', 'grocery', '358555031'],
  fr: ['www.amazon.fr', 'fr-FR', 'EUR', 'grocery', '6356706031'],
  it: ['www.amazon.it', 'it-IT', 'EUR', 'grocery', '1806695031'],
  es: ['www.amazon.es', 'es-ES', 'EUR', 'grocery', '6347831031'],
  nl: ['www.amazon.nl', 'nl-NL', 'EUR', 'grocery', '16462596031'],
  ca: ['www.amazon.ca', 'en-CA', 'CAD', 'grocery', '7351088011'],
  au: ['www.amazon.com.au', 'en-AU', 'AUD', 'grocery', '5265192051'],
  jp: ['www.amazon.co.jp', 'ja-JP', 'JPY', 'food-beverage', '71422051'],
};

// Amazon shows prices in the currency of the visitor's country ("VND 285,321") on some pages.
const CURRENCY_IN_PRICE = [[/\bVND\b|₫/, 'VND'], [/\bUSD\b|US\$/, 'USD'], [/\bGBP\b|£/, 'GBP'], [/\bEUR\b|€/, 'EUR'], [/\bCAD\b|CA\$/, 'CAD'], [/\bAUD\b|A\$/, 'AUD'], [/\bJPY\b|￥|¥/, 'JPY']];

async function page(market, pg, signal) {
  const [host, lang, , slug, node] = BESTSELLER_MARKETS[market];
  const url = `https://${host}/gp/bestsellers/${slug}/${node}/?ie=UTF8&pg=${pg}`;
  const { text } = await fetchText(url, { signal, timeout: 12000, lang: `${lang},${lang.split('-')[0]};q=0.9`, proxy: 'fallback' });
  const $ = cheerio.load(text);
  const cards = $('#gridItemRoot');
  if (!cards.length) {
    if (text.length < 40000 || /captcha|api-services-support|robot/i.test(text)) throw new HttpError('Amazon yêu cầu captcha (tạm thời)', 429);
    return []; // page past the end of the list
  }
  const out = [];
  cards.each((_, el) => {
    const $el = $(el);
    const asin = $el.find('[data-asin]').first().attr('data-asin');
    const title = clean($el.find('img').first().attr('alt') || $el.find('[class*="line-clamp"]').first().text());
    const rank = Number($el.find('.zg-bdg-text').first().text().replace(/\D/g, ''));
    if (!asin || !title) return;
    const price = clean($el.find('[class*="p13n-sc-price"]').first().text());
    const ratingText = $el.find('.a-icon-alt').first().text();
    const rating = ratingText.match(/(\d+[.,]\d)/)?.[1];
    const reviews = clean($el.find('.a-icon-row .a-size-small').first().text()).replace(/[^\d]/g, '');
    out.push({
      title,
      url: `https://${host}/dp/${asin}`,
      image: $el.find('img').first().attr('src') || null,
      price: price || null,
      currency: CURRENCY_IN_PRICE.find(([re]) => re.test(price))?.[1] || BESTSELLER_MARKETS[market][2],
      rating: rating ? Number(rating.replace(',', '.')) : null,
      reviews: reviews ? Number(reviews) : null,
      seller: 'Amazon',
      rank: rank || null,
    });
  });
  return out;
}

// The "Baby Food" node also lists infant formula and milk drinks; this is a complementary-food (ăn dặm) tool.
const FORMULA = /formula|nutritional drink|toddler drink|enfagrow|enfamil|similac|good start|bebelac|infant milk|baby milk|growing[- ]?up milk|toddler milk|follow[- ]?on|milk powder|first milk|anfangsmilch|folgemilch|pre[- ]nahrung|milchpulver|kindermilch|lait (?:infantile|\d|de croissance|pour nourrisson|1er|2[eè]me)|leche (?:para lactantes|de continuaci|de crecimiento|infantil)|latte (?:in polvere|di proseguimento|di crescita|per l'infanzia)|zuigelingenmelk|opvolgmelk|groeimelk|粉ミルク|液体ミルク|フォローアップ|ミルク|\bpre\b ?\d? ?(?:bio|milch)|\bstage [123] (?:milk|formula)\b|nutrilon|aptamil [123]\b|nan (?:supreme|optipro)|\bhmo\b/i;

// Also in the node: oral rehydration, nutrition shakes, water, tea, supplements.
const NOT_FOOD = /pedia ?sure|pedialyte|electrolyte|rehydrat|retterspitz|protein shake|nutrition(?:al)? shake|\bshake\b|drinking water|baby water|mineral ?water|wasser\b|\beau\b|agua\b|acqua\b|麦茶|純水|ミネラル|飲料|vitamin|supplement|probiotic|drops\b|tropfen|colic|coliche|\bsirop/i;

// Amazon titles start with the brand ("Plasmon Omogeneizzato Pollo…", "【和光堂】 …"); the generic brand guesser
// misses many European/Asian brands, so fall back to the leading word(s).
const BRAND_TAIL = /^(kitchen|organics|garden|farm|bellies|spoon|gourmet|baby|tot|mum-mum|freddie|rabbit|goût|gout|fruit|food|foods|kids)$/i;
function leadBrand(title) {
  const bracket = title.match(/^[【\[]([^】\]]{1,20})[】\]]/);
  if (bracket) return bracket[1].trim();
  const w = title.replace(/^[^\p{L}\p{N}]+/u, '').split(/[\s,–—|:()]+/).filter(Boolean);
  if (!w.length || /^\d/.test(w[0]) || w[0].length < 2) return null;
  return w[1] && BRAND_TAIL.test(w[1]) && /^\p{Lu}/u.test(w[1]) ? `${w[0]} ${w[1]}` : w[0];
}

// Top ~50 of one market (two pages), cached for 12 hours.
export async function bestsellers(market, { signal, fresh = false, formula = false } = {}) {
  if (!BESTSELLER_MARKETS[market]) return [];
  const key = `bs:v1:${market}`;
  if (fresh) del(key);
  const { value } = await remember(key, 12 * 3600e3, () => throttled(`amazon:${market}`, { concurrency: 1, gap: 1200, cooldown: 15 * 60e3 }, async () => {
    const first = await page(market, 1, signal);
    let second = [];
    try {
      second = await page(market, 2, signal);
    } catch { /* page 1 alone is still a useful list */ }
    return [...first, ...second];
  }));
  return value
    .filter((r) => !NOT_FOOD.test(r.title) && (formula || !FORMULA.test(r.title)))
    .map((r) => {
      const it = makeItem({ ...r, source: 'amazon', kind: 'shop', market, relBonus: 0.45 }, { market, queries: [] });
      const starts = it.brand && fold(r.title).replace(/[^a-z0-9]/g, '').startsWith(fold(it.brand).replace(/[^a-z0-9]/g, ''));
      return { ...it, brand: starts ? it.brand : leadBrand(r.title) || it.brand, rank: r.rank, bestseller: true };
    });
}
