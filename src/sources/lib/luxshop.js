// Shared code for OpenCart shops with the "luxshop" theme (jaguar-solingen.in.ua, moser-animal.com).
// createLuxshopSource(settings) returns a source object; each site file only passes its settings.
// What these shops have in common:
//  - Catalogue menu: #menu-vertical-list, nested lists (up to 3 levels). Categories are visited deepest
//    first (by their breadcrumb, as the menu shows some subcategories at the top level), so a product
//    gets its most specific category; equally deep ones in menu order, children before parents.
//  - Category pages: product grid .product-layout .product-thumb (other .product-thumb blocks on the
//    page are blog-article carousels), pages /category/page-2, /category/page-3, ... A page after the
//    last one is a 404 (not an empty page), so paging stops when there is no link to the next page.
//  - SEO URLs with the product's main category in the path (SeoPro): every other path redirects to it,
//    so the link of a category card is already the product's one link. Russian: /ru/ + the same path.
//  - Product page: everything of the product is inside #product (related products are outside it).
//    Stock: .info-product-stock label (.stock_status_success = in stock). Specs: #tab-specification
//    (the short list next to the photo repeats some of them with " - " and is ignored). The schema.org
//    data says InStock even for sold-out products. A module appends "Відео огляд" blocks (heading,
//    <style>, iframe, JSON-LD) to many descriptions; they are removed.
//  - "Options" that link to other product pages (sizes, colours, pairs: .options a.view0_link) are
//    separate products; they are reported with ctx.addProduct in case they are in no category.
import { eachAttr, fitDescription, htmlFirst, normText, textFirst, trimChars } from '../../core/html.js';
import { createProduct, movePrices } from '../../core/product.js';

export { fitDescription }; // shared, in core/html.js

const MAX_PAGES = 200;

const SEL = {
  menu: '#menu-vertical-list',
  card: '.product-layout .product-thumb',
  cardLink: '.product-name a',
  breadcrumb: '.breadcrumb li',
  pagination: '.pagination a[href]',
  price: '#product .price .autocalc-product-price',
  special: '#product .price .autocalc-product-special',
  sku: '#product .info-model span',
  manufacturer: '#product .info-manufacturer a, #product .info-manufacturer span',
  stock: '#product .info-product-stock',
  inStock: '.stock_status_success',
  images: '#product a.main-image, #product a.dop-img',
  description: '#tab-description',
  descriptionJunk: '.product-video, style, script',
  attributes: '#tab-specification .short-attribute',
  linkedProducts: '#product .options a.view0_link[href]',
};

/** "12 929 грн." / "1 149грн" / "12929.0000" -> "12929.00" (same format as vroda); '' if there is no number. */
export function money(text) {
  const match = String(text ?? '').replace(/[\s ]/g, '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')).toFixed(2) : '';
}


/** Image links that are not real photos ("javascript:void(0)" video thumbnails, placeholders). */
const NOT_A_PHOTO = /^(?!https?:)|\/(no_image|placeholder)[^/]*$/i;

/**
 * @param {object} site
 * @param {string} site.id
 * @param {string} site.name
 * @param {string} site.website        e.g. 'https://moser-animal.com' (no trailing slash)
 * @param {string} site.description
 * @param {object} site.languages      e.g. { ua: 'Українська', ru: 'Русский' }; ru pages are /ru/...
 * @param {string} site.vendor         brand used when the page shows no manufacturer
 * @param {object} [site.columns]      spec columns exported even when empty, per language
 * @param {string[]} [site.skipCrumbPaths]  breadcrumb links left out of `category` (e.g. a root "All products")
 * @param {RegExp} [site.lateCategory] menu categories (UA name) visited after their sibling categories
 */
export function createLuxshopSource(site) {
  const ORIGIN = site.website;
  const skipCrumbPaths = new Set((site.skipCrumbPaths ?? []).map(pathOf));

  /** Path of a site URL without the language prefix and query: ".../ru/all/scissors/" -> "all/scissors/". */
  function pathOf(url) {
    return new URL(url, ORIGIN).pathname.replace(/^\/(ru(\/|$))?/, '');
  }

  /** Site URL for a language: ua -> https://site/a/b, ru -> https://site/ru/a/b */
  function langUrl(url, lang) {
    return `${ORIGIN}/${lang === 'ru' ? 'ru/' : ''}${pathOf(url)}`;
  }

  /** A pasted category link -> its first page in the language (no /page-N, query or #hash). */
  function categoryUrl(url, lang) {
    return langUrl(url, lang).replace(/\/page-\d+\/?$/, '/');
  }

  function pageUrl(url, page) {
    return page === 1 ? url : `${url.replace(/\/$/, '')}/page-${page}`;
  }

  /** Breadcrumb without "Головна" (and the skipped root crumbs), e.g. "Ножиці/Серія Gold Line". */
  function breadcrumb($) {
    return $(SEL.breadcrumb)
      .slice(1)
      .filter((_, li) => {
        const href = $(li).find('a').first().prop('href');
        return !href || !skipCrumbPaths.has(pathOf(href));
      })
      .map((_, li) => normText($(li).text()))
      .get()
      .filter(Boolean);
  }

  /** One page of a category -> { crumbs, links (in the language, page order), hasNext }. */
  async function readPage(url, page, lang, ctx) {
    const $ = await ctx.http.getHtml(pageUrl(url, page));
    const links = $(SEL.card)
      .map((_, card) => $(card).find(SEL.cardLink).first().prop('href'))
      .get()
      .filter(Boolean)
      .map((href) => langUrl(href, lang));
    const hasNext = $(SEL.pagination).filter((_, a) => $(a).attr('href')?.endsWith(`/page-${page + 1}`)).length > 0;
    return { crumbs: breadcrumb($), links, hasNext };
  }

  /**
   * Adds the products of a category (all its pages) to `links`: Map(link -> { category }).
   * The first category a product is found in wins. `first` = its first page, if already read.
   */
  async function collectCategory(url, lang, links, ctx, first) {
    let current = first ?? (await readPage(url, 1, lang, ctx));
    const category = current.crumbs.join('/');

    let previousFirst = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) {
        try {
          current = await readPage(url, page, lang, ctx);
        } catch (err) {
          if (err.status === 404 || err.status === 410) break; // a page after the last one is a 404 here
          throw err;
        }
      }
      if (!current.links.length) break;
      if (current.links[0] === previousFirst) break; // safety: site returned the same page again
      previousFirst = current.links[0];

      let added = 0;
      for (const link of current.links) {
        if (links.has(link)) continue;
        links.set(link, { category });
        added++;
      }
      ctx.log(`${category || url} - page ${page} (${current.links.length} products, ${added} new)`);
      if (!current.hasNext) break;
    }
  }

  /**
   * Category URLs from the catalogue menu of the Ukrainian home page, converted to the language:
   * depth first, subcategories before their parent, `lateCategory` ones after their siblings.
   */
  async function menuCategories(lang, ctx) {
    const $ = await ctx.http.getHtml(`${ORIGIN}/`);
    const urls = [];
    const visit = (li) => {
      const children = $(li)
        .find('li')
        .filter((_, child) => $(child).parent().closest('li')[0] === li)
        .toArray();
      const late = (child) => site.lateCategory?.test(normText($(child).children('a').first().text())) ?? false;
      for (const child of [...children.filter((c) => !late(c)), ...children.filter(late)]) visit(child);
      const href = $(li).children('a').first().prop('href');
      if (href) urls.push(href);
    };
    $(SEL.menu).children('li').each((_, li) => visit(li));
    const categories = [...new Set(urls.map((url) => categoryUrl(url, lang)))];
    if (!categories.length) throw new Error(`Catalogue menu not found on ${ORIGIN} - the site layout may have changed`);
    return categories;
  }

  /** Specifications -> { name: value }; repeated names joined with ";". */
  function attributes($) {
    const grouped = new Map();
    $(SEL.attributes).each((_, el) => {
      const key = trimChars(normText($(el).find('.attr-name').text()), ' :-');
      const value = trimChars(normText($(el).find('.attr-text').text()), ' :');
      if (!key) return;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(value);
    });
    return Object.fromEntries([...grouped].map(([key, values]) => [key, values.join(';')]));
  }

  /**
   * The description without the "Відео огляд / Подивіться товар у дії" video blocks a module appends
   * to it (each with its own <style> and JSON-LD <script>).
   */
  function description($) {
    $(SEL.description).find(SEL.descriptionJunk).remove();
    return fitDescription(htmlFirst($, SEL.description, ''));
  }

  async function parseProduct(link, extra = {}, ctx) {
    const $ = await ctx.http.getHtml(link);
    const lang = new URL(link).pathname.startsWith('/ru/') ? 'ru' : 'ua';

    // Other sizes / colours / pairs are separate products, linked from the options block.
    for (const href of new Set(eachAttr($, SEL.linkedProducts, 'href'))) {
      ctx.addProduct?.(langUrl(href, lang), { category: extra.category ?? '' });
    }

    const specs = attributes($);
    specs.vendor = textFirst($, SEL.manufacturer, '') || site.vendor;

    // With a discount the theme shows the regular price crossed out next to the special price.
    const price = money(textFirst($, SEL.price, ''));
    const special = money(textFirst($, SEL.special, ''));
    const stock = $(SEL.stock).first();

    return movePrices(
      createProduct({
        link,
        name: breadcrumb($).at(-1) || textFirst($, 'h1', ''),
        category: extra.category ?? '',
        images: [...new Set(eachAttr($, SEL.images, 'href').filter((href) => !NOT_A_PHOTO.test(href)))].join(';'),
        description: description($),
        price,
        priceSpecial: special,
        sku: textFirst($, SEL.sku, ''),
        parent: '',
        available: stock.find(SEL.inStock).length > 0,
        specs,
      }),
    );
  }

  return {
    id: site.id,
    name: site.name,
    website: site.website,
    description: site.description,
    languages: site.languages,
    modes: {
      all: { label: 'Whole site', needsUrl: false },
      category: { label: 'One category (paste URL)', needsUrl: true },
    },
    concurrency: 2,
    columns: site.columns,

    /** Returns Map(productLink -> { category }). */
    async collectLinks({ lang, mode, url }, ctx) {
      const links = new Map();
      if (mode === 'all') {
        const categories = [];
        for (const url of await menuCategories(lang, ctx)) {
          try {
            categories.push({ url, first: await readPage(url, 1, lang, ctx) });
          } catch (err) {
            if (err.status !== 404 && err.status !== 410) throw err;
            ctx.log(`Skipping ${url}: ${err.message}`);
          }
        }
        // Most specific first: deeper categories (by breadcrumb) before shallower ones, else menu order.
        // The menu puts some subcategories at the top level (jaguar: "Cумки та чохли" is under "Ножиці").
        categories.sort((a, b) => b.first.crumbs.length - a.first.crumbs.length);
        for (const { url, first } of categories) await collectCategory(url, lang, links, ctx, first);
      } else if (mode === 'category') {
        if (!url) throw new Error('Category URL is required for mode "category"');
        await collectCategory(categoryUrl(url, lang), lang, links, ctx);
      } else {
        throw new Error(`Unknown mode "${mode}"`);
      }
      return links;
    },

    parseProduct,
  };
}
