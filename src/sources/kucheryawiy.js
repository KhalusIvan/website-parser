// kucheryawiy.com.ua - Kucheryawiy, a shop for hairdressers and barbers (OpenCart, "upstore" theme).
// Ukrainian and Russian. Shared upstore code: ./lib/upstore.js. Notes about this site:
//  - The catalogue menu is the horizontal one (#additional-menu), 3 levels deep (e.g. clippers ->
//    by brand); the deepest categories are visited first. Category tiles not in the menu are followed.
//  - Links end with "/"; a product's link is /product-keyword/. Russian keywords of products and of
//    some categories differ from the Ukrainian ones (/ru/nozhici/goryachie-nozhnicy/ vs
//    /nozhici/garyachi-nozhici/), so the Russian menu is read from /ru/ and a pasted category link is
//    turned into the language with the page's hreflang links.
//  - The grooming category is not in the menu, only in the home page's category wall; the wall's
//    categories are visited after the menu ones.
//  - The shop sells many brands: vendor = the manufacturer shown on the page (its logo's alt text);
//    empty when the page shows none.
//  - About 300 products are in no category (only in the sitemap) and are not exported.
import { createUpstoreSource } from './lib/upstore.js';
import { VRODA_UA_COLUMNS } from './vroda-columns.js';

export default createUpstoreSource({
  id: 'kucheryawiy',
  name: 'Kucheryawiy',
  website: 'https://kucheryawiy.com.ua',
  description: 'Shop for hairdressers and barbers: clippers, trimmers, dryers, scissors, tools, spare parts and salon equipment.',
  languages: { ua: 'Українська', ru: 'Русский' },
  // Same spec columns as the vroda file (Ukrainian), even if empty here; the shop's own specs are added.
  columns: { ua: VRODA_UA_COLUMNS },
  menu: '#additional-menu .nav-dopmenu > li',
  trailingSlash: true,
  translatedPaths: true,
  homeCategories: '.fon_catcat a', // "Інструменти та аксесуари для грумінгу" is only in the home page's category wall
  followSubcategories: true,
  readManufacturer: true,
  vendor: '',
});
