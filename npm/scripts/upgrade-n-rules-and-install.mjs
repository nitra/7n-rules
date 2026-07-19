/**
 * Перед синхронізацією правил CLI підтягує останню опубліковану версію `@7n/rules` з npm registry
 * у кореневий `package.json` і запускає `bun i` у корені проєкту.
 *
 * Якщо залежність уже задана через `workspace:`, `file:`, `link:` тощо, запис у registry не
 * змінюється і `bun i` не викликається — так зберігається робота монорепо та сценаріїв з `workspace:`, `file:` чи `link:`.
 *
 * Міграція перейменування: якщо у package.json ще оголошено legacy-пакет `@nitra/cursor`
 * (а `@7n/rules` немає), запис переноситься на нову назву в тій самій секції.
 *
 * Після встановлення повертається шлях до `node_modules/@7n/rules`, якщо каталог з
 * `package.json` існує; інакше — fallback (корінь пакету поточного процесу CLI, наприклад кеш npx).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PACKAGE_NAME = '@7n/rules'
const LEGACY_PACKAGE_NAME = '@nitra/cursor'
const NPM_LATEST_URL = 'https://registry.npmjs.org/@7n/rules/latest'

// Плагіни екосистеми (@7n/rules-lang-js, -ci-github, …) — їх діапазони sync
// підіймає до ^latest тим самим механізмом, що й ядро: `bun i` сам по собі
// поважає lockfile, і фікси плагінів навіть у межах діапазону не доїжджали б.
const PLUGIN_NAME_RE = /^@7n\/rules-/

const execFileAsync = promisify(execFile)

const WORKSPACE_RE = /^workspace:/i
const FILE_RE = /^file:/i
const LINK_RE = /^link:/i
const PORTAL_RE = /^portal:/i
const GIT_RE = /^git(\+|:\/\/)/i
const NPM_PROTO_RE = /^npm:/i
const HTTP_RE = /^https?:\/\//i

/**
 * Чи не можна безпечно підставити semver з npm замість поточного специфікатора залежності.
 * @param {string} specifier значення з package.json
 * @returns {boolean} true — залишити як є (монорепо, git, tarball тощо)
 */
export function shouldSkipNpmVersionUpgrade(specifier) {
  const s = String(specifier).trim()
  if (!s) {
    return true
  }
  if (WORKSPACE_RE.test(s)) {
    return true
  }
  if (FILE_RE.test(s)) {
    return true
  }
  if (LINK_RE.test(s)) {
    return true
  }
  if (PORTAL_RE.test(s)) {
    return true
  }
  if (GIT_RE.test(s)) {
    return true
  }
  if (NPM_PROTO_RE.test(s)) {
    return true
  }
  if (HTTP_RE.test(s)) {
    return true
  }
  return Boolean(s.startsWith('./') || s.startsWith('../'))
}

/**
 * Остання версія довільного пакета з npm (поле `version` у dist-tag `latest`).
 * @param {string} packageName npm-ім'я пакета
 * @returns {Promise<string>} semver без префікса `^`
 */
async function fetchLatestVersionFromNpm(packageName) {
  const url = packageName === PACKAGE_NAME ? NPM_LATEST_URL : `https://registry.npmjs.org/${packageName}/latest`
  const res = await fetch(url, {
    headers: { accept: 'application/json' }
  })
  if (!res.ok) {
    throw new Error(`npm registry: ${res.status} ${res.statusText} для ${packageName}`)
  }
  const data = await res.json()
  if (!data || typeof data.version !== 'string' || !data.version.trim()) {
    throw new Error(`npm registry: у відповіді для ${packageName} немає поля version`)
  }
  return data.version.trim()
}

/**
 * Остання версія пакета `@7n/rules` з npm.
 * @returns {Promise<string>} semver без префікса `^`
 */
export async function fetchLatestNRulesVersionFromNpm() {
  return await fetchLatestVersionFromNpm(PACKAGE_NAME)
}

/**
 * Підіймає діапазони встановлених плагінів `@7n/rules-*` у package.json до
 * `^latest` з npm (мутує `pkg`). Специфікатори поза npm-semver
 * (`workspace:`, `file:`, git тощо) не чіпає; недоступний registry для
 * окремого плагіна — warning і пропуск (sync не має падати без мережі).
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} pkg розпарсений package.json проєкту
 * @returns {Promise<string[]>} імена плагінів, чиї діапазони змінено
 */
export async function upgradePluginRanges(pkg) {
  /** @type {Array<{ section: 'dependencies' | 'devDependencies', name: string, value: string }>} */
  const candidates = []
  for (const section of /** @type {const} */ (['dependencies', 'devDependencies'])) {
    const deps = pkg[section]
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue
    for (const [name, value] of Object.entries(deps)) {
      if (PLUGIN_NAME_RE.test(name) && typeof value === 'string' && !shouldSkipNpmVersionUpgrade(value)) {
        candidates.push({ section, name, value })
      }
    }
  }
  const changed = []
  const latests = await Promise.allSettled(candidates.map(c => fetchLatestVersionFromNpm(c.name)))
  for (const [i, settled] of latests.entries()) {
    const { section, name, value } = candidates[i]
    if (settled.status === 'rejected') {
      console.warn(`⚠️  ${name}: npm registry недоступний (${settled.reason?.message ?? settled.reason}) — пропускаю\n`)
      continue
    }
    const desired = `^${settled.value}`
    if (value !== desired) {
      pkg[section][name] = desired
      changed.push(name)
      console.log(`⬆️  Оновлено ${name} ${value} → ${desired} у ${section}\n`)
    }
  }
  return changed
}

/**
 * Версія з package.json вказаного кореня пакету (fallback, коли registry недоступний).
 * @param {string} packageRoot корінь пакету поточного процесу CLI
 * @returns {Promise<string | null>} semver або null, якщо файл нечитабельний
 */
async function readPackageVersionSafe(packageRoot) {
  try {
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    return typeof pkg?.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null
  } catch {
    return null
  }
}

/**
 * Шлях до встановленого пакета в `node_modules` або fallback.
 * @param {string} projectRoot корінь репозиторію
 * @param {string} fallbackPackageRoot корінь пакету з поточного процесу (`null` для плагінів — fallback-кореня нема)
 * @param {string} [packageName] npm-ім'я пакета (за замовчуванням ядро `@7n/rules`; плагіни передають своє)
 * @returns {string | null} абсолютний шлях до каталогу з `rules/`, `scripts/` тощо, або `fallbackPackageRoot`
 */
export function resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot, packageName = PACKAGE_NAME) {
  const installed = join(projectRoot, 'node_modules', packageName)
  if (existsSync(join(installed, 'package.json'))) {
    return installed
  }
  return fallbackPackageRoot
}

/**
 * Остання версія ядра з npm; коли registry недоступний (або до першої
 * публікації — 404) — fallback на версію пакету поточного процесу.
 * @param {string} fallbackPackageRoot корінь пакету з поточного процесу CLI
 * @returns {Promise<string>} semver без префікса `^`
 */
async function resolveLatestCoreVersion(fallbackPackageRoot) {
  try {
    return await fetchLatestNRulesVersionFromNpm()
  } catch (error) {
    const bundled = await readPackageVersionSafe(fallbackPackageRoot)
    if (!bundled) {
      throw error
    }
    console.log(`⚠️  npm registry недоступний для ${PACKAGE_NAME} — використовую bundled-версію ${bundled}\n`)
    return bundled
  }
}

/**
 * Запускає `bun i` у вказаному каталозі з виводом у поточний stdio.
 * @param {string} projectRoot cwd для процесу
 * @returns {Promise<void>} завершується після успішного `bun i`
 */
async function runBunInstall(projectRoot) {
  try {
    await execFileAsync('bun', ['i'], { cwd: projectRoot, stdio: 'inherit' })
  } catch (error) {
    const exitCode = typeof error?.code === 'number' ? error.code : null
    if (exitCode !== null && exitCode !== 0) {
      throw new Error(`bun i завершився з кодом ${exitCode}`, { cause: error })
    }
    throw error
  }
}

/**
 * Міграція перейменування: переносить `@nitra/cursor` → `@7n/rules` у тій самій секції
 * package.json (devDependencies або dependencies), якщо нова назва ще не оголошена.
 * @param {Record<string, unknown>} pkg вміст package.json (мутується in-place)
 * @returns {boolean} true, якщо запис перенесено
 */
export function migrateLegacyDependencyName(pkg) {
  let migrated = false
  for (const section of ['devDependencies', 'dependencies']) {
    const deps = pkg[section]
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
      continue
    }
    if (!(LEGACY_PACKAGE_NAME in deps) || typeof deps[LEGACY_PACKAGE_NAME] !== 'string') {
      continue
    }
    if (!(PACKAGE_NAME in deps)) {
      deps[PACKAGE_NAME] = deps[LEGACY_PACKAGE_NAME]
    }
    delete deps[LEGACY_PACKAGE_NAME]
    migrated = true
  }
  return migrated
}

/**
 * Де зараз оголошено `@7n/rules` у package.json.
 * @param {Record<string, unknown>} pkg вміст package.json як об'єкт після читання JSON
 * @returns {{ section: 'devDependencies' | 'dependencies', value: string } | null} секція та специфікатор або null, якщо залежності немає
 */
function findNRulesDependency(pkg) {
  const dev = pkg.devDependencies
  if (dev && typeof dev === 'object' && !Array.isArray(dev) && PACKAGE_NAME in dev) {
    const value = dev[PACKAGE_NAME]
    if (typeof value === 'string') {
      return { section: 'devDependencies', value }
    }
  }
  const deps = pkg.dependencies
  if (deps && typeof deps === 'object' && !Array.isArray(deps) && PACKAGE_NAME in deps) {
    const value = deps[PACKAGE_NAME]
    if (typeof value === 'string') {
      return { section: 'dependencies', value }
    }
  }
  return null
}

/**
 * Оновлює `@7n/rules` до `^<latest>` з npm (якщо дозволено специфікатором), виконує `bun i`,
 * повертає корінь пакету для читання `mdc/` та інших файлів синхронізації.
 * @param {string} projectRoot корінь цільового репозиторію (`cwd()`)
 * @param {string} fallbackPackageRoot корінь пакету з `import.meta.url` (кеш npx або workspace)
 * @returns {Promise<string>} абсолютний шлях до кореня `@7n/rules` для копіювання файлів
 */
export async function upgradeNRulesToLatestAndBunInstall(projectRoot, fallbackPackageRoot) {
  const pkgPath = join(projectRoot, 'package.json')
  if (!existsSync(pkgPath)) {
    return resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot)
  }

  let raw
  try {
    raw = await readFile(pkgPath, 'utf8')
  } catch {
    return resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot)
  }

  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch {
    return resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot)
  }

  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot)
  }

  if (migrateLegacyDependencyName(pkg)) {
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    console.log(`📝 Мігровано ${LEGACY_PACKAGE_NAME} → ${PACKAGE_NAME} у package.json\n`)
  }

  const found = findNRulesDependency(pkg)

  if (found && shouldSkipNpmVersionUpgrade(found.value)) {
    console.log(`⏭️  ${PACKAGE_NAME}: специфікатор «${found.value}» — без оновлення з npm та без bun i\n`)
    return resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot)
  }

  const desired = `^${await resolveLatestCoreVersion(fallbackPackageRoot)}`

  // Діапазони вже оголошених плагінів @7n/rules-* — до ^latest тим самим
  // кроком (мутує pkg; запис на диск — разом із записом по ядру нижче).
  const upgradedPlugins = await upgradePluginRanges(pkg)

  if (!found) {
    if (!pkg.devDependencies || typeof pkg.devDependencies !== 'object' || Array.isArray(pkg.devDependencies)) {
      pkg.devDependencies = {}
    }
    pkg.devDependencies[PACKAGE_NAME] = desired
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    console.log(`📝 Додано ${PACKAGE_NAME}@${desired} у devDependencies (остання з npm)\n`)
    await runBunInstall(projectRoot)
    console.log(`📦 Виконано bun i у корені проєкту\n`)
    return resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot)
  }

  if (found.value === desired && upgradedPlugins.length === 0) {
    console.log(`📌 ${PACKAGE_NAME} уже ${desired} у package.json — виконуємо bun i\n`)
  } else {
    if (found.section === 'devDependencies') {
      pkg.devDependencies[PACKAGE_NAME] = desired
    } else {
      pkg.dependencies[PACKAGE_NAME] = desired
    }
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    if (found.value !== desired) {
      console.log(`📝 Оновлено ${PACKAGE_NAME} → ${desired} у package.json\n`)
    }
  }

  await runBunInstall(projectRoot)
  console.log(`📦 Виконано bun i у корені проєкту\n`)

  return resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot)
}
