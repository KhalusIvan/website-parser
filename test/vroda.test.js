// Offline tests (no network): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';
import ExcelJS from 'exceljs';
import vroda from '../src/sources/vroda.js';
import { movePrices, createProduct } from '../src/core/product.js';
import { writeXlsx } from '../src/core/excel.js';
import { scrape } from '../src/scrape.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** Fake HTTP client: maps URLs to fixture files. */
function fakeHttp(routes) {
  const calls = [];
  const getText = async (url) => {
    calls.push(url);
    const file = routes[url];
    if (!file) throw Object.assign(new Error(`HTTP 404 for ${url}`), { status: 404 });
    return fixture(file);
  };
  return { calls, getText, getHtml: async (url) => cheerio.load(await getText(url), { baseURI: url }) };
}

const ctx = (http) => ({ http, log: () => {} });

test('parseProduct reads all fields like the jar', async () => {
  const http = fakeHttp({ 'https://vroda-ua.com/p': 'vroda-product.html' });
  const p = await vroda.parseProduct('https://vroda-ua.com/p', 'Root/Category', ctx(http));

  assert.equal(p.link, 'https://vroda-ua.com/p');
  assert.equal(p.name, 'Машинка для стрижки Moser 1400');
  assert.equal(p.category, 'Root/Category');
  assert.equal(p.images, 'https://vroda-ua.com/a-860.jpg;https://vroda-ua.com/b-860.jpg');
  assert.equal(p.description, '<p><b>Moser 1400</b> - класика.</p>\n<p>Друга частина.</p>');
  // meta price 2368 + old price 3299 -> regular price 3299, special (discounted) 2368
  assert.equal(p.price, '3299.00');
  assert.equal(p.priceSpecial, '2368.00');
  assert.equal(p.sku, '1400-0050');
  assert.equal(p.available, true);
  assert.deepEqual(p.specs, { 'Тип живлення': 'Мережа', Колір: 'Чорний;Білий', vendor: 'Moser' });
});

test('collectLinks (category mode) switches language, follows subcategories and pages', async () => {
  const http = fakeHttp({
    'https://vroda-ua.com/start': 'vroda-category.html',
    'https://vroda-ua.com/ru/kategoriya': 'vroda-parent-category.html',
    'https://vroda-ua.com/kategoriya': 'vroda-category.html',
    'https://vroda-ua.com/kategoriya?page=1': 'vroda-category.html',
    'https://vroda-ua.com/kategoriya?page=2': 'vroda-empty.html',
  });
  const links = await vroda.collectLinks({ lang: 'ru', mode: 'category', url: 'https://vroda-ua.com/start' }, ctx(http));

  assert.deepEqual([...links.entries()], [
    ['https://vroda-ua.com/kategoriya/product-1', 'Корінь/Категорія'],
    ['https://vroda-ua.com/kategoriya/product-2', 'Корінь/Категорія'],
  ]);
  // duplicate subcategory link is visited once
  assert.equal(http.calls.filter((u) => u === 'https://vroda-ua.com/kategoriya').length, 1);
});

test('movePrices matches Product.movePrices() from the jar', () => {
  const run = (price, priceSpecial) => {
    const p = movePrices(createProduct({ price, priceSpecial }));
    return [p.price, p.priceSpecial];
  };
  assert.deepEqual(run('2368.00', '3299.00'), ['3299.00', '2368.00']); // swap
  assert.deepEqual(run('3299.00', '2368.00'), ['3299.00', '2368.00']); // already right
  assert.deepEqual(run('', '100'), ['100', '']); // only special
  assert.deepEqual(run('100', ''), ['100', '']);
  assert.deepEqual(run('abc', '5'), ['5', 'abc']); // unparsable price counts as 1
});

test('Excel file has the jar column layout', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wp-'));
  const file = path.join(dir, 'x.xlsx');
  await writeXlsx(file, [
    createProduct({ link: 'L1', name: 'A', available: true, specs: { vendor: 'V', Колір: 'red', Alpha: '1' } }),
    createProduct({ link: 'L2', name: 'B', specs: { Об: '2' } }),
  ]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Sheet0');
  const row = (n) => ws.getRow(n).values.slice(1);
  assert.deepEqual(row(1), ['link', 'name', 'category', 'images', 'description', 'price', 'price special', 'sku', 'parent', 'available', 'Alpha', 'vendor', 'Колір', 'Об']);
  assert.deepEqual(row(2), ['L1', 'A', '', '', '', '', '', '', '', '+', '1', 'V', 'red', '']);
  assert.equal(row(3)[9], '-');
});

test('scrape() runs both languages, skips failing products and writes one file + summary', async () => {
  const http = fakeHttp({
    'https://vroda-ua.com/kategoriya': 'vroda-category.html',
    'https://vroda-ua.com/kategoriya?page=1': 'vroda-category.html',
    'https://vroda-ua.com/kategoriya?page=2': 'vroda-empty.html',
    'https://vroda-ua.com/ru/kategoriya': 'vroda-category.html',
    'https://vroda-ua.com/ru/kategoriya?page=1': 'vroda-category.html',
    'https://vroda-ua.com/ru/kategoriya?page=2': 'vroda-empty.html',
    'https://vroda-ua.com/kategoriya/product-1': 'vroda-product.html',
    // product-2 -> 404 (in both languages)
  });
  const outDir = mkdtempSync(path.join(tmpdir(), 'wp-'));
  const summary = await scrape({ source: 'vroda', mode: 'category', url: 'https://vroda-ua.com/kategoriya', outDir, http, log: () => {} });
  assert.deepEqual(summary.languages, ['ua', 'ru']);
  assert.equal(summary.products, 1);
  assert.equal(summary.withRussian, 1);
  assert.equal(summary.failed, 2);
  assert.equal(summary.file, 'vroda-kategoriya.xlsx');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(outDir, summary.file));
  const header = wb.getWorksheet('Sheet0').getRow(1).values.slice(1);
  assert.deepEqual(header.slice(0, 14), [
    'link', 'link (ru)', 'name', 'name (ru)', 'category', 'category (ru)', 'images', 'description', 'description (ru)',
    'price', 'price special', 'sku', 'parent', 'available',
  ]);
  assert.ok(wb.getWorksheet('Attributes')); // Russian names of the attribute columns
});

test('old price of a related product (random carousel) is ignored', async () => {
  // Same product without its own discount; only the related-products carousel has an old price.
  const html = fixture('vroda-product.html').replace(/<span class="price-old"><span class="autocalc-product-price">.*?<\/span><\/span>/, '');
  const http = { getHtml: async (url) => cheerio.load(html, { baseURI: url }) };
  const p = await vroda.parseProduct('https://vroda-ua.com/p', 'C', ctx(http));
  assert.equal(p.price, '2368.00');
  assert.equal(p.priceSpecial, '');
});
