/**
 * Parity-тест wasm-плагіна `plugin-lang-php` — ЧЕТВЕРТОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`,
 * другий — `plugin-lang-python`, третій — `plugin-lang-rust`,
 * `wasm-plugin-parity-rust.test.mjs`): ганяє ОДНІ фікстури через ЖИВІ
 * JS-детектори (`plugins/lang-php/rules/php/<concern>/main.mjs` — Plugin API
 * v2, канон НЕ видаляється цією задачею) і через `runWasmConcern`
 * napi-мосту (`crates/rules-napi` → `crates/plugin-lang-php`), звіряючи, що
 * `violations` ідентичні (reason/message/file/severity/data біт-у-біт) —
 * для всіх п'яти концернів однієї хвилі: `php/tooling`,
 * `php/composer_manifest`, `php/project`, `php/mago_fmt`, `php/mago_lint`
 * (доккомент `crates/plugin-lang-php/src/lib.rs`).
 *
 * НА ВІДМІНУ від golden-форми (`wasm-plugin-parity-python.test.mjs` після
 * конвертації): тут НЕМАЄ golden-шару — JS-канон `lang-php` ще ЖИВИЙ (усі
 * `main.mjs` під `plugins/lang-php/rules/php` нікуди не поділись, це лише
 * одна хвиля порту), тож кожен прогін викликає `lint()` НАПРЯМУ — та сама
 * форма, що `wasm-plugin-parity-rust.test.mjs` МАВ до конвертації свого
 * `lang-rust`-сусіда на golden (`git show
 * df4665602^:npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-rust.test.mjs`).
 * Видалення JS-канону `lang-php` — окрема майбутня задача.
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
 * `wasm-plugin-parity-rust.test.mjs` для `cargo`.
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
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { env } from 'node:process'
import { pathToFileURL } from 'node:url'

import { describe, expect, test, vi } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'

const ensureToolAsyncMock = vi.fn()
vi.mock('@7n/rules/scripts/lib/ensure-tool.mjs', () => ({ ensureToolAsync: ensureToolAsyncMock }))

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_php.wasm')

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

/** Size-budget компонента — той самий бюджет, що решта трьох гостей (доккомент модуля). */
const WASM_SIZE_BUDGET_BYTES = 2.5 * 1024 * 1024

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
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(mainMjsPath).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'php', concernId, files: undefined })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, null)
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
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
  const originalPath = env.PATH
  let js
  try {
    env.PATH = binDir ? `${binDir}${delimiter}${originalPath ?? ''}` : ''
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(COMPOSER_MANIFEST_MAIN_MJS_PATH).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'php', concernId: 'composer_manifest', files: undefined })
    js = withDefaultSeverity(jsResult.violations)
  } finally {
    env.PATH = originalPath
  }
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
  const originalPath = env.PATH
  let js
  try {
    env.PATH = binDir ? `${binDir}${delimiter}${originalPath ?? ''}` : ''
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(PROJECT_MAIN_MJS_PATH).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'php', concernId: 'project', files: undefined })
    js = withDefaultSeverity(jsResult.violations)
  } finally {
    env.PATH = originalPath
  }
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
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(mainMjsPath).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'php', concernId, files: phpFiles })
  const wasmFiles = phpFiles.length > 0 ? [...phpFiles, 'composer.json'] : phpFiles
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, wasmFiles, toolPaths)
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
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
  test(`plugin_lang_php.wasm не перевищує бюджет ${WASM_SIZE_BUDGET_BYTES} байт (2,5 MiB)`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThanOrEqual(WASM_SIZE_BUDGET_BYTES)
  })
})
