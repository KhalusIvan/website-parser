// Offline tests for the Mainmarket catalog builder (src/catalog/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignAttributes, valueTranslator } from '../src/catalog/align.js';
import { canonicalAttribute } from '../src/catalog/attributes.js';
import { brandFamily, brandFromName, canonicalBrand } from '../src/catalog/brands.js';
import { photoCandidates, priceOffer } from '../src/catalog/build.js';
import { cleanDescription } from '../src/catalog/html.js';
import { groupOffers, skuKey } from '../src/catalog/offers.js';
import { slugify } from '../src/catalog/slug.js';
import { classify } from '../src/catalog/taxonomy.js';

test('articles from different shops match: case, punctuation, Cyrillic look-alikes, brand prefixes', () => {
  assert.equal(skuKey('JRL-2020С'), skuKey('JRL-2020C')); // Cyrillic С
  assert.equal(skuKey('J-82655'), skuKey('82655')); // jaguar-solingen vs resellers
  assert.equal(skuKey('HC-999C-X-B'), '999CXB'); // MRD
  assert.equal(skuKey('4314-0475'), '43140475');
});

test('brands: one spelling per brand, brand from the name, families share articles', () => {
  assert.equal(canonicalBrand('Babyliss Pro'), 'BaByliss PRO');
  assert.equal(canonicalBrand('BaBylіssPRO'), 'BaByliss PRO'); // Cyrillic і
  assert.equal(canonicalBrand('GA.MA Professional'), 'GA.MA');
  assert.equal(brandFromName('Фен-щітка Ga.Ma MULTISTYLER (для BaByliss)'), 'GA.MA'); // first brand named wins
  assert.equal(brandFamily('Moser'), brandFamily('Wahl'));
  assert.notEqual(brandFamily('JRL'), brandFamily('GA.MA'));
});

const offer = (source, sku, name, extra = {}) => ({
  source, sku, brand: extra.brand ?? 'SPL', rank: extra.rank ?? 1, key: `spl:${skuKey(sku)}`,
  ua: { name, link: `https://${source}/${name}`, specs: {} }, ru: null, effectivePrice: extra.price ?? 100,
  price: extra.price ?? 100, special: 0, available: extra.available ?? true, ...extra,
});

test('a shop that gives two different products one article: they stay two products', () => {
  const groups = groupOffers([
    offer('vroda', '4445-0050', 'Плойка Moser TitanCurl 32 мм'),
    offer('kucheryawiy', '4445-0050', 'Плойка Moser TitanCurl 32 мм'),
    offer('kucheryawiy', '4445-0050', 'Плойка Moser CeraCurl 19 мм'),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.offers.length === 2).offers[1].ua.name, 'Плойка Moser TitanCurl 32 мм');
});

test('price: cheapest in stock wins; a price under half of every other shop is skipped and noted', () => {
  const a = offer('spl', '1', 'x', { price: 590, effectivePrice: 590, rank: 0 });
  const b = offer('kucheryawiy', '1', 'x', { price: 49, effectivePrice: 49 });
  const c = offer('vroda', '1', 'x', { price: 560, effectivePrice: 560, available: false });
  assert.equal(priceOffer([a, b, c]).offer, a);
  assert.match(priceOffer([a, b, c]).note, /kucheryawiy 49/);
  const d = offer('vroda', '2', 'y', { price: 249, effectivePrice: 249 });
  const e = offer('kucheryawiy', '2', 'y', { price: 250, effectivePrice: 250 });
  const f = offer('spl4barber', '2', 'y', { price: 550, effectivePrice: 550 });
  assert.deepEqual(priceOffer([f, e, d]), { offer: d, note: '' }); // two shops agree: not an error
});

test('categories: product type in the name beats the shop category; deepest category level first', () => {
  assert.equal(classify('kucheryawiy', 'Техніка для перукарів і барберів/Тримери для стрижки/MRD', 'Мережевий адаптер для машинок MRD'), 'parts-power');
  assert.equal(classify('vroda', 'Інструменти та аксесуари для перукарів та барберів/Гребінці, щітки та брашинги для волосся/Гребінці для волосся', 'Гребінець SPL 1'), 'combs-combs');
  assert.equal(classify('spl', 'Манікюр та педикюр/Манікюрні ножиці', 'Ножиці для кутикул SPL 9216'), 'mani-scissors');
  assert.equal(classify('moser', 'Ножові блоки/Ножові блоки А5', 'Ножовий блок Moser #10F'), 'groom-blades');
  assert.equal(classify('gama', 'Аксесуари', 'Наcадка для фена GaMa IQ'), 'parts-dryer'); // Latin "c" inside the word
  assert.equal(classify('jrl', 'JRL X DIAMANTE COLLECTION', 'Професійний фен JRL x Diamante Forte Pro Lite'), 'tech-dryers');
});

test('attributes: synonyms merged, brand-only attributes dropped', () => {
  assert.equal(canonicalAttribute('Швидкість мотора (об / хв)'), 'Швидкість двигуна (об/хв)');
  assert.equal(canonicalAttribute('Колір манікюрного набору Удалити'), 'Колір');
  assert.equal(canonicalAttribute('Бренд'), null);
  assert.equal(canonicalAttribute('Нове поле'), 'Нове поле');
});

test('Ukrainian/Russian attribute names are paired from the values; values are translated', () => {
  const both = (ua, ru) => ({ source: 's', ua: { specs: ua }, ru: { specs: ru } });
  const offers = [
    both({ Вага: '290 г', Колір: 'Чорний', Гарантія: '12 місяців' }, { Вес: '290 г', Цвет: 'Черный', Гарантия: '12 месяцев' }),
    both({ Вага: '310 г', Колір: 'Чорний' }, { Вес: '310 г', Цвет: 'Черный' }),
    both({ Колір: 'Червоний', Гарантія: '24 місяців' }, { Цвет: 'Красный', Гарантия: '24 месяцев' }),
  ];
  const aligned = alignAttributes(offers);
  assert.deepEqual(Object.fromEntries(aligned.get('s')), { Вага: 'Вес', Колір: 'Цвет', Гарантія: 'Гарантия' });
  const translate = valueTranslator(offers, aligned);
  assert.equal(translate('Чорний'), 'Черный');
  assert.equal(translate('36 місяців'), '36 месяцев'); // word by word
  assert.equal(translate('Невідоме слово'), '');
});

test('descriptions: no styles, links, images or "buy on our site" sentences; ordinary words kept', () => {
  const html = '<div style="color:red"><p><font color="#333">Фен для <b>кучерявого</b> волосся.</font> Купіть його на нашому сайті Vroda!</p>'
    + '<img src="x.jpg"><p><a href="https://vroda-ua.com">Детальніше</a></p><iframe src="//www.youtube.com/embed/abc"></iframe><script>x()</script></div>';
  assert.equal(
    cleanDescription(html),
    '<p>Фен для <b>кучерявого</b> волосся.</p><p>Детальніше</p><iframe src="https://www.youtube.com/embed/abc"></iframe>',
  );
});

test('SEO keywords and OpenCart original photos', () => {
  assert.equal(slugify('Машинка для стрижки Moser 1400 (сіра)', 'uk'), 'mashynka-dlia-stryzhky-moser-1400-sira');
  assert.equal(slugify('Щётка массажная', 'ru'), 'shchetka-massazhnaya');
  assert.deepEqual(photoCandidates('https://shop.ua/image/cache/catalog/a/b-1300x1300.jpg').slice(0, 2), [
    'https://shop.ua/image/catalog/a/b.jpg',
    'https://shop.ua/image/catalog/a/b.png',
  ]);
  assert.deepEqual(photoCandidates('https://shop.ua/wp-content/uploads/x.jpg'), ['https://shop.ua/wp-content/uploads/x.jpg']);
});
