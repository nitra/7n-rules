/**
 * Запуск `regal lint` по Rego-полісі репозиторію (`conftest.mdc`).
 *
 * Regal (https://docs.styra.com/regal) — статичний лінтер Rego, який ловить v0-синтаксис,
 * неявні set-rules та інші відхилення від `rego.v1`. Без preflight-у на наявність бінарника
 * лінт мовчки злетить з невиразним повідомленням від shell — тут друкуємо явний install-hint
 * (як це робить `lint-ga.mjs` для shellcheck/uv).
 *
 * Цілі лінту: `npm/policy/` (місце, де поки що живуть Rego-полісі пакета `@nitra/cursor`).
 * Якщо в репозиторії з’являться інші *.rego поза цим деревом, додай шлях у `LINT_TARGETS` —
 * `regal lint` приймає кілька шляхів і сам рекурсивно обходить директорії.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveCmd } from './utils/resolve-cmd.mjs'

/** Шляхи з Rego-полісі (відносно cwd). Існують не всі на ранніх стадіях — фільтруємо нижче. */
const LINT_TARGETS = ['npm/policy']

/**
 * Друкує підказку зі встановлення `regal`.
 * @returns {void}
 */
function printRegalInstallHints() {
  process.stderr.write(
    [
      '❌ regal не знайдено в PATH.',
      '   Без нього не перевіряється rego.v1 синтаксис у *.rego (правило `conftest`).',
      '   Встанови:',
      '     macOS:    brew install regal',
      '     Universal: https://docs.styra.com/regal#installation',
      ''
    ].join('\n')
  )
}

/**
 * Запускає `regal lint` по існуючих цілях. Якщо жодної цілі немає — пропускає лінт із кодом 0.
 * @param {string} [cwd] робочий каталог (за замовчуванням `process.cwd()`)
 * @returns {number} 0 — OK або skip; інакше код виходу regal
 */
export function runLintRego(cwd = process.cwd()) {
  const root = resolve(cwd)
  const regal = resolveCmd('regal')
  if (!regal) {
    printRegalInstallHints()
    return 1
  }

  const targets = LINT_TARGETS.filter(rel => existsSync(resolve(root, rel)))
  if (targets.length === 0) {
    return 0
  }

  console.log(`▶ regal lint ${targets.join(' ')}`)
  const result = spawnSync(regal, ['lint', ...targets], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  })
  if (result.error) {
    process.stderr.write(`❌ Не вдалося запустити regal: ${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}

process.exitCode = runLintRego()
