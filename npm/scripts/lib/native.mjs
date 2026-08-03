/**
 * Loader napi-аддона `rules-core` (`crates/rules-napi` → `rules-core`) —
 * за зразком `llm-lib/lib/internal/native.mjs` (T2 фази 1,
 * `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).
 *
 * Порядок пошуку (залежить від оточення — див. [`isSourceTree`]):
 *   1. N_RULES_NATIVE_ADDON — явний override шляху до аддона (dev / CI / тести).
 *   2. **Лише у вихідному дереві** (`<repoRoot>/crates/rules-napi/Cargo.toml`
 *      існує — тобто dev-машина або CI цього репо): локальна збірка
 *      `<repoRoot>/target/release|debug/` (сирий cdylib з
 *      `cargo build -p rules-napi`) та вивід `napi build` у `crates/rules-napi/`.
 *   3. Platform-підпакет `@7n/rules-<platform>-<arch>` (napi-артефакт
 *      `rules-napi.<triple>.node`).
 *   4. Той самий fallback на локальну збірку для НЕ-вихідного дерева
 *      (продакшен без підпакета) — поведінка така сама, як до фіксу.
 *   5. Інакше — зрозуміла помилка з підказкою `cargo build --release -p rules-napi`.
 *
 * ЧОМУ порядок різний для вихідного дерева і проду (регресія 2026-08-03):
 * до фіксу підпакет стояв перед локальною збіркою БЕЗУМОВНО, тож у репо
 * (dev і CI) `cargo build -p rules-napi` збирав аддон, який loader потім НЕ
 * брав — вантажився **опублікований** `@7n/rules-<key>` із `node_modules`.
 * Будь-який тест нової native-поверхні перевіряв попередню збірку, а зелений
 * результат нічого не доводив. У CI це ще й недетерміноване: platform-пакет
 * потрапляє в `bun.lock` лише тоді, коли lock востаннє регенерували на тій
 * самій платформі (пор. `git show 581082ef:bun.lock` — `@7n/rules-linux-x64`
 * був у lock, тобто ubuntu-runner тестував registry-аддон 1.76.0).
 * Зворотний безумовний порядок («target завжди перший») теж хибний — у
 * користувача підпакет є **єдиним** авторитетним артефактом, запіненим
 * lockstep до версії `@7n/rules` і звіреним за `contractVersion()`; сторонній
 * `target/release/librules_napi.*`, що випадково опинився поруч зі
 * встановленим пакетом, не має його перебивати. Тому дискримінатор — не
 * евристика (`CI`, `NODE_ENV`), а факт наявності вихідних файлів аддона поруч
 * із loader-ом.
 *
 * Аддон завантажується через `process.dlopen` — працює і для `.node`, і для
 * сирих cdylib (`.dylib`/`.so`/`.dll`), і під bun (не лише node). Результат
 * кешується (одне завантаження на процес). Без JS-fallback на неоголошеній
 * платформі — hard error, свідома межа v1 (darwin-arm64, linux-x64, win32-x64),
 * Р1 спеки + П3 (`docs/specs/2026-07-30-rules-v2-rust-core-migration.md`,
 * рішення О `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.4a).
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

/** Підтримувані platform-arch → napi-суфікс артефакта (v1: darwin-arm64, linux-x64, win32-x64). */
const NAPI_SUFFIXES = {
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu',
  'win32-x64': 'win32-x64-msvc'
}

/** Очікувана версія JSON DTO-контракту `rules-core` ⇄ `rules-napi` (Р10 спеки). */
export const EXPECTED_CONTRACT_VERSION = 2

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
 * УВАГА: на Windows cdylib БЕЗ `lib`-префікса (`rules_napi.dll`, не
 * `librules_napi.dll`) — конвенція MSVC-тулчейну, на відміну від
 * darwin/linux, де cargo додає `lib`-префікс автоматично.
 * @param {string} platform process.platform
 * @returns {string} ім'я бібліотеки
 */
function cdylibName(platform) {
  if (platform === 'darwin') return 'librules_napi.dylib'
  if (platform === 'win32') return 'rules_napi.dll'
  return 'librules_napi.so'
}

/**
 * Чи запущено loader із вихідного дерева репо (dev-машина або CI), а не з
 * встановленого пакета `@7n/rules`. Маркер — `crates/rules-napi/Cargo.toml`
 * поруч із `repoRoot`: у репо він закомічений завжди, а у встановленому
 * пакеті `repoRoot` дорівнює `<node_modules>/@7n`, де жодних `crates/` немає.
 * Саме факт наявності вихідних файлів (а не env-евристика на кшталт `CI`) вирішує,
 * що локальна збірка `target/` авторитетніша за опублікований підпакет.
 * @param {string} repoRoot корінь, від якого рахуються кандидати
 * @param {(p: string) => boolean} exists перевірка існування (ін'єкція для тестів)
 * @returns {boolean} true — вихідне дерево репо
 */
function isSourceTree(repoRoot, exists) {
  return exists(join(repoRoot, 'crates', 'rules-napi', 'Cargo.toml'))
}

/**
 * Кандидати локальної збірки: сирий cdylib з `cargo build -p rules-napi`
 * (release перемагає debug) і вивід `napi build` у `crates/rules-napi/`.
 * @param {string} repoRoot корінь репо
 * @param {string} platform process.platform
 * @param {string | undefined} suffix napi-суфікс артефакта для платформи
 * @returns {string[]} шляхи-кандидати в порядку пріоритету
 */
function localBuildCandidates(repoRoot, platform, suffix) {
  const candidates = Array.from(['release', 'debug'], profile =>
    join(repoRoot, 'target', profile, cdylibName(platform))
  )
  if (suffix) {
    candidates.push(join(repoRoot, 'crates', 'rules-napi', `rules-napi.${suffix}.node`))
  }
  return candidates
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
  const candidates = localBuildCandidates(repoRoot, platform, suffix)

  // 2. Вихідне дерево (dev / CI цього репо): локальна збірка — перша.
  // Інакше свіжий `cargo build -p rules-napi` мовчки перекривався б
  // опублікованим підпакетом, і тести перевіряли б попередню збірку.
  const fromSource = isSourceTree(repoRoot, exists)
  if (fromSource) {
    for (const candidate of candidates) {
      if (exists(candidate)) return candidate
    }
  }

  // 3. Platform-підпакет — авторитетне джерело у користувача (прод).
  if (suffix) {
    try {
      return requireResolve(`@7n/rules-${key}/rules-napi.${suffix}.node`)
    } catch {
      // не встановлено — пробуємо локальну збірку
    }
  }

  // 4. Локальна збірка поза вихідним деревом (поведінка така сама, як до фіксу).
  if (!fromSource) {
    for (const candidate of candidates) {
      if (exists(candidate)) return candidate
    }
  }

  // 5. Помилка з підказкою.
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
