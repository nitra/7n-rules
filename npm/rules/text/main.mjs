/**
 * CLI-обгортка над канонічним `lint-text` (text.mdc): авто-встановлює `shellcheck` і `dotenv-linter`
 * через `ensureTool` (brew/scoop/GitHub Release per-platform), перевіряє наявність `patch`
 * (для авто-фіксу shellcheck); далі послідовно
 *   1) `cspell .` — перевірка правопису з `@nitra/cspell-dict`;
 *   2) `runShellcheckText()` — авто-фікс і фінальна перевірка `*.sh` через `shellcheck`;
 *   3) `runDotenvLinter()` — авто-фікс і фінальна перевірка `.env*` через `dotenv-linter`;
 *   4) `bunx markdownlint-cli2 --fix "**\/*.md" "**\/*.mdc"` — авто-фікс Markdown;
 *   5) `runV8rWithGlobs()` — schema-валідація json/json5/yaml/yml/toml через v8r.
 *
 * Без preflight локальний прогін може пройти cspell/markdownlint, а CI на ubuntu-latest
 * (де shellcheck передвстановлений, але dotenv-linter — ні) падає на кроці dotenv-linter
 * з неінформативним повідомленням. ensureTool збирає всі відсутні бінарники до першого кроку.
 *
 * Перший ненульовий код з ланцюжка повертається як код виходу; наступні кроки не запускаються.
 * Експортовано як `runLintTextCli` — викликається через `n-cursor lint text` (оркестраторний адаптер `lint()` делегує сюди); окремої bin-підкоманди `lint-text` немає.
 *
 * Канон патерну `lint-*` (серіалізація через `runStandardLint`, без прямого `withLock`) —
 * `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд».
 */
import { platform } from 'node:process'

import { runLintStep } from '../../scripts/lib/run-lint-step.mjs'
import { resolveCmd } from '../../scripts/utils/resolve-cmd.mjs'
import { runStandardLint } from '../../scripts/lib/run-standard-lint.mjs'
import { ensureTool } from '../../scripts/lib/ensure-tool.mjs'
import { runCspellText } from './js/cspell-fix.mjs'
import { runDotenvLinter } from './js/run-dotenv-linter.mjs'
import { runShellcheckText } from './js/run-shellcheck.mjs'
import { runV8rWithGlobs } from './js/run-v8r.mjs'
import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня (applies → JS-concerns
 * → policy → mdc-refs); `lint()` нижче — lint-поверхня (markdownlint/cspell/shellcheck/…), імпл інлайн тут.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

/**
 * Опис залежності preflight-ом.
 * @typedef {object} PreflightDep
 * @property {string} bin ім'я виконуваного файлу
 * @property {string[]} [winBins] альтернативні імена на Windows
 * @property {string} explanation наслідки відсутності
 * @property {string[]} install команди встановлення
 * @property {string} successMsg повідомлення на pass-шлях
 */

/** @type {PreflightDep} */
const PATCH_PREFLIGHT = {
  bin: 'patch',
  explanation: ['Без `patch` не застосуються авто-виправлення shellcheck (`shellcheck -f diff` + `patch -p1`).'].join(
    '\n   '
  ),
  install: ['macOS:         зазвичай уже є в системі', 'Debian/Ubuntu: sudo apt-get install -y patch'],
  successMsg: '✅ patch знайдено в PATH — shellcheck auto-fix працюватиме'
}

/**
 * Шукає шлях до бінарника `dep.bin` у `PATH`; на Windows додатково перебирає `dep.winBins`.
 * @param {PreflightDep} dep опис залежності з canon-списку preflight-перевірок
 * @returns {string | null} абсолютний шлях до знайденого бінарника або `null`, якщо не знайдено
 */
function resolvePreflightBin(dep) {
  if (platform === 'win32' && dep.winBins) {
    for (const name of dep.winBins) {
      const r = resolveCmd(name)
      if (r) return r
    }
  }
  return resolveCmd(dep.bin)
}

/**
 * Друкує stderr-повідомлення про відсутній бінарник з install-hint'ами і посиланням на правило.
 * @param {PreflightDep} dep опис залежності — джерело пояснення й install-команд
 * @returns {void} нічого не повертає; виводить рядки в `console.error`
 */
function printPreflightMissingMessage(dep) {
  console.error(`❌ ${dep.bin} не знайдено в PATH.`)
  console.error(`   ${dep.explanation}`)
  console.error('   Встанови:')
  for (const line of dep.install) {
    console.error(`     ${line}`)
  }
  console.error('   Деталі: text.mdc → секція про lint-text.')
}

/**
 * Виконує preflight-перевірку: повертає `true` і друкує `successMsg`, якщо бінарник знайдено,
 * інакше друкує install-hint у stderr і повертає `false`.
 * @param {PreflightDep} dep опис залежності для перевірки наявності в `PATH`
 * @returns {boolean} `true` — бінарник знайдено, `false` — відсутній
 */
function preflight(dep) {
  if (resolvePreflightBin(dep)) {
    console.log(dep.successMsg)
    return true
  }
  printPreflightMissingMessage(dep)
  return false
}

/**
 * Внутрішні кроки `lint-text` без локу.
 * @param {boolean} [readOnly] true → лише детект без авто-фіксу (нуль мутацій — CI/pre-commit)
 * @param {boolean} [llmFix] opt-in omlx-класифікація cspell (інші кроки фіксяться детерміновано за readOnly)
 * @returns {Promise<number>} 0 — все OK, інакше — код першого кроку, що впав
 */
async function runLintTextSteps(readOnly = false, llmFix = false) {
  // Auto-install: throws on failure → propagates as exit 1 from runStandardLint
  ensureTool('shellcheck')
  ensureTool('dotenv-linter')

  // patch потрібен лише для авто-фіксу shellcheck; у read-only пропускаємо preflight.
  if (!readOnly && !preflight(PATCH_PREFLIGHT)) return 1

  console.log(`\n▶ cspell (${!readOnly && llmFix ? 'LLM-класифікація + словник + перевірка' : 'перевірка'})`)
  const cspellCode = await runCspellText(process.cwd(), readOnly, llmFix)
  if (cspellCode !== 0) return cspellCode

  console.log(`\n▶ shellcheck (${readOnly ? 'перевірка' : 'авто-фікс + фінальна перевірка'} *.sh)`)
  const shellcheckCode = runShellcheckText(process.cwd(), readOnly)
  if (shellcheckCode !== 0) return shellcheckCode

  console.log(`\n▶ dotenv-linter (${readOnly ? 'перевірка' : 'авто-фікс + фінальна перевірка'} .env*)`)
  const dotenvCode = runDotenvLinter(process.cwd(), readOnly)
  if (dotenvCode !== 0) return dotenvCode

  const mdArgs = readOnly
    ? ['markdownlint-cli2', '**/*.md', '**/*.mdc']
    : ['markdownlint-cli2', '--fix', '**/*.md', '**/*.mdc']
  const markdownlintCode = runLintStep('markdownlint', 'bunx', mdArgs)
  if (markdownlintCode !== 0) return markdownlintCode

  console.log('\n▶ v8r (schema-валідація json/json5/yaml/yml/toml)')
  return runV8rWithGlobs()
}

/**
 * Публічна CLI-форма: серіалізує через `withLock('lint-text')` + дедуп за станом git-дерева.
 * @param {{ readOnly?: boolean, llmFix?: boolean }} [opts] readOnly → детект без авто-фіксу;
 *   llmFix → omlx-класифікація cspell (opt-in із `meta.json: llmFix:true`)
 * @returns {Promise<number>} код виходу
 */
export const runLintTextCli = (opts = {}) =>
  runStandardLint(import.meta.dirname, () => runLintTextSteps(opts.readOnly === true, opts.llmFix === true))

/**
 * Оркестраторний адаптер `n-cursor lint text`: делегує у `runLintTextCli`.
 * @param {string[] | undefined} _files ігнорується (whole-repo аналіз)
 * @param {string} [_cwd] корінь (ігнорується — CLI працює від process.cwd())
 * @param {{ readOnly?: boolean, llmFix?: boolean }} [opts] readOnly → детект без авто-фіксу;
 *   llmFix → opt-in omlx-класифікація cspell
 * @returns {Promise<number>} exit code
 */
export function lint(_files, _cwd, opts = {}) {
  return runLintTextCli({ readOnly: opts.readOnly === true, llmFix: opts.llmFix === true })
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/text/main.mjs — повний еквівалент `npx @nitra/cursor check text`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
