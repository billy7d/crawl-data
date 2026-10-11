// Reads one page through the real browser and runs the listing extractor on it:
//   node scripts/test-browser.js "https://shopee.vn/search?keyword=phô mai"
// SAVE=trang.html also writes the page to a file.
import { browserCtx, browserFetch, closeBrowser, newSession, closeSession } from '../src/lib/browser.js';
import fs from 'node:fs';
import { extractListing } from '../src/lib/extract.js';

const url = process.argv[2] || 'https://concung.com/search?search_query=b%C3%A1nh%20%C4%83n%20d%E1%BA%B7m';
const session = newSession();
const t0 = Date.now();
try {
  const r = await browserCtx.run({ session, onAttention: (a) => console.log('Cần bạn thao tác trên trình duyệt:', a) }, () => browserFetch(url));
  if (process.env.SAVE) fs.writeFileSync(process.env.SAVE, r.text);
  const rows = extractListing(r.text, r.url);
  console.log(`${r.url}\n${(r.text.length / 1024).toFixed(0)} KB, ${rows.length} sản phẩm, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const p of rows.slice(0, 8)) console.log(' -', p.title?.slice(0, 70), '|', p.price, p.currency || '');
} catch (e) {
  console.error('Lỗi:', e.message);
} finally {
  await closeSession(session);
  await closeBrowser();
}
