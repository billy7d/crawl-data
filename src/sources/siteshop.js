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
  us: ['walmart.com', 'target.com', 'iherb.com', 'amazon.com', 'kroger.com', 'costco.com', 'thrivemarket.com', 'cvs.com', 'walgreens.com', 'wholefoodsmarket.com', 'instacart.com', 'samsclub.com'],
  gb: ['tesco.com', 'sainsburys.co.uk', 'asda.com', 'boots.com', 'ocado.com', 'waitrose.com', 'morrisons.com', 'superdrug.com', 'hollandandbarrett.com', 'amazon.co.uk', 'aldi.co.uk', 'iceland.co.uk'],
  au: ['coles.com.au', 'woolworths.com.au', 'chemistwarehouse.com.au', 'babybunting.com.au', 'aldi.com.au', 'priceline.com.au', 'iga.com.au', 'amazon.com.au', 'harrisfarm.com.au', 'mydeal.com.au'],
  de: ['dm.de', 'rossmann.de', 'mueller.de', 'rewe.de', 'edeka24.de', 'kaufland.de', 'babymarkt.de', 'windeln.de', 'shop-apotheke.com', 'docmorris.de', 'amazon.de', 'otto.de'],
  ca: ['walmart.ca', 'loblaws.ca', 'realcanadiansuperstore.ca', 'shoppersdrugmart.ca', 'well.ca', 'voila.ca', 'sobeys.com', 'metro.ca', 'amazon.ca', 'londondrugs.com'],
  it: ['esselunga.it', 'carrefour.it', 'conad.it', 'easycoop.com', 'amazon.it', 'farmaciauno.it', 'farmacosmo.it', 'efarma.com', 'prenatal.com', 'bimbostore.it', 'tigros.it'],
  es: ['tienda.mercadona.es', 'carrefour.es', 'elcorteingles.es', 'alcampo.es', 'dia.es', 'supermercado.eroski.es', 'amazon.es', 'mifarma.es', 'promofarma.com', 'atida.com', 'condisline.com'],
  nl: ['ah.nl', 'jumbo.com', 'plus.nl', 'kruidvat.nl', 'etos.nl', 'bol.com', 'prenatal.nl', 'dirk.nl', 'hoogvliet.com', 'amazon.nl'],
  fr: ['carrefour.fr', 'auchan.fr', 'monoprix.fr', 'e.leclerc', 'intermarche.com', 'franprix.fr', 'chronodrive.com', 'houra.fr', 'cdiscount.com', 'aubert.com', 'newpharma.fr', 'pharma-gdd.com', 'cocooncenter.com', 'amazon.fr'],
  jp: ['amazon.co.jp', 'lohaco.yahoo.co.jp', 'shopping.yahoo.co.jp', 'akachan.jp', 'matsukiyococokara-online.com', 'iyec.omni7.jp'],
  kr: ['coupang.com', 'gmarket.co.kr', '11st.co.kr', 'ssg.com', 'kurly.com'],
  cn: ['tmall.com', 'jd.com', 'taobao.com', 'suning.com'],
  sg: ['guardian.com.sg', 'watsons.com.sg', 'redmart.com', 'shopee.sg', 'amazon.sg'],
  th: ['bigc.co.th', 'lotuss.com', 'shopee.co.th', 'boots.co.th', 'tops.co.th'],
  my: ['shopee.com.my', 'watsons.com.my', 'guardian.com.my', 'mydin.my'],
  ph: ['shopee.ph', 'watsons.com.ph', 'southstar.ph', 'metromart.com.ph'],
  id: ['tokopedia.com', 'shopee.co.id', 'blibli.com', 'alfagift.id'],
};

const prettyHost = (h) => h.replace(/^(www|shop|shopping|groceries|tienda|supermercado|courses)\./, '');
const shopRow = (r) => ({ ...r, price: r.price || `${r.title} ${r.snippet}`.match(PRICE_IN_TEXT)?.[0] || null, seller: prettyHost(hostOf(r.url)) });
// 1 = save credits, 2 = balanced (default), 3 = deep.
export const searchDepth = () => Math.min(3, Math.max(1, Number(process.env.SEARCH_DEPTH) || 2));

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
    // With Serper the sites are searched in small groups: in one big OR query the largest retailer takes all
    // ten results (free plan: 10 per site: query). SEARCH_DEPTH sets the group size (more groups = more credits).
    if (process.env.SERPER_API_KEY) {
      const size = { 1: sites.length, 2: 4, 3: 2 }[searchDepth()] || 4;
      const groups = [];
      for (let i = 0; i < sites.length; i += size) groups.push(sites.slice(i, i + size));
      const answers = await Promise.allSettled(groups.map((g) => serperWeb(`${q} (${g.map((x) => `site:${x}`).join(' OR ')})`, market, signal)));
      if (answers.every((a) => a.status === 'rejected')) throw answers[0].reason;
      const seen = new Set();
      return answers.flatMap((a) => (a.status === 'fulfilled' ? a.value : []))
        .filter((r) => sites.some((x) => hostOf(r.url) === x || hostOf(r.url).endsWith('.' + x)) && !seen.has(r.url) && seen.add(r.url))
        .map(shopRow);
    }
    const query = `${q} (${sites.map((x) => `site:${x}`).join(' OR ')})`;
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
    return rows.map(shopRow);
  },
};
