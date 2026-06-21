/**
 * CLI-обгортка над канонічним `lint-ga` (ga.mdc): авто-встановлює `shellcheck` і `conftest`
 * через `ensureTool` (brew/scoop/GitHub Release per-platform), перевіряє наявність `uv` (для `uvx`),
 * тоді послідовно виконує `bunx github-actionlint`, `uvx zizmor --offline --collect=workflows .` і
 * делегує до `rules/ga/check.mjs::check()` — там і Rego-частина (через `runConftestBatch`),
 * і JS cross-file перевірки правил `ga.mdc`.
 *
 * Plan B-патерн (rego-authoritative): Rego-полісі (`npm/policy/ga/`) запускає вже сам
 * `rules/ga/check.mjs::check()` як перший крок — `lint-ga.mjs` про це не знає. Раніше `lint-ga.mjs` сам
 * спавнив conftest для `ga.<name>` per-workflow і `ga.workflow_common` (PoC); тепер ця логіка
 * централізована у `rules/ga/check.mjs`, тож одне джерело істини, без дублювання між
 * `lint-ga` і `npx \@nitra/cursor check ga`.
 *
 * Без preflight `actionlint` (через `bunx github-actionlint`) мовчки пропускає shell-перевірки в
 * `run:` блоках, коли `shellcheck` відсутній у PATH; локально `bun lint-ga` лишається зеленим, а CI
 * на ubuntu-latest (де shellcheck передвстановлений) падає. ensureTool('shellcheck') усуває цю різницю.
 *
 * `uv` потрібен для `uvx zizmor`. Якщо його нема — `uvx zizmor` падає неінформативно; підказка
 * з командою встановлення коротша й корисніша. `uv` не в реєстрі ensureTool → hint-only.
 *
 * Експортовано окремо `runLintGaCli` — викликається через `n-cursor lint ga` (оркестраторний адаптер `lint()` делегує сюди); окремої bin-підкоманди `lint-ga` немає.
 *
 * Канон патерну `lint-*` (серіалізація через `runStandardLint`, без прямого `withLock`) —
 * `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд».
 */
import { platform } from 'node:process'

import { check as checkGa } from './js/workflows.mjs'
import { resolveCmd } from '../../scripts/utils/resolve-cmd.mjs'
import { runLintStep } from '../../scripts/lib/run-lint-step.mjs'
import { runStandardLint } from '../../scripts/lib/run-standard-lint.mjs'
import { ensureTool } from '../../scripts/lib/ensure-tool.mjs'
import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня (applies → JS-concerns
 * → policy → mdc-refs); `lint()` нижче — lint-поверхня (actionlint/zizmor + check-ga), імпл інлайн тут.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

/**
 * Опис залежності preflight-ом: бінарник, для чого потрібен, і команди встановлення.
 * @typedef {object} PreflightDep
 * @property {string} bin ім'я виконуваного файлу (на Windows додається `.exe` за потреби)
 * @property {string[]} winBins альтернативні імена на Windows (`shellcheck.exe`); якщо нема — fallback на `bin`
 * @property {string} explanation 1-2 рядки про наслідки відсутності
 * @property {string[]} install список рядків з командами встановлення (друкуються як є, з відступом)
 * @property {string} successMsg повідомлення на pass-шлях
 */

/** @type {PreflightDep} */
const UV_PREFLIGHT = {
  bin: 'uv',
  winBins: ['uv.exe'],
  explanation: [
    'Без `uv` (а отже без `uvx`) не виконається `uvx zizmor` — second-stage аудит',
    'workflow на ризики GitHub Actions просто не запуститься.'
  ].join('\n   '),
  install: [
    'macOS:        brew install uv',
    'Universal:    curl -LsSf https://astral.sh/uv/install.sh | sh',
    'pip:          pip install uv'
  ],
  successMsg: '✅ uv знайдено в PATH — uvx zizmor запуститься'
}

/**
 * Шукає бінарник у PATH з урахуванням Windows: спершу `winBins`, потім `bin`.
 * @param {PreflightDep} dep опис залежності
 * @returns {string | null} абсолютний шлях або null
 */
function resolvePreflightBin(dep) {
  if (platform === 'win32') {
    for (const name of dep.winBins) {
      const r = resolveCmd(name)
      if (r) return r
    }
  }
  return resolveCmd(dep.bin)
}

/**
 * Друкує блок з причиною fail і командами встановлення.
 * @param {PreflightDep} dep опис залежності
 * @returns {void}
 */
function printPreflightMissingMessage(dep) {
  console.error(`❌ ${dep.bin} не знайдено в PATH.`)
  console.error(`   ${dep.explanation}`)
  console.error('   Встанови:')
  for (const line of dep.install) {
    console.error(`     ${line}`)
  }
  console.error('   Деталі: ga.mdc → секція про lint-ga.')
}

/**
 * Запускає preflight-перевірку: pass → лог success і повертає true; fail → лог hint і повертає false.
 * @param {PreflightDep} dep опис залежності
 * @returns {boolean} чи знайдено бінарник
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
 * Виконує канонічний `lint-ga` — авто-встановлює shellcheck/conftest, перевіряє uv, запускає actionlint/zizmor/check-ga.
 *
 * Послідовність:
 * 1) ensureTool: `shellcheck` і `conftest` (авто-install або hard-fail);
 * 2) preflight: `uv` (для `uvx zizmor`) — hint-only, без авто-install;
 * 3) `bunx github-actionlint`;
 * 4) `uvx zizmor --offline --collect=workflows .`;
 * 5) `rules/ga/check.mjs::check()` — Rego-полісі (батч conftest з `npm/policy/ga/`) + JS cross-file
 *    перевірки правил `ga.mdc`. Це **те саме**, що робить `npx \@nitra/cursor check ga`, тож
 *    `lint-ga` тепер є суперсетом перевірки правила: external-tools + check.
 * @returns {Promise<number>} 0 — все OK, інакше — код першого кроку, що впав
 */
async function runLintGaSteps() {
  // Auto-install: throws on failure → propagates as exit 1 from runStandardLint
  ensureTool('shellcheck')
  ensureTool('conftest')

  // uv is hint-only (not in auto-install registry)
  if (!preflight(UV_PREFLIGHT)) return 1

  const actionlintCode = runLintStep('actionlint', 'bunx', ['github-actionlint'])
  if (actionlintCode !== 0) return actionlintCode

  const zizmorCode = runLintStep('zizmor', 'uvx', ['zizmor', '--offline', '--collect=workflows', '.'])
  if (zizmorCode !== 0) return zizmorCode

  console.log('\n▶ check-ga (rego-полісі npm/policy/ga/ + JS cross-file перевірки)')
  return await checkGa()
}

export const runLintGaCli = () => runStandardLint(import.meta.dirname, runLintGaSteps)

/**
 * Оркестраторний адаптер `n-cursor lint ga`: делегує у `runLintGaCli`.
 * @param {string[] | undefined} _files ігнорується (whole-repo аналіз)
 * @returns {Promise<number>} exit code
 */
export function lint(_files) {
  return runLintGaCli()
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/ga/main.mjs — повний еквівалент `npx @nitra/cursor check ga`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
