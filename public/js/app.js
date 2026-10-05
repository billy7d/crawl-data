import {
  $, $$, esc, fold, fmtNum, fmtVND, fmtShortVND, fmtMoney, fmtCompact, fmtPct, quantile, median, debounce,
  timeAgo, ageLabel, flag, download, load, save, api,
} from './util.js';
import { hbar, columns, sparkline, niceStep } from './charts.js';

// ---------------------------------------------------------------- constants

const EXAMPLES = ['bánh ăn dặm Gerber', 'bột ăn dặm HiPP', 'cháo tươi cho bé', 'mì ăn dặm hữu cơ', 'dầu óc chó cho bé', 'bánh gạo ăn dặm', 'sữa chua khô cho bé', 'ruốc cá hồi cho bé'];
const CLAIMS = ['Hữu cơ', 'Không đường', 'Không muối', 'Không gluten', 'Không chất bảo quản', 'Non-GMO', 'Thuần chay', 'Bổ sung DHA', 'Bổ sung sắt', 'Probiotic'];
const ALLERGENS = ['Sữa', 'Gluten/lúa mì', 'Trứng', 'Đậu nành', 'Đậu phộng/hạt', 'Cá/hải sản', 'Mè'];
const SECTION_LABELS = {
  ingredients: 'Thành phần', age: 'Độ tuổi', usage: 'Cách dùng', storage: 'Bảo quản', origin: 'Xuất xứ',
  expiry: 'Hạn sử dụng', weight: 'Khối lượng', nutrition: 'Dinh dưỡng', warnings: 'Lưu ý',
};
const STATUS = { research: 'Đang nghiên cứu', contact: 'Liên hệ NCC', sample: 'Đặt mẫu', imported: 'Đã nhập hàng', dropped: 'Loại bỏ' };
const NO_DETAIL = new Set(['bingshop', 'gshop', 'sainsburys']);
const DEFAULT_MARKETS = ['vn'];
const PAGE = 120;

const QUICK_LINKS = [
  ['Google', 'vi', (q) => `https://www.google.com/search?q=${q}`],
  ['Google Shopping', 'vi', (q) => `https://www.google.com/search?tbm=shop&q=${q}`],
  ['Shopee', 'vi', (q) => `https://shopee.vn/search?keyword=${q}`],
  ['TikTok', 'vi', (q) => `https://www.tiktok.com/search?q=${q}`],
  ['Google Trends', 'vi', (q) => `https://trends.google.com/trends/explore?geo=VN&q=${q}`],
  ['AVAKids', 'vi', (q) => `https://www.avakids.com/tim-kiem?key=${q}`],
  ['Bibomart', 'vi', (q) => `https://bibomart.com.vn/search?q=${q}`],
  ['Amazon', 'en', (q) => `https://www.amazon.com/s?k=${q}`],
  ['iHerb', 'en', (q) => `https://vn.iherb.com/search?kw=${q}`],
  ['Alibaba (sỉ/NCC)', 'en', (q) => `https://www.alibaba.com/trade/search?SearchText=${q}`],
  ['Rakuten', 'ja', (q) => `https://search.rakuten.co.jp/search/mall/${q}/`],
  ['Coupang', 'ko', (q) => `https://www.coupang.com/np/search?q=${q}`],
  ['Taobao', 'zh-CN', (q) => `https://s.taobao.com/search?q=${q}`],
];

// ---------------------------------------------------------------- state

const S = {
  meta: null,
  srcName: {},
  markets: load('markets', DEFAULT_MARKETS),
  sources: load('sources', null),
  q: '',
  items: new Map(),
  order: [],
  fresh: new Set(),
  tasks: new Map(),
  translations: {},
  trOverride: {},
  es: null,
  searching: false,
  t0: 0,
  doneMs: null,
  sort: load('sort', 'relevance'),
  view: load('view', 'table'),
  limit: PAGE,
  compare: new Set(load('compare', [])),
  compareItems: new Map(load('compareItems', [])),
  watch: [],
  tab: 'results',
  detailLoading: new Set(),
  borrow: new Map(),
  enrichQueue: [],
  enrichInflight: 0,
  enrichInflightIds: new Set(),
  enrichAttempted: new Set(),
  runId: 0,
};

// ---------------------------------------------------------------- helpers

const toast = (() => {
  let t;
  return (msg, ms = 2600) => {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(t);
    t = setTimeout(() => {
      el.hidden = true;
    }, ms);
  };
})();

const countryName = (c) => S.meta?.countries?.[c] || (c ? c.toUpperCase() : '');
const marketName = (m) => (m === 'world' ? 'Toàn cầu' : S.meta?.markets.find((x) => x.code === m)?.name || m);
const proxied = (u) => `/api/img?u=${encodeURIComponent(u)}`;

function img(src, cls = 'thumb', alt = '') {
  if (!src) return `<div class="${cls} ph">Không ảnh</div>`;
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" data-fallback="${esc(proxied(src))}">`;
}
// Retry broken images through the server proxy (some CDNs block hot-linking), then give up quietly.
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el.tagName !== 'IMG' || !el.dataset.fallback) return;
  const fb = el.dataset.fallback;
  delete el.dataset.fallback;
  el.src = fb;
}, true);

const allItems = () => S.order.map((id) => S.items.get(id));
const priceOf = (it) => it.priceVND;

// ---- Ingredients & storage: own data, data borrowed from the same product elsewhere, lazy loading ----

const NAME_STOP = new Set(['cho', 'be', 'tre', 'em', 'hop', 'goi', 'tui', 'lon', 'chai', 'combo', 'loc', 'set', 'vi', 'huong', 'loai',
  'the', 'and', 'with', 'for', 'of', 'pack', 'baby', 'babies', 'months', 'month', 'thang', 'tuoi', 'nam', 'chinh', 'hang', 'nhap', 'khau']);
const tokenCache = new Map();
function nameTokens(it) {
  const key = `${it.title}|${it.brand || ''}`;
  if (tokenCache.has(key)) return tokenCache.get(key);
  const brand = fold(it.brand || '');
  const words = fold(it.title)
    .replace(/\d+(?:[.,]\d+)?\s*(?:g|gr|gram|ml|kg|l|oz|m|thang|tuoi|x)\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !NAME_STOP.has(w) && !/^\d+$/.test(w) && !brand.split(/\s+/).includes(w));
  const v = { set: new Set(words), brand };
  tokenCache.set(key, v);
  return v;
}
function similarity(a, b) {
  if (a.brand && b.brand && a.brand !== b.brand) return 0;
  let inter = 0;
  for (const w of a.set) if (b.set.has(w)) inter++;
  const union = a.set.size + b.set.size - inter;
  return union ? inter / union : 0;
}

// For rows missing ingredients/storage, borrow them from the same product found in another source:
// identical barcode first, otherwise same brand + near-identical name. Recomputed on each render.
function computeBorrow() {
  S.borrow = new Map();
  const items = allItems().filter((i) => i.kind !== 'web');
  const donors = items.filter((i) => i.sections?.ingredients || i.sections?.storage);
  if (!donors.length) return;
  const byGtin = new Map(donors.filter((d) => d.gtin).map((d) => [String(d.gtin).replace(/^0+/, ''), d]));
  for (const it of items) {
    const need = ['ingredients', 'storage'].filter((k) => !it.sections?.[k]);
    if (!need.length) continue;
    const t = nameTokens(it);
    const ranked = [];
    const sameCode = it.gtin && byGtin.get(String(it.gtin).replace(/^0+/, ''));
    if (sameCode && sameCode.id !== it.id) ranked.push([2, sameCode]);
    if (t.set.size >= 2) {
      for (const d of donors) {
        if (d.id === it.id) continue;
        const sim = similarity(t, nameTokens(d));
        if (sim >= 0.6) ranked.push([sim, d]);
      }
    }
    ranked.sort((a, b) => b[0] - a[0]);
    const b = {};
    for (const k of need) {
      const hit = ranked.find(([, d]) => d.sections?.[k]);
      if (hit) b[k] = { text: hit[1].sections[k], from: S.srcName[hit[1].source] || hit[1].source, donorId: hit[1].id, donorTitle: hit[1].title, sameCode: hit[0] === 2 };
    }
    if (Object.keys(b).length) S.borrow.set(it.id, b);
  }
}

// Sections to display: the row's own, then borrowed ones, each with a note on where it came from.
function viewSections(it) {
  const s = { ...(it.sections || {}) };
  const notes = { ...(it.sectionSource || {}) };
  for (const [k, v] of Object.entries(S.borrow.get(it.id) || {})) {
    if (!s[k]) {
      s[k] = v.text;
      notes[k] = `${v.sameCode ? 'cùng mã vạch' : 'SP tương tự'} trên ${v.from}`;
    }
  }
  return { s, notes };
}

const detailPossible = (it) => it.kind !== 'web' && (!NO_DETAIL.has(it.source) || !!it.gtin) && (!!it.url || !!it.gtin);
const detailPending = (it) => detailPossible(it) && !it.enrichTried && !it.enriched;

function infoLine(it) {
  const { s, notes } = viewSections(it);
  const note = (k) => (notes[k] ? ` <span class="src-note">(theo ${esc(notes[k])})</span>` : '');
  if (it.kind === 'web') {
    const parts = [];
    if (s.ingredients) parts.push(`<b>Thành phần</b>${note('ingredients')}: ${esc(s.ingredients)}`);
    if (s.storage) parts.push(`<b>Bảo quản</b>${note('storage')}: ${esc(s.storage)}`);
    const d = it.description || it.snippet;
    if (!parts.length && d) parts.push(esc(d));
    return parts.join(' · ') || '<span class="na">—</span>';
  }
  const pending = detailPending(it) || S.enrichInflightIds?.has(it.id);
  const missing = pending ? '<span class="muted loading-dots">đang lấy</span>' : '<span class="na">chưa có</span>';
  const parts = [
    `<b>Thành phần</b>${note('ingredients')}: ${s.ingredients ? esc(s.ingredients) : missing}`,
    `<b>Bảo quản</b>${note('storage')}: ${s.storage ? esc(s.storage) : missing}`,
  ];
  if (s.usage) parts.push(`<b>Cách dùng</b>${note('usage')}: ${esc(s.usage)}`);
  const extra = [s.age && `<b>Độ tuổi:</b> ${esc(s.age)}`, s.origin && `<b>Xuất xứ:</b> ${esc(s.origin)}`].filter(Boolean);
  if (extra.length) parts.push(extra.join(' · '));
  if (!s.ingredients && !s.storage && (it.description || it.snippet)) parts.push(`<span class="muted">${esc(it.description || it.snippet)}</span>`);
  return parts.map((p) => `<div class="info-row">${p}</div>`).join('');
}

// After a search (and whenever the visible rows change), fetch details for rows still lacking them.
function enrichVisible() {
  if (S.searching) return;
  const { list } = filtered();
  for (const it of list.slice(0, S.limit)) {
    if (!detailPending(it) || S.enrichAttempted.has(it.id)) continue;
    if (it.sections?.ingredients && it.sections?.storage) continue;
    S.enrichAttempted.add(it.id);
    S.enrichQueue.push(it.id);
  }
  pumpEnrich();
}
const enrichVisibleSoon = debounce(enrichVisible, 500);

function pumpEnrich() {
  const runId = S.runId;
  while (S.enrichInflight < 2 && S.enrichQueue.length) {
    const ids = S.enrichQueue.splice(0, 8).filter((id) => S.items.has(id));
    if (!ids.length) continue;
    S.enrichInflight++;
    ids.forEach((id) => S.enrichInflightIds.add(id));
    api('/api/details', { method: 'POST', body: { items: ids.map((id) => S.items.get(id)) } })
      .then((r) => {
        if (runId !== S.runId) return;
        for (const it of r.items || []) if (S.items.has(it.id)) S.items.set(it.id, { ...it, enrichTried: true });
      })
      .catch(() => {
        if (runId !== S.runId) return;
        for (const id of ids) {
          const it = S.items.get(id);
          if (it) S.items.set(id, { ...it, enrichTried: true });
        }
      })
      .finally(() => {
        ids.forEach((id) => S.enrichInflightIds.delete(id));
        if (runId !== S.runId) return;
        S.enrichInflight--;
        scheduleRender();
        pumpEnrich();
      });
  }
}

function tagsHtml(it, max = 6) {
  const t = [];
  if (it.sponsored) t.push('<span class="tag ad">Tài trợ</span>');
  if (it.ageMonths != null) t.push(`<span class="tag age">${ageLabel(it.ageMonths)}</span>`);
  if (it.type) t.push(`<span class="tag">${esc(it.type)}</span>`);
  if (it.qty) t.push(`<span class="tag">${esc(it.qty.label)}</span>`);
  for (const c of it.claims || []) t.push(`<span class="tag claim">${esc(c)}</span>`);
  if (it.nutriscore) t.push(`<span class="tag">Nutri-Score ${esc(it.nutriscore)}</span>`);
  return t.length ? `<div class="tags">${t.slice(0, max).join('')}</div>` : '';
}

function priceHtml(it, big = false) {
  if (it.price == null) return '<span class="na">Chưa có giá</span>';
  const vnd = it.priceVND != null ? `<div class="${big ? 'd-price' : 'price'} tnum">${fmtVND(it.priceVND)}</div>` : '';
  const orig = it.currency && it.currency !== 'VND' ? `<div class="price-orig tnum">${fmtMoney(it.price, it.currency)}</div>` : '';
  const old = it.originalPriceVND ? `<div><span class="price-old tnum">${fmtVND(it.originalPriceVND)}</span> <span class="disc">-${it.discount}%</span></div>` : '';
  return vnd + orig + old || `<div class="price">${fmtNum(it.price, 2)}</div>`;
}

function marketHtml(it) {
  if (it.countries?.length > 1) {
    const shown = it.countries.slice(0, 4).map(flag).join('');
    const more = it.countries.length > 4 ? `<span class="small muted">+${it.countries.length - 4}</span>` : '';
    return `<div class="mk" title="Đang bán tại: ${esc(it.countries.map(countryName).join(', '))}">${shown}${more}</div><div class="small muted">${it.countries.length} quốc gia</div>`;
  }
  const c = it.country;
  const sub = it.market && it.market !== 'world' && it.market !== c ? `<div class="small muted">tìm ở TT ${esc(marketName(it.market))}</div>` : '';
  const origin = it.originCountry && it.originCountry !== c ? `<div class="small muted">Xuất xứ: ${esc(countryName(it.originCountry))}</div>` : '';
  return `<div class="mk">${flag(c)}<span>${esc(countryName(c))}</span></div>${sub}${origin}`;
}

function sourceHtml(it) {
  const engines = it.engines?.length > 1 ? `<div class="small muted">${it.engines.map((e) => esc(S.srcName[e] || e)).join(' + ')}</div>` : '';
  const seller = it.seller && it.seller !== S.srcName[it.source] ? `<div class="small muted" title="Người bán">${esc(it.seller)}</div>` : '';
  const domain = it.kind === 'web' && it.domain ? `<div class="small muted">${esc(it.domain)}</div>` : '';
  return `<div class="src-badge">${esc(S.srcName[it.source] || it.source)}</div>${seller}${domain}${engines}`;
}

function rateHtml(it) {
  const r = [];
  if (it.rating) r.push(`<span class="star">★</span> ${fmtNum(it.rating, 1)}${it.reviews ? ` <span class="muted">(${fmtCompact(it.reviews)})</span>` : ''}`);
  if (it.sold) r.push(`Đã bán ${fmtCompact(it.sold)}`);
  return r.length ? `<div class="rate">${r.join('<br>')}</div>` : '<span class="na">—</span>';
}

const isWatched = (id) => S.watch.some((w) => w.id === id);
function actionsHtml(it) {
  const w = isWatched(it.id);
  return `<div class="act">
    <button class="icon-btn ${w ? 'on' : ''}" data-act="watch" title="${w ? 'Bỏ theo dõi' : 'Theo dõi sản phẩm'}" aria-label="Theo dõi">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="${w ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>
    </button>
    ${it.url ? `<a class="icon-btn" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" title="Mở trang gốc" aria-label="Mở trang gốc" data-act="open">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- init

async function init() {
  applyTheme(load('theme', null));
  try {
    S.meta = await api('/api/meta');
  } catch {
    toast('Không kết nối được máy chủ. Hãy chạy "npm start".', 8000);
    return;
  }
  S.srcName = Object.fromEntries(S.meta.sources.map((s) => [s.id, s.name]));
  renderMarkets();
  renderSources();
  $('#examples').innerHTML = EXAMPLES.map((e) => `<button type="button">${esc(e)}</button>`).join('');
  $('#f-claims').innerHTML = CLAIMS.map((c) => `<label class="check"><input type="checkbox" value="${esc(c)}"> ${esc(c)}</label>`).join('');
  $('#f-allergens').innerHTML = ALLERGENS.map((c) => `<label class="check"><input type="checkbox" value="${esc(c)}"> Không chứa ${esc(c.toLowerCase())}</label>`).join('');
  $('#sort').value = S.sort;
  setView(S.view);
  bindEvents();
  bindSettings();
  bindImport();
  refreshTracked();
  refreshWatch();
  renderCompareBar();

  const p = new URLSearchParams(location.search);
  if (p.get('m')) S.markets = p.get('m').split(',').filter((m) => S.meta.markets.some((x) => x.code === m));
  if (!S.markets.length) S.markets = [...DEFAULT_MARKETS];
  renderMarkets();
  if (p.get('q')) {
    $('#q').value = p.get('q');
    startSearch(p.get('q'));
  } else {
    $('#q').focus();
  }
}

function renderMarkets() {
  $('#markets').innerHTML = S.meta.markets.map((m) => `
    <button type="button" class="chip" data-market="${m.code}" aria-pressed="${S.markets.includes(m.code)}" title="${esc(m.name)} — tìm bằng ${esc(m.lang)}, giá ${esc(m.currency)}">
      ${flag(m.code)}${esc(m.name)}
    </button>`).join('');
}

function selectedSources() {
  const enabled = S.meta.sources.filter((s) => s.enabled);
  return S.sources ? enabled.filter((s) => S.sources.includes(s.id)) : enabled;
}

function renderSources() {
  const sel = new Set(selectedSources().map((s) => s.id));
  const groups = {};
  for (const s of S.meta.sources) (groups[s.group] ||= []).push(s);
  const marketsLabel = (s) => (s.markets === '*' ? (s.global ? 'toàn cầu' : 'mọi TT') : s.markets.map((m) => m.toUpperCase()).join(', '));
  $('#sources').innerHTML = Object.entries(groups).map(([g, list]) => `
    <div class="dd-title">${esc(g)}</div>
    ${list.map((s) => `<label class="src-row ${s.enabled ? '' : 'muted'}" title="${s.enabled ? '' : `Cần khoá ${esc(s.needsKey)} trong file .env`}">
      <input type="checkbox" value="${s.id}" ${sel.has(s.id) ? 'checked' : ''} ${s.enabled ? '' : 'disabled'}>
      <span>${esc(s.name)}</span><span class="small muted">${s.enabled ? marketsLabel(s) : 'cần API key'}</span>
    </label>`).join('')}`).join('')
    + '<div class="row-actions" style="margin-top:6px"><button type="button" class="btn small ghost" data-src-all>Chọn tất cả</button></div>'
    + '<p class="small muted" style="margin:4px 0 0;max-width:320px">Nguồn mờ cần khóa miễn phí: Google Shopping gom giá từ gần như mọi shop; proxy mở khóa Walmart, iHerb, Shopee… <button type="button" class="hint-link" data-open-settings>Mở Cài đặt nguồn</button>. Mỗi nguồn chỉ chạy với thị trường nó hỗ trợ.</p>';
  $('#sources-count').textContent = `${sel.size}/${S.meta.sources.filter((s) => s.enabled).length}`;
}

// ---------------------------------------------------------------- search

function startSearch(q, { fresh = $('#opt-fresh').checked } = {}) {
  q = q.trim();
  if (!q) return;
  S.es?.close();
  hideSuggest();
  S.q = q;
  S.items.clear();
  S.order = [];
  S.tasks.clear();
  S.runId++;
  S.enrichQueue = [];
  S.enrichInflight = 0;
  S.enrichInflightIds.clear();
  S.enrichAttempted.clear();
  S.translations = {};
  S.limit = PAGE;
  S.searching = true;
  S.stopped = false;
  S.t0 = performance.now();
  S.doneMs = null;
  $('#q').value = q;
  $('#kw-q').value ||= q;
  const url = new URL(location.href);
  url.searchParams.set('q', q);
  url.searchParams.set('m', S.markets.join(','));
  history.replaceState(null, '', url);
  document.title = `${q} — Ăn Dặm Radar`;

  const params = new URLSearchParams({
    q,
    markets: S.markets.join(','),
    sources: selectedSources().map((s) => s.id).join(','),
    enrich: $('#opt-enrich').checked ? '1' : '0',
    fresh: fresh ? '1' : '0',
  });
  for (const [lang, text] of Object.entries(S.trOverride)) if (text) params.append(`tr[${lang}]`, text);

  $('#empty-state').hidden = true;
  $('#results-wrap').hidden = false;
  $('#status').hidden = false;
  // The search button stays usable: a new search replaces this one (closing the stream stops it on the server).
  $('#search-btn').textContent = 'Tìm mới';
  $('#stop-btn').hidden = false;
  renderQuickLinks();
  if (S.tab !== 'results' && S.tab !== 'insights') switchTab('results');

  const es = new EventSource(`/api/search?${params}`);
  S.es = es;
  es.addEventListener('meta', (e) => {
    const d = JSON.parse(e.data);
    for (const t of d.tasks) S.tasks.set(`${t.source}:${t.market}`, { ...t, status: 'queued' });
    renderStatus();
  });
  es.addEventListener('task', (e) => {
    const d = JSON.parse(e.data);
    S.tasks.set(`${d.source}:${d.market}`, d);
    renderStatus();
  });
  es.addEventListener('translation', (e) => {
    const d = JSON.parse(e.data);
    S.translations[d.lang] = d.text;
    renderTranslations();
  });
  es.addEventListener('items', (e) => {
    const d = JSON.parse(e.data);
    for (const it of d.items) {
      if (!S.items.has(it.id)) {
        S.order.push(it.id);
        S.fresh.add(it.id);
      }
      S.items.set(it.id, it);
    }
    scheduleRender();
  });
  es.addEventListener('patch', (e) => {
    const it = JSON.parse(e.data);
    if (S.items.has(it.id)) S.items.set(it.id, it);
    scheduleRender();
  });
  es.addEventListener('done', (e) => {
    const d = JSON.parse(e.data);
    S.doneMs = d.ms;
    endSearch();
  });
  es.onerror = () => endSearch(true);
}

function endSearch(interrupted = false) {
  S.es?.close();
  S.es = null;
  if (!S.searching) return;
  S.searching = false;
  $('#search-btn').textContent = 'Tìm kiếm';
  $('#stop-btn').hidden = true;
  if (interrupted && S.doneMs == null) S.doneMs = Math.round(performance.now() - S.t0);
  renderStatus();
  scheduleRender(true);
  if (!S.stopped) enrichVisible();
}

// Stop the running search: the server aborts its source requests when the stream closes; results so far stay.
function stopSearch() {
  if (!S.searching) return;
  S.stopped = true;
  S.runId++; // late detail answers of this run are ignored
  S.enrichQueue = [];
  for (const t of S.tasks.values()) if (t.status === 'queued' || t.status === 'running') t.status = 'stopped';
  endSearch(true);
  toast('Đã dừng tìm kiếm — giữ lại kết quả đã có');
}

function renderStatus() {
  const tasks = [...S.tasks.values()];
  const finished = tasks.filter((t) => !['queued', 'running'].includes(t.status)).length;
  const pct = tasks.length ? (finished / tasks.length) * (S.searching ? 85 : 100) : 0;
  $('#progress-bar').style.width = `${S.searching ? Math.max(5, pct) : 100}%`;
  const n = S.items.size;
  const secs = ((S.doneMs ?? performance.now() - S.t0) / 1000).toFixed(1);
  $('#status-text').innerHTML = S.searching
    ? `Đang tìm “<b>${esc(S.q)}</b>” trên ${tasks.length} nguồn… <b>${n}</b> sản phẩm sau ${secs}s${finished === tasks.length && tasks.length ? ' — đang lấy chi tiết sản phẩm' : ''}`
    : `${S.stopped ? 'Đã dừng — giữ ' : 'Tìm thấy '}<b>${n}</b> kết quả từ ${tasks.filter((t) => t.count).length}/${tasks.length} nguồn trong ${secs}s`
      + (tasks.some((t) => ['error', 'cooldown', 'warn'].includes(t.status)) && !S.meta.sources.find((s) => s.id === 'gshop')?.enabled
        ? ' · <span class="muted">Một số nguồn bị chặn — </span><button type="button" class="hint-link" data-open-settings>thêm khóa miễn phí để ổn định hơn</button>'
        : '');
  const label = (t) => `${S.srcName[t.source] || t.source}${t.market !== 'world' && S.markets.length > 1 ? ` · ${t.market.toUpperCase()}` : ''}`;
  $('#task-chips').innerHTML = tasks.map((t) => {
    const detail = t.status === 'done' || t.status === 'warn'
      ? `${t.count} <span class="ms">${t.cached ? 'cache' : `${(t.ms / 1000).toFixed(1)}s`}</span>`
      : t.status === 'error' || t.status === 'cooldown' ? '<span class="ms">lỗi</span>' : t.status === 'stopped' ? '<span class="ms">đã dừng</span>' : '';
    const title = t.error || t.warn || (t.query ? `Từ khóa: ${t.query}` : '');
    return `<span class="task ${t.status}" title="${esc(title)}"><span class="dot"></span>${esc(label(t))} ${detail}</span>`;
  }).join('');
}

function renderTranslations() {
  const entries = Object.entries(S.translations);
  const box = $('#translations');
  box.hidden = !entries.length;
  const langName = { en: 'Tiếng Anh', ja: 'Tiếng Nhật', ko: 'Tiếng Hàn', de: 'Tiếng Đức', fr: 'Tiếng Pháp', th: 'Tiếng Thái', id: 'Tiếng Indonesia', 'zh-CN': 'Tiếng Trung' };
  box.innerHTML = '<span class="muted small">Từ khóa đã dịch cho thị trường nước ngoài (sửa rồi Enter để tìm lại):</span>'
    + entries.map(([lang, text]) => `<label class="tr-item" title="${esc(langName[lang] || lang)}"><span class="small muted">${esc(lang.toUpperCase())}</span><input data-lang="${esc(lang)}" value="${esc(S.trOverride[lang] || text)}" size="${Math.max(10, text.length + 2)}"></label>`).join('');
}

async function renderQuickLinks() {
  const box = $('#quicklinks');
  box.hidden = false;
  const tr = { vi: S.q };
  const draw = () => {
    box.innerHTML = '<span>Mở nhanh trên:</span>' + QUICK_LINKS.map(([name, lang, fn]) => {
      const q = tr[lang] ?? (lang === 'vi' ? S.q : null);
      return q ? `<a href="${esc(fn(encodeURIComponent(q)))}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>` : '';
    }).join('');
  };
  draw();
  try {
    Object.assign(tr, await api(`/api/translate-query?q=${encodeURIComponent(S.q)}&langs=en,ja,ko,zh-CN`));
    draw();
  } catch { /* links in other languages stay hidden */ }
}

// ---------------------------------------------------------------- filters & sort

function readFilters() {
  const checked = (sel) => $$(`${sel} input:checked`).map((i) => i.value);
  return {
    text: fold($('#f-text').value.trim()),
    source: $('#f-source').value,
    country: $('#f-country').value,
    type: $('#f-type').value,
    age: $('#f-age').value,
    min: Number($('#f-min').value) || null,
    max: Number($('#f-max').value) || null,
    hasPrice: $('#f-hasprice').checked,
    shopOnly: $('#f-shop').checked,
    relevant: $('#f-relevant').checked,
    foodOnly: $('#f-food').checked,
    noAds: $('#f-noads').checked,
    claims: checked('#f-claims'),
    allergens: checked('#f-allergens'),
  };
}

function filtered() {
  const f = readFilters();
  const words = f.text ? f.text.split(/\s+/) : [];
  const [aLo, aHi] = f.age ? f.age.split('-').map(Number) : [];
  let list = allItems().filter((it) => {
    if (f.relevant && it.relevance < 0.45) return false;
    if (f.foodOnly && it.nonFood) return false;
    if (f.source && it.source !== f.source) return false;
    if (f.country && it.country !== f.country && !(it.countries || []).includes(f.country)) return false;
    if (f.type && it.type !== f.type) return false;
    if (f.age && (it.ageMonths == null || it.ageMonths < aLo || it.ageMonths > aHi)) return false;
    if ((f.hasPrice || f.min || f.max) && it.priceVND == null) return false;
    if (f.min && it.priceVND < f.min) return false;
    if (f.max && it.priceVND > f.max) return false;
    if (f.shopOnly && it.kind === 'web') return false;
    if (f.noAds && it.sponsored) return false;
    if (f.claims.length && !f.claims.every((c) => (it.claims || []).includes(c))) return false;
    if (f.allergens.length && f.allergens.some((a) => (it.allergens || []).includes(a))) return false;
    if (words.length) {
      const hay = fold([it.title, it.brand, it.seller, it.snippet, it.description, it.domain, ...Object.values(it.sections || {})].join(' '));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const score = (it) => it.relevance + (it.priceVND != null ? 0.12 : 0) + (it.image ? 0.06 : 0)
    + (it.kind !== 'web' ? 0.05 : 0) + (Object.keys(it.sections || {}).length ? 0.04 : 0) - (it.pos || 0) * 0.003;
  const num = (v, dir) => (v == null ? Infinity : dir * v);
  const sorters = {
    relevance: (a, b) => score(b) - score(a),
    'price-asc': (a, b) => num(a.priceVND, 1) - num(b.priceVND, 1),
    'price-desc': (a, b) => num(a.priceVND, -1) - num(b.priceVND, -1),
    'p100-asc': (a, b) => num(a.pricePer100VND, 1) - num(b.pricePer100VND, 1),
    'sold-desc': (a, b) => num(a.sold, -1) - num(b.sold, -1),
    'rating-desc': (a, b) => num(a.rating, -1) - num(b.rating, -1) || num(a.reviews, -1) - num(b.reviews, -1),
    'discount-desc': (a, b) => num(a.discount, -1) - num(b.discount, -1),
  };
  list.sort(sorters[S.sort] || sorters.relevance);
  return { list, f };
}

function populateFilterOptions() {
  const items = allItems();
  const fill = (sel, values, label) => {
    const el = $(sel);
    const cur = el.value;
    const first = el.options[0].outerHTML;
    el.innerHTML = first + values.map(([v, n]) => `<option value="${esc(v)}">${esc(label(v))} (${n})</option>`).join('');
    el.value = values.some(([v]) => v === cur) ? cur : '';
  };
  const count = (key) => {
    const m = new Map();
    for (const it of items) {
      const v = key(it);
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  fill('#f-source', count((i) => i.source), (v) => S.srcName[v] || v);
  fill('#f-country', count((i) => i.country), countryName);
  fill('#f-type', count((i) => i.type), (v) => v);
}

// ---------------------------------------------------------------- results render

let renderTimer = null;
let lastRender = 0;
function scheduleRender(now = false) {
  if (now) {
    clearTimeout(renderTimer);
    renderTimer = null;
    renderAll();
    return;
  }
  if (renderTimer) return;
  const wait = Math.max(0, 180 - (performance.now() - lastRender));
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderAll();
  }, wait);
}

function renderAll() {
  lastRender = performance.now();
  renderStatus();
  populateFilterOptions();
  computeBorrow();
  renderResults();
  $('#cnt-results').textContent = S.items.size || '';
  if (S.tab === 'insights') renderInsights();
}

function renderResults() {
  const { list } = filtered();
  const shown = list.slice(0, S.limit);
  const priced = list.filter((i) => i.priceVND != null).map((i) => i.priceVND).sort((a, b) => a - b);
  const brands = new Set(list.map((i) => i.brand).filter(Boolean));
  // How many product rows (not web articles) have ingredients / storage, counting borrowed data.
  const products = list.filter((i) => i.kind !== 'web');
  const has = (k) => products.filter((i) => viewSections(i).s[k]).length;
  const pct = (n) => (products.length ? Math.round((n / products.length) * 100) : 0);
  const loading = S.enrichQueue.length + S.enrichInflightIds.size;
  $('#result-meta').innerHTML = [
    `Hiển thị <b>${fmtNum(Math.min(S.limit, list.length))}</b>/${fmtNum(list.length)} kết quả${list.length !== S.items.size ? ` (lọc từ ${fmtNum(S.items.size)})` : ''}`,
    priced.length ? `Giá: <b>${fmtShortVND(priced[0])}</b> – <b>${fmtShortVND(priced.at(-1))}</b>, trung vị <b>${fmtShortVND(quantile(priced, 0.5))}</b>` : '',
    brands.size ? `<b>${brands.size}</b> thương hiệu` : '',
    products.length ? `Có thành phần <b>${pct(has('ingredients'))}%</b> · bảo quản <b>${pct(has('storage'))}%</b> sản phẩm` : '',
    loading ? `<span class="muted loading-dots">Đang lấy thành phần & bảo quản cho ${loading} sản phẩm</span>` : '',
  ].filter(Boolean).join(' · ');

  if (!list.length) {
    $('#results').innerHTML = S.searching
      ? '<div class="panel muted">Đang chờ kết quả đầu tiên…</div>'
      : '<div class="panel muted">Không có kết quả phù hợp bộ lọc. Thử xoá bớt bộ lọc hoặc tắt “Ẩn kết quả ít liên quan”.</div>';
  } else if (S.view === 'grid') {
    $('#results').innerHTML = `<div class="grid">${shown.map(cardHtml).join('')}</div>`;
  } else {
    $('#results').innerHTML = tableHtml(shown);
  }
  $('#more-btn').hidden = list.length <= S.limit;
  $('#more-btn').textContent = `Xem thêm (${fmtNum(list.length - S.limit)})`;
  S.fresh.clear();
  if (!S.searching) enrichVisibleSoon();
}

function tableHtml(rows) {
  const th = (label, key, cls) => {
    const sortKey = { price: 'price-asc', p100: 'p100-asc', rate: 'sold-desc' }[key];
    const sorted = sortKey && S.sort.startsWith(sortKey.split('-')[0]) ? 'sorted' : '';
    return `<th class="${cls} ${sortKey ? 'sortable' : ''} ${sorted}" ${sortKey ? `data-sort="${sortKey}"` : ''}>${label}</th>`;
  };
  return `<div class="table-wrap"><table class="results">
    <thead><tr>
      <th class="c-sel" title="Chọn để so sánh">⇄</th>${th('Ảnh', '', 'c-img')}${th('Sản phẩm', '', 'c-title')}
      ${th('Giá (quy đổi VNĐ)', 'price', 'c-price')}${th('Giá/100g', 'p100', 'c-p100')}${th('Thị trường', '', 'c-market')}
      ${th('Nguồn', '', 'c-src')}${th('Đánh giá · Bán', 'rate', 'c-rate')}${th('Thông tin chính', '', 'c-info')}<th class="c-act"></th>
    </tr></thead>
    <tbody>${rows.map((it) => `<tr data-id="${it.id}" class="${S.fresh.has(it.id) ? 'new' : ''}">
      <td class="c-sel"><input type="checkbox" data-act="compare" ${S.compare.has(it.id) ? 'checked' : ''} aria-label="So sánh"></td>
      <td class="c-img">${img(it.image, 'thumb', it.title)}</td>
      <td class="c-title"><div class="p-title">${esc(it.title)}</div>
        <div class="p-sub">${[it.brand ? `<b>${esc(it.brand)}</b>` : '', it.gtin && it.source === 'off' ? `EAN ${esc(it.gtin)}` : ''].filter(Boolean).join(' · ')}</div>${tagsHtml(it)}</td>
      <td class="c-price">${priceHtml(it)}</td>
      <td class="c-p100 tnum">${it.pricePer100VND ? `${fmtVND(it.pricePer100VND)}` : '<span class="na">—</span>'}</td>
      <td class="c-market">${marketHtml(it)}</td>
      <td class="c-src">${sourceHtml(it)}</td>
      <td class="c-rate">${rateHtml(it)}</td>
      <td class="c-info"><div class="info">${infoLine(it)}</div></td>
      <td class="c-act">${actionsHtml(it)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function cardHtml(it) {
  return `<div class="card" data-id="${it.id}">
    ${img(it.image, 'thumb', it.title)}
    ${actionsHtml(it)}
    <div class="p-title">${esc(it.title)}</div>
    <div class="p-sub">${esc(it.brand || '')}</div>
    ${tagsHtml(it, 4)}
    <div class="card-foot">
      <div>${priceHtml(it)}${it.pricePer100VND ? `<div class="small muted">${fmtVND(it.pricePer100VND)}/100g</div>` : ''}</div>
      <div style="text-align:right">${marketHtml(it)}<div class="src-badge">${esc(S.srcName[it.source] || it.source)}</div></div>
    </div>
    <label class="check small"><input type="checkbox" data-act="compare" ${S.compare.has(it.id) ? 'checked' : ''}> So sánh</label>
  </div>`;
}

function setView(v) {
  S.view = v;
  save('view', v);
  $$('.seg [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  if (S.items.size) renderResults();
}

// ---------------------------------------------------------------- drawer

let drawerId = null;
function findItem(id) {
  return S.items.get(id) || S.compareItems.get(id) || S.watch.find((w) => w.id === id)?.item;
}

function openDrawer(id) {
  const it = findItem(id);
  if (!it) return;
  drawerId = id;
  $('#drawer').hidden = false;
  renderDrawer(it);
  if (detailPending(it) && !S.detailLoading.has(id)) loadDetail(it);
}
function closeDrawer() {
  $('#drawer').hidden = true;
  drawerId = null;
}

async function loadDetail(it, fresh = false) {
  S.detailLoading.add(it.id);
  if (drawerId === it.id) renderDrawer(it);
  try {
    const r = await api('/api/detail', { method: 'POST', body: { item: it, fresh } });
    if (r.error) toast(`Không lấy được chi tiết: ${r.error}`);
    updateItem({ ...r.item, enrichTried: true });
  } catch (e) {
    toast(`Lỗi: ${e.message}`);
  } finally {
    S.detailLoading.delete(it.id);
    if (drawerId === it.id) renderDrawer(findItem(it.id));
  }
}

function updateItem(it) {
  if (S.items.has(it.id)) S.items.set(it.id, it);
  if (S.compareItems.has(it.id)) {
    S.compareItems.set(it.id, it);
    persistCompare();
  }
  scheduleRender();
}

function renderDrawer(it) {
  const { s, notes } = viewSections(it);
  const loading = S.detailLoading.has(it.id);
  const foreign = it.country && it.country !== 'vn';
  const kv = [
    ['Thương hiệu', esc(it.brand || '—')],
    ['Nguồn', `${esc(S.srcName[it.source] || it.source)}${it.seller ? ` · ${esc(it.seller)}` : ''}${it.domain ? ` · <span class="muted">${esc(it.domain)}</span>` : ''}`],
    ['Thị trường', marketHtml(it)],
    it.qty ? ['Quy cách', `${esc(it.qty.label)} (${fmtNum(it.qty.total)}${it.qty.unit})`] : null,
    it.pricePer100VND ? ['Giá/100' + (it.qty?.unit || 'g'), fmtVND(it.pricePer100VND)] : null,
    it.ageMonths != null ? ['Độ tuổi', ageLabel(it.ageMonths)] : null,
    it.type ? ['Loại sản phẩm', esc(it.type)] : null,
    it.rating || it.sold ? ['Đánh giá / bán', rateHtml(it)] : null,
    it.nutriscore ? ['Nutri-Score', `<span class="nutri ${esc(it.nutriscore)}">${esc(it.nutriscore)}</span>${it.nova ? ` · NOVA ${esc(it.nova)}` : ''}`] : null,
    it.gtin ? ['Mã vạch', esc(it.gtin)] : null,
    it.claims?.length ? ['Nhãn / công bố', it.claims.map((c) => `<span class="tag claim">${esc(c)}</span>`).join(' ')] : null,
    it.allergens?.length ? ['Có thể chứa', it.allergens.map((c) => `<span class="tag allergen">${esc(c)}</span>`).join(' ')] : null,
  ].filter(Boolean);
  const sections = Object.entries(SECTION_LABELS).filter(([k]) => s[k]);
  const images = (it.images || []).filter(Boolean);
  $('#drawer-body').innerHTML = `
    <div class="d-head">
      <div>${it.image ? img(it.image, 'd-img', it.title) : '<div class="d-img thumb ph">Không ảnh</div>'}
        ${images.length > 1 ? `<div class="d-thumbs">${images.map((u) => `<img src="${esc(u)}" referrerpolicy="no-referrer" data-big="${esc(u)}" alt="">`).join('')}</div>` : ''}
      </div>
      <div>
        <h2 class="d-title">${esc(it.title)}</h2>
        ${tagsHtml(it, 10)}
        ${priceHtml(it, true)}
        <div class="d-actions">
          ${it.url ? `<a class="btn primary small" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">Mở trang gốc ↗</a>` : ''}
          <button class="btn small" data-dact="watch">${isWatched(it.id) ? '★ Đang theo dõi' : '☆ Theo dõi'}</button>
          <button class="btn small" data-dact="compare">${S.compare.has(it.id) ? '✓ Trong so sánh' : '⇄ So sánh'}</button>
          <button class="btn small ghost" data-dact="similar" title="Tìm sản phẩm này ở VN và các thị trường lớn">Tìm ở thị trường khác</button>
          ${detailPossible(it) ? `<button class="btn small ghost" data-dact="reload" ${loading ? 'disabled' : ''}>${loading ? 'Đang tải…' : it.enriched ? 'Tải lại chi tiết' : 'Tải chi tiết'}</button>` : ''}
          ${foreign ? '<button class="btn small ghost" data-dact="translate">Dịch sang tiếng Việt</button>' : ''}
        </div>
      </div>
    </div>
    <div class="kv">${kv.map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join('')}</div>
    <div id="d-sections">
      ${loading && !sections.length ? '<div class="section-block"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:14px;margin-top:8px"></div><div class="skeleton" style="height:14px;margin-top:8px;width:80%"></div></div>' : ''}
      ${sections.map(([k, label]) => `<div class="section-block" data-sec="${k}"><h3>${label}${notes[k] ? ` <span class="src-note">— theo ${esc(notes[k])}</span>` : ''}</h3><div class="sec-text">${esc(s[k])}</div></div>`).join('')}
      ${(it.enrichTried || it.enriched) && !loading && it.kind !== 'web'
    ? ['ingredients', 'storage'].filter((k) => !s[k]).map((k) => `<div class="section-block"><h3>${SECTION_LABELS[k]}</h3><div class="sec-text muted">Chưa tìm thấy trên trang sản phẩm, qua mã vạch hay ở sản phẩm tương tự — mở trang gốc để xem ảnh nhãn.</div></div>`).join('')
    : ''}
      ${it.description ? `<div class="section-block" data-sec="description"><h3>Mô tả</h3><div class="sec-text">${esc(it.description)}</div></div>` : ''}
      ${!sections.length && !it.description && it.snippet ? `<div class="section-block" data-sec="snippet"><h3>Trích đoạn</h3><div class="sec-text">${esc(it.snippet)}</div></div>` : ''}
      ${!sections.length && !loading && NO_DETAIL.has(it.source) ? '<p class="muted small">Nguồn này không cho phép đọc trang chi tiết tự động — mở trang gốc để xem thành phần và hướng dẫn.</p>' : ''}
    </div>`;
}

async function translateDrawer(it) {
  const blocks = $$('#d-sections .section-block');
  const texts = [it.title, ...blocks.map((b) => $('.sec-text', b).textContent)];
  toast('Đang dịch…', 1500);
  try {
    const r = await api('/api/translate', { method: 'POST', body: { texts, to: 'vi' } });
    $('.d-title').insertAdjacentHTML('afterend', `<div class="muted small">🇻🇳 ${esc(r.texts[0])}</div>`);
    blocks.forEach((b, i) => {
      $('.sec-text', b).insertAdjacentHTML('afterend', `<div class="small" style="margin-top:6px;color:var(--accent-ink)">Dịch: ${esc(r.texts[i + 1])}</div>`);
    });
  } catch (e) {
    toast(`Không dịch được: ${e.message}`);
  }
}

function searchSimilar(it) {
  const name = (it.brand ? `${it.brand} ` : '') + it.title
    .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(new RegExp(`^${(it.brand || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
    .split(/[,|–\-:]/)[0];
  const q = name.replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ');
  S.markets = [...new Set(['vn', 'us', 'gb', 'au', 'jp', 'de', ...S.markets])];
  save('markets', S.markets);
  renderMarkets();
  closeDrawer();
  S.trOverride = {};
  startSearch(q);
}

// ---------------------------------------------------------------- compare

function persistCompare() {
  save('compare', [...S.compare]);
  save('compareItems', [...S.compareItems.entries()]);
}

function toggleCompare(id, on) {
  const it = findItem(id);
  if (on ?? !S.compare.has(id)) {
    if (S.compare.size >= 6) {
      toast('So sánh tối đa 6 sản phẩm');
      return false;
    }
    S.compare.add(id);
    if (it) S.compareItems.set(id, it);
  } else {
    S.compare.delete(id);
    S.compareItems.delete(id);
  }
  persistCompare();
  renderCompareBar();
  if (S.tab === 'compare') renderCompare();
  return true;
}

function renderCompareBar() {
  const n = S.compare.size;
  $('#cnt-compare').textContent = n || '';
  $('#compare-bar').hidden = n < 1 || S.tab === 'compare';
  $('#compare-bar-text').textContent = `Đã chọn ${n} sản phẩm để so sánh`;
}

function renderCompare() {
  const items = [...S.compare].map((id) => findItem(id)).filter(Boolean);
  if (!items.length) {
    $('#compare').innerHTML = '<div class="empty-state"><h2>Chưa chọn sản phẩm</h2><p>Tick ô ⇄ ở đầu mỗi dòng (tối đa 6) để so sánh giá, giá/100g, thành phần, độ tuổi và cách bảo quản cạnh nhau.</p></div>';
    return;
  }
  const minOf = (key) => Math.min(...items.map((i) => i[key]).filter((v) => v != null));
  const bestP100 = minOf('pricePer100VND');
  const bestPrice = minOf('priceVND');
  const row = (label, fn, bestFn) => `<tr><th>${label}</th>${items.map((it) => `<td class="${bestFn?.(it) ? 'best' : ''}">${fn(it) ?? '<span class="na">—</span>'}</td>`).join('')}</tr>`;
  $('#compare').innerHTML = `
    <div class="view-head"><div><h2>So sánh ${items.length} sản phẩm</h2><p class="muted">Ô xanh = tốt nhất trong nhóm (giá thấp nhất, giá/100g thấp nhất).</p></div>
      <div class="row-actions"><button class="btn ghost" id="compare-export">Xuất CSV</button><button class="btn ghost" data-cmp-clear>Bỏ chọn tất cả</button></div></div>
    <div class="cmp-wrap"><table class="cmp"><tbody>
      ${row('', (it) => `${img(it.image, 'thumb', it.title)}<div class="p-title" style="margin-top:6px">${esc(it.title)}</div><div class="act" style="margin-top:4px"><button class="btn small ghost" data-cmp-open="${it.id}">Chi tiết</button><button class="btn small ghost" data-cmp-remove="${it.id}">Bỏ</button></div>`)}
      ${row('Giá (VNĐ)', (it) => (it.priceVND != null ? `<b>${fmtVND(it.priceVND)}</b>${it.currency !== 'VND' ? `<div class="small muted">${fmtMoney(it.price, it.currency)}</div>` : ''}` : null), (it) => it.priceVND === bestPrice)}
      ${row('Giá/100g', (it) => (it.pricePer100VND ? fmtVND(it.pricePer100VND) : null), (it) => it.pricePer100VND === bestP100)}
      ${row('Quy cách', (it) => (it.qty ? esc(it.qty.label) : null))}
      ${row('Thương hiệu', (it) => (it.brand ? esc(it.brand) : null))}
      ${row('Thị trường', (it) => marketHtml(it))}
      ${row('Nguồn', (it) => sourceHtml(it))}
      ${row('Độ tuổi', (it) => (it.ageMonths != null ? ageLabel(it.ageMonths) : it.sections?.age ? esc(it.sections.age) : null))}
      ${row('Loại', (it) => (it.type ? esc(it.type) : null))}
      ${row('Nhãn', (it) => (it.claims?.length ? it.claims.map((c) => `<span class="tag claim">${esc(c)}</span>`).join(' ') : null))}
      ${row('Dị ứng', (it) => (it.allergens?.length ? it.allergens.map((c) => `<span class="tag allergen">${esc(c)}</span>`).join(' ') : null))}
      ${row('Đánh giá / bán', (it) => (it.rating || it.sold ? rateHtml(it) : null))}
      ${Object.entries(SECTION_LABELS).map(([k, label]) => (items.some((it) => viewSections(it).s[k]) ? row(label, (it) => {
        const { s: vs, notes } = viewSections(it);
        return vs[k] ? `<span class="small">${esc(vs[k])}</span>${notes[k] ? `<div class="src-note">theo ${esc(notes[k])}</div>` : ''}` : null;
      }) : '')).join('')}
      ${row('Link', (it) => (it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">Mở trang ↗</a>` : null))}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------- insights

function priceBins(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = quantile(sorted, 0.95);
  const lo = sorted[0];
  const step = niceStep(Math.max(1000, (p95 - lo) / 10));
  const start = Math.floor(lo / step) * step;
  const bins = [];
  for (let x = start; x <= p95; x += step) bins.push({ x0: x, x1: x + step, value: 0 });
  if (!bins.length) bins.push({ x0: start, x1: start + step, value: 0 });
  const last = bins.at(-1);
  let overflow = 0;
  for (const v of sorted) {
    const b = bins.find((x) => v >= x.x0 && v < x.x1);
    if (b) b.value++;
    else if (v >= last.x1) overflow++;
    else bins[0].value++;
  }
  if (overflow) bins.push({ x0: last.x1, x1: Infinity, value: overflow });
  return bins.map((b) => ({
    ...b,
    label: b.x1 === Infinity ? `≥${fmtShortVND(b.x0)}` : fmtShortVND(b.x0),
    tip: `<b>${b.x1 === Infinity ? `Từ ${fmtVND(b.x0)}` : `${fmtVND(b.x0)} – ${fmtVND(b.x1)}`}</b><br>${b.value} sản phẩm`,
  }));
}

function groupStats(list, key, valueKey = 'priceVND') {
  const m = new Map();
  for (const it of list) {
    const k = key(it);
    if (!k) continue;
    const g = m.get(k) || { key: k, n: 0, prices: [] };
    g.n++;
    if (it[valueKey] != null) g.prices.push(it[valueKey]);
    m.set(k, g);
  }
  for (const g of m.values()) {
    g.prices.sort((a, b) => a - b);
    g.median = quantile(g.prices, 0.5);
  }
  return [...m.values()];
}

function renderInsights() {
  const box = $('#insights');
  if (!S.items.size) {
    box.innerHTML = '<div class="empty-state"><h2>Chưa có dữ liệu</h2><p>Hãy tìm một sản phẩm trước. Tổng quan sẽ phân tích giá, thương hiệu, thị trường và nhu cầu từ các kết quả (theo bộ lọc hiện tại).</p></div>';
    return;
  }
  const { list } = filtered();
  const products = list.filter((i) => i.kind !== 'web');
  const priced = list.filter((i) => i.priceVND != null);
  const prices = priced.map(priceOf).sort((a, b) => a - b);
  const p100 = list.filter((i) => i.pricePer100VND).map((i) => i.pricePer100VND).sort((a, b) => a - b);
  const brands = groupStats(list, (i) => i.brand).sort((a, b) => b.n - a.n);
  const countries = groupStats(priced, (i) => i.country).sort((a, b) => b.n - a.n);
  const types = groupStats(list, (i) => i.type).sort((a, b) => b.n - a.n);
  const sources = groupStats(list, (i) => S.srcName[i.source] || i.source).sort((a, b) => b.n - a.n);
  const ages = groupStats(list.filter((i) => i.ageMonths != null), (i) => ageLabel(i.ageMonths)).sort((a, b) => b.n - a.n);
  const claimCounts = CLAIMS.map((c) => ({ label: c, value: list.filter((i) => i.claims?.includes(c)).length })).filter((c) => c.value);
  const best = list.filter((i) => i.sold).sort((a, b) => b.sold - a.sold).slice(0, 10);
  const p33 = quantile(prices, 0.33);
  const p67 = quantile(prices, 0.67);

  // Brand x country price-per-100g (fairer than raw price across pack sizes) for import opportunities.
  const opp = [];
  for (const b of brands.slice(0, 40)) {
    const rows = list.filter((i) => i.brand === b.key && i.pricePer100VND);
    const byC = groupStats(rows, (i) => i.country, 'pricePer100VND');
    const vn = byC.find((g) => g.key === 'vn');
    const abroad = byC.filter((g) => g.key !== 'vn' && g.key !== 'world' && g.median);
    if (vn?.median && abroad.length) {
      const cheapest = abroad.sort((a, b) => a.median - b.median)[0];
      opp.push({ brand: b.key, vn: vn.median, vnN: vn.prices.length, other: cheapest, diff: ((vn.median - cheapest.median) / cheapest.median) * 100 });
    }
  }
  opp.sort((a, b) => b.diff - a.diff);

  const insights = [];
  if (prices.length >= 3) {
    insights.push(`Khoảng giá phổ biến (giữa 50% sản phẩm): <b>${fmtVND(quantile(prices, 0.25))} – ${fmtVND(quantile(prices, 0.75))}</b>.`);
    insights.push(`Phân khúc: <b>bình dân</b> dưới ${fmtShortVND(p33)}, <b>trung cấp</b> ${fmtShortVND(p33)}–${fmtShortVND(p67)}, <b>cao cấp</b> trên ${fmtShortVND(p67)}.`);
  }
  if (brands[0]) insights.push(`Thương hiệu xuất hiện nhiều nhất: <b>${esc(brands[0].key)}</b> (${brands[0].n} kết quả${brands[0].median ? `, giá trung vị ${fmtShortVND(brands[0].median)}` : ''})${brands[1] ? `, tiếp theo là <b>${esc(brands[1].key)}</b> (${brands[1].n})` : ''}.`);
  const vnC = countries.find((c) => c.key === 'vn');
  for (const c of countries.filter((x) => x.key !== 'vn' && x.key !== 'world' && x.prices.length >= 3).slice(0, 3)) {
    if (vnC?.median) {
      const d = ((vnC.median - c.median) / c.median) * 100;
      insights.push(`Giá trung vị tại Việt Nam ${d >= 0 ? 'cao hơn' : 'thấp hơn'} ${esc(countryName(c.key))} <b>${fmtNum(Math.abs(d))}%</b> (${fmtShortVND(vnC.median)} so với ${fmtShortVND(c.median)}, đã quy đổi).`);
    }
  }
  if (claimCounts.length) {
    const top = [...claimCounts].sort((a, b) => b.value - a.value)[0];
    insights.push(`Công bố phổ biến nhất: <b>${esc(top.label)}</b> — ${fmtNum((top.value / list.length) * 100)}% kết quả.`);
  }
  if (ages[0]) insights.push(`Độ tuổi được nhắm nhiều nhất: <b>${esc(ages[0].key)}</b> (${ages[0].n} sản phẩm).`);
  if (best[0]) insights.push(`Bán chạy nhất (theo số đã bán trên sàn): <b>${esc(best[0].title)}</b> — ${fmtCompact(best[0].sold)} lượt, ${fmtVND(best[0].priceVND)}.`);
  if (opp[0] && opp[0].diff > 15) insights.push(`Chênh lệch giá/100g lớn nhất: <b>${esc(opp[0].brand)}</b> ở Việt Nam đắt hơn ${esc(countryName(opp[0].other.key))} <b>${fmtNum(opp[0].diff)}%</b> — cân nhắc nhập khẩu/xách tay.`);

  box.innerHTML = `
    <div class="view-head"><div><h2>Tổng quan thị trường: “${esc(S.q)}”</h2>
      <p class="muted">Phân tích ${fmtNum(list.length)} kết quả đang hiển thị (theo bộ lọc ở tab Kết quả). Giá đã quy đổi VNĐ theo tỷ giá ${esc(S.meta.rates?.source || '')}.</p></div></div>
    <div class="stats">
      <div class="stat"><div class="label">Sản phẩm (kênh bán + CSDL)</div><div class="value">${fmtNum(products.length)}</div><div class="hint">+ ${fmtNum(list.length - products.length)} trang web/bài viết</div></div>
      <div class="stat"><div class="label">Có giá</div><div class="value">${fmtNum(priced.length)}</div><div class="hint">${list.length ? fmtNum((priced.length / list.length) * 100) : 0}% kết quả</div></div>
      <div class="stat"><div class="label">Thương hiệu</div><div class="value">${fmtNum(brands.length)}</div><div class="hint">${countries.length} quốc gia có giá</div></div>
      <div class="stat"><div class="label">Giá trung vị</div><div class="value">${prices.length ? fmtShortVND(quantile(prices, 0.5)) : '—'}</div><div class="hint">${prices.length ? `${fmtShortVND(prices[0])} – ${fmtShortVND(prices.at(-1))}` : ''}</div></div>
      <div class="stat"><div class="label">Giá/100g trung vị</div><div class="value">${p100.length ? fmtShortVND(quantile(p100, 0.5)) : '—'}</div><div class="hint">${p100.length} SP có quy cách</div></div>
    </div>
    ${insights.length ? `<div class="panel" style="margin-top:14px"><h3>Nhận định nhanh</h3><ul class="insight-list">${insights.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}
    <div class="panels">
      <div class="panel"><h3>Phân bố giá <span class="muted">số sản phẩm theo khoảng giá (VNĐ)</span></h3><div id="ch-price"></div></div>
      <div class="panel"><h3>Giá trung vị theo quốc gia <span class="muted">VNĐ, đã quy đổi</span></h3><div id="ch-country"></div></div>
      <div class="panel"><h3>Thương hiệu xuất hiện nhiều nhất <span class="muted">số kết quả · bấm để lọc</span></h3><div id="ch-brand"></div></div>
      <div class="panel"><h3>Loại sản phẩm <span class="muted">số kết quả</span></h3><div id="ch-type"></div></div>
      <div class="panel"><h3>Độ tuổi khuyến nghị <span class="muted">số sản phẩm</span></h3><div id="ch-age"></div></div>
      <div class="panel"><h3>Nhãn / công bố <span class="muted">số kết quả</span></h3><div id="ch-claim"></div></div>
      <div class="panel"><h3>Bán chạy nhất trên sàn <span class="muted">theo số lượt đã bán</span></h3>
        ${best.length ? `<table class="simple"><thead><tr><th></th><th>Sản phẩm</th><th class="num">Giá</th><th class="num">Đã bán</th></tr></thead><tbody>
        ${best.map((it) => `<tr data-open="${it.id}" style="cursor:pointer"><td>${img(it.image, 'mini-thumb')}</td><td>${esc(it.title)}<div class="small muted">${esc(S.srcName[it.source])}${it.brand ? ` · ${esc(it.brand)}` : ''}</div></td><td class="num">${fmtShortVND(it.priceVND)}</td><td class="num">${fmtCompact(it.sold)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted small">Chưa có dữ liệu lượt bán (có từ Tiki, Lazada).</p>'}
      </div>
      <div class="panel"><h3>Cơ hội nhập khẩu <span class="muted">giá/100g trung vị: VN so với nước rẻ nhất</span></h3>
        ${opp.length ? `<table class="simple"><thead><tr><th>Thương hiệu</th><th class="num">VN /100g</th><th>Rẻ nhất ở</th><th class="num">/100g</th><th class="num">VN đắt hơn</th></tr></thead><tbody>
        ${opp.slice(0, 10).map((o) => `<tr><td><b>${esc(o.brand)}</b></td><td class="num">${fmtShortVND(o.vn)}</td><td>${flag(o.other.key)} ${esc(countryName(o.other.key))}</td><td class="num">${fmtShortVND(o.other.median)}</td><td class="num ${o.diff > 0 ? 'delta-up' : 'delta-down'}">${fmtPct(o.diff)}</td></tr>`).join('')}
        </tbody></table><p class="muted small">Chưa gồm phí vận chuyển, thuế nhập khẩu. Chọn thêm thị trường (Mỹ, Nhật, Úc…) để có nhiều điểm so sánh hơn.</p>`
        : '<p class="muted small">Cần kết quả của cùng thương hiệu ở Việt Nam và ít nhất một thị trường khác (có quy cách gram/ml). Hãy chọn thêm thị trường như Mỹ, Nhật, Úc rồi tìm lại.</p>'}
      </div>
      <div class="panel"><h3>Độ phủ theo nguồn <span class="muted">số kết quả</span></h3><div id="ch-source"></div></div>
    </div>`;

  if (prices.length >= 2) columns($('#ch-price'), priceBins(prices), { format: (v) => `${v} SP`, yFormat: (v) => fmtNum(v) });
  else $('#ch-price').innerHTML = '<p class="muted small">Cần ít nhất 2 sản phẩm có giá.</p>';
  hbar($('#ch-country'), countries.filter((c) => c.median).slice(0, 12).map((c) => ({
    label: countryName(c.key), value: c.median, display: fmtShortVND(c.median),
    tip: `<b>${esc(countryName(c.key))}</b><br>Trung vị ${fmtVND(c.median)}<br>Thấp nhất ${fmtVND(c.prices[0])} · cao nhất ${fmtVND(c.prices.at(-1))}<br>${c.prices.length} SP có giá`,
  })));
  hbar($('#ch-brand'), brands.slice(0, 12).map((b) => ({
    label: b.key, value: b.n, display: String(b.n),
    tip: `<b>${esc(b.key)}</b><br>${b.n} kết quả${b.median ? `<br>Giá trung vị ${fmtVND(b.median)}` : ''}`,
  })), { onClick: (r) => { $('#f-text').value = r.label; switchTab('results'); scheduleRender(true); } });
  hbar($('#ch-type'), types.slice(0, 10).map((t) => ({
    label: t.key, value: t.n, display: String(t.n),
    tip: `<b>${esc(t.key)}</b><br>${t.n} kết quả${t.median ? `<br>Giá trung vị ${fmtVND(t.median)}` : ''}`,
  })));
  hbar($('#ch-age'), ages.sort((a, b) => parseInt(a.key, 10) - parseInt(b.key, 10)).map((a) => ({ label: a.key, value: a.n, display: String(a.n) })));
  hbar($('#ch-claim'), claimCounts.sort((a, b) => b.value - a.value).map((c) => ({ ...c, display: String(c.value) })));
  hbar($('#ch-source'), sources.map((s) => ({ label: s.key, value: s.n, display: String(s.n) })));
}

// ---------------------------------------------------------------- watchlist

async function refreshWatch() {
  try {
    S.watch = await api('/api/watchlist');
  } catch {
    S.watch = [];
  }
  $('#cnt-watch').textContent = S.watch.length || '';
  if (S.tab === 'watch') renderWatch();
}

async function toggleWatch(id) {
  const it = findItem(id);
  if (!it) return;
  if (isWatched(id)) {
    await api(`/api/watchlist/${id}`, { method: 'DELETE' });
    toast('Đã bỏ theo dõi');
  } else {
    await api('/api/watchlist', { method: 'POST', body: { item: it } });
    toast('Đã thêm vào danh sách theo dõi');
  }
  await refreshWatch();
  renderResults();
  if (drawerId === id) renderDrawer(findItem(id));
}

function renderWatch() {
  const box = $('#watch');
  if (!S.watch.length) {
    box.innerHTML = '<div class="empty-state"><h2>Chưa theo dõi sản phẩm nào</h2><p>Bấm ☆ ở mỗi kết quả để lưu sản phẩm tiềm năng. Bạn có thể ghi chú nhà cung cấp, giá nhập, giá bán dự kiến và cập nhật giá định kỳ.</p></div>';
    return;
  }
  box.innerHTML = `<div class="watch-list">${S.watch.map((w) => {
    const it = w.item;
    const hist = (w.history || []).filter((h) => h.priceVND != null).map((h) => ({ t: h.t, v: h.priceVND }));
    const first = hist[0]?.v;
    const change = first && it.priceVND ? ((it.priceVND - first) / first) * 100 : 0;
    const margin = w.targetPrice && w.cost ? ((w.targetPrice - w.cost) / w.targetPrice) * 100 : null;
    const vsMarket = w.targetPrice && it.priceVND ? ((w.targetPrice - it.priceVND) / it.priceVND) * 100 : null;
    return `<div class="w-item" data-wid="${w.id}">
      <div>${img(it.image, 'thumb', it.title)}</div>
      <div>
        <div class="p-title" data-open="${w.id}" style="cursor:pointer">${esc(it.title)}</div>
        <div class="p-sub">${esc(S.srcName[it.source] || it.source)}${it.brand ? ` · ${esc(it.brand)}` : ''} · ${flag(it.country)} ${esc(countryName(it.country))}</div>
        <div style="margin-top:6px">${priceHtml(it)}</div>
        <div class="small muted" style="margin-top:4px">
          ${hist.length > 1 ? `${sparkline(hist)} <span class="${change > 0 ? 'delta-down' : change < 0 ? 'delta-up' : ''}">${change ? fmtPct(change, 1) : 'không đổi'}</span> từ khi lưu · ` : ''}
          Lưu ${timeAgo(w.savedAt)}${w.checkedAt ? ` · cập nhật ${timeAgo(w.checkedAt)}` : ''}
        </div>
        <div class="row-actions" style="margin-top:8px">
          <button class="btn small ghost" data-wact="refresh">Cập nhật giá</button>
          ${it.url ? `<a class="btn small ghost" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">Mở ↗</a>` : ''}
          <button class="btn small ghost" data-wact="compare">${S.compare.has(w.id) ? '✓ So sánh' : '⇄ So sánh'}</button>
          <button class="btn small ghost" data-wact="remove">Xoá</button>
        </div>
      </div>
      <div class="w-fields">
        <label>Trạng thái<select data-wf="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${w.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Nhà cung cấp<input data-wf="supplier" value="${esc(w.supplier || '')}" placeholder="Tên / liên hệ"></label>
        <label>Giá nhập dự kiến (₫)<input type="number" min="0" step="1000" data-wf="cost" value="${w.cost ?? ''}"></label>
        <label>Giá bán dự kiến (₫)<input type="number" min="0" step="1000" data-wf="targetPrice" value="${w.targetPrice ?? ''}"></label>
        <div class="margin-box">${margin != null ? `Biên lợi nhuận gộp: <b class="${margin >= 0 ? 'delta-up' : 'delta-down'}">${fmtNum(margin, 1)}%</b>` : 'Nhập giá nhập & giá bán để tính biên lợi nhuận'}${vsMarket != null ? ` · Giá bán ${vsMarket >= 0 ? 'cao hơn' : 'thấp hơn'} giá đang bán <b>${fmtNum(Math.abs(vsMarket), 1)}%</b>` : ''}</div>
        <textarea data-wf="note" placeholder="Ghi chú: MOQ, hạn dùng, chứng nhận, phản hồi khách…">${esc(w.note || '')}</textarea>
      </div>
    </div>`;
  }).join('')}</div>`;
}

const saveWatchField = debounce(async (id, field, value) => {
  const body = { [field]: ['cost', 'targetPrice'].includes(field) ? (value === '' ? null : Number(value)) : value };
  const entry = await api(`/api/watchlist/${id}`, { method: 'PATCH', body });
  const i = S.watch.findIndex((w) => w.id === id);
  if (i >= 0) S.watch[i] = entry;
  if (['cost', 'targetPrice'].includes(field)) {
    const el = $(`[data-wid="${id}"] .margin-box`);
    if (el) {
      const w = S.watch[i];
      const it = w.item;
      const margin = w.targetPrice && w.cost ? ((w.targetPrice - w.cost) / w.targetPrice) * 100 : null;
      const vs = w.targetPrice && it.priceVND ? ((w.targetPrice - it.priceVND) / it.priceVND) * 100 : null;
      el.innerHTML = `${margin != null ? `Biên lợi nhuận gộp: <b class="${margin >= 0 ? 'delta-up' : 'delta-down'}">${fmtNum(margin, 1)}%</b>` : 'Nhập giá nhập & giá bán để tính biên lợi nhuận'}${vs != null ? ` · Giá bán ${vs >= 0 ? 'cao hơn' : 'thấp hơn'} giá đang bán <b>${fmtNum(Math.abs(vs), 1)}%</b>` : ''}`;
    }
  }
}, 500);

function exportWatch() {
  const head = ['Tên sản phẩm', 'Thương hiệu', 'Nguồn', 'Quốc gia', 'Giá hiện tại (VNĐ)', 'Giá nguyên tệ', 'Tiền tệ', 'Trạng thái', 'Nhà cung cấp', 'Giá nhập', 'Giá bán dự kiến', 'Biên LN %', 'Ghi chú', 'Link', 'Ngày lưu'];
  const rows = S.watch.map((w) => {
    const it = w.item;
    const m = w.targetPrice && w.cost ? (((w.targetPrice - w.cost) / w.targetPrice) * 100).toFixed(1) : '';
    return [it.title, it.brand, S.srcName[it.source], countryName(it.country), it.priceVND, it.price, it.currency, STATUS[w.status], w.supplier, w.cost, w.targetPrice, m, w.note, it.url, new Date(w.savedAt).toLocaleString('vi-VN')];
  });
  download(`theo-doi-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([head, ...rows]), 'text/csv;charset=utf-8');
}

// ---------------------------------------------------------------- keywords

async function runKeywords(q) {
  q = q.trim();
  if (!q) return;
  $('#kw-q').value = q;
  const box = $('#keywords');
  box.innerHTML = '<div class="panel"><div class="skeleton" style="height:16px;width:40%"></div><div class="skeleton" style="height:120px;margin-top:12px"></div></div>';
  try {
    const d = await api(`/api/keywords?q=${encodeURIComponent(q)}`);
    const max = Math.max(1, ...d.terms.map((t) => t.count));
    box.innerHTML = `
      <div class="panels" style="margin-top:0">
        <div class="panel"><h3>Từ đi kèm phổ biến <span class="muted">số gợi ý chứa từ · bấm để tìm</span></h3>
          ${d.terms.length ? `<div class="kw-terms">${d.terms.map((t) => `<div class="kw-term" data-kw="${esc(`${q} ${t.term}`)}" title="Tìm “${esc(`${q} ${t.term}`)}”"><span>${esc(t.term)}</span><div class="kw-bar" style="width:${(t.count / max) * 100}%"></div><span class="tnum muted">${t.count}</span></div>`).join('')}</div>` : '<p class="muted">Không có gợi ý.</p>'}
        </div>
        <div class="panel"><h3>Tổng quan <span class="muted">${d.total} cụm từ khác nhau</span></h3>
          <p class="muted small">Các từ đi kèm cho thấy người mua quan tâm điều gì (độ tuổi, thương hiệu, thành phần, nơi mua, giá…). Dùng chúng để đặt tên sản phẩm, viết mô tả và chọn từ khóa quảng cáo.</p>
          <div>${d.groups.flatMap((g) => g.suggestions).slice(0, 30).map((s) => `<span class="kw-chip" data-kw="${esc(s)}">${esc(s)}</span>`).join('')}</div>
        </div>
      </div>
      <h3 style="margin:18px 0 10px">Gợi ý theo nhóm</h3>
      <div class="kw-groups">${d.groups.map((g) => `<div class="panel"><h3>${esc(g.seed)}</h3>${g.suggestions.map((s) => `<span class="kw-chip" data-kw="${esc(s)}">${esc(s)}</span>`).join('')}</div>`).join('')}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="panel muted">Không lấy được gợi ý: ${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------- history

async function renderHistory() {
  const box = $('#history');
  const h = await api('/api/history').catch(() => []);
  box.innerHTML = h.length ? h.map((e) => `<div class="h-item" data-hq="${esc(e.q)}" data-hm="${esc(e.markets.join(','))}">
    <div><div class="h-q">${esc(e.q)}</div><div class="small muted">${e.markets.map((m) => `${flag(m)} ${esc(marketName(m))}`).join(' &nbsp;')}</div></div>
    <div class="small muted" style="text-align:right">${fmtNum(e.count)} kết quả<br>${timeAgo(e.t)}</div>
  </div>`).join('') : '<div class="empty-state"><h2>Chưa có lịch sử</h2></div>';
}

// ---------------------------------------------------------------- export

function toCSV(rows, sep = ',') {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return sep === ',' && /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s.replace(/[\t\n\r]+/g, ' ');
  };
  return (sep === ',' ? '﻿' : '') + rows.map((r) => r.map(cell).join(sep)).join('\r\n');
}

function exportRows(list) {
  const head = ['Tên sản phẩm', 'Thương hiệu', 'Nguồn', 'Người bán', 'Quốc gia', 'Thị trường tìm', 'Giá nguyên tệ', 'Tiền tệ', 'Giá VNĐ', 'Giá niêm yết VNĐ', 'Giảm %', 'Quy cách', 'Giá/100g VNĐ', 'Độ tuổi (tháng)', 'Loại', 'Nhãn', 'Dị ứng', 'Đánh giá', 'Lượt đánh giá', 'Đã bán', 'Thành phần', 'Cách dùng', 'Bảo quản', 'Xuất xứ', 'Hạn sử dụng', 'Nguồn thành phần/bảo quản', 'Mô tả', 'Link', 'Ảnh'];
  const rows = list.map((it) => {
    const { s, notes } = viewSections(it);
    const srcNote = ['ingredients', 'storage'].filter((k) => s[k]).map((k) => `${SECTION_LABELS[k]}: ${notes[k] || 'trang sản phẩm'}`).join('; ');
    return [it.title, it.brand, S.srcName[it.source], it.seller, it.countries?.length > 1 ? it.countries.map(countryName).join('; ') : countryName(it.country), marketName(it.market),
      it.price, it.currency, it.priceVND, it.originalPriceVND, it.discount, it.qty?.label, it.pricePer100VND, it.ageMonths, it.type,
      (it.claims || []).join('; '), (it.allergens || []).join('; '), it.rating, it.reviews, it.sold, s.ingredients, s.usage, s.storage,
      s.origin, s.expiry, srcNote, it.description || it.snippet, it.url, it.image];
  });
  return [head, ...rows];
}

async function doExport(kind) {
  const { list } = filtered();
  const name = `an-dam-${fold(S.q).replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
  if (kind === 'csv') download(`${name}.csv`, toCSV(exportRows(list)), 'text/csv;charset=utf-8');
  if (kind === 'json') download(`${name}.json`, JSON.stringify(list, null, 2), 'application/json');
  if (kind === 'tsv') {
    await navigator.clipboard.writeText(toCSV(exportRows(list), '\t'));
    toast(`Đã copy ${list.length} dòng — dán vào Google Sheets/Excel`);
  }
}

// ---------------------------------------------------------------- suggest (autocomplete)

let sugIndex = -1;
const hideSuggest = () => {
  $('#suggest').hidden = true;
  sugIndex = -1;
};
const fetchSuggest = debounce(async (q) => {
  if (q.length < 2 || document.activeElement !== $('#q')) return hideSuggest();
  const list = await api(`/api/suggest?q=${encodeURIComponent(q)}`).catch(() => []);
  if ($('#q').value.trim() !== q || !list.length) return hideSuggest();
  const fq = fold(q);
  $('#suggest').innerHTML = list.slice(0, 8).map((s, i) => {
    const fs = fold(s);
    const html = fs.startsWith(fq) ? `${esc(s.slice(0, q.length))}<mark>${esc(s.slice(q.length))}</mark>` : esc(s);
    return `<li role="option" data-i="${i}" data-value="${esc(s)}">${html}</li>`;
  }).join('');
  $('#suggest').hidden = false;
  sugIndex = -1;
}, 160);

// ---------------------------------------------------------------- import opportunities (NKCN check)

const IMP_CLASSES = {
  absent: ['Chưa có tại VN', 'Không thấy thương hiệu lẫn sản phẩm trên các kênh VN'],
  brand: ['Hãng có, SP chưa', 'Thương hiệu đã bán tại VN nhưng chưa thấy sản phẩm này'],
  partial: ['Có bán, chưa đủ chuẩn NKCN', 'Có tin bán tại VN nhưng chưa đủ 2 chuỗi lớn + tên nhà nhập khẩu (thường là xách tay/nhỏ lẻ)'],
  nkcn: ['Đã NKCN', 'Có ở ≥2 chuỗi mẹ & bé lớn và có tên nhà nhập khẩu/phân phối'],
};
const WEST = ['vn', 'us', 'ca', 'gb', 'de', 'fr', 'it', 'es', 'nl', 'au'];
S.imp = { results: new Map(), running: false, total: 0, filter: '', importers: [], ctrl: null, best: [], bestMarkets: [], bestLoading: false };
const BEST_PER_MARKET = 10;

// Foreign product rows from the current results (respecting the Results tab filters), one per product.
function importCandidates() {
  const { list } = filtered();
  const seen = new Set();
  const perMarket = {};
  // Best sellers first (top 10 per country, already limited to the baby-food category), then search results.
  const best = S.imp.best.filter((it) => !it.nonFood && S.markets.includes(it.market) && (perMarket[it.market] = (perMarket[it.market] || 0) + 1) <= BEST_PER_MARKET);
  return [...best, ...list].filter((it) => {
    if (it.kind === 'web' || it.nonFood || it.market === 'vn' || it.country === 'vn') return false;
    // Shop searches also return unrelated groceries (Marmite for "puffs"…): keep products made for babies.
    const forBabies = it.bestseller || it.ageMonths != null || it.source === 'off' // OFF hits are already limited to the baby-foods category
      || /(baby|babies|infant|toddler|kids?|months?|stage [1-4]|bébé|kinder|beikost)|離乳|ベビー|아기|이유식|trẻ em|cho bé/i.test(it.title);
    if (!forBabies) return false;
    const key = it.gtin || fold(`${it.brand || ''} ${it.title}`).replace(/d+s*(g|ml|oz)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
}

async function loadBestsellers() {
  if (S.imp.bestLoading) return;
  const supported = S.meta.bestsellerMarkets || [];
  const markets = S.markets.filter((m) => m !== 'vn' && supported.includes(m));
  if (!markets.length) {
    toast('Hãy chọn thị trường nước ngoài (nút Âu–Mỹ–Úc hoặc Tất cả) — hiện hỗ trợ: ' + supported.map((m) => m.toUpperCase()).join(', '), 5500);
    return;
  }
  S.imp.bestLoading = true;
  $('#imp-best').disabled = true;
  $('#imp-best').textContent = 'Đang lấy bán chạy…';
  try {
    const r = await (await fetch('/api/bestsellers?markets=' + markets.join(','))).json();
    S.imp.best = r.items || [];
    S.imp.bestMarkets = markets;
    const ok = new Set(S.imp.best.map((i) => i.market));
    toast(`Đã lấy ${S.imp.best.length} sản phẩm bán chạy từ ${ok.size}/${markets.length} nước${r.failed?.length ? ` (lỗi: ${r.failed.map((f) => f.market.toUpperCase()).join(', ')})` : ''} — bấm Phân tích`, 5500);
  } catch (e) {
    toast('Không lấy được danh sách bán chạy: ' + e.message);
  } finally {
    S.imp.bestLoading = false;
    $('#imp-best').disabled = false;
    $('#imp-best').textContent = 'Lấy bán chạy theo nước';
    renderImport();
  }
}

async function runImportCheck() {
  const items = importCandidates();
  if (!items.length) {
    toast('Chưa có sản phẩm nước ngoài trong kết quả. Hãy chọn thêm thị trường (nút Âu–Mỹ–Úc) rồi tìm kiếm.', 5000);
    return;
  }
  S.imp.ctrl?.abort();
  const ctrl = new AbortController();
  Object.assign(S.imp, { stopped: false, results: new Map(), running: true, total: items.length, importers: [], ctrl, t0: performance.now() });
  renderImport();
  const slim = items.map((it) => ({
    id: it.id, title: it.title, brand: it.brand, image: it.image, url: it.url, country: it.country, market: it.market, gtin: it.gtin,
    priceVND: it.priceVND, price: it.price, currency: it.currency, rating: it.rating, reviews: it.reviews, sold: it.sold, source: it.source, qty: it.qty, rank: it.rank,
  }));
  try {
    const res = await fetch('/api/import-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: slim }), signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (msg.type === 'result') S.imp.results.set(msg.result.id, msg.result);
        if (msg.type === 'done') S.imp.importers = msg.importers || [];
        renderImportSoon();
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Lỗi phân tích: ${e.message}`);
  } finally {
    if (S.imp.ctrl === ctrl) S.imp.running = false;
    renderImport();
    renderImporterDirectory();
  }
}
const renderImportSoon = debounce(() => renderImport(), 150);

// ---- Opportunity score: transparent sum of demand signals × how open the Vietnamese market still is ----

const CLASS_WEIGHT = { absent: 1, brand: 0.9, partial: 0.8, nkcn: 0.2 };
const log10p = (n) => Math.log10(1 + (n || 0));

// The same product sold elsewhere in the current results: how many countries and retailers carry it.
function impBreadth(r) {
  const p = r.product;
  const brand = fold(p.brand || '');
  if (!brand) return { markets: 1, retailers: 1 };
  const t = nameTokens({ title: p.title, brand: p.brand });
  const markets = new Set([p.country]);
  const retailers = new Set([p.source]);
  for (const it of allItems()) {
    if (it.kind === 'web' || it.market === 'vn' || fold(it.brand || '') !== brand) continue;
    if (similarity(t, nameTokens(it)) < 0.5) continue;
    markets.add(it.country);
    retailers.add(it.seller || it.source);
  }
  return { markets: markets.size, retailers: retailers.size };
}

function impOpportunity(r) {
  if (r._opp) return r._opp;
  const p = r.product;
  const parts = [];
  const add = (label, pts, detail) => {
    if (pts > 0.4) parts.push([label, Math.round(pts), detail]);
  };
  add('Đánh giá ở nước ngoài', Math.min(30, 7.5 * log10p(p.reviews)), p.reviews ? `${fmtCompact(p.reviews)} đánh giá` : '');
  add('Hạng bán chạy', p.rank ? Math.max(0, Math.min(15, 17 - p.rank)) : 0, p.rank ? `#${p.rank} nhóm đồ ăn dặm Amazon ${countryName(p.country)}` : '');
  add('Điểm sao', p.rating >= 4.5 ? 5 : p.rating >= 4 ? 3 : 0, p.rating ? `★ ${fmtNum(p.rating, 1)}` : '');
  const b = impBreadth(r);
  add('Độ phủ quốc tế', Math.min(15, 5 * (b.markets - 1) + 2 * (b.retailers - 1)), `${b.markets} nước, ${b.retailers} nhà bán trong kết quả`);
  if (r.class !== 'nkcn') {
    add('Nhu cầu tại VN (hàng xách tay/nhỏ lẻ)', Math.min(20, 5 * log10p(r.vn.sold) + 2 * Math.min(r.vn.listings, 5)), `${r.vn.listings} tin bán, ${fmtCompact(r.vn.sold || 0)} đã bán`);
    add('Tốc độ bán tại VN', Math.min(10, (r.history?.soldPerWeek || 0) / 10), r.history?.soldPerWeek ? `~${fmtCompact(r.history.soldPerWeek)}/tuần` : '');
  }
  add('Người Việt tìm thương hiệu', Math.min(10, 2 * (r.interest?.suggestions || 0)), r.interest?.sample?.length ? `gợi ý: “${r.interest.sample.slice(0, 2).join('”, “')}”` : '');
  if (p.priceVND && r.vn.minPriceVND && r.vn.minPriceVND > p.priceVND) {
    const gap = (r.vn.minPriceVND - p.priceVND) / p.priceVND;
    add('Giá VN cao hơn giá gốc', Math.min(10, gap * 20), `+${fmtNum(gap * 100)}% (${fmtShortVND(p.priceVND)} → ${fmtShortVND(r.vn.minPriceVND)})`);
  }
  const demand = Math.min(100, parts.reduce((s, x) => s + x[1], 0));
  const weight = CLASS_WEIGHT[r.class] ?? 0.5;
  r._opp = { score: Math.round(demand * weight), demand, weight, parts };
  return r._opp;
}

const impScore = (r) => impOpportunity(r).score * 1e6 + (r.product.reviews || 0);

function oppCell(r) {
  const o = impOpportunity(r);
  return `<div class="opp"><b class="opp-n">${o.score}</b><div class="opp-bar"><span style="width:${o.score}%"></span></div></div>
    <details class="imp-matches"><summary>Vì sao?</summary>
      <div class="small">${o.parts.map(([l, pts, d]) => `<div>+${pts} ${esc(l)}${d ? ` <span class="muted">(${esc(d)})</span>` : ''}</div>`).join('') || '<div class="muted">Chưa có tín hiệu nhu cầu</div>'}
      <div class="muted">Nhu cầu ${o.demand}/100 × hệ số nhóm ${o.weight} = <b>${o.score}</b></div></div>
    </details>`;
}

// Brands with the most room: not officially imported yet, ranked by their best product's score.
function brandOpportunities(all) {
  const by = new Map();
  for (const r of all) {
    const k = fold(r.product.brand || '').replace(/[^a-z0-9]/g, '') || '(không rõ hãng)';
    const g = by.get(k) || { brand: r.product.brand || '(không rõ hãng)', items: [], best: 0, reviews: 0, classes: new Set(), importer: null };
    g.items.push(r);
    g.best = Math.max(g.best, impOpportunity(r).score);
    g.reviews += r.product.reviews || 0;
    g.classes.add(r.class);
    g.importer ||= r.importers[0] || r.brandImporter || null;
    by.set(k, g);
  }
  return [...by.values()].filter((g) => !g.classes.has('nkcn') || g.classes.size > 1).sort((a, b) => b.best - a.best).slice(0, 12);
}

async function renderImporterDirectory(q = $('#imp-dir-q')?.value || '') {
  const box = $('#imp-importers');
  if (!box) return;
  let rows = [];
  try {
    rows = await api(`/api/importers?q=${encodeURIComponent(q)}`);
  } catch { /* offline */ }
  const focused = document.activeElement?.id === 'imp-dir-q';
  box.innerHTML = `<div class="panel" style="margin-top:14px"><h3>Danh bạ nhà nhập khẩu / phân phối <span class="muted">tích lũy qua mọi lần phân tích · ${rows.length} mục</span></h3>
    <input type="search" id="imp-dir-q" placeholder="Tìm thương hiệu hoặc công ty…" value="${esc(q)}" style="width:280px;margin-bottom:8px">
    ${rows.length ? `<table class="simple"><thead><tr><th>Thương hiệu</th><th>Công ty</th><th>Thấy trên</th><th class="num">Số lần</th><th>Gần nhất</th></tr></thead><tbody>
    ${rows.slice(0, 200).map((x) => `<tr><td><b>${esc(x.brand)}</b></td><td>${esc(x.importer)}</td><td>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(S.srcName[x.source] || x.source || 'link')}</a>` : esc(x.source || '')}</td><td class="num">${x.seen}</td><td class="small muted">${timeAgo(x.lastSeen)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted small">Chưa có. Chạy phân tích để app đọc tên nhà nhập khẩu trên các trang bán tại VN.</p>'}</div>`;
  if (focused) {
    const el = $('#imp-dir-q');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function renderImport() {
  const all = [...S.imp.results.values()];
  $('#cnt-import').textContent = all.filter((r) => r.class !== 'nkcn').length || '';
  if (S.tab !== 'import') return;
  $('#imp-tracked').innerHTML = trackedHtml();
  const counts = Object.fromEntries(Object.keys(IMP_CLASSES).map((k) => [k, all.filter((r) => r.class === k).length]));
  const secs = ((performance.now() - (S.imp.t0 || performance.now())) / 1000).toFixed(0);
  const pendingN = S.imp.running ? all.filter((r) => r.pending?.length).length : 0;
  $('#imp-run').textContent = S.imp.running ? 'Dừng phân tích' : `Phân tích ${importCandidates().length} sản phẩm nước ngoài`;
  $('#imp-status').innerHTML = !S.imp.total
    ? `<span>Bước 1: tìm sản phẩm với các thị trường nước ngoài (nút <b>Âu–Mỹ–Úc</b>). Bước 2: bấm <b>Phân tích</b> — app tìm từng sản phẩm trên các kênh Việt Nam và phân loại.</span>`
    : `${S.imp.running ? '<span class="loading-dots">Đang kiểm tra</span>' : S.imp.stopped ? 'Đã dừng — đã kiểm tra' : 'Đã kiểm tra'} <b>${all.length}</b>/${S.imp.total} sản phẩm${S.imp.running ? ` · ${secs}s` : ''}${pendingN ? ` · đang bổ sung dữ liệu chậm (Lazada, trang chi tiết) cho <b>${pendingN}</b> SP — bảng tự cập nhật` : ''}`;
  $('#imp-filters').innerHTML = all.length ? [['', `Tất cả (${all.length})`], ...Object.entries(IMP_CLASSES).map(([k, [label]]) => [k, `${label} (${counts[k]})`])]
    .map(([k, label]) => `<button type="button" class="chip" data-imp-filter="${k}" aria-pressed="${S.imp.filter === k}" title="${esc(IMP_CLASSES[k]?.[1] || '')}">${k ? `<span class="cls ${k}">●</span>` : ''}${esc(label)}</button>`).join('') : '';
  const rows = all.filter((r) => !S.imp.filter || r.class === S.imp.filter).sort((a, b) => impScore(b) - impScore(a));
  $('#imp-results').innerHTML = rows.length ? `<div class="table-wrap"><table class="results imp"><thead><tr>
      <th class="c-img">Ảnh</th><th class="c-title">Sản phẩm (nước ngoài)</th><th style="width:150px">Điểm cơ hội</th><th>Kết luận tại VN</th><th>Bằng chứng tại VN</th><th class="c-price">Giá NN / VN</th>
    </tr></thead><tbody>${rows.map(impRow).join('')}</tbody></table></div>`
    : (S.imp.total && !S.imp.running ? '<div class="panel muted">Không có sản phẩm trong nhóm này.</div>' : '');
  const open = all.filter((r) => r.class !== 'nkcn').sort((a, b) => impScore(b) - impScore(a));
  const brands = brandOpportunities(all);
  $('#imp-summary').innerHTML = !S.imp.filter && open.length ? `<div class="panels" style="margin:0 0 14px">
    <div class="panel"><h3>Top cơ hội <span class="muted">điểm cao nhất, chưa NKCN</span></h3><div class="top-opps">${open.slice(0, 6).map((r) => `
      <div class="top-opp">${img(r.product.image, 'mini-thumb')}<div><div class="p-title small">${esc(r.product.title)}</div>
        <div class="small"><b>${impOpportunity(r).score}</b> điểm · <span class="cls ${r.class}">${esc(IMP_CLASSES[r.class][0])}</span></div></div></div>`).join('')}</div></div>
    <div class="panel"><h3>Thương hiệu tiềm năng <span class="muted">chưa NKCN, xếp theo SP tốt nhất</span></h3>
      <table class="simple"><thead><tr><th>Thương hiệu</th><th class="num">SP</th><th>Tình trạng tại VN</th><th class="num">Điểm</th></tr></thead><tbody>
      ${brands.map((g) => `<tr><td><b>${esc(g.brand)}</b>${g.importer ? `<div class="small muted">NPP: ${esc(g.importer)}</div>` : ''}</td><td class="num">${g.items.length}</td>
        <td>${[...g.classes].map((c) => `<span class="cls ${c}">${esc(IMP_CLASSES[c][0])}</span>`).join(' ')}</td><td class="num"><b>${g.best}</b></td></tr>`).join('')}
      </tbody></table></div></div>` : '';
}

// ---- Tracked products: sales history and re-checks ----

S.sales = { tracked: [], recheck: null, everyHours: 24, timer: null };
const isTracked = (id) => S.sales.tracked.some((t) => t.id === id);

async function refreshTracked() {
  try {
    const d = await api('/api/sales/tracked');
    Object.assign(S.sales, { tracked: d.tracked, recheck: d.recheck, everyHours: d.everyHours, stats: d.stats });
  } catch { /* server not reachable */ }
  clearTimeout(S.sales.timer);
  if (S.sales.recheck?.running) S.sales.timer = setTimeout(refreshTracked, 4000);
  if (S.tab === 'import') renderImport();
}

async function toggleTrack(id) {
  if (isTracked(id)) {
    await api(`/api/sales/track/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('Đã bỏ theo dõi lượt bán');
  } else {
    const r = S.imp.results.get(id);
    if (!r) return;
    await api('/api/sales/track', { method: 'POST', body: { product: r.product, result: r } });
    toast('Đã theo dõi — app sẽ kiểm tra lại định kỳ và lưu lịch sử lượt bán');
  }
  await refreshTracked();
}

const salesLine = (h) => {
  if (!h) return '';
  const rate = h.soldPerWeek != null ? `<b>~${fmtCompact(h.soldPerWeek)}/tuần</b>` : h.reviewsPerWeek ? `~${fmtCompact(h.reviewsPerWeek)} đánh giá mới/tuần` : null;
  const spark = h.series?.length > 1 ? sparkline(h.series) : '';
  return `<div class="small">${rate ? `Tốc độ bán: ${rate}` : `<span class="muted">Tốc độ bán: cần thêm lần ghi (đã ghi ${h.snapshots || 0} lần, ${h.trackedDays || 0} ngày)</span>`} ${spark}</div>`;
};

function trackedHtml() {
  const list = S.sales.tracked;
  const rc = S.sales.recheck;
  if (!list.length) return '';
  const changes = rc?.changes?.length ? `<div class="set-msg ok" style="margin-bottom:8px">Thay đổi ở lần kiểm tra gần nhất: ${rc.changes.map((c) => `<b>${esc(c.title)}</b>: ${esc(IMP_CLASSES[c.from]?.[0] || c.from)} → ${esc(IMP_CLASSES[c.to]?.[0] || c.to)}`).join(' · ')}</div>` : '';
  return `<div class="panel" style="margin-bottom:14px">
    <h3>Đang theo dõi lượt bán (${list.length}) <span class="muted">tự kiểm tra lại mỗi ${S.sales.everyHours} giờ khi app đang chạy</span></h3>
    ${changes}
    <div class="row-actions" style="margin-bottom:8px">
      <button class="btn small" data-recheck-all ${rc?.running ? 'disabled' : ''}>${rc?.running ? `Đang kiểm tra ${rc.done}/${rc.total}…` : 'Kiểm tra lại tất cả ngay'}</button>
      <span class="small muted">${S.sales.stats ? `Đã lưu ${fmtNum(S.sales.stats.snapshots)} bản chụp của ${fmtNum(S.sales.stats.listings)} tin bán tại VN` : ''}</span>
    </div>
    <table class="simple"><thead><tr><th></th><th>Sản phẩm</th><th>Kết luận hiện tại</th><th>Diễn biến</th><th>Lượt bán tại VN</th><th>Kiểm tra</th><th></th></tr></thead><tbody>
    ${list.map((t) => {
      const r = t.result;
      const hist = t.classHistory.map((h) => `${esc(IMP_CLASSES[h.class]?.[0] || h.class)} (${new Date(h.t).toLocaleDateString('vi-VN')})`).join(' → ');
      return `<tr>
        <td>${img(t.product.image, 'mini-thumb')}</td>
        <td><a href="${esc(t.product.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(t.product.title)}</a><div class="small muted">${esc(t.product.brand || '')} · ${esc(countryName(t.product.country))}</div></td>
        <td>${r ? `<span class="cls ${r.class}">${esc(IMP_CLASSES[r.class][0])}</span>${r.importers?.length ? `<div class="small">${esc(r.importers.join('; '))}</div>` : ''}` : '<span class="muted">chưa kiểm tra</span>'}</td>
        <td class="small">${hist || '—'}</td>
        <td>${r?.vn?.sold ? `${fmtCompact(r.vn.sold)} đã bán` : '—'}${salesLine(r?.history)}</td>
        <td class="small muted">${t.lastCheck ? timeAgo(t.lastCheck) : '—'}</td>
        <td><button class="btn small ghost" data-recheck="${esc(t.id)}" ${rc?.running ? 'disabled' : ''}>Kiểm tra</button> <button class="btn small ghost" data-untrack="${esc(t.id)}">Bỏ</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function impRow(r) {
  const p = r.product;
  const [label] = IMP_CLASSES[r.class];
  const vn = r.vn;
  const evidence = [
    vn.listings ? `<b>${vn.listings}</b> tin bán khớp (${vn.strong} chắc chắn)` : 'Không có tin bán khớp',
    r.chains.length ? `Chuỗi: <b>${r.chains.map(esc).join(', ')}</b>` : '',
    r.importers.length ? `NK/PP: <b>${r.importers.map(esc).join('; ')}</b>` : r.brandImporter ? `PP của hãng: ${esc(r.brandImporter)}` : '',
    vn.official ? `${vn.official} gian hàng chính hãng/Mall` : '',
    vn.sold ? `Đã bán tại VN: <b>${fmtCompact(vn.sold)}</b>` : '',
    vn.handCarried ? `<span class="tag ad">${vn.handCarried} tin xách tay</span>` : '',
    r.history ? salesLine(r.history) : '',
    r.class === 'brand' || r.class === 'absent' ? `Thương hiệu: ${r.brandListings} tin bán tại VN` : '',
  ].filter(Boolean).join('<br>');
  const matches = r.matches.length ? `<details class="imp-matches"><summary>Xem ${r.matches.length} tin bán tại VN</summary>${r.matches.map((m) => `
      <div class="imp-match">${img(m.image, 'mini-thumb')}
        <div><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.title)}</a>
          <div class="muted">${esc(S.srcName[m.source] || m.source)}${m.seller ? ` · ${esc(m.seller)}` : ''}${m.chain ? ` · <b>${esc(m.chain)}</b>` : ''}${m.official ? ' · chính hãng' : ''}${m.importer ? ` · NK: ${esc(m.importer)}` : ''}${m.handCarried ? ' · xách tay' : ''} · độ khớp ${Math.round(m.score * 100)}%</div></div>
        <div class="tnum">${m.priceVND ? fmtShortVND(m.priceVND) : ''}${m.sold ? `<div class="muted">bán ${fmtCompact(m.sold)}</div>` : ''}</div>
      </div>`).join('')}</details>` : '';
  return `<tr>
    <td class="c-img">${img(p.image, 'thumb', p.title)}</td>
    <td class="c-title"><a class="p-title" href="${esc(p.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>
      <div class="p-sub">${p.brand ? `<b>${esc(p.brand)}</b> · ` : ''}${flag(p.country)} ${esc(countryName(p.country))} · ${esc(S.srcName[p.source] || p.source)}</div>
      ${p.rank ? `<div class="rate"><span class="tag" title="Thứ hạng trong danh sách bán chạy nhóm đồ ăn dặm của Amazon">#${p.rank} bán chạy · ${esc(countryName(p.country))}</span></div>` : ''}
      ${p.rating || p.reviews ? `<div class="rate"><span class="star">★</span> ${fmtNum(p.rating, 1)}${p.reviews ? ` (${fmtCompact(p.reviews)} đánh giá)` : ''}</div>` : ''}</td>
    <td>${oppCell(r)}</td>
    <td><span class="cls ${r.class}">${esc(label)}</span>
      <button class="btn small ghost" style="margin-left:4px" data-track="${esc(r.id)}" title="Lưu lịch sử lượt bán và tự kiểm tra lại định kỳ">${isTracked(r.id) ? '★ Đang theo dõi' : '☆ Theo dõi'}</button>${r.uncertain ? ' <span class="tag ad" title="Một số kênh VN chính không trả lời — kết luận có thể sai">chưa chắc</span>' : ''}${r.pending?.length && S.imp.running ? ` <span class="tag" title="Đang chờ: ${esc(r.pending.join(', '))}"><span class="loading-dots">đang bổ sung</span></span>` : ''}<ul class="imp-reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></td>
    <td class="small">${evidence}${matches}</td>
    <td class="c-price tnum">${p.priceVND ? fmtVND(p.priceVND) : '—'}<div class="muted small">VN: ${vn.minPriceVND ? fmtShortVND(vn.minPriceVND) + (vn.maxPriceVND > vn.minPriceVND ? `–${fmtShortVND(vn.maxPriceVND)}` : '') : '—'}</div></td>
  </tr>`;
}

function exportImport() {
  const rows = [...S.imp.results.values()].sort((a, b) => impScore(b) - impScore(a));
  if (!rows.length) return toast('Chưa có kết quả để xuất.');
  const head = ['Điểm cơ hội', 'Nhu cầu /100', 'Chi tiết điểm', 'Sản phẩm', 'Thương hiệu', 'Nước', 'Giá NN (VNĐ)', 'Đánh giá NN', 'Kết luận', 'Chưa chắc', 'Lý do', 'Số tin VN khớp', 'Chuỗi lớn', 'Nhà NK/PP', 'NPP của hãng', 'Đã bán VN', 'Tin xách tay', 'Giá VN thấp nhất', 'Link NN', 'Link VN'];
  const data = rows.map((r) => [impOpportunity(r).score, impOpportunity(r).demand, impOpportunity(r).parts.map(([l, p]) => `${l} +${p}`).join('; '), r.product.title, r.product.brand, countryName(r.product.country), r.product.priceVND, r.product.reviews, IMP_CLASSES[r.class][0], r.uncertain ? 'có' : '',
    r.reasons.join(' | '), r.vn.listings, r.chains.join('; '), r.importers.join('; '), r.brandImporter, r.vn.sold, r.vn.handCarried, r.vn.minPriceVND, r.product.url,
    r.matches.slice(0, 5).map((m) => m.url).join(' ')]);
  download(`co-hoi-nhap-khau-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([head, ...data]), 'text/csv;charset=utf-8');
}

function bindImport() {
  $('#imp-run').addEventListener('click', () => {
    // While running the button stops the check (rows already classified stay); otherwise it starts one.
    if (!S.imp.running) return runImportCheck();
    S.imp.ctrl?.abort();
    S.imp.running = false;
    S.imp.stopped = true;
    renderImport();
    toast('Đã dừng phân tích — giữ lại các dòng đã có kết luận');
  });
  $('#imp-best').addEventListener('click', loadBestsellers);
  $('#imp-export').addEventListener('click', exportImport);
  $('#view-import').addEventListener('click', async (e) => {
    const tr = e.target.closest('[data-track]');
    if (tr) return toggleTrack(tr.dataset.track);
    const un = e.target.closest('[data-untrack]');
    if (un) {
      await api(`/api/sales/track/${encodeURIComponent(un.dataset.untrack)}`, { method: 'DELETE' });
      return refreshTracked();
    }
    const one = e.target.closest('[data-recheck]');
    const all = e.target.closest('[data-recheck-all]');
    if (one || all) {
      const r = await api('/api/sales/recheck', { method: 'POST', body: { ids: one ? [one.dataset.recheck] : [] } });
      toast(r.started ? `Đang kiểm tra lại ${r.total} sản phẩm…` : 'Đang có lượt kiểm tra khác chạy');
      setTimeout(refreshTracked, 500);
    }
  });
  $('#imp-importers').addEventListener('input', debounce((e) => {
    if (e.target.id === 'imp-dir-q') renderImporterDirectory(e.target.value);
  }, 300));
  $('#imp-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-imp-filter]');
    if (!b) return;
    S.imp.filter = b.dataset.impFilter;
    renderImport();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-market-set]');
    if (!b) return;
    const set = b.dataset.marketSet;
    S.markets = set === 'all' ? S.meta.markets.map((m) => m.code) : set === 'west' ? WEST.filter((m) => S.meta.markets.some((x) => x.code === m)) : ['vn'];
    save('markets', S.markets);
    renderMarkets();
    toast(set === 'vn' ? 'Chỉ tìm tại Việt Nam' : `Đã chọn ${S.markets.length} thị trường — bấm Tìm kiếm`);
  });
}

// ---------------------------------------------------------------- source settings (API keys)

const SETTING_CARDS = [
  {
    kind: 'serper', field: 'SERPER_API_KEY', title: 'Google Search + Google Shopping',
    desc: 'Khuyên dùng. Google Shopping gom giá từ gần như mọi shop (Walmart, Tesco, Target, Boots, Coles, Amazon…) theo từng nước. Miễn phí 2.500 lượt, không cần thẻ.',
    placeholder: 'Dán API key của serper.dev', link: ['https://serper.dev', 'Lấy khóa miễn phí tại serper.dev'],
  },
  { kind: 'proxy', field: 'SCRAPE_PROXY', title: 'Proxy chống chặn bot',
    desc: 'Mở khóa cào trực tiếp Walmart, iHerb, eBay, Boots, Asda, Coles, Chemist Warehouse, Carrefour, Coupang, Shopee, và dùng làm dự phòng khi Amazon/Tesco chặn. Các dịch vụ dưới đây đều có gói miễn phí.' },
  {
    kind: 'searxng', field: 'SEARXNG_URL', title: 'SearXNG tự host', secret: false,
    desc: 'Meta-search miễn phí, không giới hạn: gộp Google, Bing, DuckDuckGo, Brave, Qwant. Cần chạy bằng Docker trên máy (xem README).',
    placeholder: 'http://localhost:8888', link: ['https://docs.searxng.org/admin/installation-docker.html', 'Hướng dẫn cài'],
  },
  {
    kind: 'brave', field: 'BRAVE_API_KEY', title: 'Brave Search API',
    desc: 'Search engine độc lập, có hạn mức miễn phí hằng tháng. Dùng làm nguồn kết quả web và tìm shop chặn bot.',
    placeholder: 'Dán API key của Brave Search', link: ['https://brave.com/search/api/', 'Lấy khóa tại brave.com'],
  },
];

let settingsData = null;

async function openSettings() {
  $('#settings').hidden = false;
  $('#settings-form').innerHTML = '<div class="skeleton" style="height:120px;margin-top:12px"></div>';
  try {
    settingsData = await api('/api/settings');
    renderSettings();
  } catch (e) {
    $('#settings-form').innerHTML = `<p class="set-msg err">Không tải được cài đặt: ${esc(e.message)}</p>`;
  }
}
const closeSettings = () => {
  $('#settings').hidden = true;
};

function renderSettings() {
  const { fields, providers, editable } = settingsData;
  const proxy = fields.SCRAPE_PROXY;
  const badge = (f) => (f.set ? `<span class="badge on">Đang bật${f.masked ? ` · ${esc(f.masked)}` : f.value ? ` · ${esc(f.value)}` : ''}</span>` : '<span class="badge off">Chưa cấu hình</span>');
  const cards = SETTING_CARDS.map((c) => {
    const f = fields[c.field];
    let row;
    if (c.kind === 'proxy') {
      const cur = proxy.provider && proxy.provider !== 'custom' ? proxy.provider : proxy.provider === 'custom' ? 'custom' : 'scraperapi';
      row = `<div class="set-row">
          <select name="proxyProvider" aria-label="Nhà cung cấp proxy">
            ${Object.entries(providers).map(([id, p]) => `<option value="${id}" ${cur === id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            <option value="custom" ${cur === 'custom' ? 'selected' : ''}>URL tùy chỉnh</option>
          </select>
          <input type="password" name="proxyKey" placeholder="${proxy.set ? 'Để trống = giữ khóa hiện tại' : 'Dán API key'}" ${cur === 'custom' ? 'hidden' : ''} aria-label="API key proxy">
          <input type="text" name="SCRAPE_PROXY" placeholder="https://…?key=…&url={url}" ${cur === 'custom' ? '' : 'hidden'} aria-label="URL proxy tùy chỉnh">
        </div>
        <div class="set-row" style="margin-top:8px">
          <button type="button" class="btn small" data-test="proxy">Kiểm tra</button>
          <button type="button" class="btn small ghost" data-reveal>Hiện</button>
          <a class="small" data-proxy-signup href="${esc(providers[cur]?.signup || providers.scraperapi.signup)}" target="_blank" rel="noopener noreferrer">Đăng ký miễn phí ↗</a>
          ${proxy.set ? '<button type="button" class="btn small ghost" data-clear="SCRAPE_PROXY">Gỡ proxy</button>' : ''}
        </div>`;
    } else {
      row = `<div class="set-row">
          <input type="${c.secret === false ? 'text' : 'password'}" name="${c.field}" placeholder="${f.set && c.secret !== false ? 'Để trống = giữ khóa hiện tại' : esc(c.placeholder)}" value="${c.secret === false ? esc(f.value || '') : ''}" aria-label="${esc(c.title)}">
        </div>
        <div class="set-row" style="margin-top:8px">
          <button type="button" class="btn small" data-test="${c.kind}">Kiểm tra</button>
          ${c.secret === false ? '' : '<button type="button" class="btn small ghost" data-reveal>Hiện</button>'}
          <a class="small" href="${esc(c.link[0])}" target="_blank" rel="noopener noreferrer">${esc(c.link[1])} ↗</a>
          ${f.set ? `<button type="button" class="btn small ghost" data-clear="${c.field}">Gỡ</button>` : ''}
        </div>`;
    }
    return `<div class="set-card ${f.set ? 'on' : ''}" data-kind="${c.kind}">
      <div class="set-head"><h3>${esc(c.title)}</h3>${badge(f)}</div>
      <p class="muted small">${esc(c.desc)}</p>
      ${row}
      <div class="set-msg" data-msg="${c.kind}"></div>
    </div>`;
  }).join('');
  $('#settings-form').innerHTML = `${cards}
    <div class="set-card">
      <div class="set-head"><h3>Thời gian lưu tạm kết quả</h3></div>
      <p class="muted small">Tìm lại cùng từ khóa trong khoảng này sẽ gần như tức thì và đỡ bị chặn hơn.</p>
      <div class="set-row"><input type="number" name="SEARCH_CACHE_HOURS" min="0.5" max="168" step="0.5" value="${fields.SEARCH_CACHE_HOURS.value}" style="flex:0 1 120px" aria-label="Số giờ lưu tạm"> <span class="small muted">giờ</span></div>
    </div>
    <div class="set-card">
      <div class="set-head"><h3>Độ phủ tìm kiếm (Google qua Serper)</h3></div>
      <p class="muted small">Sâu hơn = nhiều trang bán và nhiều sản phẩm hơn ở mỗi thị trường (Google Shopping nhiều trang, tìm theo nhóm nhỏ trang bán), nhưng tốn nhiều lượt Serper hơn. Ước tính lượt Serper mỗi thị trường cho một lần tìm: Tiết kiệm ≈ 3 · Cân bằng ≈ 6 · Sâu ≈ 10.</p>
      <div class="set-row"><select name="SEARCH_DEPTH" aria-label="Độ phủ tìm kiếm" style="flex:0 1 220px">${[[1, 'Tiết kiệm'], [2, 'Cân bằng (mặc định)'], [3, 'Sâu']].map(([v, l]) => `<option value="${v}" ${(fields.SEARCH_DEPTH?.value ?? 2) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="set-card">
      <div class="set-head"><h3>Chu kỳ kiểm tra lượt bán</h3></div>
      <p class="muted small">Sản phẩm đang theo dõi (tab Cơ hội nhập khẩu) được kiểm tra lại tự động sau mỗi khoảng này, khi app đang chạy.</p>
      <div class="set-row"><input type="number" name="SALES_CHECK_HOURS" min="1" max="720" step="1" value="${fields.SALES_CHECK_HOURS?.value ?? 24}" style="flex:0 1 120px" aria-label="Số giờ giữa hai lần kiểm tra"> <span class="small muted">giờ</span></div>
    </div>
    <div class="set-foot">
      ${editable ? '<span class="small muted">Ô để trống = giữ nguyên giá trị hiện tại.</span>' : '<span class="small set-msg err">Chỉ chỉnh được trên chính máy đang chạy app.</span>'}
      <button type="button" class="btn ghost" data-close-settings>Đóng</button>
      <button type="submit" class="btn primary" ${editable ? '' : 'disabled'}>Lưu cài đặt</button>
    </div>`;
}

// Values the user typed; blank inputs mean "keep the current value".
function settingsPayload(form, only) {
  const v = (name) => form.elements[name]?.value.trim() ?? '';
  const body = {};
  const want = (k) => !only || only === k;
  if (want('serper') && v('SERPER_API_KEY')) body.SERPER_API_KEY = v('SERPER_API_KEY');
  if (want('brave') && v('BRAVE_API_KEY')) body.BRAVE_API_KEY = v('BRAVE_API_KEY');
  if (want('searxng') && v('SEARXNG_URL') !== (settingsData.fields.SEARXNG_URL.value || '')) body.SEARXNG_URL = v('SEARXNG_URL');
  if (want('proxy')) {
    const provider = v('proxyProvider');
    if (provider === 'custom' ? v('SCRAPE_PROXY') : v('proxyKey')) {
      body.proxyProvider = provider;
      if (provider === 'custom') body.SCRAPE_PROXY = v('SCRAPE_PROXY');
      else body.proxyKey = v('proxyKey');
    }
  }
  if (!only && Number(v('SEARCH_CACHE_HOURS')) !== settingsData.fields.SEARCH_CACHE_HOURS.value) body.SEARCH_CACHE_HOURS = v('SEARCH_CACHE_HOURS');
  if (!only && settingsData.fields.SEARCH_DEPTH && Number(v('SEARCH_DEPTH')) !== settingsData.fields.SEARCH_DEPTH.value) body.SEARCH_DEPTH = v('SEARCH_DEPTH');
  if (!only && Number(v('SALES_CHECK_HOURS')) !== settingsData.fields.SALES_CHECK_HOURS.value) body.SALES_CHECK_HOURS = v('SALES_CHECK_HOURS');
  return body;
}

async function saveSettings(body, okMsg) {
  const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error || res.statusText);
  // Sources that just became available join the user's selection automatically.
  const before = new Set(S.meta.sources.filter((s) => s.enabled).map((s) => s.id));
  S.meta.sources = d.sources;
  S.srcName = Object.fromEntries(S.meta.sources.map((s) => [s.id, s.name]));
  const added = S.meta.sources.filter((s) => s.enabled && !before.has(s.id));
  if (S.sources && added.length) {
    S.sources = [...new Set([...S.sources, ...added.map((s) => s.id)])];
    save('sources', S.sources);
  }
  renderSources();
  settingsData.fields = d.fields;
  renderSettings();
  toast(added.length ? `${okMsg} Đã bật thêm: ${added.map((s) => s.name).join(', ')}.` : okMsg, 4500);
}

function bindSettings() {
  $('#settings-btn').addEventListener('click', openSettings);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-open-settings]')) return;
    e.target.closest('details')?.removeAttribute('open');
    openSettings();
  });
  $('#settings').addEventListener('click', async (e) => {
    if (e.target.closest('[data-close-settings]')) return closeSettings();
    const reveal = e.target.closest('[data-reveal]');
    if (reveal) {
      const inputs = $$('input[type=password], input[data-revealed]', reveal.closest('.set-card'));
      const show = reveal.textContent === 'Hiện';
      inputs.forEach((i) => {
        i.type = show ? 'text' : 'password';
        i.toggleAttribute('data-revealed', show);
      });
      reveal.textContent = show ? 'Ẩn' : 'Hiện';
      return;
    }
    const test = e.target.closest('[data-test]');
    if (test) {
      const kind = test.dataset.test;
      const msg = $(`[data-msg="${kind}"]`);
      msg.className = 'set-msg';
      msg.textContent = kind === 'proxy' ? 'Đang kiểm tra (proxy có thể mất tới 30 giây)…' : 'Đang kiểm tra…';
      test.disabled = true;
      try {
        const r = await api('/api/settings/test', { method: 'POST', body: { kind, ...settingsPayload($('#settings-form'), kind) } });
        msg.className = `set-msg ${r.ok ? 'ok' : 'err'}`;
        msg.textContent = `${r.ok ? '✓' : '✗'} ${r.message}`;
      } catch (err) {
        msg.className = 'set-msg err';
        msg.textContent = `✗ ${err.message}`;
      } finally {
        test.disabled = false;
      }
      return;
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      if (!confirm('Gỡ cấu hình này? Nguồn tương ứng sẽ tắt.')) return;
      const key = clear.dataset.clear;
      const body = key === 'SCRAPE_PROXY' ? { proxyProvider: 'custom', SCRAPE_PROXY: '' } : { [key]: '' };
      try {
        await saveSettings(body, 'Đã gỡ.');
      } catch (err) {
        toast(`Lỗi: ${err.message}`);
      }
    }
  });
  $('#settings').addEventListener('change', (e) => {
    if (e.target.name !== 'proxyProvider') return;
    const card = e.target.closest('.set-card');
    const custom = e.target.value === 'custom';
    card.querySelector('[name=proxyKey]').hidden = custom;
    card.querySelector('[name=SCRAPE_PROXY]').hidden = !custom;
    const p = settingsData.providers[e.target.value];
    const link = card.querySelector('[data-proxy-signup]');
    link.hidden = !p;
    if (p) link.href = p.signup;
  });
  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = settingsPayload(e.target);
    if (!Object.keys(body).length) return toast('Chưa có thay đổi nào.');
    const btn = e.submitter || $('#settings-form [type=submit]');
    btn.disabled = true;
    try {
      await saveSettings(body, 'Đã lưu — áp dụng cho lần tìm tiếp theo.');
    } catch (err) {
      toast(`Không lưu được: ${err.message}`, 5000);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- tabs, theme

function switchTab(tab) {
  S.tab = tab;
  $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.view').forEach((v) => {
    v.hidden = v.id !== `view-${tab}`;
  });
  if (tab === 'insights') renderInsights();
  if (tab === 'compare') renderCompare();
  if (tab === 'import') {
    renderImport();
    refreshTracked();
    renderImporterDirectory();
  }
  if (tab === 'watch') renderWatch();
  if (tab === 'history') renderHistory();
  if (tab === 'keywords' && !$('#keywords').innerHTML && (S.q || $('#q').value)) runKeywords(S.q || $('#q').value);
  renderCompareBar();
}

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------------------------------------------------------------- events

function bindEvents() {
  $('#stop-btn').addEventListener('click', stopSearch);
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    S.trOverride = {};
    startSearch($('#q').value);
  });
  $('#q').addEventListener('input', (e) => fetchSuggest(e.target.value.trim()));
  $('#q').addEventListener('keydown', (e) => {
    const items = $$('#suggest li');
    if ($('#suggest').hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sugIndex = (sugIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.setAttribute('aria-selected', String(i === sugIndex)));
      $('#q').value = items[sugIndex].dataset.value;
    } else if (e.key === 'Escape') hideSuggest();
  });
  $('#q').addEventListener('blur', () => setTimeout(hideSuggest, 150));
  $('#suggest').addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    S.trOverride = {};
    startSearch(li.dataset.value);
  });

  $('#markets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-market]');
    if (!b) return;
    const m = b.dataset.market;
    S.markets = S.markets.includes(m) ? S.markets.filter((x) => x !== m) : [...S.markets, m];
    if (!S.markets.length) S.markets = ['vn'];
    save('markets', S.markets);
    renderMarkets();
  });
  $('#sources').addEventListener('change', () => {
    S.sources = $$('#sources input:checked').map((i) => i.value);
    save('sources', S.sources);
    $('#sources-count').textContent = `${S.sources.length}/${S.meta.sources.filter((s) => s.enabled).length}`;
  });
  $('#sources').addEventListener('click', (e) => {
    if (!e.target.closest('[data-src-all]')) return;
    S.sources = null;
    save('sources', null);
    renderSources();
  });
  $('#examples').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) startSearch(b.textContent);
  });
  $('#translations').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.dataset.lang) return;
    S.trOverride[e.target.dataset.lang] = e.target.value.trim();
    startSearch(S.q);
  });

  // filters
  const rerender = () => {
    S.limit = PAGE;
    const more = readFilters();
    const n = [more.hasPrice, more.shopOnly, !more.relevant, !more.foodOnly, more.noAds].filter(Boolean).length + more.claims.length + more.allergens.length;
    $('#more-filter-count').textContent = n ? `(${n})` : '';
    scheduleRender(true);
  };
  $('#filters').addEventListener('change', (e) => {
    if (e.target.id === 'sort') {
      S.sort = e.target.value;
      save('sort', S.sort);
    }
    rerender();
  });
  $('#f-text').addEventListener('input', debounce(rerender, 200));
  $('#f-min').addEventListener('input', debounce(rerender, 400));
  $('#f-max').addEventListener('input', debounce(rerender, 400));
  $('#f-reset').addEventListener('click', () => {
    ['#f-text', '#f-min', '#f-max'].forEach((s) => { $(s).value = ''; });
    ['#f-source', '#f-country', '#f-type', '#f-age'].forEach((s) => { $(s).value = ''; });
    $('#filters input[type=checkbox]').forEach((c) => { c.checked = c.id === 'f-relevant' || c.id === 'f-food'; });
    rerender();
  });
  $$('.seg [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#more-btn').addEventListener('click', () => {
    S.limit += PAGE;
    renderResults();
  });
  $$('[data-export]').forEach((b) => b.addEventListener('click', (e) => {
    e.target.closest('details').open = false;
    doExport(b.dataset.export);
  }));

  // results clicks (delegated)
  $('#results').addEventListener('click', (e) => {
    const sortTh = e.target.closest('th[data-sort]');
    if (sortTh) {
      const cur = S.sort;
      const key = sortTh.dataset.sort;
      S.sort = cur === key && key === 'price-asc' ? 'price-desc' : key;
      $('#sort').value = S.sort;
      save('sort', S.sort);
      renderResults();
      return;
    }
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open') return;
    if (act === 'compare') {
      if (!toggleCompare(id, e.target.checked)) e.target.checked = false;
      return;
    }
    if (act === 'watch') {
      e.preventDefault();
      toggleWatch(id);
      return;
    }
    if (e.target.closest('a, input, label')) return;
    openDrawer(id);
  });

  // drawer
  $('#drawer').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeDrawer();
    const big = e.target.closest('[data-big]');
    if (big) {
      $('.d-img').src = big.dataset.big;
      return;
    }
    const act = e.target.closest('[data-dact]')?.dataset.dact;
    if (!act) return;
    const it = findItem(drawerId);
    if (act === 'watch') toggleWatch(drawerId);
    if (act === 'compare') {
      toggleCompare(drawerId);
      renderDrawer(it);
      renderResults();
    }
    if (act === 'reload') loadDetail(it, true);
    if (act === 'translate') translateDrawer(it);
    if (act === 'similar') searchSimilar(it);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#settings').hidden) return closeSettings();
    if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault();
      $('#q').focus();
      $('#q').select();
    }
  });

  // tabs
  $$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    save('theme', next);
    if (S.tab === 'insights') renderInsights();
  });

  // compare
  $('#compare-go').addEventListener('click', () => switchTab('compare'));
  $('#compare-clear').addEventListener('click', () => {
    S.compare.clear();
    S.compareItems.clear();
    persistCompare();
    renderCompareBar();
    renderResults();
  });
  $('#compare').addEventListener('click', (e) => {
    const open = e.target.closest('[data-cmp-open]');
    if (open) return openDrawer(open.dataset.cmpOpen);
    const rm = e.target.closest('[data-cmp-remove]');
    if (rm) {
      toggleCompare(rm.dataset.cmpRemove, false);
      renderResults();
    }
    if (e.target.closest('[data-cmp-clear]')) {
      S.compare.clear();
      S.compareItems.clear();
      persistCompare();
      renderCompare();
      renderCompareBar();
      renderResults();
    }
    if (e.target.id === 'compare-export') {
      const items = [...S.compare].map(findItem).filter(Boolean);
      download(`so-sanh-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(exportRows(items)), 'text/csv;charset=utf-8');
    }
  });

  // insights
  $('#insights').addEventListener('click', (e) => {
    const r = e.target.closest('[data-open]');
    if (r) openDrawer(r.dataset.open);
  });

  // watchlist
  $('#watch').addEventListener('input', (e) => {
    const f = e.target.dataset.wf;
    if (f) saveWatchField(e.target.closest('[data-wid]').dataset.wid, f, e.target.value);
  });
  $('#watch').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return openDrawer(open.dataset.open);
    const act = e.target.closest('[data-wact]')?.dataset.wact;
    if (!act) return;
    const id = e.target.closest('[data-wid]').dataset.wid;
    if (act === 'remove') {
      await api(`/api/watchlist/${id}`, { method: 'DELETE' });
      await refreshWatch();
      renderResults();
    }
    if (act === 'compare') {
      toggleCompare(id);
      renderWatch();
    }
    if (act === 'refresh') {
      e.target.disabled = true;
      e.target.textContent = 'Đang cập nhật…';
      const r = await api(`/api/watchlist/${id}/refresh`, { method: 'POST' }).catch((err) => ({ error: err.message }));
      toast(r.error ? `⚠ ${r.error}` : 'Đã cập nhật giá');
      await refreshWatch();
    }
  });
  $('#watch-refresh-all').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Đang cập nhật…';
    const r = await api('/api/watchlist-refresh-all', { method: 'POST' }).catch((err) => ({ error: err.message }));
    toast(r.error ? `Lỗi: ${r.error}` : `Đã cập nhật ${r.ok}/${r.total} sản phẩm`);
    e.target.disabled = false;
    e.target.textContent = 'Cập nhật giá tất cả';
    await refreshWatch();
  });
  $('#watch-export').addEventListener('click', exportWatch);

  // keywords
  $('#kw-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runKeywords($('#kw-q').value);
  });
  $('#keywords').addEventListener('click', (e) => {
    const k = e.target.closest('[data-kw]');
    if (!k) return;
    S.trOverride = {};
    startSearch(k.dataset.kw);
  });

  // history
  $('#history').addEventListener('click', (e) => {
    const h = e.target.closest('[data-hq]');
    if (!h) return;
    S.markets = h.dataset.hm.split(',');
    save('markets', S.markets);
    renderMarkets();
    S.trOverride = {};
    startSearch(h.dataset.hq, { fresh: false });
  });
  $('#history-clear').addEventListener('click', async () => {
    await api('/api/history', { method: 'DELETE' });
    renderHistory();
  });
  $('#cache-clear').addEventListener('click', async () => {
    await api('/api/cache/clear', { method: 'POST' });
    toast('Đã xoá dữ liệu tạm — lần tìm tới sẽ cào lại từ đầu');
  });

  // close open dropdowns when clicking elsewhere
  document.addEventListener('click', (e) => {
    $$('details.dropdown[open]').forEach((d) => {
      if (!d.contains(e.target)) d.open = false;
    });
  });
  addEventListener('resize', debounce(() => {
    if (S.tab === 'insights') renderInsights();
  }, 250));
}

init();
