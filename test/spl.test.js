// Offline tests for the spl-group.com.ua source (no network): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import spl, { fitDescription, langUrl, money, originalImage, pageUrl, productLink } from '../src/sources/spl.js';

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
  'https://spl-group.com.ua/ua/': 'spl-home.html',
  'https://spl-group.com.ua/ua/novinki/?sort=p.model&order=ASC&limit=100': 'spl-novinki.html',
  'https://spl-group.com.ua/ua/litso/?sort=p.model&order=ASC&limit=100': 'spl-parent-category.html',
  'https://spl-group.com.ua/ua/litso/page-2?sort=p.model&order=ASC&limit=100': 'spl-parent-category-page2.html',
  'https://spl-group.com.ua/ua/litso/pintsety/?sort=p.model&order=ASC&limit=100': 'spl-subcategory.html',
  // the menu link redirects to aksesuary-ta-tekhnika (the page's canonical link)
  'https://spl-group.com.ua/ua/aksesuary-i-tekhnika/?sort=p.model&order=ASC&limit=100': 'spl-aksesuary.html',
  'https://spl-group.com.ua/ua/aksesuary-ta-tekhnika/?sort=p.model&order=ASC&limit=100': 'spl-aksesuary.html',
};

test('collectLinks (whole site): menu, subcategories first, pages, "new" last, one link per product', async () => {
  const http = fakeHttp(SITE);
  const links = await spl.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));

  assert.deepEqual([...links.entries()], [
    ['https://spl-group.com.ua/ua/litso/pintsety/pintset-spl-9321', { category: 'Догляд за обличчям/Пінцети' }], // subcategory first
    ['https://spl-group.com.ua/ua/litso/tochilka-kosmetichna', { category: 'Догляд за обличчям' }],
    ['https://spl-group.com.ua/ua/litso/gubka-spl-96388', { category: 'Догляд за обличчям' }], // page 2
    ['https://spl-group.com.ua/ua/aksesuary-ta-tekhnika/neocape-spl-barber-1', { category: 'Аксесуари та Техніка' }],
    ['https://spl-group.com.ua/ua/index.php?route=product/product&product_id=10070', { category: 'Аксесуари та Техніка' }],
    ['https://spl-group.com.ua/ua/volosy/novyj-grebinets', { category: 'Новинки' }], // "new" is visited last
  ]);
  assert.ok(http.calls.includes('https://spl-group.com.ua/ua/blog/?sort=p.model&order=ASC&limit=100')); // dead menu link skipped
  assert.equal(http.calls.filter((url) => url.includes('/pintsety/')).length, 1); // listed in parent and menu, visited once
  // the redirect drops the query, so page 1 is loaded again from the real (canonical) address
  assert.ok(http.calls.includes('https://spl-group.com.ua/ua/aksesuary-ta-tekhnika/?sort=p.model&order=ASC&limit=100'));
});

test('collectLinks (one category, Russian): /ru/ pages even for a Ukrainian category link', async () => {
  const http = fakeHttp({ 'https://spl-group.com.ua/ru/litso/pintsety/?sort=p.model&order=ASC&limit=100': 'spl-subcategory.html' });
  const links = await spl.collectLinks({ lang: 'ru', mode: 'category', url: 'https://spl-group.com.ua/ua/litso/pintsety/' }, ctx(http));
  assert.deepEqual([...links.keys()], ['https://spl-group.com.ua/ru/litso/pintsety/pintset-spl-9321']);
});

test('parseProduct reads all fields in the vroda column format', async () => {
  const link = 'https://spl-group.com.ua/ua/aksesuary-ta-tekhnika/uchebnye-manekeny/golova-maneken-exalto-julia';
  const http = fakeHttp({ [link]: 'spl-product.html' });
  const found = [];
  const p = await spl.parseProduct(link, { category: 'Аксесуари та Техніка/Навчальні манекени' }, {
    ...ctx(http),
    addProduct: (l, extra) => found.push([l, extra]),
  });
  // the other product of a scissors pair is reported, so it is scraped even if no category lists it
  assert.deepEqual(found, [['https://spl-group.com.ua/ua/volosy/90056-30', { category: 'Аксесуари та Техніка/Навчальні манекени' }]]);

  assert.equal(p.link, link);
  assert.equal(p.name, 'Голова-манекен Exalto Professional Julia 35 см, шатенка REF1031');
  assert.equal(p.category, 'Аксесуари та Техніка/Навчальні манекени');
  assert.equal(
    p.images,
    'https://spl-group.com.ua/image/catalog/tovars/ref1031.jpg;https://spl-group.com.ua/image/catalog/tovars/ref1031_2.jpg',
  );
  assert.equal(p.description, '<p>Голова-манекен для <b>навчання</b>.</p>');
  assert.equal(p.price, '2499.00'); // regular price (crossed out); related products' prices ignored
  assert.equal(p.priceSpecial, '1999.00');
  assert.equal(p.sku, 'REF1031');
  assert.equal(p.available, true);
  assert.deepEqual(p.specs, {
    'Тип волосся': 'Комбіноване',
    'Довжина волосся, см': '35',
    Колір: 'Шатенка;Каштановий',
    vendor: 'Exalto', // the product's manufacturer, not the shop
  });
});

test('sold-out product (Russian) is not available; no manufacturer -> SPL', async () => {
  const http = fakeHttp({ 'https://spl-group.com.ua/ru/p': 'spl-product-soldout.html' });
  const p = await spl.parseProduct('https://spl-group.com.ua/ru/p', { category: 'C' }, ctx(http));
  assert.equal(p.available, false); // "Нет в наличии"; schema says instock, related product says "В наличии"
  assert.equal(p.name, 'Пинцет скошенный');
  assert.equal(p.price, '79.00');
  assert.equal(p.priceSpecial, '');
  assert.equal(p.sku, '9158');
  assert.equal(p.images, 'https://spl-group.com.ua/image/catalog/9158_1.jpg');
  assert.deepEqual(p.specs, { vendor: 'SPL' });
});

test('helpers: money, langUrl, productLink, pageUrl, originalImage, fitDescription', () => {
  assert.equal(money('2 499 ₴'), '2499.00');
  assert.equal(money(''), '');

  assert.equal(langUrl('https://spl-group.com.ua/ua/litso/pintsety/', 'ru'), 'https://spl-group.com.ua/ru/litso/pintsety/');
  assert.equal(langUrl('https://spl-group.com.ua/ru/litso/', 'ua'), 'https://spl-group.com.ua/ua/litso/');
  assert.equal(langUrl('https://spl-group.com.ua/en/litso/', 'ru'), 'https://spl-group.com.ua/ru/litso/');
  assert.equal(langUrl('https://spl-group.com.ua/litso/', 'ua'), 'https://spl-group.com.ua/ua/litso/');

  assert.equal(productLink('https://spl-group.com.ua/ua/litso/pintsety/x?tracking=1#top', 'ua'), 'https://spl-group.com.ua/ua/litso/pintsety/x');
  assert.equal(
    productLink('https://spl-group.com.ua/ua/page-5?route=product/product&product_id=10070&limit=100', 'ua'),
    'https://spl-group.com.ua/ua/index.php?route=product/product&product_id=10070',
  );

  assert.equal(pageUrl('https://spl-group.com.ua/ua/litso', 1), 'https://spl-group.com.ua/ua/litso/?sort=p.model&order=ASC&limit=100');
  assert.equal(pageUrl('https://spl-group.com.ua/ua/litso/', 3), 'https://spl-group.com.ua/ua/litso/page-3?sort=p.model&order=ASC&limit=100');

  assert.equal(originalImage('https://spl-group.com.ua/image/cache/catalog/a/b_1-526x782.jpg'), 'https://spl-group.com.ua/image/catalog/a/b_1.jpg');
  assert.equal(originalImage('https://spl-group.com.ua/image/catalog/a.png'), 'https://spl-group.com.ua/image/catalog/a.png');

  const long = `<p style="color:red">${'x'.repeat(33000)}</p>`;
  assert.equal(fitDescription(long), `<p>${'x'.repeat(33000)}</p>`);
  assert.equal(fitDescription('<p style="a">short</p>'), '<p style="a">short</p>');
});
