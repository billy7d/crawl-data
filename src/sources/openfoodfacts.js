// Open Food Facts: free, open product database (ingredients, allergens, Nutri-Score, countries sold).
// Open Prices (same project) adds community-reported shelf prices.
import { fetchJSON } from '../lib/http.js';
import { countriesFromOFF } from '../lib/markets.js';
import { clean } from '../lib/normalize.js';

const UA = { 'User-Agent': 'AnDamRadar/1.0 (baby food market research; contact: local)' };
const FIELDS = [
  'code', 'product_name', 'product_name_en', 'product_name_vi', 'generic_name', 'brands', 'quantity', 'countries_tags',
  'image_front_small_url', 'image_front_url', 'ingredients_text', 'ingredients_text_en', 'allergens_tags', 'labels_tags',
  'categories_tags', 'nutriscore_grade', 'nova_group', 'stores', 'conservation_conditions', 'preparation',
].join(',');

const str = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? Object.values(v)[0] : v) || '';
const tagNames = (tags = []) => tags.map((t) => t.replace(/^\w+:/, '').replace(/-/g, ' '));

async function query(q, signal) {
  const url = `https://search.openfoodfacts.org/search?page_size=30&langs=en,vi,fr,de&fields=${FIELDS}&q=${encodeURIComponent(q)}`;
  const d = await fetchJSON(url, { signal, timeout: 9000, headers: UA });
  return d.hits || [];
}

export default {
  id: 'off',
  name: 'Open Food Facts',
  kind: 'db',
  group: 'CSDL sản phẩm',
  markets: '*',
  limit: { concurrency: 2, gap: 400 },
  global: true, // run once per search (English query), not once per market
  async search({ q, signal }) {
    let hits = await query(`${q} categories_tags:"en:baby-foods"`, signal);
    if (hits.length < 8) {
      const more = await query(q, signal).catch(() => []);
      const codes = new Set(hits.map((h) => h.code));
      hits = hits.concat(more.filter((h) => !codes.has(h.code)));
    }
    return hits.filter((h) => h.code && (h.product_name || h.product_name_en)).map((h) => {
      const countries = countriesFromOFF(h.countries_tags);
      const labels = tagNames(h.labels_tags);
      const name = clean(str(h.product_name_vi) || str(h.product_name) || str(h.product_name_en));
      return {
        title: [name, h.quantity && !name.includes(h.quantity) ? h.quantity : ''].filter(Boolean).join(' – '),
        url: `https://world.openfoodfacts.org/product/${h.code}`,
        image: h.image_front_url || h.image_front_small_url || null,
        brand: str(h.brands).split(',')[0],
        snippet: [str(h.generic_name), labels.slice(0, 4).join(', '), h.stores ? `Bán tại: ${str(h.stores)}` : ''].filter(Boolean).join(' · '),
        countries,
        country: countries.length === 1 ? countries[0] : countries.length ? 'world' : null,
        sections: {
          ingredients: clean(str(h.ingredients_text_en) || str(h.ingredients_text)) || undefined,
          storage: clean(str(h.conservation_conditions)) || undefined,
          usage: clean(str(h.preparation)) || undefined,
          weight: h.quantity || undefined,
        },
        nutriscore: h.nutriscore_grade && /^[a-e]$/.test(h.nutriscore_grade) ? h.nutriscore_grade.toUpperCase() : null,
        nova: h.nova_group || null,
        gtin: h.code,
        extra: { allergensTags: tagNames(h.allergens_tags), labels },
      };
    });
  },
  // Latest community price from Open Prices, if any.
  async detail(item, { signal }) {
    if (!item.gtin) return null;
    const d = await fetchJSON(`https://prices.openfoodfacts.org/api/v1/prices?product_code=${item.gtin}&order_by=-date&size=5`, {
      signal, timeout: 6000, headers: UA,
    });
    const p = d.items?.[0];
    if (!p) return { sections: {} };
    return { price: p.price, currency: p.currency, sections: {} };
  },
};
