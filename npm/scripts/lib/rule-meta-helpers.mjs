/**
 * Чисті хелпери конфігу/репо для автодетекту правил: id-міграції, нормалізація
 * списків, repository URL, monorepo-детект.
 *
 * Винесені з `auto-rules.mjs`, щоб `rule-predicates.mjs` міг використати
 * `getRepositoryUrl` без циклу імпортів. `auto-rules.mjs` пізніше ре-експортує їх звідси.
 */

/**
 * Карта міграції застарілих rule-id у `.n-cursor.json` на актуальні.
 * Застосовується автоматично при читанні конфігу (як для `rules`, так і для `disable-rules`).
 * Приклад: `image` → `image-compress` + `image-avif` (правило розщеплене у 1.8.197).
 */
export const RULE_MIGRATIONS = Object.freeze(
  /** @type {Record<string, readonly string[]>} */ ({
    image: Object.freeze(['image-compress', 'image-avif'])
  })
)

/**
 * Розгортає застарілі rule-id у списку згідно з `RULE_MIGRATIONS`. Зберігає порядок,
 * дедуплікує. Чистий хелпер: не мутує вхід, не логує.
 * @param {string[]} ids нормалізований список id (як з `normalizeIdList`)
 * @returns {string[]} список з legacy-id, заміненими на нові; решта без змін
 */
export function migrateRuleIds(ids) {
  /** @type {string[]} */
  const out = []
  for (const id of ids) {
    const replacement = Object.hasOwn(RULE_MIGRATIONS, id) ? RULE_MIGRATIONS[id] : [id]
    for (const newId of replacement) {
      if (!out.includes(newId)) out.push(newId)
    }
  }
  return out
}

/**
 * Повертає лише ті legacy rule-id зі списку, для яких є запис у `RULE_MIGRATIONS`.
 * Використовується для людинозрозумілого логування міграції при синхронізації CLI.
 * @param {string[]} ids нормалізований список id
 * @returns {string[]} legacy id, які потребуватимуть заміни у `migrateRuleIds`
 */
export function detectLegacyRuleIds(ids) {
  return ids.filter(id => Object.hasOwn(RULE_MIGRATIONS, id))
}

/**
 * Нормалізує список ідентифікаторів (trim + lowercase + унікальність збереженням порядку).
 * @param {unknown} value вихідне значення з `.n-cursor.json`
 * @returns {string[]} масив id у нормалізованому вигляді
 */
export function normalizeIdList(value) {
  if (!Array.isArray(value)) {
    return []
  }
  const out = []
  for (const item of value) {
    const normalized = String(item).trim().toLowerCase()
    if (normalized && !out.includes(normalized)) {
      out.push(normalized)
    }
  }
  return out
}

/**
 * Повертає URL репозиторію з package.json (`repository` може бути рядком або обʼєктом).
 * @param {unknown} repository значення `packageJson.repository`
 * @returns {string | null} URL або null
 */
export function getRepositoryUrl(repository) {
  if (typeof repository === 'string') {
    return repository
  }
  if (repository && typeof repository === 'object' && !Array.isArray(repository)) {
    const url = /** @type {Record<string, unknown>} */ (repository).url
    if (typeof url === 'string') {
      return url
    }
  }
  return null
}

/**
 * Чи package.json виглядає як монорепо (поле `workspaces`).
 * @param {unknown} packageJson кореневий package.json як JS-обʼєкт
 * @returns {boolean} true, якщо оголошено workspaces
 */
export function isMonorepoPackage(packageJson) {
  if (packageJson === null || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    return false
  }
  const workspaces = /** @type {Record<string, unknown>} */ (packageJson).workspaces
  if (Array.isArray(workspaces)) {
    return workspaces.length > 0
  }
  if (workspaces && typeof workspaces === 'object' && !Array.isArray(workspaces)) {
    const packages = /** @type {Record<string, unknown>} */ (workspaces).packages
    return Array.isArray(packages) && packages.length > 0
  }
  return false
}
