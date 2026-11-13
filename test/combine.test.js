// Offline tests for joining a site's Ukrainian and Russian products into one row (src/scrape.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineLanguages } from '../src/scrape.js';

const product = (link, name, images, sku, specs = {}) => ({ link, name, category: 'C', images, description: '', sku, specs });

test('Russian products are paired by photo / article / link; attribute names are matched by values', () => {
  const ua = [
    product('https://s.ua/a', 'Фен A', 'https://s.ua/a.jpg', 'A-1', { Колір: 'Чорний', Вага: '300 г' }),
    product('https://s.ua/b', 'Фен B', 'https://s.ua/b.jpg', 'B-1', { Колір: 'Червоний', Вага: '310 г' }),
    product('https://s.ua/c', 'Фен C', '', 'C-1'),
  ];
  const ru = [
    product('https://s.ua/ru/b', 'Фен B (ru)', 'https://s.ua/b.jpg', 'B-1', { Цвет: 'Красный', Вес: '310 г' }), // same photo
    product('https://s.ua/ru/a', 'Фен A (ru)', 'https://s.ua/a2.jpg', 'A-1', { Цвет: 'Черный', Вес: '300 г' }), // same article
    product('https://s.ua/ru/x', 'Только на русском', 'https://s.ua/x.jpg', 'X-1', { Новое: 'да' }),
  ];
  const { products, ruNames, unpaired } = combineLanguages(ua, ru);

  assert.deepEqual(products.map((p) => [p.name, p.ru?.name ?? null]), [
    ['Фен A', 'Фен A (ru)'],
    ['Фен B', 'Фен B (ru)'],
    ['Фен C', null],
    ['', 'Только на русском'], // Russian-only product: kept, at the end
  ]);
  assert.deepEqual(products[0].ru.specs, { Колір: 'Черный', Вага: '300 г' }); // keyed by the Ukrainian names
  assert.equal(ruNames.get('Колір'), 'Цвет');
  assert.equal(ruNames.get('Новое'), 'Новое'); // Russian-only attribute keeps its own name
  assert.equal(unpaired, 1);
});
