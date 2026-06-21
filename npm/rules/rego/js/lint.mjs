/**
 * Лінт Rego-полісі (`conftest.mdc` + `rego.mdc`): `ensureTool` на `opa` і `regal`
 * (авто-install per-platform або hard-fail), далі послідовно `opa check --strict`,
 * `regal lint` і опційний `conftest verify` (для `*_test.rego`-файлів) якщо conftest у PATH.
 *
 * Чому два-три інструменти:
 * - `opa check --strict` — компіляція з типами і строгим режимом (мертвий код, неоднозначні
 *   правила, незадекларовані змінні). Ловить помилки, які `regal` навмисно лишає поза скоупом
 *   (він — про стиль і ідіоматичність, а не про компіляцію).
 * - `regal lint` (https://docs.styra.com/regal) — статичний лінтер Rego: ловить v0-синтаксис,
 *   неявні set-rules та інші відхилення від `rego.v1`, плюс bugs/idiomatic/performance-правила.
 * - `conftest verify` (опційно) — виконує `test_*` правила у `*_test.rego` (юніт-тести політик).
 *   Якщо conftest відсутній у PATH — пропускаємо без помилки (тести опційні в локальному середовищі;
 *   у CI потрібно встановити conftest).
 *
 * `opa`/`regal` резолвляться через `ensureTool` (PATH → кеш → авто-install brew/scoop/GitHub
 * Release → hard-fail) — без них лінт мовчки злетів би з невиразним повідомленням від shell.
 * `opa` додатково потрібен VS Code-розширенню `tsandall.opa` (LSP, format-on-save через
 * `opa fmt`) — деталі в `mdc/rego.mdc`.
 *
 * Цілі лінту: `npm/rules/` (де живуть Rego-полісі пакета `@nitra/cursor` — у
 * `npm/rules/<id>/policy/<concern>/`). Усі три інструменти приймають один шлях
 * і самі рекурсивно знаходять `.rego` (ігноруючи інші розширення на кшталт
 * `target.json` чи template-фіх).
 *
 * Канон патерну `lint-*` (серіалізація через `runStandardLint`, без прямого `withLock`) —
 * `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд».
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'

/** Шляхи з Rego-полісі (відносно cwd). Існують не всі на ранніх стадіях — фільтруємо нижче. */
const LINT_TARGETS = ['npm/rules']

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
 *
 * Внутрішня форма без локу — для тестів, які працюють у тимчасових каталогах і мають
 * можливість запускати fresh без дедуплікації проти попереднього прогону.
 * @param {string} [cwd] робочий каталог (за замовчуванням `process.cwd()`)
 * @returns {number} 0 — OK або skip; інакше код виходу першого кроку, що впав
 */
export function runLintRegoSteps(cwd = process.cwd()) {
  const root = resolve(cwd)
  const opa = ensureTool('opa')
  const regal = ensureTool('regal')

  const targets = LINT_TARGETS.filter(rel => existsSync(resolve(root, rel)))
  if (targets.length === 0) {
    return 0
  }

  const opaCode = runStep(opa, ['check', '--strict', ...targets], root)
  if (opaCode !== 0) return opaCode

  const regalCode = runStep(regal, ['lint', ...targets], root)
  if (regalCode !== 0) return regalCode

  const conftest = resolveCmd('conftest')
  if (!conftest) {
    console.log(
      'ℹ conftest не знайдено в PATH — пропускаю `conftest verify` (юніт-тести *_test.rego).\n' +
        '  Встанови, щоб запустити локально: brew install conftest (macOS) або https://www.conftest.dev/install/'
    )
    return 0
  }
  return runStep(conftest, ['verify', ...targets.flatMap(t => ['-p', t])], root)
}

/**
 * Публічна CLI-форма: серіалізує через `withLock('lint-rego')` + дедуп за станом git-дерева.
 * @returns {Promise<number>} код виходу
 */
export const runLintRego = () => runStandardLint(import.meta.dirname, () => runLintRegoSteps())

/**
 * Оркестраторний адаптер `n-cursor lint rego`: делегує у `runLintRego`.
 * @param {string[] | undefined} _files ігнорується (whole-repo аналіз)
 * @returns {Promise<number>} exit code
 */
export function lint(_files) {
  return runLintRego()
}

if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runLintRego()
}
