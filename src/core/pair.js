// Pairs a shop's Russian products with its Ukrainian ones (the same product on the Russian page).
// Photos don't depend on the language, so the first photo is the surest sign; then the article if it
// is unique in the shop; then the last part of the link (most shops use the same keyword in /ru/).

const firstImage = (p) => String(p.images ?? '').split(';')[0];
const LOOKALIKE = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', І: 'I', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X' };
const skuKey = (sku) =>
  String(sku ?? '')
    .toUpperCase()
    .replace(/[АВСЕНІКМОРТХ]/g, (c) => LOOKALIKE[c])
    .replace(/[^A-Z0-9]/g, '');
export const slugOf = (link) => {
  try {
    return decodeURIComponent(new URL(link).pathname).split('/').filter(Boolean).pop() ?? '';
  } catch {
    return '';
  }
};

/**
 * Returns a function: Ukrainian product -> its Russian product (or null). Each Russian product is
 * used once. `ua`/`ru` products need link, images and sku.
 */
export function russianPairer(ruProducts) {
  const used = new Set();
  const index = (key) => {
    const m = new Map();
    for (const p of ruProducts) {
      const k = key(p);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return m;
  };
  const byImage = index(firstImage);
  const bySku = index((p) => skuKey(p.sku));
  const bySlug = index((p) => slugOf(p.link));
  const take = (list, unique = false) => {
    if (!list || (unique && list.length > 1)) return null;
    const p = list.find((x) => !used.has(x));
    if (p) used.add(p);
    return p ?? null;
  };
  const find = (ua) =>
    take(byImage.get(firstImage(ua))) || take(bySku.get(skuKey(ua.sku)), true) || take(bySlug.get(slugOf(ua.link))) || null;
  find.unpaired = () => ruProducts.filter((p) => !used.has(p));
  return find;
}
