export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

const ZERO_DEC = new Set(['VND', 'JPY', 'KRW', 'IDR', 'TWD']);
export const fmtNum = (n, d = 0) => (n == null ? '' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }));
export const fmtVND = (n) => (n == null ? '' : `${Math.round(n).toLocaleString('vi-VN')} ₫`);
export function fmtShortVND(n) {
  if (n == null) return '';
  if (n >= 1e9) return `${fmtNum(n / 1e9, 1)} tỷ`;
  if (n >= 1e6) return `${fmtNum(n / 1e6, n >= 1e7 ? 0 : 1)} tr`;
  if (n >= 1e3) return `${fmtNum(n / 1e3, n >= 1e4 ? 0 : 1)}k`;
  return fmtNum(n);
}
export function fmtMoney(v, cur) {
  if (v == null) return '';
  if (!cur) return fmtNum(v, 2);
  try {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: cur, maximumFractionDigits: ZERO_DEC.has(cur) ? 0 : 2 }).format(v);
  } catch {
    return `${fmtNum(v, 2)} ${cur}`;
  }
}
export const fmtCompact = (n) => (n == null ? '' : new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
export const fmtPct = (x, d = 0) => `${x > 0 ? '+' : ''}${fmtNum(x, d)}%`;

export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
export const median = (arr) => quantile([...arr].sort((a, b) => a - b), 0.5);

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

export const ageLabel = (m) => (m == null ? '' : m >= 12 && m % 12 === 0 ? `${m / 12} tuổi+` : `${m} tháng+`);

const GLOBE = '<svg class="globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
export function flag(code) {
  if (!code) return '';
  if (code === 'world') return GLOBE;
  return `<img class="flag" src="https://flagcdn.com/36x27/${esc(code)}.png" alt="${esc(code.toUpperCase())}" loading="lazy" referrerpolicy="no-referrer">`;
}

export function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function load(key, fallback) {
  try {
    const v = localStorage.getItem('adr:' + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    localStorage.setItem('adr:' + key, JSON.stringify(value));
  } catch { /* storage unavailable */ }
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
