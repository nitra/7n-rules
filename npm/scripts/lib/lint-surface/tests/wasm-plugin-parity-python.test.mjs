/**
 * Parity-тест wasm-плагіна `plugin-lang-python` — ДРУГОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`):
 * ганяє ОДНІ фікстури через ЖИВІ JS-детектори
 * (`plugins/lang-python/rules/python/<concern>/main.mjs` — Plugin API v2,
 * канон НЕ видаляється цією задачею) і через `runWasmConcern` napi-мосту
 * (`crates/rules-napi` → `crates/plugin-lang-python`), звіряючи, що
 * `violations` ідентичні (reason/message/file/severity/data біт-у-біт) — для
 * трьох контрибуцій першої хвилі: `python/applies`, `python/tooling`,
 * `python/doc_comments` (доккомент `crates/plugin-lang-python/src/lib.rs`).
 *
 * НА ВІДМІНУ від `wasm-plugin-parity.test.mjs` (lang-js): тут НЕМАЄ
 * golden-фікстур/`N_WASM_PARITY_CAPTURE` — JS-канон lang-python ще ЖИВИЙ
 * (усі `main.mjs` під `plugins/lang-python/rules/python` нікуди не
 * поділись, це лише перша хвиля порту), тож кожен прогін викликає `lint()`
 * НАПРЯМУ,
 * як `wasm-plugin-parity.test.mjs` робив ДО рефакторингу лінивого
 * зняття еталонів (`git show 55a4d0715~1:.../wasm-plugin-parity.test.mjs`
 * — той самий, простіший шар без golden-кешу). Видалення JS-канону
 * lang-python — окрема майбутня задача (доккомент завдання), і саме тоді
 * цей файл, ймовірно, теж перейде на golden-еталони.
 *
 * `python/applies` і `python/tooling` — full-scope
 * (`concern.json.lint.scope: "full"`), той самий full-scope-мостовий виклик,
 * що lang-js-концерни ([`runFullScopeBoth`]): виклик БЕЗ `files` (`undefined`
 * на JS-боці, `null` на wasm-боці) на обох боках — JS-оригінал ігнорує
 * `ctx.files`, а `runWasmConcern` будує batch сам через
 * `ConcernContribution::glob` (host, `crates/rules-napi::run_wasm_concern`).
 * Фікстури дзеркалять `plugins/lang-python/rules/python/tooling/tests/tooling.test.mjs`
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
 * Останній describe-блок (`size-budget`) — окремо від parity: заміряє
 * реальний `plugin_lang_python.wasm` проти того самого бюджету 2,5 MiB, що
 * `plugin-lang-js` (`WASM_SIZE_BUDGET_BYTES`, доккомент нижче й
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

const APPLIES_CONCERN_KEY = 'python/applies'
const TOOLING_CONCERN_KEY = 'python/tooling'
const DOC_COMMENTS_CONCERN_KEY = 'python/doc_comments'

/** Size-budget компонента — той самий бюджет, що `plugin-lang-js` (доккомент модуля). */
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
  // file:// URL — абсолютний шлях цього файлу (realRepoRoot() + константні
  // сегменти), не вхід ззовні (той самий мотив, що lang-js-хелпери).
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(mainMjsPath).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'python', concernId, files: undefined })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, null)
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
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
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(DOC_COMMENTS_MAIN_MJS_PATH).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'python', concernId: 'doc_comments', files: [fileName] })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [fileName])
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
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

describe('wasm-plugin — size-budget (python/wasm-concerns, перша хвиля)', () => {
  test(`plugin_lang_python.wasm не перевищує бюджет ${WASM_SIZE_BUDGET_BYTES} байт (2,5 MiB)`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThanOrEqual(WASM_SIZE_BUDGET_BYTES)
  })
})
