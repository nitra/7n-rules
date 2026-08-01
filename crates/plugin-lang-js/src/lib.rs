//! wasm-компонент `n-rules:plugin@3.0.0` — `lang-js/wasm-concerns` (задачі N2,
//! Q1 батч 1, Q2 батч 2 та Q3, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5 і
//! `docs/specs/2026-08-01-wasm-ast-strategy.md`),
//! створений за флоу скіла `npm/skills/wasm-plugin/` (scaffold → реалізація →
//! golden-тести). ОДИНАДЦЯТЬ концернів у контрибуції, порт чинних
//! JS-оригіналів — справжній 1:1, той самий `reason`/`message` біт-у-біт
//! (parity-дисципліна СКІЛа не допускає shadowing regex-наближенням
//! AST-оригіналу в контрибуції — рішення оркестратора після звіту батчу 2,
//! доккомент секції «Регекс-наближення» нижче; останні два концерни (задача
//! Q3) — byte-exact через СПРАВЖНІЙ `oxc_parser`, не потребують такого
//! де-скоупу):
//!
//! - `vue/tfm-translations` (per-file) — перенесено з виведеного пілота
//!   `crates/plugin-lang-js-pilot` (задача K фази 6), порт
//!   `plugins/lang-js/rules/vue/tfm-translations/main.mjs`.
//! - `style/gap` (full-scope, whole-batch — НЕ per-file) — порт
//!   `plugins/lang-js/rules/style/gap/main.mjs`: крос-файлова перевірка
//!   usage↔definition, весь `detect-batch.files` аналізується разом, не
//!   файл-за-файлом.
//! - `test/vitest-config-pool-forks` (full-scope, задача Q1) — порт
//!   `plugins/lang-js/rules/test/vitest-config-pool-forks/main.mjs`: перший
//!   існуючий `vitest.config.{mjs,js}` серед `detect-batch.files` має містити
//!   `pool: 'forks'`.
//! - `test/no-process-chdir` (full-scope, задача Q1) — порт
//!   `plugins/lang-js/rules/test/no-process-chdir/main.mjs`: жоден
//!   `*.test.{mjs,js}` не викликає `process.chdir(`, одна діагностика на
//!   кожен порушений рядок.
//! - `style/admin_table` (full-scope, задача Q1) — порт
//!   `plugins/lang-js/rules/style/admin_table/main.mjs`: той самий
//!   usage↔definition мотив, що `style/gap`, але для ОДНОГО класу
//!   (`n-admin-table`), не набору суфіксів.
//! - `style/quasar_fixes` (full-scope, задача Q1) — порт
//!   `plugins/lang-js/rules/style/quasar_fixes/main.mjs`: дві незалежні пари
//!   usage↔fix (`q-scroll-area`/`q-tooltip`), фіксований порядок масиву
//!   (не набір) — вивід має йти в тому самому порядку, що й JS `FIXES`.
//! - `test/location` (full-scope, задача Q1) — порт
//!   `plugins/lang-js/rules/test/location/main.mjs`: лише ШЛЯХИ з батчу
//!   (`SourceFile::path`), `content` не читається — `*.test.mjs` має лежати
//!   у каталозі `tests/`.
//! - `test/no-console-store-restore` (full-scope, задача Q2 батч 2) — порт
//!   `plugins/lang-js/rules/test/no-console-store-restore/main.mjs`: пряме
//!   присвоєння `console.<method> = …` у `*.test.{mjs,js}` заборонено.
//! - `test/no-bun-test-import` (full-scope, задача Q2 батч 2) — порт
//!   `plugins/lang-js/rules/test/no-bun-test-import/main.mjs`: **T0-фікс
//!   `fix-no-bun-test-import.mjs` лишається JS** і працює НАПРЯМУ з
//!   wasm-violations (`reason`/`data.fixable`) — критичний ризик батчу,
//!   перевірений живим смок-тестом (`crates/rules-plugin-host/tests/plugin_lang_js.rs`).
//! - `js/utils_imports` (full-scope, задача Q3) — порт
//!   `plugins/lang-js/rules/js/utils_imports/main.mjs`: **справжній
//!   oxc-parser AST-концерн**, не regex-наближення (доккомент секції нижче
//!   «Регекс-наближення» стосується ІНШИХ трьох, де-скоупнутих концернів —
//!   ці два вже мають byte-exact parity через ТОЙ САМИЙ движок,
//!   `docs/specs/2026-08-01-wasm-ast-strategy.md`). Кожен файл під якимось
//!   `utils/`-каталогом парситься `oxc_parser`, зібрані import-source
//!   (`ImportDeclaration`, динамічний `import()`, `require()`) звіряються з
//!   `^\.\.(?:/|$)` — жодного relative-імпорту з `..`.
//! - `test/no-relative-fs-path` (full-scope, задача Q3) — порт
//!   `plugins/lang-js/rules/test/no-relative-fs-path/main.mjs`: теж
//!   справжній oxc-parser AST-концерн — кожен `*.test.{mjs,js}` парситься,
//!   виклики `node:fs`/`node:fs/promises`-функцій (`FS_PATH_ARG_POSITIONS`)
//!   з relative string/template-literal-аргументом на path-позиції —
//!   порушення.
//!
//! JS-реалізації лишаються канонічними (Plugin API v2, дистрибуція wasm —
//! окремий крок) — цей компонент лише переносить логіку в native/wasm шлях,
//! parity-тест `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs`
//! ганяє ОДНІ фікстури через обидві реалізації.
//!
//! **БЕЗ контрибуції** (groundwork без `describe()`-запису, доккомент секції
//! «Регекс-наближення» нижче): `js-bun-redis/imports`
//! (`plugins/lang-js/rules/js-bun-redis/imports/main.mjs`, AST-оригінал через
//! oxc-parser), `js-bun-db/safety`
//! (`plugins/lang-js/rules/js-bun-db/safety/main.mjs`, 1071-рядковий
//! `bun-sql-scan.mjs`), `js-mssql/deps`
//! (`plugins/lang-js/rules/js-mssql/deps/main.mjs`, 610-рядковий
//! `mssql-pool-scan.mjs`) — їхні detect-функції й unit-тести лишаються в
//! крейті, але `Guest::detect`/host їх не досягають.
//!
//! # Одинадцять концернів в одному Guest — мотив із `test-plugin-guest`
//!
//! `Guest::detect` розгалужується за `batch.concern-id` (той самий патерн,
//! що вже встановлений `crates/test-plugin-guest/src/lib.rs` для трьох
//! тест-хуків) — один guest-крейт МОЖЕ нести кілька контрибуцій `describe()`.
//! `npm/skills/wasm-plugin/template/lib.rs.tpl` демонструє лише
//! форму з ОДНИМ концерном (`__CONCERN_ID__` — єдиний плейсхолдер) — SKILL.md
//! доповнено секцією про розширення на кілька концернів (крок 2, підрозділ
//! «Кілька концернів в одному крейті»).
//!
//! # `style/gap` та решта Q1-концернів — whole-batch, не per-file
//!
//! Шаблон скіла документує лише `detect_one_file(file) -> Option<Diagnostic>`
//! (одна перевірка, один файл, один можливий violation). `style/gap` і всі
//! пʼять концернів задачі Q1 — крос-файлові/whole-repo перевірки (usage-суфікси
//! з `.vue` мають бути визначені хоч в одному `.scss`/`.css`/`.vue` з усього
//! `detect-batch.files`, і так само для решти), тож чиста логіка тут бере
//! ВЕСЬ `&[SourceFile]`, не один файл. SKILL.md доповнено підрозділом
//! «Full-scope / whole-batch концерн» — шаблон демонстрував лише per-file
//! форму, це прогалина, яку задача N2 виявила й закрила.
//!
//! # `test/no-process-chdir` — гість-фільтр поверх host-глобу (розбіжність
//! full-scope мосту, задача Q1)
//!
//! JS-оригінал (`collectTestFiles`, `npm/scripts/lib/collect-test-files.mjs`)
//! фільтрує `*.test.{mjs,js}` через `walkDir(cwd, onFile, ignorePaths)`, де
//! `ignorePaths` — `loadCursorIgnorePaths(cwd)`: додаткові шляхи з
//! `.n-rules.json` `ignore` (напр. `npm/schemas/vendor` цього репозиторію),
//! ПОНАД дефолтний `.gitignore`/`.git`/`node_modules`/worktrees-набір
//! (`ALWAYS_IGNORE`, `npm/scripts/utils/walkDir.mjs`). Host-бік full-scope
//! мосту (`crates/rules-napi::build_full_scope_files`) цей додатковий
//! `.n-rules.json`-ignore НЕ читає — той самий `rules_core::scan::walk_dir`
//! двигун, але без консюмер-специфічного `ignore`-списку (та сама
//! обмеженість, що вже мовчки прийнята для `style/gap`/`style/admin_table`/
//! `style/quasar_fixes`, які теж ходять `walkDir(cwd, …)` БЕЗ
//! `ignorePaths` — цей момент не новий для Q1, лише вперше явно
//! задокументований тут). Виправлення — зміна `build_full_scope_files`, щоб
//! вона теж читала `.n-rules.json`, — інфраструктурна робота понад
//! napi-міст, що торкається УСІХ full-scope wasm-концернів одразу, не лише
//! `plugin-lang-js`; поза обсягом задачі Q1 батч 1. Замість цього:
//!
//! 1. `ConcernContribution.glob` для `test/no-process-chdir` — той самий
//!    `["**/*.test.mjs", "**/*.test.js"]`, що й `concern.json.lint.glob`
//!    JS-оригіналу (host звужує whole-repo обхід ще ДО читання вмісту).
//! 2. [`detect_no_process_chdir`] додатково перевіряє
//!    `is_test_file_no_process_chdir(&file.path)` для кожного файлу з батчу
//!    (гість-фільтр, той самий мотив, що `detect_one_file_tfm`'s
//!    `!file.path.ends_with(".vue")`) — захист, якщо колись `detect` цього
//!    концерну викличуть з файлами поза глобом (напр. per-file dispatch
//!    напряму, не лише full-scope міст).
//!
//! Реальної розбіжності в тестових фікстурах (parity-тест, golden-тести) це
//! не дає: жоден `*.test.{mjs,js}` цього репозиторію не лежить під
//! `npm/schemas/vendor` сьогодні — розбіжність лишається задокументованою,
//! не покритою regression-тестом (не існує детермінованого способу довести
//! відсутність майбутнього файлу).
//!
//! # `js/utils_imports`/`test/no-relative-fs-path` — AST-концерни через
//! `oxc_parser` (задача Q3, `docs/specs/2026-08-01-wasm-ast-strategy.md`)
//!
//! Перші два concern-и цього крейту, чиї JS-оригінали побудовані на
//! **справжньому AST** (npm `oxc-parser`, `parseSync`), не на regex — спайк
//! S1 підтвердив, що `oxc_parser`/`oxc_ast`/`oxc_allocator`/`oxc_span`
//! (Rust-крейти, той самий репозиторій `oxc-project/oxc`, той самий
//! пінований мінор, що npm-пакет) компілюються під `wasm32-wasip2` без
//! host-медіації — парсер живе прямо в цьому guest-крейті. Дзеркальний тест
//! версій (`npm/scripts/lib/lint-surface/tests/oxc-version-pin.test.mjs`)
//! ламає дельта-лінт, якщо `npm/package.json:dependencies.oxc-parser` і
//! `Cargo.toml`-піни розійдуться.
//!
//! `js/utils_imports` — WHOLE-BATCH, host уже звузив `files` до
//! `ConcernContribution.glob` (`**/utils/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}`)
//! — кожен `SourceFile::path` гарантовано містить сегмент `utils`.
//! [`detect_utils_imports`] відтворює filesystem-фільтри JS-оригіналу
//! (`findUtilsDirs`/`collectUtilsSources`) над УЖЕ наданим списком файлів:
//!
//! - сегменти ДО першого `utils` не повинні містити жодного з
//!   [`UTILS_SKIP_DIR_NAMES`] (дзеркало пропуску outer-walk `findUtilsDirs`);
//! - сегменти МІЖ `utils` і файлом не повинні бути `tests`/`__fixtures__`/
//!   [`UTILS_SKIP_DIR_NAMES`] (дзеркало inner-walk `collectUtilsSources`).
//!
//! **Розбіжність full-scope мосту (задокументовано, не виправлено — той
//! самий мотив, що `test/no-process-chdir` вище):** JS-оригінал додатково
//! фільтрує через `loadCursorIgnorePaths` (`.n-rules.json` `ignore`) і
//! `getMonorepoPackageRootDirs` (обмежує пошук `utils/`-каталогів межами
//! workspace-пакетів) — `crates/rules-napi::build_full_scope_files` жодного
//! з двох не відтворює. Єдиний JS-тест, що покладається саме на
//! `.n-rules.json` ignore (`utils_imports.test.mjs`, «у .n-rules.json ignore
//! → ігнорується»), СВІДОМО не дзеркалиться в
//! `wasm-plugin-parity.test.mjs` з цієї самої причини (wasm-бік дав би інший
//! результат — не помилка порту, а відома межа full-scope мосту).
//!
//! `test/no-relative-fs-path` — теж WHOLE-BATCH, `ConcernContribution.glob`
//! = `["**/*.test.mjs", "**/*.test.js"]` (`isTestFile`-фільтр JS-оригіналу
//! відтворено як гість-фільтр [`is_test_file_no_process_chdir`] — той самий
//! предикат, що `test/no-process-chdir`, два незалежні JS-оригінали
//! випадково збігаються посимвольно). На відміну від [`detect_utils_imports`]
//! (`extractImportSources` НЕ перевіряє `result.errors` — best-effort на
//! часткове AST), [`find_offenders_in_body`] відтворює
//! `parseProgramOrNull`'s явну перевірку `result.errors?.length` — файл із
//! syntax-error пропускається цілком (0 offenders), не аналізується
//! best-effort (точний порт, не спрощення).

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

use std::collections::BTreeSet;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, CallExpression, Expression, ImportDeclaration, ImportExpression, TemplateLiteral,
};
use oxc_ast_visit::{
    walk::{walk_call_expression, walk_import_expression},
    Visit,
};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};

/// Ключ контрибуції `vue/tfm-translations` — точний відповідник
/// `${ctx.ruleId}/${ctx.concernId}` (`runConcernDetector`,
/// `npm/scripts/lib/lint-surface/detect.mjs`).
const CONCERN_TFM: &str = "vue/tfm-translations";

/// Ключ контрибуції `style/gap`.
const CONCERN_GAP: &str = "style/gap";

/// Ключ контрибуції `test/vitest-config-pool-forks` (задача Q1).
const CONCERN_POOL_FORKS: &str = "test/vitest-config-pool-forks";

/// Ключ контрибуції `test/no-process-chdir` (задача Q1).
const CONCERN_NO_PROCESS_CHDIR: &str = "test/no-process-chdir";

/// Ключ контрибуції `style/admin_table` (задача Q1).
const CONCERN_ADMIN_TABLE: &str = "style/admin_table";

/// Ключ контрибуції `style/quasar_fixes` (задача Q1).
const CONCERN_QUASAR_FIXES: &str = "style/quasar_fixes";

/// Ключ контрибуції `test/location` (задача Q1).
const CONCERN_LOCATION: &str = "test/location";

/// Дефолтний `reason` violation-а `vue/tfm-translations` — точний
/// відповідник `ctx.concernId` (`createViolationReporter`, доккомент
/// `plugins/lang-js/rules/vue/tfm-translations/main.mjs`: `fail(msg, opts)`
/// цього концерну НІКОЛИ не перекриває явним `reason`).
const TFM_VIOLATION_REASON: &str = "tfm-translations";

/// `reason` violation-а `style/gap` — точний відповідник другого аргумента
/// `fail(msg, 'missing-gap-style')` (`plugins/lang-js/rules/style/gap/main.mjs`).
const GAP_VIOLATION_REASON: &str = "missing-gap-style";

/// Дефолтний `reason` violation-а `test/vitest-config-pool-forks` — точний
/// відповідник `ctx.concernId` (`fail(msg)` без другого аргумента,
/// `plugins/lang-js/rules/test/vitest-config-pool-forks/main.mjs`; bare
/// `concernId`, БЕЗ префікса `ruleId/`, той самий мотив, що
/// [`TFM_VIOLATION_REASON`]).
const POOL_FORKS_VIOLATION_REASON: &str = "vitest-config-pool-forks";

/// `reason` violation-а `test/no-process-chdir` — точний відповідник
/// `reason: 'process-chdir-in-test'` (`main.mjs`, будується напряму, не
/// через `createViolationReporter`).
const NO_PROCESS_CHDIR_VIOLATION_REASON: &str = "process-chdir-in-test";

/// `reason` violation-а `style/admin_table` — точний відповідник
/// `fail(msg, 'missing-admin-table-style')`.
const ADMIN_TABLE_VIOLATION_REASON: &str = "missing-admin-table-style";

/// `reason` violation-а `style/quasar_fixes` — точний відповідник
/// `fail(msg, 'missing-quasar-fix')`.
const QUASAR_FIXES_VIOLATION_REASON: &str = "missing-quasar-fix";

/// Дефолтний `reason` violation-а `test/location` — точний відповідник
/// `ctx.concernId` (`fail(msg)` без другого аргумента, `main.mjs`).
const LOCATION_VIOLATION_REASON: &str = "location";

/// Іменований імпорт з `@nitra/tfm` — захоплює список імен усередині
/// `{ ... }`. Точний порт `TFM_IMPORT_RE` (`main.mjs:5`, vue/tfm-translations).
const TFM_IMPORT_PATTERN: &str = r#"import\s*\{([^}]*)\}\s*from\s*['"]@nitra/tfm['"]"#;

/// Один запис іменованого імпорту `tf` (з опційним `as <alias>`). Точний
/// порт `TF_SPECIFIER_RE` (`main.mjs:8`).
const TF_SPECIFIER_PATTERN: &str = r"^tf(?:\s+as\s+\w+)?$";

/// Оголошення функції `getTr` — `function getTr(...)` або
/// `const/let/var getTr = (...)`. Точний порт `GET_TR_DECL_RE` (`main.mjs:11`).
const GET_TR_DECL_PATTERN: &str = r"(?:function\s+getTr\s*\(|(?:const|let|var)\s+getTr\s*=)";

/// Використання класу `n-gap-{xs,sm,md,lg}` у `.vue`. Точний порт
/// `USAGE_RE` (`plugins/lang-js/rules/style/gap/main.mjs:8`).
const GAP_USAGE_PATTERN: &str = r"\bn-gap-(xs|sm|md|lg)\b";

/// Визначення класу `.n-gap-{xs,sm,md,lg}` у `.vue`/`.scss`/`.css`. Точний
/// порт `DEFINITION_RE` (`main.mjs:9`).
const GAP_DEFINITION_PATTERN: &str = r"\.n-gap-(xs|sm|md|lg)\b";

/// `pool: 'forks'`/`pool: "forks"` з опційним whitespace навколо двокрапки.
/// Точний порт `POOL_FORKS_RE`
/// (`plugins/lang-js/rules/test/vitest-config-pool-forks/main.mjs:9`).
const POOL_FORKS_PATTERN: &str = r#"pool\s*:\s*['"]forks['"]"#;

/// Канонічна назва — `.mjs` (нові файли, `js.mdc`), legacy `.js` лишається
/// валідним; перший знайдений виграє (`.mjs` пріоритетніший). Точний порт
/// `VITEST_CONFIG_NAMES` (`main.mjs:13`).
const VITEST_CONFIG_NAMES: [&str; 2] = ["vitest.config.mjs", "vitest.config.js"];

/// Викличний паттерн `process.chdir(` з відкривною дужкою — не зачепить
/// згадку у docstring/коментарі. Точний порт `CHDIR_CALL_RE`
/// (`plugins/lang-js/rules/test/no-process-chdir/main.mjs:7`).
const CHDIR_CALL_PATTERN: &str = r"process\.chdir\s*\(";

/// Використання класу `n-admin-table` у `.vue`. Точний порт `USAGE_RE`
/// (`plugins/lang-js/rules/style/admin_table/main.mjs:8`).
const ADMIN_TABLE_USAGE_PATTERN: &str = r"\bn-admin-table\b";

/// Визначення класу `.n-admin-table`. Точний порт `DEFINITION_RE`
/// (`plugins/lang-js/rules/style/admin_table/main.mjs:9`).
const ADMIN_TABLE_DEFINITION_PATTERN: &str = r"\.n-admin-table\b";

/// Назва каталогу тестів — точний порт `TESTS_DIR_NAME`
/// (`plugins/lang-js/rules/test/location/main.mjs:8`), спільна для
/// [`is_inside_tests_dir`] і повідомлення [`detect_location`].
const TESTS_DIR_NAME: &str = "tests";

/// Чи імпортує вміст файлу `tf` (можливо з `as <alias>`) саме з `@nitra/tfm`.
/// Точний порт `importsTfFromTfm` (`main.mjs:18-22`, vue/tfm-translations).
fn imports_tf_from_tfm(content: &str) -> bool {
    let import_re = regex::Regex::new(TFM_IMPORT_PATTERN).expect("TFM_IMPORT_PATTERN валідний");
    let Some(captures) = import_re.captures(content) else {
        return false;
    };
    let specifier_re =
        regex::Regex::new(TF_SPECIFIER_PATTERN).expect("TF_SPECIFIER_PATTERN валідний");
    captures[1]
        .split(',')
        .any(|entry| specifier_re.is_match(entry.trim()))
}

/// Чи оголошено `getTr` десь у файлі. Точний порт вживання `GET_TR_DECL_RE.test`
/// (`main.mjs:46`).
fn declares_get_tr(content: &str) -> bool {
    regex::Regex::new(GET_TR_DECL_PATTERN)
        .expect("GET_TR_DECL_PATTERN валідний")
        .is_match(content)
}

/// Одна пара (usage у `.vue` → визначення CSS-фікса) — точний порт одного
/// запису `FIXES` (`plugins/lang-js/rules/style/quasar_fixes/main.mjs:14-17`).
/// iOS-zoom-фікс навмисно НЕ портований (той самий коментар JS-оригіналу:
/// тригер `input`/`textarea`/`select` — занадто загальний, false-positive на
/// майже будь-якій формі).
struct QuasarFix {
    /// Ідентифікатор пари (`fix.name` у JS) — фігурує в `message`.
    name: &'static str,
    /// Точний порт `fix.usage`.
    usage_pattern: &'static str,
    /// Точний порт `fix.definition`.
    definition_pattern: &'static str,
    /// Точний порт `fix.selector` — CSS-селектор, згаданий у `message`.
    selector: &'static str,
}

/// Точний порт `FIXES` (`main.mjs:14-17`) — ФІКСОВАНИЙ порядок масиву (не
/// набір/мапа): [`detect_quasar_fixes`] віддає діагностики в цьому самому
/// порядку, дзеркалячи `for (const fix of FIXES)` JS-оригіналу.
const QUASAR_FIXES: [QuasarFix; 2] = [
    QuasarFix {
        name: "q-scroll-area",
        usage_pattern: r"<q-scroll-area\b",
        definition_pattern: r"\.q-scrollarea\b",
        selector: ".q-scrollarea",
    },
    QuasarFix {
        name: "q-tooltip",
        usage_pattern: r"<q-tooltip\b",
        definition_pattern: r"\.q-tooltip\b",
        selector: ".q-tooltip",
    },
];

/// posix-basename (останній сегмент після `/`) — чистий еквівалент
/// `node:path.basename` для вже-posix-відносних шляхів `SourceFile::path`
/// (хост гарантує posix-relative, доккомент `wit/world.wit` `record
/// source-file`, тож `sep`-конверсія тут не потрібна, на відміну від
/// `toRelPosix` у `collect-test-files.mjs`, що конвертує з платформного
/// `path.relative`).
fn posix_basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// posix-dirname — точний еквівалент `node:path.dirname`: без `/` у шляху
/// повертає `"."` (Node-конвенція, [`detect_location`] відтворює її для
/// повідомлення про перенесення).
fn posix_dirname(path: &str) -> &str {
    match path.rfind('/') {
        Some(idx) => &path[..idx],
        None => ".",
    }
}

/// Чи файл — JS-тест (`*.test.mjs`/`*.test.js`). Точний порт `isTestFile`
/// (`npm/scripts/lib/collect-test-files.mjs:16-19`, `test/no-process-chdir`).
fn is_test_file_no_process_chdir(path: &str) -> bool {
    path.ends_with(".test.mjs") || path.ends_with(".test.js")
}

/// Чи файл — JS-тест (лише `*.test.mjs`, БЕЗ `.js`). Точний порт
/// `isTestFile` (`plugins/lang-js/rules/test/location/main.mjs:15-17`,
/// `test/location`) — навмисно вужчий за [`is_test_file_no_process_chdir`],
/// не дублювання: два різні JS-оригінали з різними наборами розширень.
fn is_test_file_location(path: &str) -> bool {
    path.ends_with(".test.mjs")
}

/// Чи лежить тест у каталозі з іменем `tests`. Точний порт
/// `isInsideTestsDir` (`plugins/lang-js/rules/test/location/main.mjs:24-26`).
fn is_inside_tests_dir(path: &str) -> bool {
    posix_basename(posix_dirname(path)) == TESTS_DIR_NAME
}

// =====================================================================
// Батч 2 (задача Q2, §3.5.5): ще concern-и lang-js у native/wasm —
// `test/no-console-store-restore`, `test/no-bun-test-import` (+ T0-фікс
// `fix-no-bun-test-import.mjs` лишається JS, працює НАПРЯМУ з
// wasm-violations — критичний ризик батчу, перевірений живим смоком). Обидва
// — СПРАВЖНІЙ 1:1 порт (REGEX-based і в JS-оригіналі), обидва в контрибуції
// `describe()` як решта семи концернів.
//
// # Регекс-наближення замість повного oxc AST — БЕЗ контрибуції (де-скоуп)
//
// JS-оригінали `js-bun-redis/imports`, `js-bun-db/safety`, `js-mssql/deps`
// побудовані на **oxc-parser** (справжній AST, не regex) — `redis-imports.mjs`,
// `bun-sql-scan.mjs` (1071 рядків), `mssql-pool-scan.mjs` (610 рядків):
// control-flow-чутлива детекція guard-ів, трасування Identifier → init через
// усі `VariableDeclarator` файлу, обхід предків для «чи всередині функції».
// Rust `regex`-крейт — це regex-двигун (без lookaround й backreference,
// той самий ліміт, що вже задокументований для інших концернів цього
// крейту), не парсер: побудова повноцінного JS/TS AST-парсера (чи
// вендорингу `oxc_parser` Rust-крейта) — інфраструктурна робота понад обсяг
// задачі порту пʼяти concern-ів батчу 2. Тут — **пряме синтаксичне
// наближення**: regex-и + двоє легких лінійних сканерів
// ([`find_matching_bracket`], [`brace_depth_before`]) без string/comment-
// masking (збалансовані дужки всередині рядкових літералів — типовий випадок
// SQL-тексту на кшталт `` `CREATE TABLE ${TABLE} (id int)` `` — net-нейтральні
// для підрахунку глибини, тож проста лінійна лічба досить для фікстур цього
// порту).
//
// **Рішення оркестратора (звіт батчу 2): regex-наближення AST-семантики НЕ
// проходить parity-гейт цього SKILL.md для КОНТРИБУЦІЇ.** «Пряме синтаксичне
// наближення» — прийнятна практика лише для lookaround/backreference-обмежень
// ОДНОГО regex-а (підрозділ «Parity-дисципліна», п.4: «явний алгоритмічний
// еквівалент, не ‘майже той самий’ регекс», застосовано вище/нижче для
// `test/no-console-store-restore`/`test/no-bun-test-import` та перших семи
// концернів батчу 1). Коли ЦІЛЕ ДЖЕРЕЛО — AST-сканер (не один regex із
// локальним обмеженням), «count+reason, не байтова рівність message»
// (обраний тут рівень парності) означає, що wasm-вихід МОЖЕ розійтись із
// JS-каноном на реальних, не лише синтетичних фікстурах — недопустимо для
// concern-а, що споживачі трактують як shadowing-заміну живої JS-реалізації
// (доккомент `describe()`/host-диспетчеризації: контрибуція = «ця
// реалізація тепер джерело правди»). Тому три detect-функції нижче
// ЛИШАЮТЬСЯ в крейті як groundwork під майбутнє справжнє AST-рішення
// (`oxc_parser` Rust-крейт чи tree-sitter) — з unit-тестами, що звіряють
// поведінку самих функцій, — але НЕ в [`build_manifest`] і не в
// `Guest::detect`-диспетчеризації (host їх ніколи не викличе: не знає про
// них із `describe()`). Ризик, що лишається задокументованим тут (не
// production-ризик, оскільки concern без контрибуції): рідкісні
// синтаксичні конструкції (regex-літерали з дужками, дуже нетипове
// форматування) можуть дати false-negative/positive, яких не дасть справжній
// AST — не покрито regression-тестом (як і `.n-rules.json`-ignore
// розбіжність вище) — немає детермінованого способу довести відсутність
// майбутнього edge-case.

/// Ключ контрибуції `test/no-console-store-restore` (задача Q2 батч 2).
const CONCERN_NO_CONSOLE_STORE_RESTORE: &str = "test/no-console-store-restore";
/// Ключ контрибуції `test/no-bun-test-import`.
const CONCERN_NO_BUN_TEST_IMPORT: &str = "test/no-bun-test-import";
/// Ключ контрибуції `js/utils_imports` (задача Q3) — справжній oxc-parser
/// AST-концерн, byte-exact parity (доккомент модуля, розділ
/// «js/utils_imports/test/no-relative-fs-path — AST-концерни»).
const CONCERN_UTILS_IMPORTS: &str = "js/utils_imports";
/// Ключ контрибуції `test/no-relative-fs-path` (задача Q3) — той самий
/// мотив, що [`CONCERN_UTILS_IMPORTS`].
const CONCERN_NO_RELATIVE_FS_PATH: &str = "test/no-relative-fs-path";
/// Concern-key `js-bun-redis/imports` — БЕЗ контрибуції в [`build_manifest`]
/// (де-скоуп, доккомент секції «Регекс-наближення» вище): groundwork-ключ,
/// вживається лише match-гілкою `Guest::detect` (недосяжна без `describe()`)
/// і unit-тестами.
const CONCERN_REDIS_IMPORTS: &str = "js-bun-redis/imports";
/// Concern-key `js-bun-db/safety` — той самий groundwork-статус, що
/// [`CONCERN_REDIS_IMPORTS`].
const CONCERN_BUN_DB_SAFETY: &str = "js-bun-db/safety";
/// Concern-key `js-mssql/deps` — той самий groundwork-статус, що
/// [`CONCERN_REDIS_IMPORTS`].
const CONCERN_MSSQL_DEPS: &str = "js-mssql/deps";

/// `reason` violation-а `no-console-store-restore` — бере `fail(msg)` БЕЗ
/// другого аргументу (`createViolationReporter`, `main.mjs`), тож дефолт —
/// `ctx.concernId` (bare, без `ruleId/`-префікса) — точний той самий мотив,
/// що [`POOL_FORKS_VIOLATION_REASON`]/[`LOCATION_VIOLATION_REASON`].
const NO_CONSOLE_STORE_RESTORE_VIOLATION_REASON: &str = "no-console-store-restore";
/// `reason` violation-а `no-bun-test-import` — точний відповідник
/// `reason: 'bun-test-import'`, вручну зібраний об'єкт `main.mjs` (НЕ через
/// `createViolationReporter`). **T0-критичний**: `fix-no-bun-test-import.mjs`
/// (`patterns[0].test`) матчить саме на це значення.
const BUN_TEST_IMPORT_VIOLATION_REASON: &str = "bun-test-import";
/// `reason` violation-а `js/utils_imports` — `fail(msg)` БЕЗ опцій
/// (`createViolationReporter`, `main.mjs`), дефолт `ctx.concernId` = bare
/// `"utils_imports"` (без `js/`-префікса, той самий мотив, що
/// [`POOL_FORKS_VIOLATION_REASON`]).
const UTILS_IMPORTS_VIOLATION_REASON: &str = "utils_imports";
/// `reason` violation-а `test/no-relative-fs-path` — `fail(msg)` БЕЗ опцій
/// (пряме `fail(...)` без другого аргументу, `main.mjs`), дефолт
/// `ctx.concernId` = bare `"no-relative-fs-path"`.
const NO_RELATIVE_FS_PATH_VIOLATION_REASON: &str = "no-relative-fs-path";
/// `reason` violation-а `js-bun-redis/imports` — `fail(msg)` без опцій
/// (`createViolationReporter`), дефолт `ctx.concernId` = `"imports"`.
const REDIS_IMPORTS_VIOLATION_REASON: &str = "imports";
/// `reason` violation-а `js-bun-db/safety` — УСІ виклики `fail(msg)` у
/// `main.mjs` цього концерну без опцій (`createViolationReporter`), тож
/// дефолт `ctx.concernId` = `"safety"` для КОЖНОГО типу порушення (не лише
/// одного) — перевірено читанням `main.mjs`: жоден `fail()`-виклик не передає
/// другий аргумент.
const BUN_DB_SAFETY_VIOLATION_REASON: &str = "safety";
/// `reason` violation-а `js-mssql/deps` — той самий мотив, що
/// [`BUN_DB_SAFETY_VIOLATION_REASON`]: усі `fail()` у `main.mjs` без опцій,
/// дефолт `ctx.concernId` = `"deps"`.
const MSSQL_DEPS_VIOLATION_REASON: &str = "deps";

/// Точний порт `CONSOLE_ASSIGN_RE` (`main.mjs:11`, no-console-store-restore)
/// БЕЗ negative lookahead `(?!=)` (Rust `regex` не підтримує lookaround) —
/// явний алгоритмічний еквівалент: [`line_has_console_store_assign`]
/// матчить цим паттерном, потім вручну перевіряє, що наступний символ —
/// НЕ `=` (виключає `==`/`===`), той самий фінальний ефект, що `(?!=)`.
const CONSOLE_ASSIGN_PATTERN: &str =
    r"\bconsole\.(?:log|error|warn|info|debug|dir|table|trace|group|groupEnd|time|timeEnd)\s*=";

/// Іменований import з `bun:test`. Відносно `BUN_TEST_IMPORT_RE`
/// (`main.mjs:29`, no-bun-test-import) — **розслаблено**: не вимагає
/// однакової лапки на відкритті/закритті (JS-оригінал це робить через
/// backreference `\2`, який Rust `regex` не підтримує) — приймає БУДЬ-ЯКУ
/// комбінацію `'`/`"` з обох боків. Задокументована розбіжність (SKILL.md
/// «Parity-дисципліна» п.4): жодна фікстура цього концерну не змішує лапки
/// в одному `import`, тож на реальних сценаріях розбіжності немає.
const BUN_TEST_IMPORT_PATTERN: &str = r#"import\s*\{([^}]*)\}\s*from\s*['"]bun:test['"]"#;
/// Роздільник токенів специфікатора (замість `\s+as\s+`-regex — точний порт
/// `WHITESPACE_RE`, `main.mjs:31`).
const WHITESPACE_PATTERN: &str = r"\s+";
/// Іменовані експорти `bun:test` з прямим 1:1 еквівалентом у vitest. Точний
/// порт `SAFE_SPECIFIERS` (`main.mjs:13-22`).
const SAFE_BUN_TEST_SPECIFIERS: [&str; 8] = [
    "describe",
    "test",
    "it",
    "expect",
    "beforeEach",
    "beforeAll",
    "afterEach",
    "afterAll",
];

/// Заборонені модулі — точний порт `FORBIDDEN_MODULE_NAMES`
/// (`redis-imports.mjs:32-41`).
const FORBIDDEN_REDIS_MODULES: [&str; 8] = [
    "ioredis",
    "node-redis",
    "redis",
    "@redis/client",
    "@redis/json",
    "@redis/search",
    "@redis/time-series",
    "@redis/bloom",
];

/// Фільтр розширень JS/TS-джерел — точний порт `SOURCE_FILE_RE`
/// (`redis-imports.mjs:31`, `bun-sql-scan.mjs:36`, `mssql-pool-scan.mjs:35`
/// — той самий regex у всіх трьох JS-оригіналах).
const JS_TS_SOURCE_FILE_PATTERN: &str = r"\.([cm]?[jt]sx?)$";

/// `import { sql|SQL } from 'bun'` — точний порт `BUN_SQL_IMPORT_RE`
/// (`js-source-signals.mjs:10`, реекспортований `bun-sql-scan.mjs`) —
/// **справжній** 1:1 порт: `[\s\S]*?` (non-greedy, символьний клас без
/// lookaround/backreference) підтримується Rust `regex` дослівно.
const BUN_SQL_IMPORT_PATTERN: &str =
    r#"\bimport\s*\{[\s\S]*?\b(?:sql|SQL)\b[\s\S]*?\}\s*from\s*["']bun["']"#;
/// Імпорт пакета `pg` — точний порт `PG_LIB_IMPORT_RE`
/// (`bun-sql-scan.mjs:38`) — так само справжній 1:1 (без lookaround/backreference).
const PG_LIB_IMPORT_PATTERN: &str =
    r#"(?:\bimport\b[\s\S]*?\bfrom\s*["']pg["']|\brequire\s*\(\s*["']pg["']\s*\))"#;
/// LISTEN/UNLISTEN/NOTIFY у виклику `<obj>.query(...)`/`.queryArray(...)`/
/// `.queryStream(...)` — регекс-наближення `findPgListenNotifyUsageInText`
/// (AST-оригінал, `bun-sql-scan.mjs`): перевіряє перший символ аргументу
/// (рядковий літерал чи template) замість повного розбору `CallExpression`.
const PG_LISTEN_NOTIFY_CALL_PATTERN: &str =
    r#"\.(?:query|queryArray|queryStream)\s*\(\s*[`'"]\s*(?i:LISTEN|UNLISTEN|NOTIFY)\b"#;
/// `.on('notification', ...)` — частина того самого сканера.
const PG_NOTIFICATION_LISTENER_PATTERN: &str = r#"\.on\s*\(\s*['"]notification['"]"#;
/// `// n-rules:allow-unsafe: <непорожня причина>` — точний порт
/// `ALLOW_UNSAFE_MARKER_RE` (`bun-sql-scan.mjs`).
const ALLOW_UNSAFE_MARKER_PATTERN: &str = r"n-rules:allow-unsafe\s*:\s*\S";
/// `// n-rules:allow-pg-leftover: <непорожня причина>` — точний порт
/// `ALLOW_PG_LEFTOVER_MARKER_RE`.
const ALLOW_PG_LEFTOVER_MARKER_PATTERN: &str = r"n-rules:allow-pg-leftover\s*:\s*\S";
/// `new SQL(...)` — цільова форма fixture-ів `js-bun-db/safety`
/// (`import { SQL } from 'bun'`), регекс-наближення `isNewConnectionPool`-
/// подібного AST-предиката.
const NEW_BUN_SQL_PATTERN: &str = r"\bnew\s+SQL\s*\(";
/// `<obj>.unsafe(` — виклик-кандидат для `findBunSqlUnsafeUseWithoutAllowMarkerInText`/
/// `findBunSqlUnsafeWithInterpolatedTemplateInText`.
const UNSAFE_CALL_PATTERN: &str = r"\.unsafe\s*\(";
/// `<obj>.connect(`/`<obj>.end(` — pg-leftover виклики, точний порт
/// `PG_LEFTOVER_METHOD_NAMES` (`bun-sql-scan.mjs`).
const PG_LEFTOVER_CALL_PATTERN: &str = r"\.(?:connect|end)\s*\(";
/// `IN (${...join(...)...})` / `VALUES (${...join(...)...})` — регекс-
/// наближення `isSqlListContextTemplate` + `isJoinCall`
/// (`ast-scan-utils.mjs`): пряма текстова суміжність замість AST-обходу
/// `TemplateLiteral.expressions`.
const DYNAMIC_SQL_LIST_JOIN_PATTERN: &str =
    r"(?i)\b(?:in|values)\s*\(\s*\$\{[^}]*?\.join\s*\([^)]*?\)[^}]*?\}";
/// `IN (${<вираз>})` — захоплює вміст інтерполяції для перевірки
/// guard-а/числового парсера. Регекс-наближення `collectInListMissingEmptyGuardFromTemplate`/
/// `collectInListUnparsedFromTemplate`.
const IN_LIST_INTERP_PATTERN: &str = r"(?i)\bin\s*\(\s*\$\{([^}]*)\}";
/// `function format(...)`/`pgFormat`/`sqlFormat`/`pgFmt` — точний порт
/// `PG_FORMAT_SHIM_FUNC_NAMES` (`bun-sql-scan.mjs`).
const PG_FORMAT_SHIM_FUNC_PATTERN: &str = r"\bfunction\s+(format|pgFormat|sqlFormat|pgFmt)\s*\(";
/// `function quoteLiteral(...)`/`quoteIdent`/`escapeLiteral`/`escapeIdent` —
/// точний порт `QUOTE_HELPER_NAMES`.
const QUOTE_HELPER_FUNC_PATTERN: &str =
    r"\bfunction\s+(quoteLiteral|quoteIdent|escapeLiteral|escapeIdent)\s*\(";
/// `%L`/`%I`/`%s` pg-format placeholder — точний порт `PG_FORMAT_PLACEHOLDER_RE`.
const PG_FORMAT_PLACEHOLDER_PATTERN: &str = r"%[LIs]";
/// `query(text|sql|query, ...)` — перший параметр типового pg-style
/// query-wrapper-а. Регекс-наближення `PG_QUERY_FIRST_PARAM_RE`-перевірки.
const QUERY_WRAPPER_PARAM_PATTERN: &str = r"\bquery\s*\(\s*(?:text|sql|query)\b";
/// `${JSON.stringify(...)}::jsonb` — точний порт мотиву
/// `findJsonStringifyBeforeJsonbInText`.
const JSON_STRINGIFY_JSONB_PATTERN: &str = r"\$\{\s*JSON\.stringify\s*\([^)]*\)\s*\}\s*::jsonb";
/// `sql.array(`/`pgWrite.array(`/`pgRead.array(` — точний порт цільових
/// імен `findSqlArrayWithoutTypeArgInText`.
const SQL_ARRAY_CALL_PATTERN: &str = r"\b(?:sql|pgWrite|pgRead)\.array\s*\(";

/// `new sql.ConnectionPool(...)`/`new mssql.ConnectionPool(...)` — точний
/// порт `isNewConnectionPool` (`mssql-pool-scan.mjs`).
const NEW_MSSQL_CONNECTION_POOL_PATTERN: &str = r"\bnew\s+(?:sql|mssql)\.ConnectionPool\s*\(";
/// `<obj>.query(\`...\`)` (виклик з дужками, TemplateLiteral першим
/// аргументом — НЕ tagged template) — регекс-наближення
/// `isUnsafeQueryCallWithTemplateLiteral`.
const MSSQL_UNSAFE_QUERY_TEMPLATE_PATTERN: &str = r"\.query\s*\(\s*`";
/// `(export )?const/let/var request = <obj>.request()` — точний порт
/// `isRequestFactoryCall` + `VariableDeclarator`-перевірки
/// `findSharedMssqlRequestInText`.
const MSSQL_SHARED_REQUEST_PATTERN: &str =
    r"\b(?:export\s+)?(?:const|let|var)\s+request\s*=\s*[\w.$]+\.request\s*\(\s*\)";
/// Провідний версійний префікс (`^`/`~`/`>`/`=`/`<`) — точний порт
/// `VERSION_PREFIX_RE` (`js-mssql/deps/main.mjs:20`).
const VERSION_PREFIX_PATTERN: &str = r"^[\^~>=<]+\s*";
/// Перша semver-трійка у діапазоні — точний порт `SEMVER_RE`
/// (`js-mssql/deps/main.mjs:21`).
const SEMVER_PATTERN: &str = r"^(\d+)\.(\d+)\.(\d+)";
/// Мінімальна дозволена версія `mssql` — точний порт `MIN_MSSQL_VERSION`
/// (`js-mssql/deps/main.mjs:24`).
const MIN_MSSQL_VERSION: (u32, u32, u32) = (12, 5, 0);

// =====================================================================
// Задача Q3 (`docs/specs/2026-08-01-wasm-ast-strategy.md`): AST-концерни
// через справжній `oxc_parser` — `js/utils_imports`/`test/no-relative-fs-path`.
// На відміну від секції вище «Регекс-наближення», ці два концерни В
// КОНТРИБУЦІЇ (`build_manifest`) — byte-exact parity досягнутий тим самим
// движком, що JS-оригінали, не наближенням.

/// Каталоги, які пропускає `findUtilsDirs`/`collectUtilsSources`
/// (`SKIP_DIR_NAMES`, `plugins/lang-js/rules/js/utils_imports/main.mjs:20-29`)
/// — застосовується і до сегментів ДО `utils` (outer-walk), і МІЖ `utils` і
/// файлом (inner-walk, разом з `tests`/`__fixtures__` окремо нижче).
const UTILS_SKIP_DIR_NAMES: [&str; 8] = [
    "node_modules",
    ".git",
    "dist",
    "coverage",
    "reports",
    ".turbo",
    ".next",
    "__fixtures__",
];

/// Точний порт `JS_SOURCE_RE` (`main.mjs:17`, `js/utils_imports`) —
/// `\.(?:[cm]?[jt]sx?)$`, жодного lookaround.
const UTILS_JS_SOURCE_PATTERN: &str = r"\.(?:[cm]?[jt]sx?)$";

/// Точний порт `TEST_FILE_RE` (`main.mjs:18`, `js/utils_imports`).
const UTILS_TEST_FILE_PATTERN: &str = r"\.test\.[cm]?[jt]sx?$";

/// (ім'я FS-функції, 0-індексовані позиції path-аргументів) — точний порт
/// `FS_PATH_ARG_POSITIONS` (`plugins/lang-js/rules/test/no-relative-fs-path/main.mjs:15-58`).
/// Лінійний масив (не `HashMap`) — той самий мотив, що `QUASAR_FIXES`:
/// невеликий, фіксований, порядок не впливає на семантику (пошук за іменем).
const FS_PATH_ARG_POSITIONS: &[(&str, &[usize])] = &[
    ("writeFile", &[0]),
    ("writeFileSync", &[0]),
    ("readFile", &[0]),
    ("readFileSync", &[0]),
    ("appendFile", &[0]),
    ("appendFileSync", &[0]),
    ("mkdir", &[0]),
    ("mkdirSync", &[0]),
    ("rmdir", &[0]),
    ("rmdirSync", &[0]),
    ("rm", &[0]),
    ("rmSync", &[0]),
    ("unlink", &[0]),
    ("unlinkSync", &[0]),
    ("access", &[0]),
    ("accessSync", &[0]),
    ("stat", &[0]),
    ("statSync", &[0]),
    ("lstat", &[0]),
    ("lstatSync", &[0]),
    ("chmod", &[0]),
    ("chmodSync", &[0]),
    ("chown", &[0]),
    ("chownSync", &[0]),
    ("truncate", &[0]),
    ("truncateSync", &[0]),
    ("existsSync", &[0]),
    ("readdir", &[0]),
    ("readdirSync", &[0]),
    ("copyFile", &[0, 1]),
    ("copyFileSync", &[0, 1]),
    ("rename", &[0, 1]),
    ("renameSync", &[0, 1]),
    ("symlink", &[0, 1]),
    ("symlinkSync", &[0, 1]),
    ("link", &[0, 1]),
    ("linkSync", &[0, 1]),
    ("cp", &[0, 1]),
    ("cpSync", &[0, 1]),
    ("writeJson", &[0]),
    ("ensureDir", &[0]),
];

/// Точний порт `ABSOLUTE_PREFIXES` (`main.mjs:64`, `test/no-relative-fs-path`).
const NO_RELATIVE_FS_PATH_ABSOLUTE_PREFIXES: [&str; 6] =
    ["/", "\\", "file:", "http:", "https:", "data:"];

/// Точний порт `WINDOWS_DRIVE_RE` (`main.mjs:65`).
const NO_RELATIVE_FS_PATH_WINDOWS_DRIVE_PATTERN: &str = r"^[A-Za-z]:[\\/]";

/// Найпростіший лінійний скан для офсету відповідної закриваючої дужки —
/// рахує лише символи дужок (без masking рядків/коментарів, доккомент
/// секції вище «Регекс-наближення»): для фікстур цих концернів достатньо,
/// бо збалансовані дужки всередині рядкових/template-літералів (типовий SQL
/// на кшталт `` `CREATE TABLE ${TABLE} (id int)` ``) net-нейтральні для
/// підрахунку глибини.
fn find_matching_bracket(
    chars: &[char],
    open_idx: usize,
    open_ch: char,
    close_ch: char,
) -> Option<usize> {
    let mut depth = 1i32;
    let mut i = open_idx + 1;
    while i < chars.len() {
        if chars[i] == open_ch {
            depth += 1;
        } else if chars[i] == close_ch {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

/// Глибина вкладеності `{`/`}` ПЕРЕД позицією `idx` (0 = верхній рівень
/// модуля) — той самий мотив спрощення, що [`find_matching_bracket`].
/// Використовується для «чи цей виклик всередині функції» (напр.
/// `findMssqlPerRequestConnectionInText`'s `ancestors.some(isFunctionNode)`) —
/// наближення: рахує БУДЬ-ЯКУ вкладеність (об'єктний літерал, блок if тощо),
/// не лише функції, тож можливий false-positive на не-функціональних
/// блоках; жодна фікстура цього порту такого не містить.
fn brace_depth_before(chars: &[char], idx: usize) -> i32 {
    let mut depth = 0i32;
    for &c in &chars[..idx.min(chars.len())] {
        if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth -= 1;
        }
    }
    depth
}

/// 1-based номер рядка символьного офсету `idx` у `content`.
fn line_number_at(content: &str, idx: usize) -> usize {
    content.chars().take(idx).filter(|&c| c == '\n').count() + 1
}

/// Текст рядка, що містить символьний офсет `idx` (без кінцевого `\n`).
fn line_text_at(content: &str, idx: usize) -> &str {
    let start = content[..idx.min(content.len())]
        .rfind('\n')
        .map(|p| p + 1)
        .unwrap_or(0);
    let end = content[idx.min(content.len())..]
        .find('\n')
        .map(|p| idx + p)
        .unwrap_or(content.len());
    &content[start..end]
}

/// Текст рядка, що передує рядку з офсетом `idx` (порожній рядок, якщо
/// `idx` — на першому рядку файлу).
fn previous_line_text_at(content: &str, idx: usize) -> &str {
    let current_start = content[..idx.min(content.len())]
        .rfind('\n')
        .map(|p| p + 1)
        .unwrap_or(0);
    if current_start == 0 {
        return "";
    }
    let prev_end = current_start - 1;
    let prev_start = content[..prev_end].rfind('\n').map(|p| p + 1).unwrap_or(0);
    &content[prev_start..prev_end]
}

/// Чи є `marker_re` на тому самому рядку (байтовий офсет `idx`) чи рядком
/// вище — точний мотив «на тому ж рядку або рядком вище» з doc-коментарів
/// `bun-sql-scan.mjs` (`ALLOW_UNSAFE_MARKER_RE`/`ALLOW_PG_LEFTOVER_MARKER_RE`).
fn marker_present_nearby(content: &str, idx: usize, marker_re: &regex::Regex) -> bool {
    marker_re.is_match(line_text_at(content, idx))
        || marker_re.is_match(previous_line_text_at(content, idx))
}

/// Знаходить усі байтові офсети regex-збігів `pattern` у `content` — тонка
/// обгортка над `find_iter`, повертає лише `start()` (спільний примітив для
/// кількох сканерів цього батчу).
fn find_all_starts(content: &str, pattern: &regex::Regex) -> Vec<usize> {
    pattern.find_iter(content).map(|m| m.start()).collect()
}

/// Чи файл — JS-тест з тим самим суфіксним набором, що
/// [`is_test_file_no_process_chdir`] (`.test.mjs`/`.test.js`) — псевдонім
/// для `no-console-store-restore`/`no-bun-test-import`: три різні JS-модулі
/// (`collect-test-file-offenders.mjs`, `collect-test-files.mjs`,
/// `collect-test-files.mjs` для no-process-chdir) визначають `isTestFile`
/// ІДЕНТИЧНО (той самий суфіксний набір) — тут одна спільна функція замість
/// трьох дублікатів.
fn is_bun_test_suffix_file(path: &str) -> bool {
    is_test_file_no_process_chdir(path)
}

/// Чи рядок містить пряме присвоєння `console.<method> = …` (не `==`/`===`).
/// Точний порт `findOffenders`'s `CONSOLE_ASSIGN_RE.test(line)` —
/// [`CONSOLE_ASSIGN_PATTERN`] без `(?!=)`, компенсовано ручною перевіркою
/// наступного символу (доккомент константи).
fn line_has_console_store_assign(line: &str, re: &regex::Regex) -> bool {
    re.find_iter(line)
        .any(|m| !line[m.end()..].starts_with('='))
}

/// Точний порт `lint()` `test/no-console-store-restore` (`main.mjs:35-55`)
/// — WHOLE-BATCH: кожен `*.test.{mjs,js}` скануємо порядково, одна
/// діагностика на кожен порушений рядок (той самий мотив, що
/// [`detect_no_process_chdir`]).
fn detect_no_console_store_restore(files: &[SourceFile]) -> Vec<Diagnostic> {
    let re = regex::Regex::new(CONSOLE_ASSIGN_PATTERN).expect("CONSOLE_ASSIGN_PATTERN валідний");
    let mut out = Vec::new();
    for file in files {
        if !is_bun_test_suffix_file(&file.path) {
            continue;
        }
        for (index, line) in file.content.split('\n').enumerate() {
            if line_has_console_store_assign(line, &re) {
                out.push(Diagnostic {
                    reason: NO_CONSOLE_STORE_RESTORE_VIOLATION_REASON.to_string(),
                    message: format!(
                        "{}:{}: пряме присвоєння console.<method> = … заборонено — використовуй \
                         vi.spyOn(console, 'method').mockReturnValue() (test.mdc, no-console-store-restore)",
                        file.path,
                        index + 1
                    ),
                    file: None,
                    severity: Severity::Error,
                    data: None,
                });
            }
        }
    }
    out
}

/// Розбирає список іменованих специфікаторів `{ a, b as c }` на імена, що
/// РЕАЛЬНО імпортуються (`imported`, ігноруючи `local`-аліас) — точний порт
/// `parseSpecifiers` (`main.mjs:38-51`), лишень повертає `imported` (єдине,
/// що потрібне [`find_bun_test_imports`]/[`BunTestImportMatch::fixable`]).
fn parse_bun_test_specifiers(raw: &str) -> Vec<String> {
    let ws_re = regex::Regex::new(WHITESPACE_PATTERN).expect("WHITESPACE_PATTERN валідний");
    raw.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| {
            let tokens: Vec<&str> = ws_re.split(s).filter(|t| !t.is_empty()).collect();
            match tokens.iter().position(|t| *t == "as") {
                Some(as_idx) => tokens[..as_idx].join(" "),
                None => tokens.join(" "),
            }
        })
        .collect()
}

/// Один знайдений `import { ... } from 'bun:test'` — точний порт форми
/// `findBunTestImports` (`main.mjs:60-68`), без `end`/`raw` (T0-фікс
/// `fix-no-bun-test-import.mjs` перечитує файл і парсить сам — доккомент
/// модуля цього крейту, «T0-критичний» вище).
struct BunTestImportMatch {
    /// Символьний офсет початку `import { ... }`.
    start: usize,
    /// Іменовані специфікатори (`imported`-імена, без `local`-аліасів).
    specifiers: Vec<String>,
    /// Чи всі специфікатори мають прямий 1:1 еквівалент у vitest.
    fixable: bool,
}

/// Точний порт `findBunTestImports` (`main.mjs:60-68`) — [`BUN_TEST_IMPORT_PATTERN`]
/// доккомент пояснює єдину розбіжність (без backreference-перевірки лапок).
fn find_bun_test_imports(content: &str) -> Vec<BunTestImportMatch> {
    let re = regex::Regex::new(BUN_TEST_IMPORT_PATTERN).expect("BUN_TEST_IMPORT_PATTERN валідний");
    re.captures_iter(content)
        .map(|caps| {
            let m = caps.get(0).expect("група 0 завжди є");
            let specifiers = parse_bun_test_specifiers(&caps[1]);
            let fixable = !specifiers.is_empty()
                && specifiers
                    .iter()
                    .all(|s| SAFE_BUN_TEST_SPECIFIERS.contains(&s.as_str()));
            BunTestImportMatch {
                start: content[..m.start()].chars().count(),
                specifiers,
                fixable,
            }
        })
        .collect()
}

/// Мінімальне (без сторонніх крейтів — доккомент `crates/test-plugin-guest`,
/// «data — вручну зібраний JSON-рядок») JSON string-екранування — точний
/// набір спецсимволів `JSON.stringify` для рядків (`"`, `\`, control chars).
fn json_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Точний порт `lint()` `test/no-bun-test-import` (`main.mjs:76-105`) —
/// WHOLE-BATCH. `data` — вручну зібраний JSON-рядок `{"fixable":…,"specifiers":[…]}`
/// (той самий мотив, що [`detect_no_process_chdir`]) — **T0-критичне поле**:
/// `fix-no-bun-test-import.mjs`'s `patterns[0].test`/`apply` матчать саме на
/// `reason === 'bun-test-import' && data?.fixable`.
fn detect_no_bun_test_import(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for file in files {
        if !is_bun_test_suffix_file(&file.path) {
            continue;
        }
        let found = find_bun_test_imports(&file.content);
        if found.is_empty() {
            continue;
        }
        for m in found {
            let line = line_number_at(&file.content, m.start);
            let message = if m.fixable {
                format!(
                    "{}:{line}: import з 'bun:test' — vitest не резолвить цей пакет; auto-fix \
                     перепише джерело на 'vitest' (test.mdc)",
                    file.path
                )
            } else {
                format!(
                    "{}:{line}: import з 'bun:test' містить специфікатори без прямого 1:1 \
                     еквіваленту у vitest ({}) — потрібне ручне виправлення call-sites \
                     (vi.fn/vi.spyOn мають інший API) (test.mdc)",
                    file.path,
                    m.specifiers.join(", ")
                )
            };
            let specifiers_json = m
                .specifiers
                .iter()
                .map(|s| json_escape_string(s))
                .collect::<Vec<_>>()
                .join(",");
            out.push(Diagnostic {
                reason: BUN_TEST_IMPORT_VIOLATION_REASON.to_string(),
                message,
                file: Some(file.path.clone()),
                severity: Severity::Error,
                data: Some(format!(
                    "{{\"fixable\":{},\"specifiers\":[{specifiers_json}]}}",
                    m.fixable
                )),
            });
        }
    }
    out
}

/// Чи specifier-рядок імпорту заборонений — точний порт
/// `isForbiddenRedisModule` (`redis-imports.mjs:53-56`).
fn is_forbidden_redis_module(module: &str) -> bool {
    FORBIDDEN_REDIS_MODULES.contains(&module)
        || module.starts_with("ioredis/")
        || module.starts_with("redis/")
        || module.starts_with("@redis/")
}

/// Чи сканувати файл за розширенням — точний порт `isRedisScanSourceFile`
/// (теж [`is_bun_db_scan_source_file`]/`isMssqlScanSourceFile` — той самий
/// `SOURCE_FILE_RE` у трьох JS-оригіналах).
fn is_js_ts_source_file(path: &str) -> bool {
    regex::Regex::new(JS_TS_SOURCE_FILE_PATTERN)
        .expect("JS_TS_SOURCE_FILE_PATTERN валідний")
        .is_match(path)
}

/// Точний порт `shouldSkipFileForRedisScan` (`redis-imports.mjs:128-130`).
fn should_skip_redis_scan_file(path: &str) -> bool {
    path.ends_with(".d.ts")
}

/// Один знайдений заборонений redis-імпорт — [`find_redis_imports_in_text`].
struct RedisImportHit {
    /// Символьний офсет початку `import`/`require`/`import(` ключового слова.
    start: usize,
    /// Специфікатор модуля (`ioredis`, `@redis/client`, ...).
    module: String,
}

/// Регекс-наближення `findRedisImportsInText` (AST-оригінал через
/// oxc-parser, `redis-imports.mjs:64-112`) — доккомент секції вище
/// «Регекс-наближення». Покриває три форми: статичний
/// `import ... from '<mod>'` (включно з side-effect `import '<mod>'` і
/// багаторядковим специфікатором), `require('<mod>')`,
/// динамічний `import('<mod>')`.
fn find_redis_imports_in_text(content: &str) -> Vec<RedisImportHit> {
    let import_re = regex::Regex::new(r#"\bimport\s+(?:[^;]*?\bfrom\s+)?['"]([^'"]+)['"]"#)
        .expect("import_re валідний");
    let require_re = regex::Regex::new(r#"\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)"#)
        .expect("require_re валідний");
    let dynamic_import_re = regex::Regex::new(r#"\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)"#)
        .expect("dynamic_import_re валідний");

    let mut hits = Vec::new();
    for caps in import_re.captures_iter(content) {
        let m = caps.get(0).expect("група 0 завжди є");
        hits.push(RedisImportHit {
            start: content[..m.start()].chars().count(),
            module: caps[1].to_string(),
        });
    }
    for caps in require_re.captures_iter(content) {
        let m = caps.get(0).expect("група 0 завжди є");
        hits.push(RedisImportHit {
            start: content[..m.start()].chars().count(),
            module: caps[1].to_string(),
        });
    }
    for caps in dynamic_import_re.captures_iter(content) {
        let m = caps.get(0).expect("група 0 завжди є");
        hits.push(RedisImportHit {
            start: content[..m.start()].chars().count(),
            module: caps[1].to_string(),
        });
    }
    hits.retain(|h| is_forbidden_redis_module(&h.module));
    hits.sort_by_key(|h| h.start);
    hits
}

/// Точний порт `lint()` `js-bun-redis/imports` (`main.mjs:62-88`) —
/// WHOLE-BATCH: гейт на кореневий `package.json` (`existsSync`-перевірка
/// JS-оригіналу — тут: чи є `package.json` серед файлів батчу), потім скан
/// усіх JS/TS-джерел.
fn detect_redis_imports(files: &[SourceFile]) -> Vec<Diagnostic> {
    if !files.iter().any(|f| f.path == "package.json") {
        return Vec::new();
    }
    let mut out = Vec::new();
    for file in files {
        if !is_js_ts_source_file(&file.path) || should_skip_redis_scan_file(&file.path) {
            continue;
        }
        for hit in find_redis_imports_in_text(&file.content) {
            let line = line_number_at(&file.content, hit.start);
            let snippet = line_text_at(&file.content, hit.start).trim();
            out.push(Diagnostic {
                reason: REDIS_IMPORTS_VIOLATION_REASON.to_string(),
                message: format!(
                    "js-bun-redis: {}:{line} — заміни '{}' на Bun native Redis (import {{ redis }} \
                     from 'bun', https://bun.com/docs/runtime/redis): {snippet}",
                    file.path, hit.module
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
        }
    }
    out
}

/// Псевдонім [`is_js_ts_source_file`] для `js-bun-db/safety` — той самий
/// `SOURCE_FILE_RE`, що redis/mssql (доккомент константи).
fn is_bun_db_scan_source_file(path: &str) -> bool {
    is_js_ts_source_file(path) && !path.ends_with(".d.ts")
}

/// Чи вміст містить `import { sql|SQL } from 'bun'` — точний порт
/// `textHasBunSqlImport` (`js-source-signals.mjs`).
fn has_bun_sql_import(content: &str) -> bool {
    regex::Regex::new(BUN_SQL_IMPORT_PATTERN)
        .expect("BUN_SQL_IMPORT_PATTERN валідний")
        .is_match(content)
}

/// Чи вміст імпортує пакет `pg` — точний порт `textHasPgLibImport`/
/// `findPgLibImportInText` (спрощено до boolean — рядок/snippet тут не
/// потрібні, `detect_bun_db_safety` сам рахує лінію).
fn has_pg_lib_import(content: &str) -> bool {
    regex::Regex::new(PG_LIB_IMPORT_PATTERN)
        .expect("PG_LIB_IMPORT_PATTERN валідний")
        .is_match(content)
}

/// Чи вміст містить сигнал LISTEN/NOTIFY/UNLISTEN — регекс-наближення
/// `findPgListenNotifyUsageInText` (доккомент [`PG_LISTEN_NOTIFY_CALL_PATTERN`]).
fn has_pg_listen_notify(content: &str) -> bool {
    regex::Regex::new(PG_LISTEN_NOTIFY_CALL_PATTERN)
        .expect("PG_LISTEN_NOTIFY_CALL_PATTERN валідний")
        .is_match(content)
        || regex::Regex::new(PG_NOTIFICATION_LISTENER_PATTERN)
            .expect("PG_NOTIFICATION_LISTENER_PATTERN валідний")
            .is_match(content)
}

/// Груба перевірка «виглядає як JSON-обʼєкт» (без повного парсера —
/// доккомент [`json_escape_string`], та сама економія залежностей) —
/// достатньо, щоб відрізнити валідний package.json від сировини на кшталт
/// `"NOT_VALID_JSON"` (skip-not-crash фікстура `safety.test.mjs`).
fn looks_like_json_object(content: &str) -> bool {
    let trimmed = content.trim();
    trimmed.starts_with('{') && trimmed.ends_with('}')
}

/// Чи `package.json`-подібний вміст декларує `dependencies.<field>` —
/// регекс-наближення JSON-парсингу (`[^{}]*` — плоский `dependencies`-блок,
/// типовий для фікстур; вкладені обʼєкти всередині `dependencies` на
/// практиці не зустрічаються).
fn json_declares_dependency(content: &str, field: &str) -> bool {
    let pattern = format!(
        r#""dependencies"\s*:\s*\{{[^{{}}]*"{}"\s*:"#,
        regex::escape(field)
    );
    regex::Regex::new(&pattern)
        .map(|re| re.is_match(content))
        .unwrap_or(false)
}

/// Витягає рядкове значення `dependencies.<field>` — регекс-наближення
/// того самого JSON-поля, повертає значення (не лише presence), потрібне
/// [`parse_leading_semver`].
fn json_dependency_value(content: &str, field: &str) -> Option<String> {
    let pattern = format!(
        r#""dependencies"\s*:\s*\{{[^{{}}]*"{}"\s*:\s*"([^"]*)""#,
        regex::escape(field)
    );
    regex::Regex::new(&pattern)
        .ok()
        .and_then(|re| re.captures(content))
        .map(|caps| caps[1].to_string())
}

/// Точний порт `parseLeadingSemver` (`js-mssql/deps/main.mjs:74-83`).
fn parse_leading_semver(range: &str) -> Option<(u32, u32, u32)> {
    let prefix_re =
        regex::Regex::new(VERSION_PREFIX_PATTERN).expect("VERSION_PREFIX_PATTERN валідний");
    let cleaned = prefix_re.replace(range.trim(), "");
    let semver_re = regex::Regex::new(SEMVER_PATTERN).expect("SEMVER_PATTERN валідний");
    let caps = semver_re.captures(&cleaned)?;
    let major = caps[1].parse().ok()?;
    let minor = caps[2].parse().ok()?;
    let patch = caps[3].parse().ok()?;
    Some((major, minor, patch))
}

/// Точний порт `semverGte` (`js-mssql/deps/main.mjs:90-94`).
fn semver_gte(a: (u32, u32, u32), b: (u32, u32, u32)) -> bool {
    if a.0 != b.0 {
        return a.0 > b.0;
    }
    if a.1 != b.1 {
        return a.1 > b.1;
    }
    a.2 >= b.2
}

/// Компільований набір regex-ів для сканерів `js-bun-db/safety`, побудований
/// раз на виклик [`scan_bun_sql_patterns`] (уникає перекомпіляції на кожен
/// файл whole-batch).
struct BunSqlScanRegexes {
    new_sql: regex::Regex,
    unsafe_call: regex::Regex,
    pg_leftover_call: regex::Regex,
    allow_unsafe_marker: regex::Regex,
    allow_pg_leftover_marker: regex::Regex,
    dynamic_list_join: regex::Regex,
    in_list_interp: regex::Regex,
    format_shim_func: regex::Regex,
    quote_helper_func: regex::Regex,
    format_placeholder: regex::Regex,
    query_wrapper_param: regex::Regex,
    json_stringify_jsonb: regex::Regex,
    sql_array_call: regex::Regex,
}

impl BunSqlScanRegexes {
    fn new() -> Self {
        Self {
            new_sql: regex::Regex::new(NEW_BUN_SQL_PATTERN).expect("валідний"),
            unsafe_call: regex::Regex::new(UNSAFE_CALL_PATTERN).expect("валідний"),
            pg_leftover_call: regex::Regex::new(PG_LEFTOVER_CALL_PATTERN).expect("валідний"),
            allow_unsafe_marker: regex::Regex::new(ALLOW_UNSAFE_MARKER_PATTERN).expect("валідний"),
            allow_pg_leftover_marker: regex::Regex::new(ALLOW_PG_LEFTOVER_MARKER_PATTERN)
                .expect("валідний"),
            dynamic_list_join: regex::Regex::new(DYNAMIC_SQL_LIST_JOIN_PATTERN).expect("валідний"),
            in_list_interp: regex::Regex::new(IN_LIST_INTERP_PATTERN).expect("валідний"),
            format_shim_func: regex::Regex::new(PG_FORMAT_SHIM_FUNC_PATTERN).expect("валідний"),
            quote_helper_func: regex::Regex::new(QUOTE_HELPER_FUNC_PATTERN).expect("валідний"),
            format_placeholder: regex::Regex::new(PG_FORMAT_PLACEHOLDER_PATTERN).expect("валідний"),
            query_wrapper_param: regex::Regex::new(QUERY_WRAPPER_PARAM_PATTERN).expect("валідний"),
            json_stringify_jsonb: regex::Regex::new(JSON_STRINGIFY_JSONB_PATTERN)
                .expect("валідний"),
            sql_array_call: regex::Regex::new(SQL_ARRAY_CALL_PATTERN).expect("валідний"),
        }
    }
}

/// Точний порт `scanFileForBunSqlPatterns` (`js-bun-db/safety/main.mjs:137-225`)
/// — гейт «файл має сам імпортувати Bun SQL» застосовує викликач
/// ([`detect_bun_db_safety`]), не ця функція (той самий подіум, що
/// `findBunSqlPgLeftoverCallInText`'s внутрішній `textHasBunSqlImport`-гейт,
/// тут винесений на рівень виклику для єдиного проходу по файлу).
fn scan_bun_sql_patterns(rel: &str, content: &str, re: &BunSqlScanRegexes) -> Vec<String> {
    let chars: Vec<char> = content.chars().collect();
    let mut out = Vec::new();

    // new SQL(...) всередині функції (перевіряємо brace-глибину в місці виклику).
    for start in find_all_starts(content, &re.new_sql) {
        let char_idx = content[..start].chars().count();
        if brace_depth_before(&chars, char_idx) > 0 {
            let line = line_number_at(content, char_idx);
            out.push(format!(
                "js-bun-db: {rel}:{line} — не створюй new SQL(...) всередині функцій; тримай \
                 singleton на рівні модуля (js-bun-db.mdc)"
            ));
        }
    }

    // <obj>.unsafe(...) без маркера / з інтерпольованим TemplateLiteral.
    for start in find_all_starts(content, &re.unsafe_call) {
        let char_idx = content[..start].chars().count();
        let has_marker = marker_present_nearby(content, char_idx, &re.allow_unsafe_marker);
        if !has_marker {
            let line = line_number_at(content, char_idx);
            out.push(format!(
                "js-bun-db: {rel}:{line} — sql.unsafe(...) заборонено за замовчуванням; якщо \
                 випадок легітимний — додай маркер \"// n-rules:allow-unsafe: <причина>\" на \
                 тому ж рядку або рядком вище (js-bun-db.mdc)"
            ));
        }
        // Аргумент виклику — для перевірки template-літерала з інтерполяцією.
        if let Some(open_paren) = chars[char_idx..].iter().position(|&c| c == '(') {
            let open_idx = char_idx + open_paren;
            if let Some(close_idx) = find_matching_bracket(&chars, open_idx, '(', ')') {
                let arg: String = chars[open_idx + 1..close_idx].iter().collect();
                let trimmed = arg.trim();
                if trimmed.starts_with('`') && trimmed.contains("${") {
                    let line = line_number_at(content, char_idx);
                    out.push(format!(
                        "js-bun-db: {rel}:{line} — sql.unsafe(`...${{x}}...`) з template-літералом \
                         і інтерполяцією заборонено навіть з n-rules:allow-unsafe маркером — збери \
                         text через @scaleleap/pg-format або позиційні $N (js-bun-db.mdc)"
                    ));
                }
            }
        }
    }

    // pg-leftover <obj>.connect()/.end() без маркера.
    for start in find_all_starts(content, &re.pg_leftover_call) {
        let char_idx = content[..start].chars().count();
        if !marker_present_nearby(content, char_idx, &re.allow_pg_leftover_marker) {
            let line = line_number_at(content, char_idx);
            out.push(format!(
                "js-bun-db: {rel}:{line} — pg-leftover виклик: Bun SQL пулом керує сам, видали \
                 зайвий .connect()/.end() або додай маркер \"// n-rules:allow-pg-leftover: \
                 <причина>\" (js-bun-db.mdc)"
            ));
        }
    }

    // Динамічний SQL-список через .join(',') у IN/VALUES.
    for start in find_all_starts(content, &re.dynamic_list_join) {
        let char_idx = content[..start].chars().count();
        let line = line_number_at(content, char_idx);
        out.push(format!(
            "js-bun-db: {rel}:{line} — заборонено підставляти у SQL динамічні списки через \
             .join(','); використовуй sql([...]) (js-bun-db.mdc)"
        ));
    }

    // IN (${...}) — не-Identifier чи Identifier без guard-а на пустоту.
    let ident_re = regex::Regex::new(r"^[A-Za-z_$][\w$]*$").expect("валідний");
    for caps in re.in_list_interp.captures_iter(content) {
        let m = caps.get(0).expect("група 0 завжди є");
        let inner = caps[1].trim();
        let char_idx = content[..m.start()].chars().count();
        let line = line_number_at(content, char_idx);
        if !ident_re.is_match(inner) {
            out.push(format!(
                "js-bun-db: {rel}:{line} — IN-список у ${{sql(...)}} має підставлятись зі змінної \
                 (Identifier) після валідації на пустоту + throw (js-bun-db.mdc)"
            ));
        } else {
            let guard_re = regex::Regex::new(&format!(
                r"if\s*\(\s*!\s*{}\.length\s*\)",
                regex::escape(inner)
            ))
            .expect("валідний");
            let has_guard = guard_re
                .find(content)
                .map(|m| content[m.end()..].contains("throw"))
                .unwrap_or(false);
            if !has_guard {
                out.push(format!(
                    "js-bun-db: {rel}:{line} — перед IN-списком {inner} потрібна перевірка на \
                     пустоту з throw (наприклад if (!{inner}.length) throw ...) (js-bun-db.mdc)"
                ));
            }
        }
    }

    // pg-format-сумісні шими (format/pgFormat/sqlFormat/pgFmt з %L/%I/%s у тілі).
    for caps in re.format_shim_func.captures_iter(content) {
        let m = caps.get(0).expect("група 0 завжди є");
        let name = &caps[1];
        if let Some(brace_rel) = content[m.end()..].find('{') {
            let open_idx = content[..m.end() + brace_rel].chars().count();
            if let Some(close_idx) = find_matching_bracket(&chars, open_idx, '{', '}') {
                let body: String = chars[open_idx + 1..close_idx].iter().collect();
                if re.format_placeholder.is_match(&body) {
                    let line = line_number_at(content, content[..m.start()].chars().count());
                    out.push(format!(
                        "js-bun-db: {rel}:{line} — функція \"{name}\" виглядає як pg-format-сумісний \
                         шим; видали шим і переведи call-site на tagged template sql`...${{value}}...` \
                         (js-bun-db.mdc)"
                    ));
                }
            }
        }
    }
    // Quote/escape-хелпери — дають violation незалежно від тіла.
    for caps in re.quote_helper_func.captures_iter(content) {
        let m = caps.get(0).expect("група 0 завжди є");
        let name = &caps[1];
        let line = line_number_at(content, content[..m.start()].chars().count());
        out.push(format!(
            "js-bun-db: {rel}:{line} — \"{name}\" — це pg-format-специфічний escape-хелпер; з Bun \
             SQL він не потрібен, видали і перепиши call-site (js-bun-db.mdc)"
        ));
    }

    // query(text|sql|query, ...) { ... .unsafe(...) ... } — pg-сумісна обгортка.
    for m in re.query_wrapper_param.find_iter(content) {
        if let Some(paren_rel) = content[m.start()..].find('(') {
            let open_paren = content[..m.start() + paren_rel].chars().count();
            if let Some(close_paren) = find_matching_bracket(&chars, open_paren, '(', ')') {
                if let Some(brace_rel) = chars[close_paren..].iter().position(|&c| c == '{') {
                    let open_brace = close_paren + brace_rel;
                    if let Some(close_brace) = find_matching_bracket(&chars, open_brace, '{', '}') {
                        let body: String = chars[open_brace + 1..close_brace].iter().collect();
                        if re.unsafe_call.is_match(&body) {
                            let line =
                                line_number_at(content, content[..m.start()].chars().count());
                            out.push(format!(
                                "js-bun-db: {rel}:{line} — query(text, params)-обгортка над \
                                 <obj>.unsafe(...) — прихований pg-сумісний шим; видали обгортку \
                                 (js-bun-db.mdc)"
                            ));
                        }
                    }
                }
            }
        }
    }

    // JSON.stringify(...) перед ::jsonb — Bun SQL серіалізує автоматично.
    for m in re.json_stringify_jsonb.find_iter(content) {
        let line = line_number_at(content, content[..m.start()].chars().count());
        out.push(format!(
            "js-bun-db: {rel}:{line} — JSON.stringify(...) перед ::jsonb зайвий: Bun SQL серіалізує \
             автоматично (js-bun-db.mdc query-safety)"
        ));
    }

    // sql.array(arr) без другого аргументу типу.
    for m in re.sql_array_call.find_iter(content) {
        let char_idx = content[..m.end()].chars().count() - 1; // офсет символу '('
        if let Some(close_idx) = find_matching_bracket(&chars, char_idx, '(', ')') {
            let arg: String = chars[char_idx + 1..close_idx].iter().collect();
            if !arg.contains(',') {
                let line = line_number_at(content, content[..m.start()].chars().count());
                out.push(format!(
                    "js-bun-db: {rel}:{line} — sql.array(arr) без другого аргументу типу — вкажи \
                     явний pg-тип: sql.array(arr, 'int8')/'uuid' тощо (js-bun-db.mdc sql-array)"
                ));
            }
        }
    }

    out
}

/// Точний порт `lint()` `js-bun-db/safety` (`main.mjs:323-432`) — WHOLE-BATCH,
/// доккомент секції вище «Регекс-наближення» пояснює межі відповідності
/// AST-оригіналу. Гейт «кожен `.unsafe`/`.connect`/… скан застосовується
/// лише у файлах, що САМІ імпортують Bun SQL» (`has_bun_sql_import`
/// per-file) — консервативне спрощення (JS делегує гейт частково на рівень
/// окремих `find*`-функцій, тут — єдиний зовнішній гейт перед усім
/// проходом файлу).
fn detect_bun_db_safety(files: &[SourceFile]) -> Vec<Diagnostic> {
    if !files.iter().any(|f| f.path == "package.json") {
        return Vec::new();
    }
    let mut messages: Vec<String> = Vec::new();

    let source_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| is_bun_db_scan_source_file(&f.path))
        .collect();
    let package_json_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| f.path == "package.json" || f.path.ends_with("/package.json"))
        .collect();

    let has_any_listen_notify = source_files
        .iter()
        .any(|f| has_pg_listen_notify(&f.content));

    for pkg in &package_json_files {
        if !looks_like_json_object(&pkg.content) {
            continue;
        }
        if json_declares_dependency(&pkg.content, "pg") && !has_any_listen_notify {
            messages.push(format!(
                "js-bun-db: {}: dependencies.pg заборонено — у проекті не знайдено LISTEN / \
                 NOTIFY / UNLISTEN (js-bun-db.mdc, секція «pg для LISTEN/NOTIFY»)",
                pkg.path
            ));
        }
    }

    for f in &source_files {
        if has_pg_lib_import(&f.content) && !has_pg_listen_notify(&f.content) {
            messages.push(format!(
                "js-bun-db: {} — import 'pg' дозволено лише у файлах з LISTEN / NOTIFY / UNLISTEN \
                 або .on('notification', ...) (js-bun-db.mdc)",
                f.path
            ));
        }
    }

    let regexes = BunSqlScanRegexes::new();
    for f in &source_files {
        if has_bun_sql_import(&f.content) {
            messages.extend(scan_bun_sql_patterns(&f.path, &f.content, &regexes));
        }
    }

    messages
        .into_iter()
        .map(|message| Diagnostic {
            reason: BUN_DB_SAFETY_VIOLATION_REASON.to_string(),
            message,
            file: None,
            severity: Severity::Error,
            data: None,
        })
        .collect()
}

/// Точний порт `auditMssqlVersionInPackageJson`+`aggregateMssqlVersionsAcrossPackages`
/// (`js-mssql/deps/main.mjs:105-147`) — повертає `(found, bad, messages)`.
fn audit_mssql_versions(package_json_files: &[&SourceFile]) -> (u32, u32, Vec<String>) {
    let mut found = 0u32;
    let mut bad = 0u32;
    let mut messages = Vec::new();
    for pkg in package_json_files {
        if !looks_like_json_object(&pkg.content) {
            messages.push(format!("js-mssql: {} — невалідний JSON", pkg.path));
            continue;
        }
        let Some(range) = json_dependency_value(&pkg.content, "mssql") else {
            continue;
        };
        if range.trim().is_empty() {
            continue;
        }
        found += 1;
        let Some(parsed) = parse_leading_semver(&range) else {
            bad += 1;
            messages.push(format!(
                "js-mssql: {}: dependencies.mssql має нечитабельну версію: {:?} (js-mssql.mdc)",
                pkg.path, range
            ));
            continue;
        };
        if !semver_gte(parsed, MIN_MSSQL_VERSION) {
            bad += 1;
            messages.push(format!(
                "js-mssql: {}: dependencies.mssql {:?} — має бути >=12.5.0 (js-mssql.mdc)",
                pkg.path, range
            ));
        }
    }
    (found, bad, messages)
}

/// Точний порт `scanMssqlOneSourceFile` (`js-mssql/deps/main.mjs:157-202`)
/// — доккомент секції вище «Регекс-наближення» (той самий мотив, що
/// [`scan_bun_sql_patterns`]).
fn scan_mssql_source_file(rel: &str, content: &str) -> Vec<String> {
    let chars: Vec<char> = content.chars().collect();
    let mut out = Vec::new();

    let new_pool_re = regex::Regex::new(NEW_MSSQL_CONNECTION_POOL_PATTERN).expect("валідний");
    for start in find_all_starts(content, &new_pool_re) {
        let char_idx = content[..start].chars().count();
        if brace_depth_before(&chars, char_idx) > 0 {
            let line = line_number_at(content, char_idx);
            out.push(format!(
                "js-mssql: {rel}:{line} — не створюй new sql.ConnectionPool(...) на кожен запит; \
                 використовуй singleton sql.ConnectionPool"
            ));
        }
    }

    let shared_request_re = regex::Regex::new(MSSQL_SHARED_REQUEST_PATTERN).expect("валідний");
    for start in find_all_starts(content, &shared_request_re) {
        let char_idx = content[..start].chars().count();
        let line = line_number_at(content, char_idx);
        out.push(format!(
            "js-mssql: {rel}:{line} — заборонено шарити Request (наприклад export const request = \
             pool.request()); створюй pool.request() щоразу заново (js-mssql.mdc)"
        ));
    }

    let unsafe_query_re = regex::Regex::new(MSSQL_UNSAFE_QUERY_TEMPLATE_PATTERN).expect("валідний");
    for start in find_all_starts(content, &unsafe_query_re) {
        let char_idx = content[..start].chars().count();
        let line = line_number_at(content, char_idx);
        out.push(format!(
            "js-mssql: {rel}:{line} — заборонено query(`...`): це не tagged template; використовуй \
             pool.request().query`...` (js-mssql.mdc)"
        ));
    }

    let dynamic_list_re = regex::Regex::new(DYNAMIC_SQL_LIST_JOIN_PATTERN).expect("валідний");
    for start in find_all_starts(content, &dynamic_list_re) {
        let char_idx = content[..start].chars().count();
        let line = line_number_at(content, char_idx);
        out.push(format!(
            "js-mssql: {rel}:{line} — заборонено підставляти у SQL динамічні списки через \
             .join(','); використовуй TVP (sql.Table) + JOIN/INSERT (js-mssql.mdc)"
        ));
    }

    let in_list_re = regex::Regex::new(IN_LIST_INTERP_PATTERN).expect("валідний");
    let ident_re = regex::Regex::new(r"^[A-Za-z_$][\w$]*$").expect("валідний");
    for caps in in_list_re.captures_iter(content) {
        let m = caps.get(0).expect("група 0 завжди є");
        let inner = caps[1].trim();
        let char_idx = content[..m.start()].chars().count();
        let line = line_number_at(content, char_idx);
        if !ident_re.is_match(inner) {
            out.push(format!(
                "js-mssql: {rel}:{line} — значення для IN (${{...}}) у template literal треба \
                 винести в окрему змінну і перевірити на пустоту (throw) (js-mssql.mdc)"
            ));
            continue;
        }
        let guard_re = regex::Regex::new(&format!(
            r"if\s*\(\s*!\s*{}\.length\s*\)",
            regex::escape(inner)
        ))
        .expect("валідний");
        let has_guard = guard_re
            .find(content)
            .map(|m| content[m.end()..].contains("throw"))
            .unwrap_or(false);
        if !has_guard {
            out.push(format!(
                "js-mssql: {rel}:{line} — перед IN-списком {inner} потрібна перевірка на пустоту \
                 з throw (js-mssql.mdc)"
            ));
        }
    }

    out
}

/// Точний порт `lint()` `js-mssql/deps` (`main.mjs:267-297`) — WHOLE-BATCH.
/// Джерела скануються лише якщо ХОЧ ОДИН `package.json` у батчі декларує
/// `dependencies.mssql` (`found > 0`, точний порт `if (found === 0) { pass;
/// return }`) — незалежно від того, чи версія валідна/достатня.
fn detect_mssql_deps(files: &[SourceFile]) -> Vec<Diagnostic> {
    if !files.iter().any(|f| f.path == "package.json") {
        return Vec::new();
    }
    let package_json_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| f.path == "package.json" || f.path.ends_with("/package.json"))
        .collect();
    if package_json_files.is_empty() {
        return Vec::new();
    }

    let (found, _bad, mut messages) = audit_mssql_versions(&package_json_files);
    if found == 0 {
        return Vec::new();
    }

    let source_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| is_js_ts_source_file(&f.path) && !f.path.ends_with(".d.ts"))
        .collect();
    for f in &source_files {
        messages.extend(scan_mssql_source_file(&f.path, &f.content));
    }

    messages
        .into_iter()
        .map(|message| Diagnostic {
            reason: MSSQL_DEPS_VIOLATION_REASON.to_string(),
            message,
            file: None,
            severity: Severity::Error,
            data: None,
        })
        .collect()
}

// =====================================================================
// Задача Q3: `js/utils_imports` — AST-концерн через `oxc_parser`.

/// Чи рядок `src` — заборонений parent-relative import. Точний порт
/// `PARENT_RELATIVE_RE = /^\.\.(?:\/|$)/u` (`main.mjs:19`, `js/utils_imports`)
/// — без regex-крейту, бо патерн тривіальний (рівність `".."` або префікс
/// `"../"`).
fn is_parent_relative_import(src: &str) -> bool {
    src == ".." || src.starts_with("../")
}

/// Visitor, що збирає import-source-рядки з дерева одного файлу: статичний
/// `ImportDeclaration.source` (лише toplevel — валідно синтаксично лише там,
/// тож `Program.body`-рівня досить, `visit_import_declaration` не викликає
/// `walk_import_declaration` далі), динамічний `import('…')`
/// ([`ImportExpression::source`], може бути ГЛИБОКО вкладений — звідси
/// потрібен повний обхід дерева, не лише toplevel), `require('…')`
/// (`CallExpression` з callee-`Identifier` `require`, теж може бути
/// вкладений). Точний порт `extractImportSources` (`main.mjs:120-145`) —
/// `walkAstWithAncestors(program, [], node => { dynamicImportModule(node);
/// requireCallModule(node) })` (`npm/scripts/utils/ast-scan-utils.mjs`) +
/// окремий прохід `parsed.module.staticImports` для `ImportDeclaration`.
/// Емпірично звірено (`node -e` з реальним npm `oxc-parser`): `module.staticImports`
/// містить ЛИШЕ `ImportDeclaration.source` (НЕ `export … from`/`export *
/// from` — ці не є "static import"), тому [`visit_import_declaration`] —
/// повний еквівалент, без окремого проходу `Program.body`.
struct ImportSourceVisitor {
    sources: Vec<String>,
}

impl<'a> Visit<'a> for ImportSourceVisitor {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        self.sources.push(it.source.value.as_str().to_string());
        // Навмисно БЕЗ `walk_import_declaration(self, it)` — специфікатори
        // (`{ a, b as c }`) не містять вкладених `import()`/`require()`,
        // яких мали б стосуватись інші visit-гілки цього visitor-а.
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if let Expression::StringLiteral(lit) = &it.source {
            self.sources.push(lit.value.as_str().to_string());
        }
        // JS-оригінал `dynamicImportModule` теж повертає `null` (пропускає)
        // для нелітерального аргументу (`import(computed())`) — той самий
        // ефект тут: гілка `if let` вище просто нічого не додає.
        walk_import_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::Identifier(ident) = &it.callee {
            if ident.name.as_str() == "require" {
                if let Some(Argument::StringLiteral(lit)) = it.arguments.first() {
                    self.sources.push(lit.value.as_str().to_string());
                }
            }
        }
        walk_call_expression(self, it);
    }
}

/// Парсить `content` (мова обирається з розширення `file_path` — точний
/// відповідник `langFromPath`, `SourceType::from_path` покриває той самий
/// набір розширень `js/mjs/cjs/jsx/ts/mts/cts/tsx`) і повертає всі
/// import-source-рядки через [`ImportSourceVisitor`]. Помилки парсингу НЕ
/// перевіряються (best-effort, точний порт: `extractImportSources` теж не
/// звіряє `result.errors`, лише ловить exception із самого `parseSync` —
/// `oxc_parser::Parser::parse` структурно не кидає, тож відповідний
/// `try/catch` тут не потрібен).
fn extract_import_sources(content: &str, file_path: &str) -> Vec<String> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(file_path).unwrap_or_default();
    let ret = Parser::new(&allocator, content, source_type).parse();
    let mut visitor = ImportSourceVisitor {
        sources: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.sources
}

/// Чи `path` (posix-relative від cwd, гарантовано містить сегмент `utils`
/// — host уже звузив batch за `ConcernContribution.glob`) — файл, що
/// [`detect_utils_imports`] має перевірити: відтворює
/// `findUtilsDirs`/`collectUtilsSources`-фільтри (доккомент модуля).
fn is_checked_utils_source_file(path: &str) -> bool {
    let segments: Vec<&str> = path.split('/').collect();
    let Some(utils_idx) = segments.iter().position(|s| *s == "utils") else {
        return false;
    };
    if segments[..utils_idx]
        .iter()
        .any(|s| UTILS_SKIP_DIR_NAMES.contains(s))
    {
        return false;
    }
    if utils_idx + 1 < segments.len() {
        let between = &segments[utils_idx + 1..segments.len() - 1];
        if between
            .iter()
            .any(|s| *s == "tests" || *s == "__fixtures__" || UTILS_SKIP_DIR_NAMES.contains(s))
        {
            return false;
        }
    }
    let Some(filename) = segments.last() else {
        return false;
    };
    let source_re =
        regex::Regex::new(UTILS_JS_SOURCE_PATTERN).expect("UTILS_JS_SOURCE_PATTERN валідний");
    let test_re =
        regex::Regex::new(UTILS_TEST_FILE_PATTERN).expect("UTILS_TEST_FILE_PATTERN валідний");
    source_re.is_match(filename) && !test_re.is_match(filename)
}

/// Точний порт `lint()` `js/utils_imports`
/// (`plugins/lang-js/rules/js/utils_imports/main.mjs:151-194`) — WHOLE-BATCH,
/// перший AST-концерн задачі Q3 (доккомент модуля, розділ
/// «js/utils_imports/test/no-relative-fs-path — AST-концерни»).
fn detect_utils_imports(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for file in files {
        if !is_checked_utils_source_file(&file.path) {
            continue;
        }
        for src in extract_import_sources(&file.content, &file.path) {
            if !is_parent_relative_import(&src) {
                continue;
            }
            diagnostics.push(Diagnostic {
                reason: UTILS_IMPORTS_VIOLATION_REASON.to_string(),
                message: format!(
                    "{}: заборонений імпорт '{src}' — utils/-файли мають бути generic (js.mdc)",
                    file.path
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
        }
    }
    diagnostics
}

// =====================================================================
// Задача Q3: `test/no-relative-fs-path` — AST-концерн через `oxc_parser`.

/// Чи `s` — очевидно-абсолютний рядок (не потребує детекції). Точний порт
/// `isRelativeString` (`main.mjs:93-100`, `test/no-relative-fs-path`) —
/// повертає `true`, якщо `s` НЕ абсолютний (тобто це і є relative-порушення).
fn is_relative_string(s: &str, windows_drive_re: &regex::Regex) -> bool {
    if s.is_empty() {
        return false;
    }
    if NO_RELATIVE_FS_PATH_ABSOLUTE_PREFIXES
        .iter()
        .any(|p| s.starts_with(p))
    {
        return false;
    }
    !windows_drive_re.is_match(s)
}

/// Конкатенація `cooked`-значень `TemplateElement`-ів без expressions.
/// Точний порт `arg.quasis.map(q => q.value.cooked).join('')` (`main.mjs:79`)
/// — З ОДНІЄЮ свідомою відмінністю: `cooked` теоретично `None` лише для
/// invalid escape-послідовності (не покрито жодною фікстурою); JS-оригінал
/// у цьому випадку вставив би літеральний рядок `"undefined"` (`.join`
/// стрінгіфікує `undefined`-елемент масиву) — це JS-специфічний footgun, не
/// навмисна поведінка, тож тут — порожній рядок замість відтворення багу.
fn template_quasis_cooked_text(tpl: &TemplateLiteral) -> String {
    tpl.quasis
        .iter()
        .map(|q| q.value.cooked.map(|s| s.as_str()).unwrap_or(""))
        .collect()
}

/// Точний порт `extractRelativeLiteralPath` (`main.mjs:74-85`,
/// `test/no-relative-fs-path`) — `Literal`(string)/`TemplateLiteral`(без
/// expressions) з relative-значенням, інакше `None` (обчислені вирази й
/// template-и з `${}` — припускаємо absolute, той самий мотив, що
/// JS-коментар оригіналу).
fn extract_relative_literal_path(
    arg: &Argument,
    windows_drive_re: &regex::Regex,
) -> Option<String> {
    match arg {
        Argument::StringLiteral(lit) => {
            let value = lit.value.as_str();
            is_relative_string(value, windows_drive_re).then(|| value.to_string())
        }
        Argument::TemplateLiteral(tpl) => {
            if !tpl.expressions.is_empty() {
                return None;
            }
            let raw = template_quasis_cooked_text(tpl);
            is_relative_string(&raw, windows_drive_re).then_some(raw)
        }
        _ => None,
    }
}

/// Ім'я FS-функції з callee — точний порт `extractFsFunctionName`
/// (`main.mjs:111-121`): `Identifier` напряму (`writeFile(...)`) або
/// non-computed `StaticMemberExpression` (`fs.writeFile(...)`,
/// `fsp.promises.writeFile(...)` — лише `.property`, `.object`-ланцюжок
/// ігнорується, той самий мотив, що JS-оригінал). Повертає канонічне ім'я з
/// [`FS_PATH_ARG_POSITIONS`], не сирий текст (для стабільного `&'static str`
/// у повідомленні).
fn extract_fs_function_name(callee: &Expression) -> Option<&'static str> {
    let name = match callee {
        Expression::Identifier(ident) => ident.name.as_str(),
        Expression::StaticMemberExpression(member) => member.property.name.as_str(),
        _ => return None,
    };
    FS_PATH_ARG_POSITIONS
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(n, _)| *n)
}

/// Число байтових-офсетних новий-рядків до `offset` (1-індексований номер
/// рядка) — той самий мотив, що `computeLineOffsets`/`offsetToLineFromCache`
/// (`main.mjs:161-190`) на ASCII-фікстурах: `oxc_span::Span`-офсети — байтові
/// (UTF-8), як і в npm `oxc-parser` (спайк S1, розділ «Мікро-parity»
/// `docs/specs/2026-08-01-wasm-ast-strategy.md`), тоді як JS-оригінал рахує
/// офсети через `for (const ch of body)` — по code point, не по байту.
/// Для ASCII (усі наявні фікстури) байт == code point, тож розбіжності
/// немає; для non-ASCII вмісту в JS-оригіналі вже є цей самий baseline-баг
/// (не щось, що цей порт мав би "виправляти" — задокументовано, не покрито
/// regression-тестом, той самий мотив, що інші розбіжності цього модуля).
fn line_number_at_offset(content: &str, offset: usize) -> usize {
    content.as_bytes()[..offset.min(content.len())]
        .iter()
        .filter(|&&b| b == b'\n')
        .count()
        + 1
}

/// Один offender: (1-індексований рядок, канонічне ім'я FS-функції,
/// relative-шлях з літералу, 0-індексована позиція аргументу).
type FsPathOffender = (usize, &'static str, String, usize);

/// Visitor для [`find_offenders_in_body`] — точний порт тіла
/// `walkAstWithAncestors(program, [], node => {…})` у `findOffendersInBody`
/// (`main.mjs:138-159`): для кожного `CallExpression` з callee з
/// [`FS_PATH_ARG_POSITIONS`] перевіряє ВСІ задекларовані path-позиції
/// аргументів (не лише перший — `copyFile`/`rename`/`symlink`/`link`/`cp`
/// мають дві).
struct FsPathVisitor<'c> {
    content: &'c str,
    windows_drive_re: regex::Regex,
    offenders: Vec<FsPathOffender>,
}

impl<'a, 'c> Visit<'a> for FsPathVisitor<'c> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some(fn_name) = extract_fs_function_name(&it.callee) {
            if let Some((_, positions)) = FS_PATH_ARG_POSITIONS.iter().find(|(n, _)| *n == fn_name)
            {
                for &pos in *positions {
                    let Some(arg) = it.arguments.get(pos) else {
                        continue;
                    };
                    let Some(rel_path) = extract_relative_literal_path(arg, &self.windows_drive_re)
                    else {
                        continue;
                    };
                    let start = arg.span().start as usize;
                    let line = line_number_at_offset(self.content, start);
                    self.offenders.push((line, fn_name, rel_path, pos));
                }
            }
        }
        walk_call_expression(self, it);
    }
}

/// Точний порт `findOffendersInBody` (`main.mjs:138-159`) — на відміну від
/// [`extract_import_sources`], ТУТ файл із syntax-error пропускається
/// цілком (порожній результат, точний порт `parseProgramOrNull`'s
/// `if (result.errors?.length) return null`, `npm/scripts/utils/ast-scan-utils.mjs:104-114`).
/// Віртуальний шлях завжди `"test.mjs"` (той самий, що JS-оригінал передає
/// в `parseProgramOrNull(body, 'test.mjs')`) — `langFromPath('test.mjs')`
/// завжди `'js'`, реальне розширення файлу-джерела не впливає на вибір мови
/// парсера для ЦЬОГО концерну (на відміну від [`extract_import_sources`]).
fn find_offenders_in_body(content: &str) -> Vec<FsPathOffender> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path("test.mjs").unwrap_or_default();
    let ret = Parser::new(&allocator, content, source_type).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = FsPathVisitor {
        content,
        windows_drive_re: regex::Regex::new(NO_RELATIVE_FS_PATH_WINDOWS_DRIVE_PATTERN)
            .expect("NO_RELATIVE_FS_PATH_WINDOWS_DRIVE_PATTERN валідний"),
        offenders: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.offenders
}

/// Точний порт `lint()` `test/no-relative-fs-path`
/// (`plugins/lang-js/rules/test/no-relative-fs-path/main.mjs:199-239`) —
/// WHOLE-BATCH, гість-фільтр [`is_test_file_no_process_chdir`] (той самий
/// предикат, що `test/no-process-chdir` — доккомент модуля).
fn detect_no_relative_fs_path(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for file in files {
        if !is_test_file_no_process_chdir(&file.path) {
            continue;
        }
        for (line, fn_name, rel_path, arg_pos) in find_offenders_in_body(&file.content) {
            let which = if arg_pos == 0 {
                "1-й аргумент".to_string()
            } else {
                format!("{}-й аргумент", arg_pos + 1)
            };
            diagnostics.push(Diagnostic {
                reason: NO_RELATIVE_FS_PATH_VIOLATION_REASON.to_string(),
                message: format!(
                    "{}:{line}: {fn_name}() — {which} '{rel_path}' relative; використовуй join(dir, …) (test.mdc, no-relative-fs-path)",
                    file.path
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
        }
    }
    diagnostics
}

/// Чистий (без host-імпортів `log`/`report-progress`) конструктор маніфеста —
/// винесений з [`Guest::describe`] окремо, щоб host-таргет unit-тести могли
/// звірити форму маніфеста, не викликаючи `log()` (host-import, який поза
/// реальним wasmtime-хостом абортує процес — доккомент модуля, «Ключове
/// застереження» у SKILL.md крок 2).
fn build_manifest() -> Manifest {
    Manifest {
        id: "lang-js/wasm-concerns".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.0.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![
            ConcernContribution {
                key: CONCERN_TFM.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.vue".to_string()],
            },
            ConcernContribution {
                key: CONCERN_GAP.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.vue".to_string(),
                    "**/*.scss".to_string(),
                    "**/*.css".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_POOL_FORKS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "vitest.config.mjs".to_string(),
                    "vitest.config.js".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_NO_PROCESS_CHDIR.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
            },
            ConcernContribution {
                key: CONCERN_ADMIN_TABLE.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.vue".to_string(),
                    "**/*.scss".to_string(),
                    "**/*.css".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_QUASAR_FIXES.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.vue".to_string(),
                    "**/*.scss".to_string(),
                    "**/*.css".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_LOCATION.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string()],
            },
            ConcernContribution {
                key: CONCERN_NO_CONSOLE_STORE_RESTORE.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
            },
            ConcernContribution {
                key: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
            },
            ConcernContribution {
                key: CONCERN_UTILS_IMPORTS.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/utils/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string()],
            },
            ConcernContribution {
                key: CONCERN_NO_RELATIVE_FS_PATH.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
            },
            // `js-bun-redis/imports`, `js-bun-db/safety`, `js-mssql/deps` —
            // СВІДОМО без контрибуції (де-скоуп рішенням оркестратора,
            // доккомент модуля вище «Регекс-наближення» і секція нижче): їхні
            // detect-функції лишаються в крейті як groundwork, не в цьому
            // масиві.
        ],
        ci_artifacts: vec![],
        capabilities: Capabilities {
            // Вміст файлів хост передає inline (per-file чи host-побудований
            // full-scope batch, доккомент `wit/world.wit`) — плагін не читає
            // диск сам.
            fs_read: vec![],
            network: false,
        },
        tools: vec![],
    }
}

/// Точний порт тіла циклу `lint()` (`main.mjs:40-52` vue/tfm-translations)
/// для ОДНОГО файлу — чиста функція (без host-імпортів), яку host-таргет
/// unit-тести викликають напряму. Хост уже відфільтрував/прочитав вміст
/// (спека §3.2), тут лишається сама перевірка.
fn detect_one_file_tfm(file: &SourceFile) -> Option<Diagnostic> {
    if !file.path.ends_with(".vue") {
        return None;
    }
    if !imports_tf_from_tfm(&file.content) {
        return None;
    }
    if declares_get_tr(&file.content) {
        return None;
    }
    Some(Diagnostic {
        reason: TFM_VIOLATION_REASON.to_string(),
        message: format!(
            "{}: імпортує 'tf' з '@nitra/tfm', але не оголошує функцію getTr() з перекладами \
             (vue.mdc tfm-translations)",
            file.path
        ),
        file: Some(file.path.clone()),
        severity: Severity::Error,
        data: None,
    })
}

/// Точний порт `lint()` `style/gap` (`main.mjs:19-51`) — WHOLE-BATCH
/// перевірка (не per-file, доккомент модуля): кожен суфікс `n-gap-{xs,sm,md,lg}`,
/// використаний у `.vue`, має бути визначений хоч в одному `.scss`/`.css`/`.vue`
/// з УСЬОГО переданого `files` (хост уже зібрав whole-repo batch за
/// `ConcernContribution::glob`, спека §3.2 передумова full-scope мосту,
/// задача N2 п.2).
///
/// `used`/`defined` — `BTreeSet` (сортований), не порядок вставки, як
/// JS-`Set`: детермінізм отримуємо явно (алфавітний порядок суфіксів
/// `lg`/`md`/`sm`/`xs`), а не мімікруємо insertion-order, залежний від
/// порядку `detect-batch.files` (не гарантований контрактом як стабільний
/// між host-реалізаціями). Жодна наявна фікстура (JS чи parity-тест) не
/// покриває ОДНОЧАСНО кілька відсутніх суфіксів, тож ця відмінність від
/// JS insertion-order не порушує parity на реальних сценаріях.
fn detect_gap(files: &[SourceFile]) -> Vec<Diagnostic> {
    let usage_re = regex::Regex::new(GAP_USAGE_PATTERN).expect("GAP_USAGE_PATTERN валідний");
    let definition_re =
        regex::Regex::new(GAP_DEFINITION_PATTERN).expect("GAP_DEFINITION_PATTERN валідний");

    let mut used: BTreeSet<String> = BTreeSet::new();
    let mut defined: BTreeSet<String> = BTreeSet::new();
    for file in files {
        if file.path.ends_with(".vue") {
            for captures in usage_re.captures_iter(&file.content) {
                used.insert(captures[1].to_string());
            }
        }
        for captures in definition_re.captures_iter(&file.content) {
            defined.insert(captures[1].to_string());
        }
    }

    used.difference(&defined)
        .map(|suffix| Diagnostic {
            reason: GAP_VIOLATION_REASON.to_string(),
            message: format!(
                "Клас `.n-gap-{suffix}` використовується у `.vue`, але не визначений у жодному \
                 `.scss`/`.css` (guide: style/gap.mdc) — додай клас до app.scss"
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        })
        .collect()
}

/// Точний порт `lint()` `test/vitest-config-pool-forks`
/// (`main.mjs:20-41`) — WHOLE-BATCH: перший наявний
/// `vitest.config.{mjs,js}` серед `files` (пріоритет [`VITEST_CONFIG_NAMES`]
/// — `.mjs` раніше за `.js`, дзеркало `Array::find`) має містити
/// `pool: 'forks'`. Відсутність жодного конфіга — `pass()` у JS (без
/// діагностики), тут — порожній `Vec`.
fn detect_pool_forks(files: &[SourceFile]) -> Vec<Diagnostic> {
    let Some(config) = VITEST_CONFIG_NAMES
        .iter()
        .find_map(|name| files.iter().find(|file| file.path == *name))
    else {
        return Vec::new();
    };

    let pool_forks_re = regex::Regex::new(POOL_FORKS_PATTERN).expect("POOL_FORKS_PATTERN валідний");
    if pool_forks_re.is_match(&config.content) {
        return Vec::new();
    }

    vec![Diagnostic {
        reason: POOL_FORKS_VIOLATION_REASON.to_string(),
        message: format!(
            "{} має містити pool: 'forks' — defense-in-depth для race у process.cwd() між \
             паралельними test files (test.mdc)",
            config.path
        ),
        file: None,
        severity: Severity::Error,
        data: None,
    }]
}

/// Точний порт `lint()` `test/no-process-chdir` (`main.mjs:14-40`) —
/// WHOLE-BATCH: кожен `*.test.{mjs,js}` (гість-фільтр
/// [`is_test_file_no_process_chdir`], доккомент модуля «розбіжність
/// full-scope мосту») скануємо порядково, одна діагностика на кожен рядок із
/// `process.chdir(`. `data` — вручну зібраний JSON-рядок (той самий мотив,
/// що `crates/test-plugin-guest`, доккомент модуля тут) — точний відповідник
/// `data: { line: i + 1 }`.
fn detect_no_process_chdir(files: &[SourceFile]) -> Vec<Diagnostic> {
    let chdir_re = regex::Regex::new(CHDIR_CALL_PATTERN).expect("CHDIR_CALL_PATTERN валідний");
    let mut diagnostics = Vec::new();
    for file in files {
        if !is_test_file_no_process_chdir(&file.path) {
            continue;
        }
        if !chdir_re.is_match(&file.content) {
            continue;
        }
        for (index, line) in file.content.split('\n').enumerate() {
            if !chdir_re.is_match(line) {
                continue;
            }
            let line_number = index + 1;
            diagnostics.push(Diagnostic {
                reason: NO_PROCESS_CHDIR_VIOLATION_REASON.to_string(),
                message: format!(
                    "{}:{line_number}: process.chdir() у тесті заборонений — використовуй \
                     withTmpDir(async dir => …) + явні join(dir, …) + cwd: dir (test.mdc)",
                    file.path
                ),
                file: Some(file.path.clone()),
                severity: Severity::Error,
                data: Some(format!("{{\"line\":{line_number}}}")),
            });
        }
    }
    diagnostics
}

/// Точний порт `lint()` `style/admin_table` (`main.mjs:19-46`) —
/// WHOLE-BATCH, той самий usage↔definition мотив, що [`detect_gap`], але для
/// ОДНОГО класу (не набору суфіксів): найкоротший шлях зупинки — раннє
/// `break`, коли обидва прапорці вже `true` (точний порт `if (used &&
/// defined) break`).
fn detect_admin_table(files: &[SourceFile]) -> Vec<Diagnostic> {
    let usage_re =
        regex::Regex::new(ADMIN_TABLE_USAGE_PATTERN).expect("ADMIN_TABLE_USAGE_PATTERN валідний");
    let definition_re = regex::Regex::new(ADMIN_TABLE_DEFINITION_PATTERN)
        .expect("ADMIN_TABLE_DEFINITION_PATTERN валідний");

    let mut used = false;
    let mut defined = false;
    for file in files {
        if !used && file.path.ends_with(".vue") && usage_re.is_match(&file.content) {
            used = true;
        }
        if !defined && definition_re.is_match(&file.content) {
            defined = true;
        }
        if used && defined {
            break;
        }
    }

    if used && !defined {
        vec![Diagnostic {
            reason: ADMIN_TABLE_VIOLATION_REASON.to_string(),
            message: "Клас `.n-admin-table` використовується у `.vue`, але не визначений у \
                       жодному `.scss`/`.css` (guide: style/admin_table.mdc) — додай фікс до \
                       app.scss"
                .to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        }]
    } else {
        Vec::new()
    }
}

/// Точний порт `lint()` `style/quasar_fixes` (`main.mjs:19-57`) —
/// WHOLE-BATCH: для кожної пари [`QUASAR_FIXES`] незалежні прапорці
/// used/defined (індекс масиву — паралельний до JS `Set.has(fix.name)`),
/// вивід — у ФІКСОВАНОМУ порядку `QUASAR_FIXES` (доккомент типу), не в
/// порядку виявлення.
fn detect_quasar_fixes(files: &[SourceFile]) -> Vec<Diagnostic> {
    let usage_res: Vec<regex::Regex> = QUASAR_FIXES
        .iter()
        .map(|fix| regex::Regex::new(fix.usage_pattern).expect("usage_pattern валідний"))
        .collect();
    let definition_res: Vec<regex::Regex> = QUASAR_FIXES
        .iter()
        .map(|fix| regex::Regex::new(fix.definition_pattern).expect("definition_pattern валідний"))
        .collect();

    let mut used = [false; QUASAR_FIXES.len()];
    let mut defined = [false; QUASAR_FIXES.len()];
    for file in files {
        for i in 0..QUASAR_FIXES.len() {
            if !used[i] && file.path.ends_with(".vue") && usage_res[i].is_match(&file.content) {
                used[i] = true;
            }
            if !defined[i] && definition_res[i].is_match(&file.content) {
                defined[i] = true;
            }
        }
    }

    QUASAR_FIXES
        .iter()
        .enumerate()
        .filter(|(i, _)| used[*i] && !defined[*i])
        .map(|(_, fix)| Diagnostic {
            reason: QUASAR_FIXES_VIOLATION_REASON.to_string(),
            message: format!(
                "Компонент `{}` використовується у `.vue`, але фікс `{}` відсутній у \
                 `.scss`/`.css` (guide: style/quasar_fixes.mdc) — додай фікс до app.scss",
                fix.name, fix.selector
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        })
        .collect()
}

/// Точний порт `lint()` `test/location` (`main.mjs:33-70`) — WHOLE-BATCH,
/// ЛИШЕ ШЛЯХИ: `SourceFile::content` тут НІКОЛИ не читається (JS-оригінал
/// теж працює виключно з `absPath`, без `readFile`). Порядок збігається з
/// порядком `files` у батчі (той самий детермінований native-обхід, що
/// живить і host, і `collectTestFiles`-стиль колекцію JS-оригіналу).
fn detect_location(files: &[SourceFile]) -> Vec<Diagnostic> {
    files
        .iter()
        .filter(|file| is_test_file_location(&file.path))
        .filter(|file| !is_inside_tests_dir(&file.path))
        .map(|file| {
            let parent_dir = posix_dirname(&file.path);
            let base = posix_basename(&file.path);
            Diagnostic {
                reason: LOCATION_VIOLATION_REASON.to_string(),
                message: format!(
                    "{}: тест має лежати у tests/ — перенеси у {parent_dir}/{TESTS_DIR_NAME}/{base} \
                     (test.mdc)",
                    file.path
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            }
        })
        .collect()
}

/// Guest-реалізація world `plugin` — одинадцять контрибуцій ([`CONCERN_TFM`],
/// [`CONCERN_GAP`], [`CONCERN_POOL_FORKS`], [`CONCERN_NO_PROCESS_CHDIR`],
/// [`CONCERN_ADMIN_TABLE`], [`CONCERN_QUASAR_FIXES`], [`CONCERN_LOCATION`],
/// [`CONCERN_NO_CONSOLE_STORE_RESTORE`], [`CONCERN_NO_BUN_TEST_IMPORT`],
/// [`CONCERN_UTILS_IMPORTS`], [`CONCERN_NO_RELATIVE_FS_PATH`]).
/// `detect()` нижче зберігає match-гілки і для [`CONCERN_REDIS_IMPORTS`]/
/// [`CONCERN_BUN_DB_SAFETY`]/[`CONCERN_MSSQL_DEPS`] (недосяжні через
/// `describe()` — host їх не викличе, доккомент секції «Регекс-наближення»
/// вище) — захисна відповідність один-до-одного з groundwork-функціями, не
/// мертвий код без причини.
struct LangJs;

impl Guest for LangJs {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-lang-js: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        let total = batch.files.len() as u32;
        // Шість із семи контрибуцій — whole-batch (доккомент модуля): один
        // "крок" прогресу, не per-file (весь batch аналізується разом).
        // `CONCERN_TFM` (дефолтна гілка `_`) лишається per-file.
        let diagnostics = match batch.concern_id.as_str() {
            CONCERN_GAP => {
                report_progress(total, total);
                detect_gap(&batch.files)
            }
            CONCERN_POOL_FORKS => {
                report_progress(total, total);
                detect_pool_forks(&batch.files)
            }
            CONCERN_NO_PROCESS_CHDIR => {
                report_progress(total, total);
                detect_no_process_chdir(&batch.files)
            }
            CONCERN_ADMIN_TABLE => {
                report_progress(total, total);
                detect_admin_table(&batch.files)
            }
            CONCERN_QUASAR_FIXES => {
                report_progress(total, total);
                detect_quasar_fixes(&batch.files)
            }
            CONCERN_LOCATION => {
                report_progress(total, total);
                detect_location(&batch.files)
            }
            CONCERN_NO_CONSOLE_STORE_RESTORE => {
                report_progress(total, total);
                detect_no_console_store_restore(&batch.files)
            }
            CONCERN_NO_BUN_TEST_IMPORT => {
                report_progress(total, total);
                detect_no_bun_test_import(&batch.files)
            }
            CONCERN_UTILS_IMPORTS => {
                report_progress(total, total);
                detect_utils_imports(&batch.files)
            }
            CONCERN_NO_RELATIVE_FS_PATH => {
                report_progress(total, total);
                detect_no_relative_fs_path(&batch.files)
            }
            CONCERN_REDIS_IMPORTS => {
                report_progress(total, total);
                detect_redis_imports(&batch.files)
            }
            CONCERN_BUN_DB_SAFETY => {
                report_progress(total, total);
                detect_bun_db_safety(&batch.files)
            }
            CONCERN_MSSQL_DEPS => {
                report_progress(total, total);
                detect_mssql_deps(&batch.files)
            }
            _ => {
                let mut diagnostics = Vec::new();
                for (index, file) in batch.files.iter().enumerate() {
                    report_progress(index as u32 + 1, total);
                    if let Some(diagnostic) = detect_one_file_tfm(file) {
                        diagnostics.push(diagnostic);
                    }
                }
                diagnostics
            }
        };
        log(
            LogLevel::Info,
            &format!(
                "plugin-lang-js: detect({}) опрацював {total} файл(ів)",
                batch.concern_id
            ),
        );
        diagnostics
    }

    /// v3.0-заглушка — жоден із двох JS-оригіналів не має fix-контуру (лише
    /// detect), тож `FixPlan` завжди порожній.
    fn fix(_request: FixRequest) -> FixPlan {
        FixPlan { edits: vec![] }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

export!(LangJs);

#[cfg(test)]
mod tests {
    //! Юніт-тести на host-таргеті (`cargo test -p plugin-lang-js`, без
    //! wasm-збірки) — лише чисті helper-и, НЕ `Guest::describe`/`Guest::detect`
    //! напряму (доккомент модуля: host-імпорти абортують поза реальним
    //! хостом). Golden-тест через реальний `PluginHost` —
    //! `crates/rules-plugin-host/tests/plugin_lang_js.rs`.
    use super::*;

    // --- vue/tfm-translations ---

    #[test]
    fn imports_tf_named_specifier_is_detected() {
        assert!(imports_tf_from_tfm(
            "import { lang, tf as tfm } from '@nitra/tfm'\n"
        ));
        assert!(imports_tf_from_tfm("import { tf } from '@nitra/tfm'\n"));
    }

    #[test]
    fn imports_only_other_named_specifiers_is_not_detected() {
        assert!(!imports_tf_from_tfm("import { lang } from '@nitra/tfm'\n"));
        assert!(!imports_tf_from_tfm("const x = 1\n"));
    }

    #[test]
    fn declares_get_tr_matches_function_and_const_forms() {
        assert!(declares_get_tr("function getTr() { return {} }"));
        assert!(declares_get_tr("const getTr = () => ({})"));
        assert!(!declares_get_tr("const other = () => ({})"));
    }

    #[test]
    fn detect_one_file_tfm_flags_file_importing_tf_without_get_tr() {
        let file = SourceFile {
            path: "Page.vue".to_string(),
            content: "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: {} })\n</script>\n".to_string(),
        };
        let diagnostic = detect_one_file_tfm(&file).expect("мало знайти violation");
        assert_eq!(diagnostic.reason, TFM_VIOLATION_REASON);
        assert!(diagnostic.message.contains("getTr"));
        assert_eq!(diagnostic.file.as_deref(), Some("Page.vue"));
        assert_eq!(diagnostic.severity, Severity::Error);
        assert!(diagnostic.data.is_none());
    }

    #[test]
    fn detect_one_file_tfm_passes_file_with_get_tr_declared() {
        let file = SourceFile {
            path: "Page.vue".to_string(),
            content: "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: getTr() })\nfunction getTr() { return {} }\n</script>\n".to_string(),
        };
        assert!(detect_one_file_tfm(&file).is_none());
    }

    #[test]
    fn detect_one_file_tfm_ignores_non_vue_files() {
        let file = SourceFile {
            path: "helper.mjs".to_string(),
            content: "import { tf } from '@nitra/tfm'\n".to_string(),
        };
        assert!(detect_one_file_tfm(&file).is_none());
    }

    // --- style/gap ---

    #[test]
    fn detect_gap_passes_when_used_suffix_is_defined() {
        let files = vec![
            SourceFile {
                path: "src/Row.vue".to_string(),
                content: "<template><div class=\"row n-gap-md\" /></template>\n".to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".n-gap-md {\n  gap: 16px;\n}\n".to_string(),
            },
        ];
        assert!(detect_gap(&files).is_empty());
    }

    #[test]
    fn detect_gap_passes_when_suffix_never_used() {
        let files = vec![SourceFile {
            path: "src/Row.vue".to_string(),
            content: "<template><div class=\"row q-gutter-md\" /></template>\n".to_string(),
        }];
        assert!(detect_gap(&files).is_empty());
    }

    #[test]
    fn detect_gap_flags_used_but_undefined_suffix() {
        let files = vec![
            SourceFile {
                path: "src/Row.vue".to_string(),
                content: "<template><div class=\"row n-gap-lg\" /></template>\n".to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".n-gap-sm {\n  gap: 8px;\n}\n".to_string(),
            },
        ];
        let diagnostics = detect_gap(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, GAP_VIOLATION_REASON);
        assert!(diagnostics[0].message.contains("n-gap-lg"));
        assert!(diagnostics[0].file.is_none());
    }

    // --- test/vitest-config-pool-forks ---

    fn source(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn detect_pool_forks_passes_when_config_has_pool_forks_single_quotes() {
        let files = vec![source(
            "vitest.config.js",
            "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { pool: 'forks' } })\n",
        )];
        assert!(detect_pool_forks(&files).is_empty());
    }

    #[test]
    fn detect_pool_forks_passes_when_mjs_config_has_pool_forks() {
        let files = vec![source(
            "vitest.config.mjs",
            "export default { test: { pool: 'forks' } }\n",
        )];
        assert!(detect_pool_forks(&files).is_empty());
    }

    #[test]
    fn detect_pool_forks_flags_config_with_other_pool() {
        let files = vec![source(
            "vitest.config.mjs",
            "export default { test: { pool: 'threads' } }\n",
        )];
        let diagnostics = detect_pool_forks(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POOL_FORKS_VIOLATION_REASON);
        assert!(diagnostics[0].file.is_none());
    }

    #[test]
    fn detect_pool_forks_passes_with_double_quotes() {
        let files = vec![source(
            "vitest.config.js",
            "export default { test: { pool: \"forks\" } }\n",
        )];
        assert!(detect_pool_forks(&files).is_empty());
    }

    #[test]
    fn detect_pool_forks_flags_missing_pool_field() {
        let files = vec![source("vitest.config.js", "export default { test: {} }\n")];
        assert_eq!(detect_pool_forks(&files).len(), 1);
    }

    #[test]
    fn detect_pool_forks_passes_when_no_config_present() {
        let files: Vec<SourceFile> = vec![];
        assert!(detect_pool_forks(&files).is_empty());
    }

    #[test]
    fn detect_pool_forks_passes_with_whitespace_around_colon() {
        let files = vec![source(
            "vitest.config.js",
            "export default { test: { pool : \"forks\" } }\n",
        )];
        assert!(detect_pool_forks(&files).is_empty());
    }

    #[test]
    fn detect_pool_forks_prefers_mjs_over_js() {
        // `.mjs` пріоритетніший — точний порядок [`VITEST_CONFIG_NAMES`].
        let files = vec![
            source(
                "vitest.config.js",
                "export default { test: { pool: 'threads' } }\n",
            ),
            source(
                "vitest.config.mjs",
                "export default { test: { pool: 'forks' } }\n",
            ),
        ];
        assert!(detect_pool_forks(&files).is_empty());
    }

    // --- test/no-process-chdir ---

    #[test]
    fn detect_no_process_chdir_passes_without_forbidden_call() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "import { test } from \"vitest\"\ntest(\"ok\", () => {})\n",
        )];
        assert!(detect_no_process_chdir(&files).is_empty());
    }

    #[test]
    fn detect_no_process_chdir_flags_call_with_dir_arg() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "import { test } from \"vitest\"\ntest(\"bad\", () => { process.chdir(\"/tmp\") })\n",
        )];
        let diagnostics = detect_no_process_chdir(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, NO_PROCESS_CHDIR_VIOLATION_REASON);
        assert_eq!(diagnostics[0].file.as_deref(), Some("tests/foo.test.mjs"));
        assert_eq!(diagnostics[0].data.as_deref(), Some("{\"line\":2}"));
    }

    #[test]
    fn detect_no_process_chdir_flags_call_with_whitespace_before_paren() {
        let files = vec![source("tests/bar.test.mjs", "process.chdir (\"/tmp\")\n")];
        assert_eq!(detect_no_process_chdir(&files).len(), 1);
    }

    #[test]
    fn detect_no_process_chdir_passes_on_comment_mention() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "// Не використовуй process.chdir — це process-wide мутація.\ntest(\"ok\", () => {})\n",
        )];
        assert!(detect_no_process_chdir(&files).is_empty());
    }

    #[test]
    fn detect_no_process_chdir_passes_on_process_cwd() {
        let files = vec![source("tests/foo.test.mjs", "const c = process.cwd()\n")];
        assert!(detect_no_process_chdir(&files).is_empty());
    }

    #[test]
    fn detect_no_process_chdir_ignores_non_test_files() {
        let files = vec![source(
            "src/helper.mjs",
            "export function fn() { process.chdir(\"/tmp\") }\n",
        )];
        assert!(detect_no_process_chdir(&files).is_empty());
    }

    #[test]
    fn detect_no_process_chdir_reports_each_file_and_line() {
        let files = vec![
            source(
                "tests/a.test.mjs",
                "process.chdir(\"/tmp\")\nprocess.chdir(\"/var\")\n",
            ),
            source("tests/b.test.mjs", "process.chdir(\"/x\")\n"),
        ];
        assert_eq!(detect_no_process_chdir(&files).len(), 3);
    }

    // --- style/admin_table ---

    #[test]
    fn detect_admin_table_passes_when_used_class_is_defined() {
        let files = vec![
            source(
                "src/Table.vue",
                "<template><q-table class=\"n-admin-table\" /></template>\n",
            ),
            source("src/app.scss", ".n-admin-table {\n  height: 100%;\n}\n"),
        ];
        assert!(detect_admin_table(&files).is_empty());
    }

    #[test]
    fn detect_admin_table_passes_when_class_never_used() {
        let files = vec![source(
            "src/Table.vue",
            "<template><q-table dense /></template>\n",
        )];
        assert!(detect_admin_table(&files).is_empty());
    }

    #[test]
    fn detect_admin_table_flags_used_but_undefined_class() {
        let files = vec![
            source(
                "src/Table.vue",
                "<template><q-table class=\"n-admin-table\" /></template>\n",
            ),
            source("src/app.scss", ".other { color: red; }\n"),
        ];
        let diagnostics = detect_admin_table(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, ADMIN_TABLE_VIOLATION_REASON);
        assert!(diagnostics[0].file.is_none());
    }

    // --- style/quasar_fixes ---

    #[test]
    fn detect_quasar_fixes_passes_when_used_fix_is_defined() {
        let files = vec![
            source("src/List.vue", "<template><q-scroll-area /></template>\n"),
            source("src/app.scss", ".q-scrollarea {\n  display: flex;\n}\n"),
        ];
        assert!(detect_quasar_fixes(&files).is_empty());
    }

    #[test]
    fn detect_quasar_fixes_passes_when_neither_component_used() {
        let files = vec![source("src/List.vue", "<template><div /></template>\n")];
        assert!(detect_quasar_fixes(&files).is_empty());
    }

    #[test]
    fn detect_quasar_fixes_flags_used_but_undefined_fix() {
        let files = vec![
            source(
                "src/Btn.vue",
                "<template><q-btn><q-tooltip>hi</q-tooltip></q-btn></template>\n",
            ),
            source("src/app.scss", ".other { color: red; }\n"),
        ];
        let diagnostics = detect_quasar_fixes(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, QUASAR_FIXES_VIOLATION_REASON);
        assert!(diagnostics[0].message.contains("q-tooltip"));
        assert!(diagnostics[0].file.is_none());
    }

    #[test]
    fn detect_quasar_fixes_reports_in_fixed_array_order() {
        // Обидва фікси відсутні — вивід має йти в порядку `QUASAR_FIXES`
        // (`q-scroll-area` перед `q-tooltip`), не в порядку виявлення у файлі.
        let files = vec![source(
            "src/Both.vue",
            "<template><q-tooltip>hi</q-tooltip><q-scroll-area /></template>\n",
        )];
        let diagnostics = detect_quasar_fixes(&files);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics[0].message.contains("q-scroll-area"));
        assert!(diagnostics[1].message.contains("q-tooltip"));
    }

    // --- test/location ---

    #[test]
    fn detect_location_passes_when_test_is_inside_tests_dir() {
        let files = vec![
            source("rules/foo/js/bar/check.mjs", ""),
            source("rules/foo/js/bar/tests/check.test.mjs", ""),
        ];
        assert!(detect_location(&files).is_empty());
    }

    #[test]
    fn detect_location_flags_test_next_to_source() {
        let files = vec![source("rules/foo/js/bar/check.test.mjs", "")];
        let diagnostics = detect_location(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, LOCATION_VIOLATION_REASON);
        assert!(diagnostics[0].file.is_none());
        assert!(diagnostics[0]
            .message
            .contains("rules/foo/js/bar/tests/check.test.mjs"));
    }

    #[test]
    fn detect_location_flags_test_in_arbitrary_non_tests_dir() {
        let files = vec![source("scripts/spec/foo.test.mjs", "")];
        assert_eq!(detect_location(&files).len(), 1);
    }

    #[test]
    fn detect_location_passes_without_any_test_file() {
        let files = vec![source("src/index.mjs", "")];
        assert!(detect_location(&files).is_empty());
    }

    #[test]
    fn detect_location_passes_for_root_tests_dir() {
        let files = vec![source("tests/integration.test.mjs", "")];
        assert!(detect_location(&files).is_empty());
    }

    #[test]
    fn detect_location_ignores_rego_test_convention() {
        // `*_test.rego` не є `*.test.mjs` — [`is_test_file_location`] не
        // матчить, той самий висновок, що JS-тест «OPA convention».
        let files = vec![
            source("rules/foo/policy/bar/bar.rego", ""),
            source("rules/foo/policy/bar/bar_test.rego", ""),
        ];
        assert!(detect_location(&files).is_empty());
    }

    // --- test/no-console-store-restore ---

    #[test]
    fn detect_no_console_store_restore_passes_without_assignment() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "import { test } from \"vitest\"\ntest(\"ok\", () => {})\n",
        )];
        assert!(detect_no_console_store_restore(&files).is_empty());
    }

    #[test]
    fn detect_no_console_store_restore_flags_direct_assignment() {
        let assign = ["console.lo", "g ="].join("");
        let files = vec![source(
            "tests/bad.test.mjs",
            &format!("const orig = {assign} fn\n"),
        )];
        let diagnostics = detect_no_console_store_restore(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].reason,
            NO_CONSOLE_STORE_RESTORE_VIOLATION_REASON
        );
        assert!(diagnostics[0].file.is_none());
        assert!(diagnostics[0].message.contains("tests/bad.test.mjs:1"));
    }

    #[test]
    fn detect_no_console_store_restore_ignores_comparison() {
        let files = vec![source(
            "tests/ok.test.mjs",
            "if (console.log === undefined) {}\n",
        )];
        assert!(detect_no_console_store_restore(&files).is_empty());
    }

    #[test]
    fn detect_no_console_store_restore_ignores_non_test_files() {
        let assign = ["console.lo", "g ="].join("");
        let files = vec![source("src/helper.mjs", &format!("{assign} vi.fn()\n"))];
        assert!(detect_no_console_store_restore(&files).is_empty());
    }

    #[test]
    fn detect_no_console_store_restore_scans_dot_test_js_too() {
        let assign = ["console.lo", "g ="].join("");
        let files = vec![source("tests/bad.test.js", &format!("{assign} stub\n"))];
        assert_eq!(detect_no_console_store_restore(&files).len(), 1);
    }

    // --- test/no-bun-test-import ---

    #[test]
    fn detect_no_bun_test_import_passes_with_vitest_import() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "import { describe, test, expect } from 'vitest'\ntest('ok', () => {})\n",
        )];
        assert!(detect_no_bun_test_import(&files).is_empty());
    }

    #[test]
    fn detect_no_bun_test_import_flags_fixable_import() {
        let bun_test = ["bun", "test"].join(":");
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("import {{ test, expect }} from '{bun_test}'\ntest('ok', () => expect(1).toBe(1))\n"),
        )];
        let diagnostics = detect_no_bun_test_import(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, BUN_TEST_IMPORT_VIOLATION_REASON);
        assert_eq!(diagnostics[0].file.as_deref(), Some("tests/foo.test.mjs"));
        let data = diagnostics[0].data.as_deref().expect("data має бути");
        assert!(data.contains("\"fixable\":true"));
        assert!(data.contains("\"test\""));
        assert!(data.contains("\"expect\""));
    }

    #[test]
    fn detect_no_bun_test_import_flags_unfixable_import_with_mock() {
        let bun_test = ["bun", "test"].join(":");
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("import {{ test, mock }} from \"{bun_test}\"\n"),
        )];
        let diagnostics = detect_no_bun_test_import(&files);
        assert_eq!(diagnostics.len(), 1);
        let data = diagnostics[0].data.as_deref().expect("data має бути");
        assert!(data.contains("\"fixable\":false"));
    }

    #[test]
    fn detect_no_bun_test_import_ignores_non_test_files() {
        let bun_test = ["bun", "test"].join(":");
        let files = vec![source(
            "src/helper.mjs",
            &format!("import {{ test }} from '{bun_test}'\n"),
        )];
        assert!(detect_no_bun_test_import(&files).is_empty());
    }

    #[test]
    fn find_bun_test_imports_finds_none_in_plain_vitest_source() {
        assert!(find_bun_test_imports("import { test } from 'vitest'\n").is_empty());
    }

    // --- js-bun-redis/imports ---

    #[test]
    fn detect_redis_imports_flags_default_import_from_ioredis() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("src/x.ts", "import Redis from 'ioredis'\n"),
        ];
        let diagnostics = detect_redis_imports(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, REDIS_IMPORTS_VIOLATION_REASON);
        assert!(diagnostics[0].message.contains("ioredis"));
    }

    #[test]
    fn detect_redis_imports_flags_require_and_dynamic_import() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("src/a.cjs", "const Redis = require('ioredis')\n"),
            source("src/b.ts", "const m = await import('redis')\n"),
        ];
        assert_eq!(detect_redis_imports(&files).len(), 2);
    }

    #[test]
    fn detect_redis_imports_passes_for_bun_native_redis() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("src/x.ts", "import { redis } from 'bun'\n"),
        ];
        assert!(detect_redis_imports(&files).is_empty());
    }

    #[test]
    fn detect_redis_imports_passes_for_unrelated_redis_mock() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("src/x.ts", "import RedisMock from 'redis-mock'\n"),
        ];
        assert!(detect_redis_imports(&files).is_empty());
    }

    #[test]
    fn detect_redis_imports_skips_whole_batch_without_root_package_json() {
        let files = vec![source("src/x.ts", "import Redis from 'ioredis'\n")];
        assert!(detect_redis_imports(&files).is_empty());
    }

    #[test]
    fn detect_redis_imports_flags_subpath_and_scoped_subpackage() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("src/a.ts", "import { Buffer } from 'ioredis/built/utils'\n"),
            source("src/b.ts", "import { defineScript } from '@redis/client'\n"),
        ];
        assert_eq!(detect_redis_imports(&files).len(), 2);
    }

    // --- js-bun-db/safety ---

    #[test]
    fn detect_bun_db_safety_passes_without_root_package_json() {
        let files = vec![source("src/app.js", "export const x = 1\n")];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_passes_for_clean_project() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("src/app.js", "export const x = 1\n"),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_passes_for_safe_singleton_and_tagged_template() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { SQL, sql } from 'bun'\nexport const db = new SQL(process.env.DATABASE_URL)\nexport async function getUser(id) {\n  return sql`SELECT * FROM users WHERE id = ${id}`\n}\n",
            ),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_flags_per_request_connection() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { SQL } from 'bun'\nexport function getUser(id) {\n  const db = new SQL(process.env.DATABASE_URL)\n  return db`SELECT * FROM users WHERE id = ${id}`\n}\n",
            ),
        ];
        assert!(!detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_flags_unsafe_call_without_marker() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport const ping = () => sql.unsafe('SELECT 1')\n",
            ),
        ];
        assert!(!detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_passes_unsafe_call_with_marker() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport const ping = () => sql.unsafe('SELECT 1') // n-rules:allow-unsafe: ping\n",
            ),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_flags_interpolated_unsafe_template_even_with_marker() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nconst TABLE = 'users_2026'\nexport async function migrate() {\n  // n-rules:allow-unsafe: DDL\n  return sql.unsafe(`CREATE TABLE ${TABLE} (id int)`)\n}\n",
            ),
        ];
        assert!(!detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_flags_pg_leftover_call_without_marker() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/shutdown.ts",
                "import { sql } from 'bun'\nexport const close = () => client.end()\nexport const ping = () => sql`SELECT 1`\n",
            ),
        ];
        assert!(!detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_ignores_pg_leftover_in_non_bun_sql_file() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("src/stream.ts", "export const stop = () => stream.end()\n"),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_flags_dynamic_join_in_in_list() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport async function findMany(ids) {\n  return sql`SELECT * FROM users WHERE id IN (${ids.join(',')})`\n}\n",
            ),
        ];
        assert!(!detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_flags_pg_dependency_without_listen_notify() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"pg\":\"^8.0.0\"}}",
            ),
            source(
                "src/app.ts",
                "import { Client } from 'pg'\nconst client = new Client()\nexport const findUser = id => client.query('SELECT * FROM users WHERE id = $1', [id])\n",
            ),
        ];
        assert!(!detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_passes_pg_dependency_with_listen() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"pg\":\"^8.0.0\"}}",
            ),
            source(
                "src/pg-listen.ts",
                "import { Client } from 'pg'\nconst client = new Client()\nexport async function start() {\n  await client.query('LISTEN orders_channel')\n  client.on('notification', msg => console.log(msg))\n}\n",
            ),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_recovers_from_invalid_nested_package_json() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("sub/package.json", "NOT_VALID_JSON"),
            source("src/app.js", "export const x = 1\n"),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    // --- js-mssql/deps ---

    #[test]
    fn detect_mssql_deps_passes_without_root_package_json() {
        let files = vec![source("src/app.js", "export const x = 1\n")];
        assert!(detect_mssql_deps(&files).is_empty());
    }

    #[test]
    fn detect_mssql_deps_passes_when_mssql_dependency_absent() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "export function getUser() {\n  const pool = new sql.ConnectionPool(config)\n  return pool\n}\n",
            ),
        ];
        // Немає dependencies.mssql — джерела взагалі не скануються (found === 0).
        assert!(detect_mssql_deps(&files).is_empty());
    }

    #[test]
    fn detect_mssql_deps_flags_version_below_minimum() {
        let files = vec![source(
            "package.json",
            "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^10.0.0\"}}",
        )];
        let diagnostics = detect_mssql_deps(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, MSSQL_DEPS_VIOLATION_REASON);
        assert!(diagnostics[0].message.contains(">=12.5.0"));
    }

    #[test]
    fn detect_mssql_deps_passes_version_at_minimum() {
        let files = vec![source(
            "package.json",
            "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
        )];
        assert!(detect_mssql_deps(&files).is_empty());
    }

    #[test]
    fn detect_mssql_deps_flags_per_request_connection_pool() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
            ),
            source(
                "src/handler.ts",
                "export async function handler() {\n  const pool = new sql.ConnectionPool(config)\n  await pool.connect()\n}\n",
            ),
        ];
        assert!(!detect_mssql_deps(&files).is_empty());
    }

    #[test]
    fn detect_mssql_deps_passes_module_level_singleton_pool() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
            ),
            source("src/db.ts", "const pool = new sql.ConnectionPool(config)\n"),
        ];
        assert!(detect_mssql_deps(&files).is_empty());
    }

    #[test]
    fn detect_mssql_deps_flags_unsafe_query_template_call() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
            ),
            source(
                "src/db.ts",
                "export async function findUser(userId) {\n  return pool.request().query(`SELECT * FROM users WHERE id = ${userId}`)\n}\n",
            ),
        ];
        assert!(!detect_mssql_deps(&files).is_empty());
    }

    #[test]
    fn detect_mssql_deps_passes_tagged_template_query() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
            ),
            source(
                "src/db.ts",
                "export async function findUser(userId) {\n  return pool.request().query`SELECT * FROM users WHERE id = ${userId}`\n}\n",
            ),
        ];
        assert!(detect_mssql_deps(&files).is_empty());
    }

    #[test]
    fn detect_mssql_deps_flags_shared_request() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
            ),
            source("src/db.ts", "export const request = pool.request()\n"),
        ];
        assert!(!detect_mssql_deps(&files).is_empty());
    }

    // --- js/utils_imports (задача Q3, AST через oxc_parser) ---
    // Фікстури дзеркалять `plugins/lang-js/rules/js/utils_imports/tests/utils_imports.test.mjs`.

    #[test]
    fn detect_utils_imports_passes_for_same_dir_import() {
        let files = vec![source(
            "utils/helper.mjs",
            "import { readFile } from 'node:fs/promises'\nexport function h() {}\n",
        )];
        assert!(detect_utils_imports(&files).is_empty());
    }

    #[test]
    fn detect_utils_imports_passes_for_bare_package_import() {
        let files = vec![source(
            "utils/fmt.mjs",
            "import { parse } from 'yaml'\nexport const p = parse\n",
        )];
        assert!(detect_utils_imports(&files).is_empty());
    }

    #[test]
    fn detect_utils_imports_flags_parent_relative_import() {
        let files = vec![source(
            "utils/bad.mjs",
            "import { config } from '../lib/config.mjs'\nexport const x = config\n",
        )];
        let diagnostics = detect_utils_imports(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "utils_imports");
        assert!(diagnostics[0].file.is_none());
        assert!(diagnostics[0].message.contains("../lib/config.mjs"));
        assert!(diagnostics[0].message.contains("utils/bad.mjs"));
    }

    #[test]
    fn detect_utils_imports_ignores_tests_subdir() {
        let files = vec![source(
            "utils/tests/helper.test.mjs",
            "import { h } from '../helper.mjs'\n",
        )];
        assert!(detect_utils_imports(&files).is_empty());
    }

    #[test]
    fn detect_utils_imports_ignores_fixtures_subdir() {
        let files = vec![source(
            "utils/__fixtures__/data.mjs",
            "import { x } from '../../other.mjs'\n",
        )];
        assert!(detect_utils_imports(&files).is_empty());
    }

    #[test]
    fn detect_utils_imports_ignores_stryker_sandbox_reports_dir() {
        let files = vec![source(
            "reports/stryker/.tmp/sandbox-1/src/utils/bad.mjs",
            "import { x } from '../lib.mjs'\nexport const y = x\n",
        )];
        assert!(detect_utils_imports(&files).is_empty());
    }

    #[test]
    fn detect_utils_imports_collects_nested_subdir_recursively() {
        let files = vec![source(
            "utils/helpers/helper.mjs",
            "import { join } from 'node:path'\nexport const h = join\n",
        )];
        assert!(detect_utils_imports(&files).is_empty());
    }

    #[test]
    fn detect_utils_imports_flags_dynamic_import_and_require() {
        let files = vec![source(
            "utils/mixed.mjs",
            "const f = () => import('../dynamic.mjs')\nconst g = require('../required.mjs')\n",
        )];
        let diagnostics = detect_utils_imports(&files);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics.iter().all(|d| d.reason == "utils_imports"));
    }

    #[test]
    fn detect_utils_imports_side_effect_import_without_dotdot_is_ok() {
        let files = vec![source("utils/setup.mjs", "import './polyfill.mjs'\n")];
        assert!(detect_utils_imports(&files).is_empty());
    }

    // --- test/no-relative-fs-path (задача Q3, AST через oxc_parser) ---
    // Фікстури дзеркалять
    // `plugins/lang-js/rules/test/no-relative-fs-path/tests/no-relative-fs-path.test.mjs`.

    const FS_TEST_HEAD: &str = "import { writeFile, copyFile, mkdir } from 'node:fs/promises'\n";

    #[test]
    fn detect_no_relative_fs_path_passes_when_join_used() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await writeFile(join(dir, 'foo.json'), 'x', 'utf8')\n"),
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_flags_relative_first_arg() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await writeFile('foo.json', 'x', 'utf8')\n"),
        )];
        let diagnostics = detect_no_relative_fs_path(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "no-relative-fs-path");
        assert!(diagnostics[0].file.is_none());
        assert!(diagnostics[0].message.contains("writeFile"));
        assert!(diagnostics[0].message.contains("1-й аргумент"));
    }

    #[test]
    fn detect_no_relative_fs_path_flags_second_arg_of_copy_file() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await copyFile('/abs/src', 'foo.json')\n"),
        )];
        let diagnostics = detect_no_relative_fs_path(&files);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("2-й аргумент"));
    }

    #[test]
    fn detect_no_relative_fs_path_passes_for_absolute_second_arg() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await copyFile('/abs/src', join(dir, 'dst'))\n"),
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_passes_for_posix_absolute_literal() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await writeFile('/tmp/x.json', 'x', 'utf8')\n"),
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_flags_member_expression_callee() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "import * as fsp from 'node:fs/promises'\nawait fsp.writeFile('foo', 'x')\n",
        )];
        assert_eq!(detect_no_relative_fs_path(&files).len(), 1);
    }

    #[test]
    fn detect_no_relative_fs_path_passes_for_absolute_sync_member_call() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "import * as fs from 'node:fs'\nfs.writeFileSync('/tmp/x', 'y')\n",
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_flags_exists_sync() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "import { existsSync } from 'node:fs'\nexistsSync('foo.json')\n",
        )];
        assert_eq!(detect_no_relative_fs_path(&files).len(), 1);
    }

    #[test]
    fn detect_no_relative_fs_path_passes_for_two_join_args() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await rename(join(dir, 'a'), join(dir, 'b'))\n"),
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_passes_for_non_literal_arg() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}const p = computeSomething()\nawait writeFile(p, 'x')\n"),
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_passes_for_template_with_expression() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await writeFile(`${{dir}}/foo`, 'x')\n"),
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_flags_template_without_expression() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await writeFile(`foo.json`, 'x')\n"),
        )];
        assert_eq!(detect_no_relative_fs_path(&files).len(), 1);
    }

    #[test]
    fn detect_no_relative_fs_path_ignores_non_test_files() {
        let files = vec![source(
            "src/helper.mjs",
            &format!(
                "{FS_TEST_HEAD}export async function fn() {{ await writeFile('any.json', 'x') }}\n"
            ),
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_skips_file_with_syntax_error() {
        let files = vec![source("tests/foo.test.mjs", "invalid <<<< syntax\n")];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_passes_for_file_url() {
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await writeFile('file:///abs/x', 'y')\n"),
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    #[test]
    fn detect_no_relative_fs_path_passes_for_windows_drive_literal() {
        // Файл-фікстура має МІСТИТИ два літеральні backslash-и перед "foo"/"bar"
        // (JS string-literal escape `\\` у ЗІБРАНОМУ `.mjs`-джерелі, не в
        // цьому Rust-рядку) — точний відповідник JS-тесту `String.raw` фікстури
        // (`no-relative-fs-path.test.mjs`, «Windows-абсолютний 'C:\\foo\\bar'»).
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("{FS_TEST_HEAD}await writeFile('C:\\\\foo\\\\bar', 'y')\n"),
        )];
        assert!(detect_no_relative_fs_path(&files).is_empty());
    }

    // --- маніфест ---

    #[test]
    fn build_manifest_declares_all_eleven_concerns_with_expected_scopes() {
        let manifest = build_manifest();
        // Де-скоуп (рішення оркестратора): `CONCERN_REDIS_IMPORTS`/
        // `CONCERN_BUN_DB_SAFETY`/`CONCERN_MSSQL_DEPS` НЕ в маніфесті —
        // groundwork без контрибуції, доккомент модуля вище.
        assert_eq!(manifest.concerns.len(), 11);
        let tfm = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_TFM)
            .expect("tfm contribution має бути в маніфесті");
        assert_eq!(tfm.scope, ConcernScope::PerFile);
        for key in [
            CONCERN_GAP,
            CONCERN_POOL_FORKS,
            CONCERN_NO_PROCESS_CHDIR,
            CONCERN_ADMIN_TABLE,
            CONCERN_QUASAR_FIXES,
            CONCERN_LOCATION,
            CONCERN_NO_CONSOLE_STORE_RESTORE,
            CONCERN_NO_BUN_TEST_IMPORT,
            CONCERN_UTILS_IMPORTS,
            CONCERN_NO_RELATIVE_FS_PATH,
        ] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .unwrap_or_else(|| panic!("{key} contribution має бути в маніфесті"));
            assert_eq!(contribution.scope, ConcernScope::Full);
            assert!(!contribution.glob.is_empty());
        }
        assert!(!manifest
            .concerns
            .iter()
            .any(|c| c.key == CONCERN_REDIS_IMPORTS
                || c.key == CONCERN_BUN_DB_SAFETY
                || c.key == CONCERN_MSSQL_DEPS));
        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
        assert_eq!(manifest.domains, vec![Domain::Lint]);
    }
}
