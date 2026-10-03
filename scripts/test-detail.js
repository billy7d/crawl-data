// Usage: node scripts/test-detail.js <url> [url...]
import { fetchText } from '../src/lib/http.js';
import { extractDetail } from '../src/lib/extract.js';
for (const url of process.argv.slice(2)) {
  const t = Date.now();
  try {
    const { text, url: final } = await fetchText(url, { timeout: 10000 });
    const t2 = Date.now();
    const d = extractDetail(text, final);
    console.log(`\n=== ${url.slice(0, 80)} (${t2 - t}ms fetch, ${Date.now() - t2}ms parse, ${text.length}b)`);
    const { textSample, ...rest } = d;
    console.log(JSON.stringify(rest, null, 1).slice(0, 2200));
  } catch (e) { console.log(`\n=== ${url}: ERR ${e.message}`); }
}
