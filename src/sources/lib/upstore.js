// Shared code for OpenCart shops with the "upstore" theme (mrd-pro.com.ua, immortal.com.ua,
// kucheryawiy.com.ua, glorianapro.com). createUpstoreSource(settings) returns a source object; each site file only
// passes its settings. What these shops have in common:
//  - Catalogue menu: top-level <li> items (the selector differs per site) with the subcategories
//    inside. Subcategories are visited before their parent (deepest first), so a product gets its
//    most specific category. Russian category links are /ru/ + the Ukrainian path on some sites
//    (mrd: the menu is read from the Ukrainian home page and converted); on others the Russian
//    paths differ (translatedPaths: the Russian home page's menu is read, and a pasted category link
//    is turned into the language with the page's hreflang links).
//  - Category pages: .product-thumb cards, pages /category/page-2, ... (or ?page=2 on some sites).
//    Optionally (followSubcategories) the subcategory tiles of a category page (a.subcategory) are
//    visited before the category itself, for subcategories missing from the menu.
//  - A product's link depends on the category it is listed in (/category/sub/product). The product's
//    keyword alone (/product, /ru/product) opens the same page, so that is used: one link per product.
//    In Russian the keyword may differ from the Ukrainian one; it is taken from the Russian pages.
//  - Product page: everything of the product is inside #product (related products are outside it).
//    Prices: .autocalc-product-price / .autocalc-product-special. Stock: .stock-status (see below).
//    Specs: #tab-specification .short-attribute. Images: .main-image / .dop-img (href, or data-src
//    in newer theme versions). Manufacturer: .info-manufacturer (text, or the logo's alt).
//  - name = the product's name as in the catalogue (breadcrumb), not the longer SEO heading (h1).
//  - Stock: in stock if the label is .instock or says "В наявності" / "В наличии" (immortal.com.ua shows
//    "В наявності" with the out-of-stock style on a few products - the visible label wins).
//    "Передзамовлення" (pre-order), "Немає в наявності", "Очікується ..." etc. count as not available.
import { fitDescription, normText, textFirst, tidyHtml, trimChars } from '../../core/html.js';
import { createProduct, movePrices } from '../../core/product.js';

const MAX_PAGES = 200;

const SEL = {
  card: '.product-thumb',
  cardLink: '.product-name a',
  subcategories: 'a.subcategory',
  breadcrumb: '.breadcrumb li',
  price: '#product .price-group .autocalc-product-price',
  special: '#product .price-group .autocalc-product-special',
  sku: '#product .info-model span',
  stock: '#product .info-product-stock .stock-status',
  images: '#product .main-image, #product .dop-img',
  description: '#tab-description',
  attributes: '#tab-specification .short-attribute',
  manufacturer: '#product .info-manufacturer a',
};

/** "27 999 грн." -> "27999.00" (same format as vroda); '' if there is no number. */
export function money(text) {
  const match = String(text ?? '').replace(/[\s ]/g, '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')).toFixed(2) : '';
}

/**
 * URL helpers of a site. `trailingSlash`: the site's links end with "/" (e.g. /category/product/).
 *  - langUrl(url, lang): the same page in a language: ua -> origin/a/b, ru -> origin/ru/a/b
 *  - productLink(href, lang): /category/sub/product -> /product (keeping the language)
 */
export function upstoreUrls({ website, trailingSlash = false }) {
  const origin = new URL(website).origin;
  const pathOf = (url) => new URL(url, origin).pathname.replace(/^\/(ru(\/|$))?/, '').replace(/\/$/, '');
  const langUrl = (url, lang) => {
    const path = pathOf(url);
    return `${origin}/${lang === 'ru' ? 'ru/' : ''}${path}${trailingSlash && path ? '/' : ''}`;
  };
  const productLink = (href, lang) => langUrl(pathOf(href).split('/').pop(), lang);
  return { origin, pathOf, langUrl, productLink };
}

/** Page N of a category: /category/page-N (pageQuery: false) or /category/?page=N (pageQuery: true). */
export function pageUrl(url, page, pageQuery = false) {
  if (page === 1) return url;
  if (!pageQuery) return `${url.replace(/\/$/, '')}/page-${page}`;
  const u = new URL(url);
  u.searchParams.set('page', String(page));
  return u.toString();
}

/** Breadcrumb without "Головна" / "Главная", e.g. "Комплектуючі/Ножі для машинок". */
function breadcrumb($) {
  return $(SEL.breadcrumb)
    .map((_, el) => normText($(el).text()))
    .get()
    .slice(1)
    .filter(Boolean);
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
  const $description = $(SEL.description).first();
  $description.children('h2.ch-h2').first().remove();
  // A block the shop left unclosed in a description (a few immortal.com.ua and kucheryawiy.com.ua
  // pages) makes the parser put the next tabs (specifications, reviews with their form and script)
  // inside the description. Such a tab is then the only element with its id on the page. Shops also
  // paste copies of the theme's markup into descriptions (headings, even a "tab-review" block); those
  // copies have the same id as the real tab elsewhere on the page and are kept.
  const leaked = $description
    .find('[id^="tab-"]')
    .filter((_, el) => el.attribs.id !== 'tab-description' && $(`[id="${el.attribs.id}"]`).length === 1)
    .first();
  if (leaked.length) {
    leaked.nextAll().remove();
    let node = leaked.parent();
    leaked.remove();
    while (node.length && !node.is($description)) {
      node.nextAll().remove();
      node = node.parent();
    }
  }
  $description.find('script, form').remove();
  return fitDescription($description.length ? tidyHtml($description.html() ?? '').trim() : '');
}

/**
 * Full-size photos: links (href) or, in newer theme versions, data-src of the gallery items.
 * A few kucheryawiy.com.ua products link the server's file path ("/home/.../www/image/catalog/x.jpg");
 * that is turned into the image's web address (origin + "/image/catalog/x.jpg").
 */
function images($, origin) {
  // glorianapro.com links file names with spaces ("401-050 (1).webp"): encode them so links stay valid.
  const encodeSpaces = (url) => url.replace(/ /g, '%20');
  const imageUrl = (url) => {
    if (/^https?:/.test(url)) return encodeSpaces(url);
    const path = url.match(/^\/\S*?\/(image\/(?:catalog|cache)\/\S+)$/)?.[1];
    return path ? `${origin}/${encodeSpaces(path)}` : ''; // "javascript:;" and the like are dropped
  };
  const urls = $(SEL.images)
    .map((_, el) => imageUrl($(el).attr('href') ?? $(el).attr('data-src') ?? ''))
    .get()
    .filter(Boolean);
  return [...new Set(urls)].join(';');
}

/** In-stock labels ("Немає в наявності" / "Нет в наличии" don't match: the whole label is compared). */
const IN_STOCK_LABEL = /^(є\s+)?в\s+наявності$|^(есть\s+)?в\s+наличии$/i;

/** The product's stock label is the in-stock one (by its style, or by its text). */
function inStock($) {
  return $(SEL.stock)
    .toArray()
    .some((el) => $(el).hasClass('instock') || IN_STOCK_LABEL.test(normText($(el).text())));
}

/** "Виробник: <a><span>Immortal Infuse</span></a>" or a logo "<a><img alt="Jaguar"></a>". */
function manufacturer($) {
  const link = $(SEL.manufacturer).first();
  return normText(link.text()) || normText(link.find('img').attr('alt') ?? '');
}

/** Number of "/"-separated parts of a URL path (deeper = more specific category). */
const depth = (url) => new URL(url).pathname.split('/').filter(Boolean).length;

/**
 * settings:
 *  id, name, website, description, languages - as in every source
 *  menu             selector of the top-level catalogue menu items (<li>)
 *  trailingSlash    the site's links end with "/"
 *  vendor           the brand used when the page shows no manufacturer (or always, see below)
 *  readManufacturer vendor = the manufacturer shown on the product page (shops with several brands)
 *  followSubcategories  also visit the subcategory tiles (a.subcategory) of category pages
 *  pageQuery        category pages are ?page=N instead of /page-N
 *  translatedPaths  Russian category paths differ from the Ukrainian ones (see the top of the file)
 *  homeCategories   selector of more category links on the home page (e.g. a category wall), visited
 *                   after the menu - for categories missing from the menu
 */
export function createUpstoreSource(settings) {
  const {
    menu,
    vendor = '',
    readManufacturer = false,
    followSubcategories = false,
    pageQuery = false,
    translatedPaths = false,
    homeCategories = '',
  } = settings;
  const { origin, langUrl, productLink } = upstoreUrls(settings);
  const host = new URL(origin).host;

  /**
   * Adds the products of a category (all its pages) to `links`: Map(link -> { category }).
   * The first category a product is found in wins. With followSubcategories, the subcategories
   * linked from the page are collected first.
   */
  async function collectCategory(url, lang, links, ctx, visited) {
    if (visited.has(url)) return;
    visited.add(url);

    const $first = await ctx.http.getHtml(url);
    const category = breadcrumb($first).join('/');

    if (followSubcategories) {
      const subs = $first(SEL.subcategories).map((_, a) => $first(a).prop('href')).get();
      for (const sub of new Set(subs.filter(Boolean).map((href) => langUrl(href, lang)))) {
        await collectCategorySafe(sub, lang, links, ctx, visited);
      }
    }

    let $page = $first;
    let previousFirst = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) {
        try {
          $page = await ctx.http.getHtml(pageUrl(url, page, pageQuery));
        } catch (err) {
          // Some sites answer 404 for a page after the last one (others show an empty page).
          if (err.status === 404 || err.status === 410) break;
          throw err;
        }
      }
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

  /** collectCategory, but dead links (404/410: menu items without products, ...) are skipped. */
  async function collectCategorySafe(url, lang, links, ctx, visited) {
    try {
      await collectCategory(url, lang, links, ctx, visited);
    } catch (err) {
      if (err.status !== 404 && err.status !== 410) throw err;
      ctx.log(`Skipping ${url}: ${err.message}`);
    }
  }

  /**
   * Category URLs from the catalogue menu, in menu order, subcategories (deepest first) before their
   * parent. Read from the Ukrainian home page and converted to the language (translatedPaths: read
   * from the home page in the language).
   */
  async function menuCategories(lang, ctx) {
    const $ = await ctx.http.getHtml(translatedPaths ? langUrl(origin, lang) : `${origin}/`);
    const urls = [];
    $(menu).each((_, li) => {
      const top = $(li).children('a').first().prop('href');
      const children = $(li)
        .find('a[href]')
        .map((_, a) => $(a).prop('href'))
        .get()
        .filter((href) => href && href !== top && /^https?:/.test(href));
      const sorted = children.map((href, i) => ({ href, i, d: depth(href) })).sort((a, b) => b.d - a.d || a.i - b.i);
      urls.push(...sorted.map((c) => c.href), top);
    });
    if (homeCategories) urls.push(...$(homeCategories).map((_, a) => $(a).prop('href')).get());
    const categories = [...new Set(urls.filter(Boolean).map((url) => langUrl(url, lang)))];
    if (!categories.length) throw new Error(`Catalogue menu not found on ${host} - the site layout may have changed`);
    return categories;
  }

  /** A pasted category link in the language: /ru/ + path, or (translatedPaths) the page's hreflang link. */
  async function categoryUrl(url, lang, ctx) {
    if (!translatedPaths) return langUrl(url, lang);
    const $ = await ctx.http.getHtml(url);
    const alternate = $(`link[rel="alternate"][hreflang="${lang === 'ru' ? 'ru' : 'uk'}"]`).attr('href');
    return alternate ? langUrl(alternate, lang) : langUrl(url, lang);
  }

  async function parseProduct(link, extra = {}, ctx) {
    const $ = await ctx.http.getHtml(link);
    const specs = attributes($);
    specs.vendor = (readManufacturer && manufacturer($)) || vendor;

    return movePrices(
      createProduct({
        link,
        name: breadcrumb($).at(-1) || textFirst($, 'h1', ''),
        category: extra.category ?? '',
        images: images($, origin),
        description: description($),
        // With a discount: regular price (crossed out) + special price; movePrices keeps the higher one in "price".
        price: money(textFirst($, SEL.price, '')),
        priceSpecial: money(textFirst($, SEL.special, '')),
        sku: textFirst($, SEL.sku, ''),
        parent: '',
        available: inStock($),
        specs,
      }),
    );
  }

  return {
    id: settings.id,
    name: settings.name,
    website: settings.website,
    description: settings.description,
    languages: settings.languages,
    modes: {
      all: { label: 'Whole site', needsUrl: false },
      category: { label: 'One category (paste URL)', needsUrl: true },
    },
    concurrency: 2,

    /** Returns Map(productLink -> { category }). */
    async collectLinks({ lang, mode, url }, ctx) {
      const links = new Map();
      const visited = new Set();
      if (mode === 'all') {
        // Menus can link pages without products (news, ...) that are missing in a language.
        for (const category of await menuCategories(lang, ctx)) await collectCategorySafe(category, lang, links, ctx, visited);
      } else if (mode === 'category') {
        if (!url) throw new Error('Category URL is required for mode "category"');
        await collectCategory(await categoryUrl(url, lang, ctx), lang, links, ctx, visited);
      } else {
        throw new Error(`Unknown mode "${mode}"`);
      }
      return links;
    },

    parseProduct,
  };
}
