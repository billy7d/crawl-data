// Foreign retailers that can be read without an API key: public JSON endpoints or server-rendered pages.
import * as cheerio from 'cheerio';
import { fetchJSON, fetchText, request, HttpError, proxyEnabled } from '../lib/http.js';
import { extractEmbeddedProducts, flattenStrings, textFromHtml } from '../lib/extract.js';
import { clean, fold, truncate } from '../lib/normalize.js';

const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const decodeEntities = (s) => clean(String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'"));
const group = 'Shop nước ngoài';

// HTML/plain value -> one tidy line for a section, or undefined when empty.
const sec = (v, n = 500) => {
  const t = clean(textFromHtml(Array.isArray(v) ? v.join(', ') : v));
  return t.length >= 4 ? truncate(t, n) : undefined;
};
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));

// ---------------- Amazon (DE, AU, JP usually open; US/UK/SG often show a captcha) ----------------

const AMAZON = {
  us: ['www.amazon.com', 'USD', 'en-US'], gb: ['www.amazon.co.uk', 'GBP', 'en-GB'], de: ['www.amazon.de', 'EUR', 'de-DE'],
  fr: ['www.amazon.fr', 'EUR', 'fr-FR'], jp: ['www.amazon.co.jp', 'JPY', 'ja-JP'], au: ['www.amazon.com.au', 'AUD', 'en-AU'],
  sg: ['www.amazon.sg', 'SGD', 'en-SG'], ca: ['www.amazon.ca', 'CAD', 'en-CA'], it: ['www.amazon.it', 'EUR', 'it-IT'],
  es: ['www.amazon.es', 'EUR', 'es-ES'], nl: ['www.amazon.nl', 'EUR', 'nl-NL'],
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
    const url = `https://${host}/s?k=${encodeURIComponent(q)}`;
    const opts = { signal, timeout: 10000, lang: `${lang},${lang.split('-')[0]};q=0.9`, proxy: 'fallback' };
    let { text, proxied } = await fetchText(url, opts);
    let $ = cheerio.load(text);
    let cards = $('[data-component-type="s-search-result"]');
    // Amazon's bot check is often a small 200 page without the word captcha: retry it through the proxy.
    if (!cards.length && !proxied && text.length < 40000 && proxyEnabled()) {
      ({ text } = await fetchText(url, { ...opts, proxy: 'always' }));
      $ = cheerio.load(text);
      cards = $('[data-component-type="s-search-result"]');
    }
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
        extra: { tcin: p.tcin },
      };
    }).filter((x) => x.title);
  },
  // Product details: marketing copy + bullets (age, form, claims); ingredients when Target lists them.
  detailNeeds: (item) => item.extra?.tcin,
  async detail(item, { signal }) {
    const tcin = item.extra?.tcin;
    if (!tcin) return null;
    const d = await fetchJSON('https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=9f36aeafbe60771e321a7cc95a78140772ab3e96'
      + `&tcin=${tcin}&pricing_store_id=3991&has_pricing_store_id=true&visitor_id=0190AB12CD34EF560000000000000000`, { signal, timeout: 8000 });
    const it = d.data?.product?.item || {};
    const pd = it.product_description || {};
    const bullets = (pd.bullet_descriptions || []).map((b) => clean(textFromHtml(b)));
    const bullet = (re) => bullets.find((b) => re.test(b))?.replace(/^[^:]+:\s*/, '');
    const nf = it.enrichment?.nutrition_facts || {};
    return {
      description: sec(pd.downstream_description, 600),
      gtin: it.primary_barcode || null,
      sections: compact({
        ingredients: sec(nf.ingredients || nf.value_prepared_list?.[0]?.ingredients),
        age: sec(bullet(/^Age Level/i)),
        warnings: sec(nf.warning || bullet(/^Allergens?/i)),
        usage: sec(bullet(/^State of Readiness|^Preparation/i)),
      }),
    };
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
async function woolworthsCookie(signal) {
  if (wowCookie.exp < Date.now()) {
    const home = await request('https://www.woolworths.com.au/', { signal, timeout: 8000, lang: 'en-AU,en;q=0.9' });
    await home.arrayBuffer();
    wowCookie = { v: home.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), exp: Date.now() + 20 * 60e3 };
  }
  return wowCookie.v;
}

export const woolworths = {
  id: 'woolworths',
  name: 'Woolworths',
  kind: 'shop',
  group,
  markets: ['au'],
  limit: { concurrency: 1, gap: 600 },
  // Product detail API: ingredients, storage instructions, allergen statements.
  detailNeeds: (item) => item.extra?.stockcode,
  async detail(item, { signal }) {
    const code = item.extra?.stockcode;
    if (!code) return null;
    const res = await request(`https://www.woolworths.com.au/apis/ui/product/detail/${code}?isMobile=false&useVariant=true`, {
      signal, timeout: 9000, lang: 'en-AU,en;q=0.9', accept: 'application/json',
      headers: { Cookie: await woolworthsCookie(signal), Referer: item.url },
    });
    const d = await res.json();
    const a = d.AdditionalAttributes || {};
    const allergens = [a.allergystatement, a.allergenmaybepresent && `May contain: ${a.allergenmaybepresent}`].filter(Boolean).join('. ');
    return {
      description: sec(d.Product?.RichDescription || a.description, 600),
      sections: compact({
        ingredients: sec(a.ingredients),
        storage: sec(a.storageinstructions),
        usage: sec(a.directions || a.usageinstructions || a.preparationinstructions),
        warnings: sec(allergens),
        age: sec(a.lifestageage || a.suitablefor),
        origin: typeof d.CountryOfOriginLabel === 'string' ? sec(d.CountryOfOriginLabel, 120) : undefined,
      }),
    };
  },
  async search({ q, signal }) {
    await woolworthsCookie(signal);
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
      extra: { stockcode: p.Stockcode },
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
        extra: { dan: p.dan },
      };
    });
  },
  // Detail by dm article number: grouped texts "Zutaten", "Aufbewahrungshinweise", "Zubereitung"…
  detailNeeds: (item) => item.extra?.dan,
  async detail(item, { signal }) {
    const dan = item.extra?.dan;
    if (!dan) return null;
    const d = await fetchJSON(`https://products.dm.de/product/products/detail/DE/dan/${dan}`, { signal, timeout: 8000, lang: 'de-DE,de;q=0.9' });
    const KIND = {
      Zutaten: 'ingredients', Aufbewahrungshinweise: 'storage', Zubereitung: 'usage', Verwendungshinweise: 'usage',
      Allergene: 'warnings', Warnhinweise: 'warnings', Produktbeschreibung: 'description',
    };
    const out = { sections: {} };
    for (const g of d.descriptionGroups || []) {
      const kind = KIND[g.header];
      if (!kind) continue;
      const text = sec(flattenStrings(g.contentBlock).join(' '), kind === 'description' ? 600 : 500);
      if (!text) continue;
      if (kind === 'description') out.description ||= text;
      else out.sections[kind] ||= text;
    }
    return out;
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
        // The search API already carries the label data — no detail request needed.
        description: sec(p.metaData?.['Key Information'], 600),
        sections: compact({
          ingredients: sec(p.metaData?.Ingredients),
          storage: sec(p.metaData?.['Storage Information']),
          usage: sec(p.metaData?.Preparation),
          origin: sec(p.metaData?.['Country of Origin'], 80),
        }),
        enriched: true,
      };
    });
  },
};
