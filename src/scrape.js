import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHttp } from './core/http.js';
import { mapPool } from './core/pool.js';
import { writeXlsx } from './core/excel.js';
import { alignAttributes } from './core/align.js';
import { russianPairer } from './core/pair.js';
import { getSource } from './sources/index.js';

function slugFromUrl(url) {
  try {
    // Last path part, ignoring a page number ("/category/page-2") and the "index.php" of plain links;
    // Cyrillic links are decoded, so the file name stays readable.
    const parts = decodeURIComponent(new URL(url).pathname)
      .split('/')
      .filter((part) => part && !/^page-\d+$/i.test(part) && part !== 'index.php');
    const last = parts.pop() ?? 'category';
    return last.replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'category';
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

/** Output file name (without extension), e.g. "vroda" or "vroda-maslo-dlya-...". */
export function outputName({ source, mode, url }) {
  return mode === 'all' ? source : `${source}-${slugFromUrl(url)}`;
}

/** The site's languages, Ukrainian first ("ua" is the main language of every file). */
export const languagesOf = (source) => Object.keys(source.languages).sort((a, b) => (a === 'ua' ? -1 : b === 'ua' ? 1 : 0));

/**
 * Collects and parses one language of a site. Returns { products (in site order), failed }.
 * `report(done, total, failed)` is called after every product.
 */
async function scrapeLanguage(source, lang, { mode, url, limit, threads, ctx, log, report }) {
  log(`Collecting product links from ${source.name} (${lang}, ${mode})...`);
  const links = await source.collectLinks({ lang, mode, url }, ctx);
  let entries = [...links.entries()];
  if (limit > 0) entries = entries.slice(0, limit);
  log(`Found ${entries.length} products (${lang})`);

  // A source can report more products it finds on a product page (e.g. colour variants that are
  // not listed in any category) with ctx.addProduct(link, extra). They are scraped in further
  // rounds and placed right after the product that linked them. Not used with --limit (quick tests).
  const known = new Set(entries.map(([link]) => link));
  let queue = entries.map(([link, extra], i) => ({ link, extra, order: [i], found: [] }));
  const scraped = []; // { order, product }
  const failed = [];
  let total = queue.length;
  let done = 0;
  let counter = 0;
  report(done, total, failed.length);

  for (let round = 1; queue.length && round <= MAX_ROUNDS; round++) {
    const results = await mapPool(queue, threads, async (item) => {
      const n = counter++;
      const pageCtx = { ...ctx, addProduct: (link, extra) => item.found.push({ link, extra }) };
      try {
        const product = await source.parseProduct(item.link, item.extra, pageCtx);
        log(`[${lang} ${++done}/${total}] ${item.link} (N-${n}) collected`);
        return product;
      } catch (err) {
        failed.push(item.link);
        log(`[${lang} ${++done}/${total}] ${item.link} (N-${n}) ERROR: ${err.message}`);
        throw err;
      } finally {
        report(done, total, failed.length);
      }
    });

    // Next round: new links, taken in file order so the result doesn't depend on timing.
    const next = [];
    queue.forEach((item, i) => {
      if (results[i].value) scraped.push({ order: item.order, product: results[i].value });
      if (limit > 0) return;
      for (const { link, extra } of item.found) {
        if (known.has(link)) continue;
        known.add(link);
        next.push({ link, extra, order: [...item.order, next.length], found: [] });
      }
    });
    if (next.length) log(`Found ${next.length} more products on product pages (${lang})`);
    total += next.length;
    queue = next;
  }

  scraped.sort((a, b) => compareOrder(a.order, b.order));
  return { products: scraped.map((s) => s.product), failed };
}

/**
 * Adds the Russian version to every Ukrainian product (product.ru = { link, name, category,
 * description, specs } with specs keyed by the Ukrainian attribute name where the two match).
 * Russian products without a Ukrainian one are added at the end (Russian fields only).
 * Returns { products, ruNames: Map(ukrainian attribute -> russian attribute), unpaired }.
 */
export function combineLanguages(uaProducts, ruProducts) {
  const findRu = russianPairer(ruProducts);
  const pairs = uaProducts.map((ua) => ({ ua, ru: findRu(ua) }));
  const extra = findRu.unpaired();

  // which Russian attribute is which Ukrainian one (same products, equal/similar values)
  const aligned =
    alignAttributes(pairs.filter((p) => p.ru).map((p) => ({ source: 's', ua: { specs: p.ua.specs }, ru: { specs: p.ru.specs } }))).get('s') ??
    new Map();
  const ruToUa = new Map([...aligned].map(([u, r]) => [r, u]));
  const ruSpecs = (specs) =>
    Object.fromEntries(Object.entries(specs).map(([name, value]) => [ruToUa.get(name) ?? `${name}`, value]));
  const russian = (p) => ({ link: p.link, name: p.name, category: p.category, description: p.description, specs: ruSpecs(p.specs) });

  const products = pairs.map(({ ua, ru }) => ({ ...ua, ru: ru ? russian(ru) : null }));
  for (const ru of extra) {
    products.push({ ...ru, link: '', name: '', category: '', description: '', specs: {}, ru: russian(ru) });
  }
  // Russian names of the attributes: aligned ones, plus Russian-only attributes (kept under their own name)
  const ruNames = new Map(aligned);
  for (const p of ruProducts) for (const name of Object.keys(p.specs)) if (!ruToUa.has(name)) ruNames.set(name, name);
  return { products, ruNames, unpaired: extra.length };
}

/**
 * Runs a full scrape of a site in all its languages and writes one Excel file (Ukrainian columns,
 * then " (ru)" columns for the Russian version). Returns a summary { file, products, failed, ... }
 * that is also saved next to the file as JSON.
 * `onProgress` is called with { phase: 'collect', lang } and { phase: 'products', lang, done, total,
 * failed } after every product (used for Telegram progress messages).
 */
export async function scrape({
  source: sourceId,
  mode = 'all',
  url = '',
  outDir = 'output',
  concurrency,
  limit = 0,
  log = console.log,
  http = createHttp({ log }),
  onProgress,
}) {
  // A source id, or a source object (lets a new source be tried before it is registered).
  const source = typeof sourceId === 'object' ? sourceId : getSource(sourceId);
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
  const threads = concurrency ?? source.concurrency ?? 2;
  const langs = languagesOf(source);

  const results = {};
  for (const lang of langs) {
    progress({ phase: 'collect', lang, langs });
    results[lang] = await scrapeLanguage(source, lang, {
      mode,
      url,
      limit,
      threads,
      ctx,
      log,
      report: (done, total, failed) => progress({ phase: 'products', lang, langs, done, total, failed }),
    });
  }

  const [main, second] = langs;
  let products = results[main].products;
  let ruNames = new Map();
  let unpaired = 0;
  if (second) {
    ({ products, ruNames, unpaired } = combineLanguages(results[main].products, results[second].products));
    const paired = products.filter((p) => p.ru && p.link).length;
    log(`Russian version found for ${paired} of ${results[main].products.length} products${unpaired ? `; ${unpaired} Russian-only products added` : ''}`);
  }

  const name = outputName({ source: source.id, mode, url });
  const file = path.join(outDir, `${name}.xlsx`);
  await writeXlsx(file, products, { log, ruNames: second ? ruNames : null });

  const failed = langs.flatMap((l) => results[l].failed);
  const summary = {
    file: path.basename(file),
    source: source.id,
    sourceName: source.name,
    languages: langs,
    mode,
    url: mode === 'all' ? '' : url,
    products: products.length,
    withRussian: second ? products.filter((p) => p.ru).length : 0,
    russianOnly: unpaired,
    failed: failed.length,
    failedLinks: failed.slice(0, 200),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
  await writeFile(`${file}.json`, JSON.stringify(summary, null, 2));
  log(`Done: ${products.length} products written to ${file}${failed.length ? ` (${failed.length} failed)` : ''}`);
  return { ...summary, failedLinks: failed }; // all of them (the file keeps the first 200)
}
