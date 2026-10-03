// Two-level cache (memory + JSON files on disk) with TTL and in-flight de-duplication.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = path.resolve('data', 'cache');
fs.mkdirSync(DIR, { recursive: true });

const mem = new Map();
const inflight = new Map();
const MAX_MEM = 2000;

export const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const file = (key) => path.join(DIR, hash(key) + '.json');

export function get(key) {
  const now = Date.now();
  const m = mem.get(key);
  if (m) {
    if (m.exp > now) return m.value;
    mem.delete(key);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file(key), 'utf8'));
    if (raw.exp > now) {
      mem.set(key, raw);
      return raw.value;
    }
  } catch { /* miss */ }
  return undefined;
}

export function set(key, value, ttlMs) {
  const entry = { exp: Date.now() + ttlMs, value };
  mem.set(key, entry);
  if (mem.size > MAX_MEM) mem.delete(mem.keys().next().value);
  fs.writeFile(file(key), JSON.stringify(entry), () => {});
}

export function del(key) {
  mem.delete(key);
  fs.rm(file(key), { force: true }, () => {});
}

// Returns cached value or computes it once even if called concurrently.
export async function remember(key, ttlMs, fn) {
  const hit = get(key);
  if (hit !== undefined) return { value: hit, cached: true };
  if (inflight.has(key)) return { value: await inflight.get(key), cached: false };
  const p = (async () => {
    const value = await fn();
    set(key, value, ttlMs);
    return value;
  })();
  inflight.set(key, p);
  try {
    return { value: await p, cached: false };
  } finally {
    inflight.delete(key);
  }
}

// Remove expired files at startup so the cache folder doesn't grow forever.
export function sweep() {
  const now = Date.now();
  for (const f of fs.readdirSync(DIR)) {
    const p = path.join(DIR, f);
    try {
      const { exp } = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!(exp > now)) fs.rmSync(p, { force: true });
    } catch {
      fs.rmSync(p, { force: true });
    }
  }
}

export function clearAll() {
  mem.clear();
  for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { force: true });
}
