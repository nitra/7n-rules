import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { createCheckReporter } from '../../scripts/lib/check-reporter.mjs'
import { runStandardLint } from '../../scripts/lib/run-standard-lint.mjs'
import { resolveCmd } from '../../scripts/utils/resolve-cmd.mjs'
import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня: applies →
 * JS-concerns → policy → mdc-refs (через runStandardRule). `lint()` — lint-поверхня
 * (licensee — перевірка ліцензій npm-залежностей, лише у `--full`).
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону (walkCache тощо)
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

/** Дефолтний allowlist: Blue Oak bronze — дозволяє MIT/Apache/BSD/ISC, блокує GPL/AGPL/LGPL. */
const DEFAULT_LICENSEE_CONFIG = JSON.stringify({ licenses: { blueOak: 'bronze' }, corrections: true }, null, 2) + '\n'

/**
 * Перевірка ліцензій npm-залежностей через `licensee`.
 * У fix-режимі: якщо `.licensee.json` відсутній — генерує його з дефолтним allowlist
 * (blueOak: bronze) і запускає перевірку. У readOnly (CI): відсутність файлу → fail.
 * @param {string} [cwd] корінь проєкту
 * @param {{ readOnly?: boolean }} [opts]
 * @returns {number} 0 — OK, 1 — порушення
 */
function runLicenseeSteps(cwd = process.cwd(), opts = {}) {
  const readOnly = opts.readOnly === true
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const configPath = join(cwd, '.licensee.json')
  if (!existsSync(configPath)) {
    if (readOnly) {
      fail(
        'lint-bun: licensee — немає .licensee.json; запустіть `npx @nitra/cursor fix bun` локально для генерації (bun.mdc)'
      )
      return reporter.getExitCode()
    }
    writeFileSync(configPath, DEFAULT_LICENSEE_CONFIG, 'utf8')
    pass('lint-bun: licensee — створено .licensee.json з дефолтним allowlist (blueOak: bronze)')
  }

  const bun = resolveCmd('bun')
  if (!bun) {
    fail('lint-bun: `bun` не знайдено в PATH (bun.mdc)')
    return reporter.getExitCode()
  }

  const r = spawnSync(bun, ['x', 'licensee', '--production', '--quiet'], { cwd, stdio: 'inherit', shell: false })
  if (r.status === 0) {
    pass('lint-bun: licensee — ліцензії OK')
  } else {
    const code = typeof r.status === 'number' ? r.status : 1
    fail(`lint-bun: licensee — порушення ліцензій (код ${code}, bun.mdc)`)
  }
  return reporter.getExitCode()
}

/**
 * Оркестраторний адаптер `n-cursor lint bun`: licensee-перевірка ліцензій npm-залежностей.
 * Whole-repo (ігнорує `_files`). Fix-режим: auto-генерує `.licensee.json` якщо відсутній.
 * @param {string[] | undefined} _files ігнорується
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean }} [opts] readOnly → не мутує ФС; відсутність конфігу → fail
 * @returns {Promise<number>} exit code
 */
export function lint(_files, cwd = process.cwd(), opts = {}) {
  return runStandardLint(import.meta.dirname, () => runLicenseeSteps(cwd, opts))
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/<id>/main.mjs — повний еквівалент `npx @nitra/cursor check <id>`
  // (config-loading + whitelist + summary): library-роль (run) + standalone-роль (CLI-блок).
  process.exitCode = await runRuleCli(import.meta.dirname)
}
