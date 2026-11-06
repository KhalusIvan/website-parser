# Website Parser

Scrapes online shops and exports their product catalog to Excel (`.xlsx`).
The web UI is hosted on **GitHub Pages**. The scraping runs in **GitHub Actions**.

Right now it supports one source, **vroda-ua.com**. It is a JavaScript port of the old `vroda.jar`
and produces the same Excel file (same columns, same order, same values).

## How it works

```
GitHub Pages (site/)            GitHub Actions (.github/workflows/)
┌─────────────────────┐  start  ┌──────────────────────────────────────┐
│ form: site, lang,   │ ──────▶ │ scrape.yml: node src/cli.js ...      │
│ whole site/category │         │   -> output/vroda-UA.xlsx            │
│                     │         │   -> uploaded to release "data"      │
│ downloads list      │ ◀────── │ pages.yml: rebuilds the site with    │
│ (files/index.json)  │ deploy  │   the latest Excel files             │
└─────────────────────┘         └──────────────────────────────────────┘
```

Why not scrape directly in the browser? Browsers block a page from reading other websites (CORS),
and vroda-ua.com doesn't allow it. GitHub Pages can't run PHP or Node either. So the page starts a
GitHub Actions job and the job does the scraping.

## Using it

1. Open the site: `https://<user>.github.io/website-parser/`
2. Pick a website, language and **Whole site** or **One category**, then click **Start scraping**.
3. Wait for the run to finish under *Recent runs* (whole site ≈ 30-60 min). The file then appears
   under *Downloads*.

Without a token, the button opens the GitHub Actions page, where you click **Run workflow** with the same options.
To start runs straight from the site, open **Settings** on the page and paste a
[fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to
*only this repo* and the permission **Actions: Read and write**. The token stays in your browser (localStorage).

## Running locally

Needs Node.js 20.11+.

```bash
npm install
npm run scrape                                    # asks questions, like the jar did
npm run scrape -- vroda --lang ua --mode all      # whole site -> output/vroda-UA.xlsx
npm run scrape -- vroda --lang ru --mode category --url https://vroda-ua.com/zasobi-dlya-doglyadu-perukars-koji-tehniki
npm run scrape -- vroda --lang ua --mode all --limit 20   # quick test: only the first 20 products
npm run site                                      # preview the web UI with files from ./output on http://localhost:8080
```

## Tests

```bash
npm test                                          # offline unit tests (HTML fixtures, no network)
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

Note: vroda-ua.com shows a *random* "old price" on some products (a different one on every page
load). For those products the `price special` column can differ between any two runs, even of the same scraper.

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

The web UI picks up new sources automatically (it reads `sources.json`, which is generated from the registry).

## One-time GitHub setup

1. **Pages needs a public repo** on the free plan (private repos need GitHub Pro/Team).
   *Settings → General → Danger zone → Change visibility*, or upgrade the plan.
   Note: anyone with the Pages URL can open the site and download the Excel files.
2. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
3. Push to `main`. The *Deploy site* workflow publishes the site.
4. Run the first scrape: *Actions → Scrape → Run workflow*.

## Project layout

```
src/
  cli.js              command line entry
  scrape.js           engine: collect links -> parse products in parallel -> write Excel
  core/http.js        fetch with retries; on HTTP 403/429 waits 5-7 min (like the jar)
  core/html.js        jsoup-like helpers for cheerio
  core/product.js     product fields + price normalisation (movePrices)
  core/excel.js       Excel writer (same layout as the jar)
  sources/            one file per website + index.js registry
site/                 GitHub Pages UI (plain HTML/CSS/JS)
scripts/build-site.js builds the Pages site (+ sources.json, latest Excel files)
test/                 unit tests, fixtures, compare tool
.github/workflows/    scrape.yml (scrape + publish), pages.yml (deploy site)
```
