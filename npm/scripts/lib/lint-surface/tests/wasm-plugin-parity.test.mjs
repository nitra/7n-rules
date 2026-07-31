/**
 * Parity-тест wasm-плагіна `plugin-lang-js` (задачі N2 та Q1 батч 1, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5):
 * ганяє ОДНІ фікстури через чинні JS-детектори (`plugins/lang-js/rules/<rule>/<concern>/main.mjs`
 * — канонічні реалізації, Plugin API v2, НЕ видаляються) і через
 * `runWasmConcern` napi-мосту (`crates/rules-napi` → `crates/plugin-lang-js`),
 * звіряючи, що `violations` ідентичні (reason/message/file/severity
 * біт-у-біт). Це доводить конвеєр «wasm-компонент → napi-міст →
 * JS-diagnostics-форма», не замінює JS-канон.
 *
 * `vue/tfm-translations` фікстури дзеркалять
 * `plugins/lang-js/rules/vue/tfm-translations/tests/tfm-translations.test.mjs`
 * (per-file, [`runTfmBoth`]). Решта шести концернів — full-scope
 * (`concern.json.lint.scope: "full"`), той самий full-scope-мостовий виклик,
 * що `style/gap` ([`runFullScopeBoth`]): виклик БЕЗ `files` (`undefined` на
 * JS-боці, `null` на wasm-боці, доккомент `detect.mjs`) на обох боках —
 * JS-оригінал ігнорує `ctx.files` і сам ганяє whole-repo обхід (`walkDir`/
 * `collectTestFiles`, `main.mjs` кожного концерну), `runWasmConcern` теж
 * отримує `files: null` — саме це доводить full-scope міст (задача N2 п.2):
 * host (`crates/rules-napi::run_wasm_concern`) сам будує batch за
 * `ConcernContribution::glob` задекларованого концерну, не JS-оркестрація.
 * Фікстури дзеркалять відповідний `plugins/lang-js/rules/<rule>/<concern>/tests/*.test.mjs`:
 * `style/gap` — `style/gap/tests/main.test.mjs`; `test/vitest-config-pool-forks`
 * — `test/vitest-config-pool-forks/tests/vitest-config-pool-forks.test.mjs`;
 * `test/no-process-chdir` — `test/no-process-chdir/tests/no-process-chdir.test.mjs`;
 * `style/admin_table` — `style/admin_table/tests/main.test.mjs`;
 * `style/quasar_fixes` — `style/quasar_fixes/tests/main.test.mjs`;
 * `test/location` — `test/location/tests/location.test.mjs`.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_js.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-parity.test.mjs: wasm-компонент plugin-lang-js не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-js/build.sh'
  )
}

const TFM_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'vue', 'tfm-translations', 'main.mjs')
const GAP_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'style', 'gap', 'main.mjs')
const POOL_FORKS_MAIN_MJS_PATH = join(
  REPO_ROOT,
  'plugins',
  'lang-js',
  'rules',
  'test',
  'vitest-config-pool-forks',
  'main.mjs'
)
const NO_PROCESS_CHDIR_MAIN_MJS_PATH = join(
  REPO_ROOT,
  'plugins',
  'lang-js',
  'rules',
  'test',
  'no-process-chdir',
  'main.mjs'
)
const ADMIN_TABLE_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'style', 'admin_table', 'main.mjs')
const QUASAR_FIXES_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'style', 'quasar_fixes', 'main.mjs')
const LOCATION_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'test', 'location', 'main.mjs')

const TFM_CONCERN_KEY = 'vue/tfm-translations'
const GAP_CONCERN_KEY = 'style/gap'
const POOL_FORKS_CONCERN_KEY = 'test/vitest-config-pool-forks'
const NO_PROCESS_CHDIR_CONCERN_KEY = 'test/no-process-chdir'
const ADMIN_TABLE_CONCERN_KEY = 'style/admin_table'
const QUASAR_FIXES_CONCERN_KEY = 'style/quasar_fixes'
const LOCATION_CONCERN_KEY = 'test/location'

/**
 * Виставляє дефолт `severity: 'error'`, якщо ключ відсутній — точне дзеркало
 * severity-гілки `normalizeViolation` (`detect.mjs`): raw-вихід JS `lint()`
 * ОПУСКАЄ дефолтне поле (`createViolationReporter.fail` не виставляє ключ,
 * якщо `opts.severity` не передано), тоді як WIT `record diagnostic.severity`
 * не опційне — `rules_contract::Diagnostic` завжди серіалізує його. Обидві
 * форми валідні (та сама семантика «дефолт — error»), тому порівняння
 * `violations` тут — після приведення обох через ЦЕЙ САМИЙ normalize-крок,
 * що застосовує `runConcernDetector` у продакшн-диспетчеризації.
 * @param {unknown[]} violations сирі violations (JS чи wasm)
 * @returns {unknown[]} ті самі violations із заповненим `severity`
 */
function withDefaultSeverity(violations) {
  return violations.map(v => ({ severity: 'error', ...v }))
}

/**
 * Ганяє одну `.vue`-фікстуру `vue/tfm-translations` через JS-детектор
 * (канон) і `runWasmConcern` (wasm, per-file dispatch) і повертає обидва
 * `violations`-масиви (після [`withDefaultSeverity`]) для звірки.
 * @param {string} dir абсолютний шлях tmp-каталогу (містить `fileName`)
 * @param {string} fileName ім'я файлу у `dir`
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runTfmBoth(dir, fileName) {
  // file:// URL — інакше відносний шлях трактується як bare package specifier (той самий
  // мотив, що в detect.mjs runConcernDetector); TFM_MAIN_MJS_PATH — фіксований абсолютний
  // шлях цього файлу (realRepoRoot() + константні сегменти), не вхід ззовні.
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(TFM_MAIN_MJS_PATH).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'vue', concernId: 'tfm-translations', files: [fileName] })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, TFM_CONCERN_KEY, dir, [fileName])
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє один full-scope концерн через JS-детектор (канон, ігнорує
 * `ctx.files`, сам ходить `walkDir`/`collectTestFiles` за `cwd`) і
 * `runWasmConcern` з `files: null` (full-scope міст, доккомент модуля) —
 * обидва бачать УСЕ дерево `dir`, не підмножину. Спільний хелпер для
 * `style/gap` і всіх пʼяти full-scope концернів задачі Q1 (доккомент модуля).
 * @param {string} mainMjsPath абсолютний шлях до `main.mjs` JS-канону концерну
 * @param {string} concernKey `ruleId/concernId` (`detect-batch.concern-id` для wasm-виклику)
 * @param {string} ruleId `ctx.ruleId` для JS-виклику
 * @param {string} concernId `ctx.concernId` для JS-виклику
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runFullScopeBoth(mainMjsPath, concernKey, ruleId, concernId, dir) {
  // file:// URL — абсолютний шлях цього файлу (realRepoRoot() + константні сегменти),
  // не вхід ззовні (той самий мотив, що [`runTfmBoth`]).
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(mainMjsPath).href)
  const jsResult = await lint({ cwd: dir, ruleId, concernId, files: undefined })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, null)
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
}

describe('wasm-plugin parity — vue/tfm-translations (JS канон vs wasm plugin-lang-js)', () => {
  test('порушення: імпортує tf, але не оголошує getTr() → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Page.vue'),
        "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: {} })\n</script>\n"
      )
      const { js, wasm } = await runTfmBoth(dir, 'Page.vue')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('tfm-translations')
      expect(js[0].message).toContain('getTr')
    })
  })

  test('успіх: використовує tf і оголошує getTr() → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Page.vue'),
        `<template>{{ t\`Клиенты\` }}</template>
<script setup>
import { lang, tf as tfm } from '@nitra/tfm'
const t = tfm.bind({ tr: getTr() })

function getTr() {
  return { Клиенты: { en: 'Customers' } }
}
</script>
`
      )
      const { js, wasm } = await runTfmBoth(dir, 'Page.vue')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: не використовує @nitra/tfm взагалі → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Page.vue'), '<template><div /></template>\n<script setup></script>\n')
      const { js, wasm } = await runTfmBoth(dir, 'Page.vue')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: імпортує з @nitra/tfm, але не саме tf → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Page.vue'), "<script setup>\nimport { lang } from '@nitra/tfm'\n</script>\n")
      const { js, wasm } = await runTfmBoth(dir, 'Page.vue')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('не .vue файл → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'helper.mjs'), "import { tf } from '@nitra/tfm'\n")
      const { js, wasm } = await runTfmBoth(dir, 'helper.mjs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — style/gap (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runGapBoth = dir => runFullScopeBoth(GAP_MAIN_MJS_PATH, GAP_CONCERN_KEY, 'style', 'gap', dir)

  test('exit 0 — n-gap-md використано і визначено → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Row.vue'), '<template><div class="row n-gap-md" /></template>\n')
      await writeFile(join(dir, 'src/app.scss'), '.n-gap-md {\n  gap: 16px;\n}\n')
      const { js, wasm } = await runGapBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('exit 1 — n-gap-lg використано, але не визначено → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Row.vue'), '<template><div class="row n-gap-lg" /></template>\n')
      await writeFile(join(dir, 'src/app.scss'), '.n-gap-sm {\n  gap: 8px;\n}\n')
      const { js, wasm } = await runGapBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-gap-style')
      expect(js[0].message).toContain('n-gap-lg')
    })
  })

  test('exit 0 — n-gap-* взагалі не використовується → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Row.vue'), '<template><div class="row q-gutter-md" /></template>\n')
      const { js, wasm } = await runGapBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — test/vitest-config-pool-forks (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runPoolForksBoth = dir =>
    runFullScopeBoth(POOL_FORKS_MAIN_MJS_PATH, POOL_FORKS_CONCERN_KEY, 'test', 'vitest-config-pool-forks', dir)

  test("успіх: config з pool: 'forks' → без порушень з обох реалізацій", async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'vitest.config.js'),
        "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { pool: 'forks' } })\n"
      )
      const { js, wasm } = await runPoolForksBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test("порушення: vitest.config.mjs з pool: 'threads' → однакове violation з обох реалізацій", async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'vitest.config.mjs'), "export default { test: { pool: 'threads' } }\n")
      const { js, wasm } = await runPoolForksBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('vitest-config-pool-forks')
    })
  })

  test('успіх: vitest.config.{mjs,js} відсутній → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runPoolForksBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — test/no-process-chdir (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runNoProcessChdirBoth = dir =>
    runFullScopeBoth(NO_PROCESS_CHDIR_MAIN_MJS_PATH, NO_PROCESS_CHDIR_CONCERN_KEY, 'test', 'no-process-chdir', dir)

  // Зібрано через `join`, щоб у source не зустрічався точний паттерн виклику
  // (той самий мотив, що `no-process-chdir.test.mjs` — meta-test самого сканера).
  const CHDIR = ['process.chd', 'ir'].join('')

  test('успіх: тест без забороненого виклику → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), 'import { test } from "vitest"\ntest("ok", () => {})\n')
      const { js, wasm } = await runNoProcessChdirBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test(`порушення: тест із ${CHDIR}(dir) → однакове violation з обох реалізацій`, async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { test } from "vitest"\ntest("bad", () => { ${CHDIR}("/tmp") })\n`
      )
      const { js, wasm } = await runNoProcessChdirBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('process-chdir-in-test')
      expect(js[0].data).toEqual({ line: 2 })
    })
  })

  test('обхід пропускає node_modules → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'node_modules/some-pkg/tests'), { recursive: true })
      await writeFile(join(dir, 'node_modules/some-pkg/tests/foo.test.mjs'), `${CHDIR}("/anywhere")\n`)
      const { js, wasm } = await runNoProcessChdirBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — style/admin_table (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runAdminTableBoth = dir =>
    runFullScopeBoth(ADMIN_TABLE_MAIN_MJS_PATH, ADMIN_TABLE_CONCERN_KEY, 'style', 'admin_table', dir)

  test('exit 0 — n-admin-table використано і визначено → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Table.vue'), '<template><q-table class="n-admin-table" /></template>\n')
      await writeFile(join(dir, 'src/app.scss'), '.n-admin-table {\n  height: 100%;\n}\n')
      const { js, wasm } = await runAdminTableBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('exit 1 — n-admin-table використано, але не визначено → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Table.vue'), '<template><q-table class="n-admin-table" /></template>\n')
      await writeFile(join(dir, 'src/app.scss'), '.other { color: red; }\n')
      const { js, wasm } = await runAdminTableBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-admin-table-style')
    })
  })

  test('exit 0 — n-admin-table взагалі не використовується → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Table.vue'), '<template><q-table dense /></template>\n')
      const { js, wasm } = await runAdminTableBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — style/quasar_fixes (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runQuasarFixesBoth = dir =>
    runFullScopeBoth(QUASAR_FIXES_MAIN_MJS_PATH, QUASAR_FIXES_CONCERN_KEY, 'style', 'quasar_fixes', dir)

  test('exit 0 — q-scroll-area використано і фікс визначено → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/List.vue'), '<template><q-scroll-area /></template>\n')
      await writeFile(join(dir, 'src/app.scss'), '.q-scrollarea {\n  display: flex;\n}\n')
      const { js, wasm } = await runQuasarFixesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('exit 1 — q-tooltip використано, але фікс відсутній → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/Btn.vue'), '<template><q-btn><q-tooltip>hi</q-tooltip></q-btn></template>\n')
      await writeFile(join(dir, 'src/app.scss'), '.other { color: red; }\n')
      const { js, wasm } = await runQuasarFixesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-quasar-fix')
      expect(js[0].message).toContain('q-tooltip')
    })
  })

  test('exit 0 — жоден із компонентів не використовується → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/List.vue'), '<template><div /></template>\n')
      const { js, wasm } = await runQuasarFixesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — test/location (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runLocationBoth = dir => runFullScopeBoth(LOCATION_MAIN_MJS_PATH, LOCATION_CONCERN_KEY, 'test', 'location', dir)

  test('успіх: усі *.test.mjs у tests/ → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'rules/foo/js/bar/tests'), { recursive: true })
      await writeFile(join(dir, 'rules/foo/js/bar/check.mjs'), 'export function check() {}\n')
      await writeFile(join(dir, 'rules/foo/js/bar/tests/check.test.mjs'), 'import { test } from "vitest"\n')
      const { js, wasm } = await runLocationBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: тест поряд із джерелом → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'rules/foo/js/bar'), { recursive: true })
      await writeFile(join(dir, 'rules/foo/js/bar/check.mjs'), 'export function check() {}\n')
      await writeFile(join(dir, 'rules/foo/js/bar/check.test.mjs'), 'import { test } from "vitest"\n')
      const { js, wasm } = await runLocationBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('location')
    })
  })

  test('обхід пропускає node_modules → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'node_modules/some-pkg'), { recursive: true })
      await writeFile(join(dir, 'node_modules/some-pkg/foo.test.mjs'), 'import { test } from "vitest"\n')
      const { js, wasm } = await runLocationBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})
