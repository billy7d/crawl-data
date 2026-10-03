import * as cheerio from 'cheerio';
import { fetchText, request } from '../lib/http.js';
import { MARKETS } from '../lib/markets.js';
import { clean } from '../lib/normalize.js';

export const PRICE_IN_TEXT = /(?:₫|đ|VND|US\$|\$|£|€|¥|円|₩|원|฿|RM|₱|Rp)\s?\d[\d.,]*|\d[\d.,]*\s?(?:₫|đ|VNĐ|VND|円|원|€)/;

// Bing wraps result links in /ck/a?...&u=a1<base64url(target)>
export function decodeBingUrl(href) {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://www.bing.com');
    if (u.hostname.endsWith('bing.com') && u.pathname.startsWith('/ck/')) {
      const p = u.searchParams.get('u');
      if (p?.startsWith('a1')) {
        return Buffer.from(p.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      }
    }
    return u.href;
  } catch {
    return null;
  }
}

// A cookie-less client looks like a bot to Bing; start a session like a browser would and reuse it.
let jar = { cookie: '', exp: 0 };
export async function bingCookie(signal) {
  if (jar.exp > Date.now()) return jar.cookie;
  try {
    const res = await request('https://www.bing.com/', { signal, timeout: 5000 });
    await res.arrayBuffer();
    jar = { cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), exp: Date.now() + 30 * 60e3 };
  } catch {
    jar = { cookie: '', exp: Date.now() + 60e3 };
  }
  return jar.cookie;
}

export async function bingWeb(q, market, signal, { count = 30 } = {}) {
  const m = MARKETS[market] || MARKETS.vn;
  const lang = m.mkt.split('-')[0];
  const headers = { Cookie: await bingCookie(signal), Referer: 'https://www.bing.com/' };
  const get = (params) => fetchText(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=${count}${params}`, {
    signal, timeout: 7000, lang: `${m.mkt},${lang};q=0.9,en;q=0.6`, headers,
  }).then((r) => cheerio.load(r.text));
  let $ = await get(`&setlang=${lang}&cc=${market.toUpperCase()}&mkt=${m.mkt}`);
  // Some Bing markets (e.g. ja-JP) answer requests from outside the country with an empty page;
  // the global index still has those pages, so retry through the default market.
  if (!$('li.b_algo').length && market !== 'vn') $ = await get('&cc=VN&mkt=vi-VN');
  const out = [];
  $('li.b_algo').each((_, el) => {
    const $el = $(el);
    const a = $el.find('h2 a').first();
    const target = decodeBingUrl(a.attr('href'));
    if (!target || !/^https?:/.test(target)) return;
    const snippet = clean($el.find('.b_caption p, p.b_lineclamp2, p.b_lineclamp3, p.b_lineclamp4, .b_algoSlug').first().text())
      || clean($el.find('p').first().text());
    const img = $el.find('img').filter((_, i) => {
      const w = Number($(i).attr('width') || 0);
      const src = $(i).attr('src') || $(i).attr('data-src') || '';
      return /^https?:/.test(src) && (w === 0 || w >= 50) && !/favicon|\/th\?id=ODF|\/rp\//.test(src);
    }).first();
    const priceText = clean($el.text()).match(PRICE_IN_TEXT)?.[0];
    out.push({
      title: clean(a.text()),
      url: target,
      snippet: snippet.replace(/^\d{1,2} thg \d{1,2}, \d{4}\s*·\s*/, ''),
      image: img.attr('src') || img.attr('data-src') || null,
      price: priceText || null,
    });
  });
  return out;
}

export default {
  id: 'bing',
  name: 'Bing',
  kind: 'web',
  group: 'Search engine',
  markets: '*',
  limit: { key: 'bing', concurrency: 2, gap: 700 },
  async search({ q, market, signal }) {
    return bingWeb(q, market, signal);
  },
};
