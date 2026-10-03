// Smoke test: run every source once and print counts/timings + a sample row.
// Usage: node scripts/test-sources.js "bột ăn dặm hipp" [sourceId ...]
import { SOURCES, supports, enabled } from '../src/sources/index.js';
import { makeItem } from '../src/lib/item.js';
import { loadRates } from '../src/lib/currency.js';
import { translateQuery } from '../src/lib/translate.js';
import { MARKETS } from '../src/lib/markets.js';

const q = process.argv[2] || 'bột ăn dặm hipp';
const only = process.argv.slice(3);
await loadRates();

const plan = [];
for (const s of SOURCES) {
  if (only.length && !only.includes(s.id)) continue;
  if (!enabled(s)) {
    console.log(`- ${s.id}: bỏ qua (thiếu ${s.needsKey})`);
    continue;
  }
  const market = s.global ? 'us' : supports(s, 'vn') ? 'vn' : (s.markets === '*' ? 'vn' : s.markets[0]);
  plan.push([s, market]);
}

await Promise.all(plan.map(async ([s, market]) => {
  const t = Date.now();
  try {
    const query = await translateQuery(q, MARKETS[market].lang).catch(() => q);
    const raw = await s.search({ q: query, market, signal: AbortSignal.timeout(15000) });
    const items = raw.map((r) => makeItem({ ...r, source: s.id, kind: s.kind }, { market, queries: [q, query] }));
    const withPrice = items.filter((i) => i.price != null).length;
    const withImg = items.filter((i) => i.image).length;
    console.log(`✓ ${s.id.padEnd(10)} [${market}] "${query}" ${String(items.length).padStart(3)} items, ${withPrice} giá, ${withImg} ảnh, ${Date.now() - t}ms`);
    const x = items[0];
    if (x) console.log('   ', JSON.stringify({ title: x.title, price: x.price, cur: x.currency, vnd: x.priceVND, qty: x.qty?.label, p100: x.pricePer100VND, brand: x.brand, country: x.country, age: x.ageMonths, type: x.type, url: x.url?.slice(0, 90), img: x.image?.slice(0, 70) }));
  } catch (e) {
    console.log(`✗ ${s.id.padEnd(10)} [${market}] ${e.message} (${Date.now() - t}ms)`);
  }
}));
