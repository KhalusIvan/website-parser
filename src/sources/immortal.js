// immortal.com.ua - official Immortal store (OpenCart, "upstore" theme). Ukrainian only (/ru/ is 404).
// Shared upstore code: ./lib/upstore.js. Notes about this site:
//  - The catalogue menu is the horizontal one (#additional-menu); its top links are relative.
//  - Category pages are ?page=2, ?page=3, ... (not /page-2).
//  - Links end with "/"; a product's link is /product-keyword/ (the site's canonical link has the
//    "Новинки" or another category path in it).
//  - "Новинки" (new) is the last menu category, so its products get their real category first.
//  - Site bug: the beard menu's "Креми", "Сироватки", "Шампуні" links open the women's line categories
//    with the same names (shared URL keywords), so beard creams/serums/shampoos get the category
//    "Догляд за бородою/Засоби для догляду за бородою" (the parent that lists them).
//  - vendor = the manufacturer shown on the page (Immortal, Immortal Infuse, Immortal NYC);
//    some products show none, then it is Immortal (the shop's brand).
import { createUpstoreSource } from './lib/upstore.js';

export default createUpstoreSource({
  id: 'immortal',
  name: 'Immortal',
  website: 'https://immortal.com.ua',
  description: 'Official Immortal store: beard, hair and face care, perfumes and barber accessories.',
  languages: { ua: 'Українська' },
  menu: '#additional-menu .nav-dopmenu > li',
  trailingSlash: true,
  pageQuery: true, // category pages are /category/?page=2 (/category/page-2 is 404)
  followSubcategories: true,
  readManufacturer: true,
  vendor: 'Immortal',
});
