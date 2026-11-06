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

  const threads = concurrency ?? source.concurrency ?? 2;
  const total = entries.length;
  let done = 0;
  let failedCount = 0;
  progress({ phase: 'products', done, total, failed: failedCount });
  const results = await mapPool(entries, threads, async ([link, extra], index) => {
    try {
      const product = await source.parseProduct(link, extra, ctx);
      log(`[${++done}/${total}] ${link} (N-${index}) collected`);
      return product;
    } catch (err) {
      failedCount++;
      log(`[${++done}/${total}] ${link} (N-${index}) ERROR: ${err.message}`);
      throw err;
    } finally {
      progress({ phase: 'products', done, total, failed: failedCount });
    }
  });

  const products = results.filter((r) => r.value).map((r) => r.value);
  const failed = entries.filter((_, i) => results[i].error).map(([link], i) => link);

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
