/**
 * Тихий запуск v8r для усіх типів файлів, які підтримує v8r (json, json5, yaml, yml, toml).
 *
 * Один виклик цього скрипта з `lint-text` замість чотирьох окремих викликів v8r: під капотом для
 * кожного glob окремий `bunx v8r`, бо v8r у одному процесі падає з кодом 98, якщо хоч один із
 * переданих глобів не знаходить файлів — тоді решта розширень не перевіряються.
 *
 * Каталог схем `@nitra/cursor` (`v8r-catalog.json` у каталозі `schemas` пакета) передається в v8r
 * як `-c` автоматично (те саме, що в репозиторії шлях `npm/schemas/v8r-catalog.json` від кореня).
 * Опційно можна передати власні glob-и як аргументи; якщо їх немає — типові для `.json`, `.json5`,
 * `.yml`, `.yaml`, `.toml` у дереві проєкту.
 *
 * Якщо код виходу 0 або 98 (успіх або порожній glob), вивід v8r не показується; інакше
 * вивід друкується, процес завершується з тим самим кодом, що й перший невдалий v8r.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

/** Типові glob-и для форматів, які обробляє v8r (див. опис CLI v8r). */
export const DEFAULT_V8R_GLOBS = ['**/*.json', '**/*.json5', '**/*.yml', '**/*.yaml', '**/*.toml']

/** Абсолютний шлях до `schemas/v8r-catalog.json` у корені пакета `@nitra/cursor` (`npm/schemas/`). */
export const V8R_CATALOG_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../schemas/v8r-catalog.json')

/**
 * Повертає шлях до каталогу схем v8r для пакета (для тестів і діагностики).
 * @returns {string} абсолютний шлях до v8r-catalog.json
 */
export function getV8rCatalogPath() {
  return V8R_CATALOG_PATH
}

/**
 * Запускає послідовні виклики v8r по glob-ам; не змінює process.exitCode (лише повертає код).
 * @param {string[]} [globs] патерни; за замовчуванням DEFAULT_V8R_GLOBS
 * @returns {number} 0 — OK, 1 — помилка spawn, 2 — немає каталогу схем, інше — код v8r
 */
export function runV8rWithGlobs(globs = DEFAULT_V8R_GLOBS) {
  if (!existsSync(V8R_CATALOG_PATH)) {
    process.stderr.write(
      `run-v8r: не знайдено каталог схем за шляхом ${V8R_CATALOG_PATH} (очікується npm/schemas/v8r-catalog.json у пакеті)\n`
    )
    return 2
  }

  for (const pattern of globs) {
    const bunPath = resolveCmd('bun') ?? process.execPath
    const result = spawnSync(bunPath, ['x', 'v8r', pattern, '-c', V8R_CATALOG_PATH], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    if (result.error) {
      process.stderr.write(`${result.error.message}\n`)
      return 1
    }

    const exitCode = result.status ?? 1
    if (exitCode !== 0 && exitCode !== 98) {
      if (result.stdout?.length) {
        process.stdout.write(result.stdout)
      }
      if (result.stderr?.length) {
        process.stderr.write(result.stderr)
      }
      return exitCode
    }
  }
  return 0
}

if (isRunAsCli(import.meta.url)) {
  const globs = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_V8R_GLOBS
  process.exitCode = runV8rWithGlobs(globs)
}
