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
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = '@nitra/cursor'

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

  const devDeps = pkg.devDependencies
  const deps = pkg.dependencies
  if (devDeps && typeof devDeps === 'object' && PACKAGE_NAME in devDeps) {
    return false
  }
  if (deps && typeof deps === 'object' && PACKAGE_NAME in deps) {
    return false
  }

  const ver = options.bundledVersion ?? (await readBundledPackageVersion())
  if (!ver) {
    return false
  }

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
