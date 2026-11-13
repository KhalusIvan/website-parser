// Downloads the catalog's photos into <dir>/catalog/products/<brand>/<product-seo-name>-<n>.<ext>
// (ready to copy into OpenCart's image/ folder). Already downloaded files are skipped, so an
// interrupted run can simply be started again.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { photoCandidates } from './build.js';
import { slugify } from './slug.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Hosts on one server share a queue. moser-animal.com, gamaofficial.com.ua and spl4barber.com.ua are
 * one server that blocks IPs which load it too fast: one request at a time, with a pause.
 */
const SERVERS = {
  'moser-animal.com': { queue: 'shared-88.218.29.91', concurrency: 1, pauseMs: 800 },
  'gamaofficial.com.ua': { queue: 'shared-88.218.29.91', concurrency: 1, pauseMs: 800 },
  'spl4barber.com.ua': { queue: 'shared-88.218.29.91', concurrency: 1, pauseMs: 800 },
};
const DEFAULT_SERVER = { concurrency: 2, pauseMs: 150 };

async function fetchImage(url, timeoutMs = 30_000) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return { status: res.status };
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const body = Buffer.from(await res.arrayBuffer());
  if (!type.startsWith('image/') || body.length < 1000) return { status: 'not-an-image' };
  return { status: 200, type, body };
}

/** Existing file for "<base>.*" (any extension), or null. */
function existing(dir, base) {
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) => f.startsWith(`${base}.`) && statSync(path.join(dir, f)).size > 0);
  return hit ? path.join(dir, hit) : null;
}

/**
 * products: [{ id, brand, seoUa, photoUrls }]. Sets product.photos = [{ file, url }] (file relative to
 * `outDir`, e.g. "catalog/products/moser/mashynka-...-1.jpg"); url = where it was downloaded from.
 */
export async function downloadPhotos(products, outDir, { log = console.log } = {}) {
  const jobs = [];
  for (const p of products) {
    p.photos = [];
    const folder = path.join('catalog', 'products', slugify(p.brand || 'other', 'uk') || 'other');
    p.photoUrls.forEach((url, i) => jobs.push({ product: p, index: i, url, folder, base: `${p.seoUa}-${i + 1}` }));
  }
  const queues = new Map();
  for (const job of jobs) {
    const host = new URL(job.url).host.replace(/^www\./, '');
    const server = SERVERS[host] ?? { ...DEFAULT_SERVER, queue: host };
    if (!queues.has(server.queue)) queues.set(server.queue, { server, jobs: [] });
    queues.get(server.queue).jobs.push(job);
  }

  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  const failed = [];
  const originalsMissing = new Map(); // host -> misses in a row (stop trying originals after 25)
  const results = new Map(); // job -> { file, url }
  const total = jobs.length;
  const progress = setInterval(() => log(`photos: ${done}/${total} (${downloaded} downloaded, ${skipped} already there, ${failed.length} failed)`), 30_000);

  async function runJob(job, server) {
    const dir = path.join(outDir, job.folder);
    const have = existing(dir, job.base);
    if (have) {
      skipped++;
      results.set(job, { file: path.relative(outDir, have), url: job.url });
      return;
    }
    const host = new URL(job.url).host;
    let candidates = photoCandidates(job.url);
    if ((originalsMissing.get(host) ?? 0) >= 25) candidates = [job.url];
    for (const url of candidates) {
      let r;
      try {
        r = await fetchImage(url);
      } catch (err) {
        r = { status: err.name === 'TimeoutError' ? 'timeout' : err.message };
      }
      await sleep(server.pauseMs);
      if (r.status === 'timeout' && server.concurrency === 1) {
        throw new Error(`timeout on ${host} - stopping this server's queue so the IP is not blocked`);
      }
      if (r.status === 200) {
        if (url !== job.url) originalsMissing.set(host, 0);
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${job.base}.${EXT[r.type] ?? 'jpg'}`);
        writeFileSync(file, r.body);
        downloaded++;
        results.set(job, { file: path.relative(outDir, file), url });
        return;
      }
      if (url !== job.url) originalsMissing.set(host, (originalsMissing.get(host) ?? 0) + 1);
    }
    failed.push({ product: job.product.id, url: job.url });
  }

  await Promise.all(
    [...queues.values()].map(async ({ server, jobs: list }) => {
      let next = 0;
      let stopped = false;
      await Promise.all(
        Array.from({ length: server.concurrency }, async () => {
          while (!stopped && next < list.length) {
            const job = list[next++];
            try {
              await runJob(job, server);
            } catch (err) {
              stopped = true;
              log(`photos: ${err.message}`);
              for (const j of list.slice(next)) failed.push({ product: j.product.id, url: j.url, reason: 'queue stopped' });
            }
            done++;
          }
        }),
      );
    }),
  );
  clearInterval(progress);

  for (const job of jobs) {
    const r = results.get(job);
    if (r) job.product.photos.push(r);
  }
  log(`photos: ${downloaded} downloaded, ${skipped} already there, ${failed.length} failed`);
  return { downloaded, skipped, failed };
}
