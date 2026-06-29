/** @see ./docs/tooling.md */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { runConftestBatch } from '../../../scripts/lib/run-conftest-batch.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

/**
 * Чи є префікс `@tauri-apps/` у ключах `dependencies` або `devDependencies`.
 * @param {Record<string, unknown> | null | undefined} pkg розпарсений `package.json`
 * @returns {boolean} true, якщо знайдено хоча б один `@tauri-apps/*`
 */
function packageHasTauriDep(pkg) {
  if (!pkg || typeof pkg !== 'object') return false
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = /** @type {Record<string, unknown> | undefined} */ (pkg[field])
    if (!deps || typeof deps !== 'object') continue
    for (const name of Object.keys(deps)) {
      if (name.startsWith('@tauri-apps/')) return true
    }
  }
  return false
}

/**
 * Чи має одиничний workspace-пакет маркер Tauri.
 * @param {string} cwd корінь репо
 * @param {string} ws відносний шлях workspace ('.' для root)
 * @returns {Promise<boolean>} true, якщо в цьому workspace є Tauri
 */
async function workspaceHasTauriMarker(cwd, ws) {
  const base = ws === '.' ? cwd : join(cwd, ws)
  const srcTauri = join(base, 'src-tauri')
  if (existsSync(srcTauri) && statSync(srcTauri).isDirectory()) return true
  if (existsSync(join(base, 'src-tauri', 'Cargo.toml'))) return true
  if (existsSync(join(base, 'src-tauri', 'tauri.conf.json'))) return true
  if (existsSync(join(base, 'tauri.conf.json'))) return true
  const pkgPath = join(base, 'package.json')
  if (!existsSync(pkgPath)) return false
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  return packageHasTauriDep(pkg)
}

/**
 * Чи є у проєкті (root або будь-якому workspace-пакеті) маркер Tauri.
 * @param {string} cwd корінь репо
 * @returns {Promise<boolean>} true, якщо проєкт використовує Tauri
 */
async function projectHasTauriMarker(cwd) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  for (const ws of roots) {
    if (await workspaceHasTauriMarker(cwd, ws)) return true
  }
  return false
}

/**
 * Перевіряє відповідність проєкту правилам tauri.mdc.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>}
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const cwd = ctx.cwd
  const hasTauri = await projectHasTauriMarker(cwd)
  if (!hasTauri) {
    pass('Немає маркера Tauri (src-tauri/, tauri.conf.json, @tauri-apps/*) — tauri-tooling не вимагається')
    return reporter.result()
  }

  pass('Знайдено маркер Tauri — перевіряємо канонічні конфіги tauri.mdc')

  const extPath = '.vscode/extensions.json'
  if (!existsSync(extPath)) {
    fail(`${extPath} не існує — створи з recommendations "tauri-apps.tauri-vscode" (tauri.mdc)`)
    return reporter.result()
  }
  const violations = runConftestBatch({
    policyDirRel: 'tauri/vscode_extensions',
    namespace: 'tauri.vscode_extensions',
    files: [extPath]
  })
  if (violations.length === 0) {
    pass(`${extPath} відповідає tauri.vscode_extensions (rego)`)
  } else {
    for (const v of violations) fail(v.message)
  }

  return reporter.result()
}
