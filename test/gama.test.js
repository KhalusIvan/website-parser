// Offline tests for the gamaofficial.com.ua source (no network): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import gama, { langUrl, money, productKey } from '../src/sources/gama.js';

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
  'https://gamaofficial.com.ua/': 'gama-home.html',
  'https://gamaofficial.com.ua/utyuzhki/': 'gama-category.html',
  'https://gamaofficial.com.ua/utyuzhki/?page=2': 'gama-category-page2.html',
  'https://gamaofficial.com.ua/utyuzhki/?page=3': 'gama-empty.html',
  'https://gamaofficial.com.ua/index.php?route=product/category&path=68': 'gama-other.html',
  'https://gamaofficial.com.ua/uhod-za-telom/': 'gama-hidden.html',
  'https://gamaofficial.com.ua/uhod-za-telom/?page=2': 'gama-empty.html',
  'https://gamaofficial.com.ua/sales/': 'gama-sales.html',
  'https://gamaofficial.com.ua/gofre-gama/': 'gama-gofre.html',
  'https://gamaofficial.com.ua/gofre-gama/?page=2': 'gama-empty.html',
};

test('collectLinks (whole site): menu + sidebar categories, pages, sale-style last, one link per product', async () => {
  const http = fakeHttp(SITE);
  const links = await gama.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));

  assert.deepEqual([...links.entries()], [
    ['https://gamaofficial.com.ua/index.php?route=product/product&path=59&product_id=422', { category: 'Випрямлячі' }],
    ['https://gamaofficial.com.ua/utyuzhki/vypryamitel-gama-cp1', { category: 'Випрямлячі' }],
    ['https://gamaofficial.com.ua/utyuzhki/vypryamitel-gofre-microfrise', { category: 'Випрямлячі' }], // page 2
    // only in the sidebar, not in the top menu
    ['https://gamaofficial.com.ua/uhod-za-telom/frezer-gama-5v1-gsp0801', { category: 'Догляд за тілом' }],
    // "Гофре" products are in "Випрямлячі" too (other link form) - not repeated
  ]);
  // Relative menu links resolve against <base>, not the page (no /utyuzhki/inshe); the dead "inshe" is skipped.
  assert.ok(http.calls.includes('https://gamaofficial.com.ua/inshe/'));
  assert.ok(!http.calls.some((url) => /utyuzhki\/(utyuzhki|inshe)/.test(url)));
  // sale-style pages last
  assert.deepEqual(http.calls.slice(-3), [
    'https://gamaofficial.com.ua/sales/',
    'https://gamaofficial.com.ua/gofre-gama/',
    'https://gamaofficial.com.ua/gofre-gama/?page=2',
  ]);
});

test('collectLinks (one category, Russian): /ru/ category even for a Ukrainian link with a page number', async () => {
  const http = fakeHttp({
    'https://gamaofficial.com.ua/ru/uhod-za-telom/': 'gama-hidden.html',
    'https://gamaofficial.com.ua/ru/uhod-za-telom/?page=2': 'gama-empty.html',
  });
  const links = await gama.collectLinks(
    { lang: 'ru', mode: 'category', url: 'https://gamaofficial.com.ua/uhod-za-telom?page=3' },
    ctx(http),
  );
  assert.deepEqual([...links.keys()], ['https://gamaofficial.com.ua/uhod-za-telom/frezer-gama-5v1-gsp0801']);
  assert.deepEqual(http.calls, ['https://gamaofficial.com.ua/ru/uhod-za-telom/', 'https://gamaofficial.com.ua/ru/uhod-za-telom/?page=2']);
});

test('parseProduct reads all fields in the vroda column format', async () => {
  const link = 'https://gamaofficial.com.ua/index.php?route=product/product&path=59&product_id=422';
  const http = fakeHttp({ [link]: 'gama-product.html' });
  const p = await gama.parseProduct(link, { category: 'Випрямлячі' }, ctx(http));

  assert.equal(p.link, link);
  assert.equal(p.name, 'Випрямляч для волосся 2 в 1 GAMA IQ Smart Styler Rose&Gold PI0504'); // not the SEO h1
  assert.equal(p.category, 'Випрямлячі');
  assert.equal(
    p.images,
    'https://gamaofficial.com.ua/image/cache/catalog/prasochka/pi0504/pi0504%283%29-1000x1340.jpg;' +
      'https://gamaofficial.com.ua/image/cache/catalog/prasochka/pi0501/pi0501%282%29-1000x1340.jpg',
  );
  assert.equal(p.description, '<p>Шукаєте ідеальний <strong>утюжок для волосся</strong>?</p>\n<ul><li>Титанові пластини</li></ul>');
  assert.equal(p.price, '6000.00'); // regular price (crossed out); related products ignored
  assert.equal(p.priceSpecial, '4999.00');
  assert.equal(p.sku, 'PI0504');
  assert.equal(p.available, true);
  assert.deepEqual(p.specs, {
    'Лінія продукції': 'iQ',
    'Покриття пластин': 'Титанове;Nano Silver',
    vendor: 'Gama',
  });
});

test('sold-out product: the visible label counts (schema.org says InStock), no discount', async () => {
  const link = 'https://gamaofficial.com.ua/utyuzhki/vypryamitel-gama-tourmaline-midi-smart';
  const http = fakeHttp({ [link]: 'gama-product-soldout.html' });
  const p = await gama.parseProduct(link, { category: 'Випрямлячі' }, ctx(http));
  assert.equal(p.available, false); // "Нет в наличии" (the shop's label is Russian on the Ukrainian page)
  assert.equal(p.price, '550.00');
  assert.equal(p.priceSpecial, '');
  assert.equal(p.sku, 'P21.MIDI');
  assert.equal(p.images, '');
  assert.deepEqual(p.specs, { vendor: 'Gama' });
});

test('Russian page: "Доступность: На складе" is in stock', async () => {
  const html = fixture('gama-product-soldout.html')
    .replace('Наявність:', 'Доступность:')
    .replace(/Нет в наличии/g, 'На складе')
    .replace('Модель:', 'Код товара:');
  const http = { getHtml: async (url) => cheerio.load(html, { baseURI: url }) };
  const p = await gama.parseProduct('https://gamaofficial.com.ua/ru/x', {}, ctx(http));
  assert.equal(p.available, true);
  assert.equal(p.sku, 'P21.MIDI');
});

test('helpers: money, langUrl, productKey', () => {
  assert.equal(money('4 999 грн'), '4999.00');
  assert.equal(money(''), '');

  assert.equal(langUrl('https://gamaofficial.com.ua/utyuzhki', 'ru'), 'https://gamaofficial.com.ua/ru/utyuzhki/');
  assert.equal(langUrl('https://gamaofficial.com.ua/ru/utyuzhki/?page=2', 'ua'), 'https://gamaofficial.com.ua/utyuzhki/');
  assert.equal(langUrl('https://gamaofficial.com.ua/', 'ru'), 'https://gamaofficial.com.ua/ru/');
  assert.equal(
    langUrl('https://gamaofficial.com.ua/index.php?route=product/category&path=68', 'ru'),
    'https://gamaofficial.com.ua/ru/index.php?route=product/category&path=68',
  );

  assert.equal(productKey('https://gamaofficial.com.ua/ru/index.php?route=product/product&path=59&product_id=422'), 'id422');
  assert.equal(productKey('https://gamaofficial.com.ua/gofre-gama/vypryamitel-gofre-microfrise'), 'vypryamitel-gofre-microfrise');
});
