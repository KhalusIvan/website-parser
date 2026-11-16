// The shop's feed: one JSON line with the meta data, then one line per product (the same fields as
// mainmarket-catalog.json). The shop reads it line by line, so a big catalog needs little memory.
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tables } from '../catalog/write.js';

/** `extra`: more meta data (partial: sites with failed pages, keep: keys of products whose pages failed). */
export async function writeFeed(catalog, file, mode, extra = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const t = tables(catalog);
  const out = createWriteStream(file);
  const line = (obj) => new Promise((resolve) => (out.write(`${JSON.stringify(obj)}\n`) ? resolve() : out.once('drain', resolve)));
  await line({ meta: { built: new Date().toISOString().slice(0, 16).replace('T', ' '), mode, categories: t.categoryRows, brands: t.brandRows, products: t.productRows.length, ...extra } });
  for (const p of catalog.products) {
    await line({
      ...t.productRows[p.id - 1],
      attributes: p.specs.map(({ ua, ru, valueUa, valueRu }) => ({ ua, ru, valueUa, valueRu })),
      offers: p.offers,
    });
  }
  await new Promise((resolve) => out.end(resolve));
  return t.productRows.length;
}

/** The product pages behind the catalog, for the quick (price and stock) runs: [{ source, link, category, key }]. */
export function offerLinks(catalog) {
  const seen = new Set();
  const links = [];
  for (const p of catalog.products) {
    for (const o of p.offers) {
      if (!o.link || seen.has(o.link)) continue;
      seen.add(o.link);
      links.push({ source: o.source, link: o.link, category: o.category ?? '', key: p.key });
    }
  }
  return links;
}

/**
 * What the shop must not take from an incomplete run: sites that failed or lost some pages (their
 * texts wait for a complete run) and the keys of products whose pages failed or whose site failed
 * (they are not "gone"), found through the links of the previous run.
 */
export function incomplete(report, previousLinks) {
  const partial = Object.entries(report).filter(([, r]) => !r.ok || r.failedLinks?.length).map(([id]) => id);
  const failed = new Set(Object.values(report).flatMap((r) => r.failedLinks ?? []));
  const broken = new Set(Object.entries(report).filter(([, r]) => !r.ok).map(([id]) => id));
  const keep = new Set();
  for (const l of previousLinks) {
    if (l.key && (failed.has(l.link) || broken.has(l.source))) keep.add(l.key);
  }
  return { partial, keep: [...keep] };
}
