/**
 * Резолвер шляху до native-бінаря `rules-cli` — той самий каскад-принцип,
 * що вже діє для napi-аддона (`npm/scripts/lib/native.mjs`), портований для
 * задачі «канал доставки бінаря»
 * (`docs/specs/2026-09-01-native-binary-distribution-channel.md`, розділ 2).
 *
 * **Не підключений до `package.json#bin` цією задачею.** `#bin` лишається на
 * `bin/n-rules.js` до «Крок 0» плану full-rust-migration («зробити бінар
 * вхідною точкою») — перемикати вхідну точку нема куди, доки канал (розділ 1
 * мінідизайну — GitHub Release binary assets) не наповнений хоч раз живим
 * asset-ом. Модуль існує зараз, щоб Крок 0 мав готовий, покритий тестами
 * резолвер, а не писав його наспіх під тиском.
 *
 * Порядок кандидатів:
 *   1. `N_RULES_CLI_BIN` — явний override (той самий env, що вже використовує
 *      `npm/scripts/utils/test-helpers.mjs::resolveRulesCliBin` для
 *      parity-тестів; довіряється без перевірки існування — той самий канон,
 *      що override аддона в `native.mjs`).
 *   2. Вихідне дерево репо (`crates/rules-cli/Cargo.toml` поруч із коренем) →
 *      `target/{release,debug}/rules-cli[.exe]`.
 *   3. Встановлений канал (розділ 1 мінідизайну, ЩЕ НЕ live) —
 *      `<packageRoot>/.bin-cache/rules-cli-<platform>-<arch>[.exe]`,
 *      конвенція для майбутнього postinstall/fetch-кроку; цей модуль лише
 *      ЧИТАЄ шлях, ніколи не завантажує й не пише туди (мережевий фетч —
 *      поза межею модуля, той самий поділ обов'язків, що вже є між
 *      `n-rules plugin fetch` (пише кеш) і `wasm-plugins.mjs` (лише читає)).
 *
 * Нічого не знайдено — **hard error**, ніколи мовчазний відкат на
 * `bin/n-rules.js` чи будь-який інший JS-шлях: мовчазний skip — вада
 * (`feedback_fail-loud-not-silent.md`), і саме цей принцип уже застосований
 * до napi-аддона («без JS-fallback на неоголошеній платформі — hard error,
 * свідома межа v1», доккомент `native.mjs`). Дві причини відсутності
 * розрізняються явно: платформа поза [`SUPPORTED_CLI_TARGETS`] — інша
 * помилка, ніж підтримувана платформа без жодного кандидата на диску.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process, { arch as osArch, env as procEnv, platform as osPlatform } from 'node:process'

/**
 * Підтримувані platform-arch трійки каналу (розділ 1 мінідизайну) — та сама
 * трійка, що вже збирає `npm-publish.yml`'s `build-native` для napi-аддона
 * (`darwin-arm64`/`linux-x64-gnu`/`win32-x64-msvc`), лише для `rules-cli`
 * замість `rules-napi`.
 */
export const SUPPORTED_CLI_TARGETS = new Set(['darwin-arm64', 'linux-x64', 'win32-x64'])

/**
 * Ім'я виконуваного файлу `rules-cli` для платформи — `[[bin]] name =
 * "rules-cli"` у `crates/rules-cli/Cargo.toml`, з `.exe` на Windows.
 * @param {string} platform process.platform
 * @returns {string} ім'я файлу бінаря
 */
function cliBinaryName(platform) {
  return platform === 'win32' ? 'rules-cli.exe' : 'rules-cli'
}

/**
 * Чи запущено з вихідного дерева репо (маркер — `crates/rules-cli/Cargo.toml`
 * поруч із `repoRoot`) — той самий дискримінатор, що `native.mjs::isSourceTree`.
 * @param {string} repoRoot корінь, від якого рахуються кандидати
 * @param {(p: string) => boolean} exists перевірка існування (ін'єкція для тестів)
 * @returns {boolean} true — вихідне дерево репо
 */
function isSourceTree(repoRoot, exists) {
  return exists(join(repoRoot, 'crates', 'rules-cli', 'Cargo.toml'))
}

/**
 * Кандидати локальної збірки (release перемагає debug).
 * @param {string} repoRoot корінь репо
 * @param {string} platform process.platform
 * @returns {string[]} шляхи-кандидати в порядку пріоритету
 */
function localBuildCandidates(repoRoot, platform) {
  const name = cliBinaryName(platform)
  return ['release', 'debug'].map(profile => join(repoRoot, 'target', profile, name))
}

/**
 * Шлях каналу «встановлений asset» — конвенція для майбутнього
 * postinstall/fetch-кроку (розділ 1 мінідизайну), ще не наповнена жодним
 * інсталятором. Модуль лише перевіряє цей шлях, ніколи не пише туди.
 * @param {string} repoRoot корінь пакета `@7n/rules`
 * @param {string} platform process.platform
 * @param {string} arch process.arch
 * @returns {string} очікуваний шлях кешованого asset-а каналу
 */
function installedChannelCandidate(repoRoot, platform, arch) {
  const key = `${platform}-${arch}`
  const suffix = platform === 'win32' ? '.exe' : ''
  return join(repoRoot, '.bin-cache', `rules-cli-${key}${suffix}`)
}

/**
 * Помилка «платформа поза каналом» — [`SUPPORTED_CLI_TARGETS`] не містить
 * `<platform>-<arch>`. Відрізняється від [`missingBinaryError`]: тут річ не в
 * тому, що бінар не зібрано, а в тому, що каналу для цієї платформи взагалі
 * не існує.
 * @param {string} key `<platform>-<arch>`
 * @returns {Error} готова помилка
 */
function unsupportedPlatformError(key) {
  const supported = Array.from(SUPPORTED_CLI_TARGETS).sort().join(', ')
  return new Error(
    `rules-cli binary: платформа "${key}" поза каналом доставки. ` +
      `Підтримувані трійки: ${supported}. ` +
      `Постав N_RULES_CLI_BIN=/шлях/до/rules-cli, якщо зібрав бінар самостійно.`
  )
}

/**
 * Помилка «нема з чого брати бінар» для підтримуваної платформи.
 * @param {string} key `<platform>-<arch>`
 * @returns {Error} готова помилка
 */
function missingBinaryError(key) {
  return new Error(
    `rules-cli binary: немає збірки для "${key}". ` +
      `Постав N_RULES_CLI_BIN=/шлях/до/rules-cli, збери локально: ` +
      `cargo build --release -p rules-cli, або дочекайся встановленого каналу ` +
      `(docs/specs/2026-09-01-native-binary-distribution-channel.md).`
  )
}

/**
 * Упорядкований ланцюг кандидатів шляху до `rules-cli` — не лише перший
 * знайдений, а все, що виглядає доступним (та сама причина, що
 * `native.mjs::nativeAddonChain`: `existsSync` не доказ виконуваності,
 * викликач сам вирішує, чи пробувати наступний кандидат при невдалому
 * запуску).
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: string,
 *   arch?: string,
 *   existsSync?: (p: string) => boolean,
 *   repoRoot?: string
 * }} [deps] ін'єкції для тестів
 * @returns {string[]} шляхи в порядку пріоритету (може бути порожнім)
 */
export function nativeCliBinaryChain(deps = {}) {
  const env = deps.env ?? procEnv
  const platform = deps.platform ?? osPlatform
  const arch = deps.arch ?? osArch
  const exists = deps.existsSync ?? existsSync
  const repoRoot = deps.repoRoot ?? process.cwd()

  // 1. Явний override — єдине джерело, коли заданий (той самий мотив, що
  // N_RULES_NATIVE_ADDON у native.mjs: мовчазний відкат на щось інше
  // приховав би саме те, що просили перевірити).
  const override = env.N_RULES_CLI_BIN
  if (override) return [override]

  const local = isSourceTree(repoRoot, exists)
    ? localBuildCandidates(repoRoot, platform).filter(p => exists(p))
    : []

  const key = `${platform}-${arch}`
  const installed =
    SUPPORTED_CLI_TARGETS.has(key) && exists(installedChannelCandidate(repoRoot, platform, arch))
      ? [installedChannelCandidate(repoRoot, platform, arch)]
      : []

  // Вихідне дерево (dev/CI цього репо) — локальна збірка попереду, той самий
  // порядок, що napi-аддон: свіжий `cargo build -p rules-cli` не повинен
  // мовчки перекриватись встановленим каналом.
  return isSourceTree(repoRoot, exists) ? [...local, ...installed] : [...installed, ...local]
}

/**
 * Резолвить шлях до `rules-cli` — перший кандидат [`nativeCliBinaryChain`],
 * або гучна помилка, якщо ланцюг порожній.
 * @param {Parameters<typeof nativeCliBinaryChain>[0]} [deps] ін'єкції для тестів
 * @returns {string} абсолютний (чи injected) шлях до бінаря
 * @throws {Error} [`unsupportedPlatformError`] чи [`missingBinaryError`]
 */
export function resolveNativeCliBinary(deps = {}) {
  const chain = nativeCliBinaryChain(deps)
  if (chain.length > 0) return chain[0]

  const env = deps.env ?? procEnv
  const platform = deps.platform ?? osPlatform
  const arch = deps.arch ?? osArch
  const key = `${platform}-${arch}`

  // Override не рахується у SUPPORTED_CLI_TARGETS-перевірку: якщо його
  // задали, chain уже мав би довжину 1 (гілка вище) — сюди доходимо лише
  // коли override відсутній.
  if (!SUPPORTED_CLI_TARGETS.has(key) && !env.N_RULES_CLI_BIN) throw unsupportedPlatformError(key)
  throw missingBinaryError(key)
}
