/**
 * A scraped product. Same fields (and Excel column order) as the original vroda.jar.
 * `specs` is a plain object { "Spec name": "value" }; each spec becomes its own Excel column.
 */
export function createProduct(fields = {}) {
  return {
    link: '',
    name: '',
    category: '',
    images: '', // image URLs joined with ";"
    description: '', // HTML
    price: '',
    priceSpecial: '',
    sku: '',
    parent: '',
    available: false,
    specs: {},
    ...fields,
  };
}

// Kotlin's String.toDoubleOrNull(): null for empty / non-numeric strings.
function toNumberOrNull(value) {
  const s = String(value ?? '').trim().replace(/,/g, '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalises prices like the jar's Product.movePrices():
 *  - only a special price -> it becomes the price
 *  - special price higher than price (site gave "old price" as special) -> swap
 * Result: `price` = regular price, `priceSpecial` = discounted price (or "").
 */
export function movePrices(product) {
  const isBlank = (s) => String(s ?? '').trim() === '';
  if (isBlank(product.price) && !isBlank(product.priceSpecial)) {
    product.price = product.priceSpecial;
    product.priceSpecial = '';
    return product;
  }
  const price = toNumberOrNull(product.price) ?? 1;
  const special = toNumberOrNull(product.priceSpecial) ?? 0;
  if (price < special) {
    [product.price, product.priceSpecial] = [product.priceSpecial, product.price];
  }
  return product;
}
