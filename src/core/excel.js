import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_CELL_LENGTH = 32_767; // Excel limit

/** Fixed columns, same order and header names as vroda.jar. Specs columns follow. */
export const BASE_COLUMNS = [
  ['link', (p) => p.link],
  ['name', (p) => p.name],
  ['category', (p) => p.category],
  ['images', (p) => p.images],
  ['description', (p) => p.description],
  ['price', (p) => p.price],
  ['price special', (p) => p.priceSpecial],
  ['sku', (p) => p.sku],
  ['parent', (p) => p.parent],
  ['available', (p) => (p.available ? '+' : '-')],
];

/**
 * All spec names used by any product plus `always` (columns a source exports even when empty),
 * sorted like Java's String.compareTo (UTF-16 order).
 */
export function specColumns(products, always = []) {
  const names = new Set(always);
  for (const p of products) for (const key of Object.keys(p.specs ?? {})) names.add(key);
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function cell(value, product, column, log) {
  const s = value == null ? '' : String(value);
  if (s.length <= MAX_CELL_LENGTH) return s;
  log?.(`Cell too long for "${column}" (${s.length} chars) at ${product.link}, truncated`);
  return s.slice(0, MAX_CELL_LENGTH);
}

/** Builds the workbook (one sheet "Sheet0", every value as text). */
export function buildWorkbook(products, { log, columns } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet0');
  const specs = specColumns(products, columns);

  sheet.addRow([...BASE_COLUMNS.map(([name]) => name), ...specs]);
  for (const p of products) {
    sheet.addRow([
      ...BASE_COLUMNS.map(([name, get]) => cell(get(p), p, name, log)),
      ...specs.map((name) => cell(p.specs?.[name] ?? '', p, name, log)),
    ]);
  }
  return workbook;
}

export async function writeXlsx(filePath, products, options) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await buildWorkbook(products, options).xlsx.writeFile(filePath);
  return filePath;
}
