// gamaofficial.com.ua - official GA.MA store (OpenCart, "storeset" theme). Ukrainian and Russian.
// Same Excel columns as vroda. Notes about this site:
//  - The top menu misses a category ("Догляд за тілом" is only in the sidebar, and the menu's
//    "Інше" link is dead), so categories come from the top menu AND the sidebar category list of
//    the category pages (#sstore-3-level). "Акції" / "Гофре" are listed last; their products are
//    in a real category first.
//  - Pages are ?page=2, ?page=3, ... (a page after the last one is empty).
//  - Every product has one link, the site's canonical one: /category/product or
//    index.php?route=product/product&path=<category>&product_id=<id> (products without a friendly URL).
//    Links without the category redirect to it, so the link from the category card is used as is.
//  - The menus' links are relative to <base href="https://gamaofficial.com.ua/"> even on the
//    Russian pages, so category links are converted to the language: /ru/ + the same path.
//  - name = the catalogue name (breadcrumb / card), not the longer SEO heading (h1).
//  - Stock: the visible "Наявність" / "Доступность" label (schema.org says InStock for every product).
//    "На складі" / "В наличии" (some labels are Russian on the Ukrainian pages too) = available;
//    "Нет в наличии" and anything else = not.
//  - sku = "Модель"; vendor = "Виробник" (always Gama).
import { fitDescription, htmlFirst, normText, specsFromRows, textFirst, trimChars } from '../core/html.js';
import { createProduct, movePrices } from '../core/product.js';
import { VRODA_UA_COLUMNS } from './vroda-columns.js';

export { fitDescription }; // shared, in core/html.js

const ORIGIN = 'https://gamaofficial.com.ua';
const MAX_PAGES = 200;

const SEL = {
  menu: '#megamenu-menu .nav > li > a',
  sidebar: '#sstore-3-level a.category-name-a',
  card: '#content .product-grid .product',
  cardLink: '.name a',
  breadcrumb: '.breadcrumb li',
  info: '#content .product-info .product-right', // the main product block (not related products)
  price: '.price[itemprop="offers"] #update_price',
  special: '.price[itemprop="offers"] #update_special',
  brand: '.description [itemprop="brand"]',
  model: '.description [itemprop="model"]',
  images: '#content .product-info .image a.dataitem, #content .product-info #image-additional a',
  description: '#tab-description [itemprop="description"]',
  specRows: '#tab-specification table tr',
};

/** Visible stock labels that mean "in stock". Others ("Немає в наявності", "Очікується", ...) = not. */
const IN_STOCK = /^(на складі|на складе|в наявності|є в наявності|в наличии|есть в наличии)$/i;

/** "4 999 грн" -> "4999.00" (same format as vroda); '' if there is no number. */
export function money(text) {
  const match = String(text ?? '').replace(/[\s ]/g, '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')).toFixed(2) : '';
}


/**
 * Category URL for a language, keeping path and query (without "page"):
 * ua -> https://gamaofficial.com.ua/a/, ru -> https://gamaofficial.com.ua/ru/a/
 */
export function langUrl(url, lang) {
  const u = new URL(url, `${ORIGIN}/`);
  const search = u.search.replace(/([?&])page=[^&]*&?/, '$1').replace(/[?&]$/, '');
  let path = u.pathname.replace(/^\/ru(?=\/|$)/, '').replace(/^\/+/, '');
  if (path && !path.endsWith('/') && !path.includes('.')) path += '/'; // /utyuzhki redirects to /utyuzhki/
  return `${ORIGIN}/${lang === 'ru' ? 'ru/' : ''}${path}${search}`;
}

/** Same product in any link form: "id422" for index.php links, else the last path segment. */
export function productKey(link) {
  const u = new URL(link);
  const id = u.searchParams.get('product_id');
  return id ? `id${id}` : u.pathname.split('/').filter(Boolean).pop() ?? link;
}

function pageUrl(url, page) {
  if (page === 1) return url;
  const u = new URL(url);
  u.searchParams.set('page', String(page));
  return u.toString();
}

/** Breadcrumb without the home icon, e.g. ["Випрямлячі", "<product>"]. */
function breadcrumb($) {
  return $(SEL.breadcrumb)
    .map((_, li) => {
      const name = $(li).find('[itemprop="name"]').first(); // the link also repeats the text
      return normText(name.length ? name.text() : $(li).text());
    })
    .get()
    .filter(Boolean);
}

/**
 * Category links of a page (top menu + sidebar), as language URLs. The menu's links are relative
 * ("utyuzhki") to the page's <base href>, which cheerio doesn't apply - resolved here.
 */
function categoryLinks($, pageUrl, lang) {
  const base = new URL($('base').attr('href') || pageUrl, pageUrl);
  return [...$(SEL.menu).toArray(), ...$(SEL.sidebar).toArray()]
    .map((a) => $(a).attr('href'))
    .filter((href) => href && !/^(javascript|#)/i.test(href))
    .map((href) => new URL(href, base))
    .filter((u) => u.origin === ORIGIN)
    .map((u) => langUrl(u.href, lang));
}

/**
 * Adds the products of a category (all its pages) to `links`: Map(link -> { category }).
 * The first category a product is found in wins (`seen` holds product keys). Returns the page's category links.
 */
async function collectCategory(url, lang, links, seen, ctx) {
  let $page = await ctx.http.getHtml(url);
  const category = breadcrumb($page).join('/');
  const more = categoryLinks($page, url, lang);

  let previousFirst = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) $page = await ctx.http.getHtml(pageUrl(url, page));
    const cards = $page(SEL.card).toArray();
    if (!cards.length) break;

    const first = $page(cards[0]).find(SEL.cardLink).prop('href');
    if (first === previousFirst) break; // safety: site returned the same page again
    previousFirst = first;

    let added = 0;
    for (const card of cards) {
      const link = $page(card).find(SEL.cardLink).first().prop('href');
      if (!link || seen.has(productKey(link))) continue;
      seen.add(productKey(link));
      links.set(link, { category });
      added++;
    }
    ctx.log(`${category} - page ${page} (${cards.length} products, ${added} new)`);
  }
  return more;
}

/** "sale" style pages go last, so their products get a real category. */
const LAST = /\/(sales|gofre-gama)\/?$/;

async function collectAll(lang, links, seen, ctx) {
  const home = langUrl(`${ORIGIN}/`, lang);
  const $ = await ctx.http.getHtml(home);
  const queue = [...new Set(categoryLinks($, home, lang))];
  if (!queue.length) throw new Error('Catalogue menu not found on gamaofficial.com.ua - the site layout may have changed');
  const visited = new Set();
  while (queue.length) {
    // Real categories first, then the "sale"-style ones.
    const index = Math.max(0, queue.findIndex((url) => !LAST.test(url)));
    const url = queue.splice(index, 1)[0];
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      // The sidebar of every category page lists all categories (also ones missing from the menu).
      for (const found of await collectCategory(url, lang, links, seen, ctx)) {
        if (!visited.has(found) && !queue.includes(found)) queue.push(found);
      }
    } catch (err) {
      // The menu's "Інше" / "Другое" link is dead (404). Skip dead links.
      if (err.status !== 404 && err.status !== 410) throw err;
      ctx.log(`Skipping ${url}: ${err.message}`);
    }
  }
}

/** Text after a "Label:" in the product's info block, e.g. "Наявність: На складі". */
function infoValue($, info, labels) {
  const marked = info
    .find('.description .marked')
    .filter((_, el) => labels.test(normText($(el).text())))
    .first();
  if (!marked.length) return '';
  let text = '';
  for (let node = marked[0].next; node && node.name !== 'br' && !$(node).is('.marked'); node = node.next) {
    text += $(node).text();
  }
  return trimChars(normText(text), ' :');
}

async function parseProduct(link, extra = {}, ctx) {
  const $ = await ctx.http.getHtml(link);
  const info = $(SEL.info).first();

  const specs = specsFromRows($, $(SEL.specRows));
  specs.vendor = textFirst($, SEL.brand, '', info) || 'Gama';

  const images = $(SEL.images)
    .map((_, a) => $(a).prop('href'))
    .get()
    .filter((href) => href && /^https?:/.test(href) && !/\/no_image[-.]/.test(href)); // no "javascript:" / placeholders

  return movePrices(
    createProduct({
      link,
      name: breadcrumb($).at(-1) || textFirst($, '#content h1', ''),
      category: extra.category ?? '',
      images: [...new Set(images)].join(';'),
      description: fitDescription(htmlFirst($, SEL.description, '')),
      // With a discount: #update_price = regular (crossed out), #update_special = discounted price.
      price: money(textFirst($, SEL.price, '', info)),
      priceSpecial: money(textFirst($, SEL.special, '', info)),
      sku: textFirst($, SEL.model, '', info),
      parent: '',
      // "Наявність: На складі" (ru: "Доступность: На складе"); the label next to the price as a fallback.
      available: IN_STOCK.test(infoValue($, info, /^(Наявність|Доступность|Наличие)/i) || textFirst($, '.availabil', '', info)),
      specs,
    }),
  );
}

export default {
  id: 'gama',
  name: 'GA.MA',
  website: 'https://gamaofficial.com.ua',
  description: 'Official GA.MA store: hair straighteners, curling irons, hair dryers, brushes, clippers and accessories.',
  languages: { ua: 'Українська', ru: 'Русский' },
  modes: {
    all: { label: 'Whole site', needsUrl: false },
    category: { label: 'One category (paste URL)', needsUrl: true },
  },
  concurrency: 2,
  // Same spec columns as the vroda file (Ukrainian), even if empty here; the shop's own specs are added.
  columns: { ua: VRODA_UA_COLUMNS },

  /** Returns Map(productLink -> { category }). */
  async collectLinks({ lang, mode, url }, ctx) {
    const links = new Map();
    const seen = new Set();
    if (mode === 'all') {
      await collectAll(lang, links, seen, ctx);
    } else if (mode === 'category') {
      if (!url) throw new Error('Category URL is required for mode "category"');
      await collectCategory(langUrl(url, lang), lang, links, seen, ctx);
    } else {
      throw new Error(`Unknown mode "${mode}"`);
    }
    return links;
  },

  parseProduct,
};
