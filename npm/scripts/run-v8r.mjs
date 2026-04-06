/**
 * Тихий запуск v8r для усіх типів файлів, які підтримує v8r (json, json5, yaml, yml, toml).
 *
 * Один виклик цього скрипта з `lint-text` замість чотирьох окремих викликів v8r: під капотом для
 * кожного glob окремий `bun x v8r`, бо v8r у одному процесі падає з кодом 98, якщо хоч один із
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

/** Типові glob-и для форматів, які обробляє v8r (див. опис CLI v8r). */
const DEFAULT_GLOBS = ['**/*.json', '**/*.json5', '**/*.yml', '**/*.yaml', '**/*.toml']

/** Абсолютний шлях до `schemas/v8r-catalog.json` поруч з цим скриптом у пакеті `@nitra/cursor`. */
const V8R_CATALOG_PATH = join(dirname(fileURLToPath(import.meta.url)), '../schemas/v8r-catalog.json')

if (existsSync(V8R_CATALOG_PATH)) {
  const globs = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_GLOBS

  for (const pattern of globs) {
    // Порядок важливий: glob має бути перед -c, інакше yargs у v8r не отримує позиційні patterns.
    const result = spawnSync('bun', ['x', 'v8r', pattern, '-c', V8R_CATALOG_PATH], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    if (result.error) {
      process.stderr.write(`${result.error.message}\n`)
      process.exitCode = 1
      break
    }

    const exitCode = result.status ?? 1
    if (exitCode !== 0 && exitCode !== 98) {
      if (result.stdout?.length) {
        process.stdout.write(result.stdout)
      }
      if (result.stderr?.length) {
        process.stderr.write(result.stderr)
      }
      process.exitCode = exitCode
      break
    }
  }
} else {
  process.stderr.write(
    `run-v8r: не знайдено каталог схем за шляхом ${V8R_CATALOG_PATH} (очікується npm/schemas/v8r-catalog.json у пакеті)\n`
  )
  process.exitCode = 2
}
