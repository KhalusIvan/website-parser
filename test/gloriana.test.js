// Offline tests for the glorianapro.com source (no network): node --test test/
// The shared upstore code is tested in mrd/immortal/kucheryawiy tests; this checks the site's layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import gloriana from '../src/sources/gloriana.js';

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

test('collectLinks (whole site, Russian): menu from the Ukrainian home page, /ru/ links, accessories first, info pages skipped', async () => {
  const http = fakeHttp({
    'https://glorianapro.com/': 'gloriana-home.html',
    'https://glorianapro.com/ru/feni/aksesuari-dlya-feniv/': 'gloriana-aksesuari.html',
    'https://glorianapro.com/ru/feni/': 'gloriana-feni.html',
    'https://glorianapro.com/ru/vypriamliach/': 'gloriana-vypriamliach.html',
    'https://glorianapro.com/ru/pro-nas/': 'gloriana-info.html',
    // page 2 of every category: not routed -> 404 -> end of the category
  });
  const links = await gloriana.collectLinks({ lang: 'ru', mode: 'all' }, ctx(http));

  assert.deepEqual([...links.entries()], [
    ['https://glorianapro.com/ru/dyfuzor/', { category: 'Фены/Аксессуары для фенов' }],
    ['https://glorianapro.com/ru/fen-crown-ai/', { category: 'Фены/Аксессуары для фенов' }], // listed in both: first one wins
    ['https://glorianapro.com/ru/vypriamliach-g7/', { category: 'Выпрямитель' }],
  ]);
});

test('parseProduct: sold out, discount, specs, manufacturer; related products ignored', async () => {
  const http = fakeHttp({ 'https://glorianapro.com/vypriamliach-g7/': 'gloriana-product.html' });
  const p = await gloriana.parseProduct('https://glorianapro.com/vypriamliach-g7/', { category: 'Випрямляч' }, ctx(http));

  assert.equal(p.name, 'Випрямляч Gloriana G7, 402-070');
  assert.equal(
    p.images,
    'https://glorianapro.com/image/cache/catalog/402-070-1300x1300.webp;https://glorianapro.com/image/cache/catalog/402-070%20(1)-1300x1300.webp',
  );
  assert.equal(p.description, '<p>Випрямляч з <b>титановими</b> пластинами.</p>');
  assert.equal(p.price, '2999.00');
  assert.equal(p.priceSpecial, '2499.00');
  assert.equal(p.sku, '402-070');
  assert.equal(p.available, false);
  assert.deepEqual(p.specs, { 'Покриття пластин': 'Титан', 'Довжина шнура': '3 м', vendor: 'Gloriana' });
});
