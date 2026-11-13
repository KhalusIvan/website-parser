#!/usr/bin/env node
// Combines all scraped shops (output/<shop>-UA.xlsx, -RU.xlsx) into one catalog for Mainmarket.
//   npm run catalog                       # catalog + photos -> output/mainmarket/
//   npm run catalog -- --no-photos        # catalog only (photo columns stay empty; image_urls are filled)
//   npm run catalog -- --in output --out output/mainmarket
import { parseArgs } from 'node:util';
import { buildCatalog } from './build.js';
import { downloadPhotos } from './photos.js';
import { writeCatalog } from './write.js';

const { values } = parseArgs({
  options: {
    in: { type: 'string', default: 'output' },
    out: { type: 'string', default: 'output/mainmarket' },
    'no-photos': { type: 'boolean', default: false },
  },
});

const started = Date.now();
const catalog = await buildCatalog({ dir: values.in });
if (!values['no-photos']) await downloadPhotos(catalog.products, values.out);
const { counts } = await writeCatalog(catalog, values.out);
console.log(`Done in ${Math.round((Date.now() - started) / 60000)} min:`, counts);
