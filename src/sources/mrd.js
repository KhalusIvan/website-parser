// mrd-pro.com.ua - official MRD PRO store (OpenCart, "upstore" theme). Ukrainian and Russian.
// Same Excel columns as vroda. Notes about this site:
//  - Categories come from the catalogue menu (#menu-vertical-list); subcategories of "Комплектуючі"
//    are visited before the category itself, so products get the most specific category.
//    "Акції та знижки" (sale) is a menu category too; its products are all in a real category first.
//  - Pages are /category/page-2, /category/page-3, ...
//  - A product's link depends on the category it is listed in (/category/product); the canonical link
//    (/product, /ru/product) is used, so each product has one link.
//  - The Russian menu links some categories to the Ukrainian pages (a site bug), so Russian category
//    links are built from the Ukrainian ones: /ru/ + the same path.
//  - name = the product's name as in the catalogue (breadcrumb), not the longer SEO heading (h1).
//  - "Передзамовлення" (pre-order) counts as not available ("-"), like "Немає в наявності".
//  - vendor is always MRD PRO (the only brand of the shop).
import { eachAttr, exists, htmlFirst, normText, textFirst, trimChars } from '../core/html.js';
import { createProduct, movePrices } from '../core/product.js';
import { VRODA_UA_COLUMNS } from './vroda-columns.js';

const ORIGIN = 'https://mrd-pro.com.ua';
const MAX_PAGES = 200;

const SEL = {
  menuItems: '#menu-vertical-list > li',
  card: '.product-thumb',
  cardLink: '.product-name a',
  breadcrumb: '.breadcrumb li',
  canonical: 'link[rel="canonical"]',
  price: '#product .price-group .autocalc-product-price',
  special: '#product .price-group .autocalc-product-special',
  sku: '#product .info-model span',
  inStock: '#product .info-product-stock .stock-status.instock',
  images: '#product a.main-image, #product a.dop-img',
  description: '#tab-description',
  attributes: '#tab-specification .short-attribute',
};

/** "27 999 грн." -> "27999.00" (same format as vroda); '' if there is no number. */
export function money(text) {
  const match = String(text ?? '').replace(/[\s ]/g, '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')).toFixed(2) : '';
}

/** Path of a site URL without the language prefix: "https://mrd-pro.com.ua/ru/a/b" -> "a/b". */
function pathOf(url) {
  return new URL(url, ORIGIN).pathname.replace(/^\/(ru\/?)?/, '').replace(/\/$/, '');
}

/** Site URL for a language: ua -> https://mrd-pro.com.ua/a/b, ru -> https://mrd-pro.com.ua/ru/a/b */
export function langUrl(url, lang) {
  return `${ORIGIN}/${lang === 'ru' ? 'ru/' : ''}${pathOf(url)}`;
}

/** /category/sub/product -> /product (the product's canonical link), keeping the language. */
export function productLink(href, lang) {
  return langUrl(pathOf(href).split('/').pop(), lang);
}

function pageUrl(url, page) {
  return page === 1 ? url : `${url.replace(/\/$/, '')}/page-${page}`;
}

/** Breadcrumb without "Головна" / "Главная", e.g. "Комплектуючі/Ножі для машинок". */
function breadcrumb($) {
  return $(SEL.breadcrumb)
    .map((_, el) => normText($(el).text()))
    .get()
    .slice(1)
    .filter(Boolean);
}

/**
 * Adds the products of a category (all its pages) to `links`: Map(link -> { category }).
 * The first category a product is found in wins.
 */
async function collectCategory(url, lang, links, ctx) {
  let $page = await ctx.http.getHtml(url);
  const category = breadcrumb($page).join('/');

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
      const href = $page(card).find(SEL.cardLink).first().prop('href');
      if (!href) continue;
      const link = productLink(href, lang);
      if (links.has(link)) continue;
      links.set(link, { category });
      added++;
    }
    ctx.log(`${category} - page ${page} (${cards.length} products, ${added} new)`);
  }
}

/**
 * Category URLs from the catalogue menu, in menu order, subcategories before their parent.
 * Read from the Ukrainian home page and converted to the language (see the note at the top).
 */
async function menuCategories(lang, ctx) {
  const $ = await ctx.http.getHtml(`${ORIGIN}/`);
  const urls = [];
  $(SEL.menuItems).each((_, li) => {
    const top = $(li).children('a').first().prop('href');
    const children = $(li).find('a[href]').map((_, a) => $(a).prop('href')).get().filter((href) => href !== top);
    urls.push(...children, top);
  });
  const categories = [...new Set(urls.filter(Boolean).map((url) => langUrl(url, lang)))];
  if (!categories.length) throw new Error('Catalogue menu not found on mrd-pro.com.ua - the site layout may have changed');
  return categories;
}

/** Specifications ("Характеристики") -> { name: value }; repeated names joined with ";". */
function attributes($) {
  const grouped = new Map();
  $(SEL.attributes).each((_, el) => {
    const key = trimChars(normText($(el).find('.attr-name').text()), ' :');
    const value = trimChars(normText($(el).find('.attr-text').text()), ' :');
    if (!key) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  });
  return Object.fromEntries([...grouped].map(([key, values]) => [key, values.join(';')]));
}

/** The description without the heading the theme adds ("Опис <product name>"). */
function description($) {
  $(`${SEL.description} > h2.ch-h2`).first().remove();
  return htmlFirst($, SEL.description, '').trim();
}

async function parseProduct(link, extra = {}, ctx) {
  const $ = await ctx.http.getHtml(link);
  const specs = attributes($);
  specs.vendor = 'MRD PRO';

  return movePrices(
    createProduct({
      link,
      name: breadcrumb($).at(-1) || textFirst($, 'h1', ''),
      category: extra.category ?? '',
      images: [...new Set(eachAttr($, SEL.images, 'href').filter((href) => /^https?:/.test(href)))].join(';'),
      description: description($),
      // With a discount: regular price (crossed out) + special price; movePrices keeps the higher one in "price".
      price: money(textFirst($, SEL.price, '')),
      priceSpecial: money(textFirst($, SEL.special, '')),
      sku: textFirst($, SEL.sku, ''),
      parent: '',
      available: exists($, SEL.inStock),
      specs,
    }),
  );
}

export default {
  id: 'mrd',
  name: 'MRD PRO',
  website: 'https://mrd-pro.com.ua',
  description: 'Official MRD PRO store: clippers, trimmers, shavers, sets and spare parts.',
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
    if (mode === 'all') {
      for (const category of await menuCategories(lang, ctx)) {
        try {
          await collectCategory(category, lang, links, ctx);
        } catch (err) {
          // The menu also has "News" (no products; its Russian link differs). Skip dead links.
          if (err.status !== 404 && err.status !== 410) throw err;
          ctx.log(`Skipping ${category}: ${err.message}`);
        }
      }
    } else if (mode === 'category') {
      if (!url) throw new Error('Category URL is required for mode "category"');
      await collectCategory(langUrl(url, lang), lang, links, ctx);
    } else {
      throw new Error(`Unknown mode "${mode}"`);
    }
    return links;
  },

  parseProduct,
};
