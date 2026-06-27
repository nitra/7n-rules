/**
 * Реєстр незводимих до даних предикатів автодетекту правил.
 *
 * Прості умови (наявність файлів) живуть як `glob` у `meta.json`; ці предикати —
 * для умов, що вимагають парсингу залежностей, сканування вмісту source чи URL repo.
 * Декларація «який предикат + аргумент» — у `meta.json.auto.predicate`; тут — реалізація.
 *
 * Сигнатури неоднорідні (одні беруть `facts`, інші — `cwd`/`packageJson`), бо предикати
 * читають різні джерела; виклик диспетчиться в `auto-rules.mjs` за іменем предиката.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { findAllPackageJsonPaths } from '../utils/find-package-json-paths.mjs'
import { getRepositoryUrl } from './rule-meta-helpers.mjs'

/**
 * Чи package.json дерева містить будь-який із зазначених пакетів у dependencies.
 * Обхід — через `findAllPackageJsonPaths` (на `walkDir`/`globby`), тож **поважає `.gitignore`**
 * і не зчитує package.json з ігнорованих каталогів (build-артефакти, vendored-копії).
 * @param {string} root корінь репо
 * @param {string[]} keys імена пакетів
 * @returns {Promise<boolean>} true, якщо знайдено хоч один
 */
async function anyDepInTree(root, keys) {
  const wanted = new Set(keys)
  for (const abs of await findAllPackageJsonPaths(root, [])) {
    try {
      const deps = JSON.parse(await readFile(abs, 'utf8'))?.dependencies
      if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
        for (const k of wanted) if (Object.hasOwn(deps, k)) return true
      }
    } catch {
      /* ігноруємо пошкоджені package.json */
    }
  }
  return false
}

/**
 * Чи існує вкладений (не кореневий) package.json без `vite` у devDependencies.
 * Обхід — `findAllPackageJsonPaths` (gitignore-aware), як у `anyDepInTree`.
 * @param {string} root корінь репо
 * @returns {Promise<boolean>} true, якщо знайдено
 */
async function nestedWithoutVite(root) {
  const rootPkg = join(root, 'package.json')
  for (const abs of await findAllPackageJsonPaths(root, [])) {
    if (abs === rootPkg) continue
    try {
      const dev = JSON.parse(await readFile(abs, 'utf8'))?.devDependencies
      const hasVite = dev && typeof dev === 'object' && !Array.isArray(dev) && Object.hasOwn(dev, 'vite')
      if (!hasVite) return true
    } catch {
      /* пошкоджений package.json не вважаємо vite-проєктом */
    }
  }
  return false
}

/** Реєстр предикатів: імʼя → реалізація. Виклик за `meta.json.auto.predicate`. */
export const RULE_PREDICATES = {
  /**
   * @param {unknown} packageJson кореневий package.json
   * @param {string} arg підрядок-маркер URL
   * @returns {boolean} true, якщо repository.url містить маркер
   */
  repoUrlMarker(packageJson, arg) {
    const url = getRepositoryUrl(
      packageJson && typeof packageJson === 'object' && !Array.isArray(packageJson)
        ? /** @type {Record<string, unknown>} */ (packageJson).repository
        : null
    )
    return typeof url === 'string' && url.toLowerCase().includes(String(arg).toLowerCase())
  },
  /**
   * @param {string} cwd корінь репо
   * @param {string[]} arg імена пакетів
   * @returns {Promise<boolean>} true, якщо будь-який пакет у dependencies дерева
   */
  depInAnyPackageJson(cwd, arg) {
    return anyDepInTree(cwd, Array.isArray(arg) ? arg : [])
  },
  /**
   * @param {{ hasGqlTaggedTemplates: boolean }} facts факти
   * @returns {boolean} true, якщо є gql-літерал
   */
  gqlTaggedTemplate(facts) {
    return facts.hasGqlTaggedTemplates === true
  },
  /**
   * @param {{ hasHasuraConfig: boolean }} facts факти
   * @returns {boolean} true, якщо config.yaml із маркером
   */
  hasuraConfigMarker(facts) {
    return facts.hasHasuraConfig === true
  },
  /**
   * @param {string} cwd корінь репо
   * @param {{ hasBunSqlImport: boolean }} facts факти
   * @returns {Promise<boolean>} true, якщо deps pg/pg-format/mysql2 або import sql з bun
   */
  jsBunDbSignal(cwd, facts) {
    if (facts.hasBunSqlImport === true) return true
    return anyDepInTree(cwd, ['pg', 'pg-format', 'mysql2'])
  },
  /**
   * @param {string} cwd корінь репо
   * @returns {Promise<boolean>} true, якщо вкладений package.json без vite
   */
  nestedPackageWithoutVite(cwd) {
    return nestedWithoutVite(cwd)
  }
}
