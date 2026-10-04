// Markets (countries) the app can research, plus helpers to guess a listing's country.

export const MARKETS = {
  vn: { name: 'Việt Nam', lang: 'vi', currency: 'VND', ddg: 'vn-vi', mkt: 'vi-VN', lazada: 'www.lazada.vn' },
  us: { name: 'Mỹ', lang: 'en', currency: 'USD', ddg: 'us-en', mkt: 'en-US', bingShop: true },
  gb: { name: 'Anh', lang: 'en', currency: 'GBP', ddg: 'uk-en', mkt: 'en-GB', bingShop: true },
  au: { name: 'Úc', lang: 'en', currency: 'AUD', ddg: 'au-en', mkt: 'en-AU', bingShop: true },
  de: { name: 'Đức', lang: 'de', currency: 'EUR', ddg: 'de-de', mkt: 'de-DE', bingShop: true },
  fr: { name: 'Pháp', lang: 'fr', currency: 'EUR', ddg: 'fr-fr', mkt: 'fr-FR', bingShop: true },
  it: { name: 'Ý', lang: 'it', currency: 'EUR', ddg: 'it-it', mkt: 'it-IT' },
  es: { name: 'Tây Ban Nha', lang: 'es', currency: 'EUR', ddg: 'es-es', mkt: 'es-ES' },
  nl: { name: 'Hà Lan', lang: 'nl', currency: 'EUR', ddg: 'nl-nl', mkt: 'nl-NL' },
  ca: { name: 'Canada', lang: 'en', currency: 'CAD', ddg: 'ca-en', mkt: 'en-CA', bingShop: true },
  jp: { name: 'Nhật Bản', lang: 'ja', currency: 'JPY', ddg: 'jp-jp', mkt: 'ja-JP' },
  kr: { name: 'Hàn Quốc', lang: 'ko', currency: 'KRW', ddg: 'kr-kr', mkt: 'ko-KR' },
  cn: { name: 'Trung Quốc', lang: 'zh-CN', currency: 'CNY', ddg: 'cn-zh', mkt: 'zh-CN' },
  sg: { name: 'Singapore', lang: 'en', currency: 'SGD', ddg: 'sg-en', mkt: 'en-SG', lazada: 'www.lazada.sg' },
  th: { name: 'Thái Lan', lang: 'th', currency: 'THB', ddg: 'th-th', mkt: 'th-TH', lazada: 'www.lazada.co.th' },
  my: { name: 'Malaysia', lang: 'en', currency: 'MYR', ddg: 'my-en', mkt: 'en-MY', lazada: 'www.lazada.com.my' },
  ph: { name: 'Philippines', lang: 'en', currency: 'PHP', ddg: 'ph-en', mkt: 'en-PH', lazada: 'www.lazada.com.ph' },
  id: { name: 'Indonesia', lang: 'id', currency: 'IDR', ddg: 'id-en', mkt: 'id-ID', lazada: 'www.lazada.co.id' },
};

export const COUNTRY_NAMES = {
  vn: 'Việt Nam', us: 'Mỹ', gb: 'Anh', au: 'Úc', de: 'Đức', fr: 'Pháp', jp: 'Nhật Bản', kr: 'Hàn Quốc',
  cn: 'Trung Quốc', sg: 'Singapore', th: 'Thái Lan', my: 'Malaysia', ph: 'Philippines', id: 'Indonesia',
  ca: 'Canada', nz: 'New Zealand', it: 'Ý', es: 'Tây Ban Nha', nl: 'Hà Lan', be: 'Bỉ', ch: 'Thụy Sĩ',
  at: 'Áo', se: 'Thụy Điển', dk: 'Đan Mạch', no: 'Na Uy', fi: 'Phần Lan', pl: 'Ba Lan', ie: 'Ireland',
  pt: 'Bồ Đào Nha', tw: 'Đài Loan', hk: 'Hồng Kông', in: 'Ấn Độ', ru: 'Nga', ae: 'UAE', sa: 'Ả Rập Xê Út',
  br: 'Brazil', mx: 'Mexico', za: 'Nam Phi', tr: 'Thổ Nhĩ Kỳ', il: 'Israel', cz: 'Séc', hu: 'Hungary',
  gr: 'Hy Lạp', ro: 'Romania', ar: 'Argentina', cl: 'Chile', eg: 'Ai Cập', ma: 'Morocco', pk: 'Pakistan',
  world: 'Toàn cầu',
};

// Known .com/.net shops whose country isn't in the TLD.
const DOMAIN_COUNTRY = {
  'amazon.com': 'us', 'walmart.com': 'us', 'target.com': 'us', 'iherb.com': 'us', 'ebay.com': 'us',
  'gerber.com': 'us', 'happyfamilyorganics.com': 'us', 'plumorganics.com': 'us', 'beechnut.com': 'us',
  'earthsbest.com': 'us', 'costco.com': 'us', 'kroger.com': 'us', 'thrivemarket.com': 'us', 'instacart.com': 'us',
  'cvs.com': 'us', 'walgreens.com': 'us', 'samsclub.com': 'us', 'buybuybaby.com': 'us', 'wholefoodsmarket.com': 'us',
  'tesco.com': 'gb', 'sainsburys.co.uk': 'gb', 'ocado.com': 'gb', 'boots.com': 'gb', 'asda.com': 'gb',
  'ellaskitchen.com': 'gb', 'organix.com': 'gb', 'annabelkarmel.com': 'gb',
  'woolworths.com.au': 'au', 'coles.com.au': 'au', 'chemistwarehouse.com.au': 'au',
  'rakuten.co.jp': 'jp', 'lohaco.yahoo.co.jp': 'jp', 'shopping.yahoo.co.jp': 'jp',
  'coupang.com': 'kr', 'gmarket.co.kr': 'kr', '11st.co.kr': 'kr',
  'tmall.com': 'cn', 'taobao.com': 'cn', 'jd.com': 'cn', '1688.com': 'cn', 'alibaba.com': 'cn',
  'concung.com': 'vn', 'avakids.com': 'vn', 'shopee.vn': 'vn', 'tiki.vn': 'vn', 'lazada.vn': 'vn',
  'bachhoaxanh.com': 'vn', 'bibomart.com.vn': 'vn', 'kidsplaza.vn': 'vn', 'hasaki.vn': 'vn',
  'dm.de': 'de', 'rossmann.de': 'de', 'hipp.de': 'de',
  'bledina.com': 'fr', 'carrefour.fr': 'fr',
  'fairprice.com.sg': 'sg', 'redmart.com': 'sg', 'jumbo.com': 'nl', 'bol.com': 'nl',
  'waitrose.com': 'gb', 'morrisons.com': 'gb', 'superdrug.com': 'gb', 'hollandandbarrett.com': 'gb',
  'aubert.com': 'fr', 'lotuss.com': 'th', 'tokopedia.com': 'id', 'blibli.com': 'id', 'ssg.com': 'kr', 'kurly.com': 'kr',
  'shop-apotheke.com': 'de', 'suning.com': 'cn', 'matsukiyococokara-online.com': 'jp', 'nhathuoclongchau.com.vn': 'vn',
};

const SLD = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);
const TLD_ALIAS = { uk: 'gb' };

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function countryFromUrl(url) {
  const host = hostOf(url);
  if (!host) return null;
  for (const [d, c] of Object.entries(DOMAIN_COUNTRY)) {
    if (host === d || host.endsWith('.' + d)) return c;
  }
  const parts = host.split('.');
  let tld = parts.at(-1);
  if (parts.length >= 3 && SLD.has(parts.at(-2)) && tld.length === 2) tld = parts.at(-1);
  tld = TLD_ALIAS[tld] || tld;
  if (tld.length === 2 && COUNTRY_NAMES[tld]) return tld;
  return null;
}

const CURRENCY_COUNTRY = {
  VND: 'vn', JPY: 'jp', KRW: 'kr', CNY: 'cn', GBP: 'gb', AUD: 'au', SGD: 'sg', THB: 'th',
  MYR: 'my', PHP: 'ph', IDR: 'id', CAD: 'ca', NZD: 'nz', HKD: 'hk', TWD: 'tw', INR: 'in',
};
export const countryFromCurrency = (cur) => CURRENCY_COUNTRY[cur] || null;

// OFF countries_tags like "en:united-kingdom" -> iso2
const OFF_COUNTRIES = {
  'vietnam': 'vn', 'united-states': 'us', 'united-kingdom': 'gb', 'australia': 'au', 'germany': 'de',
  'france': 'fr', 'japan': 'jp', 'south-korea': 'kr', 'china': 'cn', 'singapore': 'sg', 'thailand': 'th',
  'malaysia': 'my', 'philippines': 'ph', 'indonesia': 'id', 'canada': 'ca', 'new-zealand': 'nz',
  'italy': 'it', 'spain': 'es', 'netherlands': 'nl', 'belgium': 'be', 'switzerland': 'ch', 'austria': 'at',
  'sweden': 'se', 'denmark': 'dk', 'norway': 'no', 'finland': 'fi', 'poland': 'pl', 'ireland': 'ie',
  'portugal': 'pt', 'taiwan': 'tw', 'hong-kong': 'hk', 'india': 'in', 'russia': 'ru',
  'united-arab-emirates': 'ae', 'saudi-arabia': 'sa', 'brazil': 'br', 'mexico': 'mx', 'south-africa': 'za',
  'turkey': 'tr', 'israel': 'il', 'czech-republic': 'cz', 'hungary': 'hu', 'greece': 'gr', 'romania': 'ro',
  'argentina': 'ar', 'chile': 'cl', 'egypt': 'eg', 'morocco': 'ma', 'pakistan': 'pk', 'world': 'world',
};
export function countriesFromOFF(tags = []) {
  return [...new Set(tags.map((t) => OFF_COUNTRIES[t.replace(/^\w+:/, '')]).filter(Boolean))];
}

// Free-text origin field ("Đức", "Germany", "Made in Japan") -> iso2. Only meant for short origin fields.
// \b is ASCII-only in JS, so word boundaries are built from \p{L} lookarounds.
const word = (alts) => new RegExp(`(?<!\\p{L})(?:${alts})(?!\\p{L})`, 'iu');
const ORIGIN_WORDS = [
  [word('việt nam|vietnam'), 'vn'], [word('đức|germany|deutschland'), 'de'], [word('pháp|france'), 'fr'],
  [word('nhật bản|nhật|japan'), 'jp'], [word('hàn quốc|korea'), 'kr'], [word('trung quốc|china'), 'cn'],
  [word('mỹ|hoa kỳ|usa|united states'), 'us'], [word('anh|united kingdom|uk|england'), 'gb'],
  [word('úc|australia'), 'au'], [word('new zealand|niu di lân'), 'nz'], [word('thái lan|thailand'), 'th'],
  [word('singapore'), 'sg'], [word('malaysia'), 'my'], [word('indonesia'), 'id'], [word('hà lan|netherlands'), 'nl'],
  [word('thụy sĩ|switzerland'), 'ch'], [word('tây ban nha|spain'), 'es'], [word('ý|italy'), 'it'],
  [word('đài loan|taiwan'), 'tw'], [word('áo|austria'), 'at'], [word('canada'), 'ca'], [word('philippines'), 'ph'],
  [word('đan mạch|denmark'), 'dk'],
];
export function countryFromText(s) {
  if (!s) return null;
  for (const [re, c] of ORIGIN_WORDS) if (re.test(s)) return c;
  return null;
}
