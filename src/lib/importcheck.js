// "Has this foreign product been officially imported into Vietnam?"
// For each product found abroad: search Vietnamese channels by brand and by product name, match listings,
// read matched listings' pages for the importer/distributor, then classify:
//   nkcn      — sold by ≥2 big baby-store chains AND an importer/distributor name was found (user's rule)
//   partial   — sold in Vietnam but the evidence doesn't meet that bar (one chain, no importer, hand-carried…)
//   brand     — the brand is sold in Vietnam but this product wasn't found
//   absent    — neither the brand nor the product was found in Vietnam
import { byId, enabled } from '../sources/index.js';
import { runSearch } from './run.js';
import { makeItem, mergeDetail } from './item.js';
import { canEnrich, getDetail, gtinOf } from './enrich.js';
import { translate } from './translate.js';
import { clean, fold, guessBrand, parseQuantity } from './normalize.js';
import { hostOf } from './markets.js';
import { recordListings, productHistory, listingHistory, recordImporter, knownImporter } from './sales.js';
import { suggest } from './suggest.js';

// Vietnamese listing sources, in the order evidence is most trustworthy.
const VN_SOURCES = ['concung', 'kidsplaza', 'tiki', 'lazada', 'siteshop', 'gshop'];

// Big mother & baby chains (by own site, by marketplace store name, or by domain found through site: search).
const CHAINS = [
  ['Con Cưng', /con ?cưng|concung/i, 'concung'],
  ['Kids Plaza', /kids ?plaza|kidsplaza/i, 'kidsplaza'],
  ['Bibomart', /bibo ?mart|bibomart/i, 'bibomart.com.vn'],
  ['AVAKids', /avakids|ava ?kids/i, 'avakids.com'],
];
export const MIN_CHAINS = 2;

const HAND_CARRIED = /xách tay|xach tay|nội địa (?:nhật|đức|mỹ|úc|hàn|trung)|hàng air|\bair\b|có bill|order|pre-?order|hàng mỹ|hàng úc|hàng đức|hàng nhật|nhập (?:mỹ|úc|đức|nhật)/i;
const GENERIC = new Set(['baby', 'babies', 'infant', 'toddler', 'kids', 'food', 'foods', 'snack', 'snacks', 'organic', 'pack', 'months',
  'month', 'stage', 'for', 'with', 'and', 'the', 'of', 'in', 'from', 'to', 'cho', 'be', 'tre', 'em', 'an', 'dam', 'thang', 'tuoi', 'hop',
  'goi', 'loai', 'vi', 'huong', 'combo', 'set', 'chinh', 'hang', 'nhap', 'khau', 'san', 'pham', 'mua', 'gia', 'tot', 'moi']);

const words = (s) => fold(s)
  .replace(/\d+(?:[.,]\d+)?\s*(?:g|gr|gram|grams|ml|kg|l|oz|m|x|pk|ct|thang|tuoi)\b/g, ' ')
  .split(/[^a-z0-9]+/)
  .filter((w) => w.length > 1 && !/^\d+$/.test(w));

// Distinctive words of a product name: no brand words, no generic baby-food words, no sizes.
function distinctive(title, brand) {
  const b = new Set(words(brand || ''));
  return [...new Set(words(title).filter((w) => !b.has(w) && !GENERIC.has(w)))];
}

// Cross-language "concepts": the flavour/ingredient/format words that identify a baby-food SKU, in English,
// Vietnamese (folded, no accents) and a few other shop languages. Titles are compared on these, so
// "Organic Rice Cereal" matches "Bột gạo hữu cơ" and "Strawberry Apple Puffs" matches "Puffs vị dâu táo".
const CONCEPTS = {
  rice: ['rice', 'gao', 'reis', 'riz', 'arroz', 'riso'], oat: ['oat', 'oats', 'oatmeal', 'yen mach', 'hafer', 'avoine', 'avena'],
  wheat: ['wheat', 'lua mi', 'weizen', 'ble'], corn: ['corn', 'maize', 'bap', 'ngo', 'mais'], quinoa: ['quinoa', 'diem mach'],
  multigrain: ['multigrain', 'mixed grain', 'ngu coc tong hop', 'mehrkorn', 'multicereales'], cereal: ['cereal', 'cereals', 'bot', 'ngu coc', 'brei', 'cereales', 'bouillie'],
  porridge: ['porridge', 'congee', 'chao'], puree: ['puree', 'pouch', 'nghien', 'xay nhuyen', 'mus', 'compote'],
  puffs: ['puffs', 'puff', 'banh phong', 'banh xop', 'melts'], biscuit: ['biscuit', 'biscuits', 'cookie', 'cookies', 'banh quy', 'keks', 'galletas'],
  rusk: ['rusk', 'rusks', 'teether', 'teething', 'banh gam', 'zwieback'], ricecake: ['rice cake', 'rice cakes', 'banh gao', 'rice rusks'],
  pasta: ['pasta', 'noodle', 'noodles', 'nui', 'mi', 'nudeln'], yogurt: ['yogurt', 'yoghurt', 'sua chua', 'joghurt', 'yaourt'],
  apple: ['apple', 'apples', 'tao', 'apfel', 'pomme', 'manzana', 'mela'], banana: ['banana', 'bananas', 'chuoi', 'banane', 'platano'],
  pear: ['pear', 'pears', 'le', 'birne', 'poire', 'pera'], mango: ['mango', 'mangoes', 'xoai', 'mangue'],
  strawberry: ['strawberry', 'strawberries', 'dau tay', 'erdbeere', 'fraise', 'fresa'], blueberry: ['blueberry', 'blueberries', 'viet quat', 'heidelbeere', 'myrtille'],
  raspberry: ['raspberry', 'raspberries', 'mam xoi', 'himbeere', 'framboise'], peach: ['peach', 'peaches', 'dao', 'pfirsich', 'peche'],
  apricot: ['apricot', 'mo tay', 'aprikose', 'abricot'], prune: ['prune', 'plum', 'man tay', 'pflaume', 'pruneau'], orange: ['orange', 'cam'],
  pineapple: ['pineapple', 'thom', 'dua thom', 'ananas'], coconut: ['coconut', 'nuoc dua', 'cot dua'], grape: ['grape', 'traube'], berry: ['berry', 'berries', 'qua mong'],
  carrot: ['carrot', 'carrots', 'ca rot', 'karotte', 'carotte', 'zanahoria'], pumpkin: ['pumpkin', 'squash', 'butternut', 'bi do', 'kurbis', 'potiron', 'calabaza'],
  sweetpotato: ['sweet potato', 'sweet potatoes', 'khoai lang', 'susskartoffel', 'patate douce'], potato: ['potato', 'potatoes', 'khoai tay', 'kartoffel'],
  spinach: ['spinach', 'rau bina', 'cai bo xoi', 'spinat', 'epinard'], broccoli: ['broccoli', 'bong cai xanh', 'sup lo xanh', 'brokkoli', 'brocoli'],
  pea: ['pea', 'peas', 'dau ha lan', 'erbse'], beetroot: ['beetroot', 'beet', 'cu den', 'rote bete'], kale: ['kale', 'cai xoan'],
  tomato: ['tomato', 'tomatoes', 'ca chua', 'tomate'], vegetable: ['vegetable', 'vegetables', 'veggie', 'veggies', 'rau cu', 'rau', 'gemuse', 'legumes', 'verduras'],
  fruit: ['fruit', 'fruits', 'trai cay', 'hoa qua', 'obst', 'frucht'], chicken: ['chicken', 'ga', 'huhn', 'poulet', 'pollo'],
  beef: ['beef', 'bo', 'rind', 'boeuf', 'ternera'], pork: ['pork', 'heo', 'lon', 'schwein'], salmon: ['salmon', 'ca hoi', 'lachs', 'saumon'],
  fish: ['fish', 'ca', 'fisch', 'poisson'], milk: ['milk', 'sua', 'milch', 'lait', 'leche'], cheese: ['cheese', 'pho mai', 'kase', 'fromage'],
  vanilla: ['vanilla', 'vani', 'vanille'], cocoa: ['cocoa', 'chocolate', 'socola', 'ca cao', 'kakao'], cinnamon: ['cinnamon', 'zimt', 'cannelle'],
  seaweed: ['seaweed', 'rong bien'], egg: ['egg', 'trung ga', 'oeuf'],
};
const PHRASES = Object.entries(CONCEPTS)
  .flatMap(([k, list]) => list.map((p) => [k, ` ${p} `]))
  .sort((a, b) => b[1].length - a[1].length);

function conceptsOf(text) {
  let s = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
  const out = new Set();
  // Bare "dâu" folds to "dau" like "dầu" (oil) and "đậu" (bean): count it as strawberry only next to
  // "vị/hương" or another fruit ("vị dâu", "dâu táo").
  if (/ (?:vi|huong) dau | dau (?:tao|chuoi|le|xoai|viet quat|cam) | (?:tao|chuoi|le|xoai|cam) dau /.test(s)) out.add('strawberry');
  for (const [k, p] of PHRASES) {
    if (s.includes(p)) {
      out.add(k);
      s = s.split(p).join(' ');
    }
  }
  return out;
}

const wordHit = (w, set) => set.has(w) || (w.length >= 4 && [...set].some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x))));
const containment = (need, have) => (need.length ? need.filter((w) => wordHit(w, have)).length / need.length : 0);

function brandIn(listing, brand) {
  if (!brand) return false;
  const b = fold(brand).replace(/[^a-z0-9]/g, '');
  const hay = fold(`${listing.brand || ''} ${listing.title}`).replace(/[^a-z0-9]/g, '');
  return b.length >= 3 && hay.includes(b);
}

export function identityOf(p) {
  const brand = p.brand || guessBrand(p.title) || null;
  return {
    brand,
    title: p.title,
    gtin: gtinOf(p.gtin),
    qty: p.qty || parseQuantity(p.title),
    words: distinctive(p.title, brand),
    concepts: conceptsOf(p.title),
  };
}

// 0..1: how likely a Vietnamese listing is the same product (same barcode = 1).
const FORMAT = new Set(['cereal', 'porridge', 'puree', 'puffs', 'biscuit', 'rusk', 'ricecake', 'pasta', 'yogurt', 'fruit', 'vegetable', 'milk']);
const weight = (c) => (FORMAT.has(c) ? 0.5 : 1);

// Share of the foreign product's flavour/format concepts found in the listing, minus flavours it doesn't have.
function conceptScore(foreign, listing) {
  if (!foreign.size) return null;
  let total = 0;
  let hit = 0;
  for (const c of foreign) {
    total += weight(c);
    if (listing.has(c)) hit += weight(c);
  }
  const extraFlavours = [...listing].filter((c) => !FORMAT.has(c) && !foreign.has(c)).length;
  return Math.max(0, hit / total - 0.15 * extraFlavours);
}

export function matchScore(id, idViWords, listing) {
  if (id.gtin && gtinOf(listing.gtin) === id.gtin) return 1;
  if (id.brand && !brandIn(listing, id.brand)) return 0;
  const have = new Set(words(listing.title));
  const byConcept = conceptScore(id.concepts, conceptsOf(listing.title));
  let s = Math.max(byConcept ?? 0, containment(id.words, have), containment(idViWords, have) * 0.9);
  if (!id.words.length && byConcept == null) s = 0.5; // only the brand to go on
  const q1 = id.qty?.total;
  const q2 = (listing.qty || parseQuantity(listing.title))?.total;
  if (q1 && q2) s += Math.abs(q1 - q2) / Math.max(q1, q2) <= 0.1 ? 0.1 : -0.1;
  return Math.max(0, Math.min(1, s));
}

function chainOf(l) {
  const where = `${l.source} ${l.seller || ''} ${l.domain || hostOf(l.url)}`;
  return CHAINS.find(([, re, id]) => l.source === id || l.domain === id || re.test(where))?.[0] || null;
}

const officialStore = (l) => !!(l.extra?.lazMall || l.extra?.official || /tiki trading|official|chính hãng|mall/i.test(l.seller || ''));

// Fast pass: how long to wait for Vietnamese sources / product pages before answering with what has
// arrived. Slow sources (Lazada through the premium proxy can take 10–40s) keep running; the complete
// pass then reuses the same in-flight requests and corrects the answer.
const FAST_LIST_MS = 9000;
const FAST_DETAIL_MS = 6000;
const SLOW_SOURCES = ['lazada'];
const SLOW_GRACE_MS = 1000;
const LATE = Symbol('late');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Promise.race with a timer; never rejects (failures come back as { error }).
const within = (p, ms) => {
  const settled = p.then((v) => ({ v }), (error) => ({ error }));
  return ms == null ? settled : Promise.race([settled, sleep(ms).then(() => LATE)]);
};

// One request per Vietnamese source per query, shared by every product and both passes of a run.
function sourceRuns(query, ctx) {
  const key = fold(query);
  if (!ctx.queries.has(key)) {
    ctx.queries.set(key, VN_SOURCES.map((id) => byId[id]).filter((s) => s && enabled(s)).map((src) => ({
      id: src.id,
      name: src.name,
      p: runSearch(src, 'vn', query, { signal: ctx.signal })
        .then(({ value }) => value.map((r) => makeItem({ ...r, source: src.id, kind: src.kind, market: 'vn' }, { market: 'vn' }))),
    })));
  }
  return ctx.queries.get(key);
}

// Listings of every enabled Vietnamese source for a query (failures are reported, not thrown).
// wait: ms to wait in the fast pass; sources still running then are reported as pending.
async function vnListings(query, ctx, wait) {
  const runs = sourceRuns(query, ctx);
  let out;
  if (wait == null) out = await Promise.all(runs.map((r) => within(r.p, null)));
  else {
    // Fast pass: stop waiting once every normally-fast source has answered (+ a short grace for the slow
    // ones, which answer quickly too when they aren't going through the proxy).
    const settled = runs.map((r) => r.p.then(() => {}, () => {}));
    const fastDone = Promise.all(settled.filter((_, i) => !SLOW_SOURCES.includes(runs[i].id))).then(() => sleep(SLOW_GRACE_MS));
    await Promise.race([Promise.all(settled), sleep(wait), fastDone]);
    out = await Promise.all(runs.map((r) => within(r.p, 0)));
  }
  const items = [];
  const failed = [];
  const pending = [];
  out.forEach((x, i) => {
    if (x === LATE) pending.push(runs[i].name);
    else if (x.error) failed.push(runs[i].name);
    else items.push(...x.v);
  });
  return { items, failed, pending };
}

export function createContext(signal) {
  return { signal, queries: new Map(), detailCache: new Map(), importers: new Map() };
}

// Sources whose silence makes "not sold in Vietnam" unreliable.
const KEY_SOURCES = ['Tiki', 'Lazada', 'Con Cưng', 'Kids Plaza'];

async function withDetails(listing, ctx) {
  if (ctx.detailCache.has(listing.id)) return ctx.detailCache.get(listing.id);
  const src = byId[listing.source];
  const p = (async () => {
    if (!canEnrich(listing, src)) return listing;
    try {
      return mergeDetail({ ...listing }, await getDetail(listing, src, { signal: ctx.signal }), { market: 'vn' });
    } catch {
      return listing;
    }
  })();
  ctx.detailCache.set(listing.id, p);
  return p;
}

// When the matched listings don't name an importer, read a few other listings of the same brand
// (Kids Plaza and Tiki pages usually print "Nhà nhập khẩu/phân phối") to find the brand's distributor.
const IMPORTER_SOURCES = ['kidsplaza', 'tiki', 'lazada', 'siteshop', 'concung'];
function brandImporter(brand, brandHits, ctx) {
  const key = fold(brand);
  if (!ctx.brandImporter) ctx.brandImporter = new Map();
  if (!ctx.brandImporter.has(key)) {
    ctx.brandImporter.set(key, (async () => {
      const known = ctx.importers.get(key)?.importer;
      if (known) return known;
      // Seen on an earlier run (persisted directory).
      const saved = knownImporter(brand);
      if (saved) return saved;
      const picks = [...brandHits]
        .sort((a, b) => IMPORTER_SOURCES.indexOf(a.source) - IMPORTER_SOURCES.indexOf(b.source))
        .slice(0, 5);
      for (const l of picks) {
        const d = await withDetails(l, ctx);
        if (d.importer) {
          try {
            recordImporter(brand, d.importer, d.source, d.url);
          } catch { /* best-effort */ }
          return d.importer;
        }
      }
      return null;
    })());
  }
  return ctx.brandImporter.get(key);
}

// How much Vietnamese shoppers search for the brand: autocomplete suggestions (Google + DDG, vi-VN)
// that contain the brand name. A cheap proxy for awareness/demand in Vietnam.
function brandInterest(brand, ctx) {
  const key = fold(brand);
  if (!ctx.interest) ctx.interest = new Map();
  if (!ctx.interest.has(key)) {
    // Only baby-context suggestions count: "gerber accumark" (sewing software) says nothing about baby food.
    const BABY = /an dam|cho be|\bbe\b|tre em|so sinh|sua|bot|banh|chao|puffs?|baby|thang tuoi|hop|goi/;
    ctx.interest.set(key, Promise.all([suggest(brand), suggest(`${brand} cho bé`)]).then(([a, b2]) => {
      const b = key.replace(/[^a-z0-9]/g, '');
      const seen = new Set();
      const hits = [...a, ...b2].filter((x) => {
        const f = fold(x);
        if (seen.has(f) || !f.replace(/[^a-z0-9]/g, '').includes(b) || !BABY.test(f)) return false;
        seen.add(f);
        return true;
      });
      return { suggestions: hits.length, sample: hits.slice(0, 5) };
    }).catch(() => null));
  }
  return ctx.interest.get(key);
}

// fast: answer from the sources/pages that respond within a few seconds; the result lists what is still
// pending, and calling again without fast (same ctx) gives the complete answer.
export async function checkProduct(p, ctx, { fast = false } = {}) {
  const listWait = fast ? FAST_LIST_MS : undefined;
  const detailWait = fast ? FAST_DETAIL_MS : undefined;
  const pendingDetails = { n: 0 };
  // Value of a shared promise, or `fallback` if it isn't ready within the fast-pass budget.
  const soon = async (promise, fallback, ms = detailWait) => {
    const x = await within(promise, ms);
    if (x === LATE) {
      pendingDetails.n++;
      return fallback;
    }
    return x.error ? fallback : x.v;
  };

  const id = identityOf(p);
  const none = { items: [], failed: [], pending: [] };
  // Translation, brand search and brand interest are independent: start them together.
  const viTitleP = translate(p.title, 'vi').then((r) => r.text).catch(() => '');
  const byBrandP = id.brand ? vnListings(id.brand, ctx, listWait) : Promise.resolve(none);
  const interestP = id.brand ? brandInterest(id.brand, ctx) : Promise.resolve(null);
  const [viTitle, byBrand] = await Promise.all([viTitleP, byBrandP]);
  const idVi = distinctive(viTitle, id.brand);

  const specificQuery = clean([id.brand, ...id.words.slice(0, 4)].filter(Boolean).join(' ')) || p.title;
  // One brand-level search per brand; a product-specific search only when it can change the answer:
  // the brand is sold in Vietnam but this product isn't in the brand's top results, or the brand is unknown.
  const brandPresent = byBrand.items.some((l) => brandIn(l, id.brand));
  const score = (l) => matchScore(id, idVi, l);
  const needSpecific = !id.brand || (brandPresent && !byBrand.items.some((l) => score(l) >= 0.65));
  const bySpecific = needSpecific ? await vnListings(specificQuery, ctx, listWait) : none;
  const failed = [...new Set([...byBrand.failed, ...bySpecific.failed])];
  const pendingSources = [...new Set([...byBrand.pending, ...bySpecific.pending])];

  const seen = new Set();
  const urlKey = (l) => (l.url || l.id).split(/[?#]/)[0].replace(/\/$/, '').toLowerCase();
  const pool = [...bySpecific.items, ...byBrand.items].filter((l) => !seen.has(urlKey(l)) && seen.add(urlKey(l)));

  const brandHits = id.brand ? pool.filter((l) => brandIn(l, id.brand)) : [];
  const scored = pool.map((l) => ({ l, score: score(l) })).filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score).slice(0, 12);

  // Read the best matches' pages for the importer/distributor (Tiki/Lazada/chain product pages).
  const detailed = await Promise.all(scored.slice(0, 8).map(async (x) => ({ ...x, l: await soon(withDetails(x.l, ctx), x.l) })));
  const matches = [...detailed, ...scored.slice(8)];

  const strong = matches.filter((x) => x.score >= 0.65);
  const chains = [...new Set(strong.map((x) => chainOf(x.l)).filter(Boolean))];
  const importers = [...new Set(matches.map((x) => x.l.importer).filter(Boolean))];
  // Brand-level importer seen on other products of the same brand (useful for the "brand" class).
  for (const imp of importers) if (id.brand) ctx.importers.set(fold(id.brand), { brand: id.brand, importer: imp });
  for (const x of matches) {
    if (x.l.importer && id.brand) {
      try {
        recordImporter(id.brand, x.l.importer, x.l.source, x.l.url);
      } catch { /* best-effort */ }
    }
  }
  const handCarried = matches.filter((x) => HAND_CARRIED.test(x.l.title)).length;
  const sold = matches.reduce((s, x) => s + (x.l.sold || 0), 0);
  const prices = matches.map((x) => x.l.priceVND).filter(Boolean).sort((a, b) => a - b);

  const brandImp = !importers.length && brandHits.length && id.brand ? await soon(brandImporter(id.brand, brandHits, ctx), null) : null;
  const importerText = importers.length ? `Nhà nhập khẩu/phân phối: ${importers.join('; ')}`
    : brandImp ? `Nhà phân phối của thương hiệu (thấy trên SP khác cùng hãng): ${brandImp}` : null;

  let cls;
  const reasons = [];
  if (strong.length) {
    if (chains.length >= MIN_CHAINS && importerText) {
      cls = 'nkcn';
      reasons.push(`Có ở ${chains.length} chuỗi: ${chains.join(', ')}`, importerText);
    } else {
      cls = 'partial';
      reasons.push(chains.length ? `Mới thấy ở ${chains.length} chuỗi lớn (${chains.join(', ')}) — cần ≥${MIN_CHAINS}` : 'Chưa thấy ở chuỗi mẹ & bé lớn nào');
      reasons.push(importerText || 'Chưa tìm thấy tên nhà nhập khẩu/phân phối');
      if (handCarried) reasons.push(`${handCarried} tin bán ghi xách tay/nội địa`);
    }
  } else if (matches.length) {
    cls = 'partial';
    reasons.push('Chỉ thấy sản phẩm gần giống (chưa chắc cùng mã) — nên kiểm tra tay');
  } else if (brandHits.length) {
    cls = 'brand';
    reasons.push(`Thương hiệu có ${brandHits.length} tin bán tại VN nhưng không thấy sản phẩm này`);
  } else {
    cls = 'absent';
    reasons.push(id.brand ? `Không thấy thương hiệu ${id.brand} trên các kênh VN đã kiểm tra` : 'Không thấy sản phẩm trên các kênh VN đã kiểm tra');
  }
  const brandDistributor = brandImp || (id.brand ? ctx.importers.get(fold(id.brand))?.importer : null)
    || (cls === 'brand' && id.brand ? await soon(brandImporter(id.brand, brandHits, ctx), null) : null);
  if (cls === 'brand' && brandDistributor) reasons.push(`Thương hiệu đã có nhà phân phối: ${brandDistributor} — có thể đề xuất họ nhập thêm SP này`);
  // "Not found" only means something if the main Vietnamese channels actually answered.
  const missingKey = failed.filter((f) => KEY_SOURCES.includes(f));
  const uncertain = (cls === 'absent' || cls === 'brand') && missingKey.length > 0;
  if (uncertain) reasons.unshift(`Chưa chắc: không kiểm tra được ${missingKey.join(', ')} (bị giới hạn tạm thời) — chạy lại sau ít phút`);
  else if (failed.length) reasons.push(`Thiếu dữ liệu từ: ${failed.join(', ')}`);
  const pending = [...pendingSources, ...(pendingDetails.n ? ['trang chi tiết (nhà nhập khẩu)'] : [])];
  if (pending.length) reasons.push(`Đang bổ sung: ${pending.join(', ')} — kết quả sẽ tự cập nhật`);

  // Sales history: snapshot the matched Vietnamese listings, then read back their trend.
  const strongListings = strong.map((x) => ({ ...x.l, chain: chainOf(x.l) }));
  try {
    recordListings(matches.map((x) => ({ ...x.l, chain: chainOf(x.l) })));
  } catch { /* history is best-effort */ }
  const history = strongListings.length ? productHistory(strongListings) : null;
  // Autocomplete is a side signal: don't hold a fast answer (or trigger a complete pass) for it.
  const interestX = await within(interestP, fast ? 3000 : undefined);
  const interest = interestX === LATE || interestX.error ? null : interestX.v;
  if (history?.soldPerWeek) reasons.push(`Tốc độ bán tại VN: ~${history.soldPerWeek}/tuần (theo dõi ${history.trackedDays} ngày)`);

  return {
    id: p.id,
    product: {
      id: p.id, title: p.title, brand: id.brand, image: p.image, url: p.url, country: p.country, market: p.market,
      priceVND: p.priceVND, price: p.price, currency: p.currency, rating: p.rating, reviews: p.reviews, sold: p.sold, source: p.source,
      qty: id.qty?.label || null, gtin: id.gtin, rank: p.rank || null,
    },
    class: cls,
    uncertain,
    failed,
    pending,
    confidence: strong[0]?.score ?? matches[0]?.score ?? 0,
    reasons,
    chains,
    importers,
    brandImporter: brandDistributor,
    brandListings: brandHits.length,
    vn: {
      listings: matches.length, strong: strong.length, sold, handCarried,
      minPriceVND: prices[0] ?? null, maxPriceVND: prices.at(-1) ?? null,
      official: strong.filter((x) => officialStore(x.l)).length,
    },
    history,
    interest,
    matches: matches.map(({ l, score }) => ({
      title: l.title, url: l.url, image: l.image, source: l.source, seller: l.seller, domain: l.domain, priceVND: l.priceVND,
      sold: l.sold, rating: l.rating, reviews: l.reviews, importer: l.importer || null, chain: chainOf(l), official: officialStore(l),
      handCarried: HAND_CARRIED.test(l.title), score: Math.round(score * 100) / 100,
      soldPerWeek: score >= 0.65 ? listingHistory(l).soldPerWeek : null,
    })),
    queries: [specificQuery, id.brand].filter(Boolean),
  };
}
