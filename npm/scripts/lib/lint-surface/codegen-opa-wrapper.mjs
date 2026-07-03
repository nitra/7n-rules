/**
 * Хелпери для policy-concern detector-а (spec 2026-06-29 §Policy Codegen, ревізовано —
 * див. ADR про пряму оцінку policy-concern-ів без generated `main.mjs`).
 *
 * `main.mjs` для чисто policy-concern-ів (rego/template) більше не потрібен: `detect.mjs`
 * викликає `evaluatePolicyConcern` напряму з `concern.json`. Ручний (не-`@generated`)
 * `main.mjs` лишається escape-hatch-ом для custom-detector-ів — `isGeneratedFile` дозволяє
 * відрізнити старий codegen-артефакт від ручного файлу.
 */
const GENERATED_MARK = '// @generated — do not edit'

/**
 * @param {string} content вміст main.mjs.
 * @returns {boolean} чи це (застарілий) згенерований, а не ручний файл.
 */
export function isGeneratedFile(content) {
  return content.startsWith(GENERATED_MARK)
}

/**
 * Чи policy.files резолвиться у конкретні таргети (single або walkGlob).
 * Концерни без цього — або orchestrated parent-концерном (rego-бібліотека), або
 * incomplete; напряму (без parent-оркестратора) оцінити такий concern не можна.
 * @param {object|undefined} files об'єкт policy.files concern-а.
 * @returns {boolean} true, якщо files резолвиться у конкретні таргети.
 */
export function hasResolvableFiles(files) {
  if (!files || typeof files !== 'object') return false
  return typeof files.single === 'string' || files.walkGlob !== undefined
}
