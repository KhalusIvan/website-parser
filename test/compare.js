#!/usr/bin/env node
// Compares two Excel exports row by row (matched by the "link" column).
//   node test/compare.js expected.xlsx actual.xlsx [--strict] [--show 5]
// By default whitespace inside "description" is ignored (HTML formatting differs between
// jsoup and cheerio but renders the same). Use --strict for exact comparison.
import ExcelJS from 'exceljs';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { strict: { type: 'boolean', default: false }, show: { type: 'string', default: '3' } },
});
if (positionals.length !== 2) {
  console.error('Usage: node test/compare.js expected.xlsx actual.xlsx [--strict] [--show N]');
  process.exit(2);
}

async function readSheet(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (header[i - 1] = String(c.value ?? '')));
  const rows = new Map();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    header.forEach((h, i) => (obj[h] = String(row.getCell(i + 1).value ?? '')));
    if (obj.link) rows.set(obj.link, obj);
  }
  return { header, rows };
}

const normalize = (column, value) => {
  if (values.strict) return value;
  if (column === 'description') return value.replace(/\s*(<[^>]+>)\s*/g, '$1').replace(/\s+/g, ' ').trim();
  return value.trim();
};

const [a, b] = await Promise.all(positionals.map(readSheet));
const show = Number(values.show);
let problems = 0;

console.log(`Expected: ${positionals[0]} - ${a.rows.size} products, ${a.header.length} columns`);
console.log(`Actual:   ${positionals[1]} - ${b.rows.size} products, ${b.header.length} columns\n`);

const sameHeader = a.header.join('\u0001') === b.header.join('\u0001');
console.log(sameHeader ? 'Columns: identical (same names, same order)' : 'Columns: DIFFERENT');
if (!sameHeader) {
  problems++;
  const missing = a.header.filter((h) => !b.header.includes(h));
  const extra = b.header.filter((h) => !a.header.includes(h));
  if (missing.length) console.log('  missing in actual:', missing);
  if (extra.length) console.log('  extra in actual:  ', extra);
  if (!missing.length && !extra.length) console.log('  same names, different order');
}

const onlyA = [...a.rows.keys()].filter((k) => !b.rows.has(k));
const onlyB = [...b.rows.keys()].filter((k) => !a.rows.has(k));
console.log(`Products only in expected: ${onlyA.length}`);
onlyA.slice(0, show).forEach((l) => console.log('   ', l));
console.log(`Products only in actual:   ${onlyB.length}`);
onlyB.slice(0, show).forEach((l) => console.log('   ', l));
problems += onlyA.length + onlyB.length;

const orderA = [...a.rows.keys()].filter((k) => b.rows.has(k));
const orderB = [...b.rows.keys()].filter((k) => a.rows.has(k));
const sameOrder = orderA.every((k, i) => orderB[i] === k);
console.log(`Row order: ${sameOrder ? 'same' : 'different'}\n`);

const columns = [...new Set([...a.header, ...b.header])];
const diffs = Object.fromEntries(columns.map((c) => [c, []]));
let compared = 0;
for (const [link, ra] of a.rows) {
  const rb = b.rows.get(link);
  if (!rb) continue;
  compared++;
  for (const c of columns) {
    const va = normalize(c, ra[c] ?? '');
    const vb = normalize(c, rb[c] ?? '');
    if (va !== vb) diffs[c].push({ link, expected: ra[c] ?? '', actual: rb[c] ?? '' });
  }
}

console.log(`Cell comparison over ${compared} common products:`);
for (const c of columns) {
  const n = diffs[c].length;
  console.log(`  ${n === 0 ? 'OK  ' : 'DIFF'} ${c.padEnd(30)} ${n === 0 ? '' : `${n} mismatches`}`);
  problems += n;
  for (const d of diffs[c].slice(0, show)) {
    console.log(`       ${d.link}\n         expected: ${JSON.stringify(d.expected.slice(0, 200))}\n         actual:   ${JSON.stringify(d.actual.slice(0, 200))}`);
  }
}

console.log(problems === 0 ? '\nRESULT: files match' : `\nRESULT: ${problems} differences`);
process.exit(problems === 0 ? 0 : 1);
