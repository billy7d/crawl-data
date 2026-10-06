import bing from './bing.js';
import ddg from './duckduckgo.js';
import bingshop from './bingshop.js';
import tiki from './tiki.js';
import lazada from './lazada.js';
import off from './openfoodfacts.js';
import siteshop from './siteshop.js';
import { concung, kidsplaza, proxied, monoprix } from './stores.js';
import { auchan, chronodrive, carrefour, leclerc } from './fr-shops.js';
import { moreShops } from './more-shops.js';
import { apiShops } from './api-shops.js';
import { amazon, target, sainsburys, tesco, waitrose, morrisons, woolworths, dm, fairprice } from './global-shops.js';
import { google, googleShopping } from './serper.js';
import { searxng, brave } from './metasearch.js';

export const SOURCES = [
  // Vietnam
  tiki, lazada, concung, kidsplaza,
  // Foreign retailers (direct)
  amazon, target, tesco, sainsburys, waitrose, morrisons, woolworths, dm, fairprice, monoprix, auchan, chronodrive, carrefour, leclerc, ...moreShops, ...apiShops, bingshop,
  // Retailers that block bots: via search-engine index, or via the optional scraping proxy
  siteshop, ...proxied,
  // Search engines & product database
  googleShopping, google, searxng, brave, bing, ddg, off,
];
export const byId = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

export const supports = (src, market) => src.markets === '*' || src.markets.includes(market);
export const enabled = (src) => !src.needsKey || !!process.env[src.needsKey];

// Public description for the UI.
export const describe = () => SOURCES.map((s) => ({
  id: s.id,
  name: s.name,
  kind: s.kind,
  group: s.group,
  markets: s.markets,
  global: !!s.global,
  enabled: enabled(s),
  needsKey: s.needsKey || null,
}));
