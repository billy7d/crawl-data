import { fetchJSON } from '../lib/http.js';
import { MARKETS } from '../lib/markets.js';

const CURRENCY = { vn: 'VND', th: 'THB', sg: 'SGD', my: 'MYR', ph: 'PHP', id: 'IDR' };

export default {
  id: 'lazada',
  name: 'Lazada',
  kind: 'shop',
  group: 'Sàn TMĐT',
  markets: Object.keys(MARKETS).filter((k) => MARKETS[k].lazada),
  limit: { concurrency: 2, gap: 400 },
  async search({ q, market, signal }) {
    const host = MARKETS[market].lazada;
    const d = await fetchJSON(`https://${host}/catalog/?ajax=true&page=1&q=${encodeURIComponent(q)}`, {
      signal, timeout: 8000, headers: { Referer: `https://${host}/` },
    });
    if (d.rgv587_flag || d.url?.includes('punish')) throw new Error('Lazada yêu cầu xác minh captcha (tạm thời)');
    const items = d.mods?.listItems || [];
    return items.map((p) => ({
      title: p.name,
      url: p.itemUrl ? new URL(p.itemUrl, `https://${host}`).href.split('?')[0] : null,
      image: p.image,
      price: p.price != null ? Number(p.price) : p.priceShow,
      currency: CURRENCY[market],
      originalPrice: p.originalPrice ? Number(p.originalPrice) : p.originalPriceShow || null,
      brand: p.brandName,
      seller: p.sellerName,
      rating: p.ratingScore ? Number(p.ratingScore) : null,
      reviews: p.review ? Number(p.review) : null,
      sold: p.itemSoldCntShow || null,
      sponsored: !!(p.isSponsored || p.adFlag),
      extra: { location: p.location || null, lazMall: (p.icons || []).some((i) => /lazMall/i.test(i.bizType || '')) },
    }));
  },
};
