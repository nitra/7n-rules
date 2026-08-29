/**
 * Parity-тест wasm-плагіна `plugin-lang-rust` — ТРЕТЬОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`,
 * другий — `plugin-lang-python`, `wasm-plugin-parity-python.test.mjs`):
 * звіряє `runWasmConcern` napi-мосту (`crates/rules-napi` →
 * `crates/plugin-lang-rust`) із ЕТАЛОНОМ — знятим виводом JS-детекторів
 * `plugins/lang-rust/rules/rust/<concern>/main.mjs` (reason/message/file/
 * severity/data біт-у-біт) — для шести контрибуцій:
 * `rust/applies`, `rust/doc_comments`, `rust/workspace_root`, `rust/check`,
 * `rust/cargo_mutants_config`, `rust/wasm_component`
 * (доккомент `crates/plugin-lang-rust/src/lib.rs`).
 *
 * ЕТАЛОН, НЕ ЖИВИЙ КАНОН: `plugins/lang-rust/rules/rust/*\/main.mjs` —
 * транзитивний шар Plugin API v2, що видаляється разом із портом (мета
 * цього тестового файлу — довести порт, не тримати JS вічно), той самий
 * прийом, що `wasm-plugin-parity-python.test.mjs` (lang-python, задача
 * #475). Поки він живий, зняти еталон можна прогнавши суїт з
 * `N_WASM_PARITY_CAPTURE=1`; звичайний прогін JS НЕ викликає — читає
 * зафіксований раніше вивід із `fixtures/wasm-parity/rust/**\/*.json`
 * ([`goldenJs`], `wasm-parity-golden.mjs` — спільний шар з
 * `wasm-plugin-parity.test.mjs`/`wasm-plugin-parity-python.test.mjs`,
 * доккомент там). Відсутній еталон — ПАДІННЯ тесту з явним проханням
 * перезняти, повернувши `main.mjs` з історії, не мовчазний пропуск: інакше
 * зникнення канону не дало б жодного сигналу.
 *
 * `rust/applies` — full-scope (`concern.json.lint.scope: "full"`), той самий
 * full-scope-мостовий виклик, що lang-js/lang-python-концерни
 * ([`runFullScopeBoth`]): виклик БЕЗ `files` (`undefined` на JS-боці, `null`
 * на wasm-боці) на обох боках — JS-оригінал ігнорує `ctx.files`, а
 * `runWasmConcern` будує batch сам через `ConcernContribution::glob` (host,
 * `crates/rules-napi::run_wasm_concern`).
 *
 * `rust/doc_comments` — per-file (`concern.json.lint.scope: "per-file"`),
 * той самий мотив, що `python/doc_comments`: `files: [fileName]` на обох
 * боках. Фікстури дзеркалять
 * `plugins/lang-rust/rules/rust/doc_comments/tests/doc_comments.test.mjs` і
 * ДОДАТКОВО покривають три місця, де наївний regex-порт розійшовся б із
 * JS-оригіналом (доккомент `crates/plugin-lang-rust/src/lib.rs`):
 *   1) `PLAIN_COMMENT_RE`'s негативний lookahead `(?![/!])` — Rust `regex`
 *      його не підтримує, порт БЕЗ regex-крейта ([`is_plain_comment_line`]);
 *      фікстура з `"////"` (чотири слеші) звіряє межовий випадок: матчить
 *      `DOC_LINE_RE` (уже doc), НЕ матчить `PLAIN_COMMENT_RE`.
 *   2) JS `\w` — ЗАВЖДИ ASCII-only (ECMA-262), Rust `regex`-крейт за
 *      замовчуванням Unicode-обізнаний — без явного ASCII-класу в
 *      `KIND_NAME_RE`-порту кириличне ім'я матчило б у Rust, але НЕ в JS;
 *      фікстура з кириличним іменем звіряє, що ОБИДВІ реалізації мовчать
 *      (рядок узагалі не розпізнається як pub-елемент).
 *   3) Модифікатори (`async`/`unsafe`/`const`) + `extern "C"` зрізаються
 *      ІТЕРАТИВНО (не одним regex) — фікстура з кількома модифікаторами
 *      поспіль звіряє порядок зрізання.
 *
 * `rust/workspace_root` — full-scope (`concern.json.lint.scope: "full"`,
 * власний обхід дерева, ігнорує `ctx.files`), той самий `runFullScopeBoth`.
 * Фікстури дзеркалять
 * `plugins/lang-rust/rules/rust/workspace_root/tests/workspace_root.test.mjs`
 * (букви a–e — той самий підпис сценарію, що коментарі тесту-джерела) і
 * ДОДАТКОВО покривають нез'ясовану в JS-тестах, але явно задокументовану в
 * `main.mjs` властивість: `nested-workspace` і `nested-profile` — НЕЗАЛЕЖНІ
 * перевірки (один маніфест може отримати ОБИДВА порушення одночасно, два
 * окремі `if`, не `else if`).
 *
 * Останній describe-блок (`size-budget`) — окремо від parity: заміряє
 * реальний `plugin_lang_rust.wasm` проти спільної для всіх гостей стелі
 * (`WASM_SIZE_BUDGET_BYTES`, `./wasm-size-budget.mjs` — там і число, і
 * походження, і межі того, що цей гейт ловить).
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { env } from 'node:process'
import { pathToFileURL } from 'node:url'

import { describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'
import { createGoldenJs } from './wasm-parity-golden.mjs'
import { WASM_SIZE_BUDGET_BYTES, WASM_SIZE_BUDGET_LABEL } from './wasm-size-budget.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_rust.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-parity-rust.test.mjs: wasm-компонент plugin-lang-rust не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-rust/build.sh'
  )
}

const RUST_RULES_DIR = join(REPO_ROOT, 'plugins', 'lang-rust', 'rules', 'rust')
const APPLIES_MAIN_MJS_PATH = join(RUST_RULES_DIR, 'applies', 'main.mjs')
const DOC_COMMENTS_MAIN_MJS_PATH = join(RUST_RULES_DIR, 'doc_comments', 'main.mjs')
const WORKSPACE_ROOT_MAIN_MJS_PATH = join(RUST_RULES_DIR, 'workspace_root', 'main.mjs')
const CHECK_MAIN_MJS_PATH = join(RUST_RULES_DIR, 'check', 'main.mjs')
/** ЖИВИЙ (не еталонний) JS-канон T0-фіксера `rust/check` — парність fix-контуру. */
const CHECK_FIX_MJS_PATH = join(RUST_RULES_DIR, 'check', 'fix-check.mjs')
const CARGO_MUTANTS_CONFIG_MAIN_MJS_PATH = join(RUST_RULES_DIR, 'cargo_mutants_config', 'main.mjs')
const WASM_COMPONENT_MAIN_MJS_PATH = join(RUST_RULES_DIR, 'wasm_component', 'main.mjs')

const APPLIES_CONCERN_KEY = 'rust/applies'
const DOC_COMMENTS_CONCERN_KEY = 'rust/doc_comments'
const WORKSPACE_ROOT_CONCERN_KEY = 'rust/workspace_root'
const CHECK_CONCERN_KEY = 'rust/check'
const CARGO_MUTANTS_CONFIG_CONCERN_KEY = 'rust/cargo_mutants_config'
const WASM_COMPONENT_CONCERN_KEY = 'rust/wasm_component'


// ---------------------------------------------------------------------
// Шар еталонів ([`goldenJs`], `wasm-parity-golden.mjs`): JS-детектори
// `plugins/lang-rust/rules/rust/*/main.mjs` — транзитивний канон Plugin
// API v2, який видаляється разом із портом. Механізм (кеш, лічильники,
// плейсхолдер tmp-шляху, помилка відсутнього еталона) — СПІЛЬНИЙ з
// `wasm-plugin-parity.test.mjs`/`wasm-plugin-parity-python.test.mjs`,
// винесений у `wasm-parity-golden.mjs`; тут лишається лише `goldenJs`,
// звʼязаний із ЦИМ файлом як підказкою команди перезняття (доккомент
// модуля вище).
const goldenJs = createGoldenJs({
  captureHintPath: 'npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-rust.test.mjs'
})
// ---------------------------------------------------------------------

/**
 * Виставляє дефолт `severity: 'error'`, якщо ключ відсутній — той самий
 * normalize-крок, що `wasm-plugin-parity.test.mjs::withDefaultSeverity`
 * (доккомент там же): raw JS `lint()` опускає дефолтне поле, WIT
 * `record diagnostic.severity` не опційне.
 * @param {unknown[]} violations сирі violations (JS чи wasm)
 * @returns {unknown[]} ті самі violations із заповненим `severity`
 */
function withDefaultSeverity(violations) {
  return violations.map(v => ({ severity: 'error', ...v }))
}

/**
 * Пише файл у `dir/rel`, створюючи батьківські каталоги — той самий
 * `writeFileDeep`, що `wasm-plugin-parity.test.mjs`/`wasm-plugin-parity-python.test.mjs`.
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
 * Ганяє один full-scope концерн через ЖИВИЙ JS-детектор (канон, ігнорує
 * `ctx.files`, сам ходить `readdirSync`/`existsSync` за `cwd`) і
 * `runWasmConcern` з `files: null` (full-scope міст, host сам будує batch за
 * `ConcernContribution::glob`) — обидва бачать УСЕ дерево `dir`.
 * @param {string} mainMjsPath абсолютний шлях до `main.mjs` JS-канону концерну
 * @param {string} concernKey `ruleId/concernId` (`detect-batch.concern-id` для wasm-виклику)
 * @param {string} concernId `ctx.concernId` для JS-виклику
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runFullScopeBoth(mainMjsPath, concernKey, concernId, dir) {
  const js = await goldenJs(concernKey, dir, async () => {
    // file:// URL — абсолютний шлях цього файлу (realRepoRoot() + константні
    // сегменти), не вхід ззовні (той самий мотив, що lang-js/lang-python-хелпери).
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(mainMjsPath).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId, files: undefined })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, null)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє одну `.rs`-фікстуру `rust/doc_comments` через JS-детектор (канон) і
 * `runWasmConcern` (wasm, per-file dispatch) — той самий мотив, що
 * `runDocCommentsBoth` у `wasm-plugin-parity-python.test.mjs`.
 * @param {string} dir абсолютний шлях tmp-каталогу (містить `fileName`)
 * @param {string} fileName posix-relative імʼя файлу у `dir`
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runDocCommentsBoth(dir, fileName) {
  const js = await goldenJs(DOC_COMMENTS_CONCERN_KEY, dir, async () => {
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(DOC_COMMENTS_MAIN_MJS_PATH).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId: 'doc_comments', files: [fileName] })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [fileName])
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє `rust/wasm_component` (per-file) через JS-детектор і `runWasmConcern`
 * з ЯВНИМ списком файлів (той самий мотив, що [`runDocCommentsBoth`]), АЛЕ
 * `fileNames` — масив (не одне ім'я): `wasm-bindgen`/`wasmtime`-перевірка
 * workspace-успадкування потребує видимості sibling-маніфестів того самого
 * батчу (доккомент `crates/plugin-lang-rust/src/lib.rs`, розділ «межа `{
 * workspace = true }`-успадкування») — на відміну від `doc_comments`, де
 * кожен файл незалежний.
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @param {string[]} fileNames posix-relative імена файлів у `dir`
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runWasmComponentBoth(dir, fileNames) {
  const js = await goldenJs(WASM_COMPONENT_CONCERN_KEY, dir, async () => {
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(WASM_COMPONENT_MAIN_MJS_PATH).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId: 'wasm_component', files: fileNames })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, WASM_COMPONENT_CONCERN_KEY, dir, fileNames)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Пише виконуваний sh-скрипт (фейковий `cargo`) і повертає його шлях — той
 * самий helper, що `writeFakeUv` у `wasm-plugin-parity-python.test.mjs`.
 * @param {string} path абсолютний шлях майбутнього бінарника
 * @param {string} body тіло скрипта разом із shebang
 * @returns {Promise<string>} той самий `path`
 */
async function writeFakeCargo(path, body) {
  await writeFile(path, body, 'utf8')
  await chmod(path, 0o755)
  return path
}

/**
 * Ганяє `rust/check` (full-scope, `exec-tool`-ланцюжок) через JS-канон і
 * wasm-порт на СПІЛЬНОМУ фейковому `cargo` — той самий мотив, що
 * `runPythonToolBoth` у `wasm-plugin-parity-python.test.mjs`, АЛЕ БЕЗ
 * golden-шару (цей файл ще ганяє JS-канон НАПРЯМУ, доккомент модуля):
 * канон резолвить `cargo` з PATH (`resolveCmd('cargo')`), тож PATH тимчасово
 * звужується до каталогу фейка (чи ПОРОЖНІЙ — канал «cargo не знайдено») й
 * відновлюється у `finally`; wasm-бік отримує абсолютний шлях фейка (чи
 * порожню мапу) у `toolPaths` (`{ cargo: toolPath }`).
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @param {string | null} toolBody тіло фейкового `cargo`; `null` — канал
 *   «cargo не знайдено» (порожній PATH, порожній `toolPaths`)
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runCheckBoth(dir, toolBody) {
  // Фейковий `cargo` пишеться на диск БЕЗУМОВНО (не лише в режимі зняття) —
  // wasm-бік справді ВИКОНУЄ цей бінарник через `toolPaths` (нижче), тож він
  // мусить існувати і в звичайному прогоні. `env.PATH`, навпаки, потрібен
  // ЛИШЕ JS-канону (`resolveCmd` читає PATH), тож підміна PATH переїхала
  // всередину `compute()` [`goldenJs`] — там, де й сам виклик `lint()` (той
  // самий мотив, що `runPythonToolBoth` у `wasm-plugin-parity-python.test.mjs`).
  let toolPaths = {}
  let binDir = null
  if (toolBody !== null) {
    binDir = join(dir, 'fake-bin')
    await mkdir(binDir, { recursive: true })
    const toolPath = await writeFakeCargo(join(binDir, 'cargo'), toolBody)
    toolPaths = { cargo: toolPath }
  }
  const js = await goldenJs(CHECK_CONCERN_KEY, dir, async () => {
    const originalPath = env.PATH
    try {
      // Виконується ЛИШЕ в режимі зняття еталонів.
      env.PATH = binDir ? `${binDir}${delimiter}${originalPath ?? ''}` : ''
      // eslint-disable-next-line no-unsanitized/method
      const { lint } = await import(pathToFileURL(CHECK_MAIN_MJS_PATH).href)
      const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId: 'check', files: undefined })
      return withDefaultSeverity(jsResult.violations)
    } finally {
      env.PATH = originalPath
    }
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, CHECK_CONCERN_KEY, dir, null, toolPaths)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє `rust/cargo_mutants_config` (full-scope, T0) через JS-канон і
 * wasm-порт. JS-канон має in-detector self-gate `.n-rules.json`
 * (`readNRulesConfigLite`, доккомент `crates/plugin-lang-rust/src/lib.rs`,
 * розділ «дві СВІДОМІ поведінкові відмінності», пункт (a)) — wasm-порт цей
 * гейт НЕ несе (не потрібен: `enabledRuleIds` фільтрує ДО диспатчу), тож
 * ОБИДВІ реалізації тут звіряються ЛИШЕ ПІСЛЯ гейту: фікстура завжди пише
 * `.n-rules.json` з `rust` у `rules`, щоб JS-канон не вийшов рано.
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runCargoMutantsConfigBoth(dir) {
  await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ rules: ['rust'] }), 'utf8')
  const js = await goldenJs(CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, async () => {
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(CARGO_MUTANTS_CONFIG_MAIN_MJS_PATH).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId: 'cargo_mutants_config', files: undefined })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, null)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

describe('wasm-plugin parity — rust/applies (JS канон vs wasm plugin-lang-rust, full-scope, чистий context-pass)', () => {
  const runAppliesBoth = dir => runFullScopeBoth(APPLIES_MAIN_MJS_PATH, APPLIES_CONCERN_KEY, 'applies', dir)

  test('Cargo.toml є — обидві реалізації мовчать (context-pass, не перевірка)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      const { js, wasm } = await runAppliesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('Cargo.toml відсутній — теж обидві реалізації мовчать (JS-канон узагалі не читає ctx)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{"name":"x"}', 'utf8')
      const { js, wasm } = await runAppliesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — rust/doc_comments (JS канон vs wasm plugin-lang-rust, per-file)', () => {
  test('файл без pub-елементів — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.rs', 'fn private_only() {}\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('//!-header + /// над pub — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '//! Намір файлу.\n\n/// Робить X.\npub fn go() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('без header і без /// — дві однакові діагностики з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.rs', 'pub fn go() {}\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js.map(v => v.reason).toSorted()).toEqual(['missing-file-header', 'missing-pub-doc'])
    })
  })

  test('//-блок над pub-елементом (атрибут між ними пропускається) — однакова promotable data', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\n\n// робить X\n#[derive(Debug)]\npub struct S {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-pub-doc')
      expect(js[0].data.promotable).toBe(true)
    })
  })

  test('провідний //-блок — однакова promotable header data з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '// намір\n/// X.\npub fn go() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-file-header')
      expect(js[0].data).toEqual({ promotable: true, fromLine: 0, toLine: 0, header: true })
    })
  })

  test('pub-елементи після #[cfg(test)] не скануються з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\n#[cfg(test)]\npub fn helper_in_tests() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('pub const NAME — kind const; pub const fn — kind fn, з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\npub const MAX: u32 = 1;\npub const fn calc() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js.map(v => v.data.name).toSorted()).toEqual(['MAX', 'calc'])
    })
  })

  test.each(['tests/helpers.rs', 'src/a_test.rs', 'src/a_tests.rs'])(
    'тестовий файл %s — поза вимогою з обох реалізацій',
    async path => {
      await withTmpDir(async dir => {
        await writeFileDeep(dir, path, 'pub fn go() {}\n')
        const { js, wasm } = await runDocCommentsBoth(dir, path)
        expect(wasm).toEqual(js)
        expect(js).toEqual([])
      })
    }
  )

  test('не-.rs файл — поза вимогою з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.py', 'pub fn go() {}\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.py')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('/// безпосередньо над елементом — уже doc, не promotable, з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\n\n/// вже є опис\npub fn go() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('без блоку коментарів — data містить лише {name} з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\n\npub fn go() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].data).toEqual({ name: 'go' })
    })
  })

  test('struct без docstring — повідомлення містить "pub struct <імʼя>" з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\npub struct Foo {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('pub struct Foo без ///-опису')
    })
  })

  // --- Межові випадки: regex-lookahead / \w-семантика / ітеративні модифікатори ---
  // (доккомент модуля вище, три пункти) — фікстури, де наївний port
  // розійшовся б із JS-оригіналом, якби не задокументовані фікси в
  // `crates/plugin-lang-rust/src/lib.rs`.

  test('"////" (чотири слеші) — уже doc (DOC_LINE_RE), НЕ promotable-plain — з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\n\n////\npub fn go() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('кириличне імʼя (pub fn облік) — JS \\w ASCII-only, рядок узагалі не pub-елемент, з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\npub fn облік() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  // Змішаний хвіст імені — сильніший випадок за суто кириличне імʼя вище:
  // тут рядок Є pub-елементом в обох реалізаціях, і розходився б не факт
  // порушення, а `data.name` у ньому (JS-`\w` зупиняється на `a`,
  // Unicode-`\w` крейта `regex` захопив би `aоблік`). Саме цю пару ловить
  // явний ASCII-клас у `DOC_COMMENTS_KIND_NAME_PATTERN`; та сама пастка
  // знайдена й полагоджена у сусідньому гості
  // (`crates/plugin-lang-python`, `DOC_COMMENTS_PUBLIC_DEF_PATTERN`).
  test('змішаний хвіст імені (pub fn aоблік) — імʼя обрізається по ASCII однаково з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\npub fn aоблік() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('fn a ')
      expect(js[0].message).not.toContain('aоблік')
    })
  })

  test('pub unsafe extern "C" fn + pub async fn — модифікатори зрізані ітеративно однаково', async () => {
    await withTmpDir(async dir => {
      const src = '//! H.\npub unsafe extern "C" fn foo() {}\npub async fn bar() {}\n'
      await writeFileDeep(dir, 'src/a.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.rs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js.some(v => v.message.includes('pub fn foo без'))).toBe(true)
      expect(js.some(v => v.message.includes('pub fn bar без'))).toBe(true)
    })
  })

  test('не-ASCII вміст (кирилиця, емодзі поза BMP) у коментарі — приймається однаково з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      // Само ім'я лишається ASCII (доккомент тесту вище щодо кириличних
      // імен) — тут не-ASCII перевіряє `content`/`message`/`file`, не сам
      // факт розпізнавання pub-елемента.
      const src = '//! Облік клієнтів — 🎉.\n\npub fn go() {}\n'
      await writeFileDeep(dir, 'pkg/облік.rs', src)
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/облік.rs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-pub-doc')
      expect(js[0].file).toBe('pkg/облік.rs')
    })
  })
})

describe('wasm-plugin parity — rust/workspace_root (JS канон vs wasm plugin-lang-rust, full-scope, власний обхід дерева)', () => {
  // Сценарії дзеркалять `plugins/lang-rust/rules/rust/workspace_root/
  // tests/workspace_root.test.mjs` (букви a–e — той самий підпис сценарію в
  // коментарі тесту, той самий мотив, що parity-юніти в `src/lib.rs`).
  // JS-канон сам ходить `readdirSync` (ігнорує `ctx.files`) — той самий
  // `runFullScopeBoth`, що `rust/applies`, з `files: null` на wasm-боці
  // (host сам будує batch за `**/Cargo.toml`, `ConcernContribution::glob`).
  const runWorkspaceRootBoth = dir =>
    runFullScopeBoth(WORKSPACE_ROOT_MAIN_MJS_PATH, WORKSPACE_ROOT_CONCERN_KEY, 'workspace_root', dir)

  /**
   * Пише Cargo.toml у `dir/relDir` (порожній `relDir` — кореневий файл) —
   * дзеркало `writeManifest` (`workspace_root.test.mjs`).
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {string} relDir відносний каталог (`''` — корінь)
   * @param {string} content вміст Cargo.toml
   * @returns {Promise<void>}
   */
  async function writeManifest(dir, relDir, content) {
    await writeFileDeep(dir, relDir ? `${relDir}/Cargo.toml` : 'Cargo.toml', content)
  }

  test('a) кореневий [workspace] покриває всіх members — чисто', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a", "crates/b"]\n')
      await writeManifest(dir, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'crates/b', '[package]\nname = "b"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('a2) glob members (crates/*) покриває всіх — чисто', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[workspace]\nresolver = "2"\nmembers = ["crates/*"]\n')
      await writeManifest(dir, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'crates/b', '[package]\nname = "b"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('b) вкладений [workspace] глибше кореня → nested-workspace violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      await writeManifest(dir, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'nested', '[workspace]\nmembers = ["sub"]\n')
      await writeManifest(dir, 'nested/sub', '[package]\nname = "sub"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.some(v => v.reason === 'nested-workspace' && v.file === 'nested/Cargo.toml')).toBe(true)
    })
  })

  test('c) єдиний кореневий [package] без нащадків — чисто (неявний workspace root)', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[package]\nname = "solo"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('d) [profile.*] у не-кореневому маніфесті → nested-profile violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      await writeManifest(
        dir,
        'crates/a',
        '[package]\nname = "a"\nversion = "0.1.0"\n\n[profile.release]\nopt-level = 3\n'
      )
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.some(v => v.reason === 'nested-profile' && v.file === 'crates/a/Cargo.toml')).toBe(true)
    })
  })

  test('nested-workspace і nested-profile в ОДНОМУ маніфесті — обидва звітуються незалежно з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[workspace]\nresolver = "2"\nmembers = ["nested"]\n')
      await writeManifest(
        dir,
        'nested',
        '[package]\nname = "nested"\nversion = "0.1.0"\n\n[workspace]\nmembers = ["x"]\n\n[profile.release]\nopt-level = 3\n'
      )
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.some(v => v.reason === 'nested-workspace')).toBe(true)
      expect(js.some(v => v.reason === 'nested-profile')).toBe(true)
    })
  })

  test('e) package не покритий members кореня → package-not-workspace-member violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      await writeManifest(dir, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'crates/orphan', '[package]\nname = "orphan"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.some(v => v.reason === 'package-not-workspace-member' && v.file === 'crates/orphan/Cargo.toml')).toBe(
        true
      )
    })
  })

  test('workspace.exclude виключає package з вимоги members — чисто з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(
        dir,
        '',
        '[workspace]\nresolver = "2"\nmembers = ["crates/*"]\nexclude = ["crates/experimental"]\n'
      )
      await writeManifest(dir, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'crates/experimental', '[package]\nname = "experimental"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('немає жодного Cargo.toml з [package] — концерн не застосовний з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('кореневий Cargo.toml відсутній, але є package-и → missing-root-workspace з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.some(v => v.reason === 'missing-root-workspace')).toBe(true)
    })
  })

  test('кореневий [package] без [workspace] + є інший package → missing-root-workspace з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[package]\nname = "root"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.some(v => v.reason === 'missing-root-workspace')).toBe(true)
    })
  })

  test('target/ і node_modules/ пропускаються обходом з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      await writeManifest(dir, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'target/debug/build/whatever', '[package]\nname = "ignored"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'node_modules/pkg', '[package]\nname = "ignored2"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('.worktrees/ (auto-created сесійний checkout) пропускається обходом з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      await writeManifest(dir, 'crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      // Копія всього дерева (кореневий + вкладений workspace) під
      // .worktrees/ — без ігнору walker знайшов би тут дублі й видав
      // nested-workspace.
      await writeManifest(dir, '.worktrees/main-lint', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      await writeManifest(dir, '.worktrees/main-lint/crates/a', '[package]\nname = "a"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — rust/check (JS канон vs wasm plugin-lang-rust, спільний фейковий cargo)', () => {
  /** `cargo` не мав би спавнитись узагалі (немає кореневого Cargo.toml). */
  const CARGO_MUST_NOT_RUN = '#!/bin/sh\nexit 1\n'

  /** Усі кроки exit 0. */
  const CARGO_ALL_CLEAN =
    '#!/bin/sh\ncase "$*" in\n' +
    '  "fmt --all -- --check") exit 0 ;;\n' +
    '  "clippy --all-targets --all-features -- -D warnings") exit 0 ;;\n' +
    '  "deny --version") exit 0 ;;\n' +
    '  "deny check licenses") exit 0 ;;\n' +
    '  *) exit 1 ;;\n' +
    'esac\n'

  test('немає кореневого Cargo.toml — обидві реалізації мовчать, cargo не спавниться', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{}', 'utf8')
      const { js, wasm } = await runCheckBoth(dir, CARGO_MUST_NOT_RUN)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('cargo не резолвиться в PATH — однакове cargo-missing порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      const { js, wasm } = await runCheckBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('cargo-missing')
      expect(js[0].message).toBe('lint-rust: `cargo` не знайдено в PATH (Rust toolchain через rustup, rust.mdc)')
    })
  })

  test('cargo fmt --check провалюється — лише cargo-fmt-violation, clippy/deny НЕ виконуються', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      const argvPath = join(dir, 'argv.txt')
      const toolBody =
        '#!/bin/sh\n' +
        `printf '%s\\n' "$*" >> "${argvPath}"\n` +
        'case "$*" in\n' +
        '  "fmt --all -- --check") echo "would reformat main.rs" ; exit 1 ;;\n' +
        '  *) exit 0 ;;\n' +
        'esac\n'
      const { js, wasm } = await runCheckBoth(dir, toolBody)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('cargo-fmt-violation')
      expect(js[0].message).toBe('lint-rust: cargo fmt --check — помилка (код 1, rust.mdc)\nwould reformat main.rs')
      // Обидва виклики (JS у режимі зняття, тоді wasm) пишуть у той самий
      // argv.txt — у звичайному прогоні JS-канон узагалі не виконується
      // (goldenJs читає еталон з диска), тож рядків може бути 1 (лише wasm)
      // чи 2 (зняття); перевірка — НЕ на кількість рядків, а на те, що
      // КОЖЕН записаний рядок — це fmt, а не clippy/deny (вони НЕ спавнились).
      const { readFile } = await import('node:fs/promises')
      const argv = await readFile(argvPath, 'utf8')
      const lines = argv.trim().split('\n')
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.every(l => l === 'fmt --all -- --check')).toBe(true)
    })
  })

  test('clippy провалюється, deny.toml відсутній — cargo-clippy-violation І deny-config-missing разом', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      const toolBody =
        '#!/bin/sh\ncase "$*" in\n' +
        '  "fmt --all -- --check") exit 0 ;;\n' +
        '  "clippy --all-targets --all-features -- -D warnings") echo "unused variable" ; exit 1 ;;\n' +
        '  *) exit 0 ;;\n' +
        'esac\n'
      const { js, wasm } = await runCheckBoth(dir, toolBody)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason).toSorted()).toEqual(['cargo-clippy-violation', 'deny-config-missing'])
    })
  })

  test('deny --version провалюється (deny не встановлено) — §2.33: видима діагностика cargo-deny-unavailable, не тиша', async () => {
    // РАНІШЕ (до §2.33, docs/plans/2026-08-05-open-questions-register.md)
    // цей сценарій закріплював мовчазний fail-open golden-канону: крок 6
    // `main.mjs` (`if status === 0 { … }` без `else`) мовчки пропускав
    // ліцензійну перевірку `cargo deny`, коли `cargo-deny` не встановлено.
    // §2.33 визнав це найгіршим режимом відмови лінтера — код виходу не
    // відрізняє «свідомо не встановлено» від «встановлено, але зламано»,
    // тож канал обрав ГУЧНІШИЙ варіант і сигналить однаково в обох
    // випадках ([`cargo_deny_unavailable_diagnostic`],
    // `crates/plugin-lang-rust/src/lib.rs`).
    //
    // Порівнювати з JS-каноном тут більше нема з чим: `main.mjs` видалено
    // разом із транзитивним періодом lang-rust, а знятий раніше golden-
    // еталон буквально закріплював мовчання — переснімати нема сенсу (і
    // нема як: `N_WASM_PARITY_CAPTURE=1` впав би на відсутньому імпорті).
    // Тому тут — пряме твердження ОЧІКУВАНОЇ поведінки гостя, БЕЗ
    // `goldenJs`/`runCheckBoth` (той самий прийом, що §2.28 — `git show
    // 362d6b59c`).
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      await writeFile(join(dir, 'deny.toml'), '', 'utf8')
      const toolBody =
        '#!/bin/sh\ncase "$*" in\n' +
        '  "fmt --all -- --check") exit 0 ;;\n' +
        '  "clippy --all-targets --all-features -- -D warnings") exit 0 ;;\n' +
        '  "deny --version") exit 1 ;;\n' +
        '  *) exit 0 ;;\n' +
        'esac\n'
      const binDir = join(dir, 'fake-bin')
      await mkdir(binDir, { recursive: true })
      const cargoPath = await writeFakeCargo(join(binDir, 'cargo'), toolBody)
      const wasm = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, CHECK_CONCERN_KEY, dir, null, { cargo: cargoPath }).violations
      )
      expect(wasm).toHaveLength(1)
      expect(wasm[0].reason).toBe('cargo-deny-unavailable')
      expect(wasm[0].severity).toBe('error')
      expect(wasm[0].message).toContain('cargo-deny')
      expect(wasm[0].message).toContain('ПРОПУЩЕНО')
    })
  })

  test('cargo deny check licenses провалюється — однакове cargo-deny-violation', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      await writeFile(join(dir, 'deny.toml'), '', 'utf8')
      const toolBody =
        '#!/bin/sh\ncase "$*" in\n' +
        '  "fmt --all -- --check") exit 0 ;;\n' +
        '  "clippy --all-targets --all-features -- -D warnings") exit 0 ;;\n' +
        '  "deny --version") exit 0 ;;\n' +
        '  "deny check licenses") echo "GPL-3.0 not allowed" ; exit 1 ;;\n' +
        '  *) exit 0 ;;\n' +
        'esac\n'
      const { js, wasm } = await runCheckBoth(dir, toolBody)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('cargo-deny-violation')
      expect(js[0].message).toBe(
        'lint-rust: cargo deny check licenses — помилка (код 1, rust.mdc)\nGPL-3.0 not allowed'
      )
    })
  })

  test('усі кроки проходять — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      await writeFile(join(dir, 'deny.toml'), '', 'utf8')
      const { js, wasm } = await runCheckBoth(dir, CARGO_ALL_CLEAN)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — rust/cargo_mutants_config (JS канон vs wasm plugin-lang-rust, T0, full-scope)', () => {
  test('немає жодного Cargo.toml — концерн не застосовний з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runCargoMutantsConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('кореневий .cargo/mutants.toml є — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, '.cargo/mutants.toml', '[[exclude_globs]]\n')
      const { js, wasm } = await runCargoMutantsConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('кореневий .cargo/mutants.toml відсутній — однакове mutants-config-missing з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
      const { js, wasm } = await runCargoMutantsConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('mutants-config-missing')
      expect(js[0].file).toBe('.cargo/mutants.toml')
    })
  })

  test('workspaces-запис у package.json резолвиться (не glob) — Tauri-маніфест пріоритетний з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]\n', 'utf8')
      await writeFile(join(dir, 'package.json'), JSON.stringify({ workspaces: ['owner'] }), 'utf8')
      await writeFileDeep(dir, 'owner/src-tauri/Cargo.toml', '[package]\nname = "tauri"\n')
      await writeFileDeep(dir, 'owner/Cargo.toml', '[package]\nname = "flat"\n')
      const { js, wasm } = await runCargoMutantsConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js.map(v => v.file).toSorted()).toEqual(['.cargo/mutants.toml', 'owner/src-tauri/.cargo/mutants.toml'])
    })
  })

  test('workspaces glob-патерн (packages/*) РОЗКРИВАЄТЬСЯ — §2.28 виправив латентний баг канону', async () => {
    // РАНІШЕ (до §2.28, `docs/plans/2026-08-05-open-questions-register.md`)
    // цей сценарій закріплював латентний баг golden-канону: JS-детектор
    // (`rust/cargo_mutants_config/main.mjs`, ще живий на момент зняття
    // еталона) трактував `workspaces`-запис як ЛІТЕРАЛЬНИЙ сегмент шляху —
    // `packages/*` шукав каталог, буквально названий `*`, і нічого не
    // знаходив; wasm-порт відтворював той самий баг байт-у-байт. §2.28
    // виправив ОБИДВІ реалізації, що споживають цю семантику:
    // [`resolve_all_cargo_manifests`] гостя (`crates/plugin-lang-rust/src/lib.rs`)
    // і `resolveAllCargoManifests` (`npm/scripts/utils/resolve-cargo-manifest.mjs`,
    // споживач — T0-фіксер `fix-cargo_mutants_config.mjs`) — детектор і
    // фіксер мають бачити ОДНАКОВИЙ набір маніфестів, інакше фіксер не
    // зміг би закрити діагностику, яку видає детектор (T0-цикл нижче
    // доводить це дією, не лише детектором окремо).
    //
    // Порівнювати з JS-каноном тут більше нема з чим: `main.mjs` видалено
    // разом із транзитивним періодом `lang-rust`, а знятий раніше
    // golden-еталон буквально закріплював баг — переснімати нема сенсу
    // (і нема як: `N_WASM_PARITY_CAPTURE=1` впав би на відсутньому
    // імпорті). Тому тут — пряме твердження ОЧІКУВАНОЇ поведінки гостя,
    // БЕЗ `goldenJs`/`runCargoMutantsConfigBoth` (той самий прийом, що
    // T0-цикл нижче: «не parity, порівнювати нема з чим»).
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]\n', 'utf8')
      await writeFile(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }), 'utf8')
      await writeFileDeep(dir, 'packages/a/Cargo.toml', '[package]\nname = "a"\n')
      const wasm = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, null).violations
      )
      // Кореневий манiфест І `packages/a` (розкритий glob) — ДВІ діагностики.
      expect(wasm).toHaveLength(2)
      expect(wasm.map(v => v.file).toSorted()).toEqual(['.cargo/mutants.toml', 'packages/a/.cargo/mutants.toml'])
    })
  })
})

describe('wasm-plugin parity — rust/wasm_component (JS канон vs wasm plugin-lang-rust, per-file)', () => {
  test('без wasm-bindgen/wasmtime — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "a"\n\n[dependencies]\nserde = "1"\n', 'utf8')
      const { js, wasm } = await runWasmComponentBoth(dir, ['Cargo.toml'])
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('пряма залежність від wasm-bindgen — однакове wasm-bindgen-forbidden з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Cargo.toml'),
        '[package]\nname = "a"\n\n[dependencies]\nwasm-bindgen = "0.2"\n',
        'utf8'
      )
      const { js, wasm } = await runWasmComponentBoth(dir, ['Cargo.toml'])
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('wasm-bindgen-forbidden')
      expect(js[0].file).toBe('Cargo.toml')
    })
  })

  test('wasmtime default-features=false без component-model — однакове wasmtime-missing-component-model', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Cargo.toml'),
        '[package]\nname = "a"\n\n[dependencies]\nwasmtime = { version = "27", default-features = false, features = ["cranelift"] }\n',
        'utf8'
      )
      const { js, wasm } = await runWasmComponentBoth(dir, ['Cargo.toml'])
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('wasmtime-missing-component-model')
    })
  })

  test('wasmtime default-features=false З component-model — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Cargo.toml'),
        '[package]\nname = "a"\n\n[dependencies]\nwasmtime = { version = "27", default-features = false, features = ["component-model"] }\n',
        'utf8'
      )
      const { js, wasm } = await runWasmComponentBoth(dir, ['Cargo.toml'])
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('{ workspace = true }-успадкована wasm-bindgen — резолвиться через кореневий manifest у батчі з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Cargo.toml'),
        '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n\n[workspace.dependencies]\nwasm-bindgen = "0.2"\n',
        'utf8'
      )
      await writeFileDeep(
        dir,
        'crates/a/Cargo.toml',
        '[package]\nname = "a"\n\n[dependencies]\nwasm-bindgen = { workspace = true }\n'
      )
      const { js, wasm } = await runWasmComponentBoth(dir, ['Cargo.toml', 'crates/a/Cargo.toml'])
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('wasm-bindgen-forbidden')
      expect(js[0].file).toBe('crates/a/Cargo.toml')
    })
  })

  test('не-.toml файл серед цілей — поза виміром з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/main.rs', 'fn main() {}\n')
      const { js, wasm } = await runWasmComponentBoth(dir, ['src/main.rs'])
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

// --- Замикання T0-циклів: гість → JS-фіксер → гість --------------------
//
// Не parity (порівнювати нема з чим): `Guest::fix` для обох цих концернів
// свідомо віддає порожній план, фіксери лишаються JS. Але після зняття
// JS-ДЕТЕКТОРІВ фіксери вперше живуть окремо від реалізації, що породжує
// їхній вхід. Раніше петлю замикали власні тести концернів
// (`checkFileDocComments(after)` / `runCheckIn` перед `applyT0`) — разом із
// детекторами вони б зникли.
//
// Особливо важливо для `cargo_mutants_config`: його `test()` матчить
// порушення за РЯДКОМ `mutants-config-missing`, який після зняття канону
// живе окремою константою у фіксері й окремою — у гості. Розходження цих
// двох рядків не зламало б жодного юніт-тесту, а фікс просто тихо
// перестав би спрацьовувати. Саме це й ловить сценарій нижче.
describe('rust/doc_comments + rust/cargo_mutants_config — T0-цикл: детект гостем → JS-фіксер → детект гостем чистий', () => {
  test('doc_comments: обидва //-блоки підвищено, повторний детект мовчить', async () => {
    await withTmpDir(async dir => {
      const rel = 'src/a.rs'
      await writeFileDeep(dir, rel, ['// намір файлу', '', '// робить X', 'pub fn go() {}', ''].join('\n'))

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [rel]).violations
      )
      expect(before).toHaveLength(2)
      expect(before.every(v => v.data?.promotable)).toBe(true)

      // eslint-disable-next-line no-unsanitized/method
      const { patterns } = await import(
        pathToFileURL(join(RUST_RULES_DIR, 'doc_comments', 'fix-doc_comments.mjs')).href
      )
      expect(patterns[0].test(before)).toBe(true)
      await patterns[0].apply(before, { cwd: dir, recordWrite: () => {} })

      const again = loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [rel])
      expect(again.violations).toEqual([])
    })
  })

  test('cargo_mutants_config: baseline створено, повторний детект мовчить (пінує рядок reason)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "x"\nversion = "0.1.0"\n', 'utf8')

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, null).violations
      )
      expect(before).toHaveLength(1)

      // eslint-disable-next-line no-unsanitized/method
      const { patterns } = await import(
        pathToFileURL(join(RUST_RULES_DIR, 'cargo_mutants_config', 'fix-cargo_mutants_config.mjs')).href
      )
      // Саме ця перевірка розсипалась би при розходженні рядка `reason`
      // між гостем і фіксером — юніт-тести обох боків лишились би зелені.
      expect(patterns[0].test(before)).toBe(true)
      await patterns[0].apply(before, { cwd: dir, recordWrite: () => {} })

      const again = loadNative().runWasmConcern(WASM_PATH, CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, null)
      expect(again.violations).toEqual([])
    })
  })

  test('cargo_mutants_config: glob-workspaces (packages/*) — фіксер створює baseline у РОЗКРИТОМУ каталозі (§2.28)', async () => {
    // Найпряміший доказ, що детектор (wasm-гість) і фіксер (JS,
    // `resolveAllCargoManifests` з `resolve-cargo-manifest.mjs`) досі
    // синхронні ПІСЛЯ §2.28: якби фіксер усе ще трактував `packages/*` як
    // літеральний сегмент (стара поведінка), `resolveAllCargoManifests(cwd)`
    // у `fix-cargo_mutants_config.mjs::apply` не знайшла б
    // `packages/a/Cargo.toml`, baseline у `packages/a/.cargo/mutants.toml`
    // не створився б, і повторний детект (`again` нижче) лишив би ту
    // діагностику — тест впав би саме на цьому кроці, не на першому.
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]\n', 'utf8')
      await writeFile(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }), 'utf8')
      await writeFileDeep(dir, 'packages/a/Cargo.toml', '[package]\nname = "a"\nversion = "0.1.0"\n')

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, null).violations
      )
      expect(before).toHaveLength(2)
      expect(before.map(v => v.file).toSorted()).toEqual(['.cargo/mutants.toml', 'packages/a/.cargo/mutants.toml'])

      // eslint-disable-next-line no-unsanitized/method
      const { patterns } = await import(
        pathToFileURL(join(RUST_RULES_DIR, 'cargo_mutants_config', 'fix-cargo_mutants_config.mjs')).href
      )
      expect(patterns[0].test(before)).toBe(true)
      await patterns[0].apply(before, { cwd: dir, recordWrite: () => {} })

      const again = loadNative().runWasmConcern(WASM_PATH, CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, null)
      expect(again.violations).toEqual([])
    })
  })
})

// --- rust/doc_comments + rust/cargo_mutants_config: замикання T0-циклу --
// через РЕАЛЬНИЙ napi-міст (§2.49 open-questions-register) ---------------
//
// Обидва концерни мають guest-фікс, ПОРТОВАНИЙ у `Guest::fix`
// (`fix_doc_comments`/`fix_cargo_mutants_config`, доккомент
// `crates/plugin-lang-rust/src/lib.rs`, розділ «ДРУГА ХВИЛЯ» /
// «Т0-фіксер ПОРТОВАНО»), і НЕ входять у `NATIVE_FIXES`
// (`crates/rules-core/src/concerns/fix.rs`) — production-шлях
// (`run-fix.mjs::loadT0Patterns`) для обох ЗАВЖДИ веде через
// `wasmFixPattern` → `runWasmConcernFix` napi-міст (`crates/rules-napi`).
//
// Describe-блок вище («T0-цикл: детект гостем → JS-фіксер → детект гостем
// чистий») цей факт НЕ перевіряє: `apply()` там береться з
// `fix-doc_comments.mjs`/`fix-cargo_mutants_config.mjs` (JS-канон,
// транзитивний шар) НАПРЯМУ — `runWasmConcernFix` там жодного разу не
// викликається. Guest-фікс (реальний код, що виконується в проді) лишається
// НЕПЕРЕВІРЕНИМ через міст. Той самий клас прогалини, що PR #513 (`js/check`,
// `wasm-plugin-parity.test.mjs`) — там повний цикл ІДЕ через
// `loadNative().runWasmConcernFix`, тут — ні. Обидва концерни нижче НЕ
// whole-batch (кожна fixable діагностика несе `diagnostic.file` —
// `workspace_root_file_violation`/per-file `Diagnostic` відповідно), тож
// цикл НЕ проходить крізь full-scope fallback `run_wasm_concern_fix`
// (той самий фолбек, що ловив баг #513 для `js/check`) — перевіряється
// file-scoped гілка моста.
describe('rust/doc_comments + rust/cargo_mutants_config — T0-цикл через fix-міст (детект гостем → runWasmConcernFix → детект гостем чистий)', () => {
  test('doc_comments: fix-міст (runWasmConcernFix) підвищує обидва //-блоки, повторний детект гостем мовчить', async () => {
    await withTmpDir(async dir => {
      const rel = 'src/a.rs'
      await writeFileDeep(dir, rel, ['// намір файлу', '', '// робить X', 'pub fn go() {}', ''].join('\n'))

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [rel]).violations
      )
      expect(before).toHaveLength(2)
      expect(before.every(v => v.file === rel)).toBe(true)

      const plan = loadNative().runWasmConcernFix(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, before)
      expect(plan.edits.length).toBeGreaterThan(0)
      for (const edit of plan.edits) {
        if (edit.type === 'write') await writeFile(join(dir, edit.path), edit.content, 'utf8')
      }

      const content = await readFile(join(dir, rel), 'utf8')
      expect(content).toContain('//! намір файлу')
      expect(content).toContain('/// робить X')
      expect(content).not.toMatch(/^\/\/ /m)

      const again = loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [rel])
      expect(again.violations).toEqual([])
    })
  })

  test('cargo_mutants_config: fix-міст (runWasmConcernFix) створює baseline, повторний детект гостем мовчить', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "x"\nversion = "0.1.0"\n', 'utf8')

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, null).violations
      )
      expect(before).toHaveLength(1)
      expect(before[0].file).toBe('.cargo/mutants.toml')

      const plan = loadNative().runWasmConcernFix(WASM_PATH, CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, before)
      expect(plan.edits).toHaveLength(1)
      expect(plan.edits[0]).toMatchObject({ type: 'write', path: '.cargo/mutants.toml' })
      for (const edit of plan.edits) {
        if (edit.type === 'write') {
          await mkdir(join(dir, dirname(edit.path)), { recursive: true })
          await writeFile(join(dir, edit.path), edit.content, 'utf8')
        }
      }

      const again = loadNative().runWasmConcern(WASM_PATH, CARGO_MUTANTS_CONFIG_CONCERN_KEY, dir, null)
      expect(again.violations).toEqual([])
    })
  })
})

describe('wasm-plugin — rust/check: T0-фіксер через fix-міст (exec-tool + host-diff)', () => {
  /**
   * Спільне джерело скаффолда `deny.toml` для JS-канону (`readFileSync`
   * у `fix-check.mjs`) і гостя (`include_str!` у `fix_check`) — саме тому
   * тест звіряє вміст edit-а з ЦИМ файлом, а не з літералом у тесті.
   */
  const DENY_SCAFFOLD_PATH = join(RUST_RULES_DIR, 'check', 'data', 'check', 'deny.toml.minimal')

  const RS_REL = 'src/main.rs'
  const RS_UNFORMATTED = 'fn  main( ){}\n'
  const RS_FORMATTED = 'fn main() {}\n'
  const DENY_INIT_CONTENT = '# generated by cargo deny init\n[licenses]\nallow = []\n'

  /** Порушення в тій самій формі, що їх віддає `detect_check` (`plain_violation`: `file: null`). */
  const violation = reason => ({ reason, message: 'm', severity: 'error', file: null })

  /**
   * Пише фейковий `cargo`, що ПРАВДИВО мутує диск на fix-кроках (як
   * справжній `cargo fmt --all`/`cargo deny init`) і логує кожен виклик.
   * @param {string} dir tmp-каталог
   * @param {{ denyVersionExit?: number, denyInitExit?: number }} cfg поведінка deny-каналу
   * @returns {Promise<{ cargoPath: string, argvPath: string }>} шлях фейка й лог викликів
   */
  async function seedFakeCargo(dir, { denyVersionExit = 1, denyInitExit = 0 } = {}) {
    const binDir = join(dir, 'fake-bin')
    await mkdir(binDir, { recursive: true })
    const argvPath = join(dir, 'argv.txt')
    const body =
      '#!/bin/sh\n' +
      `printf '%s\\n' "$*" >> "${argvPath}"\n` +
      'case "$*" in\n' +
      `  "fmt --all") printf '%s' '${RS_FORMATTED}' > "${join(dir, RS_REL)}" ; exit 0 ;;\n` +
      `  "deny --version") exit ${denyVersionExit} ;;\n` +
      `  "deny init") printf '%s' '${DENY_INIT_CONTENT}' > "${join(dir, 'deny.toml')}" ; exit ${denyInitExit} ;;\n` +
      '  *) exit 0 ;;\n' +
      'esac\n'
    const cargoPath = await writeFakeCargo(join(binDir, 'cargo'), body)
    return { cargoPath, argvPath }
  }

  /** Сіє мінімальний Rust-проєкт із НЕвідформатованим `src/main.rs`. */
  async function seedRustProject(dir) {
    await writeFile(join(dir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8')
    await writeFileDeep(dir, RS_REL, RS_UNFORMATTED)
  }

  test('cargo-fmt-violation: exec-tool мутує .rs напряму → host-diff синтезує edit саме зміненого файлу', async () => {
    await withTmpDir(async dir => {
      await seedRustProject(dir)
      const { cargoPath } = await seedFakeCargo(dir)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        CHECK_CONCERN_KEY,
        dir,
        [violation('cargo-fmt-violation')],
        { cargo: cargoPath }
      )

      // РЕД ДО ПОРТУ: `Guest::fix` не мав гілки `rust/check` → `edits: []`,
      // `cargo fmt` не спавнився взагалі, а `guestFix`-пріоритет
      // (`run-fix.mjs`) не спрацьовував — JS-канон робив ту саму роботу вдруге.
      const write = plan.edits.find(e => e.type === 'write' && e.path === RS_REL)
      expect(write).toBeDefined()
      expect(write.content).toBe(RS_FORMATTED)
      // Синтезований edit = РЕАЛЬНИЙ стан диска (мутував зовнішній процес).
      expect(await readFile(join(dir, RS_REL), 'utf8')).toBe(RS_FORMATTED)
      // Другий канал не чіпався — `deny.toml` у плані немає.
      expect(plan.edits.some(e => e.path === 'deny.toml')).toBe(false)
    })
  })

  test('deny-config-missing без cargo-deny: детермінований скаффолд БАЙТ-У-БАЙТ як у JS-канону', async () => {
    await withTmpDir(async dir => {
      await seedRustProject(dir)
      const { cargoPath, argvPath } = await seedFakeCargo(dir, { denyVersionExit: 1 })

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        CHECK_CONCERN_KEY,
        dir,
        [violation('deny-config-missing')],
        { cargo: cargoPath }
      )

      const write = plan.edits.find(e => e.type === 'write' && e.path === 'deny.toml')
      expect(write).toBeDefined()
      expect(write.content).toBe(await readFile(DENY_SCAFFOLD_PATH, 'utf8'))
      // `cargo deny init` НЕ спавнився — `--version` уже сказав «немає тула».
      expect(await readFile(argvPath, 'utf8')).not.toContain('deny init')
      // Скаффолд декларативний: гість диска не торкався, файл ще не існує.
      expect(existsSync(join(dir, 'deny.toml'))).toBe(false)

      // Парність із ЖИВИМ JS-каноном (`fix-check.mjs` не видалений): той
      // самий скаффолд, той самий шлях.
      const originalPath = env.PATH
      try {
        env.PATH = `${join(dir, 'fake-bin')}${delimiter}${originalPath ?? ''}`
        // eslint-disable-next-line no-unsanitized/method
        const { patterns } = await import(pathToFileURL(CHECK_FIX_MJS_PATH).href)
        const denyPattern = patterns.find(p => p.id === 'rust-cargo-deny-init')
        expect(denyPattern.test([violation('deny-config-missing')])).toBe(true)
        await denyPattern.apply([violation('deny-config-missing')], { cwd: dir })
      } finally {
        env.PATH = originalPath
      }
      expect(await readFile(join(dir, 'deny.toml'), 'utf8')).toBe(write.content)
    })
  })

  test('deny-config-missing із доступним cargo-deny: план несе вивід `cargo deny init`, не скаффолд', async () => {
    await withTmpDir(async dir => {
      await seedRustProject(dir)
      const { cargoPath, argvPath } = await seedFakeCargo(dir, { denyVersionExit: 0 })

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        CHECK_CONCERN_KEY,
        dir,
        [violation('deny-config-missing')],
        { cargo: cargoPath }
      )

      expect(await readFile(argvPath, 'utf8')).toContain('deny init')
      const write = plan.edits.find(e => e.type === 'write' && e.path === 'deny.toml')
      expect(write).toBeDefined()
      // Файл народив `cargo deny init` на диску — edit синтезував host-diff,
      // гість власного (скаффолдового) edit-а НЕ додав.
      expect(write.content).toBe(DENY_INIT_CONTENT)
      expect(write.content).not.toBe(await readFile(DENY_SCAFFOLD_PATH, 'utf8'))
    })
  })

  test('`cargo deny init` провалився (ненульовий код) — скаффолд усе одно закриває violation, не тиша', async () => {
    await withTmpDir(async dir => {
      await seedRustProject(dir)
      // `--version` каже «є», але сам `init` падає — JS-канон ловить це
      // через `existsSync`, гість (без файлової системи) — через код виходу.
      const binDir = join(dir, 'fake-bin')
      await mkdir(binDir, { recursive: true })
      const cargoPath = await writeFakeCargo(
        join(binDir, 'cargo'),
        '#!/bin/sh\ncase "$*" in\n  "deny --version") exit 0 ;;\n  "deny init") exit 2 ;;\n  *) exit 0 ;;\nesac\n'
      )

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        CHECK_CONCERN_KEY,
        dir,
        [violation('deny-config-missing')],
        { cargo: cargoPath }
      )

      const write = plan.edits.find(e => e.type === 'write' && e.path === 'deny.toml')
      expect(write).toBeDefined()
      expect(write.content).toBe(await readFile(DENY_SCAFFOLD_PATH, 'utf8'))
    })
  })

  test('обидва канали разом — один виклик fix() дає і fmt-мутацію, і deny.toml', async () => {
    await withTmpDir(async dir => {
      await seedRustProject(dir)
      const { cargoPath } = await seedFakeCargo(dir, { denyVersionExit: 1 })

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        CHECK_CONCERN_KEY,
        dir,
        [violation('cargo-fmt-violation'), violation('deny-config-missing')],
        { cargo: cargoPath }
      )

      const paths = plan.edits.map(e => e.path).toSorted()
      expect(paths).toContain(RS_REL)
      expect(paths).toContain('deny.toml')
    })
  })

  test('лише clippy/deny-violation — фіксер не чіпає нічого і не спавнить cargo', async () => {
    await withTmpDir(async dir => {
      await seedRustProject(dir)
      const { cargoPath, argvPath } = await seedFakeCargo(dir)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        CHECK_CONCERN_KEY,
        dir,
        [violation('cargo-clippy-violation'), violation('cargo-deny-violation')],
        { cargo: cargoPath }
      )

      expect(plan.edits).toEqual([])
      expect(existsSync(argvPath)).toBe(false)
      expect(await readFile(join(dir, RS_REL), 'utf8')).toBe(RS_UNFORMATTED)
    })
  })

  test('cargo не резолвиться — план порожній, диск не торкнутий (гість логує помилку, не мовчить)', async () => {
    await withTmpDir(async dir => {
      await seedRustProject(dir)
      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        CHECK_CONCERN_KEY,
        dir,
        [violation('cargo-fmt-violation')],
        {}
      )
      expect(plan.edits).toEqual([])
      expect(await readFile(join(dir, RS_REL), 'utf8')).toBe(RS_UNFORMATTED)
    })
  })
})

describe('wasm-plugin — size-budget (rust/wasm-concerns, перша хвиля)', () => {
  test(`plugin_lang_rust.wasm не перевищує бюджет ${WASM_SIZE_BUDGET_LABEL}`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThanOrEqual(WASM_SIZE_BUDGET_BYTES)
  })
})
