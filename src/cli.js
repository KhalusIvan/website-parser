#!/usr/bin/env node
// Usage:
//   node src/cli.js                                   (asks everything interactively)
//   node src/cli.js vroda --lang ua --mode all
//   node src/cli.js vroda --lang ru --mode category --url https://vroda-ua.com/...
// Options: --out-dir output  --concurrency 2  --limit 0 (0 = no limit, handy for quick tests)
import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { sources, getSource } from './sources/index.js';
import { scrape } from './scrape.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    lang: { type: 'string' },
    mode: { type: 'string' },
    url: { type: 'string' },
    'out-dir': { type: 'string', default: 'output' },
    concurrency: { type: 'string' },
    limit: { type: 'string', default: '0' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(`node src/cli.js <source> --lang <lang> --mode <mode> [--url <category url>]
Sources:`);
  for (const s of sources) {
    console.log(`  ${s.id.padEnd(10)} ${s.website}  langs: ${Object.keys(s.languages).join(', ')}  modes: ${Object.keys(s.modes).join(', ')}`);
  }
  process.exit(0);
}

let rl;
async function ask(question, allowed) {
  rl ??= readline.createInterface({ input: stdin, output: stdout });
  for (;;) {
    const answer = (await rl.question(`${question}${allowed ? ` (${allowed.join(', ')})` : ''}: `)).trim();
    if (!allowed || allowed.includes(answer)) return answer;
    console.log('Unknown value, try again');
  }
}

try {
  const sourceId = positionals[0] ?? (await ask('Source', sources.map((s) => s.id)));
  const source = getSource(sourceId);
  const lang = values.lang ?? (await ask('Language', Object.keys(source.languages)));
  const mode = values.mode ?? (await ask('Mode', Object.keys(source.modes)));
  const url = values.url ?? (source.modes[mode]?.needsUrl ? await ask('Category URL') : '');
  rl?.close();

  const summary = await scrape({
    source: sourceId,
    lang,
    mode,
    url,
    outDir: values['out-dir'],
    concurrency: values.concurrency ? Number(values.concurrency) : undefined,
    limit: Number(values.limit),
  });
  process.exit(summary.products > 0 ? 0 : 1);
} catch (err) {
  rl?.close();
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
