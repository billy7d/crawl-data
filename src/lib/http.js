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
export const proxyEnabled = () => !!process.env.SCRAPE_PROXY;
const viaProxy = (url) => process.env.SCRAPE_PROXY.replace('{url}', encodeURIComponent(url));

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
        ...headers,
      },
    });
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
export async function fetchText(url, { proxy, ...opts } = {}) {
  const useProxy = proxy && proxyEnabled();
  const proxied = async () => {
    const res = await request(viaProxy(url), { ...opts, timeout: 60000 }); // proxies render JS and retry: slow
    return { text: await res.text(), url, status: res.status, proxied: true };
  };
  if (useProxy && proxy === 'always') return proxied();
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
  const res = await request(url, { accept: 'application/json, text/plain, */*', ...opts });
  const text = await res.text();
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
