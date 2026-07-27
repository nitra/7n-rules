/**
 * Generic consumer слоту `ci.artifact@1` для `@7n/rules-ci-azure` (spec
 * `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.3, Фаза 3).
 *
 * `mergeStrategy: "contains-step"` — Azure Pipelines YAML — на відміну від GitHub-adapter-а
 * (structural deep merge) тут перевіряється лише НАЯВНІСТЬ канонічного lint-кроку десь у дереві
 * (`steps`/`jobs`/`stages` на будь-якій глибині — топологія Azure pipeline вкладена довільно:
 * `stages[].jobs[].steps[]`, `jobs[].steps[]`, голий `steps[]`). Канонічна команда (з
 * `template`) АБО загальний full-lint (`n-rules lint --no-fix --full` /
 * `@7n/rules lint --no-fix --full`, provider-level policy — той самий fallback, що вже є у
 * чинному `lint_pipeline_php.rego`) — обидва варіанти покривають concern; обов'язковий
 * read-only marker `--no-fix` десь у тому самому script-блобі.
 *
 * `template` — YAML з одним полем `script` (canonical command WITHOUT `--no-fix`, напр.
 * `n-rules lint php`); provider сам конструює `n-rules <cmd>`/`@7n/rules <cmd>` варіанти —
 * бінарний prefix є provider-know-how, не частиною descriptor-а (spec §2 рішення Б: лише
 * consumer-adapter матеріалізує contribution).
 *
 * v1 — DIAGNOSTIC-ONLY: `fix: false` у payload (spec §7.3, "у v1 зберігає чинну поведінку
 * fix: false") — модуль НЕ експортує T0 apply-функцію; consumer лише детектує.
 *
 * Default export сумісний з `loadSlotConsumer` (spec §3.3): стабільний `id` + `validate(payload)`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveArtifactTemplatePath, validateCiArtifactPayload } from '@7n/rules/plugin-api'

/** Provider-level fallback: загальний full-lint покриває будь-який домен (спека §7.3, як у lint_pipeline_php.rego). */
const FULL_LINT_MARKERS = ['n-rules lint --no-fix --full', '@7n/rules lint --no-fix --full']
const NO_FIX_MARKER = '--no-fix'

/**
 * Збирає всі `script:`-текстові поля Azure pipeline на будь-якій глибині (`steps`/`jobs`/`stages`
 * вкладені довільно — обходимо ВЕСЬ document tree, а не лише відомі ключі, той самий підхід, що
 * `lint_pipeline_php.rego`'s `walk(input, [_, node])`).
 * @param {unknown} node поточний вузол дерева
 * @param {string[]} out акумулятор script-текстів (мутується)
 * @returns {void}
 */
function collectScripts(node, out) {
  if (Array.isArray(node)) {
    for (const el of node) collectScripts(el, out)
    return
  }
  if (node === null || typeof node !== 'object') return
  if (typeof node.script === 'string') out.push(node.script)
  for (const v of Object.values(node)) collectScripts(v, out)
}

/**
 * Провайдер-варіанти canonical-команди (`n-rules <cmd>` / `@7n/rules <cmd>`) — ім'я бінарника
 * лишається provider-know-how, не частиною descriptor-а.
 * @param {string} command суфікс команди з template (`script`-поле, без `--no-fix`)
 * @returns {string[]} варіанти маркера
 */
function commandVariants(command) {
  return [`n-rules ${command}`, `@7n/rules ${command}`]
}

/**
 * Читає й парсить canonical template (YAML `{ script: "<domain command>" }`) contribution-у за
 * безпечним шляхом.
 * @param {{ packageRoot: string, resourcePath: string | null }} contribution provenance
 * @param {import('@7n/rules/plugin-api').CiArtifactDescriptor} descriptor валідований payload
 * @returns {Promise<{ ok: true, command: string } | { ok: false, reason: string }>} результат
 */
export async function loadCanonicalCommand(contribution, descriptor) {
  const resolved = resolveArtifactTemplatePath(contribution, descriptor)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  if (!resolved.exists) return { ok: false, reason: `template не знайдено (${resolved.absPath})` }
  const { parse } = await import('yaml')
  const parsed = parse(readFileSync(resolved.absPath, 'utf8'))
  if (!parsed || typeof parsed.script !== 'string' || parsed.script === '') {
    return { ok: false, reason: `template "${resolved.absPath}" має мати непорожнє поле "script"` }
  }
  return { ok: true, command: parsed.script }
}

/**
 * Діагностує один `ci.artifact@1` artifact (mergeStrategy `contains-step`) проти поточного
 * стану `targetPath` (`patch-existing`-семантика: файл, якого немає, — no-op, spec §7.1 —
 * pipeline-файл належить іншому, окремому концерну azure-pipelines, не цьому generic-у).
 * @param {{ cwd: string, targetPath: string, command: string }} args вхід
 * @returns {{ applicable: boolean, violations: string[] }} `applicable: false` — файл відсутній, generic concern мовчки пропускає
 */
export async function diagnoseArtifact({ cwd, targetPath, command }) {
  const absTarget = join(cwd, targetPath)
  if (!existsSync(absTarget)) return { applicable: false, violations: [] }
  const { parse } = await import('yaml')
  let doc
  try {
    doc = parse(readFileSync(absTarget, 'utf8'))
  } catch {
    return { applicable: true, violations: [`${targetPath}: не парситься як YAML`] }
  }
  const scripts = []
  collectScripts(doc, scripts)
  const blob = scripts.join('\n')

  const domainMarkers = commandVariants(command)
  const hasLintStep = [...domainMarkers, ...FULL_LINT_MARKERS].some(m => blob.includes(m))
  if (!hasLintStep) {
    return {
      applicable: true,
      violations: [`${targetPath}: має бути script-крок з "${command}" або full-lint (--no-fix --full)`]
    }
  }
  if (!blob.includes(NO_FIX_MARKER)) {
    return { applicable: true, violations: [`${targetPath}: lint-крок має запускатись з "${NO_FIX_MARKER}"`] }
  }
  return { applicable: true, violations: [] }
}

/** `loadSlotConsumer`-сумісний default export (spec §3.3): стабільний `id` + `validate(payload)`. */
export default {
  id: 'ci-azure-artifact',
  /**
   * @param {unknown} payload сирий (розпарсений) `ci.artifact@1` payload
   * @returns {boolean} true — валідний payload; v1 додатково вимагає `mergeStrategy: "contains-step"` та `fix: false` (diagnostic-only, spec §7.3)
   */
  validate(payload) {
    const result = validateCiArtifactPayload(payload)
    if (!result.ok) return false
    return result.descriptor.mergeStrategy === 'contains-step' && result.descriptor.fix === false
  }
}
