/** @see ./docs/tooling.md */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Шлях до канонічного oxlint JSON у цьому пакеті (для перевірки та тестів). */
export const OXLINT_CANONICAL_JSON_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data',
  'tooling',
  'oxlint-canonical.json'
)

/** Шлях до канонічного knip JSON у цьому пакеті — копіюється у корінь проєкту-споживача, якщо відсутній. */
export const KNIP_CANONICAL_JSON_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data',
  'tooling',
  'knip-canonical.json'
)

/** `.oxlintrc.json` відсутній — T0 копіює канон (`fix-check.mjs`). */
export const OXLINTRC_MISSING = 'oxlintrc-missing'
/**
 * `knip.json` відсутній — T0 копіює канон (`fix-check.mjs`, патерн `js-check-knip`).
 *
 * До 2026-08-01 порушення НЕ існувало: `checkKnipConfig` детектора сам робив
 * `copyFile` під час фази detect і звітував `pass`, тобто стан «knip.json
 * немає» був принципово неспостережуваний, а `lint --no-fix` мутував дерево
 * (спека `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, рішення Ґ).
 * Тепер це звичайний T0-фіксований reason, як `oxlintrc-missing` поруч.
 */
export const KNIP_MISSING = 'knip-missing'
/** `.oxlintrc.json` існує, але розходиться з каноном — T0 доводить до відповідності детермінованим merge. */
export const OXLINTRC_DRIFT = 'oxlintrc-drift'

// Канонічний рядок `lint-js`-скрипта і мінімальна версія `@nitra/eslint-config` —
// у rego (`npm/policy/js_lint/package_json/`). JS-копії (`CANONICAL_LINT_JS`,
// `isCanonicalLintJs`, `nitraEslintConfigMeetsMinVersion`) видалено, щоб не
// було двох джерел істини й ризику дрифту.

/**
 * Рекурсивне порівняння фрагментів канону oxlint (масиви — порядок як у каноні; об'єкти — той самий набір ключів і вкладеність).
 * @param {unknown} actual значення з `.oxlintrc.json`
 * @param {unknown} expected значення з канону
 * @returns {boolean} true, якщо значення збігаються за правилами канону
 */
function deepEqualOxlintCanonical(actual, expected) {
  if (expected === null || typeof expected !== 'object') {
    return actual === expected
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
  }
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
    return false
  }
  const exp = /** @type {Record<string, unknown>} */ (expected)
  const act = /** @type {Record<string, unknown>} */ (actual)
  const expKeys = Object.keys(exp)
  const actKeys = Object.keys(act)
  if (expKeys.length !== actKeys.length) {
    return false
  }
  for (const k of expKeys) {
    if (!(k in act) || !deepEqualOxlintCanonical(act[k], exp[k])) {
      return false
    }
  }
  return true
}

/**
 * Безпечний доступ як до plain-object запису.
 * @param {unknown} v будь-яке значення
 * @returns {Record<string, unknown>} запис або пустий обʼєкт, якщо `v` не plain-object
 */
function asRecordOrEmpty(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {}
}

/**
 * Звіряє блок `rules`: кожне правило з канону має точне збіжне значення в actual.
 * @param {unknown} expected канонічне значення для `rules`
 * @param {unknown} actual поточне значення для `rules`
 * @param {string[]} failures буфер для помилок
 */
function compareOxlintRules(expected, actual, failures) {
  const er = asRecordOrEmpty(expected)
  const ar = asRecordOrEmpty(actual)
  for (const [ruleKey, expectedValue] of Object.entries(er)) {
    if (!deepEqualOxlintCanonical(ar[ruleKey], expectedValue)) {
      failures.push(
        `.oxlintrc.json: rules["${ruleKey}"] очікується ${JSON.stringify(expectedValue)}, зараз ${JSON.stringify(ar[ruleKey])}`
      )
    }
  }
}

/**
 * Звіряє блок `ignorePatterns`: кожен патерн із канону має бути присутній в actual; додаткові локальні
 * патерни дозволені (канон задає мінімум, проєкт може розширити).
 * @param {unknown} expected канонічний масив `ignorePatterns`
 * @param {unknown} actual поточний `ignorePatterns` із `.oxlintrc.json`
 * @param {string[]} failures буфер для помилок
 */
function compareOxlintIgnorePatterns(expected, actual, failures) {
  if (!Array.isArray(expected)) {
    return
  }
  if (!Array.isArray(actual)) {
    failures.push(
      '.oxlintrc.json: поле "ignorePatterns" має бути масивом (канон задає мінімум, додаткові патерни дозволені)'
    )
    return
  }
  const set = new Set(actual)
  const missing = expected.filter(p => !set.has(p))
  if (missing.length > 0) {
    failures.push(
      `.oxlintrc.json: ignorePatterns має містити канонічні патерни — додай: ${missing.map(p => JSON.stringify(p)).join(', ')}`
    )
  }
}

/**
 * Звіряє блок `jsPlugins`: кожен plugin із канону має бути присутній в actual;
 * додаткові project-specific plugins дозволені для локальних wrapper-ів.
 * @param {unknown} expected канонічний масив `jsPlugins`
 * @param {unknown} actual поточний `jsPlugins` із `.oxlintrc.json`
 * @param {string[]} failures буфер для помилок
 */
function compareOxlintJsPlugins(expected, actual, failures) {
  if (!Array.isArray(expected)) return
  if (!Array.isArray(actual)) {
    failures.push(
      '.oxlintrc.json: поле "jsPlugins" має бути масивом (канон задає мінімум, локальні wrapper-и дозволені)'
    )
    return
  }
  const missing = expected.filter(plugin => actual.every(entry => !deepEqualOxlintCanonical(entry, plugin)))
  if (missing.length > 0) {
    failures.push(
      `.oxlintrc.json: jsPlugins має містити канонічні plugins — додай: ${missing.map(plugin => JSON.stringify(plugin)).join(', ')}`
    )
  }
}

/**
 * Перевіряє `.oxlintrc.json` проти канону пакета `@7n/rules` (усі правила з канону та інші поля з `oxlint-canonical.json`).
 * Додаткові ключі лише в `rules` дозволені; інші поля мають збігатися з каноном.
 * @param {unknown} cfg корінь JSON з `.oxlintrc.json`
 * @param {unknown} canonical розпарений `oxlint-canonical.json`
 * @returns {{ ok: boolean, failures: string[] }} статус і повідомлення для `fail`
 */
export function verifyOxlintRcAgainstCanonical(cfg, canonical) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { ok: false, failures: ['.oxlintrc.json: корінь має бути значенням типу object'] }
  }
  if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
    return { ok: false, failures: ['внутрішня помилка: канон oxlint має бути object'] }
  }
  const failures = []
  const o = /** @type {Record<string, unknown>} */ (cfg)
  const c = /** @type {Record<string, unknown>} */ (canonical)

  for (const [key, expected] of Object.entries(c)) {
    const actual = o[key]

    if (key === 'rules') {
      compareOxlintRules(expected, actual, failures)
      continue
    }

    if (key === 'ignorePatterns') {
      compareOxlintIgnorePatterns(expected, actual, failures)
      continue
    }

    if (key === 'jsPlugins') {
      compareOxlintJsPlugins(expected, actual, failures)
      continue
    }

    if (!deepEqualOxlintCanonical(actual, expected)) {
      failures.push(
        `.oxlintrc.json: поле "${key}" має збігатися з каноном пакета @7n/rules (npm/rules/js/tooling/data/tooling/oxlint-canonical.json)`
      )
    }
  }

  return { ok: failures.length === 0, failures }
}

/**
 * Детермінований merge `.oxlintrc.json` до відповідності канону (T0 `fix-check.mjs`) —
 * дзеркалить правила `verifyOxlintRcAgainstCanonical`, тож результат завжди проходить
 * повторну перевірку без LLM. Project-specific розширення зберігаються: зайві ключі в
 * `rules` і зайві `ignorePatterns` не видаляються, лише доповнюються канонічними.
 * @param {unknown} actual поточний вміст `.oxlintrc.json` (`null`/будь-що не-object — трактується як відсутній файл)
 * @param {Record<string, unknown>} canonical розпарсений `oxlint-canonical.json`
 * @returns {Record<string, unknown>} злитий обʼєкт, готовий до запису у `.oxlintrc.json`
 */
export function planOxlintrcFix(actual, canonical) {
  const merged = { ...asRecordOrEmpty(actual) }
  for (const [key, expected] of Object.entries(canonical)) {
    if (key === 'rules') {
      merged.rules = { ...asRecordOrEmpty(merged.rules), ...asRecordOrEmpty(expected) }
      continue
    }
    if (key === 'ignorePatterns') {
      const existing = Array.isArray(merged.ignorePatterns) ? merged.ignorePatterns : []
      const canonPatterns = Array.isArray(expected) ? expected : []
      merged.ignorePatterns = [...existing, ...canonPatterns.filter(p => !existing.includes(p))]
      continue
    }
    if (key === 'jsPlugins') {
      const existing = Array.isArray(merged.jsPlugins) ? merged.jsPlugins : []
      const canonicalPlugins = Array.isArray(expected) ? expected : []
      merged.jsPlugins = [
        ...existing,
        ...canonicalPlugins.filter(plugin => existing.every(entry => !deepEqualOxlintCanonical(entry, plugin)))
      ]
      continue
    }
    // Інші поля вимагають точного збігу з каноном (verifyOxlintRcAgainstCanonical) —
    // єдине валідне значення й так канонічне, тож перезапис безпечний.
    merged[key] = expected
  }
  return merged
}
