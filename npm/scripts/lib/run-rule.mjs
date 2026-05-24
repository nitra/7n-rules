/**
 * Оркестратор одного правила під CLI `fix`.
 *
 * Послідовність (concerns у межах правила — алфавітно):
 *   1. **applies-гейт** з `js/applies.mjs`. Якщо модуль експортує `applies()` і вона повертає
 *      false — друкуємо `✅ правило не застосовне` і завершуємо без подальших викликів.
 *   2. **JS-концерни** — кожен файл `js/<concern>.mjs`. Concern `applies` теж може мати
 *      `check()` для друку контексту (його `applies()` уже відпрацював на кроці 1, він не повторюється).
 *   3. **Policy-концерни** — кожен `policy/<concern>/target.json` через `runConftestBatch`.
 *      Резолвер `resolveTargetFiles` ділить cache (`walkCache`) між концернами.
 *
 * Кожен concern має власний `createCheckReporter` — їхні exit-коди OR-яться в один на рівні правила.
 * Це дає той самий 0/1 контракт, що й попередня модель «один check.mjs на правило».
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { findMissingMdcRefs } from './check-mdc-template-refs.mjs'
import { createCheckReporter } from './check-reporter.mjs'
import { resolveTargetFiles } from './resolve-target-files.mjs'
import { runConftestBatch } from './run-conftest-batch.mjs'
import { resolveConcernTemplateData } from './template.mjs'

const APPLIES_CONCERN_NAME = 'applies'

/**
 * Обчислює абсолютний шлях до файла-концерну: `rules/<id>/js/<concern>.mjs`.
 * Flat-convention з 1.14.0 — концерн = файл, не каталог.
 * @param {string} bundledRulesDir абсолютний `rules/`
 * @param {string} ruleId id правила
 * @param {import('./discover-checkable-rules.mjs').JsConcern} concern опис концерну
 * @returns {string} абсолютний шлях
 */
function resolveJsCheckPath(bundledRulesDir, ruleId, concern) {
  return join(bundledRulesDir, ruleId, 'js', `${concern.name}.mjs`)
}

/**
 * Спробувати викликати applies() гейт з `js/applies.mjs` правила.
 * Гейт активний лише за наявності концерну з імʼям `applies` і експортом-функцією `applies`.
 * @param {string} bundledRulesDir абсолютний `rules/`
 * @param {import('./discover-checkable-rules.mjs').CheckableRule} rule опис правила
 * @returns {Promise<boolean>} `true` — правило застосовне (або гейту немає); `false` — пропустити
 */
async function evaluateAppliesGate(bundledRulesDir, rule) {
  const concern = rule.jsConcerns.find(c => c.name === APPLIES_CONCERN_NAME)
  if (!concern) return true
  const path = resolveJsCheckPath(bundledRulesDir, rule.id, concern)
  // eslint-disable-next-line no-unsanitized/method -- path з discovered concern, файл з whitelist'у readdir
  const mod = await import(path)
  if (typeof mod.applies !== 'function') return true
  return Boolean(await mod.applies())
}

/**
 * Запускає одну policy-полісі через `runConftestBatch`. Створює локальний репортер,
 * читає `target.json`, резолвить файли, фіксує fail/pass — і повертає exit-код.
 * @param {string} bundledRulesDir абсолютний `rules/`
 * @param {string} ruleId id правила
 * @param {string} concernName імʼя полісі (= підкаталог у `policy/`)
 * @param {Map<string, Promise<string[]>>} walkCache shared cache між концернами одного check-прогону
 * @returns {Promise<number>} 0 — OK, 1 — є порушення
 */
async function runPolicyConcern(bundledRulesDir, ruleId, concernName, walkCache) {
  const reporter = createCheckReporter()
  const targetPath = join(bundledRulesDir, ruleId, 'policy', concernName, 'target.json')
  /** @type {{ files: { single?: string, walkGlob?: string|string[], required?: boolean }, missingMessage?: string }} */
  const target = JSON.parse(await readFile(targetPath, 'utf8'))
  const files = await resolveTargetFiles(target.files, process.cwd(), walkCache)
  if (files.length === 0) {
    if (target.files.required && target.files.single) {
      const msg =
        target.missingMessage ??
        `${target.files.single} не існує — створи згідно ${ruleId}.mdc (${ruleId}.${concernName})`
      reporter.fail(msg)
    }
    return reporter.getExitCode()
  }
  // Rego не дозволяє '-' в імені пакета, тому kebab-id у `.n-cursor.json:rules`
  // мапиться на snake у namespace. Файлова структура `rules/<id>/policy/` лишається kebab.
  const regoNamespace = `${ruleId.replaceAll('-', '_')}.${concernName}`
  const concernAbsDir = join(bundledRulesDir, ruleId, 'policy', concernName)
  const templateData = await resolveConcernTemplateData(concernAbsDir, target)
  const violations = runConftestBatch({
    policyDirRel: `${ruleId}/${concernName}`,
    namespace: regoNamespace,
    files,
    templateData
  })
  if (violations.length === 0) {
    reporter.pass(`${concernName}: ${files.length} файл(ів) OK (rego)`)
  } else {
    for (const v of violations) reporter.fail(v.message)
  }
  return reporter.getExitCode()
}

/**
 * Запускає одне правило: applies-гейт → JS-концерни → policy-концерни.
 * @param {import('./discover-checkable-rules.mjs').CheckableRule} rule опис правила з discovery
 * @param {string} bundledRulesDir абсолютний шлях до `rules/`
 * @param {Map<string, Promise<string[]>>} walkCache shared cache (один на check-прогон)
 * @returns {Promise<number>} 0 — OK, 1 — є порушення в одному чи більше концернів
 */
export async function runRule(rule, bundledRulesDir, walkCache) {
  console.log(`📋 ${rule.id}:`)

  if (!(await evaluateAppliesGate(bundledRulesDir, rule))) {
    console.log(`  ✅ Правило ${rule.id} не застосовне до цього репо — пропущено`)
    return 0
  }

  let totalCode = 0

  for (const concern of rule.jsConcerns) {
    const path = resolveJsCheckPath(bundledRulesDir, rule.id, concern)
    // eslint-disable-next-line no-unsanitized/method -- path з discovered concern, файл з whitelist'у readdir
    const mod = await import(path)
    if (typeof mod.check === 'function') {
      const code = await mod.check()
      if (code !== 0) totalCode = 1
    }
  }

  for (const policyConcern of rule.policyConcerns) {
    const code = await runPolicyConcern(bundledRulesDir, rule.id, policyConcern.name, walkCache)
    if (code !== 0) totalCode = 1
  }

  const ruleDir = join(bundledRulesDir, rule.id)
  const missing = await findMissingMdcRefs(ruleDir, rule.id)
  if (missing.length > 0) {
    const reporter = createCheckReporter()
    for (const rel of missing) {
      reporter.fail(`${rule.id}.mdc: відсутнє markdown-посилання на template-файл ${rel}`)
    }
    if (reporter.getExitCode() !== 0) totalCode = 1
  }

  return totalCode
}
