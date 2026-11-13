// Builds one catalog from all scraped shops: every product once, with the cheapest supplier's price,
// the best texts, photos and characteristics, in one category tree.
import { alignAttributes, valueTranslator } from '../core/align.js';
import { RUSSIAN_NAMES, canonicalAttribute, cleanValue } from './attributes.js';
import { cleanDescription, plainText, textLength } from './html.js';
import { groupOffers, loadOffers } from './offers.js';
import { CATEGORIES, categoryPath, classify } from './taxonomy.js';
import { slugify } from './slug.js';

/** How good a shop's photos are (from sampling: size of the originals, padding, upscaling). */
const PHOTO_QUALITY = {
  jrl: 1, spl: 1, immortal: 1, gloriana: 1, vroda: 0.95, jaguar: 0.95, mrd: 0.9, babyliss: 0.9,
  spl4barber: 0.9, moser: 0.85, gama: 0.85, kucheryawiy: 0.7,
};
const MAX_PHOTOS = 10;

const byContent = (a, b) => a.rank - b.rank || textLength(b.ua.description) - textLength(a.ua.description);
const hasCyrillic = (s) => /\p{Script=Cyrillic}/u.test(s);

/** A price below half of every other shop's price is taken for an error (or another pack size). */
const OUTLIER = 0.5;

/**
 * The offer whose price the customer gets: the cheapest one in stock (else the cheapest one), skipping
 * prices that look wrong. Returns { offer, note }.
 */
export function priceOffer(offers) {
  const priced = offers.filter((o) => o.effectivePrice > 0);
  const inStock = priced.filter((o) => o.available);
  const pool = [...(inStock.length ? inStock : priced)].sort((a, b) => a.effectivePrice - b.effectivePrice || a.rank - b.rank);
  const skipped = [];
  for (const o of pool) {
    // compared with the cheapest other shop: two shops agreeing on a low price is not an error
    const cheapestOther = Math.min(...priced.filter((x) => x !== o).map((x) => x.effectivePrice));
    if (Number.isFinite(cheapestOther) && o.effectivePrice < cheapestOther * OUTLIER && o !== pool.at(-1)) {
      skipped.push(`${o.source} ${o.effectivePrice}`);
      continue;
    }
    return { offer: o, note: skipped.length ? `skipped (less than half of other shops): ${skipped.join(', ')}` : '' };
  }
  return { offer: pool[0] ?? null, note: '' };
}

/** The description: the official store's, unless another shop's is much more complete. */
function descriptionOffer(offers) {
  const withText = offers.filter((o) => textLength(cleanDescription(o.ua.description)) > 0);
  if (!withText.length) return null;
  const longest = Math.max(...withText.map((o) => textLength(cleanDescription(o.ua.description))));
  return withText.sort(byContent).find((o) => textLength(cleanDescription(o.ua.description)) >= longest * 0.4);
}

/** The photo set: most photos, weighted by the shop's photo quality. */
function photoOffer(offers) {
  const score = (o) => Math.min((o.ua.images ?? '').split(';').filter(Boolean).length, MAX_PHOTOS) * (PHOTO_QUALITY[o.source] ?? 0.8);
  return [...offers].filter((o) => o.ua.images).sort((a, b) => score(b) - score(a) || a.rank - b.rank)[0] ?? null;
}

/** The brand: the official store's, else the one most shops show. */
function productBrand(offers) {
  const official = offers.find((o) => o.official && o.brand);
  if (official) return official.brand;
  const votes = new Map();
  for (const o of offers) if (o.brand) votes.set(o.brand, (votes.get(o.brand) ?? 0) + 1);
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/**
 * Characteristics merged from all shops (official store first), one value per attribute:
 * [{ ua, ru, valueUa, valueRu, source }].
 */
function mergeSpecs(offers, aligned, ruNames, translate, extra) {
  const specs = new Map();
  for (const o of offers) {
    const ruMap = aligned.get(o.source);
    for (const [name, value] of Object.entries(o.ua.specs)) {
      const ua = canonicalAttribute(name);
      if (!ua || specs.has(ua) || !cleanValue(value)) continue;
      const ruName = ruMap?.get(name);
      const ruValue = ruName && o.ru?.specs[ruName];
      specs.set(ua, {
        ua,
        ru: ruNames.get(ua) ?? '',
        valueUa: cleanValue(value),
        // no Russian page: numbers and Latin texts are the same, Ukrainian words are translated
        valueRu: ruValue ? cleanValue(ruValue) : hasCyrillic(value) ? cleanValue(translate(value)) : cleanValue(value),
        source: o.source,
      });
    }
  }
  for (const [ua, value] of Object.entries(extra)) {
    if (value && !specs.has(ua)) specs.set(ua, { ua, ru: ruNames.get(ua) ?? '', valueUa: value, valueRu: translate(value) || value, source: '' });
  }
  return [...specs.values()];
}

/** Russian attribute names: fixed ones for merged names, else the name the shops use (most products). */
function russianAttributeNames(offers, aligned) {
  const votes = new Map();
  for (const o of offers) {
    const map = aligned.get(o.source);
    if (!map || !o.ru) continue;
    for (const name of Object.keys(o.ua.specs)) {
      const ua = canonicalAttribute(name);
      const ru = map.get(name);
      if (!ua || !ru) continue;
      if (!votes.has(ua)) votes.set(ua, new Map());
      const clean = ru.replace(/\s+Удалити$/i, '').trim();
      votes.get(ua).set(clean, (votes.get(ua).get(clean) ?? 0) + 1);
    }
  }
  const names = new Map(Object.entries(RUSSIAN_NAMES));
  for (const [ua, v] of votes) if (!names.has(ua)) names.set(ua, [...v].sort((a, b) => b[1] - a[1])[0][0]);
  return names;
}

const metaDescription = (html, max = 160) => {
  const text = plainText(html);
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};

/**
 * OpenCart keeps resized copies in image/cache/ ("x-1300x1300.jpg"); the original upload is usually
 * bigger or at least not upscaled. Returns the URLs to try, best first.
 */
export function photoCandidates(url) {
  const m = url.match(/^(https?:\/\/[^/]+)\/(?:[a-z]{2}\/)?image\/cache\/(?:webp\/)?(catalog\/.+?)(?:-\d+x\d+)+(?:-\d+)?\.(\w+)$/i);
  if (!m) return [url];
  const base = `${m[1]}/image/${m[2]}`;
  const exts = [...new Set([m[3], m[3] === 'webp' ? 'jpg' : null, m[3] === 'webp' ? 'png' : null, 'jpg', 'png', 'jpeg'].filter(Boolean))];
  return [...exts.map((e) => `${base}.${e}`), url];
}

export async function buildCatalog({ dir = 'output', log = console.log } = {}) {
  const offers = await loadOffers(dir, { log });
  const aligned = alignAttributes(offers);
  const ruNames = russianAttributeNames(offers, aligned);
  const translate = valueTranslator(offers, aligned);
  const groups = groupOffers(offers);
  log(`${offers.length} offers from ${new Set(offers.map((o) => o.source)).size} shops -> ${groups.length} products`);

  const products = [];
  const unclassified = [];
  for (const group of groups) {
    const list = [...group.offers].sort(byContent);
    const main = list[0];
    const { offer: price, note: priceNote } = priceOffer(list);
    const text = descriptionOffer(list) ?? main;
    const photos = photoOffer(list);
    const categoryId = list.map((o) => classify(o.source, o.ua.category, o.ua.name)).find(Boolean) ?? null;
    if (!categoryId) unclassified.push(main);

    const ruText = text.ru ? text : list.find((o) => o.ru && textLength(o.ru.description)) ?? list.find((o) => o.ru);
    const descriptionUa = cleanDescription(text.ua.description);
    const descriptionRu = ruText ? cleanDescription(ruText.ru.description) : '';
    const nameRu = main.ru?.name ?? list.find((o) => o.ru)?.ru.name ?? '';
    const brand = productBrand(list);
    const line = list.find((o) => o.line)?.line ?? '';

    products.push({
      key: group.key,
      sku: main.sku || list.find((o) => o.sku)?.sku || '',
      brand,
      categoryId: categoryId ?? 'tools-other',
      nameUa: main.ua.name.replace(/\s+/g, ' ').trim(),
      nameRu: nameRu.replace(/\s+/g, ' ').trim(),
      descriptionUa,
      descriptionRu,
      metaDescriptionUa: metaDescription(descriptionUa),
      metaDescriptionRu: metaDescription(descriptionRu),
      price: price ? price.price || price.effectivePrice : 0,
      special: price && price.special && price.special < price.price ? price.special : 0,
      available: list.some((o) => o.available && o.effectivePrice > 0),
      priceSource: price?.source ?? '',
      priceNote,
      priceLink: price?.ua.link ?? '',
      contentSource: main.source,
      descriptionSource: descriptionUa ? text.source : '',
      photoSource: photos?.source ?? '',
      photoUrls: photos ? [...new Set(photos.ua.images.split(';').filter(Boolean))].slice(0, MAX_PHOTOS) : [],
      specs: mergeSpecs(list, aligned, ruNames, translate, { 'Серія': line }),
      offers: list.map((o) => ({
        source: o.source,
        link: o.ua.link,
        linkRu: o.ru?.link ?? '',
        sku: o.sku,
        price: o.price,
        special: o.special && o.special < o.price ? o.special : 0,
        available: o.available,
      })),
    });
  }
  if (unclassified.length) log(`${unclassified.length} products without a category rule -> "tools-other": ${unclassified.slice(0, 5).map((o) => o.ua.name).join(' | ')}`);

  // ids, SEO keywords (unique per language), sorted by category tree order then name
  const order = new Map(CATEGORIES.map((c) => [c.id, c.sort]));
  products.sort((a, b) => order.get(a.categoryId) - order.get(b.categoryId) || a.brand.localeCompare(b.brand) || a.nameUa.localeCompare(b.nameUa, 'uk'));
  const used = { ua: new Set(), ru: new Set() };
  const unique = (lang, base) => {
    let slug = base || 'product';
    for (let i = 2; used[lang].has(slug); i++) slug = `${base}-${i}`;
    used[lang].add(slug);
    return slug;
  };
  products.forEach((p, i) => {
    p.id = i + 1;
    p.seoUa = unique('ua', slugify(p.nameUa, 'uk'));
    p.seoRu = unique('ru', slugify(p.nameRu || p.nameUa, 'ru'));
  });
  return { products, categories: CATEGORIES.map((c) => ({ ...c, pathUa: categoryPath(c.id, 'ua'), pathRu: categoryPath(c.id, 'ru') })) };
}
