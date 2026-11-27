import * as cheerio from 'cheerio';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(status, url, { retryable = false } = {}) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => min + Math.random() * (max - min);

/**
 * HTTP client with the same behaviour as the original jar:
 *  - up to `retries` attempts for network errors / 5xx
 *  - 404/410 fail immediately (the product is skipped)
 *  - 403/429 (site blocked us) -> wait 5-7 minutes, then try again
 *  - pages failing with network errors several times in a row (a site that blocks by dropping the
 *    connection) -> the same pause; all such pauses of one client together are capped by `pauseBudgetMs`,
 *    after that failing pages fail fast (the run must still finish in time)
 *  - a site that stopped answering (`downAfter` pages failed in a row after the pauses are spent): the
 *    following pages fail at once, without retries; every `probeEvery`-th page is tried once, and the
 *    first answer brings normal work back. Otherwise one dead site (5 retries × 30 s per page) runs its
 *    job over the time limit, GitHub cancels it and the whole update is lost.
 */
export function createHttp({
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = 30_000,
  retries = 5,
  retryDelayMs = 2_000,
  blockedWaitMs = [5 * 60_000, 7 * 60_000],
  maxBlockedWaits = 6,
  failStreak = 3,
  pauseBudgetMs = 60 * 60_000, // summed over threads: about 30 min of waiting with 2 threads
  downAfter = 10,
  probeEvery = 20,
  log = console.log,
} = {}) {
  let streak = 0; // pages that failed one after another
  let paused = 0; // ms spent in pauses after network errors
  let down = false; // the site doesn't answer: fail fast
  let skipped = 0; // pages failed at once while down

  async function getText(url) {
    let attempt = 0;
    let probe = false;
    if (down) {
      if (++skipped % probeEvery !== 0) {
        throw new Error('the site is not answering - skipped');
      }
      probe = true; // one try, no retries
    }
    let blockedWaits = 0;
    for (;;) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const text = await res.text();
          if (down) {
            log(`the site answers again (${url}) - back to normal after ${skipped} skipped pages`);
            down = false;
            skipped = 0;
          }
          streak = 0;
          return text;
        }

        if (res.status === 404 || res.status === 410) throw new HttpError(res.status, url);
        if (res.status === 403 || res.status === 429) {
          if (blockedWaits++ < maxBlockedWaits) {
            const wait = randomBetween(...blockedWaitMs);
            log(`HTTP ${res.status} (blocked?) on ${url} - sleeping ${Math.round(wait / 1000)}s`);
            await sleep(wait);
            continue;
          }
          throw new HttpError(res.status, url);
        }
        throw new HttpError(res.status, url, { retryable: true });
      } catch (err) {
        if (err instanceof HttpError && !err.retryable) throw err;
        if (probe) throw err;
        attempt += 1;
        if (attempt < retries) {
          await sleep(retryDelayMs * attempt);
          continue;
        }
        streak += 1;
        if (streak >= failStreak && paused < pauseBudgetMs) {
          const wait = Math.min(randomBetween(...blockedWaitMs), pauseBudgetMs - paused);
          paused += wait;
          log(`${streak} pages failed in a row (${err.message}) - the site may have blocked us, sleeping ${Math.round(wait / 1000)}s`);
          await sleep(wait);
          attempt = 0;
          continue;
        }
        if (!down && streak >= downAfter && paused >= pauseBudgetMs) {
          down = true;
          log(`${streak} pages failed in a row and the pauses are used up - the site is treated as down: the rest of its pages are skipped (one try every ${probeEvery} pages)`);
        }
        throw err;
      }
    }
  }

  /** Fetches a page and returns a cheerio document ($). */
  async function getHtml(url) {
    const html = await getText(url);
    return cheerio.load(html, { baseURI: url });
  }

  return { getText, getHtml };
}
