/**
 * Policy source test-step (spec 2026-06-29 §Policy Unit Tests).
 *
 * `<concern>_test.rego` — це source-validation policy-concern-а (НЕ окремий consumer
 * detector і НЕ четверта surface). Runner знаходить policy.engine:'rego' concern-и з
 * `<concern>_test.rego` іганяє `conftest verify` по їх теці; failures нормалізує у
 * `LintViolation { reason: 'rego-unit-test-failed' }`.
 *
 * Запуск (зі специфікації): у `lint --no-fix --full`, або в delta якщо змінився
 * concern.json/.rego/_test.rego/template/ концерну; перед policy codegen/evaluate.
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { readConcernMeta } from '../concern-meta.mjs'
import { resolveCmd } from '../../utils/resolve-cmd.mjs'

/**
 * Дефолтний раннер conftest verify. Інжектиться у тестах.
 * @param {string} concernDir
 * @returns {{ ok: boolean, failures: Array<{ name: string, msg: string }>, skipped?: boolean }}
 */
function defaultRunner(concernDir) {
  const conftest = resolveCmd('conftest')
  if (!conftest) return { ok: true, failures: [], skipped: true }
  const r = spawnSync(conftest, ['verify', '-p', concernDir, '--output', 'json', '--no-color'], {
    encoding: 'utf8'
  })
  if (r.status === 0) return { ok: true, failures: [] }
  /** @type {Array<{ name: string, msg: string }>} */
  const failures = []
  try {
    const parsed = JSON.parse(r.stdout || '[]')
    for (const entry of parsed) {
      for (const f of entry.failures ?? []) failures.push({ name: entry.namespace ?? 'test', msg: f.msg ?? String(f) })
    }
  } catch {
    failures.push({ name: 'conftest', msg: (r.stderr || r.stdout || 'conftest verify failed').trim().slice(0, 300) })
  }
  return { ok: failures.length === 0, failures }
}

/**
 * Чи має concern policy.engine:'rego' + `<concern>_test.rego`.
 * @param {string} concernDir
 * @param {string} concernName
 * @returns {Promise<boolean>}
 */
async function hasRegoTests(concernDir, concernName) {
  if (!existsSync(join(concernDir, `${concernName}_test.rego`))) return false
  const meta = await readConcernMeta(concernDir, concernName)
  return Boolean(meta?.policy && meta.policy.engine === 'rego')
}

/**
 * Запускає policy unit-tests по всіх (або вибраних) rego-concern-ах.
 * @param {string} rulesDir
 * @param {string} cwd для posix-relative file у violation
 * @param {object} [opts]
 * @param {string[]} [opts.rules] обмежити цими rule-id
 * @param {(concernDir: string) => { ok: boolean, failures: Array<{ name: string, msg: string }>, skipped?: boolean }} [opts.runner]
 * @returns {Promise<{ violations: LintViolation[], skipped: boolean, ran: number }>}
 */
export async function runPolicyUnitTests(rulesDir, cwd, opts = {}) {
  const runner = opts.runner ?? defaultRunner
  const ruleFilter = Array.isArray(opts.rules) && opts.rules.length > 0 ? new Set(opts.rules) : null
  /** @type {LintViolation[]} */
  const violations = []
  let skipped = false
  let ran = 0

  if (!existsSync(rulesDir)) return { violations, skipped, ran }
  for (const ruleName of readdirSync(rulesDir).toSorted()) {
    if (ruleName.startsWith('.')) continue
    if (ruleFilter && !ruleFilter.has(ruleName)) continue
    const ruleDir = join(rulesDir, ruleName)
    if (!statSync(ruleDir).isDirectory()) continue
    for (const concernName of readdirSync(ruleDir).toSorted()) {
      if (concernName.startsWith('.')) continue
      const concernDir = join(ruleDir, concernName)
      if (!statSync(concernDir).isDirectory()) continue
      if (!(await hasRegoTests(concernDir, concernName))) continue

      const res = runner(concernDir)
      if (res.skipped) {
        skipped = true
        continue
      }
      ran++
      const testRel = (relative(cwd, join(concernDir, `${concernName}_test.rego`)) || `${concernName}_test.rego`)
        .split('\\')
        .join('/')
      for (const f of res.failures) {
        violations.push({
          ruleId: ruleName,
          concernId: concernName,
          reason: 'rego-unit-test-failed',
          message: `${concernName}_test.rego: ${f.name} — ${f.msg}`,
          file: testRel,
          severity: 'error',
          data: { engine: 'conftest' }
        })
      }
    }
  }
  return { violations, skipped, ran }
}
