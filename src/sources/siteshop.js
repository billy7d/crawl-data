// Retailers that block scrapers (Walmart, iHerb, Boots, Coles, Coupang, Shopee…) are still indexed by search
// engines. A site-restricted search returns their product pages with title, link and often the price
// in the snippet; enrichment then reads the page itself when the site allows it.
import { bingWeb, PRICE_IN_TEXT } from './bing.js';
import { ddgWeb, DDG_LIMIT } from './duckduckgo.js';
import { hostOf } from '../lib/markets.js';
import { throttled } from '../lib/limiter.js';
import { serperWeb } from './serper.js';
import { searxngWeb, braveWeb } from './metasearch.js';

export const SITE_SHOPS = {
  vn: ['shopee.vn', 'bibomart.com.vn', 'avakids.com', 'bachhoaxanh.com', 'winmart.vn', 'nhathuoclongchau.com.vn', 'guardian.com.vn', 'hasaki.vn'],
  us: ['walmart.com', 'iherb.com', 'amazon.com', 'kroger.com', 'costco.com', 'thrivemarket.com', 'cvs.com', 'walgreens.com', 'wholefoodsmarket.com'],
  gb: ['tesco.com', 'boots.com', 'asda.com', 'ocado.com', 'superdrug.com', 'hollandandbarrett.com', 'amazon.co.uk', 'aldi.co.uk'],
  au: ['coles.com.au', 'woolworths.com.au', 'chemistwarehouse.com.au', 'babybunting.com.au', 'aldi.com.au', 'priceline.com.au', 'iga.com.au'],
  de: ['rossmann.de', 'mueller.de', 'amazon.de', 'rewe.de', 'babymarkt.de', 'edeka24.de', 'shop-apotheke.com'],
  ca: ['walmart.ca', 'loblaws.ca', 'shoppersdrugmart.ca', 'well.ca', 'amazon.ca', 'metro.ca'],
  it: ['esselunga.it', 'carrefour.it', 'amazon.it', 'conad.it', 'farmaciauno.it'],
  es: ['carrefour.es', 'mercadona.es', 'elcorteingles.es', 'amazon.es', 'dia.es'],
  nl: ['ah.nl', 'jumbo.com', 'kruidvat.nl', 'bol.com', 'etos.nl'],
  fr: ['carrefour.fr', 'auchan.fr', 'monoprix.fr', 'aubert.com', 'e.leclerc', 'amazon.fr'],
  jp: ['amazon.co.jp', 'lohaco.yahoo.co.jp', 'shopping.yahoo.co.jp', 'akachan.jp', 'matsukiyococokara-online.com', 'iyec.omni7.jp'],
  kr: ['coupang.com', 'gmarket.co.kr', '11st.co.kr', 'ssg.com', 'kurly.com'],
  cn: ['tmall.com', 'jd.com', 'taobao.com', 'suning.com'],
  sg: ['guardian.com.sg', 'watsons.com.sg', 'redmart.com', 'shopee.sg', 'amazon.sg'],
  th: ['bigc.co.th', 'lotuss.com', 'shopee.co.th', 'boots.co.th', 'tops.co.th'],
  my: ['shopee.com.my', 'watsons.com.my', 'guardian.com.my', 'mydin.my'],
  ph: ['shopee.ph', 'watsons.com.ph', 'southstar.ph', 'metromart.com.ph'],
  id: ['tokopedia.com', 'shopee.co.id', 'blibli.com', 'alfagift.id'],
};

const prettyHost = (h) => h.replace(/^(www|shop|shopping|groceries)\./, '');

export default {
  id: 'siteshop',
  name: 'Shop khác (qua search engine)',
  kind: 'shop',
  group: 'Shop nước ngoài',
  markets: Object.keys(SITE_SHOPS),
  limit: { concurrency: 3, gap: 0 },
  filterIrrelevant: true,
  dedupe: true,
  async search({ q, market, signal }) {
    const sites = SITE_SHOPS[market];
    const query = `${q} (${sites.map((s) => `site:${s}`).join(' OR ')})`;
    // Most robust provider first: keyed APIs / self-hosted SearXNG, then DuckDuckGo (honours site:/OR well),
    // then Bing. Each failure or empty answer falls through to the next one.
    // A keyed provider (Serper/Brave) that answers is trusted even when empty: falling through to the free
    // engines then only adds captcha errors and minutes of waiting for the same "nothing".
    const providers = [
      process.env.SERPER_API_KEY && [true, () => serperWeb(query, market, signal)],
      process.env.SEARXNG_URL && [false, () => searxngWeb(query, market, signal)],
      process.env.BRAVE_API_KEY && [true, () => throttled('brave', { concurrency: 1, gap: 1100 }, () => braveWeb(query, market, signal))],
      [false, () => throttled('ddg', DDG_LIMIT, () => ddgWeb(query, market, signal))],
      [false, () => throttled('bing', { concurrency: 2, gap: 700 }, () => bingWeb(query, market, signal))],
    ].filter(Boolean);
    let rows = [];
    let lastError = null;
    for (const [keyed, p] of providers) {
      try {
        rows = (await p()).filter((r) => sites.some((s) => hostOf(r.url) === s || hostOf(r.url).endsWith('.' + s)));
        lastError = null;
        if (rows.length || keyed) break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!rows.length && lastError) throw lastError;
    return rows.map((r) => ({ ...r, price: r.price || `${r.title} ${r.snippet}`.match(PRICE_IN_TEXT)?.[0] || null, seller: prettyHost(hostOf(r.url)) }));
  },
};
