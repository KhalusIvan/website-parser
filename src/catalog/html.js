// Cleans supplier descriptions for the catalog: plain semantic HTML, no supplier links, images,
// styles or "buy on our site" sentences.
import * as cheerio from 'cheerio';

const KEEP = new Set(['p', 'br', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'iframe', 'sup', 'sub']);
const DROP = new Set(['script', 'style', 'img', 'form', 'input', 'button', 'svg', 'video', 'audio', 'object', 'embed', 'noscript', 'link', 'meta']);
const RENAME = { h1: 'h2', h5: 'h4', h6: 'h4' };
const ATTRS = { iframe: ['src', 'width', 'height', 'allowfullscreen'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] };

/** Sentences about the supplier shop itself (its site, its store, its delivery). */
const SHOP_SENTENCE =
  // Shop names only in Latin / as domains: "врода" (beauty) and "кучерявий" (curly) are ordinary words.
  /(vroda|kucheryaw|babyliss\.in\.ua|babyliss-pro\.com\.ua|spl-group|spl4barber|jrl\.in\.ua|moser-animal|gamaofficial|mrd-pro\.com|immortal\.com\.ua|jaguar-solingen\.in|glorianapro|на нашому сайті|на нашем сайте|(у|в) нашому (інтернет-)?магазин|в нашем (интернет-)?магазин|наш (інтернет-)?магазин|наш интернет-магазин|замовляйте (у|в) нас|заказывайте у нас|купуйте (у|в) нас|покупайте у нас)/i;

function dropShopSentences(text) {
  if (!SHOP_SENTENCE.test(text)) return text;
  return text
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => !SHOP_SENTENCE.test(sentence))
    .join(' ');
}

const isYoutube = (src) => /^(https?:)?\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)\//i.test(src ?? '');

/** Supplier description HTML -> clean HTML ('' if nothing is left). */
export function cleanDescription(html) {
  if (!html) return '';
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false);
  const root = $('#root');

  root.find('*').each((_, el) => {
    if (!el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag) || tag.includes(':')) return void $(el).remove();
    if (tag === 'iframe') {
      const src = $(el).attr('src') ?? $(el).attr('data-src');
      if (!isYoutube(src)) return void $(el).remove();
      $(el).attr('src', src.replace(/^\/\//, 'https://'));
    }
  });
  // unwrap everything that is not kept (div, span, font, a, ...), rename headings
  let changed = true;
  while (changed) {
    changed = false;
    root.find('*').each((_, el) => {
      const tag = el.tagName.toLowerCase();
      if (RENAME[tag]) {
        el.tagName = RENAME[tag];
        changed = true;
      } else if (!KEEP.has(tag)) {
        // a block element becomes a paragraph break
        if (/^(div|section|article|blockquote|center)$/.test(tag)) $(el).after('<br>');
        $(el).replaceWith($(el).contents());
        changed = true;
      }
    });
  }
  root.find('*').each((_, el) => {
    const keep = ATTRS[el.tagName] ?? [];
    for (const name of Object.keys(el.attribs ?? {})) if (!keep.includes(name)) $(el).removeAttr(name);
  });
  // text: no "buy at our shop" sentences, no &nbsp; runs
  root.find('*').addBack().contents().each((_, node) => {
    if (node.type !== 'text') return;
    node.data = dropShopSentences(node.data.replace(/ /g, ' ').replace(/[ \t]{2,}/g, ' '));
  });
  // empty elements and leading/trailing/doubled line breaks
  for (let i = 0; i < 3; i++) {
    root.find('p, li, b, strong, i, em, u, h2, h3, h4, td, th, sup, sub').each((_, el) => {
      if (!$(el).text().trim() && !$(el).find('iframe').length) $(el).remove();
    });
    root.find('ul, ol, table, tr').each((_, el) => {
      if (!$(el).text().trim()) $(el).remove();
    });
  }
  let out = root.html() ?? '';
  out = out
    .replace(/(\s*<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/^(\s*<br\s*\/?>\s*)+|(\s*<br\s*\/?>\s*)+$/gi, '')
    .replace(/<p>\s*(<br\s*\/?>\s*)+/gi, '<p>')
    .replace(/(\s*<br\s*\/?>)+\s*<\/p>/gi, '</p>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return textLength(out) ? out : '';
}

/** Visible text length of an HTML string. */
export function textLength(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/** Plain text of an HTML string (for meta descriptions). */
export function plainText(html) {
  return cheerio.load(`<div>${String(html ?? '').replace(/<br\s*\/?>/gi, ' ')}</div>`, null, false)('div')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}
