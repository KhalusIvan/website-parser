// Offline tests for the immortal.com.ua source (no network): node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import immortal from '../src/sources/immortal.js';
import { upstoreUrls, pageUrl } from '../src/sources/lib/upstore.js';

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
  'https://immortal.com.ua/': 'immortal-home.html',
  'https://immortal.com.ua/dohliad-za-borodoiu/': 'immortal-top.html',
  'https://immortal.com.ua/dohliad-za-borodoiu/zasoby/': 'immortal-category.html',
  'https://immortal.com.ua/dohliad-za-borodoiu/zasoby/?page=2': 'immortal-category-page2.html',
  // ?page=3 is not routed: the site answers 404 after the last page
  'https://immortal.com.ua/dohliad-za-borodoiu/zasoby/vosky/': 'immortal-subcategory.html',
  'https://immortal.com.ua/dohliad-za-borodoiu/zasoby/shampuni/': 'immortal-tile.html',
  'https://immortal.com.ua/novynky/': 'immortal-new.html',
  'https://immortal.com.ua/novynky/?page=2': 'immortal-empty.html',
};

test('collectLinks (whole site): horizontal menu, deepest categories first, tiles, ?page=N, one link per product', async () => {
  const http = fakeHttp(SITE);
  const links = await immortal.collectLinks({ lang: 'ua', mode: 'all' }, ctx(http));

  assert.deepEqual([...links.entries()], [
    // "Воски" (3 levels) before its parent, although the menu lists the parent first
    ['https://immortal.com.ua/visk-bear-beard-wax/', { category: 'Догляд за бородою/Засоби для догляду за бородою/Воски' }],
    // a subcategory tile that is not in the menu, visited before its parent's products
    ['https://immortal.com.ua/shampun-dlya-borodi/', { category: 'Догляд за бородою/Засоби для догляду за бородою/Шампуні' }],
    ['https://immortal.com.ua/pomada-dlya-borodi/', { category: 'Догляд за бородою/Засоби для догляду за бородою' }],
    ['https://immortal.com.ua/oliya-dlya-borodi/', { category: 'Догляд за бородою/Засоби для догляду за бородою' }], // ?page=2
    ['https://immortal.com.ua/parfum-dlia-borody/', { category: 'Новинки' }], // "new" last
  ]);
  // the menu's duplicate blocks and the tile back to an already visited category are fetched once
  assert.equal(http.calls.filter((u) => u === 'https://immortal.com.ua/dohliad-za-borodoiu/zasoby/').length, 1);
});

test('collectLinks (one category)', async () => {
  const http = fakeHttp(SITE);
  const links = await immortal.collectLinks(
    { lang: 'ua', mode: 'category', url: 'https://immortal.com.ua/dohliad-za-borodoiu/zasoby/vosky' },
    ctx(http),
  );
  assert.deepEqual([...links.keys()], ['https://immortal.com.ua/visk-bear-beard-wax/']);
});

test('parseProduct: data-src photos, manufacturer, the visible "В наявності" label wins', async () => {
  const http = fakeHttp({ 'https://immortal.com.ua/pudra-volume-powder-wax/': 'immortal-product.html' });
  const p = await immortal.parseProduct('https://immortal.com.ua/pudra-volume-powder-wax/', { category: 'Новинки' }, ctx(http));

  assert.equal(p.name, 'Пудра для об\'єму волосся "Volume Powder Wax" 20 г');
  assert.equal(p.category, 'Новинки');
  assert.equal(
    p.images,
    'https://immortal.com.ua/image/cache/catalog/inf-20-1300x1300.jpg;https://immortal.com.ua/image/cache/catalog/inf-0987-1300x1300.jpg',
  );
  assert.equal(p.description, '<p>Пудра для <b>об\'єму</b>.</p>'); // theme heading removed
  assert.equal(p.price, '349.00');
  assert.equal(p.priceSpecial, '');
  assert.equal(p.sku, 'INF-20');
  assert.equal(p.available, true); // label "В наявності" (styled as out of stock by the site)
  assert.deepEqual(p.specs, { vendor: 'Immortal Infuse' });
});

test('parseProduct: "Очікується" is not available; no manufacturer -> Immortal; related products ignored', async () => {
  const http = fakeHttp({ 'https://immortal.com.ua/p/': 'immortal-product-expected.html' });
  const p = await immortal.parseProduct('https://immortal.com.ua/p/', { category: 'C' }, ctx(http));
  assert.equal(p.available, false);
  assert.equal(p.price, '299.00');
  assert.equal(p.priceSpecial, '');
  assert.equal(p.description, '');
  assert.deepEqual(p.specs, { vendor: 'Immortal' });
});

test('helpers: links with a trailing slash, page URLs', () => {
  const { langUrl, productLink } = upstoreUrls({ website: 'https://immortal.com.ua', trailingSlash: true });
  assert.equal(langUrl('https://immortal.com.ua/aksesuary', 'ua'), 'https://immortal.com.ua/aksesuary/');
  assert.equal(langUrl('https://immortal.com.ua/', 'ua'), 'https://immortal.com.ua/');
  assert.equal(productLink('https://immortal.com.ua/novynky/visk-bear-beard-wax/', 'ua'), 'https://immortal.com.ua/visk-bear-beard-wax/');
  assert.equal(pageUrl('https://immortal.com.ua/aksesuary/', 2, true), 'https://immortal.com.ua/aksesuary/?page=2');
  assert.equal(pageUrl('https://immortal.com.ua/aksesuary/', 1, true), 'https://immortal.com.ua/aksesuary/');
  assert.equal(pageUrl('https://kucheryawiy.com.ua/nozhici/', 3), 'https://kucheryawiy.com.ua/nozhici/page-3');
});
