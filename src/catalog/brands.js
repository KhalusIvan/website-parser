// Brand names as the shops write them -> one name per brand.
// Keys are lower-case letters/digits only (Cyrillic look-alike letters turned into Latin).

const CANONICAL = {
  babylisspro: 'BaByliss PRO',
  babyliss: 'BaByliss PRO',
  wahl: 'Wahl',
  moser: 'Moser',
  gama: 'GA.MA',
  gamaprofessional: 'GA.MA',
  jaguar: 'Jaguar',
  jrl: 'JRL',
  spl: 'SPL',
  mrd: 'MRD PRO',
  mrdpro: 'MRD PRO',
  immortal: 'Immortal',
  immortalinfuse: 'Immortal',
  immortalnyc: 'Immortal',
  gloriana: 'Gloriana',
  glorianaprofessional: 'Gloriana',
  exalto: 'Exalto',
  exaltoprofessional: 'Exalto',
  disicide: 'Disicide',
  xanitalia: 'Xanitalia',
  ermila: 'Ermila',
  vatana: 'Vatana',
  coifin: 'Coifin',
  medicalpro: 'Medical PRO',
  stylance: 'Stylance',
  remington: 'Remington',
  tondeo: 'Tondeo',
  madeshow: 'MadeShow',
  biolong: 'Biolong',
  gstar: 'G-Star',
  philips: 'Philips',
  topchoice: 'Top Choice',
  simei: 'Simei',
  tcc: 'Jaguar', // Jaguar TCC hot scissors
  jsda: 'JSDA',
};

/** Product lines of a brand that are exported as "Лінія" instead of a separate brand. */
export const BRAND_LINES = { immortalinfuse: 'Immortal Infuse', immortalnyc: 'Immortal NYC' };

const LOOKALIKE = { а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', і: 'i', к: 'k', м: 'm', о: 'o', р: 'p', т: 't', х: 'x' };

export function brandKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[авсенікмортх]/g, (c) => LOOKALIKE[c])
    .replace(/[^a-z0-9]/g, '');
}

/** "Babyliss Pro" / "BaByliss PRO" / "BaBylіssPRO" -> "BaByliss PRO"; unknown names are kept (trimmed). */
export function canonicalBrand(name) {
  const key = brandKey(name);
  if (!key) return '';
  return CANONICAL[key] ?? String(name).trim();
}

/** Brands found in product names, for products whose shop shows no brand or a wrong one. */
const NAME_BRANDS = [
  [/babyliss/i, 'BaByliss PRO'],
  [/\bwahl\b/i, 'Wahl'],
  [/\bmoser\b/i, 'Moser'],
  [/\bga\.?\s?ma\b/i, 'GA.MA'],
  [/\bjaguar\b/i, 'Jaguar'],
  [/\bjrl\b/i, 'JRL'],
  [/\bspl\b/i, 'SPL'],
  [/\bmrd\b/i, 'MRD PRO'],
  [/\bimmortal\b/i, 'Immortal'],
  [/\bgloriana\b/i, 'Gloriana'],
  [/\bermila\b/i, 'Ermila'],
  [/\bexalto\b/i, 'Exalto'],
  [/\b(disicide|trimmercide)\b/i, 'Disicide'],
  [/\bcoif\*?in\b/i, 'Coifin'],
  [/\btondeo\b/i, 'Tondeo'],
  [/\ball1clean\b/i, 'All1Clean'],
  [/\bstylance\b/i, 'Stylance'],
  [/\bvatana\b/i, 'Vatana'],
  [/\bremington\b/i, 'Remington'],
  [/\bxanitalia\b/i, 'Xanitalia'],
];

/** The brand named first in a product name ('' if none). */
export function brandFromName(name) {
  let best = '';
  let at = Infinity;
  for (const [re, brand] of NAME_BRANDS) {
    const m = re.exec(String(name ?? ''));
    if (m && m.index < at) {
      at = m.index;
      best = brand;
    }
  }
  return best;
}

/**
 * Brands of one company share articles (Moser is Wahl's European brand; Exalto, Stylance, Vatana and
 * Medical PRO are sold by SPL with SPL articles): the matching key uses the family, not the brand.
 */
const FAMILY = { Wahl: 'wahl', Moser: 'wahl', SPL: 'spl', Exalto: 'spl', Stylance: 'spl', Vatana: 'spl', 'Medical PRO': 'spl' };
export function brandFamily(brand) {
  return FAMILY[brand] ?? brandKey(brand);
}
