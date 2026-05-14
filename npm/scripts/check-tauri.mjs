/**
 * Перевіряє інструментарій Tauri (tauri.mdc): VSCode `extensions.json` для
 * проєктів, у яких є маркер Tauri.
 *
 * Cross-file gating (JS):
 *   1. Tauri-маркер визначаємо за **будь-яким** з:
 *      - існує каталог `src-tauri/` у `cwd`;
 *      - існує файл `tauri.conf.json` у `cwd` або в workspace-пакетах;
 *      - кореневий `package.json#devDependencies` або `dependencies` містить
 *        ключ з префіксом `@tauri-apps/`.
 *   2. Якщо маркера немає — пропустити перевірку (tauri-tooling не вимагається).
 *   3. Інакше — для `.vscode/extensions.json` зробити FS-existence + делегувати
 *      content `rego.tauri.vscode_extensions` через `runConftestBatch`.
 *
 * Rego-полісі глобально у `lint-conftest` НЕ реєструється — це conditional
 * правило. Plan B: Rego-authoritative + JS-orchestrator з `runConftestBatch`.
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { createCheckReporter } from './utils/check-reporter.mjs'
import { runConftestBatch } from './utils/run-conftest-batch.mjs'

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
 * Чи є у проєкті маркер Tauri: `src-tauri/`, `tauri.conf.json` (root або
 * workspace), або `@tauri-apps/*` у залежностях кореневого `package.json`.
 * @returns {Promise<boolean>} true, якщо проєкт використовує Tauri
 */
async function projectHasTauriMarker() {
  if (existsSync('src-tauri') && statSync('src-tauri').isDirectory()) return true
  if (existsSync('tauri.conf.json')) return true
  if (!existsSync('package.json')) return false
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  if (packageHasTauriDep(pkg)) return true
  return false
}

/**
 * Перевіряє відповідність проєкту правилам tauri.mdc.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const hasTauri = await projectHasTauriMarker()
  if (!hasTauri) {
    pass('Немає маркера Tauri (src-tauri/, tauri.conf.json, @tauri-apps/*) — tauri-tooling не вимагається')
    return reporter.getExitCode()
  }

  pass('Знайдено маркер Tauri — перевіряємо канонічні конфіги tauri.mdc')

  const extPath = '.vscode/extensions.json'
  if (!existsSync(extPath)) {
    fail(`${extPath} не існує — створи з recommendations "tauri-apps.tauri-vscode" і "rust-lang.rust-analyzer" (tauri.mdc)`)
    return reporter.getExitCode()
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

  return reporter.getExitCode()
}
