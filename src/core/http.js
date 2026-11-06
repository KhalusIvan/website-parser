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
 */
export function createHttp({
  userAgent = DEFAULT_USER_AGENT,
  timeoutMs = 30_000,
  retries = 5,
  retryDelayMs = 2_000,
  blockedWaitMs = [5 * 60_000, 7 * 60_000],
  maxBlockedWaits = 6,
  log = console.log,
} = {}) {
  async function getText(url) {
    let attempt = 0;
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
        if (res.ok) return await res.text();

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
        attempt += 1;
        if (attempt >= retries) throw err;
        await sleep(retryDelayMs * attempt);
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
