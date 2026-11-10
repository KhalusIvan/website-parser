// Sends scrape progress and the finished Excel file to a Telegram chat.
// Used by the CLI when it runs in GitHub Actions (started from the Telegram bot in bot/).
import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

/** Telegram bots can upload files up to 50 MB. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'менш ніж хвилину';
  if (minutes < 60) return `${minutes} хв`;
  return `${Math.floor(minutes / 60)} год ${minutes % 60} хв`;
}

/** Replaces every occurrence of `secret` in `text` with "***". */
export const redact = (text, secret) => (secret ? String(text).split(secret).join('***') : String(text));

/** Minimal Telegram Bot API client bound to one chat. */
export function createTelegram({ token, chatId, fetch: http = globalThis.fetch }) {
  async function call(method, body) {
    const isForm = body instanceof FormData;
    try {
      const res = await http(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'content-type': 'application/json' },
        body: isForm ? body : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
      if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description}`);
      return data.result;
    } catch (err) {
      // The request URL contains the bot token - make sure it never ends up in a log or message.
      throw new Error(redact(err.message, token));
    }
  }

  const textOptions = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

  return {
    send: (text) => call('sendMessage', { chat_id: chatId, text, ...textOptions }),
    edit: (messageId, text) => call('editMessageText', { chat_id: chatId, message_id: messageId, text, ...textOptions }),
    async sendDocument(filePath, caption) {
      const form = new FormData();
      form.set('chat_id', String(chatId));
      form.set('caption', caption);
      form.set('parse_mode', 'HTML');
      form.set('document', await openAsBlob(filePath), path.basename(filePath));
      return call('sendDocument', form);
    },
  };
}

/**
 * Keeps one Telegram message up to date while a scrape runs, then sends the Excel file.
 * Telegram errors are logged and never stop the scrape.
 */
export function createReporter({ telegram, title, runUrl = '', log = console.log, intervalMs = 30_000, now = Date.now }) {
  const startedAt = now();
  const head = (icon) => `${icon} <b>${escapeHtml(title)}</b>`;
  const runLink = runUrl ? `\n<a href="${escapeHtml(runUrl)}">Відкрити запуск на GitHub</a>` : '';
  let messageId = null;
  let lastText = '';
  let lastShownAt = 0;
  let queue = Promise.resolve();

  const enqueue = (task) => {
    queue = queue.then(task).catch((err) => log(`Telegram: ${err.message}`));
    return queue;
  };

  /** Shows `text` in the status message (sends it the first time, edits it afterwards). */
  const show = (text) => {
    lastShownAt = now();
    return enqueue(async () => {
      if (text === lastText) return;
      lastText = text;
      if (messageId) await telegram.edit(messageId, text);
      else messageId = (await telegram.send(text)).message_id;
    });
  };

  return {
    start() {
      return show(`${head('🔄')}\nЗбираю посилання на товари…${runLink}`);
    },

    /** Pass as `onProgress` to scrape(). Updates the message at most every `intervalMs`. */
    progress: (info) => {
      if (info.phase !== 'products') return;
      const { done, total, failed } = info;
      if (done > 0 && done < total && now() - lastShownAt < intervalMs) return;
      const percent = total ? Math.floor((done / total) * 100) : 100;
      const failedText = failed ? ` · помилок: ${failed}` : '';
      show(`${head('🔄')}\nЗбираю товари: ${done} / ${total} (${percent}%)${failedText}${runLink}`);
    },

    done(summary, filePath) {
      const took = formatDuration(now() - startedAt);
      if (!summary.products) return show(`${head('⚠️')}\nТоварів не знайдено (${took}). Перевірте посилання.${runLink}`);

      const counts = `Товарів: ${summary.products}${summary.failed ? `, помилок: ${summary.failed}` : ''}`;
      show(`${head('✅')}\nГотово за ${took}. ${counts}.`);
      return enqueue(async () => {
        try {
          const { size } = await stat(filePath);
          if (size > MAX_UPLOAD_BYTES) {
            const mb = (size / 1024 / 1024).toFixed(1);
            await telegram.send(`${head('📦')}\nФайл має ${mb} МБ – це забагато для Telegram. Завантажте його зі сторінки запуску (Artifacts).${runLink}`);
            return;
          }
          await telegram.sendDocument(filePath, `${head('📊')}\n${counts}`);
        } catch (err) {
          log(`Telegram: ${err.message}`);
          await telegram.send(`${head('⚠️')}\nНе вдалося надіслати файл: ${escapeHtml(err.message)}\nЗавантажте його зі сторінки запуску (Artifacts).${runLink}`);
        }
      });
    },

    fail(err) {
      return show(`${head('❌')}\nПомилка: ${escapeHtml(err.message)}${runLink}`);
    },
  };
}
