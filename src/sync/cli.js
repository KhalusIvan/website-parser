#!/usr/bin/env node
// The shop's automatic update (started by the shop through GitHub Actions, workflow sync.yml).
//   node src/sync/cli.js --mode full    all sites, both languages -> output/site-feed.ndjson + output/offers.json
//   node src/sync/cli.js --mode quick   only the product pages from output/offers.json (last full run):
//                                       prices and stock -> output/site-feed.ndjson
// The partner list comes from data/partner.json (the shop writes it when a new partner file is sent
// to its bot). Photos are not downloaded here: the shop downloads the photos of new products itself.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sources } from '../sources/index.js';
import { scrape } from '../scrape.js';
import { buildCatalog } from '../catalog/build.js';
import { incomplete, offerLinks, writeFeed } from './feed.js';
import { scrapeLinks } from './quick.js';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'quick' },
    out: { type: 'string', default: 'output' },
    partner: { type: 'string', default: 'data/partner.json' },
    only: { type: 'string', default: '' }, // tests: some sources only (comma separated)
    limit: { type: 'string', default: '0' }, // tests: products per source
  },
});

const out = values.out;
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
// these three sites share one server that blocks fast visitors: one after another, never together
const SHARED = ['gama', 'moser', 'spl4barber'];

async function inGroups(ids, work) {
  const shared = ids.filter((id) => SHARED.includes(id));
  const free = ids.filter((id) => !SHARED.includes(id));
  const results = {};
  const run = async (id) => {
    const t = Date.now();
    try {
      results[id] = { ok: true, ...(await work(id)) };
    } catch (err) {
      results[id] = { ok: false, error: err.message };
      log(`${id}: FAILED ${err.message}`);
    }
    results[id].minutes = Math.round((Date.now() - t) / 6000) / 10;
    log(`${id}: done in ${results[id].minutes} min`);
  };
  await Promise.all([
    (async () => {
      for (const id of shared) await run(id);
    })(),
    ...free.map(run),
  ]);
  return results;
}

let mode = values.mode === 'full' ? 'full' : 'quick';
const offersFile = path.join(out, 'offers.json');
if (mode === 'quick' && !existsSync(offersFile)) {
  log('No list of product pages from a full run yet - doing a full run instead');
  mode = 'full';
}
const ids = (values.only ? values.only.split(',') : sources.map((s) => s.id)).map((s) => s.trim()).filter(Boolean);
await mkdir(out, { recursive: true });
for (const id of ids) await rm(path.join(out, `${id}.xlsx`), { force: true });
const started = Date.now();

// the product pages of the previous full run (with the products' keys)
const previousLinks = existsSync(offersFile) ? JSON.parse(readFileSync(offersFile, 'utf8')) : [];

let report;
if (mode === 'full') {
  report = await inGroups(ids, async (id) => {
    const s = await scrape({ source: id, mode: 'all', outDir: out, limit: Number(values.limit), log: (m) => (/ERROR|Found|Done|blocked/.test(m) ? log(`[${id}] ${m}`) : null) });
    return { products: s.products, failed: s.failed, failedLinks: s.failedLinks };
  });
} else {
  const bySource = {};
  for (const l of previousLinks) (bySource[l.source] ??= []).push(l);
  report = await inGroups(ids.filter((id) => bySource[id]), (id) => scrapeLinks(id, Number(values.limit) > 0 ? bySource[id].slice(0, Number(values.limit)) : bySource[id], { outDir: out, log }));
}

const partnerFile = existsSync(values.partner) ? values.partner : null;
log(partnerFile ? `Partner list: ${partnerFile}` : 'No partner list (data/partner.json): all products');
const catalog = await buildCatalog({ dir: out, partnerFile, log });
const { partial, keep } = incomplete(report, previousLinks);
if (partial.length) log(`Incomplete sites: ${partial.join(', ')}; products kept as they are: ${keep.length}`);
const n = await writeFeed(catalog, path.join(out, 'site-feed.ndjson'), mode, { partial, keep });
if (mode === 'full') {
  await writeFile(offersFile, JSON.stringify(offerLinks(catalog)));
  await writeFile(path.join(out, 'offers.fresh'), new Date().toISOString()); // tells the workflow to keep it
}
// the report without the (long) lists of failed pages
const bySite = Object.fromEntries(Object.entries(report).map(([id, { failedLinks, ...r }]) => [id, r]));
const summary = { mode, products: n, minutes: Math.round((Date.now() - started) / 6000) / 10, sources: bySite, partial, kept: keep.length };
await writeFile(path.join(out, 'sync-report.json'), JSON.stringify(summary, null, 2));
log(`Feed: ${n} products, ${summary.minutes} min`);
const broken = Object.entries(report).filter(([, r]) => !r.ok).map(([id]) => id);
if (broken.length) log(`Sites that failed: ${broken.join(', ')}`);
process.exit(n > 0 ? 0 : 1);
