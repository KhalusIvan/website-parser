# Website Parser

Scrapes online shops and exports their product catalog to Excel (`.xlsx`).
You control it from a **Telegram bot**. The scraping runs in **GitHub Actions**, and the bot runs on
**Cloudflare Workers**. Both are free.

Right now it supports one source, **vroda-ua.com**. It is a JavaScript port of the old `vroda.jar`
and produces the same Excel file (same columns, same order, same values).

## How it works

```
Telegram                 Cloudflare Worker (bot/)            GitHub Actions (.github/workflows/scrape.yml)
┌──────────────┐  /new   ┌────────────────────────┐  start  ┌─────────────────────────────────────────┐
│ you          │ ──────▶ │ buttons: site, whole   │ ──────▶ │ node src/cli.js vroda --lang ua ...     │
│              │         │ site/category, language│         │                                         │
│              │ ◀────────────────────────────────────────── │ progress message, then the .xlsx file   │
└──────────────┘                                            └─────────────────────────────────────────┘
```

- A free Cloudflare Worker can only run for a few seconds per request, so it only shows the
  buttons and starts the GitHub workflow.
- The workflow can run for up to 6 hours. It scrapes, keeps one Telegram message updated with
  progress, and sends the Excel file to the chat. The file is also kept on the run page
  (*Artifacts*) for 30 days.
- The repo stays private. Free accounts get 2,000 Actions minutes a month, which is about 30
  whole-site scrapes.

## Using the bot

| You send | What happens |
|---|---|
| `/new` | Choose *Whole site* or *One category*, then the language. Then wait for the file. |
| a category link, e.g. `https://vroda-ua.com/ru/uhod-za-licom-i-telom` | Choose the language. Only that category is scraped. |
| `/status` | Shows the last 5 runs, with a *Cancel* button for a running one. |
| `/id` | Shows your Telegram ID. Works for everyone. |

A whole site takes about 30–60 minutes. Only the Telegram users listed in `ALLOWED_USER_IDS` can use the bot.

You can also start a run without the bot: *Actions → Scrape → Run workflow*. Put your Telegram ID
in *chat_id*, or set the repository variable `TELEGRAM_CHAT_ID` once.

## One-time setup

You need a Telegram account, a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and Node.js 20.11+.

> Run the commands that ask for a token in your own terminal. Paste tokens only into those
> prompts (the input is hidden), never into a chat, a file in this folder or a command line.

1. **Create the bot.** In Telegram, message [@BotFather](https://t.me/BotFather) and send `/newbot`.
   Copy the token it gives you.
2. **Give GitHub Actions the bot token,** so the workflow can send messages and files:
   ```bash
   gh secret set TELEGRAM_BOT_TOKEN        # paste the token when asked
   ```
   (or *Settings → Secrets and variables → Actions → New repository secret*).
3. **Create a GitHub token for the bot,** so it can start the workflow.
   Open [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new) and set:
   - *Repository access*: Only select repositories → `website-parser`
   - *Permissions*: **Actions: Read and write**

   Set the expiration you want. You'll have to replace the token when it expires.
4. **Deploy the bot to Cloudflare:**
   ```bash
   npm install
   npx wrangler@4 login                      # opens the browser once
   npm run bot:secret -- TELEGRAM_BOT_TOKEN  # paste the Telegram token
   npm run bot:secret -- GITHUB_TOKEN        # paste the GitHub token from step 3
   npm run bot:deploy                        # prints https://website-parser-bot.<you>.workers.dev
   ```
5. **Connect Telegram to the Worker.** Open `https://website-parser-bot.<you>.workers.dev/setup`
   in the browser. It registers the webhook and the command menu, and shows a check of the setup.
6. **Allow yourself.** Send `/id` to your bot. Put the number in `ALLOWED_USER_IDS` in
   `bot/wrangler.toml` (comma-separated for more people), then run `npm run bot:deploy` again.
   Open `/setup` again to check: it should show `"ok": true`.

To see the bot's errors live, run `npm run bot:logs`.

## Where the secrets are

| Secret | Stored in | Who can use it |
|---|---|---|
| Telegram bot token | GitHub repo secret + Cloudflare Worker secret | the Scrape step of the workflow, the Worker |
| GitHub token (Actions read/write, this repo only) | Cloudflare Worker secret | the Worker |

- Neither token is in the code or in git. `.gitignore` also blocks `.env` and `.dev.vars` files.
- GitHub hides secrets in the workflow logs (`***`). The bot token is only given to the two steps
  that send to Telegram. `npm ci --ignore-scripts` stops dependencies from running code while installing.
- Error messages that could contain a token (the Telegram API URL contains it) are cleaned
  before they reach the chat or a log.
- Only Telegram can call the bot's webhook (a secret header derived from the bot token), and the
  bot only answers the users in `ALLOWED_USER_IDS`.
- If a token leaks: Telegram → @BotFather → `/revoke`, or delete the GitHub token in
  *Settings → Developer settings*. Then set the new one again (setup steps 2 and 4).
- Turn on two-factor login for GitHub, Cloudflare and Telegram. Those accounts give access to everything above.

## Running locally

```bash
npm install
npm run scrape                                    # asks questions, like the jar did
npm run scrape -- vroda --lang ua --mode all      # whole site -> output/vroda-UA.xlsx
npm run scrape -- vroda --lang ru --mode category --url https://vroda-ua.com/zasobi-dlya-doglyadu-perukars-koji-tehniki
npm run scrape -- vroda --lang ua --mode all --limit 20   # quick test: only the first 20 products
```

Add `--telegram-chat <your id>` (with `TELEGRAM_BOT_TOKEN` set in the environment) to get the
progress and the file in Telegram, like the workflow does.

## Tests

```bash
npm test                                          # offline unit tests (scraper, bot, Telegram messages)
npm run compare -- old.xlsx new.xlsx              # compare two exports, e.g. vroda.jar vs this app
```

`compare` matches rows by `link` and reports missing or extra products, column differences and
cell-by-cell mismatches. Description whitespace is ignored unless you pass `--strict`.

To compare with the original jar:

```bash
printf 'ua\ncategory\nhttps://vroda-ua.com/zasobi-dlya-doglyadu-perukars-koji-tehniki\n' | java -jar vroda.jar
npm run scrape -- vroda --lang ua --mode category --url https://vroda-ua.com/zasobi-dlya-doglyadu-perukars-koji-tehniki
npm run compare -- vroda-UA.xlsx output/vroda-UA-zasobi-dlya-doglyadu-perukars-koji-tehniki.xlsx
```

Known difference: `vroda.jar` read the first "old price" anywhere on the product page. That is often
the old price of a random product in the *related products* carousel (a different one on every page
load), so the jar's `price` / `price special` columns were wrong for many products. This app reads
the old price only from the product's own price block, so expect price differences when comparing
with jar exports. Products with a real discount: `price` = old price, `price special` = current price.

## Adding a new website

1. Create `src/sources/<id>.js`. Copy `src/sources/vroda.js` and change it:
   ```js
   export default {
     id: 'myshop',
     name: 'My Shop',
     website: 'https://myshop.ua',
     description: 'What the shop sells',
     languages: { ua: 'Українська' },
     modes: { all: { label: 'Whole site', needsUrl: false },
              category: { label: 'One category (paste URL)', needsUrl: true } },
     concurrency: 2,
     // returns Map(productUrl -> category name)
     async collectLinks({ lang, mode, url }, { http, log }) { ... },
     // returns createProduct({...}) for one product page
     async parseProduct(link, category, { http, log }) { ... },
   };
   ```
   `http.getHtml(url)` returns a [cheerio](https://cheerio.js.org/) document (jQuery-like `$`).
   Helpers in `src/core/html.js` (`textFirst`, `hrefs`, `specsFromRows`, …) cover the usual cases.
2. Register it in `src/sources/index.js`.
3. Add the id to the `source` options in `.github/workflows/scrape.yml` (and any new language code to `lang`).
4. Add a fixture-based test in `test/`.
5. Run `npm run bot:deploy`. This updates the bot's list of websites (`bot/sources.generated.js`)
   and deploys it. The bot then shows the new site, and links to it are recognised.

## Project layout

```
src/
  cli.js                command line entry (also used by the workflow)
  scrape.js             engine: collect links -> parse products in parallel -> write Excel
  core/http.js          fetch with retries; on HTTP 403/429 waits 5-7 min (like the jar)
  core/html.js          jsoup-like helpers for cheerio
  core/product.js       product fields + price normalisation (movePrices)
  core/excel.js         Excel writer (same layout as the jar)
  notify/telegram.js    progress message + sending the file to Telegram
  sources/              one file per website + index.js registry
bot/
  bot.js                Telegram bot: menus, starting runs, /status
  worker.js             Cloudflare Worker entry (/webhook, /setup)
  wrangler.toml         Worker config (repo, allowed users)
  sources.generated.js  list of websites for the bot (npm run bot:sources)
scripts/bot-sources.js  generates bot/sources.generated.js
test/                   unit tests, fixtures, compare tool
.github/workflows/      scrape.yml (scrape + send to Telegram)
```
