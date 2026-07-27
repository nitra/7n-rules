/**
 * Runtime-нейтральний glob-обхід для коду, що виконується і під Bun, і під Node
 * (hook запускається через npx → Node, де глобал `Bun` не визначений, тож
 * top-level `new Bun.Glob(...)` валить сам import модуля). Пряме
 * `node:fs/promises#glob` теж не варіант: спостережено self-hosted Linux Bun
 * 1.3.14, де Node-compat шим не надає export 'glob'. Тож вибір реалізації —
 * за середовищем виконання: `Bun.Glob` під Bun, `node:fs/promises#glob` під
 * Node (engines: node >=25).
 *
 * Діагностика цього модуля (`bun patch` у консюмер-репо) виявила побічний факт
 * поза межами самого glob-обходу: `bun x <локальна-devDependency>` НЕ застосовує
 * `patchedDependencies` — той самий тимчасовий патч, викликаний через `bun x
 * n-rules`, не давав жодного діагностичного виводу, хоча локально підтверджено,
 * що патч коректно застосовується і до `node_modules`, і читається прямим
 * імпортом під `bun -e`. Тобто `bun x` резолвить пакет з джерела, що не враховує
 * локальний патч у `node_modules` — тримай це на увазі під час майбутньої
 * діагностики через тимчасові `bun patch`: canonical-виклик через `bun x` може
 * мовчки НЕ показати застосований патч.
 */

/**
 * Розрізняє дві форми повернення `Bun.Glob#scan()`: async-iterable напряму,
 * або Promise, що резолвиться в async-iterable (`yield*` на Promise падає з
 * "is not async iterable", бо в Promise немає ні `Symbol.asyncIterator`, ні
 * `Symbol.iterator`). Початкова гіпотеза (self-hosted Linux Bun 1.3.14 як
 * причина) спростована прямими даними з реального CI-агента: 16/16 прямих
 * викликів на тому самому Linux-агенті (`Bun.version`/`revision` незмінні)
 * дали чистий async-iterable — жодного разу Promise. Реальна кореляція —
 * ЯК був викликаний зовнішній `n-rules`-скрипт: через `bun x <pkg>` crash
 * відтворювався стабільно; та сама команда напряму (`bun bin/n-rules.js`,
 * обхід `bun x`) — жодного разу. Корінь (чому `bun x` впливає на резолв
 * вкладеного `Bun.Glob#scan()`) — не встановлено, лишається діагностика на
 * рівні цієї defensive-обгортки (nitra/7n-rules#203).
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
