import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http.js';
import { MARKETS } from '../lib/markets.js';
import { clean } from '../lib/normalize.js';

function decodeDdg(href) {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    if (u.pathname === '/l/' && u.searchParams.get('uddg')) return u.searchParams.get('uddg');
    if (u.hostname.endsWith('duckduckgo.com')) return null; // ads (y.js) and internal links
    return u.href;
  } catch {
    return null;
  }
}

export async function ddgWeb(q, market, signal) {
  const m = MARKETS[market] || MARKETS.vn;
  // The "lite" HTML endpoint is far less likely to trigger DDG's anti-bot page than /html.
  const { text } = await fetchText(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}&kl=${m.ddg}`, {
    signal, timeout: 7000,
  });
  if (/anomaly|captcha/i.test(text) && !/result-link/.test(text)) throw new Error('DuckDuckGo yêu cầu captcha (tạm thời)');
  const $ = cheerio.load(text);
  const out = [];
  $('a.result-link').each((_, a) => {
    const $a = $(a);
    const url = decodeDdg($a.attr('href'));
    if (!url) return;
    const row = $a.closest('tr');
    const snippet = clean(row.nextAll('tr').first().find('td.result-snippet').text());
    out.push({ title: clean($a.text()), url, snippet });
  });
  return out;
}

export const DDG_LIMIT = { concurrency: 1, gap: 1300 };

export default {
  id: 'ddg',
  name: 'DuckDuckGo',
  kind: 'web',
  group: 'Search engine',
  markets: '*',
  limit: DDG_LIMIT,
  async search({ q, market, signal }) {
    return ddgWeb(q, market, signal);
  },
};
