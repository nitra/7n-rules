/**
 * Визначення, чи виконується поточний ESM-модуль як точка входу CLI, а не як import у тестах чи інших модулях.
 *
 * У Bun використовується `import.meta.main`; у Node — порівняння `import.meta.url` з `process.argv[1]`
 * після `resolve`, щоб `bun path/to/script.mjs` і `node path/to/script.mjs` коректно вважалися прямим запуском.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Чи виконується модуль як точка входу CLI (прямий запуск), а не через import.
 * @returns {boolean} `true`, якщо файл запущено напряму; інакше `false`.
 */
export function isRunAsCli() {
  if (import.meta.main === true) {
    return true
  }
  try {
    const entry = process.argv[1]
    if (!entry) {
      return false
    }
    return fileURLToPath(import.meta.url) === resolve(entry)
  } catch {
    return false
  }
}
