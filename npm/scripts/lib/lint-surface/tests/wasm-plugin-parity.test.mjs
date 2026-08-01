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
 * `test/no-bun-test-import` (задача Q2 батч 2, справжній 1:1-порт),
 * `js/utils_imports`/`test/no-relative-fs-path` (задача Q3) і
 * `js-bun-redis/imports`/`js-mssql/deps`/`js-bun-db/safety` (задача Q4
 * батч 4 — де-скоуп батчу 2 знято: regex-groundwork замінено справжніми
 * AST-портами, доккомент секції «Батч 4» у
 * `crates/plugin-lang-js/src/lib.rs`) — усі п'ять AST-концернів byte-exact
 * через ТОЙ САМИЙ движок `oxc_parser`, не наближення. Це доводить конвеєр
 * «wasm-компонент → napi-міст → JS-diagnostics-форма», не замінює JS-канон.
 *
 * Фікстури AST-концернів батчу 4 навмисно покривають місця, де regex брехав
 * би, а AST — ні: імпорти в коментарях/рядкових літералах, дубль-діагностики
 * tagged template (обидва боки віддають ДВІ ідентичні — задокументована
 * особливість walk-обходу JS-оригіналу), guard лише в найближчому блоці,
 * невалідний JSON у package.json.
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
 * `test/no-relative-fs-path` — `test/no-relative-fs-path/tests/no-relative-fs-path.test.mjs`;
 * `js-bun-redis/imports`/`js-mssql/deps`/`js-bun-db/safety` (задача Q4
 * батч 4) — фікстури дзеркалять unit-тести `#[cfg(test)]`
 * `crates/plugin-lang-js/src/lib.rs` і golden-тести
 * `crates/rules-plugin-host/tests/plugin_lang_js.rs` (у самих JS-концернів
 * тек `tests/` немає — їхні сканери покриті тестами lib-модулів).
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
const REDIS_IMPORTS_MAIN_MJS_PATH = join(
  REPO_ROOT,
  'plugins',
  'lang-js',
  'rules',
  'js-bun-redis',
  'imports',
  'main.mjs'
)
const MSSQL_DEPS_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'js-mssql', 'deps', 'main.mjs')
const BUN_DB_SAFETY_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'js-bun-db', 'safety', 'main.mjs')
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
const REDIS_IMPORTS_CONCERN_KEY = 'js-bun-redis/imports'
const MSSQL_DEPS_CONCERN_KEY = 'js-mssql/deps'
const BUN_DB_SAFETY_CONCERN_KEY = 'js-bun-db/safety'
// Батч 5 (§3.5.5): storybook-сімейство — п'ять full-scope концернів. JS-канони
// самі ходять диском (`collectInScopeVuePackages`: workspaces + walkDir +
// `.n-rules.json`), wasm-порт отримує ті самі факти з host-побудованого
// батча — саме цю еквівалентність і доводять фікстури нижче.
const STORYBOOK_RULES_DIR = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'test')
const STORYBOOK_SCOPE_MAIN_MJS_PATH = join(STORYBOOK_RULES_DIR, 'storybook-scope', 'main.mjs')
const STORYBOOK_HYGIENE_MAIN_MJS_PATH = join(STORYBOOK_RULES_DIR, 'storybook-hygiene', 'main.mjs')
const STORYBOOK_PAGE_COVERAGE_MAIN_MJS_PATH = join(STORYBOOK_RULES_DIR, 'storybook-page-coverage', 'main.mjs')
const STORYBOOK_SCAFFOLD_MAIN_MJS_PATH = join(STORYBOOK_RULES_DIR, 'storybook-scaffold', 'main.mjs')
const STORYBOOK_CI_MAIN_MJS_PATH = join(STORYBOOK_RULES_DIR, 'storybook-ci', 'main.mjs')
const STORYBOOK_SCOPE_CONCERN_KEY = 'test/storybook-scope'
const STORYBOOK_HYGIENE_CONCERN_KEY = 'test/storybook-hygiene'
const STORYBOOK_PAGE_COVERAGE_CONCERN_KEY = 'test/storybook-page-coverage'
const STORYBOOK_SCAFFOLD_CONCERN_KEY = 'test/storybook-scaffold'
const STORYBOOK_CI_CONCERN_KEY = 'test/storybook-ci'

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
   * FIX-СМОК (пілот fix-контуру contract v3 — заміна колишнього «T0-смоку»
   * задачі Q2 батч 2, коли фікс ще лишався JS-модулем): детектор І фіксер
   * тепер wasm. Живий прогін: tempdir із порушенням → `detect` через wasm
   * (`runWasmConcern`) → план `export fix` через napi (`runWasmConcernFix`,
   * той самий виклик, що синтетичний `wasm-fix:*` T0Pattern у `run-fix.mjs`)
   * напряму на wasm-violations → застосування write-edit-ів → повторний
   * wasm-detect має дати 0. Якби форма wasm-violation
   * (reason/data.fixable/file) розходилась із тим, що чекає guest-фікс
   * (`fix_no_bun_test_import`, `crates/plugin-lang-js`), план вийшов би
   * порожнім і re-detect лишився б червоним.
   */
  test('fix-смок: план export fix (runWasmConcernFix) чинить файл напряму з wasm-violations, повторний wasm-detect → 0', async () => {
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

      const plan = loadNative().runWasmConcernFix(WASM_PATH, NO_BUN_TEST_IMPORT_CONCERN_KEY, dir, wasmBefore)
      expect(plan.edits).toHaveLength(1)
      expect(plan.edits[0]).toMatchObject({ type: 'write', path: 'tests/foo.test.mjs' })
      // Застосування — дзеркало `wasmFixPattern.apply` (`run-fix.mjs`);
      // повний dispatch-шлях (loadT0Patterns → runFixPipeline) звіряє
      // `wasm-fix-e2e.test.mjs`.
      for (const edit of plan.edits) {
        if (edit.type === 'write') await writeFile(join(dir, edit.path), edit.content)
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

describe('wasm-plugin parity — js-bun-redis/imports (JS канон vs wasm plugin-lang-js, full-scope міст, задача Q4 AST-концерн)', () => {
  const runRedisImportsBoth = dir =>
    runFullScopeBoth(REDIS_IMPORTS_MAIN_MJS_PATH, REDIS_IMPORTS_CONCERN_KEY, 'js-bun-redis', 'imports', dir)

  test('без package.json у корені → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/cache.mjs'), "import Redis from 'ioredis'\n")
      const { js, wasm } = await runRedisImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: import з ioredis → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(join(dir, 'src/cache.mjs'), "import Redis from 'ioredis'\nexport const r = new Redis()\n")
      const { js, wasm } = await runRedisImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('imports')
      expect(js[0].message).toContain("заміни 'ioredis'")
    })
  })

  test('успіх: згадки в коментарях і рядкових літералах → без порушень (AST, не regex)', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/cache.mjs'),
        "// import Redis from 'ioredis'\nconst s = \"require('redis')\"\nexport const y = s\n"
      )
      const { js, wasm } = await runRedisImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: require і динамічний import → однакові 2 violations', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(join(dir, 'src/a.cjs'), "const Redis = require('ioredis')\n")
      await writeFile(join(dir, 'src/b.mjs'), "export const load = () => import('redis')\n")
      const { js, wasm } = await runRedisImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
    })
  })

  test('порядок: require перед import у файлі → однаковий (двофазний) порядок violations', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(join(dir, 'src/mixed.cjs'), "const a = require('redis')\nimport Redis from 'ioredis'\n")
      const { js, wasm } = await runRedisImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
    })
  })

  test('успіх: redis-mock не зачіпається → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(join(dir, 'src/mock.mjs'), "import RedisMock from 'redis-mock'\nexport const m = RedisMock\n")
      const { js, wasm } = await runRedisImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: .d.ts з імпортом ioredis ігнорується → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(join(dir, 'src/types.d.ts'), "import Redis from 'ioredis'\nexport type R = Redis\n")
      const { js, wasm } = await runRedisImportsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — js-mssql/deps (JS канон vs wasm plugin-lang-js, full-scope міст, задача Q4 AST-концерн)', () => {
  const runMssqlDepsBoth = dir =>
    runFullScopeBoth(MSSQL_DEPS_MAIN_MJS_PATH, MSSQL_DEPS_CONCERN_KEY, 'js-mssql', 'deps', dir)

  test('успіх: без dependencies.mssql джерела не скануються → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/db.ts'),
        'export function getUser() {\n  const pool = new sql.ConnectionPool(config)\n  return pool\n}\n'
      )
      const { js, wasm } = await runMssqlDepsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: версія нижче мінімуму → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{"name":"t","dependencies":{"mssql":"^10.0.0"}}\n')
      const { js, wasm } = await runMssqlDepsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('deps')
      expect(js[0].message).toContain('>=12.5.0')
    })
  })

  test('порушення: невалідний JSON у вкладеному package.json → однакове violation навіть без mssql', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'sub'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(join(dir, 'sub/package.json'), 'NOT_VALID_JSON\n')
      const { js, wasm } = await runMssqlDepsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('невалідний JSON')
    })
  })

  test('порушення: new sql.ConnectionPool у функції → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t","dependencies":{"mssql":"^12.5.0"}}\n')
      await writeFile(
        join(dir, 'src/handler.ts'),
        'export async function handler() {\n  const pool = new sql.ConnectionPool(config)\n  await pool.connect()\n}\n'
      )
      const { js, wasm } = await runMssqlDepsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('singleton sql.ConnectionPool')
    })
  })

  test('порушення: query(`...`) не tagged → однакове violation; tagged query`...` — чисто', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t","dependencies":{"mssql":"^12.5.0"}}\n')
      await writeFile(
        join(dir, 'src/bad.ts'),
        `export async function findUser(userId) {\n  return pool.request().query(\`SELECT * FROM users WHERE id = \${userId}\`)\n}\n`
      )
      await writeFile(
        join(dir, 'src/ok.ts'),
        `export async function findUser2(userId) {\n  return pool.request().query\`SELECT * FROM users WHERE id = \${userId}\`\n}\n`
      )
      const { js, wasm } = await runMssqlDepsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('не tagged template')
    })
  })

  test('порушення: IN-плейсхолдер без числового парсера і guard → однакові 2 violations', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t","dependencies":{"mssql":"^12.5.0"}}\n')
      await writeFile(
        join(dir, 'src/db.ts'),
        `export function f(ids) {\n  return pool.request().query\`SELECT 1 FROM t WHERE id IN (\${ids})\`\n}\n`
      )
      const { js, wasm } = await runMssqlDepsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
    })
  })

  test('успіх: parseInt-трасування + guard на пустоту → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t","dependencies":{"mssql":"^12.5.0"}}\n')
      await writeFile(
        join(dir, 'src/db.ts'),
        `export function f(raw) {\n  const ids = raw.map(x => parseInt(x, 10)).filter(n => !Number.isNaN(n))\n  if (!ids.length) throw new Error('empty')\n  return pool.request().query\`SELECT 1 FROM t WHERE id IN (\${ids})\`\n}\n`
      )
      const { js, wasm } = await runMssqlDepsBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — js-bun-db/safety (JS канон vs wasm plugin-lang-js, full-scope міст, задача Q4 AST-концерн)', () => {
  const runBunDbSafetyBoth = dir =>
    runFullScopeBoth(BUN_DB_SAFETY_MAIN_MJS_PATH, BUN_DB_SAFETY_CONCERN_KEY, 'js-bun-db', 'safety', dir)

  test('успіх: singleton new SQL + tagged template → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { SQL, sql } from 'bun'\nexport const db = new SQL(process.env.DATABASE_URL)\nexport async function getUser(id) {\n  return sql\`SELECT * FROM users WHERE id = \${id}\`\n}\n`
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: new SQL(...) всередині функції → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { SQL } from 'bun'\nexport function getUser(id) {\n  const db = new SQL(process.env.DATABASE_URL)\n  return db\`SELECT * FROM users WHERE id = \${id}\`\n}\n`
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('safety')
      expect(js[0].message).toContain('new SQL(...)')
    })
  })

  test('порушення: sql.unsafe без маркера → однакове violation; з маркером — чисто', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/bad.ts'),
        "import { sql } from 'bun'\nexport const ping = () => sql.unsafe('SELECT 1')\n"
      )
      await writeFile(
        join(dir, 'src/ok.ts'),
        "import { sql } from 'bun'\nexport const ping2 = () => sql.unsafe('SELECT 1') // n-rules:allow-unsafe: ping\n"
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('sql.unsafe(...) заборонено за замовчуванням')
    })
  })

  test('порушення: sql.unsafe(інтерпольований template) навіть з маркером → однакове violation', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/migrate.ts'),
        `import { sql } from 'bun'\nconst TABLE = 'users_2026'\nexport async function migrate() {\n  // n-rules:allow-unsafe: DDL\n  return sql.unsafe(\`CREATE TABLE \${TABLE} (id int)\`)\n}\n`
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('template-літералом')
    })
  })

  test('порушення: tagged .join у IN → однакові ЧОТИРИ violations (дубль-обхід tagged, як у JS)', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'\nexport async function findMany(ids) {\n  return sql\`SELECT * FROM users WHERE id IN (\${ids.join(',')})\`\n}\n`
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(4)
    })
  })

  test('успіх: guard у тому самому блоці → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'\nexport function f(ids) {\n  if (!ids.length) throw new Error('empty')\n  return sql\`SELECT 1 FROM t WHERE id IN (\${ids})\`\n}\n`
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: guard лише у зовнішньому блоці → однакові violations (найближчий блок, як у JS)', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'\nexport function f(ids, x) {\n  if (!ids.length) throw new Error('empty')\n  if (x) {\n    return sql\`SELECT 1 FROM t WHERE id IN (\${ids})\`\n  }\n  return null\n}\n`
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].message).toContain('перед IN-списком "ids"')
    })
  })

  test('порушення: dependencies.pg без LISTEN/NOTIFY → однакові dep- та import-violations', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t","dependencies":{"pg":"^8.0.0"}}\n')
      await writeFile(
        join(dir, 'src/app.ts'),
        "import { Client } from 'pg'\nconst client = new Client()\nexport const findUser = id => client.query('SELECT * FROM users WHERE id = $1', [id])\n"
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].message).toContain('dependencies.pg заборонено')
      expect(js[1].message).toContain("import 'pg' дозволено лише")
    })
  })

  test('успіх: dependencies.pg виправдано LISTEN/NOTIFY → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t","dependencies":{"pg":"^8.0.0"}}\n')
      await writeFile(
        join(dir, 'src/pg-listen.ts'),
        "import { Client } from 'pg'\nconst client = new Client()\nexport async function start() {\n  await client.query('LISTEN orders_channel')\n  client.on('notification', msg => console.log(msg))\n}\n"
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: sql.unsafe у коментарі та new SQL у рядку → без порушень (AST, не regex)', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/db.ts'),
        `import { sql } from 'bun'\n// sql.unsafe('SELECT 1')\nconst s = "new SQL(url)"\nexport const ping = () => sql\`SELECT \${s}\`\n`
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: sql.array(arr) без типу → однакове violation; з типом — чисто', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), '{"name":"t"}\n')
      await writeFile(
        join(dir, 'src/bad.ts'),
        `import { sql } from 'bun'\nexport const q = ids => sql\`SELECT \${sql.array(ids)}\`\n`
      )
      await writeFile(
        join(dir, 'src/ok.ts'),
        `import { sql } from 'bun'\nexport const q2 = ids => sql\`SELECT \${sql.array(ids, 'int8')}\`\n`
      )
      const { js, wasm } = await runBunDbSafetyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('sql.array(arr) без другого аргументу')
    })
  })
})

/**
 * Пише файл із створенням проміжних тек — фікстури storybook-сімейства
 * (батч 5) будують мінімальні монорепо-дерева (workspaces + пакети).
 * @param {string} dir корінь tmp-дерева
 * @param {string} rel відносний шлях файлу
 * @param {string} content вміст
 * @returns {Promise<void>}
 */
async function writeFileDeep(dir, rel, content) {
  const { mkdir } = await import('node:fs/promises')
  const abs = join(dir, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

/**
 * Мінімальна Vue-бібліотека `packages/ui` у скоупі Storybook (workspaces +
 * peerDependencies.vue + 3 `.vue`) — дзеркало `writeVueLibraryPkg`
 * (`plugins/lang-js/rules/test/storybook-scope/tests/scope.test.mjs`).
 * @param {string} dir корінь tmp-дерева
 * @returns {Promise<void>}
 */
async function writeStorybookLibraryFixture(dir) {
  await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
  await writeFileDeep(
    dir,
    'packages/ui/package.json',
    JSON.stringify({ name: 'ui', peerDependencies: { vue: '^3.6.0' } }, null, 2)
  )
  for (let i = 0; i < 3; i++) {
    await writeFileDeep(dir, `packages/ui/src/components/Comp${i}.vue`, '<template><div/></template>\n')
  }
}

describe('wasm-plugin parity — test/storybook-scope (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runScopeBoth = dir =>
    runFullScopeBoth(STORYBOOK_SCOPE_MAIN_MJS_PATH, STORYBOOK_SCOPE_CONCERN_KEY, 'test', 'storybook-scope', dir)

  test('успіх: storybook.optOut порожній/не заданий → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      const { js, wasm } = await runScopeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: optOut на неіснуючий workspace-пакет → однакове stale-opt-out violation', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(dir, '.n-rules.json', JSON.stringify({ storybook: { optOut: ['packages/ghost'] } }))
      const { js, wasm } = await runScopeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('stale-opt-out')
      expect(js[0].message).toContain('packages/ghost')
    })
  })

  test('успіх: optOut на існуючий пакет → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(dir, '.n-rules.json', JSON.stringify({ storybook: { optOut: ['packages/ui'] } }))
      const { js, wasm } = await runScopeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('крайове: legacy .n-cursor.json (без .n-rules.json) читається обома реалізаціями', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(dir, '.n-cursor.json', JSON.stringify({ storybook: { optOut: ['packages/ghost'] } }))
      const { js, wasm } = await runScopeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('stale-opt-out')
    })
  })
})

describe('wasm-plugin parity — test/storybook-hygiene (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runHygieneBoth = dir =>
    runFullScopeBoth(STORYBOOK_HYGIENE_MAIN_MJS_PATH, STORYBOOK_HYGIENE_CONCERN_KEY, 'test', 'storybook-hygiene', dir)

  test('порушення: undeclared import у .vue (static + subpath-дедуп) → ідентичні violations', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(
        dir,
        'packages/ui/src/components/Picker.vue',
        "<script setup>\nimport Datepicker from '@vuepic/vue-datepicker'\nimport { util } from '@vuepic/vue-datepicker/sub'\nimport { join } from 'node:path'\nimport rel from './local.js'\nimport aliased from '@/utils'\n</script>\n"
      )
      const { js, wasm } = await runHygieneBoth(dir)
      expect(wasm).toEqual(js)
      // Один violation: subpath дедуплікується за top-level ім'ям пакета,
      // node-builtin/відносний/alias-імпорти пропускаються.
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('undeclared-import')
      expect(js[0].message).toContain('@vuepic/vue-datepicker')
    })
  })

  test('порушення: динамічний import() і require() у script блоці → ідентичний порядок violations', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(
        dir,
        'packages/ui/src/components/Lazy.vue',
        "<script>\nconst legacy = require('legacy-pkg')\nexport default {\n  async mounted() {\n    await import('dyn-pkg')\n  }\n}\n</script>\n"
      )
      const { js, wasm } = await runHygieneBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js.map(v => v.data.package)).toEqual(['legacy-pkg', 'dyn-pkg'])
    })
  })

  test('успіх: задекларована залежність і .vue із syntax error → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
      await writeFileDeep(
        dir,
        'packages/ui/package.json',
        JSON.stringify(
          { name: 'ui', peerDependencies: { vue: '^3.6.0' }, dependencies: { '@vuepic/vue-datepicker': '^14.0.0' } },
          null,
          2
        )
      )
      for (let i = 0; i < 3; i++) {
        await writeFileDeep(
          dir,
          `packages/ui/src/components/Comp${i}.vue`,
          "<script setup>\nimport Datepicker from '@vuepic/vue-datepicker'\n</script>\n"
        )
      }
      // Файл із syntax error пропускається цілком (parsed.errors → []).
      await writeFileDeep(
        dir,
        'packages/ui/src/components/Broken.vue',
        "<script setup>\nimport { x } from 'undeclared-pkg'\ninvalid <<<< syntax\n</script>\n"
      )
      const { js, wasm } = await runHygieneBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: sass-variables без sassVariables у .storybook/main.js → однаковий warn', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(dir, 'packages/ui/src/css/quasar.variables.scss', '$primary: #000;\n')
      await writeFileDeep(
        dir,
        'packages/ui/.storybook/main.js',
        "export default { framework: '@storybook/vue3-vite' }\n"
      )
      const { js, wasm } = await runHygieneBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-sass-variables')
      expect(js[0].severity).toBe('warn')
    })
  })

  test('успіх: sassVariables заданий у main.js → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(dir, 'packages/ui/src/css/quasar.variables.scss', '$primary: #000;\n')
      await writeFileDeep(
        dir,
        'packages/ui/.storybook/main.js',
        'export default { viteFinal: () => quasar({ sassVariables: true }) }\n'
      )
      const { js, wasm } = await runHygieneBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — test/storybook-page-coverage (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runPageCoverageBoth = dir =>
    runFullScopeBoth(
      STORYBOOK_PAGE_COVERAGE_MAIN_MJS_PATH,
      STORYBOOK_PAGE_COVERAGE_CONCERN_KEY,
      'test',
      'storybook-page-coverage',
      dir
    )

  /**
   * App-пакет `packages/demo` у скоупі хвилі 2a (`detectApps: true`).
   * @param {string} dir корінь tmp-дерева
   * @returns {Promise<void>}
   */
  async function writeAppFixture(dir) {
    await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
    await writeFileDeep(dir, '.n-rules.json', JSON.stringify({ storybook: { detectApps: true } }))
    await writeFileDeep(
      dir,
      'packages/demo/package.json',
      JSON.stringify({ name: 'demo', dependencies: { vue: '^3.6.0' } }, null, 2)
    )
    await writeFileDeep(dir, 'packages/demo/src/pages/task/[id].vue', '<template><div/></template>\n')
  }

  test('порушення: сторінка без *.stories.js поряд → однаковий warn з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeAppFixture(dir)
      const { js, wasm } = await runPageCoverageBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('page-missing-story')
      expect(js[0].severity).toBe('warn')
    })
  })

  test('успіх: stories з довільним іменем у тій самій теці → без порушень', async () => {
    await withTmpDir(async dir => {
      await writeAppFixture(dir)
      await writeFileDeep(dir, 'packages/demo/src/pages/task/task-detail.stories.js', "export default { title: 't' }\n")
      const { js, wasm } = await runPageCoverageBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: без прапорця detectApps app-пакет поза скоупом → без порушень', async () => {
    await withTmpDir(async dir => {
      await writeAppFixture(dir)
      await writeFileDeep(dir, '.n-rules.json', JSON.stringify({}))
      const { js, wasm } = await runPageCoverageBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — test/storybook-scaffold (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runScaffoldBoth = dir =>
    runFullScopeBoth(
      STORYBOOK_SCAFFOLD_MAIN_MJS_PATH,
      STORYBOOK_SCAFFOLD_CONCERN_KEY,
      'test',
      'storybook-scaffold',
      dir
    )

  test('порушення: бібліотека без жодного canon-файлу → ідентичні пʼять violations у тому ж порядку', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      const { js, wasm } = await runScaffoldBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual([
        'missing-main-js',
        'missing-preview-js',
        'missing-empty-vite-config',
        'missing-vitest-setup-js',
        'missing-storybook-script'
      ])
    })
  })

  test('порушення: canon-файли без частини маркерів + некороткий script → ідентичні marker-violations', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
      await writeFileDeep(
        dir,
        'packages/ui/package.json',
        JSON.stringify(
          { name: 'ui', peerDependencies: { vue: '^3.6.0' }, scripts: { storybook: 'storybook dev' } },
          null,
          2
        )
      )
      for (let i = 0; i < 3; i++) {
        await writeFileDeep(dir, `packages/ui/src/components/Comp${i}.vue`, '<template><div/></template>\n')
      }
      // main.js з усіма маркерами, крім viteConfigPath; preview.js без mswLoader.
      await writeFileDeep(
        dir,
        'packages/ui/.storybook/main.js',
        "// @storybook/vue3-vite viteFinal 'vite-plugin-pages' 'vite-plugin-vue-layouts' 'vite-plugin-vue-layouts-next' isVueTransformFamily resolvePluginEntry\n"
      )
      await writeFileDeep(
        dir,
        'packages/ui/.storybook/preview.js',
        '// Quasar iconSet iconMapFn msw-storybook-addon onUnhandledRequest\n'
      )
      await writeFileDeep(dir, 'packages/ui/.storybook/empty-vite.config.js', 'export default defineConfig({})\n')
      await writeFileDeep(dir, 'packages/ui/.storybook/vitest.setup.js', '// setProjectAnnotations beforeAll\n')
      const { js, wasm } = await runScaffoldBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual([
        'main-js-marker-missing',
        'preview-js-marker-missing',
        'missing-storybook-script'
      ])
      expect(js[2].message).toContain("(зараз: 'storybook dev')")
    })
  })

  test('успіх: канонічний скафолд бібліотеки → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
      await writeFileDeep(
        dir,
        'packages/ui/package.json',
        JSON.stringify(
          {
            name: 'ui',
            peerDependencies: { vue: '^3.6.0' },
            scripts: { storybook: 'storybook dev -p 6006 --no-open' }
          },
          null,
          2
        )
      )
      for (let i = 0; i < 3; i++) {
        await writeFileDeep(dir, `packages/ui/src/components/Comp${i}.vue`, '<template><div/></template>\n')
      }
      await writeFileDeep(
        dir,
        'packages/ui/.storybook/main.js',
        "// @storybook/vue3-vite viteFinal 'vite-plugin-pages' 'vite-plugin-vue-layouts' 'vite-plugin-vue-layouts-next' isVueTransformFamily resolvePluginEntry viteConfigPath\n"
      )
      await writeFileDeep(
        dir,
        'packages/ui/.storybook/preview.js',
        '// Quasar iconSet iconMapFn msw-storybook-addon onUnhandledRequest mswLoader\n'
      )
      await writeFileDeep(dir, 'packages/ui/.storybook/empty-vite.config.js', 'export default defineConfig({})\n')
      await writeFileDeep(dir, 'packages/ui/.storybook/vitest.setup.js', '// setProjectAnnotations beforeAll\n')
      const { js, wasm } = await runScaffoldBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('крайове: .n-rules.json ignore знімає .vue-файли з порога скоупу в обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      // Без ignore пакет у скоупі (5 scaffold-violations вище); з ignore на
      // src/components лишаються 0 видимих .vue → поза скоупом → тиша.
      await writeFileDeep(dir, '.n-rules.json', JSON.stringify({ ignore: ['packages/ui/src/components'] }))
      const { js, wasm } = await runScaffoldBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — test/storybook-ci (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runCiBoth = dir =>
    runFullScopeBoth(STORYBOOK_CI_MAIN_MJS_PATH, STORYBOOK_CI_CONCERN_KEY, 'test', 'storybook-ci', dir)

  test('порушення: бібліотека у скоупі без обох .github-файлів → ідентичні два violations', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      const { js, wasm } = await runCiBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['missing-playwright-action', 'missing-storybook-workflow'])
    })
  })

  test('порушення: action без одного маркера, канонічний workflow → один marker-violation', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(
        dir,
        '.github/actions/setup-playwright-chromium/action.yml',
        '# ms-playwright кеш через actions/cache@v4\n'
      )
      await writeFileDeep(
        dir,
        '.github/workflows/lint-storybook.yml',
        '# ./.github/actions/setup-bun-deps ./.github/actions/setup-playwright-chromium vitest --project=storybook\n'
      )
      const { js, wasm } = await runCiBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('playwright-action-marker-missing')
    })
  })

  test('успіх: немає пакетів у скоупі → тиша навіть без .github-файлів', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root' }, null, 2))
      const { js, wasm } = await runCiBoth(dir)
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

// `js-bun-redis/imports`/`js-mssql/deps`/`js-bun-db/safety` — parity-тести
// ВИЩЕ (задача Q4 батч 4): де-скоуп батчу 2 знято, wasm-реалізації — справжні
// AST-порти через той самий `oxc_parser`, концерни В контрибуції `describe()`
// (production-шлях shadowing-у існує, тому byte-exact parity — обов'язковий
// гейт, як для решти концернів).
