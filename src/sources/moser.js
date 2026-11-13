// moser-animal.com - Moser Animal store: grooming clippers, trimmers, blades (OpenCart, "luxshop" theme).
// Ukrainian only: the site has no Russian version (/ru/ is 404, ?language=ru-ru shows Ukrainian).
// Shared luxshop code: ./lib/luxshop.js. Notes about this site:
//  - The shop sells several brands (Moser, Wahl, ...): vendor = the manufacturer shown on the page.
import { createLuxshopSource } from './lib/luxshop.js';

export default createLuxshopSource({
  id: 'moser',
  name: 'Moser Animal',
  website: 'https://moser-animal.com',
  description: 'Moser Animal store: grooming clippers and trimmers, blades, dryers, tools and cosmetics for pets.',
  languages: { ua: 'Українська' },
  vendor: 'Moser',
});
