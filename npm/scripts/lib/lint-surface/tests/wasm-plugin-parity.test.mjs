/**
 * Parity-тест wasm-плагіна `plugin-lang-js` (задачі N2, Q1 батч 1, Q2
 * батч 2 та Q3 — де-скоуп до byte-exact-парних концернів, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5 і
 * `docs/specs/2026-08-01-wasm-ast-strategy.md`): звіряє `violations`
 * `runWasmConcern` napi-мосту (`crates/rules-napi` → `crates/plugin-lang-js`)
 * із ЕТАЛОНОМ — знятим виводом JS-детекторів `plugins/lang-js/rules/<rule>/
 * <concern>/main.mjs` (reason/message/file/severity біт-у-біт) — для перших
 * семи концернів (задачі N2 + Q1 батч 1), `test/no-console-store-restore`/
 * `test/no-bun-test-import` (задача Q2 батч 2, справжній 1:1-порт),
 * `js/utils_imports`/`test/no-relative-fs-path` (задача Q3) і
 * `js-bun-redis/imports`/`js-mssql/deps`/`js-bun-db/safety` (задача Q4
 * батч 4 — де-скоуп батчу 2 знято: regex-groundwork замінено справжніми
 * AST-портами, доккомент секції «Батч 4» у
 * `crates/plugin-lang-js/src/lib.rs`) — усі п'ять AST-концернів byte-exact
 * через ТОЙ САМИЙ движок `oxc_parser`, не наближення. Це доводить конвеєр
 * «wasm-компонент → napi-міст → JS-diagnostics-форма».
 *
 * ЕТАЛОН, НЕ ЖИВИЙ КАНОН: `plugins/lang-js/rules/**\/main.mjs` — транзитивний
 * шар, що видаляється разом із портом (мета цього тестового файлу — довести
 * порт, не тримати JS вічно). Поки він живий, зняти еталон можна прогнавши
 * суїт з `N_WASM_PARITY_CAPTURE=1`; звичайний прогін JS НЕ викликає — читає
 * зафіксований раніше вивід із `fixtures/wasm-parity/**\/*.json` (поряд із
 * цим файлом, [`goldenJs`] — сам механізм у `wasm-parity-golden.mjs`,
 * спільному з `wasm-plugin-parity-python.test.mjs`, доккомент нижче й там).
 * Відсутній еталон — ПАДІННЯ тесту з явним
 * проханням перезняти, не мовчазний пропуск: інакше зникнення канону не
 * дало б жодного сигналу. Той самий прийом застосовано для k8s-parity-гейта
 * (`N_K8S_PARITY_CAPTURE`, `crates/rules-core/tests/common/mod.rs`) — форма
 * тут навмисно дзеркальна. Два винятки з цього шару: `runPolicyBoth` (канон
 * — rego через conftest, `evaluatePolicyConcern`, не `main.mjs`; rego-політики
 * не видаляються) і фіксерна половина `runDocCommentsFixBoth`
 * (`fix-doc_comments.mjs` лишається каноном — лише її `violations`-вхід іде
 * через еталон, доккомент секції «Зріз 4» нижче).
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
 * Зріз 4 контракту v3.1 (`js/doc_comments`) — єдиний набір із ДВОМА рівнями
 * parity: детект (`data.{start,end}` мають бути в UTF-16, як у napi-парсера) і
 * T0-фікс (JS-патерн `fix-doc_comments.mjs` проти `runWasmConcernFix` —
 * порівнюється фінальний текст файлу). Фікстури обовʼязково несуть не-ASCII
 * (кирилиця + емодзі поза BMP), бо саме на них байтовий офсет crate-парсера
 * розходиться з UTF-16-офсетом napi-парсера — на ASCII обидві реалізації
 * збігаються навіть із забутою конверсією.
 *
 * Останній describe-блок (`size-budget`) — окремо від parity: заміряє
 * реальний `plugin_lang_js.wasm` проти спільної для всіх гостей стелі
 * (`WASM_SIZE_BUDGET_BYTES`, `./wasm-size-budget.mjs` — там число, його
 * походження зі спайка `docs/specs/2026-08-01-wasm-ast-strategy.md` і межі
 * того, що цей гейт ловить).
 */
import { existsSync } from 'node:fs'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, sep } from 'node:path'
import { env } from 'node:process'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { applyPlanEdit } from '../run-fix.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'
import { createGoldenJs } from './wasm-parity-golden.mjs'
import { WASM_SIZE_BUDGET_BYTES, WASM_SIZE_BUDGET_LABEL } from './wasm-size-budget.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip3', 'release', 'plugin_lang_js.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-parity.test.mjs: wasm-компонент plugin-lang-js не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-js/build.sh'
  )
}

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
const STORYBOOK_SCOPE_CONCERN_KEY = 'test/storybook-scope'
const STORYBOOK_HYGIENE_CONCERN_KEY = 'test/storybook-hygiene'
const STORYBOOK_PAGE_COVERAGE_CONCERN_KEY = 'test/storybook-page-coverage'
const STORYBOOK_SCAFFOLD_CONCERN_KEY = 'test/storybook-scaffold'
const STORYBOOK_CI_CONCERN_KEY = 'test/storybook-ci'
// Батч 6 (§3.5.5): `test/storybook-vitest-config` (JS-канон, full-scope) плюс
// три rego-концерни `*/package_json` — у них НЕМАЄ `main.mjs`, канон
// виконує conftest через `evaluatePolicyConcern` ([`runPolicyBoth`]).
const STORYBOOK_VITEST_CONFIG_CONCERN_KEY = 'test/storybook-vitest-config'
const BUN_DB_PACKAGE_JSON_CONCERN_KEY = 'js-bun-db/package_json'
const REDIS_PACKAGE_JSON_CONCERN_KEY = 'js-bun-redis/package_json'
const MSSQL_PACKAGE_JSON_CONCERN_KEY = 'js-mssql/package_json'
// Батч 7 (§3.5.5): кластер `npm-module/*` (метадані-перевірки, що в JS-каноні
// ходять `readdirSync`/`walkDir` по `npm/rules`, `npm/skills`, `npm/`) плюс
// AST-концерн `js/dep-policy`. Глоби контрибуцій цих пʼятьох СВІДОМО вужчі за
// `concern.json.lint.glob` — доккомент секції «Батч 7» у
// `crates/plugin-lang-js/src/lib.rs`.
// Батч 8: чотири «файлово-структурні» концерни без зовнішнього тула
// (доккомент секції «Батч 8» у `crates/plugin-lang-js/src/lib.rs`).
// Батч 9: `vue/packages` — останній придатний до порту концерн lang-js
// (доккомент секції «Батч 9» у `crates/plugin-lang-js/src/lib.rs`).
const VUE_PACKAGES_CONCERN_KEY = 'vue/packages'
// Зріз 1 контракту v3.1 (`docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`,
// §7): `test/stryker_config` — секція «Зріз 1» у `crates/plugin-lang-js/src/lib.rs`.
const STRYKER_CONFIG_CONCERN_KEY = 'test/stryker_config'
// Зріз 2 контракту v3.1: `js/check` — секція «Зріз 2» у
// `crates/plugin-lang-js/src/lib.rs` (вшитий канон oxlint + рефакторинг
// рішення Ґ, через який `knip.json` став спостережуваним порушенням).
const JS_CHECK_CONCERN_KEY = 'js/check'
// T0-фіксер `js/check` — JS-канон детектора (`main.mjs`) УЖЕ видалено
// (доккомент модуля, «ЕТАЛОН, НЕ ЖИВИЙ КАНОН» — case видалення разом із
// портом детекту), тож violations для fix-тестів беруться НЕ з `goldenJs`,
// а напряму з `runWasmConcern` (доведена парність детекту [`runJsCheckBoth`]
// вище робить це коректним джерелом — той самий шлях, яким `applyT0`
// реально живиться в проді). §2.93 зняла й канон ФІКСУ (`fix-check.mjs` +
// `eslint-config.mjs`), тож шлях до нього більше не потрібен нікому.
// T0-фіксер `js-run/runtime` (`js-run-jsconfig-create`, доккомент біля
// `fix_js_run_runtime` у `crates/plugin-lang-js/src/lib.rs`) — той самий
// full-scope fallback шлях `run_wasm_concern_fix`, що `js/check` (жодна
// діагностика цього концерну не несе `file`), тож пряме тестування гостя
// цю гілку НЕ доводить (§2.47/§2.49 реєстру) — describe нижче ганяє
// РЕАЛЬНИЙ napi-міст (`runWasmConcern` → `runWasmConcernFix`).
// Зріз 4 контракту v3.1: `js/doc_comments` — секція «Зріз 4» у
// `crates/plugin-lang-js/src/lib.rs`. Детектор лишається еталонним JS-шаром
// (`goldenJs`), фіксер §2.93 знято — очікуваний текст T0 тепер літерал.
const DOC_COMMENTS_CONCERN_KEY = 'js/doc_comments'
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

// ---------------------------------------------------------------------
// Шар еталонів ([`goldenJs`], `wasm-parity-golden.mjs`): JS-детектори
// `plugins/lang-js/rules/**/main.mjs` — транзитивний канон, який видаляється
// разом із портом. Поки він був живий, кожен `run*Both`-хелпер викликав
// `lint()` напряму; тепер звичайний прогін звіряє wasm ЗІ ЗНЯТИМ раніше
// виводом канону (JSON під `GOLDEN_DIR`, `wasm-parity-golden.mjs`), а не з
// живим `main.mjs`, — сила перевірки та сама (той самий JS-вивід), лише без
// дочірнього канону на диску. Перезняти еталони можна, повернувши `main.mjs`
// з історії й прогнавши суїт з `N_WASM_PARITY_CAPTURE=1` (той самий прийом,
// що `N_K8S_PARITY_CAPTURE` у `crates/rules-core/tests/common/mod.rs`). Сам
// механізм (кеш, лічильники, плейсхолдер tmp-шляху, помилка відсутнього
// еталона) винесений у `wasm-parity-golden.mjs` — спільний для цього гейта і
// `wasm-plugin-parity-python.test.mjs`; тут лишається лише `goldenJs`,
// звʼязаний із ЦИМ файлом як підказкою команди перезняття.
const goldenJs = createGoldenJs({
  captureHintPath: 'npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs'
})
// ---------------------------------------------------------------------

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
 * Шлях до `main.mjs` канону концерну — обчислюється за конвенцією
 * `plugins/lang-js/rules/<ruleId>/<concernId>/main.mjs`, а НЕ зберігається
 * іменованою константою: після видалення JS-детекторів ця функція
 * викликається лише всередині `compute()` [`goldenJs`] — тобто тільки в
 * режимі зняття (`N_WASM_PARITY_CAPTURE=1`, коли канон іще на диску).
 * Звичайний прогін цю гілку не виконує взагалі.
 * @param {string} ruleId `ctx.ruleId` (він же перший сегмент шляху)
 * @param {string} concernId `ctx.concernId` (він же другий сегмент шляху)
 * @returns {string} абсолютний шлях до `main.mjs`
 */
function mainMjsPathFor(ruleId, concernId) {
  return join(REPO_ROOT, 'plugins', 'lang-js', 'rules', ruleId, concernId, 'main.mjs')
}

/**
 * Ганяє одну `.vue`-фікстуру `vue/tfm-translations` через JS-детектор
 * (канон, лише в режимі зняття — [`goldenJs`]) і `runWasmConcern` (wasm,
 * per-file dispatch), повертаючи обидва `violations`-масиви (після
 * [`withDefaultSeverity`]) для звірки.
 * @param {string} dir абсолютний шлях tmp-каталогу (містить `fileName`)
 * @param {string} fileName ім'я файлу у `dir`
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runTfmBoth(dir, fileName) {
  const js = await goldenJs(TFM_CONCERN_KEY, dir, async () => {
    // file:// URL — інакше відносний шлях трактується як bare package specifier (той самий
    // мотив, що в detect.mjs runConcernDetector); шлях зібраний із REPO_ROOT + константних
    // сегментів (не вхід ззовні). Виконується ЛИШЕ в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(mainMjsPathFor('vue', 'tfm-translations')).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'vue', concernId: 'tfm-translations', files: [fileName] })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, TFM_CONCERN_KEY, dir, [fileName])
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє один full-scope концерн через JS-детектор (канон, ігнорує
 * `ctx.files`, сам ходить `walkDir`/`collectTestFiles` за `cwd` — лише в
 * режимі зняття, [`goldenJs`]) і `runWasmConcern` з `files: null`
 * (full-scope міст, доккомент модуля) — обидва бачать УСЕ дерево `dir`,
 * не підмножину. Спільний хелпер для `style/gap` і всіх пʼяти full-scope
 * концернів задачі Q1 (доккомент модуля).
 * @param {string} concernKey `ruleId/concernId` (bucket еталона й вхід у `runWasmConcern`)
 * @param {string} ruleId `ctx.ruleId` для JS-виклику
 * @param {string} concernId `ctx.concernId` для JS-виклику
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runFullScopeBoth(concernKey, ruleId, concernId, dir) {
  const js = await goldenJs(concernKey, dir, async () => {
    // file:// URL — абсолютний шлях (той самий мотив, що [`runTfmBoth`]).
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(mainMjsPathFor(ruleId, concernId)).href)
    const jsResult = await lint({ cwd: dir, ruleId, concernId, files: undefined })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, concernKey, dir, null)
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Стеля розігріву napi-мосту ([`beforeAll`] нижче).
 *
 * Перший виклик `runWasmConcern` у процесі платить одноразову ціну, якої не
 * платить жоден наступний: `dlopen` napi-аддона (для debug-збірки
 * `target/debug/librules_napi.dylib` — відчутно дорожче за release) плюс перша
 * компіляція wasm-компонента `plugin_lang_js.wasm` (~2,4 МБ) рушієм хоста.
 * Заміряно на debug-аддоні: ~12,6 с, і практично весь цей час — саме холодний
 * старт. Дефолтні 5 с Vitest його не покривали, тож БЕЗ розігріву перший
 * `test` файлу стабільно падав із `Test timed out in 5000ms` — «зависання»
 * холодного старту читалося як реальний фейл парності (решта тестів файлу
 * проходила, бо йшла вже теплою).
 *
 * Кореневий `vitest.config.mjs` відтоді підняв `testTimeout` до 20 с, і цього
 * САМОГО ПО СОБІ вистачає, щоб файл був зеленим. Розігрів лишається не як
 * дубль тієї стелі, а тому що запас 12,6 с проти 20 с — 1,6×, тобто заручник
 * машини: повільніший диск чи холодніший кеш повертають падіння, і воно
 * читатиметься як флейк. З розігрівом перший тест триває одиниці мілісекунд,
 * а 20-секундна стеля лишається стелею для ШТАТНОГО тесту — тобто далі ловить
 * справжні зависання, замість того щоб бути розтягнутою під разовий старт.
 *
 * 120 с — із запасом над заміряним: гейт має ловити мертвий міст, а не
 * повільну машину. Те саме число й той самий мотив, що в
 * [`CONFTEST_SPAWN_TIMEOUT_MS`] нижче (холодний перший спавн `conftest`) —
 * різниця лише в тому, що там ціну платить кожен тест-спавн, а тут вона
 * одноразова на процес, тож виноситься в hook, а не в стелю тесту.
 */
const NATIVE_WARMUP_TIMEOUT_MS = 120_000

/**
 * Розігріває napi-міст ОДИН раз на файл: `loadNative()` + один справжній
 * `runWasmConcern` (той самий wasm-компонент обслуговує ВСІ концерни файлу,
 * тож одна компіляція покриває весь суїт).
 *
 * Саме hook, а не піднятий `timeout` цього файлу: вартість холодного старту
 * стає явною й одноразовою, а кожен окремий тест лишається під спільною
 * стелею монорепо.
 */
beforeAll(async () => {
  await withTmpDir(async dir => {
    await writeFile(join(dir, 'Page.vue'), '<template><div /></template>\n<script setup></script>\n')
    loadNative().runWasmConcern(WASM_PATH, TFM_CONCERN_KEY, dir, ['Page.vue'])
  })
}, NATIVE_WARMUP_TIMEOUT_MS)

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
  const runGapBoth = dir => runFullScopeBoth(GAP_CONCERN_KEY, 'style', 'gap', dir)

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
  const runPoolForksBoth = dir => runFullScopeBoth(POOL_FORKS_CONCERN_KEY, 'test', 'vitest-config-pool-forks', dir)

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
  const runNoProcessChdirBoth = dir => runFullScopeBoth(NO_PROCESS_CHDIR_CONCERN_KEY, 'test', 'no-process-chdir', dir)

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
  const runAdminTableBoth = dir => runFullScopeBoth(ADMIN_TABLE_CONCERN_KEY, 'style', 'admin_table', dir)

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
  const runQuasarFixesBoth = dir => runFullScopeBoth(QUASAR_FIXES_CONCERN_KEY, 'style', 'quasar_fixes', dir)

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
  const runLocationBoth = dir => runFullScopeBoth(LOCATION_CONCERN_KEY, 'test', 'location', dir)

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
    runFullScopeBoth(NO_CONSOLE_STORE_RESTORE_CONCERN_KEY, 'test', 'no-console-store-restore', dir)

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
    runFullScopeBoth(NO_BUN_TEST_IMPORT_CONCERN_KEY, 'test', 'no-bun-test-import', dir)

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
  const runUtilsImportsBoth = dir => runFullScopeBoth(UTILS_IMPORTS_CONCERN_KEY, 'js', 'utils_imports', dir)

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
    runFullScopeBoth(NO_RELATIVE_FS_PATH_CONCERN_KEY, 'test', 'no-relative-fs-path', dir)
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

  // symlink: 1-й аргумент — ЦІЛЬ посилання (рядок усередині symlink-а),
  // відносна ціль там легітимна; перевіряється лише 2-й (шлях лінка на
  // диску). Пара кейсів фіксує саме ту мапу, де wasm-порт колись дрейфував
  // від JS-канону (`FS_PATH_ARG_POSITIONS`: symlink → [1], не [0, 1]).
  test('успіх: symlink з відносною ЦІЛЛЮ але абсолютним шляхом лінка → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        "import { symlink } from 'node:fs/promises'\nawait symlink('../real.txt', join(dir, 'link.txt'))\n"
      )
      const { js, wasm } = await runNoRelativeFsPathBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('порушення: symlink з відносним шляхом ЛІНКА (2-й аргумент) → однакове violation з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        "import { symlink } from 'node:fs/promises'\nawait symlink('../real.txt', 'link.txt')\n"
      )
      const { js, wasm } = await runNoRelativeFsPathBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('no-relative-fs-path')
      expect(js[0].message).toContain('symlink')
      expect(js[0].message).toContain('link.txt')
    })
  })
})

describe('wasm-plugin parity — js-bun-redis/imports (JS канон vs wasm plugin-lang-js, full-scope міст, задача Q4 AST-концерн)', () => {
  const runRedisImportsBoth = dir => runFullScopeBoth(REDIS_IMPORTS_CONCERN_KEY, 'js-bun-redis', 'imports', dir)

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
  const runMssqlDepsBoth = dir => runFullScopeBoth(MSSQL_DEPS_CONCERN_KEY, 'js-mssql', 'deps', dir)

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
  const runBunDbSafetyBoth = dir => runFullScopeBoth(BUN_DB_SAFETY_CONCERN_KEY, 'js-bun-db', 'safety', dir)

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
  const runScopeBoth = dir => runFullScopeBoth(STORYBOOK_SCOPE_CONCERN_KEY, 'test', 'storybook-scope', dir)

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
  const runHygieneBoth = dir => runFullScopeBoth(STORYBOOK_HYGIENE_CONCERN_KEY, 'test', 'storybook-hygiene', dir)

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
    runFullScopeBoth(STORYBOOK_PAGE_COVERAGE_CONCERN_KEY, 'test', 'storybook-page-coverage', dir)

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
  const runScaffoldBoth = dir => runFullScopeBoth(STORYBOOK_SCAFFOLD_CONCERN_KEY, 'test', 'storybook-scaffold', dir)

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
  const runCiBoth = dir => runFullScopeBoth(STORYBOOK_CI_CONCERN_KEY, 'test', 'storybook-ci', dir)

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
    runFullScopeBoth(STORYBOOK_VITEST_CONFIG_CONCERN_KEY, 'test', 'storybook-vitest-config', dir)

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
  const runRuleMetaBoth = dir => runFullScopeBoth(RULE_META_CONCERN_KEY, 'npm-module', 'rule_meta', dir)

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
  const runSkillMetaBoth = dir => runFullScopeBoth(SKILL_META_CONCERN_KEY, 'npm-module', 'skill_meta', dir)

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
    runFullScopeBoth(HEADER_DOC_POINTER_CONCERN_KEY, 'npm-module', 'header_doc_pointer', dir)

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
    runFullScopeBoth(PACKAGE_STRUCTURE_CONCERN_KEY, 'npm-module', 'package_structure', dir)

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
  const runDepPolicyBoth = dir => runFullScopeBoth(DEP_POLICY_CONCERN_KEY, 'js', 'dep-policy', dir)

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
  const runBunLayoutBoth = dir => runFullScopeBoth(BUN_LAYOUT_CONCERN_KEY, 'bun', 'layout', dir)

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

// `bun/layout` — T0-цикл через РЕАЛЬНИЙ napi-міст (§2.47/§2.49
// open-questions-register: пряме звернення до гостя ховає баги моста, доказ
// парності фіксера — round-trip САМЕ через `loadNative().runWasmConcernFix`,
// а не `patterns[0].apply(...)` з видаленого `fix-layout.mjs` напряму).
// `bun/layout` — WHOLE-BATCH (жодна діагностика не несе `file`,
// [`detect_bun_layout`] у `crates/plugin-lang-js/src/lib.rs`), тож цикл
// проходить крізь ТОЙ САМИЙ full-scope fallback `run_wasm_concern_fix`
// (`ConcernScope::Full`), що вже ловив #513 для `js/check` — тут це не
// fallback, а штатна гілка (`scope = "full"`, `plugin.toml`).
//
// Едити застосовуються через [`applyPlanEdit`] (`run-fix.mjs`) — той самий
// код, що реально пише на диск у продакшн fix-прогоні (`wasmFixPattern` →
// `applyPlanEdit`), НЕ ручний `fs.rm`/`fs.writeFile` тесту: `bun-yarn-dir-remove`
// — перший у цьому крейті РЕАЛЬНИЙ `FileEdit::Delete` на КАТАЛОГ, і саме
// `applyPlanEdit` (не сам гість) нещодавно полагодили з `unlink` на
// `fs.rm(recursive: true)` (PR #520) — цей тест доводить, що видалення
// каталогу реально доїжджає до диска крізь весь ланцюжок
// napi-план → `applyPlanEdit`, а не лише правильно ФОРМУЄТЬСЯ в плані.
describe('wasm-plugin parity — bun/layout T0-фікс через fix-міст (детект гостем → runWasmConcernFix → applyPlanEdit → детект гостем чистий)', () => {
  /** ctx для `applyPlanEdit` — `recordWrite` не потрібен поза T0-rollback контуром. */
  const fixCtx = dir => ({ cwd: dir, ruleId: 'bun', concernId: 'layout' })

  test('порожній корінь: bunfig.toml — guest-план створює канонічний вміст, повторний детект гостем мовчить про bunfig', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bun.lock', '')
      await writeFileDeep(dir, 'package.json', '{}\n')

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, null).violations
      )
      expect(before.map(v => v.message)).toEqual([
        'Відсутній bunfig.toml — створи з [install] linker = "hoisted" (bun.mdc)'
      ])

      const plan = loadNative().runWasmConcernFix(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, before, {})
      expect(plan.edits).toEqual([{ type: 'write', path: 'bunfig.toml', content: '[install]\nlinker = "hoisted"\n' }])
      for (const edit of plan.edits) await applyPlanEdit(edit, dir, fixCtx(dir))

      expect(await readFile(join(dir, 'bunfig.toml'), 'utf8')).toBe('[install]\nlinker = "hoisted"\n')
      const again = loadNative().runWasmConcern(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, null)
      expect(again.violations.some(v => v.message.startsWith('Відсутній bunfig.toml'))).toBe(false)
    })
  })

  test('заборонені файли: guest-план видаляє package-lock.json і yarn.lock через applyPlanEdit, повторний детект мовчить про них', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bun.lock', '')
      await writeFileDeep(dir, 'bunfig.toml', '[install]\nlinker = "hoisted"\n')
      await writeFileDeep(dir, 'package.json', '{}\n')
      await writeFileDeep(dir, 'package-lock.json', '{}\n')
      await writeFileDeep(dir, 'yarn.lock', '# yarn\n')

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, null).violations
      )
      expect(before.map(v => v.message)).toEqual([
        'Знайдено заборонений файл: package-lock.json — видали його',
        'Знайдено заборонений файл: yarn.lock — видали його'
      ])

      const plan = loadNative().runWasmConcernFix(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, before, {})
      expect(plan.edits).toEqual([
        { type: 'delete', path: 'package-lock.json' },
        { type: 'delete', path: 'yarn.lock' }
      ])
      for (const edit of plan.edits) await applyPlanEdit(edit, dir, fixCtx(dir))

      expect(existsSync(join(dir, 'package-lock.json'))).toBe(false)
      expect(existsSync(join(dir, 'yarn.lock'))).toBe(false)
      const again = loadNative().runWasmConcern(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, null)
      expect(again.violations).toEqual([])
    })
  })

  test('.yarn/ із вкладеним вмістом: guest-план дає ОДИН delete-edit на каталог, applyPlanEdit реально прибирає його з диска (доводить #520 крізь весь ланцюжок)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bun.lock', '')
      await writeFileDeep(dir, 'bunfig.toml', '[install]\nlinker = "hoisted"\n')
      await writeFileDeep(dir, 'package.json', '{}\n')
      await writeFileDeep(dir, '.yarn/releases/yarn-4.0.0.cjs', '// yarn\n')
      await writeFileDeep(dir, '.yarn/install-state.gz', 'binary')

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, null).violations
      )
      expect(before.map(v => v.message)).toEqual(['Знайдено директорію .yarn — видали її'])

      const plan = loadNative().runWasmConcernFix(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, before, {})
      expect(plan.edits).toEqual([{ type: 'delete', path: '.yarn' }])
      for (const edit of plan.edits) await applyPlanEdit(edit, dir, fixCtx(dir))

      // Ключове твердження задачі: КАТАЛОГ (з вкладеним вмістом) реально
      // зник із диска через РЕАЛЬНИЙ виклик `applyPlanEdit`, не лише через
      // формально коректний `FileEdit::Delete` у плані.
      expect(existsSync(join(dir, '.yarn'))).toBe(false)
      const again = loadNative().runWasmConcern(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, null)
      expect(again.violations).toEqual([])
    })
  })

  test('.yarn відсутній на диску: guest-план порожній, applyPlanEdit не викликається взагалі', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bun.lock', '')
      await writeFileDeep(dir, 'bunfig.toml', '[install]\nlinker = "hoisted"\n')
      await writeFileDeep(dir, 'package.json', '{}\n')

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, null).violations
      )
      expect(before).toEqual([])

      const plan = loadNative().runWasmConcernFix(WASM_PATH, BUN_LAYOUT_CONCERN_KEY, dir, before, {})
      expect(plan.edits).toEqual([])
    })
  })
})

describe('wasm-plugin parity — style/tooling (JS канон vs wasm plugin-lang-js, full-scope міст)', () => {
  const runStyleToolingBoth = dir => runFullScopeBoth(STYLE_TOOLING_CONCERN_KEY, 'style', 'tooling', dir)

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
  const runSandboxBoth = dir => runFullScopeBoth(SANDBOX_AWARE_TEST_CONCERN_KEY, 'test', 'sandbox-aware-test', dir)

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
    runFullScopeBoth(VITEST_API_CONVENTIONS_CONCERN_KEY, 'test', 'vitest-api-conventions', dir)

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
  const runVuePackagesBoth = dir => runFullScopeBoth(VUE_PACKAGES_CONCERN_KEY, 'vue', 'packages', dir)

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

describe('wasm-plugin parity — test/stryker_config (JS канон vs wasm plugin-lang-js, зріз 1 контракту v3.1)', () => {
  const runStrykerBoth = dir => runFullScopeBoth(STRYKER_CONFIG_CONCERN_KEY, 'test', 'stryker_config', dir)

  /**
   * `.n-rules.json` з увімкненим правилом `js` — без нього концерн мовчить (self-gate).
   * @param {string} dir tmp-корінь репо тесту.
   * @returns {Promise<void>} завершення запису.
   */
  const writeJsEnabled = dir => writeFileDeep(dir, '.n-rules.json', JSON.stringify({ rules: ['js', 'test'] }))

  test('self-gate: без `.n-rules.json` обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('self-gate: `js` у `disable-rules` — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, '.n-rules.json', JSON.stringify({ rules: ['js'], 'disable-rules': ['js'] }))
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('fatal: js увімкнено, але кореневого package.json немає', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('stryker_config')
      expect(js[0].message).toBe('test: js enabled, але кореневий package.json не знайдено (test.mdc)')
    })
  })

  test('порожній single-package репо: stryker + vitest baseline + .gitignore', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(3)
      expect(js.map(v => v.reason)).toEqual(['stryker-config-missing', 'stryker-config-missing', 'gitignore-missing'])
      expect(js.map(v => v.file)).toEqual(['stryker.config.mjs', 'vitest.config.mjs', undefined])
    })
  })

  test('legacy `vitest.config.js` не плодить `.mjs`-порушення', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'vitest.config.js', 'export default {}\n')
      await writeFileDeep(dir, '.gitignore', '**/reports/stryker/\n**/coverage/\n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].file).toBe('stryker.config.mjs')
    })
  })

  test('vue-root: додається baseline vue-macros ignorer-плагіна', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'src/App.vue', '<template><div /></template>\n')
      await writeFileDeep(dir, '.gitignore', '**/reports/stryker/\n**/coverage/\n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.file)).toEqual(['stryker.config.mjs', 'stryker-vue-macros-ignorer.mjs', 'vitest.config.mjs'])
    })
  })

  test('`.vue` лише під `src/dist/` — не vue-root в обох реалізаціях (VUE_GLOB_IGNORE)', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'src/dist/App.vue', '<template><div /></template>\n')
      await writeFileDeep(dir, '.gitignore', '**/reports/stryker/\n**/coverage/\n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      // Немає дії `stryker-vue-macros-ignorer.mjs` — саме це відрізняє
      // vue-root від звичайного.
      expect(js.map(v => v.file)).toEqual(['stryker.config.mjs', 'vitest.config.mjs'])
    })
  })

  test('vue-root із наявним stryker-конфігом без ignorer-а: augment-порушення', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'src/App.vue', '<template><div /></template>\n')
      await writeFileDeep(dir, 'stryker.config.mjs', "export default {\n  testRunner: 'vitest'\n}\n")
      await writeFileDeep(dir, 'vitest.config.mjs', 'export default {}\n')
      await writeFileDeep(dir, '.gitignore', '**/reports/stryker/\n**/coverage/\n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      // Порядок фіксований `lint()`: спершу ВСІ baseline-дії, потім augment-и.
      expect(js).toHaveLength(2)
      expect(js[0].reason).toBe('stryker-config-missing')
      expect(js[0].file).toBe('stryker-vue-macros-ignorer.mjs')
      expect(js[1].reason).toBe('stryker-vue-augment')
      expect(js[1].file).toBe('stryker.config.mjs')
    })
  })

  test('vue-root із повністю зареєстрованим ignorer-ом: augment — no-op', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'src/App.vue', '<template><div /></template>\n')
      await writeFileDeep(
        dir,
        'stryker.config.mjs',
        'export default {\n' +
          "  plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs'],\n" +
          "  ignorers: ['vue-macros']\n" +
          '}\n'
      )
      await writeFileDeep(dir, 'stryker-vue-macros-ignorer.mjs', 'export const strykerPlugins = []\n')
      await writeFileDeep(dir, 'vitest.config.mjs', 'export default {}\n')
      await writeFileDeep(dir, '.gitignore', '**/reports/stryker/\n**/coverage/\n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('augment неможливий: non-literal default export', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'src/App.vue', '<template><div /></template>\n')
      await writeFileDeep(dir, 'stryker.config.mjs', 'export default defineConfig({ plugins: [] })\n')
      await writeFileDeep(dir, 'stryker-vue-macros-ignorer.mjs', 'export const strykerPlugins = []\n')
      await writeFileDeep(dir, 'vitest.config.mjs', 'export default {}\n')
      await writeFileDeep(dir, '.gitignore', '**/reports/stryker/\n**/coverage/\n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('stryker-vue-augment-fail')
      expect(js[0].message).toContain('non-literal default export')
    })
  })

  test('augment неможливий: динамічний `plugins` (spread)', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'src/App.vue', '<template><div /></template>\n')
      await writeFileDeep(dir, 'stryker.config.mjs', 'const base = []\nexport default {\n  plugins: [...base]\n}\n')
      await writeFileDeep(dir, 'stryker-vue-macros-ignorer.mjs', 'export const strykerPlugins = []\n')
      await writeFileDeep(dir, 'vitest.config.mjs', 'export default {}\n')
      await writeFileDeep(dir, '.gitignore', '**/reports/stryker/\n**/coverage/\n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('stryker-vue-augment-fail')
      expect(js[0].message).toContain('динамічний вираз (spread/computed)')
    })
  })

  // Ця фікстура тримає живим твердження «повідомлення парсера в обох
  // реалізаціях однакове»: JS-бік — napi `oxc-parser`, guest — crate
  // `oxc_parser`, обидва пін 0.137.0 (`oxc-version-pin.test.mjs`). Розійдуться
  // піни — розійдеться текст, і саме цей тест це побачить.
  test('augment неможливий: syntax error — текст повідомлення парсера збігається побайтово', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'src/App.vue', '<template><div /></template>\n')
      await writeFileDeep(dir, 'stryker.config.mjs', 'export default {\n  plugins: [\n}\n')
      await writeFileDeep(dir, 'stryker-vue-macros-ignorer.mjs', 'export const strykerPlugins = []\n')
      await writeFileDeep(dir, 'vitest.config.mjs', 'export default {}\n')
      await writeFileDeep(dir, '.gitignore', '**/reports/stryker/\n**/coverage/\n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('stryker-vue-augment-fail')
      expect(js[0].message).toContain('має syntax error')
    })
  })

  test('монорепо: workspaces-глоб розгортається в кілька js-roots', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }))
      await writeFileDeep(dir, 'packages/app/package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'packages/ui/package.json', JSON.stringify({ name: 'ui' }))
      await writeFileDeep(dir, '.gitignore', '**/reports/stryker/\n**/coverage/\n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.file)).toEqual([
        'packages/app/stryker.config.mjs',
        'packages/app/vitest.config.mjs',
        'packages/ui/stryker.config.mjs',
        'packages/ui/vitest.config.mjs'
      ])
    })
  })

  test('`.gitignore` містить лише частину патернів — у тексті лишається лише відсутній', async () => {
    await withTmpDir(async dir => {
      await writeJsEnabled(dir)
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, 'stryker.config.mjs', "export default { testRunner: 'vitest' }\n")
      await writeFileDeep(dir, 'vitest.config.mjs', 'export default {}\n')
      await writeFileDeep(dir, '.gitignore', '  **/coverage/  \n')
      const { js, wasm } = await runStrykerBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('gitignore-missing')
      expect(js[0].message).toBe(
        '.gitignore: бракує тест-патернів (**/reports/stryker/) — запусти `npx @7n/rules lint test` (test.mdc)'
      )
    })
  })
})

/**
 * Вміст `eslint.config.js`, що проходить усі три текстові перевірки.
 * @param {string} args аргументи виклику `getConfig(...)`.
 * @returns {string} вміст файла конфігу.
 */
const eslintConfigWith = args =>
  `import { getConfig } from '@nitra/eslint-config'\n\nexport default [\n  {\n    ignores: ['**/auto-imports.d.ts']\n  },\n  ...getConfig(${args})\n]\n`

/**
 * Канон oxlint із пакета — той самий файл, що вшито в компонент. Модульна
 * область видимості (не всередині одного `describe`) — і детект-, і
 * fix-parity блоки `js/check` його читають.
 * @returns {Promise<string>} вміст `oxlint-canonical.json`.
 */
const readOxlintCanonical = async () => {
  const { readFile } = await import('node:fs/promises')
  return readFile(
    join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'js', 'tooling', 'data', 'tooling', 'oxlint-canonical.json'),
    'utf8'
  )
}

/**
 * Канон knip із пакета — той самий файл, що гість вшиває
 * `KNIP_CANONICAL_JSON` (`include_str!`). §2.93: раніше «очікуваним»
 * вмістом для fix-тестів був вивід знятого `fix-check.mjs`, який цей файл
 * копіював; тепер очікуване читається з ДЖЕРЕЛА напряму.
 * @returns {Promise<string>} вміст `knip-canonical.json`.
 */
const readKnipCanonical = async () => {
  const { readFile } = await import('node:fs/promises')
  return readFile(
    join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'js', 'tooling', 'data', 'tooling', 'knip-canonical.json'),
    'utf8'
  )
}

describe('wasm-plugin parity — js/check (JS канон vs wasm plugin-lang-js, зріз 2 контракту v3.1)', () => {
  const runJsCheckBoth = dir => runFullScopeBoth(JS_CHECK_CONCERN_KEY, 'js', 'check', dir)

  test('порожній репо — три порушення в тому самому порядку', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.reason)).toEqual(['eslint-config-missing', 'oxlintrc-missing', 'knip-missing'])
    })
  })

  // Зафіксована ЗМІНА ПОВЕДІНКИ (рішення Ґ спеки v3.1): раніше JS-канон тут
  // тихо створював `knip.json` і не звітував нічого. Тепер обидві реалізації
  // звітують порушення, і дерево лишається недоторканим.
  test('відсутній knip.json — порушення `knip-missing`, дерево не мутоване жодною реалізацією', async () => {
    await withTmpDir(async dir => {
      const { existsSync } = await import('node:fs')
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('knip-missing')
      expect(js[0].message).toBe('knip.json відсутній — T0 створить його з канону пакета @7n/rules (js.mdc)')
      expect(existsSync(join(dir, 'knip.json'))).toBe(false)
    })
  })

  test('канонічний `.oxlintrc.json` — жодного drift-порушення в обох реалізаціях', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('`.oxlintrc.json` із вирізаним правилом — текст drift-повідомлення збігається побайтово', async () => {
    await withTmpDir(async dir => {
      const canonical = JSON.parse(await readOxlintCanonical())
      delete canonical.rules.eqeqeq
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', JSON.stringify(canonical, null, 2))
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('oxlintrc-drift')
      expect(js[0].message).toBe(
        '.oxlintrc.json: rules["eqeqeq"] очікується ["deny","always",{"null":"ignore"}], зараз undefined'
      )
    })
  })

  test('`.oxlintrc.json` із вилученими jsPlugins/ignorePatterns — порядок повідомлень за порядком ключів канону', async () => {
    await withTmpDir(async dir => {
      const canonical = JSON.parse(await readOxlintCanonical())
      canonical.jsPlugins = []
      canonical.ignorePatterns = []
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', JSON.stringify(canonical, null, 2))
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      // jsPlugins стоїть у каноні ПЕРЕД ignorePatterns — і саме такий порядок
      // мають обидві реалізації (алфавітний дав би зворотний).
      expect(js).toHaveLength(2)
      expect(js[0].message).toContain('jsPlugins має містити канонічні plugins')
      expect(js[1].message).toContain('ignorePatterns має містити канонічні патерни')
    })
  })

  test('невалідний `.oxlintrc.json` — однакове повідомлення й жодного drift-у', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', '{ not json')
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe('.oxlintrc.json не є валідним JSON')
    })
  })

  test('eslint.config без getConfig/@nitra/ignores — три текстові порушення в порядку канону', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.mjs', 'export default []\n')
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual([
        'eslint.config.mjs: потрібен виклик getConfig (js.mdc)',
        'eslint.config.mjs: імпортуй getConfig з @nitra/eslint-config',
        'eslint.config.mjs: додай у ignores запис **/auto-imports.d.ts (js.mdc)'
      ])
    })
  })

  test('vue-воркспейс (за залежністю) поза `vue: [...]` — однакове порушення', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['app'] }"))
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', type: 'module', workspaces: ['app'] }))
      await writeFileDeep(
        dir,
        'app/package.json',
        JSON.stringify({
          name: 'app',
          type: 'module',
          engines: { node: '>=24', bun: '>=1.4' },
          dependencies: { vue: '^3.6.0' }
        })
      )
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('eslint-config-vue-workspace')
      expect(js[0].message).toContain("воркспейс 'app' містить Vue-код")
    })
  })

  test('vue-воркспейс (за `.vue`-файлом, glob-патерн workspaces) — однакове порушення', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['packages/ui'] }"))
      await writeFileDeep(
        dir,
        'package.json',
        JSON.stringify({ name: 'root', type: 'module', workspaces: ['packages/*'] })
      )
      await writeFileDeep(
        dir,
        'packages/ui/package.json',
        JSON.stringify({ name: 'ui', type: 'module', engines: { node: '>=24', bun: '>=1.4' } })
      )
      await writeFileDeep(dir, 'packages/ui/src/Widget.vue', '<template><div /></template>\n')
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('eslint-config-vue-workspace')
      expect(js[0].message).toContain("воркспейс 'packages/ui' містить Vue-код")
    })
  })

  test('`.vue` під `dist/` не робить воркспейс vue-воркспейсом (ignore globby)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['app'] }"))
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', type: 'module', workspaces: ['app'] }))
      await writeFileDeep(
        dir,
        'app/package.json',
        JSON.stringify({ name: 'app', type: 'module', engines: { node: '>=24', bun: '>=1.4' } })
      )
      await writeFileDeep(dir, 'app/dist/Bundled.vue', '<template><div /></template>\n')
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('workspace-`package.json` без type/engines — три порушення в порядку канону', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['app'] }"))
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', type: 'module', workspaces: ['app'] }))
      await writeFileDeep(dir, 'app/package.json', JSON.stringify({ name: 'app' }))
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual([
        'app/package.json: має містити "type": "module" (js.mdc)',
        'app/package.json не містить engines.node — додай: "engines": { "node": ">=24" }',
        'app/package.json не містить engines.bun — додай: "engines": { "bun": ">=1.4" }'
      ])
    })
  })

  test('engines нижче порогів — однаковий текст порогових повідомлень', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['app'] }"))
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', type: 'module', workspaces: ['app'] }))
      await writeFileDeep(
        dir,
        'app/package.json',
        JSON.stringify({ name: 'app', type: 'module', engines: { node: '>=22.1', bun: '^1.2.9' } })
      )
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual([
        'app/package.json: engines.node ">=22.1" — має бути >=24',
        'app/package.json: engines.bun "^1.2.9" — має бути >=1.4'
      ])
    })
  })

  test('`lint.yml` дублює кроки lint-js.yml — однакове порушення', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      await writeFileDeep(
        dir,
        '.github/workflows/lint.yml',
        'jobs:\n  a:\n    steps:\n      - run: bunx oxlint\n      - run: bunx eslint\n      - run: jscpd\n'
      )
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe(
        '.github/workflows/lint.yml дублює кроки lint-js.yml — залиш один workflow на лінт JS (js.mdc)'
      )
    })
  })

  test('застарілі конфіги ESLint — по одному порушенню на кожен, у фіксованому порядку', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      await writeFileDeep(dir, '.eslintrc', '{}\n')
      await writeFileDeep(dir, '.eslintrc.yml', 'root: true\n')
      const { js, wasm } = await runJsCheckBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.map(v => v.message)).toEqual([
        'Знайдено застарілий конфіг ESLint: .eslintrc — видали, використовуй flat config',
        'Знайдено застарілий конфіг ESLint: .eslintrc.yml — видали, використовуй flat config'
      ])
    })
  })
})

// Зріз 2 контракту v3.1: `js/check` — T0-фіксер. §2.93 зняла JS-канон
// (`fix-check.mjs` + `eslint-config.mjs`), тож набір нижче ПЕРЕПИСАНО зі
// «звірки двох реалізацій» на «гість = ОЧІКУВАНИЙ результат» (крок 4
// зразка §2.88): `expect(wasm).toEqual(js)` більше немає, а кожне
// твердження про вміст, яке раніше висіло на JS-знімку, тепер висить на
// плані гостя. Жодного твердження при цьому не зникло — вони лише
// перестали бути транзитивними через канон.
describe('wasm-plugin — js/check T0-фікс (гість plugin-lang-js — ЄДИНИЙ виконавець, §2.93)', () => {
  const JS_CHECK_TARGET_PATHS = ['eslint.config.js', 'eslint.config.mjs', '.oxlintrc.json', 'knip.json']

  /**
   * Знімок вмісту трьох можливих цільових файлів `js/check` — `null` для
   * відсутнього.
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @returns {Promise<Record<string, string|null>>} шлях → вміст (або `null`)
   */
  async function snapshotJsCheckTargets(dir) {
    const { readFile: read } = await import('node:fs/promises')
    const out = {}
    for (const rel of JS_CHECK_TARGET_PATHS) {
      try {
        out[rel] = await read(join(dir, rel), 'utf8')
      } catch {
        out[rel] = null
      }
    }
    return out
  }

  /**
   * T0-фікс `js/check` гостем: violations беруться напряму з
   * `runWasmConcern` (JS-детектора для `js/check` вже немає), подаються в
   * `runWasmConcernFix`, і план накладається на знімок «до». Повертає
   * фінальний вміст усіх чотирьох можливих цільових шляхів.
   * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
   * @returns {Promise<{ wasm: Record<string, string|null>, violations: unknown[] }>}
   *   фінальний знімок і violations, якими фікс живився
   */
  async function runJsCheckFix(dir) {
    const before = await snapshotJsCheckTargets(dir)
    const violations = withDefaultSeverity(
      loadNative().runWasmConcern(WASM_PATH, JS_CHECK_CONCERN_KEY, dir, null).violations
    )

    const plan = loadNative().runWasmConcernFix(WASM_PATH, JS_CHECK_CONCERN_KEY, dir, violations, {})
    const wasmAfter = { ...before }
    for (const edit of plan.edits) {
      if (edit.type === 'write' && JS_CHECK_TARGET_PATHS.includes(edit.path)) {
        wasmAfter[edit.path] = edit.content
      }
    }

    return { wasm: wasmAfter, violations }
  }

  test('порожній репо — T0 створює eslint.config.js, .oxlintrc.json і knip.json', async () => {
    await withTmpDir(async dir => {
      const { wasm, violations } = await runJsCheckFix(dir)
      expect(violations.map(v => v.reason)).toEqual(['eslint-config-missing', 'oxlintrc-missing', 'knip-missing'])
      expect(wasm['eslint.config.js']).toContain("import { getConfig } from '@nitra/eslint-config'")
      expect(wasm['.oxlintrc.json']).not.toBeNull()
      expect(wasm['knip.json']).not.toBeNull()
      // Канонічні асети вшито в гостя `include_str!`-ом — фікс мусить дати
      // РІВНО їх, а не «щось непорожнє» (анти-дрейф джерела).
      expect(wasm['knip.json']).toBe(await readKnipCanonical())
      expect(JSON.parse(wasm['.oxlintrc.json']).rules.eqeqeq).toEqual(
        JSON.parse(await readOxlintCanonical()).rules.eqeqeq
      )
    })
  })

  test('`.oxlintrc.json` із вирізаним правилом — T0-merge доповнює правило й зберігає зайве', async () => {
    await withTmpDir(async dir => {
      const canonical = JSON.parse(await readOxlintCanonical())
      delete canonical.rules.eqeqeq
      canonical.rules['project-specific/no-foo'] = 'error'
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', JSON.stringify(canonical, null, 2))
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { wasm, violations } = await runJsCheckFix(dir)
      expect(violations.some(v => v.reason === 'oxlintrc-drift')).toBe(true)
      const merged = JSON.parse(wasm['.oxlintrc.json'])
      expect(merged.rules.eqeqeq).toEqual(['deny', 'always', { null: 'ignore' }])
      expect(merged.rules['project-specific/no-foo']).toBe('error')
      // Merge — точковий: сусідні цілі не рухаються.
      expect(wasm['eslint.config.js']).toBe(eslintConfigWith("{ node: ['.'] }"))
      expect(wasm['knip.json']).toBe('{}\n')
    })
  })

  test('канонічний `.oxlintrc.json` — T0-merge не рухає жоден інший файл (drift нема)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { wasm, violations } = await runJsCheckFix(dir)
      expect(violations).toEqual([])
      expect(wasm['eslint.config.js']).toBe(eslintConfigWith("{ node: ['.'] }"))
      expect(wasm['.oxlintrc.json']).toBe(await readOxlintCanonical())
      expect(wasm['knip.json']).toBe('{}\n')
    })
  })

  test('vue-воркспейс поза `vue: [...]` — T0 хірургічно дописує запис, кастомний коментар лишається', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'eslint.config.js',
        "// custom header\nimport { getConfig } from '@nitra/eslint-config'\nexport default [\n  { ignores: ['**/auto-imports.d.ts'] },\n  ...getConfig({\n    node: ['app']\n  })\n]\n"
      )
      await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', type: 'module', workspaces: ['app'] }))
      await writeFileDeep(
        dir,
        'app/package.json',
        JSON.stringify({
          name: 'app',
          type: 'module',
          engines: { node: '>=24', bun: '>=1.4' },
          dependencies: { vue: '^3.6.0' }
        })
      )
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{}\n')
      const { wasm, violations } = await runJsCheckFix(dir)
      expect(violations.some(v => v.reason === 'eslint-config-vue-workspace')).toBe(true)
      expect(wasm['eslint.config.js']).toContain('// custom header')
      expect(wasm['eslint.config.js']).toContain("vue: ['app']")
      expect(wasm['eslint.config.js']).not.toContain("node: ['app']")
    })
  })

  test('`knip.json` уже присутній — T0 не перезаписує чужий вміст', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'eslint.config.js', eslintConfigWith("{ node: ['.'] }"))
      await writeFileDeep(dir, '.oxlintrc.json', await readOxlintCanonical())
      await writeFileDeep(dir, 'knip.json', '{"custom":true}\n')
      const { wasm, violations } = await runJsCheckFix(dir)
      expect(violations).toEqual([])
      expect(wasm['knip.json']).toBe('{"custom":true}\n')
    })
  })
})

// Зріз 4 контракту v3.1: `js/doc_comments` — ЄДИНИЙ (крім
// `vue/tfm-translations`) per-file концерн у контрибуції, і єдиний, чиї
// офсети витікають у `violation.data`. Саме тому набір нижче має ДВА рівні:
// parity детекту ([`runDocCommentsBoth`]) і parity T0-фікса
// ([`runDocCommentsFixBoth`]) — з обовʼязковими не-ASCII фікстурами, на яких
// байтовий і UTF-16 офсети розходяться (секція «Зріз 4» у
// `crates/plugin-lang-js/src/lib.rs`).
describe('wasm-plugin parity — js/doc_comments (JS канон vs wasm plugin-lang-js, per-file)', () => {
  /**
   * Живий виклик JS-канону `js/doc_comments` для заданого файлу — спільний
   * для [`runDocCommentsBoth`] (детект) і [`runDocCommentsFixBoth`] (T0-фікс,
   * бере ТІ САМІ violations як вхід фіксера). Виконується лише всередині
   * `compute()` [`goldenJs`] — тобто тільки в режимі зняття еталонів.
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {string} fileName posix-relative ім'я файлу у `dir`
   * @returns {Promise<unknown[]>} сирі (ненормалізовані) violations
   */
  async function computeDocCommentsViolations(dir, fileName) {
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(mainMjsPathFor('js', 'doc_comments')).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'js', concernId: 'doc_comments', files: [fileName] })
    return jsResult.violations
  }

  /**
   * Ганяє одну фікстуру `js/doc_comments` через JS-детектор (канон, лише в
   * режимі зняття) і `runWasmConcern` (wasm, per-file dispatch) — той самий
   * мотив, що [`runTfmBoth`].
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {string} fileName posix-relative ім'я файлу у `dir`
   * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
   */
  async function runDocCommentsBoth(dir, fileName) {
    const violations = await goldenJs(DOC_COMMENTS_CONCERN_KEY, dir, () => computeDocCommentsViolations(dir, fileName))
    const wasmResult = loadNative().runWasmConcern(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, [fileName])
    return { js: withDefaultSeverity(violations), wasm: withDefaultSeverity(wasmResult.violations) }
  }

  /**
   * T0-фікс гостем: ТІ САМІ violations (з еталона — [`goldenJs`]) подаються
   * у `runWasmConcernFix`, повертається ФІНАЛЬНИЙ вміст файлу. §2.93:
   * раніше сюди ж подавався JS-патерн `fix-doc_comments.mjs` і два тексти
   * порівнювались; канон знято, і очікуваний текст тепер записаний
   * ЛІТЕРАЛОМ у кожному тесті — саме те місце, де забута зворотна
   * конверсія UTF-16 → байти дала б інший текст.
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {string} fileName posix-relative ім'я файлу у `dir`
   * @returns {Promise<{ wasm: string, violations: unknown[] }>} вміст після фіксу
   */
  async function runDocCommentsFix(dir, fileName) {
    const { readFile: read } = await import('node:fs/promises')
    const original = await read(join(dir, fileName), 'utf8')
    const violations = await goldenJs(DOC_COMMENTS_CONCERN_KEY, dir, () => computeDocCommentsViolations(dir, fileName))
    const plan = loadNative().runWasmConcernFix(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, violations, {})
    const write = plan.edits.find(e => e.type === 'write' && e.path === fileName)
    return { wasm: write ? write.content : original, violations }
  }

  test('файл без експортів — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.mjs', 'const x = 1\nconsole.log(x)\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.mjs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('header-JSDoc + JSDoc над експортом — без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'src/a.mjs',
        '/** Огляд модуля. */\n\n/** Робить справу. */\nexport function робити() {}\n'
      )
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.mjs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('немає header-а і немає JSDoc над експортом — обидва порушення однакові', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.mjs', 'export const a = 1\nexport function b() {}\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.mjs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(3)
      expect(js.map(v => v.reason)).toEqual(['missing-file-header', 'missing-export-doc', 'missing-export-doc'])
      expect(js[0].data).toEqual({})
      expect(js[2].data).toEqual({ name: 'b' })
    })
  })

  // ГОЛОВНА фікстура зрізу: кирилиця (2 байти / 1 UTF-16 unit) і емодзі поза
  // BMP (4 байти / 2 UTF-16 units) СТОЯТЬ ПЕРЕД promotable-блоком, тож
  // байтовий офсет crate-парсера і UTF-16-офсет napi-парсера розходяться.
  // Наївний порт (`data.start` у байтах) валить саме цей тест.
  test('не-ASCII перед promotable-блоком — data.{start,end} збігаються (UTF-16, не байти)', async () => {
    await withTmpDir(async dir => {
      const content = "/** Огляд. */\nconst внутрішнє = '😀'\n// опис експорту\nexport function робити() {}\n"
      await writeFileDeep(dir, 'src/файл.mjs', content)
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/файл.mjs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].data.promotable).toBe(true)
      // Самоперевірка фікстури: якби офсети були байтовими, вони б НЕ
      // збіглися з UTF-16-індексом того самого місця в JS-рядку.
      const utf16Start = content.indexOf('// опис')
      const byteStart = Buffer.byteLength(content.slice(0, utf16Start), 'utf8')
      expect(byteStart).not.toBe(utf16Start)
      expect(js[0].data.start).toBe(utf16Start)
      expect(content.slice(js[0].data.start, js[0].data.end)).toBe('// опис експорту')
    })
  })

  test('провідний //-блок на початку файлу — promotable header з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.mjs', '// Огляд модуля 😀\n// другий рядок\nexport const a = 1\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.mjs')
      expect(wasm).toEqual(js)
      expect(js[0].reason).toBe('missing-file-header')
      expect(js[0].data.promotable).toBe(true)
    })
  })

  test('порожній рядок між //-блоком і експортом — порушення НЕ promotable', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.mjs', '/** Огляд. */\n// відірваний коментар\n\nexport const a = 1\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.mjs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].data).toEqual({ name: 'a' })
    })
  })

  test('shebang перед header-JSDoc — обидві реалізації бачать header', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'bin/a.mjs', '#!/usr/bin/env node\n/** Огляд. */\n/** Опис. */\nexport const a = 1\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'bin/a.mjs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('export default / export-специфікатори — однакові імена в data.name', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'src/a.mjs',
        '/** Огляд. */\nconst внутрішнє = 1\nexport { внутрішнє }\nexport default class {}\n'
      )
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.mjs')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].data).toEqual({ name: 'default' })
    })
  })

  test('syntax error — обидві реалізації мовчать (синтаксис ловлять інші концерни)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.mjs', 'export function (\n')
      const { js, wasm } = await runDocCommentsBoth(dir, 'src/a.mjs')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('тест/фікстура/декларація — поза вимогою в обох реалізаціях', async () => {
    await withTmpDir(async dir => {
      for (const rel of ['src/a.test.mjs', 'tests/b.mjs', 'src/fixtures/c.mjs', 'types/d.d.ts']) {
        await writeFileDeep(dir, rel, 'export const a = 1\n')
        const { js, wasm } = await runDocCommentsBoth(dir, rel)
        expect(wasm).toEqual(js)
        expect(js).toEqual([])
      }
    })
  })

  test('T0-фікс: ASCII-блок підвищується до JSDoc', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.mjs', '// Overview of module\n// second line\nexport const a = 1\n')
      const { wasm } = await runDocCommentsFix(dir, 'src/a.mjs')
      expect(wasm).toBe('/**\n * Overview of module\n * second line\n */\nexport const a = 1\n')
    })
  })

  // Дзеркало головної detect-фікстури на боці fix: тут падає забута
  // ЗВОРОТНА конверсія (UTF-16 з `data` → байти для зрізу UTF-8-рядка).
  test('T0-фікс: не-ASCII вміст — БАЙТ-У-БАЙТ очікуваний текст (зворотна конверсія UTF-16 → байти)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'src/файл.mjs',
        "// Огляд файлу 😀\nconst внутрішнє = '😀'\n// опис експорту 😀\nexport function робити() {}\n"
      )
      const { wasm } = await runDocCommentsFix(dir, 'src/файл.mjs')
      expect(wasm).toBe(
        "/** Огляд файлу 😀 */\nconst внутрішнє = '😀'\n/** опис експорту 😀 */\nexport function робити() {}\n"
      )
    })
  })

  test('T0-фікс: кілька блоків в одному файлі — усі підвищені (заміна з кінця)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'src/файл.mjs',
        '// Огляд 😀\nconst х = 1\n// перший експорт\nexport const а = 1\n// другий експорт 😀\nexport const б = 2\n'
      )
      const { wasm } = await runDocCommentsFix(dir, 'src/файл.mjs')
      expect(wasm).toBe(
        '/** Огляд 😀 */\nconst х = 1\n/** перший експорт */\nexport const а = 1\n/** другий експорт 😀 */\nexport const б = 2\n'
      )
    })
  })

  // Guard ідемпотентності (`is_line_comment_block` у гості). §2.93 зняла
  // JS-канон, тож сценарій «несвіжі офсети» більше не про другий патерн
  // `applyT0`, а про ПОВТОРНИЙ виклик самого гостя тими самими
  // (застарілими після першого запису) violations — рівно те, що робить
  // `--fix` на дереві, яке хтось уже полагодив. Без guard-а гість різав би
  // підвищений `/** … */` посередині.
  test('T0-фікс: несвіжі офсети — повторний план гостя ПОРОЖНІЙ, файл недоторканий', async () => {
    await withTmpDir(async dir => {
      const rel = 'src/файл.mjs'
      await writeFileDeep(dir, rel, "// Огляд файлу 😀\nconst внутрішнє = '😀'\n// опис 😀\nexport const а = 1\n")
      const { wasm, violations } = await runDocCommentsFix(dir, rel)

      await writeFile(join(dir, rel), wasm, 'utf8')
      const plan = loadNative().runWasmConcernFix(WASM_PATH, DOC_COMMENTS_CONCERN_KEY, dir, violations, {})
      expect(plan.edits).toEqual([])

      const { readFile: read } = await import('node:fs/promises')
      expect(await read(join(dir, rel), 'utf8')).toBe(wasm)
    })
  })
})

// --- зріз 6 контракту v3.1: style/lint і js/jscpd_duplicates -------------
//
// Обгортки зовнішніх процесів parity-тестуються НЕ так, як решта концернів,
// і причина структурна: канон і порт мали б спавнити РЕАЛЬНІ `stylelint` і
// `bunx jscpd` на реальному дереві — результат залежав би від машини, версії
// тула й мережі, тобто «однакові фікстури через обидві реалізації»
// перетворилось би на «однаково недетерміновано» (той самий аргумент, що в
// доккоменті пілота `bun/licensee` у `crates/rules-plugin-host/tests/plugin_lang_js.rs`).
//
// Тут натомість обидві реалізації спавнять ОДИН І ТОЙ САМИЙ фейковий
// бінарник, чию поведінку задає тест: канон резолвить його своїм звичайним
// шляхом (`node_modules/.bin/stylelint` — саме той порядок, який відтворює
// схема `npm:`; `bunx` — з PATH), а wasm-бік отримує його абсолютний шлях у
// `toolPaths`, як його передала б `ensureDeclaredTools`. Усе, що лишається
// після спавна — розбір виводу й форма діагностик — і є те, що порт
// зобов'язаний зберегти біт-у-біт. Гілки, де порт свідомо розходиться з
// каноном (тул не дав вердикту → `LintResult.diagnostics` проти
// warn-`Diagnostic`), живуть у Rust-тестах хоста, не тут.

const STYLE_LINT_CONCERN_KEY = 'style/lint'
const JSCPD_CONCERN_KEY = 'js/jscpd_duplicates'

/**
 * Пише виконуваний sh-скрипт (фейковий зовнішній тул) і повертає його шлях.
 * @param {string} path абсолютний шлях майбутнього бінарника
 * @param {string} body тіло скрипта разом із shebang
 * @returns {Promise<string>} той самий `path` — зручно для інлайн-вживання
 */
async function writeFakeTool(path, body) {
  await writeFile(path, body, 'utf8')
  await chmod(path, 0o755)
  return path
}

/**
 * Ганяє `style/lint` через JS-канон і wasm-порт на СПІЛЬНОМУ фейковому
 * `stylelint`: канон бере його з `<dir>/node_modules/.bin/`, wasm — із
 * `toolPaths` (те, що для схеми `npm:` побудувала б `ensureDeclaredTools`).
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @param {string[] | undefined} files дельта-список файлів; `undefined` — повний режим
 * @param {string} toolBody тіло фейкового `stylelint`
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runStyleLintBoth(dir, files, toolBody) {
  const { mkdir } = await import('node:fs/promises')
  const binDir = join(dir, 'node_modules', '.bin')
  await mkdir(binDir, { recursive: true })
  const toolPath = await writeFakeTool(join(binDir, 'stylelint'), toolBody)

  const js = await goldenJs(STYLE_LINT_CONCERN_KEY, dir, async () => {
    // file:// URL — абсолютний шлях (той самий мотив, що [`runTfmBoth`]). Виконується
    // лише в режимі зняття еталонів.
    // eslint-disable-next-line no-unsanitized/method
    const { lint } = await import(pathToFileURL(mainMjsPathFor('style', 'lint')).href)
    const jsResult = await lint({ cwd: dir, ruleId: 'style', concernId: 'lint', files })
    return withDefaultSeverity(jsResult.violations)
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, STYLE_LINT_CONCERN_KEY, dir, files ?? null, {
    stylelint: toolPath
  })
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Ганяє `js/jscpd_duplicates` через JS-канон і wasm-порт на фейкових тулах
 * ІЗ ОДНАКОВИМ ТІЛОМ, але різними іменами файлу — розбіжність, яку внесла
 * §2.100. Канон (лише в режимі зняття еталонів, доккомент нижче) і далі
 * резолвить `bunx` із PATH (тому PATH тимчасово доповнюється каталогом
 * фейка й відновлюється у `finally`) і кличе його з провідним аргументом
 * `jscpd`; wasm — `npm:jscpd` (`toolPaths.jscpd`, доккомент [`JSCPD_TOOL`]
 * у `crates/plugin-lang-js/src/lib.rs`: зріз 6 контракту знімає неявну
 * гарантію присутності `bun`/`bunx`, а сам тул тепер СПАВНИТЬСЯ напряму,
 * без провідного `jscpd`-аргументу бінарника-раннера). Тіло фейкового тула
 * тому шукає `--output` СКАНОМ аргументів, а не фіксованою позицією —
 * позиція зсувається між двома викликами (доккомент [`fakeJscpdReport`]).
 * @param {string} dir абсолютний шлях tmp-каталогу
 * @param {string} toolBody тіло фейкового тула (спільне для обох імен)
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runJscpdBoth(dir, toolBody) {
  const { mkdir } = await import('node:fs/promises')
  const binDir = join(dir, 'fake-bin')
  await mkdir(binDir, { recursive: true })
  // Канон (compute-гілка, лише зняття еталонів) і wasm-порт резолвлюють
  // РІЗНІ імена — той самий фейковий скрипт лягає під обома.
  await writeFakeTool(join(binDir, 'bunx'), toolBody)
  const jscpdToolPath = await writeFakeTool(join(binDir, 'jscpd'), toolBody)

  const js = await goldenJs(JSCPD_CONCERN_KEY, dir, async () => {
    // `env` з `node:process` (не `process.env`) — вимога `js-run/runtime`;
    // мутація тут навмисна й тимчасова: канон резолвить `bunx` саме з PATH
    // дочірнього процесу, іншої точки ін'єкції в нього немає. Виконується
    // лише в режимі зняття еталонів.
    const originalPath = env.PATH
    try {
      env.PATH = `${binDir}${delimiter}${originalPath ?? ''}`
      // eslint-disable-next-line no-unsanitized/method
      const { lint } = await import(pathToFileURL(mainMjsPathFor('js', 'jscpd_duplicates')).href)
      const jsResult = await lint({ cwd: dir, ruleId: 'js', concernId: 'jscpd_duplicates', files: undefined })
      return withDefaultSeverity(jsResult.violations)
    } finally {
      env.PATH = originalPath
    }
  })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, JSCPD_CONCERN_KEY, dir, null, { jscpd: jscpdToolPath })
  return { js, wasm: withDefaultSeverity(wasmResult.violations) }
}

/**
 * Тіло фейкового `jscpd`, що пише заданий JSON-звіт у каталог `--output` і
 * виходить заданим кодом. Сканує `$@` за прапорцем `--output`, а не бере
 * фіксовану позицію (`$6`/`$5`): канон кличе тул як `bunx jscpd . --reporters
 * json --output <dir> --silent` (`--output` — шостий токен, `<dir>` —
 * сьомий), wasm-порт (§2.100 — `npm:jscpd` без провідного `jscpd`-аргумента)
 * — як `<jscpd-бінарник> . --reporters json --output <dir> --silent`
 * (`<dir>` — п'ятий). Той самий фейковий скрипт обслуговує ОБИДВА виклики,
 * тож фіксована позиція розійшлась би з одним із них.
 * @param {string} report вміст майбутнього `jscpd-report.json`
 * @param {number} [exitCode] код виходу скрипта (дефолт 0)
 * @returns {string} тіло sh-скрипта для [`writeFakeTool`]
 */
const fakeJscpdReport = (report, exitCode = 0) =>
  `#!/bin/sh\nout=""\nwhile [ $# -gt 0 ]; do\n  case "$1" in\n    --output) shift; out="$1" ;;\n  esac\n  shift\ndone\ncat > "$out/jscpd-report.json" <<'JSON'\n${report}\nJSON\nexit ${exitCode}\n`

describe('wasm-plugin parity — style/lint (JS канон vs wasm plugin-lang-js, спільний фейковий stylelint)', () => {
  test('exit 0 — тул мовчить → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.scss'), '.a {\n  color: red;\n}\n')
      const { js, wasm } = await runStyleLintBoth(dir, ['app.scss'], '#!/bin/sh\nexit 0\n')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('exit 2 — однакове violation з обох реалізацій, включно з чужим виводом у тексті', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.scss'), '.a {\n  color: red;\n}\n')
      const { js, wasm } = await runStyleLintBoth(
        dir,
        ['app.scss'],
        '#!/bin/sh\necho "app.scss"\necho "  1:1  ✖  Unexpected" >&2\nexit 2\n'
      )
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('stylelint-violation')
      expect(js[0].message).toBe('lint-style: stylelint — порушення (код 2, style.mdc)\napp.scss\n  1:1  ✖  Unexpected')
    })
  })

  test('exit 1 без жодного виводу → повідомлення без суфікса з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.css'), '.a {\n  color: red;\n}\n')
      const { js, wasm } = await runStyleLintBoth(dir, ['app.css'], '#!/bin/sh\nexit 1\n')
      expect(wasm).toEqual(js)
      expect(js[0].message).toBe('lint-style: stylelint — порушення (код 1, style.mdc)')
    })
  })

  test('вивід довший за 2000 символів обрізається однаково обома реалізаціями', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.css'), '.a {\n  color: red;\n}\n')
      // 3000 ASCII-символів: на ASCII `.slice(0, 2000)` (UTF-16 code units)
      // і `chars().take(2000)` (code points) збігаються за визначенням.
      const { js, wasm } = await runStyleLintBoth(
        dir,
        ['app.css'],
        `#!/bin/sh\nprintf '%s' '${'x'.repeat(3000)}'\nexit 1\n`
      )
      expect(wasm).toEqual(js)
      expect(js[0].message).toBe(`lint-style: stylelint — порушення (код 1, style.mdc)\n${'x'.repeat(2000)}`)
    })
  })

  test('дельта без жодного css/scss/vue → тул не спавниться, обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'main.mjs'), 'export const a = 1\n')
      // Скрипт віддав би 1 (порушення), якби його взагалі запустили.
      const { js, wasm } = await runStyleLintBoth(dir, ['main.mjs'], '#!/bin/sh\nexit 1\n')
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('повний режим (files: undefined) — той самий вердикт з обох реалізацій попри різні цілі', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.scss'), '.a {\n  color: red;\n}\n')
      await writeFile(join(dir, 'main.mjs'), 'export const a = 1\n')
      // Канон віддає тулу ГЛОБ `**/*.{css,scss,vue}`, порт — розкритий
      // хостом список (розбіжність 2 доккомента секції «Зріз 6»); вивід
      // фейка від argv не залежить, тож видима частина вердикту однакова.
      // Це заразом і доказ full-scope мосту: `files: null` → хост сам
      // будує batch за глобом контрибуції.
      const { js, wasm } = await runStyleLintBoth(dir, undefined, '#!/bin/sh\necho "boom"\nexit 2\n')
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toBe('lint-style: stylelint — порушення (код 2, style.mdc)\nboom')
    })
  })
})

// --- T0-фіксер `style/lint`: перший у цьому крейті фікс класу exec-tool ---
//
// Гість не будує `FixPlan` узагалі — він спавнить `stylelint --fix`, який
// сам мутує файли на диску, а edits синтезує ХОСТ, діфаючи знімок глоба
// концерну до і після виклику `fix()` (host-diff, §2.64 реєстру;
// прецедент — `python/ruff`, `wasm-fix-exec-tool-python-ruff.test.mjs`).
// Тому весь цикл тут іде через РЕАЛЬНИЙ napi-міст (`runWasmConcernFix`), а
// не через прямий виклик гостя: прямий виклик повернув би порожній план і
// не довів би нічого (§2.47/§2.49).
//
// Тул — той самий фейк, що в detect-тестах вище: тіло задає тест, тож
// «виправлення» детерміноване й не залежить від версії справжнього
// `stylelint`.
describe('wasm-plugin — style/lint T0-фікс через fix-міст (exec-tool + host-diff)', () => {
  /** Фейковий `stylelint --fix`: переписує КОЖЕН переданий файл канонічним вмістом. */
  const stylelintFixTool = '#!/bin/sh\nshift\nfor f in "$@"; do printf \'FIXED\\n\' > "$f"; done\nexit 0\n'

  /**
   * Кладе фейковий `stylelint` у `node_modules/.bin` (шлях схеми `npm:`) і
   * повертає його абсолютний шлях — те, що для цієї схеми побудувала б
   * `ensureDeclaredTools`.
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {string} body тіло фейкового тула
   * @returns {Promise<string>} абсолютний шлях фейка
   */
  async function installFakeStylelint(dir, body) {
    const { mkdir } = await import('node:fs/promises')
    const binDir = join(dir, 'node_modules', '.bin')
    await mkdir(binDir, { recursive: true })
    return writeFakeTool(join(binDir, 'stylelint'), body)
  }

  /** Агрегована діагностика концерну — рівно те, що віддає `detect_style_lint` (жодного `file`). */
  const stylelintViolations = () => [
    {
      reason: 'stylelint-violation',
      message: 'lint-style: stylelint — порушення (код 2, style.mdc)',
      severity: 'error'
    }
  ]

  test('дельта: host-diff синтезує write-edit ЛИШЕ на файли дельти — файл поза нею не чіпається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.scss'), '.a {\n  color: red;\n}\n')
      await writeFile(join(dir, 'other.scss'), '.b {\n  color: blue;\n}\n')
      const toolPath = await installFakeStylelint(dir, stylelintFixTool)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        STYLE_LINT_CONCERN_KEY,
        dir,
        stylelintViolations(),
        { stylelint: toolPath },
        ['app.scss']
      )

      // Порожній план тут означав би регресію: гість НЕ повертає edits сам,
      // тож непорожній план — доказ, що host-diff справді побачив мутацію.
      expect(plan.edits).toEqual([{ type: 'write', path: 'app.scss', content: 'FIXED\n' }])
      for (const edit of plan.edits) await applyPlanEdit(edit, dir, { cwd: dir, ruleId: 'style', concernId: 'lint' })
      expect(await readFile(join(dir, 'app.scss'), 'utf8')).toBe('FIXED\n')
      // Головне твердження: `per-file`-контрибуція звузила спавн до дельти.
      // На `scope: full` (як було до порту) тул дістав би ОБИДВА файли й
      // дельта-прогін переписав би репозиторій поза дельтою.
      expect(await readFile(join(dir, 'other.scss'), 'utf8')).toBe('.b {\n  color: blue;\n}\n')
    })
  })

  test('повний режим (deltaFiles: undefined) — хост будує batch глобом, фікс покриває всі стилі', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.scss'), '.a {\n  color: red;\n}\n')
      await writeFile(join(dir, 'other.css'), '.b {\n  color: blue;\n}\n')
      await writeFile(join(dir, 'main.mjs'), 'export const a = 1\n')
      const toolPath = await installFakeStylelint(dir, stylelintFixTool)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        STYLE_LINT_CONCERN_KEY,
        dir,
        stylelintViolations(),
        { stylelint: toolPath },
        undefined
      )

      const paths = plan.edits.map(e => e.path).sort()
      expect(paths).toEqual(['app.scss', 'other.css'])
      // `.mjs` не в глобі концерну — host-diff його навіть не знімає.
      expect(await readFile(join(dir, 'main.mjs'), 'utf8')).toBe('export const a = 1\n')
    })
  })

  // §2.93: порожній план тут — СВІДОМИЙ no-op, а не «підхопить JS-канон»:
  // `fix-lint.mjs` знято, третього шару `loadT0Patterns` більше немає.
  test('тул нічого не змінив (exit 0, без запису) — план порожній (свідомий no-op)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'app.scss'), '.a {\n  color: red;\n}\n')
      const toolPath = await installFakeStylelint(dir, '#!/bin/sh\nexit 0\n')

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        STYLE_LINT_CONCERN_KEY,
        dir,
        stylelintViolations(),
        { stylelint: toolPath },
        ['app.scss']
      )
      expect(plan.edits).toEqual([])
    })
  })

  test('дельта без жодного css/scss/vue — тул не спавниться, план порожній', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'main.mjs'), 'export const a = 1\n')
      // Скрипт затер би будь-який файл, якби його взагалі запустили.
      const toolPath = await installFakeStylelint(dir, stylelintFixTool)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        STYLE_LINT_CONCERN_KEY,
        dir,
        stylelintViolations(),
        { stylelint: toolPath },
        ['main.mjs']
      )
      expect(plan.edits).toEqual([])
      expect(await readFile(join(dir, 'main.mjs'), 'utf8')).toBe('export const a = 1\n')
    })
  })
})

// --- T0-фіксер `bun/licensee`: три патерни, план ПОВНІСТЮ декларативний ---
//
// На відміну від `style/lint`, тут host-diff не задіяний: гість будує
// `FixPlan` сам із вмісту, який хост уже приніс у `FixRequest::files`
// (глоб контрибуції розширено `**/package.json` саме заради патерна 3).
// §2.93 зняла JS-канон (`fix-licensee.mjs`), тож два тести, що раніше
// звіряли підсумковий вміст із прогоном канону в сусідньому tmp-дереві,
// ПЕРЕПИСАНО на очікуваний текст ЛІТЕРАЛОМ (крок 4 зразка §2.88) — так
// само, як від початку був сформульований патерн 1
// (`bun-licensee-config-init`): канон там спавнив `bunx licensee --init`
// (мережа + версія тула), і саме тому порт пише канонічний вміст
// декларативно.
describe('wasm-plugin — bun/licensee T0-фікс (гість — ЄДИНИЙ виконавець, §2.93)', () => {
  const BUN_LICENSEE_CONCERN_KEY = 'bun/licensee'
  const fixCtx = dir => ({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })

  /**
   * Застосовує план гостя у `dir` через той самий `applyPlanEdit`, що й
   * продакшн fix-прогін.
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {unknown[]} violations порушення концерну
   * @returns {Promise<Array<{ type: string, path: string }>>} застосовані edits
   */
  async function applyGuestPlan(dir, violations) {
    const plan = loadNative().runWasmConcernFix(WASM_PATH, BUN_LICENSEE_CONCERN_KEY, dir, violations, {}, undefined)
    for (const edit of plan.edits) await applyPlanEdit(edit, dir, fixCtx(dir))
    return plan.edits
  }

  /**
   * Розкладає фікстуру (шлях → вміст) по каталогу, створюючи підкаталоги.
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {Record<string, string>} fixture фікстура
   * @returns {Promise<void>} нічого
   */
  async function seedFixture(dir, fixture) {
    const { mkdir } = await import('node:fs/promises')
    for (const [name, content] of Object.entries(fixture)) {
      await mkdir(dirname(join(dir, name)), { recursive: true })
      await writeFile(join(dir, name), content)
    }
  }

  test('патерн 1 (немає .licensee.json): план пише канонічну policy з усіма сімома SPDX — без спавна тула', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{\n  "name": "root"\n}\n')
      const edits = await applyGuestPlan(dir, [
        { reason: 'licensee-config-missing', message: 'lint-bun: licensee — немає .licensee.json', severity: 'error' }
      ])

      expect(edits.map(e => e.path)).toEqual(['.licensee.json'])
      const config = JSON.parse(await readFile(join(dir, '.licensee.json'), 'utf8'))
      expect(config.licenses.spdx).toEqual([
        'MIT',
        'BSD-2-Clause',
        'BSD-3-Clause',
        'Apache-2.0',
        'ISC',
        'BlueOak-1.0.0',
        '0BSD'
      ])
      // Дефолт самого `licensee --init`, який канон зберігає після
      // нормалізації — порт відтворює його дослівно.
      expect(config.packages).toEqual({ optimist: '<=0.6.1' })
      expect(config.corrections).toBe(false)
    })
  })

  test('патерн 2 (license-violation): нормалізація .licensee.json — union SPDX, локальні ключі цілі', async () => {
    const fixture = {
      'package.json': '{\n  "name": "root"\n}\n',
      '.licensee.json': `${JSON.stringify(
        {
          licenses: { spdx: ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0'] },
          packages: { 'legacy-pkg': '<=1.0.0' },
          corrections: true
        },
        null,
        2
      )}\n`
    }
    const violations = [{ reason: 'license-violation', message: 'lint-bun: licensee — порушення', severity: 'error' }]

    await withTmpDir(async guestDir => {
      await seedFixture(guestDir, fixture)
      await applyGuestPlan(guestDir, violations)
      const guestConfig = await readFile(join(guestDir, '.licensee.json'), 'utf8')

      // Очікуване — ЛІТЕРАЛОМ, а не «те саме, що канон»: union зберігає
      // порядок наявних (включно з локальним `MPL-2.0`) і дописує
      // відсутні канонічні у хвіст; форматування — `JSON.stringify(…, 2)`
      // + завершальний перевід рядка.
      expect(guestConfig).toBe(
        `${JSON.stringify(
          {
            licenses: {
              spdx: ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0', 'ISC', 'BlueOak-1.0.0', '0BSD']
            },
            packages: { 'legacy-pkg': '<=1.0.0' },
            corrections: true
          },
          null,
          2
        )}\n`
      )
    })
  })

  test('патерн 2 ідемпотентний: уже канонічна policy — порожній план (як `changed === false` канону)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{\n  "name": "root"\n}\n')
      await writeFile(
        join(dir, '.licensee.json'),
        `${JSON.stringify(
          {
            licenses: {
              spdx: ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'BlueOak-1.0.0', '0BSD']
            }
          },
          null,
          2
        )}\n`
      )
      const edits = await applyGuestPlan(dir, [
        { reason: 'license-violation', message: 'lint-bun: licensee — порушення', severity: 'error' }
      ])
      expect(edits).toEqual([])
    })
  })

  test('патерн 3 (license-metadata-invalid): "license": "ISC" власним пакетам, решта полів і порядок цілі', async () => {
    const fixture = {
      'package.json': `${JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['npm'] }, null, 2)}\n`,
      'npm/package.json': `${JSON.stringify({ name: '@scope/member', version: '2.0.0' }, null, 2)}\n`,
      '.licensee.json': `${JSON.stringify({ licenses: { spdx: ['MIT'] } }, null, 2)}\n`
    }
    const violations = [
      {
        reason: 'license-metadata-invalid',
        message: 'lint-bun: licensee — root: Invalid license metadata',
        severity: 'error',
        data: { package: 'root' }
      },
      {
        reason: 'license-metadata-invalid',
        message: 'lint-bun: licensee — @scope/member: Invalid license metadata',
        severity: 'error',
        data: { package: '@scope/member' }
      }
    ]

    await withTmpDir(async guestDir => {
      await seedFixture(guestDir, fixture)
      const edits = await applyGuestPlan(guestDir, violations)
      expect(edits.map(e => e.path).sort()).toEqual(['npm/package.json', 'package.json'])

      // Очікуване — ЛІТЕРАЛОМ: `license` дописується у ХВІСТ, наявні поля
      // й їхній порядок не рухаються, форматування те саме.
      expect(await readFile(join(guestDir, 'package.json'), 'utf8')).toBe(
        `${JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['npm'], license: 'ISC' }, null, 2)}\n`
      )
      expect(await readFile(join(guestDir, 'npm', 'package.json'), 'utf8')).toBe(
        `${JSON.stringify({ name: '@scope/member', version: '2.0.0', license: 'ISC' }, null, 2)}\n`
      )
    })
  })

  test('патерн 3: пакет із наявним license і пакет поза воркспейсом не чіпаються', async () => {
    const fixture = {
      'package.json': `${JSON.stringify({ name: 'root', workspaces: ['npm'], license: 'MIT' }, null, 2)}\n`,
      'npm/package.json': `${JSON.stringify({ name: 'member' }, null, 2)}\n`,
      'outside/package.json': `${JSON.stringify({ name: 'outsider' }, null, 2)}\n`
    }
    const violations = [
      { reason: 'license-metadata-invalid', message: 'm', severity: 'error', data: { package: 'root' } },
      { reason: 'license-metadata-invalid', message: 'm', severity: 'error', data: { package: 'outsider' } }
    ]

    await withTmpDir(async dir => {
      await seedFixture(dir, fixture)
      const edits = await applyGuestPlan(dir, violations)
      expect(edits).toEqual([])
      expect(JSON.parse(await readFile(join(dir, 'outside', 'package.json'), 'utf8')).license).toBeUndefined()
    })
  })
})

describe('wasm-plugin parity — js/jscpd_duplicates (JS канон vs wasm plugin-lang-js, спільний фейковий bunx)', () => {
  test('звіт із двома клонами → однакові violations (message/file/data) з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const report = JSON.stringify({
        duplicates: [
          {
            format: 'javascript',
            lines: 25,
            firstFile: { name: 'src/a.mjs', start: 1, end: 26 },
            secondFile: { name: 'src/b.mjs', start: 10, end: 35 }
          },
          {
            format: 'vue',
            lines: 30,
            firstFile: { name: 'src/C.vue', start: 2, end: 32 },
            secondFile: { name: 'src/D.vue', start: 5, end: 35 }
          }
        ]
      })
      const { js, wasm } = await runJscpdBoth(dir, fakeJscpdReport(report))
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].reason).toBe('duplicate-clone')
      expect(js[0].message).toBe('jscpd: дубльований фрагмент (25 рядків, javascript) src/a.mjs:1-26 ↔ src/b.mjs:10-35')
      expect(js[0].file).toBe('src/a.mjs')
      expect(js[0].data).toEqual({
        line: 1,
        lines: 25,
        format: 'javascript',
        first: { file: 'src/a.mjs', start: 1, end: 26 },
        second: { file: 'src/b.mjs', start: 10, end: 35 }
      })
    })
  })

  test('порожній duplicates → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runJscpdBoth(dir, fakeJscpdReport(JSON.stringify({ duplicates: [] })))
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('duplicates не масив → без порушень з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runJscpdBoth(dir, fakeJscpdReport(JSON.stringify({ duplicates: 'nope' })))
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('ненульовий код тула зі звітом → вердикт беруть зі звіту обидві реалізації', async () => {
    await withTmpDir(async dir => {
      const report = JSON.stringify({
        duplicates: [
          {
            format: 'markdown',
            lines: 40,
            firstFile: { name: 'docs/a.md', start: 3, end: 43 },
            secondFile: { name: 'docs/b.md', start: 7, end: 47 }
          }
        ]
      })
      // `.jscpd.json` цього репо має `"exitCode": 1` — реальний `jscpd`
      // виходить ненульовим САМЕ тоді, коли клони знайдено, тож ця гілка
      // (звіт є, код ≠ 0) і є типовою, а не крайньою.
      const { js, wasm } = await runJscpdBoth(dir, fakeJscpdReport(report, 1))
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].file).toBe('docs/a.md')
    })
  })

  test('wasm-порт не лишає звіту в дереві репо — він живе у scratch-каталозі хоста', async () => {
    await withTmpDir(async dir => {
      await runJscpdBoth(dir, fakeJscpdReport(JSON.stringify({ duplicates: [] })))
      expect(existsSync(join(dir, 'jscpd-report.json'))).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------
// Зріз 7 контракту v3.1 — `js-run/runtime` (дев'ять під-перевірок одного
// ключа, доккомент секції «Зріз 7» у `crates/plugin-lang-js/src/lib.rs`).
//
// Обидві реалізації бачать УСЕ дерево tmp-каталогу: канон сам ходить
// `walkDir` по кожному workspace-пакету, wasm отримує host-побудований
// full-scope batch за глобом контрибуції. Тому спільний хелпер тут той
// самий [`runFullScopeBoth`], що для решти full-scope концернів — жодного
// зовнішнього тула цей концерн не спавнить (див. тест «вакуумний conftest»
// нижче).
//
// Джерела в фікстурах лежать під `lib/`, а не `src/` — навмисно: каталог
// `src/` вмикає під-перевірку 1 («є src/, немає jsconfig.json»), яка
// додавала б своє порушення в КОЖЕН сценарій сканерів і топила б те, що
// тест насправді перевіряє. Дефолтний `connDir` (`src/conn`) і сама гілка
// `src/` покриті окремими тестами наприкінці.

const JS_RUN_RUNTIME_CONCERN_KEY = 'js-run/runtime'

/**
 * Ганяє `js-run/runtime` через JS-канон і wasm-порт на спільному дереві.
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
const runJsRunRuntimeBoth = dir => runFullScopeBoth(JS_RUN_RUNTIME_CONCERN_KEY, 'js-run', 'runtime', dir)

/**
 * Пише кореневий `package.json` з одним workspace-пакетом `api` і сам
 * маніфест пакета.
 * @param {string} dir корінь tmp-дерева
 * @param {object} [apiPkg] вміст `api/package.json` (дефолт — порожній маніфест)
 * @returns {Promise<void>} завершується після запису обох файлів
 */
async function writeWorkspaceRoot(dir, apiPkg = {}) {
  const { mkdir } = await import('node:fs/promises')
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['api'] }))
  await mkdir(join(dir, 'api'), { recursive: true })
  await writeFile(join(dir, 'api', 'package.json'), JSON.stringify({ name: 'api', ...apiPkg }))
}

/**
 * Пише файл усередині пакета `api`, створюючи проміжні каталоги.
 * @param {string} dir корінь tmp-дерева
 * @param {string} relPath шлях відносно кореня пакета (posix)
 * @param {string} content вміст файлу
 * @returns {Promise<void>} завершується після запису
 */
async function writeApiFile(dir, relPath, content) {
  const { mkdir } = await import('node:fs/promises')
  const abs = join(dir, 'api', ...relPath.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

describe('wasm-plugin parity — js-run/runtime (JS канон vs wasm plugin-lang-js, full-scope)', () => {
  test('немає workspace-пакетів → жодного порушення з обох реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'solo' }))
      await writeFile(join(dir, 'index.mjs'), 'console.log(process.env.PORT)\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('frontend-пакет (vite у devDependencies) пропускається цілком', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir, { devDependencies: { vite: '^5.0.0' } })
      await writeApiFile(dir, 'lib/app.mjs', 'console.log(process.env.PORT)\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('bunyan: статичний імпорт, require і динамічний import — три однакові порушення', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(
        dir,
        'lib/log.mjs',
        "const a = require('bunyan')\nimport { createLogger } from '@nitra/bunyan'\nconst b = await import('bunyan')\n"
      )
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(3)
      expect(js[0].reason).toBe('runtime')
      // Двофазний порядок JS-оригіналу: спершу статичні імпорти, потім walk.
      expect(js[0].message).toContain("lib/log.mjs:2 — заміни '@nitra/bunyan' на '@nitra/pino'")
      expect(js[1].message).toContain("lib/log.mjs:1 — заміни 'bunyan' на '@nitra/pino'")
      expect(js[2].message).toContain("lib/log.mjs:3 — заміни 'bunyan' на '@nitra/pino'")
    })
  })

  test('фабричні імпорти поза conn-каталогом — три однакові порушення', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir, { imports: { '#conn/*': './lib/conn/*' } })
      await writeApiFile(
        dir,
        'lib/app.mjs',
        "import { SQL } from 'bun'\nimport sql from 'mssql'\nimport { GraphQLClient } from '@nitra/graphql-request'\n"
      )
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(3)
      expect(js[0].message).toContain("імпорт { SQL } from 'bun' має бути в 'lib/conn/'")
      expect(js[1].message).toContain("імпорт 'mssql' має бути в 'lib/conn/'")
      expect(js[2].message).toContain("імпорт { GraphQLClient } from '@nitra/graphql-request'")
    })
  })

  test('той самий імпорт УСЕРЕДИНІ conn-каталогу порушенням не є', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir, { imports: { '#conn/*': './lib/conn/*' } })
      await writeApiFile(dir, 'lib/conn/pg-read.mjs', "import { SQL } from 'bun'\nexport const pgRead = new SQL()\n")
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('conn-файл: невалідне ім’я + export default — два однакові порушення', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir, { imports: { '#conn/*': './lib/conn/*' } })
      await writeApiFile(dir, 'lib/conn/database.mjs', 'export default 1\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(2)
      expect(js[0].message).toContain("назва файла в 'lib/conn/' не відповідає канону js-run")
      expect(js[1].message).toContain("'export default' заборонений у 'lib/conn/'")
    })
  })

  test('conn-файл: валідне ім’я, але експорт не в camelCase від basename', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir, { imports: { '#conn/*': './lib/conn/*' } })
      await writeApiFile(dir, 'lib/conn/pg-write-contract.mjs', 'export const db = 1\nexport function helper() {}\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain("очікується іменований експорт 'export const pgWriteContract = …'")
      expect(js[0].message).toContain('знайдено: db, helper')
    })
  })

  test('conn-файл `index.*` — реекспортний барель, пропускається', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir, { imports: { '#conn/*': './lib/conn/*' } })
      await writeApiFile(dir, 'lib/conn/index.mjs', "export * from './pg-read.mjs'\n")
      await writeApiFile(dir, 'lib/conn/pg-read.mjs', 'export const pgRead = 1\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('check-env: process.env, деструктуризація і env без checkEnv', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(
        dir,
        'lib/env.mjs',
        "import { env } from '@nitra/check-env'\n" +
          'const { HOST, PORT } = process.env\n' +
          'console.log(process.env.DB_URL)\n' +
          "console.log(env.QL, env['SECRET'])\n"
      )
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(5)
      expect(js[0].message).toContain('lib/env.mjs:2 — process.env.HOST')
      expect(js[1].message).toContain('lib/env.mjs:2 — process.env.PORT')
      expect(js[2].message).toContain('lib/env.mjs:3 — process.env.DB_URL')
      expect(js[3].message).toContain("lib/env.mjs:4 — env.QL (з '@nitra/check-env') без checkEnv(['QL'])")
      expect(js[4].message).toContain("lib/env.mjs:4 — env.SECRET (з '@nitra/check-env') без checkEnv(['SECRET'])")
    })
  })

  test('check-env: checkEnv([…]) закриває змінну, ignore-маркер глушить process.env', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(
        dir,
        'lib/env.mjs',
        "import { checkEnv, env } from '@nitra/check-env'\n" +
          "checkEnv(['QL'])\n" +
          'console.log(env.QL)\n' +
          '// n-rules:ignore-next-line checkEnv\n' +
          'console.log(process.env.LEGACY)\n'
      )
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('пауза через new Promise + setTimeout — однакове порушення', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(
        dir,
        'lib/sleep.mjs',
        'export async function sleep(ms) {\n  await new Promise(resolve => setTimeout(resolve, ms))\n}\n'
      )
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain("lib/sleep.mjs:2 — заміни 'new Promise(r => setTimeout(r, ms))'")
    })
  })

  test('Temporal у Bun-рантаймі — однакове порушення на кожне вживання', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(dir, 'lib/time.mjs', 'export const now = Temporal.Now.instant()\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('lib/time.mjs:1 — Temporal API заборонений у Bun runtime')
    })
  })

  test('`.d.ts` не сканується жодною з шести перевірок', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(dir, 'lib/types.d.ts', 'declare const x: typeof Temporal\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('k8s/ без base/configmap.yaml — однакове порушення (гілка, заради якої глоб ширший)', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(dir, 'k8s/base/kustomization.yaml', 'resources: []\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('api/k8s/base/configmap.yaml відсутній')
    })
  })

  test('k8s/base/configmap.yaml на місці — чисто; без каталогу k8s/ — теж чисто', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(dir, 'k8s/base/configmap.yaml', 'kind: ConfigMap\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('файли у conn-каталозі без аліаса "#conn/*" — однакове порушення', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(dir, 'src/conn/pg-read.mjs', 'export const pgRead = 1\n')
      await writeApiFile(dir, 'jsconfig.json', '{"compilerOptions":{"module":"NodeNext"},"include":["src/**/*"]}\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('є файли у \'src/conn/\', але в package.json відсутній аліас "#conn/*"')
    })
  })

  test('є каталог src/, немає jsconfig.json — однакове порушення', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(dir, 'src/index.mjs', 'export const app = 1\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].message).toContain('є каталог src/, але немає jsconfig.json')
    })
  })

  // Ключовий тест зрізу: він доводить, що `runConftestBatch` у
  // `runtime/main.mjs` не може віддати ЖОДНОГО порушення (доккомент секції
  // «Зріз 7» у `crates/plugin-lang-js/src/lib.rs`). `jsconfig.json` тут
  // свідомо неканонічний за КОЖНИМ полем сніпета `js_run.jsconfig`
  // (`module`, `moduleResolution`, `target`, `lib`, `checkJs`, `include`) —
  // якби гілка працювала, канон дав би шість порушень. Він дає нуль, бо
  // `--data` (тобто `data.template.snippet`) у цьому виклику немає взагалі.
  // Саме тому порт цю гілку не відтворює, і саме тому parity тут — рівність
  // двох порожніх списків, а не «wasm загубив перевірку».
  test('вакуумний conftest: неканонічний jsconfig.json не дає порушень у ЖОДНІЙ з реалізацій', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(dir, 'src/index.mjs', 'export const app = 1\n')
      await writeApiFile(dir, 'jsconfig.json', '{"compilerOptions":{"module":"commonjs"},"include":["lib/**/*"]}\n')
      const { js, wasm } = await runJsRunRuntimeBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

// T0-фіксер `js-run/runtime` (`js-run-jsconfig-create`). §2.93 зняла
// JS-канон `fix-runtime.mjs`, тож snapshot/restore-пара більше не потрібна
// (відновлювати диск між двома реалізаціями нема від чого) — лишився
// знімок «до», на який накладається план гостя. Цільові шляхи залежать від
// workspace-ів конкретного сценарію, тож параметризовані явним списком.
describe('wasm-plugin — js-run/runtime T0-фікс (гість — ЄДИНИЙ виконавець, §2.93)', () => {
  /**
   * Канонічний `jsconfig.json` із дерева правил — той самий файл, що гість
   * вшиває `JSCONFIG_CANONICAL_JSON` (`include_str!`).
   * @returns {Promise<string>} вміст snippet-а
   */
  const readJsconfigCanonical = async () => {
    const { readFile: read } = await import('node:fs/promises')
    return read(
      join(REPO_ROOT, 'plugins', 'lang-js', 'rules', 'js-run', 'jsconfig', 'template', 'jsconfig.json.snippet.json'),
      'utf8'
    )
  }

  /**
   * Знімок вмісту заданих файлів tmp-дерева — `null` для відсутнього (той
   * самий контракт, що `snapshotJsCheckTargets`).
   * @param {string} dir абсолютний шлях tmp-каталогу
   * @param {string[]} relPaths repo-relative шляхи для знімку
   * @returns {Promise<Record<string, string|null>>} шлях → вміст (або `null`)
   */
  async function snapshotTargets(dir, relPaths) {
    const { readFile: read } = await import('node:fs/promises')
    const out = {}
    for (const rel of relPaths) {
      try {
        out[rel] = await read(join(dir, rel), 'utf8')
      } catch {
        out[rel] = null
      }
    }
    return out
  }

  /**
   * T0-фікс `js-run/runtime` гостем: violations беруться напряму з
   * `runWasmConcern` (whole-batch full-scope, той самий шлях, що
   * [`runJsRunRuntimeBoth`] вище), подаються в `runWasmConcernFix`, план
   * накладається на знімок «до».
   * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
   * @param {string[]} targetPaths repo-relative шляхи `<ws>/jsconfig.json`, які сценарій очікує торкнутись
   * @returns {Promise<{ wasm: Record<string, string|null>, violations: unknown[] }>}
   *   фінальний знімок і violations, якими фікс живився
   */
  async function runJsRunRuntimeFix(dir, targetPaths) {
    const before = await snapshotTargets(dir, targetPaths)
    const violations = withDefaultSeverity(
      loadNative().runWasmConcern(WASM_PATH, JS_RUN_RUNTIME_CONCERN_KEY, dir, null).violations
    )

    const plan = loadNative().runWasmConcernFix(WASM_PATH, JS_RUN_RUNTIME_CONCERN_KEY, dir, violations, {})
    const wasmAfter = { ...before }
    for (const edit of plan.edits) {
      if (edit.type === 'write' && targetPaths.includes(edit.path)) {
        wasmAfter[edit.path] = edit.content
      }
    }

    return { wasm: wasmAfter, violations }
  }

  test('один workspace без jsconfig.json — створюється канонічний файл', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(dir, 'src/index.mjs', 'export const app = 1\n')
      const { wasm, violations } = await runJsRunRuntimeFix(dir, ['api/jsconfig.json'])
      expect(violations).toHaveLength(1)
      expect(violations[0].message).toContain('є каталог src/, але немає jsconfig.json')
      // Очікуване — сам канонічний snippet концерну `js-run/jsconfig`, який
      // гість вшиває `include_str!`-ом (`JSCONFIG_CANONICAL_JSON`), а не
      // «щось непорожнє».
      expect(wasm['api/jsconfig.json']).toBe(await readJsconfigCanonical())
      expect(wasm['api/jsconfig.json']).toContain('"include": ["src/**/*"]')
    })
  })

  test('кілька workspace-ів без jsconfig.json одночасно — файл створюється для КОЖНОГО', async () => {
    await withTmpDir(async dir => {
      const { mkdir } = await import('node:fs/promises')
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['api', 'worker'] }))
      await mkdir(join(dir, 'api'), { recursive: true })
      await writeFile(join(dir, 'api', 'package.json'), JSON.stringify({ name: 'api' }))
      await mkdir(join(dir, 'api', 'src'), { recursive: true })
      await writeFile(join(dir, 'api', 'src', 'index.mjs'), 'export const app = 1\n')
      await mkdir(join(dir, 'worker'), { recursive: true })
      await writeFile(join(dir, 'worker', 'package.json'), JSON.stringify({ name: 'worker' }))
      await mkdir(join(dir, 'worker', 'src'), { recursive: true })
      await writeFile(join(dir, 'worker', 'src', 'index.mjs'), 'export const w = 1\n')

      const targetPaths = ['api/jsconfig.json', 'worker/jsconfig.json']
      const { wasm, violations } = await runJsRunRuntimeFix(dir, targetPaths)
      expect(violations).toHaveLength(2)
      const canonical = await readJsconfigCanonical()
      for (const path of targetPaths) expect(wasm[path]).toBe(canonical)
    })
  })

  test('jsconfig.json уже існує — чужий вміст НЕ перезаписується (violations порожні)', async () => {
    await withTmpDir(async dir => {
      await writeWorkspaceRoot(dir)
      await writeApiFile(dir, 'src/index.mjs', 'export const app = 1\n')
      await writeApiFile(dir, 'jsconfig.json', '{"custom":true}\n')
      const { wasm, violations } = await runJsRunRuntimeFix(dir, ['api/jsconfig.json'])
      expect(violations).toEqual([])
      expect(wasm['api/jsconfig.json']).toBe('{"custom":true}\n')
    })
  })
})

// =====================================================================
// §2.78 — родина `vscode_extensions` (два концерни) + четвірка
// `package_json`: ПЕРША хвиля `plugin-lang-js`, чий детект — вшита
// `.rego`-політика через host-import `rego-engine` (§2.66), а не власний
// Rust-сканер.
//
// Канон тут — НЕ `main.mjs` (його в цих шести немає взагалі), а rego через
// `conftest` (`evaluatePolicyConcern`), тобто той самий виняток із
// «еталонного» шару, що вже описаний угорі для трьох `*/package_json`
// батчу 6 ([`runPolicyBoth`]). Різниця: там `files.walkGlob`, тут —
// `files.single` (+ `required`/`missingMessage` у `js/vscode_extensions`),
// тож потрібен окремий, узагальнений прогонщик [`runSingleFilePolicyBoth`].
//
// Фікс-половина ганяється РЕАЛЬНИМ napi-мостом
// (`runWasmConcern` → `runWasmConcernFix` → `applyPlanEdit`), не прямим
// викликом гостя: саме цей ланцюжок ловить пастку §2.72 («глоб контрибуції
// годує й fix») — вузький глоб дав би порожній batch, порожній план і
// мовчазний no-op, якого прямий виклик гостя не побачив би взагалі.
// =====================================================================

const JS_VSCODE_EXTENSIONS_CONCERN_KEY = 'js/vscode_extensions'
const STYLE_VSCODE_EXTENSIONS_CONCERN_KEY = 'style/vscode_extensions'
const JS_PACKAGE_JSON_CONCERN_KEY = 'js/package_json'
const NPM_PACKAGE_JSON_CONCERN_KEY = 'npm-module/npm_package_json'
const ROOT_PACKAGE_JSON_CONCERN_KEY = 'npm-module/root_package_json'
const STYLE_PACKAGE_JSON_CONCERN_KEY = 'style/package_json'

/**
 * Шість концернів §2.78 із їхньою `policy.files`-семантикою — дзеркало
 * `concern.json` кожного (свідомо продубльоване тут, а не прочитане з
 * диска: тест мусить ЗАФІКСУВАТИ очікувану форму, а не успадкувати ту саму
 * помилку, якщо `concern.json` колись поїде).
 */
const POLICY_CONCERNS_2_78 = [
  {
    key: JS_VSCODE_EXTENSIONS_CONCERN_KEY,
    ruleId: 'js',
    concernId: 'vscode_extensions',
    files: { single: '.vscode/extensions.json', required: true },
    missingMessage: '.vscode/extensions.json не існує — додай recommendations з js.mdc'
  },
  {
    key: STYLE_VSCODE_EXTENSIONS_CONCERN_KEY,
    ruleId: 'style',
    concernId: 'vscode_extensions',
    files: { single: '.vscode/extensions.json' }
  },
  {
    key: JS_PACKAGE_JSON_CONCERN_KEY,
    ruleId: 'js',
    concernId: 'package_json',
    files: { single: 'package.json' }
  },
  {
    key: NPM_PACKAGE_JSON_CONCERN_KEY,
    ruleId: 'npm-module',
    concernId: 'npm_package_json',
    files: { single: 'npm/package.json' }
  },
  {
    key: ROOT_PACKAGE_JSON_CONCERN_KEY,
    ruleId: 'npm-module',
    concernId: 'root_package_json',
    files: { single: 'package.json' }
  },
  {
    key: STYLE_PACKAGE_JSON_CONCERN_KEY,
    ruleId: 'style',
    concernId: 'package_json',
    files: { single: 'package.json' }
  }
]

const STYLE_VSCODE_SETTINGS_CONCERN_KEY = 'style/vscode_settings'
const JSCPD_CONFIG_CONCERN_KEY = 'js/jscpd_config'
const EMIT_TYPES_CONFIG_CONCERN_KEY = 'npm-module/emit_types_config'
const JSCONFIG_CONCERN_KEY = 'js-run/jsconfig'

/**
 * §2.80 — решта конфіг-подібних концернів. Форма запису та сама, що
 * [`POLICY_CONCERNS_2_78`]; `files: null` означає «канон цього концерну —
 * НЕ policy-адаптер» (`style/tooling` має власний `main.mjs`, тож
 * `runSingleFilePolicyBoth` до нього не застосовний — його гейт нижче лише
 * T0-цикл через реальний napi-міст).
 */
const POLICY_CONCERNS_2_80 = [
  {
    key: STYLE_VSCODE_SETTINGS_CONCERN_KEY,
    ruleId: 'style',
    concernId: 'vscode_settings',
    files: { single: '.vscode/settings.json' }
  },
  {
    key: JSCPD_CONFIG_CONCERN_KEY,
    ruleId: 'js',
    concernId: 'jscpd_config',
    files: { single: '.jscpd.json', required: true },
    missingMessage: '.jscpd.json не існує — створи з полями згідно js.mdc'
  },
  {
    key: EMIT_TYPES_CONFIG_CONCERN_KEY,
    ruleId: 'npm-module',
    concernId: 'emit_types_config',
    files: { single: 'npm/tsconfig.emit-types.json' }
  },
  {
    key: JSCONFIG_CONCERN_KEY,
    ruleId: 'js-run',
    concernId: 'jsconfig',
    // ЄДИНИЙ `walkGlob`-концерн цього гостя — саме він доводить, що
    // багатофайлова форма `policy.files` портована, а не звужена до `single`.
    files: { walkGlob: '**/jsconfig.json' }
  },
  { key: STYLE_TOOLING_CONCERN_KEY, ruleId: 'style', concernId: 'tooling', files: null }
]

/** @param {string} key ключ концерну `ruleId/concernId` */
const concern2_78 = key => [...POLICY_CONCERNS_2_78, ...POLICY_CONCERNS_2_80].find(c => c.key === key)

/**
 * Порядок порівняння violations двох реалізацій. Ключ — ФАЙЛ, потім
 * повідомлення: у багатофайлових (`walkGlob`) концернів текст deny-я той
 * самий для кожного таргета (`js-run/jsconfig` іменує файл лише в префіксі
 * `jsconfig.json:`), тож сортування самим лише повідомленням лишало б
 * порядок нестабільним і робило б тест флейкі-зеленим/червоним без жодної
 * зміни коду.
 * @param {{ file?: string, message: string }} a перша violation
 * @param {{ file?: string, message: string }} b друга violation
 * @returns {number} результат порівняння
 */
const byFileThenMessage = (a, b) =>
  (a.file ?? '').localeCompare(b.file ?? '') || a.message.localeCompare(b.message)

/**
 * Ганяє `files.single` rego-концерн через КАНОН (`evaluatePolicyConcern` —
 * conftest із `--data` зі snippet-а концерну) і через `runWasmConcern`
 * (`files: null`, full-scope міст — host сам будує batch за глобом
 * контрибуції), повертаючи обидва `violations` у спільній формі.
 * @param {string} key ключ концерну `ruleId/concernId`
 * @param {string} dir абсолютний шлях tmp-дерева з фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runSingleFilePolicyBoth(key, dir) {
  const { evaluatePolicyConcern } = await import('../policy-lint-adapter.mjs')
  const meta = concern2_78(key)
  const jsResult = await evaluatePolicyConcern(
    { cwd: dir, ruleId: meta.ruleId, concernId: meta.concernId },
    {
      engine: 'rego',
      policyDir: join(REPO_ROOT, 'plugins', 'lang-js', 'rules', meta.ruleId, meta.concernId),
      files: meta.files,
      missingMessage: meta.missingMessage
    }
  )
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, key, dir, null)
  return {
    js: jsResult.violations.map(v => pickPolicyFields(v)).toSorted(byFileThenMessage),
    wasm: wasmResult.violations
      .map(v => pickPolicyFields({ severity: 'error', ...v }))
      .toSorted(byFileThenMessage)
  }
}

/**
 * Повний T0-цикл через РЕАЛЬНИЙ napi-міст: детект гостем → `runWasmConcernFix`
 * → `applyPlanEdit` → повторний детект гостем.
 * @param {string} key ключ концерну `ruleId/concernId`
 * @param {string} dir абсолютний шлях tmp-дерева
 * @returns {Promise<{ before: unknown[], edits: unknown[], after: unknown[] }>} стан до, план і стан після
 */
async function runWasmFixCycle(key, dir) {
  const meta = concern2_78(key)
  const before = withDefaultSeverity(loadNative().runWasmConcern(WASM_PATH, key, dir, null).violations)
  const plan = loadNative().runWasmConcernFix(WASM_PATH, key, dir, before, {})
  for (const edit of plan.edits) {
    await applyPlanEdit(edit, dir, { cwd: dir, ruleId: meta.ruleId, concernId: meta.concernId })
  }
  const after = withDefaultSeverity(loadNative().runWasmConcern(WASM_PATH, key, dir, null).violations)
  return { before, edits: plan.edits, after }
}

/**
 * Таймаут тестів, що спавнять `conftest` (канонічна половина парності).
 * Дефолтні 5 с не покривають ХОЛОДНИЙ перший спавн (резолв піна + запуск
 * Go-бінарника) — саме він, а не сама оцінка policy, займає більшість часу;
 * решта викликів у прогоні вкладається на порядок швидше. Явне число тут —
 * щоб холодний старт не читався як «тест завис».
 */
const CONFTEST_SPAWN_TIMEOUT_MS = 120_000

describe('wasm-plugin parity — §2.78 rego-детект шести концернів (conftest-канон vs host-import rego-engine)', () => {
  test(
    'js/vscode_extensions: бракує однієї рекомендації → ідентичні violations',
    async () => {
      await withTmpDir(async dir => {
        await writeFileDeep(dir, '.vscode/extensions.json', '{\n  "recommendations": ["dbaeumer.vscode-eslint"]\n}\n')
        const { js, wasm } = await runSingleFilePolicyBoth(JS_VSCODE_EXTENSIONS_CONCERN_KEY, dir)
        expect(wasm).toEqual(js)
        expect(js).toHaveLength(1)
        expect(js[0].message).toContain('oxc.oxc-vscode')
        expect(js[0].file).toBe('.vscode/extensions.json')
      })
    },
    CONFTEST_SPAWN_TIMEOUT_MS
  )

  test(
    'js/vscode_extensions: файлу немає — обидві реалізації дають ту саму policy-file-missing (required: true)',
    async () => {
      await withTmpDir(async dir => {
        await writeFileDeep(dir, 'package.json', '{}\n')
        const { js, wasm } = await runSingleFilePolicyBoth(JS_VSCODE_EXTENSIONS_CONCERN_KEY, dir)
        expect(wasm).toEqual(js)
        expect(js).toHaveLength(1)
        expect(js[0].reason).toBe('policy-file-missing')
      })
    },
    CONFTEST_SPAWN_TIMEOUT_MS
  )

  test(
    'style/vscode_extensions: файлу немає — БЕЗ required обидві мовчать (розходження concern.json тієї самої родини)',
    async () => {
      await withTmpDir(async dir => {
        await writeFileDeep(dir, 'package.json', '{}\n')
        const { js, wasm } = await runSingleFilePolicyBoth(STYLE_VSCODE_EXTENSIONS_CONCERN_KEY, dir)
        expect(wasm).toEqual(js)
        expect(js).toEqual([])
      })
    },
    CONFTEST_SPAWN_TIMEOUT_MS
  )

  test(
    'js/package_json: type + engines + eslint-config нижче порогу → ідентичні violations',
    async () => {
      await withTmpDir(async dir => {
        await writeFileDeep(
          dir,
          'package.json',
          JSON.stringify(
            {
              name: 'x',
              type: 'commonjs',
              engines: { node: '>=20', bun: '>=1.2' },
              devDependencies: { '@nitra/eslint-config': '^3.1.0' }
            },
            null,
            2
          )
        )
        const { js, wasm } = await runSingleFilePolicyBoth(JS_PACKAGE_JSON_CONCERN_KEY, dir)
        expect(wasm).toEqual(js)
        expect(js.length).toBeGreaterThanOrEqual(4)
      })
    },
    CONFTEST_SPAWN_TIMEOUT_MS
  )

  test(
    'js/package_json: eslint-config ВИЩЕ порогу — обидві мовчать (detect — це `>=`, не рівність)',
    async () => {
      await withTmpDir(async dir => {
        await writeFileDeep(
          dir,
          'package.json',
          JSON.stringify(
            {
              type: 'module',
              engines: { node: '>=24', bun: '>=1.4' },
              devDependencies: { '@nitra/eslint-config': '^3.20.0' }
            },
            null,
            2
          )
        )
        const { js, wasm } = await runSingleFilePolicyBoth(JS_PACKAGE_JSON_CONCERN_KEY, dir)
        expect(wasm).toEqual(js)
        expect(js).toEqual([])
      })
    },
    CONFTEST_SPAWN_TIMEOUT_MS
  )

  test(
    'npm-module/npm_package_json: files без "types" → ідентичні violations (і `.rego` компілюється під regorus після §2.78)',
    async () => {
      await withTmpDir(async dir => {
        await writeFileDeep(
          dir,
          'npm/package.json',
          JSON.stringify({ types: './types/index.d.ts', files: ['dist'] }, null, 2)
        )
        const { js, wasm } = await runSingleFilePolicyBoth(NPM_PACKAGE_JSON_CONCERN_KEY, dir)
        expect(wasm).toEqual(js)
        expect(js).toHaveLength(1)
        expect(js[0].message).toContain('types')
        expect(js[0].file).toBe('npm/package.json')
      })
    },
    CONFTEST_SPAWN_TIMEOUT_MS
  )

  test(
    'npm-module/root_package_json: немає workspaces → ідентичні violations; є — обидві мовчать',
    async () => {
      await withTmpDir(async dir => {
        await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root' }, null, 2))
        const bad = await runSingleFilePolicyBoth(ROOT_PACKAGE_JSON_CONCERN_KEY, dir)
        expect(bad.wasm).toEqual(bad.js)
        expect(bad.js).toHaveLength(1)

        await writeFileDeep(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['npm'] }, null, 2))
        const good = await runSingleFilePolicyBoth(ROOT_PACKAGE_JSON_CONCERN_KEY, dir)
        expect(good.wasm).toEqual(good.js)
        expect(good.js).toEqual([])
      })
    },
    CONFTEST_SPAWN_TIMEOUT_MS
  )

  test(
    'style/package_json: чужий stylelint.extends + відсутній devDep → ідентичні violations',
    async () => {
      await withTmpDir(async dir => {
        await writeFileDeep(dir, 'package.json', JSON.stringify({ stylelint: { extends: 'wrong' } }, null, 2))
        const { js, wasm } = await runSingleFilePolicyBoth(STYLE_PACKAGE_JSON_CONCERN_KEY, dir)
        expect(wasm).toEqual(js)
        expect(js).toHaveLength(2)
      })
    },
    CONFTEST_SPAWN_TIMEOUT_MS
  )
})

describe('wasm-plugin parity — §2.78 T0-фікс через РЕАЛЬНИЙ napi-міст (детект гостем → runWasmConcernFix → applyPlanEdit → детект чистий)', () => {
  test('js/vscode_extensions: відсутній файл створюється, повторний детект мовчить', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{}\n')
      const { before, edits, after } = await runWasmFixCycle(JS_VSCODE_EXTENSIONS_CONCERN_KEY, dir)
      expect(before).toHaveLength(1)
      expect(edits).toHaveLength(1)
      expect(after).toEqual([])
      expect(await readFile(join(dir, '.vscode/extensions.json'), 'utf8')).toBe(
        '{\n  "recommendations": [\n    "dbaeumer.vscode-eslint",\n    "oxc.oxc-vscode"\n  ]\n}\n'
      )
    })
  })

  test('style/vscode_extensions: канонічне розширення дописується в ХВІСТ, чужі лишаються на місці', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, '.vscode/extensions.json', '{\n  "recommendations": ["local.only"]\n}\n')
      const { edits, after } = await runWasmFixCycle(STYLE_VSCODE_EXTENSIONS_CONCERN_KEY, dir)
      expect(edits).toHaveLength(1)
      expect(after).toEqual([])
      expect(await readFile(join(dir, '.vscode/extensions.json'), 'utf8')).toBe(
        '{\n  "recommendations": [\n    "local.only",\n    "stylelint.vscode-stylelint"\n  ]\n}\n'
      )
    })
  })

  test('js/package_json: фікс НЕ збиває `@nitra/eslint-config` ^3.20.0 назад на поріг ^3.10.0 (полагоджена асиметрія канону)', async () => {
    await withTmpDir(async dir => {
      // Той самий вхід, на якому JS-канон (`createTemplateFixPattern`)
      // мерджить лист ТОЧНОЮ рівністю і мовчки ПОГІРШУЄ файл.
      await writeFileDeep(
        dir,
        'package.json',
        JSON.stringify(
          {
            name: 'x',
            type: 'commonjs',
            engines: { node: '>=24', bun: '>=1.4' },
            devDependencies: { '@nitra/eslint-config': '^3.20.0' }
          },
          null,
          2
        ) + '\n'
      )
      const { before, edits, after } = await runWasmFixCycle(JS_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(before.map(v => v.message)).toEqual(['package.json: "type" має бути "module" (js.mdc)'])
      expect(edits).toHaveLength(1)
      expect(after).toEqual([])
      const written = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(written.devDependencies['@nitra/eslint-config']).toBe('^3.20.0')
      expect(written.type).toBe('module')
    })
  })

  test('js/package_json: версія НИЖЧА за поріг — фікс підтягує її до канону', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'package.json',
        JSON.stringify(
          {
            type: 'module',
            engines: { node: '>=24', bun: '>=1.4' },
            devDependencies: { '@nitra/eslint-config': '^3.1.0' }
          },
          null,
          2
        ) + '\n'
      )
      const { after } = await runWasmFixCycle(JS_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(after).toEqual([])
      const written = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      expect(written.devDependencies['@nitra/eslint-config']).toBe('^3.10.0')
    })
  })

  test('npm-module/root_package_json: workspaces дописується, порядок наявних ключів не тасується', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{\n  "zzz": 1,\n  "name": "root",\n  "aaa": 2\n}\n')
      const { after } = await runWasmFixCycle(ROOT_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(after).toEqual([])
      const text = await readFile(join(dir, 'package.json'), 'utf8')
      expect(text.indexOf('"zzz"')).toBeLessThan(text.indexOf('"name"'))
      expect(text.indexOf('"name"')).toBeLessThan(text.indexOf('"aaa"'))
      expect(JSON.parse(text).workspaces).toEqual(['npm'])
    })
  })

  test('npm-module/npm_package_json: "types" дописується у наявний масив files, повторний детект мовчить', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'npm/package.json',
        JSON.stringify({ types: './types/index.d.ts', files: ['dist'] }, null, 2) + '\n'
      )
      const { after } = await runWasmFixCycle(NPM_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(after).toEqual([])
      expect(JSON.parse(await readFile(join(dir, 'npm/package.json'), 'utf8')).files).toEqual(['dist', 'types'])
    })
  })

  test('глоб контрибуції годує й fix (§2.72): план непорожній САМЕ через full-scope batch хоста, не через дельту', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', JSON.stringify({ stylelint: { extends: 'wrong' } }, null, 2) + '\n')
      // `runWasmConcernFix` без шостого аргумента (дельти) — рівно
      // продакшн-виклик full-scope концерну: batch будує хост за глобом.
      const { edits } = await runWasmFixCycle(STYLE_PACKAGE_JSON_CONCERN_KEY, dir)
      expect(edits).toHaveLength(1)
      expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).stylelint.extends).toBe(
        '@nitra/stylelint-config'
      )
    })
  })

  test('побитий JSON у таргеті: план ПОРОЖНІЙ — файл не перезаписується сміттям, порушення лишається видимим', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, '.vscode/extensions.json', '{ це не json')
      const { edits } = await runWasmFixCycle(JS_VSCODE_EXTENSIONS_CONCERN_KEY, dir)
      expect(edits).toEqual([])
      expect(await readFile(join(dir, '.vscode/extensions.json'), 'utf8')).toBe('{ це не json')
    })
  })
})

// =====================================================================
// §2.80 — решта конфіг-подібних концернів `plugin-lang-js`.
//
// Чотири з пʼяти — той самий rego-канон через `conftest`
// ([`runSingleFilePolicyBoth`]), тож і шар парності той самий. Дві
// відмінності від §2.78, які саме тут і перевіряються:
//
//  - `js-run/jsconfig` — `files.walkGlob`, тобто БАГАТОФАЙЛОВИЙ концерн:
//    канон обходить дерево й міряє кожен `jsconfig.json` окремо, і порт
//    мусить дати ті самі violations із тими самими `file`;
//  - `style/tooling` — канон НЕ policy-адаптер, а власний `main.mjs`
//    (детект портовано ще батчем 8); §2.80 добудовує лише fix-половину,
//    тому його гейт — T0-цикл через реальний napi-міст.
// =====================================================================

describe('wasm-plugin parity — §2.80 rego-детект (conftest-канон vs host-import rego-engine)', () => {
  test('style/vscode_settings: чуже значення css.validate → ідентичні violations', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, '.vscode/settings.json', '{\n  "css.validate": true\n}\n')
      const { js, wasm } = await runSingleFilePolicyBoth(STYLE_VSCODE_SETTINGS_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js.length).toBeGreaterThanOrEqual(1)
      expect(js[0].file).toBe('.vscode/settings.json')
    })
  }, CONFTEST_SPAWN_TIMEOUT_MS)

  test('style/vscode_settings: файлу немає — БЕЗ required обидві мовчать', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{}\n')
      const { js, wasm } = await runSingleFilePolicyBoth(STYLE_VSCODE_SETTINGS_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  }, CONFTEST_SPAWN_TIMEOUT_MS)

  test('js/jscpd_config: minLines ВИЩЕ порогу — обидві мовчать про нього (detect — це `>=`, не рівність)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        '.jscpd.json',
        JSON.stringify(
          {
            gitignore: true,
            exitCode: 1,
            reporters: ['console'],
            minLines: 40,
            ignore: ['.claude/worktrees/**', '**/dist/**', '**/CHANGELOG.md']
          },
          null,
          2
        )
      )
      const { js, wasm } = await runSingleFilePolicyBoth(JSCPD_CONFIG_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  }, CONFTEST_SPAWN_TIMEOUT_MS)

  test('js/jscpd_config: файлу немає — обидві дають ту саму policy-file-missing (required: true)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{}\n')
      const { js, wasm } = await runSingleFilePolicyBoth(JSCPD_CONFIG_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('policy-file-missing')
    })
  }, CONFTEST_SPAWN_TIMEOUT_MS)

  test('npm-module/emit_types_config: чуже значення leaf-а → ідентичні violations', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'npm/tsconfig.emit-types.json',
        JSON.stringify({ compilerOptions: { allowJs: false } }, null, 2)
      )
      const { js, wasm } = await runSingleFilePolicyBoth(EMIT_TYPES_CONFIG_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js.length).toBeGreaterThanOrEqual(1)
      expect(js[0].file).toBe('npm/tsconfig.emit-types.json')
    })
  }, CONFTEST_SPAWN_TIMEOUT_MS)

  test('js-run/jsconfig (walkGlob): КОЖЕН jsconfig.json дерева міряється окремо — ідентичні violations із тими самими file', async () => {
    await withTmpDir(async dir => {
      // Кореневий файл тут не випадковий: `**/jsconfig.json` мусить
      // матчити і його (gitignore-семантика канону vs `globset` хоста).
      await writeFileDeep(dir, 'jsconfig.json', JSON.stringify({ compilerOptions: { target: 'es2020' } }, null, 2))
      await writeFileDeep(dir, 'packages/b/jsconfig.json', JSON.stringify({ include: ['lib/**/*'] }, null, 2))
      const { js, wasm } = await runSingleFilePolicyBoth(JSCONFIG_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      const files = [...new Set(js.map(v => v.file))].toSorted()
      expect(files).toEqual(['jsconfig.json', 'packages/b/jsconfig.json'])
    })
  }, CONFTEST_SPAWN_TIMEOUT_MS)

  test('js-run/jsconfig: жодного jsconfig.json — обидві мовчать (walkGlob не має required-гілки)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{}\n')
      const { js, wasm } = await runSingleFilePolicyBoth(JSCONFIG_CONCERN_KEY, dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  }, CONFTEST_SPAWN_TIMEOUT_MS)
})

describe('wasm-plugin parity — §2.80 T0-фікс через РЕАЛЬНИЙ napi-міст', () => {
  test('style/vscode_settings: канонічні поля дописуються, локальні лишаються, повторний детект мовчить', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, '.vscode/settings.json', '{\n  "editor.tabSize": 2,\n  "css.validate": true\n}\n')
      const { edits, after } = await runWasmFixCycle(STYLE_VSCODE_SETTINGS_CONCERN_KEY, dir)
      expect(edits).toHaveLength(1)
      expect(after).toEqual([])
      const written = JSON.parse(await readFile(join(dir, '.vscode/settings.json'), 'utf8'))
      expect(written['editor.tabSize']).toBe(2)
      expect(written['css.validate']).toBe(false)
      expect(written['scss.validate']).toBe(false)
    })
  })

  test('js/jscpd_config: фікс НЕ збиває minLines 40 назад на поріг 25 (полагоджена асиметрія канону)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        '.jscpd.json',
        JSON.stringify({ gitignore: false, exitCode: 1, reporters: ['console'], minLines: 40 }, null, 2) + '\n'
      )
      const { before, edits, after } = await runWasmFixCycle(JSCPD_CONFIG_CONCERN_KEY, dir)
      expect(before.length).toBeGreaterThan(0)
      expect(edits).toHaveLength(1)
      expect(after).toEqual([])
      const written = JSON.parse(await readFile(join(dir, '.jscpd.json'), 'utf8'))
      expect(written.minLines).toBe(40)
      expect(written.gitignore).toBe(true)
    })
  })

  test('js/jscpd_config: відсутній файл створюється ВЕРБАТИМ зі снапшота, повторний детект мовчить', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{}\n')
      const { edits, after } = await runWasmFixCycle(JSCPD_CONFIG_CONCERN_KEY, dir)
      expect(edits).toHaveLength(1)
      expect(after).toEqual([])
      expect(JSON.parse(await readFile(join(dir, '.jscpd.json'), 'utf8')).minLines).toBe(25)
    })
  })

  test('npm-module/emit_types_config: leaf підтягується до канону, повторний детект мовчить', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'npm/tsconfig.emit-types.json',
        JSON.stringify({ compilerOptions: { allowJs: false, strict: true } }, null, 2) + '\n'
      )
      const { after } = await runWasmFixCycle(EMIT_TYPES_CONFIG_CONCERN_KEY, dir)
      expect(after).toEqual([])
      const written = JSON.parse(await readFile(join(dir, 'npm/tsconfig.emit-types.json'), 'utf8'))
      expect(written.compilerOptions.allowJs).toBe(true)
      expect(written.compilerOptions.strict).toBe(true)
    })
  })

  test('js-run/jsconfig: фікс править ОБИДВА файли дерева одним планом, повторний детект мовчить', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'jsconfig.json', JSON.stringify({ compilerOptions: { target: 'es2020' } }, null, 2))
      await writeFileDeep(dir, 'packages/b/jsconfig.json', JSON.stringify({ include: ['lib/**/*'] }, null, 2))
      const { edits, after } = await runWasmFixCycle(JSCONFIG_CONCERN_KEY, dir)
      expect(edits).toHaveLength(2)
      expect(after).toEqual([])
      // `include` ЗАМІНЮЄТЬСЯ (rego порівнює множини на рівність), а не
      // мерджиться union-ом — інакше концерн лишався б червоним назавжди.
      expect(JSON.parse(await readFile(join(dir, 'packages/b/jsconfig.json'), 'utf8')).include).toEqual(['src/**/*'])
    })
  })

  test('style/tooling: детект гостем → фікс гостем → детект чистий (глоб контрибуції годує й fix, §2.72)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'package.json', '{\n  "name": "x"\n}\n')
      const { before, edits, after } = await runWasmFixCycle(STYLE_TOOLING_CONCERN_KEY, dir)
      expect(before).toHaveLength(2)
      expect(edits).toHaveLength(2)
      expect(after).toEqual([])
      expect(await readFile(join(dir, '.stylelintignore'), 'utf8')).toContain('dist/')
      expect(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).stylelint.extends).toBe(
        '@nitra/stylelint-config'
      )
    })
  })
})

describe('wasm-plugin — size-budget (задача Q3, спека `docs/specs/2026-08-01-wasm-ast-strategy.md`, розділ «Рішення» п.2)', () => {
  test(`plugin_lang_js.wasm не перевищує бюджет ${WASM_SIZE_BUDGET_LABEL}`, async () => {
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

// --- §2.86: `js/eslint` — ПЕРШИЙ споживач `fix-only-concerns` -------------
//
// Два твердження, і друге важливіше за перше:
//
// 1. fix РЕАЛЬНО їде в гостя — повний T0-цикл через справжній napi-міст
//    (`runWasmConcernFix`, §2.47/§2.49: прямий виклик гостя тут не довів би
//    нічого, бо гість повертає ПОРОЖНІЙ план, а edits синтезує host-diff);
// 2. detect НЕ зашедоуєно — `main.mjs` концерну і далі виконується.
//
// Друге — весь сенс мажора `4.0.0`: ключ у `describe().concerns` вимкнув би
// `main.mjs` МОВЧКИ (`detect.mjs`, гілка `wasmEntry !== undefined`).
//
// Тули — фейки, як у `style/lint`: справжні `oxlint`/`eslint` зробили б
// «однаково недетерміновано» замість «однаково». `tee` — навпаки,
// НЕ фейк: він і є та поверхня, якою гість кладе механічну заміну на диск,
// тож підміна його скриптом сховала б рівно те, що тест доводить.
const JS_ESLINT_CONCERN_KEY = 'js/eslint'

/** Реальний `tee` — `path:`-схема резолвить його по PATH так само. */
const REAL_TEE_PATH = ['/usr/bin/tee', '/bin/tee'].find(candidate => existsSync(candidate)) ?? '/usr/bin/tee'

/**
 * Фейковий лінтер-скрипт (§2.100 — `npm:eslint`/`npm:oxlint`, кожен своїм
 * бінарником, а не спільний `bunx`): `$1` — `--fix` (скидається), решта —
 * файли. Дописує маркер `marker` у КОЖЕН переданий файл, тож підсумковий
 * вміст свідчить і про факт спавну, і про ПОРЯДОК кроків гостя
 * (`oxlint` → `eslint`, доккомент [`OXLINT_TOOL`]/[`ESLINT_TOOL`] у
 * `crates/plugin-lang-js/src/lib.rs`).
 * @param {string} marker текст маркера (ім'я лінтера)
 * @returns {string} тіло sh-скрипта
 */
const fakeLinterBody = marker =>
  `#!/bin/sh\nshift 1\nfor f in "$@"; do printf '// %s\\n' '${marker}' >> "$f"; done\nexit 0\n`

/** Діагностика механічного правила — рівно та форма, що її дає `main.mjs` (`data: { line, tool }`). */
const mechanicalDiagnostic = (file, line) => ({
  reason: 'unicorn/prefer-number-is-safe-integer',
  message: 'Prefer `Number.isSafeInteger()` (eslint)',
  file,
  severity: 'error',
  data: { line, tool: 'eslint' }
})

/** Звичайна (немеханічна) діагностика того ж концерну. */
const plainDiagnostic = file => ({
  reason: 'no-unused-vars',
  message: "'x' is defined but never used (eslint)",
  file,
  severity: 'error',
  data: { line: 1, tool: 'eslint' }
})

/**
 * Кладе фейкові `eslint`/`oxlint` у tmp-дерево й повертає `toolPaths`, який
 * для схем `npm:eslint`/`npm:oxlint`/`path:tee` побудувала б
 * `ensureDeclaredTools` (§2.100 замінила спільний `path:bunx` двома
 * окремими записами — доккомент [`ESLINT_TOOL`]/[`OXLINT_TOOL`] у
 * `crates/plugin-lang-js/src/lib.rs`).
 * @param {string} dir абсолютний шлях tmp-каталогу
 * @param {{ eslintBody?: string, oxlintBody?: string }} [opts] тіла фейкових скриптів (дефолт — маркер з іменем лінтера)
 * @returns {Promise<Record<string, string>>} мапа `toolPaths`
 */
async function installEslintTools(dir, opts = {}) {
  const { eslintBody = fakeLinterBody('eslint'), oxlintBody = fakeLinterBody('oxlint') } = opts
  const { mkdir } = await import('node:fs/promises')
  const binDir = join(dir, 'fake-bin')
  await mkdir(binDir, { recursive: true })
  const eslint = await writeFakeTool(join(binDir, 'eslint'), eslintBody)
  const oxlint = await writeFakeTool(join(binDir, 'oxlint'), oxlintBody)
  return { eslint, oxlint, tee: REAL_TEE_PATH }
}

describe('wasm-plugin — js/eslint T0-фікс через fix-міст (fix-only контрибуція, exec-tool + host-diff)', () => {
  test('обидва патерни канону: механічна заміна лягає ПЕРЕД лінтерами, host-diff синтезує write', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.mjs'), 'export const ok = x => Number.isInteger(x)\n')
      await writeFile(join(dir, 'untouched.mjs'), 'export const b = 1\n')
      const toolPaths = await installEslintTools(dir)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        JS_ESLINT_CONCERN_KEY,
        dir,
        [mechanicalDiagnostic('a.mjs', 1)],
        toolPaths,
        ['a.mjs']
      )

      // Порядок маркерів — і є доказ послідовності кроків гостя:
      // `tee` (механічна заміна) → `oxlint --fix` → `eslint --fix`.
      const expected = 'export const ok = x => Number.isSafeInteger(x)\n// oxlint\n// eslint\n'
      expect(plan.edits).toEqual([{ type: 'write', path: 'a.mjs', content: expected }])
      for (const edit of plan.edits)
        await applyPlanEdit(edit, dir, { cwd: dir, ruleId: 'js', concernId: 'eslint' })
      expect(await readFile(join(dir, 'a.mjs'), 'utf8')).toBe(expected)
      // `per-file` контрибуція звузила спавн до дельти: файл поза нею не чіпається.
      expect(await readFile(join(dir, 'untouched.mjs'), 'utf8')).toBe('export const b = 1\n')
    })
  })

  test('немеханічне порушення: гість спавнить лише лінтери, механічного запису немає', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.mjs'), 'export const ok = x => Number.isInteger(x)\n')
      const toolPaths = await installEslintTools(dir)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        JS_ESLINT_CONCERN_KEY,
        dir,
        [plainDiagnostic('a.mjs')],
        toolPaths,
        ['a.mjs']
      )

      // `Number.isInteger` лишився: механічна заміна прив'язана до reason-у
      // діагностики, а не до вмісту рядка (порт `mechanicalFixFor`).
      expect(plan.edits).toEqual([
        { type: 'write', path: 'a.mjs', content: 'export const ok = x => Number.isInteger(x)\n// oxlint\n// eslint\n' }
      ])
    })
  })

  test('лінтери нічого не змінили — план порожній, JS-fallback лишається робочим', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.mjs'), 'export const b = 1\n')
      const toolPaths = await installEslintTools(dir, {
        eslintBody: '#!/bin/sh\nexit 0\n',
        oxlintBody: '#!/bin/sh\nexit 0\n'
      })

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        JS_ESLINT_CONCERN_KEY,
        dir,
        [plainDiagnostic('a.mjs')],
        toolPaths,
        ['a.mjs']
      )
      expect(plan.edits).toEqual([])
    })
  })

  test('жодна діагностика не називає JS-файл — тули не спавняться, план порожній', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.mjs'), 'export const b = 1\n')
      // Скрипт затер би будь-який файл, якби його взагалі запустили.
      const toolPaths = await installEslintTools(dir)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        JS_ESLINT_CONCERN_KEY,
        dir,
        [{ ...plainDiagnostic('README.md') }],
        toolPaths,
        ['a.mjs']
      )
      expect(plan.edits).toEqual([])
      expect(await readFile(join(dir, 'a.mjs'), 'utf8')).toBe('export const b = 1\n')
    })
  })

  /**
   * `tee` не резолвиться — механічна заміна НЕ застосована (гість каже це
   * `LogLevel::Error`), але лінтери все одно відпрацювали. Тест фіксує саме
   * деградацію, а не «все одно зелено»: у плані видно, що `Number.isInteger`
   * лишився.
   */
  test('tee не резолвиться — механічна заміна відпадає, лінтери працюють далі', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.mjs'), 'export const ok = x => Number.isInteger(x)\n')
      const { eslint, oxlint } = await installEslintTools(dir)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        JS_ESLINT_CONCERN_KEY,
        dir,
        [mechanicalDiagnostic('a.mjs', 1)],
        { eslint, oxlint },
        ['a.mjs']
      )
      expect(plan.edits).toEqual([
        { type: 'write', path: 'a.mjs', content: 'export const ok = x => Number.isInteger(x)\n// oxlint\n// eslint\n' }
      ])
    })
  })

  /**
   * Повний прогін (`deltaFiles: undefined`): batch хост будує сам глобом
   * контрибуції — гілка, яка до полагодження `Manifest::fix_contribution`
   * (`crates/rules-napi`) падала `ambiguous_empty_fix_batch_err`, бо
   * контрибуцію шукали ЛИШЕ у `describe().concerns`. Цілі при цьому
   * лишаються з діагностик, як у канону, — `b.mjs` без порушень не
   * чіпається.
   */
  test('повний режим: контрибуція резолвиться з fix_only_concerns, цілі — з діагностик', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.mjs'), 'export const ok = x => Number.isInteger(x)\n')
      await writeFile(join(dir, 'b.mjs'), 'export const b = 1\n')
      const toolPaths = await installEslintTools(dir)

      const plan = loadNative().runWasmConcernFix(
        WASM_PATH,
        JS_ESLINT_CONCERN_KEY,
        dir,
        [mechanicalDiagnostic('a.mjs', 1)],
        toolPaths,
        undefined
      )

      expect(plan.edits).toEqual([
        {
          type: 'write',
          path: 'a.mjs',
          content: 'export const ok = x => Number.isSafeInteger(x)\n// oxlint\n// eslint\n'
        }
      ])
      expect(await readFile(join(dir, 'b.mjs'), 'utf8')).toBe('export const b = 1\n')
    })
  })
})

// --- §2.86: доказ, що detect НЕ зашедоуєно -------------------------------
//
// Твердження перевіряється тим самим шляхом, яким ходить прод —
// `runConcernDetector` (`detect.mjs`), із РЕАЛЬНИМ wasm-плагіном у
// `.n-rules.json`. Концерн підставляється stub-ом `main.mjs`, що віддає
// маркерне порушення: якщо гілка `wasmEntry !== undefined` спрацює, stub
// не виконається взагалі й маркера не буде.
//
// Контроль (другий тест) — ТОЙ САМИЙ stub під ключем `vue/tfm-translations`,
// який у `concerns` Є: там stub мусить бути зашедоуєний. Без контролю
// перший тест доводив би лише «stub виконався», а не «саме fix-only список
// шедоуїнг не вмикає».
describe('wasm-plugin — js/eslint: fix-only контрибуція НЕ шедоуїть detect (§2.86)', () => {
  const SENTINEL_REASON = 'stub-main-mjs-executed'
  const STUB_MAIN_MJS =
    'export async function lint(ctx) {\n' +
    `  return { violations: [{ reason: '${SENTINEL_REASON}', message: 'stub', file: ctx.files?.[0] ?? null }] }\n` +
    '}\n'

  /**
   * Готує stub `main.mjs` для заданого концерну й ганяє `runConcernDetector`
   * — той самий шлях, яким ходить прод.
   * @param {string} dir абсолютний шлях tmp-репо (уже з `.n-rules.json` і `a.mjs`)
   * @param {string} ruleId id правила
   * @param {string} concernId id концерну
   * @returns {Promise<{ violations: Array<{ reason: string }> }>} результат детектора
   */
  async function detectWithStubMain(dir, ruleId, concernId) {
    const { mkdir } = await import('node:fs/promises')
    const concernDir = join(dir, `concern-${ruleId}-${concernId}`)
    await mkdir(concernDir, { recursive: true })
    await writeFile(join(concernDir, 'main.mjs'), STUB_MAIN_MJS, 'utf8')
    const { runConcernDetector } = await import('../detect.mjs')
    return runConcernDetector({ dir: concernDir }, { cwd: dir, ruleId, concernId, files: ['a.mjs'] })
  }

  /**
   * Обидва твердження — в ОДНОМУ tmp-репо навмисно: `resolveWasmConcernMap`
   * мемоізується за `cwd`, а перший резолв інстанціює ВСІ builtin-компоненти
   * (`npm/wasm-plugins/builtin-pins.json`) і резолвить їхні тули — секунди,
   * не мілісекунди. Окремі каталоги платили б цю ціну двічі й упирались у
   * дефолтний таймаут vitest.
   *
   * Контрольне твердження (друге) — не декорація: без нього перше доводило б
   * лише «stub виконався», а не «саме fix-only список шедоуїнг НЕ вмикає».
   */
  test(
    'main.mjs концерну виконується (js/eslint), а концерн зі списку `concerns` свій main.mjs ТАКИ втрачає',
    async () => {
      await withTmpDir(async dir => {
        await writeFile(
          join(dir, '.n-rules.json'),
          JSON.stringify({ wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
          'utf8'
        )
        await writeFile(join(dir, 'a.mjs'), 'export const b = 1\n', 'utf8')

        const fixOnly = await detectWithStubMain(dir, 'js', 'eslint')
        expect(fixOnly.violations.map(v => v.reason)).toEqual([SENTINEL_REASON])

        const shadowed = await detectWithStubMain(dir, 'vue', 'tfm-translations')
        expect(shadowed.violations.map(v => v.reason)).not.toContain(SENTINEL_REASON)
      })
    },
    120_000
  )
})

/**
 * §2.87 — fix-половина storybook-пари через РЕАЛЬНИЙ napi-міст.
 *
 * Тест сторожить не лише вміст плану, а сам МІСТ: обидва концерни —
 * перші споживачі непорожнього `fix-glob`, і саме цей тест ловить регрес
 * «хост знову звузив fix-батч до шляхів діагностик». Симптом там був би
 * підступний: план не падає, а ТИХНЕ (порожній `edits`), гейт
 * `edits.length > 0` не пускає гість-пріоритет, і JS-канон робить фікс
 * удруге — жодного червоного без цієї перевірки.
 */
describe('wasm-plugin parity — §2.87 storybook-пара T0-фікс через fix-міст', () => {
  const fixCtx = (dir, concernId) => ({ cwd: dir, ruleId: 'test', concernId })

  test('storybook-ci: обидва .github-файли ВІДСУТНІ (батч із самих діагностик був би порожній) — план несе матрицю пакетів у скоупі', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, STORYBOOK_CI_CONCERN_KEY, dir, null).violations
      )
      expect(before.map(v => v.reason)).toEqual(['missing-playwright-action', 'missing-storybook-workflow'])

      const plan = loadNative().runWasmConcernFix(WASM_PATH, STORYBOOK_CI_CONCERN_KEY, dir, before, {})
      expect(plan.edits.map(e => e.path)).toEqual([
        '.github/actions/setup-playwright-chromium/action.yml',
        '.github/workflows/lint-storybook.yml'
      ])
      for (const edit of plan.edits) await applyPlanEdit(edit, dir, fixCtx(dir, 'storybook-ci'))

      const workflow = await readFile(join(dir, '.github/workflows/lint-storybook.yml'), 'utf8')
      expect(workflow).toContain('          - packages/ui\n')
      expect(workflow).not.toContain('__STORYBOOK_CI_PACKAGE_DIRS__')

      const again = loadNative().runWasmConcern(WASM_PATH, STORYBOOK_CI_CONCERN_KEY, dir, null)
      expect(again.violations).toEqual([])
    })
  })

  test('storybook-scaffold: план створює канонічний скафолд і дописує scripts.storybook, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      await writeStorybookLibraryFixture(dir)

      const before = withDefaultSeverity(
        loadNative().runWasmConcern(WASM_PATH, STORYBOOK_SCAFFOLD_CONCERN_KEY, dir, null).violations
      )
      expect(before.map(v => v.reason)).toEqual([
        'missing-main-js',
        'missing-preview-js',
        'missing-empty-vite-config',
        'missing-vitest-setup-js',
        'missing-storybook-script'
      ])

      const plan = loadNative().runWasmConcernFix(WASM_PATH, STORYBOOK_SCAFFOLD_CONCERN_KEY, dir, before, {})
      for (const edit of plan.edits) await applyPlanEdit(edit, dir, fixCtx(dir, 'storybook-scaffold'))

      // Глоб звузився до src/components/ — саме та перевірка, заради якої
      // fix-скоуп ШИРШИЙ за детект-глоб (`**/src/components/**`).
      const mainJs = await readFile(join(dir, 'packages/ui/.storybook/main.js'), 'utf8')
      expect(mainJs).toContain("'../src/components/**/*.stories.@(js|ts)'")

      const pkg = JSON.parse(await readFile(join(dir, 'packages/ui/package.json'), 'utf8'))
      expect(pkg.scripts.storybook).toBe('storybook dev -p 6006 --no-open')
      // Ключі консюмера лишились на місці й у ТОМУ САМОМУ порядку
      // (регрес hash-порядку `parse_jsonc_document`, §2.87).
      expect(Object.keys(pkg)).toEqual(['name', 'peerDependencies', 'scripts'])

      const again = loadNative().runWasmConcern(WASM_PATH, STORYBOOK_SCAFFOLD_CONCERN_KEY, dir, null)
      expect(again.violations).toEqual([])
    })
  })
})

// =====================================================================
// §2.93 — ЗНЯТТЯ JS-КАНОНІВ ФІКСУ: девʼятнадцять `fix-<concern>.mjs` видалено
// з `plugins/lang-js` (борг «спершу парність»; зразок — §2.88, пілот на
// `plugins/lang-php`, табличні форми — §2.89/§2.90).
//
// Разом із каноном зникає не тест, а ПОВЕРХНЯ: `loadT0Patterns`
// (`run-fix.mjs`) резолвить фіксери у порядку native → wasm (`guestFix`)
// → `fix-<concern>.mjs`, і третій шар був глушником випадку «гість не
// резолвиться» (плагін не зібрано, розбіжність піна, хост без wasm).
// Глушника більше немає — концерн деградує з «автофікс» у «повідомили й
// віддали в LLM-ладдер». Саме це диктує форму гейта: перевіряється не
// відсутність файлу, а СКЛАД резолву тим самим резолвером, яким ходить
// прод:
//
// - два патерни  → канон повернувся (подвійний фікс, пастка §2.72);
// - нуль патернів → зник ГІСТЬ, тобто `--fix` МОВЧКИ перестав фіксити
//   концерн, і він тихо поїхав би в дорогий LLM-ладдер.
//
// `existsSync` на видаленому файлі ловив би лише перше з двох.
//
// ЧОМУ ТУТ ТРИ ТВЕРДЖЕННЯ, А НЕ ДВА, ЯК У §2.90. Там другим твердженням
// таблиця звірялась із ЖИВИМ маніфестом у бік «кожен концерн маніфеста
// або в таблиці, або у свідомому виключенні»; у `ci-github` це працювало,
// бо ВСІ вісімнадцять концернів гостя мали фікс. У `lang-js` фікс має
// меншість із пʼятдесяти — решта суто детект-концерни, і той самий бік
// звірки дав би тридцять «виключень», тобто шум замість гейта. Тому
// живих джерел два, кожне зі свого боку:
//
// - твердження 2 — з боку ГОСТЯ: кожен ключ таблиці мусить бути в живому
//   маніфесті (`concerns` ∪ `fix_only_concerns`); перейменований чи
//   знятий у гості ключ валить гейт, а не тихо проходить через
//   «нуль патернів» разом із рештою;
// - твердження 3 — з боку ДИСКА: набір уцілілих `fix-*.mjs` плагіна
//   мусить дорівнювати рівно ДВОМ ІМЕНОВАНИМ винятками. Новий канон для
//   портованого концерну (чи повернений старий) валить гейт навіть якщо
//   його ключа в таблиці немає — саме та дірка, яку сама лише таблиця
//   лишає відкритою.
//
// Це заразом ЄДИНІ тести цього файлу, що йдуть через `loadT0Patterns` —
// решта кличе `runWasmConcernFix` напряму й цю поверхню обходить.
// =====================================================================

/** Корінь `rules/` плагіна `lang-js` — спільний для трьох тверджень гейта. */
const LANG_JS_RULES_DIR = join(REPO_ROOT, 'plugins', 'lang-js', 'rules')

/**
 * Девʼятнадцять концернів `plugins/lang-js`, чий T0-фікс живе ВИКЛЮЧНО в
 * гості `crates/plugin-lang-js` — рівно ті, чий `fix-<concern>.mjs` знято
 * §2.93. Список зібрано обходом `Guest::fix` (гілки `match` на
 * `CONCERN_*`), `POLICY_CONFIGS`, `TEMPLATE_FIX_CONFIGS` і
 * `fix_only_concerns`, не пошуком рядкових літералів.
 * @type {Array<{ ruleId: string, concern: string }>}
 */
const FIX_ONLY_IN_GUEST = [
  { ruleId: 'bun', concern: 'layout' },
  { ruleId: 'bun', concern: 'licensee' },
  { ruleId: 'js', concern: 'check' },
  { ruleId: 'js', concern: 'doc_comments' },
  { ruleId: 'js', concern: 'jscpd_config' },
  { ruleId: 'js', concern: 'package_json' },
  { ruleId: 'js', concern: 'vscode_extensions' },
  { ruleId: 'js-run', concern: 'jsconfig' },
  { ruleId: 'js-run', concern: 'runtime' },
  { ruleId: 'npm-module', concern: 'emit_types_config' },
  { ruleId: 'npm-module', concern: 'npm_package_json' },
  { ruleId: 'npm-module', concern: 'root_package_json' },
  { ruleId: 'style', concern: 'lint' },
  { ruleId: 'style', concern: 'package_json' },
  { ruleId: 'style', concern: 'tooling' },
  { ruleId: 'style', concern: 'vscode_extensions' },
  { ruleId: 'style', concern: 'vscode_settings' },
  { ruleId: 'test', concern: 'storybook-ci' },
  { ruleId: 'test', concern: 'storybook-scaffold' },
  // §2.118 — ДРУГИЙ (після storybook-пари) споживач непорожнього `fix-glob`:
  // застарілий запис `FIX_STAYS_IN_JS` («napi-міст будує `FixRequest::files`
  // лише з полів `file` переданих violations») знято §2.102 — `explicit_fix_glob`
  // (`crates/rules-napi/src/lib.rs`) уже давав full-scope fix-батч, порту
  // бракувало лише самого коду (`fix_stryker_config`, доккомент у
  // `crates/plugin-lang-js/src/lib.rs`).
  { ruleId: 'test', concern: 'stryker_config' },
  // §2.92/§2.94/§2.119 — крок 5 спеки `docs/specs/2026-08-31-plugin-
  // contract-v5.md`: `n-rules:caps/file-reader@1.0.0` знімає ОБИДВА
  // блокери §2.92 (тип межі `source-file.content: string`, 124 MiB
  // `**/*`-batch), тож ЄДИНИЙ канон партії, зупинений НЕ порядковою
  // звіркою (як `js/eslint`), а структурним блокером — портований.
  { ruleId: 'bun', concern: 'package_json' }
]

/**
 * Два вцілілі `fix-<concern>.mjs` плагіна — кожен зі СВОЄЮ причиною, і
 * жодна з них не «ще не дійшли руки». Ключі — шлях відносно
 * `plugins/lang-js/rules/`. `bun/package_json` (§2.92 — колишній третій
 * запис) портований кроком 5 спеки `docs/specs/2026-08-31-plugin-
 * contract-v5.md` — запис знято, канон видалено разом із JS-каноном.
 * @type {Record<string, string>}
 */
const FIX_STAYS_IN_JS = {
  // §2.93 — ЄДИНИЙ канон партії, який зупинила ПОРЯДКОВА звірка, а не
  // відома незавершеність порту: канон гейтить на `bunx` лише `oxlint`, а
  // `eslint --fix` кличе programmatic API (`new ESLint({ cwd, fix: true })`
  // + `ESLint.outputFixes`), тобто резолвиться Node-модулем, не CLI-тулом
  // взагалі. §2.100 зняла спільну залежність гостя від `bunx`
  // (`ESLINT_TOOL`/`OXLINT_TOOL` тепер `npm:eslint`/`npm:oxlint` —
  // `<cwd>/node_modules/.bin`, фолбек `PATH`, та сама асиметрія «eslint
  // обов'язковий, oxlint best-effort», що в канону), але шляхи резолву
  // лишились РІЗНИМИ (Node-модуль канону проти CLI-бінарника гостя) — не
  // байт-у-байт той самий, тож канон і далі не збігається з гостем ПОРЯДКОВО.
  // Гість повертає порожній план (клас host-diff), тож `guestFix`-брейк
  // `applyT0` канон не глушить — драбина «гість, а якщо він нічого не
  // зробив, канон» тут жива й потрібна.
  'js/eslint/fix-eslint.mjs':
    '§2.93/§2.100 — канон кличе `eslint --fix` через programmatic API (Node-модуль), гість — ' +
    'через CLI-бінарник `npm:eslint`; різні шляхи резолву, не порт одне одного',
  'test/storybook-vitest-config/fix-storybook-vitest-config.mjs':
    '§2.87 — не портований: хірургічне string-splice редагування чужого `vitest.config.*`'
}

describe('§2.93 — plugins/lang-js: фікс кожного портованого концерну живе рівно в одному місці (JS-канони знято)', () => {
  test(
    'loadT0Patterns на КОЖНОМУ з девʼятнадцяти віддає РІВНО ОДИН патерн, і той — guestFix (ані канону, ані порожнечі)',
    async () => {
      await withTmpDir(async dir => {
        await writeFile(
          join(dir, '.n-rules.json'),
          JSON.stringify({ wasmPlugins: [{ name: 'lang-js', path: WASM_PATH }] }),
          'utf8'
        )
        const { loadT0Patterns } = await import('../run-fix.mjs')
        /** @type {Record<string, boolean[]>} */
        const actual = {}
        for (const { ruleId, concern } of FIX_ONLY_IN_GUEST) {
          const concernDir = join(LANG_JS_RULES_DIR, ruleId, concern)
          const patterns = await loadT0Patterns(concernDir, concern, ruleId, dir)
          actual[`${ruleId}/${concern}`] = patterns.map(p => p.guestFix === true)
        }
        const expected = Object.fromEntries(
          FIX_ONLY_IN_GUEST.map(({ ruleId, concern }) => [`${ruleId}/${concern}`, [true]])
        )
        expect(actual).toEqual(expected)
      })
    },
    180_000
  )

  test('таблиця не відстала від гостя: кожен її ключ є у ЖИВОМУ маніфесті (concerns ∪ fix_only_concerns)', () => {
    const manifest = loadNative().wasmPluginManifest(WASM_PATH)
    const declared = new Set([
      ...manifest.concerns.map(c => c.key),
      ...(manifest.fix_only_concerns ?? []).map(c => c.key)
    ])
    expect(FIX_ONLY_IN_GUEST).toHaveLength(21)
    const missing = FIX_ONLY_IN_GUEST.map(({ ruleId, concern }) => `${ruleId}/${concern}`).filter(
      key => !declared.has(key)
    )
    expect(
      missing,
      'ключ таблиці зник із маніфеста гостя — або перейменований (онови таблицю), ' +
        'або контрибуцію знято, і концерн лишився БЕЗ жодного фіксера'
    ).toEqual([])
    // `js/eslint`/`bun/package_json` — ДВА ключі, що приходять із ДРУГОГО
    // списку (§2.86/§2.92-§2.94-§2.119): гість дає лише fix, detect
    // лишається за `main.mjs`/rego-policy. Твердження явне, щоб
    // перенесення ключа між списками не пройшло тихо.
    expect((manifest.fix_only_concerns ?? []).map(c => c.key)).toEqual(['js/eslint', 'bun/package_json'])
  })

  test('на диску не лишилось жодного зайвого fix-канону: рівно два іменовані винятки', async () => {
    const { glob } = await import('node:fs/promises')
    /** @type {string[]} */
    const found = []
    for await (const entry of glob('*/*/fix-*.mjs', { cwd: LANG_JS_RULES_DIR })) {
      const normalized = entry.split(sep).join('/')
      // `fix-worker.mjs` — не T0-фікс, а LLM-драбина (той самий виняток, що §2.89).
      if (normalized.endsWith('/fix-worker.mjs')) continue
      found.push(normalized)
    }
    expect(
      found.toSorted(),
      'новий (чи повернений) `fix-<concern>.mjs` у lang-js — або портуй фікс і знеси канон, ' +
        'або внеси у FIX_STAYS_IN_JS з ПРИЧИНОЮ'
    ).toEqual(Object.keys(FIX_STAYS_IN_JS).toSorted())
  })
})
