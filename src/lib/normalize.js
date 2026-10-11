// Parsing helpers that turn messy listing text into comparable fields:
// price + currency, pack size (grams/ml), age, product type, claims, allergens, brand.

export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export const fold = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd');

export const truncate = (s, n) => {
  s = clean(s);
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
};

// ---------- Price ----------

const ZERO_DECIMAL = new Set(['VND', 'JPY', 'KRW', 'IDR', 'TWD', 'CLP', 'HUF']);
const DOLLAR_BY_MARKET = { us: 'USD', au: 'AUD', sg: 'SGD', ca: 'CAD', nz: 'NZD', hk: 'HKD', tw: 'TWD' };

// Order matters: longer / more specific symbols first.
const SYMBOLS = [
  [/US\$|USD/i, 'USD'], [/A\$|AU\$|AUD/i, 'AUD'], [/S\$|SGD/i, 'SGD'], [/C\$|CAD/i, 'CAD'], [/NZ\$|NZD/i, 'NZD'],
  [/HK\$|HKD/i, 'HKD'], [/NT\$|TWD/i, 'TWD'], [/VNĐ|VND|₫|(?<=\d\s?)đ/i, 'VND'], [/£|GBP/i, 'GBP'],
  [/€|EUR/i, 'EUR'], [/円|JPY/i, 'JPY'], [/元|CNY|RMB/i, 'CNY'], [/₩|원|KRW/i, 'KRW'], [/฿|บาท|THB/i, 'THB'],
  [/RM|MYR/i, 'MYR'], [/₱|PHP/i, 'PHP'], [/Rp|IDR/i, 'IDR'], [/[¥￥]/, 'YEN'], [/\$/, 'DOLLAR'],
];

function parseNumber(token, currency) {
  let t = token.replace(/[\s ']/g, '');
  if (!t) return NaN;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (ZERO_DECIMAL.has(currency)) return Number(t.replace(/[.,]/g, ''));
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    return Number(t.split(thou).join('').replace(dec, '.'));
  }
  const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
  if (!sep) return Number(t);
  const parts = t.split(sep);
  const tail = parts.at(-1);
  // "1.234" / "12,900" (groups of 3) -> thousands; "4,32" / "25.77" -> decimal
  if (tail.length === 3 && (parts.length > 2 || parts[0].length <= 3)) return Number(parts.join(''));
  return Number(parts.slice(0, -1).join('') + '.' + tail);
}

export function parsePrice(input, market = 'vn', currencyHint) {
  if (input == null || input === '') return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? { value: input, currency: currencyHint || 'VND' } : null;
  }
  const s = clean(input);
  let currency = currencyHint ? currencyHint.toUpperCase() : null;
  if (!currency) {
    for (const [re, cur] of SYMBOLS) {
      if (re.test(s)) { currency = cur; break; }
    }
  }
  if (currency === 'YEN') currency = market === 'cn' ? 'CNY' : 'JPY';
  if (currency === 'DOLLAR') currency = DOLLAR_BY_MARKET[market] || 'USD';
  const m = s.match(/\d[\d\s., ']*/);
  if (!m) return null;
  const value = parseNumber(m[0].replace(/[.,\s]+$/, ''), currency);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, currency: currency || null };
}

// ---------- Pack size ----------

const UNIT_G = { kg: 1000, g: 1, gr: 1, gram: 1, grams: 1, gam: 1, ml: 1, l: 1000, lit: 1000, 'lít': 1000, oz: 28.35, lb: 453.6 };
const UNIT_RE = '(kg|grams?|gam|gr|g|ml|lít|lit|l|oz|lb)';
const NUM_RE = '(\\d+(?:[.,]\\d+)?)';

const toNum = (s) => Number(String(s).replace(',', '.'));
const unitKind = (u) => (/ml|l|lít|lit/i.test(u) ? 'ml' : 'g');

export function parseQuantity(text) {
  if (!text) return null;
  const s = ' ' + String(text).toLowerCase() + ' ';
  let m;
  // "6x110g", "4 x 90 g"
  m = s.match(new RegExp(`(\\d{1,3})\\s*[x×]\\s*${NUM_RE}\\s*${UNIT_RE}(?![a-z])`, 'i'));
  if (m) {
    const each = toNum(m[2]) * UNIT_G[m[3]];
    return { total: Math.round(toNum(m[1]) * each), unit: unitKind(m[3]), label: `${m[1]}×${m[2]}${m[3]}` };
  }
  // "110g x 6"
  m = s.match(new RegExp(`${NUM_RE}\\s*${UNIT_RE}\\s*[x×]\\s*(\\d{1,3})(?!\\d)`, 'i'));
  if (m) {
    const each = toNum(m[1]) * UNIT_G[m[2]];
    return { total: Math.round(toNum(m[3]) * each), unit: unitKind(m[2]), label: `${m[3]}×${m[1]}${m[2]}` };
  }
  m = s.match(new RegExp(`(?<![\\d.,])${NUM_RE}\\s*${UNIT_RE}(?![a-z])`, 'i'));
  if (!m) return null;
  let total = toNum(m[1]) * UNIT_G[m[2]];
  if (!(total > 0) || total > 20000) return null;
  let label = `${m[1]}${m[2]}`;
  const pack = s.match(/pack of (\d{1,2})|(\d{1,2})[- ]?(?:pack|pk)\b|(?:combo|lốc|set|bộ|thùng)\s*(\d{1,2})(?!\s*(?:tháng|m\b|tuổi))/i);
  if (pack) {
    const n = toNum(pack[1] || pack[2] || pack[3]);
    if (n > 1 && n <= 48) {
      total *= n;
      label = `${n}×${label}`;
    }
  }
  return { total: Math.round(total), unit: unitKind(m[2]), label };
}

// ---------- Age / type / claims ----------

const STAGE_MONTHS = { 1: 4, 2: 6, 3: 9, 4: 12 };

export function parseAgeMonths(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();
  let m;
  if ((m = s.match(/(\d{1,2})\s*[-–~]\s*(\d{1,2})\s*(?:tuổi|years?|yrs?|ans|jahre)/))) return Number(m[1]) * 12;
  if ((m = s.match(/(?:từ|trên|from|ab|dès|des|after)\s*(\d{1,2})\s*(?:\+\s*)?(?:tháng|months?|monat|mois|m\b)/))) return Number(m[1]);
  if ((m = s.match(/(\d{1,2})\s*\+?\s*(?:tháng tuổi|tháng|months?\+?|mths?|monate?n?|mois|m\+|m\b|ヶ月|か月|カ月|개월)/))) {
    const n = Number(m[1]);
    if (n >= 3 && n <= 36) return n;
  }
  if ((m = s.match(/(\d)\s*\+?\s*(?:tuổi|years?|yrs?|歳|살)/))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 5) return n * 12;
  }
  if ((m = s.match(/stage\s*(\d)|giai đoạn\s*(\d)|bước\s*(\d)/))) return STAGE_MONTHS[m[1] || m[2] || m[3]] || null;
  return null;
}

// Feeding accessories, books, appliances: listed first so they don't get a food type.
export const NON_FOOD = 'Dụng cụ / phụ kiện';
export const TYPES = [
  [NON_FOOD, /ghế ăn|yếm|bình sữa|bình nước|cốc tập|thìa|muỗng|máy xay|máy hâm|máy tiệt trùng|máy làm|khay|hộp đựng|hộp trữ|túi trữ|chén ăn|bát ăn|đĩa ăn|núm ti|ti giả|sách|dụng cụ|nồi nấu|rây lọc|high ?chair|\bbibs?\b|\bspoons?\b|\bforks?\b|feeding bottle|sippy|cup holder|\bcontainers?\b|\btrays?\b|stroller|blender|steamer|food maker|freezer|cookbook|\bbooks?\b|dispenser|pacifier|\bplates?\b|suction bowl|silicone (?:bowl|plate|bib|feeder)|storage pods|\bfeeder\b|utensil|teething toy|スプーン|食器|エプロン|チェア|容器|レシピ本|숟가락|식판|턱받이/i],
  ['Sữa công thức', /sữa (bột|công thức)|infant formula|formula milk|follow-on milk|growing[- ]up milk|分ミルク|粉ミルク|분유|säuglingsmilch|lait infantile|sữa (hipp|aptamil|nan|meiji|morinaga|similac|enfa)/i],
  ['Bột ăn dặm', /bột ăn dặm|bột dinh dưỡng|bột gạo|bột (ngũ cốc|sữa)|ngũ cốc|cereal|cerelac|ridielac|getreidebrei|milchbrei|\bbrei\b|bouillie|céréales|baby rice|oatmeal|porridge oats|ベビーシリアル|粉末/i],
  ['Cháo / súp', /cháo|súp|soup|congee|risotto|おかゆ|がゆ|粥|죽/i],
  ['Bánh / snack', /bánh|snack|puffs?|melts?|biscuit|cracker|rusks?|teether|wafer|crisps?|stick|bars?\b|zwieback|gâteau|biscuits?|せんべい|ボーロ|과자|쌀과자/i],
  ['Mì / nui', /\bmì\b|\bmỳ\b|\bnui\b|pasta|noodles?|nudeln|pâtes|うどん|そうめん|국수|면\b/i],
  ['Sữa chua / váng sữa', /sữa chua|váng sữa|yog(h)?urt|fromage frais|joghurt|ヨーグルト|요거트/i],
  ['Dầu / gia vị', /dầu ăn|dầu (óc chó|oliu|olive|gấc|cá)|gia vị|hạt nêm|nước mắm|nước tương|seasoning|\boil\b|öl\b|huile|ふりかけ|だし|조미료/i],
  ['Nước ép / đồ uống', /nước ép|juice|saft|jus\b|ジュース|주스/i],
  ['Trái cây / rau nghiền', /nghiền|xay nhuyễn|puree|purée|pouch|squeez|quetsch|mus\b|compote|jar|hũ|lọ|túi|food pouch|ベビーフード|瓶|파우치|이유식/i],
  ['Thịt / cá / đạm', /ruốc|chà bông|thịt|cá hồi|tôm|salmon|chicken|beef|fish|meat|鶏|魚|고기/i],
];

export function detectType(text) {
  if (!text) return null;
  for (const [name, re] of TYPES) if (re.test(text)) return name;
  return null;
}

const CLAIMS = [
  ['Hữu cơ', /organic|hữu cơ|\bbio\b|biologique|オーガニック|有機|유기농|有机/i],
  ['Không đường', /no added sugars?|không (thêm |bổ sung )?đường|sugar[- ]free|không chứa đường|ohne (zucker|zuckerzusatz)|sans sucre|砂糖不使用|무설탕|无糖/i],
  ['Không muối', /no added salt|không (thêm )?muối|salt[- ]free|ohne salz|sans sel|食塩不使用|무염/i],
  ['Không gluten', /gluten[- ]free|không (chứa )?gluten|glutenfrei|sans gluten|글루텐 프리/i],
  ['Không chất bảo quản', /no preservatives|không (chất )?bảo quản|preservative[- ]free|ohne konservierung|無添加|무첨가/i],
  ['Non-GMO', /non[- ]gmo|không biến đổi gen/i],
  ['Thuần chay', /vegan|thuần chay|plant[- ]based/i],
  ['Bổ sung DHA', /\bdha\b/i],
  ['Bổ sung sắt', /iron|sắt|\beisen\b|\bfer\b/i],
  ['Probiotic', /probiotic|lợi khuẩn|men vi sinh|bifidus|lactobacillus/i],
];

export function detectClaims(text) {
  if (!text) return [];
  return CLAIMS.filter(([, re]) => re.test(text)).map(([n]) => n);
}

const ALLERGENS = [
  ['Sữa', /\bsữa\b|milk|dairy|lactose|whey|casein|sữa bột|milch|lait|乳|우유/i],
  ['Gluten/lúa mì', /gluten|wheat|lúa mì|bột mì|barley|lúa mạch|\boat|yến mạch|rye|weizen|blé|小麦|밀/i],
  ['Trứng', /\btrứng\b|\begg|\bei\b|œuf|oeuf|卵|계란|달걀/i],
  ['Đậu nành', /đậu nành|soy|soja|大豆|대두/i],
  ['Đậu phộng/hạt', /đậu phộng|lạc|peanut|hazelnut|almond|cashew|walnut|hạt điều|hạnh nhân|óc chó|nuss|noix|落花生|땅콩/i],
  ['Cá/hải sản', /\bcá\b|fish|tôm|shrimp|prawn|cua|crab|salmon|tuna|fisch|poisson|魚|えび|생선|새우/i],
  ['Mè', /\bmè\b|vừng|sesame|sesam|ごま|참깨/i],
];

export function detectAllergens(ingredients) {
  if (!ingredients) return [];
  return ALLERGENS.filter(([, re]) => re.test(ingredients)).map(([n]) => n);
}

// ---------- Brands ----------

export const BRANDS = [
  'HiPP', 'Gerber', 'Heinz', 'Nestlé', 'Cerelac', 'Ridielac', 'Vinamilk', 'Nutifood', 'Blédina', 'Bledina', 'Wakodo', 'Pigeon',
  'Kewpie', 'Meiji', 'Morinaga', 'Glico', 'Ella\'s Kitchen', 'Plum Organics', 'Happy Baby', 'Little Freddie', 'Bellamy\'s',
  'Organix', 'Annabel Karmel', 'Earth\'s Best', 'Beech-Nut', 'Sprout', 'Holle', 'Alete', 'Bebivita', 'Babybio', 'Good Goût',
  'Piccolo', 'Kiddylicious', 'Mum-Mum', 'Want Want', 'Ivenet', 'Bebecook', 'Naeiae', 'Anpaso', 'Mămmy', 'Mammy', 'Sun Baby',
  'Kidsmeal', 'Aptamil', 'Similac', 'Enfa', 'Enfamil', 'Friso', 'Nan', 'Abbott', 'Danone', 'Dielac', 'Optimum', 'Grow Plus',
  'Hikari', 'Kabaya', 'Calbee', 'Lotte', 'Orgran', 'Rafferty\'s Garden', 'Baby Gourmet', 'Only Organic', 'Mama Bear',
  'Once Upon a Farm', 'Serenity Kids', 'Yumi', 'Cerebos', 'Wakodo', 'Asahi', 'Bio Kinder', 'Hero Baby', 'Nature\'s Way',
  'Freshly Picked', 'Baby Brezza', 'Picot', 'Topfer', 'Töpfer', 'Humana', 'Bebelac', 'Nestle', 'Bambi', 'Dr. Papie',
  'Mabu', 'Bibo', 'Hokkaido', 'Kizzy', 'Organic Kids', 'Yummy Kids', 'Babee', 'Gold Kids', 'Mầm Xanh', 'Hebi',
  // Europe / Australia / North America
  'Mellin', 'Plasmon', 'Milupa', 'Bambix', 'Freche Freunde', 'NaturNes', 'Popote', 'Yooji', 'Kendamil', 'Peter Rabbit Organics',
  'GoGo squeeZ', 'Little Bellies', 'Little Spoon', 'Cerebelly', 'Happy Tot', 'NurturMe', 'Baby Mum-Mum', 'Heinz By Nature',
  'Sma', 'Cow & Gate', 'Hipp Organic', 'Nutricia', 'Nutribén', 'Nutriben', 'Hero Solo', 'Smileat', 'Blevit', 'Ordesa', 'Olvarit',
  'Bebivita', 'Kölln', 'Sunval', "Pom'Potes", 'Materne', 'Gallia', 'Guigoz', 'Modilac', 'Nidal', 'Mamia', 'Bellamy', 'Holle Baby',
];
const BRAND_MATCHERS = [...new Set(BRANDS)].map((b) => [b, new RegExp(`(?<!\\p{L})${fold(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'u')]);

export function guessBrand(text) {
  if (!text) return null;
  const f = fold(text);
  for (const [b, re] of BRAND_MATCHERS) if (re.test(f)) return b === 'Nestle' ? 'Nestlé' : b === 'Bledina' ? 'Blédina' : b;
  return null;
}

export function normalizeBrand(b) {
  b = clean(b);
  if (!b || /^(no ?brand|oem|khác|other|generic|không thương hiệu|n\/a)$/i.test(b)) return null;
  const known = guessBrand(b);
  if (known) return known;
  // Title-case only all-caps or all-lowercase names; \b is ASCII-only, so split on spaces instead.
  if (b !== b.toUpperCase() && b !== b.toLowerCase()) return b;
  return b.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ---------- Relevance ----------

const STOP = new Set(['cho', 'be', 'va', 'cua', 'the', 'a', 'an', 'of', 'for', 'and', 'with', 'loai', 'nao', 'tot', 'gia', 're', 'mua', 'o', 'dau']);
const BABY_WORDS = /an dam|tre em|cho be|em be|so sinh|nhu nhi|baby|infant|toddler|kids?|months?|thang|weaning|stage|bebe|kinder|enfant|bayi/;
// CJK/Thai are tested on the raw text: NFD folding splits kana like ベ into ヘ + U+3099.
const BABY_CJK = /離乳食|ベビー|赤ちゃん|이유식|아기|婴儿|宝宝|辅食|เด็ก|ทารก/;

const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

// Words for spaced scripts; character bigrams for CJK/Thai, which don't separate words with spaces.
export const tokens = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}\p{M}]+/u).flatMap((w) => {
  if (!w) return [];
  if (NO_SPACES.test(w)) {
    const chars = [...w];
    return chars.length < 3 ? [w] : chars.slice(0, -1).map((c, i) => c + chars[i + 1]);
  }
  const f = fold(w);
  return STOP.has(f) ? [] : [f];
});

// Short tokens must match a whole word ("an" must not hit "vegan"); longer ones may match a word prefix
// ("snack" ~ "snacks"); CJK bigrams match as substrings.
function matches(t, hay, words) {
  if (NO_SPACES.test(t)) return hay.includes(t);
  if (words.has(t)) return true;
  if (t.length < 4) return false;
  for (const w of words) if (w.length >= 4 && (w.startsWith(t) || t.startsWith(w))) return true;
  return false;
}

// ---------- Product form ----------
const VI_MARKS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
// Word matching alone can't tell "thanh phô mai" (cheese sticks) from "bánh quy phô mai" (cheese biscuits):
// both share "phô mai". The form word is what the shopper actually asked for, so a title naming a different
// form and none of the query's is a different product. Terms are matched on accented lowercase text so
// Vietnamese "mì" doesn't hit Spanish "mi"; Latin terms also take a plural s/es.
const FORMS = {
  stick: ['thanh', 'que', 'stick', 'string', 'string cheese', 'cheestrings', 'bar', 'riegel', 'barre', 'barrita', 'barretta', 'barrette', 'bâtonnet', 'batonnet', 'palito', 'スティック', 'バー', '스틱', '棒', 'แท่ง'],
  biscuit: ['bánh quy', 'biscuit', 'biscotti', 'biscotto', 'cookie', 'cookies', 'cracker', 'keks', 'kekse', 'galleta', 'sablé', 'ビスケット', 'クッキー', 'クラッカー', '쿠키', '비스킷', '크래커', '饼干', 'บิสกิต', 'คุกกี้'],
  wafer: ['bánh xốp', 'bánh quế', 'wafer', 'waffel', 'gaufrette', 'ウエハース', '웨이퍼'],
  burger: ['burger', 'hamburger', 'cheeseburger', 'bánh mì kẹp', 'バーガー', '버거'],
  pizza: ['pizza', 'ピザ', '피자'],
  bread: ['bánh mì', 'bread', 'brot', 'brötchen', 'toast', 'sandwich', 'パン', '빵', '面包'],
  cake: ['bánh bông lan', 'bánh kem', 'cake', 'cupcake', 'muffin', 'kuchen', 'gâteau', 'gateau', 'ケーキ', '케이크', '蛋糕'],
  candy: ['kẹo', 'candy', 'candies', 'gummy', 'gummies', 'bonbon', 'lollipop', 'グミ', 'キャンディ', '사탕', '糖果'],
  jelly: ['thạch', 'jelly', 'gelee', 'gelée', 'ゼリー', '젤리', '果冻'],
  ricecake: ['bánh gạo', 'rice cake', 'rice cracker', 'rice biscuit', 'rice rusk', 'せんべい', '쌀과자', '米饼'],
  puffs: ['bỏng', 'puff', 'puffs', 'melts', 'ボーロ'],
  chips: ['bim bim', 'snack khoai', 'chips', 'crisps', 'ポテトチップス', '칩'],
  yogurt: ['sữa chua', 'yogurt', 'yoghurt', 'joghurt', 'yaourt', 'ヨーグルト', '요거트', '요구르트', '酸奶'],
  icecream: ['kem', 'ice cream', 'gelato', 'アイス', '아이스크림', '冰淇淋'],
  sauce: ['sốt', 'xốt', 'nước sốt', 'nước xốt', 'sauce', 'soße', 'dip', 'ソース', '소스'],
  powder: ['bột', 'powder', 'pulver', 'poudre', 'パウダー', '분말', '粉'],
  spread: ['spread', 'aufstrich', 'à tartiner', 'cream cheese', 'phô mai kem', 'クリームチーズ'],
  slice: ['lát', 'slice', 'scheiben', 'tranche', 'スライス', '슬라이스'],
  cube: ['viên', 'cube', 'würfel', 'キューブ', '큐브'],
  porridge: ['cháo', 'porridge', 'congee', 'おかゆ', '粥', '죽'],
  soup: ['súp', 'soup', 'suppe', 'soupe', 'スープ', '수프'],
  noodles: ['mì', 'mỳ', 'nui', 'pasta', 'noodle', 'nudeln', 'pâtes', 'macaroni', 'うどん', 'そうめん', '국수', '面条'],
  puree: ['nghiền', 'puree', 'purée', 'pouch', 'quetschie', 'compote', 'ピューレ', '퓨레'],
  juice: ['nước ép', 'juice', 'saft', 'jus', 'ジュース', '주스', '果汁'],
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FORM_TERMS = Object.entries(FORMS)
  .flatMap(([form, terms]) => terms.map((t) => [form, t]))
  .sort((a, b) => b[1].length - a[1].length)
  .map(([form, t]) => {
    const body = esc(t).replace(/ /g, '\\s+');
    const latin = /^[\p{Script=Latin}\s]+$/u.test(t);
    const re = NO_SPACES.test(t) || /[\p{Script=Hangul}]/u.test(t)
      ? new RegExp(body, 'gu')
      : new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${body}${latin ? '(?:e?s)?' : ''}(?![\\p{L}\\p{M}\\p{N}])`, 'gu');
    return [form, re];
  });

// Vietnamese counts use the same words as forms: "Bánh xốp 20 thanh" is 20 wafers, not a bar.
const COUNTED = /\d+\s*(?:x\s*)?(?:thanh|que|viên|lát|miếng)(?![\p{L}\p{M}])/gu;

// Forms named in a text, earliest first; longer terms win and are consumed first ("bánh mì kẹp" is a burger,
// not bread + noodles). Consumed text is blanked to the same length so positions stay comparable.
function formsByPosition(text) {
  let s = String(text ?? '').normalize('NFC').toLowerCase().replace(COUNTED, (m) => ' '.repeat(m.length));
  const at = new Map();
  for (const [form, re] of FORM_TERMS) {
    re.lastIndex = 0;
    const m = re.exec(s);
    if (!m) continue;
    at.set(form, Math.min(at.get(form) ?? Infinity, m.index));
    s = s.replace(re, (x) => ' '.repeat(x.length));
  }
  return [...at].sort((a, b) => a[1] - b[1]).map(([form]) => form);
}
export const productForms = (text) => new Set(formsByPosition(text));

// How an item's title stands against the forms in the user's query:
// 'match' (names one of them), 'other' (names only different forms), or null (no query form / no form named).
// Vietnamese puts the head noun first, so there the first form named decides: "Thạch phô mai que" is a jelly.
export function formMatch(title, queryForms) {
  if (!queryForms?.size) return null;
  const forms = formsByPosition(title);
  if (!forms.length) return null;
  if (VI_MARKS.test(title)) return queryForms.has(forms[0]) ? 'match' : 'other';
  return forms.some((f) => queryForms.has(f)) ? 'match' : 'other';
}

// The query minus its form words, with '|' where they stood so syllable pairs don't bridge the gap.
// Form words are judged by formMatch (which also accepts synonyms: "que" for "thanh").
function stripForms(q) {
  let s = String(q ?? '').normalize('NFC').toLowerCase();
  for (const [, re] of FORM_TERMS) s = s.replace(re, ' | ');
  return s;
}

// Vietnamese words are often two syllables ("phô mai"); matched one by one they hit "ô mai thanh mai".
// Adjacent syllables of a Vietnamese query must also sit together in the title ("phô mai" / "phomai").
function syllablePairs(core) {
  const pairs = [];
  for (const seg of core.split('|')) {
    let prev = null;
    for (const w of seg.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean).map(fold)) {
      if (STOP.has(w) || NO_SPACES.test(w)) {
        prev = null;
        continue;
      }
      if (prev) pairs.push([prev, w, new RegExp(`(?<![\\p{L}\\p{N}])${esc(prev)}[\\s-]*${esc(w)}(?![\\p{L}\\p{N}])`, 'u')]);
      prev = w;
    }
  }
  return pairs;
}

export const relevance = (title, text, queries) => relevanceDetail(title, text, queries).score;

// score, plus `split`: the best-matching query is Vietnamese and the title has its syllables only apart —
// a shop's own search engine returns those too, so its trust bonus shouldn't rescue them.
export function relevanceDetail(title, text, queries) {
  // Folded copies match Latin tokens; raw lowercase copies match CJK bigrams (folding splits kana).
  const ft = fold(title) + '\n' + String(title ?? '').toLowerCase();
  const fx = fold(text) + '\n' + String(text ?? '').toLowerCase();
  const wordsT = new Set(ft.split(/[^\p{L}\p{N}]+/u));
  const wordsX = new Set(fx.split(/[^\p{L}\p{N}]+/u));
  let best = 0;
  let split = false;
  for (const q of queries) {
    const core = stripForms(q);
    const pairs = VI_MARKS.test(q) ? syllablePairs(core) : [];
    // "phomai" written as one word counts for both syllables.
    for (const [a, b] of pairs) {
      if (wordsT.has(a + b)) wordsT.add(a).add(b);
      if (wordsX.has(a + b)) wordsX.add(a).add(b);
    }
    let qt = tokens(core.replace(/\|/g, ' '));
    // A query that is only a form ("bánh quy") keeps its words.
    if (!qt.length) qt = tokens(q);
    if (!qt.length) continue;
    let hitT = 0;
    let hitX = 0;
    for (const t of qt) {
      if (matches(t, ft, wordsT)) hitT++;
      else if (matches(t, fx, wordsX)) hitX++;
    }
    let together = 1;
    let apart = false;
    if (pairs.length) {
      const hit = pairs.reduce((n, [, , re]) => n + (re.test(ft) ? 1 : re.test(fx) ? 0.5 : 0), 0);
      together = 0.4 + 0.6 * (hit / pairs.length);
      apart = !hit && (hitT > 0 || VI_MARKS.test(title ?? ''));
    }
    const phrase = ft.includes(fold(q).trim()) ? 0.25 : 0;
    const score = ((hitT + hitX * 0.4) / qt.length) * together + phrase;
    if (score > best || (score === best && !split)) split = apart;
    best = Math.max(best, score);
  }
  if (BABY_WORDS.test(ft + ' ' + fx) || BABY_CJK.test(title + ' ' + text)) best += 0.15;
  return { score: Math.round(Math.min(best, 1.4) * 100) / 100, split };
}
