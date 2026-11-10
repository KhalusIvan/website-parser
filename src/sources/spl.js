// spl-group.com.ua - SPL Group store (OpenCart, customised default theme). Ukrainian and Russian.
// Same Excel columns as vroda. Notes about this site:
//  - Pages are /ua/... and /ru/... (the English /en/ version is ignored).
//  - Top categories come from the catalogue menu (#horizontal-menu); subcategories from the category
//    pages themselves (the menu misses a few, e.g. "Ножиці для лівшів"). Subcategories are visited
//    before their parent, so a product gets its most specific category. "Новинки" (new) goes last.
//  - The menu links are relative to <base href> and some redirect ("aksesuary-i-tekhnika" ->
//    "aksesuary-ta-tekhnika"), so visited categories are keyed by the page's canonical link.
//  - Pages are /category/page-2?sort=p.model&order=ASC&limit=100, ... (100 products per page, sorted by
//    article: the default order has ties, so products could move between pages while they are read).
//  - A product has the same link in every category (its main category path), so links are unique.
//  - The product page is customised: the main block is the column with h1.zag_h1; related products
//    below it have their own prices, so every selector is scoped to the main block.
//  - Stock: "В наявності" (.nal) = in stock, "Немає в наявності" (.nonal) = not.
//  - vendor = the product's "Виробник" (SPL, Exalto, Stylance, Vatana); SPL if not shown.
//  - Images: the popup links are 526x782 cache copies; the original files (often 1000x1000) are used.
//  - Scissors pairs link each other ("Пара ножиць"); those links are followed with addProduct in case
//    one isn't listed in a category. ~22 products have a colour/design option (no price change):
//    one row per product page, options are not exported.
import { fitDescription, htmlFirst, normText, trimChars } from '../core/html.js';
import { createProduct, movePrices } from '../core/product.js';
import { VRODA_UA_COLUMNS } from './vroda-columns.js';

export { fitDescription }; // shared, in core/html.js

const ORIGIN = 'https://spl-group.com.ua';
const MAX_PAGES = 100;
const LIST_QUERY = 'sort=p.model&order=ASC&limit=100'; // 100 per page = fewer requests
/** Categories that only repeat products of real categories ("new"), visited last. */
const LAST_CATEGORIES = ['novinki', 'specials'];

const SEL = {
  menu: '#horizontal-menu .navbar-nav > li > a[href]',
  subcategories: '#content .fon_cat .zag_cat a[href]',
  card: '#content .fon_tov',
  cardLink: '.zag_tov a[href]',
  breadcrumb: '.breadcrumb li',
  canonical: 'link[rel="canonical"]',
  title: 'h1.zag_h1',
};

/** "1 234 ₴" -> "1234.00" (same format as vroda); '' if there is no number. */
export function money(text) {
  const match = String(text ?? '').replace(/[\s ]/g, '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')).toFixed(2) : '';
}


/** Site URL in a language: "https://spl-group.com.ua/ua/litso/pintsety/" -> ".../ru/litso/pintsety/". */
export function langUrl(url, lang) {
  const u = new URL(url, `${ORIGIN}/`);
  const path = u.pathname.replace(/^\/(ua|ru|en)(\/|$)/, '/');
  return `${ORIGIN}/${lang}${path}${u.search}`;
}

/**
 * One link per product in the chosen language, without tracking/paging parameters. Products without
 * a friendly URL (index.php?route=product/product&product_id=..) keep only the product id.
 */
export function productLink(href, lang) {
  const u = new URL(href, `${ORIGIN}/`);
  const id = u.searchParams.get('route') === 'product/product' && u.searchParams.get('product_id');
  if (id) return `${ORIGIN}/${lang}/index.php?route=product/product&product_id=${id}`;
  return langUrl(`${ORIGIN}${u.pathname}`, lang);
}

/**
 * https://spl-group.com.ua/ua/litso/ + 2 -> https://spl-group.com.ua/ua/litso/page-2?sort=p.model&order=ASC&limit=100
 * Sorted by article (unique): the default order has ties, and then a product can move between pages
 * while they are read (seen once: listed twice, another one skipped).
 */
export function pageUrl(url, page) {
  const base = url.split(/[?#]/)[0].replace(/\/?$/, '/');
  return `${base}${page === 1 ? '' : `page-${page}`}?${LIST_QUERY}`;
}

/** Absolute URL of a link, resolved against the page's <base href> (the menu uses relative links). */
function absolute($, href, pageLink) {
  const base = $('base[href]').attr('href') || pageLink;
  return new URL(href, new URL(base, pageLink)).toString();
}

/** Breadcrumb without the home icon, e.g. ["Догляд за обличчям", "Пінцети"]. */
function breadcrumb($) {
  return $(SEL.breadcrumb)
    .map((_, el) => normText($(el).text()))
    .get()
    .filter(Boolean);
}

/** The category's real address (its canonical link, in the chosen language), e.g. ".../ua/litso/". */
function canonicalKey($, url, lang) {
  return langUrl(($(SEL.canonical).attr('href') || url).split(/[?#]/)[0].replace(/\/?$/, '/'), lang);
}

/**
 * Adds the products of a category to `links` (Map link -> { category }): first its subcategories
 * (recursively), then all its own pages. The first category a product is found in wins.
 */
async function collectCategory(url, lang, links, ctx, visited = new Set()) {
  let $page = await ctx.http.getHtml(pageUrl(url, 1));
  const key = canonicalKey($page, url, lang);
  if (visited.has(key)) return;
  visited.add(key);
  // A redirected menu link (aksesuary-i-tekhnika -> aksesuary-ta-tekhnika) loses the query:
  // load page 1 again from the real address, or products 25-100 would be skipped.
  if (key !== pageUrl(url, 1).split('?')[0]) $page = await ctx.http.getHtml(pageUrl(key, 1));

  const subcategories = [
    ...new Set($page(SEL.subcategories).map((_, el) => langUrl(absolute($page, $page(el).attr('href'), url), lang)).get()),
  ];
  for (const sub of subcategories) await collectCategory(sub, lang, links, ctx, visited);

  const category = breadcrumb($page).join('/');
  let previousFirst = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) $page = await ctx.http.getHtml(pageUrl(key, page));
    const cards = $page(SEL.card).toArray();
    if (!cards.length) break;

    const first = $page(cards[0]).find(SEL.cardLink).attr('href');
    if (first === previousFirst) break; // safety: the site redirects a page past the end to the last one
    previousFirst = first;

    let added = 0;
    for (const card of cards) {
      const href = $page(card).find(SEL.cardLink).first().attr('href');
      if (!href) continue;
      const link = productLink(absolute($page, href, url), lang);
      if (links.has(link)) continue;
      links.set(link, { category });
      added++;
    }
    ctx.log(`${category} - page ${page} (${cards.length} products, ${added} new)`);
    if (!$page(`.pagination a[href*="page-${page + 1}"]`).length) break;
  }
}

/** Top categories from the catalogue menu, in menu order, "new" style pages last. */
async function menuCategories(lang, ctx) {
  const home = `${ORIGIN}/${lang}/`;
  const $ = await ctx.http.getHtml(home);
  const urls = [...new Set($(SEL.menu).map((_, el) => langUrl(absolute($, $(el).attr('href'), home), lang)).get())];
  if (!urls.length) throw new Error('Catalogue menu not found on spl-group.com.ua - the site layout may have changed');
  const isLast = (url) => LAST_CATEGORIES.some((slug) => new URL(url).pathname.split('/').includes(slug));
  return [...urls.filter((url) => !isLast(url)), ...urls.filter(isLast)];
}

/** The product's own block (title, info, price, stock), without related products. */
function mainBlock($) {
  return $(SEL.title).first().parent();
}

/** Characteristics ("Тип ножиць: Філіровочні", ...) -> { name: value }; repeated names joined with ";". */
function attributes($, row) {
  const grouped = new Map();
  row.find('.zag_har').each((_, el) => {
    const key = trimChars(normText($(el).text()), ' :');
    const value = trimChars(normText($(el).closest('.row').find('.val_har').first().text()), ' :');
    if (!key) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  });
  return Object.fromEntries([...grouped].map(([key, values]) => [key, values.join(';')]));
}

/** Info line value by label, e.g. "Арт. 9321" -> "9321", "Виробник: SPL" -> "SPL". */
function infoValue($, main, label) {
  for (const li of main.find('ul.list-unstyled > li').toArray()) {
    const match = normText($(li).text()).match(label);
    if (match) return trimChars(match[1], ' :');
  }
  return '';
}

/** /image/cache/catalog/a/b-526x782.jpg -> /image/catalog/a/b.jpg (the original, full-size file). */
export function originalImage(url) {
  return url.replace(/\/image\/cache\/(.+)-\d+x\d+(\.[a-z0-9]+)$/i, '/image/$1$2');
}

async function parseProduct(link, extra = {}, ctx) {
  const $ = await ctx.http.getHtml(link);
  const main = mainBlock($);
  if (!main.length) throw new Error(`Product block not found on ${link}`);
  const row = main.closest('.row'); // images, characteristics and info; related products are outside it

  // Linked products ("Пара ножиць": the straight / thinning scissors of a pair). Today they are all
  // listed in categories too; any that aren't get scraped with this product's category.
  const lang = new URL(link).pathname.split('/')[1] === 'ru' ? 'ru' : 'ua';
  for (const href of new Set(main.find('#product a.view0_link[href]').map((_, el) => $(el).attr('href')).get())) {
    ctx.addProduct?.(productLink(absolute($, href, link), lang), { category: extra.category ?? '' });
  }

  const specs = attributes($, row);
  specs.vendor = infoValue($, main, /^(?:Виробник|Производитель|Manufacturer)\s*:?\s*(.+)$/i) || 'SPL';

  const images = row
    .find('ul.thumbnails a.thumbnail')
    .map((_, el) => $(el).attr('href'))
    .get()
    .filter((href) => href && /^https?:/.test(href) && !/placeholder|no_image/i.test(href))
    .map(originalImage);

  return movePrices(
    createProduct({
      link,
      name: breadcrumb($).at(-1) || normText(main.find(SEL.title).first().text()),
      category: extra.category ?? '',
      images: [...new Set(images)].join(';'),
      description: fitDescription(htmlFirst($, '#tab-description', '')),
      // With a discount: regular price (crossed out) + special price; movePrices keeps the higher one in "price".
      price: money(normText(main.find('.price_det .autocalc-product-price').first().text())),
      priceSpecial: money(normText(main.find('.price_det .autocalc-product-special').first().text())),
      sku: infoValue($, main, /^(?:Арт\.?|Артикул:?)\s*(.+)$/i),
      parent: '',
      available: main.find('.nal').length > 0 && !main.find('.nonal').length,
      specs,
    }),
  );
}

export default {
  id: 'spl',
  name: 'SPL Group',
  website: 'https://spl-group.com.ua',
  description: 'SPL Group store: hairdressing scissors, brushes, combs, capes, manicure and make-up tools (SPL, Exalto, Stylance, Vatana).',
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
    const visited = new Set();
    if (mode === 'all') {
      for (const category of await menuCategories(lang, ctx)) {
        try {
          await collectCategory(category, lang, links, ctx, visited);
        } catch (err) {
          // The menu also links info pages (blog, partners); skip dead links.
          if (err.status !== 404 && err.status !== 410) throw err;
          ctx.log(`Skipping ${category}: ${err.message}`);
        }
      }
    } else if (mode === 'category') {
      if (!url) throw new Error('Category URL is required for mode "category"');
      await collectCategory(langUrl(url, lang), lang, links, ctx, visited);
    } else {
      throw new Error(`Unknown mode "${mode}"`);
    }
    return links;
  },

  parseProduct,
};
