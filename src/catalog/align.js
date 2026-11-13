// Finds which Russian attribute name of a shop is which Ukrainian one ("Швидкість двигуна (об/хв)" ->
// "Скорость двигателя (об/мин)"), from the shop's products that have both languages: the right pair
// is present on the same products and has equal (numbers) or similar (uk/ru spelling) values.

/** Similarity of two short texts, 0..1 (character bigrams; uk and ru spellings are close). */
export function textSimilarity(a, b) {
  const grams = (s) => {
    const t = ` ${String(s).toLowerCase().replace(/\s+/g, ' ')} `;
    const out = new Map();
    for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const x = grams(a);
  const y = grams(b);
  let common = 0;
  let total = 0;
  for (const [g, n] of x) {
    common += Math.min(n, y.get(g) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return total ? (2 * common) / total : 0;
}

const numbers = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) ?? []).join(' ');
const YES_NO = { так: 'да', ні: 'нет', є: 'есть', немає: 'нет' };

function valueSimilarity(ua, ru) {
  const nu = numbers(ua);
  const nr = numbers(ru);
  if (nu || nr) return nu === nr ? 1 : 0;
  const u = String(ua).toLowerCase().trim();
  if (YES_NO[u] && YES_NO[u] === String(ru).toLowerCase().trim()) return 1;
  return textSimilarity(ua, ru);
}

/**
 * offers: [{ source, ua: { specs }, ru: { specs } | null }]
 * Returns Map(source -> Map(ukrainian attribute name -> russian attribute name)).
 */
export function alignAttributes(offers) {
  const bySource = new Map();
  for (const o of offers) {
    if (!o.ru) continue;
    if (!bySource.has(o.source)) bySource.set(o.source, []);
    bySource.get(o.source).push(o);
  }
  const result = new Map();
  for (const [source, list] of bySource) {
    const nU = new Map();
    const nR = new Map();
    const both = new Map(); // "u\u0000r" -> { n, sim }
    for (const o of list) {
      const us = Object.entries(o.ua.specs);
      const rs = Object.entries(o.ru.specs);
      for (const [u] of us) nU.set(u, (nU.get(u) ?? 0) + 1);
      for (const [r] of rs) nR.set(r, (nR.get(r) ?? 0) + 1);
      for (const [u, uv] of us) {
        for (const [r, rv] of rs) {
          const k = `${u}\u0000${r}`;
          const e = both.get(k) ?? { n: 0, sim: 0 };
          e.n++;
          e.sim += valueSimilarity(uv, rv);
          both.set(k, e);
        }
      }
    }
    // score: present on the same products (Jaccard) + similar values; then one-to-one, best first
    const pairs = [];
    for (const [k, e] of both) {
      const [u, r] = k.split('\u0000');
      const jaccard = e.n / (nU.get(u) + nR.get(r) - e.n);
      pairs.push({ u, r, score: jaccard + e.sim / e.n, n: e.n });
    }
    pairs.sort((a, b) => b.score - a.score || b.n - a.n);
    const map = new Map();
    const usedR = new Set();
    for (const p of pairs) {
      if (map.has(p.u) || usedR.has(p.r) || p.score < 0.8) continue;
      map.set(p.u, p.r);
      usedR.add(p.r);
    }
    result.set(source, map);
  }
  return result;
}

const tokens = (s) => String(s).trim().split(/(\s+|[,;:()/«»"]+)/).filter((t) => t !== '');
const isWord = (t) => /\p{Script=Cyrillic}/u.test(t);
const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0];

/**
 * Learns Ukrainian -> Russian attribute values from the shops that have both languages, to fill the
 * Russian value where the product's shop has no Russian page. Whole values first ("Металевий" ->
 * "Металлический"), else word by word for values of the same shape ("12 місяців" -> "12 месяцев").
 * Returns translate(value) -> Russian value or '' if not every word is known.
 */
export function valueTranslator(offers, aligned) {
  const whole = new Map();
  const words = new Map();
  const add = (map, k, v) => {
    if (!map.has(k)) map.set(k, new Map());
    map.get(k).set(v, (map.get(k).get(v) ?? 0) + 1);
  };
  for (const o of offers) {
    const map = aligned.get(o.source);
    if (!map || !o.ru) continue;
    for (const [name, uaValue] of Object.entries(o.ua.specs)) {
      const ruValue = o.ru.specs[map.get(name)];
      if (!ruValue) continue;
      const u = uaValue.trim();
      const r = ruValue.trim();
      add(whole, u.toLowerCase(), r);
      const tu = tokens(u);
      const tr = tokens(r);
      if (tu.length !== tr.length) continue;
      if (tu.some((t, i) => !isWord(t) && t !== tr[i])) continue; // numbers/latin must be the same
      tu.forEach((t, i) => isWord(t) && add(words, t.toLowerCase(), tr[i].toLowerCase()));
    }
  }
  const sameCase = (src, dst) => (src[0] === src[0].toUpperCase() ? dst[0].toUpperCase() + dst.slice(1) : dst);
  return (value) => {
    const v = String(value ?? '').trim();
    if (!v) return '';
    const w = whole.get(v.toLowerCase());
    if (w) return top(w)[0];
    const out = [];
    for (const t of tokens(v)) {
      if (!isWord(t)) out.push(t);
      else {
        const hit = words.get(t.toLowerCase());
        if (!hit) return '';
        const [ru, n] = top(hit);
        if (n < 2) return '';
        out.push(sameCase(t, ru));
      }
    }
    return out.join('');
  };
}
