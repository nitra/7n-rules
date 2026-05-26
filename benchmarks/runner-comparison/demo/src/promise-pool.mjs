/**
 * Run async worker over items with limited concurrency while preserving result order.
 * @param {unknown[]} items input items
 * @param {(item: unknown, index: number) => unknown | Promise<unknown>} worker item worker
 * @param {number} concurrency maximum concurrent workers
 * @returns {Promise<unknown[]>} mapped results in input order
 */
export async function promisePool(items, worker, concurrency = 4) {
  if (!Array.isArray(items)) return []
  if (concurrency < 1) concurrency = 1
  const results = Array.from({ length: items.length })
  let next = 0
  /**
   *
   */
  async function run() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  const runners = []
  const limit = Math.min(concurrency, items.length)
  for (let k = 0; k < limit; k++) runners.push(run())
  await Promise.all(runners)
  return results
}
