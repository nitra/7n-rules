/**
 * Capability Router — резолвер режиму оркестрації (`native` vs `polyfill`)
 * за **явною декларацією моделі** (spec §2.2).
 *
 * Рантайм-детекції моделі в кодобазі немає — тому модель НЕ вгадуємо, а
 * оголошуємо за пріоритетом: CLI `--model` > env `N_CURSOR_FLOW_MODEL` >
 * config `flow.model`. Default-режим (`polyfill`) дозволений ЛИШЕ за наявного
 * `SubagentRunner` (§15.1); інакше — fail (caller кидає помилку), бо polyfill
 * без runner-а не «працює з будь-якою моделлю».
 *
 * Усі функції чисті (без I/O) — джерела (`args`/`env`/`config`/`matrix`/
 * `hasRunner`) передаються ззовні, що робить модуль тривіально тестованим.
 */

export const DEFAULT_ORCHESTRATION = 'polyfill'

/**
 * Витягує значення `--model <value>` з argv. Не мутує вхід.
 * @param {string[]} args аргументи підкоманди flow
 * @returns {string | null} оголошена модель або null
 */
export function parseModelFlag(args) {
  const i = args.indexOf('--model')
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null
}

/**
 * Оголошена модель за пріоритетом CLI > env > config.
 * @param {{ cliModel?: string | null, envModel?: string | null, configModel?: string | null }} sources джерела декларації
 * @returns {string | null} модель або null, якщо ніде не оголошено
 */
export function declaredModel({ cliModel = null, envModel = null, configModel = null } = {}) {
  return cliModel || envModel || configModel || null
}

/**
 * Режим оркестрації для оголошеної моделі за `capability-matrix`.
 * Невідома/неоголошена модель → `matrix.default` → `DEFAULT_ORCHESTRATION`.
 * @param {string | null} model оголошена модель
 * @param {{ models?: Record<string, { orchestration?: string }>, default?: { orchestration?: string } }} matrix матриця можливостей
 * @returns {'native' | 'polyfill'} режим
 */
export function orchestrationFor(model, matrix) {
  const entry = model && matrix && matrix.models ? matrix.models[model] : null
  return (
    (entry && entry.orchestration) ||
    (matrix && matrix.default && matrix.default.orchestration) ||
    DEFAULT_ORCHESTRATION
  )
}

/**
 * Чи стартує polyfill: потрібен доступний `SubagentRunner`.
 * @param {{ hasRunner: boolean }} ctx контекст середовища
 * @returns {boolean} true, якщо runner у наявності
 */
export function polyfillStartable({ hasRunner }) {
  return hasRunner === true
}
