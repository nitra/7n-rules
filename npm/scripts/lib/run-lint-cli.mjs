/**
 * `n-cursor lint` — оркестратор лінт-ланцюжка з тайменгом на кожен крок.
 *
 * Замість агрегатора `bun run lint-ga && bun run lint-js && ... && oxfmt .` у кореневому
 * `package.json` (де child-процеси анонімні і час кожного не видно), цей орекстратор:
 *
 *  - читає `scripts` з кореневого `package.json`,
 *  - бере **присутні** ключі з фіксованого списку `LINT_SCRIPTS` (відсутні мовчки пропускає),
 *  - послідовно запускає `bun run <script>`,
 *  - заміряє час кожного,
 *  - **fail-fast**: при першому ненульовому exit-коді зупиняється, друкує таблицю
 *    лише по виконаних і повертає той самий код,
 *  - друкує підсумкову таблицю `⏱ Lint timing` і повертає 0, якщо все ОК.
 *
 * Список + порядок зумисне фіксований: збігається з канонічним ланцюжком, що його раніше
 * тримав root `package.json`. Динамічний discovery (`scripts/^lint-/`) дав би непередбачуваний
 * порядок і небажану інтерпретацію кастомних `lint-*` користувача.
 *
 * `oxfmt` — окремий рядок поза префіксом `lint-`, ставиться в кінець (як було у `lint`).
 */
import { spawnSync as defaultSpawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { formatTimingSummary } from './timing-summary.mjs'

/**
 * Імена npm-скриптів, які `n-cursor lint` запускає **по черзі**, якщо вони є у root `package.json`.
 * Порядок дзеркалить попередній агрегатор `lint`: cheap-checks першими, формат — в кінці.
 */
export const LINT_SCRIPTS = /** @type {const} */ ([
  'lint-ga',
  'lint-js',
  'lint-rego',
  'lint-style',
  'lint-text',
  'lint-security',
  'oxfmt'
])

/**
 * Читає `scripts` з `package.json` у заданій теці. Повертає `null`, якщо файла немає, JSON
 * некоректний або поля `scripts` нема. Не кидає — викликач сам вирішує, що робити.
 * @param {string} root абсолютний шлях до теки з `package.json`
 * @returns {Record<string, string> | null} мапа scripts або null
 */
function readRootScripts(root) {
  const packageJsonPath = join(root, 'package.json')
  if (!existsSync(packageJsonPath)) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    const scripts = parsed?.scripts
    if (!scripts || typeof scripts !== 'object') {
      return null
    }
    return /** @type {Record<string, string>} */ (scripts)
  } catch {
    return null
  }
}

/**
 * @typedef {{
 *   cwd?: string,
 *   spawnSyncFn?: typeof defaultSpawnSync,
 *   now?: () => number,
 *   log?: (text: string) => void,
 *   logError?: (text: string) => void
 * }} RunLintCliOptions
 */

/**
 * Виконує лінт-ланцюжок з тайменгом. Повертає exit-код, не кидає винятків (для прямого
 * присвоєння у `process.exitCode`).
 * @param {RunLintCliOptions} [options] DI для тестів (мокаємо spawn / fs / clock)
 * @returns {number} 0 = успіх, ненульовий = code першого впалого скрипта, або 1 при структурних проблемах
 */
export function runLintCli(options = {}) {
  const root = options.cwd ?? process.cwd()
  const spawnSync = options.spawnSyncFn ?? defaultSpawnSync
  const now = options.now ?? Date.now
  const log = options.log ?? (text => process.stdout.write(text))
  const logError = options.logError ?? (text => process.stderr.write(text))

  const scripts = readRootScripts(root)
  if (scripts === null) {
    logError(`❌ n-cursor lint: не знайдено package.json або поля "scripts" у ${root}\n`)
    return 1
  }

  const present = LINT_SCRIPTS.filter(name => typeof scripts[name] === 'string' && scripts[name].length > 0)
  if (present.length === 0) {
    log('\nℹ️  n-cursor lint: у package.json немає жодного з lint-* / oxfmt скриптів — нічого запускати.\n')
    return 0
  }

  /** @type {{ id: string, ms: number, ok: boolean }[]} */
  const timings = []
  let failedCode = 0
  for (const name of present) {
    const startedAt = now()
    const result = spawnSync('bun', ['run', name], { stdio: 'inherit', cwd: root })
    const code = typeof result.status === 'number' ? result.status : 1
    const ok = code === 0
    timings.push({ id: name, ms: now() - startedAt, ok })
    if (!ok) {
      failedCode = code === 0 ? 1 : code
      break
    }
  }

  log(formatTimingSummary('Lint timing', timings))
  return failedCode
}
