// Generic HTML extractors: schema.org JSON-LD, OpenGraph, product cards on listing pages,
// and labelled sections (ingredients, storage, usage, age...) on product pages.
import * as cheerio from 'cheerio';
import { clean, fold, parsePrice, truncate } from './normalize.js';

const abs = (u, base) => {
  if (!u) return null;
  u = String(u).trim();
  if (u.startsWith('data:')) return null;
  try {
    return new URL(u.startsWith('//') ? 'https:' + u : u, base).href;
  } catch {
    return null;
  }
};

// ---------- JSON-LD ----------

export function jsonLdObjects($) {
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    out.push(o);
    if (o['@graph']) walk(o['@graph']);
    if (o.itemListElement) walk(o.itemListElement);
    if (o.item && typeof o.item === 'object') walk(o.item);
    if (o.mainEntity) walk(o.mainEntity);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      walk(JSON.parse(raw));
    } catch {
      // Some sites put several objects or trailing commas in one tag; try a lenient parse.
      try {
        walk(JSON.parse(raw.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001f]+/g, ' ')));
      } catch { /* ignore */ }
    }
  });
  return out;
}

const isType = (o, t) => [].concat(o['@type'] || []).some((x) => String(x).toLowerCase() === t.toLowerCase());
const firstImage = (img) => {
  if (!img) return null;
  if (Array.isArray(img)) return firstImage(img[0]);
  if (typeof img === 'object') return img.url || img.contentUrl || null;
  return img;
};

export function productFromLd(o, base) {
  const offers = [].concat(o.offers || []).flatMap((x) => (x?.offers ? [].concat(x.offers) : [x])).filter(Boolean);
  const offer = offers.find((x) => x.price || x.lowPrice) || offers[0] || {};
  const priceRaw = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price;
  const currency = offer.priceCurrency || offer.priceSpecification?.priceCurrency || null;
  const rating = o.aggregateRating || {};
  return {
    title: clean(o.name),
    url: abs(o.url || o['@id'] || offer.url, base),
    image: abs(firstImage(o.image), base),
    brand: clean(typeof o.brand === 'object' ? o.brand?.name : o.brand) || null,
    description: clean(o.description) || null,
    price: priceRaw != null && priceRaw !== '' ? Number(String(priceRaw).replace(/[^\d.]/g, '')) || null : null,
    currency: currency ? String(currency).toUpperCase() : null,
    availability: offer.availability ? String(offer.availability).split('/').pop() : null,
    rating: rating.ratingValue ? Number(rating.ratingValue) : null,
    reviews: rating.reviewCount || rating.ratingCount ? Number(rating.reviewCount || rating.ratingCount) : null,
    gtin: o.gtin13 || o.gtin || o.gtin8 || o.gtin12 || null,
    sku: o.sku || null,
    origin: clean(o.countryOfOrigin?.name || o.countryOfOrigin) || null,
  };
}

export function productsFromJsonLd($, base) {
  return jsonLdObjects($).filter((o) => isType(o, 'Product') && o.name).map((o) => productFromLd(o, base));
}

// ---------- Embedded JSON state (Next.js, Redux __INITIAL_STATE__, Apollo…) ----------

// Index just past the bracket that closes s[0] ('{' or '['), skipping over string contents.
function matchBracket(s) {
  let depth = 0;
  let inStr = false;
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === quote) inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// Decode a JS string literal starting at s[0] (the quote), e.g. the argument of JSON.parse('...').
function readJsString(s) {
  const q = s[0];
  if (q !== "'" && q !== '"') return null;
  let out = '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === q) return out;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n === 'u') {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16));
      i += 4;
    } else if (n === 'x') {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[n] ?? n;
  }
  return null;
}

export function jsonBlobs($) {
  const blobs = [];
  const tryParse = (s) => {
    try {
      blobs.push(JSON.parse(s));
    } catch { /* not JSON */ }
  };
  $('script').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase();
    const s = $(el).contents().text().trim();
    if (s.length < 200 || type.includes('ld+json')) return;
    if (type && !/javascript|module/.test(type)) return tryParse(s); // application/json, *+json, custom data types
    const re = /(?:window\.|self\.|var\s+|let\s+|const\s+)(__[A-Z0-9_]+__|[A-Za-z_$][\w$]*(?:State|STATE|Data|DATA))\s*=\s*/g;
    let m;
    while ((m = re.exec(s))) {
      const rest = s.slice(m.index + m[0].length);
      if (rest.startsWith('JSON.parse(')) {
        const lit = readJsString(rest.slice(11));
        if (lit) tryParse(lit);
      } else if (rest[0] === '{' || rest[0] === '[') {
        const end = matchBracket(rest);
        if (end > 0) tryParse(rest.slice(0, end));
      }
    }
  });
  return blobs;
}

const NAME_KEYS = ['name', 'title', 'productName', 'product_name', 'displayName', 'itemName', 'productTitle'];
const SKIP_PRICE_KEY = /unit|per|cup|qualifier|was|original|regular|^reg|list|before|old|strike|compare|min|max|deposit|tax|ship|deliver|threshold|count|quantity|percent|saving|discount|loyalty|points|id$/i;
const PRICE_KEY = /price|retail|amount|value|current|actual|final|sale|offer|now/i;
const PRICE_PARENT = /price|retail|offer|cost|amount/i;
const PAGE_URL = /^(https?:\/\/|\/)(?![^?#]*\.(?:jpe?g|png|webp|gif|svg|avif)(?:[?#]|$))\S{3,}$/i;
const MONEY = /[₫$£€¥￥₩฿₱]|\b(?:USD|GBP|EUR|JPY|AUD|SGD|VND|THB|MYR|KRW)\b/;

function findPrice(o, depth = 0, parentPrice = false) {
  if (!o || typeof o !== 'object' || depth > 3) return null;
  for (const [k, v] of Object.entries(o)) {
    if (SKIP_PRICE_KEY.test(k) || !PRICE_KEY.test(k)) continue;
    const priceish = /price|retail|offer/i.test(k) || parentPrice;
    if (typeof v === 'number' && v > 0 && priceish) return { value: v, currency: o.currency || o.currencyCode || null };
    if (typeof v === 'string' && v.length < 30 && (MONEY.test(v) || (priceish && /^\d+(?:[.,]\d+)?$/.test(v)))) {
      const p = parsePrice(v, 'us', o.currency || o.currencyCode);
      if (p) return p;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const r = findPrice(v, depth + 1, parentPrice || PRICE_PARENT.test(k));
      if (r) return { ...r, currency: r.currency || v.currencyCode || v.currency || null };
    }
  }
  return null;
}

function findString(o, keyRe, valRe, depth = 0, skipRe = null) {
  if (!o || typeof o !== 'object' || depth > 3) return null;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && keyRe.test(k) && valRe.test(v)) return v;
  }
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && keyRe.test(k) && !(skipRe && skipRe.test(k))) {
      const r = Array.isArray(v) ? findString(v[0], /.*/, valRe, depth + 1) : findString(v, /.*/, valRe, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

// Walk embedded state and keep objects that look like a product: a name plus a price.
export function extractEmbeddedProducts($, base) {
  const out = [];
  const seen = new Set();
  const stack = jsonBlobs($).map((b) => [b, 0]);
  let visited = 0;
  while (stack.length && visited++ < 200000) {
    const [o, d] = stack.pop();
    if (!o || typeof o !== 'object' || d > 40) continue;
    if (Array.isArray(o)) {
      for (const v of o) if (v && typeof v === 'object') stack.push([v, d + 1]);
      continue;
    }
    const nameKey = NAME_KEYS.find((k) => typeof o[k] === 'string' && o[k].length >= 5 && o[k].length <= 300 && !/^https?:|^\//.test(o[k]));
    if (nameKey) {
      const price = findPrice(o);
      if (price) {
        const image = findString(o, /image|thumb|img|media|picture|photo/i, /^(https?:)?\/\/|\.(jpe?g|png|webp)/i);
        const url = findString(o, /url|href|link|path|self|canonical/i, PAGE_URL, 0, /image|media|thumb|img|picture|photo|asset/i);
        const title = clean(o[nameKey]);
        const key = `${title}|${price.value}`;
        if ((image || url) && !seen.has(key)) {
          seen.add(key);
          const brand = typeof o.brand === 'string' ? o.brand : o.brand?.name || o.brandName || null;
          out.push({
            title: [title, typeof o.size === 'string' && !title.includes(o.size) ? o.size : ''].filter(Boolean).join(' '),
            url: abs(url, base),
            image: abs(image, base),
            brand: brand ? clean(brand) : null,
            price: price.value,
            currency: price.currency,
            raw: o,
          });
        }
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push([v, d + 1]);
  }
  return out;
}

// ---------- Listing pages (search results of a shop) ----------

const PRICE_TEXT = /^\s*(?:(?:từ|from|giá)\s*:?\s*)?(?:[₫$£€¥￥₩฿₱]|US\$|S\$|A\$|RM|Rp)?\s*\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\s*(?:₫|đ|VNĐ|VND|円|원|บาท|€)?\s*$/i;
const HAS_CURRENCY = /[₫$£€¥￥₩฿₱]|đ|VNĐ|VND|円|원|บาท|RM|Rp/i;

const imgSrc = ($img, base) => {
  const s = $img.attr('data-src') || $img.attr('data-original') || $img.attr('data-lazy-src') || $img.attr('data-srcset')?.split(/[ ,]/)[0]
    || $img.attr('src') || $img.attr('srcset')?.split(/[ ,]/)[0];
  return abs(s, base);
};

function cardFrom($, el, base) {
  const $el = $(el);
  const links = $el.find('a[href]').map((_, a) => $(a).attr('href')).get().filter((h) => h && !h.startsWith('javascript') && h !== '#');
  const distinct = [...new Set(links.map((h) => abs(h, base)).filter(Boolean))];
  if (!distinct.length) return null;
  const $img = $el.find('img').first();
  const priceEls = $el.find('*').filter((_, n) => {
    const t = $(n).children().length ? '' : $(n).text();
    return t && PRICE_TEXT.test(t) && HAS_CURRENCY.test(t);
  });
  const prices = priceEls.map((_, n) => clean($(n).text())).get();
  if (!prices.length) return null;
  const title = clean(
    $el.find('[title]').filter((_, n) => clean($(n).attr('title')).length > 8).first().attr('title')
    || $el.find('h2,h3,h4,[class*="name"],[class*="title"]').first().text()
    || $img.attr('alt')
    || $el.find('a').map((_, a) => clean($(a).text())).get().sort((a, b) => b.length - a.length)[0],
  );
  if (title.length < 6) return null;
  return { title, url: distinct[0], image: $img.length ? imgSrc($img, base) : null, prices };
}

export function extractListing(html, base, { min = 3 } = {}) {
  const $ = cheerio.load(html);
  const fromLd = productsFromJsonLd($, base).filter((p) => p.url);
  if (fromLd.length >= min) return fromLd;
  const embedded = extractEmbeddedProducts($, base).map(({ raw, ...p }) => p);
  if (embedded.length >= min) return embedded;

  // Heuristic: from each price leaf, climb to the smallest ancestor that is a self-contained card
  // (has an image and links to exactly one product).
  const seen = new Set();
  const cards = [];
  $('body *').each((_, n) => {
    const $n = $(n);
    if ($n.children().length) return;
    const t = $n.text();
    if (!t || t.length > 40 || !PRICE_TEXT.test(t) || !HAS_CURRENCY.test(t)) return;
    let cur = $n.parent();
    for (let depth = 0; depth < 8 && cur.length && cur[0].tagName !== 'body'; depth++, cur = cur.parent()) {
      const imgs = cur.find('img').length;
      if (!imgs) continue;
      const hrefs = new Set(cur.find('a[href]').map((_, a) => abs($(a).attr('href'), base)).get().filter(Boolean));
      if (hrefs.size > 3 || imgs > 4) break;
      const card = cardFrom($, cur[0], base);
      if (card) {
        if (!seen.has(card.url)) {
          seen.add(card.url);
          cards.push(card);
        }
        break;
      }
    }
  });
  const heur = cards.map((c) => {
    const parsed = c.prices.map((p) => parsePrice(p)).filter(Boolean);
    const sorted = [...parsed].sort((a, b) => a.value - b.value);
    return {
      title: c.title,
      url: c.url,
      image: c.image,
      price: sorted[0]?.value ?? null,
      currency: sorted[0]?.currency ?? null,
      originalPrice: sorted.length > 1 && sorted.at(-1).value > sorted[0].value ? sorted.at(-1).value : null,
    };
  });
  return fromLd.length > heur.length ? fromLd : heur;
}

// ---------- Product detail pages ----------

const L = (s) => s; // marker for readability
const SECTION_LABELS = {
  ingredients: [L('thành phần(?: dinh dưỡng| chính| nguyên liệu| sản phẩm)?'), 'nguyên liệu', 'ingredients?', 'zutaten', 'ingrédients', '原材料名?', '원재료명?', 'composition'],
  usage: ['hướng dẫn sử dụng', 'cách sử dụng', 'cách dùng', 'hướng dẫn pha(?: chế)?', 'cách pha', 'directions(?: for use)?', 'how to (?:use|prepare|serve)', 'preparation(?: instructions)?', 'feeding guide', 'zubereitung', "mode d'emploi", 'préparation', '使用方法', '召し上がり方', '조리방법'],
  storage: ['hướng dẫn bảo quản', 'cách bảo quản', 'bảo quản', 'storage(?: instructions| advice)?', 'store (?:in|at)', 'keep (?:in|refrigerated)', 'once opened', 'aufbewahrung', 'conservation', '保存方法', '보관방법'],
  age: ['độ tuổi(?: sử dụng| phù hợp)?', 'đối tượng(?: sử dụng)?', 'dành cho (?:bé|trẻ)', 'suitable (?:for|from)', 'recommended age', 'phù hợp với'],
  origin: ['xuất xứ(?: thương hiệu)?', 'nơi sản xuất', 'sản xuất tại', 'made in', 'country of origin', 'herkunftsland', '原産国', '원산지'],
  expiry: ['hạn sử dụng', 'hsd', 'shelf life', 'best before', 'mindestens haltbar', '賞味期限', '유통기한'],
  weight: ['khối lượng(?: tịnh)?', 'trọng lượng(?: tịnh)?', 'quy cách(?: đóng gói)?', 'dung tích', 'net (?:weight|wt\\.?)', 'nettogewicht', 'poids net', '内容量', '중량'],
  nutrition: ['giá trị dinh dưỡng', 'thông tin dinh dưỡng', 'bảng dinh dưỡng', 'nutrition(?:al)? (?:information|facts|values)', 'nährwerte', '栄養成分'],
  warnings: ['lưu ý', 'chú ý', 'cảnh báo', 'warnings?', 'allergy (?:advice|information)', 'thông tin dị ứng', 'allergens?'],
};
const MAX_LEN = { ingredients: 500, usage: 400, storage: 260, age: 120, origin: 80, expiry: 100, weight: 80, nutrition: 400, warnings: 300 };

const ALL_LABELS = Object.entries(SECTION_LABELS).flatMap(([k, arr]) => arr.map((l) => [k, l]));
const LABEL_RE = new RegExp(
  `(^|\\n|[.!;•▪●·-]\\s*)(${ALL_LABELS.map(([, l]) => l).join('|')})(?:\\s*(?:sản phẩm|của sản phẩm))?\\s*([:：]|\\n)`,
  'giu',
);
const labelKind = (label) => {
  const lower = label.toLowerCase();
  for (const [k, l] of ALL_LABELS) if (new RegExp(`^(?:${l})$`, 'iu').test(lower)) return k;
  return null;
};

export function pageText($) {
  $('script,style,noscript,svg,iframe,template,link,meta').remove();
  $('br').replaceWith('\n');
  $('p,div,li,tr,h1,h2,h3,h4,h5,h6,section,article,dd,dt,table,ul,ol,td,th,span[class*="title"],strong,b').each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  return ($('main').text() || $('body').text())
    .replace(/[ \t ​]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// Heading-style sections, e.g. "Các thành phần chính có trong bột HiPP" followed by the content lines.
const HEADING_KW = {
  ingredients: /thành phần|nguyên liệu|ingredients|zutaten|ingrédients|原材料|원재료/i,
  age: /độ tuổi|dành cho (?:bé|trẻ)|phù hợp (?:cho|với) (?:bé|trẻ)|suitable (?:for|from)|recommended age/i,
  usage: /hướng dẫn (?:sử dụng|pha|chế biến|cho bé ăn)|cách (?:pha|dùng|sử dụng|chế biến)|how to (?:use|prepare|serve)|directions|preparation|zubereitung/i,
  storage: /bảo quản|storage|aufbewahrung|conservation|保存/i,
  origin: /xuất xứ|sản xuất tại|made in|country of origin/i,
  nutrition: /giá trị dinh dưỡng|thông tin dinh dưỡng|nutrition(?:al)? (?:information|facts)|nährwerte/i,
};
// Shop boilerplate that often follows the real content.
const cutTail = (s) => s.split(/\s*(?:>>>|>>|Xem thêm|Xem chi tiết|Xem tất cả|Đọc thêm|Read more|Mua ngay|Giá sản phẩm trên Tiki|Giá sản phẩm đã bao gồm|Bên cạnh đó, tuỳ vào loại sản phẩm|Sản phẩm được phân phối bởi)\b/i)[0];

// HTML fragment -> text that keeps block boundaries as newlines.
export function textFromHtml(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|ul|ol|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim();
}

// Descriptions stored as plain text with the markup stripped glue headings to content
// ("…cho béHướng dẫn sử dụngChế biến…"); split where a lowercase letter runs into a capitalised word.
export const unglue = (s) => String(s ?? '').replace(/(\p{Ll}|[0-9%)])(\p{Lu}\p{Ll})/gu, '$1\n$2');

export const sectionsFromText = (raw) => extractSections(unglue(textFromHtml(raw)));

function headingSections(text, found) {
  const lines = text.split('\n');
  const isHeading = (l) => l.length >= 6 && l.length <= 100 && !/[.;]$/.test(l);
  const kindOf = (l) => Object.keys(HEADING_KW).find((k) => HEADING_KW[k].test(l));
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (!isHeading(line)) continue;
    const kind = kindOf(line);
    if (!kind || found[kind]) continue;
    let body = '';
    for (let j = i + 1; j < lines.length && body.length < MAX_LEN[kind] * 1.5; j++) {
      const l = lines[j];
      if (isHeading(l) && kindOf(l) && body.length > 20) break;
      body += (body ? ' ' : '') + l;
    }
    body = clean(cutTail(body));
    if (body.length >= 15) found[kind] = truncate(body, MAX_LEN[kind]);
  }
}

export function extractSections(text) {
  const found = {};
  const hits = [];
  LABEL_RE.lastIndex = 0;
  let m;
  while ((m = LABEL_RE.exec(text))) {
    const kind = labelKind(m[2]);
    if (kind) hits.push({ kind, start: m.index + m[1].length, end: m.index + m[0].length });
  }
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (found[h.kind]) continue;
    const stop = hits[i + 1]?.start ?? text.length;
    let body = text.slice(h.end, Math.min(stop, h.end + MAX_LEN[h.kind] * 2));
    // Stop at a heading-like short line after the first sentence block.
    body = body.split('\n').reduce((acc, line, idx) => {
      if (acc.done) return acc;
      if (idx > 0 && acc.text.length > 40 && line.length < 30 && !/[,;]$/.test(acc.text)) acc.done = true;
      else acc.text += (acc.text ? ' ' : '') + line;
      return acc;
    }, { text: '', done: false }).text;
    body = clean(cutTail(body)).replace(/^[:：\-–\s]+/, '');
    if (body.length < 4 || /^(xem thêm|chi tiết|đang cập nhật|tham khảo mô tả|xem trên|updating)/i.test(body)) continue;
    found[h.kind] = truncate(body, MAX_LEN[h.kind]);
  }
  headingSections(text, found);
  // Labels like "suitable for" also introduce unrelated text; an age section must actually state an age.
  if (found.age && !/\d/.test(found.age) && !/sơ sinh|newborn|infant/i.test(found.age)) delete found.age;
  if (found.age && !/tháng|tuổi|month|year|mois|monat|jahr|ヶ月|か月|歳|개월|살|\d\s*m\b|\+/i.test(found.age)) delete found.age;
  return found;
}

// ---------- Importer / distributor (Vietnamese labels) ----------

const IMPORTER_RE = /(?:nhà nhập khẩu|đơn vị nhập khẩu|thương nhân nhập khẩu|nhập khẩu\s*(?:và|&)\s*phân phối(?:\s*bởi)?|nhập khẩu bởi|nk\s*(?:&|và)\s*pp|nhà phân phối(?:\s*độc quyền)?|phân phối(?:\s*độc quyền)?\s*bởi|đơn vị phân phối|chịu trách nhiệm (?:về )?(?:chất lượng )?(?:hàng hóa|sản phẩm))(?:[^\n:：]{0,45}[:：]|\s*bởi)?\s*[\-–]?\s*((?:công ty|cty|c\.ty|ctcp|tnhh)[^\n;•]{4,110})/iu;

// "Công ty TNHH ABC - Địa chỉ: …" -> "Công ty TNHH ABC"
export function findImporter(text) {
  const m = String(text || '').match(IMPORTER_RE);
  if (!m) return null;
  const name = clean(m[1].split(/\s*(?:[-–(,|]|\.\s|địa chỉ|đ\/c|đc:|mst|mã số|số đt|điện thoại|hotline|website|tel|sđt|trụ sở)/i)[0]).replace(/[.\s]+$/, '');
  return name.length >= 8 && name.length <= 100 ? name : null;
}

// ---------- Structured sections: embedded JSON and FAQ answers ----------

// Map a JSON key or a section title ("storageInstruction", "Zutaten", "ingredients") to a section kind.
function jsonLabelKind(label) {
  const k = fold(label).replace(/[^a-z0-9぀-ヿ一-鿿]/g, '');
  if (!k || k.length > 40 || /(note|notes|title|label|header|heading|link|url|icon|count|flag|bold|id|type|placeholder|button)$/.test(k)) return null;
  if (k.startsWith('ingredients') || /^(ingredient|ingredienttext|ingredientstatement|ingredientlist|zutaten|zutatenliste|thanhphan|thanhphanchinh|原材料名?)$/.test(k)) return 'ingredients';
  if (k.startsWith('storage') || /^(aufbewahrung|aufbewahrungshinweise|conservation|conservationconditions|baoquan|huongdanbaoquan|保存方法)$/.test(k)) return 'storage';
  if (/^(preparation|preparationinstructions?|preparationandusage|directions?|directionsforuse|usage|usageinstructions?|howtouse|instructionsforuse|cookingguidelines|cookinginstructions|zubereitung|verwendungshinweise|huongdansudung|cachdung|cachsudung)$/.test(k)) return 'usage';
  if (/^(allerg(y|en|ens)(advice|statement|information|info)?|allergene|allergenmaybepresent|allergystatement)$/.test(k)) return 'warnings';
  if (/^(countryoforigin|herkunftsland|xuatxu)$/.test(k)) return 'origin';
  return null;
}

const SKIP_STRING_KEYS = /^(type|id|url|href|link|icon|class|className|style|image|src|alt|key|code)$/i;
export function flattenStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => flattenStrings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!SKIP_STRING_KEYS.test(k)) flattenStrings(x, out);
  return out;
}

// i18n dictionaries are full of "Ingredients" labels that aren't product data.
const UI_PATH = /(^|\.)(locale|strings|i18n|translations?|messages|dictionary|labels|copy|seo|navigation|menu|footer)(\.|$)/i;

export function sectionsFromJson($) {
  const found = {};
  const put = (kind, raw) => {
    if (!kind || found[kind]) return;
    const v = clean(cutTail(textFromHtml(Array.isArray(raw) ? flattenStrings(raw).join(', ') : raw)));
    if (v.length < 8 || /\{\w+\}/.test(v) || /^(true|false|null|n\/a|none|tham khảo mô tả)$/i.test(v)) return;
    found[kind] = truncate(v, MAX_LEN[kind]);
  };
  const stack = jsonBlobs($).map((b) => [b, '', 0]);
  let visited = 0;
  while (stack.length && visited++ < 300000) {
    const [o, path, d] = stack.pop();
    if (!o || typeof o !== 'object' || d > 40 || UI_PATH.test(path)) continue;
    if (Array.isArray(o)) {
      for (const v of o) if (v && typeof v === 'object') stack.push([v, path, d + 1]);
      continue;
    }
    // { title: "storage", content: "Once opened, refrigerate…" } style pairs
    const label = [o.title, o.name, o.label, o.header, o.heading, o.key].find((x) => typeof x === 'string');
    const body = o.content ?? o.value ?? o.text ?? o.body ?? o.contentBlock ?? o.description;
    if (label && body != null) put(jsonLabelKind(label), typeof body === 'object' ? flattenStrings(body).join(' ') : body);
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' || (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string'))) put(jsonLabelKind(k), v);
      else if (v && typeof v === 'object') stack.push([v, `${path}.${k}`, d + 1]);
    }
  }
  return found;
}

// Store FAQ (schema.org FAQPage) answers often state ingredients/usage when the description doesn't.
export function sectionsFromFaq($) {
  const found = {};
  const questions = jsonLdObjects($).filter((o) => isType(o, 'Question') && o.acceptedAnswer);
  for (const q of questions) {
    const raw = textFromHtml([].concat(q.acceptedAnswer).map((a) => a.text || '').join('\n'));
    const answer = raw
      .replace(/^(dạ[,\s]*)?(chào\s+(ba mẹ|bố mẹ|ba|bố|mẹ|anh chị|anh|chị|bạn)(\s+(ơi|ạ))?[,.!\s]*)?(dạ[,\s]*)?/i, '')
      .replace(/\s*(con cưng|shop|kids ?plaza)?\s*(xin\s+)?(cảm|cám) ơn[^.]*\.?\s*$/i, '');
    if (!found.ingredients) {
      const m = answer.match(/thành phần(?:\s+(?:gồm|từ|chính|bao gồm|như sau|có))*\s*(?:là|:)?\s*([\s\S]{15,})/i);
      if (m) found.ingredients = truncate(clean(m[1]), MAX_LEN.ingredients);
    }
    if (!found.storage) {
      const m = answer.match(/((?:bảo quản|đậy kín|sau khi (?:mở|pha))[\s\S]{10,})/i);
      if (m && !/không (?:chứa |có )?(?:chất )?bảo quản/i.test(m[1].slice(0, 30))) found.storage = truncate(clean(m[1]), MAX_LEN.storage);
    }
    for (const [k, v] of Object.entries(extractSections(unglue(answer)))) if (!found[k] && k !== 'warnings') found[k] = v;
  }
  return found;
}

export function extractDetail(html, url) {
  const $ = cheerio.load(html);
  const meta = (sel) => clean($(sel).attr('content')) || null;
  const ld = jsonLdObjects($).find((o) => isType(o, 'Product') && o.name);
  const p = ld ? productFromLd(ld, url) : {};

  let price = p.price ?? null;
  let currency = p.currency ?? null;
  const metaPrice = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]') || meta('meta[itemprop="price"]');
  if (price == null && metaPrice) {
    price = Number(metaPrice.replace(/[^\d.]/g, '')) || null;
    currency = meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]') || meta('meta[itemprop="priceCurrency"]') || currency;
  }
  if (price == null) {
    const $p = $('[itemprop="price"]').first();
    const raw = $p.attr('content') || $p.text();
    const parsed = raw ? parsePrice(raw) : null;
    if (parsed) ({ value: price, currency } = { value: parsed.value, currency: parsed.currency || currency });
  }
  if (price == null) {
    // Last resort: the first visible element with "price" in its class that isn't an old/compare price.
    $('[class*="price" i]').each((_, el) => {
      if (price != null) return;
      const cls = ($(el).attr('class') || '').toLowerCase();
      if (/old|original|regular|compare|was|before|line-through|del|strike|list/.test(cls)) return;
      const t = clean($(el).text());
      if (t.length > 40 || !HAS_CURRENCY.test(t)) return;
      const parsed = parsePrice(t);
      if (parsed) {
        price = parsed.value;
        currency = parsed.currency;
      }
    });
  }

  const title = p.title || meta('meta[property="og:title"]') || clean($('h1').first().text()) || clean($('title').text());
  const image = p.image || abs(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'), url);
  const description = p.description || meta('meta[property="og:description"]') || meta('meta[name="description"]');
  // Structured data first (pageText() strips the <script> tags they live in). Precedence: JSON > page text > FAQ.
  const fromJson = sectionsFromJson($);
  const fromFaq = sectionsFromFaq($);
  const text = pageText($);
  const sections = { ...fromFaq, ...extractSections(text), ...fromJson };
  if (!sections.origin && p.origin) sections.origin = p.origin;

  return {
    title: title || null,
    image: image || null,
    brand: p.brand || meta('meta[property="product:brand"]') || null,
    description: description ? truncate(description, 600) : null,
    price,
    currency: currency ? String(currency).toUpperCase() : null,
    availability: p.availability || null,
    rating: p.rating ?? null,
    reviews: p.reviews ?? null,
    gtin: p.gtin || null,
    sections,
    importer: findImporter(text),
    textSample: truncate(text, 1500),
  };
}
