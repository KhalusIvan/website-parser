// Offline tests for the jrl.in.ua source (no network): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';
import ExcelJS from 'exceljs';
import jrl, { fitDescription, money, normalizeLink } from '../src/sources/jrl.js';
import { scrape } from '../src/scrape.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** Fake HTTP client: maps URLs to fixture files; anything else is a 404. */
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

const SITE = {
  'https://jrl.in.ua/': 'jrl-home.html',
  'https://jrl.in.ua/mashinki': 'jrl-category.html',
  'https://jrl.in.ua/mashinki?page=2': 'jrl-category-page2.html',
  'https://jrl.in.ua/mashinki?page=3': 'jrl-empty.html',
  'https://jrl.in.ua/komplektuyuchi': 'jrl-parent-category.html',
  'https://jrl.in.ua/komplektuyuchi?page=2': 'jrl-empty.html',
  'https://jrl.in.ua/komplektuyuchi/mashinki-1/': 'jrl-subcategory.html',
  'https://jrl.in.ua/komplektuyuchi/mashinki-1/?page=2': 'jrl-empty.html',
  // https://jrl.in.ua/jrlsale is a dead menu link (404) -> skipped
};

test('collectLinks (whole site): menu categories, pages, subcategories, each product once', async () => {
  const http = fakeHttp(SITE);
  const links = await jrl.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));

  assert.deepEqual([...links.entries()], [
    ['https://jrl.in.ua/mashinki/jrl-onyx', { category: 'Машинки', listPrice: '7199.0000', listSpecial: '' }],
    // "path" removed; listed again in a subcategory with another path -> still one product, first category kept
    ['https://jrl.in.ua/index.php?route=product/product&product_id=476', { category: 'Машинки', listPrice: '12999.0000', listSpecial: '11549.0000' }],
    ['https://jrl.in.ua/mashinki/jrl-art-limited', { category: 'Машинки', listPrice: '5999.0000', listSpecial: '' }],
    ['https://jrl.in.ua/komplektuyuchi/mashinki-1/nizh-jrl', { category: 'Комплектуючі/Машинки', listPrice: '899.0000', listSpecial: '' }],
  ]);
  // the duplicated subcategory link is visited once
  assert.equal(http.calls.filter((u) => u === 'https://jrl.in.ua/komplektuyuchi/mashinki-1/').length, 1);
});

test('collectLinks (one category) fails clearly on a wrong link', async () => {
  const http = fakeHttp(SITE);
  await assert.rejects(jrl.collectLinks({ lang: 'ua', mode: 'category', url: 'https://jrl.in.ua/nope' }, ctx(http)), /404/);
});

test('parseProduct reads all fields in the vroda column format', async () => {
  const http = fakeHttp({ 'https://jrl.in.ua/p': 'jrl-product.html' });
  const p = await jrl.parseProduct('https://jrl.in.ua/p', { category: 'Машинки', listPrice: '7199.0000', listSpecial: '' }, ctx(http));

  assert.equal(p.name, 'Професійна машинка для стрижки JRL ONYX');
  assert.equal(p.category, 'Машинки');
  assert.equal(
    p.images,
    'https://jrl.in.ua/image/cache/catalog/onyx/2020c-b01-700x700.jpg;https://jrl.in.ua/image/cache/catalog/onyx/2020c-b02-700x700.jpg',
  );
  assert.equal(p.description, '<p style="margin-bottom: 10px;"><b>JRL Onyx</b> – професійна машинка.</p>\n<ul><li>Вага: 290 г</li></ul>');
  assert.equal(p.price, '7199.00');
  assert.equal(p.priceSpecial, '');
  assert.equal(p.sku, 'JRL-2020C-B');
  assert.equal(p.available, true);
  assert.deepEqual(p.specs, { Гарантія: '12 місяців', vendor: 'JRL' }); // "атрибут 1" placeholder skipped
});

test('sold-out product is "-" even though its hidden schema data says InStock', async () => {
  const http = fakeHttp({ 'https://jrl.in.ua/p': 'jrl-product-soldout.html' });
  const p = await jrl.parseProduct('https://jrl.in.ua/p', { category: 'Машинки' }, ctx(http));
  assert.equal(p.available, false);
  assert.deepEqual(p.specs, { vendor: 'JRL' }); // no brand link on the page -> JRL
});

test('discount from the category card: price = regular, price special = discounted', async () => {
  const http = fakeHttp({ 'https://jrl.in.ua/p': 'jrl-product.html' });
  const p = await jrl.parseProduct('https://jrl.in.ua/p', { category: 'C', listPrice: '12999.0000', listSpecial: '11549.0000' }, ctx(http));
  assert.equal(p.price, '12999.00');
  assert.equal(p.priceSpecial, '11549.00');
});

test('helpers: money, normalizeLink, fitDescription', () => {
  assert.equal(money('7 199 грн.'), '7199.00');
  assert.equal(money('15599.0000'), '15599.00');
  assert.equal(money('12 999,50 грн'), '12999.50');
  assert.equal(money(''), '');

  assert.equal(normalizeLink('https://jrl.in.ua/index.php?route=product/product&path=4_14_23&product_id=326'), 'https://jrl.in.ua/index.php?route=product/product&product_id=326');
  assert.equal(normalizeLink('https://jrl.in.ua/index.php?path=1&route=product/product&product_id=1'), 'https://jrl.in.ua/index.php?route=product/product&product_id=1');
  assert.equal(normalizeLink('https://jrl.in.ua/mashinki/jrl-onyx'), 'https://jrl.in.ua/mashinki/jrl-onyx');

  const short = '<p style="color: red">Text</p>';
  assert.equal(fitDescription(short), short); // fits in an Excel cell -> unchanged
  const word = `<p class="MsoNormal" style="${'background-image: initial; '.repeat(1500)}">Text<o:p></o:p></p>`;
  assert.equal(fitDescription(word), '<p class="MsoNormal">Text</p>'); // too long -> styles removed, text kept
});

test('colour variants linked from product pages are scraped too, right after their product', async () => {
  const http = fakeHttp({
    'https://jrl.in.ua/grebeni': 'jrl-grebeni.html', // lists combs A and C
    'https://jrl.in.ua/grebeni?page=2': 'jrl-empty.html',
    'https://jrl.in.ua/grebeni/a': 'jrl-comb-a.html', // colours: B (new), A (itself), C (already listed)
    'https://jrl.in.ua/grebeni/b': 'jrl-comb-b.html', // colours: A, D (new)
    'https://jrl.in.ua/grebeni/c': 'jrl-product.html',
    'https://jrl.in.ua/grebeni/d': 'jrl-comb-d.html',
  });
  const outDir = mkdtempSync(path.join(tmpdir(), 'wp-'));
  const summary = await scrape({ source: 'jrl', lang: 'ua', mode: 'category', url: 'https://jrl.in.ua/grebeni', outDir, http, log: () => {} });
  assert.equal(summary.products, 4);
  assert.equal(summary.failed, 0);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(outDir, summary.file));
  const rows = [];
  wb.getWorksheet('Sheet0').eachRow((r, i) => i > 1 && rows.push([r.getCell(1).text, r.getCell(2).text, r.getCell(3).text, r.getCell(10).text]));
  assert.deepEqual(rows, [
    ['https://jrl.in.ua/grebeni/a', 'Гребінець A', 'Гребінці для волосся', '+'],
    ['https://jrl.in.ua/grebeni/b', 'Гребінець B', 'Гребінці для волосся', '+'], // found on A, inherits its category
    ['https://jrl.in.ua/grebeni/d', 'Гребінець D', 'Гребінці для волосся', '-'], // found on B
    ['https://jrl.in.ua/grebeni/c', 'Професійна машинка для стрижки JRL ONYX', 'Гребінці для волосся', '+'],
  ]);
  // every page fetched once
  const pages = http.calls.filter((u) => /grebeni\/[a-d]$/.test(u));
  assert.equal(pages.length, new Set(pages).size);
});
