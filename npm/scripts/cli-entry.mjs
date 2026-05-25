/**
 * Визначення, чи виконується поточний ESM-модуль як точка входу CLI, а не як import у тестах чи інших модулях.
 *
 * Прийом: модуль, що хоче знати свій статус, передає `import.meta.url` —
 * `import.meta` лексично прив'язаний до файлу, де він записаний, тому helper-функція
 * без аргументу неминуче дивилася б на свій файл, а не на caller. `realpathSync` на обох
 * сторонах знімає різницю «symlink vs canonical» (macOS `/tmp` ↔ `/private/tmp`,
 * `node_modules/.bin/*` shim, pnpm-style content-addressable links).
 */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Чи виконується модуль як точка входу CLI (прямий запуск), а не через import.
 * @param {string | URL} [metaUrl] `import.meta.url` модуля-caller'а. Без нього — завжди `false`.
 * @returns {boolean} `true`, якщо файл, з якого передано `metaUrl`, є `process.argv[1]`.
 */
export function isRunAsCli(metaUrl) {
  if (!metaUrl) {
    return false
  }
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    const callerPath = realpathSync(fileURLToPath(metaUrl))
    const entryPath = realpathSync(resolve(entry))
    return callerPath === entryPath
  } catch {
    return false
  }
}
