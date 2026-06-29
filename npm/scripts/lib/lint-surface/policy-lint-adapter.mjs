/**
 * Policy → detector adapter. Перетворює policy-поверхню concern-а (Rego через conftest
 * або template deep-subset) на unified `LintResult`. Generated `main.mjs` policy-concern-а
 * викликає саме цю функцію (spec 2026-06-29 §Policy Codegen).
 *
 * Переоформлює перевірену логіку run-rule.mjs у структуровані violations — НЕ дублює її:
 * та сама `resolveTargetFiles` / `runConftestBatch` / template-checks.
 *
 * @typedef {import('./types.mjs').LintContext} LintContext
 * @typedef {import('./types.mjs').LintResult} LintResult
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('./types.mjs').PolicySurface} PolicySurface
 */
import { relative } from 'node:path'

import { resolveTargetFiles } from '../resolve-target-files.mjs'
import { runConftestBatch } from '../run-conftest-batch.mjs'
import {
  checkContains,
  checkDeny,
  checkSnippet,
  checkTextSubset,
  parseByExt,
  resolveConcernTemplateData
} from '../template.mjs'

/**
 * posix-relative шлях від cwd (для LintViolation.file).
 * @param {string} abs
 * @param {string} cwd
 * @returns {string}
 */
function toRel(abs, cwd) {
  return (relative(cwd, abs) || abs).split('\\').join('/')
}

/**
 * @param {object} cfg
 * @param {'rego'|'template'} cfg.engine
 * @param {string} cfg.policyDir абсолютний шлях до теки concern-а
 * @param {PolicySurface['files']} cfg.files target-семантика
 * @param {string} [cfg.missingMessage]
 * @param {LintContext} ctx
 * @returns {Promise<LintResult>}
 */
export async function evaluatePolicyConcern(ctx, cfg) {
  const { cwd, ruleId, concernId } = ctx
  /** @type {LintViolation[]} */
  const violations = []
  /** @param {string} reason @param {string} message @param {string} [file] */
  const add = (reason, message, file) => {
    const v = { ruleId, concernId, reason, message, severity: 'error' }
    if (file) v.file = file
    violations.push(/** @type {LintViolation} */ (v))
  }

  const files = await resolveTargetFiles(cfg.files, cwd, new Map())
  if (files.length === 0) {
    if (cfg.files.required && cfg.files.single) {
      const msg = cfg.missingMessage ?? `${cfg.files.single} не існує — створи згідно main.mdc (${ruleId}/${concernId})`
      add('policy-file-missing', msg, cfg.files.single)
    }
    return { violations }
  }

  if (cfg.engine === 'template') {
    const data = await resolveConcernTemplateData(cfg.policyDir, { files: cfg.files, check: 'template' })
    if (!data) return { violations } // немає сніпета → нічого перевіряти
    for (const file of files) {
      const rel = toRel(file, cwd)
      const actual = await parseByExt(file)
      const opts = { targetPath: rel, source: 'main.mdc' }
      const msgs = [
        ...(typeof data.snippet === 'string'
          ? checkTextSubset(actual, data.snippet, opts)
          : checkSnippet(actual, data.snippet, opts)),
        ...checkDeny(actual, data.deny, opts),
        ...checkContains(actual, data.contains, opts)
      ]
      for (const m of msgs) add('policy-template-mismatch', m, rel)
    }
    return { violations }
  }

  // Rego
  const namespace = `${ruleId.replaceAll('-', '_')}.${concernId}`
  const templateData = await resolveConcernTemplateData(cfg.policyDir, { files: cfg.files })
  const denies = runConftestBatch({
    policyDirRel: `${ruleId}/${concernId}`,
    namespace,
    files,
    templateData
  })
  for (const d of denies) add('policy-deny', d.message, d.filename ? toRel(d.filename, cwd) : undefined)
  return { violations }
}
