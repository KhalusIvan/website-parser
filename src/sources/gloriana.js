// glorianapro.com - official Gloriana Pro store (OpenCart, "upstore" theme). Ukrainian and Russian
// (the English version is ignored). Shared upstore code: ./lib/upstore.js. Notes about this site:
//  - The catalogue menu is the horizontal one (#additional-menu); it also links info pages
//    (about, delivery, ...) that have no products. "Аксесуари" subcategories are visited first.
//  - Russian pages are /ru/ + the same path as the Ukrainian ones.
//  - Links end with "/"; a product's link is /product-keyword/ (it redirects to the site's
//    canonical link, which has the category path in it).
//  - vendor = the manufacturer shown on the page (Gloriana).
import { createUpstoreSource } from './lib/upstore.js';

export default createUpstoreSource({
  id: 'gloriana',
  name: 'Gloriana Pro',
  website: 'https://glorianapro.com',
  description: 'Official Gloriana Pro store: hair dryers, straighteners, curling irons, stylers and accessories.',
  languages: { ua: 'Українська', ru: 'Русский' },
  menu: '#additional-menu .nav-dopmenu > li',
  trailingSlash: true,
  followSubcategories: true,
  readManufacturer: true,
  vendor: 'Gloriana',
});
