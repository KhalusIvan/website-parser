// Telegram bot: asks what to scrape (buttons) and starts the "Scrape" GitHub Actions workflow.
// The workflow does the scraping and sends progress + the Excel file back to the same chat.
// Runs on Cloudflare Workers (see worker.js). Uses only fetch/crypto, no Node APIs.
import SOURCES from './sources.generated.js';

const URL_RE = /https?:\/\/[^\s<>"']+/i;
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

// All texts in one place, so they are easy to change or translate.
const TEXT = {
  help:
    'I scrape online shops and send you the product catalog as an Excel file.\n\n' +
    '/new – scrape a whole website\n' +
    '/status – recent scrapes (and cancel a running one)\n' +
    'Or just send me a link to a category to scrape only that category.\n\n' +
    'A whole website takes about 30–60 minutes. I post progress here and send the file when it is ready.',
  notAllowed: (id) =>
    `Sorry, this is a private bot.\nYour Telegram ID is <code>${id}</code> – the owner can add it to ALLOWED_USER_IDS.`,
  chooseSource: 'Which website?',
  chooseMode: (s) => `<b>${esc(s.name)}</b> – what should I scrape?`,
  chooseLang: (s, what) => `<b>${esc(s.name)}</b> · ${esc(what)}\nWhich language?`,
  sendLink: (s) => `Send me a link to a category on ${esc(s.website)}`,
  unknownSite: (url) =>
    `I don't know this website: ${esc(url)}\nI can scrape: ${SOURCES.map((s) => esc(s.website)).join(', ')}`,
  noCategoryMode: (s) => `${esc(s.name)} can only be scraped as a whole site: /new`,
  unknown: 'Send /new to start a scrape, or a category link.',
  starting: (job) => `⏳ Starting: ${esc(job)}…`,
  started: (job) =>
    `✅ <b>Started</b>: ${esc(job)}\nI'll post progress here and send the Excel file when it's done.\n/status – check progress`,
  startFailed: (job, err) => `❌ Could not start ${esc(job)}\n${esc(err.message)}`,
  noRuns: 'No scrapes yet. Send /new to start one.',
};

const esc = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const sourceById = (id) => {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`Unknown website "${id}"`);
  return source;
};
const sourceForUrl = (url) => SOURCES.find((s) => hostOf(s.website) === hostOf(url));
const urlMode = (source) => Object.keys(source.modes).find((m) => source.modes[m].needsUrl);

/** "Vroda · Українська · whole site" or "Vroda · Русский · https://..." */
export const jobTitle = (source, mode, lang, url) =>
  [source.name, source.languages[lang] ?? lang, url || (mode === 'all' ? 'whole site' : mode)].join(' · ');

function minutes(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function ago(date, now) {
  const m = Math.round((now - Date.parse(date)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/** Telegram checks this secret on every webhook call, so only Telegram can talk to the worker. */
export async function webhookSecret(botToken) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`website-parser:${botToken}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * env: TELEGRAM_BOT_TOKEN, GITHUB_TOKEN (secrets), GITHUB_REPO, GITHUB_REF, GITHUB_WORKFLOW,
 *      ALLOWED_USER_IDS (comma-separated Telegram user IDs).
 */
export function createBot(env, { fetch: http = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const repo = env.GITHUB_REPO;
  const workflow = env.GITHUB_WORKFLOW || 'scrape.yml';
  const ref = env.GITHUB_REF || 'main';
  const allowed = new Set(String(env.ALLOWED_USER_IDS ?? '').split(/[\s,]+/).filter(Boolean));
  const isAllowed = (user) => allowed.has(String(user?.id));

  // Error texts can be shown in the chat and in the Cloudflare logs - keep the tokens out of them.
  const redact = (text) =>
    [env.TELEGRAM_BOT_TOKEN, env.GITHUB_TOKEN].reduce((t, secret) => (secret ? t.split(secret).join('***') : t), String(text));

  async function telegram(method, body) {
    try {
      const res = await http(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
      if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
      return data.result;
    } catch (err) {
      throw new Error(redact(err.message));
    }
  }

  async function github(path, options) {
    try {
      return await githubRequest(path, options);
    } catch (err) {
      throw new Error(redact(err.message));
    }
  }

  async function githubRequest(path, { method = 'GET', body } = {}) {
    const res = await http(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'user-agent': 'website-parser-bot',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        message = JSON.parse(text).message ?? text;
      } catch {}
      throw new Error(`GitHub API ${res.status}: ${message.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  // ---- sending views (text + buttons) ----

  const textOptions = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  const buttons = (list) => ({ reply_markup: { inline_keyboard: list.map((b) => [{ text: b[0], callback_data: b[1] }]) } });
  const send = (chatId, view, extra = {}) =>
    telegram('sendMessage', { chat_id: chatId, text: view.text, ...textOptions, ...view.extra, ...extra });

  async function edit(message, view) {
    try {
      await telegram('editMessageText', {
        chat_id: message.chat.id,
        message_id: message.message_id,
        text: view.text,
        ...textOptions,
        ...view.extra,
      });
    } catch (err) {
      if (!/message is not modified/i.test(err.message)) throw err;
    }
  }

  // ---- the conversation steps ----

  function sourceMenu() {
    if (SOURCES.length === 1) return modeMenu(SOURCES[0]);
    return {
      text: TEXT.chooseSource,
      extra: buttons(SOURCES.map((s) => [`${s.name} (${hostOf(s.website)})`, `src:${s.id}`])),
    };
  }

  function modeMenu(source) {
    return {
      text: TEXT.chooseMode(source),
      extra: buttons(Object.entries(source.modes).map(([id, m]) => [m.label, `mode:${source.id}:${id}`])),
    };
  }

  function langMenu(source, what, dataPrefix) {
    return {
      text: TEXT.chooseLang(source, what),
      extra: buttons(Object.entries(source.languages).map(([id, label]) => [label, `${dataPrefix}:${id}`])),
    };
  }

  /** Starts the workflow and returns the view that replaces the menu. */
  async function startRun(chatId, source, mode, lang, url = '') {
    const job = jobTitle(source, mode, lang, url);
    try {
      await github(`/actions/workflows/${workflow}/dispatches`, {
        method: 'POST',
        body: { ref, inputs: { source: source.id, lang, mode, url, chat_id: String(chatId) } },
      });
      return { text: TEXT.started(job) };
    } catch (err) {
      return { text: TEXT.startFailed(job, err) };
    }
  }

  async function statusView() {
    const data = await github(`/actions/workflows/${workflow}/runs?per_page=5`);
    const runs = data?.workflow_runs ?? [];
    if (!runs.length) return { text: TEXT.noRuns };

    const lines = runs.map((run) => {
      const active = ACTIVE.has(run.status);
      const started = run.run_started_at ?? run.created_at;
      let icon;
      let state;
      if (active) {
        icon = run.status === 'in_progress' ? '🔄' : '⏳';
        state = run.status === 'in_progress' ? `running for ${minutes(now() - Date.parse(started))}` : 'waiting to start';
      } else {
        icon = { success: '✅', failure: '❌', cancelled: '⏹' }[run.conclusion] ?? '⚠️';
        const took = minutes(Date.parse(run.updated_at) - Date.parse(started));
        state = `${run.conclusion ?? run.status} · took ${took} · ${ago(run.updated_at, now())}`;
      }
      return `${icon} <a href="${esc(run.html_url)}">${esc(run.display_title ?? run.name)}</a>\n      ${state}`;
    });

    const list = runs
      .filter((run) => ACTIVE.has(run.status))
      .map((run) => [`⏹ Cancel #${run.run_number}`, `cancel:${run.id}`]);
    list.push(['🔄 Refresh', 'status']);
    return { text: lines.join('\n\n'), extra: buttons(list) };
  }

  // ---- update handlers ----

  async function onMessage(message) {
    const chatId = message.chat.id;
    const text = message.text.trim();
    const command = text.startsWith('/') ? text.slice(1).split(/[\s@]/)[0].toLowerCase() : '';

    if (command === 'id') return send(chatId, { text: `Your Telegram ID: <code>${message.from.id}</code>` });
    if (!isAllowed(message.from)) return send(chatId, { text: TEXT.notAllowed(message.from.id) });

    if (command === 'start' || command === 'help') {
      await send(chatId, { text: TEXT.help });
      return send(chatId, sourceMenu());
    }
    if (command === 'new') return send(chatId, sourceMenu());
    if (command === 'status') return send(chatId, await statusView());

    const url = text.match(URL_RE)?.[0];
    if (!url) return send(chatId, { text: TEXT.unknown });

    const source = sourceForUrl(url);
    if (!source) return send(chatId, { text: TEXT.unknownSite(url) });
    const mode = urlMode(source);
    if (!mode) return send(chatId, { text: TEXT.noCategoryMode(source) });

    const langs = Object.keys(source.languages);
    if (langs.length === 1) return send(chatId, await startRun(chatId, source, mode, langs[0], url));
    // The URL is repeated in the question, so the button handler can read it back from the message.
    return send(chatId, langMenu(source, url, 'url'), { reply_parameters: { message_id: message.message_id } });
  }

  async function onCallback(query) {
    const message = query.message;
    if (!isAllowed(query.from)) {
      return telegram('answerCallbackQuery', { callback_query_id: query.id, text: 'Not allowed', show_alert: true });
    }

    let notice = '';
    try {
      const [action, ...args] = String(query.data ?? '').split(':');
      switch (action) {
        case 'src':
          await edit(message, modeMenu(sourceById(args[0])));
          break;

        case 'mode': {
          const source = sourceById(args[0]);
          const mode = args[1];
          const langs = Object.keys(source.languages);
          if (source.modes[mode]?.needsUrl) await edit(message, { text: TEXT.sendLink(source) });
          else if (langs.length === 1) await edit(message, await startRun(message.chat.id, source, mode, langs[0]));
          else await edit(message, langMenu(source, source.modes[mode]?.label ?? mode, `run:${source.id}:${mode}`));
          break;
        }

        case 'run': {
          const [id, mode, lang] = args;
          const source = sourceById(id);
          await edit(message, { text: TEXT.starting(jobTitle(source, mode, lang)) }); // removes the buttons
          await edit(message, await startRun(message.chat.id, source, mode, lang));
          break;
        }

        case 'url': {
          const url = (message.text ?? '').match(URL_RE)?.[0] ?? message.reply_to_message?.text?.match(URL_RE)?.[0];
          const source = url && sourceForUrl(url);
          if (!source) throw new Error('Link not found, please send it again');
          const lang = args[0];
          await edit(message, { text: TEXT.starting(jobTitle(source, urlMode(source), lang, url)) });
          await edit(message, await startRun(message.chat.id, source, urlMode(source), lang, url));
          break;
        }

        case 'status':
          await edit(message, await statusView());
          notice = 'Updated';
          break;

        case 'cancel':
          await github(`/actions/runs/${Number(args[0])}/cancel`, { method: 'POST' });
          notice = 'Cancelling…';
          await edit(message, await statusView());
          break;

        default:
          notice = 'Unknown button';
      }
    } catch (err) {
      notice = err.message.slice(0, 190);
    }
    return telegram('answerCallbackQuery', { callback_query_id: query.id, text: notice });
  }

  return {
    async handleUpdate(update) {
      if (update.callback_query) return onCallback(update.callback_query);
      if (update.message?.text) return onMessage(update.message);
      return null;
    },

    /** Registers the webhook and the command menu; returns a config check. Called via GET /setup. */
    async setup(webhookUrl) {
      const missing = ['TELEGRAM_BOT_TOKEN', 'GITHUB_TOKEN', 'GITHUB_REPO'].filter((key) => !env[key]);
      if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, missing };

      const me = await telegram('getMe', {});
      await telegram('setWebhook', {
        url: webhookUrl,
        secret_token: await webhookSecret(env.TELEGRAM_BOT_TOKEN),
        allowed_updates: ['message', 'callback_query'],
      });
      await telegram('setMyCommands', {
        commands: [
          { command: 'new', description: 'Scrape a whole website' },
          { command: 'status', description: 'Recent scrapes' },
          { command: 'help', description: 'How to use the bot' },
          { command: 'id', description: 'Show my Telegram ID' },
        ],
      });

      let githubCheck = 'skipped (token or repo missing)';
      if (env.GITHUB_TOKEN && repo) {
        try {
          await github(`/actions/workflows/${workflow}`);
          githubCheck = 'ok';
        } catch (err) {
          githubCheck = err.message;
        }
      }
      return {
        ok: missing.length === 0 && githubCheck === 'ok' && allowed.size > 0,
        bot: `@${me.username}`,
        webhook: webhookUrl,
        github: githubCheck,
        allowedUsers: allowed.size || 'none yet - send /id to the bot and put the number in ALLOWED_USER_IDS',
        missing,
      };
    },
  };
}
