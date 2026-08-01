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
// Батч 6 (§3.5.5): `test/storybook-vitest-config` (JS-канон, full-scope) плюс
// три rego-концерни `*/package_json` — у них НЕМАЄ `main.mjs`, канон
// виконує conftest через `evaluatePolicyConcern` ([`runPolicyBoth`]).
const STORYBOOK_VITEST_CONFIG_MAIN_MJS_PATH = join(STORYBOOK_RULES_DIR, 'storybook-vitest-config', 'main.mjs')
const STORYBOOK_VITEST_CONFIG_CONCERN_KEY = 'test/storybook-vitest-config'
const BUN_DB_PACKAGE_JSON_CONCERN_KEY = 'js-bun-db/package_json'
const REDIS_PACKAGE_JSON_CONCERN_KEY = 'js-bun-redis/package_json'
const MSSQL_PACKAGE_JSON_CONCERN_KEY = 'js-mssql/package_json'
// Батч 7 (§3.5.5): кластер `npm-module/*` (метадані-перевірки, що в JS-каноні
// ходять `readdirSync`/`walkDir` по `npm/rules`, `npm/skills`, `npm/`) плюс
// AST-концерн `js/dep-policy`. Глоби контрибуцій цих пʼятьох СВІДОМО вужчі за
// `concern.json.lint.glob` — доккомент секції «Батч 7» у
// `crates/plugin-lang-js/src/lib.rs`.
const NPM_MODULE_RULES_DIR = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'npm-module')
const RULE_META_MAIN_MJS_PATH = join(NPM_MODULE_RULES_DIR, 'rule_meta', 'main.mjs')
const SKILL_META_MAIN_MJS_PATH = join(NPM_MODULE_RULES_DIR, 'skill_meta', 'main.mjs')
const HEADER_DOC_POINTER_MAIN_MJS_PATH = join(NPM_MODULE_RULES_DIR, 'header_doc_pointer', 'main.mjs')
const PACKAGE_STRUCTURE_MAIN_MJS_PATH = join(NPM_MODULE_RULES_DIR, 'package_structure', 'main.mjs')
const DEP_POLICY_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'js', 'dep-policy', 'main.mjs')
// Батч 8: чотири «файлово-структурні» концерни без зовнішнього тула
// (доккомент секції «Батч 8» у `crates/plugin-lang-js/src/lib.rs`).
const BUN_LAYOUT_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'bun', 'layout', 'main.mjs')
const STYLE_TOOLING_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'style', 'tooling', 'main.mjs')
const SANDBOX_AWARE_TEST_MAIN_MJS_PATH = join(
  REPO_ROOT,
  'plugins',
  'lang-js',
  'rules',
  'test',
  'sandbox-aware-test',
  'main.mjs'
)
const VITEST_API_CONVENTIONS_MAIN_MJS_PATH = join(
  REPO_ROOT,
  'plugins',
  'lang-js',
  'rules',
  'test',
  'vitest-api-conventions',
  'main.mjs'
)
// Батч 9: `vue/packages` — останній придатний до порту концерн lang-js
// (доккомент секції «Батч 9» у `crates/plugin-lang-js/src/lib.rs`).
const VUE_PACKAGES_MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'vue', 'packages', 'main.mjs')
const VUE_PACKAGES_CONCERN_KEY = 'vue/packages'
const BUN_LAYOUT_CONCERN_KEY = 'bun/layout'
const STYLE_TOOLING_CONCERN_KEY = 'style/tooling'
const SANDBOX_AWARE_TEST_CONCERN_KEY = 'test/sandbox-aware-test'
const VITEST_API_CONVENTIONS_CONCERN_KEY = 'test/vitest-api-conventions'
const RULE_META_CONCERN_KEY = 'npm-module/rule_meta'
const SKILL_META_CONCERN_KEY = 'npm-module/skill_meta'
const HEADER_DOC_POINTER_CONCERN_KEY = 'npm-module/header_doc_pointer'
const PACKAGE_STRUCTURE_CONCERN_KEY = 'npm-module/package_structure'
const DEP_POLICY_CONCERN_KEY = 'js/dep-policy'
/** Реєстр предикатів — джерело правди анти-дрейф-тесту `RULE_PREDICATE_NAMES`. */
const RULE_PREDICATES_PATH = join(REPO_ROOT, 'npm', 'scripts', 'lib', 'rule-predicates.mjs')

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

/**
 * Мінімальний Vue-**застосунок** `apps/web` у скоупі Storybook: workspaces +
 * `dependencies.vue` + `src/pages/*.vue` ПЛЮС обовʼязковий прапорець
 * `storybook.detectApps` — app-гілка `collectInScopeVuePackages` (хвиля 2a)
 * без нього не вмикається взагалі. Маркери storybook-project для app ширші
 * за library: додатково quasar()/AutoImport()/Pages().
 * @param {string} dir корінь tmp-дерева
 * @returns {Promise<void>}
 */
async function writeStorybookAppFixture(dir) {
  await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['apps/*'] }, null, 2))
  await writeFileDeep(dir, '.n-rules.json', JSON.stringify({ storybook: { detectApps: true } }))
  await writeFileDeep(
    dir,
    'apps/web/package.json',
    JSON.stringify({ name: 'web', dependencies: { vue: '^3.6.0', quasar: '^2.0.0' } }, null, 2)
  )
  for (let i = 0; i < 3; i++) {
    await writeFileDeep(dir, `apps/web/src/pages/Page${i}.vue`, '<template><div/></template>\n')
  }
}

describe('wasm-plugin parity — test/storybook-vitest-config (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runVitestConfigBoth = dir =>
    runFullScopeBoth(
      STORYBOOK_VITEST_CONFIG_MAIN_MJS_PATH,
      STORYBOOK_VITEST_CONFIG_CONCERN_KEY,
      'test',
      'storybook-vitest-config',
      dir
    )

  test('порушення: бібліотека у скоупі без vitest.config.* → ідентичне vitest-config-missing (з data.rootDir/type)', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      const { js, wasm } = await runVitestConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('vitest-config-missing')
      expect(js[0].data).toEqual({ rootDir: 'packages/ui', type: 'library' })
    })
  })

  test('порушення: конфіг без test-блоку → unresolvable І stryker-перевірка (вона НЕ припиняється early-return-ом)', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(dir, 'packages/ui/vitest.config.mjs', 'export default { plugins: [] }\n')
      const { js, wasm } = await runVitestConfigBoth(dir)
      expect(wasm).toEqual(js)
      // `checkStrykerConfigPresence` у JS-каноні кличеться з `checkPackage`
      // ПІСЛЯ `checkVitestConfigContent` — early-return-и останнього її не
      // скасовують (порт зберігає саме цей порядок).
      expect(js.map(v => v.reason)).toEqual(['vitest-config-unresolvable', 'stryker-config-missing'])
    })
  })

  test('порушення: test.projects відсутній → data.vitestConfigPath АБСОЛЮТНИЙ на обох боках (слот repo-root@1)', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(
        dir,
        'packages/ui/vitest.config.mjs',
        "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { globals: true } })\n"
      )
      await writeFileDeep(dir, 'packages/ui/vitest.stryker.config.mjs', 'export default {}\n')
      const { js, wasm } = await runVitestConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['unit-project-missing', 'storybook-project-missing'])
      // Саме це поле було блокером батчу 5: JS-канон кладе join(absDir, name),
      // wasm бере корінь зі слоту `repo-root@1` host-контексту.
      expect(js[0].data.vitestConfigPath).toBe(join(dir, 'packages/ui/vitest.config.mjs'))
    })
  })

  test('порушення: test.projects — не статичний масив → ідентичне projects-dynamic', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(
        dir,
        'packages/ui/vitest.config.mjs',
        "import { defineConfig } from 'vitest/config'\nconst projects = []\nexport default defineConfig({ test: { projects } })\n"
      )
      await writeFileDeep(dir, 'packages/ui/vitest.stryker.config.mjs', 'export default {}\n')
      const { js, wasm } = await runVitestConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['projects-dynamic'])
    })
  })

  test('порушення: storybook-project без канонічних маркерів → ідентичний список підказок (app-гілка)', async () => {
    await withTmpDir(async dir => {
      await writeStorybookAppFixture(dir)
      await writeFileDeep(
        dir,
        'apps/web/vitest.config.mjs',
        "import { defineConfig } from 'vitest/config'\n" +
          "export default defineConfig({ test: { projects: [{ name: 'unit' }, { name: 'storybook' }] } })\n"
      )
      await writeFileDeep(dir, 'apps/web/vitest.stryker.config.mjs', 'export default {}\n')
      const { js, wasm } = await runVitestConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['storybook-project-marker-missing'])
      expect(js[0].message).toContain('Pages()-плагін')
    })
  })

  test('порушення: канонічний vitest.config без vitest.stryker.config.* → ідентичне stryker-config-missing', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)
      await writeFileDeep(
        dir,
        'packages/ui/vitest.config.ts',
        "import { defineConfig } from 'vitest/config'\n" +
          "import { playwright } from '@vitest/browser-playwright'\n" +
          'export default defineConfig({\n' +
          '  test: {\n' +
          '    projects: [\n' +
          "      { name: 'unit' },\n" +
          "      { name: 'storybook', test: { browser: { instances: [{ browser: 'chromium' }], provider: playwright() } }, plugins: [storybookTest({ configDir: '.storybook' })] }\n" +
          '    ]\n' +
          '  }\n' +
          '})\n'
      )
      const { js, wasm } = await runVitestConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['stryker-config-missing'])
    })
  })

  test('успіх: немає пакетів у скоупі → тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root' }, null, 2))
      const { js, wasm } = await runVitestConfigBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

/**
 * Спільна підмножина полів violation-а для звірки rego-канону з wasm-портом:
 * policy-adapter додає ще `ruleId`/`concernId` (їх контракт wasm не має —
 * їх проставляє `normalizeResult` у продакшн-диспетчеризації), тому звіряємо
 * саме contract-поля, як решта parity-тестів після [`withDefaultSeverity`].
 * @param {{ reason: string, message: string, file?: string, severity?: string }} v violation будь-якого боку
 * @returns {object} нормалізована форма для порівняння
 */
function pickPolicyFields(v) {
  return { reason: v.reason, message: v.message, file: v.file, severity: v.severity ?? 'error' }
}

/**
 * Ганяє rego-концерн (`<rule>/package_json`) через КАНОН — policy-adapter
 * `evaluatePolicyConcern` (той самий виклик, що робить `detect.mjs` для
 * concern-ів без `main.mjs`: conftest із `--data` з `template/`) — і через
 * `runWasmConcern` (`files: null`, full-scope міст), повертаючи обидва
 * `violations` для звірки. `engine: 'rego'` — явна форма того, що
 * `evaluatePolicyConcern` виводить із відсутнього `policy.engine`
 * (не-`template` → rego-гілка).
 * @param {string} ruleId `ctx.ruleId` (він же тека правила)
 * @param {string} concernId `ctx.concernId` (він же тека концерну)
 * @param {string} concernKey `ruleId/concernId` для wasm-виклику
 * @param {string} dir абсолютний шлях tmp-дерева з фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runPolicyBoth(ruleId, concernId, concernKey, dir) {
  const { evaluatePolicyConcern } = await import('../policy-lint-adapter.mjs')
  const jsResult = await evaluatePolicyConcern(
    { cwd: dir, ruleId, concernId },
    {
      engine: 'rego',
      policyDir: join(REPO_ROOT, 'plugins', 'lang-js', 'rules', ruleId, concernId),
      files: { walkGlob: '**/package.json' }
    }
  )
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, null)
  return {
    js: jsResult.violations.map(v => pickPolicyFields(v)),
    wasm: wasmResult.violations.map(v => pickPolicyFields(v))
  }
}

describe('wasm-plugin parity — js-bun-db/package_json (rego-канон через conftest vs wasm plugin-lang-js)', () => {
  test('порушення: обидві deny-залежності → ідентичні violations (лексикографічний порядок)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'package.json',
        JSON.stringify({ name: 'x', dependencies: { 'pg-format': '^1.0.0', mysql2: '^3.0.0' } }, null, 2)
      )
      const { js, wasm } = await runPolicyBoth('js-bun-db', 'package_json', BUN_DB_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].reason).toBe('policy-deny')
    })
  })

  test('успіх: жодної deny-залежності → тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'x', dependencies: { vue: '^3.6.0' } }, null, 2))
      const { js, wasm } = await runPolicyBoth('js-bun-db', 'package_json', BUN_DB_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — js-bun-redis/package_json (rego-канон через conftest vs wasm plugin-lang-js)', () => {
  test('порушення: ioredis + @redis/client у вкладеному пакеті → ідентичні violations із relative file', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root' }, null, 2))
      await writeFileDeep(
        dir,
        'packages/api/package.json',
        JSON.stringify({ name: 'api', dependencies: { ioredis: '^5.0.0', '@redis/client': '^1.0.0' } }, null, 2)
      )
      const { js, wasm } = await runPolicyBoth('js-bun-redis', 'package_json', REDIS_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js.every(v => v.file === 'packages/api/package.json')).toBe(true)
    })
  })

  test('успіх: bun native redis (без deny-пакетів) → тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'x', dependencies: {} }, null, 2))
      const { js, wasm } = await runPolicyBoth('js-bun-redis', 'package_json', REDIS_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — js-mssql/package_json (rego-канон через conftest vs wasm plugin-lang-js)', () => {
  test('порушення: mssql нижче мінімуму → ідентичне повідомлення з %q-формою діапазону', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'package.json',
        JSON.stringify({ name: 'x', dependencies: { mssql: '^10.0.0' } }, null, 2)
      )
      const { js, wasm } = await runPolicyBoth('js-mssql', 'package_json', MSSQL_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('"^10.0.0"')
    })
  })

  test('успіх: mssql >= 12.5.0 і workspace:* → тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'package.json',
        JSON.stringify({ name: 'x', dependencies: { mssql: '^12.5.0' } }, null, 2)
      )
      await writeFileDeep(
        dir,
        'packages/db/package.json',
        JSON.stringify({ name: 'db', dependencies: { mssql: 'workspace:*' } }, null, 2)
      )
      const { js, wasm } = await runPolicyBoth('js-mssql', 'package_json', MSSQL_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

// Батч 7 (§3.5.5): кластер `npm-module/*` + `js/dep-policy`. Усі п'ять —
// full-scope (`concern.json.lint.scope: "full"`), тож той самий
// [`runFullScopeBoth`], що решта: JS-канон сам ходить диском
// (`readdirSync`/`walkDir`), wasm-порт бачить host-побудований батч — саме
// цю еквівалентність фікстури й доводять.
/**
 * Компаратор для звірки НАБОРУ violations, коли їх порядок задає
 * `readdirSync` JS-канону. Знахідка батчу 7: цей порядок РУНТАЙМ-ЗАЛЕЖНИЙ —
 * node на APFS віддає імена вже відсортованими, bun (`bun run --bun vitest`)
 * віддає їх у сирому порядку каталогу (жива фікстура: `a, c, d, b`).
 * `readdirSync` порядку не гарантує ні в node-, ні в bun-доці, тож це
 * недетермінізм самого JS-канону, а не розбіжність порту: wasm-порт
 * детермінований (байтово-лексикографічний, `BTreeSet` у
 * [`batch_child_dirs`]). Тому мульти-каталогові фікстури звіряють байт-у-байт
 * НАБІР (усі поля кожного violation), а не позицію в масиві; одно-каталогові
 * лишаються на прямому `toEqual`, де порядок задає сам концерн.
 * @param {{ message: string }} a перший violation
 * @param {{ message: string }} b другий violation
 * @returns {number} порядок сортування за `message`
 */
function byMessage(a, b) {
  if (a.message === b.message) return 0
  return a.message < b.message ? -1 : 1
}

describe('wasm-plugin parity — npm-module/rule_meta (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runRuleMetaBoth = dir =>
    runFullScopeBoth(RULE_META_MAIN_MJS_PATH, RULE_META_CONCERN_KEY, 'npm-module', 'rule_meta', dir)

  test('успіх: npm/rules/ відсутній → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{}\n')
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: валідне правило (main.mdc + main.json з auto "завжди") → тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/n-js/main.mdc', '# n-js\n')
      await writeFileDeep(dir, 'npm/rules/n-js/main.json', JSON.stringify({ auto: 'завжди' }))
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: відсутній main.mdc + залишковий auto.md → два ідентичні violations у тому самому порядку', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/n-js/auto.md', 'завжди\n')
      await writeFileDeep(dir, 'npm/rules/n-js/main.json', JSON.stringify({ auto: 'завжди' }))
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].message).toContain('залишковий auto.md')
      expect(js[1].message).toContain('відсутній main.mdc')
      expect(js[0].reason).toBe('rule_meta')
    })
  })

  test('порушення: main.json відсутній / битий JSON / масив / скаляр → однакове «відсутній або невалідний»', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/a-missing/main.mdc', '#\n')
      await writeFileDeep(dir, 'npm/rules/b-broken/main.mdc', '#\n')
      await writeFileDeep(dir, 'npm/rules/b-broken/main.json', '{ не json')
      await writeFileDeep(dir, 'npm/rules/c-array/main.mdc', '#\n')
      await writeFileDeep(dir, 'npm/rules/c-array/main.json', '[1, 2]')
      await writeFileDeep(dir, 'npm/rules/d-scalar/main.mdc', '#\n')
      await writeFileDeep(dir, 'npm/rules/d-scalar/main.json', 'null')
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm.toSorted(byMessage)).toEqual(js.toSorted(byMessage))
      expect(js).toHaveLength(4)
      expect(js.map(v => v.message).toSorted()).toEqual([
        'rules/a-missing: відсутній або невалідний main.json',
        'rules/b-broken: відсутній або невалідний main.json',
        'rules/c-array: відсутній або невалідний main.json',
        'rules/d-scalar: відсутній або невалідний main.json'
      ])
    })
  })

  test('порушення: нерозпізнане auto (порожній масив / {glob:[]} / {predicate:""} / число)', async () => {
    await withTmpDir(async dir => {
      for (const [id, auto] of [
        ['a', []],
        ['b', { glob: [] }],
        ['c', { predicate: '' }],
        ['d', 7]
      ]) {
        await writeFileDeep(dir, `npm/rules/${id}/main.mdc`, '#\n')
        await writeFileDeep(dir, `npm/rules/${id}/main.json`, JSON.stringify({ auto }))
      }
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm.toSorted(byMessage)).toEqual(js.toSorted(byMessage))
      expect(js).toHaveLength(4)
      expect(js.every(v => v.message.includes('main.json.auto нерозпізнане'))).toBe(true)
    })
  })

  // Тонкість `String()`-семантики, яку wasm-порт мусить відтворити точно:
  // елемент масиву стрінгується ОКРЕМО (`String(null)` === `"null"` →
  // валідний), а от ВКЛАДЕНИЙ порожній масив дає `""` → нерозпізнане.
  test('край: auto-масив із порожніх рядків і [[]] нерозпізнаний, а [null] і {glob:"x"} — валідні', async () => {
    await withTmpDir(async dir => {
      for (const [id, auto] of [
        ['a-blank', ['  ', '']],
        ['b-null', [null]],
        ['c-glob-string', { glob: 'src/**' }],
        ['d-nested-empty', [[]]]
      ]) {
        await writeFileDeep(dir, `npm/rules/${id}/main.mdc`, '#\n')
        await writeFileDeep(dir, `npm/rules/${id}/main.json`, JSON.stringify({ auto }))
      }
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm.toSorted(byMessage)).toEqual(js.toSorted(byMessage))
      expect(js.map(v => v.message.slice(0, 14)).toSorted()).toEqual(['rules/a-blank:', 'rules/d-nested'])
    })
  })

  test('порушення: скасовані поля lint і llmFix → два violations у порядку lint → llmFix', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/n-js/main.mdc', '#\n')
      await writeFileDeep(
        dir,
        'npm/rules/n-js/main.json',
        JSON.stringify({ auto: 'завжди', lint: { scope: 'full' }, llmFix: true })
      )
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].message).toContain('main.json.lint скасовано')
      expect(js[1].message).toContain('main.json.llmFix скасовано')
    })
  })

  test('порушення: невідомий predicate → ідентичне повідомлення з назвою предиката', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/n-js/main.mdc', '#\n')
      await writeFileDeep(dir, 'npm/rules/n-js/main.json', JSON.stringify({ auto: { predicate: 'noSuchThing' } }))
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe('rules/n-js: main.json — невідомий predicate "noSuchThing" (немає в RULE_PREDICATES)')
    })
  })

  // Анти-дрейф: список предикатів у wasm-порті (`RULE_PREDICATE_NAMES`) —
  // копія реєстру `RULE_PREDICATES`. Тест ітерує РЕАЛЬНІ ключі реєстру, тож
  // новий предикат у JS без оновлення Rust одразу завалить parity.
  test('анти-дрейф: КОЖЕН ключ реального RULE_PREDICATES приймають обидві реалізації', async () => {
    // file:// URL зібраний з `realRepoRoot()` + константних сегментів (той
    // самий мотив, що [`runTfmBoth`]) — не вхід ззовні.
    // eslint-disable-next-line no-unsanitized/method
    const { RULE_PREDICATES } = await import(pathToFileURL(RULE_PREDICATES_PATH).href)
    const names = Object.keys(RULE_PREDICATES)
    expect(names.length).toBeGreaterThan(0)
    await withTmpDir(async dir => {
      for (const name of names) {
        await writeFileDeep(dir, `npm/rules/${name}/main.mdc`, '#\n')
        await writeFileDeep(dir, `npm/rules/${name}/main.json`, JSON.stringify({ auto: { predicate: name } }))
      }
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('край: каталог із крапки та файл прямо в npm/rules/ ігноруються обома реалізаціями', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/.cache/main.json', 'null')
      await writeFileDeep(dir, 'npm/rules/README.md', '# rules\n')
      await writeFileDeep(dir, 'npm/rules/ok/main.mdc', '#\n')
      await writeFileDeep(dir, 'npm/rules/ok/main.json', '{}')
      const { js, wasm } = await runRuleMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — npm-module/skill_meta (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runSkillMetaBoth = dir =>
    runFullScopeBoth(SKILL_META_MAIN_MJS_PATH, SKILL_META_CONCERN_KEY, 'npm-module', 'skill_meta', dir)

  test('успіх: npm/skills/ відсутній → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{}\n')
      const { js, wasm } = await runSkillMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: валідний скіл (worktree:false, auto-масив, tier) → тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'npm/skills/n-lint/main.json',
        JSON.stringify({ worktree: false, auto: ['n-js'], tier: 'avg' })
      )
      const { js, wasm } = await runSkillMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: main.json відсутній → «відсутній або невалідний» з формою очікуваного обʼєкта', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/skills/n-lint/SKILL.md', '# skill\n')
      const { js, wasm } = await runSkillMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([
        {
          reason: 'skill_meta',
          severity: 'error',
          message: 'skills/n-lint: відсутній або невалідний main.json (очікується {"auto"?, "worktree": bool})'
        }
      ])
    })
  })

  test('порушення: усі поля биті → пʼять violations у канонічному порядку', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/skills/n-lint/auto.md', 'завжди\n')
      await writeFileDeep(
        dir,
        'npm/skills/n-lint/main.json',
        JSON.stringify({ worktree: 'yes', auto: [], requireRoot: 'no', tier: 'ultra' })
      )
      const { js, wasm } = await runSkillMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual([
        'skills/n-lint: залишковий auto.md — видали (метадані тепер у main.json)',
        'skills/n-lint: main.json.worktree має бути boolean',
        'skills/n-lint: main.json.auto нерозпізнане — очікується "завжди" або непорожній масив правил',
        'skills/n-lint: main.json.requireRoot має бути boolean',
        'skills/n-lint: main.json.tier має бути "min" | "avg" | "max"'
      ])
    })
  })

  test('порушення: requireRoot:false при worktree:true → конфлікт-повідомлення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/skills/n-taze/main.json', JSON.stringify({ worktree: true, requireRoot: false }))
      const { js, wasm } = await runSkillMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('requireRoot:false суперечить worktree:true')
    })
  })

  test('край: auto:"завжди" валідне, а auto:"інколи" — ні (кілька скілів у лексикографічному порядку)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/skills/a-ok/main.json', JSON.stringify({ worktree: true, auto: 'завжди' }))
      await writeFileDeep(dir, 'npm/skills/b-bad/main.json', JSON.stringify({ worktree: true, auto: 'інколи' }))
      const { js, wasm } = await runSkillMetaBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('skills/b-bad')
    })
  })
})

describe('wasm-plugin parity — npm-module/header_doc_pointer (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runHeaderDocPointerBoth = dir =>
    runFullScopeBoth(
      HEADER_DOC_POINTER_MAIN_MJS_PATH,
      HEADER_DOC_POINTER_CONCERN_KEY,
      'npm-module',
      'header_doc_pointer',
      dir
    )

  test('успіх: docs/ немає → наратив у header-JSDoc дозволений обом реалізаціям', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'npm/rules/n-js/js/scan.mjs',
        '/**\n * Перший рядок.\n * Другий рядок.\n * Третій рядок.\n */\nexport const x = 1\n'
      )
      const { js, wasm } = await runHeaderDocPointerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: pointer-JSDoc (один рядок) поряд із docs/ → тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/n-js/js/docs/scan.md', '# scan\n')
      await writeFileDeep(dir, 'npm/rules/n-js/js/scan.mjs', '/** @see ./docs/scan.md */\nexport const x = 1\n')
      const { js, wasm } = await runHeaderDocPointerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: наратив у header-JSDoc при наявному docs/ → ідентичне violation із лічильником рядків', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/skills/n-lint/js/docs/run.md', '# run\n')
      await writeFileDeep(
        dir,
        'npm/skills/n-lint/js/run.mjs',
        '/**\n * Огляд.\n *\n * Деталі поведінки.\n */\nimport { x } from "y"\nexport const z = x\n'
      )
      const { js, wasm } = await runHeaderDocPointerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([
        {
          reason: 'header_doc_pointer',
          severity: 'error',
          message:
            'npm/skills/n-lint/js/run.mjs: docs/run.md вже описує поведінку — module-level JSDoc має бути pointer (≤1 рядок, зараз 2)'
        }
      ])
    })
  })

  test('край: JSDoc ПІСЛЯ першого import/export не рахується module-level (regex-межа, не AST)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/n-js/js/docs/late.md', '# late\n')
      await writeFileDeep(
        dir,
        'npm/rules/n-js/js/late.mjs',
        'import { a } from "b"\n\n/**\n * Наратив.\n * Ще наратив.\n */\nexport const c = a\n'
      )
      const { js, wasm } = await runHeaderDocPointerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('край: *.test.mjs і не-.mjs пропускаються, вкладені підкаталоги js/ не скануються', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/n-js/js/docs/a.md', '# a\n')
      await writeFileDeep(
        dir,
        'npm/rules/n-js/js/a.test.mjs',
        '/**\n * Наратив.\n * Ще наратив.\n */\nexport const t = 1\n'
      )
      await writeFileDeep(dir, 'npm/rules/n-js/js/docs/b.md', '# b\n')
      await writeFileDeep(dir, 'npm/rules/n-js/js/b.js', '/**\n * Наратив.\n * Ще.\n */\nexport const b = 1\n')
      const { js, wasm } = await runHeaderDocPointerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('край: JSDoc у рядковому літералі до першого import — обидві реалізації беруть його однаково (regex-канон)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'npm/rules/n-js/js/docs/lit.md', '# lit\n')
      await writeFileDeep(
        dir,
        'npm/rules/n-js/js/lit.mjs',
        'const s = "/**\\n * один\\n * два\\n */"\nexport const q = s\n'
      )
      const { js, wasm } = await runHeaderDocPointerBoth(dir)
      expect(wasm).toEqual(js)
    })
  })

  test('порушення: обидва base-сегменти (npm/rules і npm/skills) у порядку rules → skills', async () => {
    await withTmpDir(async dir => {
      for (const base of ['npm/rules', 'npm/skills']) {
        await writeFileDeep(dir, `${base}/x/js/docs/m.md`, '# m\n')
        await writeFileDeep(dir, `${base}/x/js/m.mjs`, '/**\n * а.\n * б.\n */\nexport const m = 1\n')
      }
      const { js, wasm } = await runHeaderDocPointerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message.split(':', 1)[0])).toEqual(['npm/rules/x/js/m.mjs', 'npm/skills/x/js/m.mjs'])
    })
  })
})

describe('wasm-plugin parity — npm-module/package_structure (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runPackageStructureBoth = dir =>
    runFullScopeBoth(
      PACKAGE_STRUCTURE_MAIN_MJS_PATH,
      PACKAGE_STRUCTURE_CONCERN_KEY,
      'npm-module',
      'package_structure',
      dir
    )

  /**
   * Мінімальний канонічний npm-monorepo (усе на місці) — база, від якої
   * фікстури нижче ВІДНІМАЮТЬ по одному факту.
   * @param {string} dir корінь tmp-дерева
   * @returns {Promise<void>}
   */
  async function writeCanonicalNpmModule(dir) {
    await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['npm'] }))
    await writeFileDeep(dir, 'npm/package.json', JSON.stringify({ name: '@x/y', types: './types/index.d.ts' }))
    await writeFileDeep(dir, 'npm/types/index.d.ts', 'export {}\n')
    await writeFileDeep(dir, 'npm/tsconfig.emit-types.json', '{}\n')
    await writeFileDeep(
      dir,
      'hk.pkl',
      'hooks {\n  ["pre-commit"] {\n    steps { ["tsc"] { glob = "x"; check = "bunx -p typescript tsc -p npm/tsconfig.emit-types.json" } }\n  }\n  ["npm-changelog"] {\n    fix = "N_RULES_CHANGELOG_AUTOFIX=1 npx @7n/rules lint changelog"\n  }\n}\n'
    )
    await writeFileDeep(dir, '.github/workflows/npm-publish.yml', 'name: publish\n')
  }

  test('успіх: канонічний npm-monorepo → тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: порожній репозиторій → повний набір structural-violations у канонічному порядку', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'readme.md', '# x\n')
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual([
        'package.json не існує',
        'npm/ директорія не існує',
        'npm/package.json не існує — створи package.json для npm модуля',
        'Без .js під npm/src потрібен npm/tsconfig.emit-types.json (див. npm-module.mdc: emit через tsconfig, без штучного src/index.js)',
        'Очікується hk.pkl або .config/hk.pkl з pre-commit і tsc (npm-module.mdc)',
        '.github/workflows/ не існує',
        'Відсутній .github/workflows/npm-publish.yml (npm-module.mdc: npm publish)'
      ])
      expect(js.every(v => v.reason === 'package_structure')).toBe(true)
    })
  })

  test('порушення: layout npm/src з .js → інший набір hk-фрагментів (types/index.d.ts на місці)', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(dir, 'npm/src/index.js', 'export const a = 1\n')
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual([
        'hk.pkl: онови pre-commit крок (npm-module.mdc); не знайдено: src/**/*.js, --declaration, --allowJs, --emitDeclarationOnly, --outDir types, --skipLibCheck'
      ])
    })
  })

  test('порушення: layout npm/src з .js без npm/types/index.d.ts → src-специфічне повідомлення про types', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(dir, 'npm/src/index.js', 'export const a = 1\n')
      await writeFileDeep(dir, 'npm/package.json', JSON.stringify({ name: '@x/y' }))
      const { rm } = await import('node:fs/promises')
      await rm(join(dir, 'npm/types/index.d.ts'))
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js[0].message).toBe('Відсутній npm/types/index.d.ts (згенеруй tsc з npm-module.mdc)')
    })
  })

  test('порушення: types вказує поза ./types/ → String(typesField) у повідомленні', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(dir, 'npm/package.json', JSON.stringify({ name: '@x/y', types: './dist/index.d.ts' }))
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe('Файл для поля types не знайдено або шлях не під ./types/ — ./dist/index.d.ts')
    })
  })

  test('край: types відсутнє зовсім → String(undefined) === "undefined" з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(dir, 'npm/package.json', JSON.stringify({ name: '@x/y' }))
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe('Файл для поля types не знайдено або шлях не під ./types/ — undefined')
    })
  })

  test('порушення: застарілий "check changelog" у hk.pkl витісняє перевірку кроку npm-changelog', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(
        dir,
        'hk.pkl',
        'hooks {\n  ["pre-commit"] { check = "bunx -p typescript tsc -p npm/tsconfig.emit-types.json && npx @7n/rules check changelog" }\n}\n'
      )
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('застарілий виклик "check changelog"')
    })
  })

  test('порушення: тести у tarball — каталог, імʼя файлу й імпорт фреймворку', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(
        dir,
        'npm/package.json',
        JSON.stringify({ name: '@x/y', types: './types/index.d.ts', files: ['lib'] })
      )
      await writeFileDeep(dir, 'npm/lib/ok.mjs', 'export const ok = 1\n')
      await writeFileDeep(dir, 'npm/lib/fixtures/data.json', '{}\n')
      await writeFileDeep(dir, 'npm/lib/util.test.mjs', 'export const t = 1\n')
      await writeFileDeep(dir, 'npm/lib/hidden.mjs', "import { test } from 'vitest'\nexport const h = test\n")
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message.split(' — ', 1)[0])).toEqual([
        'npm/lib/fixtures/data.json: test-style каталог "fixtures/"',
        'npm/lib/hidden.mjs: імпорт test-фреймворку "vitest"',
        "npm/lib/util.test.mjs: test-style ім'я файлу"
      ])
    })
  })

  test('край: негативний glob у files виключає файл з tarball-простору обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(
        dir,
        'npm/package.json',
        JSON.stringify({
          name: '@x/y',
          types: './types/index.d.ts',
          files: ['lib', '!**/fixtures/**', '!**/*.test.mjs']
        })
      )
      await writeFileDeep(dir, 'npm/lib/ok.mjs', 'export const ok = 1\n')
      await writeFileDeep(dir, 'npm/lib/fixtures/data.json', '{}\n')
      await writeFileDeep(dir, 'npm/lib/util.test.mjs', 'export const t = 1\n')
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('край: carve-out rules/<rule-name>/ — правило з id "test" НЕ є test-fixture', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(
        dir,
        'npm/package.json',
        JSON.stringify({ name: '@x/y', types: './types/index.d.ts', files: ['rules'] })
      )
      await writeFileDeep(dir, 'npm/rules/test/main.mdc', '# test rule\n')
      await writeFileDeep(dir, 'npm/rules/n-js/tests/deep.mjs', 'export const d = 1\n')
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message.split(' — ', 1)[0])).toEqual([
        'npm/rules/n-js/tests/deep.mjs: test-style каталог "tests/"'
      ])
    })
  })

  test('край: `require`/динамічний import test-фреймворку ловиться так само, як статичний', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(
        dir,
        'npm/package.json',
        JSON.stringify({ name: '@x/y', types: './types/index.d.ts', files: ['lib'] })
      )
      await writeFileDeep(dir, 'npm/lib/a.cjs', "const { test } = require('node:test')\nmodule.exports = test\n")
      await writeFileDeep(dir, 'npm/lib/b.mjs', "export const load = () => import('mocha')\n")
      // Рядок/коментар зі згадкою vitest — НЕ імпорт (тут regex збрехав би, AST — ні).
      await writeFileDeep(dir, 'npm/lib/c.mjs', "// import { it } from 'vitest'\nexport const s = \"from 'vitest'\"\n")
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message.split(' — ', 1)[0])).toEqual([
        'npm/lib/a.cjs: імпорт test-фреймворку "node:test"',
        'npm/lib/b.mjs: імпорт test-фреймворку "mocha"'
      ])
    })
  })

  test('край: files-запис — окремий ФАЙЛ, а не каталог (сирий рядок запису в шляху)', async () => {
    await withTmpDir(async dir => {
      await writeCanonicalNpmModule(dir)
      await writeFileDeep(
        dir,
        'npm/package.json',
        JSON.stringify({ name: '@x/y', types: './types/index.d.ts', files: ['spec.mjs', 'missing.mjs'] })
      )
      await writeFileDeep(dir, 'npm/spec.mjs', 'export const s = 1\n')
      const { js, wasm } = await runPackageStructureBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — js/dep-policy (JS канон vs wasm plugin-lang-js, full-scope міст, AST-концерн)', () => {
  const runDepPolicyBoth = dir =>
    runFullScopeBoth(DEP_POLICY_MAIN_MJS_PATH, DEP_POLICY_CONCERN_KEY, 'js', 'dep-policy', dir)

  test('успіх: дозволені імпорти → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/app.mjs', "import bowser from 'bowser'\nexport const b = bowser\n")
      const { js, wasm } = await runDepPolicyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: статичний import ua-parser-js → ідентичне violation з підказкою про bowser', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/ua.mjs', "import UAParser from 'ua-parser-js'\nexport const p = UAParser\n")
      const { js, wasm } = await runDepPolicyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('dep-policy')
      expect(js[0].message).toBe(
        "src/ua.mjs: заборонений import 'ua-parser-js' — замінити на bowser (MIT, ~6 KB) — npm i bowser. " +
          'ua-parser-js v2 змінив ліцензію на AGPL-3.0, несумісну з комерційним використанням (js.mdc dep-policy)'
      )
    })
  })

  test('порушення: require і динамічний import ловляться так само, як статичний', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'a.cjs', "const f = require('@nitra/as-integrations-fastify')\nmodule.exports = f\n")
      await writeFileDeep(dir, 'b.mjs', "export const load = () => import('@nitra/as-integrations-fastify')\n")
      const { js, wasm } = await runDepPolicyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js.map(v => v.message.split(':', 1)[0])).toEqual(['a.cjs', 'b.mjs'])
    })
  })

  test('край: згадки в коментарі, рядку й шаблонному літералі — НЕ порушення (тут regex збрехав би)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'src/noise.mjs',
        [
          "// import UAParser from 'ua-parser-js'",
          "/* require('ua-parser-js') */",
          'export const s = "import x from \'ua-parser-js\'"',
          'export const t = `ua-parser-js`',
          "export const u = 'ua-parser-js'"
        ].join('\n') + '\n'
      )
      const { js, wasm } = await runDepPolicyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('край: субшлях забороненого пакета дозволений (точна рівність specifier-а)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/sub.mjs', "import x from 'ua-parser-js/helpers'\nexport const s = x\n")
      const { js, wasm } = await runDepPolicyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  // Синтаксично БИТИЙ файл сюди свідомо не входить — розбіжність 6
  // (доккомент секції «Батч 7» у `crates/plugin-lang-js/src/lib.rs`):
  // `extractImportSpecifiers` не звіряє `result.errors`, тож обидві сторони
  // читають частковий AST, але глибина recovery в napi-`oxc-parser` і
  // `oxc_parser`-crate різна.
  test('край: TS-джерело з type-import ловиться так само, як звичайний import', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/ok.ts', "import type { X } from 'ua-parser-js'\nexport type Y = X\n")
      await writeFileDeep(dir, 'src/plain.mts', "import x from 'ua-parser-js'\nexport const p = x\n")
      const { js, wasm } = await runDepPolicyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message.split(':', 1)[0])).toEqual(['src/ok.ts', 'src/plain.mts'])
    })
  })

  test('край: два порушення в одному файлі — статичне перед walk-знахідкою (двофазний порядок канону)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'src/mix.mjs',
        "const legacy = require('ua-parser-js')\nimport fastify from '@nitra/as-integrations-fastify'\nexport const m = [legacy, fastify]\n"
      )
      const { js, wasm } = await runDepPolicyBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].message).toContain('@nitra/as-integrations-fastify')
      expect(js[1].message).toContain('ua-parser-js')
    })
  })
})

// Батч 8 (§3.5.5): чотири «файлово-структурні» концерни без зовнішнього тула.
// Усі full-scope, той самий [`runFullScopeBoth`]. `bun/layout` і
// `style/tooling` — чисті `existsSync`-перевірки кореня (доводять, що
// host-побудований батч еквівалентний FS-обходу JS-канону);
// `test/sandbox-aware-test` і `test/vitest-api-conventions` — сканери тіл
// `*.test.{mjs,js}`, дзеркало
// `plugins/lang-js/rules/test/<concern>/tests/*.test.mjs` там, де вони є.
describe('wasm-plugin parity — bun/layout (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runBunLayoutBoth = dir =>
    runFullScopeBoth(BUN_LAYOUT_MAIN_MJS_PATH, BUN_LAYOUT_CONCERN_KEY, 'bun', 'layout', dir)

  test('успіх: bun.lock + bunfig.toml + package.json → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bun.lock', '')
      await writeFileDeep(dir, 'bunfig.toml', '[install]\nlinker = "hoisted"\n')
      await writeFileDeep(dir, 'package.json', '{ "name": "app" }\n')
      const { js, wasm } = await runBunLayoutBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: порожній корінь → три однакові violations у тому самому порядку', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runBunLayoutBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual([
        'Відсутній bun.lock — запусти bun i',
        'Відсутній bunfig.toml — створи з [install] linker = "hoisted" (bun.mdc)',
        'Відсутній package.json у корені'
      ])
      expect(js.every(v => v.reason === 'layout')).toBe(true)
    })
  })

  test('порушення: усі чотири заборонені lock/конфіг-файли — порядок масиву канону', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bun.lock', '')
      await writeFileDeep(dir, 'bunfig.toml', '[install]\n')
      await writeFileDeep(dir, 'package.json', '{}\n')
      for (const f of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']) {
        await writeFileDeep(dir, f, '')
      }
      const { js, wasm } = await runBunLayoutBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual([
        'Знайдено заборонений файл: package-lock.json — видали його',
        'Знайдено заборонений файл: yarn.lock — видали його',
        'Знайдено заборонений файл: pnpm-lock.yaml — видали його',
        'Знайдено заборонений файл: .yarnrc.yml — видали його'
      ])
    })
  })

  // Каталог `.yarn/` wasm-порт реконструює з батча (`.yarn/**` у глобі
  // контрибуції) — саме тут «файл під каталогом» має дати той самий сигнал,
  // що `existsSync(join(cwd, '.yarn'))` JS-канону.
  test('порушення: непорожній .yarn/ → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bun.lock', '')
      await writeFileDeep(dir, 'bunfig.toml', '[install]\n')
      await writeFileDeep(dir, 'package.json', '{}\n')
      await writeFileDeep(dir, '.yarn/install-state.gz', 'x')
      const { js, wasm } = await runBunLayoutBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe('Знайдено директорію .yarn — видали її')
    })
  })

  test('край: файл (не каталог) з іменем .yarn теж рахується — глоб контрибуції ширший за concern.json', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bun.lock', '')
      await writeFileDeep(dir, 'bunfig.toml', '[install]\n')
      await writeFileDeep(dir, 'package.json', '{}\n')
      await writeFileDeep(dir, '.yarn', '')
      const { js, wasm } = await runBunLayoutBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual(['Знайдено директорію .yarn — видали її'])
    })
  })

  test('край: вкладені lock-файли підпакетів корінь не чіпають (existsSync лише cwd)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bun.lock', '')
      await writeFileDeep(dir, 'bunfig.toml', '[install]\n')
      await writeFileDeep(dir, 'package.json', '{}\n')
      await writeFileDeep(dir, 'packages/ui/yarn.lock', '')
      const { js, wasm } = await runBunLayoutBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — style/tooling (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runStyleToolingBoth = dir =>
    runFullScopeBoth(STYLE_TOOLING_MAIN_MJS_PATH, STYLE_TOOLING_CONCERN_KEY, 'style', 'tooling', dir)

  test('успіх: поле stylelint у package.json + .stylelintignore з dist/ → без порушень', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ stylelint: { extends: '@nitra/stylelint-config' } }))
      await writeFileDeep(dir, '.stylelintignore', 'dist/\n')
      const { js, wasm } = await runStyleToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: зовнішній stylelint.config.mjs замість поля + dist/ з пробілами навколо', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{}\n')
      await writeFileDeep(dir, 'stylelint.config.mjs', 'export default {}\n')
      await writeFileDeep(dir, '.stylelintignore', '  dist/  \n')
      const { js, wasm } = await runStyleToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: ні конфігу, ні .stylelintignore → два однакові violations у тому самому порядку', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{ "name": "app" }\n')
      const { js, wasm } = await runStyleToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].message).toContain('Немає конфігу stylelint')
      expect(js[1].message).toBe('.stylelintignore не існує — створи з вмістом: dist/')
      expect(js.every(v => v.reason === 'tooling')).toBe(true)
    })
  })

  test('порушення: .stylelintignore без рядка dist/ → однакове violation', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ stylelint: {} }))
      await writeFileDeep(dir, '.stylelintignore', 'build/\ncoverage/\n')
      const { js, wasm } = await runStyleToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe('.stylelintignore не містить рядка dist/ — додай його (style.mdc)')
    })
  })

  test('край: без кореневого package.json перевірка конфігу пропускається (лишається лише ignore-гілка)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, '.stylelintignore', 'dist/\n')
      const { js, wasm } = await runStyleToolingBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  // `pkg.stylelint && typeof pkg.stylelint === 'object'` — рядок не проходить,
  // а МАСИВ проходить (`typeof [] === 'object'`); порт мусить відтворити
  // саме цю JS-семантику, а не «об'єкт».
  test('край: stylelint-рядок не рахується конфігом, а stylelint-масив — рахується', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ stylelint: '@nitra/stylelint-config' }))
      await writeFileDeep(dir, '.stylelintignore', 'dist/\n')
      const asString = await runStyleToolingBoth(dir)
      expect(asString.wasm).toEqual(asString.js)
      expect(asString.js).toHaveLength(1)

      await writeFileDeep(dir, 'package.json', JSON.stringify({ stylelint: [] }))
      const asArray = await runStyleToolingBoth(dir)
      expect(asArray.wasm).toEqual(asArray.js)
      expect(asArray.js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — test/sandbox-aware-test (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runSandboxBoth = dir =>
    runFullScopeBoth(
      SANDBOX_AWARE_TEST_MAIN_MJS_PATH,
      SANDBOX_AWARE_TEST_CONCERN_KEY,
      'test',
      'sandbox-aware-test',
      dir
    )

  /** Тіло з `import.meta.dirname` і чотирма `'..'`-літералами у вікні 400. */
  const DEEP_NAV_BODY =
    "import { join } from 'node:path'\nconst root = join(import.meta.dirname, '..', '..', '..', '..')\n"

  test('порушення: глибока import.meta-навігація без ізоляції → однакове violation', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'tests/deep.test.mjs', DEEP_NAV_BODY)
      const { js, wasm } = await runSandboxBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('sandbox-aware-test')
      expect(js[0].message).toContain('tests/deep.test.mjs: import.meta deep navigation')
    })
  })

  test('успіх: та сама навігація під withTmpDir() → тиша з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'tests/deep.test.mjs', `${DEEP_NAV_BODY}await withTmpDir(async d => {})\n`)
      const { js, wasm } = await runSandboxBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: захист test.skipIf(process.env.STRYKER_MUTATOR_WORKER) з пробілами', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'tests/deep.test.mjs',
        `${DEEP_NAV_BODY}test.skipIf( process.env.STRYKER_MUTATOR_WORKER )('x', () => {})\n`
      )
      const { js, wasm } = await runSandboxBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: лише три рівні .. → не «глибока» навігація', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'tests/shallow.test.mjs',
        "import { join } from 'node:path'\nconst r = join(import.meta.dirname, '..', '..', '..')\n"
      )
      const { js, wasm } = await runSandboxBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  // Вікно 400 символів після вживання `import.meta.*` — літерали за його
  // межами не рахуються (обидві сторони).
  test('край: `..`-літерали далі за 400 символів у вікно не потрапляють', async () => {
    await withTmpDir(async dir => {
      const filler = 'x'.repeat(420)
      await writeFileDeep(
        dir,
        'tests/far.test.mjs',
        `const d = import.meta.dirname\n// ${filler}\nconst r = join(d, '..', '..', '..', '..')\n`
      )
      const { js, wasm } = await runSandboxBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('край: не-тестовий файл із тим самим тілом ігнорується обома', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/deep.mjs', DEEP_NAV_BODY)
      const { js, wasm } = await runSandboxBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — test/vitest-api-conventions (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runVitestApiBoth = dir =>
    runFullScopeBoth(
      VITEST_API_CONVENTIONS_MAIN_MJS_PATH,
      VITEST_API_CONVENTIONS_CONCERN_KEY,
      'test',
      'vitest-api-conventions',
      dir
    )

  // Сам концерн — ТЕКСТОВИЙ сканер, а цей файл теж `*.test.mjs`, тож
  // літеральний `.toBe(` у фікстурах позначив би власні рядки цього файлу як
  // порушення під час `lint --full`. Складаємо виклик із частин, аби
  // послідовність `.toBe(` у ВИХІДНОМУ тексті не зустрічалась.
  const TO_BE = '.toBe'
  /**
   * Текст фікстури `expect(<recv>)<TO_BE>(<arg>)` без літерального `.toBe(`
   * у цьому файлі.
   * @param {string} recv вираз-приймач усередині `expect(...)`
   * @param {string} arg текст аргументу матчера
   * @returns {string} рядок коду фікстури
   */
  const expectToBe = (recv, arg) => `expect(${recv})${TO_BE}(${arg})`

  test('порушення: toBe з об’єктним і масивним літералами → два однакові violations з file', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'tests/api.test.mjs', `${expectToBe('a', '{ x: 1 }')}\n${expectToBe('b', '[1, 2]')}\n`)
      const { js, wasm } = await runVitestApiBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].reason).toBe('vitest-api-conventions')
      expect(js[0].file).toBe('tests/api.test.mjs')
      expect(js[0].message).toContain('tests/api.test.mjs:1: expect(...)')
      expect(js[1].message).toContain('tests/api.test.mjs:2: expect(...)')
    })
  })

  test('успіх: літерал із приєднаним .join() — результат рядок, не посилання', async () => {
    await withTmpDir(async dir => {
      const arg = String.raw`['x', 'y'].join('\n')`
      await writeFileDeep(dir, 'tests/api.test.mjs', `${expectToBe('a', arg)}\n`)
      const { js, wasm } = await runVitestApiBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: примітивні аргументи toBe не чіпаються', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'tests/api.test.mjs',
        `${expectToBe('a', '1')}\n${expectToBe('b', "'x'")}\n${expectToBe('c', 'undefined')}\n`
      )
      const { js, wasm } = await runVitestApiBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  // Дужки всередині рядкових/template-літералів не збивають сканер балансу —
  // саме тут байтовий порт мусить збігтись із UTF-16-сканером JS.
  test('край: дужки у рядкових і template-літералах усередині об’єкта', async () => {
    await withTmpDir(async dir => {
      const templateBrace = ['`', '}', '`'].join('')
      const arg = `{ s: '}', t: "]", u: ${templateBrace} }`
      const body = `${expectToBe('a', arg)}\n`
      await writeFileDeep(dir, 'tests/api.test.mjs', body)
      const { js, wasm } = await runVitestApiBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
    })
  })

  test('край: незбалансовані дужки — обидві сторони «здаються» без violation', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'tests/api.test.mjs', `${expectToBe('a', '{ x: 1')}\n`)
      const { js, wasm } = await runVitestApiBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('край: багаторядковий літерал — рядок рахується від позиції виклику', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'tests/api.test.mjs', `// прелюдія\n${expectToBe('a', '\n  { x: 1 }\n')}\n`)
      const { js, wasm } = await runVitestApiBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('tests/api.test.mjs:2:')
    })
  })

  test('край: не-тестовий файл із тим самим викликом ігнорується обома', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/api.mjs', `${expectToBe('a', '{ x: 1 }')}\n`)
      const { js, wasm } = await runVitestApiBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-plugin parity — vue/packages (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runVuePackagesBoth = dir =>
    runFullScopeBoth(VUE_PACKAGES_MAIN_MJS_PATH, VUE_PACKAGES_CONCERN_KEY, 'vue', 'packages', dir)

  /** Кореневий `package.json` Vue-додатка з повним набором vitest-devDeps. */
  const APP_PKG_JSON = JSON.stringify({
    name: 'app',
    dependencies: { vue: '^3.6.0' },
    devDependencies: { vitest: '1', '@vitest/coverage-v8': '1', '@stryker-mutator/vitest-runner': '1' }
  })

  /** Vite-конфіг без жодного порушення (AutoImport покриває `'vue'`). */
  const CLEAN_VITE_CONFIG =
    "export default { css: { transformer: 'lightningcss' }, plugins: [VueMacros({}), AutoImport({ imports: ['vue'] })] }\n"

  /**
   * Розкладає чистий Vue-пакет у корені tmp-дерева.
   * @param {string} dir корінь tmp-дерева
   * @returns {Promise<void>}
   */
  async function writeCleanVueApp(dir) {
    await writeFileDeep(dir, 'package.json', APP_PKG_JSON)
    await writeFileDeep(dir, '.vscode/extensions.json', JSON.stringify({ recommendations: ['Vue.volar'] }))
    await writeFileDeep(dir, 'jsconfig.json', '{}')
    await writeFileDeep(dir, 'src/vite-env.d.ts', '/// <reference types="vite/client" />\n')
    await writeFileDeep(dir, 'vite.config.js', CLEAN_VITE_CONFIG)
  }

  test('успіх: чистий Vue-пакет — жодного violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: репо без vue у dependencies — концерн мовчить у обох', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'plain' }))
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: немає Vue.volar і двох кореневих vitest-devDeps', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(
        dir,
        'package.json',
        JSON.stringify({ name: 'app', dependencies: { vue: '^3.6.0' }, devDependencies: { vitest: '1' } })
      )
      await writeFileDeep(
        dir,
        '.vscode/extensions.json',
        JSON.stringify({ recommendations: ['dbaeumer.vscode-eslint'] })
      )
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(3)
      expect(js[0].reason).toBe('packages')
      expect(js[0].message).toBe('extensions.json не містить Vue.volar — додай до recommendations')
      expect(js[1].message).toContain("'@vitest/coverage-v8'")
      expect(js[2].message).toContain("'@stryker-mutator/vitest-runner'")
    })
  })

  test('порушення: немає src/vite-env.d.ts — перевірка обривається на першому fail', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      const { rm } = await import('node:fs/promises')
      await rm(join(dir, 'src/vite-env.d.ts'))
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('[корінь] немає src/vite-env.d.ts')
    })
  })

  test('порушення: vite.config без lightningcss/VueMacros/AutoImport — три однакові violations', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(dir, 'vite.config.js', 'export default {}\n')
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(3)
      expect(js[0].message).toContain('lightningcss')
      expect(js[1].message).toBe('[корінь] vite.config.js не містить VueMacros')
      expect(js[2].message).toBe('[корінь] vite.config.js не містить AutoImport')
    })
  })

  test('порушення: AutoImport без `vue` у imports — value-імпорти НЕ перевіряються, лише сам конфіг', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(
        dir,
        'vite.config.js',
        "export default { css: { transformer: 'lightningcss' }, plugins: [VueMacros({}), AutoImport({ imports: ['quasar'] })] }\n"
      )
      await writeFileDeep(dir, 'src/Page.vue', "<script setup>\nimport { ref } from 'vue'\n</script>\n")
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain("AutoImport не містить 'vue' у imports")
    })
  })

  // Номер рядка — по ВИТЯГНУТИХ `<script>`-блоках SFC, не по сирому файлу
  // (доккомент секції «Батч 9» у `crates/plugin-lang-js/src/lib.rs`).
  test('порушення: явний value-імпорт з `vue` у .vue — рядок рахується по script-блоку', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(
        dir,
        'src/Page.vue',
        "<template><div /></template>\n<script setup>\nimport { ref } from 'vue'\n</script>\n"
      )
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe(
        "[корінь] src/Page.vue:2 — прибери явний value-імпорт з 'vue' (unplugin-auto-import): import { ref } from 'vue'"
      )
    })
  })

  test('успіх: type-only й side-effect імпорти з `vue` дозволені обома', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(
        dir,
        'src/types.ts',
        "import type { Ref } from 'vue'\nimport { type ComputedRef } from 'vue'\nimport 'vue'\n"
      )
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('успіх: тести, `__tests__` і `.d.ts` поза перевіркою auto-import у обох', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(dir, 'src/a.test.ts', "import { ref } from 'vue'\n")
      await writeFileDeep(dir, 'src/__tests__/b.ts', "import { ref } from 'vue'\n")
      await writeFileDeep(dir, 'src/auto-imports.d.ts', "import { ref } from 'vue'\n")
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: імпорт Node-нативного модуля у .vue SFC', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(dir, 'src/Fs.vue', "<script setup>\nimport { readFile } from 'node:fs/promises'\n</script>\n")
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain("імпорт Node-нативного модуля 'node:fs/promises' у .vue заборонено")
    })
  })

  test('успіх: той самий Node-імпорт у .ts (не SFC) — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(dir, 'src/server.ts', "import { join } from 'node:path'\n")
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: згадка `esbuild` у .md — той самий rel:line і фрагмент', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(dir, 'docs/build.md', '# Збірка\n\nМи використовуємо esbuild.\n')
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe(
        "[корінь] docs/build.md:3 — знайдено 'esbuild'. Замінити на 'rolldown'. Фрагмент: Ми використовуємо esbuild."
      )
    })
  })

  test('край: `esbuild` у lock-файлі ігнорується обома', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(dir, 'bun.lock', 'esbuild\n')
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('край: понад 30 згадок `esbuild` — обидві дають 30 + підсумкову', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(dir, 'notes.md', 'esbuild\n'.repeat(40))
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(31)
      expect(js[30].message).toBe("[корінь] показано перші 30 збігів 'esbuild' (замінити на 'rolldown')")
    })
  })

  test('успіх: бібліотека компонентів (vue у peerDependencies) — auto-import не вимагається', async () => {
    await withTmpDir(async dir => {
      await writeCleanVueApp(dir)
      await writeFileDeep(
        dir,
        'package.json',
        JSON.stringify({
          name: 'ui',
          dependencies: { vue: '^3.6.0' },
          peerDependencies: { vue: '^3.6.0' },
          devDependencies: { vitest: '1', '@vitest/coverage-v8': '1', '@stryker-mutator/vitest-runner': '1' }
        })
      )
      await writeFileDeep(dir, 'vite.config.js', 'export default {}\n')
      await writeFileDeep(dir, 'src/Widget.vue', "<script setup>\nimport { ref } from 'vue'\n</script>\n")
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('workspace-пакет: префікс повідомлень — шлях пакета, не «корінь»', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'package.json',
        JSON.stringify({
          name: 'root',
          workspaces: ['packages/*'],
          devDependencies: { vitest: '1', '@vitest/coverage-v8': '1', '@stryker-mutator/vitest-runner': '1' }
        })
      )
      await writeFileDeep(dir, '.vscode/extensions.json', JSON.stringify({ recommendations: ['Vue.volar'] }))
      await writeFileDeep(
        dir,
        'packages/site/package.json',
        JSON.stringify({ name: 'site', dependencies: { vue: '^3.6.0' } })
      )
      const { js, wasm } = await runVuePackagesBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.length).toBeGreaterThan(0)
      expect(js.every(v => v.message.startsWith('[packages/site] '))).toBe(true)
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
