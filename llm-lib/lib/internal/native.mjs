/**
 * Loader napi-аддона `llm-cascade` (Rust-ядро `llm-lib/crates/llm-cascade-napi`
 * → `llm-cascade`) — за зразком `mt/npm/lib/core/native.mjs`.
 *
 * Порядок пошуку:
 *   1. N_LLM_LIB_NATIVE_ADDON — явний override шляху до аддона (dev / CI / тести).
 *   2. Platform-підпакет `@7n/llm-lib-<platform>-<arch>` (napi-артефакт
 *      `llm-cascade-napi.<triple>.node`).
 *   3. Dev-fallback: `<repoRoot>/target/release|debug/` (сирий cdylib з
 *      `cargo build -p llm-cascade-napi`) та вивід `napi build` у
 *      `llm-lib/crates/llm-cascade-napi/`.
 *   4. Інакше — зрозуміла помилка з підказкою.
 *
 * Аддон завантажується через `process.dlopen` — працює і для `.node`, і для
 * сирих cdylib (`.dylib`/`.so`). Результат кешується (одне завантаження на процес).
 * Без JS-fallback на неоголошеній платформі — hard error, свідома межа v1
 * (darwin-arm64, linux-x64), не регресія.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process, { arch as osArch, env as procEnv, platform as osPlatform } from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
/** Корінь репо: llm-lib/lib/internal → up 3. */
const REPO_ROOT = join(HERE, '..', '..', '..')

/** Підтримувані platform-arch → napi-суфікс артефакта (v1: darwin-arm64, linux-x64). */
const NAPI_SUFFIXES = {
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu'
}

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
 * Ім'я cdylib-файлу для платформи (вивід `cargo build -p llm-cascade-napi`).
 * @param {string} platform process.platform
 * @returns {string} ім'я бібліотеки
 */
function cdylibName(platform) {
  return platform === 'darwin' ? 'libllm_cascade_napi.dylib' : 'libllm_cascade_napi.so'
}

/**
 * Резолвить шлях до napi-аддона `llm-cascade`.
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
  const override = env.N_LLM_LIB_NATIVE_ADDON
  if (override) return override

  const key = `${platform}-${arch}`
  const suffix = NAPI_SUFFIXES[key]

  // 2. Platform-підпакет.
  if (suffix) {
    try {
      return requireResolve(`@7n/llm-lib-${key}/llm-cascade-napi.${suffix}.node`)
    } catch {
      // не встановлено — пробуємо dev-fallback
    }
  }

  // 3. Dev-fallback: cargo-збірка (сирий cdylib) або вивід napi build.
  const candidates = Array.from(['release', 'debug'], profile =>
    join(repoRoot, 'target', profile, cdylibName(platform))
  )
  if (suffix) {
    candidates.push(join(repoRoot, 'llm-lib', 'crates', 'llm-cascade-napi', `llm-cascade-napi.${suffix}.node`))
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }

  // 4. Помилка з підказкою.
  throw new Error(
    `llm-cascade native addon: немає збірки для "${key}". ` +
      `Постав N_LLM_LIB_NATIVE_ADDON=/шлях/до/аддона, додай підпакет @7n/llm-lib-${key}, ` +
      `або збери локально: cargo build --release -p llm-cascade-napi`
  )
}

/**
 * Кешований доступ до аддона (одне завантаження на процес).
 * @param {{ resolve?: () => string, dlopen?: (p: string) => Record<string, unknown> }} [deps] ін'єкції
 * @returns {Record<string, unknown>} exports аддона (oneShotAcp, resolveModel, oneShotLocalCloud)
 */
export function loadNative(deps = {}) {
  if (cached === null) {
    const path = (deps.resolve ?? resolveNativeAddon)()
    cached = (deps.dlopen ?? dlopenAddon)(path)
  }
  return cached
}
