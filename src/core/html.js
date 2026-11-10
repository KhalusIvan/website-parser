// Small helpers on top of cheerio that behave like the jsoup helpers used in the original jar.

/** Collapses whitespace (incl. &nbsp;) and trims - same as jsoup's Element.text(). */
export function normText(value) {
  return String(value ?? '').replace(/[\s ]+/g, ' ').trim();
}

/** Trims any of the given characters from both ends (Kotlin's String.trim(vararg chars)). */
export function trimChars(value, chars) {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start])) start++;
  while (end > start && chars.includes(value[end - 1])) end--;
  return value.slice(start, end);
}

/** Text of the first element matching `selector`, or `fallback`. */
export function textFirst($, selector, fallback = '', root) {
  const el = (root ? root.find(selector) : $(selector)).first();
  return el.length ? normText(el.text()) : fallback;
}

/** `content` attribute of the first matching element (for <meta>). */
export function contentFirst($, selector, fallback = '') {
  const el = $(selector).first();
  return el.length ? el.attr('content') ?? fallback : fallback;
}

/** Inner HTML of the first matching element, trimmed. */
export function htmlFirst($, selector, fallback = '') {
  const el = $(selector).first();
  return el.length ? tidyHtml(el.html() ?? '') : fallback;
}

export function exists($, selector) {
  return $(selector).length > 0;
}

/** Absolute hrefs of all matching links, in page order. */
export function hrefs($, selector) {
  return $(selector)
    .map((_, el) => $(el).prop('href') || $(el).attr('href'))
    .get()
    .filter(Boolean);
}

/** Values of `attr` for every matching element that has it (jsoup's eachAttr). */
export function eachAttr($, selector, attr) {
  return $(selector)
    .map((_, el) => $(el).attr(attr))
    .get()
    .filter((v) => v !== undefined);
}

/**
 * Reads a specs table: every row with more than `valueIndex` cells becomes key -> value
 * (key = cell 0, value = cell `valueIndex`). Repeated keys are joined with `separator`.
 */
export function specsFromRows($, rows, { valueIndex = 1, separator = ';' } = {}) {
  const grouped = new Map();
  rows.each((_, row) => {
    const cells = $(row).children();
    if (cells.length <= valueIndex) return;
    const key = trimChars(normText(cells.eq(0).text()), ' :');
    const value = trimChars(normText(cells.eq(valueIndex).text()), ' :');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  });
  const specs = {};
  for (const [key, values] of grouped) specs[key] = values.join(separator);
  return specs;
}

const BLOCK_TAGS =
  'p|div|ul|ol|li|h[1-6]|table|thead|tbody|tr|td|th|blockquote|section|article|figure|iframe|hr|br';
const BETWEEN_BLOCKS = new RegExp(`>\\s+<(?=/?(?:${BLOCK_TAGS})\\b)`, 'gi');
const AFTER_BLOCK_OPEN = new RegExp(`(<(?:${BLOCK_TAGS})\\b[^>]*>)\\s+`, 'gi');
const BEFORE_BLOCK_CLOSE = new RegExp(`\\s+(</(?:${BLOCK_TAGS})>)`, 'gi');
const ADJACENT_BLOCKS = new RegExp(`(</(?:${BLOCK_TAGS})>)(?=<(?:${BLOCK_TAGS})\\b)`, 'gi');

/**
 * Light clean-up of description HTML, similar to jsoup's output in the jar: trims it and
 * removes whitespace at block-tag boundaries. The rendered HTML looks the same.
 */
export function tidyHtml(html) {
  return html
    .trim()
    .replace(AFTER_BLOCK_OPEN, '$1')
    .replace(BEFORE_BLOCK_CLOSE, '$1')
    .replace(BETWEEN_BLOCKS, '>\n<')
    .replace(ADJACENT_BLOCKS, '$1\n');
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
