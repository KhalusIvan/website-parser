import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_CELL_LENGTH = 32_767; // Excel limit
const RU = ' (ru)';

/**
 * Fixed columns, in the order of the original vroda.jar export. For a site with a Russian version the
 * Russian column follows its Ukrainian one ("name", "name (ru)"); prices, article and stock are the same
 * in both languages. Each entry: [header, (product) => value].
 */
export function baseColumns(withRussian) {
  const ru = (header, get) => (withRussian ? [[`${header}${RU}`, (p) => (p.ru ? get(p.ru) : '')]] : []);
  return [
    ['link', (p) => p.link],
    ...ru('link', (r) => r.link),
    ['name', (p) => p.name],
    ...ru('name', (r) => r.name),
    ['category', (p) => p.category],
    ...ru('category', (r) => r.category),
    ['images', (p) => p.images],
    ['description', (p) => p.description],
    ...ru('description', (r) => r.description),
    ['price', (p) => p.price],
    ['price special', (p) => p.priceSpecial],
    ['sku', (p) => p.sku],
    ['parent', (p) => p.parent],
    ['available', (p) => (p.available ? '+' : '-')],
  ];
}
/** The columns of a Ukrainian-only site (kept for code that needs the plain list). */
export const BASE_COLUMNS = baseColumns(false);

const javaOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // like Java's String.compareTo (UTF-16 order)

/** All spec names used by any product, sorted like the jar did. */
export function specColumns(products) {
  const names = new Set();
  for (const p of products) for (const key of Object.keys(p.specs ?? {})) names.add(key);
  return [...names].sort(javaOrder);
}

/**
 * Spec columns: every attribute of the site (Ukrainian name), each followed by its Russian value
 * ("Колір", "Колір (ru)") when the site has a Russian version. Attributes only the Russian pages have
 * come at the end under their Russian name. vendor has no Russian column (it is a name).
 */
function specColumnList(products, withRussian) {
  const ua = specColumns(products);
  if (!withRussian) return ua.map((name) => [name, (p) => p.specs?.[name] ?? '']);
  const ruOnly = new Set();
  for (const p of products) for (const key of Object.keys(p.ru?.specs ?? {})) if (!ua.includes(key)) ruOnly.add(key);
  const cols = [];
  for (const name of ua) {
    cols.push([name, (p) => p.specs?.[name] ?? '']);
    if (name !== 'vendor' && products.some((p) => p.ru?.specs?.[name])) cols.push([`${name}${RU}`, (p) => p.ru?.specs?.[name] ?? '']);
  }
  for (const name of [...ruOnly].sort(javaOrder)) cols.push([`${name}${RU}`, (p) => p.ru?.specs?.[name] ?? '']);
  return cols;
}

function cell(value, product, column, log) {
  const s = value == null ? '' : String(value);
  if (s.length <= MAX_CELL_LENGTH) return s;
  log?.(`Cell too long for "${column}" (${s.length} chars) at ${product.link || product.ru?.link}, truncated`);
  return s.slice(0, MAX_CELL_LENGTH);
}

/**
 * Builds the workbook: sheet "Sheet0" with the products (every value as text) and, for a site with a
 * Russian version, sheet "Attributes" with the Russian name of every attribute column.
 * ruNames: Map(ukrainian attribute -> russian attribute), or null for a Ukrainian-only site.
 */
export function buildWorkbook(products, { log, ruNames = null } = {}) {
  const withRussian = Boolean(ruNames);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet0');
  const columns = [...baseColumns(withRussian), ...specColumnList(products, withRussian)];

  sheet.addRow(columns.map(([name]) => name));
  for (const p of products) sheet.addRow(columns.map(([name, get]) => cell(get(p), p, name, log)));

  if (withRussian) {
    const names = workbook.addWorksheet('Attributes');
    names.addRow(['attribute', 'attribute (ru)', 'products', 'products (ru)']);
    const count = (key, ru) => products.filter((p) => (ru ? p.ru?.specs?.[key] : p.specs?.[key])).length;
    for (const [name] of specColumnList(products, true)) {
      if (name.endsWith(RU) || name === 'vendor') continue;
      names.addRow([name, ruNames.get(name) ?? '', count(name, false), count(name, true)]);
    }
    for (const [name] of specColumnList(products, true)) {
      const base = name.slice(0, -RU.length);
      if (name.endsWith(RU) && !products.some((p) => p.specs?.[base])) names.addRow(['', ruNames.get(base) ?? base, 0, count(base, true)]);
    }
  }
  return workbook;
}

export async function writeXlsx(filePath, products, options) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await buildWorkbook(products, options).xlsx.writeFile(filePath);
  return filePath;
}
