import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partnerItems, partnerJsonRows } from '../src/catalog/partner.js';
import { incomplete, offerLinks } from '../src/sync/feed.js';
import { createHttp } from '../src/core/http.js';

test('partner list from the shop (data/partner.json) keeps its brand groups', () => {
  const items = partnerItems(partnerJsonRows({ items: [['1042', 'Ножиці SPL 1042', 'SPL'], ['4360-0050', 'Фен MOSER Protect', 'MOSER'], ['J-82655', 'Ножиці', 'JAGUAR TCC']] }));
  assert.deepEqual(items.map((i) => [i.code, i.brand]), [['1042', 'SPL'], ['4360-0050', 'Moser'], ['J-82655', 'Jaguar']]);
});

test('offer links: each product page once', () => {
  const links = offerLinks({ products: [
    { key: 'p1', offers: [{ source: 'jrl', link: 'https://a/1', category: 'Машинки' }, { source: 'vroda', link: 'https://b/1' }] },
    { key: 'p2', offers: [{ source: 'jrl', link: 'https://a/1' }] },
  ] });
  assert.deepEqual(links, [{ source: 'jrl', link: 'https://a/1', category: 'Машинки', key: 'p1' }, { source: 'vroda', link: 'https://b/1', category: '', key: 'p1' }]);
});

test('incomplete run: sites with failed pages, products to keep', () => {
  const previous = [
    { source: 'jrl', link: 'https://a/1', key: 'p1' },
    { source: 'jrl', link: 'https://a/2', key: 'p2' },
    { source: 'vroda', link: 'https://b/1', key: 'p3' },
    { source: 'gama', link: 'https://c/1', key: 'p4' },
  ];
  const report = {
    jrl: { ok: true, failed: 1, failedLinks: ['https://a/2'] },
    vroda: { ok: true, failed: 0, failedLinks: [] },
    gama: { ok: false, error: 'down' },
  };
  const r = incomplete(report, previous);
  assert.deepEqual(r.partial.sort(), ['gama', 'jrl']);
  assert.deepEqual(r.keep.sort(), ['p2', 'p4']);
  assert.deepEqual(incomplete({ jrl: { ok: true, failedLinks: [] } }, previous), { partial: [], keep: [] });
});

test('http: pages failing in a row -> a pause, then the page is tried again', async () => {
  const realFetch = globalThis.fetch;
  const logs = [];
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls <= 6) throw new TypeError('fetch failed'); // 3 pages x 2 attempts
    return new Response('ok', { status: 200 });
  };
  try {
    const http = createHttp({ retries: 2, retryDelayMs: 1, blockedWaitMs: [5, 5], failStreak: 3, pauseBudgetMs: 1000, log: (m) => logs.push(m) });
    await assert.rejects(http.getText('https://x/1'), /fetch failed/);
    await assert.rejects(http.getText('https://x/2'), /fetch failed/);
    assert.equal(await http.getText('https://x/3'), 'ok'); // third failure in a row: pause, then it works
    assert.equal(logs.filter((m) => /blocked us/.test(m)).length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('http: the pauses are capped, after that failing pages fail fast', async () => {
  const realFetch = globalThis.fetch;
  const logs = [];
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  try {
    const http = createHttp({ retries: 1, retryDelayMs: 1, blockedWaitMs: [20, 20], failStreak: 1, pauseBudgetMs: 30, log: (m) => logs.push(m) });
    await assert.rejects(http.getText('https://x/1'), /fetch failed/);
    await assert.rejects(http.getText('https://x/2'), /fetch failed/);
    assert.equal(logs.length, 2); // 20 ms + the last 10 ms of the budget, then no more pauses
  } finally {
    globalThis.fetch = realFetch;
  }
});
