/**
 * Preflight-перевірка трьох локальних build-артефактів, без яких повний
 * JS-суїт (vitest) не дає достовірного результату на свіжому checkout:
 *
 *   1. napi-аддон `rules-napi`      → `cargo build --release -p rules-napi`
 *   2. бінар `rules-cli`            → `cargo build --release -p rules-cli`
 *   3. first-party wasm-плагіни     → `node npm/scripts/build-wasm-plugins.mjs`
 *      (`npm/wasm-plugins/builtin-pins.json` + `target/wasm32-wasip2/release/*.wasm`)
 *
 * Живе в `lib/`, не в `utils/` (`js.mdc`/`utils_imports`): модуль знає про
 * домен проєкту (napi-loader, cargo-крейти, wasm-плагіни), а не просто generic
 * helper — `utils/`-каталог гейтиться лінтом на relative-імпорти з `..` саме
 * тому, що такі залежності від домену туди не належать.
 *
 * ЧОМУ preflight, а не покластися на наявні per-test гейти: усі три вже
 * МАЮТЬ власний hard-fail глибоко в суїті ([`resolveRulesCliBin`] у
 * `test-helpers.mjs`, `existsSync(WASM_PATH)` у кожному wasm-parity-тесті) —
 * але вони спрацьовують по одному, коли vitest ДОХОДИТЬ до конкретного
 * файлу (десятки хвилин повного прогону), і не завжди навіть тоді:
 * відсутній `rules-napi` не кидає одразу — `nativeAddonChain` (доккомент
 * `native.mjs`) мовчки відкочується на стейлий registry-підпакет, тож
 * тести проходять на СТАРОМУ коді без жодного сигналу. Ціна виміряна на
 * сесії 2026-08-27 (реєстр `docs/plans/2026-08-05-open-questions-register.md`
 * §2.39): відсутність (3) двічі дала оманливий `DetectorError('немає
 * main.mjs')`, відсутність (2) — порожній `STACK_TRACE_ERROR`, що не каже
 * взагалі нічого; один агент згаяв ~1.5 години на пошук неіснуючого
 * дефекту, який насправді був відсутньою локальною збіркою.
 *
 * Тому: перевір усі три ОДНИМ дешевим проходом (`existsSync` + кілька
 * малих `readFileSync` на `Cargo.toml`, БЕЗ жодного spawn) ще до старту
 * жодного тесту (vitest `globalSetup`) і, якщо чогось бракує, зупини
 * прогін одразу з ПОВНИМ списком — не по одному, як сталося на тій сесії
 * (три ітерації по десять хвилин, поки з'ясувалось, що бракує трьох, а не
 * однієї речі).
 *
 * Свідомо БЕЗ staleness/mtime-евристики: команди-підказки нижче — той
 * самий `cargo build`/`build.sh`, що вже інкрементальні самі по собі
 * (no-op, якщо нічого не змінилось відносно попередньої збірки) —
 * переізобретати граф залежностей cargo тут було б дублюванням крихкої
 * логіки заради виграшу, якого не існує (повторний запуск підказки завжди
 * дешевий і безпечний, а cargo сам вирішує, чи треба щось перезбирати).
 *
 * Свідомо БЕЗ per-file сканування «чи цей конкретний тест торкається
 * native/wasm»: усі три артефакти прошивають переважну більшість suite —
 * і тести пакета `npm`, і тести КОЖНОГО language-plugin workspace
 * (`native.mjs`/`WASM_PATH`-гейти живуть у ЧОТИРЬОХ workspace-пакетах, не
 * лише в `npm`) — а сама перевірка коштує одиниці мілісекунд незалежно від
 * того, скільки файлів реально запущено, тож звужувати дороге не було б
 * чим: інвестиція в import-граф аналіз коштувала б дорожче, ніж вона
 * економить. Явний опт-аут для вузького «один суто-JS файл на машині без
 * Rust-тулчейну» — env `N_RULES_TEST_PREFLIGHT_SKIP=1` (задокументовано в
 * тексті помилки нижче), а не автоматична евристика.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env as procEnv, platform as osPlatform } from 'node:process'

import { FIRST_PARTY_WASM_PLUGINS, WASM_PLUGINS_DIR } from '../build-wasm-plugins.mjs'
import { resolveRulesCliBin } from '../utils/test-helpers.mjs'
import { localBuildCandidates } from './native.mjs'

/** `name = "..."` у першому рядку-збігу `Cargo.toml` — той самий канон, що `readCargoPackageName` у `build-wasm-plugins.mjs` (тут — власна копія, щоб не тягнути `readFileSync` без DI з чужого модуля в юніт-тестах цього файлу). */
const CARGO_PACKAGE_NAME_RE = /^name\s*=\s*"([^"]+)"/m

/**
 * Ім'я cargo-пакета крейта з `Cargo.toml` — той самий парсинг, що
 * `readCargoPackageName` у `build-wasm-plugins.mjs` (доккомент модуля: DI
 * тут лишається локальним, щоб не змішувати dev-скрипт зі своїм
 * тестовим DI-контрактом і preflight зі своїм).
 * @param {string} crateDir абсолютний шлях до крейта
 * @param {(p: string, enc: string) => string} readFile ін'єкція для тестів
 * @returns {string} ім'я пакета
 */
function cargoPackageName(crateDir, readFile) {
  const cargoToml = readFile(join(crateDir, 'Cargo.toml'), 'utf8')
  const match = CARGO_PACKAGE_NAME_RE.exec(cargoToml)
  if (!match) throw new Error(`test-preflight: не вдалось прочитати "name" з ${crateDir}/Cargo.toml`)
  return match[1]
}

/**
 * Перевіряє наявність локальної збірки napi-аддона `rules-napi`
 * (`target/{release,debug}/<cdylib>` — той самий канон, що
 * [`localBuildCandidates`] у `native.mjs`, з `suffix=undefined`: перевіряємо
 * РІВНО те, що лишає по собі `cargo build --release -p rules-napi`, без
 * platform-суфікса встановленого підпакета — той стосується лише
 * production-fallback, не dev-збірки).
 * @param {{ repoRoot: string, platform: string, exists: (p: string) => boolean }} deps
 * @returns {boolean} true — локальна збірка є (хоча б release або debug)
 */
function hasRulesNapiBuild({ repoRoot, platform, exists }) {
  return localBuildCandidates(repoRoot, platform, undefined).some(exists)
}

/**
 * Перевіряє наявність зібраного бінаря `rules-cli` через [`resolveRulesCliBin`]
 * (те саме, що використовує `rules-cli-parity.test.mjs` та інші — той самий
 * каскад: `N_RULES_CLI_BIN` override → `target/release` → `target/debug`).
 * @param {() => string} resolveBin ін'єкція [`resolveRulesCliBin`] для тестів
 * @returns {boolean} true — бінар резолвиться (не кидає)
 */
function hasRulesCliBuild(resolveBin) {
  try {
    resolveBin()
    return true
  } catch {
    return false
  }
}

/**
 * Перевіряє повноту first-party wasm-плагінів: `builtin-pins.json` і
 * РІВНО ті `target/wasm32-wasip2/release/<stem>.wasm`, які
 * `build-wasm-plugins.mjs` копіює в `npm/wasm-plugins/` (реєстр
 * [`FIRST_PARTY_WASM_PLUGINS`] — той самий, тож новий first-party плагін
 * автоматично потрапляє й у цю перевірку, без окремого рядка тут).
 * @param {{
 *   repoRoot: string,
 *   exists: (p: string) => boolean,
 *   readFile: (p: string, enc: string) => string,
 *   plugins: Array<{ name: string, crateDir: string }>,
 *   wasmPluginsDir: string
 * }} deps
 * @returns {{ ok: boolean, missingPinsFile: boolean, missingWasm: string[] }} деталізація браку (для тексту помилки)
 */
function checkWasmPlugins({ repoRoot, exists, readFile, plugins, wasmPluginsDir }) {
  const missingPinsFile = !exists(join(wasmPluginsDir, 'builtin-pins.json'))
  const missingWasm = []
  for (const plugin of plugins) {
    const crateDir = join(repoRoot, plugin.crateDir)
    const pkgName = cargoPackageName(crateDir, readFile)
    const wasmStem = pkgName.replaceAll('-', '_')
    const wasmPath = join(repoRoot, 'target', 'wasm32-wasip2', 'release', `${wasmStem}.wasm`)
    if (!exists(wasmPath)) missingWasm.push(`${plugin.name} (${wasmPath})`)
  }
  return { ok: !missingPinsFile && missingWasm.length === 0, missingPinsFile, missingWasm }
}

/**
 * Env-опт-аут для вузького сценарію «один суто-JS тест, native/wasm
 * свідомо не потрібні, Rust-тулчейну на машині нема» (доккомент модуля).
 * Явний прапорець користувача, не автоматична евристика — тиша про
 * пропуск суперечила б принципу "fail loud", тож [`assertTestArtifacts`]
 * все одно друкує, що перевірку пропущено і чому.
 */
export const SKIP_ENV_VAR = 'N_RULES_TEST_PREFLIGHT_SKIP'

/**
 * Збирає перелік відсутніх передумов (порожній масив — усе на місці).
 * Увесь прохід — `existsSync`/`readFileSync` на маленьких `Cargo.toml`,
 * без жодного `spawn` (доккомент модуля).
 * @param {{
 *   repoRoot?: string,
 *   platform?: string,
 *   exists?: (p: string) => boolean,
 *   readFile?: (p: string, enc: string) => string,
 *   resolveRulesCliBinFn?: () => string,
 *   plugins?: Array<{ name: string, crateDir: string }>,
 *   wasmPluginsDir?: string
 * }} [deps] ін'єкції для тестів
 * @returns {Array<{ id: string, detail: string, command: string }>} відсутні артефакти, у стабільному порядку 1→2→3
 */
export function collectMissingArtifacts(deps = {}) {
  const repoRoot = deps.repoRoot ?? join(import.meta.dirname, '..', '..', '..')
  const platform = deps.platform ?? osPlatform
  const exists = deps.exists ?? existsSync
  const readFile = deps.readFile ?? readFileSync
  const resolveBin = deps.resolveRulesCliBinFn ?? resolveRulesCliBin
  const plugins = deps.plugins ?? FIRST_PARTY_WASM_PLUGINS
  const wasmPluginsDir = deps.wasmPluginsDir ?? WASM_PLUGINS_DIR

  /** @type {Array<{ id: string, detail: string, command: string }>} */
  const missing = []

  if (!hasRulesNapiBuild({ repoRoot, platform, exists })) {
    missing.push({
      id: 'rules-napi',
      detail:
        'napi-аддон rules-napi не зібраний — без нього loader (`native.mjs::nativeAddonChain`) МОВЧКИ ' +
        'відкочується на старий/registry бінар (або взагалі не має звідки вантажити): тести пройдуть, ' +
        'але проти чужого коду, без жодного сигналу про це.',
      command: 'cargo build --release -p rules-napi'
    })
  }

  if (!hasRulesCliBuild(resolveBin)) {
    missing.push({
      id: 'rules-cli',
      detail:
        'бінар rules-cli не зібраний — без нього десятки тестів parity/tools-registry/`lint --full` ' +
        'падають з порожнім STACK_TRACE_ERROR (serialized stack без тексту помилки), що не каже, ' +
        'у чому річ.',
      command: 'cargo build --release -p rules-cli'
    })
  }

  const wasm = checkWasmPlugins({ repoRoot, exists, readFile, plugins, wasmPluginsDir })
  if (!wasm.ok) {
    const parts = []
    if (wasm.missingPinsFile) parts.push('npm/wasm-plugins/builtin-pins.json відсутній')
    if (wasm.missingWasm.length > 0) parts.push(`не зібрано: ${wasm.missingWasm.join(', ')}`)
    missing.push({
      id: 'wasm-плагіни',
      detail:
        `first-party wasm-плагіни неповні (${parts.join('; ')}) — без них wasm-parity-тести ` +
        'падають прямим hard-fail, а лінт-детектори, портовані у wasm, дають оманливе ' +
        "DetectorError('немає main.mjs') замість реальної причини.",
      command: 'node npm/scripts/build-wasm-plugins.mjs'
    })
  }

  return missing
}

/**
 * Форматує зведене повідомлення про ВСІ відсутні передумови одразу (не по
 * одній) — той самий тон, що hard-fail у `wasm-plugin-parity-ci-github.test.mjs`:
 * що бракує, чому це важливо, яка саме команда.
 * @param {Array<{ id: string, detail: string, command: string }>} missing непорожній список
 * @returns {string} готовий текст помилки
 */
function formatMessage(missing) {
  const items = missing
    .map((item, i) => `  ${i + 1}. [${item.id}] ${item.detail}\n     Команда: ${item.command}`)
    .join('\n\n')
  return (
    `test-preflight: відсутні ${missing.length}/3 локальні build-артефакти — свіжий checkout не ` +
    'дає достовірного JS-суїту без них (детальний мотив — доккомент `npm/scripts/lib/test-preflight.mjs`).\n\n' +
    `${items}\n\n` +
    `Зберіть усе перелічене вище ОДРАЗУ, потім перезапустіть тести. Якщо цей прогін свідомо суто-JS ` +
    `і native/wasm не потрібні — пропустіть перевірку одноразово: ${SKIP_ENV_VAR}=1.`
  )
}

/**
 * Vitest `globalSetup`-точка входу: кидає з повним списком відсутнього,
 * якщо бракує хоч одного з трьох (доккомент модуля), інакше — без побічних
 * ефектів. Викликається РІВНО ОДИН раз на весь прогін, до першого тесту.
 * @param {Parameters<typeof collectMissingArtifacts>[0]} [deps] ін'єкції для тестів
 * @returns {void}
 */
export function assertTestArtifacts(deps = {}) {
  const env = deps.env ?? procEnv
  if (env[SKIP_ENV_VAR]) {
    // eslint-disable-next-line no-console -- навмисний друк: мовчазний skip суперечив би "fail loud" (CLAUDE.md), навіть коли skip явний.
    console.warn(`test-preflight: пропущено (${SKIP_ENV_VAR}=1) — native/wasm-гейти глибоко в suite лишаються активними.`)
    return
  }
  const missing = collectMissingArtifacts(deps)
  if (missing.length === 0) return
  throw new Error(formatMessage(missing))
}

/** Vitest `globalSetup` default export — синхронний виклик [`assertTestArtifacts`] з реальними deps. */
export default function globalSetup() {
  assertTestArtifacts()
}
