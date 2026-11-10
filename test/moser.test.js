// Offline tests for the moser-animal.com source (no network): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import moser from '../src/sources/moser.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** Fake HTTP client: maps URLs to fixture files; anything else is a 404. */
function fakeHttp(routes) {
  const getText = async (url) => {
    const file = routes[url];
    if (!file) throw Object.assign(new Error(`HTTP 404 for ${url}`), { status: 404 });
    return fixture(file);
  };
  return { getText, getHtml: async (url) => cheerio.load(await getText(url), { baseURI: url }) };
}
const ctx = (http) => ({ http, log: () => {}, addProduct: () => {} });

const M = 'https://moser-animal.com';

test('Ukrainian only', () => {
  assert.deepEqual(Object.keys(moser.languages), ['ua']);
});

test('collectLinks (whole site): subcategory before its parent, empty categories are fine', async () => {
  const http = fakeHttp({
    [`${M}/`]: 'moser-home.html',
    [`${M}/feny-dlia-hruminhu`]: 'jaguar-empty.html',
    [`${M}/nozhovi-bloky/nozhovi-bloky-a5/`]: 'moser-category.html',
    [`${M}/nozhovi-bloky`]: 'moser-category.html',
  });
  const links = await moser.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));
  assert.deepEqual([...links.entries()], [
    [`${M}/nozhovi-bloky/nozhovyi-blok-wahl-diamond-blade-animal-1854-7172`, { category: 'Ножові блоки/Ножові блоки А5' }],
  ]);
});

test('discounted, sold-out product: regular + special price, visible label wins over schema.org', async () => {
  const link = `${M}/nozhovi-bloky/nozhovyi-blok-wahl-diamond-blade-animal-1854-7172`;
  const p = await moser.parseProduct(link, { category: 'Ножові блоки/Ножові блоки А5' }, ctx(fakeHttp({ [link]: 'moser-product-sale.html' })));
  assert.equal(p.name, 'Ножовий блок WAHL Diamond Blade Animal 1854-7172');
  assert.equal(p.price, '2470.00');
  assert.equal(p.priceSpecial, '1829.00');
  assert.equal(p.available, false); // "Немає в наявності" although schema.org says InStock
  assert.equal(p.sku, '1854-7172');
  assert.equal(p.images, `${M}/image/cache/catalog/1854-7172-750x750.jpg`);
  assert.equal(p.description, '<p><b>WAHL Diamond Blade</b> – ножовий блок.</p>');
  assert.deepEqual(p.specs, { 'Вид запчастини': 'Ножовий блок', Бренд: 'WAHL', vendor: 'WAHL' });
});

test('product without manufacturer: vendor is Moser, empty description', async () => {
  const link = `${M}/sprey`;
  const p = await moser.parseProduct(link, {}, ctx(fakeHttp({ [link]: 'moser-product-nobrand.html' })));
  assert.equal(p.specs.vendor, 'Moser');
  assert.equal(p.available, true);
  assert.equal(p.price, '499.00');
  assert.equal(p.description, '');
  assert.equal(p.category, '');
});
