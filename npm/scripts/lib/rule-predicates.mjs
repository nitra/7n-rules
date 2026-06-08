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
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getRepositoryUrl } from './rule-meta-helpers.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo'])

/**
 * Чи package.json дерева містить будь-який із зазначених пакетів у dependencies.
 * @param {string} root корінь репо
 * @param {string[]} keys імена пакетів
 * @returns {Promise<boolean>} true, якщо знайдено хоч один
 */
async function anyDepInTree(root, keys) {
  const wanted = new Set(keys)
  let found = false
  /** @param {string} dir каталог обходу @returns {Promise<void>} */
  async function walk(dir) {
    if (found) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found) return
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) await walk(abs)
      } else if (entry.isFile() && entry.name === 'package.json') {
        try {
          const deps = JSON.parse(await readFile(abs, 'utf8'))?.dependencies
          if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
            for (const k of wanted) if (Object.hasOwn(deps, k)) found = true
          }
        } catch {
          /* ігноруємо пошкоджені package.json */
        }
      }
    }
  }
  await walk(root)
  return found
}

/**
 * Чи існує вкладений (не кореневий) package.json без `vite` у devDependencies.
 * @param {string} root корінь репо
 * @returns {Promise<boolean>} true, якщо знайдено
 */
async function nestedWithoutVite(root) {
  const rootPkg = join(root, 'package.json')
  let result = false
  /** @param {string} dir каталог @returns {Promise<void>} */
  async function walk(dir) {
    if (result) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (result) return
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry.name)) await walk(abs)
      } else if (entry.isFile() && entry.name === 'package.json' && abs !== rootPkg) {
        try {
          const dev = JSON.parse(await readFile(abs, 'utf8'))?.devDependencies
          const hasVite = dev && typeof dev === 'object' && !Array.isArray(dev) && Object.hasOwn(dev, 'vite')
          if (!hasVite) result = true
        } catch {
          /* пошкоджений package.json не вважаємо vite-проєктом */
        }
      }
    }
  }
  await walk(root)
  return result
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
