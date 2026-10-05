// Free machine translation via the public Google Translate web endpoint (no key).
// Used to search foreign markets in their own language and to translate foreign descriptions to Vietnamese.
import { remember } from './cache.js';
import { fetchJSON } from './http.js';
import { BRANDS, fold } from './normalize.js';

// The free endpoint rate-limits bursts, so calls go through a small semaphore.
let running = 0;
const waiters = [];
async function limited(fn) {
  if (running >= 3) await new Promise((r) => waiters.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

async function google(text, target, source) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'
    + `&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(text.slice(0, 4500))}`;
  const d = await fetchJSON(url, { timeout: 6000 });
  return { text: (d[0] || []).map((p) => p[0]).join(''), detected: d[2] || null };
}

// Fallback: MyMemory (free, anonymous quota ~5k chars/day). Needs an explicit source language.
async function mymemory(text, target, source) {
  const src = source === 'auto' ? (/[ăâđêôơư]/i.test(text) ? 'vi' : 'en') : source;
  const d = await fetchJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${src}|${target}`, { timeout: 6000 });
  if (d.responseStatus !== 200 && d.responseStatus !== '200') throw new Error(d.responseDetails || 'MyMemory lỗi');
  return { text: d.responseData?.translatedText || text, detected: src };
}

export async function translate(text, target, source = 'auto') {
  text = String(text || '').trim();
  if (!text) return { text: '', detected: null };
  const key = `tr:${source}:${target}:${text}`;
  const { value } = await remember(key, 30 * 24 * 3600e3, () => limited(async () => {
    try {
      return await google(text, target, source);
    } catch (e) {
      return mymemory(text, target, source).catch(() => { throw e; });
    }
  }));
  return value;
}

// Baby-food glossary applied before machine translation: generic MT turns "bánh ăn dặm" into "snack cake"
// and loses the baby context that foreign shop searches need. Longest phrases first.
const GLOSSARY = [
  ['bánh gạo ăn dặm', 'baby rice cakes'], ['bánh quy ăn dặm', 'baby biscuits'], ['bánh ăn dặm', 'baby snacks'],
  ['bột ăn dặm', 'baby cereal'], ['bột dinh dưỡng', 'baby cereal'], ['cháo ăn dặm', 'baby porridge'],
  ['súp ăn dặm', 'baby soup'], ['mì ăn dặm', 'baby noodles'], ['mỳ ăn dặm', 'baby noodles'], ['nui ăn dặm', 'baby pasta'],
  ['dầu ăn dặm', 'baby food oil'], ['hạt nêm ăn dặm', 'baby seasoning'], ['gia vị ăn dặm', 'baby seasoning'],
  ['ruốc ăn dặm', 'baby meat floss'], ['sữa chua ăn dặm', 'baby yogurt'], ['váng sữa', 'baby fromage frais'],
  ['hoa quả nghiền', 'baby fruit puree'], ['trái cây nghiền', 'baby fruit puree'], ['rau củ nghiền', 'baby vegetable puree'],
  ['đồ ăn dặm', 'baby food'], ['thức ăn dặm', 'baby food'], ['ăn dặm', 'baby food'], ['sữa công thức', 'infant formula'],
  ['sữa bột', 'formula milk'], ['cho bé', 'for baby'], ['cho trẻ', 'for kids'], ['trẻ em', 'kids'], ['trẻ sơ sinh', 'infant'],
];
const BABY_VI = /ăn dặm|cho bé|em bé|trẻ em|trẻ sơ sinh|nhũ nhi|\bbé\b/i;
const BABY_EN = /baby|babies|infant|toddler|kid|child|weaning/i;

function applyGlossary(q) {
  let s = ` ${q.toLowerCase()} `;
  for (const [vi, en] of GLOSSARY) s = s.split(vi).join(en);
  return s.trim();
}

// Vietnamese query -> search query for another market's language, keeping the baby-food context.
// Brand names must never be translated ("nestle" → French "se nicher", "plum" → "prune"): take them out,
// translate the rest, then put them back in front.
// Product-format words shops use untranslated everywhere (Italian 'sbuffi' for 'puffs' finds nothing).
const KEEP = ['puffs', 'puff', 'melts', 'yogurt melts', 'teethers', 'squeeze', 'bio'];
const BRAND_WORDS = [...new Set([...BRANDS, ...KEEP])]
  .map((b) => fold(b).split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean))
  .filter((ws) => ws.length && ws.join('').length >= 3)
  .sort((a, b) => b.length - a.length);
export function splitBrands(q) {
  const words = q.split(/\s+/).filter(Boolean);
  const f = words.map((w) => fold(w).replace(/[^a-z0-9]/g, ''));
  const used = new Array(words.length).fill(false);
  const brands = [];
  for (const bw of BRAND_WORDS) {
    for (let i = 0; i + bw.length <= words.length; i++) {
      if (used.slice(i, i + bw.length).some(Boolean) || !bw.every((w, k) => f[i + k] === w)) continue;
      brands.push(words.slice(i, i + bw.length).join(' '));
      for (let k = 0; k < bw.length; k++) used[i + k] = true;
    }
  }
  return { brands, rest: words.filter((_, i) => !used[i]).join(' ') };
}

export async function translateQuery(q, lang) {
  const base = lang.split('-')[0];
  if (base === 'vi') return q;
  const { brands, rest } = splitBrands(q);
  if (brands.length) {
    if (!rest.trim()) return brands.join(' ');
    return `${brands.join(' ')} ${await translateQuery(rest, lang)}`.replace(/\s+/g, ' ').trim();
  }
  const looksVi = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(q);
  let en = q;
  if (looksVi) {
    en = (await translate(applyGlossary(q), 'en', 'vi')).text || q;
    if (BABY_VI.test(q) && !BABY_EN.test(en)) en = `baby ${en}`;
  } else {
    const r = await translate(q, 'en');
    if (r.detected && r.detected !== 'en') en = r.text;
  }
  en = en.replace(/\s+/g, ' ').trim();
  if (base === 'en') return en;
  return (await translate(en, lang, 'en')).text || en;
}
