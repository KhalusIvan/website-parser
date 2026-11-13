#!/usr/bin/env node
// Usage:
//   node src/cli.js                                   (asks everything interactively)
//   node src/cli.js vroda --mode all                  (all the site's languages in one file)
//   node src/cli.js vroda --mode category --url https://vroda-ua.com/...
// Options: --out-dir output  --concurrency 2  --limit 0 (0 = no limit, handy for quick tests)
//          --telegram-chat <chat id>  send progress + the Excel file to Telegram
//                                     (bot token in the TELEGRAM_BOT_TOKEN env variable)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { sources, getSource } from './sources/index.js';
import { scrape } from './scrape.js';
import { createReporter, createTelegram } from './notify/telegram.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: 'string' },
    url: { type: 'string' },
    'out-dir': { type: 'string', default: 'output' },
    concurrency: { type: 'string' },
    limit: { type: 'string', default: '0' },
    'telegram-chat': { type: 'string', default: '' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(`node src/cli.js <source> --mode <mode> [--url <category url>]
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

/** Telegram reporter, when --telegram-chat is given (e.g. "Vroda · весь сайт"). */
function telegramReporter(chatId, source, mode, url) {
  if (!chatId) return null;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('--telegram-chat is set but TELEGRAM_BOT_TOKEN is not - not sending anything to Telegram');
    return null;
  }
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const runUrl = GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : '';
  const title = [source.name, mode === 'all' ? 'весь сайт' : url || mode].join(' · ');
  return createReporter({ telegram: createTelegram({ token, chatId }), title, runUrl });
}

/** Tells the workflow that the final Telegram message was sent (so it doesn't send a second one). */
async function markNotified() {
  await mkdir(values['out-dir'], { recursive: true });
  await writeFile(path.join(values['out-dir'], '.telegram-notified'), new Date().toISOString());
}

let reporter = null;
try {
  const sourceId = positionals[0] ?? (await ask('Source', sources.map((s) => s.id)));
  const source = getSource(sourceId);
  const mode = values.mode ?? (await ask('Mode', Object.keys(source.modes)));
  const url = values.url ?? (source.modes[mode]?.needsUrl ? await ask('Category URL') : '');
  rl?.close();

  reporter = telegramReporter(values['telegram-chat'], source, mode, url);
  await reporter?.start();
  const summary = await scrape({
    source: sourceId,
    mode,
    url,
    outDir: values['out-dir'],
    concurrency: values.concurrency ? Number(values.concurrency) : undefined,
    limit: Number(values.limit),
    onProgress: reporter?.progress,
  });
  if (reporter) {
    await reporter.done(summary, path.join(values['out-dir'], summary.file));
    await markNotified();
  }
  process.exit(summary.products > 0 ? 0 : 1);
} catch (err) {
  rl?.close();
  console.error(`Error: ${err.message}`);
  if (reporter) {
    await reporter.fail(err);
    await markNotified().catch(() => {});
  }
  process.exit(1);
}
