/** @see ./docs/lint.md */
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { ESLint } from 'eslint'
import { main as knipMain } from 'knip'

import { addedLinesByFile } from '../../scripts/lib/diff-added-lines.mjs'
import { classifyFindings, eslintResultsToFindings, parseOxlint, renderFindings } from './js/lint-findings.mjs'
import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня (applies → JS-concerns
 * → policy → mdc-refs); `lint()` нижче — lint-поверхня (oxlint+eslint), імпл інлайн тут.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

const JS_EXT_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|vue)$/u

/**
 * Лишає лише js-подібні файли зі списку.
 * @param {string[]} files список шляхів
 * @returns {string[]} підмножина js-подібних
 */
export function filterJsFiles(files) {
  return files.filter(f => JS_EXT_RE.test(f))
}

/**
 * Запуск oxlint (через bunx) зі стрімінгом у термінал.
 * @param {string[]} args аргументи
 * @param {string} cwd корінь
 * @returns {number} exit code
 */
function runOxlint(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, stdio: 'inherit' })
  return typeof r.status === 'number' ? r.status : 1
}

/**
 * Авто-фікс-пас oxlint: stdout приглушено, stderr — назовні.
 * @param {string[]} args аргументи
 * @param {string} cwd корінь
 * @returns {number} exit code
 */
function runOxlintFix(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] })
  return typeof r.status === 'number' ? r.status : 1
}

/** Запас буфера для json-виводу oxlint (великі changeset-и > дефолтного ~1MB). */
const JSON_MAX_BUFFER = 64 * 1024 * 1024

/**
 * Репорт-пас oxlint: `--format=json`.
 * @param {string[]} args аргументи
 * @param {string} cwd корінь
 * @returns {{ status: number, stdout: string }} результат
 */
function runOxlintJson(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, encoding: 'utf8', maxBuffer: JSON_MAX_BUFFER })
  return { status: typeof r.status === 'number' ? r.status : 1, stdout: r.stdout ?? '' }
}

/**
 * Full-режим (--full): лінт усього проєкту зі стрімінгом і fail-fast (без класифікації).
 * @param {string} cwd корінь
 * @param {boolean} readOnly true → без `--fix` (детект, нуль мутацій — CI)
 * @returns {Promise<number>} exit code
 */
async function lintFullProject(cwd, readOnly) {
  const ox = runOxlint(readOnly ? ['oxlint'] : ['oxlint', '--fix'], cwd)
  if (ox !== 0) return ox

  const eslint = new ESLint({ fix: !readOnly, cwd })
  let results
  try {
    results = await eslint.lintFiles([cwd])
    if (!readOnly) await ESLint.outputFixes(results)
  } catch (err) {
    process.stderr.write(`❌ js: eslint завершився з помилкою: ${err.message}\n`)
    return 1
  }
  const formatter = await eslint.loadFormatter('stylish')
  const text = await formatter.format(results)
  if (text) process.stdout.write(`${text}\n`)
  return results.some(r => r.errorCount > 0) ? 1 : 0
}

/**
 * Крос-файловий аналіз: jscpd (дублікати) + knip (невикористані залежності/експорти).
 * Ігнорує `files` — завжди по всьому репо.
 * @param {string} cwd корінь репо
 * @returns {Promise<number>} exit code
 */
async function lintFullCi(cwd) {
  const jscpd = spawnSync('bunx', ['jscpd', '.'], { cwd, stdio: 'inherit' })
  const jc = typeof jscpd.status === 'number' ? jscpd.status : 1
  if (jc !== 0) return jc

  // createOptions — внутрішній хелпер knip, що резолвить config/catalog/workspace перед run
  const { createOptions } = await import('knip/dist/util/create-options.js')
  const { runReporters } = await import('knip/dist/util/reporter.js')
  const options = await createOptions({ cwd, isDisableConfigHints: true })
  const results = await knipMain(options)

  await runReporters(['symbols'], {
    report: options.includedIssueTypes,
    ...results,
    cwd: options.cwd,
    isDisableConfigHints: options.isDisableConfigHints,
    isDisableTagHints: options.isDisableTagHints,
    isTreatConfigHintsAsErrors: false,
    isTreatTagHintsAsErrors: false,
    rules: options.rules,
    isProduction: options.isProduction,
    isShowProgress: false,
    maxShowIssues: undefined,
    options: '',
  })

  return results.counters.total > 0 ? 1 : 0
}

/**
 * Quick-режим: авто-фікс змінених файлів, тоді класифікація лишених findings
 * на introduced / pre-existing (беклог #6/A). Блокування на будь-якому finding.
 * @param {string[]} js js-подібні змінені файли (відносні до cwd)
 * @param {string} cwd корінь
 * @param {boolean} readOnly true → пропустити фікс-пас (детект, нуль мутацій)
 * @returns {Promise<number>} exit code (0 — чисто; 1 — лишились findings)
 */
async function lintChangedClassified(js, cwd, readOnly) {
  const absJs = js.map(f => resolve(cwd, f))

  let esResults
  if (readOnly) {
    const eslint = new ESLint({ cwd })
    try {
      esResults = await eslint.lintFiles(absJs)
    } catch (err) {
      process.stderr.write(`❌ js: eslint завершився з помилкою: ${err.message}\n`)
      return 1
    }
  } else {
    // oxlint fix першим — щоб eslint бачив уже виправлені файли
    runOxlintFix(['oxlint', '--fix', ...js], cwd)
    const eslint = new ESLint({ fix: true, cwd })
    try {
      esResults = await eslint.lintFiles(absJs)
      await ESLint.outputFixes(esResults)
    } catch (err) {
      process.stderr.write(`❌ js: eslint завершився з помилкою: ${err.message}\n`)
      return 1
    }
  }

  // Репорт-пас oxlint по ФІНАЛЬНОМУ (пост-фікс) стані файлів
  const oxRes = runOxlintJson(['oxlint', '--format=json', ...js], cwd)
  const ox = parseOxlint(oxRes.stdout)

  // Краш oxlint (ненульовий exit + непарсабельний json) — фейлимо явно
  if (ox === null && oxRes.status !== 0) {
    process.stderr.write('❌ js: oxlint завершився з помилкою (не lint-порушення) — json не розпарсено\n')
    return 1
  }

  const es = eslintResultsToFindings(esResults)
  const findings = [...(ox ?? []), ...es]
  if (findings.length === 0) return 0

  const classified = classifyFindings(findings, addedLinesByFile(js, cwd), cwd)
  const header = `❌ js: ${findings.length} порушень (introduced ${classified.introduced.length}, pre-existing ${classified.preExisting.length})`
  process.stdout.write(`${header}\n${renderFindings(classified, cwd)}\n`)
  return 1
}

/**
 * Запускає oxlint+eslint (per-file або full) + jscpd+knip (лише full).
 * За замовчуванням — з автофіксом; `opts.readOnly` — лише детект.
 * @param {string[] | undefined} files per-file: лише ці файли; undefined: весь проєкт (--full)
 * @param {string} [cwd] корінь репо
 * @param {{ readOnly?: boolean }} [opts] readOnly → без `--fix` (нуль мутацій)
 * @returns {Promise<number>} 0 — OK, ≠0 — порушення
 */
export async function lint(files, cwd = process.cwd(), opts = {}) {
  const readOnly = opts.readOnly === true
  if (files === undefined) {
    const esCode = await lintFullProject(cwd, readOnly)
    if (esCode !== 0) return esCode
    return lintFullCi(cwd)
  }
  const js = filterJsFiles(files)
  if (js.length === 0) return 0
  return lintChangedClassified(js, cwd, readOnly)
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/js/main.mjs — повний еквівалент `npx @nitra/cursor check js`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
