/**
 * Parity-тест wasm-плагіна `plugin-lang-js` (задачі N2, Q1 батч 1, Q2
 * батч 2 та Q3 — де-скоуп до byte-exact-парних концернів, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5 і
 * `docs/specs/2026-08-01-wasm-ast-strategy.md`): ганяє ОДНІ фікстури через
 * чинні JS-детектори
 * (`plugins/lang-js/rules/<rule>/<concern>/main.mjs` — канонічні реалізації,
 * Plugin API v2, НЕ видаляються) і через `runWasmConcern` napi-мосту
 * (`crates/rules-napi` → `crates/plugin-lang-js`), звіряючи, що `violations`
 * ідентичні (reason/message/file/severity біт-у-біт) — для перших семи
 * концернів (задачі N2 + Q1 батч 1), `test/no-console-store-restore`/
 * `test/no-bun-test-import` (задача Q2 батч 2, справжній 1:1-порт) і
 * `js/utils_imports`/`test/no-relative-fs-path` (задача Q3, справжні
 * AST-концерни через `oxc_parser` — byte-exact через ТОЙ САМИЙ движок, не
 * наближення). Це доводить конвеєр «wasm-компонент → napi-міст →
 * JS-diagnostics-форма», не замінює JS-канон.
 *
 * `js-bun-redis/imports`/`js-bun-db/safety`/`js-mssql/deps` (задача Q2
 * батч 2) — СВІДОМО БЕЗ parity-тестів тут (рішення оркестратора після звіту
 * батчу 2): JS-оригінали побудовані на справжньому oxc-parser AST, а
 * Rust-порт — лише regex-наближення (доккомент «Регекс-наближення»,
 * `crates/plugin-lang-js/src/lib.rs`), тож він НЕ в контрибуції `describe()`
 * (concern-и недосяжні через production-диспетчеризацію) — твердження
 * «wasm ⇄ JS парні» тут було б оманливим. Юніт-рівневі тести самих
 * detect-функцій лишаються в `crates/plugin-lang-js/src/lib.rs`
 * (`#[cfg(test)] mod tests`), не тут.
 *
 * `vue/tfm-translations` фікстури дзеркалять
 * `plugins/lang-js/rules/vue/tfm-translations/tests/tfm-translations.test.mjs`
 * (per-file, [`runTfmBoth`]). Решта концернів — full-scope
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
 * `test/location` — `test/location/tests/location.test.mjs`;
 * `test/no-console-store-restore` — `test/no-console-store-restore/tests/no-console-store-restore.test.mjs`;
 * `test/no-bun-test-import` — `test/no-bun-test-import/tests/no-bun-test-import.test.mjs`;
 * `js/utils_imports` — `js/utils_imports/tests/utils_imports.test.mjs`;
 * `test/no-relative-fs-path` — `test/no-relative-fs-path/tests/no-relative-fs-path.test.mjs`.
 *
 * Останній describe-блок (`size-budget`) — окремо від parity: заміряє
 * реальний `plugin_lang_js.wasm` проти бюджету 2,5 MB (задача Q3, спека
 * `docs/specs/2026-08-01-wasm-ast-strategy.md`, розділ «Рішення» п.2).
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
const NO_CONSOLE_STORE_RESTORE_MAIN_MJS_PATH = join(
  REPO_ROOT,
  'plugins',
  'lang-js',
  'rules',
  'test',
  'no-console-store-restore',
  'main.mjs'
)
const NO_BUN_TEST_IMPORT_MAIN_MJS_PATH = join(
  REPO_ROOT,
  'plugins',
  'lang-js',
  'rules',
  'test',
  'no-bun-test-import',
  'main.mjs'
)
/**
 * T0-фікс `no-bun-test-import` — лишається JS (доккомент модуля,
 * `crates/plugin-lang-js/src/lib.rs`): `fix-no-bun-test-import.mjs`'s
 * `patterns[0].test`/`apply` мають працювати НАПРЯМУ з wasm-violations
 * (T0-критичний ризик задачі Q2 батч 2, перевірений тестом «T0-смок» у
 * `describe('wasm-plugin parity — test/no-bun-test-import …')` нижче).
 */
const NO_BUN_TEST_IMPORT_FIX_MJS_PATH = join(
  REPO_ROOT,
  'plugins',
  'lang-js',
  'rules',
  'test',
  'no-bun-test-import',
  'fix-no-bun-test-import.mjs'
)
const UTILS_IMPORTS_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'js', 'utils_imports', 'main.mjs')
const NO_RELATIVE_FS_PATH_MAIN_MJS_PATH = join(
  REPO_ROOT,
  'plugins',
  'lang-js',
  'rules',
  'test',
  'no-relative-fs-path',
  'main.mjs'
)
const TFM_CONCERN_KEY = 'vue/tfm-translations'
const GAP_CONCERN_KEY = 'style/gap'
const POOL_FORKS_CONCERN_KEY = 'test/vitest-config-pool-forks'
const NO_PROCESS_CHDIR_CONCERN_KEY = 'test/no-process-chdir'
const ADMIN_TABLE_CONCERN_KEY = 'style/admin_table'
const QUASAR_FIXES_CONCERN_KEY = 'style/quasar_fixes'
const LOCATION_CONCERN_KEY = 'test/location'
const NO_CONSOLE_STORE_RESTORE_CONCERN_KEY = 'test/no-console-store-restore'
const NO_BUN_TEST_IMPORT_CONCERN_KEY = 'test/no-bun-test-import'
const UTILS_IMPORTS_CONCERN_KEY = 'js/utils_imports'
const NO_RELATIVE_FS_PATH_CONCERN_KEY = 'test/no-relative-fs-path'

/** Size-budget компонента (задача Q3, спека `docs/specs/2026-08-01-wasm-ast-strategy.md`, розділ «Рішення» п.2). */
const WASM_SIZE_BUDGET_BYTES = 2.5 * 1024 * 1024

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

describe('wasm-plugin parity — test/no-console-store-restore (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runNoConsoleBoth = dir =>
    runFullScopeBoth(
      NO_CONSOLE_STORE_RESTORE_MAIN_MJS_PATH,
      NO_CONSOLE_STORE_RESTORE_CONCERN_KEY,
      'test',
      'no-console-store-restore',
      dir
    )

  // Зібрано через join, щоб у source не було дослівного assignment-патерну (той самий мотив,
  // що no-console-store-restore.test.mjs — meta-test самого сканера).
  const CONSOLE_ASSIGN = ['console.lo', 'g ='].join('')

  test('успіх: тест без присвоєння console → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), 'import { test } from "vitest"\ntest("ok", () => {})\n')
      const { js, wasm } = await runNoConsoleBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test(`порушення: ${CONSOLE_ASSIGN} fn → однакове violation з обох реалізацій`, async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/bad.test.mjs'), `const orig = ${CONSOLE_ASSIGN} fn\n`)
      const { js, wasm } = await runNoConsoleBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('no-console-store-restore')
    })
  })

  test('успіх: vi.spyOn(console, "log") не вважається порушенням → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/ok.test.mjs'), 'vi.spyOn(console, "log").mockReturnValue()\n')
      const { js, wasm } = await runNoConsoleBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — test/no-bun-test-import (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runNoBunTestImportBoth = dir =>
    runFullScopeBoth(
      NO_BUN_TEST_IMPORT_MAIN_MJS_PATH,
      NO_BUN_TEST_IMPORT_CONCERN_KEY,
      'test',
      'no-bun-test-import',
      dir
    )

  // Джерело bun:test у фікстурах збирається динамічно (той самий мотив, що no-bun-test-import.test.mjs).
  const BUN_TEST = ['bun', 'test'].join(':')

  test('успіх: import з vitest → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        "import { describe, test, expect } from 'vitest'\ntest('ok', () => {})\n"
      )
      const { js, wasm } = await runNoBunTestImportBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: import з bun:test (test, expect) → однакове fixable violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { test, expect } from '${BUN_TEST}'\ntest('ok', () => expect(1).toBe(1))\n`
      )
      const { js, wasm } = await runNoBunTestImportBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('bun-test-import')
      expect(js[0].data.fixable).toBe(true)
      expect(js[0].data.specifiers).toEqual(['test', 'expect'])
    })
  })

  test('порушення: import з bun:test (test, mock) → однакове НЕ-fixable violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), `import { test, mock } from "${BUN_TEST}"\n`)
      const { js, wasm } = await runNoBunTestImportBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].data.fixable).toBe(false)
    })
  })

  /**
   * T0-СМОК (задача Q2 батч 2, головний ризик): `fix-no-bun-test-import.mjs`
   * лишається JS-модулем, детектор — тепер wasm. Живий прогін: tempdir із
   * порушенням → `detect` через wasm (`runWasmConcern`, ідентичний виклик, що
   * продакшн-диспетчеризація після `node npm/scripts/build-wasm-plugins.mjs`) →
   * `patterns[0].test`/`apply` фіксера напряму на wasm-violations (не на
   * JS-violations) → повторний wasm-detect має дати 0. Якби форма
   * wasm-violation (reason/data.fixable/file) розходилась із тим, що чекає
   * `test`/`apply` фіксера, `test()` не спрацював би або `apply()` впав.
   */
  test('T0-смок: fix-no-bun-test-import.mjs патчить файл напряму з wasm-violations, повторний wasm-detect → 0', async () => {
    await withTmpDir(async dir => {
      const { mkdir, readFile } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      const target = join(dir, 'tests/foo.test.mjs')
      await writeFile(
        target,
        `import { describe, test, expect, beforeEach } from '${BUN_TEST}'\n\ndescribe('x', () => {\n  beforeEach(() => {})\n  test('ok', () => expect(1).toBe(1))\n})\n`
      )

      const wasmBefore = loadNative().runWasmConcern(WASM_PATH, NO_BUN_TEST_IMPORT_CONCERN_KEY, dir, null).violations
      expect(wasmBefore).toHaveLength(1)
      expect(wasmBefore[0].reason).toBe('bun-test-import')
      expect(wasmBefore[0].data.fixable).toBe(true)

      // eslint-disable-next-line no-unsanitized/method
      const { patterns } = await import(pathToFileURL(NO_BUN_TEST_IMPORT_FIX_MJS_PATH).href)
      const fixCtx = {
        cwd: dir,
        ruleId: 'test',
        concernId: 'no-bun-test-import',
        recordWrite() {
          /* no-op у тестовому контексті */
        }
      }
      for (const pattern of patterns) {
        if (pattern.test(wasmBefore)) await pattern.apply(wasmBefore, fixCtx)
      }

      const wasmAfter = loadNative().runWasmConcern(WASM_PATH, NO_BUN_TEST_IMPORT_CONCERN_KEY, dir, null).violations
      expect(wasmAfter).toEqual([])

      const content = await readFile(target, 'utf8')
      expect(content).toContain("from 'vitest'")
      expect(content).not.toContain(BUN_TEST)
      expect(content).toContain('import { describe, test, expect, beforeEach } from')
      expect(content).toContain("test('ok', () => expect(1).toBe(1))")
    })
  })
})

describe('wasm-plugin parity — js/utils_imports (JS канон vs wasm plugin-lang-js, full-scope міст, задача Q3 AST-концерн)', () => {
  const runUtilsImportsBoth = dir =>
    runFullScopeBoth(UTILS_IMPORTS_MAIN_MJS_PATH, UTILS_IMPORTS_CONCERN_KEY, 'js', 'utils_imports', dir)

  test('без utils-каталогів → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src', 'index.mjs'), 'export const x = 1\n')
      const { js, wasm } = await runUtilsImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('utils/ з бажаним ./same-dir імпортом → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'helper.mjs'),
        "import { readFile } from 'node:fs/promises'\nexport function h() {}\n"
      )
      const { js, wasm } = await runUtilsImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('utils/ з забороненим ../ імпортом → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'bad.mjs'),
        "import { config } from '../lib/config.mjs'\nexport const x = config\n"
      )
      const { js, wasm } = await runUtilsImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('utils_imports')
      expect(js[0].message).toContain('../lib/config.mjs')
      expect(js[0].file).toBeUndefined()
    })
  })

  test('файл у utils/tests/ ігнорується — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'utils', 'tests'), { recursive: true })
      await writeFile(join(dir, 'utils', 'tests', 'helper.test.mjs'), "import { h } from '../helper.mjs'\n")
      const { js, wasm } = await runUtilsImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('файл у utils/__fixtures__/ ігнорується — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'utils', '__fixtures__'), { recursive: true })
      await writeFile(join(dir, 'utils', '__fixtures__', 'data.mjs'), "import { x } from '../../other.mjs'\n")
      const { js, wasm } = await runUtilsImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('динамічний import()/require() з .. → однакова кількість violations з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'utils'), { recursive: true })
      await writeFile(
        join(dir, 'utils', 'mixed.mjs'),
        "const f = () => import('../dynamic.mjs')\nconst g = require('../required.mjs')\n"
      )
      const { js, wasm } = await runUtilsImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
    })
  })
})

describe('wasm-plugin parity — test/no-relative-fs-path (JS канон vs wasm plugin-lang-js, full-scope міст, задача Q3 AST-концерн)', () => {
  const runNoRelativeFsPathBoth = dir =>
    runFullScopeBoth(
      NO_RELATIVE_FS_PATH_MAIN_MJS_PATH,
      NO_RELATIVE_FS_PATH_CONCERN_KEY,
      'test',
      'no-relative-fs-path',
      dir
    )
  const FS_TEST_HEAD = "import { writeFile, copyFile, mkdir } from 'node:fs/promises'\n"

  test('успіх: тест з join(dir, …) → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${FS_TEST_HEAD}await writeFile(join(dir, 'foo.json'), 'x', 'utf8')\n`
      )
      const { js, wasm } = await runNoRelativeFsPathBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test("порушення: writeFile('foo.json', …) → однакове violation з обох реалізацій", async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), `${FS_TEST_HEAD}await writeFile('foo.json', 'x', 'utf8')\n`)
      const { js, wasm } = await runNoRelativeFsPathBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('no-relative-fs-path')
      expect(js[0].message).toContain('writeFile')
      expect(js[0].file).toBeUndefined()
    })
  })

  test('порушення: fsp.writeFile (MemberExpression) → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        "import * as fsp from 'node:fs/promises'\nawait fsp.writeFile('foo', 'x')\n"
      )
      const { js, wasm } = await runNoRelativeFsPathBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
    })
  })

  test('успіх: не-тестові файли не скануються → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(
        join(dir, 'src/helper.mjs'),
        `${FS_TEST_HEAD}export async function fn() { await writeFile('any.json', 'x') }\n`
      )
      const { js, wasm } = await runNoRelativeFsPathBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: файл з syntax-error НЕ кидає, тільки пропускає аналіз (обидві реалізації)', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), 'invalid <<<< syntax\n')
      const { js, wasm } = await runNoRelativeFsPathBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin — size-budget (задача Q3, спека `docs/specs/2026-08-01-wasm-ast-strategy.md`, розділ «Рішення» п.2)', () => {
  test(`plugin_lang_js.wasm не перевищує бюджет ${WASM_SIZE_BUDGET_BYTES} байт (2.5 MB)`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThanOrEqual(WASM_SIZE_BUDGET_BYTES)
  })
})

// `js-bun-redis/imports`/`js-bun-db/safety`/`js-mssql/deps` — СВІДОМО БЕЗ
// JS⇄wasm parity-тестів тут (де-скоуп рішенням оркестратора після звіту
// батчу 2, доккомент модуля вище й `crates/plugin-lang-js/src/lib.rs`
// секція «Регекс-наближення»): concern-и НЕ в контрибуції `describe()`, тож
// НЕМАЄ production-шляху, де wasm-вихід міг би «підмінити» JS-канон —
// твердження «wasm ⇄ JS еквівалентні» тут було б оманливим (regex-
// наближення AST-оригіналу навмисно НЕ byte-exact). Юніт-рівневі тести самих
// pure-функцій (`detect_redis_imports`/`detect_bun_db_safety`/
// `detect_mssql_deps` і хелпери) лишаються в
// `crates/plugin-lang-js/src/lib.rs` (`#[cfg(test)] mod tests`) — Rust-крейт
// єдине місце, де ці функції взагалі викликаються.
