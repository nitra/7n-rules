/**
 * Loader napi-аддона `rules-core` (`crates/rules-napi` → `rules-core`) —
 * за зразком `llm-lib/lib/internal/native.mjs` (T2 фази 1,
 * `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
 *
 * Порядок пошуку:
 *   1. N_RULES_NATIVE_ADDON — явний override шляху до аддона (dev / CI / тести).
 *   2. Platform-підпакет `@7n/rules-<platform>-<arch>` (napi-артефакт
 *      `rules-napi.<triple>.node`).
 *   3. Dev-fallback: `<repoRoot>/target/release|debug/` (сирий cdylib з
 *      `cargo build -p rules-napi`) та вивід `napi build` у `crates/rules-napi/`.
 *   4. Інакше — зрозуміла помилка з підказкою `cargo build --release -p rules-napi`.
 *
 * Аддон завантажується через `process.dlopen` — працює і для `.node`, і для
 * сирих cdylib (`.dylib`/`.so`), і під bun (не лише node). Результат
 * кешується (одне завантаження на процес). Без JS-fallback на неоголошеній
 * платформі — hard error, свідома межа v1 (darwin-arm64, linux-x64), Р1 спеки.
 *
 * Додатково (відмінність від `llm-lib`-loader-а): після dlopen звіряється
 * `addon.contractVersion()` з [`EXPECTED_CONTRACT_VERSION`] — розбіжність
 * означає несумісний DTO-контракт `rules-core` ⇄ `rules-napi` (Р10 спеки,
 * enforcement-точка за зразком `requiresPluginApi`). Звірка — один раз, при
 * першому завантаженні.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process, { arch as osArch, env as procEnv, platform as osPlatform } from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
/** Корінь репо: npm/scripts/lib → up 3. */
const REPO_ROOT = join(HERE, '..', '..', '..')

/** Підтримувані platform-arch → napi-суфікс артефакта (v1: darwin-arm64, linux-x64). */
const NAPI_SUFFIXES = {
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu'
}

/** Очікувана версія JSON DTO-контракту `rules-core` ⇄ `rules-napi` (Р10 спеки). */
export const EXPECTED_CONTRACT_VERSION = 1

/** @type {Record<string, unknown> | null} */
let cached = null

/**
 * Завантажує аддон за шляхом через process.dlopen.
 * @param {string} p шлях до .node / .dylib / .so
 * @returns {Record<string, unknown>} exports аддона
 */
function dlopenAddon(p) {
  const mod = { exports: {} }
  process.dlopen(mod, p)
  return mod.exports
}

/**
 * Ім'я cdylib-файлу для платформи (вивід `cargo build -p rules-napi`).
 * @param {string} platform process.platform
 * @returns {string} ім'я бібліотеки
 */
function cdylibName(platform) {
  return platform === 'darwin' ? 'librules_napi.dylib' : 'librules_napi.so'
}

/**
 * Резолвить шлях до napi-аддона `rules-core`.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: string,
 *   arch?: string,
 *   existsSync?: (p: string) => boolean,
 *   requireResolve?: (id: string) => string,
 *   repoRoot?: string
 * }} [deps] ін'єкції для тестів
 * @returns {string} шлях до файлу аддона
 */
export function resolveNativeAddon(deps = {}) {
  const env = deps.env ?? procEnv
  const platform = deps.platform ?? osPlatform
  const arch = deps.arch ?? osArch
  const exists = deps.existsSync ?? existsSync
  const requireResolve = deps.requireResolve ?? (id => require.resolve(id))
  const repoRoot = deps.repoRoot ?? REPO_ROOT

  // 1. Явний override.
  const override = env.N_RULES_NATIVE_ADDON
  if (override) return override

  const key = `${platform}-${arch}`
  const suffix = NAPI_SUFFIXES[key]

  // 2. Platform-підпакет.
  if (suffix) {
    try {
      return requireResolve(`@7n/rules-${key}/rules-napi.${suffix}.node`)
    } catch {
      // не встановлено — пробуємо dev-fallback
    }
  }

  // 3. Dev-fallback: cargo-збірка (сирий cdylib) або вивід napi build.
  const candidates = Array.from(['release', 'debug'], profile =>
    join(repoRoot, 'target', profile, cdylibName(platform))
  )
  if (suffix) {
    candidates.push(join(repoRoot, 'crates', 'rules-napi', `rules-napi.${suffix}.node`))
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }

  // 4. Помилка з підказкою.
  throw new Error(
    `rules native addon: немає збірки для "${key}". ` +
      `Постав N_RULES_NATIVE_ADDON=/шлях/до/аддона, додай підпакет @7n/rules-${key}, ` +
      `або збери локально: cargo build --release -p rules-napi`
  )
}

/**
 * Кешований доступ до аддона (одне завантаження на процес). Після dlopen
 * звіряє `addon.contractVersion()` з [`EXPECTED_CONTRACT_VERSION`] — до
 * кешування, тож розбіжність кидає щоразу (не залипає в невдалому стані).
 * @param {{ resolve?: () => string, dlopen?: (p: string) => Record<string, unknown> }} [deps] ін'єкції
 * @returns {Record<string, unknown>} exports аддона (contractVersion, resolveChangedBase)
 */
export function loadNative(deps = {}) {
  if (cached === null) {
    const path = (deps.resolve ?? resolveNativeAddon)()
    const addon = (deps.dlopen ?? dlopenAddon)(path)
    const actual = addon.contractVersion()
    if (actual !== EXPECTED_CONTRACT_VERSION) {
      throw new Error(
        `rules native addon: несумісна версія DTO-контракту rules-core ⇄ rules-napi ` +
          `(аддон=${actual}, очікується=${EXPECTED_CONTRACT_VERSION}). ` +
          `Онови пакет @7n/rules або перезбери native локально: cargo build --release -p rules-napi`
      )
    }
    cached = addon
  }
  return cached
}
