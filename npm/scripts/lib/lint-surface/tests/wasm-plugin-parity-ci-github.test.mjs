/**
 * Parity-тест wasm-плагіна `plugin-ci-github` — П'ЯТОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`,
 * другий — `plugin-lang-python`, третій — `plugin-lang-rust`, четвертий —
 * `plugin-lang-php`, `wasm-plugin-parity-php.test.mjs`): ганяє ОДНІ фікстури
 * через ЖИВІ JS-детектори (Plugin API v2, канон НЕ видаляється цією задачею)
 * і через `runWasmConcern` napi-мосту (`crates/rules-napi` →
 * `crates/plugin-ci-github`), звіряючи, що `violations` ідентичні
 * (reason/message/file/severity/data біт-у-біт) — той самий non-golden
 * режим, що `wasm-plugin-parity-php.test.mjs`.
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
import { delimiter, join } from 'node:path'
import { env } from 'node:process'
import { pathToFileURL } from 'node:url'

import { describe, expect, test, vi } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, withBinRemovedFromPath, withTmpDir } from '../../../utils/test-helpers.mjs'
import { resolveCmd } from '../../../utils/resolve-cmd.mjs'

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
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_ci_github.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-parity-ci-github.test.mjs: wasm-компонент plugin-ci-github не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-ci-github/build.sh'
  )
}

const MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'ci-github', 'rules', 'rust', 'toolchain_cache', 'main.mjs')
const CONCERN_KEY = 'rust/toolchain_cache'

const WORKFLOWS_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'ci-github', 'rules', 'ga', 'workflows', 'main.mjs')
const WORKFLOWS_CONCERN_KEY = 'ga/workflows'

/** Size-budget компонента — той самий бюджет, що решта чотирьох гостей (доккомент модуля). */
const WASM_SIZE_BUDGET_BYTES = 2.5 * 1024 * 1024

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
 * Ганяє `rust/toolchain_cache` (full-scope, БЕЗ `exec-tool`) через JS-канон
 * і `runWasmConcern` з `files: null` (host сам будує batch за
 * `ConcernContribution::glob` — `.github/workflows/*.{yml,yaml}` +
 * `Cargo.toml`/`src-tauri/Cargo.toml`, доккомент `plugin.toml`).
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runToolchainCacheBoth(dir) {
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(MAIN_MJS_PATH).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId: 'toolchain_cache' })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, CONCERN_KEY, dir, null)
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
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
const EXTERNAL_TOOL_REASONS = new Set(['actionlint', 'zizmor'])

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
 * Ганяє `ga/workflows` (full-scope) через JS-канон і wasm-порт на СПІЛЬНОМУ
 * стані: `git` — реальний системний бінарник (детерміновано, доккомент
 * модуля), `actionlint`/`zizmor` — детерміновано skip через poison-стаби
 * (`makePoisonedBunxUvxDir`), `shellcheck` — залежно від `opts.shellcheck`:
 * `'stub'` (дефолт) — СПІЛЬНИЙ фейковий стаб, і PATH-бік (JS), і
 * `toolPaths`-бік (wasm) отримують ТОЙ САМИЙ файл; `'absent'` — реальний
 * shellcheck вирізається з PATH (`withBinRemovedFromPath`), `toolPaths` без
 * ключа `shellcheck` — обидві реалізації бачать "тула немає".
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

  // `withBinRemovedFromPath` не пропагує повернене значення `fn()`
  // (`test-helpers.mjs`) — результат кладемо в замикання.
  let jsViolations
  const runJsLint = async () => {
    const originalPath = env.PATH
    try {
      env.PATH = stubDir
        ? `${stubDir}${delimiter}${poisonDir}${delimiter}${originalPath ?? ''}`
        : `${poisonDir}${delimiter}${originalPath ?? ''}`
      // eslint-disable-next-line no-unsanitized/method
      const { lint } = await import(pathToFileURL(WORKFLOWS_MAIN_MJS_PATH).href)
      const jsResult = await lint({ cwd: dir, ruleId: 'ga', concernId: 'workflows', files: undefined })
      jsViolations = normalizeWorkflowsViolations(jsResult.violations, dir)
    } finally {
      if (originalPath === undefined) delete env.PATH
      else env.PATH = originalPath
    }
  }

  // `toolPaths.shellcheck` (`stubDir`) мусить лишатись на диску, поки wasm-виклик
  // не завершиться — cleanup ОБОВʼЯЗКОВО ПІСЛЯ обох реалізацій (перша версія
  // прибирала `stubDir` одразу після JS-виклику, ДО `runWasmConcern`: wasm-бік
  // `exec-tool("shellcheck", …)` тоді спавнив уже видалений файл і хибно давав
  // `status: none` — той самий стаб файл спільний для обох, доккомент нижче).
  try {
    if (shellcheckMode === 'absent') {
      await withBinRemovedFromPath('shellcheck', runJsLint)
    } else {
      await runJsLint()
    }

    const wasmResult = loadNative().runWasmConcern(WASM_PATH, WORKFLOWS_CONCERN_KEY, dir, null, toolPaths)
    const wasmViolations = normalizeWorkflowsViolations(wasmResult.violations)
    return { js: jsViolations, wasm: wasmViolations }
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

describe('wasm-плагін plugin-ci-github — describe()/розмір', () => {
  test('describe() повертає manifest з двома full-scope концернами', () => {
    const manifest = loadNative().wasmPluginManifest(WASM_PATH)
    expect(manifest.id).toBe('ci-github/wasm-concerns')
    expect(manifest.concerns).toHaveLength(2)
    const toolchainCache = manifest.concerns.find(c => c.key === CONCERN_KEY)
    expect(toolchainCache.scope).toBe('full')
    const workflows = manifest.concerns.find(c => c.key === WORKFLOWS_CONCERN_KEY)
    expect(workflows.scope).toBe('full')
    expect(manifest.tools).toEqual(['path:git', 'npm:github-actionlint', 'path:uvx', 'shellcheck'])
  })

  test(`зібраний .wasm вкладається в size-budget (${WASM_SIZE_BUDGET_BYTES} байт)`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThan(WASM_SIZE_BUDGET_BYTES)
  })
})
