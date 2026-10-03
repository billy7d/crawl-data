import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http.js';
import { MARKETS } from '../lib/markets.js';
import { clean } from '../lib/normalize.js';
import { bingCookie } from './bing.js';

// Bing Shopping aggregates offers from many retailers (US/UK/AU/DE/FR). Gives real shelf prices + images.
export default {
  id: 'bingshop',
  name: 'Bing Shopping',
  kind: 'shop',
  group: 'Search engine',
  markets: Object.keys(MARKETS).filter((k) => MARKETS[k].bingShop),
  limit: { key: 'bing', concurrency: 2, gap: 700 },
  async search({ q, market, signal }) {
    const m = MARKETS[market];
    const lang = m.mkt.split('-')[0];
    const url = `https://www.bing.com/shop?q=${encodeURIComponent(q)}&cc=${market.toUpperCase()}&mkt=${m.mkt}&setlang=${lang}`;
    const { text } = await fetchText(url, {
      signal, timeout: 9000, lang: `${m.mkt},${lang};q=0.9,en;q=0.6`,
      headers: { Cookie: await bingCookie(signal), Referer: 'https://www.bing.com/' },
    });
    const $ = cheerio.load(text);
    const out = [];
    const seen = new Set();
    $('.br-title span[title]').each((_, el) => {
      const $t = $(el);
      // Climb to the card: the nearest ancestor that holds both the title and a product image.
      let card = $t.parent();
      for (let i = 0; i < 8 && card.length && !card.find('img').length; i++) card = card.parent();
      if (!card.length) return;
      const title = clean($t.attr('title'));
      if (!title || seen.has(title)) return;
      seen.add(title);
      const href = card.find('a.br-titlelink').attr('href') || $t.closest('a').attr('href');
      const img = card.find('.br-pdMainImg img, img').first();
      const price = clean(card.find('.pd-price').first().text() || card.find('.br-price').first().text());
      const strike = clean(card.find('.br-strkPrice, .pd-strk, del').first().text());
      const seller = clean(card.find('.br-sellerName, .br-sellerNameWithTb, .br-seller').first().text()).replace(/\s*\+\s*\d+.*$/, '');
      const rating = card.find('[aria-label*="sao"], [aria-label*="star"], [aria-label*="Stern"]').first().attr('aria-label');
      out.push({
        title,
        url: href ? new URL(href, 'https://www.bing.com').href : null,
        image: img.attr('src') || img.attr('data-src') || null,
        price,
        originalPrice: strike || null,
        seller: seller || null,
        rating: rating ? Number((rating.match(/(\d+(?:[.,]\d)?)/) || [])[1]?.replace(',', '.')) || null : null,
        sponsored: /promoted|Được tài trợ|Sponsored|Gesponsert/i.test(card.text()),
      });
    });
    return out;
  },
};
