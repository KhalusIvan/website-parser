// Shared scraper for WordPress + WooCommerce shops with the "woodmart" theme (babyliss-pro.com.ua,
// spl4barber.com.ua). Each site passes its own settings to createWooSource(). Notes:
//  - Categories come from a catalogue menu on the home page (a selector per site), subcategories
//    before their parent, and categories matching `lastCategories` (e.g. "new") at the very end.
//    Subcategory tiles shown on a category page are visited before the category itself too: with
//    WooCommerce's "show subcategories" mode, page 1 of a parent category shows only those tiles
//    (its first products are only listed in the subcategories), and products continue on page 2.
//  - Pages are /product-category/<slug>/page/2/, ...; the next page is requested only if the page links to
//    it (pagination, <link rel="next"> or woodmart's "load more" button).
//  - Product links are the shop's permalinks (/product/<slug>/), without query strings.
//  - Everything on the product page is read from the main product block only: related / upsell
//    products below it (.product-grid-item) have their own prices and stock labels.
//  - Prices: the crossed-out <del> amount is the regular price, the <ins> amount the sale price.
//  - Stock: the visible label (p.stock) decides: "in-stock" = available; "out-of-stock" and
//    "available-on-backorder" (pre-order) = not available. Products that don't track stock show no
//    label: then they are available only if WooCommerce marks them "instock" and the page has an
//    "add to cart" button.
//  - Specs: WooCommerce's attributes table (woodmart adds hint texts to some names - not exported).
//    Attributes without a name (shown as their slug "pa_...") are skipped.
//    vendor = the value of the site's brand attribute (e.g. "Виробник"), else the shop's brand.
import { fitDescription, normText, tidyHtml, trimChars } from '../../core/html.js';
import { createProduct, movePrices } from '../../core/product.js';

export { fitDescription }; // shared, in core/html.js

const MAX_PAGES = 200;

/** Excel's maximum text length per cell. */

/** "10 000 грн" / "1,250 грн" -> "10000.00" (same format as vroda); '' if there is no number. */
export function money(text) {
  // Thousands separators on these sites are spaces or commas; prices have no decimals.
  const match = String(text ?? '').replace(/[\s ,]/g, '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]).toFixed(2) : '';
}


/** A link without query string / hash, e.g. for product permalinks. */
export function cleanLink(href) {
  const u = new URL(href);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** Category link without paging / query, with a trailing slash: ".../cat/page/3/?x=1" -> ".../cat/". */
export function categoryUrl(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  u.pathname = u.pathname.replace(/\/page\/\d+\/?$/, '/').replace(/\/?$/, '/');
  return u.toString();
}

/** Whether a list page links to the next one (pagination, <link rel="next"> or woodmart's "load more"). */
function hasNextPage($, url, page) {
  const next = pageUrl(url, page + 1);
  return $('link[rel="next"], a.page-numbers, .wd-products-load-more, .woodmart-products-load-more')
    .toArray()
    .some((el) => {
      const href = $(el).prop('href');
      return Boolean(href) && /^https?:/.test(href) && cleanLink(href) === next;
    });
}

export function pageUrl(url, page) {
  return page === 1 ? url : `${url}page/${page}/`;
}

/** Breadcrumb without "Головна" and the "Сторінка 2" crumb of paged lists. */
function breadcrumb($) {
  return $('.woocommerce-breadcrumb')
    .first()
    .children('a, span')
    .map((_, el) => normText($(el).text()))
    .get()
    .slice(1)
    .filter((crumb) => crumb && !/^Сторінка \d+$/.test(crumb));
}

/** Elements of the main product block, without the related / upsell products inside it. */
function inMain($, main, selector) {
  return main.find(selector).filter((_, el) => !$(el).closest('.product-grid-item').length);
}

/**
 * Category links from the catalogue menu, in menu order: for every top-level item its subcategories
 * (deepest first), then the item itself. Categories matching `last` go to the end.
 */
function menuCategories($, menuItems, last) {
  const urls = [];
  const walk = (li) => {
    // Direct sub-items: nested <li>s whose nearest parent item is this one (the dropdown markup varies).
    $(li)
      .find('li')
      .filter((_, child) => $(child).parent().closest('li')[0] === li)
      .each((_, child) => walk(child));
    const href = $(li).children('a').first().prop('href');
    if (href) urls.push(href);
  };
  $(menuItems).each((_, li) => walk(li));
  const categories = [...new Set(urls.filter((url) => /\/product-category\//.test(url)).map(categoryUrl))];
  return [...categories.filter((url) => !last?.test(url)), ...categories.filter((url) => last?.test(url))];
}

/** Attributes table -> { name: value }; several values of one attribute are joined with ", ". */
function attributes($, main) {
  const grouped = new Map();
  inMain($, main, 'table.woocommerce-product-attributes tr, table.shop_attributes tr').each((_, row) => {
    const th = $(row).find('th').first();
    const label = th.find('.wd-attr-name-label');
    const key = trimChars(normText((label.length ? label : th).text()), ' :');
    const td = $(row).find('td').first();
    const terms = td.find('.wd-attr-term').map((_, el) => normText($(el).text())).get().filter(Boolean);
    const value = trimChars(terms.length ? terms.join(', ') : normText(td.text()), ' :');
    // "pa_..." = an attribute whose name was deleted in the shop (the value is then a term id).
    if (!key || /^pa_/.test(key)) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  });
  return Object.fromEntries([...grouped].map(([key, values]) => [key, values.join(';')]));
}

/** Inner HTML of the description tab (without the theme's .wc-tab-inner wrapper), trimmed. */
function descriptionHtml($, selector) {
  let el = $(selector).first();
  if (!el.length) return '';
  const inner = el.children('.wc-tab-inner');
  if (inner.length === 1) el = inner;
  return tidyHtml(el.html() ?? '');
}

/**
 * Creates a source for a WooCommerce + woodmart shop.
 * @param {object} site
 *   id, name, website, description - as in every source
 *   menu            - selector of the catalogue menu's top-level <li> items on the home page
 *   lastCategories  - RegExp of category links visited last ("new", "sale", ...), optional
 *   brandSpec       - name of the attribute that holds the brand (e.g. "Виробник"), optional
 *   brand           - the shop's brand, used when the page shows none
 *   descriptionFallback - selector used when the description tab is missing/empty, optional
 */
export function createWooSource(site) {
  const home = `${site.website}/`;

  /**
   * Adds the products of a category to `links`: Map(link -> { category, listPrice, listSpecial, listStock }).
   * Subcategory tiles on its first page are visited first. The first category a product is found in wins.
   */
  async function collectCategory(url, links, ctx, visited) {
    url = categoryUrl(url);
    if (visited.has(url)) return;
    visited.add(url);

    let $page = await ctx.http.getHtml(url);
    const category = breadcrumb($page).join('/');

    const subcategories = $page('.site-content .category-grid-item a[href*="/product-category/"]')
      .map((_, a) => categoryUrl($page(a).prop('href')))
      .get();
    for (const sub of new Set(subcategories)) await collectCategory(sub, links, ctx, visited);

    let previousFirst = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) {
        try {
          $page = await ctx.http.getHtml(pageUrl(url, page));
        } catch (err) {
          if (err.status === 404) break; // past the last page
          throw err;
        }
      }
      const cards = $page('.site-content .products .product-grid-item').toArray();
      const hrefs = cards.map((card) =>
        $page(card).find('.wd-entities-title a, .product-title a, a.product-image-link').first().prop('href'),
      );
      if (cards.length && hrefs[0] === previousFirst) break; // safety: site returned the same page again
      previousFirst = hrefs[0];

      let added = 0;
      cards.forEach((card, i) => {
        if (!hrefs[i]) return;
        const link = cleanLink(hrefs[i]);
        if (links.has(link)) return;
        const price = $page(card).find('.price').first();
        const stock = ($page(card).attr('class') ?? '').match(/\b(instock|outofstock|onbackorder)\b/);
        links.set(link, {
          category,
          // What the category page shows (not exported; used to check the product pages).
          listPrice: money(price.find('del .amount').first().text()) || money(price.find('.amount').first().text()),
          listSpecial: price.find('del').length ? money(price.find('ins .amount').first().text()) : '',
          listStock: stock ? stock[1] : '',
        });
        added++;
      });
      ctx.log(`${category} - page ${page} (${cards.length} products, ${added} new)`);
      // Only pages the site links to are requested: on spl4barber a page past the end can take
      // minutes to answer. (Page 1 of a parent category can have only subcategory tiles, but a next link.)
      if (!hasNextPage($page, url, page)) break;
    }
  }

  async function collectLinks({ mode, url }, ctx) {
    const links = new Map();
    const visited = new Set();
    if (mode === 'all') {
      const $ = await ctx.http.getHtml(home);
      const categories = menuCategories($, site.menu, site.lastCategories);
      if (!categories.length) throw new Error(`Catalogue menu not found on ${site.website} - the site layout may have changed`);
      for (const category of categories) {
        try {
          await collectCategory(category, links, ctx, visited);
        } catch (err) {
          if (err.status !== 404 && err.status !== 410) throw err;
          ctx.log(`Skipping ${category}: ${err.message}`);
        }
      }
    } else if (mode === 'category') {
      if (!url) throw new Error('Category URL is required for mode "category"');
      await collectCategory(url, links, ctx, visited);
    } else {
      throw new Error(`Unknown mode "${mode}"`);
    }
    return links;
  }

  async function parseProduct(link, extra = {}, ctx) {
    const $ = await ctx.http.getHtml(link);
    let main = $('.single-product-page').first();
    if (!main.length) main = $('div.product.type-product').first();
    if (!main.length) throw new Error(`Product block not found on ${link}`);

    // Price block of the product itself (related products have their own .price elements).
    const priceBlock = inMain($, main, 'p.price, .summary .price').first();
    const regular = priceBlock.find('del .amount').first();
    const sale = priceBlock.find('ins .amount').first();
    const price = money((regular.length ? regular : priceBlock.find('.amount').first()).text());
    const priceSpecial = regular.length ? money(sale.text()) : '';

    // Visible stock label; products that don't track stock have none (see the note at the top).
    const label = inMain($, main, 'p.stock, .stock').first();
    const available = label.length
      ? label.hasClass('in-stock')
      : main.hasClass('instock') && inMain($, main, 'form.cart .single_add_to_cart_button').length > 0;

    const images = inMain($, main, '.woocommerce-product-gallery__image')
      .map((_, el) => $(el).find('a').first().prop('href') || $(el).find('img').first().attr('data-large_image'))
      .get()
      .filter((src) => /^https?:\/\//.test(src ?? ''));

    let description = descriptionHtml($, '#tab-description');
    if (!description && site.descriptionFallback) description = descriptionHtml($, site.descriptionFallback);

    const specs = attributes($, main);
    specs.vendor = (site.brandSpec && specs[site.brandSpec]) || site.brand;

    return movePrices(
      createProduct({
        link,
        name: normText(inMain($, main, 'h1.product_title').first().text()) || breadcrumb($).at(-1) || '',
        category: extra.category ?? breadcrumb($).slice(0, -1).join('/'),
        images: [...new Set(images)].join(';'),
        description: fitDescription(description),
        price,
        priceSpecial,
        sku: normText(inMain($, main, '.product_meta .sku').first().text()).replace(/^(Н\/Д|N\/A)$/i, ''),
        parent: '',
        available,
        specs,
      }),
    );
  }

  return {
    id: site.id,
    name: site.name,
    website: site.website,
    description: site.description,
    languages: { ua: 'Українська' },
    modes: {
      all: { label: 'Whole site', needsUrl: false },
      category: { label: 'One category (paste URL)', needsUrl: true },
    },
    concurrency: 2,
    collectLinks,
    parseProduct,
  };
}
