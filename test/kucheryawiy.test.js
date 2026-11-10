// Offline tests for the kucheryawiy.com.ua source (no network): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import kucheryawiy from '../src/sources/kucheryawiy.js';
import { upstoreUrls } from '../src/sources/lib/upstore.js';

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

test('collectLinks (whole site, Russian): the Russian menu (translated category paths), deepest first, dead links skipped, category wall', async () => {
  const http = fakeHttp({
    'https://kucheryawiy.com.ua/ru/': 'kucheryawiy-home-ru.html',
    'https://kucheryawiy.com.ua/ru/nozhici/goryachie-nozhnicy/jaguar-6/': 'kucheryawiy-hot.html',
    'https://kucheryawiy.com.ua/ru/nozhici/goryachie-nozhnicy/': 'kucheryawiy-hot.html',
    'https://kucheryawiy.com.ua/ru/nozhici/': 'kucheryawiy-category.html',
    'https://kucheryawiy.com.ua/ru/nozhici/page-2': 'kucheryawiy-empty.html',
    'https://kucheryawiy.com.ua/ru/nozhici/pryami-nozhici/': 'kucheryawiy-subcategory.html',
    // /ru/obladnannya-dlya-saloniv/miyki/ (a menu link) is a 404
    'https://kucheryawiy.com.ua/ru/instrumenti-ta-aksesuari-dlya-grumingu/': 'kucheryawiy-grooming.html',
  });
  const links = await kucheryawiy.collectLinks({ lang: 'ru', mode: 'all' }, ctx(http));
  assert.deepEqual([...links.entries()], [
    ['https://kucheryawiy.com.ua/ru/goryachie-nozhnicy-jaguar-tcc-60-j-84700/', { category: 'Ножницы/Горячие ножницы/Jaguar' }],
    ['https://kucheryawiy.com.ua/ru/nozhnicy-pryamye-jaguar-j-93575/', { category: 'Ножницы/Прямые ножницы' }],
    // a category only in the home page's category wall, after the menu
    ['https://kucheryawiy.com.ua/ru/mashinka-dlya-strizhki-zhivotnyh-wahl-max50-1251-0470/', { category: 'Инструменты и аксессуары для груминга' }],
  ]);
  assert.ok(!http.calls.includes('https://kucheryawiy.com.ua/'), 'the Ukrainian home page is not needed');
});

test('collectLinks (one category, Russian): a Ukrainian link with a translated path -> its Russian page (hreflang)', async () => {
  const http = fakeHttp({
    'https://kucheryawiy.com.ua/nozhici/garyachi-nozhici/jaguar-5/': 'kucheryawiy-hot.html',
    'https://kucheryawiy.com.ua/ru/nozhici/goryachie-nozhnicy/jaguar-6/': 'kucheryawiy-hot.html',
  });
  const links = await kucheryawiy.collectLinks(
    { lang: 'ru', mode: 'category', url: 'https://kucheryawiy.com.ua/nozhici/garyachi-nozhici/jaguar-5/' },
    ctx(http),
  );
  assert.deepEqual([...links.keys()], ['https://kucheryawiy.com.ua/ru/goryachie-nozhnicy-jaguar-tcc-60-j-84700/']);
});

test('collectLinks (one category, Russian): Russian product keywords, tiles first, pages', async () => {
  const http = fakeHttp({
    'https://kucheryawiy.com.ua/nozhici/': 'kucheryawiy-category.html',
    'https://kucheryawiy.com.ua/ru/nozhici/': 'kucheryawiy-category.html',
    'https://kucheryawiy.com.ua/ru/nozhici/page-2': 'kucheryawiy-category-page2.html',
    'https://kucheryawiy.com.ua/ru/nozhici/page-3': 'kucheryawiy-empty.html',
    'https://kucheryawiy.com.ua/ru/nozhici/pryami-nozhici/': 'kucheryawiy-subcategory.html',
    'https://kucheryawiy.com.ua/ru/nozhici/pryami-nozhici/page-2': 'kucheryawiy-empty.html',
  });
  const links = await kucheryawiy.collectLinks({ lang: 'ru', mode: 'category', url: 'https://kucheryawiy.com.ua/nozhici/' }, ctx(http));

  assert.deepEqual([...links.entries()], [
    ['https://kucheryawiy.com.ua/ru/nozhnicy-pryamye-jaguar-j-93575/', { category: 'Ножницы/Прямые ножницы' }], // subcategory tile first
    ['https://kucheryawiy.com.ua/ru/goryachie-nozhnicy-jaguar-tcc-60-j-84700/', { category: 'Ножницы' }],
    // a keyword starting with "ru" is not mistaken for the /ru/ language prefix
    ['https://kucheryawiy.com.ua/ru/ruchnaya-retro-mashinka-jrl-hm2301/', { category: 'Ножницы' }], // page 2
  ]);
});

test('parseProduct: discount, manufacturer logo, specs, photos', async () => {
  const link = 'https://kucheryawiy.com.ua/garyachi-nozhici-jaguar-tcc-60-j-84700/';
  const http = fakeHttp({ [link]: 'kucheryawiy-product.html' });
  const p = await kucheryawiy.parseProduct(link, { category: 'Ножиці/Гарячі ножиці' }, ctx(http));

  assert.equal(p.link, link);
  assert.equal(p.name, 'Гарячі ножиці Jaguar TCC 6.0 J-84700');
  assert.equal(p.category, 'Ножиці/Гарячі ножиці');
  assert.equal(
    p.images,
    'https://kucheryawiy.com.ua/image/cache/catalog/tovars/ttcphoto(5)-1300x1300.jpg;https://kucheryawiy.com.ua/image/cache/catalog/tovars/ttcphoto(8)-1300x1300.jpg',
  );
  assert.equal(p.description, '<p>Гарячі ножиці Thermo Care Cut®</p>');
  assert.equal(p.price, '99999.00'); // regular (crossed-out) price; related products ignored
  assert.equal(p.priceSpecial, '84999.00');
  assert.equal(p.sku, 'J-84700');
  assert.equal(p.available, true);
  assert.deepEqual(p.specs, { Потужність: '20 Вт', Колір: 'Сріблястий;Червоний шнур', vendor: 'Jaguar' });
});

test('parseProduct: sold out; no manufacturer -> empty vendor; photo with a server file path', async () => {
  const http = fakeHttp({ 'https://kucheryawiy.com.ua/p/': 'kucheryawiy-product-soldout.html' });
  const p = await kucheryawiy.parseProduct('https://kucheryawiy.com.ua/p/', { category: 'C' }, ctx(http));
  assert.equal(p.available, false); // the sticky bar's "В наявності" is not the product's
  assert.equal(p.price, '450.00');
  assert.equal(p.priceSpecial, '');
  // the site links the server's file path; it is turned into the image's web address
  assert.equal(p.images, 'https://kucheryawiy.com.ua/image/catalog/tovars/745342.jpg');
  assert.deepEqual(p.specs, { vendor: '' });
});

test('helpers: language links', () => {
  const { langUrl, productLink } = upstoreUrls({ website: 'https://kucheryawiy.com.ua', trailingSlash: true });
  assert.equal(langUrl('https://kucheryawiy.com.ua/nozhici/pryami-nozhici/', 'ru'), 'https://kucheryawiy.com.ua/ru/nozhici/pryami-nozhici/');
  assert.equal(langUrl('https://kucheryawiy.com.ua/ru/nozhici/', 'ua'), 'https://kucheryawiy.com.ua/nozhici/');
  assert.equal(langUrl('https://kucheryawiy.com.ua/ru', 'ua'), 'https://kucheryawiy.com.ua/');
  assert.equal(
    productLink('https://kucheryawiy.com.ua/tehnika/ruchna-retro-mashinka-jrl-hm2301/', 'ua'),
    'https://kucheryawiy.com.ua/ruchna-retro-mashinka-jrl-hm2301/',
  );
});
