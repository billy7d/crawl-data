// Dev check: classify a few foreign products against Vietnamese channels.
// Usage: node scripts/test-import-check.js [port]
const port = process.argv[2] || 3000;
const items = [
  { id: 'a', title: 'HiPP Organic Baby Rice Cereal 200g', brand: 'HiPP', country: 'de' },
  { id: 'b', title: 'Gerber Puffs Cereal Snack Strawberry Apple 42g', brand: 'Gerber', country: 'us' },
  { id: 'c', title: "Ella's Kitchen Organic Mango Smoothie Pouch 90g", brand: "Ella's Kitchen", country: 'gb' },
  { id: 'd', title: "Rafferty's Garden Apple Banana Pear Baby Food Pouch 120g", brand: "Rafferty's Garden", country: 'au' },
  { id: 'e', title: 'Little Freddie Organic Peachy Pears Pouch 100g', brand: 'Little Freddie', country: 'gb' },
];
const t0 = Date.now();
const res = await fetch(`http://localhost:${port}/api/import-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
let buf = '';
for await (const chunk of res.body) {
  buf += Buffer.from(chunk).toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.type === 'result') {
      const r = msg.result;
      console.log(`\n[${((Date.now() - t0) / 1000).toFixed(1)}s] ${r.product.title}\n  => ${r.class.toUpperCase()} (khớp ${r.confidence}) | tin VN: ${r.vn.listings} (mạnh ${r.vn.strong}), chuỗi: ${r.chains.join(', ') || '-'}, NK: ${r.importers.join('; ') || '-'}, đã bán: ${r.vn.sold}`);
      r.reasons.forEach((x) => console.log('   -', x));
      r.matches.slice(0, 3).forEach((m) => console.log(`     · ${m.score} ${m.source}${m.chain ? '/' + m.chain : ''} | ${m.title.slice(0, 70)} | ${m.importer || ''}`));
    } else if (msg.type !== 'start') console.log(msg);
  }
}
