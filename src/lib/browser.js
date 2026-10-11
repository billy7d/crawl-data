// Real-browser reader for shops that block bots, or that need the scraping proxy while it is missing or out of
// credits. It opens the user's own Chrome (or Edge/Brave) in a visible window with a separate, persistent
// profile and reads the search page the way the user would see it. Nothing is spoofed and no captcha is solved
// automatically: when a page asks for a login or a check, the tab is brought to the front and the user does it.
//
// - Asked once per server run: after the user agrees, later searches use the browser without asking again
//   until the server stops (consent lives in memory only).
// - Sized to the machine: at most `tabs` pages at a time (from CPU cores and RAM, or BROWSER_TABS), no new tab
//   while the system is overloaded, images/video/fonts are not downloaded.
// - Each tab is closed as soon as its page is read; the search's leftovers are closed when it ends, and the
//   browser itself quits after a short idle time.
//
// Talks to the browser over the DevTools protocol with Node's built-in WebSocket (no extra dependency).
import { spawn, execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './http.js';

const PROFILE_DIR = path.resolve('data', 'browser-profile');
const PORT_FILE = path.join(PROFILE_DIR, 'DevToolsActivePort');
const CONSENT_WAIT_MS = 90e3;
const userWaitMs = () => Math.max(20, Number(process.env.BROWSER_USER_WAIT_SECONDS) || 150) * 1000;
const HOST_GAP_MS = 1500;
// BROWSER_DEBUG=1 logs each step to the server console.
const debug = process.env.BROWSER_DEBUG ? (...a) => console.log('[browser]', new Date().toISOString().slice(11, 19), ...a) : () => {};
const idleCloseMs = () => Math.max(10, Number(process.env.BROWSER_IDLE_SECONDS) || 60) * 1000;

// Bot walls and login prompts, judged on the rendered page.
// Text alone misses pages the browser has translated ("Just a moment…" → "Chờ một chút…"), so the challenge
// widgets themselves are looked for too (Cloudflare, PerimeterX, DataDome, reCAPTCHA/hCaptcha on a bare page).
const CHALLENGE = /captcha|robot or human|are you a robot|are you human|just a moment|attention required|pardon our interruption|access denied|unusual traffic|verify (?:you are|that you are) (?:a )?human|checking your browser|press (?:&|and) hold|kein roboter|verifizierung erforderlich|chờ một chút|xác minh/i;
const WIDGETS = 'iframe[src*="challenges.cloudflare.com"],#challenge-form,#challenge-stage,#cf-challenge-running,#px-captcha,iframe[src*="captcha-delivery.com"],iframe[src*="geo.captcha"]';
const BARE_WIDGETS = 'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,.h-captcha';
const LOGIN_URL = /\/(?:buyer\/)?(?:login|signin|sign-in|log-in|account\/login|auth)(?:[/?#]|$)/i;
const CHECK_URL = /\/(?:verify|captcha|challenge|punish|blocked)(?:[/?#.]|$)/i;

// ---------- Search-scoped context ----------
// Sources call fetchText/fetchJSON as usual; inside browserCtx.run() those go through the browser instead.
export const browserCtx = new AsyncLocalStorage();
export const inBrowser = () => browserCtx.getStore() || null;

// ---------- Machine sizing ----------
export function hardware() {
  const cores = os.availableParallelism?.() ?? os.cpus().length;
  const memGB = os.totalmem() / 2 ** 30;
  // ~4 cores and ~6 GB of RAM per working tab keeps the user's own apps responsive.
  const auto = Math.max(1, Math.min(4, Math.floor(cores / 4), Math.floor(memGB / 6)));
  const set = Number(process.env.BROWSER_TABS);
  return { cores, memGB: Math.round(memGB), auto, tabs: set >= 1 && set <= 6 ? set : auto };
}

// Overloaded right now: don't add another tab. loadavg is always 0 on Windows, and macOS counts its file cache
// as used memory, so each check runs only where it means something.
function overloaded() {
  const { cores } = hardware();
  if (process.platform !== 'win32' && os.loadavg()[0] / cores > 0.9) return true;
  if (process.platform !== 'darwin' && os.freemem() < 800 * 2 ** 20) return true;
  return false;
}

// ---------- Finding the browser ----------
let found;
export function findBrowser() {
  if (found !== undefined) return found;
  const list = [];
  if (process.env.BROWSER_PATH) list.push(process.env.BROWSER_PATH);
  if (process.platform === 'darwin') {
    for (const n of ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium']) {
      list.push(`/Applications/${n}.app/Contents/MacOS/${n}`, path.join(os.homedir(), `Applications/${n}.app/Contents/MacOS/${n}`));
    }
  } else if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const rel of ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe']) {
      for (const r of roots) list.push(path.join(r, rel));
    }
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
      try {
        list.push(execFileSync('which', [n], { encoding: 'utf8' }).trim());
      } catch { /* not installed */ }
    }
  }
  const bin = list.find((p) => p && fs.existsSync(p)) || null;
  found = bin ? { bin, name: path.basename(bin).replace(/\.exe$/i, '') } : null;
  return found;
}

// ---------- Consent (per server run) ----------
let consent = null; // null = not asked yet, 'granted', 'denied'
let consentWaiters = [];
export const browserMode = () => (process.env.BROWSER_MODE === 'off' ? 'off' : 'ask');
// The browser can be offered at all (sources that need it are listed).
export const browserUsable = () => browserMode() !== 'off' && consent !== 'denied' && !!findBrowser();

export function setConsent(allow) {
  consent = allow ? 'granted' : 'denied';
  const w = consentWaiters;
  consentWaiters = [];
  w.forEach((x) => x(consent));
}
export const resetConsent = () => {
  consent = null;
};

// Resolves once the user has agreed; `ask` shows the prompt (the caller makes sure it is shown once).
export async function waitConsent(signal, ask) {
  if (browserMode() === 'off') throw new HttpError('Đã tắt dùng trình duyệt thật trong ⚙ Cài đặt', 0);
  if (!findBrowser()) throw new HttpError('Không tìm thấy Chrome/Edge/Brave trên máy', 0);
  if (consent === 'granted') return;
  if (consent === 'denied') throw new HttpError('Bạn chưa cho phép mở trình duyệt trong phiên này', 0);
  ask();
  const answer = await new Promise((resolve) => {
    const done = (v) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(v);
    };
    const timer = setTimeout(() => done('timeout'), CONSENT_WAIT_MS);
    const onAbort = () => done('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    consentWaiters.push(done);
  });
  if (answer === 'granted') return;
  if (answer === 'aborted') throw new HttpError('Đã huỷ', 0);
  throw new HttpError(answer === 'timeout' ? 'Chưa có xác nhận mở trình duyệt' : 'Bạn chưa cho phép mở trình duyệt trong phiên này', 0);
}

// ---------- DevTools protocol ----------
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (m.id) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
        else p.resolve(m.result);
      } else for (const fn of this.listeners) fn(m);
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Trình duyệt đã đóng'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId, timeout = 30e3) {
    if (this.closed) return Promise.reject(new Error('Trình duyệt đã đóng'));
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: quá thời gian`));
      }, timeout);
      this.pending.set(id, { resolve, reject, method, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// ---------- Launch / connect ----------
let homeUrl = 'about:blank';
export const configureBrowser = (o) => {
  if (o.homeUrl) homeUrl = o.homeUrl;
};

let conn = null;
let proc = null;
let connecting = null;
const ours = new Set(); // targetIds of tabs this app opened for reading

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsConnect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('Không kết nối được trình duyệt')), { once: true });
  });
  const c = new Cdp(ws);
  ws.addEventListener('close', () => {
    if (conn === c) conn = null;
    ours.clear();
    realUA = null;
  });
  return c;
}

// The profile's DevToolsActivePort file: "<port>\n/devtools/browser/<id>".
async function fromPortFile() {
  try {
    const [port, wsPath] = fs.readFileSync(PORT_FILE, 'utf8').split(/\r?\n/);
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    return await wsConnect(`ws://127.0.0.1:${port}${wsPath}`);
  } catch {
    return null;
  }
}

async function connect() {
  if (conn && !conn.closed) return conn;
  connecting ??= (async () => {
    try {
      // A window left over from an earlier run of the app (same profile) is reused.
      let c = await fromPortFile();
      if (!c) {
        const b = findBrowser();
        if (!b) throw new HttpError('Không tìm thấy Chrome/Edge/Brave trên máy', 0);
        fs.mkdirSync(PROFILE_DIR, { recursive: true });
        fs.rmSync(PORT_FILE, { force: true });
        const { tabs } = hardware();
        proc = spawn(b.bin, [
          `--user-data-dir=${PROFILE_DIR}`,
          '--remote-debugging-port=0',
          '--no-first-run',
          '--no-default-browser-check',
          // Reading tabs open in the background; without these Chrome slows their timers and rendering.
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          `--renderer-process-limit=${tabs + 2}`,
          '--disable-features=Translate,MediaRouter,OptimizationHints',
          '--window-size=1200,860',
          homeUrl,
        ], { stdio: 'ignore' });
        proc.on('exit', () => {
          proc = null;
        });
        proc.on('error', () => {
          proc = null;
        });
        for (let i = 0; i < 60 && !c; i++) {
          await sleep(250);
          if (fs.existsSync(PORT_FILE)) c = await fromPortFile();
        }
        if (!c) throw new HttpError('Không mở được trình duyệt', 0);
      }
      conn = c;
      return c;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

// ---------- Tab slots ----------
let active = 0;
let slotWaiters = [];
const lastByHost = new Map();

async function acquire(signal) {
  for (;;) {
    if (signal?.aborted) throw new HttpError('Đã huỷ', 0);
    const { tabs } = hardware();
    if (active < tabs && !(active > 0 && overloaded())) break;
    // Re-check now and then: a busy machine may calm down without any tab finishing.
    await new Promise((r) => {
      const t = setTimeout(r, 1500);
      slotWaiters.push(() => {
        clearTimeout(t);
        r();
      });
    });
  }
  active++;
  clearTimeout(idleTimer);
}

function release() {
  active--;
  const w = slotWaiters;
  slotWaiters = [];
  w.forEach((r) => r());
  if (!active) scheduleIdleClose();
}

// One page at a time per shop, a little apart, like a person clicking through.
async function hostGap(url) {
  const host = new URL(url).hostname;
  const wait = (lastByHost.get(host) || 0) + HOST_GAP_MS - Date.now();
  lastByHost.set(host, Math.max(Date.now(), (lastByHost.get(host) || 0) + HOST_GAP_MS));
  if (wait > 0) await sleep(wait);
}

// Only one tab asks the user for help at a time, so two pop-ups don't fight for the front.
let attention = Promise.resolve();
let asking = 0;

// ---------- Reading one page ----------
const STATE = `(() => {
  const pre = document.querySelector('body > pre');
  const text = (pre ? pre.textContent : document.body ? document.body.innerText : '') || '';
  return {
    href: location.href, title: document.title, ready: document.readyState, len: document.getElementsByTagName('*').length,
    text: text.slice(0, 6000), short: text.length < 5000,
    wall: !!document.querySelector(${JSON.stringify(WIDGETS)}) || (text.length < 5000 && !!document.querySelector(${JSON.stringify(BARE_WIDGETS)})),
  };
})()`;

function needsUser(s, url, json) {
  if (json) {
    // JSON APIs answer a block with a link to a human check (Lazada: rgv587_flag + …/punish…).
    const m = s.text.match(/"url"\s*:\s*"(https?:[^"]*(?:punish|captcha|verify)[^"]*)"/i);
    if (m || /rgv587_flag/.test(s.text)) return { reason: 'captcha', goto: m ? m[1].replace(/\\\//g, '/') : null };
    if (/^\s*[[{]/.test(s.text)) return null;
  }
  if (LOGIN_URL.test(s.href) && !LOGIN_URL.test(url)) return { reason: 'login' };
  if (CHECK_URL.test(s.href) && !CHECK_URL.test(url)) return { reason: /is_logged_in=false/.test(s.href) ? 'login' : 'captcha' };
  if (s.wall || CHALLENGE.test(s.title) || (s.short && CHALLENGE.test(s.text))) return { reason: 'captcha' };
  return null;
}

class Tab {
  constructor(c, targetId, sessionId) {
    Object.assign(this, { c, targetId, sessionId });
    this.off = c.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Fetch.requestPaused') c.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {});
      if (m.method === 'Page.loadEventFired') this.loaded?.();
    });
  }

  send(method, params) {
    return this.c.send(method, params, this.sessionId);
  }

  async state() {
    const r = await this.send('Runtime.evaluate', { expression: STATE, returnByValue: true });
    return r.result?.value || { href: '', title: '', ready: 'loading', len: 0, text: '' };
  }

  // Product images, video and web fonts are skipped: their URLs stay in the page, the bandwidth and CPU don't.
  lighten(on) {
    return on
      ? this.send('Fetch.enable', { patterns: [{ resourceType: 'Image' }, { resourceType: 'Media' }, { resourceType: 'Font' }] })
      : this.send('Fetch.disable');
  }

  async goto(url, signal) {
    const loaded = new Promise((r) => {
      this.loaded = r;
      setTimeout(r, 20e3);
    });
    const nav = await this.send('Page.navigate', { url });
    // ERR_ABORTED: the page replaced this navigation itself (a redirect, a check page) — read what it shows.
    if (nav.errorText && nav.errorText !== 'net::ERR_ABORTED') throw new HttpError(`Không mở được trang (${nav.errorText})`, 0);
    await Promise.race([loaded, new Promise((r) => signal?.addEventListener('abort', r, { once: true }))]);
  }

  // Wait for scripts to finish drawing the results: the page stops growing for a moment.
  // A check page gets a few seconds first: in a real browser many pass by themselves.
  async settle({ url, json, signal, max = 15e3, grace = 8e3 }) {
    const start = Date.now();
    let last = -1;
    let s;
    for (;;) {
      if (signal?.aborted) throw new HttpError('Đã huỷ', 0);
      s = await this.state();
      const ask = needsUser(s, url, json);
      if (ask && (ask.reason !== 'captcha' || Date.now() - start > grace)) return { ...s, ask };
      if (ask) {
        await sleep(1000);
        continue;
      }
      if (json && s.ready === 'complete') return s;
      const stable = s.ready === 'complete' && s.len === last && Date.now() - start > 2000;
      if (stable || Date.now() - start > max) return s;
      last = s.len;
      await sleep(700);
    }
  }

  // Many result pages draw the cards below the fold only when scrolled to. A few steps down, then a short wait
  // for the page to stop growing.
  async scroll(signal) {
    for (let i = 0; i < 4 && !signal?.aborted; i++) {
      await this.send('Runtime.evaluate', { expression: 'window.scrollBy(0, Math.round(innerHeight * 0.9))' });
      await sleep(450);
    }
    await this.settle({ url: '', json: false, signal, max: 3000 }).catch(() => {});
  }

  async read(json) {
    const expression = json ? "(document.querySelector('body > pre') || document.body).textContent" : 'document.documentElement.outerHTML';
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return r.result?.value || '';
  }
}

// Fetch one URL through the browser: { text, url, status } like fetchText (text is the JSON for json: true).
// lang: the market's Accept-Language, as a plain request would send (the browser's own UI language otherwise
// makes iHerb answer in French). The user agent stays the browser's real one.
let realUA = null;
export async function browserFetch(url, { json = false, lang } = {}) {
  const ctx = inBrowser() || {};
  const { signal } = ctx;
  debug('chờ chỗ', url);
  await acquire(signal);
  debug('mở', url, `(${active}/${hardware().tabs})`);
  let tab = null;
  try {
    await hostGap(url);
    const c = await connect();
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', background: true });
    ours.add(targetId);
    ctx.session?.targets.add(targetId);
    const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    tab = new Tab(c, targetId, sessionId);
    if (lang) {
      realUA ??= (await c.send('Browser.getVersion')).userAgent;
      await tab.send('Emulation.setUserAgentOverride', { userAgent: realUA, acceptLanguage: lang });
    }
    await tab.send('Page.enable');
    await tab.lighten(true);
    await tab.goto(url, signal);
    debug('đã tải', url);
    let s = await tab.settle({ url, json, signal });
    debug('xong chờ trang', s.href, s.ask || '');
    if (s.ask) s = await askUser(tab, s, { url, json, ctx });
    if (!json) await tab.scroll(ctx.signal);
    const text = await tab.read(json);
    return { text, url: s.href || url, status: 200, browser: true };
  } catch (e) {
    if (signal?.aborted) throw new HttpError('Đã huỷ', 0);
    throw e instanceof HttpError ? e : new HttpError(`Trình duyệt: ${e.message}`, 0);
  } finally {
    debug('đóng', url);
    if (tab) {
      tab.off();
      await closeTarget(tab.targetId);
      ctx.session?.targets.delete(tab.targetId);
    }
    release();
  }
}

// A login or a human check: show the tab and wait for the user, then read the page they end up on.
async function askUser(tab, s, { url, json, ctx }) {
  const prev = attention;
  const queued = asking++ > 0;
  let done;
  attention = new Promise((r) => {
    done = r;
  });
  try {
    debug('chờ lượt nhờ người dùng', url, queued ? '(xếp hàng)' : '');
    let turn = false;
    await Promise.race([prev.then(() => {
      turn = true;
    }), new Promise((r) => ctx.signal?.addEventListener('abort', r, { once: true }))]);
    if (!turn) {
      // Left the queue early: hand the turn on only once the one before has finished.
      const release = done;
      done = () => prev.then(release);
      throw new HttpError('Đã huỷ', 0);
    }
    const host = new URL(url).hostname.replace(/^www\./, '');
    debug('nhờ người dùng', host);
    // The user may have just signed in / passed the check for this shop in another tab: look again first.
    if (queued) {
      await tab.goto(url, ctx.signal);
      s = await tab.settle({ url, json, signal: ctx.signal, grace: 3000 });
      if (!s.ask) return s;
    }
    ctx.onAttention?.({ host, reason: s.ask.reason });
    await tab.lighten(false); // a picture captcha needs its pictures
    await tab.c.send('Target.activateTarget', { targetId: tab.targetId });
    await tab.goto(s.ask.goto || url, ctx.signal);
    const until = Date.now() + userWaitMs();
    for (;;) {
      if (ctx.signal?.aborted) throw new HttpError('Đã huỷ', 0);
      if (Date.now() > until) throw new HttpError('Hết thời gian chờ bạn đăng nhập/xác minh trên trình duyệt', 408);
      await sleep(1500);
      // The user closing the tab means "skip this shop".
      const now = await tab.state().catch(() => null);
      if (!now) throw new HttpError('Tab đã bị đóng — bỏ qua trang này', 0);
      if (!needsUser(now, url, false) && now.ready === 'complete') break;
    }
    await tab.goto(url, ctx.signal);
    s = await tab.settle({ url, json, signal: ctx.signal });
    if (s.ask) throw new HttpError('Trang vẫn yêu cầu xác minh', 429);
    ctx.onAttention?.({ host, reason: 'done' });
    return s;
  } finally {
    asking--;
    done();
  }
}

async function closeTarget(targetId) {
  ours.delete(targetId);
  try {
    await conn?.send('Target.closeTarget', { targetId }, undefined, 5000);
  } catch { /* already closed */ }
}

// ---------- Sessions (one per search) ----------
export const newSession = () => ({ targets: new Set(), active: 0 });

// The search is over: close whatever it still has open.
export async function closeSession(session) {
  await Promise.all([...session.targets].map(closeTarget));
  session.targets.clear();
  if (!active) scheduleIdleClose();
}

let idleTimer = null;
function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!active) closeBrowser();
  }, idleCloseMs());
  idleTimer.unref?.();
}

// Quit the browser window this app opened (the profile, with its logins, stays on disk).
export async function closeBrowser() {
  clearTimeout(idleTimer);
  const c = conn;
  conn = null;
  ours.clear();
  if (c && !c.closed) {
    try {
      await c.send('Browser.close', {}, undefined, 5000);
    } catch { /* gone */ }
  }
  proc?.kill();
  proc = null;
}

export function browserState() {
  const b = findBrowser();
  return {
    mode: browserMode(),
    consent,
    browser: b?.name || null,
    running: !!(conn && !conn.closed),
    working: active,
    ...hardware(),
  };
}
