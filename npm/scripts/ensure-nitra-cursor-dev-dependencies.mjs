/**
 * Дописує `\@nitra/cursor` у `devDependencies` кореневого `package.json` проєкту, якщо пакет ще не
 * оголошено ні в `devDependencies`, ні в `dependencies`.
 *
 * Використовується CLI `n-cursor` при кожному запуску (`npx \@nitra/cursor`, зокрема `check`), щоб
 * команда `check` і скрипти з `node_modules/\@nitra/cursor/scripts/` були відтворювані після
 * `bun install` / `npm install`, а не лише з кешу npx.
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
 * Якщо в `root/package.json` немає `\@nitra/cursor` у `devDependencies` і `dependencies`, дописує
 * `devDependencies["\@nitra/cursor"]` зі значенням `^<bundledVersion>`.
 * @param {string} root абсолютний шлях кореня проєкту (зазвичай `process.cwd()`)
 * @param {{ bundledVersion?: string | null, silent?: boolean }} [options] `bundledVersion` — для тестів;
 *   `silent` — не писати в консоль при успішному оновленні
 * @returns {Promise<boolean>} `true`, якщо `package.json` змінено на диску
 */
export async function ensureNitraCursorInRootDevDependencies(root, options = {}) {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) {
    return false
  }

  let raw
  try {
    raw = await readFile(pkgPath, 'utf8')
  } catch {
    return false
  }

  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch {
    return false
  }

  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return false
  }

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
