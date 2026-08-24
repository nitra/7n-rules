/**
 * Parity-тест wasm-плагіна `plugin-lang-rust` — ТРЕТЬОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`,
 * другий — `plugin-lang-python`, `wasm-plugin-parity-python.test.mjs`):
 * ганяє ОДНІ фікстури через ЖИВІ JS-детектори
 * (`plugins/lang-rust/rules/rust/<concern>/main.mjs` — Plugin API v2, канон
 * НЕ видаляється цією задачею) і через `runWasmConcern` napi-мосту
 * (`crates/rules-napi` → `crates/plugin-lang-rust`), звіряючи, що
 * `violations` ідентичні (reason/message/file/severity/data біт-у-біт) —
 * для трьох контрибуцій першої хвилі: `rust/applies`, `rust/doc_comments`,
 * `rust/workspace_root` (доккомент `crates/plugin-lang-rust/src/lib.rs`).
 *
 * НА ВІДМІНУ від `wasm-plugin-parity.test.mjs` (lang-js) і чинної форми
 * `wasm-plugin-parity-python.test.mjs` (уже конвертованої на
 * golden-фікстури, `createGoldenJs`/`wasm-parity-golden.mjs`): тут НЕМАЄ
 * golden-шару — JS-канон lang-rust ще ЖИВИЙ (усі `main.mjs` під
 * `plugins/lang-rust/rules/rust` нікуди не поділись, це лише перша хвиля
 * порту), тож кожен прогін викликає `lint()` НАПРЯМУ — та сама проста форма,
 * що `wasm-plugin-parity-python.test.mjs` мав ДО конвертації (`git show
 * 04fe23af7^:npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-python.test.mjs`).
 * Видалення JS-канону lang-rust — окрема майбутня задача, і саме тоді цей
 * файл, ймовірно, теж перейде на golden-еталони (`createGoldenJs`).
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
 * перевірки (один манiфест може отримати ОБИДВА порушення одночасно, два
 * окремі `if`, не `else if`).
 *
 * Останній describe-блок (`size-budget`) — окремо від parity: заміряє
 * реальний `plugin_lang_rust.wasm` проти того самого бюджету 2,5 MiB, що
 * `plugin-lang-js`/`plugin-lang-python` (`WASM_SIZE_BUDGET_BYTES`,
 * `wasm-plugin-parity.test.mjs`).
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'

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

const APPLIES_CONCERN_KEY = 'rust/applies'
const DOC_COMMENTS_CONCERN_KEY = 'rust/doc_comments'
const WORKSPACE_ROOT_CONCERN_KEY = 'rust/workspace_root'

/** Size-budget компонента — той самий бюджет, що `plugin-lang-js`/`plugin-lang-python` (доккомент модуля). */
const WASM_SIZE_BUDGET_BYTES = 2.5 * 1024 * 1024

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
  // file:// URL — абсолютний шлях цього файлу (realRepoRoot() + константні
  // сегменти), не вхід ззовні (той самий мотив, що lang-js/lang-python-хелпери).
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(mainMjsPath).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId, files: undefined })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, null)
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
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
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(DOC_COMMENTS_MAIN_MJS_PATH).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId: 'doc_comments', files: [fileName] })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [fileName])
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
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
      expect(
        js.some(v => v.reason === 'package-not-workspace-member' && v.file === 'crates/orphan/Cargo.toml')
      ).toBe(true)
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

describe('wasm-plugin — size-budget (rust/wasm-concerns, перша хвиля)', () => {
  test(`plugin_lang_rust.wasm не перевищує бюджет ${WASM_SIZE_BUDGET_BYTES} байт (2,5 MiB)`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThanOrEqual(WASM_SIZE_BUDGET_BYTES)
  })
})
