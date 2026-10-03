// Exchange rates (free, no key: open.er-api.com), cached 12h, with an offline fallback.
import { remember } from './cache.js';
import { fetchJSON } from './http.js';

// Approximate VND per unit, used only if the rate API is unreachable.
const FALLBACK_VND = {
  VND: 1, USD: 26300, EUR: 30500, GBP: 35300, JPY: 178, KRW: 19, CNY: 3690, AUD: 17300, SGD: 20400,
  THB: 810, MYR: 6200, PHP: 460, IDR: 1.6, CAD: 19000, NZD: 15600, HKD: 3380, TWD: 860, INR: 300, CHF: 33000,
};

let current = { base: 'VND', vndPer: FALLBACK_VND, updated: null, source: 'fallback' };

export async function loadRates() {
  try {
    const { value } = await remember('fx:usd', 12 * 3600e3, async () => {
      const d = await fetchJSON('https://open.er-api.com/v6/latest/USD', { timeout: 6000 });
      if (d.result !== 'success') throw new Error('rate api failed');
      return { rates: d.rates, updated: d.time_last_update_utc };
    });
    const vndPerUsd = value.rates.VND;
    const vndPer = {};
    for (const [cur, perUsd] of Object.entries(value.rates)) vndPer[cur] = vndPerUsd / perUsd;
    current = { base: 'VND', vndPer, updated: value.updated, source: 'open.er-api.com' };
  } catch (e) {
    console.warn('[fx] dùng tỷ giá dự phòng:', e.message);
  }
  return current;
}

export const rates = () => current;

export function toVND(value, currency) {
  if (value == null || !currency) return null;
  const r = current.vndPer[currency];
  return r ? Math.round(value * r) : null;
}
