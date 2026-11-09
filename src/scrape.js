import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHttp } from './core/http.js';
import { mapPool } from './core/pool.js';
import { writeXlsx } from './core/excel.js';
import { getSource } from './sources/index.js';

function slugFromUrl(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'category';
    return last.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60);
  } catch {
    return 'category';
  }
}

/** Safety limit for products found on product pages that link to more products, and so on. */
const MAX_ROUNDS = 10;

/** Sorts [3] < [3, 0] < [3, 1] < [4]: products found on a page come right after it. */
function compareOrder(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Output file name (without extension), e.g. "vroda-UA" or "vroda-UA-maslo-dlya-...". */
export function outputName({ source, lang, mode, url }) {
  const base = `${source}-${lang.toUpperCase()}`;
  return mode === 'all' ? base : `${base}-${slugFromUrl(url)}`;
}

/**
 * Runs a full scrape and writes the Excel file.
 * Returns a summary { file, products, failed, ... } that is also saved next to the file as JSON.
 * `onProgress` is called with { phase: 'collect' } and then { phase: 'products', done, total, failed }
 * after every product (used for Telegram progress messages).
 */
export async function scrape({
  source: sourceId,
  lang,
  mode = 'all',
  url = '',
  outDir = 'output',
  concurrency,
  limit = 0,
  log = console.log,
  http = createHttp({ log }),
  onProgress,
}) {
  const source = getSource(sourceId);
  if (!source.languages[lang]) {
    throw new Error(`Language "${lang}" is not available for ${source.id}: ${Object.keys(source.languages).join(', ')}`);
  }
  if (!source.modes[mode]) {
    throw new Error(`Mode "${mode}" is not available for ${source.id}: ${Object.keys(source.modes).join(', ')}`);
  }

  const startedAt = new Date();
  const ctx = { http, log };
  const progress = (info) => {
    try {
      onProgress?.(info);
    } catch (err) {
      log(`Progress callback failed: ${err.message}`);
    }
  };

  progress({ phase: 'collect' });
  log(`Collecting product links from ${source.name} (${lang}, ${mode})...`);
  const links = await source.collectLinks({ lang, mode, url }, ctx);
  let entries = [...links.entries()];
  if (limit > 0) entries = entries.slice(0, limit);
  log(`Found ${entries.length} products`);

  // A source can report more products it finds on a product page (e.g. colour variants that are
  // not listed in any category) with ctx.addProduct(link, extra). They are scraped in further
  // rounds and placed right after the product that linked them. Not used with --limit (quick tests).
  const threads = concurrency ?? source.concurrency ?? 2;
  const known = new Set(entries.map(([link]) => link));
  let queue = entries.map(([link, extra], i) => ({ link, extra, order: [i], found: [] }));
  const scraped = []; // { order, product }
  const failed = [];
  let total = queue.length;
  let done = 0;
  let failedCount = 0;
  let counter = 0;
  progress({ phase: 'products', done, total, failed: failedCount });

  for (let round = 1; queue.length && round <= MAX_ROUNDS; round++) {
    const results = await mapPool(queue, threads, async (item) => {
      const n = counter++;
      const pageCtx = { ...ctx, addProduct: (link, extra) => item.found.push({ link, extra }) };
      try {
        const product = await source.parseProduct(item.link, item.extra, pageCtx);
        log(`[${++done}/${total}] ${item.link} (N-${n}) collected`);
        return product;
      } catch (err) {
        failedCount++;
        log(`[${++done}/${total}] ${item.link} (N-${n}) ERROR: ${err.message}`);
        throw err;
      } finally {
        progress({ phase: 'products', done, total, failed: failedCount });
      }
    });

    // Next round: new links, taken in file order so the result doesn't depend on timing.
    const next = [];
    queue.forEach((item, i) => {
      if (results[i].value) scraped.push({ order: item.order, product: results[i].value });
      else failed.push(item.link);
      if (limit > 0) return;
      for (const { link, extra } of item.found) {
        if (known.has(link)) continue;
        known.add(link);
        next.push({ link, extra, order: [...item.order, next.length], found: [] });
      }
    });
    if (next.length) log(`Found ${next.length} more products on product pages`);
    total += next.length;
    queue = next;
  }

  scraped.sort((a, b) => compareOrder(a.order, b.order));
  const products = scraped.map((s) => s.product);

  const name = outputName({ source: source.id, lang, mode, url });
  const file = path.join(outDir, `${name}.xlsx`);
  await writeXlsx(file, products, { log });

  const summary = {
    file: path.basename(file),
    source: source.id,
    sourceName: source.name,
    lang,
    mode,
    url: mode === 'all' ? '' : url,
    products: products.length,
    failed: failed.length,
    failedLinks: failed.slice(0, 200),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
  await writeFile(`${file}.json`, JSON.stringify(summary, null, 2));
  log(`Done: ${products.length} products written to ${file}${failed.length ? ` (${failed.length} failed)` : ''}`);
  return summary;
}
