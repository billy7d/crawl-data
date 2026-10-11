// Runs sources through the real browser with their own readers (what a search does when they are blocked
// or the proxy is out of credits):  node scripts/test-browser-sources.js walmart:us iherb:us "phô mai"
import { browserCtx, closeBrowser, newSession } from '../src/lib/browser.js';
import { byId } from '../src/sources/index.js';
import { translateQuery } from '../src/lib/translate.js';
import { MARKETS } from '../src/lib/markets.js';

try {
  process.loadEnvFile('.env');
} catch { /* no .env */ }
const args = process.argv.slice(2);
const q = args.find((a) => !a.includes(':')) || 'bánh ăn dặm';
const session = newSession();
for (const spec of args.filter((a) => a.includes(':'))) {
  const [id, market] = spec.split(':');
  const src = byId[id];
  if (!src) {
    console.log(id, '— không có nguồn này');
    continue;
  }
  const t0 = Date.now();
  try {
    const query = await translateQuery(q, MARKETS[market]?.lang || 'en');
    const rows = await browserCtx.run({ session, onAttention: (a) => console.log('  cần thao tác:', a) }, () => src.search({ q: query, market }));
    console.log(`${id}:${market} "${query}" → ${rows.length} sản phẩm, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    for (const p of rows.slice(0, 3)) console.log('   -', String(p.title).slice(0, 60), '|', p.price, p.currency || '');
  } catch (e) {
    console.log(`${id}:${market} lỗi: ${e.message} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
}
await closeBrowser();
