// Cloudflare Worker entry point.
//   POST /webhook  - Telegram sends every message/button press here (checked with a secret header)
//   GET  /setup    - registers the webhook + command menu and shows a config check (open once after deploy)
import { createBot, webhookSecret } from './bot.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const bot = createBot(env);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = request.headers.get('x-telegram-bot-api-secret-token');
      if (!env.TELEGRAM_BOT_TOKEN || secret !== (await webhookSecret(env.TELEGRAM_BOT_TOKEN))) {
        return new Response('Forbidden', { status: 403 });
      }
      try {
        await bot.handleUpdate(await request.json());
      } catch (err) {
        // Answer 200 anyway, otherwise Telegram keeps re-sending the same update.
        console.error(err);
      }
      return new Response('ok');
    }

    if (request.method === 'GET' && url.pathname === '/setup') {
      try {
        return Response.json(await bot.setup(`${url.origin}/webhook`));
      } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500 });
      }
    }

    return new Response('website-parser bot is running. Open /setup once after deploying.');
  },
};
