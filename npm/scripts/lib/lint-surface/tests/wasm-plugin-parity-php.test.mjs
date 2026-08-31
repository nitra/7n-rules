/**
 * Parity-тест wasm-плагіна `plugin-lang-php` — ЧЕТВЕРТОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`,
 * другий — `plugin-lang-python`, третій — `plugin-lang-rust`,
 * `wasm-plugin-parity-rust.test.mjs`): звіряє `runWasmConcern` napi-мосту
 * (`crates/rules-napi` → `crates/plugin-lang-php`) із ЕТАЛОНОМ — знятим
 * виводом JS-детекторів `plugins/lang-php/rules/php/<concern>/main.mjs`
 * (reason/message/file/severity/data біт-у-біт) — для всіх п'яти концернів
 * однієї хвилі: `php/tooling`, `php/composer_manifest`, `php/project`,
 * `php/mago_fmt`, `php/mago_lint` (доккомент `crates/plugin-lang-php/src/lib.rs`).
 *
 * ЕТАЛОН, НЕ ЖИВИЙ КАНОН: `plugins/lang-php/rules/php/*\/main.mjs` —
 * транзитивний шар Plugin API v2, що видаляється разом із портом (мета цього
 * тестового файлу — довести порт, не тримати JS вічно), той самий прийом,
 * що `wasm-plugin-parity-rust.test.mjs` (lang-rust, четверта хвиля цього
 * самого переходу). Поки він живий, зняти еталон можна прогнавши суїт з
 * `N_WASM_PARITY_CAPTURE=1`; звичайний прогін JS НЕ викликає — читає
 * зафіксований раніше вивід із `fixtures/wasm-parity/php/**\/*.json`
 * ([`goldenJs`], `wasm-parity-golden.mjs` — спільний шар з рештою трьох
 * wasm-parity-гейтів, доккомент там). Відсутній еталон — ПАДІННЯ тесту з
 * явним проханням перезняти, повернувши `main.mjs` з історії, не мовчазний
 * пропуск: інакше зникнення канону не дало б жодного сигналу.
 *
 * # `mago` — pinned/bare тул, спільний фейковий бінарник
 *
 * `php/project`, `php/mago_fmt`, `php/mago_lint` резолвлять `mago` через
 * `ensureToolAsync('mago')` (managed github-release тул, доккомент
 * `crates/plugin-lang-php/src/lib.rs`, розділ «`mago` — pinned, не
 * `path:`»), НЕ через `resolveCmd`/PATH — на відміну від `composer` (`path:`
 * схема, той самий контур, що `cargo`/`uv` в попередніх гостей). Обидві
 * реалізації тут ганяють ОДИН І ТОЙ САМИЙ фейковий `mago`-скрипт: JS-бік
 * отримує його шлях через мокнутий `ensureToolAsync`
 * (`@7n/rules/scripts/lib/ensure-tool.mjs`, мокається на рівні модуля —
 * реальний `spawnAsync` лишається НЕ мокнутим і справді виконує скрипт),
 * wasm-бік — той самий абсолютний шлях у `toolPaths.mago` (те, що для
 * pinned-схеми побудувала б `ensureDeclaredTools`,
 * `npm/scripts/lib/lint-surface/wasm-plugins.mjs`). `composer`, натомість,
 * резолвиться звичайним PATH-скануванням (`resolveCmd`) — PATH тимчасово
 * звужується до каталогу фейка (чи ПОРОЖНІЙ — канал «composer не знайдено»)
 * і відновлюється у `finally`, той самий мотив, що `runCheckBoth` у
 * `wasm-plugin-parity-rust.test.mjs` для `cargo`. Фейковий бінарник (і мок
 * `ensureToolAsync`) готується БЕЗУМОВНО, поза `goldenJs`: wasm-бік справді
 * ВИКОНУЄ його через `toolPaths`, тож він мусить існувати і в звичайному
 * прогоні; підміна PATH і сам виклик `lint()`, навпаки, потрібні ЛИШЕ
 * JS-канону, тож переїхали ВСЕРЕДИНУ `compute()` [`goldenJs`] — виконуються
 * лише в режимі зняття (той самий поділ, що `runPythonToolBoth`/
 * `runCheckBoth` у сусідніх гостей).
 *
 * Сценарій «`mago` взагалі недоступний і `ensureToolAsync` кидає виняток»
 * (`main-hard-fail.test.mjs`, `plugins/lang-php/rules/php/mago_fmt/tests/`)
 * СВІДОМО НЕ покритий тут: то ЄДИНЕ місце, де wasm-порт structurally НЕ може
 * відтворити поведінку канону (кинути виняток і провалити ВЕСЬ прогін) —
 * задокументована розбіжність, не тестована на рівність
 * (`crates/plugin-lang-php/src/lib.rs`, розділ «Канал „mago“ недоступний»).
 *
 * Асертації на контент (`reason`/`message`), НЕ на кількість викликів
 * спільного фейкового бінарника — рахування рядків у побічному файлі
 * (кшталт `argv.txt`) мовчки закодувало б «обидві реалізації запустились»
 * і зламалось би при конвертації на golden-фікстури (доккомент задачі,
 * той самий урок, що конвертація `lang-rust`).
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { env } from 'node:process'
import { pathToFileURL } from 'node:url'

import { describe, expect, test, vi } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'
import { createGoldenJs } from './wasm-parity-golden.mjs'
import { WASM_SIZE_BUDGET_BYTES, WASM_SIZE_BUDGET_LABEL } from './wasm-size-budget.mjs'

const ensureToolAsyncMock = vi.fn()
// `mago` — керований тестом (спільний фейковий бінарник, доккомент модуля);
// решта тулів делегується СПРАВЖНЬОМУ `ensureToolAsync`. Плоский мок усього
// модуля ламав би rego-канон `php/vscode_extensions`: `runConftestBatch`
// резолвить `conftest` тим самим викликом і отримував би `undefined`.
vi.mock('@7n/rules/scripts/lib/ensure-tool.mjs', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    ensureToolAsync: (name, ...rest) =>
      name === 'mago' ? ensureToolAsyncMock(name, ...rest) : actual.ensureToolAsync(name, ...rest)
  }
})

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip3', 'release', 'plugin_lang_php.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-parity-php.test.mjs: wasm-компонент plugin-lang-php не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-php/build.sh'
  )
}

const PHP_RULES_DIR = join(REPO_ROOT, 'plugins', 'lang-php', 'rules', 'php')
const TOOLING_MAIN_MJS_PATH = join(PHP_RULES_DIR, 'tooling', 'main.mjs')
const COMPOSER_MANIFEST_MAIN_MJS_PATH = join(PHP_RULES_DIR, 'composer_manifest', 'main.mjs')
const PROJECT_MAIN_MJS_PATH = join(PHP_RULES_DIR, 'project', 'main.mjs')
const MAGO_FMT_MAIN_MJS_PATH = join(PHP_RULES_DIR, 'mago_fmt', 'main.mjs')
const MAGO_LINT_MAIN_MJS_PATH = join(PHP_RULES_DIR, 'mago_lint', 'main.mjs')

const TOOLING_CONCERN_KEY = 'php/tooling'
const COMPOSER_MANIFEST_CONCERN_KEY = 'php/composer_manifest'
const PROJECT_CONCERN_KEY = 'php/project'
const MAGO_FMT_CONCERN_KEY = 'php/mago_fmt'
const MAGO_LINT_CONCERN_KEY = 'php/mago_lint'


// ---------------------------------------------------------------------
// Шар еталонів ([`goldenJs`], `wasm-parity-golden.mjs`): JS-детектори
// `plugins/lang-php/rules/php/*/main.mjs` — транзитивний канон Plugin API
// v2, який видаляється разом із портом. Механізм (кеш, лічильники,
// плейсхолдер tmp-шляху, помилка відсутнього еталона) — СПІЛЬНИЙ з рештою
// трьох wasm-parity-гейтів, винесений у `wasm-parity-golden.mjs`; тут
// лишається лише `goldenJs`, звʼязаний із ЦИМ файлом як підказкою команди
// перезняття (доккомент модуля вище).
const goldenJs = createGoldenJs({
  captureHintPath: 'npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-php.test.mjs'
})
// ---------------------------------------------------------------------

/** Канонічний `composer.json` без порушень (composer недоступний за замовчуванням у декларативних тестах). */
const CANON_MANIFEST = JSON.stringify({
  name: 'nitra/demo',
  license: 'MIT',
  require: { php: '>=8.5' },
  config: { 'sort-packages': true }
})

/**
 * Виставляє дефолт `severity: 'error'`, якщо ключ відсутній — той самий
 * normalize-крок, що в решти трьох parity-файлів: raw JS `lint()` опускає
 * дефолтне поле, WIT `record diagnostic.severity` не опційне.
 * @param {unknown[]} violations сирі violations (JS чи wasm)
 * @returns {unknown[]} ті самі violations із заповненим `severity`
 */
function withDefaultSeverity(violations) {
  return violations.map(v => ({ severity: 'error', ...v }))
}

/**
 * Пише файл у `dir/rel`, створюючи батьківські каталоги — той самий
 * `writeFileDeep`, що решта parity-файлів.
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
 * Пише виконуваний sh-скрипт (фейковий зовнішній тул) і повертає його шлях
 * — той самий helper, що в решти трьох parity-файлів.
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
 * Ганяє `php/tooling` (full-scope, БЕЗ `exec-tool`) через JS-канон і
 * `runWasmConcern` з `files: null` (host сам будує batch за
 * `ConcernContribution::glob`).
 *
 * НЕОЧІКУВАНА знахідка (не здогад — прочитано джерело
 * `plugins/lang-php/rules/php/tooling/main.mjs`): цей ЄДИНИЙ детектор із
 * п'яти читає `existsSync('composer.json')`/`existsSync('package.json')`
 * БЕЗ `join(ctx.cwd, …)` — тобто відносно `process.cwd()` тест-раннера, а НЕ
 * `ctx.cwd` (`dir`). У продакшн-виклику `n-rules lint` це непомітно
 * (оркестрація завжди стартує з кореня репозиторію, що лінтиться —
 * `process.cwd() === ctx.cwd`), але робить прямий виклик `lint({ cwd: dir,
 * … })` з tmp-каталогу мовчки хибним: канон бачив би композитора/package.json
 * РЕАЛЬНОГО кореня цього репозиторію (`7n-rules`), не tmp-фікстури. wasm-порт
 * СТРУКТУРНО не може відтворити цю ваду — host будує full-scope batch РІВНО
 * за переданим `cwd` (`build_full_scope_files`, `crates/rules-napi/src/lib.rs`),
 * жодного «іншого process cwd» гість не бачить і бачити не може.
 *
 * Ваду ПОЛАГОДЖЕНО в самому каноні (`join(ctx.cwd, …)`), а не обійдено в
 * тесті. Перша спроба обходила її `process.chdir(dir)` на час JS-виклику —
 * і це прямо заборонено `npm/rules/test/main.mdc` («Заборона `process.chdir`
 * у тестах»): vitest тримає `pool: 'threads'`, воркери ділять один процес,
 * і паралельний файл може перехопити cwd сусіда посеред FS-операції. У
 * задокументованому інциденті це дало rogue-коміт у реальний репозиторій.
 * Крім того, еталони цього гейта знімаються САМЕ з канону — обхід у тесті
 * закарбував би ваду у фікстурах.
 * @param {string} mainMjsPath абсолютний шлях до `main.mjs`
 * @param {string} concernKey `ruleId/concernId`
 * @param {string} concernId `ctx.concernId` для JS-виклику
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runFullScopeBoth(mainMjsPath, concernKey, concernId, dir) {
  const js = await goldenJs(concernKey, dir, async () => {
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(mainMjsPath).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'php', concernId, files: undefined })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, null)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє `php/composer_manifest` (full-scope, ОДИН `exec-tool`-крок —
 * `composer validate`) через JS-канон і wasm-порт на СПІЛЬНОМУ фейковому
 * `composer`: канон резолвить його з PATH (тимчасово звуженого до каталогу
 * фейка), wasm — з `toolPaths.composer`.
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @param {string | null} composerBody тіло фейкового `composer`; `null` —
 *   канал «composer не знайдено» (порожній PATH, порожній `toolPaths`)
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runComposerManifestBoth(dir, composerBody) {
  let toolPaths = {}
  let binDir = null
  if (composerBody !== null) {
    binDir = join(dir, 'fake-bin')
    await mkdir(binDir, { recursive: true })
    const toolPath = await writeFakeTool(join(binDir, 'composer'), composerBody)
    toolPaths = { composer: toolPath }
  }
  const js = await goldenJs(COMPOSER_MANIFEST_CONCERN_KEY, dir, async () => {
    const originalPath = env.PATH
    try {
      // Виконується ЛИШЕ в режимі зняття еталонів.
      env.PATH = binDir ? `${binDir}${delimiter}${originalPath ?? ''}` : ''
      // eslint-disable-next-line no-unsanitized/method
      const { lint } = await import(pathToFileURL(COMPOSER_MANIFEST_MAIN_MJS_PATH).href)
      const jsResult = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest', files: undefined })
      return withDefaultSeverity(jsResult.violations)
    } finally {
      env.PATH = originalPath
    }
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, COMPOSER_MANIFEST_CONCERN_KEY, dir, null, toolPaths)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє `php/project` (full-scope, `composer audit` → `mago analyze`) через
 * JS-канон і wasm-порт на СПІЛЬНИХ фейкових `composer`/`mago` (доккомент
 * модуля, розділ «`mago` — pinned/bare тул»).
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @param {string | null} composerBody тіло фейкового `composer`; `null` —
 *   канал «composer не знайдено»
 * @param {string | null} magoBody тіло фейкового `mago`; `null` — НЕ
 *   використовується цим helper-ом (доккомент модуля — незадокументований
 *   канал «mago взагалі недоступний» тут не тестується на рівність)
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runProjectBoth(dir, composerBody, magoBody) {
  const toolPaths = {}
  let binDir = null
  if (composerBody !== null) {
    binDir = join(dir, 'fake-bin')
    await mkdir(binDir, { recursive: true })
    toolPaths.composer = await writeFakeTool(join(binDir, 'composer'), composerBody)
  }
  ensureToolAsyncMock.mockReset()
  if (magoBody !== null) {
    const magoDir = join(dir, 'fake-mago')
    await mkdir(magoDir, { recursive: true })
    const magoPath = await writeFakeTool(join(magoDir, 'mago'), magoBody)
    ensureToolAsyncMock.mockResolvedValue(magoPath)
    toolPaths.mago = magoPath
  }
  const js = await goldenJs(PROJECT_CONCERN_KEY, dir, async () => {
    const originalPath = env.PATH
    try {
      // Виконується ЛИШЕ в режимі зняття еталонів.
      env.PATH = binDir ? `${binDir}${delimiter}${originalPath ?? ''}` : ''
      // eslint-disable-next-line no-unsanitized/method
      const { lint } = await import(pathToFileURL(PROJECT_MAIN_MJS_PATH).href)
      const jsResult = await lint({ cwd: dir, ruleId: 'php', concernId: 'project', files: undefined })
      return withDefaultSeverity(jsResult.violations)
    } finally {
      env.PATH = originalPath
    }
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, PROJECT_CONCERN_KEY, dir, null, toolPaths)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє `php/mago_fmt`/`php/mago_lint` (per-file, спільна фабрика
 * `createMagoPerFileDetector`) через JS-канон і wasm-порт на СПІЛЬНОМУ
 * фейковому `mago`. `phpFiles` — явний delta-список (не `files: undefined`);
 * `composer.json` до wasm-batch-у приносить якір `lint.anchors` (доданий
 * цією ж задачею до `concern.json` обох концернів), ЛИШЕ коли `phpFiles`
 * непорожній — той самий гейт, що `plan_concern_for_delta`, доккомент
 * `crates/plugin-lang-python/src/lib.rs` (розділ «Per-file + якорі») і
 * `wasm-plugin-parity-python.test.mjs::runPythonToolBoth`.
 * @param {string} mainMjsPath абсолютний шлях до `main.mjs`
 * @param {string} concernKey `ruleId/concernId`
 * @param {string} concernId `ctx.concernId` для JS-виклику
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @param {string[]} phpFiles delta-список шляхів (posix-relative від `dir`)
 * @param {string | null} magoBody тіло фейкового `mago`; `null` —
 *   `ensureToolAsync` не мокається на резолв (НЕ використовується тут —
 *   доккомент модуля)
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runMagoPerFileBoth(mainMjsPath, concernKey, concernId, dir, phpFiles, magoBody) {
  ensureToolAsyncMock.mockReset()
  let toolPaths = {}
  if (magoBody !== null) {
    const magoDir = join(dir, 'fake-mago')
    await mkdir(magoDir, { recursive: true })
    const magoPath = await writeFakeTool(join(magoDir, 'mago'), magoBody)
    ensureToolAsyncMock.mockResolvedValue(magoPath)
    toolPaths = { mago: magoPath }
  }
  const js = await goldenJs(concernKey, dir, async () => {
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(mainMjsPath).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'php', concernId, files: phpFiles })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmFiles = phpFiles.length > 0 ? [...phpFiles, 'composer.json'] : phpFiles
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, wasmFiles, toolPaths)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

describe('wasm-plugin parity — php/tooling (JS канон vs wasm plugin-lang-php, full-scope, без exec-tool)', () => {
  const runToolingBoth = dir => runFullScopeBoth(TOOLING_MAIN_MJS_PATH, TOOLING_CONCERN_KEY, 'tooling', dir)

  test('composer.json і package.json є — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), CANON_MANIFEST, 'utf8')
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('composer.json відсутній — однакове tooling-порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('tooling')
      expect(js[0].message).toContain('composer.json')
    })
  })

  test('package.json відсутній — однакове tooling-порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), CANON_MANIFEST, 'utf8')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('tooling')
      expect(js[0].message).toContain('package.json')
    })
  })
})

describe('wasm-plugin parity — php/composer_manifest (JS канон vs wasm plugin-lang-php, спільний фейковий composer)', () => {
  const COMPOSER_MUST_NOT_RUN = '#!/bin/sh\necho "composer НЕ мав спавнитись" ; exit 1\n'
  const COMPOSER_CLEAN = '#!/bin/sh\nexit 0\n'

  test('composer.json відсутній — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runComposerManifestBoth(dir, COMPOSER_MUST_NOT_RUN)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('невалідний JSON — composer-manifest-invalid-json, composer НЕ спавниться', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{ "name": "nitra/demo", ', 'utf8')
      const { js, wasm } = await runComposerManifestBoth(dir, COMPOSER_MUST_NOT_RUN)
      // НЕ `expect(wasm).toEqual(js)` — задокументована розбіжність
      // (`crates/plugin-lang-php/src/lib.rs`, доккомент `JsonParser`): текст
      // `detail` у повідомленні НЕ відтворює дослівно вивід V8 `JSON.parse`
      // (свій мінімальний парсер, свої формулювання помилок). `reason`,
      // `severity`, `file`, `data` — байт-у-біт ідентичні, звіряємо їх
      // окремо від `message`.
      expect(js).toHaveLength(1)
      expect(wasm).toHaveLength(1)
      expect(js[0].reason).toBe('composer-manifest-invalid-json')
      expect(wasm[0].reason).toBe('composer-manifest-invalid-json')
      expect(wasm[0].severity).toBe(js[0].severity)
      expect(wasm[0].file).toBe(js[0].file)
      expect(wasm[0].data).toBe(js[0].data)
      expect(wasm[0].message).toContain('невалідний JSON')
    })
  })

  test('канонічний manifest, composer відсутній у PATH — обидві реалізації мовчать (тихий skip validate)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), CANON_MANIFEST, 'utf8')
      const { js, wasm } = await runComposerManifestBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('канонічний manifest, composer validate exit 0 — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), CANON_MANIFEST, 'utf8')
      const { js, wasm } = await runComposerManifestBoth(dir, COMPOSER_CLEAN)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('composer validate провалюється — однакове composer-manifest-validate-failed з деталями', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), CANON_MANIFEST, 'utf8')
      const toolBody = '#!/bin/sh\necho "# composer.json is not valid" ; exit 2\n'
      const { js, wasm } = await runComposerManifestBoth(dir, toolBody)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('composer-manifest-validate-failed')
      expect(js[0].message).toContain('composer.json is not valid')
      expect(js[0].message).toContain('код 2')
    })
  })

  test('config.sort-packages не true — однакове composer-manifest-sort-packages', async () => {
    await withTmpDir(async dir => {
      const manifest = JSON.stringify({ license: 'MIT', require: { php: '>=8.5' }, config: {} })
      await writeFile(join(dir, 'composer.json'), manifest, 'utf8')
      const { js, wasm } = await runComposerManifestBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['composer-manifest-sort-packages'])
    })
  })

  test('license відсутній — однакове composer-manifest-license-missing', async () => {
    await withTmpDir(async dir => {
      const manifest = JSON.stringify({ require: { php: '>=8.5' }, config: { 'sort-packages': true } })
      await writeFile(join(dir, 'composer.json'), manifest, 'utf8')
      const { js, wasm } = await runComposerManifestBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['composer-manifest-license-missing'])
    })
  })

  test('license — непорожній масив — обидві реалізації мовчать по license', async () => {
    await withTmpDir(async dir => {
      const manifest = JSON.stringify({
        license: ['MIT', 'Apache-2.0'],
        require: { php: '>=8.5' },
        config: { 'sort-packages': true }
      })
      await writeFile(join(dir, 'composer.json'), manifest, 'utf8')
      const { js, wasm } = await runComposerManifestBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('require.php відсутній — однакове composer-manifest-php-constraint-missing', async () => {
    await withTmpDir(async dir => {
      const manifest = JSON.stringify({ license: 'MIT', config: { 'sort-packages': true } })
      await writeFile(join(dir, 'composer.json'), manifest, 'utf8')
      const { js, wasm } = await runComposerManifestBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['composer-manifest-php-constraint-missing'])
    })
  })

  test('require.php = "*" — той самий composer-manifest-php-constraint-missing', async () => {
    await withTmpDir(async dir => {
      const manifest = JSON.stringify({ license: 'MIT', require: { php: '*' }, config: { 'sort-packages': true } })
      await writeFile(join(dir, 'composer.json'), manifest, 'utf8')
      const { js, wasm } = await runComposerManifestBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['composer-manifest-php-constraint-missing'])
    })
  })

  test('усі декларативні порушення накопичуються разом — однаковий набір reason-ів з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), JSON.stringify({ name: 'nitra/demo' }), 'utf8')
      const { js, wasm } = await runComposerManifestBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason).toSorted()).toEqual(
        [
          'composer-manifest-license-missing',
          'composer-manifest-php-constraint-missing',
          'composer-manifest-sort-packages'
        ].toSorted()
      )
    })
  })
})

describe('wasm-plugin parity — php/project (JS канон vs wasm plugin-lang-php, composer audit → mago analyze)', () => {
  const MAGO_CLEAN = '#!/bin/sh\nexit 0\n'

  test('composer.json відсутній — обидві реалізації мовчать, жоден тул не спавниться', async () => {
    await withTmpDir(async dir => {
      const composerMustNotRun = '#!/bin/sh\nexit 1\n'
      const { js, wasm } = await runProjectBoth(dir, composerMustNotRun, MAGO_CLEAN)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('composer не резолвиться в PATH — однакове composer-missing з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const { js, wasm } = await runProjectBoth(dir, null, MAGO_CLEAN)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('composer-missing')
      expect(js[0].message).toBe(
        'lint-php: `composer` не знайдено в PATH (потрібен при наявному composer.json, php.mdc)'
      )
    })
  })

  test('composer audit провалюється — однакове composer-audit-violation, mago НЕ викликається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const composerBody = '#!/bin/sh\necho "vulnerable package found" ; exit 1\n'
      const { js, wasm } = await runProjectBoth(dir, composerBody, MAGO_CLEAN)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('composer-audit-violation')
      expect(js[0].message).toContain('vulnerable package found')
    })
  })

  test('composer audit OK, немає require.php — mago analyze БЕЗ --php-version, обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), JSON.stringify({ name: 'nitra/demo' }), 'utf8')
      const composerBody = '#!/bin/sh\nexit 0\n'
      const magoBody = '#!/bin/sh\ncase "$*" in\n  "analyze") exit 0 ;;\n  *) echo "UNEXPECTED: $*" ; exit 1 ;;\nesac\n'
      const { js, wasm } = await runProjectBoth(dir, composerBody, magoBody)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('composer audit OK, require.php = ">=8.2" — mago analyze З --php-version 8.2, обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'composer.json'),
        JSON.stringify({ name: 'nitra/demo', require: { php: '>=8.2' } }),
        'utf8'
      )
      const composerBody = '#!/bin/sh\nexit 0\n'
      const magoBody =
        '#!/bin/sh\ncase "$*" in\n  "--php-version 8.2 analyze") exit 0 ;;\n  *) echo "UNEXPECTED: $*" ; exit 1 ;;\nesac\n'
      const { js, wasm } = await runProjectBoth(dir, composerBody, magoBody)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('composer.json — битий JSON — mago analyze БЕЗ --php-version (тихий fallback), обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{ not valid json', 'utf8')
      const composerBody = '#!/bin/sh\nexit 0\n'
      const magoBody = '#!/bin/sh\ncase "$*" in\n  "analyze") exit 0 ;;\n  *) echo "UNEXPECTED: $*" ; exit 1 ;;\nesac\n'
      const { js, wasm } = await runProjectBoth(dir, composerBody, magoBody)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('mago analyze провалюється — однакове mago-analyze з виводом з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      const composerBody = '#!/bin/sh\nexit 0\n'
      const magoBody = '#!/bin/sh\necho "error[undefined-method]: Call to undefined method." ; exit 1\n'
      const { js, wasm } = await runProjectBoth(dir, composerBody, magoBody)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('mago-analyze')
      expect(js[0].message).toContain('undefined-method')
    })
  })
})

describe.each([
  ['php/mago_fmt', MAGO_FMT_MAIN_MJS_PATH, MAGO_FMT_CONCERN_KEY, 'mago_fmt', ['format', '--dry-run'], 'mago-fmt-unformatted'],
  ['php/mago_lint', MAGO_LINT_MAIN_MJS_PATH, MAGO_LINT_CONCERN_KEY, 'mago_lint', ['lint'], 'mago-lint']
])('wasm-plugin parity — %s (JS канон vs wasm plugin-lang-php, per-file, спільний фейковий mago)', (
  _label,
  mainMjsPath,
  concernKey,
  concernId,
  magoArgsPrefix,
  reason
) => {
  const argsCase = magoArgsPrefix.join(' ')

  const runBoth = (dir, phpFiles, magoBody) =>
    runMagoPerFileBoth(mainMjsPath, concernKey, concernId, dir, phpFiles, magoBody)

  test('composer.json відсутній — обидві реалізації мовчать, mago не резолвиться/не спавниться', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.php', '<?php\n')
      const { js, wasm } = await runBoth(dir, ['src/a.php'], null)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
      expect(ensureToolAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('composer.json є, ctx.files без .php — обидві реалізації мовчать, mago не спавниться', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await writeFileDeep(dir, 'README.md', '# demo\n')
      const magoMustNotRun = '#!/bin/sh\nexit 1\n'
      const { js, wasm } = await runBoth(dir, ['README.md'], magoMustNotRun)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('happy-path: mago exit 0 — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await writeFileDeep(dir, 'src/Formatted.php', '<?php\n')
      const magoBody = `#!/bin/sh\ncase "$*" in\n  "${argsCase} src/Formatted.php") exit 0 ;;\n  *) echo "UNEXPECTED: $*" ; exit 1 ;;\nesac\n`
      const { js, wasm } = await runBoth(dir, ['src/Formatted.php'], magoBody)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('mago провалюється (exit 1) — однакове порушення з виводом з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await writeFileDeep(dir, 'src/Bad.php', '<?php\n')
      const magoBody = '#!/bin/sh\necho "INFO Found 1 file(s) with issues." ; exit 1\n'
      const { js, wasm } = await runBoth(dir, ['src/Bad.php'], magoBody)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe(reason)
      expect(js[0].message).toContain('INFO Found 1 file(s) with issues.')
      expect(js[0].message).toContain('код 1')
    })
  })
})

describe('wasm-plugin — size-budget (php/wasm-concerns, одна хвиля)', () => {
  test(`plugin_lang_php.wasm не перевищує бюджет ${WASM_SIZE_BUDGET_LABEL}`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThanOrEqual(WASM_SIZE_BUDGET_BYTES)
  })
})

// =====================================================================
// `php/vscode_extensions` — policy-концерн (rego + snippet, без
// `main.mjs`), портований у гостя ЦІЛКОМ: і детект, і T0-фікс (§2.77
// реєстру `docs/plans/2026-08-05-open-questions-register.md`).
//
// Еталон тут — НЕ golden-знімок, а ЖИВИЙ канон: `evaluatePolicyConcern`
// (`policy-lint-adapter.mjs`) спавнить справжній `conftest` із тим самим
// `.rego` і тим самим `--data` зі снапшота — той самий прийом, що
// [`runPolicyBoth`] у `wasm-plugin-parity.test.mjs` для rego-концернів
// `lang-js`. Фікс-половина доводиться T0-циклом крізь РЕАЛЬНИЙ napi-міст
// (detect → `runWasmConcernFix` → застосувати правки → detect чистий), той
// самий прийом, що `wasm-plugin-parity-ci-github.test.mjs`.
// =====================================================================

const VSCODE_EXT_CONCERN_KEY = 'php/vscode_extensions'
const VSCODE_EXT_TARGET = '.vscode/extensions.json'
const VSCODE_EXT_CONCERN_DIR = join(REPO_ROOT, 'plugins', 'lang-php', 'rules', 'php', 'vscode_extensions')

/**
 * Канонічні розширення — читаються зі снапшота концерну, не дублюються
 * літералом: змінять снапшот — тест піде за ним, а не почне брехати.
 * @returns {Promise<string[]>} список канонічних id розширень
 */
async function vscodeExtCanonical() {
  const raw = await readFile(join(VSCODE_EXT_CONCERN_DIR, 'template', 'extensions.json.snippet.json'), 'utf8')
  return JSON.parse(raw).recommendations
}

/**
 * `policy.missingMessage` з `concern.json` — той самий рядок, який канон
 * кладе у `policy-file-missing` (дублювати його в тесті означало б
 * перевіряти копію, а не контракт).
 * @returns {Promise<{ files: object, missingMessage: string }>} policy-поверхня концерну
 */
async function vscodeExtPolicySurface() {
  const raw = await readFile(join(VSCODE_EXT_CONCERN_DIR, 'concern.json'), 'utf8')
  return JSON.parse(raw).policy
}

/**
 * Порівнювані поля violation (контрактні, без `ruleId`/`concernId`, які
 * wasm-міст проставляє сам).
 * @param {{ reason: string, message: string, file?: string, severity?: string }} v violation будь-якого боку
 * @returns {object} нормалізована форма для звірки
 */
function pickVscodeExtFields(v) {
  return { reason: v.reason, message: v.message, file: v.file, severity: v.severity ?? 'error' }
}

/**
 * Ганяє концерн через КАНОН (`evaluatePolicyConcern` → conftest) і через
 * `runWasmConcern` (`files: null`, full-scope міст), повертаючи обидва
 * набори violations для звірки.
 * @param {string} dir абсолютний шлях tmp-дерева
 * @returns {Promise<{ js: object[], wasm: object[] }>} результати обох реалізацій
 */
async function runVscodeExtBoth(dir) {
  const { evaluatePolicyConcern } = await import('../policy-lint-adapter.mjs')
  const policy = await vscodeExtPolicySurface()
  const jsResult = await evaluatePolicyConcern(
    { cwd: dir, ruleId: 'php', concernId: 'vscode_extensions' },
    {
      engine: 'rego',
      policyDir: VSCODE_EXT_CONCERN_DIR,
      files: policy.files,
      missingMessage: policy.missingMessage
    }
  )
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, VSCODE_EXT_CONCERN_KEY, dir, null, {})
  return {
    js: jsResult.violations.map(v => pickVscodeExtFields(v)),
    wasm: wasmResult.violations.map(v => pickVscodeExtFields(v))
  }
}

/**
 * Пише `.vscode/extensions.json` у tmp-дерево.
 * @param {string} dir корінь tmp-дерева
 * @param {string} content вміст файлу
 * @returns {Promise<void>} завершення запису
 */
async function writeVscodeExtTarget(dir, content) {
  await mkdir(join(dir, '.vscode'), { recursive: true })
  await writeFile(join(dir, VSCODE_EXT_TARGET), content, 'utf8')
}

describe('wasm-plugin parity — php/vscode_extensions (rego-канон через conftest vs wasm plugin-lang-php)', () => {
  test('файл відсутній — обидві реалізації дають той самий policy-file-missing', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runVscodeExtBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('policy-file-missing')
      expect(js[0].file).toBe(VSCODE_EXT_TARGET)
    })
  })

  test('порожній recommendations — ідентичні policy-deny по кожному канонічному розширенню', async () => {
    await withTmpDir(async dir => {
      await writeVscodeExtTarget(dir, JSON.stringify({ recommendations: [] }, null, 2))
      const { js, wasm } = await runVscodeExtBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength((await vscodeExtCanonical()).length)
      expect(js.every(v => v.reason === 'policy-deny')).toBe(true)
    })
  })

  test('усі канонічні присутні (плюс сторонні) — тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const recommendations = ['some.other-extension', ...(await vscodeExtCanonical())]
      await writeVscodeExtTarget(dir, JSON.stringify({ recommendations }, null, 2))
      const { js, wasm } = await runVscodeExtBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  /**
   * ПОЛАГОДЖЕНИЙ ДЕФЕКТ КАНОНУ, не парність: `.vscode/*.json` із
   * `//`-коментарем — цілком легальний JSONC для VS Code, але conftest (Go,
   * строгий JSON) на ньому падає й канон не бачить `recommendations` узагалі.
   * Гість читає JSONC (`parse_jsonc_document`, спільний
   * `rules-template-merge`) — тиша там, де все канонічне вже на місці.
   * Тест СВІДОМО звіряє гостя з очікуваним, а не з JS: підганяти його під
   * гіршу поведінку канону означало б закріпити ваду.
   */
  test('JSONC-вхід із коментарем — гість читає файл (канон через conftest не вміє)', async () => {
    await withTmpDir(async dir => {
      const recommendations = await vscodeExtCanonical()
      await writeVscodeExtTarget(
        dir,
        `{\n  // канон команди\n  "recommendations": ${JSON.stringify(recommendations)}\n}\n`
      )
      const wasm = loadNative()
        .runWasmConcern(WASM_PATH, VSCODE_EXT_CONCERN_KEY, dir, null, {})
        .violations.map(v => pickVscodeExtFields(v))
      expect(wasm).toEqual([])
    })
  })

  test('T0-цикл через fix-міст: файла немає — fix створює канон, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      const before = loadNative().runWasmConcern(WASM_PATH, VSCODE_EXT_CONCERN_KEY, dir, null, {}).violations
      expect(before).toHaveLength(1)

      const plan = loadNative().runWasmConcernFix(WASM_PATH, VSCODE_EXT_CONCERN_KEY, dir, before, {})
      const edit = plan.edits.find(e => e.path === VSCODE_EXT_TARGET)
      expect(edit).toBeDefined()
      expect(JSON.parse(edit.content).recommendations).toEqual(await vscodeExtCanonical())

      await writeVscodeExtTarget(dir, edit.content)
      const { js, wasm } = await runVscodeExtBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('T0-цикл через fix-міст: локальні ключі й рекомендації переживають union-мерж', async () => {
    await withTmpDir(async dir => {
      await writeVscodeExtTarget(
        dir,
        JSON.stringify({ recommendations: ['local.ext'], unwantedRecommendations: ['bad.ext'] }, null, 2)
      )
      const before = loadNative().runWasmConcern(WASM_PATH, VSCODE_EXT_CONCERN_KEY, dir, null, {}).violations
      expect(before.length).toBeGreaterThan(0)

      const plan = loadNative().runWasmConcernFix(WASM_PATH, VSCODE_EXT_CONCERN_KEY, dir, before, {})
      const edit = plan.edits.find(e => e.path === VSCODE_EXT_TARGET)
      expect(edit).toBeDefined()
      const merged = JSON.parse(edit.content)
      expect(merged.recommendations).toEqual(['local.ext', ...(await vscodeExtCanonical())])
      expect(merged.unwantedRecommendations).toEqual(['bad.ext'])

      await writeVscodeExtTarget(dir, edit.content)
      const { js, wasm } = await runVscodeExtBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

// =====================================================================
// §2.88 — ЗНЯТТЯ JS-КАНОНУ ФІКСУ: `fix-vscode_extensions.mjs` видалено.
//
// `plugins/lang-php` — ПЕРШИЙ плагін, у якому борг «спершу парність»
// закрито повністю, тож цей гейт — ЗРАЗОК для решти пʼятьох партій, а не
// місцева дрібниця.
//
// Головна небезпека зняття канону — тиха втрата покриття: тест зникає
// РАЗОМ із файлом, який він імпортував, і суїт лишається зеленим, бо
// перевіряти вже нічого. Тут цього не сталось: уся характеризація рушія
// `vscode-ext-add` вище вже сформульована як «гість = ОЧІКУВАНИЙ
// результат» (канонічні розширення читаються зі снапшота концерну), а не
// як «гість = те, що робить JS», тож жодне твердження не трималось за
// видалений файл.
//
// Натомість зникла ОДНА реальна поверхня — JS-fallback у
// `loadT0Patterns` (`run-fix.mjs`: native → wasm(`guestFix`) →
// `fix-<concern>.mjs`). Доти вона гасила б випадок «гість не резолвиться»;
// тепер такого глушника немає, і саме тому твердження нижче перевіряє не
// відсутність файлу, а СКЛАД резолву:
//
// - два патерни  → канон повернувся (подвійний фікс, пастка §2.72);
// - нуль патернів → зник і гість, тобто `--fix` МОВЧКИ перестав фіксити
//   концерн, і він тихо поїхав би в дорогий LLM-ладдер.
//
// `existsSync` на видаленому файлі ловив би лише перше з двох. Резолвер
// беремо той самий, яким ходить прод, — тому це єдиний тест цього файлу,
// що йде через `loadT0Patterns`, а не через прямий `runWasmConcernFix`.
// =====================================================================
describe('§2.88 — php/vscode_extensions: фікс живе рівно в одному місці (JS-канон знято)', () => {
  test(
    'loadT0Patterns віддає РІВНО ОДИН патерн, і той — guestFix (ані канону, ані порожнечі)',
    async () => {
      await withTmpDir(async dir => {
        await writeFile(
          join(dir, '.n-rules.json'),
          JSON.stringify({ wasmPlugins: [{ name: 'lang-php', path: WASM_PATH }] }),
          'utf8'
        )
        const { loadT0Patterns } = await import('../run-fix.mjs')
        const patterns = await loadT0Patterns(VSCODE_EXT_CONCERN_DIR, 'vscode_extensions', 'php', dir)

        expect(patterns.map(p => p.guestFix === true)).toEqual([true])
      })
    },
    120_000
  )
})
