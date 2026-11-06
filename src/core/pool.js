/**
 * Runs `worker(item, index)` for every item with at most `concurrency` running at once.
 * Results keep the input order. A failed item resolves to `{ error }` instead of rejecting.
 */
export async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { error };
      }
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, run);
  await Promise.all(runners);
  return results;
}
