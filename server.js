// Ăn Dặm Radar — server: fans a query out to every source in parallel, streams normalized rows
// to the browser over Server-Sent Events, then enriches the best rows with product-page details.
import express from 'express';
import compression from 'compression';
import { SOURCES, byId, supports, enabled, describe } from './src/sources/index.js';
import { MARKETS, COUNTRY_NAMES } from './src/lib/markets.js';
import { makeItem, mergeDetail } from './src/lib/item.js';
import { del, sweep, clearAll } from './src/lib/cache.js';
import { loadRates, rates, toVND } from './src/lib/currency.js';
import { translate, translateQuery } from './src/lib/translate.js';
import { canEnrich, getDetail, isPublicHttpUrl } from './src/lib/enrich.js';
import { suggest, keywordResearch } from './src/lib/suggest.js';
import { jsonStore } from './src/lib/store.js';
import { request, mapLimit } from './src/lib/http.js';
import { clean, fold } from './src/lib/normalize.js';
import { CooldownError } from './src/lib/limiter.js';
import { runSearch } from './src/lib/run.js';
import { checkProduct, createContext } from './src/lib/importcheck.js';
import { bestsellers, BESTSELLER_MARKETS } from './src/lib/bestsellers.js';
import { recordListings, listTracked, dueTracked, track, untrack, saveCheck, stats as salesStats, listImporters } from './src/lib/sales.js';
import { readSettings, validate, applySettings, testSetting, PROXY_PROVIDERS } from './src/lib/settings.js';

try {
  process.loadEnvFile('.env');
} catch { /* no .env file */ }

const PORT = Number(process.env.PORT) || 3000;
const ENRICH_CONCURRENCY = 10;
const SESSION_DEADLINE_MS = 45000;
// How many top rows per source get their product page fetched for details.
// The browser asks for the rest of the visible rows afterwards (/api/details), so these only need to cover
// the first screen. Per-host throttles keep each shop at a polite rate.
const ENRICH_PLAN = {
  tiki: 20, lazada: 6, concung: 12, kidsplaza: 12, rakuten: 8, off: 8, amazon: 4, target: 12, tesco: 6, sainsburys: 12,
  waitrose: 12, morrisons: 12, woolworths: 16, dm: 16, siteshop: 8, google: 6, searxng: 6, brave: 6, bing: 6, ddg: 6,
};

const history = jsonStore('history.json', []);
const watch = jsonStore('watchlist.json', []);

const app = express();
app.disable('x-powered-by');
app.use(compression({ filter: (req, res) => req.path !== '/api/search' && compression.filter(req, res) }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public', { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const normUrl = (u) => {
  try {
    const x = new URL(u);
    x.hash = '';
    [...x.searchParams.keys()].filter((k) => /^(utm_|fbclid|gclid|srsltid|ref)/.test(k)).forEach((k) => x.searchParams.delete(k));
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search).toLowerCase();
  } catch {
    return u;
  }
};

// ---------------- Search (SSE) ----------------

app.get('/api/search', async (req, res) => {
  const q = clean(req.query.q).slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Thiếu từ khóa' });
  const markets = String(req.query.markets || 'vn').split(',').filter((m) => MARKETS[m]);
  if (!markets.length) markets.push('vn');
  const want = req.query.sources ? String(req.query.sources).split(',') : null;
  const sources = SOURCES.filter((s) => enabled(s) && (!want || want.includes(s.id)));
  const fresh = req.query.fresh === '1';
  const doEnrich = req.query.enrich !== '0';
  const overrides = typeof req.query.tr === 'object' ? req.query.tr : {};

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const t0 = Date.now();

  const tasks = [];
  for (const s of sources) {
    if (s.global) tasks.push({ src: s, market: 'world' });
    else for (const m of markets) if (supports(s, m)) tasks.push({ src: s, market: m });
  }
  send('meta', { q, markets, tasks: tasks.map((t) => ({ source: t.src.id, market: t.market })) });

  // Each market is searched in its own language; Vietnamese tasks start immediately.
  const trPromises = {};
  const queryFor = (market) => {
    const lang = market === 'world' ? 'en' : MARKETS[market].lang;
    if (overrides[lang]) return Promise.resolve(clean(overrides[lang]));
    if (lang === 'vi') return Promise.resolve(q);
    trPromises[lang] ??= translateQuery(q, lang)
      .catch(() => q)
      .then((text) => {
        send('translation', { lang, text });
        return text;
      });
    return trPromises[lang];
  };

  const items = new Map();
  const webByUrl = new Map();
  const queue = [];
  let active = 0;
  let pendingTasks = tasks.length;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    send('done', { total: items.size, ms: Date.now() - t0 });
    res.end();
    const h = history.get().filter((e) => !(e.q.toLowerCase() === q.toLowerCase() && e.markets.join() === markets.join()));
    h.unshift({ q, markets, sources: want, t: Date.now(), count: items.size });
    history.set(h.slice(0, 100));
  };
  const deadline = setTimeout(finish, SESSION_DEADLINE_MS);
  const maybeFinish = () => {
    if (!pendingTasks && !active && !queue.length) finish();
  };

  const pump = () => {
    while (active < ENRICH_CONCURRENCY && queue.length && !ac.signal.aborted && !finished) {
      const job = queue.shift();
      active++;
      getDetail(job.item, job.src, { signal: ac.signal })
        .then((d) => {
          mergeDetail(job.item, d, job.ctx);
          send('patch', job.item);
        })
        .catch(() => {
          job.item.enrichFailed = true;
        })
        .finally(() => {
          active--;
          pump();
          maybeFinish();
        });
    }
  };

  const enqueue = (list, src, ctx) => {
    const n = ENRICH_PLAN[src.id] ?? 0;
    if (!n) return;
    list.filter((i) => canEnrich(i, src))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, n)
      .forEach((item) => queue.push({ item, src, ctx }));
    pump();
  };

  await Promise.all(tasks.map(async (t) => {
    const start = Date.now();
    const query = await queryFor(t.market);
    const ctx = { market: t.market, queries: [...new Set([q, query])] };
    send('task', { source: t.src.id, market: t.market, status: 'running', query });
    try {
      const { value: raw, cached, key } = await runSearch(t.src, t.market, query, { signal: ac.signal, fresh });
      const out = [];
      let irrelevant = 0;
      // A shop's own search engine already judged its top hits relevant, even when the title lacks our words.
      const trusted = t.src.kind !== 'web' && !t.src.filterIrrelevant;
      raw.forEach((r, pos) => {
        const relBonus = trusted ? (pos < 24 ? 0.45 : 0.2) : 0;
        const it = makeItem({ ...r, source: t.src.id, kind: t.src.kind, market: t.market, relBonus }, ctx);
        it.pos = pos;
        if (t.src.kind === 'web' || t.src.dedupe) {
          // Engines under bot suspicion return off-topic pages; drop rows that match none of the query.
          if (it.relevance < 0.3) {
            irrelevant++;
            return;
          }
          const k = normUrl(it.url);
          const prev = items.get(webByUrl.get(k));
          if (prev) {
            if (!prev.engines.includes(t.src.id)) {
              prev.engines.push(t.src.id);
              send('patch', prev);
            }
            return;
          }
          webByUrl.set(k, it.id);
          it.engines = [t.src.id];
        }
        if (items.has(it.id)) return;
        items.set(it.id, it);
        out.push(it);
      });
      send('items', { source: t.src.id, market: t.market, items: out });
      // Every Vietnamese shop listing seen feeds the sales history (sold counts / reviews over time).
      if (t.market === 'vn' && t.src.kind === 'shop') {
        try {
          recordListings(out.filter((i) => i.sold != null || i.reviews != null));
        } catch { /* best-effort */ }
      }
      const warn = raw.length && !out.length && irrelevant ? 'Kết quả không liên quan — nguồn có thể đang giới hạn tạm thời' : null;
      // Empty or all-junk answers are often a soft block: don't keep them for hours, retry next time.
      if (!raw.length || warn) del(key);
      send('task', { source: t.src.id, market: t.market, status: warn ? 'warn' : 'done', count: out.length, ms: Date.now() - start, cached, query, warn, hidden: irrelevant });
      if (doEnrich) enqueue(out, t.src, ctx);
    } catch (e) {
      send('task', { source: t.src.id, market: t.market, status: e instanceof CooldownError ? 'cooldown' : 'error', error: e.message, ms: Date.now() - start, query });
    } finally {
      pendingTasks--;
      maybeFinish();
    }
  }));
});

// ---------------- Product detail / translate ----------------

// Best sellers of the baby-food category per home market (Amazon Best Sellers), fed into the import check.
app.get('/api/bestsellers', async (req, res) => {
  const markets = String(req.query.markets || '').split(',').filter((m) => BESTSELLER_MARKETS[m]);
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const failed = [];
  const lists = await Promise.all(markets.map(async (m) => {
    try {
      return await bestsellers(m, { signal: ac.signal, fresh: req.query.fresh === '1' });
    } catch (e) {
      failed.push({ market: m, error: e.message });
      return [];
    }
  }));
  res.json({ items: lists.flat(), failed, markets: Object.keys(BESTSELLER_MARKETS) });
});

// Official-import check: streams one NDJSON line per product as soon as it is classified.
app.post('/api/import-check', async (req, res) => {
  const products = (Array.isArray(req.body?.items) ? req.body.items : []).filter((p) => p?.title).slice(0, 80);
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const line = (o) => !res.writableEnded && res.write(JSON.stringify(o) + '\n');
  const ctx = createContext(ac.signal);
  const t0 = Date.now();
  line({ type: 'start', total: products.length });
  // Same-brand products next to each other so the brand-level search is reused from the run's cache.
  const ordered = [...products].sort((a, b) => fold(a.brand || '').localeCompare(fold(b.brand || '')));
  // Fast pass first (answers from sources that respond within seconds), then a complete pass for rows that
  // were waiting on slow sources (Lazada via proxy…) or product pages; the client replaces the row by id.
  // The complete pass starts after every row has its fast answer, so new work it adds (product-specific
  // searches, product pages) doesn't slow the rows still waiting; slow requests already in flight carry on.
  const completing = [];
  await mapLimit(ordered, 6, async (p) => {
    if (ac.signal.aborted) return;
    try {
      const r = await checkProduct(p, ctx, { fast: true });
      line({ type: 'result', result: r });
      if (r.pending.length) completing.push([p, r]);
    } catch (e) {
      line({ type: 'error', id: p.id, error: e.message });
    }
  });
  line({ type: 'fast-done', ms: Date.now() - t0, completing: completing.length });
  await mapLimit(completing, 6, async ([p, r]) => {
    if (ac.signal.aborted) return;
    try {
      line({ type: 'result', result: await checkProduct(p, ctx) });
    } catch {
      line({ type: 'result', result: { ...r, pending: [], reasons: r.reasons.filter((x) => !x.startsWith('Đang bổ sung')) } });
    }
  });
  line({ type: 'done', ms: Date.now() - t0, importers: [...ctx.importers.values()] });
  res.end();
});

// Batch details for the rows the user is looking at (ingredients, storage…), up to 12 per call.
app.post('/api/details', async (req, res) => {
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 12).filter((i) => i?.source);
  const out = await mapLimit(items, 6, async (item) => {
    const src = byId[item.source];
    if (!canEnrich(item, src) || (item.url && !isPublicHttpUrl(item.url))) return { ...item, enrichTried: true };
    try {
      return mergeDetail(item, await getDetail(item, src), { market: item.market });
    } catch {
      return { ...item, enrichTried: true, enrichFailed: true };
    }
  });
  res.json({ items: out.map((r, i) => (r?.error ? { ...items[i], enrichTried: true } : r)) });
});

app.post('/api/detail', async (req, res) => {
  const item = req.body?.item;
  if (!item?.source) return res.status(400).json({ error: 'Thiếu sản phẩm' });
  const src = byId[item.source];
  if (!canEnrich(item, src) || (item.url && !isPublicHttpUrl(item.url))) return res.json({ item, skipped: true });
  try {
    const d = await getDetail(item, src, { fresh: !!req.body.fresh });
    res.json({ item: mergeDetail(item, d, { market: item.market }) });
  } catch (e) {
    res.json({ item, error: e.message });
  }
});

app.post('/api/translate', async (req, res) => {
  const texts = [].concat(req.body?.texts || req.body?.text || []).map((t) => String(t).slice(0, 3000));
  const to = String(req.body?.to || 'vi');
  try {
    const out = await Promise.all(texts.map((t) => (t ? translate(t, to).then((r) => r.text) : '')));
    res.json({ texts: out });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Search-query translation for the quick links (Amazon, Taobao, Rakuten…).
app.get('/api/translate-query', async (req, res) => {
  const q = clean(req.query.q).slice(0, 200);
  const langs = String(req.query.langs || 'en').split(',').slice(0, 6);
  const out = {};
  await Promise.all(langs.map(async (l) => {
    out[l] = await translateQuery(q, l).catch(() => q);
  }));
  res.json(out);
});

// ---------------- Keywords ----------------

app.get('/api/suggest', async (req, res) => {
  try {
    res.json(await suggest(String(req.query.q || '').slice(0, 120)));
  } catch {
    res.json([]);
  }
});

app.get('/api/keywords', async (req, res) => {
  const q = clean(req.query.q).slice(0, 120);
  if (!q) return res.status(400).json({ error: 'Thiếu từ khóa' });
  res.json(await keywordResearch(q));
});

// ---------------- Watchlist ----------------

const priceSnapshot = (it) => ({ t: Date.now(), price: it.price, currency: it.currency, priceVND: it.priceVND });

app.get('/api/watchlist', (req, res) => res.json(watch.get()));

app.post('/api/watchlist', (req, res) => {
  const item = req.body?.item;
  if (!item?.id) return res.status(400).json({ error: 'Thiếu sản phẩm' });
  const list = watch.get();
  let entry = list.find((e) => e.id === item.id);
  if (!entry) {
    entry = {
      id: item.id, savedAt: Date.now(), item, note: '', status: 'research', targetPrice: null, tags: [],
      history: item.price != null ? [priceSnapshot(item)] : [],
    };
    watch.set([entry, ...list]);
  }
  res.json(entry);
});

app.patch('/api/watchlist/:id', (req, res) => {
  const list = watch.get();
  const entry = list.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Không tìm thấy' });
  for (const k of ['note', 'status', 'targetPrice', 'tags', 'supplier', 'cost']) if (k in req.body) entry[k] = req.body[k];
  watch.set([...list]);
  res.json(entry);
});

app.delete('/api/watchlist/:id', (req, res) => {
  watch.set(watch.get().filter((e) => e.id !== req.params.id));
  res.json({ ok: true });
});

async function refreshEntry(entry) {
  const src = byId[entry.item.source];
  if (!canEnrich(entry.item, src)) return { entry, error: 'Nguồn này không hỗ trợ cập nhật giá tự động' };
  const d = await getDetail(entry.item, src, { fresh: true });
  if (d?.price != null) {
    entry.item.price = d.price;
    if (d.currency) entry.item.currency = d.currency;
  }
  mergeDetail(entry.item, d, { market: entry.item.market });
  entry.item.priceVND = toVND(entry.item.price, entry.item.currency);
  entry.checkedAt = Date.now();
  const last = entry.history.at(-1);
  if (entry.item.price != null && (!last || last.price !== entry.item.price || Date.now() - last.t > 6 * 3600e3)) {
    entry.history.push(priceSnapshot(entry.item));
    entry.history = entry.history.slice(-60);
  }
  return { entry, error: d?.price == null ? 'Không đọc được giá mới từ trang' : null };
}

app.post('/api/watchlist/:id/refresh', async (req, res) => {
  const list = watch.get();
  const entry = list.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Không tìm thấy' });
  try {
    const r = await refreshEntry(entry);
    watch.set([...list]);
    res.json(r);
  } catch (e) {
    res.json({ entry, error: e.message });
  }
});

app.post('/api/watchlist-refresh-all', async (req, res) => {
  const list = watch.get();
  const results = await mapLimit(list, 4, (e) => refreshEntry(e).catch((err) => ({ entry: e, error: err.message })));
  watch.set([...list]);
  res.json({ ok: results.filter((r) => !r.error).length, total: list.length, list });
});

// ---------------- Source settings (API keys) ----------------

const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

// Keys are server-side secrets: only the machine running the app may change them, and only from this app's
// own page (a foreign site's request carries a different Origin). SETTINGS_TOKEN allows remote admin.
function guardSettings(req, res, next) {
  const origin = req.get('origin');
  const sameOrigin = !origin || origin === `${req.protocol}://${req.get('host')}`;
  const token = process.env.SETTINGS_TOKEN;
  const allowed = isLocal(req) || (token && req.get('x-settings-token') === token);
  if (allowed && sameOrigin) return next();
  res.status(403).json({ error: 'Chỉ chỉnh được cài đặt trên chính máy đang chạy app.' });
}

const providersPublic = () => Object.fromEntries(Object.entries(PROXY_PROVIDERS).map(([k, p]) => [k, { name: p.name, signup: p.signup }]));

app.get('/api/settings', (req, res) => {
  res.json({ fields: readSettings(), providers: providersPublic(), editable: isLocal(req) || !!process.env.SETTINGS_TOKEN });
});

app.put('/api/settings', guardSettings, (req, res) => {
  const { changes, errors } = validate(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  try {
    applySettings(changes);
  } catch (e) {
    return res.status(500).json({ error: `Không ghi được file .env: ${e.message}` });
  }
  res.json({ fields: readSettings(), sources: describe() });
});

app.post('/api/settings/test', guardSettings, async (req, res) => {
  res.json(await testSetting(String(req.body?.kind || ''), req.body || {}));
});

// ---------------- History / meta / misc ----------------

// ---------------- Sales history & tracked products ----------------

const SALES_CHECK_HOURS = () => Number(process.env.SALES_CHECK_HOURS || 24);
const recheck = { running: false, done: 0, total: 0, startedAt: null, finishedAt: null, changes: [] };

// Re-run the official-import check for tracked products (all due ones, or the given ids).
async function runRecheck(ids = null) {
  if (recheck.running) return;
  const due = ids ? listTracked().filter((t) => ids.includes(t.id)) : dueTracked(SALES_CHECK_HOURS() * 3600e3);
  if (!due.length) return;
  Object.assign(recheck, { running: true, done: 0, total: due.length, startedAt: Date.now(), changes: [] });
  const ctx = createContext(undefined);
  try {
    await mapLimit(due, 2, async (t) => {
      try {
        const r = await checkProduct(t.product, ctx);
        const before = t.lastClass;
        saveCheck(t.id, r);
        if (before && before !== r.class) recheck.changes.push({ id: t.id, title: t.product.title, from: before, to: r.class, t: Date.now() });
      } finally {
        recheck.done++;
      }
    });
  } finally {
    recheck.running = false;
    recheck.finishedAt = Date.now();
  }
}

app.get('/api/importers', (req, res) => res.json(listImporters(String(req.query.q || '').slice(0, 100))));

app.get('/api/sales/tracked', (req, res) => res.json({ tracked: listTracked(), recheck, stats: salesStats(), everyHours: SALES_CHECK_HOURS() }));

app.post('/api/sales/track', (req, res) => {
  const p = req.body?.product;
  if (!p?.id || !p.title) return res.status(400).json({ error: 'Thiếu sản phẩm' });
  res.json(track(p, req.body.result || null));
});

app.delete('/api/sales/track/:id', (req, res) => {
  untrack(req.params.id);
  res.json({ ok: true });
});

app.post('/api/sales/recheck', (req, res) => {
  if (recheck.running) return res.json({ started: false, recheck });
  const ids = Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids : listTracked().map((t) => t.id);
  runRecheck(ids).catch((e) => console.warn('[sales] recheck failed:', e.message));
  res.json({ started: true, total: ids.length });
});

app.get('/api/history', (req, res) => res.json(history.get()));
app.delete('/api/history', (req, res) => {
  history.set([]);
  res.json({ ok: true });
});

app.get('/api/meta', (req, res) => {
  res.json({
    sources: describe(),
    markets: Object.entries(MARKETS).map(([code, m]) => ({ code, name: m.name, lang: m.lang, currency: m.currency })),
    countries: COUNTRY_NAMES,
    bestsellerMarkets: Object.keys(BESTSELLER_MARKETS),
    rates: rates(),
  });
});

app.post('/api/cache/clear', (req, res) => {
  clearAll();
  res.json({ ok: true });
});

// Image proxy: some CDNs refuse hot-linked images; the UI falls back to this on <img> error.
app.get('/api/img', async (req, res) => {
  const u = String(req.query.u || '');
  if (!isPublicHttpUrl(u)) return res.status(400).end();
  try {
    const r = await request(u, {
      timeout: 8000,
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      headers: { Referer: new URL(u).origin + '/' },
    });
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return res.status(415).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 5e6) return res.status(413).end();
    res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' }).send(buf);
  } catch {
    res.status(502).end();
  }
});

// ---------------- Start ----------------

sweep();
await loadRates();
setInterval(loadRates, 6 * 3600e3).unref();
// Tracked products are re-checked automatically while the app is running (hourly look for due ones).
setInterval(() => runRecheck().catch(() => {}), 3600e3).unref();
setTimeout(() => runRecheck().catch(() => {}), 60e3).unref();

const server = app.listen(PORT, () => {
  const off = SOURCES.filter((s) => !enabled(s)).map((s) => `${s.name} (cần ${s.needsKey})`);
  console.log(`\n  Ăn Dặm Radar đang chạy: http://localhost:${PORT}`);
  console.log(`  Nguồn bật: ${SOURCES.filter(enabled).map((s) => s.name).join(', ')}`);
  if (off.length) console.log(`  Nguồn tắt: ${off.join(', ')}`);
  console.log(`  Tỷ giá: ${rates().source}${rates().updated ? ' — ' + rates().updated : ''}\n`);
});

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`\n  Cổng ${PORT} đang được dùng — có thể app đã chạy sẵn ở một cửa sổ khác.`);
  console.error(`  • Mở http://localhost:${PORT} để dùng bản đang chạy, hoặc`);
  console.error('  • Tắt bản cũ (Ctrl + C trong cửa sổ đó), hoặc');
  console.error('  • Đổi cổng: đặt PORT=3001 trong file .env rồi chạy lại.\n');
  process.exit(1);
});

const shutdown = () => {
  history.flushNow();
  watch.flushNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

