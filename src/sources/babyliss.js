// babyliss-pro.com.ua - BaByliss PRO store (WordPress + WooCommerce, "woodmart" theme). Ukrainian only.
// Same base columns as vroda; the shop's own characteristics as columns. Shared WooCommerce logic: ./lib/woocommerce.js. Notes about this site:
//  - Categories come from the catalogue menu (#menu-categories); "Аксесуари та деталі" has subcategories,
//    which are visited first. "НОВИНКИ" (new arrivals) is visited last, so products keep their real category.
//  - No Russian version, no public WooCommerce Store API (/wp-json is closed); all products are simple
//    (no variations).
//  - Stock label: "N в наявності" = available; "Доступно за замовленням" (backorder / pre-order) and
//    "Немає в наявності" = not available.
//  - Specs: the attributes table next to the gallery (woodmart hint texts are left out). vendor = the
//    "Виробник" attribute, else Babyliss Pro (the same spelling). Attributes whose
//    name was deleted in the shop show as "pa_<slug>" and are skipped.
import { createWooSource } from './lib/woocommerce.js';

export default createWooSource({
  id: 'babyliss',
  name: 'BaByliss PRO',
  website: 'https://babyliss-pro.com.ua',
  description: 'BaByliss PRO store: hair dryers, straighteners, curling irons, clippers, trimmers, shavers and accessories.',
  menu: '#menu-categories > li',
  lastCategories: /\/product-category\/novynky\/$/,
  brandSpec: 'Виробник',
  brand: 'Babyliss Pro', // same spelling as the "Виробник" attribute
});
