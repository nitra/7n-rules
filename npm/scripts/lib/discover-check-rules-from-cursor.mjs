/**
 * Визначає список id правил для `npx \@nitra/cursor fix` без аргументів:
 * зчитує базові імена `*.mdc` у `.cursor/rules/` і залишає лише ті id,
 * для яких у пакеті є programmatic перевірка (JS-концерн або policy з target.json).
 */

/** Префікс керованих правил пакета у `.cursor/rules/`. */
export const MANAGED_RULE_FILE_PREFIX = 'n-'

/**
 * Перетворює базове ім'я `.mdc` у id правила для `check <id>`.
 * @param {string} mdcBasename наприклад `n-bun.mdc` або `my-rule.mdc`
 * @returns {string} id без `.mdc`; для `n-*` — без префікса `n-`
 */
export function mdcBasenameToCheckId(mdcBasename) {
  const base = mdcBasename.includes('/') ? mdcBasename.slice(mdcBasename.lastIndexOf('/') + 1) : mdcBasename
  const withoutExt = base.endsWith('.mdc') ? base.slice(0, -'.mdc'.length) : base
  return withoutExt.startsWith(MANAGED_RULE_FILE_PREFIX)
    ? withoutExt.slice(MANAGED_RULE_FILE_PREFIX.length)
    : withoutExt
}

/**
 * Будує впорядкований список id перевірок за файлами правил на диску.
 * @param {string[]} available id з `discoverCheckableRules` (алфавітний порядок пакета)
 * @param {string[]} mdcBasenames відсортовані імена `*.mdc` з `.cursor/rules/`
 * @returns {string[]} унікальні id у порядку `mdcBasenames`, лише присутні в `available`
 */
export function discoverCheckRulesFromCursorRules(available, mdcBasenames) {
  const seen = new Set()
  const ordered = []
  for (const basename of mdcBasenames) {
    const id = mdcBasenameToCheckId(basename)
    if (available.includes(id) && !seen.has(id)) {
      seen.add(id)
      ordered.push(id)
    }
  }
  return ordered
}
