// jrl.in.ua - official JRL store (OpenCart, "cyberstore" theme). Ukrainian only.
// Same Excel columns as vroda. Notes about this site:
//  - Categories come from the catalogue menu (#menu-list), so new categories are picked up automatically.
//  - A product can be listed in several categories; it is exported once, with the first category found.
//  - Products without a friendly URL link to index.php?route=product/product&path=..&product_id=..
//    where "path" depends on the category - it is removed so each product has one link.
//  - Colour variants are usually not listed in categories (only one colour of each comb is) but
//    linked from the product page ("Колір"); they are followed and exported after that product.
//  - Stock: the hidden schema.org data says "InStock" even for sold-out products, so the visible
//    label is used instead ("В наявності" = in stock, "Немає в наявності" = sold out).
//  - There is no specifications table; real attributes the shop fills in are exported as columns
//    (placeholders like "атрибут 1" are skipped). vendor is always JRL (the official JRL store; only
//    a couple of product pages link to the brand). All vroda spec columns are in the file, mostly empty.
import { contentFirst, eachAttr, exists, htmlFirst, normText, textFirst, trimChars } from '../core/html.js';
import { createProduct, movePrices } from '../core/product.js';
import { VRODA_UA_COLUMNS } from './vroda-columns.js';

const HOME = 'https://jrl.in.ua/';
const MAX_PAGES = 200;

const SEL = {
  menu: '#menu-list > li > a',
  subcategories: 'a.subcategory',
  card: '.product-thumb',
  cardLink: '.product-name a',
  cardPrice: '.price[data-price-no-format]',
  breadcrumb: '.breadcrumb li',
  images: 'a.main-image, a.dop-img',
  inStock: '#product .stock_status_success',
  oldPrice: '#product .price:not(.pds) .price-old', // .price.pds is the colour switcher, not a price
  colourVariants: '#product .pds a[href]',
  attributes: '#tab-specification .short-attribute',
  manufacturer: 'a[href*="route=product/manufacturer/info"]',
};

/** "7 199 грн." / "15599.0000" -> "7199.00" (same format as vroda); '' if there is no number. */
export function money(text) {
  const match = String(text ?? '').replace(/[\s ]/g, '').match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')).toFixed(2) : '';
}

/** Excel's maximum text length per cell. */
const EXCEL_CELL_LIMIT = 32767;

/**
 * Some descriptions were pasted from Word and are mostly inline styles (e.g. 35 000 characters,
 * 2 700 of them text). Those would be cut off in Excel, losing text and breaking the HTML, so for
 * them only, the style attributes and Word's <o:p> tags are removed. Shorter ones stay unchanged.
 */
export function fitDescription(html) {
  if (html.length <= EXCEL_CELL_LIMIT) return html;
  return html.replace(/\s+style="[^"]*"/gi, '').replace(/<\/?o:p[^>]*>/gi, '');
}

/** Removes the category-dependent "path" parameter from index.php product links. */
export function normalizeLink(link) {
  return link.replace(/([?&])path=[^&#]*&?/, '$1').replace(/[?&]$/, '');
}

function pageUrl(url, page) {
  const u = new URL(url);
  u.searchParams.set('page', String(page));
  return u.toString();
}

/**
 * Adds the products of a category (all its pages) and of its subcategories to `links`:
 * Map(link -> { category, listPrice, listSpecial }). The first category a product is found in wins.
 */
async function collectCategory(url, links, ctx, visited = new Set()) {
  if (visited.has(url)) return;
  visited.add(url);

  let $page = await ctx.http.getHtml(url);
  const category = $page(SEL.breadcrumb)
    .map((_, el) => normText($page(el).text()))
    .get()
    .filter(Boolean) // the "home" crumb is only an icon
    .join('/');
  const subcategories = [...new Set($page(SEL.subcategories).map((_, el) => $page(el).prop('href')).get())];

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
      const link = normalizeLink(href);
      if (links.has(link)) continue;
      const price = $page(card).find(SEL.cardPrice).first();
      links.set(link, {
        category,
        listPrice: price.attr('data-price-no-format') ?? '',
        listSpecial: price.attr('data-special-no-format') ?? '',
      });
      added++;
    }
    ctx.log(`${category} - page ${page} (${cards.length} products, ${added} new)`);
  }

  for (const sub of subcategories) await collectCategory(sub, links, ctx, visited);
}

/** Top-level categories from the catalogue menu (info pages in the menu simply have no products). */
async function rootCategories(ctx) {
  const $ = await ctx.http.getHtml(HOME);
  const roots = [...new Set($(SEL.menu).map((_, el) => $(el).prop('href')).get())];
  if (!roots.length) throw new Error('Catalogue menu not found on jrl.in.ua - the site layout may have changed');
  return roots;
}

/** Attribute names the shop left as template placeholders, e.g. "атрибут 1" with all specs in one line. */
const PLACEHOLDER_ATTRIBUTE = /^атрибут\s*\d*$/i;

/** Shop attributes (rarely filled in on this site) -> { name: value }; repeated names joined with ";". */
function attributes($) {
  const grouped = new Map();
  $(SEL.attributes).each((_, el) => {
    const key = trimChars(normText($(el).find('.attr-name').text()), ' :');
    const value = trimChars(normText($(el).find('.attr-text').text()), ' :');
    if (!key || PLACEHOLDER_ATTRIBUTE.test(key)) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  });
  return Object.fromEntries([...grouped].map(([key, values]) => [key, values.join(';')]));
}

async function parseProduct(link, extra = {}, ctx) {
  const $ = await ctx.http.getHtml(link);
  // Colour variants (other colours of a comb, ...) often aren't listed in any category - only
  // linked from here. Report them so they get scraped too, with this product's category.
  const variants = [...new Set($(SEL.colourVariants).map((_, el) => $(el).prop('href')).get())];
  for (const href of variants) {
    ctx.addProduct?.(normalizeLink(href), { category: extra.category ?? '', listPrice: '', listSpecial: '' });
  }

  const specs = attributes($);
  specs.vendor =
    $(SEL.manufacturer)
      .map((_, el) => normText($(el).text()))
      .get()
      .find(Boolean) || 'JRL';

  // With a discount the category card has both numbers (regular + special) - the most reliable source.
  // Otherwise: price from the product page, old price from its own price block (if the shop shows one).
  let price;
  let priceSpecial;
  if (money(extra.listSpecial)) {
    price = money(extra.listPrice);
    priceSpecial = money(extra.listSpecial);
  } else {
    price = money(contentFirst($, '[itemprop="offers"] meta[itemprop="price"]', '')) || money(extra.listPrice);
    priceSpecial = money(textFirst($, SEL.oldPrice, ''));
  }

  return movePrices(
    createProduct({
      link,
      name: textFirst($, '#content h1', ''),
      category: extra.category ?? '',
      images: [...new Set(eachAttr($, SEL.images, 'href'))].join(';'),
      description: fitDescription(htmlFirst($, '#tab-description', '')),
      price,
      priceSpecial,
      sku: contentFirst($, 'meta[itemprop="sku"]', ''),
      parent: '',
      available: exists($, SEL.inStock),
      specs,
    }),
  );
}

export default {
  id: 'jrl',
  name: 'JRL',
  website: 'https://jrl.in.ua',
  description: 'Official JRL store: clippers, trimmers, shavers, hair dryers, spare parts and accessories.',
  languages: { ua: 'Українська' },
  modes: {
    all: { label: 'Whole site', needsUrl: false },
    category: { label: 'One category (paste URL)', needsUrl: true },
  },
  concurrency: 2,
  // Same spec columns as the vroda file, even if empty here, so both files have the same layout.
  columns: { ua: VRODA_UA_COLUMNS },

  /** Returns Map(productLink -> { category, listPrice, listSpecial }). */
  async collectLinks({ mode, url }, ctx) {
    const links = new Map();
    const visited = new Set();
    if (mode === 'all') {
      for (const root of await rootCategories(ctx)) {
        try {
          await collectCategory(root, links, ctx, visited);
        } catch (err) {
          // The menu also links info pages; one of them is a dead link (404). Skip those.
          if (err.status !== 404 && err.status !== 410) throw err;
          ctx.log(`Skipping ${root}: ${err.message}`);
        }
      }
    } else if (mode === 'category') {
      if (!url) throw new Error('Category URL is required for mode "category"');
      await collectCategory(url, links, ctx, visited);
    } else {
      throw new Error(`Unknown mode "${mode}"`);
    }
    return links;
  },

  parseProduct,
};
