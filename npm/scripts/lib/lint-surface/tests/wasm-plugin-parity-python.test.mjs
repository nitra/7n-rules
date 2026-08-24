/**
 * Parity-тест wasm-плагіна `plugin-lang-python` — ДРУГОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`):
 * звіряє `runWasmConcern` napi-мосту (`crates/rules-napi` →
 * `crates/plugin-lang-python`) із ЕТАЛОНОМ — знятим виводом JS-детекторів
 * `plugins/lang-python/rules/python/<concern>/main.mjs` (reason/message/
 * file/severity/data біт-у-біт) — для семи контрибуцій:
 * `python/applies`, `python/tooling`, `python/doc_comments`,
 * `python/mypy`, `python/ruff`, `python/workspace_root`, `python/project`
 * (доккомент `crates/plugin-lang-python/src/lib.rs`).
 *
 * ЕТАЛОН, НЕ ЖИВИЙ КАНОН: `plugins/lang-python/rules/python/*\/main.mjs` —
 * транзитивний шар Plugin API v2, що видаляється разом із портом (мета
 * цього тестового файлу — довести порт, не тримати JS вічно), той самий
 * прийом, що `wasm-plugin-parity.test.mjs` (lang-js, задача #471,
 * `git show 55a4d0715`). Поки він живий, зняти еталон можна прогнавши суїт
 * з `N_WASM_PARITY_CAPTURE=1`; звичайний прогін JS НЕ викликає — читає
 * зафіксований раніше вивід із `fixtures/wasm-parity/python/**\/*.json`
 * ([`goldenJs`], `wasm-parity-golden.mjs` — спільний шар з
 * `wasm-plugin-parity.test.mjs`, доккомент там). Відсутній еталон — ПАДІННЯ
 * тесту з явним проханням перезняти, повернувши `main.mjs` з історії, не
 * мовчазний пропуск: інакше зникнення канону не дало б жодного сигналу.
 *
 * `python/applies`, `python/tooling`, `python/workspace_root` — full-scope
 * (`concern.json.lint.scope: "full"`), той самий full-scope-мостовий виклик,
 * що lang-js-концерни ([`runFullScopeBoth`]): виклик БЕЗ `files` (`undefined`
 * на JS-боці, `null` на wasm-боці) на обох боках — JS-оригінал ігнорує
 * `ctx.files`, а `runWasmConcern` будує batch сам через
 * `ConcernContribution::glob` (host, `crates/rules-napi::run_wasm_concern`).
 * Фікстури дзеркалять `plugins/lang-python/rules/python/tooling/tests/tooling.test.mjs`
 * і `plugins/lang-python/rules/python/workspace_root/tests/workspace_root.test.mjs`
 * (`python/applies` власних тестів не має — чистий context-pass, доккомент
 * `main.mjs`).
 *
 * `python/doc_comments` — per-file (`concern.json.lint.scope: "per-file"`),
 * той самий мотив, що `vue/tfm-translations` у lang-js ([`runDocCommentsBoth`]):
 * `files: [fileName]` на обох боках. На відміну від `js/doc_comments`
 * lang-js, тут НЕМАЄ другого рівня parity (UTF-16-офсети): `violation.data`
 * python-канону — виключно 0-індексовані номери РЯДКІВ
 * (`fromLine`/`toLine`/`headerEnd`, `main.mjs`), не байтові/UTF-16 офсети
 * символів, тож не-ASCII вміст не створює розбіжності байт↔UTF-16 — жодних
 * обов'язкових не-ASCII фікстур цей набір не потребує (задокументована
 * розбіжність із мотивом lang-js, не забутий крок). T0-фіксер
 * (`fix-doc_comments.mjs`, 64 рядки) СВІДОМО поза обсягом цієї хвилі
 * (доккомент `crates/plugin-lang-python/src/lib.rs`) — parity-фікса тут
 * немає, лише parity-детекту. Фікстури дзеркалять
 * `plugins/lang-python/rules/python/doc_comments/tests/doc_comments.test.mjs`.
 *
 * `python/mypy`/`python/ruff` ([`runPythonToolBoth`]) і `python/project`
 * ([`runProjectBoth`]) ганяють ОБИДВІ реалізації на СПІЛЬНОМУ фейковому `uv`
 * (доккомент секцій нижче) — фейковий бінарник пишеться на диск БЕЗУМОВНО
 * (wasm-бік справді його виконує через `toolPaths`), а от `env.PATH`,
 * потрібен ЛИШЕ JS-канону (`resolveCmd`), тож підміна PATH відбувається
 * ВСЕРЕДИНІ `compute()` [`goldenJs`] — виконується лише в режимі зняття.
 *
 * Останній describe-блок (`size-budget`) — окремо від parity: заміряє
 * реальний `plugin_lang_python.wasm` проти того самого бюджету 2,5 MiB, що
 * `plugin-lang-js` (`WASM_SIZE_BUDGET_BYTES`, доккомент нижче й
 * `wasm-plugin-parity.test.mjs`).
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

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_python.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-parity-python.test.mjs: wasm-компонент plugin-lang-python не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-python/build.sh'
  )
}

const PYTHON_RULES_DIR = join(REPO_ROOT, 'plugins', 'lang-python', 'rules', 'python')
const APPLIES_MAIN_MJS_PATH = join(PYTHON_RULES_DIR, 'applies', 'main.mjs')
const TOOLING_MAIN_MJS_PATH = join(PYTHON_RULES_DIR, 'tooling', 'main.mjs')
const DOC_COMMENTS_MAIN_MJS_PATH = join(PYTHON_RULES_DIR, 'doc_comments', 'main.mjs')
const DOC_COMMENTS_FIX_MJS_PATH = join(PYTHON_RULES_DIR, 'doc_comments', 'fix-doc_comments.mjs')
const WORKSPACE_ROOT_MAIN_MJS_PATH = join(PYTHON_RULES_DIR, 'workspace_root', 'main.mjs')
const PROJECT_MAIN_MJS_PATH = join(PYTHON_RULES_DIR, 'project', 'main.mjs')
const MYPY_MAIN_MJS_PATH = join(PYTHON_RULES_DIR, 'mypy', 'main.mjs')
const RUFF_MAIN_MJS_PATH = join(PYTHON_RULES_DIR, 'ruff', 'main.mjs')

const APPLIES_CONCERN_KEY = 'python/applies'
const TOOLING_CONCERN_KEY = 'python/tooling'
const DOC_COMMENTS_CONCERN_KEY = 'python/doc_comments'
const WORKSPACE_ROOT_CONCERN_KEY = 'python/workspace_root'
const PROJECT_CONCERN_KEY = 'python/project'
const MYPY_CONCERN_KEY = 'python/mypy'
const RUFF_CONCERN_KEY = 'python/ruff'

/** Size-budget компонента — той самий бюджет, що `plugin-lang-js` (доккомент модуля). */
const WASM_SIZE_BUDGET_BYTES = 2.5 * 1024 * 1024

// ---------------------------------------------------------------------
// Шар еталонів ([`goldenJs`], `wasm-parity-golden.mjs`): JS-детектори
// `plugins/lang-python/rules/python/*/main.mjs` — транзитивний канон Plugin
// API v2, який видаляється разом із портом. Механізм (кеш, лічильники,
// плейсхолдер tmp-шляху, помилка відсутнього еталона) — СПІЛЬНИЙ з
// `wasm-plugin-parity.test.mjs` (lang-js), винесений у
// `wasm-parity-golden.mjs`; тут лишається лише `goldenJs`, звʼязаний із ЦИМ
// файлом як підказкою команди перезняття (доккомент модуля вище).
const goldenJs = createGoldenJs({
  captureHintPath: 'npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-python.test.mjs'
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
 * `writeFileDeep`, що `wasm-plugin-parity.test.mjs`.
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
 * `ctx.files`, сам ходить `existsSync` за `cwd`) і `runWasmConcern` з
 * `files: null` (full-scope міст, host сам будує batch за
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
    // сегменти), не вхід ззовні (той самий мотив, що lang-js-хелпери).
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(mainMjsPath).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'python', concernId, files: undefined })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, null)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє одну `.py`-фікстуру `python/doc_comments` через JS-детектор (канон)
 * і `runWasmConcern` (wasm, per-file dispatch) — той самий мотив, що
 * `runTfmBoth` у `wasm-plugin-parity.test.mjs`.
 * @param {string} dir абсолютний шлях tmp-каталогу (містить `fileName`)
 * @param {string} fileName posix-relative імʼя файлу у `dir`
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runDocCommentsBoth(dir, fileName) {
  const js = await goldenJs(DOC_COMMENTS_CONCERN_KEY, dir, async () => {
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(DOC_COMMENTS_MAIN_MJS_PATH).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'python', concernId: 'doc_comments', files: [fileName] })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [fileName])
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

describe('wasm-plugin parity — python/applies (JS канон vs wasm plugin-lang-python, full-scope, чистий context-pass)', () => {
  const runAppliesBoth = dir => runFullScopeBoth(APPLIES_MAIN_MJS_PATH, APPLIES_CONCERN_KEY, 'applies', dir)

  test('pyproject.toml є — обидві реалізації мовчать (context-pass, не перевірка)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      const { js, wasm } = await runAppliesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('pyproject.toml відсутній — теж обидві реалізації мовчать (JS-канон узагалі не читає ctx)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{"name":"x"}', 'utf8')
      const { js, wasm } = await runAppliesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — python/tooling (JS канон vs wasm plugin-lang-python, full-scope)', () => {
  const runToolingBoth = dir => runFullScopeBoth(TOOLING_MAIN_MJS_PATH, TOOLING_CONCERN_KEY, 'tooling', dir)

  /**
   * Створює мінімальний валідний uv-проєкт у каталозі — дзеркало
   * `writeValidUvProject` (`tooling.test.mjs`).
   * @param {string} dir абсолютний шлях каталогу
   * @returns {Promise<void>}
   */
  async function writeValidUvProject(dir) {
    await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\nversion = "0.1.0"\n', 'utf8')
    await writeFile(join(dir, 'uv.lock'), 'version = 1\n', 'utf8')
    await writeFile(join(dir, 'package.json'), '{"name":"demo","private":true}', 'utf8')
    await writeFileDeep(dir, '.github/workflows/lint-python.yml', 'name: Lint Python\n')
  }

  test('не python-проєкт (без pyproject.toml) — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{"name":"x","private":true}', 'utf8')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('валідний uv-проєкт (PEP 621 + uv.lock + workflow) — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeValidUvProject(dir)
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('присутній poetry.lock — однакове порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeValidUvProject(dir)
      await writeFile(join(dir, 'poetry.lock'), '', 'utf8')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('tooling')
      expect(js[0].message).toContain('poetry.lock')
    })
  })

  test('присутній poetry.toml — однакове порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeValidUvProject(dir)
      await writeFile(join(dir, 'poetry.toml'), '', 'utf8')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('poetry.toml')
    })
  })

  test('обидва poetry-артефакти одразу — ДВІ однакові діагностики з обох реалізацій, у тому самому порядку', async () => {
    await withTmpDir(async dir => {
      await writeValidUvProject(dir)
      await writeFile(join(dir, 'poetry.lock'), '', 'utf8')
      await writeFile(join(dir, 'poetry.toml'), '', 'utf8')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].message).toContain('poetry.lock')
      expect(js[1].message).toContain('poetry.toml')
    })
  })

  test('відсутній uv.lock — однакове порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\nversion = "0.1.0"\n', 'utf8')
      await writeFile(join(dir, 'package.json'), '{"name":"demo","private":true}', 'utf8')
      await writeFileDeep(dir, '.github/workflows/lint-python.yml', 'name: Lint Python\n')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('uv.lock')
    })
  })

  test('відсутній package.json — однакове порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFile(join(dir, 'uv.lock'), 'version = 1\n', 'utf8')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('package.json')
    })
  })

  test('без workflow lint-python.yml — обидві реалізації мовчать (existence вимагає плагін ci-github)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFile(join(dir, 'uv.lock'), 'version = 1\n', 'utf8')
      await writeFile(join(dir, 'package.json'), '{"name":"demo","private":true}', 'utf8')
      const { js, wasm } = await runToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — python/doc_comments (JS канон vs wasm plugin-lang-python, per-file)', () => {
  test('файл без публічних def/class — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'pkg/mod.py', 'x = 1\ny = 2\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/mod.py')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('module-docstring + def-docstring присутні — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'pkg/mod.py',
        '"""Модуль обробки замовлень."""\n\n\ndef run():\n    """Запускає обробку."""\n    return 1\n'
      )
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/mod.py')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('відсутні обидва docstring-и — дві однакові діагностики з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'pkg/mod.py', 'def run():\n    return 1\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/mod.py')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].reason).toBe('missing-module-docstring')
      expect(js[0].data).toEqual({})
      expect(js[1].reason).toBe('missing-def-docstring')
      expect(js[1].message).toContain('def run')
    })
  })

  test('T0-придатний блок `#`-коментарів над def — однакова `data.{promotable,fromLine,toLine,headerEnd,name}`', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'pkg/mod.py',
        '"""Модуль."""\n\n\n# Опис функції\n# другий рядок\ndef run():\n    return 1\n'
      )
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/mod.py')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].data).toEqual({ promotable: true, fromLine: 3, toLine: 4, headerEnd: 5, name: 'run' })
    })
  })

  test('декоратор між коментарем і def — блок і далі promotable з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'pkg/mod.py', '"""Модуль."""\n\n\n# Опис\n@decorator\ndef run():\n    return 1\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/mod.py')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].data.promotable).toBe(true)
    })
  })

  test('без блоку коментарів — `data` містить лише `{ name }` з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'pkg/mod.py', '"""Модуль."""\n\n\ndef run():\n    return 1\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/mod.py')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].data).toEqual({ name: 'run' })
    })
  })

  test('class без docstring — повідомлення містить "class <імʼя>" з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'pkg/mod.py', '"""Модуль."""\n\n\nclass Foo:\n    def bar(self):\n        pass\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/mod.py')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('class Foo без docstring')
    })
  })

  test('docstring зі string-префіксом (r/f) приймається з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'pkg/mod.py', 'r"""Модуль."""\n\n\ndef run():\n    f"""Опис {1}."""\n    return 1\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/mod.py')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('приватний (`_`-префікс) def — файл узагалі поза вимогою з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'pkg/mod.py', 'def _private():\n    return 1\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/mod.py')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test.each(['tests/test_helpers.py', 'pkg/test_foo.py', 'pkg/foo_test.py', 'pkg/conftest.py'])(
    'тестовий файл %s — поза вимогою з обох реалізацій',
    async path => {
      await withTmpDir(async dir => {
        await writeFileDeep(dir, path, 'def run():\n    return 1\n')
        const { js, wasm } = await runDocCommentsBoth(dir, path)
        expect(wasm).toEqual(js)
        expect(js).toEqual([])
      })
    }
  )

  test('не-ASCII вміст (кирилиця, емодзі поза BMP) у docstring — приймається однаково з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      // `def`-імʼя лишається ASCII навмисно: `PUBLIC_DEF_RE`
      // (`[A-Za-z]\w*`) не бачить кириличні ідентифікатори взагалі — той
      // самий предикат, що для `_private` вище (файл поза вимогою), тож
      // не-ASCII тут перевіряє `content`/`file`, не сам факт розпізнавання
      // `def`.
      await writeFileDeep(dir, 'pkg/облік.py', '"""Модуль обліку клієнтів — 🎉."""\n\n\ndef run():\n    return 1\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'pkg/облік.py')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-def-docstring')
      expect(js[0].file).toBe('pkg/облік.py')
    })
  })
})

// --- python/doc_comments: замикання T0-циклу ---------------------------
//
// Не parity (порівнювати нема з чим): `Guest::fix` гостя для цього концерну
// свідомо віддає порожній план, T0-фіксер лишається JS
// (`fix-doc_comments.mjs`). Але після зняття JS-ДЕТЕКТОРА фіксер уперше
// живе окремо від реалізації, що породжує його вхід: у продакшені
// `violations` йому дає wasm-гість. Раніше цю петлю замикав
// `doc_comments.test.mjs` (`checkFileDocComments(after)` після `apply`) —
// разом із детектором вона б зникла, а це саме та властивість, що ловить
// фіксер, який пише текст, на який детектор далі скаржиться.
//
// Тому петля переїхала СЮДИ, де вже є гість: детект гостем → JS-фіксер →
// повторний детект гостем має бути порожній. Юніти самого фіксера
// (`buildDocstring`, форма виводу) лишились у
// `plugins/lang-python/rules/python/doc_comments/tests/fix-doc_comments.test.mjs`.
describe('python/doc_comments — T0-цикл: детект гостем → JS-фіксер → детект гостем чистий', () => {
  const tq = '"'.repeat(3)

  test('#-блок над def промотується в docstring, і повторний детект мовчить', async () => {
    await withTmpDir(async dir => {
      const rel = 'pkg/mod.py'
      await writeFileDeep(dir, rel, [`${tq}Модуль.${tq}`, '', '# робить X', 'def go():', '    return 1', ''].join('\n'))

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [rel]).violations
      )
      expect(before).toHaveLength(1)
      expect(before[0].data?.promotable).toBe(true)

      // eslint-disable-next-line no-unsanitized/method
      const { patterns } = await import(pathToFileURL(DOC_COMMENTS_FIX_MJS_PATH).href)
      expect(patterns[0].test(before)).toBe(true)
      const writes = []
      await patterns[0].apply(before, {
        cwd: dir,
        recordWrite: path => {
          writes.push(path)
        }
      })
      expect(writes).toHaveLength(1)

      const after = await readFile(join(dir, rel), 'utf8')
      expect(after).toContain(`    ${tq}робить X${tq}`)
      expect(after).not.toContain('# робить X')

      const again = loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [rel])
      expect(again.violations).toEqual([])
    })
  })
})

// --- python/mypy + python/ruff (друга хвиля, доккомент секції
// «`python/mypy` + `python/ruff`» перед `build_manifest` у
// `crates/plugin-lang-python/src/lib.rs`) -------------------------------
//
// Обидва — per-file + `lint.anchors` (НЕ full-scope — перша спроба хвилі
// full-scope замінена після рев'ю, доккомент секції в `lib.rs`): результат
// залежить від зовнішнього `uv`, тож обидві реалізації ганяють ОДИН І ТОЙ
// САМИЙ фейковий бінарник — той самий мотив, що `style/lint` у lang-js
// (`wasm-plugin-parity.test.mjs`, секція «зріз 6»). Канон резолвить `uv` з
// PATH (`resolveCmd('uv')`), тож PATH тимчасово звужується до каталогу
// фейка (чи ПОРОЖНІЙ — канал «uv не знайдено») й відновлюється у `finally`;
// wasm-бік отримує абсолютний шлях фейка (чи порожню мапу) у `toolPaths`
// (`{ uv: toolPath }`).
//
// [`runPythonToolBoth`] бере ЯВНИЙ `pyFiles` (не `files: undefined`/`null`)
// — дзеркалить те, що реально приходить у `ctx.files`/`runWasmConcern`
// delta-режиму: JS-бік отримує `pyFiles` буквально (сам фільтрує `.py`,
// `pyproject.toml` не потрібен — робить власний `existsSync`); wasm-бік
// отримує `pyFiles` ПЛЮС доданий `pyproject.toml` — той самий якір, що
// planner (`plan_concern_for_delta`, `crates/rules-core/src/lint_plan.rs`)
// додає до непорожнього delta-batch-у, а `read_source_files`
// (`crates/rules-napi/src/lib.rs`) тихо пропускає, якщо файлу немає на
// диску. Це і є сам механізм, що тестує сценарій «delta зі зміненим одним
// .py файлом» нижче: явний список — тула НЕ бачить інших `.py`-файлів
// репозиторію, на відміну від full-scope host-walk, який був би тут
// бекендом до рев'ю.

const PY_FIXTURE_PATH = 'pkg/mod.py'
const PY_FIXTURE_CONTENT = '"""Модуль."""\n\n\ndef run():\n    """Опис."""\n    return 1\n'

/** Фейковий `uv`, що завжди провалюється — детектор помилкового виклику тула в Skip-сценаріях. */
const UV_MUST_NOT_RUN = '#!/bin/sh\nexit 1\n'

/** Фейковий `uv`: `--version` (probe) і реальний запуск обидва проходять мовчки. */
const UV_CLEAN = '#!/bin/sh\ncase "$*" in\n  *--version*) exit 0 ;;\n  *) exit 0 ;;\nesac\n'

/** Фейковий `uv`: `--version` (probe) провалюється — канал «tool недоступний у uv-середовищі» (fail-open). */
const UV_TOOL_UNAVAILABLE = '#!/bin/sh\nexit 1\n'

/**
 * Пише виконуваний sh-скрипт (фейковий `uv`) і повертає його шлях — той
 * самий helper, що `writeFakeTool` у `wasm-plugin-parity.test.mjs`.
 * @param {string} path абсолютний шлях майбутнього бінарника
 * @param {string} body тіло скрипта разом із shebang
 * @returns {Promise<string>} той самий `path`
 */
async function writeFakeUv(path, body) {
  await writeFile(path, body, 'utf8')
  await chmod(path, 0o755)
  return path
}

/**
 * Ганяє `python/mypy`/`python/ruff` через JS-канон і wasm-порт на СПІЛЬНОМУ
 * фейковому `uv`, обидва в per-file delta-режимі з ЯВНИМ `pyFiles`
 * (доккомент секції вище — НЕ full-scope `files: null`).
 * @param {string} mainMjsPath абсолютний шлях до `main.mjs` JS-канону
 * @param {string} concernKey `ruleId/concernId`
 * @param {string} concernId `ctx.concernId` для JS-виклику
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @param {string[]} pyFiles delta-список `.py`-шляхів (posix-relative від `dir`)
 * @param {string | null} toolBody тіло фейкового `uv`; `null` — канал «uv не
 *   знайдено» (порожній PATH, порожній `toolPaths`)
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runPythonToolBoth(mainMjsPath, concernKey, concernId, dir, pyFiles, toolBody) {
  // Фейковий `uv` пишеться на диск БЕЗУМОВНО (не лише в режимі зняття) —
  // wasm-бік справді ВИКОНУЄ цей бінарник через `toolPaths` (нижче), тож він
  // мусить існувати і в звичайному прогоні. `env.PATH`, навпаки, потрібен
  // ЛИШЕ JS-канону (`resolveCmd` читає PATH), тож підміна PATH переїхала
  // всередину `compute()` [`goldenJs`] — там, де й сам виклик `lint()`.
  let toolPaths = {}
  let binDir = null
  if (toolBody !== null) {
    binDir = join(dir, 'fake-bin')
    await mkdir(binDir, { recursive: true })
    const toolPath = await writeFakeUv(join(binDir, 'uv'), toolBody)
    toolPaths = { uv: toolPath }
  }
  const js = await goldenJs(concernKey, dir, async () => {
    const originalPath = env.PATH
    try {
      // Канал «uv не знайдено» (`binDir === null`): PATH БЕЗ фейкового
      // `uv` — `ToolResolver` (`crates/rules-plugin-host`) не знає `uv`,
      // `exec_tool` повертає `status: none`. Виконується ЛИШЕ в режимі
      // зняття еталонів.
      env.PATH = binDir ? `${binDir}${delimiter}${originalPath ?? ''}` : ''
      // eslint-disable-next-line no-unsanitized/method
      const { lint } = await import(pathToFileURL(mainMjsPath).href)
      const jsResult = await lint({ cwd: dir, ruleId: 'python', concernId, files: pyFiles })
      return withDefaultSeverity(jsResult.violations)
    } finally {
      env.PATH = originalPath
    }
  })
  // Якір `pyproject.toml` додається ЛИШЕ до непорожнього збігу — той самий
  // гейт, що `plan_concern_for_delta` (`if files.is_empty() { None } else {
  // … append anchors … }`, доккомент секції вище).
  const wasmFiles = pyFiles.length > 0 ? [...pyFiles, 'pyproject.toml'] : pyFiles
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, wasmFiles, toolPaths)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

describe('wasm-plugin parity — python/mypy (JS канон vs wasm plugin-lang-python, спільний фейковий uv)', () => {
  const runMypyBoth = (dir, pyFiles, toolBody) =>
    runPythonToolBoth(MYPY_MAIN_MJS_PATH, MYPY_CONCERN_KEY, 'mypy', dir, pyFiles, toolBody)

  test('немає pyproject.toml — обидві реалізації мовчать, uv не спавниться', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const { js, wasm } = await runMypyBoth(dir, [PY_FIXTURE_PATH], UV_MUST_NOT_RUN)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('uv не резолвиться в PATH — однакове uv-missing порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const { js, wasm } = await runMypyBoth(dir, [PY_FIXTURE_PATH], null)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('uv-missing')
      expect(js[0].message).toBe(
        'lint-python: `uv` не знайдено в PATH (потрібен при наявному pyproject.toml, python.mdc)'
      )
    })
  })

  test('mypy недоступний у uv-середовищі (--version провалюється) — обидві реалізації мовчать (fail-open)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const { js, wasm } = await runMypyBoth(dir, [PY_FIXTURE_PATH], UV_TOOL_UNAVAILABLE)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('mypy exit 0 — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const { js, wasm } = await runMypyBoth(dir, [PY_FIXTURE_PATH], UV_CLEAN)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('mypy exit 1 з виводом — однакове mypy-violation, включно з чужим виводом у тексті', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const toolBody =
        '#!/bin/sh\ncase "$*" in\n  *--version*) exit 0 ;;\n  *) echo "mod.py:3: error: bad" ; echo "stderr-line" >&2 ; exit 1 ;;\nesac\n'
      const { js, wasm } = await runMypyBoth(dir, [PY_FIXTURE_PATH], toolBody)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('mypy-violation')
      expect(js[0].message).toBe('lint-python: mypy — помилка (код 1, python.mdc)\nmod.py:3: error: bad\nstderr-line')
    })
  })

  test('вивід довший за 2000 символів обрізається однаково обома реалізаціями', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const toolBody = `#!/bin/sh\ncase "$*" in\n  *--version*) exit 0 ;;\n  *) printf '%s' '${'x'.repeat(3000)}' ; exit 1 ;;\nesac\n`
      const { js, wasm } = await runMypyBoth(dir, [PY_FIXTURE_PATH], toolBody)
      expect(wasm).toEqual(js)
      expect(js[0].message).toBe(`lint-python: mypy — помилка (код 1, python.mdc)\n${'x'.repeat(2000)}`)
    })
  })

  test('delta зі зміненим лише одним .py файлом — тула отримує ЛИШЕ його, не увесь репозиторій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, 'pkg/changed.py', PY_FIXTURE_CONTENT)
      await writeFileDeep(dir, 'pkg/untouched.py', PY_FIXTURE_CONTENT)
      const argvPath = join(dir, 'argv.txt')
      // Реальний запуск (не `--version`) дописує СВОЇ аргументи в
      // `argv.txt` — і JS-канон (перший виклик), і wasm-порт (другий,
      // доккомент [`runPythonToolBoth`]) переписують той самий файл, тож
      // після прогону в ньому лишається слід ОСТАННЬОГО (wasm) виклику —
      // саме той бік, чию поведінку тут перевіряємо.
      const toolBody =
        '#!/bin/sh\ncase "$*" in\n' +
        '  *--version*) exit 0 ;;\n' +
        `  *) printf '%s' "$*" > "${argvPath}" ; exit 0 ;;\n` +
        'esac\n'
      const { js, wasm } = await runMypyBoth(dir, ['pkg/changed.py'], toolBody)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
      const { readFile } = await import('node:fs/promises')
      const argv = await readFile(argvPath, 'utf8')
      expect(argv).toContain('pkg/changed.py')
      expect(argv).not.toContain('pkg/untouched.py')
    })
  })
})

describe('wasm-plugin parity — python/ruff (JS канон vs wasm plugin-lang-python, спільний фейковий uv)', () => {
  const runRuffBoth = (dir, pyFiles, toolBody) =>
    runPythonToolBoth(RUFF_MAIN_MJS_PATH, RUFF_CONCERN_KEY, 'ruff', dir, pyFiles, toolBody)

  test('немає pyproject.toml — обидві реалізації мовчать, uv не спавниться', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const { js, wasm } = await runRuffBoth(dir, [PY_FIXTURE_PATH], UV_MUST_NOT_RUN)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('uv не резолвиться в PATH — однакове uv-missing порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const { js, wasm } = await runRuffBoth(dir, [PY_FIXTURE_PATH], null)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('uv-missing')
      expect(js[0].message).toBe(
        'lint-python: `uv` не знайдено в PATH (потрібен при наявному pyproject.toml, python.mdc)'
      )
    })
  })

  test('ruff недоступний у uv-середовищі (--version провалюється) — обидві реалізації мовчать (fail-open)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const { js, wasm } = await runRuffBoth(dir, [PY_FIXTURE_PATH], UV_TOOL_UNAVAILABLE)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('ruff check + format --check обидва exit 0 — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const { js, wasm } = await runRuffBoth(dir, [PY_FIXTURE_PATH], UV_CLEAN)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('ruff check провалюється — лише ruff-check-violation, format --check НЕ виконується', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const toolBody =
        '#!/bin/sh\ncase "$*" in\n' +
        '  *--version*) exit 0 ;;\n' +
        '  *"format --check"*) echo "FORMAT МАВ НЕ ВИКОНАТИСЬ" ; exit 1 ;;\n' +
        '  *"ruff check"*) echo "F401 unused import" ; exit 1 ;;\n' +
        '  *) exit 0 ;;\n' +
        'esac\n'
      const { js, wasm } = await runRuffBoth(dir, [PY_FIXTURE_PATH], toolBody)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('ruff-check-violation')
      expect(js[0].message).toBe('lint-python: ruff check — помилка (код 1, python.mdc)\nF401 unused import')
    })
  })

  test('ruff check ОК, format --check провалюється — однакове ruff-format-violation', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, PY_FIXTURE_PATH, PY_FIXTURE_CONTENT)
      const toolBody =
        '#!/bin/sh\ncase "$*" in\n' +
        '  *--version*) exit 0 ;;\n' +
        '  *"format --check"*) echo "Would reformat mod.py" ; exit 1 ;;\n' +
        '  *"ruff check"*) exit 0 ;;\n' +
        '  *) exit 0 ;;\n' +
        'esac\n'
      const { js, wasm } = await runRuffBoth(dir, [PY_FIXTURE_PATH], toolBody)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('ruff-format-violation')
      expect(js[0].message).toBe(
        'lint-python: ruff format --check — помилка (код 1, python.mdc)\nWould reformat mod.py'
      )
    })
  })

  test('delta зі зміненим лише одним .py файлом — тула отримує ЛИШЕ його, не увесь репозиторій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      await writeFileDeep(dir, 'pkg/changed.py', PY_FIXTURE_CONTENT)
      await writeFileDeep(dir, 'pkg/untouched.py', PY_FIXTURE_CONTENT)
      const argvPath = join(dir, 'argv.txt')
      const toolBody =
        '#!/bin/sh\ncase "$*" in\n' +
        '  *--version*) exit 0 ;;\n' +
        `  *"format --check"*) printf '%s' "$*" >> "${argvPath}" ; exit 0 ;;\n` +
        `  *) printf '%s\\n' "$*" >> "${argvPath}" ; exit 0 ;;\n` +
        'esac\n'
      const { js, wasm } = await runRuffBoth(dir, ['pkg/changed.py'], toolBody)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
      const { readFile } = await import('node:fs/promises')
      const argv = await readFile(argvPath, 'utf8')
      expect(argv).toContain('pkg/changed.py')
      expect(argv).not.toContain('pkg/untouched.py')
    })
  })
})

describe('wasm-plugin parity — python/workspace_root (JS канон vs wasm plugin-lang-python, full-scope, власний обхід дерева)', () => {
  // Сценарії дзеркалять `plugins/lang-python/rules/python/workspace_root/
  // tests/workspace_root.test.mjs` (букви a–g — той самий підпис сценарію в
  // коментарі тесту, той самий мотив, що parity-юніти в `src/lib.rs`).
  // JS-канон сам ходить `readdirSync` (ігнорує `ctx.files`, доккомент
  // `main.mjs`) — той самий `runFullScopeBoth`, що `python/applies`/
  // `python/tooling`, з `files: null` на wasm-боці (host сам будує batch за
  // `**/pyproject.toml`/`**/uv.lock`, `ConcernContribution::glob`).
  const runWorkspaceRootBoth = dir =>
    runFullScopeBoth(WORKSPACE_ROOT_MAIN_MJS_PATH, WORKSPACE_ROOT_CONCERN_KEY, 'workspace_root', dir)

  /**
   * Пише pyproject.toml у `dir/relDir` (порожній `relDir` — кореневий файл) —
   * дзеркало `writeManifest` (`workspace_root.test.mjs`).
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {string} relDir відносний каталог (`''` — корінь)
   * @param {string} content вміст pyproject.toml
   * @returns {Promise<void>}
   */
  async function writeManifest(dir, relDir, content) {
    await writeFileDeep(dir, relDir ? `${relDir}/pyproject.toml` : 'pyproject.toml', content)
  }

  /**
   * Пише uv.lock у `dir/relDir` — дзеркало `writeLock` (`workspace_root.test.mjs`).
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {string} relDir відносний каталог (`''` — корінь)
   * @returns {Promise<void>}
   */
  async function writeLock(dir, relDir) {
    await writeFileDeep(dir, relDir ? `${relDir}/uv.lock` : 'uv.lock', 'version = 1\n')
  }

  test('a) кореневий [tool.uv.workspace] покриває всіх members — чисто', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[tool.uv.workspace]\nmembers = ["packages/a", "packages/b"]\n')
      await writeManifest(dir, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'packages/b', '[project]\nname = "b"\nversion = "0.1.0"\n')
      await writeLock(dir, '')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('b) вкладений package без кореневого workspace взагалі → missing-root-workspace', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-root-workspace')
      expect(js[0].file).toBeUndefined()
    })
  })

  test('c) єдиний кореневий [project] без нащадків — чисто (неявний workspace root)', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[project]\nname = "solo"\nversion = "0.1.0"\n')
      await writeLock(dir, '')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('d) вкладений [tool.uv.workspace] глибше кореня → nested-workspace violation', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[tool.uv.workspace]\nmembers = ["packages/a"]\n')
      await writeManifest(dir, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'nested', '[tool.uv.workspace]\nmembers = ["sub"]\n')
      await writeManifest(dir, 'nested/sub', '[project]\nname = "sub"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.some(v => v.reason === 'nested-workspace' && v.file === 'nested/pyproject.toml')).toBe(true)
    })
  })

  test('e) package не покритий members кореня (і не excluded) → package-not-workspace-member violation', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[tool.uv.workspace]\nmembers = ["packages/a"]\n')
      await writeManifest(dir, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'packages/orphan', '[project]\nname = "orphan"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(
        js.some(v => v.reason === 'package-not-workspace-member' && v.file === 'packages/orphan/pyproject.toml')
      ).toBe(true)
    })
  })

  test('f) вкладений uv.lock у не-excluded member → nested-lockfile violation', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[tool.uv.workspace]\nmembers = ["packages/a"]\n')
      await writeManifest(dir, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      await writeLock(dir, '')
      await writeLock(dir, 'packages/a')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.some(v => v.reason === 'nested-lockfile' && v.file === 'packages/a/uv.lock')).toBe(true)
    })
  })

  test('g) вкладений uv.lock у EXCLUDED member — чисто (escape hatch для конфліктних залежностей)', async () => {
    await withTmpDir(async dir => {
      await writeManifest(
        dir,
        '',
        '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/conflicting"]\n'
      )
      await writeManifest(dir, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'packages/conflicting', '[project]\nname = "conflicting"\nversion = "0.1.0"\n')
      await writeLock(dir, '')
      await writeLock(dir, 'packages/conflicting')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('немає жодного pyproject.toml з [project] — концерн не застосовний', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'app.py', 'print("hi")\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('.venv/ і node_modules/ пропускаються обходом з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeManifest(dir, '', '[tool.uv.workspace]\nmembers = ["packages/a"]\n')
      await writeManifest(dir, 'packages/a', '[project]\nname = "a"\nversion = "0.1.0"\n')
      await writeManifest(dir, '.venv/lib/site-packages/foo', '[project]\nname = "ignored"\nversion = "0.1.0"\n')
      await writeManifest(dir, 'node_modules/pkg', '[project]\nname = "ignored2"\nversion = "0.1.0"\n')
      const { js, wasm } = await runWorkspaceRootBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

/**
 * Пише виконуваний фейковий `uv` у `<dir>/.fake-bin/uv` і повертає його
 * абсолютний шлях — той самий мотив, що `write_executable_script`
 * (`crates/rules-plugin-host/tests/contract_test_kit.rs`,
 * `run_tool_reaches_resolved_fake_tool_binary`), адаптований для Node:
 * `python/project` (доккомент `crates/plugin-lang-python/src/lib.rs`)
 * розрізняє ЧОТИРИ кроки ланцюжка (`uv lock --check` → `uv sync --frozen` →
 * `uv run --frozen pip-licenses --version` → `uv run --frozen pip-licenses
 * --from=mixed --format=spdx-json`) виключно за `argv`, тож ОДИН скрипт
 * ([`fakeUvScript`]) диспетчеризує усі чотири. Обидві реалізації бачать
 * РІВНО той самий бінарник: wasm — через `toolPaths: { uv: … }`
 * (`crates/rules-napi::run_wasm_concern`/`build_tool_resolver`), JS-канон —
 * через тимчасово підмінений `PATH` ([`withUvOnPath`]).
 * @param {string} dir абсолютний шлях tmp-каталогу
 * @param {string} script POSIX shell-скрипт (без рядка `#!/bin/sh` — додається тут)
 * @returns {Promise<string>} абсолютний шлях виконуваного файлу `uv`
 */
async function writeFakeTool(dir, script) {
  const binDir = join(dir, '.fake-bin')
  await mkdir(binDir, { recursive: true })
  const path = join(binDir, 'uv')
  await writeFile(path, `#!/bin/sh\n${script}`, 'utf8')
  await chmod(path, 0o755)
  return path
}

/**
 * Генерує тіло POSIX shell-скрипта фейкового `uv` — `case` за ПОВНИМ рядком
 * аргументів (`"$*"`), той самий диспетчер, що реальний ланцюжок
 * `detect_project` (`crates/plugin-lang-python/src/lib.rs`). Крок, не
 * досягнутий у конкретному сценарії (наприклад, `sync`, коли `lock` уже
 * провалився), просто НЕ викликається — case для нього не спрацює, а
 * дефолтна гілка (`*`) падає з `argv` у stderr, щоб непередбачений виклик
 * провалив тест голосно, а не тихо пройшов.
 * @param {{ lock?: string, sync?: string, version?: string, scan?: string }} steps
 *   shell-тіло (без `case`-обгортки) для кожного кроку; відсутній крок —
 *   дефолт `exit 0`.
 * @returns {string} тіло POSIX shell-скрипта (без рядка `#!/bin/sh`)
 */
function fakeUvScript(steps = {}) {
  const step = body => body ?? 'exit 0'
  return `case "$*" in
  "lock --check")
${step(steps.lock)}
    ;;
  "sync --frozen")
${step(steps.sync)}
    ;;
  "run --frozen pip-licenses --version")
${step(steps.version)}
    ;;
  "run --frozen pip-licenses --from=mixed --format=spdx-json")
${step(steps.scan)}
    ;;
  *)
    echo "fake uv: несподівані аргументи: $*" >&2
    exit 1
    ;;
esac
`
}

/**
 * Тимчасово ЗАМІНЮЄ `process.env.PATH` (не додає до наявного) на час
 * виконання `fn` і гарантовано відновлює після — `resolveCmd`
 * (`npm/scripts/utils/resolve-cmd.mjs`) читає `process.env.PATH` живцем на
 * кожен виклик (доккомент того модуля), тож підміна видима одразу.
 * Заміна, а не префікс: якщо на машині, де запущено тест, реально
 * встановлений `uv`, префікс лишив би його резолвним як другого кандидата й
 * тест перестав би бути детермінованим (вимога задачі — не залежати від
 * того, що є на машині).
 * @param {string | null} uvPath абсолютний шлях фейкового `uv` чи `null` —
 *   PATH стає порожнім, `uv` НЕ резолвиться взагалі
 * @param {() => Promise<T>} fn робота, що має бачити (чи не бачити) фейковий `uv`
 * @returns {Promise<T>} результат `fn`
 * @template T
 */
async function withUvOnPath(uvPath, fn) {
  const original = env.PATH
  env.PATH = uvPath ? dirname(uvPath) : ''
  try {
    return await fn()
  } finally {
    if (original === undefined) delete env.PATH
    else env.PATH = original
  }
}

/**
 * Ганяє `python/project` через JS-канон (у режимі зняття — бачить фейковий
 * `uv` через підмінений `PATH`, [`withUvOnPath`], усередині `compute()`
 * [`goldenJs`]) і `runWasmConcern` з `toolPaths: { uv: uvPath }`
 * (`crates/rules-napi::run_wasm_concern`/`build_tool_resolver`) — обидва
 * боки резолвлять РІВНО той самий скрипт (файл на диску пише виклик-сайт
 * БЕЗУМОВНО, `writeFakeTool`, — wasm-бік його справді виконує). `uvPath:
 * null` — жоден бік не резолвить `uv` взагалі (сценарій «інструмента
 * немає»).
 * @param {string} dir абсолютний шлях tmp-каталогу з фікстурами
 * @param {string | null} uvPath шлях фейкового `uv` чи `null`
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runProjectBoth(dir, uvPath) {
  const js = await goldenJs(PROJECT_CONCERN_KEY, dir, async () => {
    // Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(PROJECT_MAIN_MJS_PATH).href)
    const jsResult = await withUvOnPath(uvPath, () =>
      lint({ cwd: dir, ruleId: 'python', concernId: 'project', files: undefined })
    )
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(
    WASM_PATH,
    PROJECT_CONCERN_KEY,
    dir,
    null,
    uvPath ? { uv: uvPath } : {}
  )
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

describe('wasm-plugin parity — python/project (JS канон vs wasm plugin-lang-python, full-scope, exec-tool)', () => {
  test('pyproject.toml відсутній — обидві реалізації мовчать (uv узагалі не спавниться)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{"name":"x"}', 'utf8')
      const { js, wasm } = await runProjectBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('uv відсутній у PATH — однакове порушення `uv-missing` з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      const { js, wasm } = await runProjectBoth(dir, null)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('uv-missing')
      expect(js[0].message).toContain('`uv` не знайдено в PATH')
    })
  })

  test('`uv lock --check` провалюється — однакове порушення `uv-lock-violation` з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      const uvPath = await writeFakeTool(
        dir,
        fakeUvScript({ lock: 'echo "lock stdout"\necho "lock stderr" >&2\nexit 1' })
      )
      const { js, wasm } = await runProjectBoth(dir, uvPath)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('uv-lock-violation')
      expect(js[0].message).toContain('uv lock --check')
      expect(js[0].message).toContain('lock stdout')
      expect(js[0].message).toContain('lock stderr')
    })
  })

  test('`uv sync --frozen` провалюється — однакове порушення `uv-sync-violation` з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      const uvPath = await writeFakeTool(
        dir,
        fakeUvScript({ sync: 'echo "sync stdout"\necho "sync stderr" >&2\nexit 1' })
      )
      const { js, wasm } = await runProjectBoth(dir, uvPath)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('uv-sync-violation')
      expect(js[0].message).toContain('uv sync --frozen')
    })
  })

  test('pip-licenses недоступний у uv-середовищі — fail-open, обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      const uvPath = await writeFakeTool(dir, fakeUvScript({ version: 'exit 1' }))
      const { js, wasm } = await runProjectBoth(dir, uvPath)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('спавн `pip-licenses` (сам скан) провалюється — однакове порушення `pip-licenses-error`', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      const uvPath = await writeFakeTool(dir, fakeUvScript({ scan: 'exit 1' }))
      const { js, wasm } = await runProjectBoth(dir, uvPath)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('pip-licenses-error')
    })
  })

  test('чистий валідний стан (усі кроки ОК, дозволена ліцензія) — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      const uvPath = await writeFakeTool(
        dir,
        fakeUvScript({
          scan: 'printf \'%s\' \'{"packages":[{"name":"demo-pkg","versionInfo":"1.0.0","licenseDeclared":"MIT"}]}\'\nexit 0'
        })
      )
      const { js, wasm } = await runProjectBoth(dir, uvPath)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('ліцензія поза Blue Oak Bronze+ — однакове порушення `license-violation` з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      const uvPath = await writeFakeTool(
        dir,
        fakeUvScript({
          scan: 'printf \'%s\' \'{"packages":[{"name":"bad-pkg","versionInfo":"2.0.0","licenseDeclared":"GPL-3.0-only"}]}\'\nexit 0'
        })
      )
      const { js, wasm } = await runProjectBoth(dir, uvPath)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('license-violation')
      expect(js[0].message).toContain('bad-pkg@2.0.0: GPL-3.0-only')
    })
  })

  test('складений SPDX-вираз `MIT OR Apache-2.0` (обидві частини дозволені) — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8')
      const uvPath = await writeFakeTool(
        dir,
        fakeUvScript({
          scan: 'printf \'%s\' \'{"packages":[{"name":"dual-pkg","versionInfo":"3.0.0","licenseDeclared":"MIT OR Apache-2.0"}]}\'\nexit 0'
        })
      )
      const { js, wasm } = await runProjectBoth(dir, uvPath)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin — size-budget (python/wasm-concerns, перша хвиля)', () => {
  test(`plugin_lang_python.wasm не перевищує бюджет ${WASM_SIZE_BUDGET_BYTES} байт (2,5 MiB)`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThanOrEqual(WASM_SIZE_BUDGET_BYTES)
  })
})
