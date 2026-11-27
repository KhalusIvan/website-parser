// Offline tests for the babyliss-pro.com.ua source and the shared WooCommerce helper (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import babyliss from '../src/sources/babyliss.js';
import { categoryUrl, cleanLink, fitDescription, money, pageUrl } from '../src/sources/lib/woocommerce.js';

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

const B = 'https://babyliss-pro.com.ua';
const SITE = {
  [`${B}/`]: 'babyliss-home.html',
  [`${B}/product-category/vypriamliachi/`]: 'babyliss-category.html',
  [`${B}/product-category/vypriamliachi/page/2/`]: 'babyliss-category-page2.html',
  [`${B}/product-category/aksesuary-ta-detali/dyfuzory/`]: 'babyliss-subcategory.html',
  [`${B}/product-category/aksesuary-ta-detali/`]: 'babyliss-parent-category.html',
  [`${B}/product-category/novynky/`]: 'babyliss-new.html',
};

test('collectLinks (whole site): menu order, subcategories first, "new" last, pages, dead links skipped', async () => {
  const http = fakeHttp(SITE);
  const links = await babyliss.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));

  assert.deepEqual([...links.entries()], [
    [`${B}/product/vypriamliach-bab2654epe/`, { category: 'Випрямлячі', listPrice: '3999.00', listSpecial: '', listStock: 'instock' }],
    // query string removed; card shows the regular (crossed-out) and the sale price
    [`${B}/product/%d0%bc%d0%b0%d1%81%d0%b0%d0%b6%d0%b5%d1%80-fxsm1ge/`, { category: 'Випрямлячі', listPrice: '4000.00', listSpecial: '3599.00', listStock: 'onbackorder' }],
    [`${B}/product/vypriamliach-bab2191sepe/`, { category: 'Випрямлячі', listPrice: '3500.00', listSpecial: '', listStock: 'outofstock' }], // page 2
    [`${B}/product/dyfuzor-bdg1e/`, { category: 'Аксесуари та деталі/Дифузори', listPrice: '899.00', listSpecial: '', listStock: 'instock' }],
    [`${B}/product/fartukh-m4189e/`, { category: 'Аксесуари та деталі', listPrice: '', listSpecial: '', listStock: 'instock' }],
    [`${B}/product/fen-bab6880e/`, { category: 'НОВИНКИ', listPrice: '', listSpecial: '', listStock: 'instock' }], // only in "new"
  ]);
  // "Старий розділ" (404) was skipped, the info page in the menu was never requested
  assert.ok(http.calls.includes(`${B}/product-category/staryi-rozdil/`));
  assert.ok(!http.calls.some((url) => url.includes('oplata-ta-dostavka')));
  // only pages the site links to ("load more" button) are requested, nothing past the last one
  assert.ok(!http.calls.includes(`${B}/product-category/vypriamliachi/page/3/`));
  assert.ok(!http.calls.includes(`${B}/product-category/novynky/page/2/`));
});

test('collectLinks (one category): a pasted paged link with a query is normalised', async () => {
  const http = fakeHttp(SITE);
  const links = await babyliss.collectLinks(
    { lang: 'ua', mode: 'category', url: `${B}/product-category/vypriamliachi/page/2/?orderby=price` },
    ctx(http),
  );
  assert.equal(links.size, 3);
  assert.equal(http.calls[0], `${B}/product-category/vypriamliachi/`);
});

test('parseProduct reads all fields from the main product only', async () => {
  const link = `${B}/product/fen-bab6880e/`;
  const http = fakeHttp({ [link]: 'babyliss-product.html' });
  const p = await babyliss.parseProduct(link, { category: 'Фени для волосся' }, ctx(http));

  assert.equal(p.link, link);
  assert.equal(p.name, 'Фен стайлер BaByliss PRO Drying Wand 1600Вт BAB6880E');
  assert.equal(p.category, 'Фени для волосся');
  // full-size links, unique, no lazy-load placeholders
  assert.equal(p.images, `${B}/wp-content/uploads/2025/09/wand-03.jpg;${B}/wp-content/uploads/2025/09/wand-14.jpg`);
  assert.equal(p.description, '<h3><b>Фен-стайлер BAB6880E</b></h3>\n<p>Професійне укладання у ваших руках.</p>');
  assert.equal(p.price, '10000.00'); // regular (crossed out); the related product's prices are ignored
  assert.equal(p.priceSpecial, '8400.00');
  assert.equal(p.sku, 'BAB6880E');
  assert.equal(p.available, true);
  assert.deepEqual(p.specs, {
    Виробник: 'Babyliss Pro',
    'Швидкість повітря': '180 км/год', // hint text left out
    'Робочі температури': '150 °C, 230 °C',
    // "pa_vushko-dlia-pidvishuvannia" (attribute without a name) skipped
    vendor: 'Babyliss Pro',
  });
});

test('backorder ("Доступно за замовленням") is not available; no attributes -> shop brand', async () => {
  const link = `${B}/product/masazher/`;
  const http = fakeHttp({ [link]: 'babyliss-product-backorder.html' });
  const p = await babyliss.parseProduct(link, {}, ctx(http));
  assert.equal(p.available, false);
  assert.equal(p.price, '3999.00');
  assert.equal(p.priceSpecial, '');
  assert.equal(p.category, 'Аксесуари та деталі'); // from the breadcrumb when the product wasn't found in a category
  assert.equal(p.description, '<p>Масажер для салону.</p>');
  assert.deepEqual(p.specs, { vendor: 'Babyliss Pro' });
});

test('"ЗНЯТО З ВИРОБНИЦТВА": not available although the page sells it, marked discontinued', async () => {
  const link = `${B}/product/fen-prodigio/`;
  const http = fakeHttp({ [link]: 'babyliss-product-discontinued.html' });
  const p = await babyliss.parseProduct(link, {}, ctx(http));
  assert.equal(p.available, false);
  assert.equal(p.specs.discontinued, '+');
  // the normal product is not
  const ok = await babyliss.parseProduct(`${B}/product/masazher/`, {}, ctx(fakeHttp({ [`${B}/product/masazher/`]: 'babyliss-product-backorder.html' })));
  assert.equal(ok.specs.discontinued, undefined);
});

test('helpers: money, categoryUrl, pageUrl, cleanLink, fitDescription', () => {
  assert.equal(money('10 000 грн'), '10000.00');
  assert.equal(money('1,250 грн'), '1250.00');
  assert.equal(money(''), '');

  assert.equal(categoryUrl(`${B}/product-category/a/b/page/3/?x=1#y`), `${B}/product-category/a/b/`);
  assert.equal(categoryUrl(`${B}/product-category/a`), `${B}/product-category/a/`);
  assert.equal(pageUrl(`${B}/product-category/a/`, 1), `${B}/product-category/a/`);
  assert.equal(pageUrl(`${B}/product-category/a/`, 2), `${B}/product-category/a/page/2/`);
  assert.equal(cleanLink(`${B}/product/x/?attribute_pa_color=red#reviews`), `${B}/product/x/`);

  const long = `<p style="color:red">${'x'.repeat(33000)}</p>`;
  assert.equal(fitDescription(long), `<p>${'x'.repeat(33000)}</p>`);
  assert.equal(fitDescription('<p style="a">short</p>'), '<p style="a">short</p>');
});
