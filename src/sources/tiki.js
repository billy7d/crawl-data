import { fetchJSON } from '../lib/http.js';
import { clean, truncate } from '../lib/normalize.js';
import { sectionsFromText, findImporter } from '../lib/extract.js';

const SPEC_MAP = {
  ingredients_mb: 'ingredients', ingredients: 'ingredients', origin: 'origin', expiry_time: 'expiry',
  product_weight_mb: 'weight', volume: 'weight', storage_instructions: 'storage', instructions_for_use: 'usage',
  age_group: 'age', suitable_age: 'age', warning: 'warnings',
};

const stripHtml = (h) => String(h || '').replace(/<\/(p|div|li|h\d|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();

export default {
  id: 'tiki',
  name: 'Tiki',
  kind: 'shop',
  group: 'Sàn TMĐT',
  markets: ['vn'],
  limit: { concurrency: 2, gap: 400 },
  async search({ q, signal }) {
    const d = await fetchJSON(`https://tiki.vn/api/v2/products?limit=40&include=advertisement&aggregations=2&q=${encodeURIComponent(q)}`, {
      signal, timeout: 7000, proxy: 'fallback',
    });
    return (d.data || []).map((p) => ({
      title: p.name,
      url: `https://tiki.vn/${p.url_path || p.url_key + '.html'}`,
      image: p.thumbnail_url,
      price: p.price,
      currency: 'VND',
      originalPrice: p.original_price,
      brand: p.brand_name,
      seller: p.seller_name,
      rating: p.rating_average || null,
      reviews: p.review_count || null,
      sold: p.quantity_sold?.value ?? null,
      origin: p.origin || null,
      gtin: /^\d{8,14}$/.test(p.sku || '') ? p.sku : null,
      extra: { tikiId: p.id, spid: p.seller_product_id, official: !!p.is_from_official_store },
    }));
  },
  // Structured details (specs + description) straight from Tiki's product API.
  detailNeeds: (item) => item.extra?.tikiId,
  async detail(item, { signal }) {
    const id = item.extra?.tikiId;
    if (!id) return null;
    const spid = item.extra?.spid ? `?spid=${item.extra.spid}` : '';
    const d = await fetchJSON(`https://tiki.vn/api/v2/products/${id}${spid}`, { signal, timeout: 7000, proxy: 'fallback' });
    const desc = stripHtml(d.description);
    const sections = sectionsFromText(d.description);
    for (const group of d.specifications || []) {
      for (const a of group.attributes || []) {
        const key = SPEC_MAP[a.code];
        const val = clean(stripHtml(a.value));
        if (key && val && !/tham khảo|xem mô tả|đang cập nhật/i.test(val)) {
          sections[key] = key === 'weight' && /^\d+([.,]\d+)?$/.test(val) ? `${Number(val.replace(',', '.')) * 1000}g` : truncate(val, 400);
        }
      }
    }
    const specText = (d.specifications || []).flatMap((g) => g.attributes || []).map((a) => `${a.name}: ${stripHtml(a.value)}`).join('\n');
    return {
      importer: findImporter(`${specText}\n${desc}`),
      price: d.price ?? null,
      currency: 'VND',
      description: truncate(d.short_description || desc, 600),
      sections,
      brand: d.brand?.name,
      rating: d.rating_average,
      reviews: d.review_count,
      sold: d.all_time_quantity_sold ?? d.quantity_sold?.value,
      images: (d.images || []).slice(0, 6).map((i) => i.medium_url || i.base_url),
      origin: (d.specifications || []).flatMap((g) => g.attributes || []).find((a) => a.code === 'origin')?.value || null,
    };
  },
};
