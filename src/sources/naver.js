// Naver Shopping (Korea): official Search API, free (25,000 calls/day). Naver Shopping is a price-comparison
// engine, so one result lists the lowest price among many Korean shops (Gmarket, 11st, Coupang, SSG, Smart
// Store…) — which also covers the shops that block scraping. Needs a Client ID + Secret from
// https://developers.naver.com/apps (application type: "검색" / Search).
import { fetchJSON, HttpError } from '../lib/http.js';
import { clean } from '../lib/normalize.js';

const decode = (s) => String(s || '')
  .replace(/<\/?b>/gi, '')
  .replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[e]);

export function parseNaver(d) {
  return (d?.items || []).filter((p) => p?.title && p.link).map((p) => {
    const price = Number(p.lprice) || null;
    const high = Number(p.hprice) || null;
    const path = [p.category1, p.category2, p.category3, p.category4].filter(Boolean).join(' > ');
    return {
      title: clean(decode(p.title)),
      url: p.link,
      image: p.image || null,
      price,
      currency: 'KRW',
      brand: clean(p.brand || p.maker) || null,
      seller: p.mallName ? clean(p.mallName) : 'Naver Shopping',
      snippet: path || null,
      extra: {
        priceMax: high && high > (price || 0) ? high : null, // highest price among the comparison shops
        productType: p.productType || null, // 1–3 = catalogued product (price comparison), 4–6 = single listing
        naverId: p.productId || null,
        maker: p.maker || null,
      },
    };
  });
}

export default {
  id: 'naver',
  name: 'Naver Shopping',
  kind: 'shop',
  group: 'Shop nước ngoài',
  markets: ['kr'],
  needsKey: 'NAVER_CLIENT_ID',
  filterIrrelevant: true,
  limit: { concurrency: 3, gap: 120 },
  async search({ q, signal }) {
    const id = process.env.NAVER_CLIENT_ID;
    const secret = process.env.NAVER_CLIENT_SECRET;
    if (!id || !secret) throw new HttpError('Naver cần cả Client ID và Client Secret (⚙ Cài đặt nguồn).', 401);
    const headers = { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret };
    // 100 results per call; deeper search (setting) reads a second page.
    const pages = Number(process.env.SEARCH_DEPTH) >= 3 ? 2 : 1;
    const calls = Array.from({ length: pages }, (_, i) => fetchJSON(
      `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(q)}&display=100&start=${i * 100 + 1}&sort=sim`,
      { signal, timeout: 9000, headers },
    ));
    const res = await Promise.allSettled(calls);
    if (res[0].status === 'rejected') {
      const e = res[0].reason;
      if ([401, 403].includes(e.status)) throw new HttpError('Naver từ chối khóa: sai Client ID/Secret, hoặc ứng dụng chưa bật API "검색" (Search).', 401);
      if (e.status === 429) throw new HttpError('Naver: quá hạn mức 25.000 lượt/ngày hoặc gọi quá nhanh.', 429);
      throw e;
    }
    const seen = new Set();
    return res.flatMap((r) => (r.status === 'fulfilled' ? parseNaver(r.value) : []))
      .filter((p) => !seen.has(p.url) && seen.add(p.url));
  },
};
