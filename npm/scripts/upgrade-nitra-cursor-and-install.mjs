/**
 * Перед синхронізацією правил CLI підтягує останню опубліковану версію `@nitra/cursor` з npm registry
 * у кореневий `package.json` і запускає `bun i` у корені проєкту.
 *
 * Якщо залежність уже задана через `workspace:`, `file:`, `link:` тощо, запис у registry не
 * змінюється і `bun i` не викликається — так зберігається робота монорепо та сценаріїв з `workspace:`, `file:` чи `link:`.
 *
 * Після встановлення повертається шлях до `node_modules/@nitra/cursor`, якщо каталог з
 * `package.json` існує; інакше — fallback (корінь пакету поточного процесу CLI, наприклад кеш npx).
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PACKAGE_NAME = '@nitra/cursor'
const NPM_LATEST_URL = 'https://registry.npmjs.org/@nitra/cursor/latest'

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
  if (s.startsWith('./') || s.startsWith('../')) {
    return true
  }
  return false
}

/**
 * Остання версія пакета з npm (поле `version` у JSON dist-tag `latest`).
 * @returns {Promise<string>} semver без префікса `^`
 */
export async function fetchLatestNitraCursorVersionFromNpm() {
  const res = await fetch(NPM_LATEST_URL, {
    headers: { accept: 'application/json' }
  })
  if (!res.ok) {
    throw new Error(`npm registry: ${res.status} ${res.statusText} для ${PACKAGE_NAME}`)
  }
  const data = await res.json()
  if (!data || typeof data.version !== 'string' || !data.version.trim()) {
    throw new Error(`npm registry: у відповіді для ${PACKAGE_NAME} немає поля version`)
  }
  return data.version.trim()
}

/**
 * Шлях до встановленого пакета в `node_modules` або fallback.
 * @param {string} projectRoot корінь репозиторію
 * @param {string} fallbackPackageRoot корінь пакету з поточного процесу
 * @returns {string} абсолютний шлях до каталогу з `mdc/`, `scripts/` тощо
 */
export function resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot) {
  const installed = join(projectRoot, 'node_modules', PACKAGE_NAME)
  if (existsSync(join(installed, 'package.json'))) {
    return installed
  }
  return fallbackPackageRoot
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
 * Де зараз оголошено `@nitra/cursor` у package.json.
 * @param {Record<string, unknown>} pkg вміст package.json як об'єкт після читання JSON
 * @returns {{ section: 'devDependencies' | 'dependencies', value: string } | null} секція та специфікатор або null, якщо залежності немає
 */
function findNitraCursorDependency(pkg) {
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
 * Оновлює `@nitra/cursor` до `^<latest>` з npm (якщо дозволено специфікатором), виконує `bun i`,
 * повертає корінь пакету для читання `mdc/` та інших файлів синхронізації.
 * @param {string} projectRoot корінь цільового репозиторію (`cwd()`)
 * @param {string} fallbackPackageRoot корінь пакету з `import.meta.url` (кеш npx або workspace)
 * @returns {Promise<string>} абсолютний шлях до кореня `@nitra/cursor` для копіювання файлів
 */
export async function upgradeNitraCursorToLatestAndBunInstall(projectRoot, fallbackPackageRoot) {
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

  const found = findNitraCursorDependency(pkg)

  if (found && shouldSkipNpmVersionUpgrade(found.value)) {
    console.log(`⏭️  ${PACKAGE_NAME}: специфікатор «${found.value}» — без оновлення з npm та без bun i\n`)
    return resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot)
  }

  const latest = await fetchLatestNitraCursorVersionFromNpm()
  const desired = `^${latest}`

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

  if (found.value === desired) {
    console.log(`📌 ${PACKAGE_NAME} уже ${desired} у package.json — виконуємо bun i\n`)
  } else {
    if (found.section === 'devDependencies') {
      pkg.devDependencies[PACKAGE_NAME] = desired
    } else {
      pkg.dependencies[PACKAGE_NAME] = desired
    }
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    console.log(`📝 Оновлено ${PACKAGE_NAME} → ${desired} у package.json\n`)
  }

  await runBunInstall(projectRoot)
  console.log(`📦 Виконано bun i у корені проєкту\n`)

  return resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot)
}
