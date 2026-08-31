/**
 * Локальна dev-петля й CI-крок «зібрати first-party wasm-плагіни» (задача O1
 * фази 6 v2, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
 * §3.4, рішення Н) — для кожного крейта з [`FIRST_PARTY_WASM_PLUGINS`] спавнить
 * його `build.sh` (той самий генеричний build-скрипт, що й скіл `wasm-plugin`,
 * доккомент `crates/plugin-lang-js/build.sh`), копіює зібраний Component Model
 * `.wasm` у `npm/wasm-plugins/<package-name>.wasm` і генерує
 * `npm/wasm-plugins/builtin-pins.json` — вбудовану таблицю `name → {file,
 * sha256}`, яку `wasm-plugins.mjs` (`readBuiltinPinsConfig`) читає ПОРЯД із
 * модулем (шлях від `import.meta.url`, працює і в repo, і в installed-пакеті).
 *
 * Запуск (вручну, з кореня `@7n/rules`):
 *   node npm/scripts/build-wasm-plugins.mjs
 *
 * Той самий скрипт викликає CI-крок `npm-publish.yml` (build-native, ubuntu-рядок —
 * wasm-компонент платформо-незалежний, окремої матриці не потрібно) перед
 * `actions/upload-artifact`, і `release-publish` завантажує згенеровану теку
 * назад перед `npm publish npm/package.json`.
 *
 * sha256 у `builtin-pins.json` рахується від байтів ставленої (скопійованої)
 * копії у `npm/wasm-plugins/` — той самий вміст, що піде в опублікований
 * пакет; `wasm-plugins.mjs` звіряє саме цей hash при кожному резолві
 * (захист від пошкодженої інсталяції, доккомент модуля).
 *
 * Після копіювання, ДО рахунку sha256, [`buildAndStage`] вбудовує
 * авторитетний маніфест у staged-копію командою `n-rules plugin
 * embed-manifest` (`crates/rules-cli/src/plugin_cmd.rs`, Д2, PR #618) — той
 * самий крок, що замикає обхід `declared_worlds` у `crates/rules-napi/src/
 * lib.rs` (спека `docs/specs/2026-08-31-plugin-contract-v5.md` §8): без
 * вбудованого маніфесту хост НЕ зможе прочитати `worlds` компонента без
 * інстанціації й гучно відмовить (`declared_worlds` там, доккомент
 * `missing_component_manifest_err`), тож цей крок — не косметика, а
 * передумова робочого `.wasm` у `npm/wasm-plugins/`.
 *
 * `spawnFn`/`wasmPluginsDir`/`repoRoot` — ін'єкції для тестів
 * (`npm/scripts/tests/build-wasm-plugins.test.mjs`), той самий DI-мотив, що
 * `release-smoke.mjs`: юніт-тести підміняють `cargo`/`build.sh` фейковим
 * `spawnFn` замість реального тулчейну, `main()` виконується автоматично
 * лише при прямому запуску як CLI (`isRunAsCli`, `cli-entry.mjs`) — імпорт
 * модуля тестами не тригерить побічний ефект реальної збірки.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isRunAsCli } from './cli-entry.mjs'
import { resolveRulesCliBin } from './utils/test-helpers.mjs'

const NPM_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(NPM_ROOT, '..')

/** Дефолтний абсолютний шлях до `npm/wasm-plugins/` — та сама тека, яку читає `wasm-plugins.mjs` (`WASM_PLUGINS_DIR`). */
export const WASM_PLUGINS_DIR = join(NPM_ROOT, 'wasm-plugins')

/**
 * First-party wasm-плагіни, вбудовані піни для яких CLI шипить у пакеті
 * (рішення Н) — `lang-js` (задача N2, `crates/plugin-lang-js`), `lang-python`
 * (перша хвиля порту `plugins/lang-python`, `crates/plugin-lang-python`),
 * `lang-rust` (перша хвиля порту `plugins/lang-rust`, `crates/plugin-lang-rust`),
 * `lang-php` (одна хвиля порту всіх п'яти концернів
 * `plugins/lang-php/rules/php/{tooling,composer_manifest,project,mago_fmt,
 * mago_lint}`, `crates/plugin-lang-php`) і `ci-github` (ПЕРШИЙ НЕ-lang
 * first-party гість, одна хвиля порту ОДНОГО концерну
 * `plugins/ci-github/rules/rust/toolchain_cache`, `crates/plugin-ci-github`
 * — `name` тут короткий package-суфікс `@7n/rules-ci-github`, той самий
 * мотив, що `lang-js`/`lang-python`/`lang-rust`/`lang-php`, доккомент
 * `crates/plugin-ci-github/plugin.toml`) і `ci-azure` (ШОСТИЙ гість, перша
 * хвиля порту ДВОХ концернів `plugins/ci-azure/rules/azure-pipelines/
 * {lint_pipeline,vscode_extensions}`, `crates/plugin-ci-azure` — той самий
 * `name`-мотив, `@7n/rules-ci-azure`).
 * Новий first-party плагін додається одним рядком тут; той самий реєстр
 * читає й CI-крок (той самий скрипт, `node npm/scripts/build-wasm-plugins.mjs`).
 * @type {Array<{ name: string, crateDir: string }>}
 */
export const FIRST_PARTY_WASM_PLUGINS = [
  { name: 'lang-js', crateDir: 'crates/plugin-lang-js' },
  { name: 'lang-python', crateDir: 'crates/plugin-lang-python' },
  { name: 'lang-rust', crateDir: 'crates/plugin-lang-rust' },
  { name: 'lang-php', crateDir: 'crates/plugin-lang-php' },
  { name: 'ci-github', crateDir: 'crates/plugin-ci-github' },
  { name: 'ci-azure', crateDir: 'crates/plugin-ci-azure' }
]

/**
 * Ціль Component Model, під яку зібрані first-party плагіни (доккомент
 * `build.sh`) — `wasm32-wasip3` від хвилі міграції на WASI 0.3 (спека
 * `docs/specs/2026-08-31-plugin-contract-v5.md`, розділ 10.1, крок 4
 * порядку реалізації); до цієї хвилі було `wasm32-wasip2`.
 */
const WASM_TARGET = 'wasm32-wasip3'

/** `name = "..."` у першому рядку-збігу `Cargo.toml` — той самий парсинг, що `build.sh` (`grep -m1 '^name'`). */
const CARGO_PACKAGE_NAME_RE = /^name\s*=\s*"([^"]+)"/m

/**
 * Ім'я cargo-пакета крейта — з `Cargo.toml`, той самий парсинг, що
 * `build.sh` (`grep -m1 '^name'`), щоб wasm-stem (`name` з дефісами,
 * замінені на підкреслення — cargo-конвенція виводу артефакту) не розходився
 * з тим, що реально зібрав `cargo build`.
 * @param {string} crateDir абсолютний шлях до крейта
 * @returns {string} ім'я пакета (`plugin-lang-js`, з дефісами — саме так називається staged-копія в `npm/wasm-plugins/`)
 */
export function readCargoPackageName(crateDir) {
  const cargoToml = readFileSync(join(crateDir, 'Cargo.toml'), 'utf8')
  const match = CARGO_PACKAGE_NAME_RE.exec(cargoToml)
  if (!match) throw new Error(`не вдалось прочитати "name" з ${crateDir}/Cargo.toml`)
  return match[1]
}

/**
 * `target_directory` крейта через `cargo metadata` — той самий канон, що
 * `build.sh` (доккомент файлу: працює і для крейта-члена workspace, і для
 * самостійного репозиторію), тож обчислюємо тут же, без хардкоду
 * `../../target`.
 * @param {string} crateDir абсолютний шлях до крейта
 * @param {typeof spawnSync} [spawnFn] ін'єкція для тестів (дефолт — реальний `spawnSync`)
 * @returns {string} абсолютний шлях `target_directory`
 */
export function readCargoTargetDir(crateDir, spawnFn = spawnSync) {
  const result = spawnFn('cargo', ['metadata', '--no-deps', '--format-version=1'], {
    cwd: crateDir,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error(`cargo metadata впав для ${crateDir}: ${result.stderr || result.error?.message}`)
  }
  return JSON.parse(result.stdout).target_directory
}

/**
 * Вбудовує авторитетний маніфест у staged-копію (`n-rules plugin
 * embed-manifest --crate-dir <crateDir> --package <name> --component
 * <destPath>`, доккомент модуля) — на місці, БЕЗ `--out` (дефолт команди
 * перезаписує `--component`). `cliBin` — резолвиться через
 * [`resolveRulesCliBin`] (`npm/scripts/utils/test-helpers.mjs`), той самий
 * каскад, що parity-гейти `rules-cli` вже використовують: явний
 * `N_RULES_CLI_BIN` → зібраний `target/{release,debug}/rules-cli`, гучна
 * відмова з підказкою, якщо жодного немає (без мовчазного skip — інакше
 * staged `.wasm` лишився б без маніфесту, і фікс `declared_worlds` у
 * `crates/rules-napi` мовчки не спрацював би для щойно зібраного плагіна).
 * @param {{ name: string, crateDir: string }} plugin запис [`FIRST_PARTY_WASM_PLUGINS`]
 * @param {string} crateDir абсолютний шлях крейта гостя
 * @param {string} destPath абсолютний шлях staged-копії `.wasm`
 * @param {{ spawnFn: typeof spawnSync, cliBin?: string }} opts `spawnFn` — та сама ін'єкція, що [`buildAndStage`]; `cliBin` — тестова ін'єкція (дефолт [`resolveRulesCliBin`])
 * @returns {void}
 */
function embedManifest(plugin, crateDir, destPath, opts) {
  const cliBin = opts.cliBin ?? resolveRulesCliBin()
  console.log(`== n-rules plugin embed-manifest (${plugin.name}) ==`)
  const result = opts.spawnFn(
    cliBin,
    ['plugin', 'embed-manifest', '--crate-dir', crateDir, '--package', plugin.name, '--component', destPath],
    { cwd: crateDir, stdio: 'inherit' }
  )
  if (result.status !== 0) {
    throw new Error(
      `n-rules plugin embed-manifest для "${plugin.name}" впав (exit ${result.status ?? result.error?.message})`
    )
  }
}

/**
 * Збирає один first-party плагін (`build.sh` крейта), копіює артефакт у
 * `<wasmPluginsDir>/<package-name>.wasm` і вбудовує в цю копію авторитетний
 * маніфест ([`embedManifest`]) — ДО рахунку sha256, щоб пін покривав саме
 * той вміст, що піде в опублікований пакет (доккомент модуля).
 * @param {{ name: string, crateDir: string }} plugin запис [`FIRST_PARTY_WASM_PLUGINS`]
 * @param {{ spawnFn?: typeof spawnSync, repoRoot?: string, wasmPluginsDir?: string, cliBin?: string }} [opts] ін'єкції для тестів
 * @returns {{ name: string, file: string, sha256: string }} запис для `builtin-pins.json`
 */
export function buildAndStage(plugin, opts = {}) {
  const spawnFn = opts.spawnFn ?? spawnSync
  const wasmPluginsDir = opts.wasmPluginsDir ?? WASM_PLUGINS_DIR
  const crateDir = join(opts.repoRoot ?? REPO_ROOT, plugin.crateDir)
  const buildScript = join(crateDir, 'build.sh')
  console.log(`== ${plugin.crateDir}/build.sh ==`)
  const buildResult = spawnFn(buildScript, [], { cwd: crateDir, stdio: 'inherit' })
  if (buildResult.status !== 0) {
    throw new Error(`build.sh для "${plugin.name}" впав (exit ${buildResult.status ?? buildResult.error?.message})`)
  }

  const pkgName = readCargoPackageName(crateDir)
  const wasmStem = pkgName.replaceAll('-', '_')
  const targetDir = readCargoTargetDir(crateDir, spawnFn)
  const builtWasmPath = join(targetDir, WASM_TARGET, 'release', `${wasmStem}.wasm`)
  if (!existsSync(builtWasmPath)) throw new Error(`очікуваний артефакт не знайдено: ${builtWasmPath}`)

  mkdirSync(wasmPluginsDir, { recursive: true })
  const destFile = `${pkgName}.wasm`
  const destPath = join(wasmPluginsDir, destFile)
  copyFileSync(builtWasmPath, destPath)

  embedManifest(plugin, crateDir, destPath, { spawnFn, cliBin: opts.cliBin })

  const sha256 = createHash('sha256').update(readFileSync(destPath)).digest('hex')
  console.log(`OK: ${destFile} (sha256 ${sha256})`)
  return { name: plugin.name, file: destFile, sha256 }
}

/**
 * Точка входу — збирає всі `plugins` (дефолт [`FIRST_PARTY_WASM_PLUGINS`]) і
 * пише `builtin-pins.json` у `wasmPluginsDir`.
 * @param {Array<{ name: string, crateDir: string }>} [plugins] реєстр плагінів (тестова ін'єкція)
 * @param {{ spawnFn?: typeof spawnSync, repoRoot?: string, wasmPluginsDir?: string }} [opts] ін'єкції для тестів (ті самі, що [`buildAndStage`])
 * @returns {string} абсолютний шлях до записаного `builtin-pins.json`
 */
export function main(plugins = FIRST_PARTY_WASM_PLUGINS, opts = {}) {
  const wasmPluginsDir = opts.wasmPluginsDir ?? WASM_PLUGINS_DIR
  /** @type {Record<string, { file: string, sha256: string }>} */
  const pins = {}
  for (const plugin of plugins) {
    const { name, file, sha256 } = buildAndStage(plugin, opts)
    pins[name] = { file, sha256 }
  }
  const pinsPath = join(wasmPluginsDir, 'builtin-pins.json')
  writeFileSync(pinsPath, `${JSON.stringify(pins, null, 2)}\n`, 'utf8')
  console.log(`\n📦 ${pinsPath} (${Object.keys(pins).length} плагін(и))`)
  return pinsPath
}

if (isRunAsCli(import.meta.url)) main()
