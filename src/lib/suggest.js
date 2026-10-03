// Keyword research from free autocomplete endpoints (Google + DuckDuckGo):
// what shoppers actually type around a product.
import { remember } from './cache.js';
import { fetchJSON, request } from './http.js';
import { fold } from './normalize.js';

async function google(q, hl = 'vi', gl = 'vn', signal) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`;
  const res = await request(url, { signal, timeout: 4000, accept: 'application/json' });
  // Google answers in the locale's legacy charset for some hl values; decode explicitly as UTF-8 bytes.
  const buf = Buffer.from(await res.arrayBuffer());
  const d = JSON.parse(buf.toString('utf8'));
  return d[1] || [];
}

async function ddg(q, kl = 'vn-vi', signal) {
  const d = await fetchJSON(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&kl=${kl}`, { signal, timeout: 4000 });
  return (d || []).map((x) => x.phrase);
}

export async function suggest(q, { hl = 'vi', gl = 'vn', kl = 'vn-vi' } = {}) {
  q = String(q || '').trim();
  if (!q) return [];
  const { value } = await remember(`sug:${hl}:${gl}:${q}`, 24 * 3600e3, async () => {
    const [g, d] = await Promise.allSettled([google(q, hl, gl), ddg(q, kl)]);
    const all = [...(g.value || []), ...(d.value || [])];
    const seen = new Set();
    return all.filter((s) => {
      const k = fold(s).trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 12);
  });
  return value;
}

const MODIFIERS = ['', ' cho bé', ' loại nào tốt', ' giá', ' review', ' hữu cơ', ' 6 tháng', ' nhập khẩu', ' của nhật', ' cho bé 1 tuổi', ' tốt nhất', ' mua ở đâu'];

// Expand a seed keyword with common shopper modifiers, then count which words co-occur most.
export async function keywordResearch(q) {
  q = String(q || '').trim();
  const { value } = await remember(`kw:v2:${q}`, 24 * 3600e3, async () => {
    const groups = await Promise.all(MODIFIERS.map(async (m) => {
      try {
        return { seed: (q + m).trim(), suggestions: await suggest(q + m) };
      } catch {
        return { seed: (q + m).trim(), suggestions: [] };
      }
    }));
    // Function words carry no shopper intent.
    const STOP = ['cho', 'be', 'cua', 'co', 'va', 'la', 'nao', 'bao', 'nhieu', 'gi', 'khong', 'duoc', 'cac', 'nhung', 'o', 'dau',
      'may', 'thi', 'voi', 'trong', 'tu', 'den', 'cai', 'con', 'em', 'nhu', 'the', 'for', 'of', 'and', 'to', 'in'];
    const seedTokens = new Set([...fold(q).split(/\s+/), ...STOP]);
    const freq = new Map(); // folded token -> { term (accented display form), count }
    const unique = new Map();
    for (const g of groups) {
      for (const s of g.suggestions) {
        unique.set(fold(s), s);
        const words = new Map(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => [fold(w), w]));
        for (const [k, w] of words) {
          if (k.length < 2 || seedTokens.has(k)) continue;
          const e = freq.get(k) || { term: w, count: 0 };
          if (e.term === fold(e.term) && w !== fold(w)) e.term = w; // prefer the accented spelling for display
          e.count++;
          freq.set(k, e);
        }
      }
    }
    const terms = [...freq.values()].sort((a, b) => b.count - a.count).slice(0, 30);
    return { seed: q, groups: groups.filter((g) => g.suggestions.length), terms, total: unique.size };
  });
  return value;
}
