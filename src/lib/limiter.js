// Per-source politeness: caps concurrency, spaces requests out, and backs off after a block
// (captcha / 403 / 429) so a burst of searches doesn't get the IP flagged for longer.
const state = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CooldownError extends Error {}

export function cooldownLeft(key) {
  const s = state.get(key);
  return s ? Math.max(0, s.coolUntil - Date.now()) : 0;
}

export async function throttled(key, { concurrency = 2, gap = 300, cooldown = 5 * 60e3 } = {}, fn) {
  let s = state.get(key);
  if (!s) state.set(key, (s = { active: 0, next: 0, waiters: [], coolUntil: 0 }));
  const left = s.coolUntil - Date.now();
  if (left > 0) throw new CooldownError(`Tạm nghỉ ${Math.ceil(left / 60000)} phút để tránh bị chặn`);
  while (s.active >= concurrency) await new Promise((r) => s.waiters.push(r));
  s.active++;
  const wait = s.next - Date.now();
  s.next = Math.max(Date.now(), s.next) + gap;
  if (wait > 0) await sleep(wait);
  try {
    return await fn();
  } catch (e) {
    if (e.status === 403 || e.status === 429 || e.status === 202 || /captcha|bị chặn/i.test(e.message)) {
      s.coolUntil = Date.now() + cooldown;
    }
    throw e;
  } finally {
    s.active--;
    s.waiters.shift()?.();
  }
}
