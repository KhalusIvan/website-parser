// mrd-pro.com.ua - official MRD PRO store (OpenCart, "upstore" theme). Ukrainian and Russian.
// Shared upstore code: ./lib/upstore.js. Notes about this site:
//  - Categories come from the catalogue menu (#menu-vertical-list); subcategories of "Комплектуючі"
//    are visited before the category itself, so products get the most specific category.
//    "Акції та знижки" (sale) is a menu category too; its products are all in a real category first.
//  - The Russian menu links some categories to the Ukrainian pages (a site bug), so Russian category
//    links are built from the Ukrainian ones: /ru/ + the same path.
//  - "Передзамовлення" (pre-order) counts as not available ("-"), like "Немає в наявності".
//  - vendor is always MRD PRO (the only brand of the shop).
import { createUpstoreSource, money, upstoreUrls } from './lib/upstore.js';

const SITE = { website: 'https://mrd-pro.com.ua', trailingSlash: false };

export { money };
export const { langUrl, productLink } = upstoreUrls(SITE);

export default createUpstoreSource({
  ...SITE,
  id: 'mrd',
  name: 'MRD PRO',
  description: 'Official MRD PRO store: clippers, trimmers, shavers, sets and spare parts.',
  languages: { ua: 'Українська', ru: 'Русский' },
  menu: '#menu-vertical-list > li',
  vendor: 'MRD PRO',
});
