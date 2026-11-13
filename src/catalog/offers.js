// Reads the scraped Excel files and turns them into "offers": one product as one shop sells it,
// with its Ukrainian row and (if the shop has a Russian version) its Russian row.
// Offers of the same product from different shops are grouped by the normalised article (SKU).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { BRAND_LINES, brandFamily, brandFromName, brandKey, canonicalBrand } from './brands.js';

export const BASE_COLUMNS = ['link', 'name', 'category', 'images', 'description', 'price', 'price special', 'sku', 'parent', 'available'];

/** Shops: the official store of a brand gives the best texts; resellers come after it. */
export const SHOPS = {
  babyliss: { brands: ['BaByliss PRO'], official: true },
  gama: { brands: ['GA.MA'], official: true },
  gloriana: { brands: ['Gloriana'], official: true },
  immortal: { brands: ['Immortal'], official: true },
  jaguar: { brands: ['Jaguar', 'Tondeo'], official: true },
  jrl: { brands: ['JRL'], official: true },
  moser: { brands: ['Moser', 'Wahl'], official: true },
  mrd: { brands: ['MRD PRO'], official: true },
  spl: { brands: ['SPL', 'Exalto', 'Stylance', 'Vatana'], official: true },
  spl4barber: { brands: ['Wahl'], official: true },
  vroda: { brands: [], official: false },
  kucheryawiy: { brands: [], official: false },
};
/** Order of resellers after the official store (vroda's texts and photos are usually the more complete). */
const RESELLER_RANK = { vroda: 1, kucheryawiy: 2 };

const LOOKALIKE = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', І: 'I', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X' };

/** Article -> matching key: upper case, Latin letters, no punctuation, no brand prefix (J-, JRL-, SPL-, HC-). */
export function skuKey(sku) {
  const s = String(sku ?? '')
    .toUpperCase()
    .replace(/[АВСЕНІКМОРТХ]/g, (c) => LOOKALIKE[c])
    .replace(/[^A-Z0-9]/g, '');
  return s.replace(/^(JRL|SPL|HC|J)(?=\d)/, '').replace(/^JRL(?=[A-Z])/, '');
}

const money = (v) => (v ? Number(v) : 0);

async function readFile(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = wb.getWorksheet('Sheet0');
  const header = sheet.getRow(1).values.slice(1);
  const rows = [];
  sheet.eachRow((row, i) => {
    if (i === 1) return;
    const o = { specs: {} };
    header.forEach((col, j) => {
      const v = row.getCell(j + 1).text;
      if (!v) return;
      if (BASE_COLUMNS.includes(col)) o[col] = v;
      else if (col === 'vendor') o.vendor = v;
      else o.specs[col] = v;
    });
    rows.push(o);
  });
  return rows;
}

const RU = ' (ru)';

/**
 * Reads a file with both languages (<shop>.xlsx: "name", "name (ru)", ..., "Колір", "Колір (ru)").
 * Returns [{ ua, ru }] where ru uses the shop's Russian attribute names (sheet "Attributes"), like a
 * Russian-only file would.
 */
async function readCombinedFile(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = wb.getWorksheet('Sheet0');
  const header = sheet.getRow(1).values.slice(1);
  const ruName = new Map();
  wb.getWorksheet('Attributes')?.eachRow((row, i) => {
    if (i > 1 && row.getCell(1).text) ruName.set(row.getCell(1).text, row.getCell(2).text);
  });
  const rows = [];
  sheet.eachRow((row, i) => {
    if (i === 1) return;
    const ua = { specs: {} };
    const ru = { specs: {} };
    header.forEach((col, j) => {
      const v = row.getCell(j + 1).text;
      if (!v) return;
      const isRu = col.endsWith(RU);
      const name = isRu ? col.slice(0, -RU.length) : col;
      const target = isRu ? ru : ua;
      if (BASE_COLUMNS.includes(name)) target[name] = v;
      else if (name === 'vendor') ua.vendor = v;
      else if (isRu) ru.specs[ruName.get(name) || name] = v;
      else ua.specs[name] = v;
    });
    if (!ua.link) return; // Russian-only rows: no Ukrainian product to attach them to
    // shared fields (price, article, photos, stock) are the same on the Russian page
    const hasRu = Boolean(ru.link);
    for (const k of ['images', 'price', 'price special', 'sku', 'parent', 'available']) if (ua[k]) ru[k] = ua[k];
    if (ua.vendor) ru.vendor = ua.vendor;
    rows.push({ ua, ru: hasRu ? ru : null });
  });
  return rows;
}

const firstImage = (row) => (row.images ?? '').split(';')[0];
const slugOf = (link) => decodeURIComponent(new URL(link).pathname).split('/').filter(Boolean).pop() ?? '';

/**
 * Pairs the Russian rows of a shop with its Ukrainian rows: same first photo (photos don't depend on
 * the language), else the same article if it is unique in the shop, else the same last link part.
 */
function pairRu(uaRows, ruRows) {
  const byImage = new Map();
  const bySku = new Map();
  const bySlug = new Map();
  const skuCount = new Map();
  for (const r of ruRows) skuCount.set(skuKey(r.sku), (skuCount.get(skuKey(r.sku)) ?? 0) + 1);
  for (const r of ruRows) {
    if (firstImage(r)) byImage.set(firstImage(r), r);
    if (r.sku && skuCount.get(skuKey(r.sku)) === 1) bySku.set(skuKey(r.sku), r);
    bySlug.set(slugOf(r.link), r);
  }
  return (ua) =>
    (firstImage(ua) && byImage.get(firstImage(ua))) ||
    (ua.sku && bySku.get(skuKey(ua.sku))) ||
    bySlug.get(slugOf(ua.link)) ||
    null;
}

/** Same product listed twice by one shop (vroda lists a product once per category): same photo or name. */
function sameProduct(a, b) {
  return (firstImage(a) && firstImage(a) === firstImage(b)) || a.name === b.name;
}

/** Loads every <source>-UA.xlsx (+ <source>-RU.xlsx) in `dir` into offers. */
export async function loadOffers(dir, { log = console.log } = {}) {
  const all = readdirSync(dir);
  // <shop>.xlsx has both languages (current scrapers); older runs wrote <shop>-UA.xlsx + <shop>-RU.xlsx
  const combined = all.filter((f) => /^[a-z0-9]+\.xlsx$/.test(f)).map((f) => f.slice(0, -5));
  const legacy = all.filter((f) => /^[a-z0-9]+-UA\.xlsx$/.test(f)).map((f) => f.split('-')[0]);
  const offers = [];
  for (const source of [...new Set([...combined, ...legacy])].sort()) {
    if (!SHOPS[source]) {
      log(`Skipping ${source}: unknown shop (add it to SHOPS in src/catalog/offers.js)`);
      continue;
    }
    let entries;
    if (combined.includes(source)) {
      entries = await readCombinedFile(path.join(dir, `${source}.xlsx`));
    } else {
      const uaRows = await readFile(path.join(dir, `${source}-UA.xlsx`));
      const ruFile = `${source}-RU.xlsx`;
      const findRu = all.includes(ruFile) ? pairRu(uaRows, await readFile(path.join(dir, ruFile))) : () => null;
      entries = uaRows.map((ua) => ({ ua, ru: findRu(ua) }));
    }
    const file = combined.includes(source) ? `${source}.xlsx` : `${source}-UA.xlsx`;
    const uaRows = entries.map((e) => e.ua);
    const ruOf = new Map(entries.map((e) => [e.ua, e.ru]));
    const findRu = (ua) => ruOf.get(ua) ?? null;
    const hasRussian = entries.some((e) => e.ru);

    const seen = [];
    let paired = 0;
    for (const ua of uaRows) {
      // The same product listed twice by this shop (in another category): keep the first, note the category.
      const twin = seen.find((o) => o.ua.sku === ua.sku && sameProduct(o.ua, ua));
      if (twin) {
        twin.categories.push(ua.category);
        continue;
      }
      const ru = findRu(ua);
      if (ru) paired++;
      const vendor = ua.vendor ?? '';
      // Official stores know their brands; resellers sometimes show a wrong one (a GA.MA styler as
      // BaByliss), so for them the brand in the product name comes first.
      const own = SHOPS[source].official && SHOPS[source].brands.includes(canonicalBrand(vendor));
      const brand = own ? canonicalBrand(vendor) : brandFromName(ua.name) || canonicalBrand(vendor);
      const price = money(ua.price);
      const special = money(ua['price special']);
      const offer = {
        source,
        official: SHOPS[source].official && SHOPS[source].brands.includes(brand),
        rank: SHOPS[source].official && SHOPS[source].brands.includes(brand) ? 0 : RESELLER_RANK[source] ?? 3,
        // Same article within a brand family = same product (different brands can share numbers).
        key: `${brandFamily(brand) || '?'}:${skuKey(ua.sku) || `${source}/${slugOf(ua.link)}`}`,
        sku: ua.sku ?? '',
        brand,
        line: BRAND_LINES[brandKey(vendor)] ?? '',
        ua,
        ru,
        categories: [ua.category],
        price,
        special,
        // what a customer pays at this shop
        effectivePrice: special && special < price ? special : price,
        available: ua.available === '+',
      };
      seen.push(offer);
      offers.push(offer);
    }
    log(`${source} (${file}): ${uaRows.length} rows -> ${seen.length} products${hasRussian ? `, ${paired} with Russian` : ''}`);
  }
  return offers;
}

/** Word set of a name (for telling apart different products that a shop gave the same article). */
const words = (s) => new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
function similarity(a, b) {
  const x = words(a);
  const y = words(b);
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.max(1, Math.min(x.size, y.size));
}

/**
 * Groups offers into products by key. A shop sometimes gives two different products the same
 * article (e.g. three different curling irons with "4445-0050"): the one most similar to the other
 * shops' offers keeps the key, the others become products of their own.
 */
export function groupOffers(offers) {
  const groups = new Map();
  for (const o of offers) {
    if (!groups.has(o.key)) groups.set(o.key, []);
    groups.get(o.key).push(o);
  }
  const products = [];
  for (const [key, list] of groups) {
    const bySource = new Map();
    for (const o of list) {
      if (!bySource.has(o.source)) bySource.set(o.source, []);
      bySource.get(o.source).push(o);
    }
    const main = [];
    const extra = [];
    for (const [source, own] of bySource) {
      if (own.length === 1) {
        main.push(own[0]);
        continue;
      }
      const others = list.filter((o) => o.source !== source);
      const score = (o) => (others.length ? Math.max(...others.map((x) => similarity(o.ua.name, x.ua.name))) : 0);
      const sorted = [...own].sort((a, b) => score(b) - score(a));
      main.push(sorted[0]);
      extra.push(...sorted.slice(1));
    }
    products.push({ key, offers: main });
    extra.forEach((o, i) => products.push({ key: `${key}~${o.source}${i + 1}`, offers: [o] }));
  }
  return products;
}
