/**
 * Визначає, чи репозиторій заявляє topology publishable npm package.
 *
 * `npm-module` не є загальним Bun-правилом: service monorepo може мати
 * `package.json` і довільні workspaces без пакета, який публікується в npm.
 * Наявний каталог `npm/`, workspace `npm` або workflow публікації є
 * достатнім явним сигналом застосувати повний npm-package канон.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} [cwd] корінь репозиторію
 * @returns {boolean} чи має репозиторій topology npm publisher-а
 */
export function applies(cwd = process.cwd()) {
  if (existsSync(join(cwd, 'npm'))) return true
  if (existsSync(join(cwd, '.github/workflows/npm-publish.yml'))) return true

  const packageJson = join(cwd, 'package.json')
  if (!existsSync(packageJson)) return false
  try {
    const manifest = JSON.parse(readFileSync(packageJson, 'utf8'))
    return Array.isArray(manifest.workspaces) && manifest.workspaces.includes('npm')
  } catch {
    return false
  }
}
