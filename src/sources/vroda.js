// vroda-ua.com - port of vroda_ua.VrodaUaCom from vroda.jar
import { contentFirst, eachAttr, exists, hrefs, htmlFirst, normText, specsFromRows, textFirst } from '../core/html.js';
import { createProduct, movePrices } from '../core/product.js';

const ROOT_CATEGORIES = {
  ua: [
    'https://vroda-ua.com/profesiyna-tehnika-dlya-strizhki',
    'https://vroda-ua.com/instrumenti-ta-aksesuari-dlya-barberiv-ta-perukariv',
    'https://vroda-ua.com/immortal-profesiyna-kosmetika',
    'https://vroda-ua.com/instrumenti-dlya-manikyuru-ta-pedikyuru',
    'https://vroda-ua.com/zasobi-dlya-doglyadu-perukars-koji-tehniki',
    'https://vroda-ua.com/instrumenti-ta-aksesuari-dlya-grumingu',
    'https://vroda-ua.com/doglyad-za-oblichchyam-i-tilom',
    'https://vroda-ua.com/profesiyni-sushuari-ta-klimazoni-dlya-volossya',
  ],
  ru: [
    'https://vroda-ua.com/ru/professional-naya-tehnika-dlya-strizhki',
    'https://vroda-ua.com/ru/instrumenty-i-aksessuary-dlya-barberov-i-parikmaherov',
    'https://vroda-ua.com/ru/immortal-professional-naya-kosmetika',
    'https://vroda-ua.com/ru/instrumenty-dlya-manikyura-i-pedikyura',
    'https://vroda-ua.com/ru/sredstva-dlya-uhoda-za-parikmaherskoy-tehnikoy',
    'https://vroda-ua.com/ru/instrumenty-i-aksessuary-dlya-gruminga',
    'https://vroda-ua.com/ru/uhod-za-licom-i-telom',
    'https://vroda-ua.com/ru/professional-nye-sushuary-i-klimazony-dlya-volos',
  ],
};

const SEL = {
  subcategories: 'div.cat_add > a.catpr',
  productLinks: 'div.raiting_thumb > a',
  breadcrumb: 'ul.breadcrumb > li *[itemprop="name"]',
  languageButtons: 'div#form-language ul.dropdown-menu > li > button',
};

const MAX_PAGES = 500;

function pageUrl(url, page) {
  const u = new URL(url);
  u.searchParams.set('page', String(page));
  return u.toString();
}

/**
 * Collects product links of a category into `links` (Map link -> category path).
 * If the category has subcategories, goes into each of them instead (like the jar).
 */
async function collectCategory(url, links, ctx) {
  const $ = await ctx.http.getHtml(url);
  if (exists($, SEL.subcategories)) {
    for (const sub of [...new Set(hrefs($, SEL.subcategories))]) {
      await collectCategory(sub, links, ctx);
    }
    return;
  }

  let previousFirst = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const $page = await ctx.http.getHtml(pageUrl(url, page));
    if (!exists($page, SEL.productLinks)) break;

    const category = $page(SEL.breadcrumb)
      .map((_, el) => normText($page(el).text()))
      .get()
      .join('/');
    const pageLinks = hrefs($page, SEL.productLinks);
    if (pageLinks[0] === previousFirst) break; // safety: site returned the same page again
    previousFirst = pageLinks[0];

    ctx.log(`${category} - page ${page} (${pageLinks.length} products)`);
    for (const link of pageLinks) links.set(link, category);
  }
}

/** The category URL in the requested language (uses the site's language switcher). */
async function localizedUrl(url, lang, ctx) {
  const $ = await ctx.http.getHtml(url);
  const label = lang.toUpperCase();
  const button = $(SEL.languageButtons)
    .filter((_, el) => normText($(el).text()).includes(label))
    .first();
  const onclick = button.attr('onclick') ?? '';
  const match = onclick.match(/window\.location\s*=\s*'([^']+)'/);
  return match ? match[1] : url;
}

async function parseProduct(link, category, ctx) {
  const $ = await ctx.http.getHtml(link);
  const specs = specsFromRows($, $('table.product_specification tbody tr'), { valueIndex: 2, separator: ';' });
  specs.vendor = textFirst($, 'a[itemprop="manufacturer"]', '');

  return movePrices(
    createProduct({
      link,
      name: textFirst($, 'h1[itemprop="name"]', ''),
      category: category ?? '',
      images: eachAttr($, 'img.main-image', 'data-zoom-image').join(';'),
      description: htmlFirst($, 'div#tab-description', ''),
      price: contentFirst($, 'meta[itemprop="price"]', ''),
      priceSpecial: textFirst($, 'span.price-old', '').replace(/[^0-9.]/g, ''),
      sku: contentFirst($, 'meta[itemprop="sku"]', ''),
      parent: '',
      available: exists($, 'link[href="https://schema.org/InStock"]'),
      specs,
    }),
  );
}

export default {
  id: 'vroda',
  name: 'Vroda',
  website: 'https://vroda-ua.com',
  description: 'Professional hairdressing, barber, manicure and grooming equipment.',
  languages: { ua: 'Українська', ru: 'Русский' },
  modes: {
    all: { label: 'Whole site', needsUrl: false },
    category: { label: 'One category (paste URL)', needsUrl: true },
  },
  concurrency: 2,

  /** Returns Map(productLink -> category path). */
  async collectLinks({ lang, mode, url }, ctx) {
    const links = new Map();
    if (mode === 'all') {
      for (const root of ROOT_CATEGORIES[lang]) await collectCategory(root, links, ctx);
    } else if (mode === 'category') {
      if (!url) throw new Error('Category URL is required for mode "category"');
      const start = await localizedUrl(url, lang, ctx);
      await collectCategory(start, links, ctx);
    } else {
      throw new Error(`Unknown mode "${mode}"`);
    }
    return links;
  },

  parseProduct,
};
