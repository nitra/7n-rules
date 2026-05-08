/**
 * Лінт Rego-полісі (`conftest.mdc` + `rego.mdc`): preflight на `opa` і `regal`,
 * далі послідовно `opa check --strict` і `regal lint`.
 *
 * Чому два інструменти:
 * - `opa check --strict` — компіляція з типами і строгим режимом (мертвий код, неоднозначні
 *   правила, незадекларовані змінні). Ловить помилки, які `regal` навмисно лишає поза скоупом
 *   (він — про стиль і ідіоматичність, а не про компіляцію).
 * - `regal lint` (https://docs.styra.com/regal) — статичний лінтер Rego: ловить v0-синтаксис,
 *   неявні set-rules та інші відхилення від `rego.v1`, плюс bugs/idiomatic/performance-правила.
 *
 * Без preflight-у на бінарники лінт мовчки злетить з невиразним повідомленням від shell —
 * друкуємо явні install-hints (як це робить `lint-ga.mjs` для shellcheck/uv). `opa` додатково
 * потрібен VS Code-розширенню `tsandall.opa` (LSP, format-on-save через `opa fmt`) — деталі в
 * `mdc/rego.mdc`.
 *
 * Цілі лінту: `npm/policy/` (місце, де поки що живуть Rego-полісі пакета `@nitra/cursor`).
 * Якщо в репозиторії з’являться інші *.rego поза цим деревом, додай шлях у `LINT_TARGETS` —
 * обидва інструменти приймають кілька шляхів і самі рекурсивно обходять директорії.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveCmd } from './utils/resolve-cmd.mjs'

/** Шляхи з Rego-полісі (відносно cwd). Існують не всі на ранніх стадіях — фільтруємо нижче. */
const LINT_TARGETS = ['npm/policy']

/**
 * Друкує підказку зі встановлення `opa` (потрібен для `opa check --strict` і VS Code LSP).
 * @returns {void}
 */
function printOpaInstallHints() {
  process.stderr.write(
    [
      '❌ opa не знайдено в PATH.',
      '   Без нього не запускається `opa check --strict` (типи + мертвий код у *.rego),',
      '   і не працює VS Code-розширення `tsandall.opa` (LSP, format-on-save через opa fmt).',
      '   Встанови:',
      '     macOS:     brew install opa',
      '     Universal: https://www.openpolicyagent.org/docs/latest/#1-download-opa',
      ''
    ].join('\n')
  )
}

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
      '     macOS:     brew install regal',
      '     Universal: https://docs.styra.com/regal#installation',
      ''
    ].join('\n')
  )
}

/**
 * Запускає крок з відображенням команди користувачу. Stdout/stderr передаємо як є
 * (`stdio: 'inherit'`), щоб виглядало як прямий виклик у shell.
 * @param {string} bin абсолютний шлях до бінарника
 * @param {string[]} args аргументи
 * @param {string} cwd робочий каталог
 * @returns {number} код виходу (0 — OK)
 */
function runStep(bin, args, cwd) {
  console.log(`▶ ${bin} ${args.join(' ')}`)
  const result = spawnSync(bin, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) {
    process.stderr.write(`❌ Не вдалося запустити ${bin}: ${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}

/**
 * Запускає `opa check --strict` і `regal lint` по існуючих цілях. Якщо жодної цілі немає —
 * пропускає лінт із кодом 0. Якщо хоча б один preflight не пройшов — exit 1 ще до запусків.
 * @param {string} [cwd] робочий каталог (за замовчуванням `process.cwd()`)
 * @returns {number} 0 — OK або skip; інакше код виходу першого кроку, що впав
 */
export function runLintRego(cwd = process.cwd()) {
  const root = resolve(cwd)
  const opa = resolveCmd('opa')
  const regal = resolveCmd('regal')

  let preflightOk = true
  if (!opa) {
    printOpaInstallHints()
    preflightOk = false
  }
  if (!regal) {
    printRegalInstallHints()
    preflightOk = false
  }
  if (!preflightOk) return 1

  const targets = LINT_TARGETS.filter(rel => existsSync(resolve(root, rel)))
  if (targets.length === 0) {
    return 0
  }

  const opaCode = runStep(opa, ['check', '--strict', ...targets], root)
  if (opaCode !== 0) return opaCode

  return runStep(regal, ['lint', ...targets], root)
}

process.exitCode = runLintRego()
