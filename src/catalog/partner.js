// The partner's product list ("Номенклатура": code, name, price) is the source of truth for product
// codes: the catalog only has products the partner sells, and their SKU is the partner's code.
// The list is grouped: rows without a code are headers (a brand like "MOSER", "JAGUAR TCC", or a
// group like "Гребні (Hair Combs)"). Read from .xlsx or .csv (save an .xls as .xlsx in Excel first).
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { brandFamily, brandFromName } from './brands.js';
import { skuKey } from './offers.js';

/** Brand headers the product-name rules don't know (the partner's own spelling). */
const HEADER_BRANDS = [
  [/^vatana/i, 'Vatana'],
  [/^medical pro/i, 'Medical PRO'],
  [/^top choice/i, 'Top Choice'],
  [/^olton/i, 'Olton'],
  [/^barbicide/i, 'Barbicide'],
];

function headerBrand(text) {
  for (const [re, brand] of HEADER_BRANDS) if (re.test(text.trim())) return brand;
  // a brand header is short ("MOSER ZOO", "JAGUAR TCC", "Exalto - манекени"); a group mentioning a
  // brand ("Футляри для перукарських інструментів SPL") belongs to the brand above it anyway
  return text.trim().split(/\s+/).length <= 4 ? brandFromName(text.replace(/-/g, ' ')) : '';
}

/** Rows [code, name, ...] -> partner items [{ code, name, brand, group, row }]. */
export function partnerItems(rows) {
  const items = [];
  let brand = '';
  let group = '';
  rows.forEach((row, i) => {
    const code = String(row[0] ?? '').trim();
    const name = String(row[1] ?? '').replace(/\s+/g, ' ').trim();
    if (!code && name) {
      const b = headerBrand(name);
      if (b) brand = b;
      group = name;
      return;
    }
    if (code) items.push({ code, name, brand, group, row: i + 1 });
  });
  return items;
}

/**
 * The list the shop keeps in the repository (data/partner.json, written by the shop when a new
 * partner price file is sent to its bot): { items: [[code, name, group], ...] }. The groups become
 * header rows again, as in the partner's Excel file.
 */
export function partnerJsonRows(json) {
  const rows = [];
  let group = null;
  for (const [code, name, grp = ''] of json.items ?? []) {
    if (grp !== group) {
      if (grp) rows.push(['', grp]);
      group = grp;
    }
    rows.push([code, name]);
  }
  return rows;
}

/**
 * Reads the partner list: data/partner.json from the shop, .xlsx (sheet "Номенклатура", else the
 * first sheet) or .csv (comma or semicolon separated).
 */
export async function readPartnerFile(file) {
  if (/\.json$/i.test(file)) {
    return partnerItems(partnerJsonRows(JSON.parse(readFileSync(file, 'utf8'))));
  }
  if (/\.csv$/i.test(file)) {
    const text = readFileSync(file, 'utf8');
    const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    const rows = text.split(/\r?\n/).map((line) => line.split(sep).map((c) => c.replace(/^"|"$/g, '')));
    return partnerItems(rows);
  }
  if (!/\.xlsx$/i.test(file)) throw new Error(`Partner list must be .xlsx or .csv (open the .xls in Excel and save it as .xlsx): ${file}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const rows = [];
  const sheet = wb.worksheets.find((w) => w.name.trim().toLowerCase() === 'номенклатура') ?? wb.worksheets[0];
  sheet.eachRow({ includeEmpty: true }, (row) => rows.push([row.getCell(1).text, row.getCell(2).text, row.getCell(3).text]));
  return partnerItems(rows);
}

/** Article as written, only without spaces and case: "JRL-2020C- W" -> "JRL-2020C-W". */
const rawCode = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, '');

/** Head start of a shop's main page for an article over a duplicate page with the same article. */
const MAIN_BONUS = 0.25;
/** The official brand store's product over a reseller's product for the same code. */
const OFFICIAL_BONUS = 0.15;
/** The product's name contains the partner code itself ("… SENSI NIGHT GH3318"). */
const CODE_IN_NAME_BONUS = 0.4;
/** A code found only in the name (the shop's article is wrong) needs names that clearly agree. */
const NAME_CODE_MIN_SIMILARITY = 0.5;

const words = (s) => new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
/** How alike two names are, 0..1 (shared words; extra words in either name lower it). */
export function nameSimilarity(a, b) {
  const x = words(a);
  const y = words(b);
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return (2 * common) / Math.max(1, x.size + y.size);
}

/**
 * Gives every product the partner item with its code: the same article within the brand family
 * ("J-82655" = "82655" for Jaguar), or exactly the same article under another brand (the partner and
 * the shops sometimes file a product under different brands). Each partner item goes to one product:
 * when a shop has two pages with the same article, its main page (grouped with the official store and
 * the other shops) gets it, unless the other page's name is much closer to the partner's name.
 * products: [{ key, offers: [{ sku, brand, official, ua: { name } }] }].
 * Returns { matched: Map(product key -> item), conflicts: [{ product, item }], unusedItems }.
 */
export function matchPartner(products, items) {
  const byFamily = new Map();
  const byRaw = new Map();
  const add = (map, k, it) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  };
  const byFamilyList = new Map(); // family -> items with a code long enough to look for in names
  for (const it of items) {
    if (skuKey(it.code)) add(byFamily, `${brandFamily(it.brand)}:${skuKey(it.code)}`, it);
    if (rawCode(it.code).length >= 3) add(byRaw, rawCode(it.code), it);
    if (skuKey(it.code).length >= 5) add(byFamilyList, brandFamily(it.brand), it);
  }
  const inName = (p, it) => p.offers.some((o) => skuKey(o.ua?.name ?? '').includes(skuKey(it.code)));

  // 1. candidate items of every product by its own article(s)
  const own = new Map(); // product key -> Set(items)
  const ownClaimed = new Set();
  for (const p of products) {
    const families = new Set(p.offers.map((o) => brandFamily(o.brand || '')));
    const skus = [...new Set(p.offers.map((o) => o.sku).filter(Boolean))];
    const candidates = new Set();
    for (const f of families) for (const sku of skus) for (const it of byFamily.get(`${f}:${skuKey(sku)}`) ?? []) candidates.add(it);
    for (const sku of skus) {
      const same = byRaw.get(rawCode(sku)) ?? [];
      if (new Set(same.map((it) => rawCode(it.code))).size === 1) same.forEach((it) => candidates.add(it));
    }
    own.set(p.key, candidates);
    candidates.forEach((it) => ownClaimed.add(it));
  }

  // 2. a code in the product's name, when the shop's article is wrong ("…ROSE GH3319" filed as
  //    GH3318) - only codes no product has as its own article: a set's name mentions the codes of
  //    the clipper and trimmer inside it, and must not take them.
  const claims = []; // { product, item, score }
  for (const p of products) {
    const candidates = own.get(p.key);
    const families = new Set(p.offers.map((o) => brandFamily(o.brand || '')));
    for (const f of families) {
      for (const it of byFamilyList.get(f) ?? []) {
        if (candidates.has(it) || ownClaimed.has(it) || !inName(p, it)) continue;
        if (Math.max(...p.offers.map((o) => nameSimilarity(o.ua?.name ?? '', it.name))) >= NAME_CODE_MIN_SIMILARITY) candidates.add(it);
      }
    }
    for (const it of candidates) {
      // A shop's second page with the same article (key "...~shop1", split off by groupOffers) is
      // usually a duplicate: the main product (with the official store and the other shops) gets a
      // head start, so a duplicate only wins when its name is much closer to the partner's (e.g. the
      // clipper "HC-90-4W" against the set "90-4W").
      const main = p.key.includes('~') ? 0 : MAIN_BONUS;
      const official = p.offers.some((o) => o.official) ? OFFICIAL_BONUS : 0;
      const codeInName = inName(p, it) ? CODE_IN_NAME_BONUS : 0;
      const score = Math.max(...p.offers.map((o) => nameSimilarity(o.ua?.name ?? '', it.name))) + main + official + codeInName + p.offers.length * 0.01;
      claims.push({ product: p, item: it, score });
    }
  }
  // best name match first: each item and each product once
  claims.sort((a, b) => b.score - a.score);
  const matched = new Map();
  const used = new Set();
  for (const c of claims) {
    if (matched.has(c.product.key) || used.has(c.item)) continue;
    matched.set(c.product.key, c.item);
    used.add(c.item);
  }
  const conflicts = [];
  const seen = new Set();
  for (const c of claims) {
    if (matched.has(c.product.key) || seen.has(c.product.key)) continue;
    seen.add(c.product.key);
    conflicts.push({ product: c.product, item: c.item });
  }
  return { matched, conflicts, unusedItems: items.filter((it) => !used.has(it)) };
}
