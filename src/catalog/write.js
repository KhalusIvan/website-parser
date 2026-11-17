// Writes the catalog as one Excel workbook (for the shop's importer) and the same data as JSON.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { slugify } from './slug.js';

const CELL_LIMIT = 32767;
const cell = (v) => (typeof v === 'string' && v.length > CELL_LIMIT ? v.slice(0, CELL_LIMIT) : v);

const STOCK = { ua: ['В наявності', 'Немає в наявності'], ru: ['В наличии', 'Нет в наличии'] };

/** Adds a sheet with a bold frozen header row, a filter and sensible column widths. */
function addSheet(wb, name, columns, rows) {
  const sheet = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(([key, header, width = 14]) => ({ key, header, width }));
  for (const row of rows) sheet.addRow(Object.fromEntries(columns.map(([key]) => [key, cell(row[key] ?? '')])));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

/** Turns the built catalog into flat tables (ids for categories and brands, product rows, ...). */
export function tables({ products, categories }) {
  // categories that have products (directly or below them), numbered in tree order
  const total = new Map();
  const direct = new Map();
  for (const p of products) direct.set(p.categoryId, (direct.get(p.categoryId) ?? 0) + 1);
  const byKey = new Map(categories.map((c) => [c.id, c]));
  for (const [id, n] of direct) for (let c = byKey.get(id); c; c = byKey.get(c.parent)) total.set(c.id, (total.get(c.id) ?? 0) + n);
  const usedCategories = categories.filter((c) => total.get(c.id));
  const categoryId = new Map(usedCategories.map((c, i) => [c.id, i + 1]));
  const categoryRows = usedCategories.map((c) => ({
    id: categoryId.get(c.id),
    key: c.id,
    parent_id: c.parent ? categoryId.get(c.parent) : 0,
    parent_key: c.parent ?? '',
    name_ua: c.ua,
    name_ru: c.ru,
    path_ua: c.pathUa,
    path_ru: c.pathRu,
    seo_keyword_ua: slugify(c.ua, 'uk'),
    seo_keyword_ru: `${slugify(c.ru, 'ru')}-ru`,
    sort_order: c.sort,
    products: direct.get(c.id) ?? 0,
    products_total: total.get(c.id),
  }));

  const brandNames = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const brandId = new Map(brandNames.map((b, i) => [b, i + 1]));
  const brandRows = brandNames.map((b) => ({
    id: brandId.get(b),
    name: b,
    seo_keyword: slugify(b, 'uk'),
    products: products.filter((p) => p.brand === b).length,
  }));

  const productRows = products.map((p) => {
    const files = (p.photos ?? []).map((ph) => ph.file);
    return {
      id: p.id,
      key: p.key,
      sku: p.sku,
      partner_name: p.partnerName,
      brand_id: brandId.get(p.brand) ?? '',
      brand: p.brand,
      maker: p.maker ?? p.brand,
      category_id: categoryId.get(p.categoryId),
      category_key: p.categoryId,
      category_ua: byKey.get(p.categoryId).pathUa,
      category_ru: byKey.get(p.categoryId).pathRu,
      name_ua: p.nameUa,
      name_ru: p.nameRu,
      description_ua: p.descriptionUa,
      description_ru: p.descriptionRu,
      meta_title_ua: p.nameUa,
      meta_title_ru: p.nameRu,
      meta_description_ua: p.metaDescriptionUa,
      meta_description_ru: p.metaDescriptionRu,
      seo_keyword_ua: p.seoUa,
      seo_keyword_ru: `${p.seoRu}-ru`,
      price: p.price || '',
      special_price: p.special || '',
      available: p.available ? 1 : 0,
      stock_status_ua: STOCK.ua[p.available ? 0 : 1],
      stock_status_ru: STOCK.ru[p.available ? 0 : 1],
      main_image: files[0] ?? '',
      images: files.slice(1).join(';'),
      image_urls: p.photoUrls.join(';'),
      price_source: p.priceSource,
      price_source_url: p.priceLink,
      price_note: p.priceNote,
      content_source: p.contentSource,
      description_source: p.descriptionSource,
      photo_source: p.photoSource,
      suppliers: p.offers.length,
    };
  });

  const attributeRows = [];
  const attributeUse = new Map();
  for (const p of products) {
    p.specs.forEach((s, i) => {
      attributeRows.push({ product_id: p.id, sku: p.sku, attribute_ua: s.ua, attribute_ru: s.ru, value_ua: s.valueUa, value_ru: s.valueRu, sort_order: i + 1 });
      const u = attributeUse.get(s.ua) ?? { attribute_ua: s.ua, attribute_ru: s.ru, products: 0, categories: new Map() };
      u.products++;
      u.categories.set(p.categoryId, (u.categories.get(p.categoryId) ?? 0) + 1);
      attributeUse.set(s.ua, u);
    });
  }
  const attributeListRows = [...attributeUse.values()]
    .sort((a, b) => b.products - a.products)
    .map((u, i) => ({
      id: i + 1,
      attribute_ua: u.attribute_ua,
      attribute_ru: u.attribute_ru,
      products: u.products,
      main_categories: [...u.categories].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => byKey.get(id).ua).join('; '),
    }));

  const imageRows = products.flatMap((p) =>
    (p.photos ?? []).map((ph, i) => ({ product_id: p.id, sku: p.sku, position: i + 1, file: ph.file, source_url: ph.url })),
  );
  const offerRows = products.flatMap((p) =>
    p.offers.map((o) => ({
      product_id: p.id,
      sku: p.sku,
      shop: o.source,
      url: o.link,
      url_ru: o.linkRu,
      supplier_sku: o.sku,
      price: o.price || '',
      special_price: o.special || '',
      available: o.available ? 1 : 0,
      chosen_for_price: o.link === p.priceLink ? 1 : 0,
    })),
  );
  return { categoryRows, brandRows, productRows, attributeRows, attributeListRows, imageRows, offerRows };
}

const README = [
  ['Mainmarket catalog', ''],
  ['Built', ''],
  ['', ''],
  ['Sheet', 'What it is'],
  ['Products', 'One row per product. id = product id used in the other sheets. Prices in UAH.'],
  ['Attributes', 'Characteristics: one row per product and attribute, Ukrainian and Russian name and value.'],
  ['Categories', 'Category tree: id, parent_id (0 = top level), names, SEO keywords. Only categories with products.'],
  ['Brands', 'Manufacturers: id = brand_id in Products.'],
  ['Images', 'Photos: file is relative to the images folder (copy "catalog/" into OpenCart image/). Position 1 = main photo.'],
  ['Supplier offers', 'Every shop that sells the product, with its price and stock (for later price updates).'],
  ['Attribute list', 'All attributes with Russian names, how many products use them, main categories.'],
  ['', ''],
  ['Column (Products)', ''],
  ['key', 'Stable product key: brand family + normalised article. Same product = same key in every rebuild.'],
  ['sku', "The partner's product code (partner list). Without a partner list: the article as the official brand store (or the first shop) writes it."],
  ['partner_name', "The product's name in the partner list (to check the match)."],
  ['price / special_price', 'From the cheapest shop that has the product in stock (else the cheapest one). special_price = sale price, empty if none.'],
  ['available', '1 = in stock at least at one shop with a price.'],
  ['price_note', 'Filled when the cheapest price was skipped because it is less than half of what the other shops ask (a likely error or another pack size). Worth a look.'],
  ['name_* / description_*', 'From the official brand store if it sells the product, else vroda, else kucheryawiy. Russian from the same shop when it has a Russian page, else another shop. A description is taken from another shop when it is at least 2.5x as complete.'],
  ['description_*', 'Cleaned HTML: p, br, lists, b/strong, i/em, h2-h4, tables, YouTube iframes. No styles, links, images or "buy on our site" sentences.'],
  ['main_image / images', 'Local photo files (main photo, then the others separated by ";"). Original uploads where the shop has them.'],
  ['image_urls', 'Where the photos come from (supplier URLs).'],
  ['seo_keyword_*', 'Unique URL keywords (Ukrainian transliteration; Russian ones end with "-ru").'],
  ['price_source / content_source / description_source / photo_source', 'Which shop each part comes from.'],
  ['Empty Russian fields', 'The shop has no Russian version and no other shop sells the product: use the Ukrainian text.'],
];

export async function writeCatalog(catalog, outDir, { log = console.log } = {}) {
  await mkdir(outDir, { recursive: true });
  const t = tables(catalog);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'website-parser';

  addSheet(wb, 'Products', [
    ['id', 'id', 7], ['key', 'key', 22], ['sku', 'sku', 16], ['partner_name', 'partner_name', 50], ['brand_id', 'brand_id', 9], ['brand', 'brand', 14],
    ['category_id', 'category_id', 11], ['category_key', 'category_key', 18], ['category_ua', 'category_ua', 40], ['category_ru', 'category_ru', 40],
    ['name_ua', 'name_ua', 60], ['name_ru', 'name_ru', 60], ['description_ua', 'description_ua', 50], ['description_ru', 'description_ru', 50],
    ['meta_title_ua', 'meta_title_ua', 30], ['meta_title_ru', 'meta_title_ru', 30], ['meta_description_ua', 'meta_description_ua', 30], ['meta_description_ru', 'meta_description_ru', 30],
    ['seo_keyword_ua', 'seo_keyword_ua', 30], ['seo_keyword_ru', 'seo_keyword_ru', 30],
    ['price', 'price', 10], ['special_price', 'special_price', 12], ['available', 'available', 9], ['stock_status_ua', 'stock_status_ua', 16], ['stock_status_ru', 'stock_status_ru', 16],
    ['main_image', 'main_image', 40], ['images', 'images', 40], ['image_urls', 'image_urls', 40],
    ['price_source', 'price_source', 12], ['price_source_url', 'price_source_url', 40], ['price_note', 'price_note', 30], ['content_source', 'content_source', 12],
    ['description_source', 'description_source', 12], ['photo_source', 'photo_source', 12], ['suppliers', 'suppliers', 9],
  ], t.productRows);
  addSheet(wb, 'Attributes', [
    ['product_id', 'product_id', 10], ['sku', 'sku', 16], ['attribute_ua', 'attribute_ua', 34], ['attribute_ru', 'attribute_ru', 34],
    ['value_ua', 'value_ua', 40], ['value_ru', 'value_ru', 40], ['sort_order', 'sort_order', 10],
  ], t.attributeRows);
  addSheet(wb, 'Categories', [
    ['id', 'id', 6], ['key', 'key', 20], ['parent_id', 'parent_id', 9], ['parent_key', 'parent_key', 14], ['name_ua', 'name_ua', 40], ['name_ru', 'name_ru', 40],
    ['path_ua', 'path_ua', 60], ['path_ru', 'path_ru', 60], ['seo_keyword_ua', 'seo_keyword_ua', 36], ['seo_keyword_ru', 'seo_keyword_ru', 36],
    ['sort_order', 'sort_order', 10], ['products', 'products', 10], ['products_total', 'products_total', 13],
  ], t.categoryRows);
  addSheet(wb, 'Brands', [['id', 'id', 6], ['name', 'name', 20], ['seo_keyword', 'seo_keyword', 20], ['products', 'products', 10]], t.brandRows);
  addSheet(wb, 'Images', [['product_id', 'product_id', 10], ['sku', 'sku', 16], ['position', 'position', 9], ['file', 'file', 70], ['source_url', 'source_url', 70]], t.imageRows);
  addSheet(wb, 'Supplier offers', [
    ['product_id', 'product_id', 10], ['sku', 'sku', 16], ['shop', 'shop', 12], ['url', 'url', 60], ['url_ru', 'url_ru', 60], ['supplier_sku', 'supplier_sku', 16],
    ['price', 'price', 10], ['special_price', 'special_price', 12], ['available', 'available', 9], ['chosen_for_price', 'chosen_for_price', 14],
  ], t.offerRows);
  addSheet(wb, 'Attribute list', [['id', 'id', 6], ['attribute_ua', 'attribute_ua', 36], ['attribute_ru', 'attribute_ru', 36], ['products', 'products', 10], ['main_categories', 'main_categories', 80]], t.attributeListRows);

  const readme = wb.addWorksheet('README');
  README[1][1] = new Date().toISOString().slice(0, 16).replace('T', ' ');
  readme.columns = [{ width: 34 }, { width: 140 }];
  for (const row of README) readme.addRow(row);
  readme.getRow(1).font = { bold: true, size: 14 };
  readme.getRow(4).font = { bold: true };
  readme.getRow(13).font = { bold: true };
  readme.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  const xlsx = path.join(outDir, 'mainmarket-catalog.xlsx');
  await wb.xlsx.writeFile(xlsx);
  const json = path.join(outDir, 'mainmarket-catalog.json');
  await writeFile(json, JSON.stringify({ built: README[1][1], categories: t.categoryRows, brands: t.brandRows, products: catalog.products.map((p) => ({ ...t.productRows[p.id - 1], attributes: p.specs.map(({ ua, ru, valueUa, valueRu }) => ({ ua, ru, valueUa, valueRu })), photos: p.photos ?? [], offers: p.offers })) }, null, 1));
  log(`Written: ${xlsx}, ${json}`);
  return { xlsx, json, counts: { products: t.productRows.length, attributes: t.attributeRows.length, categories: t.categoryRows.length, brands: t.brandRows.length, images: t.imageRows.length, offers: t.offerRows.length } };
}

/** What the partner list left out: for checking (mainmarket-review.xlsx). */
export async function writeReview(review, outDir, { log = console.log } = {}) {
  if (!review) return null;
  const wb = new ExcelJS.Workbook();
  const cheapest = (g) => Math.min(...g.offers.map((o) => o.effectivePrice || Infinity));
  addSheet(wb, 'Not in partner list', [
    ['brand', 'brand', 14], ['articles', 'articles on the sites', 24], ['name', 'name', 70], ['shops', 'shops', 24],
    ['price', 'cheapest price', 12], ['available', 'available', 9], ['link', 'link', 70],
  ], review.notInPartner.map((g) => ({
    brand: g.offers[0].brand,
    articles: [...new Set(g.offers.map((o) => o.sku).filter(Boolean))].join(' / '),
    name: g.offers[0].ua.name,
    shops: g.offers.map((o) => o.source).join(', '),
    price: Number.isFinite(cheapest(g)) ? cheapest(g) : '',
    available: g.offers.some((o) => o.available) ? 1 : 0,
    link: g.offers[0].ua.link,
  })));
  addSheet(wb, 'Same code, other page', [
    ['code', 'partner code', 16], ['partner_name', 'partner name', 60], ['used', 'used for the catalog', 60], ['used_link', 'link', 50],
    ['left', 'left out (same code)', 60], ['left_link', 'link', 50],
  ], review.conflicts.map((c) => ({
    code: c.item.code,
    partner_name: c.item.name,
    used: c.winner?.offers[0].ua.name ?? '',
    used_link: c.winner?.offers[0].ua.link ?? '',
    left: c.product.offers[0].ua.name,
    left_link: c.product.offers[0].ua.link,
  })));
  addSheet(wb, 'Check - name differs', [
    ['id', 'catalog id', 10], ['code', 'partner code', 16], ['name', 'name on the sites', 60], ['partner_name', 'partner name', 60],
    ['similarity', 'words in common', 14], ['link', 'link', 60],
  ], (review.checkNames ?? []).map(({ product, similarity }) => ({
    id: product.id,
    code: product.sku,
    name: product.nameUa,
    partner_name: product.partnerName,
    similarity: Math.round(similarity * 100) / 100,
    link: product.offers[0]?.link ?? '',
  })));
  addSheet(wb, 'Partner only', [
    ['code', 'code', 16], ['name', 'name', 80], ['brand', 'brand', 14], ['group', 'group in the partner list', 40], ['row', 'row', 8],
  ], review.partnerOnly);
  const file = path.join(outDir, 'mainmarket-review.xlsx');
  await wb.xlsx.writeFile(file);
  log(`Written: ${file} (${review.notInPartner.length} not in the partner list, ${review.conflicts.length} same code, ${(review.checkNames ?? []).length} to check, ${review.partnerOnly.length} partner-only)`);
  return file;
}
