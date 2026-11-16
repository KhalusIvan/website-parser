// Quick run: only the product pages the shop sells (from the last full run), Ukrainian only, no
// category crawling. Gives fresh prices and stock in a fraction of the time of a full scrape.
import path from 'node:path';
import { createHttp } from '../core/http.js';
import { mapPool } from '../core/pool.js';
import { writeXlsx } from '../core/excel.js';
import { getSource } from '../sources/index.js';

export async function scrapeLinks(sourceId, items, { outDir = 'output', log = console.log } = {}) {
  const source = getSource(sourceId);
  const ctx = { http: createHttp({ log }), log, addProduct: () => {} };
  const threads = source.concurrency ?? 2;
  let done = 0;
  const failed = [];
  const results = await mapPool(items, threads, async (item) => {
    try {
      return await source.parseProduct(item.link, item.category, ctx);
    } catch (err) {
      failed.push(item.link);
      log(`[${sourceId}] ${item.link} ERROR: ${err.message}`);
      throw err;
    } finally {
      if (++done % 100 === 0) log(`[${sourceId}] ${done}/${items.length}`);
    }
  });
  const products = results.map((r) => r.value).filter(Boolean);
  await writeXlsx(path.join(outDir, `${sourceId}.xlsx`), products, { log, ruNames: null });
  log(`[${sourceId}] ${products.length} of ${items.length} pages (${failed.length} failed)`);
  return { products: products.length, failed: failed.length };
}
