import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partnerItems, partnerJsonRows } from '../src/catalog/partner.js';
import { offerLinks } from '../src/sync/feed.js';

test('partner list from the shop (data/partner.json) keeps its brand groups', () => {
  const items = partnerItems(partnerJsonRows({ items: [['1042', 'Ножиці SPL 1042', 'SPL'], ['4360-0050', 'Фен MOSER Protect', 'MOSER'], ['J-82655', 'Ножиці', 'JAGUAR TCC']] }));
  assert.deepEqual(items.map((i) => [i.code, i.brand]), [['1042', 'SPL'], ['4360-0050', 'Moser'], ['J-82655', 'Jaguar']]);
});

test('offer links: each product page once', () => {
  const links = offerLinks({ products: [
    { offers: [{ source: 'jrl', link: 'https://a/1', category: 'Машинки' }, { source: 'vroda', link: 'https://b/1' }] },
    { offers: [{ source: 'jrl', link: 'https://a/1' }] },
  ] });
  assert.deepEqual(links, [{ source: 'jrl', link: 'https://a/1', category: 'Машинки' }, { source: 'vroda', link: 'https://b/1', category: '' }]);
});
