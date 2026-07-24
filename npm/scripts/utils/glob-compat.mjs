/**
 * Runtime-нейтральний glob-обхід для коду, що виконується і під Bun, і під Node
 * (hook запускається через npx → Node, де глобал `Bun` не визначений, тож
 * top-level `new Bun.Glob(...)` валить сам import модуля). Пряме
 * `node:fs/promises#glob` теж не варіант: спостережено self-hosted Linux Bun
 * 1.3.14, де Node-compat шим не надає export 'glob'. Тож вибір реалізації —
 * за середовищем виконання: `Bun.Glob` під Bun, `node:fs/promises#glob` під
 * Node (engines: node >=25).
 */

/**
 * Розрізняє дві форми повернення `Bun.Glob#scan()`: async-iterable напряму
 * (macOS) або Promise, що резолвиться в async-iterable (спостережено на
 * self-hosted Linux Bun 1.3.14 — `yield*` на Promise падає з "is not async
 * iterable", бо в Promise немає ні `Symbol.asyncIterator`, ні `Symbol.iterator`).
 * @param {unknown} scanned повернення `Bun.Glob#scan()`
 * @returns {Promise<unknown>} async-iterable шляхів (резолвлений, якщо `scanned` — Promise)
 */
export async function resolveGlobScan(scanned) {
  return typeof (/** @type {{ then?: unknown }} */ (scanned).then) === 'function' ? await scanned : scanned
}

/**
 * Ітерує відносні шляхи файлів за glob-патерном.
 * @param {string} pattern glob-патерн (наприклад, `cf/*\/package.json`)
 * @param {string} cwd корінь обходу
 * @param {{ bun?: { Glob: new (pattern: string) => { scan(opts: { cwd: string }): unknown } } }} [opts] `bun` —
 *   ін'єкція `Bun`-подібної реалізації для тестів (типово — глобал `Bun`).
 * @yields {string} кожен відносний шлях збігу
 */
export async function* scanGlob(pattern, cwd, opts = {}) {
  const bun = opts.bun ?? (typeof Bun === 'undefined' ? undefined : Bun)
  if (bun !== undefined) {
    yield* await resolveGlobScan(new bun.Glob(pattern).scan({ cwd }))
    return
  }
  const { glob } = await import('node:fs/promises')
  yield* glob(pattern, { cwd })
}

/**
 * Чи містить відносний шлях сегмент зі службових тек, які glob-обхід має ігнорувати.
 * Еквівалент колишніх ignore-патернів `**\/<dir>/**` по кожній теці з `ignoredDirs`.
 * @param {string} relPath відносний шлях зі `scanGlob`
 * @param {readonly string[]} ignoredDirs імена ігнорованих тек (наприклад, `node_modules`)
 * @returns {boolean} true — шлях лежить в ігнорованій теці
 */
export function hasIgnoredPathSegment(relPath, ignoredDirs) {
  const segments = relPath.replaceAll('\\', '/').split('/')
  return ignoredDirs.some(dir => segments.includes(dir))
}
