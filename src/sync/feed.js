// The shop's feed: one JSON line with the meta data, then one line per product (the same fields as
// mainmarket-catalog.json). The shop reads it line by line, so a big catalog needs little memory.
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tables } from '../catalog/write.js';

export async function writeFeed(catalog, file, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  const t = tables(catalog);
  const out = createWriteStream(file);
  const line = (obj) => new Promise((resolve) => (out.write(`${JSON.stringify(obj)}\n`) ? resolve() : out.once('drain', resolve)));
  await line({ meta: { built: new Date().toISOString().slice(0, 16).replace('T', ' '), mode, categories: t.categoryRows, brands: t.brandRows, products: t.productRows.length } });
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

/** The product pages behind the catalog, for the quick (price and stock) runs: [{ source, link, category }]. */
export function offerLinks(catalog) {
  const seen = new Set();
  const links = [];
  for (const p of catalog.products) {
    for (const o of p.offers) {
      if (!o.link || seen.has(o.link)) continue;
      seen.add(o.link);
      links.push({ source: o.source, link: o.link, category: o.category ?? '' });
    }
  }
  return links;
}
