// jaguar-solingen.in.ua - official Jaguar Solingen distributor (OpenCart, "luxshop" theme). Ukrainian and Russian.
// Shared luxshop code: ./lib/luxshop.js. Notes about this site:
//  - Every category is under "Всі товари Jaguar" (/all/, the menu covers all its products); that
//    crumb is left out of `category`. "Гарячі ножиці" and "Cумки та чохли" are top-level menu entries
//    but subcategories of "Ножиці" (breadcrumb); the deepest category wins, so they keep it.
//  - Gold/Silver/White Line have "Всі прямі ..." / "Всі філірувальні ..." subcategories next to the
//    model series ("Ножиці Diamond серії Gold Line"); the series are visited first (more specific).
//  - Sizes, the matching thinning scissors and the Titan coating of a model are separate products,
//    linked from its page ("Розмір ножиць", "Пара ножиць", "Покриття ножиць", "Діаметр"); they are
//    followed (today all of them are also in a category). Category cards show no stock status.
//  - The Russian pages show the stock label in Ukrainian ("Немає в наявності"); its CSS class is used.
import { createLuxshopSource } from './lib/luxshop.js';

export default createLuxshopSource({
  id: 'jaguar',
  name: 'Jaguar Solingen',
  website: 'https://jaguar-solingen.in.ua',
  description: 'Official Jaguar Solingen store: hairdressing scissors, clippers, hair dryers, brushes and accessories.',
  languages: { ua: 'Українська', ru: 'Русский' },
  vendor: 'Jaguar',
  skipCrumbPaths: ['all/'],
  lateCategory: /^Всі\s/i,
});
