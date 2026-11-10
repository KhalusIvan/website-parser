// Offline tests for the mrd-pro.com.ua source (no network): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import mrd, { langUrl, money, productLink } from '../src/sources/mrd.js';

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
  'https://mrd-pro.com.ua/': 'mrd-home.html',
  'https://mrd-pro.com.ua/mashynky-dlia-stryzky': 'mrd-category.html',
  'https://mrd-pro.com.ua/mashynky-dlia-stryzky/page-2': 'mrd-category-page2.html',
  'https://mrd-pro.com.ua/mashynky-dlia-stryzky/page-3': 'mrd-empty.html',
  'https://mrd-pro.com.ua/zapchastini/nozhi-dlya-mashinok': 'mrd-subcategory.html',
  'https://mrd-pro.com.ua/zapchastini/nozhi-dlya-mashinok/page-2': 'mrd-empty.html',
  'https://mrd-pro.com.ua/zapchastini': 'mrd-parent-category.html',
  'https://mrd-pro.com.ua/zapchastini/page-2': 'mrd-empty.html',
  'https://mrd-pro.com.ua/akciyi-ta-znizhki': 'mrd-sale.html',
  'https://mrd-pro.com.ua/akciyi-ta-znizhki/page-2': 'mrd-empty.html',
  'https://mrd-pro.com.ua/news': 'mrd-empty.html',
};

test('collectLinks (whole site): menu categories, subcategories first, pages, one link per product', async () => {
  const http = fakeHttp(SITE);
  const links = await mrd.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));

  assert.deepEqual([...links.entries()], [
    ['https://mrd-pro.com.ua/mashynka-cyborg', { category: 'Машинки для стрижки' }],
    ['https://mrd-pro.com.ua/nabir-x-pro', { category: 'Машинки для стрижки' }], // also on sale: real category kept
    ['https://mrd-pro.com.ua/mashynka-vector', { category: 'Машинки для стрижки' }], // page 2
    ['https://mrd-pro.com.ua/nizh-bl5', { category: 'Комплектуючі/Ножі для машинок' }], // subcategory before parent
    ['https://mrd-pro.com.ua/knopka-hc-90', { category: 'Комплектуючі' }], // only in the parent category
  ]);
});

test('collectLinks (one category, Russian): /ru/ links even for a Ukrainian category link', async () => {
  const http = fakeHttp({
    'https://mrd-pro.com.ua/ru/mashynky-dlia-stryzky': 'mrd-category.html',
    'https://mrd-pro.com.ua/ru/mashynky-dlia-stryzky/page-2': 'mrd-empty.html',
  });
  const links = await mrd.collectLinks({ lang: 'ru', mode: 'category', url: 'https://mrd-pro.com.ua/mashynky-dlia-stryzky' }, ctx(http));
  assert.deepEqual([...links.keys()], ['https://mrd-pro.com.ua/ru/mashynka-cyborg', 'https://mrd-pro.com.ua/ru/nabir-x-pro']);
});

test('parseProduct reads all fields in the vroda column format', async () => {
  const http = fakeHttp({ 'https://mrd-pro.com.ua/nabir-x-pro': 'mrd-product.html' });
  const p = await mrd.parseProduct('https://mrd-pro.com.ua/nabir-x-pro', { category: 'Набори для стрижки' }, ctx(http));

  assert.equal(p.name, 'Набір MRD PRO X-PRO чорний 999C-X-B-3'); // catalogue name, not the SEO heading
  assert.equal(p.category, 'Набори для стрижки');
  assert.equal(
    p.images,
    'https://mrd-pro.com.ua/image/cache/catalog/combo/x-pro-1300x1300.jpg;https://mrd-pro.com.ua/image/cache/catalog/combo/x-pro_2-1300x1300.jpg',
  );
  assert.equal(p.description, '<p><b>X-PRO</b> – набір для барберів.</p>'); // theme heading removed
  assert.equal(p.price, '27999.00'); // regular price (crossed out); related products' prices ignored
  assert.equal(p.priceSpecial, '23297.00');
  assert.equal(p.sku, '999C-X-B-3');
  assert.equal(p.available, true);
  assert.deepEqual(p.specs, {
    'Час роботи (хвилин)': '240',
    'Швидкість двигуна (об/хв)': '13000',
    Гарантія: '1 рік',
    vendor: 'MRD PRO',
  });
});

test('pre-order product is "-" and has only a price', async () => {
  const http = fakeHttp({ 'https://mrd-pro.com.ua/p': 'mrd-product-preorder.html' });
  const p = await mrd.parseProduct('https://mrd-pro.com.ua/p', { category: 'C' }, ctx(http));
  assert.equal(p.available, false); // "Передзамовлення"; the sticky bar's "В наявності" is not the product's
  assert.equal(p.price, '8999.00');
  assert.equal(p.priceSpecial, '');
});

test('helpers: money, langUrl, productLink', () => {
  assert.equal(money('27 999 грн.'), '27999.00');
  assert.equal(money(''), '');

  assert.equal(langUrl('https://mrd-pro.com.ua/zapchastini/motori', 'ru'), 'https://mrd-pro.com.ua/ru/zapchastini/motori');
  assert.equal(langUrl('https://mrd-pro.com.ua/ru/zapchastini/motori/', 'ua'), 'https://mrd-pro.com.ua/zapchastini/motori');
  assert.equal(langUrl('https://mrd-pro.com.ua/ru/akciyi-ta-znizhki', 'ru'), 'https://mrd-pro.com.ua/ru/akciyi-ta-znizhki');

  assert.equal(productLink('https://mrd-pro.com.ua/zapchastini/nozhi-dlya-mashinok/nizh-bl5', 'ua'), 'https://mrd-pro.com.ua/nizh-bl5');
  assert.equal(productLink('https://mrd-pro.com.ua/ru/akciyi-ta-znizhki/nabir-x-pro', 'ru'), 'https://mrd-pro.com.ua/ru/nabir-x-pro');
});
