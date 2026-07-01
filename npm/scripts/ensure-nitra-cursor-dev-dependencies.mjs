/**
 * Дописує `\@nitra/cursor` у `devDependencies` workspace-root `package.json` проєкту, якщо пакет ще
 * не оголошено ні в `devDependencies`, ні в `dependencies`.
 *
 * Використовується CLI `n-cursor` при кожному запуску (`npx \@nitra/cursor`, зокрема `check`), щоб
 * команда `check` і скрипти з `node_modules/\@nitra/cursor/scripts/` були відтворювані після
 * `bun install` / `npm install`, а не лише з кешу npx. Корінь визначається тільки за наявністю поля
 * `workspaces` у `package.json` поруч із поточною директорією запуску.
 *
 * Версія діапазону: `^<version>` з поля `version` установленого пакету `\@nitra/cursor`.
 *
 * Self-upgrade: якщо пакет уже присутній у `devDependencies` зі **старішим** числовим піном,
 * пін апгрейдиться до `^<version>` (щоб `npx \@nitra/cursor` завжди підтягував devDep до версії CLI,
 * а self-lint не відставав). Нижчі за bundled або нечислові піни (`workspace:*`, `latest`, git-url)
 * не чіпаються; запис у `dependencies` (нестандартне розміщення) теж лишається незмінним.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = '@nitra/cursor'

// Числовий semver-діапазон: опційний (оператор + його пробіли) одним блоком + major[.minor[.patch]].
// Пробіли після оператора всередині опційної групи (не окремим `\s*`), щоб прибрати неоднозначне
// подвійне `\s*` і backtracking (super-linear-regex). Семантика збігу — та сама.
const NUMERIC_RANGE_RE = /^\s*(?:(?:\^|~|>=|<=|>|<|=|v)\s*)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/u

/**
 * Розбирає npm-діапазон на числові компоненти `[major, minor, patch]`.
 * @param {unknown} range значення піна з `package.json` (напр. `"^12.19.0"`)
 * @returns {[number, number, number] | null} компоненти версії або `null` для нечислового специфікатора
 */
function parseVersionParts(range) {
  if (typeof range !== 'string') {
    return null
  }
  const m = NUMERIC_RANGE_RE.exec(range)
  if (!m) {
    return null
  }
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

/**
 * Чи bundled-версія строго новіша за поточний пін (для рішення про self-upgrade).
 * @param {string} bundled версія встановленого пакета (напр. `"13.2.6"`)
 * @param {unknown} current поточний діапазон із `package.json`
 * @returns {boolean} `true`, якщо bundled новіша і обидва піни числові; інакше `false`
 */
function isBundledNewer(bundled, current) {
  const b = parseVersionParts(bundled)
  const c = parseVersionParts(current)
  if (!b || !c) {
    return false
  }
  for (let i = 0; i < 3; i++) {
    if (b[i] > c[i]) {
      return true
    }
    if (b[i] < c[i]) {
      return false
    }
  }
  return false
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const bundledPkgPath = join(scriptDir, '..', 'package.json')

/**
 * Версія з `package.json` пакету `\@nitra/cursor` (каталог на рівень вище за `scripts/`).
 * @returns {Promise<string | null>} поле `version` рядком або `null`, якщо файлу немає / помилка парсингу
 */
export async function readBundledPackageVersion() {
  if (!existsSync(bundledPkgPath)) {
    return null
  }
  try {
    const raw = await readFile(bundledPkgPath, 'utf8')
    const pkg = JSON.parse(raw)
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * Читає JSON-обʼєкт із диска.
 * @param {string} path шлях до JSON-файлу
 * @returns {Promise<Record<string, unknown> | null>} обʼєкт або `null`, якщо файл нечитабельний
 */
async function readJsonObject(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Читає `package.json` поруч зі стартовою директорією, якщо це workspace-root.
 * @param {string} startDir директорія, з якої запущено CLI
 * @returns {Promise<{ path: string, pkg: Record<string, unknown> } | null>} workspace-root package або `null`
 */
async function readAdjacentWorkspaceRootPackageJson(startDir) {
  const pkgPath = join(startDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return null
  }

  const pkg = await readJsonObject(pkgPath)
  return pkg && Object.hasOwn(pkg, 'workspaces') ? { path: pkgPath, pkg } : null
}

/**
 * Якщо у workspace-root `package.json` немає `\@nitra/cursor` у `devDependencies` і `dependencies`,
 * дописує `devDependencies["\@nitra/cursor"]` зі значенням `^<bundledVersion>`.
 * @param {string} root стартова директорія проєкту (зазвичай `process.cwd()`)
 * @param {{ bundledVersion?: string | null, silent?: boolean }} [options] `bundledVersion` — для тестів;
 *   `silent` — не писати в консоль при успішному оновленні
 * @returns {Promise<boolean>} `true`, якщо `package.json` змінено на диску
 */
export async function ensureNitraCursorInRootDevDependencies(root, options = {}) {
  const workspaceRoot = await readAdjacentWorkspaceRootPackageJson(root)
  if (!workspaceRoot) {
    return false
  }
  const { path: pkgPath, pkg } = workspaceRoot

  const ver = options.bundledVersion ?? (await readBundledPackageVersion())
  if (!ver) {
    return false
  }

  // @nitra/cursor у dependencies — нестандартне розміщення, не чіпаємо.
  const deps = pkg.dependencies
  if (deps && typeof deps === 'object' && PACKAGE_NAME in deps) {
    return false
  }

  const devDeps = pkg.devDependencies
  const current =
    devDeps && typeof devDeps === 'object' && !Array.isArray(devDeps) ? devDeps[PACKAGE_NAME] : undefined

  // Уже присутній у devDependencies: self-upgrade піна лише якщо bundled строго новіша
  // (ніколи не понижуємо; нечислові піни — workspace:*/latest/git — лишаємо як є).
  if (current !== undefined) {
    if (!isBundledNewer(ver, current)) {
      return false
    }
    pkg.devDependencies[PACKAGE_NAME] = `^${ver}`
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    if (!options.silent) {
      console.log(`⬆️  Оновлено ${PACKAGE_NAME} ${current} → ^${ver} у devDependencies у package.json\n`)
    }
    return true
  }

  // Відсутній — дописуємо.
  if (!pkg.devDependencies || typeof pkg.devDependencies !== 'object' || Array.isArray(pkg.devDependencies)) {
    pkg.devDependencies = {}
  }

  pkg.devDependencies[PACKAGE_NAME] = `^${ver}`

  const out = `${JSON.stringify(pkg, null, 2)}\n`
  await writeFile(pkgPath, out, 'utf8')

  if (!options.silent) {
    console.log(`📝 Додано ${PACKAGE_NAME}@^${ver} у devDependencies у package.json\n`)
  }

  return true
}
