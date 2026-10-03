// Foreign retailers that can be read without an API key: public JSON endpoints or server-rendered pages.
import * as cheerio from 'cheerio';
import { fetchJSON, fetchText, request, HttpError } from '../lib/http.js';
import { extractEmbeddedProducts } from '../lib/extract.js';
import { clean, fold } from '../lib/normalize.js';

const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const decodeEntities = (s) => clean(String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'"));
const group = 'Shop nước ngoài';

// ---------------- Amazon (DE, AU, JP usually open; US/UK/SG often show a captcha) ----------------

const AMAZON = {
  us: ['www.amazon.com', 'USD', 'en-US'], gb: ['www.amazon.co.uk', 'GBP', 'en-GB'], de: ['www.amazon.de', 'EUR', 'de-DE'],
  fr: ['www.amazon.fr', 'EUR', 'fr-FR'], jp: ['www.amazon.co.jp', 'JPY', 'ja-JP'], au: ['www.amazon.com.au', 'AUD', 'en-AU'],
  sg: ['www.amazon.sg', 'SGD', 'en-SG'],
};

export const amazon = {
  id: 'amazon',
  name: 'Amazon',
  kind: 'shop',
  group,
  markets: Object.keys(AMAZON),
  limit: { concurrency: 1, gap: 1200, perMarket: true, cooldown: 15 * 60e3 },
  async search({ q, market, signal }) {
    const [host, currency, lang] = AMAZON[market];
    const { text } = await fetchText(`https://${host}/s?k=${encodeURIComponent(q)}`, { signal, timeout: 10000, lang: `${lang},${lang.split('-')[0]};q=0.9`, proxy: 'fallback' });
    const $ = cheerio.load(text);
    const cards = $('[data-component-type="s-search-result"]');
    // A real results page is hundreds of KB; a tiny page without cards is a captcha/interstitial.
    if (!cards.length && (text.length < 40000 || /captcha|api-services-support|robot/i.test(text))) {
      throw new HttpError('Amazon yêu cầu captcha (tạm thời)', 429);
    }
    const out = [];
    cards.each((_, el) => {
      const $el = $(el);
      const asin = $el.attr('data-asin');
      const title = clean($el.find('h2').first().attr('aria-label') || $el.find('h2 span').first().text())
        .replace(/^(Sponsored Ad|Gesponserte Anzeige|Annonce sponsorisée|スポンサー広告)s*[-–]s*/i, '');
      if (!asin || !title) return;
      const price = clean($el.find('.a-price:not(.a-text-price) .a-offscreen').first().text());
      const old = clean($el.find('.a-price.a-text-price .a-offscreen').first().text());
      const ratingText = clean($el.find('.a-icon-alt').first().text());
      const rating = ratingText.match(/(\d+[.,]\d)/g)?.find((x) => Number(x.replace(',', '.')) <= 5);
      const reviews = clean($el.find('[aria-label*="rating"], a[href*="customerReviews"] span').first().text()).replace(/[^\d]/g, '');
      const bought = clean($el.find('span:contains("bought"), span:contains("gekauft"), span:contains("購入")').first().text()).match(/(\d+(?:[.,]\d+)?\s?[KkMm]?)\+/)?.[1];
      out.push({
        title,
        url: `https://${host}/dp/${asin}`,
        image: $el.find('img.s-image').attr('src') || null,
        price: price || null,
        originalPrice: old || null,
        currency,
        rating: rating ? Number(rating.replace(',', '.')) : null,
        reviews: reviews ? Number(reviews) : null,
        sold: bought || null,
        sponsored: /Sponsored|Gesponsert|スポンサー|Sponsorisé/.test($el.text()),
        seller: 'Amazon',
      });
    });
    return out;
  },
};

// ---------------- United States ----------------

export const target = {
  id: 'target',
  name: 'Target',
  kind: 'shop',
  group,
  markets: ['us'],
  limit: { concurrency: 1, gap: 600 },
  async search({ q, signal }) {
    const visitor = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const url = 'https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?key=9f36aeafbe60771e321a7cc95a78140772ab3e96'
      + `&channel=WEB&count=24&default_purchasability_filter=true&include_sponsored=true&keyword=${encodeURIComponent(q)}`
      + `&offset=0&page=${encodeURIComponent(`/s/${q}`)}&platform=desktop&pricing_store_id=3991&visitor_id=${visitor}`;
    const d = await fetchJSON(url, { signal, timeout: 8000, lang: 'en-US,en;q=0.9' });
    return (d.data?.search?.products || []).map((p) => {
      const it = p.item || {};
      const stats = p.ratings_and_reviews?.statistics?.rating;
      return {
        title: decodeEntities(it.product_description?.title),
        url: it.enrichment?.buy_url,
        image: it.enrichment?.image_info?.primary_image?.url,
        brand: it.primary_brand?.name,
        price: p.price?.current_retail ?? p.price?.formatted_current_price,
        originalPrice: p.price?.reg_retail > p.price?.current_retail ? p.price.reg_retail : null,
        currency: 'USD',
        rating: stats?.average || null,
        reviews: stats?.count || null,
        sponsored: !!p.is_sponsored_sku,
        seller: 'Target',
        gtin: it.primary_barcode || null,
      };
    }).filter((x) => x.title);
  },
};

// ---------------- United Kingdom ----------------

export const sainsburys = {
  id: 'sainsburys',
  name: "Sainsbury's",
  kind: 'shop',
  group,
  markets: ['gb'],
  limit: { concurrency: 1, gap: 500 },
  async search({ q, signal }) {
    const url = `https://www.sainsburys.co.uk/groceries-api/gol-services/product/v1/product?filter[keyword]=${encodeURIComponent(q)}&page_number=1&page_size=36&sort_order=FAVOURITES_FIRST`;
    const d = await fetchJSON(url, { signal, timeout: 9000, lang: 'en-GB,en;q=0.9' });
    return (d.products || []).map((p) => ({
      title: p.name,
      url: p.full_url ? `https${p.full_url.replace(/^https?/, '')}` : null,
      image: p.image || null,
      price: p.retail_price?.price ?? null,
      originalPrice: p.promotions?.[0]?.original_price ?? null,
      currency: 'GBP',
      rating: p.reviews?.average_rating || null,
      reviews: p.reviews?.total || null,
      gtin: p.eans?.[0] || null,
      seller: "Sainsbury's",
    }));
  },
};

function embeddedStore({ id, name, markets, currency, lang, searchUrl, link, image }) {
  return {
    id,
    name,
    kind: 'shop',
    group,
    markets,
    limit: { concurrency: 1, gap: 600 },
    async search({ q, signal }) {
      const { text, url } = await fetchText(searchUrl(encodeURIComponent(q)), { signal, timeout: 12000, lang, proxy: 'fallback' });
      const $ = cheerio.load(text);
      return extractEmbeddedProducts($, url).map((p) => ({
        title: p.title,
        url: link(p.raw, p) || p.url,
        image: image?.(p.raw) || p.image,
        brand: p.brand,
        price: p.price,
        currency: p.currency || currency,
        seller: name,
      }));
    },
  };
}

export const tesco = embeddedStore({
  id: 'tesco',
  name: 'Tesco',
  markets: ['gb'],
  currency: 'GBP',
  lang: 'en-GB,en;q=0.9',
  searchUrl: (q) => `https://www.tesco.com/groceries/en-GB/search?query=${q}`,
  link: (r) => (r.id || r.tpnc ? `https://www.tesco.com/groceries/en-GB/products/${r.id || r.tpnc}` : null),
  image: (r) => r.defaultImageUrl,
});

export const waitrose = embeddedStore({
  id: 'waitrose',
  name: 'Waitrose',
  markets: ['gb'],
  currency: 'GBP',
  lang: 'en-GB,en;q=0.9',
  searchUrl: (q) => `https://www.waitrose.com/ecom/shop/search?&searchTerm=${q}`,
  link: (r) => (r.id ? `https://www.waitrose.com/ecom/products/${slug(r.name)}/${r.id}` : null),
  image: (r) => r.thumbnail,
});

export const morrisons = embeddedStore({
  id: 'morrisons',
  name: 'Morrisons',
  markets: ['gb'],
  currency: 'GBP',
  lang: 'en-GB,en;q=0.9',
  searchUrl: (q) => `https://groceries.morrisons.com/search?q=${q}`,
  link: (r) => (r.retailerProductId ? `https://groceries.morrisons.com/products/${slug(r.name)}/${r.retailerProductId}` : null),
  image: (r) => r.image?.src,
});

// ---------------- Australia ----------------

let wowCookie = { v: '', exp: 0 };
export const woolworths = {
  id: 'woolworths',
  name: 'Woolworths',
  kind: 'shop',
  group,
  markets: ['au'],
  limit: { concurrency: 1, gap: 600 },
  async search({ q, signal }) {
    if (wowCookie.exp < Date.now()) {
      const home = await request('https://www.woolworths.com.au/', { signal, timeout: 8000, lang: 'en-AU,en;q=0.9' });
      await home.arrayBuffer();
      wowCookie = { v: home.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), exp: Date.now() + 20 * 60e3 };
    }
    const res = await request('https://www.woolworths.com.au/apis/ui/Search/products', {
      method: 'POST',
      signal,
      timeout: 9000,
      lang: 'en-AU,en;q=0.9',
      accept: 'application/json',
      headers: {
        'Content-Type': 'application/json',
        Cookie: wowCookie.v,
        Origin: 'https://www.woolworths.com.au',
        Referer: `https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(q)}`,
      },
      body: JSON.stringify({
        SearchTerm: q, PageSize: 36, PageNumber: 1, SortType: 'TraderRelevance',
        Location: `/shop/search/products?searchTerm=${encodeURIComponent(q)}`, Filters: [], IsSpecial: false,
        IsBundle: false, IsMobile: false, GpBoost: 0, GroupEdmVariants: true, EnableAdReRanking: false,
      }),
    });
    const d = await res.json();
    return (d.Products || []).flatMap((g) => g.Products || []).map((p) => ({
      title: p.DisplayName || p.Name,
      url: `https://www.woolworths.com.au/shop/productdetails/${p.Stockcode}/${p.UrlFriendlyName || ''}`,
      image: p.MediumImageFile || p.SmallImageFile || null,
      brand: p.Brand || null,
      price: p.Price ?? p.InstorePrice ?? null,
      originalPrice: p.WasPrice && p.WasPrice > p.Price ? p.WasPrice : null,
      currency: 'AUD',
      gtin: p.Barcode || null,
      snippet: p.CupString || null,
      seller: 'Woolworths',
    })).filter((x) => x.title);
  },
};

// ---------------- Germany ----------------

export const dm = {
  id: 'dm',
  name: 'dm-drogerie',
  kind: 'shop',
  group,
  markets: ['de'],
  limit: { concurrency: 1, gap: 500 },
  async search({ q, signal }) {
    const d = await fetchJSON(`https://product-search.services.dmtech.com/de/search?query=${encodeURIComponent(q)}&pageSize=36&currentPage=0`, {
      signal, timeout: 8000, lang: 'de-DE,de;q=0.9',
    });
    return (d.products || []).map((p) => {
      const t = p.tileData || {};
      return {
        title: [p.brandName, p.title].filter(Boolean).join(' '),
        url: t.self ? `https://www.dm.de${t.self}` : null,
        image: t.images?.[0]?.tileSrc || null,
        brand: p.brandName,
        price: t.price?.price?.current?.value || null,
        currency: 'EUR',
        gtin: p.gtin ? String(p.gtin) : null,
        snippet: [t.title?.subheadline, ...(t.price?.tileInfos || [])].filter(Boolean).join(' · '),
        rating: t.rating?.ratingValue || null,
        reviews: t.rating?.ratingCount || null,
        seller: 'dm',
      };
    });
  },
};

// ---------------- Singapore ----------------

export const fairprice = {
  id: 'fairprice',
  name: 'FairPrice',
  kind: 'shop',
  group,
  markets: ['sg'],
  limit: { concurrency: 1, gap: 500 },
  async search({ q, signal }) {
    const url = `https://website-api.omni.fairprice.com.sg/api/product/v2?category=&experiments=&includeTagDetails=true&orderType=DELIVERY&page=1&q=${encodeURIComponent(q)}&storeId=165&url=${encodeURIComponent(q)}`;
    const d = await fetchJSON(url, { signal, timeout: 9000, lang: 'en-SG,en;q=0.9' });
    return (d.data?.product || []).map((p) => {
      const sd = p.storeSpecificData?.[0] || {};
      const mrp = Number(sd.mrp) || null;
      const disc = Number(sd.discount) || 0;
      return {
        title: p.name,
        url: p.slug ? `https://www.fairprice.com.sg/product/${p.slug}` : null,
        image: p.images?.[0] || null,
        brand: p.brand?.name || null,
        price: p.final_price ?? (mrp ? mrp - disc : null),
        originalPrice: disc ? mrp : null,
        currency: 'SGD',
        gtin: p.barcodes?.[0] || null,
        seller: 'FairPrice',
        origin: p.metaData?.['Country of Origin'] || null,
      };
    });
  },
};
