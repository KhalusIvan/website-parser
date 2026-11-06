#!/usr/bin/env node
// Builds the GitHub Pages site into --out (default _site):
//   site/*                -> the web UI
//   sources.json          -> list of sources (from src/sources)
//   config.json           -> owner/repo the UI talks to
//   files/*.xlsx + index.json -> latest Excel files (from --files, e.g. the downloaded "data" release)
// Local preview: npm run site  (uses ./output as files dir), then open http://localhost:8080
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { describeSources } from '../src/sources/index.js';

const { values } = parseArgs({
  options: {
    files: { type: 'string', default: 'output' },
    out: { type: 'string', default: '_site' },
  },
});

const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(values.out);
const filesDir = path.resolve(values.files);

await rm(out, { recursive: true, force: true });
await cp(path.join(root, 'site'), out, { recursive: true });
await writeFile(path.join(out, 'sources.json'), JSON.stringify(describeSources(), null, 2));

const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? 'KhalusIvan/website-parser').split('/');
await writeFile(
  path.join(out, 'config.json'),
  JSON.stringify({ owner, repo, branch: process.env.GITHUB_REF_NAME || 'main', workflow: 'scrape.yml' }, null, 2),
);

const index = [];
await mkdir(path.join(out, 'files'), { recursive: true });
if (existsSync(filesDir)) {
  for (const name of (await readdir(filesDir)).filter((f) => f.endsWith('.xlsx')).sort()) {
    const src = path.join(filesDir, name);
    await cp(src, path.join(out, 'files', name));
    const info = await stat(src);
    let meta = {};
    try {
      meta = JSON.parse(await readFile(`${src}.json`, 'utf8'));
    } catch {
      // no summary next to the file - fall back to what we can guess from the name
      const [source, lang] = name.replace(/\.xlsx$/, '').split('-');
      meta = { source, lang: lang?.toLowerCase(), finishedAt: info.mtime.toISOString() };
    }
    delete meta.failedLinks;
    index.push({ ...meta, file: name, size: info.size });
  }
}
await writeFile(path.join(out, 'files', 'index.json'), JSON.stringify(index, null, 2));
console.log(`Site built in ${out} (${index.length} Excel files)`);
