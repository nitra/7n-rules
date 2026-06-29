/**
 * Оркестратор одного правила під CLI `fix`/`check`.
 *
 * Послідовність (concerns у межах правила — алфавітно):
 *   1. **Check concerns** — `<concern>/main.mjs::main(cwd)` для кожного concern із `check:true`.
 *   2. **Policy concerns** — `<concern>/concern.json#policy` через `runConftestBatch`.
 *
 * Кожен concern має власний `createCheckReporter` — їхні exit-коди OR-яться в один.
 */
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createCheckReporter } from './check-reporter.mjs'
import { resolveTargetFiles } from './resolve-target-files.mjs'
import { runConftestBatch } from './run-conftest-batch.mjs'
import {
  checkContains,
  checkDeny,
  checkSnippet,
  checkTextSubset,
  parseByExt,
  resolveConcernTemplateData
} from './template.mjs'

/**
 * Snippet-driven перевірка (`concern.json#policy.check:"template"`).
 * @param {string} concernDir абсолютний шлях до каталогу concern-а
 * @param {import('./concern-meta.mjs').PolicySurface} policy
 * @param {string[]} files актуальні файли-таргети
 * @param {string} ruleId id правила (для повідомлень)
 * @param {string} concernName ім'я concern-а
 * @returns {Promise<number>}
 */
export async function runTemplateSubsetConcern(concernDir, policy, files, ruleId, concernName) {
  const reporter = createCheckReporter()
  const data = await resolveConcernTemplateData(concernDir, policy)
  if (!data) {
    reporter.pass(`${concernName}: немає template-сніпета — пропущено`)
    return reporter.getExitCode()
  }
  for (const file of files) {
    const rel = relative(process.cwd(), file) || file
    const actual = await parseByExt(file)
    const opts = { targetPath: rel, source: 'main.mdc' }
    const violations = [
      ...(typeof data.snippet === 'string'
        ? checkTextSubset(actual, data.snippet, opts)
        : checkSnippet(actual, data.snippet, opts)),
      ...checkDeny(actual, data.deny, opts),
      ...checkContains(actual, data.contains, opts)
    ]
    if (violations.length === 0) {
      reporter.pass(`${concernName}: ${rel} відповідає канону (template subset)`)
    } else {
      for (const v of violations) reporter.fail(v)
    }
  }
  return reporter.getExitCode()
}

/**
 * Запускає policy concern через conftest або template subset.
 * @param {string} ruleId id правила
 * @param {import('./concern-meta.mjs').ConcernMeta} concern concern-дескриптор
 * @param {Map<string, Promise<string[]>>} walkCache
 * @returns {Promise<number>}
 */
async function runPolicyConcern(ruleId, concern, walkCache) {
  const reporter = createCheckReporter()
  const policy = concern.policy
  const files = await resolveTargetFiles(policy.files, process.cwd(), walkCache)
  if (files.length === 0) {
    if (policy.files.required && policy.files.single) {
      const msg =
        policy.missingMessage ?? `${policy.files.single} не існує — створи згідно main.mdc (${ruleId}.${concern.name})`
      reporter.fail(msg)
    }
    return reporter.getExitCode()
  }

  if (policy.check === 'template') {
    return runTemplateSubsetConcern(concern.dir, policy, files, ruleId, concern.name)
  }

  const regoNamespace = `${ruleId.replaceAll('-', '_')}.${concern.name}`
  const templateData = await resolveConcernTemplateData(concern.dir, policy)
  const violations = runConftestBatch({
    policyDirRel: `${ruleId}/${concern.name}`,
    namespace: regoNamespace,
    files,
    templateData
  })
  if (violations.length === 0) {
    reporter.pass(`${concern.name}: ${files.length} файл(ів) OK (rego)`)
  } else {
    for (const v of violations) reporter.fail(v.message)
  }
  return reporter.getExitCode()
}

/**
 * Запускає одне правило: check concerns → policy concerns.
 * @param {import('./discover-checkable-rules.mjs').CheckableRule} rule
 * @param {string} bundledRulesDir абсолютний шлях до `rules/`
 * @param {Map<string, Promise<string[]>>} walkCache
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export async function runRule(rule, bundledRulesDir, walkCache) {
  console.log(`📋 ${rule.id}:`)
  let totalCode = 0

  for (const concern of rule.concerns) {
    if (concern.check) {
      // eslint-disable-next-line no-unsanitized/method
      const mod = await import(join(concern.dir, 'main.mjs'))
      if (typeof mod.main === 'function') {
        const code = await mod.main()
        if (code !== 0) totalCode = 1
      }
    }
    if (concern.policy) {
      const code = await runPolicyConcern(rule.id, concern, walkCache)
      if (code !== 0) totalCode = 1
    }
  }

  return totalCode
}
