#!/usr/bin/env node
// Combines all scraped shops (output/<shop>-UA.xlsx, -RU.xlsx) into one catalog for Mainmarket.
//   npm run catalog                       # catalog + photos -> output/mainmarket/
//   npm run catalog -- --no-photos        # catalog only (photo columns stay empty; image_urls are filled)
//   npm run catalog -- --in output --out output/mainmarket
//   npm run catalog -- --partner output/database/partner.xlsx   # only the partner's products, partner codes
//                                         (default: the newest .xlsx/.csv in output/database; --partner none = off)
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildCatalog } from './build.js';
import { downloadPhotos, removeUnusedPhotos } from './photos.js';
import { writeCatalog, writeReview } from './write.js';

const { values } = parseArgs({
  options: {
    in: { type: 'string', default: 'output' },
    out: { type: 'string', default: 'output/mainmarket' },
    'no-photos': { type: 'boolean', default: false },
    partner: { type: 'string', default: '' },
  },
});

/** The newest partner list in <in>/database (.xlsx or .csv), or null. */
function newestPartnerList(dir) {
  const db = path.join(dir, 'database');
  try {
    return readdirSync(db)
      .filter((f) => /\.(xlsx|csv)$/i.test(f) && !f.startsWith('~$'))
      .map((f) => path.join(db, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
  } catch {
    return null;
  }
}
const partnerFile = values.partner === 'none' ? null : values.partner || newestPartnerList(values.in);
console.log(partnerFile ? `Partner list: ${partnerFile}` : 'No partner list: all products, shop articles as SKU');

const started = Date.now();
const catalog = await buildCatalog({ dir: values.in, partnerFile });
if (!values['no-photos']) {
  await downloadPhotos(catalog.products, values.out);
  removeUnusedPhotos(catalog.products, values.out);
}
const { counts } = await writeCatalog(catalog, values.out);
await writeReview(catalog.review, values.out);
console.log(`Done in ${Math.round((Date.now() - started) / 60000)} min:`, counts);
