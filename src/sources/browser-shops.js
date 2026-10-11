// Shops that can only be read in the user's own browser (see lib/browser.js): they need a signed-in visitor or
// show a human check that no proxy gets past. Only listed while the browser is usable; the first visit may ask
// the user to sign in or pass a check in the browser window, later visits reuse that profile's cookies.
import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http.js';
import { clean, parsePrice } from '../lib/normalize.js';
import { parseSold } from '../lib/item.js';

// Shopee VN: search needs a signed-in account. Each result is a link to ".../<name>-i.<shopId>.<itemId>".
export function parseShopee(html, base = 'https://shopee.vn') {
  const $ = cheerio.load(html);
  const seen = new Set();
  const out = [];
  $('a[href*="-i."]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    const m = href.match(/-i\.(\d+)\.(\d+)/);
    if (!m || seen.has(m[2])) return;
    const lines = $a.find('*').map((_, n) => ($(n).children().length ? '' : clean($(n).text()))).get().filter(Boolean);
    const text = lines.join(' ');
    const price = text.match(/₫\s?([\d.]+)/)?.[1] || text.match(/([\d.]+)\s?₫/)?.[1];
    const title = clean($a.find('img[alt]').filter((_, i) => clean($(i).attr('alt')).length > 8).first().attr('alt'))
      || lines.filter((l) => !/₫|đã bán|^\d/i.test(l)).sort((x, y) => y.length - x.length)[0];
    if (!title || !price) return;
    seen.add(m[2]);
    const img = $a.find('img').filter((_, i) => /susercontent|cf\.shopee/.test($(i).attr('src') || '')).first().attr('src');
    out.push({
      title,
      url: new URL(href.split('?')[0], base).href,
      image: img || null,
      price: parsePrice(`${price}₫`, 'vn')?.value ?? null,
      currency: 'VND',
      sold: parseSold(text.match(/đã bán\s*([\d.,]+\s*k?)/i)?.[1]?.replace(',', '.') || null),
      rating: Number(text.match(/(?:^|\s)([1-5][.,]\d)(?:\s|$)/)?.[1]?.replace(',', '.')) || null,
      seller: 'Shopee',
      sponsored: /\bAd\b|Tài trợ/.test(text),
    });
  });
  return out;
}

export const shopee = {
  id: 'shopee',
  name: 'Shopee',
  kind: 'shop',
  group: 'Sàn TMĐT',
  markets: ['vn'],
  browserOnly: true,
  limit: { concurrency: 1, gap: 2000 },
  async search({ q, signal }) {
    const { text, url } = await fetchText(`https://shopee.vn/search?keyword=${encodeURIComponent(q)}`, { signal, lang: 'vi-VN,vi;q=0.9' });
    return parseShopee(text, url);
  },
};
