// Sales history: snapshots of Vietnamese listings (sold count, reviews, price) over time, and a list of
// foreign products the user tracks for official-import status. Stored in SQLite (built into Node).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DIR = path.resolve('data');
fs.mkdirSync(DIR, { recursive: true });
const db = new DatabaseSync(path.join(DIR, 'sales.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS listings (
    key TEXT PRIMARY KEY, source TEXT, url TEXT, title TEXT, brand TEXT, seller TEXT, chain TEXT, importer TEXT,
    first_seen INTEGER, last_seen INTEGER
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    key TEXT, t INTEGER, sold INTEGER, reviews INTEGER, rating REAL, price_vnd INTEGER
  );
  CREATE INDEX IF NOT EXISTS snapshots_key_t ON snapshots(key, t);
  CREATE TABLE IF NOT EXISTS importers (
    brand_key TEXT, brand TEXT, importer_key TEXT, importer TEXT, source TEXT, url TEXT,
    first_seen INTEGER, last_seen INTEGER, seen INTEGER DEFAULT 1,
    PRIMARY KEY (brand_key, importer_key)
  );
  CREATE TABLE IF NOT EXISTS tracked (
    id TEXT PRIMARY KEY, product TEXT, added_at INTEGER, last_check INTEGER, last_class TEXT, last_result TEXT,
    class_history TEXT
  );
`);

const SNAP_GAP = 12 * 3600e3;
const DAY = 86400e3;

// Same listing across runs: URL without query/hash (falls back to source + title).
export const listingKey = (l) => (l.url ? l.url.split(/[?#]/)[0].replace(/\/$/, '').toLowerCase() : `${l.source}:${l.title}`.toLowerCase());

const upsertListing = db.prepare(`
  INSERT INTO listings (key, source, url, title, brand, seller, chain, importer, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET title = excluded.title, seller = COALESCE(excluded.seller, seller),
    chain = COALESCE(excluded.chain, chain), importer = COALESCE(excluded.importer, importer), last_seen = excluded.last_seen`);
const lastSnap = db.prepare('SELECT t, sold, reviews FROM snapshots WHERE key = ? ORDER BY t DESC LIMIT 1');
const insertSnap = db.prepare('INSERT INTO snapshots (key, t, sold, reviews, rating, price_vnd) VALUES (?, ?, ?, ?, ?, ?)');

// Record Vietnamese listings seen in a search or an import check (at most one snapshot per 12h each,
// sooner if the numbers moved).
export function recordListings(list, now = Date.now()) {
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const l of list) {
      if (!l?.url && !l?.title) continue;
      const key = listingKey(l);
      upsertListing.run(key, l.source || null, l.url || null, l.title || null, l.brand || null, l.seller || null, l.chain || null, l.importer || null, now, now);
      if (l.sold == null && l.reviews == null && l.priceVND == null) continue;
      const last = lastSnap.get(key);
      const moved = last && ((l.sold ?? null) !== last.sold || (l.reviews ?? null) !== last.reviews);
      if (last && now - last.t < SNAP_GAP && !moved) continue;
      insertSnap.run(key, now, l.sold ?? null, l.reviews ?? null, l.rating ?? null, l.priceVND ?? null);
      n++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return n;
}

const snapsOf = db.prepare('SELECT t, sold, reviews, price_vnd AS priceVND FROM snapshots WHERE key = ? AND t >= ? ORDER BY t');

// Units per week from the first and last snapshot in the window (sold count, or reviews when no sold count).
function rate(points, field) {
  const pts = points.filter((p) => p[field] != null);
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = pts.at(-1);
  const days = (b.t - a.t) / DAY;
  if (days < 0.5) return null;
  return Math.max(0, ((b[field] - a[field]) / days) * 7);
}

export function listingHistory(l, days = 90) {
  const points = snapsOf.all(listingKey(l), Date.now() - days * DAY);
  return { points, soldPerWeek: rate(points, 'sold'), reviewsPerWeek: rate(points, 'reviews') };
}

// Combined history of all Vietnamese listings matched to one product: total sold per day, rates per week.
export function productHistory(matches, days = 90) {
  const per = matches.map((m) => listingHistory(m, days));
  const byDay = new Map();
  per.forEach((h) => {
    // Last known sold count of each listing per day, summed across listings.
    const daily = new Map();
    for (const p of h.points) if (p.sold != null) daily.set(Math.floor(p.t / DAY), p.sold);
    for (const [d, v] of daily) byDay.set(d, (byDay.get(d) || 0) + v);
  });
  const series = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, v]) => ({ t: d * DAY, v }));
  const sum = (k) => {
    const vals = per.map((h) => h[k]).filter((v) => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0)) : null;
  };
  const firstSeen = Math.min(...per.flatMap((h) => h.points.map((p) => p.t)), Infinity);
  return {
    soldPerWeek: sum('soldPerWeek'),
    reviewsPerWeek: sum('reviewsPerWeek'),
    series,
    trackedDays: Number.isFinite(firstSeen) ? Math.round((Date.now() - firstSeen) / DAY) : 0,
    snapshots: per.reduce((s, h) => s + h.points.length, 0),
  };
}

// ---------- Importer / distributor directory (accumulates across every check) ----------

const squash = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  .replace(/\b(cong ty|cty|c ty|tnhh|co phan|ctcp|mtv|thuong mai|dich vu|xuat nhap khau|xnk|tm|dv|viet nam|vn)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, '');

export function recordImporter(brand, importer, source = null, url = null, now = Date.now()) {
  if (!brand || !importer) return;
  db.prepare(`INSERT INTO importers (brand_key, brand, importer_key, importer, source, url, first_seen, last_seen, seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(brand_key, importer_key) DO UPDATE SET last_seen = excluded.last_seen, seen = seen + 1,
      url = COALESCE(excluded.url, url), source = COALESCE(excluded.source, source)`)
    .run(squash(brand), brand, squash(importer), importer, source, url, now, now);
}

export function listImporters(q = '') {
  const rows = db.prepare('SELECT brand, importer, source, url, first_seen AS firstSeen, last_seen AS lastSeen, seen FROM importers ORDER BY brand, seen DESC').all();
  const f = squash(q);
  return f ? rows.filter((r) => squash(r.brand).includes(f) || squash(r.importer).includes(f)) : rows;
}

export const knownImporter = (brand) => db.prepare('SELECT importer FROM importers WHERE brand_key = ? ORDER BY seen DESC LIMIT 1').get(squash(brand))?.importer || null;

// ---------- Tracked products ----------

const rowToTracked = (r) => ({
  id: r.id,
  product: JSON.parse(r.product),
  addedAt: r.added_at,
  lastCheck: r.last_check,
  lastClass: r.last_class,
  result: r.last_result ? JSON.parse(r.last_result) : null,
  classHistory: JSON.parse(r.class_history || '[]'),
});

export const listTracked = () => db.prepare('SELECT * FROM tracked ORDER BY added_at DESC').all().map(rowToTracked);
export const getTracked = (id) => {
  const r = db.prepare('SELECT * FROM tracked WHERE id = ?').get(id);
  return r ? rowToTracked(r) : null;
};

export function track(product, result = null) {
  const now = Date.now();
  const hist = result ? [{ t: now, class: result.class }] : [];
  db.prepare(`INSERT INTO tracked (id, product, added_at, last_check, last_class, last_result, class_history) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(product.id, JSON.stringify(product), now, result ? now : null, result?.class || null,
    result ? JSON.stringify(result) : null, JSON.stringify(hist));
  return getTracked(product.id);
}

export const untrack = (id) => db.prepare('DELETE FROM tracked WHERE id = ?').run(id);

// Save a fresh check; the class history keeps every change (e.g. "absent" → "nkcn" when a distributor appears).
export function saveCheck(id, result) {
  const cur = getTracked(id);
  if (!cur) return null;
  const now = Date.now();
  const hist = cur.classHistory;
  if (!hist.length || hist.at(-1).class !== result.class) hist.push({ t: now, class: result.class });
  db.prepare('UPDATE tracked SET last_check = ?, last_class = ?, last_result = ?, class_history = ? WHERE id = ?')
    .run(now, result.class, JSON.stringify(result), JSON.stringify(hist.slice(-50)), id);
  return getTracked(id);
}

export const dueTracked = (olderThanMs) => listTracked().filter((t) => !t.lastCheck || Date.now() - t.lastCheck >= olderThanMs);

export function stats() {
  return {
    listings: db.prepare('SELECT COUNT(*) n FROM listings').get().n,
    snapshots: db.prepare('SELECT COUNT(*) n FROM snapshots').get().n,
    tracked: db.prepare('SELECT COUNT(*) n FROM tracked').get().n,
  };
}
