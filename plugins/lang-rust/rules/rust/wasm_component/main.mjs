/**
 * @see ./docs/main.md
 *
 * Read-only detector, T0 (без spawn `cargo`): забороняє старий (pre-Component-Model)
 * режим компіляції в wasm — `wasm-bindgen` (браузерний cdylib-таргет wasm32-unknown-unknown,
 * не WASI, без Component Model ABI) — і вимагає, щоб хост на `wasmtime` мав `component-model`
 * увімкненою (дефолтна feature крейта; порушення — лише коли `default-features = false` і
 * `component-model` не додано назад явно).
 */
import { dirname, join } from 'node:path'

import { globby } from 'globby'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { findAncestorWorkspaceRoot, readCargoManifest } from '@7n/rules/scripts/utils/cargo-workspace.mjs'

/** Стабільний reason: пряма чи workspace-успадкована залежність від `wasm-bindgen`. */
export const WASM_BINDGEN_FORBIDDEN = 'wasm-bindgen-forbidden'
/** Стабільний reason: `wasmtime` з `default-features = false` без `component-model` у `features`. */
export const WASMTIME_MISSING_COMPONENT_MODEL = 'wasmtime-missing-component-model'

const DEP_TABLE_KEYS = ['dependencies', 'build-dependencies', 'dev-dependencies']

const WASM_BINDGEN_HINT =
  '`wasm-bindgen` — це старий режим (браузерний cdylib під wasm32-unknown-unknown, без WASI, ' +
  'без Component Model ABI). Порт на Component Model: `wit-bindgen` + ціль wasm32-wasip2 ' +
  '(rust/wasm_component.mdc).'

const WASMTIME_HINT =
  '`component-model` — дефолтна feature `wasmtime`, але цей маніфест вимкнув дефолти ' +
  '(`default-features = false`) і не додав її назад явно у `features`. Без неї хост не зможе ' +
  'вантажити wasm-компоненти (`Component::from_binary`) — лише старі core-модулі (rust/wasm_component.mdc).'

/**
 * Усі depend-таблиці маніфесту: кореневі `[dependencies]`/`[build-dependencies]`/
 * `[dev-dependencies]` + такі самі під кожним `[target.'cfg(...)'.*]`.
 * @param {Record<string, unknown>} parsed розпарсений Cargo.toml
 * @returns {Record<string, unknown>[]} перелік depend-таблиць (можуть бути порожні/відсутні)
 */
function allDependencyTables(parsed) {
  const tables = DEP_TABLE_KEYS.map(k => parsed[k]).filter(Boolean)
  const target = /** @type {Record<string, Record<string, unknown>>|undefined} */ (parsed.target)
  if (target && typeof target === 'object') {
    for (const cfgTable of Object.values(target)) {
      for (const k of DEP_TABLE_KEYS) {
        if (cfgTable?.[k]) tables.push(cfgTable[k])
      }
    }
  }
  return tables
}

/**
 * Значення залежності за іменем з будь-якої depend-таблиці маніфесту, або undefined.
 * @param {Record<string, unknown>} parsed розпарсений Cargo.toml
 * @param {string} name ім'я крейта-залежності
 * @returns {unknown} значення запису (`string` — коротка форма, `object` — таблиця) або undefined
 */
function findDependency(parsed, name) {
  const table = allDependencyTables(parsed).find(t => Object.hasOwn(t, name))
  return table?.[name]
}

/**
 * Резолвить `{ workspace = true }`-успадкування у `[workspace.dependencies]` найближчого
 * ancestor workspace root. Повертає undefined, якщо корінь не знайдено чи запису там нема
 * (навмисно тихо — уникаємо хибних спрацювань на успадкуванні, яке не вдалось розв'язати).
 * @param {string} manifestPath абсолютний шлях маніфесту, де знайдено `workspace = true`
 * @param {string} repoRoot корінь repo (межа обходу вгору)
 * @param {string} name ім'я крейта-залежності
 * @returns {Promise<unknown>} значення з `[workspace.dependencies]` або undefined
 */
async function resolveWorkspaceDependency(manifestPath, repoRoot, name) {
  const ancestor = await findAncestorWorkspaceRoot(dirname(manifestPath), repoRoot)
  if (!ancestor) return
  const wsDeps = /** @type {Record<string, unknown>|undefined} */ (ancestor.parsed.workspace?.dependencies)
  return wsDeps?.[name]
}

/**
 * Чи є значення залежності таблицею-успадкуванням `{ workspace = true }`.
 * @param {unknown} value значення запису залежності
 * @returns {boolean} true — це `{ workspace = true, ... }`
 */
function isWorkspaceInherited(value) {
  return typeof value === 'object' && value !== null && value.workspace === true
}

/**
 * Перевіряє одну залежність від `wasm-bindgen` (пряму чи workspace-успадковану).
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер concern-а
 * @param {Record<string, unknown>} parsed розпарсений Cargo.toml
 * @param {string} manifestPath абсолютний шлях маніфесту
 * @param {string} rel posix-relative шлях маніфесту (для violation.file)
 * @param {string} repoRoot корінь repo
 */
async function checkWasmBindgen(reporter, parsed, manifestPath, rel, repoRoot) {
  const value = findDependency(parsed, 'wasm-bindgen')
  if (value === undefined) return
  if (isWorkspaceInherited(value)) {
    const resolved = await resolveWorkspaceDependency(manifestPath, repoRoot, 'wasm-bindgen')
    if (resolved === undefined) return
  }
  reporter.fail(`${rel}: залежність від \`wasm-bindgen\` заборонена — старий режим wasm. ${WASM_BINDGEN_HINT}`, {
    reason: WASM_BINDGEN_FORBIDDEN,
    file: rel
  })
}

/**
 * Чи бракує `wasmtime`-запису явного `component-model` при вимкнених дефолтах.
 * @param {unknown} value значення запису `wasmtime` (string — коротка форма, object — таблиця)
 * @returns {boolean} true — порушення (`default-features = false` без `component-model`)
 */
function wasmtimeMissingComponentModel(value) {
  if (typeof value !== 'object' || value === null) return false
  const defaultFeatures = value['default-features']
  if (defaultFeatures !== false) return false
  const features = Array.isArray(value.features) ? value.features : []
  return !features.includes('component-model')
}

/**
 * Перевіряє залежність від `wasmtime` (пряму чи workspace-успадковану) на явний
 * `component-model` при вимкнених дефолтних features.
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер concern-а
 * @param {Record<string, unknown>} parsed розпарсений Cargo.toml
 * @param {string} manifestPath абсолютний шлях маніфесту
 * @param {string} rel posix-relative шлях маніфесту (для violation.file)
 * @param {string} repoRoot корінь repo
 */
async function checkWasmtime(reporter, parsed, manifestPath, rel, repoRoot) {
  let value = findDependency(parsed, 'wasmtime')
  if (value === undefined) return
  if (isWorkspaceInherited(value)) {
    const resolved = await resolveWorkspaceDependency(manifestPath, repoRoot, 'wasmtime')
    if (resolved === undefined) return
    value = resolved
  }
  if (!wasmtimeMissingComponentModel(value)) return
  reporter.fail(`${rel}: \`wasmtime\` без \`component-model\` у features. ${WASMTIME_HINT}`, {
    reason: WASMTIME_MISSING_COMPONENT_MODEL,
    file: rel
  })
}

/**
 * Detector rust/wasm_component: per-file (дельта) або whole-repo обхід `Cargo.toml`.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} перелік порушень
 */
export async function lint(ctx) {
  const { cwd, files } = ctx
  const reporter = createViolationReporter(ctx)

  const targets = files === undefined ? undefined : files.filter(f => f.endsWith('Cargo.toml'))
  if (targets !== undefined && targets.length === 0) return reporter.result()

  const relPaths = targets ?? (await globby(['**/Cargo.toml'], { cwd, gitignore: true }))

  for (const rel of relPaths) {
    const manifestPath = join(cwd, rel)
    const parsed = await readCargoManifest(manifestPath)
    if (!parsed) continue

    await checkWasmBindgen(reporter, parsed, manifestPath, rel, cwd)
    await checkWasmtime(reporter, parsed, manifestPath, rel, cwd)
  }

  return reporter.result()
}
