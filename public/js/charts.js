// Minimal SVG charts. Single-series (one color), thin marks, 4px rounded data end, hairline grid,
// value at the bar tip, per-mark hover tooltip.
import { esc } from './util.js';

const tip = () => document.getElementById('tooltip');
export function showTip(html, ev) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const pad = 14;
  const r = t.getBoundingClientRect();
  let x = ev.clientX + pad;
  let y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
export const hideTip = () => {
  tip().hidden = true;
};

function bindTips(svg, rows) {
  svg.addEventListener('mousemove', (e) => {
    const g = e.target.closest('[data-i]');
    if (!g) return hideTip();
    showTip(rows[Number(g.dataset.i)].tip, e);
  });
  svg.addEventListener('mouseleave', hideTip);
}

const barRight = (x, y, w, h, r) => {
  r = Math.min(r, w, h / 2);
  if (w <= 0) return '';
  return `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x}Z`;
};
const colTop = (x, base, w, h, r) => {
  r = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  const top = base - h;
  return `M${x},${base}V${top + r}A${r},${r} 0 0 1 ${x + r},${top}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${top + r}V${base}Z`;
};

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Horizontal bars. rows: [{ label, value, display?, tip? }]
 */
export function hbar(el, rows, { format = String, labelWidth = 150, rowH = 28, onClick } = {}) {
  if (!rows.length) {
    el.innerHTML = '<p class="muted small">Chưa đủ dữ liệu.</p>';
    return;
  }
  const W = Math.max(320, el.clientWidth || 480);
  const valW = 70;
  const plotW = W - labelWidth - valW;
  const max = Math.max(...rows.map((r) => r.value)) || 1;
  const H = rows.length * rowH + 4;
  const thick = Math.min(16, rowH - 10);
  const charLimit = Math.floor(labelWidth / 7.2);
  const body = rows.map((r, i) => {
    const y = i * rowH + (rowH - thick) / 2;
    const w = Math.max(2, (r.value / max) * plotW);
    const label = r.label ?? '';
    return `<g class="row" data-i="${i}" ${onClick ? 'style="cursor:pointer"' : ''}>
      <rect class="hit" x="0" y="${i * rowH}" width="${W}" height="${rowH}"/>
      <text x="${labelWidth - 10}" y="${i * rowH + rowH / 2 + 4}" text-anchor="end">${esc(truncate(label, charLimit))}</text>
      <path class="bar" d="${barRight(labelWidth, y, w, thick, 4)}"/>
      <text class="val" x="${labelWidth + w + 6}" y="${i * rowH + rowH / 2 + 4}">${esc(r.display ?? format(r.value))}</text>
    </g>`;
  }).join('');
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">
    <line class="baseline" x1="${labelWidth}" x2="${labelWidth}" y1="0" y2="${H - 4}"/>${body}</svg>`;
  const svg = el.firstElementChild;
  rows.forEach((r) => {
    r.tip ??= `<b>${esc(r.label)}</b><br>${esc(r.display ?? format(r.value))}`;
  });
  bindTips(svg, rows);
  if (onClick) svg.addEventListener('click', (e) => {
    const g = e.target.closest('[data-i]');
    if (g) onClick(rows[Number(g.dataset.i)]);
  });
}

/**
 * Vertical columns for a histogram. bins: [{ label, value, tip? }]
 */
export function columns(el, bins, { format = String, height = 220, yFormat = String } = {}) {
  if (!bins.length) {
    el.innerHTML = '<p class="muted small">Chưa đủ dữ liệu.</p>';
    return;
  }
  const W = Math.max(320, el.clientWidth || 480);
  const left = 34;
  const bottom = 34;
  const top = 18;
  const plotW = W - left - 4;
  const plotH = height - bottom - top;
  const max = Math.max(...bins.map((b) => b.value)) || 1;
  const step = niceStep(max / 4);
  const yMax = Math.ceil(max / step) * step;
  const slot = plotW / bins.length;
  const gap = 2;
  const w = Math.min(48, slot - gap);
  const base = top + plotH;
  let grid = '';
  for (let v = 0; v <= yMax; v += step) {
    const y = base - (v / yMax) * plotH;
    grid += `<line class="${v === 0 ? 'baseline' : 'grid-line'}" x1="${left}" x2="${W}" y1="${y}" y2="${y}"/>
      <text class="axis" x="${left - 6}" y="${y + 4}" text-anchor="end">${esc(yFormat(v))}</text>`;
  }
  const every = Math.ceil(bins.length / Math.max(1, Math.floor(plotW / 64)));
  const peak = bins.reduce((a, b, i) => (b.value > bins[a].value ? i : a), 0);
  const body = bins.map((b, i) => {
    const x = left + i * slot + (slot - w) / 2;
    const h = (b.value / yMax) * plotH;
    const showX = i % every === 0;
    return `<g data-i="${i}">
      <rect class="hit" x="${left + i * slot}" y="${top}" width="${slot}" height="${plotH}"/>
      <path class="bar" d="${colTop(x, base, w, Math.max(b.value ? 2 : 0, h), 4)}"/>
      ${i === peak && b.value ? `<text class="val" x="${x + w / 2}" y="${base - h - 6}" text-anchor="middle">${esc(format(b.value))}</text>` : ''}
      ${showX ? `<text class="axis" x="${left + i * slot + slot / 2}" y="${base + 16}" text-anchor="middle">${esc(b.label)}</text>` : ''}
    </g>`;
  }).join('');
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${height}" width="100%" height="${height}" role="img">${grid}${body}</svg>`;
  bins.forEach((b) => {
    b.tip ??= `<b>${esc(b.label)}</b><br>${esc(format(b.value))}`;
  });
  bindTips(el.firstElementChild, bins);
}

export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Tiny line for price history. points: [{t, v}] */
export function sparkline(points, w = 120, h = 30) {
  if (points.length < 2) return '';
  const xs = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs) || x0 + 1;
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const sx = (t) => 4 + ((t - x0) / (x1 - x0 || 1)) * (w - 8);
  const sy = (v) => (hi === lo ? h / 2 : 4 + (1 - (v - lo) / (hi - lo)) * (h - 8));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join('');
  const last = points.at(-1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/><circle cx="${sx(last.t)}" cy="${sy(last.v)}" r="3.5"/></svg>`;
}
