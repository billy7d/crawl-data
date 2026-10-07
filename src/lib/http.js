// HTTP helpers: timeout, browser-like headers, abort propagation, optional scraping-proxy fallback.

// One consistent Chrome identity: UA and client hints must agree, or bot filters (Akamai, PerimeterX) notice.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const CLIENT_HINTS = {
  'sec-ch-ua': '"Chromium";v="138", "Google Chrome";v="138", "Not)A;Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

// Bot-wall pages served with a 200 status.
const BLOCK_PAGE = /captcha|robot or human|just a moment\.\.\.|attention required|pardon our interruption|access denied|px-captcha|_incapsula_|are you a robot|unusual traffic/i;
export const looksBlocked = (status, text) => [202, 403, 429, 503].includes(status) || (text.length < 40000 && BLOCK_PAGE.test(text));

// SCRAPE_PROXY is a URL template with {url}, e.g. ScraperAPI: https://api.scraperapi.com/?api_key=KEY&url={url}
// When the proxy plan runs out of credits it answers 403 to everything: stop calling it for a while (sources
// that can read directly still do) and report why, instead of every search waiting on failing requests.
let proxyDown = { until: 0, reason: null };
export const proxyStatus = () => ({ configured: !!process.env.SCRAPE_PROXY, down: Date.now() < proxyDown.until, reason: Date.now() < proxyDown.until ? proxyDown.reason : null });
export const resetProxyStatus = () => { proxyDown = { until: 0, reason: null }; };
export const proxyEnabled = () => !!process.env.SCRAPE_PROXY && Date.now() >= proxyDown.until;
// proxyExtra: provider options for hard sites (e.g. ScraperAPI "&premium=true" for Lazada), inserted before url=.
const viaProxy = (url, extra = '') => {
  const tpl = process.env.SCRAPE_PROXY;
  const t = extra && tpl.includes('scraperapi.com') ? tpl.replace('url={url}', `${extra.replace(/^&/, '')}&url={url}`) : tpl;
  return t.replace('{url}', encodeURIComponent(url));
};

// Scraping proxies cap simultaneous requests per plan (ScraperAPI free: 5) and answer 429 above it.
// Queue instead of firing everything at once, so a busy import check doesn't turn into fake "blocks".
// Slow requests (lane 'slow': Lazada's premium pool, 10–35s each) may not take the last three slots, so quick
// proxied requests (Tiki, ~3s) never queue behind them.
let proxyActive = 0;
let slowActive = 0;
let proxyWaiters = [];
async function withProxySlot(lane, fn) {
  const max = Math.max(1, Number(process.env.PROXY_CONCURRENCY) || 5);
  const slowMax = Math.max(1, max - 3);
  const free = () => proxyActive < max && (lane !== 'slow' || slowActive < slowMax);
  while (!free()) await new Promise((r) => proxyWaiters.push(r));
  proxyActive++;
  if (lane === 'slow') slowActive++;
  try {
    return await fn();
  } finally {
    proxyActive--;
    if (lane === 'slow') slowActive--;
    // Wake everyone: a waiter of the other lane may be the one that can go now.
    const w = proxyWaiters;
    proxyWaiters = [];
    w.forEach((r) => r());
  }
}

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function buildSignal(signal, timeout) {
  const t = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, t]) : t;
}

// Lightweight domain-based Cookie Jar to preserve session cookies across requests
const cookieJar = new Map();

export function getCookiesForUrl(url) {
  try {
    const { hostname } = new URL(url);
    const domain = hostname.toLowerCase();
    const cookies = [];
    for (const [host, jar] of cookieJar.entries()) {
      if (domain === host || domain.endsWith('.' + host)) {
        for (const [k, v] of jar.entries()) {
          cookies.push(`${k}=${v}`);
        }
      }
    }
    return cookies.join('; ');
  } catch {
    return '';
  }
}

const MAX_HOSTS = 300;
const MAX_COOKIES_PER_HOST = 50;

// Only the first name=value pair of a Set-Cookie header is the cookie; the rest are attributes.
export function setCookieForUrl(url, setCookieHeader) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    const [pair, ...attrs] = String(setCookieHeader).split(';');
    const idx = pair.indexOf('=');
    if (idx <= 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k) return;
    let expired = v === '';
    for (const a of attrs) {
      const i = a.indexOf('=');
      const name = (i < 0 ? a : a.slice(0, i)).trim().toLowerCase();
      const val = i < 0 ? '' : a.slice(i + 1).trim();
      if (name === 'max-age' && Number(val) <= 0) expired = true;
      if (name === 'expires') {
        const t = Date.parse(val);
        if (!Number.isNaN(t) && t < Date.now()) expired = true;
      }
    }
    if (expired) {
      cookieJar.get(host)?.delete(k);
      return;
    }
    if (!cookieJar.has(host)) {
      if (cookieJar.size >= MAX_HOSTS) cookieJar.delete(cookieJar.keys().next().value);
      cookieJar.set(host, new Map());
    }
    const jar = cookieJar.get(host);
    if (!jar.has(k) && jar.size >= MAX_COOKIES_PER_HOST) jar.delete(jar.keys().next().value);
    jar.set(k, v);
  } catch {}
}

export function saveResponseCookies(url, res) {
  if (!res || !res.headers) return;
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of setCookies) {
    setCookieForUrl(url, c);
  }
}

export async function request(url, {
  timeout = 8000,
  headers = {},
  method = 'GET',
  body,
  signal,
  lang = 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  okStatuses,
} = {}) {
  let res;
  // One Cookie header: jar first, explicit cookies (any header case) replace jar values of the same name.
  const cookieKeys = Object.keys(headers).filter((k) => k.toLowerCase() === 'cookie');
  const reqHeaders = { ...headers };
  for (const k of cookieKeys) delete reqHeaders[k];
  const cookieMap = new Map();
  for (const str of [getCookiesForUrl(url), ...cookieKeys.map((k) => headers[k])]) {
    for (const part of String(str || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) cookieMap.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
  }
  const mergedCookie = [...cookieMap].map(([k, v]) => `${k}=${v}`).join('; ');

  try {
    res = await fetch(url, {
      method,
      body,
      redirect: 'follow',
      signal: buildSignal(signal, timeout),
      headers: {
        'User-Agent': UA,
        'Accept': accept,
        'Accept-Language': lang,
        ...CLIENT_HINTS,
        ...(accept.startsWith('text/html') ? { 'Upgrade-Insecure-Requests': '1' } : {}),
        ...(mergedCookie ? { 'Cookie': mergedCookie } : {}),
        ...reqHeaders,
      },
    });
    saveResponseCookies(url, res);
  } catch (e) {
    if (e.name === 'TimeoutError') throw new HttpError(`Hết thời gian chờ (${timeout}ms)`, 0);
    if (e.name === 'AbortError') throw new HttpError('Đã huỷ', 0);
    throw new HttpError(e.cause?.code || e.message, 0);
  }
  const ok = okStatuses ? okStatuses.includes(res.status) : res.ok;
  if (!ok) {
    const hint = res.status === 403 || res.status === 429 || res.status === 202
      ? 'bị chặn/giới hạn tạm thời' : 'lỗi máy chủ';
    throw new HttpError(`HTTP ${res.status} (${hint})`, res.status);
  }
  return res;
}

// proxy: 'fallback' retries through SCRAPE_PROXY when the site blocks us; 'always' goes through it directly.
// proxyTimeout: how long to wait for the proxy (default 70s); proxyLane 'slow' for slow proxy requests.
export async function fetchText(url, { proxy, proxyExtra, proxyTimeout = 70000, proxyLane, allowDirectFallback = false, ...opts } = {}) {
  const downReason = () => proxyDown.reason || 'Proxy (SCRAPE_PROXY) tạm ngừng — không đọc được trang này';
  // Direct read as a last resort; a block page is reported as the proxy problem, not returned as data.
  const direct = async () => {
    const res = await request(url, opts);
    const text = await res.text();
    if (looksBlocked(res.status, text)) throw new HttpError(proxyDown.reason || 'Bị chặn khi truy cập trực tiếp', 402);
    return { text, url: res.url, status: res.status };
  };
  // A proxy-only source while the proxy is out of credits.
  if (proxy === 'always' && process.env.SCRAPE_PROXY && !proxyEnabled()) {
    if (allowDirectFallback) {
      try {
        return await direct();
      } catch {
        throw new HttpError(downReason(), 402);
      }
    }
    throw new HttpError(downReason(), 402);
  }
  const useProxy = proxy && proxyEnabled();
  const proxied = () => withProxySlot(proxyLane, async () => {
    const go = async () => {
      // proxies retry internally: slow
      const r = await request(viaProxy(url, proxyExtra), { ...opts, timeout: proxyTimeout, okStatuses: [200, 201, 203, 204, 403] });
      if (r.status !== 403) return r;
      const body = await r.text();
      if (/exhausted|credits?|quota|subscription|payment/i.test(body)) {
        proxyDown = { until: Date.now() + 6 * 3600e3, reason: 'Proxy (SCRAPE_PROXY) đã hết lượt trong tháng — các nguồn chỉ đọc được qua proxy tạm ngừng. Nạp thêm/đổi khóa trong ⚙ Cài đặt nguồn.' };
        throw new HttpError(proxyDown.reason, 402);
      }
      throw new HttpError('HTTP 403 (bị chặn/giới hạn tạm thời)', 403);
    };
    let res;
    try {
      res = await go();
    } catch (e) {
      // 429 from the proxy = its concurrency limit (another run, another app on the same key): retry once.
      if (e.status !== 429 || opts.signal?.aborted) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      res = await go();
    }
    return { text: await res.text(), url, status: res.status, proxied: true };
  });
  if (useProxy && proxy === 'always') {
    try {
      return await proxied();
    } catch (e) {
      if (e.status === 402 && allowDirectFallback) return direct();
      throw e;
    }
  }
  try {
    const res = await request(url, opts);
    const text = await res.text();
    if (useProxy && looksBlocked(res.status, text)) return proxied();
    return { text, url: res.url, status: res.status };
  } catch (e) {
    if (useProxy && [202, 403, 429, 503].includes(e.status)) return proxied();
    throw e;
  }
}

export async function fetchJSON(url, opts = {}) {
  let text;
  let status;
  if (opts.proxy) {
    // Through fetchText so a captcha page (HTML instead of JSON) can be retried via SCRAPE_PROXY.
    const r = await fetchText(url, { accept: 'application/json, text/plain, */*', ...opts });
    ({ text, status } = r);
    if (!r.proxied && proxyEnabled() && !/^\s*[[{]/.test(text)) ({ text, status } = await fetchText(url, { ...opts, proxy: 'always' }));
  } else {
    const res = await request(url, { accept: 'application/json, text/plain, */*', ...opts });
    text = await res.text();
    status = res.status;
  }
  const res = { status };
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError('Phản hồi không phải JSON (có thể bị chặn bằng captcha)', res.status);
  }
}

// Run async tasks with a concurrency limit.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        results[idx] = { error: e };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
