// Offline tests for the jaguar-solingen.in.ua source and the shared luxshop code (no network): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import jaguar from '../src/sources/jaguar.js';
import { fitDescription, money } from '../src/sources/lib/luxshop.js';

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
const ctx = (http, found = []) => ({ http, log: () => {}, addProduct: (link, extra) => found.push([link, extra]) });

const J = 'https://jaguar-solingen.in.ua';
const SITE = {
  [`${J}/`]: 'jaguar-home.html',
  [`${J}/all/scissors/goldline/diamond/`]: 'jaguar-diamond.html',
  [`${J}/all/scissors/goldline/gold-line-scissors/`]: 'jaguar-goldline-straight.html',
  [`${J}/all/scissors/goldline/gold-line-scissors/page-2`]: 'jaguar-goldline-straight-page2.html',
  [`${J}/all/scissors/goldline/`]: 'jaguar-goldline.html', // its page-2 link is a 404
  [`${J}/all/scissors/leftseries/`]: 'jaguar-empty.html',
  [`${J}/all/scissors/`]: 'jaguar-empty.html',
  [`${J}/all/accessories/`]: 'jaguar-accessories.html',
  [`${J}/all/bags/`]: 'jaguar-bags.html', // top level in the menu, but "Ножиці/..." in its breadcrumb
  // /all/old-page/ (in the menu) is a 404
};

test('collectLinks (whole site): deepest categories first (by breadcrumb), "Всі ..." after the model series, all pages', async () => {
  const http = fakeHttp(SITE);
  const links = await jaguar.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));

  const goldline = 'Ножиці/Серія Gold Line';
  assert.deepEqual([...links.entries()], [
    [`${J}/all/scissors/goldline/21160`, { category: `${goldline}/Ножиці Diamond серії Gold Line` }],
    [`${J}/all/scissors/goldline/21150`, { category: `${goldline}/Ножиці Diamond серії Gold Line` }], // no ?query / #hash
    [`${J}/all/scissors/goldline/24575`, { category: `${goldline}/Всі прямі ножиці Gold Line Jaguar` }],
    [`${J}/all/scissors/goldline/21555`, { category: `${goldline}/Всі прямі ножиці Gold Line Jaguar` }], // page 2
    [`${J}/all/scissors/goldline/21600`, { category: goldline }], // parent after its subcategories
    [`${J}/all/bags/j-9910`, { category: 'Ножиці/Cумки та чохли' }], // deeper than "Перукарські аксесуари"
    [`${J}/all/accessories/penyuar-tcc`, { category: 'Перукарські аксесуари' }], // "Всі товари Jaguar" left out
  ]);
  // blog-article cards are not products; the page after the last one (404) and the dead menu link are skipped
  assert.ok(http.calls.includes(`${J}/all/scissors/goldline/page-2`));
  assert.ok(!http.calls.includes(`${J}/all/scissors/goldline/gold-line-scissors/page-3`)); // no link to it
});

test('collectLinks (one category, Russian): a Ukrainian page-2 link becomes the /ru/ category', async () => {
  const http = fakeHttp({
    [`${J}/ru/all/scissors/goldline/diamond/`]: 'jaguar-diamond.html',
  });
  const links = await jaguar.collectLinks(
    { lang: 'ru', mode: 'category', url: `${J}/all/scissors/goldline/diamond/page-2?sort=p.price` },
    ctx(http),
  );
  assert.deepEqual([...links.keys()], [`${J}/ru/all/scissors/goldline/21160`, `${J}/ru/all/scissors/goldline/21150`]);
});

test('parseProduct reads all fields in the vroda column format', async () => {
  const http = fakeHttp({ [`${J}/all/scissors/goldline/21160`]: 'jaguar-product.html' });
  const found = [];
  const p = await jaguar.parseProduct(`${J}/all/scissors/goldline/21160`, { category: 'Ножиці/Серія Gold Line' }, ctx(http, found));

  assert.equal(p.link, `${J}/all/scissors/goldline/21160`);
  assert.equal(p.name, 'Ножиці перукарські Jaguar Gold Line Diamond E, 6.0"'); // catalogue name, not the h1
  assert.equal(p.category, 'Ножиці/Серія Gold Line');
  assert.equal(
    p.images,
    `${J}/image/cache/catalog/j-21160-1-800x800.jpg;${J}/image/cache/catalog/j-21160%287%29-800x800.jpg`, // unique, no javascript:
  );
  // the video block a module appends (with its heading, <style> and <script>) is removed
  assert.equal(p.description, '<div><p><strong>Ножиці Jaguar Gold Line Diamond E</strong> для слайсингу.</p></div>\n<p>Gold Line – еталон якості.</p>');
  assert.equal(p.price, '12929.00'); // the related product's prices are ignored
  assert.equal(p.priceSpecial, '');
  assert.equal(p.sku, 'J-21160');
  assert.equal(p.available, true);
  assert.deepEqual(p.specs, {
    'Тип перукарських ножиць': 'Прямі', // from the specification tab only
    'Розмір перукарських ножиць (дюймів)': '6.0" = 15.5 cm',
    'Техніка стрижки': 'Слайсинг;Точковий зріз',
    vendor: 'Jaguar',
  });
  // other sizes / coatings are separate products, reported with this product's category
  assert.deepEqual(found, [
    [`${J}/all/scissors/goldline/21150`, { category: 'Ножиці/Серія Gold Line' }],
    [`${J}/all/scissors/goldline/21160-13`, { category: 'Ножиці/Серія Gold Line' }],
  ]);
});

test('Russian product: out of stock, linked products stay Russian, vendor falls back to Jaguar', async () => {
  const link = `${J}/ru/all/accessories/penyuar-tcc`;
  const http = fakeHttp({ [link]: 'jaguar-product-ru.html' });
  const found = [];
  const p = await jaguar.parseProduct(link, { category: 'Парикмахерские аксессуары' }, ctx(http, found));
  assert.equal(p.name, 'Пеньюар TCC');
  assert.equal(p.available, false); // "Нет в наличии"
  assert.equal(p.price, '1200.00');
  assert.equal(p.priceSpecial, '');
  assert.equal(p.images, '');
  assert.equal(p.specs.vendor, 'Jaguar');
  assert.deepEqual(found, [[`${J}/ru/all/accessories/penyuar-tcc-black`, { category: 'Парикмахерские аксессуары' }]]);
});

test('helpers: money, fitDescription', () => {
  assert.equal(money('12 929 грн.'), '12929.00');
  assert.equal(money('1 149грн'), '1149.00');
  assert.equal(money('12929.0000'), '12929.00');
  assert.equal(money(''), '');
  const long = `<p style="color: red">${'x'.repeat(33000)}</p>`;
  assert.equal(fitDescription(long), `<p>${'x'.repeat(33000)}</p>`);
  assert.equal(fitDescription('<p style="a">short</p>'), '<p style="a">short</p>');
});
