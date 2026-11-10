// Offline tests for the Telegram bot (bot/) and the progress reporter (src/notify/telegram.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBot, webhookSecret } from '../bot/bot.js';
import worker from '../bot/worker.js';
import generatedSources from '../bot/sources.generated.js';
import { describeSources } from '../src/sources/index.js';
import { createReporter, createTelegram } from '../src/notify/telegram.js';

const ENV = {
  TELEGRAM_BOT_TOKEN: '123:abc',
  GITHUB_TOKEN: 'gh-token',
  GITHUB_REPO: 'me/website-parser',
  GITHUB_REF: 'main',
  GITHUB_WORKFLOW: 'scrape.yml',
  ALLOWED_USER_IDS: '42, 43',
};
const NOW = Date.parse('2026-11-06T12:00:00Z');

/** Fake fetch for Telegram + GitHub. Records every call as { service, method, body }. */
function fakeApis({ runs = [] } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.startsWith('https://api.telegram.org/')) {
      const method = url.split('/').pop();
      calls.push({ service: 'telegram', method, body });
      return Response.json({ ok: true, result: { message_id: 100, username: 'test_bot' } });
    }
    const pathname = url.replace('https://api.github.com/repos/me/website-parser', '');
    calls.push({ service: 'github', method: init.method ?? 'GET', path: pathname, body });
    if (pathname.endsWith('/dispatches')) return new Response(null, { status: 204 });
    if (pathname.includes('/runs?')) return Response.json({ workflow_runs: runs });
    if (pathname.endsWith('/cancel')) return Response.json({}, { status: 202 });
    return Response.json({});
  };
  const sent = () => calls.filter((c) => c.service === 'telegram' && c.method !== 'answerCallbackQuery');
  const dispatches = () => calls.filter((c) => c.service === 'github' && c.path.endsWith('/dispatches'));
  return { calls, fetch, sent, dispatches };
}

const user = { id: 42 };
const chat = { id: 4242 };
const message = (text) => ({ update_id: 1, message: { message_id: 7, from: user, chat, text } });
const press = (data, text = '') => ({
  update_id: 2,
  callback_query: { id: 'q1', from: user, data, message: { message_id: 100, chat, text } },
});
const buttonData = (call) => call.body.reply_markup?.inline_keyboard.flat().map((b) => b.callback_data) ?? [];

test('generated bot sources match src/sources (run npm run bot:sources if this fails)', () => {
  assert.deepEqual(generatedSources, describeSources());
});

test('strangers are refused but can see their ID; nothing is started', async () => {
  const apis = fakeApis();
  const bot = createBot(ENV, { fetch: apis.fetch });
  await bot.handleUpdate({ message: { message_id: 1, from: { id: 999 }, chat: { id: 999 }, text: '/new' } });
  await bot.handleUpdate({ callback_query: { id: 'q', from: { id: 999 }, data: 'run:vroda:all:ua', message: { message_id: 1, chat } } });

  assert.match(apis.sent()[0].body.text, /приватний бот.*999/s);
  assert.equal(apis.calls.filter((c) => c.service === 'github').length, 0);
});

test('whole site: /new -> site -> mode -> language -> starts the workflow', async () => {
  const apis = fakeApis();
  const bot = createBot(ENV, { fetch: apis.fetch });

  await bot.handleUpdate(message('/new'));
  assert.deepEqual(buttonData(apis.sent()[0]), ['src:vroda', 'src:jrl']);

  await bot.handleUpdate(press('src:vroda'));
  assert.deepEqual(buttonData(apis.sent()[1]), ['mode:vroda:all', 'mode:vroda:category']);

  await bot.handleUpdate(press('mode:vroda:all'));
  assert.deepEqual(buttonData(apis.sent()[2]), ['run:vroda:all:ua', 'run:vroda:all:ru']);

  await bot.handleUpdate(press('run:vroda:all:ru'));
  const [dispatch] = apis.dispatches();
  assert.equal(dispatch.path, '/actions/workflows/scrape.yml/dispatches');
  assert.deepEqual(dispatch.body, {
    ref: 'main',
    inputs: { source: 'vroda', lang: 'ru', mode: 'all', url: '', chat_id: '4242' },
  });
  assert.match(apis.sent().at(-1).body.text, /Запущено.*Vroda · Русский · весь сайт/s);
});

test('category: send a link -> pick language -> starts the workflow with that URL', async () => {
  const apis = fakeApis();
  const bot = createBot(ENV, { fetch: apis.fetch });
  const url = 'https://www.vroda-ua.com/ru/uhod-za-licom-i-telom';

  await bot.handleUpdate(message(`please scrape ${url}`));
  const question = apis.sent()[0];
  assert.deepEqual(buttonData(question), ['url:ua', 'url:ru']);
  assert.equal(question.body.reply_parameters.message_id, 7);

  // Telegram sends back the bot's question (plain text) with the button press.
  await bot.handleUpdate(press('url:ua', `Vroda · ${url}\nWhich language?`));
  assert.deepEqual(apis.dispatches()[0].body.inputs, { source: 'vroda', lang: 'ua', mode: 'category', url, chat_id: '4242' });
});

test('a site with one language skips the language question (jrl)', async () => {
  const apis = fakeApis();
  const bot = createBot(ENV, { fetch: apis.fetch });

  await bot.handleUpdate(press('mode:jrl:all'));
  assert.deepEqual(apis.dispatches()[0].body.inputs, { source: 'jrl', lang: 'ua', mode: 'all', url: '', chat_id: '4242' });
  assert.match(apis.sent().at(-1).body.text, /Запущено.*JRL · Українська · весь сайт/s);

  await bot.handleUpdate(message('https://jrl.in.ua/komplektuyuchi/mashinki-1/'));
  assert.deepEqual(apis.dispatches()[1].body.inputs, {
    source: 'jrl', lang: 'ua', mode: 'category', url: 'https://jrl.in.ua/komplektuyuchi/mashinki-1/', chat_id: '4242',
  });
});

test('unknown website and GitHub errors are reported in the chat', async () => {
  const apis = fakeApis();
  const bot = createBot(ENV, { fetch: apis.fetch });
  await bot.handleUpdate(message('https://example.com/cat'));
  assert.match(apis.sent()[0].body.text, /не знаю цього сайту/);

  const failing = fakeApis();
  const failingFetch = async (url, init) =>
    url.includes('/dispatches') ? Response.json({ message: 'Bad credentials' }, { status: 401 }) : failing.fetch(url, init);
  await createBot(ENV, { fetch: failingFetch }).handleUpdate(press('run:vroda:all:ua'));
  assert.match(failing.sent().at(-1).body.text, /Не вдалося запустити.*401: Bad credentials/s);
});

test('/status lists runs with a cancel button for running ones', async () => {
  const runs = [
    { id: 11, run_number: 5, status: 'in_progress', display_title: 'vroda · ua · all', html_url: 'https://gh/run/11', created_at: '2026-11-06T11:40:00Z', run_started_at: '2026-11-06T11:40:00Z', updated_at: '2026-11-06T11:59:00Z' },
    { id: 10, run_number: 4, status: 'completed', conclusion: 'success', display_title: 'vroda · ru · all', html_url: 'https://gh/run/10', created_at: '2026-11-06T08:00:00Z', run_started_at: '2026-11-06T08:00:00Z', updated_at: '2026-11-06T08:47:00Z' },
  ];
  const apis = fakeApis({ runs });
  const bot = createBot(ENV, { fetch: apis.fetch, now: () => NOW });

  await bot.handleUpdate(message('/status'));
  const status = apis.sent()[0];
  assert.match(status.body.text, /🔄 .*vroda · ua · all.*триває 20 хв/s);
  assert.match(status.body.text, /✅ .*vroda · ru · all.*успішно · тривав 47 хв · 3 год тому/s);
  assert.deepEqual(buttonData(status), ['cancel:11', 'status']);

  await bot.handleUpdate(press('cancel:11'));
  assert.ok(apis.calls.some((c) => c.service === 'github' && c.method === 'POST' && c.path === '/actions/runs/11/cancel'));
});

test('worker rejects webhook calls without the secret and accepts Telegram ones', async () => {
  const update = JSON.stringify(message('/id'));
  const bad = await worker.fetch(new Request('https://bot.example/webhook', { method: 'POST', body: update }), ENV);
  assert.equal(bad.status, 403);

  const secret = await webhookSecret(ENV.TELEGRAM_BOT_TOKEN);
  assert.match(secret, /^[0-9a-f]{64}$/); // Telegram allows only A-Z a-z 0-9 _ -
  const realFetch = globalThis.fetch;
  const apis = fakeApis();
  globalThis.fetch = apis.fetch;
  try {
    const ok = await worker.fetch(
      new Request('https://bot.example/webhook', { method: 'POST', body: update, headers: { 'x-telegram-bot-api-secret-token': secret } }),
      ENV,
    );
    assert.equal(ok.status, 200);
    assert.match(apis.sent()[0].body.text, /Ваш Telegram ID: <code>42<\/code>/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('reporter keeps one progress message, then sends the Excel file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wp-'));
  const file = path.join(dir, 'vroda-UA.xlsx');
  writeFileSync(file, 'xlsx');

  const log = [];
  const telegram = {
    send: async (text) => (log.push(['send', text]), { message_id: 5 }),
    edit: async (id, text) => log.push(['edit', id, text]),
    sendDocument: async (filePath, caption) => log.push(['document', filePath, caption]),
  };
  let clock = 0;
  const reporter = createReporter({ telegram, title: 'Vroda · UA · whole site', runUrl: 'https://gh/run/1', now: () => clock, intervalMs: 1000, log: () => {} });

  await reporter.start();
  reporter.progress({ phase: 'products', done: 0, total: 10, failed: 0 });
  clock = 500;
  reporter.progress({ phase: 'products', done: 3, total: 10, failed: 0 }); // too soon -> skipped
  clock = 1500;
  reporter.progress({ phase: 'products', done: 6, total: 10, failed: 1 });
  clock = 3 * 60_000;
  await reporter.done({ products: 9, failed: 1 }, file);

  assert.deepEqual(log.map((entry) => entry[0]), ['send', 'edit', 'edit', 'edit', 'document']);
  assert.match(log[0][1], /Збираю посилання на товари/);
  assert.match(log[1][2], /0 \/ 10 \(0%\)/);
  assert.match(log[2][2], /6 \/ 10 \(60%\) · помилок: 1/);
  assert.match(log[3][2], /✅ .*Готово за 3 хв\. Товарів: 9, помилок: 1/s);
  assert.equal(log[4][1], file);
});

test('tokens never appear in error messages (chat, logs)', async () => {
  // A network error whose text contains the request URL (and so the bot token).
  const leakyFetch = async (url) => {
    throw new Error(`request to ${url} failed`);
  };
  const sent = [];
  const bot = createBot(ENV, {
    fetch: async (url, init) => {
      if (url.includes('/answerCallbackQuery')) {
        sent.push(JSON.parse(init.body).text);
        return Response.json({ ok: true, result: true });
      }
      if (url.includes('api.github.com')) throw new Error(`auth ${ENV.GITHUB_TOKEN} rejected`);
      return leakyFetch(url);
    },
  });
  await bot.handleUpdate(press('status'));
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /gh-token|123:abc/);
  assert.match(sent[0], /\*\*\*/);

  const telegram = createTelegram({ token: ENV.TELEGRAM_BOT_TOKEN, chatId: 1, fetch: leakyFetch });
  await assert.rejects(telegram.send('hi'), (err) => !err.message.includes('123:abc') && err.message.includes('bot***/sendMessage'));
});
