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
 * Ітерує відносні шляхи файлів за glob-патерном.
 * @param {string} pattern glob-патерн (наприклад, `cf/*\/package.json`)
 * @param {string} cwd корінь обходу
 * @yields {string} кожен відносний шлях збігу
 */
export async function* scanGlob(pattern, cwd) {
  if (typeof Bun !== 'undefined') {
    yield* new Bun.Glob(pattern).scan({ cwd })
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
