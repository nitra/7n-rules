/**
 * Parity-тест wasm-плагіна `plugin-ci-github` — П'ЯТОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`,
 * другий — `plugin-lang-python`, третій — `plugin-lang-rust`, четвертий —
 * `plugin-lang-php`, `wasm-plugin-parity-php.test.mjs`): звіряє
 * `runWasmConcern` napi-мосту (`crates/rules-napi` → `crates/plugin-ci-github`)
 * із ЕТАЛОНОМ — знятим виводом JS-детекторів
 * `plugins/ci-github/rules/{rust/toolchain_cache,ga/workflows}/main.mjs`
 * (reason/message/file/severity/data біт-у-біт) — для обох концернів однієї
 * хвилі.
 *
 * ЕТАЛОН, НЕ ЖИВИЙ КАНОН: обидва `main.mjs` — транзитивний шар Plugin API v2,
 * що видаляється разом із портом (мета цього тестового файлу — довести порт,
 * не тримати JS вічно), той самий прийом, що `wasm-plugin-parity-php.test.mjs`
 * (lang-php, четверта хвиля цього самого переходу) і
 * `wasm-plugin-parity-rust.test.mjs` (lang-rust, третя хвиля). Поки він живий,
 * зняти еталон можна прогнавши суїт з `N_WASM_PARITY_CAPTURE=1`; звичайний
 * прогін JS НЕ викликає — читає зафіксований раніше вивід із
 * `fixtures/wasm-parity/ci-github/*.json` ([`goldenJs`], `wasm-parity-golden.mjs`
 * — спільний шар з рештою wasm-parity-гейтів, доккомент там). Відсутній
 * еталон — ПАДІННЯ тесту з явним проханням перезняти, повернувши `main.mjs`
 * з історії, не мовчазний пропуск: інакше зникнення канону не дало б жодного
 * сигналу.
 *
 * Bucket-и еталонів — `ci-github/toolchain_cache` і `ci-github/workflows`
 * (ВЛАСНИЙ префікс `ci-github/`, не `ruleId/concernId` за замовчуванням, як у
 * php/rust-гейтів): `rust/toolchain_cache`-концерн ЦЬОГО плагіна і
 * `rust/*`-концерни `plugin-lang-rust` інакше лягли б в один і той самий
 * підкаталог `fixtures/wasm-parity/rust/` — різні файли (колізії імені
 * файлу не було б), але спільна тека двох НЕЗАЛЕЖНИХ гостей затерла б межу
 * власності. Свій підкаталог `ci-github/` — та сама модель, що дала кожному
 * попередньому гостю власний префікс (`js/`, `python/`, `rust/`, `php/`).
 *
 * ДВІ хвилі порту, ДВА `describe`-блоки нижче:
 * - `rust/toolchain_cache` (перша хвиля) — full-scope, БЕЗ жодного
 *   `exec-tool` (на відміну від `php/project`/`php/composer_manifest` —
 *   жодного фейкового бінарника тут не потрібно): JS-канон читає диск
 *   напряму (`readdir`/`existsSync`), тож
 *   `lint({ cwd: dir, ruleId: 'rust', concernId: 'toolchain_cache' })`
 *   викликається БЕЗ `files` — той самий контракт, що `php/tooling`
 *   (`runFullScopeBoth`, `wasm-plugin-parity-php.test.mjs`), лише простіший
 *   (нема відомої «process.cwd() замість ctx.cwd»-вади, яку той канон мав:
 *   `main.mjs` тут скрізь коректно `join(cwd, …)`, звірено читанням джерела).
 * - `ga/workflows` (друга хвиля, найбільший один концерн усієї міграції —
 *   доккомент `crates/plugin-ci-github/src/lib.rs`) — full-scope, ЧОТИРИ
 *   `exec-tool`-інтеграції (`git`/`github-actionlint`/`uvx`/`shellcheck`) +
 *   851 рядок Rego, що виконується IN-PROCESS через regorus (жодного
 *   фейкового бінарника ДЛЯ REGO не потрібно — лише для зовнішніх тулів).
 *   `ci_artifact/consume` і решта `ga/*` СВІДОМО поза обсягом.
 *
 * Порядок workflow-файлів у batch між JS `readdir` і host `walk_dir` НЕ
 * гарантовано збігається (доккомент `crates/plugin-ci-github/src/lib.rs`,
 * розділ «Порядок workflow-файлів»)  — кожен сценарій тут пише РІВНО ОДИН
 * (чи один МУТОВАНИЙ) workflow-файл понад канонічний набір, той самий обсяг,
 * що власний JS-тест канону (`toolchain_cache.test.mjs`/`workflows.test.mjs`),
 * де «другий job не впливає на перший» теж перевіряється в межах ОДНОГО файла.
 *
 * `ga/workflows`: `actionlint`/`zizmor` — ОБИДВІ реалізації ДЕТЕРМІНОВАНО
 * пропускають цей крок (JS-бік: `bunx`/`uvx` вирізані з `PATH` перед
 * викликом `lint()`, той самий skip-канал, що відсутність тулу в CI;
 * wasm-бік: відповідні ключі просто відсутні в `toolPaths`, `exec-tool`
 * дає `status: none`) — `actionlint`/`zizmor` reason-и відфільтровано з
 * порівняння як захисний прошарок (`EXTERNAL_TOOL_REASONS`, той самий
 * прийом, що `workflows.test.mjs::mainStructural`), не тому що вони можуть
 * розійтися. `shellcheck` — СПІЛЬНИЙ фейковий стаб (`withBinStubInPath`,
 * `../../../utils/test-helpers.mjs`) у сценаріях, де він явно потрібен;
 * `git` — РЕАЛЬНИЙ системний бінарник (детермінований `git ls-files` проти
 * реального tmp git-репо, той самий підхід, що `workflows.test.mjs`).
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { env } from 'node:process'
import { pathToFileURL } from 'node:url'

import { describe, expect, test, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, stagedWasmPath, withBinRemovedFromPath, withTmpDir } from '../../../utils/test-helpers.mjs'
import { resolveCmd } from '../../../utils/resolve-cmd.mjs'
import { createGoldenJs } from './wasm-parity-golden.mjs'
import { WASM_SIZE_BUDGET_BYTES, WASM_SIZE_BUDGET_LABEL } from './wasm-size-budget.mjs'

// `ga/workflows`'s `lint()` викликає СИНХРОННИЙ `ensureTool('shellcheck')`/
// `ensureTool('conftest')` (Plugin API v2 preflight, `main.mjs:398-399`) БЕЗУМОВНО на
// самому початку — реальний `ensureTool` на машині без резолвленого PATH-бінарника
// намагається `brew install` (мережа, змінює dev-машину, недетерміновано в CI). Мокнуто
// на no-op (той самий прийом, що `wasm-plugin-parity-php.test.mjs`): тести цього файлу
// керують доступністю shellcheck ЛИШЕ через реальний `PATH` (`withBinRemovedFromPath`/
// спільний фейковий стаб), не через побічний ефект `ensureTool`. `checkShellcheckInstalled`
// (окрема, пізніша перевірка канону) і далі читає РЕАЛЬНИЙ `resolveCmd('shellcheck')` —
// немокнутий. `ensureToolAsync` (АСИНХРОННИЙ) лишається РЕАЛЬНИМ (`importOriginal`) —
// саме він резолвить справжній `conftest` для `runConftestBatch` (rego-крок канону
// й далі спавнить conftest по-справжньому; wasm-порт замінює цей субпроцес на regorus,
// доккомент `crates/plugin-ci-github/src/lib.rs`, розділ «Regorus замість conftest»).
vi.mock('@7n/rules/scripts/lib/ensure-tool.mjs', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, ensureTool: vi.fn() }
})

const REPO_ROOT = realRepoRoot()
const WASM_PATH = stagedWasmPath('plugin-ci-github')


const MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'ci-github', 'rules', 'rust', 'toolchain_cache', 'main.mjs')
const CONCERN_KEY = 'rust/toolchain_cache'

const WORKFLOWS_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'ci-github', 'rules', 'ga', 'workflows', 'main.mjs')
const WORKFLOWS_CONCERN_KEY = 'ga/workflows'


// ---------------------------------------------------------------------
// Шар еталонів ([`goldenJs`], `wasm-parity-golden.mjs`): JS-детектори
// `plugins/ci-github/rules/{rust/toolchain_cache,ga/workflows}/main.mjs` —
// транзитивний канон Plugin API v2, що видаляється разом із портом.
// Механізм (кеш, лічильники, плейсхолдер tmp-шляху, помилка відсутнього
// еталона) — СПІЛЬНИЙ з рештою wasm-parity-гейтів, винесений у
// `wasm-parity-golden.mjs`; тут лишається лише `goldenJs`, звʼязаний із
// ЦИМ файлом як підказкою команди перезняття, і власні bucket-и (доккомент
// модуля, розділ «Bucket-и еталонів»).
const goldenJs = createGoldenJs({
  captureHintPath: 'npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-ci-github.test.mjs'
})
/** Bucket еталонів `rust/toolchain_cache` — `ci-github/`-префікс, не `ruleId/concernId` (доккомент модуля). */
const TOOLCHAIN_CACHE_GOLDEN_BUCKET = 'ci-github/toolchain_cache'
/** Bucket еталонів `ga/workflows` — той самий `ci-github/`-префікс. */
const WORKFLOWS_GOLDEN_BUCKET = 'ci-github/workflows'
// ---------------------------------------------------------------------

/**
 * Виставляє дефолт `severity: 'error'`, якщо ключ відсутній — той самий
 * normalize-крок, що в решти чотирьох parity-файлів: raw JS `lint()` опускає
 * дефолтне поле, WIT `record diagnostic.severity` не опційне.
 * @param {unknown[]} violations сирі violations (JS чи wasm)
 * @returns {unknown[]} ті самі violations із заповненим `severity`
 */
function withDefaultSeverity(violations) {
  return violations.map(v => ({ severity: 'error', ...v }))
}

/**
 * Пише workflow-файл у `<dir>/.github/workflows/<name>`.
 * @param {string} dir абсолютний шлях tmp-каталогу
 * @param {string} name ім'я файла
 * @param {string} content вміст
 * @returns {Promise<void>}
 */
async function writeWorkflow(dir, name, content) {
  const wfDir = join(dir, '.github', 'workflows')
  await mkdir(wfDir, { recursive: true })
  await writeFile(join(wfDir, name), content, 'utf8')
}

/**
 * Ганяє `rust/toolchain_cache` (full-scope, БЕЗ `exec-tool`) через еталон
 * ([`goldenJs`]) і `runWasmConcern` з `files: null` (host сам будує batch за
 * `ConcernContribution::glob` — `.github/workflows/*.{yml,yaml}` +
 * `Cargo.toml`/`src-tauri/Cargo.toml`, доккомент `plugin.toml`).
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runToolchainCacheBoth(dir) {
  const js = await goldenJs(TOOLCHAIN_CACHE_GOLDEN_BUCKET, dir, async () => {
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(MAIN_MJS_PATH).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId: 'toolchain_cache' })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, CONCERN_KEY, dir, null)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

const NO_CACHE_YML = `name: Release
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: tauri-apps/tauri-action@v0
`

const WITH_CACHE_YML = `name: Lint
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all -- --check
`

describe('wasm-plugin parity — rust/toolchain_cache (JS канон vs wasm plugin-ci-github, без exec-tool)', () => {
  test('.github/workflows відсутній — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('job з dtolnay/rust-toolchain без Swatinem/rust-cache — однакове missing-rust-cache', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(dir, 'release.yml', NO_CACHE_YML)
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-rust-cache')
      expect(js[0].file).toBe('.github/workflows/release.yml')
      expect(js[0].data).toEqual({ kind: 'missing-rust-cache' })
    })
  })

  test('job з Swatinem/rust-cache одразу після — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(dir, 'lint-rust.yml', WITH_CACHE_YML)
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('.yaml розширення теж опрацьовується — однакове missing-rust-cache', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(dir, 'release.yaml', NO_CACHE_YML)
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-rust-cache')
    })
  })

  test('другий job у тому самому файлі не впливає на перший (job-межа через indentation)', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(
        dir,
        'ci.yml',
        `name: CI
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: tauri-apps/tauri-action@v0
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.filter(v => v.reason === 'missing-rust-cache')).toHaveLength(1)
    })
  })

  test('toolchain-крок — останній рядок файла (кінець jobs:, без trailing newline) — однакове missing-rust-cache', async () => {
    await withTmpDir(async dir => {
      const wfDir = join(dir, '.github', 'workflows')
      await mkdir(wfDir, { recursive: true })
      await writeFile(
        join(wfDir, 'release.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable',
        'utf8'
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-rust-cache')
    })
  })

  test('порожній рядок між toolchain- і cache-кроком не ламає скан — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(
        dir,
        'ci.yml',
        `jobs:
  build:
    steps:
      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('Tauri-job без root Cargo.toml, з src-tauri/Cargo.toml — однакове missing-rust-cache-workspaces', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src-tauri'), { recursive: true })
      await writeFile(join(dir, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n', 'utf8')
      await writeWorkflow(
        dir,
        'release.yml',
        `name: Release
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - uses: tauri-apps/tauri-action@v0
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-rust-cache-workspaces')
      expect(js[0].data).toEqual({ kind: 'missing-rust-cache-workspaces', workspaceDir: 'src-tauri' })
    })
  })

  test('Tauri-job, cache-крок уже має with.workspaces — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src-tauri'), { recursive: true })
      await writeFile(join(dir, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n', 'utf8')
      await writeWorkflow(
        dir,
        'release.yml',
        `jobs:
  build:
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - uses: tauri-apps/tauri-action@v0
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('Tauri-job, root Cargo.toml присутній (не Tauri-layout) — workspaces-перевірка пропускається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]\n', 'utf8')
      await writeWorkflow(
        dir,
        'release.yml',
        `jobs:
  build:
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - uses: tauri-apps/tauri-action@v0
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

// =====================================================================
// `ga/workflows` (друга хвиля порту, доккомент модуля).
// =====================================================================

/** `reason`-и зовнішніх тулів, детерміновано пропущені в обох реалізаціях (доккомент модуля). */
// `*-unavailable` (§2.29) — НОВИЙ канал: до фіксу гість МОВЧАВ, коли тул не
// запустився (`status: none` чи код 127), тепер дає видиму діагностику. Цей
// гейт саме в такому середовищі й працює (тули навмисно вирізані з PATH),
// тож ці reason-и фільтруються з тієї самої причини, що й базові два: гейт
// перевіряє rego-логіку концерну, а не канал доступності зовнішніх тулів.
// Сам канал покрито unit-тестами гостя (`crates/plugin-ci-github/src/lib.rs`).
const EXTERNAL_TOOL_REASONS = new Set([
  'actionlint',
  'zizmor',
  'actionlint-unavailable',
  'zizmor-unavailable'
])

/**
 * Виставляє дефолт `severity: 'error'` — той самий normalize-крок, що
 * [`withDefaultSeverity`] toolchain_cache-блоку вище; окрема копія тут,
 * бо `ga/workflows`-блок фільтрує ще й `EXTERNAL_TOOL_REASONS`.
 * @param {unknown[]} violations сирі violations (JS чи wasm)
 * @returns {unknown[]} ті самі violations із заповненим `severity`, без actionlint/zizmor
 */
/**
 * `ga.workflow_common` rego-повідомлення канон префіксує АБСОЛЮТНИМ `v.filename`
 * (`main.mjs::runAllGaRego`: `fail(`${v.filename}: ${v.message}`, …)` — `v.filename`
 * тут ще НЕ пройшов `relative(cwd, …)`), тоді як wasm-порт префіксує
 * `SourceFile.path` — контрактно ЗАВЖДИ posix-relative (`wit/world.wit::source-file`,
 * доккомент `push_rego_violation` у `crates/plugin-ci-github/src/lib.rs`).
 * СТРУКТУРНА розбіжність, не помилка порту: wasm-плагін не бачить і не може бачити
 * абсолютний шлях tmp-фікстури хост-процесу. Нормалізує ЛИШЕ JS-бік перед
 * порівнянням — той самий tmp-каталог, що передається як `ctx.cwd`.
 * @param {string} message сире повідомлення (JS чи wasm)
 * @param {string} dir абсолютний шлях tmp-каталогу фікстури (`ctx.cwd`)
 * @returns {string} повідомлення без абсолютного префікса `dir/`
 */
function stripAbsoluteDirPrefix(message, dir) {
  return message.startsWith(`${dir}/`) ? message.slice(dir.length + 1) : message
}

function normalizeWorkflowsViolations(violations, dir) {
  return violations
    .map(v => ({ severity: 'error', ...v, message: dir ? stripAbsoluteDirPrefix(v.message, dir) : v.message }))
    .filter(v => !EXTERNAL_TOOL_REASONS.has(v.reason))
}

/**
 * Пише файл у `dir/rel`, створюючи батьківські каталоги.
 * @param {string} dir абсолютний шлях tmp-каталогу
 * @param {string} rel posix-relative шлях усередині `dir`
 * @param {string} content вміст файлу
 * @returns {Promise<void>}
 */
async function writeFileDeep(dir, rel, content) {
  const abs = join(dir, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

/**
 * Пише виконуваний sh-скрипт (фейковий зовнішній тул) і повертає його шлях.
 * @param {string} path абсолютний шлях майбутнього бінарника
 * @param {string} body тіло скрипта разом із shebang
 * @returns {Promise<string>} той самий `path`
 */
async function writeFakeTool(path, body) {
  await writeFile(path, body, 'utf8')
  await chmod(path, 0o755)
  return path
}

/**
 * Мінімальний канонічний ga-проєкт (доккомент `workflows.test.mjs::setupCanonicalGaProject`,
 * ТОЧНИЙ вміст чотирьох template-снапшотів канону — узгоджено з
 * `crates/plugin-ci-github/src/lib.rs`'s embedded `*_SNIPPET_YML`, тож рего-частина
 * для ВСІХ чотирьох per-workflow policy і `workflow_common` чиста «з коробки»):
 * `.github/workflows/{clean-ga-workflows,clean-merged-branch,lint-ga,git-ai}.yml`,
 * `.github/actions/setup-bun-deps/action.yml`, реальний git-репо (`git ls-files`
 * потребує трекованих файлів для `on.*.paths`-перевірок).
 * @param {string} dir абсолютний шлях тимчасового каталогу
 * @returns {Promise<void>}
 */
async function setupCanonicalWorkflowsProject(dir) {
  await writeFileDeep(
    dir,
    '.github/actions/setup-bun-deps/action.yml',
    'name: setup-bun-deps\nruns:\n  using: composite\n  steps: []\n'
  )
  await writeFileDeep(
    dir,
    '.github/workflows/clean-ga-workflows.yml',
    `name: Clean action for removing completed workflow runs
on:
  schedule:
    - cron: '0 1 16 * *'
  workflow_dispatch: {}
concurrency:
  group: \${{ github.ref }}-\${{ github.workflow }}
  cancel-in-progress: true
jobs:
  cleanup_old_workflows:
    runs-on: ubuntu-latest
    permissions:
      actions: write
      contents: read
    steps:
      - name: Delete workflow runs
        uses: dmvict/clean-workflow-runs@v1
        with:
          token: \${{ github.token }}
          save_period: 31
          save_min_runs_number: 0
`
  )
  await writeFileDeep(
    dir,
    '.github/workflows/clean-merged-branch.yml',
    `name: Clean abandoned branches
on:
  schedule:
    - cron: '0 1 15 * *'
  workflow_dispatch: {}
concurrency:
  group: \${{ github.ref }}-\${{ github.workflow }}
  cancel-in-progress: true
jobs:
  cleanup_old_branches:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: read
    steps:
      - id: delete_stuff
        name: Delete those pesky dead branches
        uses: phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3
        with:
          github_token: \${{ github.token }}
          last_commit_age_days: 90
          ignore_branches: main,dev
          dry_run: no
      - name: Get output
        env:
          DELETED_BRANCHES: \${{ steps.delete_stuff.outputs.deleted_branches }}
        run: |
          echo "Deleted branches: \${DELETED_BRANCHES}"
`
  )
  await writeFileDeep(
    dir,
    '.github/workflows/lint-ga.yml',
    `name: Lint GA
on:
  push:
    branches: [dev, main]
    paths:
      - '.github/actions/**'
      - '.github/workflows/**'
  pull_request:
    branches: [dev, main]
    paths:
      - '.github/actions/**'
      - '.github/workflows/**'
concurrency:
  group: \${{ github.ref }}-\${{ github.workflow }}
  cancel-in-progress: true
jobs:
  lint-ga:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup-bun-deps
      - uses: astral-sh/setup-uv@v8.0.0
      - name: Install conftest
        run: >-
          curl -fsSL
          https://github.com/open-policy-agent/conftest/releases/download/v0.62.0/conftest_0.62.0_Linux_x86_64.tar.gz
          | sudo tar -xz -C /usr/local/bin conftest
      - name: Lint GA
        run: bunx n-rules lint ga --no-fix
`
  )
  await writeFileDeep(
    dir,
    '.github/workflows/git-ai.yml',
    `name: Git AI
on:
  pull_request:
    types: [closed]
concurrency:
  group: \${{ github.ref }}-\${{ github.workflow }}
  cancel-in-progress: true
jobs:
  git-ai:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Install git-ai
        run: |
          curl -fsSL https://usegitai.com/install.sh | bash
      - name: Run git-ai
        run: |
          git-ai ci github run
`
  )
  const { execFileSync } = await import('node:child_process')
  // check-ga валідує `on.*.paths` через `git ls-files`; без git-репо ці перевірки
  // падають однаково для обох реалізацій (доккомент модуля) — ініціалізуємо
  // порожнє локальне репо й трекаємо щойно створені файли, той самий підхід,
  // що `workflows.test.mjs::setupCanonicalGaProject`.
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
}

/**
 * Готує tmp-каталог із фейковими `bunx`/`uvx`, що ЗАВЖДИ виходять з кодом
 * 127 — той самий сигнал "тул відсутній", що й `resolveCmd` не знайшов
 * бінарник (канон: `actionlintCode !== 0 && !== 127` / `zizmorCode !== 0 &&
 * !== 127`, обидва трактують 127 як skip). ПРЕПЕНДиться до PATH (не
 * фільтрує директорії) — на цій машині `bunx`/`uvx`/`git`/`shellcheck`/`brew`
 * усі живуть в одній `/opt/homebrew/bin`, тож директорійний фільтр
 * прибрав би їх УСІХ разом (емпірично зловлено: перша версія цього хелпера
 * фільтрувала директорії й ламала `ensureTool('shellcheck')`-preflight, бо
 * той самий каталог ніс і `brew`).
 * @returns {Promise<string>} абсолютний шлях tmp-каталогу зі стабами
 */
async function makePoisonedBunxUvxDir() {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(join(tmpdir(), 'n-rules-poison-bunx-uvx-'))
  await writeFakeTool(join(dir, 'bunx'), '#!/bin/sh\nexit 127\n')
  await writeFakeTool(join(dir, 'uvx'), '#!/bin/sh\nexit 127\n')
  return dir
}

/**
 * Ганяє `ga/workflows` (full-scope) через еталон ([`goldenJs`]) і wasm-порт
 * на СПІЛЬНОМУ стані: `git` — реальний системний бінарник (детерміновано,
 * доккомент модуля), `actionlint`/`zizmor` — детерміновано skip через
 * poison-стаби (`makePoisonedBunxUvxDir`), `shellcheck` — залежно від
 * `opts.shellcheck`: `'stub'` (дефолт) — СПІЛЬНИЙ фейковий стаб, і PATH-бік
 * (JS), і `toolPaths`-бік (wasm) отримують ТОЙ САМИЙ файл; `'absent'` —
 * реальний shellcheck вирізається з PATH (`withBinRemovedFromPath`),
 * `toolPaths` без ключа `shellcheck` — обидві реалізації бачать "тула немає".
 *
 * Фейкові `bunx`/`uvx`/`shellcheck` пишуться на диск БЕЗУМОВНО (не лише в
 * режимі зняття) — wasm-бік справді ВИКОНУЄ їх через `toolPaths` (`shellcheck`)
 * і PATH (host-бік `exec-tool` для `git`), тож вони мусять існувати і в
 * звичайному прогоні. Підміна `env.PATH` і сам виклик `lint()`, навпаки,
 * потрібні ЛИШЕ JS-канону — переїхали ВСЕРЕДИНУ `compute()` [`goldenJs`]
 * (той самий поділ, що `runCheckBoth` у `wasm-plugin-parity-rust.test.mjs`).
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @param {{ shellcheck?: 'stub' | 'absent' }} [opts] режим shellcheck-стану
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runWorkflowsBoth(dir, opts = {}) {
  const shellcheckMode = opts.shellcheck ?? 'stub'
  const toolPaths = {}
  const realGit = resolveCmd('git')
  if (realGit) toolPaths.git = realGit

  const poisonDir = await makePoisonedBunxUvxDir()
  let stubDir = null
  if (shellcheckMode === 'stub') {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    stubDir = await mkdtemp(join(tmpdir(), 'n-rules-shellcheck-stub-'))
    await writeFakeTool(join(stubDir, 'shellcheck'), '#!/bin/sh\nexit 0\n')
    toolPaths.shellcheck = join(stubDir, 'shellcheck')
  }

  try {
    const js = await goldenJs(WORKFLOWS_GOLDEN_BUCKET, dir, async () => {
      // Виконується ЛИШЕ в режимі зняття еталонів.
      const runJsLint = async () => {
        const originalPath = env.PATH
        try {
          env.PATH = stubDir
            ? `${stubDir}${delimiter}${poisonDir}${delimiter}${originalPath ?? ''}`
            : `${poisonDir}${delimiter}${originalPath ?? ''}`
          // eslint-disable-next-line no-unsanitized/method
          const { lint } = await import(pathToFileURL(WORKFLOWS_MAIN_MJS_PATH).href)
          const jsResult = await lint({ cwd: dir, ruleId: 'ga', concernId: 'workflows', files: undefined })
          return normalizeWorkflowsViolations(jsResult.violations, dir)
        } finally {
          if (originalPath === undefined) delete env.PATH
          else env.PATH = originalPath
        }
      }
      if (shellcheckMode !== 'absent') return runJsLint()
      // `withBinRemovedFromPath` не пропагує повернене значення `fn()`
      // (`test-helpers.mjs`) — результат кладемо в замикання.
      let jsViolations
      await withBinRemovedFromPath('shellcheck', async () => {
        jsViolations = await runJsLint()
      })
      return jsViolations
    })

    // `toolPaths.shellcheck` (`stubDir`) мусить лишатись на диску, поки wasm-виклик
    // не завершиться — cleanup ОБОВʼЯЗКОВО ПІСЛЯ обох реалізацій (перша версія
    // прибирала `stubDir` одразу після JS-виклику, ДО `runWasmConcern`: wasm-бік
    // `exec-tool("shellcheck", …)` тоді спавнив уже видалений файл і хибно давав
    // `status: none` — той самий стаб файл спільний для обох, доккомент нижче).
    const wasmResult = loadNative().runWasmConcern(WASM_PATH, WORKFLOWS_CONCERN_KEY, dir, null, toolPaths)
    const wasmViolations = normalizeWorkflowsViolations(wasmResult.violations)
    return { js, wasm: wasmViolations }
  } finally {
    const { rm } = await import('node:fs/promises')
    await rm(poisonDir, { recursive: true, force: true })
    if (stubDir) await rm(stubDir, { recursive: true, force: true })
  }
}

describe('wasm-plugin parity — ga/workflows (JS канон vs wasm plugin-ci-github, regorus + exec-tool)', () => {
  test('канонічний проєкт (4 workflow + setup-bun-deps + git-репо) — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await setupCanonicalWorkflowsProject(dir)
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('.github/workflows відсутній — однакова "Директорія … не існує"', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('Директорія .github/workflows не існує')
    })
  })

  test('лише stray.yaml у .github/workflows — однакові подвійна .yaml-violation + 4 required-workflow', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, '.github/workflows/stray.yaml', 'name: stray\n')
      const { execFileSync } = await import('node:child_process')
      execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
      execFileSync('git', ['add', '-A'], { cwd: dir })
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      // Доккомент `check_ga_workflow_files` (crates/plugin-ci-github/src/lib.rs):
      // канон дає ДВІ violation на цей ОДИН .yaml-файл.
      expect(js.filter(v => v.message.includes('stray.yaml'))).toHaveLength(2)
      expect(js.filter(v => v.message.startsWith('Відсутній .github/workflows/'))).toHaveLength(4)
    })
  })

  test('MegaLinter конфіг у корені репо — однакова MegaLinter-violation поверх канону', async () => {
    await withTmpDir(async dir => {
      await setupCanonicalWorkflowsProject(dir)
      await writeFile(join(dir, '.mega-linter.yml'), 'MEGALINTER_CONFIG:\n', 'utf8')
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('.mega-linter.yml')
    })
  })

  test('MegaLinter action у workflow — однакова MegaLinter-violation поверх канону', async () => {
    await withTmpDir(async dir => {
      await setupCanonicalWorkflowsProject(dir)
      await writeFileDeep(
        dir,
        '.github/workflows/megalint.yml',
        [
          'name: MegaLint',
          'on:',
          '  push:',
          '    branches: [main]',
          'concurrency:',
          '  group: ${{ github.ref }}-${{ github.workflow }}',
          '  cancel-in-progress: true',
          'jobs:',
          '  lint:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: oxsecurity/megalinter-action@v8',
          ''
        ].join('\n')
      )
      const { execFileSync } = await import('node:child_process')
      execFileSync('git', ['add', '-A'], { cwd: dir })
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.filter(v => v.message.includes('megalint.yml'))).toHaveLength(1)
    })
  })

  test('apply-k8s.yml без paths trigger — однакова apply-workflow-violation поверх канону', async () => {
    await withTmpDir(async dir => {
      await setupCanonicalWorkflowsProject(dir)
      await writeFileDeep(
        dir,
        '.github/workflows/apply-k8s.yml',
        [
          'name: Apply K8S',
          'on:',
          '  push:',
          '    branches: [main]',
          'concurrency:',
          '  group: ${{ github.ref }}-${{ github.workflow }}',
          '  cancel-in-progress: true',
          'jobs:',
          '  apply:',
          '    runs-on: ubuntu-latest',
          '    permissions:',
          '      contents: read',
          '    steps:',
          '      - uses: actions/checkout@v6',
          '        with:',
          '          persist-credentials: false',
          ''
        ].join('\n')
      )
      const { execFileSync } = await import('node:child_process')
      execFileSync('git', ['add', '-A'], { cwd: dir })
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual(['apply-k8s.yml не містить paths: **/k8s/**/*.yaml'])
    })
  })

  // SHA-піни `owner/action@<40-hex> # vX.Y.Z` (zizmor-політика ref-pin) замість тегів
  // (доккомент `workflows.test.mjs`) — rego перевіряє лише формат 40-hex, фейкові SHA достатні.
  const SHA_PINS = {
    'actions/checkout@v6': 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3',
    'astral-sh/setup-uv@v8.0.0': 'astral-sh/setup-uv@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v8.0.0',
    'dmvict/clean-workflow-runs@v1': 'dmvict/clean-workflow-runs@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v1',
    'phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3':
      'phpdocker-io/github-actions-delete-abandoned-branches@cccccccccccccccccccccccccccccccccccccccc # v2.0.3'
  }

  test('SHA-піновані uses (zizmor ref-pin) замість тегів — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await setupCanonicalWorkflowsProject(dir)
      for (const name of ['clean-ga-workflows.yml', 'clean-merged-branch.yml', 'lint-ga.yml']) {
        const file = join(dir, '.github/workflows', name)
        let content = await readFile(file, 'utf8')
        for (const [tagged, pinned] of Object.entries(SHA_PINS)) {
          content = content.split(tagged).join(pinned)
        }
        await writeFile(file, content, 'utf8')
      }
      const { execFileSync } = await import('node:child_process')
      execFileSync('git', ['add', '-A'], { cwd: dir })
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('відсутній setup-bun-deps/action.yml — однакова violation поверх канону', async () => {
    await withTmpDir(async dir => {
      await setupCanonicalWorkflowsProject(dir)
      const { rm } = await import('node:fs/promises')
      await rm(join(dir, '.github/actions'), { recursive: true, force: true })
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.filter(v => v.message.includes('setup-bun-deps/action.yml'))).toHaveLength(1)
    })
  })

  test('actions/checkout БЕЗ persist-credentials: false — однакова checkout-persist-credentials (workflow_common rego)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        '.github/workflows/other.yml',
        `name: Sample
on:
  push:
    branches: [main]
concurrency:
  group: \${{ github.ref }}-\${{ github.workflow }}
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
`
      )
      const { execFileSync } = await import('node:child_process')
      execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
      execFileSync('git', ['add', '-A'], { cwd: dir })
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      const persistViolations = js.filter(v => v.reason === 'checkout-persist-credentials')
      expect(persistViolations).toHaveLength(1)
      expect(persistViolations[0].file).toBe('.github/workflows/other.yml')
      expect(persistViolations[0].data).toEqual({ kind: 'checkout-persist-credentials' })
    })
  })

  test('bare `n-rules …` (без bunx) у run: — однакова bare-n-rules violation поверх канону', async () => {
    await withTmpDir(async dir => {
      await setupCanonicalWorkflowsProject(dir)
      const file = join(dir, '.github/workflows/lint-ga.yml')
      const content = await readFile(file, 'utf8')
      await writeFile(file, `${content}      - run: n-rules lint ga --no-fix\n`, 'utf8')
      const { execFileSync } = await import('node:child_process')
      execFileSync('git', ['add', '-A'], { cwd: dir })
      const { js, wasm } = await runWorkflowsBoth(dir)
      expect(wasm).toEqual(js)
      const bareViolations = js.filter(v => v.reason === 'bare-n-rules')
      expect(bareViolations).toHaveLength(1)
      expect(bareViolations[0].file).toBe('.github/workflows/lint-ga.yml')
      expect(bareViolations[0].data).toEqual({ kind: 'bare-n-rules' })
    })
  })

  test('shellcheck-стаб (СПІЛЬНИЙ фейковий бінарник, дефолтний режим) — обидві реалізації мовчать по shellcheck', async () => {
    await withTmpDir(async dir => {
      await setupCanonicalWorkflowsProject(dir)
      const { js, wasm } = await runWorkflowsBoth(dir, { shellcheck: 'stub' })
      expect(wasm).toEqual(js)
      expect(js.filter(v => v.message.includes('shellcheck'))).toEqual([])
    })
  })

  test('shellcheck відсутній (вирізаний з PATH) — однакова shellcheck-violation поверх канону', async () => {
    await withTmpDir(async dir => {
      // `withBinRemovedFromPath('shellcheck', …)` вирізає з PATH ВСЮ директорію, що
      // містить shellcheck — на цій машині та сама директорія (`/opt/homebrew/bin`)
      // несе й `conftest`, тож канонічний проєкт (що реально спавнить conftest у
      // rego-кроці) тут не підходить. Мінімальна фікстура БЕЗ жодного `.yml`-файла
      // (лише один сторонній `.yaml`) — `runAllGaRego` не досягає жодного
      // `runConftestBatch`-виклику (усі 4 per-workflow таргети відсутні per-file,
      // `ymlWorkflows` порожній — `workflow_common`-блок виходить раннім `return`,
      // доккомент `crates/plugin-ci-github/src/lib.rs::run_all_ga_rego`), тож
      // conftest/git тут не потрібні — ізолюємо ЛИШЕ shellcheck.
      await writeFileDeep(dir, '.github/workflows/placeholder.yaml', 'name: placeholder\n')
      const { js, wasm } = await runWorkflowsBoth(dir, { shellcheck: 'absent' })
      expect(wasm).toEqual(js)
      const shellcheckViolations = js.filter(v => v.message.includes('shellcheck'))
      expect(shellcheckViolations).toHaveLength(1)
      expect(shellcheckViolations[0].message).toContain('brew install shellcheck')
    })
  })
})

// --- ga/workflows: замикання T0-циклу через РЕАЛЬНИЙ napi-міст ---------
//
// §2.49 open-questions-register: `ga/workflows` — Т0-фіксер ПОРТОВАНО
// (`fix_workflows`, доккомент `crates/plugin-ci-github/src/lib.rs`, розділ
// «`ga/workflows` — Т0-фіксер ПОРТОВАНО»), концерн НЕ в `NATIVE_FIXES`
// (`crates/rules-core/src/concerns/fix.rs`) — production-шлях
// (`run-fix.mjs::loadT0Patterns`) ЗАВЖДИ веде через `wasmFixPattern` →
// `runWasmConcernFix` napi-міст. До цього сценарію жоден тест цього файлу не
// проганяв guest-фікс через РЕАЛЬНИЙ `runWasmConcernFix` — увесь
// describe-блок вище звіряє ЛИШЕ детект (`runWasmConcern`), фікс-контур
// (`fix_workflows`) не торкався жоден тест. Той самий клас прогалини, що
// закрила `test/no-bun-test-import`/`js/doc_comments`/`js/check` у
// `wasm-plugin-parity.test.mjs`, і `rust/cargo_mutants_config` +
// `rust/doc_comments` нижче в `wasm-plugin-parity-rust.test.mjs` (доккомент
// там).
//
// `bare-n-rules` — file-scoped violation (`diagnostic.file` ЗАВЖДИ
// заповнений [`verify_no_bare_n_cursor`]) — цикл НЕ проходить крізь
// full-scope fallback `run_wasm_concern_fix` (`crates/rules-napi/src/lib.rs`,
// той самий фолбек, що ловив баг #513 для whole-batch `js/check`); тест тут
// перевіряє file-scoped гілку моста (`target_files` з `diagnostic.file`,
// `read_source_files`) — саме той шлях, яким production реально фіксить
// `ga/workflows`.
describe('wasm-plugin — ga/workflows: T0-цикл через fix-міст (детект гостем → runWasmConcernFix → детект гостем чистий)', () => {
  test(
    'голий `n-rules …` (без bunx) у run: — runWasmConcernFix дописує bunx, повторний wasm-детект мовчить по bare-n-rules',
    async () => {
      await withTmpDir(async dir => {
        await writeFileDeep(
          dir,
          '.github/workflows/lint.yml',
          [
            'name: Lint',
            'on:',
            '  push:',
            '    branches: [main]',
            'concurrency:',
            '  group: ${{ github.ref }}-${{ github.workflow }}',
            '  cancel-in-progress: true',
            'jobs:',
            '  lint:',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - run: n-rules lint ga --no-fix',
            ''
          ].join('\n')
        )
        const { execFileSync } = await import('node:child_process')
        execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
        execFileSync('git', ['add', '-A'], { cwd: dir })

        // Порожній `toolPaths` — actionlint/zizmor/shellcheck дають
        // "tool-unavailable" (`file: None`, доккомент `push_tool_unavailable`),
        // жодна з цих діагностик не заважає `target_files` (лише
        // `bare-n-rules` несе `file` у цій фікстурі).
        const before = loadNative().runWasmConcern(WASM_PATH, WORKFLOWS_CONCERN_KEY, dir, null, {}).violations
        const bareBefore = before.filter(v => v.reason === 'bare-n-rules')
        expect(bareBefore).toHaveLength(1)
        expect(bareBefore[0].file).toBe('.github/workflows/lint.yml')

        const plan = loadNative().runWasmConcernFix(WASM_PATH, WORKFLOWS_CONCERN_KEY, dir, before, {})
        const edit = plan.edits.find(e => e.path === '.github/workflows/lint.yml')
        expect(edit).toBeDefined()
        expect(edit.type).toBe('write')
        expect(edit.content).toContain('run: bunx n-rules lint ga --no-fix')
        expect(edit.content).not.toMatch(/run: n-rules/)

        for (const e of plan.edits) {
          if (e.type === 'write') await writeFile(join(dir, e.path), e.content, 'utf8')
        }

        const after = loadNative().runWasmConcern(WASM_PATH, WORKFLOWS_CONCERN_KEY, dir, null, {}).violations
        expect(after.filter(v => v.reason === 'bare-n-rules')).toEqual([])
      })
    }
  )
})

// --- Третя хвиля: три policy-концерни, T0-цикл через РЕАЛЬНИЙ napi-міст ---
//
// Той самий прийом, що блок вище для `ga/workflows` (detect гостем →
// runWasmConcernFix → застосування правок → detect гостем знову, чистий),
// для КОЖНОГО з трьох нових full-scope концернів (доккомент задачі, розділ
// «Обовʼязкова послідовність», пункт 3: парність доводиться через РЕАЛЬНИЙ
// napi-міст, не прямий виклик гостя — юніт-тести `crates/plugin-ci-github`
// звіряють ТУ САМУ поведінку прямим викликом Rust-функцій, цей блок — щe
// раз, крізь увесь bridge, як production-шлях `run-fix.mjs::wasmFixPattern`).
describe('wasm-плагін plugin-ci-github — третя хвиля: T0-цикл через fix-міст', () => {
  test('ga/vscode_extensions: файл відсутній — fix створює recommendations, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      const before = loadNative().runWasmConcern(WASM_PATH, 'ga/vscode_extensions', dir, null, {}).violations
      expect(before).toHaveLength(1)
      expect(before[0].reason).toBe('policy-file-missing')

      const plan = loadNative().runWasmConcernFix(WASM_PATH, 'ga/vscode_extensions', dir, before, {})
      const edit = plan.edits.find(e => e.path === '.vscode/extensions.json')
      expect(edit).toBeDefined()
      expect(edit.content).toContain('github.vscode-github-actions')

      await mkdir(join(dir, '.vscode'), { recursive: true })
      await writeFile(join(dir, edit.path), edit.content, 'utf8')

      const after = loadNative().runWasmConcern(WASM_PATH, 'ga/vscode_extensions', dir, null, {}).violations
      expect(after).toEqual([])
    })
  })

  test('ga/vscode_settings: наявний файл з локальним блоком — fix дописує канонічне поле, локальне лишається, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.vscode'), { recursive: true })
      const localContent = JSON.stringify({ 'editor.tabSize': 4 })
      await writeFile(join(dir, '.vscode', 'settings.json'), localContent, 'utf8')

      const before = loadNative().runWasmConcern(WASM_PATH, 'ga/vscode_settings', dir, null, {}).violations
      expect(before.length).toBeGreaterThan(0)
      expect(before[0].reason).toBe('policy-deny')

      const plan = loadNative().runWasmConcernFix(WASM_PATH, 'ga/vscode_settings', dir, before, {})
      const edit = plan.edits.find(e => e.path === '.vscode/settings.json')
      expect(edit).toBeDefined()
      const merged = JSON.parse(edit.content)
      expect(merged['editor.tabSize']).toBe(4)
      expect(merged['[github-actions-workflow]']['editor.defaultFormatter']).toBe('oxc.oxc-vscode')

      await writeFile(join(dir, edit.path), edit.content, 'utf8')
      const after = loadNative().runWasmConcern(WASM_PATH, 'ga/vscode_settings', dir, null, {}).violations
      expect(after).toEqual([])
    })
  })

  /**
   * Ціль задачі §2.5x (JSONC-хвиля — доккомент розділу «Справжня
   * JSONC-підтримка», `crates/plugin-ci-github/src/lib.rs`) крізь РЕАЛЬНИЙ
   * napi-міст, не прямий виклик гостя (доккомент задачі — прямий виклик уже
   * двічі ховав реальні вади мосту): `.vscode/settings.json` з JSONC
   * `//`-коментарем ПЕРЕД ключем раніше (звіт задачі §2.58, поправка) або
   * тихо псувався (сирий `//`-рядок зливався з сусіднім ключем у сміттєвий
   * YAML-ключ), або (floor §2.58) взагалі не чіпався. Тепер —
   * `runWasmConcern` детектить `policy-deny` (файл РЕАЛЬНО читається),
   * `runWasmConcernFix` дає хірургічну правку — коментар і локальне
   * налаштування (`my.local`) лишаються байт-у-байт, канонічний блок
   * дописаний, повторний детект чистий.
   */
  test('ga/vscode_settings: JSONC-коментар (`//` перед ключем) — хірургічний merge крізь napi-міст, коментар і локальні налаштування збережені', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.vscode'), { recursive: true })
      const jsonc = [
        '{',
        '  // коментар перед ключем',
        '  "editor.formatOnSave": true,',
        '  "my.local": 42',
        '}',
        ''
      ].join('\n')
      await writeFile(join(dir, '.vscode', 'settings.json'), jsonc, 'utf8')

      const before = loadNative().runWasmConcern(WASM_PATH, 'ga/vscode_settings', dir, null, {}).violations
      expect(before.length).toBeGreaterThan(0)
      expect(before[0].reason).toBe('policy-deny')

      const plan = loadNative().runWasmConcernFix(WASM_PATH, 'ga/vscode_settings', dir, before, {})
      const edit = plan.edits.find(e => e.path === '.vscode/settings.json')
      expect(edit).toBeDefined()
      expect(edit.content).toContain('// коментар перед ключем')
      expect(edit.content).toContain('"editor.formatOnSave": true')
      expect(edit.content).toContain('"my.local": 42')
      expect(edit.content).toContain('"editor.defaultFormatter": "oxc.oxc-vscode"')

      await writeFile(join(dir, edit.path), edit.content, 'utf8')
      const after = loadNative().runWasmConcern(WASM_PATH, 'ga/vscode_settings', dir, null, {}).violations
      expect(after).toEqual([])
    })
  })

  test('security/lint_security_yml: наявний workflow з локальним кроком, без trufflehog — fix дописує канонічний крок, локальний лишається, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      const localWorkflow = [
        'name: Lint Security',
        'on:',
        '  push: {}',
        'jobs:',
        '  security:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: local-step',
        '        run: echo hi',
        ''
      ].join('\n')
      await writeFile(join(dir, '.github/workflows/lint-security.yml'), localWorkflow, 'utf8')

      const before = loadNative().runWasmConcern(WASM_PATH, 'security/lint_security_yml', dir, null, {})
        .violations
      expect(before).toHaveLength(1)
      expect(before[0].reason).toBe('policy-deny')
      expect(before[0].message).toContain('trufflesecurity/trufflehog@main')

      const plan = loadNative().runWasmConcernFix(WASM_PATH, 'security/lint_security_yml', dir, before, {})
      const edit = plan.edits.find(e => e.path === '.github/workflows/lint-security.yml')
      expect(edit).toBeDefined()
      expect(edit.content).toContain('local-step')
      expect(edit.content).toContain('trufflesecurity/trufflehog@main')

      await writeFile(join(dir, edit.path), edit.content, 'utf8')
      const after = loadNative().runWasmConcern(WASM_PATH, 'security/lint_security_yml', dir, null, {})
        .violations
      expect(after).toEqual([])
    })
  })

  /**
   * Регрес-тест на баг, знайдений незалежним ревʼю PR #528 крізь РЕАЛЬНИЙ
   * napi-міст (звіт задачі §2.58, `crates/plugin-ci-github/src/lib.rs`):
   * фікстура, де snippet-у бракує КІЛЬКОХ гілок дерева одразу (вставка в
   * послідовність з наявним елементом, цілком відсутній сусідній ключ,
   * цілком відсутній кореневий ключ, відсутній ключ усередині елемента
   * масиву, відсутній цілий елемент масиву) — кілька з цих вставок
   * структурно «дном впираються» в ТУ САМУ найглибшу скалярну позицію
   * документа. Rust-юніт-тест
   * (`fix_lint_security_yml_multi_insertion_produces_valid_reparseable_yaml`)
   * звіряє ту саму фікстуру прямим викликом `fix_template_merge` — цей тест
   * повторює те саме крізь `runWasmConcernFix` napi-моста (production-шлях,
   * не прямий виклик гостя) і, на відміну від Rust-тесту, парсить вивід
   * РЕАЛЬНИМ `yaml`-пакетом JS-канону (не власним [`parse_yaml_document`]
   * порту) — незалежна від Rust-парсера перевірка синтаксичної валідності.
   */
  test('security/lint_security_yml: кілька одночасних вставок на різних рівнях глибини — валідний YAML, коментарі збережені, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      const multiInsertion = [
        '# Верхній коментар файлу — мусить вижити',
        'name: Lint Security',
        '',
        'on:',
        '  # коментар усередині мапи',
        '  push:',
        '    branches:',
        '      - main # хвостовий коментар на елементі',
        '',
        'jobs:',
        '  security:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v6',
        '# нижній коментар наприкінці файлу',
        ''
      ].join('\n')
      await writeFile(join(dir, '.github/workflows/lint-security.yml'), multiInsertion, 'utf8')

      const before = loadNative().runWasmConcern(WASM_PATH, 'security/lint_security_yml', dir, null, {})
        .violations
      expect(before.length).toBeGreaterThan(0)

      const plan = loadNative().runWasmConcernFix(WASM_PATH, 'security/lint_security_yml', dir, before, {})
      const edit = plan.edits.find(e => e.path === '.github/workflows/lint-security.yml')
      expect(edit).toBeDefined()

      // Синтаксична валідність — РЕАЛЬНИМ `yaml`-пакетом JS-канону, не
      // Rust-парсером порту (незалежна перевірка).
      expect(() => parseYaml(edit.content)).not.toThrow()

      // Усі чотири коментарі з input-фікстури — дослівно.
      expect(edit.content).toContain('# Верхній коментар файлу — мусить вижити')
      expect(edit.content).toContain('# коментар усередині мапи')
      expect(edit.content).toContain('- main # хвостовий коментар на елементі')
      expect(edit.content).toContain('# нижній коментар наприкінці файлу')

      await writeFile(join(dir, edit.path), edit.content, 'utf8')
      const after = loadNative().runWasmConcern(WASM_PATH, 'security/lint_security_yml', dir, null, {})
        .violations
      expect(after).toEqual([])
    })
  })

  /**
   * §2.62 (`docs/plans/2026-08-05-open-questions-register.md`) звузила
   * виміряну межу §2.61 з «anchor/alias І flow-стиль непідтримні разом» до
   * РІВНО одного класу: вставка ВСЕРЕДИНУ однорядкового flow-контейнера
   * (`{…}`/`[…]`) — [`next_line_start`] не має де шукати `\n` у
   * однорядковому контейнері. Rust-юніт-тести
   * (`surgical_merge_flow_*`/`surgical_merge_mixed_flow_inside_block_tree_preserves_all_comments`
   * у `crates/plugin-ci-github/src/lib.rs`) звіряють ту саму латку прямим
   * викликом [`try_surgical_merge`]; цей тест — те саме крізь РЕАЛЬНИЙ
   * `runWasmConcernFix` napi-міст (доккомент модуля вище, «§2.47/§2.49»:
   * прямий виклик гостя вже раз приховав реальний баг мосту), з
   * production-канонічним snippet-ом (`lint-security.yml.snippet.yml`,
   * `on.push.branches` — двоелементний масив, `on.pull_request` — окремий
   * ключ). Локальний workflow тут пише `on` ОДНИМ рядком у flow-стилі
   * (`on: {push: {branches: [main]}}`, без anchor) — ДО §2.62-латки ОДНА ця
   * flow-вставка каскадом («все або нічого», [`surgical_merge_node`]
   * пробрасує `false` до кореня) валила ВЕСЬ мердж на повну регенерацію,
   * втрачаючи файловий коментар і всі block-style вставки (`permissions`,
   * trufflehog-крок, `concurrency`) заразом. Синтаксична валідність — РЕАЛЬНИМ
   * `yaml`-пакетом JS-канону, не Rust-парсером порту.
   */
  test('security/lint_security_yml: flow-стиль on: {push: {…}} у локальному файлі — хірургічна вставка (dev/pull_request/permissions/trufflehog), повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      const flowStyleWorkflow = [
        '# файловий коментар — мусить вижити',
        'name: Lint Security',
        'on: {push: {branches: [main]}}',
        'jobs:',
        '  security:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v6',
        '        with:',
        '          persist-credentials: false',
        '          fetch-depth: 0',
        ''
      ].join('\n')
      await writeFile(join(dir, '.github/workflows/lint-security.yml'), flowStyleWorkflow, 'utf8')

      const before = loadNative().runWasmConcern(WASM_PATH, 'security/lint_security_yml', dir, null, {})
        .violations
      expect(before.length).toBeGreaterThan(0)

      const plan = loadNative().runWasmConcernFix(WASM_PATH, 'security/lint_security_yml', dir, before, {})
      const edit = plan.edits.find(e => e.path === '.github/workflows/lint-security.yml')
      expect(edit).toBeDefined()

      // Синтаксична валідність і семантика — РЕАЛЬНИМ `yaml`-пакетом
      // JS-канону, не Rust-парсером порту (незалежна перевірка).
      const parsed = parseYaml(edit.content)
      expect(parsed.on.push.branches).toEqual(expect.arrayContaining(['main', 'dev']))
      expect(parsed.on.pull_request.branches).toEqual(expect.arrayContaining(['dev', 'main']))

      // Файловий коментар — доказ, що це ХІРУРГІЧНИЙ шлях, не повна
      // регенерація (яка коментарі не зберігає взагалі, доккомент розділу
      // «Хірургічний comment-preserving merge» у `crates/plugin-ci-github/src/lib.rs`).
      expect(edit.content).toContain('# файловий коментар — мусить вижити')
      expect(edit.content).toContain('trufflesecurity/trufflehog@main')

      await writeFile(join(dir, edit.path), edit.content, 'utf8')
      const after = loadNative().runWasmConcern(WASM_PATH, 'security/lint_security_yml', dir, null, {})
        .violations
      expect(after).toEqual([])
    })
  })
})

/**
 * ЧЕТВЕРТА хвиля — дванадцять `createTemplateFixPattern`-концернів, що
 * раніше лишались JS-шимами (доккомент задачі, звіт §2.6x). Той самий
 * прийом, що блок вище для третьої хвилі: detect гостем → `runWasmConcernFix`
 * → застосування правок → detect гостем знову, чистий — крізь РЕАЛЬНИЙ
 * napi-міст (production-шлях, не прямий виклик гостя — юніт-тести
 * `crates/plugin-ci-github` звіряють ту саму поведінку прямим викликом
 * Rust-функцій, доккомент задачі, «Обовʼязкова послідовність», пункт 2).
 * Дев'ять reuse rego (детект через regorus), два (`ga/lint_repo_yml`,
 * `npm-module/npm_publish_yml`) — `"check": "template"` без `.rego`.
 */
describe('wasm-плагін plugin-ci-github — четверта хвиля: T0-цикл через fix-міст (дванадцять createTemplateFixPattern-концернів)', () => {
  const FOURTH_WAVE = [
    { key: 'ga/git_ai', path: '.github/workflows/git-ai.yml' },
    { key: 'ga/lint_ga', path: '.github/workflows/lint-ga.yml' },
    { key: 'ga/clean_ga_workflows', path: '.github/workflows/clean-ga-workflows.yml' },
    { key: 'ga/clean_merged_branch', path: '.github/workflows/clean-merged-branch.yml' },
    { key: 'docker/lint_docker_yml', path: '.github/workflows/lint-docker.yml' },
    { key: 'ga/zizmor_yml', path: '.github/zizmor.yml' },
    { key: 'k8s/lint_k8s_yml', path: '.github/workflows/lint-k8s.yml' },
    { key: 'style/lint_style_yml', path: '.github/workflows/lint-style.yml' },
    { key: 'text/lint_text', path: '.github/workflows/lint-text.yml' },
    { key: 'ga/lint_repo_yml', path: '.github/workflows/lint-repo.yml' },
    { key: 'npm-module/npm_publish_yml', path: '.github/workflows/npm-publish.yml' }
  ]

  for (const { key, path } of FOURTH_WAVE) {
    test(`${key}: файл відсутній — fix копіює snippet, повторний детект чистий, повторний fix — no-op`, async () => {
      await withTmpDir(async dir => {
        const before = loadNative().runWasmConcern(WASM_PATH, key, dir, null, {}).violations
        expect(before).toHaveLength(1)
        expect(before[0].reason).toBe('policy-file-missing')

        const plan = loadNative().runWasmConcernFix(WASM_PATH, key, dir, before, {})
        const edit = plan.edits.find(e => e.path === path)
        expect(edit, `${key}: fix мав дати edit на ${path}`).toBeDefined()

        await mkdir(join(dir, dirname(path)), { recursive: true })
        await writeFile(join(dir, edit.path), edit.content, 'utf8')

        const after = loadNative().runWasmConcern(WASM_PATH, key, dir, null, {}).violations
        expect(after).toEqual([])

        // Ідемпотентність на канонічному вмісті — те саме твердження, що
        // ніс знятий §2.90 JS-канон («канонічний вміст → idempotent,
        // touchedFiles порожній», `tests/fix-<concern>.test.mjs`), у новій
        // формі: діагностика СИНТЕТИЧНА (повторний детект уже чистий, тож
        // реальної немає), і гість мусить віддати ПОРОЖНІЙ план — гілка
        // `is_subset` [`fix_template_merge`], не reformat. Без цього кроку
        // зняття канону тихо забрало б дванадцять перевірок ідемпотентності.
        const synthetic = [
          { ruleId: key.split('/')[0], concernId: key.split('/')[1], reason: 'policy-deny', message: 'x', file: path }
        ]
        const idempotent = loadNative().runWasmConcernFix(WASM_PATH, key, dir, synthetic, {})
        expect(idempotent.edits, `${key}: канонічний вміст мав дати порожній план`).toEqual([])
      })
    })
  }

  // `abie/clean_merged_ignore_branches` — окремо: `required: false`
  // (`concern.json` немає `policy.files.required`, доккомент
  // `crates/plugin-ci-github/src/lib.rs::PolicyCfg::required`) — файл
  // відсутній → ПОРОЖНІЙ результат, не `policy-file-missing`, на відміну
  // від одинадцяти сусідів циклу вище. Спільний target-файл з
  // `ga/clean_merged_branch` — сценарій пише workflow з action-кроком БЕЗ
  // потрібних `ignore_branches`, доводить деталь-специфічний `policy-deny`
  // → fix дописує `ignore_branches` → повторний детект чистий.
  test('abie/clean_merged_ignore_branches: файл відсутній — мовчить (required: false)', async () => {
    await withTmpDir(async dir => {
      const violations = loadNative().runWasmConcern(
        WASM_PATH,
        'abie/clean_merged_ignore_branches',
        dir,
        null,
        {}
      ).violations
      expect(violations).toEqual([])
    })
  })

  test('abie/clean_merged_ignore_branches: наявний workflow без ignore_branches — fix дописує канонічні гілки, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      const localWorkflow = [
        'jobs:',
        '  cleanup_old_branches:',
        '    steps:',
        '      - uses: fpicalausa/remove-merged-branches@v1',
        '        with:',
        '          ignore_branches: main',
        ''
      ].join('\n')
      await writeFile(join(dir, '.github/workflows/clean-merged-branch.yml'), localWorkflow, 'utf8')

      const before = loadNative().runWasmConcern(
        WASM_PATH,
        'abie/clean_merged_ignore_branches',
        dir,
        null,
        {}
      ).violations
      expect(before.length).toBeGreaterThan(0)
      expect(before[0].reason).toBe('policy-deny')

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        'abie/clean_merged_ignore_branches',
        dir,
        before,
        {}
      )
      const edit = plan.edits.find(e => e.path === '.github/workflows/clean-merged-branch.yml')
      expect(edit).toBeDefined()

      await writeFile(join(dir, edit.path), edit.content, 'utf8')
      const after = loadNative().runWasmConcern(
        WASM_PATH,
        'abie/clean_merged_ignore_branches',
        dir,
        null,
        {}
      ).violations
      expect(after).toEqual([])

      // Ідемпотентність — та сама заміна знятому JS-канону, що в циклі
      // одинадцяти вище (доккомент там).
      const synthetic = [
        {
          ruleId: 'abie',
          concernId: 'clean_merged_ignore_branches',
          reason: 'policy-deny',
          message: 'x',
          file: '.github/workflows/clean-merged-branch.yml'
        }
      ]
      const idempotent = loadNative().runWasmConcernFix(
        WASM_PATH,
        'abie/clean_merged_ignore_branches',
        dir,
        synthetic,
        {}
      )
      expect(idempotent.edits).toEqual([])
    })
  })

  /**
   * `%q`-пастка (доккомент задачі — вже третя поява за міграцію, §2.22 і
   * §2.5x) — `zizmor_yml.rego` мала ДВА `%q` в ОДНІЙ `sprintf`, замінено
   * на `\"%v\"`. Цей тест крізь РЕАЛЬНИЙ napi-міст доводить, що regorus
   * реально виконує правило (не падає в `rego-engine-error`) і
   * message-текст несе ОБИДВІ літерали в лапках, той самий формат, що Go
   * `%q` дав би.
   */
  test('ga/zizmor_yml: неправильне значення policy — policy-deny з квотованими літералами (регрес на %q)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github'), { recursive: true })
      await writeFile(
        join(dir, '.github/zizmor.yml'),
        'rules:\n  unpinned-uses:\n    config:\n      policies:\n        "*": "any"\n',
        'utf8'
      )
      const violations = loadNative().runWasmConcern(WASM_PATH, 'ga/zizmor_yml', dir, null, {}).violations
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('policy-deny')
      expect(violations[0].message).toContain('policies["*"]')
      expect(violations[0].message).toContain('"ref-pin"')
    })
  })

  /**
   * `ga/lint_repo_yml` — `"check": "template"` (немає `.rego`), детект іде
   * через `checkSnippet`-порт ([`check_snippet_messages`],
   * `crates/plugin-ci-github/src/lib.rs`) — `reason` тут
   * `policy-template-mismatch`, НЕ `policy-deny`.
   */
  test('ga/lint_repo_yml: name не збігається зі snippet — policy-template-mismatch, fix регенерує канон, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github/workflows/lint-repo.yml'), 'name: Wrong Name\n', 'utf8')

      const before = loadNative().runWasmConcern(WASM_PATH, 'ga/lint_repo_yml', dir, null, {}).violations
      expect(before.length).toBeGreaterThan(0)
      expect(before.every(v => v.reason === 'policy-template-mismatch')).toBe(true)

      const plan = loadNative().runWasmConcernFix(WASM_PATH, 'ga/lint_repo_yml', dir, before, {})
      const edit = plan.edits.find(e => e.path === '.github/workflows/lint-repo.yml')
      expect(edit).toBeDefined()

      await writeFile(join(dir, edit.path), edit.content, 'utf8')
      const after = loadNative().runWasmConcern(WASM_PATH, 'ga/lint_repo_yml', dir, null, {}).violations
      expect(after).toEqual([])
    })
  })
})

describe('wasm-плагін plugin-ci-github — describe()/розмір', () => {
  test('describe() повертає manifest з вісімнадцятьма концернами (пʼята хвиля — walkGlob ga/service_deploy_workflow)', () => {
    const manifest = loadNative().wasmPluginManifest(WASM_PATH)
    expect(manifest.id).toBe('ci-github/wasm-concerns')
    expect(manifest.concerns).toHaveLength(18)
    // ПʼЯТА хвиля — ПЕРША `per-file`-контрибуція цього гостя (walkGlob-набір
    // `.github/workflows/*.yml`, не один таргет).
    const serviceDeploy = manifest.concerns.find(c => c.key === 'ga/service_deploy_workflow')
    expect(serviceDeploy, 'ga/service_deploy_workflow contribution має бути в маніфесті').toBeDefined()
    expect(serviceDeploy.scope).toBe('per-file')
    expect(serviceDeploy.glob).toEqual(['.github/workflows/*.yml'])
    const toolchainCache = manifest.concerns.find(c => c.key === CONCERN_KEY)
    expect(toolchainCache.scope).toBe('full')
    const workflows = manifest.concerns.find(c => c.key === WORKFLOWS_CONCERN_KEY)
    expect(workflows.scope).toBe('full')
    expect(manifest.tools).toEqual(['path:git', 'npm:github-actionlint', 'path:uvx', 'shellcheck'])
    for (const [key, glob] of [
      ['ga/vscode_extensions', '.vscode/extensions.json'],
      ['ga/vscode_settings', '.vscode/settings.json'],
      ['security/lint_security_yml', '.github/workflows/lint-security.yml'],
      ['ga/git_ai', '.github/workflows/git-ai.yml'],
      ['ga/lint_ga', '.github/workflows/lint-ga.yml'],
      ['ga/clean_ga_workflows', '.github/workflows/clean-ga-workflows.yml'],
      ['ga/clean_merged_branch', '.github/workflows/clean-merged-branch.yml'],
      ['docker/lint_docker_yml', '.github/workflows/lint-docker.yml'],
      ['ga/zizmor_yml', '.github/zizmor.yml'],
      ['k8s/lint_k8s_yml', '.github/workflows/lint-k8s.yml'],
      ['style/lint_style_yml', '.github/workflows/lint-style.yml'],
      ['text/lint_text', '.github/workflows/lint-text.yml'],
      ['abie/clean_merged_ignore_branches', '.github/workflows/clean-merged-branch.yml'],
      ['ga/lint_repo_yml', '.github/workflows/lint-repo.yml'],
      ['npm-module/npm_publish_yml', '.github/workflows/npm-publish.yml']
    ]) {
      const contribution = manifest.concerns.find(c => c.key === key)
      expect(contribution, `${key} contribution має бути в маніфесті`).toBeDefined()
      expect(contribution.scope).toBe('full')
      expect(contribution.glob).toEqual([glob])
    }
  })

  test(`зібраний .wasm вкладається в size-budget (${WASM_SIZE_BUDGET_LABEL})`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThanOrEqual(WASM_SIZE_BUDGET_BYTES)
  })
})

const SERVICE_DEPLOY_WORKFLOW_CONCERN = 'ga/service_deploy_workflow'

/** Сервісний workflow (dir-scoped glob у `on.push.paths`) із lint-джобою, але без `plan`. */
const BROKEN_SERVICE_WORKFLOW = [
  'on:',
  '  push:',
  "    paths:",
  "      - 'run/nexus/**'",
  'jobs:',
  '  lint:',
  '    steps:',
  '      - run: bunx n-rules lint --path run/nexus --no-fix',
  '  deploy:',
  '    needs: lint',
  '    steps:',
  '      - run: echo x',
  ''
].join('\n')

describe('wasm-plugin parity — ga/service_deploy_workflow (walkGlob rego-детект через РЕАЛЬНИЙ napi-міст)', () => {
  test('сервісний workflow без plan-джоби — policy-deny, атрибутована файлом', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github', 'workflows', 'deploy-nexus.yml'), BROKEN_SERVICE_WORKFLOW, 'utf8')

      const result = loadNative().runWasmConcern(WASM_PATH, SERVICE_DEPLOY_WORKFLOW_CONCERN, dir, null)
      const violations = withDefaultSeverity(result.violations)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some(v => v.message.includes('немає job `plan`'))).toBe(true)
      for (const v of violations) {
        expect(v.reason).toBe('policy-deny')
        expect(v.file).toBe('.github/workflows/deploy-nexus.yml')
      }
    })
  })

  test('workflow без dir-scoped глоба (не сервісний) — жодної violation', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(
        join(dir, '.github', 'workflows', 'lint.yml'),
        "on:\n  push:\n    paths:\n      - '**/*.js'\njobs:\n  lint:\n    steps:\n      - run: bunx n-rules lint --no-fix\n",
        'utf8'
      )
      const result = loadNative().runWasmConcern(WASM_PATH, SERVICE_DEPLOY_WORKFLOW_CONCERN, dir, null)
      expect(withDefaultSeverity(result.violations)).toEqual([])
    })
  })

  /**
   * Порт СВІДОМО без fix-половини (доккомент `crates/plugin-ci-github/src/lib.rs`,
   * розділ «ПʼЯТА хвиля»): гість віддає порожній план, `edits.length > 0` не
   * проходить, і чинний `fix-service_deploy_workflow.mjs` лишається єдиним
   * фіксером. Почервоніння цього тесту = фікс портували, і `guestFix` тепер
   * глушить JS-канон — перевір, чи порт ПОВНИЙ.
   */
  test('fix — порожній план (T0 лишається за JS-каноном)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github', 'workflows', 'deploy-nexus.yml'), BROKEN_SERVICE_WORKFLOW, 'utf8')
      const violations = loadNative().runWasmConcern(WASM_PATH, SERVICE_DEPLOY_WORKFLOW_CONCERN, dir, null).violations
      const plan = loadNative().runWasmConcernFix(WASM_PATH, SERVICE_DEPLOY_WORKFLOW_CONCERN, dir, violations, {})
      expect(plan.edits).toEqual([])
    })
  })
})

// =====================================================================
// §2.90 — ЗНЯТТЯ JS-КАНОНІВ ФІКСУ: сімнадцять `fix-<concern>.mjs`
// видалено з `plugins/ci-github` (борг «спершу парність» закрито для
// цього плагіна повністю; зразок — §2.88, пілот на `plugins/lang-php`).
//
// Разом із каноном зникає не тест, а ПОВЕРХНЯ: `loadT0Patterns`
// (`run-fix.mjs`) резолвить фіксери у порядку native → wasm (`guestFix`)
// → `fix-<concern>.mjs`, і третій шар був глушником випадку «гість не
// резолвиться» (плагін не зібрано, розбіжність піна, хост без wasm).
// Глушника більше немає — концерн деградує з «автофікс» у «повідомили й
// віддали в LLM-ладдер». Саме це диктує форму гейта: перевіряється не
// відсутність файлу, а СКЛАД резолву тим самим резолвером, яким ходить
// прод:
//
// - два патерни  → канон повернувся (подвійний фікс, пастка §2.72);
// - нуль патернів → зник ГІСТЬ, тобто `--fix` МОВЧКИ перестав фіксити
//   концерн, і він тихо поїхав би в дорогий LLM-ладдер.
//
// `existsSync` на видаленому файлі ловив би лише перше з двох.
//
// Гейт ТАБЛИЧНИЙ (усі сімнадцять ключів в одному тесті), а не сімнадцять
// окремих: він СИЛЬНІШИЙ за суму окремих, бо другим твердженням звіряє
// саму таблицю з ЖИВИМ маніфестом гостя — концерн, доданий до гостя й не
// внесений сюди, валить гейт, а не тихо лишається неперевіреним.
// `ga/service_deploy_workflow` СВІДОМО поза таблицею — його T0-фікс
// лишився за JS (§2.81: потребує графа ввімкнених правил, каналу до
// якого гість не має); `ci_artifact/consume` — узагалі не концерн цього
// гостя (в маніфесті його немає).
//
// Це заразом ЄДИНІ тести цього файлу, що йдуть через `loadT0Patterns` —
// решта кличе `runWasmConcernFix` напряму й цю поверхню обходить.
// =====================================================================

/**
 * Сімнадцять концернів `plugins/ci-github`, чий T0-фікс живе ВИКЛЮЧНО в
 * гості `crates/plugin-ci-github` (`Guest::fix`, гілки `match`) — рівно
 * ті, чий `fix-<concern>.mjs` знято §2.90.
 * @type {Array<{ ruleId: string, concern: string }>}
 */
const FIX_ONLY_IN_GUEST = [
  { ruleId: 'abie', concern: 'clean_merged_ignore_branches' },
  { ruleId: 'docker', concern: 'lint_docker_yml' },
  { ruleId: 'ga', concern: 'clean_ga_workflows' },
  { ruleId: 'ga', concern: 'clean_merged_branch' },
  { ruleId: 'ga', concern: 'git_ai' },
  { ruleId: 'ga', concern: 'lint_ga' },
  { ruleId: 'ga', concern: 'lint_repo_yml' },
  { ruleId: 'ga', concern: 'vscode_extensions' },
  { ruleId: 'ga', concern: 'vscode_settings' },
  { ruleId: 'ga', concern: 'workflows' },
  { ruleId: 'ga', concern: 'zizmor_yml' },
  { ruleId: 'k8s', concern: 'lint_k8s_yml' },
  { ruleId: 'npm-module', concern: 'npm_publish_yml' },
  { ruleId: 'rust', concern: 'toolchain_cache' },
  { ruleId: 'security', concern: 'lint_security_yml' },
  { ruleId: 'style', concern: 'lint_style_yml' },
  { ruleId: 'text', concern: 'lint_text' }
]

/** Концерни гостя, чий T0-фікс СВІДОМО лишився за JS-каноном (§2.81). */
const FIX_STAYS_IN_JS = new Set([SERVICE_DEPLOY_WORKFLOW_CONCERN])

describe('§2.90 — plugins/ci-github: фікс кожного портованого концерну живе рівно в одному місці (JS-канони знято)', () => {
  test(
    'loadT0Patterns на КОЖНОМУ з сімнадцяти віддає РІВНО ОДИН патерн, і той — guestFix (ані канону, ані порожнечі)',
    async () => {
      await withTmpDir(async dir => {
        await writeFile(
          join(dir, '.n-rules.json'),
          JSON.stringify({ wasmPlugins: [{ name: 'ci-github', path: WASM_PATH }] }),
          'utf8'
        )
        const { loadT0Patterns } = await import('../run-fix.mjs')
        /** @type {Record<string, boolean[]>} */
        const actual = {}
        for (const { ruleId, concern } of FIX_ONLY_IN_GUEST) {
          const concernDir = join(REPO_ROOT, 'plugins', 'ci-github', 'rules', ruleId, concern)
          const patterns = await loadT0Patterns(concernDir, concern, ruleId, dir)
          actual[`${ruleId}/${concern}`] = patterns.map(p => p.guestFix === true)
        }
        const expected = Object.fromEntries(
          FIX_ONLY_IN_GUEST.map(({ ruleId, concern }) => [`${ruleId}/${concern}`, [true]])
        )
        expect(actual).toEqual(expected)
      })
    },
    180_000
  )

  test('таблиця не відстала від гостя: кожен концерн маніфеста або в таблиці, або у свідомому JS-виключенні', () => {
    const manifest = loadNative().wasmPluginManifest(WASM_PATH)
    const covered = new Set(FIX_ONLY_IN_GUEST.map(({ ruleId, concern }) => `${ruleId}/${concern}`))
    expect(covered.size).toBe(17)
    const uncovered = manifest.concerns
      .map(c => c.key)
      .filter(key => !covered.has(key) && !FIX_STAYS_IN_JS.has(key))
    expect(
      uncovered,
      'новий концерн гостя треба або внести у FIX_ONLY_IN_GUEST, або свідомо пояснити у FIX_STAYS_IN_JS'
    ).toEqual([])
  })
})
