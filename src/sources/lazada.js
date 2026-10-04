import { fetchJSON, fetchText, HttpError, proxyEnabled } from '../lib/http.js';
import { MARKETS } from '../lib/markets.js';
import { clean, truncate } from '../lib/normalize.js';
import { sectionsFromText, textFromHtml, findImporter, unglue } from '../lib/extract.js';
import { serperWeb } from './serper.js';
import { PRICE_IN_TEXT } from './bing.js';

const CURRENCY = { vn: 'VND', th: 'THB', sg: 'SGD', my: 'MYR', ph: 'PHP', id: 'IDR' };

// The product page embeds its data as JSON in a script: "desc" holds the seller's full description.
const jsonString = (text, key) => {
  const m = text.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return '';
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return '';
  }
};

export default {
  id: 'lazada',
  name: 'Lazada',
  kind: 'shop',
  group: 'Sàn TMĐT',
  markets: Object.keys(MARKETS).filter((k) => MARKETS[k].lazada),
  // 3 at a time: through the proxy (5 slots shared with Tiki) each search can take 10–35s.
  limit: { concurrency: 3, gap: 400 },
  // Product pages are heavier than the search API; read them slowly so Lazada doesn't start serving captchas.
  detailLimit: { concurrency: 1, gap: 1500 },
  async search({ q, market, signal }) {
    try {
      return await this.searchApi({ q, market, signal });
    } catch (e) {
      // Blocked and the proxy failed or timed out: Google's index of Lazada still shows which products are
      // listed (title, link, often the price), just without sold counts.
      if (!process.env.SERPER_API_KEY || signal?.aborted) throw e;
      const host = MARKETS[market].lazada;
      const rows = (await serperWeb(`${q} site:${host}`, market, signal)).filter((r) => /\/products\//.test(r.url || ''));
      if (!rows.length) throw e;
      return rows.map((r) => ({
        title: r.title.replace(/\s*[|-]\s*Lazada.*$/i, ''),
        url: r.url.split('?')[0],
        image: r.image,
        price: r.price || `${r.title} ${r.snippet}`.match(PRICE_IN_TEXT)?.[0] || null,
        currency: CURRENCY[market],
        rating: r.rating,
        reviews: r.reviews,
        extra: { viaSearch: true },
      }));
    }
  },
  async searchApi({ q, market, signal }) {
    const host = MARKETS[market].lazada;
    const url = `https://${host}/catalog/?ajax=true&page=1&q=${encodeURIComponent(q)}`;
    // Lazada blocks ScraperAPI's normal pool; its premium pool with Vietnamese IPs works best (costs more credits, used only on a block).
    const opts = { signal, timeout: 8000, headers: { Referer: `https://${host}/` }, proxy: 'fallback', proxyExtra: `&premium=true&country_code=${market}`, proxyTimeout: 35000, proxyLane: 'slow' };
    let d = await fetchJSON(url, opts);
    // Lazada's captcha comes back as JSON ({ rgv587_flag, url: …punish… }), not as an HTML page.
    const blocked = (x) => x.rgv587_flag || x.url?.includes('punish');
    if (blocked(d) && proxyEnabled()) d = await fetchJSON(url, { ...opts, proxy: 'always' });
    if (blocked(d)) throw new HttpError('Lazada yêu cầu xác minh captcha (tạm thời)', 429);
    const items = d.mods?.listItems || [];
    return items.map((p) => ({
      title: p.name,
      url: p.itemUrl ? new URL(p.itemUrl, `https://${host}`).href.split('?')[0] : null,
      image: p.image,
      price: p.price != null ? Number(p.price) : p.priceShow,
      currency: CURRENCY[market],
      originalPrice: p.originalPrice ? Number(p.originalPrice) : p.originalPriceShow || null,
      brand: p.brandName,
      seller: p.sellerName,
      rating: p.ratingScore ? Number(p.ratingScore) : null,
      reviews: p.review ? Number(p.review) : null,
      sold: p.itemSoldCntShow || null,
      sponsored: !!(p.isSponsored || p.adFlag),
      extra: { location: p.location || null, lazMall: (p.icons || []).some((i) => /lazMall/i.test(i.bizType || '')) },
    }));
  },
  async detail(item, { signal }) {
    const m = MARKETS[item.market] || MARKETS.vn;
    const { text } = await fetchText(item.url, { signal, timeout: 10000, lang: `${m.mkt},${m.lang};q=0.9`, proxy: 'fallback', proxyExtra: `&premium=true&country_code=${item.market || 'vn'}`, proxyTimeout: 40000, proxyLane: 'slow' });
    const desc = jsonString(text, 'desc');
    if (!desc) {
      if (/punish|captcha|_____tmd_____/i.test(text)) throw new HttpError('Lazada yêu cầu captcha (tạm thời)', 429);
      return {};
    }
    const highlights = jsonString(text, 'highlights');
    return {
      description: truncate(clean(textFromHtml(desc)), 600),
      sections: sectionsFromText(`${highlights}\n${desc}`),
      importer: findImporter(unglue(textFromHtml(desc))),
    };
  },
};
