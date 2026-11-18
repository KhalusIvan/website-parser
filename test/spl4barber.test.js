// Offline tests for the spl4barber source (wahl-pro.com.ua, ex spl4barber.com.ua) (no network). Shared helpers: test/babyliss.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import spl from '../src/sources/spl4barber.js';

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

const S = 'https://wahl-pro.com.ua';
const SITE = {
  [`${S}/`]: 'spl4barber-home.html',
  [`${S}/product-category/bez-katehorii/`]: 'spl4barber-empty.html',
  [`${S}/product-category/zapchastini/zapchastini-wahl-vanish/`]: 'spl4barber-subcategory.html',
  [`${S}/product-category/zapchastini/zapchastini-hero/`]: 'spl4barber-empty.html',
  [`${S}/product-category/zapchastini/`]: 'spl4barber-parent-category.html',
  [`${S}/product-category/zapchastini/page/2/`]: 'spl4barber-parent-category-page2.html',
  [`${S}/product-category/feny/`]: 'spl4barber-category.html',
};

test('collectLinks (whole site): footer category list, subcategories first, parent page 1 has only tiles', async () => {
  const http = fakeHttp(SITE);
  const links = await spl.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));

  assert.deepEqual(
    [...links.entries()].map(([link, extra]) => [link, extra.category]),
    [
      [`${S}/product/sitka-vanish-3022905/`, 'Запчастини/Запчастини для Wahl Vanish'],
      [`${S}/product/korpus-magic-clip-s08148-7125/`, 'Запчастини'], // from page 2 of the parent
      [`${S}/product/fen-vanquish-4321-0470/`, 'Фени'],
    ],
  );
  assert.deepEqual(links.get(`${S}/product/korpus-magic-clip-s08148-7125/`), {
    category: 'Запчастини',
    listPrice: '1250.00',
    listSpecial: '999.00',
    listStock: 'instock',
  });
  // a subcategory only shown as a tile on the parent page is visited too
  assert.ok(http.calls.includes(`${S}/product-category/zapchastini/zapchastini-hero/`));
});

test('collectLinks (whole site, 2026 layout): no category list on the home page - read from the first category page', async () => {
  const http = fakeHttp({
    ...SITE,
    [`${S}/`]: 'spl4barber-home-2026.html',
    [`${S}/product-category/feny/`]: 'spl4barber-category-sidebar.html',
  });
  const links = await spl.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));
  assert.deepEqual(
    [...links.entries()].map(([link, extra]) => [link, extra.category]),
    [
      [`${S}/product/sitka-vanish-3022905/`, 'Запчастини/Запчастини для Wahl Vanish'],
      [`${S}/product/korpus-magic-clip-s08148-7125/`, 'Запчастини'],
      [`${S}/product/fen-vanquish-4321-0470/`, 'Фени'],
    ],
  );
});

test('collectLinks (one category): a parent category also collects its subcategories', async () => {
  const http = fakeHttp(SITE);
  const links = await spl.collectLinks({ lang: 'ua', mode: 'category', url: `${S}/product-category/zapchastini/` }, ctx(http));
  assert.deepEqual([...links.keys()], [`${S}/product/sitka-vanish-3022905/`, `${S}/product/korpus-magic-clip-s08148-7125/`]);
});

test('parseProduct: no stock label + add to cart = available; sale price; description without the theme wrapper', async () => {
  const link = `${S}/product/vypriamliach-4467-0471/`;
  const http = fakeHttp({ [link]: 'spl4barber-product.html' });
  const p = await spl.parseProduct(link, { category: 'Випрямлячі' }, ctx(http));

  assert.equal(p.name, 'Професійний випрямляч Wahl Pro Glide Black 4467-0471');
  assert.equal(p.category, 'Випрямлячі');
  assert.equal(p.images, `${S}/wp-content/uploads/4467-04712.jpg;${S}/wp-content/uploads/4467-04711.jpg`);
  assert.equal(p.description, '<div><p><strong>Wahl Pro Glide Black</strong> — професійний випрямляч.</p></div>');
  assert.equal(p.price, '3300.00');
  assert.equal(p.priceSpecial, '3099.00');
  assert.equal(p.sku, '4467-0471');
  assert.equal(p.available, true);
  assert.deepEqual(p.specs, { vendor: 'Wahl' });
});

test('sold out: no price, not available, short description used when there is no description tab', async () => {
  const link = `${S}/product/sitka-vanish-3022905/`;
  const http = fakeHttp({ [link]: 'spl4barber-product-soldout.html' });
  const p = await spl.parseProduct(link, {}, ctx(http));
  assert.equal(p.available, false);
  assert.equal(p.price, '');
  assert.equal(p.priceSpecial, '');
  assert.equal(p.category, 'Запчастини/Запчастини для Wahl Vanish');
  assert.equal(p.description, '<p>Змінна сітка з ножем для Wahl Vanish 3022905</p>');
  assert.equal(p.images, `${S}/wp-content/uploads/5695.970.jpg`);
});
