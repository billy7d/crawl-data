// Source settings edited from the UI: persisted to .env (comments and other lines kept) and applied to
// process.env immediately, so sources pick them up on the next search without a restart.
import fs from 'node:fs';
import path from 'node:path';
import { request } from './http.js';

const ENV_FILE = path.resolve('.env');
const EXAMPLE_FILE = path.resolve('.env.example');

// Scraping-proxy providers: the user pastes only the API key, the URL template is built here.
// Plain (non-rendered) requests cost one credit on every provider's free plan.
export const PROXY_PROVIDERS = {
  scraperapi: { name: 'ScraperAPI', signup: 'https://www.scraperapi.com/signup', template: (k) => `https://api.scraperapi.com/?api_key=${k}&url={url}` },
  scrapingbee: { name: 'ScrapingBee', signup: 'https://app.scrapingbee.com/account/register', template: (k) => `https://app.scrapingbee.com/api/v1/?api_key=${k}&render_js=false&url={url}` },
  zenrows: { name: 'ZenRows', signup: 'https://app.zenrows.com/register', template: (k) => `https://api.zenrows.com/v1/?apikey=${k}&url={url}` },
};

export const mask = (s) => (!s ? '' : s.length <= 10 ? '•'.repeat(s.length) : `${s.slice(0, 4)}…${s.slice(-4)}`);

function describeProxy(tpl) {
  if (!tpl) return { set: false };
  for (const [id, p] of Object.entries(PROXY_PROVIDERS)) {
    const host = new URL(p.template('x').replace('{url}', '')).hostname;
    if (tpl.includes(host)) {
      const key = tpl.match(/api_?key=([^&]+)/i)?.[1] || '';
      return { set: true, provider: id, masked: mask(key) };
    }
  }
  return { set: true, provider: 'custom', masked: mask(tpl.replace(/^https?:\/\//, '').split('?')[0]) };
}

export function readSettings() {
  const e = process.env;
  return {
    SERPER_API_KEY: { set: !!e.SERPER_API_KEY, masked: mask(e.SERPER_API_KEY) },
    BRAVE_API_KEY: { set: !!e.BRAVE_API_KEY, masked: mask(e.BRAVE_API_KEY) },
    SEARXNG_URL: { set: !!e.SEARXNG_URL, value: e.SEARXNG_URL || '' },
    SCRAPE_PROXY: describeProxy(e.SCRAPE_PROXY),
    SEARCH_CACHE_HOURS: { value: Number(e.SEARCH_CACHE_HOURS || 6) },
    SALES_CHECK_HOURS: { value: Number(e.SALES_CHECK_HOURS || 24) },
  };
}

const KEY_RE = /^[\w.-]{16,200}$/;

// Turn a UI payload into env changes ({ KEY: value | null }), rejecting malformed values.
export function validate(body) {
  const changes = {};
  const errors = [];
  const str = (v) => String(v ?? '').trim();
  if ('SERPER_API_KEY' in body) {
    const v = str(body.SERPER_API_KEY);
    if (v && !KEY_RE.test(v)) errors.push('Khóa Serper không hợp lệ (chỉ gồm chữ, số, dài 16+ ký tự).');
    else changes.SERPER_API_KEY = v || null;
  }
  if ('BRAVE_API_KEY' in body) {
    const v = str(body.BRAVE_API_KEY);
    if (v && !KEY_RE.test(v)) errors.push('Khóa Brave không hợp lệ.');
    else changes.BRAVE_API_KEY = v || null;
  }
  if ('SEARXNG_URL' in body) {
    const v = str(body.SEARXNG_URL).replace(/\/+$/, '');
    if (v && !/^https?:\/\/[^\s]+$/.test(v)) errors.push('Địa chỉ SearXNG phải bắt đầu bằng http:// hoặc https://');
    else changes.SEARXNG_URL = v || null;
  }
  if ('proxyKey' in body || 'SCRAPE_PROXY' in body) {
    const provider = str(body.proxyProvider) || 'scraperapi';
    if (provider === 'custom') {
      const v = str(body.SCRAPE_PROXY);
      if (v && !/^https?:\/\/\S+$/.test(v)) errors.push('URL proxy phải bắt đầu bằng http(s)://');
      else if (v && !v.includes('{url}')) errors.push('URL proxy phải chứa {url} ở chỗ đặt địa chỉ trang cần lấy.');
      else changes.SCRAPE_PROXY = v || null;
    } else if (PROXY_PROVIDERS[provider]) {
      const k = str(body.proxyKey);
      if (k && !KEY_RE.test(k)) errors.push(`Khóa ${PROXY_PROVIDERS[provider].name} không hợp lệ.`);
      else changes.SCRAPE_PROXY = k ? PROXY_PROVIDERS[provider].template(k) : null;
    } else errors.push('Nhà cung cấp proxy không hợp lệ.');
  }
  if ('SEARCH_CACHE_HOURS' in body) {
    const n = Number(body.SEARCH_CACHE_HOURS);
    if (!(n >= 0.5 && n <= 168)) errors.push('Thời gian lưu tạm phải từ 0,5 đến 168 giờ.');
    else changes.SEARCH_CACHE_HOURS = String(n);
  }
  if ('SALES_CHECK_HOURS' in body) {
    const n = Number(body.SALES_CHECK_HOURS);
    if (!(n >= 1 && n <= 720)) errors.push('Chu kỳ kiểm tra lượt bán phải từ 1 đến 720 giờ.');
    else changes.SALES_CHECK_HOURS = String(n);
  }
  return { changes, errors };
}

const quote = (v) => `"${String(v).replace(/[\r\n]/g, '').replace(/"/g, '\\"')}"`;

export function applySettings(changes) {
  let lines;
  try {
    lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
  } catch {
    try {
      lines = fs.readFileSync(EXAMPLE_FILE, 'utf8').split(/\r?\n/);
    } catch {
      lines = [];
    }
  }
  for (const [key, value] of Object.entries(changes)) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    const line = value == null ? `${key}=` : `${key}=${quote(value)}`;
    if (i >= 0) lines[i] = line;
    else lines.push(line);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  const tmp = ENV_FILE + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n').replace(/\n*$/, '\n'));
  fs.renameSync(tmp, ENV_FILE);
}

// Live check of a candidate value before (or after) saving. Returns { ok, message }.
export async function testSetting(kind, body) {
  const v = validate(body);
  if (v.errors.length) return { ok: false, message: v.errors[0] };
  try {
    if (kind === 'serper') {
      const key = String(body.SERPER_API_KEY || process.env.SERPER_API_KEY || '').trim();
      if (!key) return { ok: false, message: 'Chưa nhập khóa.' };
      const res = await request('https://google.serper.dev/shopping', {
        method: 'POST', timeout: 10000, accept: 'application/json',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: 'baby food', gl: 'us', num: 10 }),
      });
      const d = await res.json();
      return { ok: true, message: `Khóa hoạt động — thử Google Shopping trả về ${d.shopping?.length ?? 0} sản phẩm.` };
    }
    if (kind === 'brave') {
      const key = String(body.BRAVE_API_KEY || process.env.BRAVE_API_KEY || '').trim();
      if (!key) return { ok: false, message: 'Chưa nhập khóa.' };
      const res = await request('https://api.search.brave.com/res/v1/web/search?q=baby%20food&count=5', {
        timeout: 10000, accept: 'application/json', headers: { 'X-Subscription-Token': key },
      });
      const d = await res.json();
      return { ok: true, message: `Khóa hoạt động — ${d.web?.results?.length ?? 0} kết quả thử.` };
    }
    if (kind === 'searxng') {
      const base = (v.changes.SEARXNG_URL ?? process.env.SEARXNG_URL ?? '').replace(/\/+$/, '');
      if (!base) return { ok: false, message: 'Chưa nhập địa chỉ.' };
      const res = await request(`${base}/search?q=baby%20food&format=json`, { timeout: 12000, accept: 'application/json' });
      const d = await res.json().catch(() => null);
      if (!d) return { ok: false, message: 'SearXNG chưa bật định dạng JSON (xem searxng/settings.yml).' };
      return { ok: true, message: `Kết nối được — ${d.results?.length ?? 0} kết quả thử.` };
    }
    if (kind === 'proxy') {
      const tpl = v.changes.SCRAPE_PROXY ?? process.env.SCRAPE_PROXY;
      if (!tpl) return { ok: false, message: 'Chưa nhập khóa.' };
      const res = await request(tpl.replace('{url}', encodeURIComponent('https://example.com/')), { timeout: 60000 });
      const text = await res.text();
      return /Example Domain/i.test(text)
        ? { ok: true, message: 'Proxy hoạt động — đã tải thử một trang qua proxy.' }
        : { ok: false, message: 'Proxy trả về nội dung lạ — kiểm tra lại khóa/gói dịch vụ.' };
    }
    return { ok: false, message: 'Loại kiểm tra không hợp lệ.' };
  } catch (e) {
    const auth = e.status === 401 || e.status === 403;
    return { ok: false, message: auth ? 'Khóa bị từ chối (sai khóa hoặc hết lượt miễn phí).' : `Không kiểm tra được: ${e.message}` };
  }
}
