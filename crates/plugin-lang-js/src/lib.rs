//! wasm-компонент `n-rules:plugin@3.0.0` — `lang-js/wasm-concerns` (задачі N2,
//! Q1 батч 1, Q2 батч 2, Q3, Q4 батч 4 та батчі 5–8, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5 і
//! `docs/specs/2026-08-01-wasm-ast-strategy.md`),
//! створений за флоу скіла `npm/skills/wasm-plugin/` (scaffold → реалізація →
//! golden-тести). ТРИДЦЯТЬ ДВА концерни у контрибуції (перелік нижче —
//! перші чотирнадцять; батчі 5–8 описані в доккоментах однойменних секцій
//! нижче за текстом), порт чинних
//! JS-оригіналів — справжній 1:1, той самий `reason`/`message` біт-у-біт
//! (parity-дисципліна СКІЛа не допускає shadowing regex-наближенням
//! AST-оригіналу в контрибуції — рішення оркестратора після звіту батчу 2;
//! AST-концерни задач Q3 і Q4 — byte-exact через СПРАВЖНІЙ `oxc_parser`, не
//! потребують такого де-скоупу):
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
//!   портовано в guest через `export fix`** (пілот fix-контуру contract v3,
//!   [`fix_no_bun_test_import`]) — JS `fix-no-bun-test-import.mjs` видалено,
//!   диспатч іде через napi `run_wasm_concern_fix` → синтетичний T0Pattern
//!   (`run-fix.mjs`), живий смок —
//!   `crates/rules-plugin-host/tests/plugin_lang_js.rs` +
//!   `npm/scripts/lib/lint-surface/tests/wasm-fix-e2e.test.mjs`.
//! - `js/utils_imports` (full-scope, задача Q3) — порт
//!   `plugins/lang-js/rules/js/utils_imports/main.mjs`: **справжній
//!   oxc-parser AST-концерн**, не regex-наближення — byte-exact parity через
//!   ТОЙ САМИЙ движок (`docs/specs/2026-08-01-wasm-ast-strategy.md`). Кожен
//!   файл під якимось
//!   `utils/`-каталогом парситься `oxc_parser`, зібрані import-source
//!   (`ImportDeclaration`, динамічний `import()`, `require()`) звіряються з
//!   `^\.\.(?:/|$)` — жодного relative-імпорту з `..`.
//! - `test/no-relative-fs-path` (full-scope, задача Q3) — порт
//!   `plugins/lang-js/rules/test/no-relative-fs-path/main.mjs`: теж
//!   справжній oxc-parser AST-концерн — кожен `*.test.{mjs,js}` парситься,
//!   виклики `node:fs`/`node:fs/promises`-функцій (`FS_PATH_ARG_POSITIONS`)
//!   з relative string/template-literal-аргументом на path-позиції —
//!   порушення.
//! - `js-bun-redis/imports` (full-scope, задача Q4 батч 4) — порт
//!   `plugins/lang-js/rules/js-bun-redis/imports/main.mjs` +
//!   `../lib/redis-imports.mjs`: справжній oxc-parser AST-концерн (заміна
//!   regex-groundwork батчу 2, який СВІДОМО не був у контрибуції) —
//!   статичні `ImportDeclaration`, `require('…')` і динамічні `import('…')`
//!   заборонених redis-модулів.
//! - `js-mssql/deps` (full-scope, задача Q4 батч 4) — порт
//!   `plugins/lang-js/rules/js-mssql/deps/main.mjs` + 610-рядкового
//!   `../lib/mssql-pool-scan.mjs`: версія `dependencies.mssql` у КОЖНОМУ
//!   `package.json` (справжній JSON-парсинг через `serde_json`, дзеркало
//!   `JSON.parse`) + шість AST-сканерів джерел (singleton pool, shared
//!   Request, ``query(`...`)``, `.join(',')`-списки, непарсовані/безguard-ні
//!   `IN (${…})`).
//! - `js-bun-db/safety` (full-scope, задача Q4 батч 4) — порт
//!   `plugins/lang-js/rules/js-bun-db/safety/main.mjs` + 1071-рядкового
//!   `../lib/bun-sql-scan.mjs`: десять AST-сканерів Bun SQL-патернів
//!   (порядок сканерів на файл — точно як у `scanFileForBunSqlPatterns`) +
//!   `pg`-виняток для LISTEN/NOTIFY (dependency- і import-рівні).
//!
//! JS-реалізації лишаються канонічними (Plugin API v2, дистрибуція wasm —
//! окремий крок) — цей компонент лише переносить логіку в native/wasm шлях,
//! parity-тест `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs`
//! ганяє ОДНІ фікстури через обидві реалізації.
//!
//! # Чотирнадцять концернів в одному Guest — мотив із `test-plugin-guest`
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

use std::collections::{BTreeSet, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, ArrayExpressionElement, ArrowFunctionExpression, BinaryOperator, BindingPattern,
    BlockStatement, CallExpression, Comment, Expression, FormalParameters, Function, FunctionBody,
    FunctionType, ImportDeclaration, ImportExpression, NewExpression, ObjectExpression,
    ObjectProperty, ObjectPropertyKind, PropertyKey, RegExpLiteral, Statement, StringLiteral,
    TaggedTemplateExpression, TemplateLiteral, UnaryExpression, UnaryOperator, VariableDeclarator,
};
use oxc_ast_visit::{
    walk::{
        walk_arrow_function_expression, walk_call_expression, walk_function,
        walk_import_expression, walk_new_expression, walk_object_expression,
        walk_tagged_template_expression, walk_template_literal, walk_unary_expression,
        walk_variable_declarator,
    },
    Visit,
};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use oxc_syntax::scope::ScopeFlags;

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
// `test/no-console-store-restore`, `test/no-bun-test-import` (T0-фікс
// відтоді портовано в guest через `export fix` — пілот fix-контуру contract
// v3, [`fix_no_bun_test_import`] нижче; JS-файл видалено). Обидва
// — СПРАВЖНІЙ 1:1 порт (REGEX-based і в JS-оригіналі), обидва в контрибуції
// `describe()` як решта семи концернів.
//
// # Батч 4 (задача Q4): js-bun-redis/imports, js-mssql/deps,
// # js-bun-db/safety — AST-порти замість regex-groundwork
//
// JS-оригінали цих трьох концернів побудовані на **oxc-parser** (справжній
// AST, не regex) — `redis-imports.mjs`, `bun-sql-scan.mjs` (1071 рядків),
// `mssql-pool-scan.mjs` (610 рядків). Батч 2 лишив у крейті їхні
// regex-наближення БЕЗ контрибуції (рішення оркестратора: наближення
// AST-семантики не проходить parity-гейт для shadowing живої
// JS-реалізації). Батч 4 замінює ті groundwork-функції повноцінними
// AST-реалізаціями через ТОЙ САМИЙ пінований `oxc_parser` (=0.137.0), що й
// npm `oxc-parser` JS-оригіналів (той самий шлях, що `js/utils_imports`/
// `test/no-relative-fs-path` батчу 3) — байт-у-байт ті самі `message`
// (включно зі `snippet`-ами через [`normalize_snippet`]), тож де-скоуп
// знято: усі три концерни тепер У КОНТРИБУЦІЇ [`build_manifest`].
//
// Навмисно відтворені особливості JS-оригіналів (не «виправлені», бо parity
// важливіша за смак):
// - `TaggedTemplateExpression` обробляється І як tagged-вузол, і повторно як
//   його `quasi`-`TemplateLiteral` (walk заходить у дочірній вузол) — тому
//   `.join(',')`-списки/`IN (${…})`-guard-и/`JSON.stringify::jsonb` у
//   tagged template дають ДВІ ідентичні діагностики (перевірено live-прогоном
//   JS-оригіналу, зафіксовано parity-фікстурою).
// - Пошук guard-а `if (empty) throw` обмежений НАЙБЛИЖЧИМ enclosing
//   `BlockStatement` (guard у зовнішньому блоці не рятує вкладений) — точний
//   порт `findEnclosingBlockAndStatementIndex`.
// - `import 'pg'` (side-effect, без `from`) НЕ дає import-порушення
//   `js-bun-db/safety`: текстовий pre-filter `PG_LIB_IMPORT_RE` JS-оригіналу
//   такого імпорту не бачить, тож файл не потрапляє в `pgUsage` — pre-filter
//   відтворено, не «поліпшено» до чистого AST.
// - Лінії/зрізи — БАЙТОВІ офсети (`oxc_span::Span`), тоді як JS `slice`/
//   `offsetToLine` рахують UTF-16-юніти на байтових офсетах — збіг
//   гарантований лише для ASCII-вмісту ДО діагностованого вузла (той самий
//   задокументований baseline, що в `test/no-relative-fs-path` батчу 3);
//   фікстури тримаються ASCII.

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
/// Ключ контрибуції `js-bun-redis/imports` (задача Q4 батч 4) — справжній
/// oxc-parser AST-концерн (заміна regex-groundwork батчу 2, доккомент секції
/// «Батч 4» вище).
const CONCERN_REDIS_IMPORTS: &str = "js-bun-redis/imports";
/// Ключ контрибуції `js-bun-db/safety` (задача Q4 батч 4) — той самий
/// AST-статус, що [`CONCERN_REDIS_IMPORTS`].
const CONCERN_BUN_DB_SAFETY: &str = "js-bun-db/safety";
/// Ключ контрибуції `js-mssql/deps` (задача Q4 батч 4) — той самий
/// AST-статус, що [`CONCERN_REDIS_IMPORTS`].
const CONCERN_MSSQL_DEPS: &str = "js-mssql/deps";

/// `reason` violation-а `no-console-store-restore` — бере `fail(msg)` БЕЗ
/// другого аргументу (`createViolationReporter`, `main.mjs`), тож дефолт —
/// `ctx.concernId` (bare, без `ruleId/`-префікса) — точний той самий мотив,
/// що [`POOL_FORKS_VIOLATION_REASON`]/[`LOCATION_VIOLATION_REASON`].
const NO_CONSOLE_STORE_RESTORE_VIOLATION_REASON: &str = "no-console-store-restore";
/// `reason` violation-а `no-bun-test-import` — точний відповідник
/// `reason: 'bun-test-import'`, вручну зібраний об'єкт `main.mjs` (НЕ через
/// `createViolationReporter`). **T0-критичний**:
/// [`is_fixable_bun_test_diagnostic`] (guest-фікс, порт видаленого
/// `fix-no-bun-test-import.mjs`) матчить саме на це значення.
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
/// `\b(LISTEN|UNLISTEN|NOTIFY)\b` — точний порт `LISTEN_NOTIFY_KEYWORD_RE`
/// (`js-bun-db/safety/main.mjs`): дешевий текстовий pre-filter перед
/// AST-сканом LISTEN/NOTIFY (`collectPgUsageForFile`). Відтворюється, а не
/// «поліпшується» (доккомент секції «Батч 4» вище — side-effect `import 'pg'`
/// без жодного сигналу свідомо НЕ потрапляє в `pgUsage`).
const LISTEN_NOTIFY_KEYWORD_PATTERN: &str = r"(?i)\b(LISTEN|UNLISTEN|NOTIFY)\b";
/// `'notification'` у будь-яких лапках — точний порт `NOTIFICATION_LITERAL_RE`
/// (той самий pre-filter).
const NOTIFICATION_LITERAL_PATTERN: &str = "['\"`]notification['\"`]";
/// SQL-рядок, що починається з LISTEN/UNLISTEN/NOTIFY — точний порт
/// `PG_LISTEN_NOTIFY_SQL_RE` (`bun-sql-scan.mjs`), застосовується до
/// cooked-значення string literal чи raw-тексту quasis.
const PG_LISTEN_NOTIFY_SQL_PATTERN: &str = r"(?i)^\s*(LISTEN|UNLISTEN|NOTIFY)\b";
/// `// n-rules:allow-unsafe: <непорожня причина>` — точний порт
/// `ALLOW_UNSAFE_MARKER_RE` (`bun-sql-scan.mjs`), матчиться проти ВМІСТУ
/// коментаря (`Comment::content_span`, дзеркало `c.value`).
const ALLOW_UNSAFE_MARKER_PATTERN: &str = r"\bn-rules:allow-unsafe\s*:\s*\S+";
/// `// n-rules:allow-pg-leftover: <непорожня причина>` — точний порт
/// `ALLOW_PG_LEFTOVER_MARKER_RE`.
const ALLOW_PG_LEFTOVER_MARKER_PATTERN: &str = r"\bn-rules:allow-pg-leftover\s*:\s*\S+";
/// `IN (` / `VALUES (` у raw-тексті quasis — точний порт
/// `SQL_LIST_CONTEXT_RE` (`ast-scan-utils.mjs`, `isSqlListContextTemplate`).
const SQL_LIST_CONTEXT_PATTERN: &str = r"(?i)\b(in|values)\b\s*\(";
/// Quasi закінчується на `IN` з опційною `(` — точний порт
/// `IN_PLACEHOLDER_END_RE` `bun-sql-scan.mjs` (`/\bin\s*(\(\s*)?$/iu`) —
/// навмисно ШИРШИЙ за mssql-варіант нижче (покриває `IN ${sql(ids)}`).
const BUN_IN_PLACEHOLDER_END_PATTERN: &str = r"(?i)\bin\s*(\(\s*)?$";
/// Quasi закінчується на `IN (` — точний порт `IN_PLACEHOLDER_END_RE`
/// `mssql-pool-scan.mjs` (`/\bin\s*\(\s*$/iu`) — дужка ОБОВ'ЯЗКОВА, на
/// відміну від bun-варіанта вище (два різні JS-оригінали).
const MSSQL_IN_PLACEHOLDER_END_PATTERN: &str = r"(?i)\bin\s*\(\s*$";
/// `%L`/`%I`/`%s` pg-format placeholder — точний порт `PG_FORMAT_PLACEHOLDER_RE`.
const PG_FORMAT_PLACEHOLDER_PATTERN: &str = r"%[LIs]";
/// Ім'я першого параметра pg-style query-обгортки — точний порт
/// `PG_QUERY_FIRST_PARAM_RE` (`/^(text|sql|query)$/u`).
const PG_QUERY_FIRST_PARAM_NAMES: [&str; 3] = ["text", "sql", "query"];
/// Текст одразу після `${...}` починається з `::jsonb` — точний порт
/// `JSONB_CAST_RE` (`bun-sql-scan.mjs`).
const JSONB_CAST_PATTERN: &str = r"^\s*::jsonb";
/// Імена функцій-кандидатів на pg-format-шим — точний порт
/// `PG_FORMAT_SHIM_FUNC_NAMES` (спрацьовують лише разом з
/// `%L`/`%I`/`%s` у тілі).
const PG_FORMAT_SHIM_FUNC_NAMES: [&str; 4] = ["format", "pgFormat", "sqlFormat", "pgFmt"];
/// Імена quote/escape-хелперів — точний порт `QUOTE_HELPER_NAMES`
/// (сильний сигнал без перевірки тіла).
const QUOTE_HELPER_NAMES: [&str; 4] =
    ["quoteLiteral", "quoteIdent", "escapeLiteral", "escapeIdent"];
/// pg-API, зайві з Bun SQL — точний порт `PG_LEFTOVER_METHOD_NAMES`.
const PG_LEFTOVER_METHOD_NAMES: [&str; 2] = ["connect", "end"];
/// Імена відомих SQL-інстансів для `.array()` без типу — точний порт
/// `SQL_INSTANCE_NAMES` (`bun-sql-scan.mjs`).
const SQL_INSTANCE_NAMES: [&str; 3] = ["sql", "pgWrite", "pgRead"];
/// Числові парсери — точний порт `NUMERIC_PARSE_FN_NAMES`
/// (`mssql-pool-scan.mjs`).
const NUMERIC_PARSE_FN_NAMES: [&str; 4] = ["parseInt", "parseFloat", "Number", "BigInt"];
/// `\s+` для стискання сніпетів — точний порт `normalizeSnippet`
/// (`ast-scan-utils.mjs`, `/\s+/gu`).
const SNIPPET_WHITESPACE_PATTERN: &str = r"\s+";
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
// Обидва концерни В КОНТРИБУЦІЇ (`build_manifest`) — byte-exact parity
// досягнутий тим самим движком, що JS-оригінали, не наближенням (батч 4
// поширив той самий підхід на js-bun-redis/js-mssql/js-bun-db, доккомент
// секції «Батч 4» вище).

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

/// 1-based номер рядка символьного офсету `idx` у `content`.
fn line_number_at(content: &str, idx: usize) -> usize {
    content.chars().take(idx).filter(|&c| c == '\n').count() + 1
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
/// `findBunTestImports` (`main.mjs:60-68`). `byte_start`/`byte_end` — межі
/// повного матчу для сплайсу [`fix_no_bun_test_import`] (fix-контур contract
/// v3 — Rust-порт видаленого `fix-no-bun-test-import.mjs`, який раніше
/// перечитував файл і парсив сам).
struct BunTestImportMatch {
    /// Символьний офсет початку `import { ... }` (для [`line_number_at`]).
    start: usize,
    /// Байтовий офсет початку повного матчу в `content`.
    byte_start: usize,
    /// Байтовий офсет кінця (exclusive) повного матчу в `content`.
    byte_end: usize,
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
                byte_start: m.start(),
                byte_end: m.end(),
                specifiers,
                fixable,
            }
        })
        .collect()
}

/// Порт `QUOTED_BUN_TEST_RE`-заміни (`fix-no-bun-test-import.mjs:14,37`,
/// до видалення): перша поява `'bun:test'`/`"bun:test"` у raw-тексті
/// import-а замінюється на `vitest` у ТІЙ САМІЙ лапці (JS робив це через
/// backreference `(['"])bun:test\1`). Змішані лапки (`'bun:test"`) не
/// матчаться — raw повертається без змін, той самий ефект, що давав
/// backreference.
fn rewrite_bun_test_source(raw: &str) -> String {
    for (needle, replacement) in [("'bun:test'", "'vitest'"), ("\"bun:test\"", "\"vitest\"")] {
        if let Some(idx) = raw.find(needle) {
            let mut out = String::with_capacity(raw.len());
            out.push_str(&raw[..idx]);
            out.push_str(replacement);
            out.push_str(&raw[idx + needle.len()..]);
            return out;
        }
    }
    raw.to_string()
}

/// Чи діагностика позначена детектором як fixable — `data` на WIT-межі це
/// JSON-рядок (`{"fixable":…,"specifiers":[…]}`, [`detect_no_bun_test_import`]),
/// парситься `serde_json` (та сама залежність, що JSON-парсинг
/// `js-mssql/deps`). Битий/відсутній `data` → `false` (не fixable — фікс
/// консервативний, як і JS-оригінал, що матчив `v.data?.fixable`).
fn is_fixable_bun_test_diagnostic(diagnostic: &Diagnostic) -> bool {
    if diagnostic.reason != BUN_TEST_IMPORT_VIOLATION_REASON {
        return false;
    }
    diagnostic
        .data
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|value| value.get("fixable").and_then(|f| f.as_bool()))
        .unwrap_or(false)
}

/// Fix-план `test/no-bun-test-import` — точний семантичний порт T0-патерна
/// `rewrite-bun-test-import-to-vitest` видаленого
/// `plugins/lang-js/rules/test/no-bun-test-import/fix-no-bun-test-import.mjs`
/// (пілот fix-контуру contract v3):
///
/// 1. файли беруться з діагностик `reason == "bun-test-import"` з
///    `data.fixable == true` (дедуп зі збереженням порядку — той самий
///    `[...new Set(...)]`);
/// 2. вміст НЕ перечитується з диска — на відміну від JS-версії
///    (`readFile(absPath)`), guest працює з `request.files` (хост уже
///    передав вміст inline, спека §3.2 — плагін без IO);
/// 3. заміна йде з кінця файлу до початку (`toReversed` у JS), щоб байтові
///    офсети попередніх матчів не зсувались;
/// 4. не-fixable import-и лишаються недоторканими; файл без реальних змін
///    не потрапляє в план (`next === content` у JS).
fn fix_no_bun_test_import(request: &FixRequest) -> FixPlan {
    let mut target_files: Vec<&str> = Vec::new();
    for diagnostic in &request.diagnostics {
        if !is_fixable_bun_test_diagnostic(diagnostic) {
            continue;
        }
        let Some(file) = diagnostic.file.as_deref() else {
            continue;
        };
        if !target_files.contains(&file) {
            target_files.push(file);
        }
    }

    let mut edits = Vec::new();
    for target in target_files {
        let Some(source) = request.files.iter().find(|f| f.path == target) else {
            continue;
        };
        let found = find_bun_test_imports(&source.content);
        if found.is_empty() {
            continue;
        }
        let mut next = source.content.clone();
        for import in found.iter().rev() {
            if !import.fixable {
                continue;
            }
            let raw = &source.content[import.byte_start..import.byte_end];
            next.replace_range(
                import.byte_start..import.byte_end,
                &rewrite_bun_test_source(raw),
            );
        }
        if next == source.content {
            continue;
        }
        edits.push(FileEdit::Write(WriteFile {
            path: source.path.clone(),
            content: next,
        }));
    }
    FixPlan { edits }
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
/// guest-фікс ([`is_fixable_bun_test_diagnostic`], порт видаленого
/// `fix-no-bun-test-import.mjs`) матчить саме на
/// `reason === 'bun-test-import' && data.fixable`.
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

// =====================================================================
// Спільна AST-інфраструктура батчу 4 (задача Q4, доккомент секції «Батч 4»
// вище): вибір `SourceType` (порт `langFromPath` + `sourceType: 'module'`),
// стискання сніпетів (порт `normalizeSnippet`), byte-офсетні лінії, маркерні
// коментарі. Кожна `find_*`-функція парсить файл САМА (дзеркало JS-оригіналів,
// де кожен сканер викликає `parseSync` окремо) і мовчки повертає порожній
// результат на синтаксичних помилках (`ret.diagnostics` непорожній — точний
// порт `parseProgramOrNull`).

/// `SourceType` за розширенням — точний порт `langFromPath`
/// (`ast-scan-utils.mjs`: `.tsx`→tsx, `.ts`/`.mts`/`.cts`→ts, `.jsx`→jsx,
/// решта→js) ПЛЮС примусовий `sourceType: 'module'` (усі JS-оригінали
/// передають його явно, включно з `.cjs`).
fn scan_source_type(path: &str) -> SourceType {
    let lower = path.to_lowercase();
    if lower.ends_with(".tsx") {
        SourceType::tsx().with_module(true)
    } else if lower.ends_with(".ts") || lower.ends_with(".mts") || lower.ends_with(".cts") {
        SourceType::ts().with_module(true)
    } else if lower.ends_with(".jsx") {
        SourceType::jsx()
    } else {
        SourceType::mjs()
    }
}

/// Стискає пробіли й обрізає до 180 символів — точний порт `normalizeSnippet`
/// (`ast-scan-utils.mjs`): `s.replaceAll(/\s+/gu, ' ').trim().slice(0, 180)`
/// (для BMP-вмісту `chars().take(180)` збігається з JS `slice(0, 180)`).
fn normalize_snippet(s: &str) -> String {
    let ws_re =
        regex::Regex::new(SNIPPET_WHITESPACE_PATTERN).expect("SNIPPET_WHITESPACE_PATTERN валідний");
    ws_re.replace_all(s, " ").trim().chars().take(180).collect()
}

/// Сніпет за `Span` вузла — `normalizeSnippet(content.slice(start, end))`
/// JS-оригіналів (байтові офсети, доккомент секції «Батч 4»).
fn span_snippet(content: &str, span: Span) -> String {
    normalize_snippet(&content[span.start as usize..span.end as usize])
}

/// (1-based лінія, сніпет) — найчастіша пара полів знахідки AST-сканера
/// (`{ line, snippet }` у JS-оригіналах).
struct AstHit {
    line: usize,
    snippet: String,
}

impl AstHit {
    /// Знахідка за span-ом вузла: лінія — за `span.start`, сніпет — за всім
    /// span-ом (найтиповіша форма `offsetToLine(content, node.start)` +
    /// `normalizeSnippet(content.slice(node.start, node.end))`).
    fn at(content: &str, span: Span) -> Self {
        Self {
            line: line_number_at_offset(content, span.start as usize),
            snippet: span_snippet(content, span),
        }
    }
}

/// Сирий текст quasis (без expressions) — точний порт `templateQuasisText`
/// (`ast-scan-utils.mjs`): конкатенація `q.value.raw`.
fn template_quasis_raw_text(tpl: &TemplateLiteral) -> String {
    tpl.quasis.iter().map(|q| q.value.raw.as_str()).collect()
}

/// Чи виглядає template як SQL-контекст зі списком — точний порт
/// `isSqlListContextTemplate` (`SQL_LIST_CONTEXT_RE` по raw-тексту quasis).
fn is_sql_list_context_template(tpl: &TemplateLiteral, sql_ctx_re: &regex::Regex) -> bool {
    sql_ctx_re.is_match(&template_quasis_raw_text(tpl))
}

/// Чи це виклик `*.join(...)` — точний порт `isJoinCall`
/// (`ast-scan-utils.mjs`): CallExpression із non-computed MemberExpression
/// `.join`.
fn is_join_call(expr: &Expression) -> bool {
    let Expression::CallExpression(call) = expr else {
        return false;
    };
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return false;
    };
    member.property.name == "join"
}

/// Чи це виклик `<obj>.unsafe(...)` — точний порт `isUnsafeCall`
/// (`bun-sql-scan.mjs`): будь-який об'єкт, non-computed `.unsafe`.
fn is_unsafe_call(call: &CallExpression) -> bool {
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return false;
    };
    member.property.name == "unsafe"
}

/// Рядкове cooked-значення string literal-вузла — точний порт
/// `getStringLiteralValue` (`bun-sql-scan.mjs`, гілки `Literal`/`StringLiteral`).
fn string_literal_value<'e>(expr: &'e Expression) -> Option<&'e str> {
    match expr {
        Expression::StringLiteral(lit) => Some(lit.value.as_str()),
        _ => None,
    }
}

/// Лінії, на яких маркерний коментар «дозволяє» виклик — порт
/// `hasMarkerCommentNear` (`bun-sql-scan.mjs`): для кожного коментаря, чий
/// вміст (`Comment::content_span`, дзеркало `c.value`) матчить `marker_re`,
/// дозволеними стають лінія ПОЧАТКУ коментаря (trailing-коментар на тому ж
/// рядку, що виклик) і лінія ОДРАЗУ ПІСЛЯ його кінця (коментар рядком вище;
/// для block-коментаря важливий саме `endLine`).
fn marker_allowed_lines(
    content: &str,
    comments: &[Comment],
    marker_re: &regex::Regex,
) -> std::collections::HashSet<usize> {
    let mut allowed = std::collections::HashSet::new();
    for comment in comments {
        let value_span = comment.content_span();
        let value = &content[value_span.start as usize..value_span.end as usize];
        if !marker_re.is_match(value) {
            continue;
        }
        allowed.insert(line_number_at_offset(content, comment.span.start as usize));
        allowed.insert(line_number_at_offset(content, comment.span.end as usize) + 1);
    }
    allowed
}

// =====================================================================
// Задача Q4 батч 4: `js-bun-redis/imports` — AST-концерн через `oxc_parser`.

/// Один знайдений заборонений redis-імпорт — [`find_redis_imports_in_text`].
struct RedisImportHit {
    /// 1-based лінія початку вузла.
    line: usize,
    /// Стиснений сніпет вузла (`normalizeSnippet`).
    snippet: String,
    /// Специфікатор модуля (`ioredis`, `@redis/client`, ...).
    module: String,
}

/// Visitor [`find_redis_imports_in_text`] — два незалежні буфери, що
/// дзеркалять ДВОФАЗНИЙ порядок JS-оригіналу (`redis-imports.mjs:64-112`):
/// спочатку УСІ статичні імпорти (`result.module.staticImports`, source
/// order), потім walk-прохід за `require('…')`/динамічним `import('…')` —
/// тож змішаний файл віддає порушення НЕ в порядку ліній (перевірено live
/// прогоном JS-оригіналу; статичний імпорт з лінії 2 передує require з
/// лінії 1).
struct RedisImportVisitor<'c> {
    content: &'c str,
    static_hits: Vec<RedisImportHit>,
    walk_hits: Vec<RedisImportHit>,
}

impl<'c> RedisImportVisitor<'c> {
    fn hit(&self, span: Span, module: &str) -> RedisImportHit {
        let base = AstHit::at(self.content, span);
        RedisImportHit {
            line: base.line,
            snippet: base.snippet,
            module: module.to_string(),
        }
    }
}

impl<'a> Visit<'a> for RedisImportVisitor<'_> {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        let module = it.source.value.as_str();
        if is_forbidden_redis_module(module) {
            self.static_hits.push(self.hit(it.span, module));
        }
        // Без walk у специфікатори — вкладених `require`/`import()` там нема
        // (той самий мотив, що [`ImportSourceVisitor`]).
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::Identifier(ident) = &it.callee {
            if ident.name == "require" {
                // Точний порт `requireCallModule`: перший аргумент — string
                // literal (кількість аргументів НЕ перевіряється).
                if let Some(Argument::StringLiteral(lit)) = it.arguments.first() {
                    let module = lit.value.as_str();
                    if is_forbidden_redis_module(module) {
                        self.walk_hits.push(self.hit(it.span, module));
                    }
                }
            }
        }
        walk_call_expression(self, it);
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if let Expression::StringLiteral(lit) = &it.source {
            let module = lit.value.as_str();
            if is_forbidden_redis_module(module) {
                self.walk_hits.push(self.hit(it.span, module));
            }
        }
        walk_import_expression(self, it);
    }
}

/// Точний порт `findRedisImportsInText` (`redis-imports.mjs:64-112`) —
/// СПРАВЖНІЙ AST-скан через `oxc_parser` (заміна regex-groundwork батчу 2):
/// статичний `ImportDeclaration` (дзеркало `module.staticImports` —
/// емпірично звірено батчем 3, що staticImports ≡ ImportDeclaration),
/// `require('<mod>')`, динамічний `import('<mod>')`. Синтаксична помилка —
/// порожній результат (порт `try/catch` + `result.errors?.length`).
fn find_redis_imports_in_text(content: &str, path: &str) -> Vec<RedisImportHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = RedisImportVisitor {
        content,
        static_hits: Vec::new(),
        walk_hits: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    let mut hits = visitor.static_hits;
    hits.extend(visitor.walk_hits);
    hits
}

/// Точний порт `lint()` `js-bun-redis/imports` (`main.mjs:62-88`) —
/// WHOLE-BATCH: гейт на кореневий `package.json` (`existsSync`-перевірка
/// JS-оригіналу — тут: чи є `package.json` серед файлів батчу, глоб
/// контрибуції включає `**/package.json`), потім AST-скан усіх JS/TS-джерел.
fn detect_redis_imports(files: &[SourceFile]) -> Vec<Diagnostic> {
    if !files.iter().any(|f| f.path == "package.json") {
        return Vec::new();
    }
    let mut out = Vec::new();
    for file in files {
        if !is_js_ts_source_file(&file.path) || should_skip_redis_scan_file(&file.path) {
            continue;
        }
        for hit in find_redis_imports_in_text(&file.content, &file.path) {
            out.push(Diagnostic {
                reason: REDIS_IMPORTS_VIOLATION_REASON.to_string(),
                message: format!(
                    "js-bun-redis: {}:{} — заміни '{}' на Bun native Redis (import {{ redis }} \
                     from 'bun', https://bun.com/docs/runtime/redis): {}",
                    file.path, hit.line, hit.module, hit.snippet
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

/// Чи вміст імпортує пакет `pg` — точний порт `textHasPgLibImport`
/// (`bun-sql-scan.mjs`): ТЕКСТОВИЙ pre-filter (не AST) — саме тому
/// side-effect `import 'pg'` без `from` цим фільтром НЕ ловиться (доккомент
/// секції «Батч 4»: відтворено, не «поліпшено»).
fn has_pg_lib_import(content: &str) -> bool {
    regex::Regex::new(PG_LIB_IMPORT_PATTERN)
        .expect("PG_LIB_IMPORT_PATTERN валідний")
        .is_match(content)
}

/// Чи вміст МОЖЕ містити LISTEN/NOTIFY-сигнал — точний порт дешевого
/// pre-filter-а `collectPgUsageForFile` (`js-bun-db/safety/main.mjs`):
/// `LISTEN_NOTIFY_KEYWORD_RE.test(content) || NOTIFICATION_LITERAL_RE.test(content)`.
fn may_have_listen_notify(content: &str) -> bool {
    regex::Regex::new(LISTEN_NOTIFY_KEYWORD_PATTERN)
        .expect("LISTEN_NOTIFY_KEYWORD_PATTERN валідний")
        .is_match(content)
        || regex::Regex::new(NOTIFICATION_LITERAL_PATTERN)
            .expect("NOTIFICATION_LITERAL_PATTERN валідний")
            .is_match(content)
}

/// Рядок `dependencies.mssql` з розпарсеного `package.json` — точний порт
/// `getMssqlDependencyRange` (`js-mssql/deps/main.mjs`): не-об'єкт →
/// відсутність; лише непорожній (після trim) рядок; повертається ТРИМОВАНЕ
/// значення (JS: `v.trim() ? v.trim() : null`).
fn mssql_dependency_range(parsed: &serde_json::Value) -> Option<String> {
    let value = parsed
        .as_object()?
        .get("dependencies")?
        .as_object()?
        .get("mssql")?
        .as_str()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Чи `package.json` декларує `dependencies.pg` — точний порт перевірки
/// `Object.hasOwn(deps, 'pg')` (`checkPgDependencyAndUsage`,
/// `js-bun-db/safety/main.mjs`): важлива ПРИСУТНІСТЬ ключа, не значення.
fn package_declares_pg(parsed: &serde_json::Value) -> bool {
    parsed
        .as_object()
        .and_then(|pkg| pkg.get("dependencies"))
        .and_then(|deps| deps.as_object())
        .is_some_and(|deps| deps.contains_key("pg"))
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

// =====================================================================
// Задача Q4 батч 4: `js-bun-db/safety` — AST-концерн через `oxc_parser`
// (десять сканерів `scanFileForBunSqlPatterns` + pg-виняток LISTEN/NOTIFY).

/// Який `new`-конструктор шукає [`NewInsideFunctionVisitor`] — два JS-оригінали
/// з ідентичною механікою «всередині функції» (`ancestors.some(isFunctionNode)`),
/// але різними цільовими вузлами.
enum NewConnectionKind {
    /// `new SQL(...)` — точний порт `isNewSqlConstructor` (`bun-sql-scan.mjs`).
    BunSql,
    /// `new sql.ConnectionPool(...)`/`new mssql.ConnectionPool(...)` — точний
    /// порт `isNewConnectionPool` (`mssql-pool-scan.mjs`).
    MssqlPool,
}

/// Visitor «`new <...>()` всередині функції» — точний порт
/// `findBunSqlPerRequestConnectionInText`/`findMssqlPerRequestConnectionInText`:
/// лічильник глибини інкрементується на ВХОДІ у функціональний вузол (разом з
/// параметрами — дзеркало `ancestors.some(isFunctionNode)`, де предком є сам
/// функціональний вузол цілком), декрементується на виході.
struct NewInsideFunctionVisitor<'c> {
    content: &'c str,
    kind: NewConnectionKind,
    fn_depth: u32,
    out: Vec<AstHit>,
}

impl<'a> Visit<'a> for NewInsideFunctionVisitor<'_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        self.fn_depth += 1;
        walk_function(self, it, flags);
        self.fn_depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        self.fn_depth += 1;
        walk_arrow_function_expression(self, it);
        self.fn_depth -= 1;
    }

    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        let is_target = match self.kind {
            NewConnectionKind::BunSql => {
                matches!(&it.callee, Expression::Identifier(ident) if ident.name == "SQL")
            }
            NewConnectionKind::MssqlPool => match &it.callee {
                Expression::StaticMemberExpression(member) => {
                    member.property.name == "ConnectionPool"
                        && matches!(&member.object, Expression::Identifier(obj)
                            if obj.name == "sql" || obj.name == "mssql")
                }
                _ => false,
            },
        };
        if is_target && self.fn_depth > 0 {
            self.out.push(AstHit::at(self.content, it.span));
        }
        walk_new_expression(self, it);
    }
}

/// Точний порт `findBunSqlPerRequestConnectionInText` (`bun-sql-scan.mjs`).
fn find_bun_sql_per_request_connection(content: &str, path: &str) -> Vec<AstHit> {
    find_new_inside_function(content, path, NewConnectionKind::BunSql)
}

/// Точний порт `findMssqlPerRequestConnectionInText` (`mssql-pool-scan.mjs`).
fn find_mssql_per_request_connection(content: &str, path: &str) -> Vec<AstHit> {
    find_new_inside_function(content, path, NewConnectionKind::MssqlPool)
}

/// Спільний прогін [`NewInsideFunctionVisitor`] для обох флейворів.
fn find_new_inside_function(content: &str, path: &str, kind: NewConnectionKind) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = NewInsideFunctionVisitor {
        content,
        kind,
        fn_depth: 0,
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Visitor `<obj>.unsafe(...)` без маркера — точний порт
/// `findBunSqlUnsafeUseWithoutAllowMarkerInText`: виклик дозволений, лише
/// якщо його СТАРТОВА лінія входить у [`marker_allowed_lines`].
struct UnsafeNoMarkerVisitor<'c> {
    content: &'c str,
    allowed_lines: std::collections::HashSet<usize>,
    out: Vec<AstHit>,
}

impl<'a> Visit<'a> for UnsafeNoMarkerVisitor<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if is_unsafe_call(it) {
            let hit = AstHit::at(self.content, it.span);
            if !self.allowed_lines.contains(&hit.line) {
                self.out.push(hit);
            }
        }
        walk_call_expression(self, it);
    }
}

/// Точний порт `findBunSqlUnsafeUseWithoutAllowMarkerInText` (`bun-sql-scan.mjs`).
fn find_bun_sql_unsafe_without_marker(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let marker_re = regex::Regex::new(ALLOW_UNSAFE_MARKER_PATTERN)
        .expect("ALLOW_UNSAFE_MARKER_PATTERN валідний");
    let mut visitor = UnsafeNoMarkerVisitor {
        content,
        allowed_lines: marker_allowed_lines(content, &ret.program.comments, &marker_re),
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Visitor `<obj>.unsafe(`...${x}...`)` — точний порт
/// `findBunSqlUnsafeWithInterpolatedTemplateInText`: перший аргумент —
/// `TemplateLiteral` з непорожніми `expressions` (маркер НЕ рятує).
struct UnsafeInterpolatedTemplateVisitor<'c> {
    content: &'c str,
    out: Vec<AstHit>,
}

impl<'a> Visit<'a> for UnsafeInterpolatedTemplateVisitor<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if is_unsafe_call(it) {
            if let Some(Argument::TemplateLiteral(tpl)) = it.arguments.first() {
                if !tpl.expressions.is_empty() {
                    self.out.push(AstHit::at(self.content, it.span));
                }
            }
        }
        walk_call_expression(self, it);
    }
}

/// Точний порт `findBunSqlUnsafeWithInterpolatedTemplateInText` (`bun-sql-scan.mjs`).
fn find_bun_sql_unsafe_interpolated_template(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = UnsafeInterpolatedTemplateVisitor {
        content,
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Одна pg-leftover-знахідка — [`find_bun_sql_pg_leftover`].
struct PgLeftoverHit {
    line: usize,
    snippet: String,
    /// Ім'я методу (`connect`/`end`) — фігурує в повідомленні.
    method: String,
}

/// Visitor `<obj>.connect(...)`/`<obj>.end(...)` без маркера — точний порт
/// `findBunSqlPgLeftoverCallInText` (гейт на bun-sql-імпорт застосовує
/// викликач, дзеркало внутрішнього `textHasBunSqlImport`-гейта JS).
struct PgLeftoverVisitor<'c> {
    content: &'c str,
    allowed_lines: std::collections::HashSet<usize>,
    out: Vec<PgLeftoverHit>,
}

impl<'a> Visit<'a> for PgLeftoverVisitor<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(member) = &it.callee {
            let method = member.property.name.as_str();
            if PG_LEFTOVER_METHOD_NAMES.contains(&method) {
                let hit = AstHit::at(self.content, it.span);
                if !self.allowed_lines.contains(&hit.line) {
                    self.out.push(PgLeftoverHit {
                        line: hit.line,
                        snippet: hit.snippet,
                        method: method.to_string(),
                    });
                }
            }
        }
        walk_call_expression(self, it);
    }
}

/// Точний порт `findBunSqlPgLeftoverCallInText` (`bun-sql-scan.mjs`) —
/// включно з внутрішнім гейтом `textHasBunSqlImport` (скоп навмисно вузький,
/// доккомент JS-оригіналу: метод-імена занадто загальні поза Bun SQL-файлами).
fn find_bun_sql_pg_leftover(content: &str, path: &str) -> Vec<PgLeftoverHit> {
    if !has_bun_sql_import(content) {
        return Vec::new();
    }
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let marker_re = regex::Regex::new(ALLOW_PG_LEFTOVER_MARKER_PATTERN)
        .expect("ALLOW_PG_LEFTOVER_MARKER_PATTERN валідний");
    let mut visitor = PgLeftoverVisitor {
        content,
        allowed_lines: marker_allowed_lines(content, &ret.program.comments, &marker_re),
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Visitor динамічних SQL-списків — точний порт
/// `findUnsafeBunSqlDynamicSqlListInText`/`findUnsafeMssqlDynamicSqlListInText`
/// (два JS-оригінали з ідентичним тілом): `IN (...)`/`VALUES (...)` у
/// raw-тексті quasis + хоч один `.join(...)` серед expressions. Tagged
/// template дає ДВІ ідентичні знахідки (доккомент секції «Батч 4» —
/// tagged-вузол І його quasi обходяться окремо, як у JS).
struct DynamicSqlListVisitor<'c> {
    content: &'c str,
    sql_ctx_re: regex::Regex,
    out: Vec<AstHit>,
}

impl DynamicSqlListVisitor<'_> {
    fn process_template(&mut self, tpl: &TemplateLiteral) {
        if !is_sql_list_context_template(tpl, &self.sql_ctx_re) {
            return;
        }
        if tpl.expressions.is_empty() {
            return;
        }
        if !tpl.expressions.iter().any(is_join_call) {
            return;
        }
        self.out.push(AstHit::at(self.content, tpl.span));
    }
}

impl<'a> Visit<'a> for DynamicSqlListVisitor<'_> {
    fn visit_template_literal(&mut self, it: &TemplateLiteral<'a>) {
        self.process_template(it);
        walk_template_literal(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        self.process_template(&it.quasi);
        walk_tagged_template_expression(self, it);
    }
}

/// Спільний прогін [`DynamicSqlListVisitor`] (bun-db і mssql відрізняються
/// лише повідомленням на боці викликача).
fn find_sql_dynamic_list(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = DynamicSqlListVisitor {
        content,
        sql_ctx_re: regex::Regex::new(SQL_LIST_CONTEXT_PATTERN)
            .expect("SQL_LIST_CONTEXT_PATTERN валідний"),
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Причина порушення guard-сканера IN-списків — точний порт `reason`-поля
/// `collectInListGuardViolationsFromTemplate` (bun) /
/// `collectInListMissingEmptyGuardFromTemplate` (mssql).
enum InListGuardReason {
    /// `${...}` — не Identifier (bun: і не `sql(Identifier)`).
    NotVar,
    /// `${sql(<не-Identifier>)}` — лише bun-флейвор.
    SqlHelperNotVar,
    /// Identifier без guard-а `if (empty) throw` у найближчому блоці.
    MissingGuard(String),
}

/// Одна guard-знахідка — [`find_bun_sql_in_list_guard`]/[`find_mssql_in_list_guard`].
struct InListGuardHit {
    line: usize,
    snippet: String,
    reason: InListGuardReason,
}

/// Флейвор guard-сканера: два JS-оригінали з різними IN-регексами
/// (доккоменти [`BUN_IN_PLACEHOLDER_END_PATTERN`]/[`MSSQL_IN_PLACEHOLDER_END_PATTERN`]),
/// різною екстракцією виразу (`sql(...)`-хелпер — лише bun) і різним
/// покриттям tagged-вузлів (bun обробляє tagged+quasi → дублікати; mssql —
/// лише TemplateLiteral).
enum InListGuardFlavor {
    BunSql,
    Mssql,
}

/// Visitor guard-перевірки IN-списків. Стек guard-множин відтворює
/// `findEnclosingBlockAndStatementIndex` + `hasEmptyGuardBefore`: контекст
/// відкривається на КОЖНОМУ `BlockStatement`/тілі функції (ESTree серіалізує
/// `FunctionBody` як `BlockStatement`), guard `if (empty(name)) throw`
/// додає `name` у ВЕРШИНУ стека після свого statement-а — тож перевірка
/// «guard перед statement-ом у НАЙБЛИЖЧОМУ блоці» зводиться до membership у
/// вершині стека (guard у зовнішньому блоці вкладений блок НЕ рятує —
/// перевірено live-прогоном JS-оригіналу).
struct InListGuardVisitor<'c> {
    content: &'c str,
    flavor: InListGuardFlavor,
    in_end_re: regex::Regex,
    sql_ctx_re: regex::Regex,
    guard_stack: Vec<std::collections::HashSet<String>>,
    out: Vec<InListGuardHit>,
}

impl InListGuardVisitor<'_> {
    /// Точний порт `extractInListVarNameFromExpr` (bun) / гілки
    /// `expr.type !== 'Identifier'` (mssql).
    fn extract_var_name(&self, expr: &Expression) -> Result<String, InListGuardReason> {
        if let Expression::Identifier(ident) = expr {
            return Ok(ident.name.to_string());
        }
        if matches!(self.flavor, InListGuardFlavor::BunSql) {
            if let Expression::CallExpression(call) = expr {
                if matches!(&call.callee, Expression::Identifier(callee) if callee.name == "sql") {
                    if let Some(Expression::Identifier(arg)) =
                        call.arguments.first().and_then(|a| a.as_expression())
                    {
                        return Ok(arg.name.to_string());
                    }
                    return Err(InListGuardReason::SqlHelperNotVar);
                }
            }
        }
        Err(InListGuardReason::NotVar)
    }

    fn process_template(&mut self, tpl: &TemplateLiteral) {
        if matches!(self.flavor, InListGuardFlavor::BunSql)
            && !is_sql_list_context_template(tpl, &self.sql_ctx_re)
        {
            return;
        }
        if tpl.expressions.is_empty() || tpl.quasis.is_empty() {
            return;
        }
        for (index, expr) in tpl.expressions.iter().enumerate() {
            let raw = tpl
                .quasis
                .get(index)
                .map(|q| q.value.raw.as_str())
                .unwrap_or("");
            if !self.in_end_re.is_match(raw) {
                continue;
            }
            let base = AstHit::at(self.content, tpl.span);
            match self.extract_var_name(expr) {
                Err(reason) => self.out.push(InListGuardHit {
                    line: base.line,
                    snippet: base.snippet,
                    reason,
                }),
                Ok(name) => {
                    let guarded = self
                        .guard_stack
                        .last()
                        .is_some_and(|guards| guards.contains(&name));
                    if !guarded {
                        self.out.push(InListGuardHit {
                            line: base.line,
                            snippet: base.snippet,
                            reason: InListGuardReason::MissingGuard(name),
                        });
                    }
                }
            }
        }
    }

    /// Обхід statement-списку блока з накопиченням guard-ів: guard видно
    /// лише statement-ам ПІСЛЯ нього (`i < statementIndex` у
    /// `hasEmptyGuardBefore`).
    fn enter_statements<'a>(&mut self, statements: &[Statement<'a>]) {
        self.guard_stack.push(std::collections::HashSet::new());
        for statement in statements {
            self.visit_statement(statement);
            self.record_guard(statement);
        }
        self.guard_stack.pop();
    }

    /// Точний порт трійки `IfStatement` + `isEmptyListTest` +
    /// `consequentHasThrow`: додає ім'я захищеного списку у вершину стека.
    fn record_guard(&mut self, statement: &Statement) {
        let Statement::IfStatement(if_stmt) = statement else {
            return;
        };
        let Some(name) = empty_list_test_name(&if_stmt.test) else {
            return;
        };
        if !consequent_has_throw(&if_stmt.consequent) {
            return;
        }
        if let Some(top) = self.guard_stack.last_mut() {
            top.insert(name);
        }
    }
}

impl<'a> Visit<'a> for InListGuardVisitor<'_> {
    fn visit_block_statement(&mut self, it: &BlockStatement<'a>) {
        self.enter_statements(&it.body);
    }

    fn visit_function_body(&mut self, it: &FunctionBody<'a>) {
        // ESTree серіалізує FunctionBody як BlockStatement — тіло функції
        // теж «найближчий блок» для guard-пошуку.
        self.enter_statements(&it.statements);
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        if it.expression {
            // ESTree: expression-body arrow має body-ВИРАЗ (НЕ BlockStatement)
            // — guard-контекст НЕ відкривається, пошук іде у зовнішній блок
            // (перевірено live-прогоном JS-оригіналу).
            self.visit_formal_parameters(&it.params);
            if let Some(expr) = it.get_expression() {
                self.visit_expression(expr);
            }
        } else {
            walk_arrow_function_expression(self, it);
        }
    }

    fn visit_template_literal(&mut self, it: &TemplateLiteral<'a>) {
        self.process_template(it);
        walk_template_literal(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if matches!(self.flavor, InListGuardFlavor::BunSql) {
            // Дзеркало дубль-обходу JS (доккомент секції «Батч 4»): tagged
            // оброблюється і тут, і повторно як його quasi-TemplateLiteral.
            self.process_template(&it.quasi);
        }
        walk_tagged_template_expression(self, it);
    }
}

/// Ім'я `<name>` з виразу `<name>.length` — точний порт `isLengthMember`
/// (non-computed MemberExpression Identifier.Identifier).
fn length_member_name(expr: &Expression) -> Option<String> {
    let Expression::StaticMemberExpression(member) = expr else {
        return None;
    };
    if member.property.name != "length" {
        return None;
    }
    match &member.object {
        Expression::Identifier(ident) => Some(ident.name.to_string()),
        _ => None,
    }
}

/// Чи це числовий літерал `0` — точний порт `isZeroNumberLiteral`
/// (`NumericLiteral`/`Literal` зі значенням 0; ESTree bigint `0n` НЕ
/// проходить строгу рівність `=== 0`).
fn is_zero_numeric_literal(expr: &Expression) -> bool {
    matches!(expr, Expression::NumericLiteral(lit) if lit.value == 0.0)
}

/// Ім'я списку з тесту «список порожній» — точний порт `isEmptyListTest`:
/// `!name.length`, `name.length ===|==|<=|< 0`, `0 ===|== name.length`.
fn empty_list_test_name(test: &Expression) -> Option<String> {
    match test {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            length_member_name(&unary.argument)
        }
        Expression::BinaryExpression(binary) => {
            let op = binary.operator;
            let allowed = matches!(
                op,
                BinaryOperator::StrictEquality
                    | BinaryOperator::Equality
                    | BinaryOperator::LessEqualThan
                    | BinaryOperator::LessThan
            );
            if !allowed {
                return None;
            }
            if let Some(name) = length_member_name(&binary.left) {
                if is_zero_numeric_literal(&binary.right) {
                    return Some(name);
                }
            }
            // Допускаємо `0 === ids.length` теж (лише для ===/==).
            if matches!(
                op,
                BinaryOperator::StrictEquality | BinaryOperator::Equality
            ) && is_zero_numeric_literal(&binary.left)
            {
                return length_member_name(&binary.right);
            }
            None
        }
        _ => None,
    }
}

/// Чи містить consequent `throw` — точний порт `consequentHasThrow`
/// (`ThrowStatement` напряму чи ПРЯМИЙ елемент `BlockStatement.body`).
fn consequent_has_throw(consequent: &Statement) -> bool {
    match consequent {
        Statement::ThrowStatement(_) => true,
        Statement::BlockStatement(block) => block
            .body
            .iter()
            .any(|s| matches!(s, Statement::ThrowStatement(_))),
        _ => false,
    }
}

/// Спільний прогін [`InListGuardVisitor`] для обох флейворів.
fn find_in_list_guard(content: &str, path: &str, flavor: InListGuardFlavor) -> Vec<InListGuardHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let in_end_pattern = match flavor {
        InListGuardFlavor::BunSql => BUN_IN_PLACEHOLDER_END_PATTERN,
        InListGuardFlavor::Mssql => MSSQL_IN_PLACEHOLDER_END_PATTERN,
    };
    let mut visitor = InListGuardVisitor {
        content,
        flavor,
        in_end_re: regex::Regex::new(in_end_pattern).expect("IN_PLACEHOLDER_END-патерн валідний"),
        sql_ctx_re: regex::Regex::new(SQL_LIST_CONTEXT_PATTERN)
            .expect("SQL_LIST_CONTEXT_PATTERN валідний"),
        guard_stack: Vec::new(),
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Точний порт `findUnsafeBunSqlInListMissingEmptyGuardInText` (`bun-sql-scan.mjs`).
fn find_bun_sql_in_list_guard(content: &str, path: &str) -> Vec<InListGuardHit> {
    find_in_list_guard(content, path, InListGuardFlavor::BunSql)
}

/// Точний порт `findUnsafeMssqlInListMissingEmptyGuardInText` (`mssql-pool-scan.mjs`).
fn find_mssql_in_list_guard(content: &str, path: &str) -> Vec<InListGuardHit> {
    find_in_list_guard(content, path, InListGuardFlavor::Mssql)
}

/// Вид pg-format-шима — точний порт `kind`-поля `findPgFormatShimDefinitionInText`.
enum ShimKind {
    /// `format`/`pgFormat`/`sqlFormat`/`pgFmt` з `%L`/`%I`/`%s` у тілі.
    FormatFunction,
    /// `quoteLiteral`/`quoteIdent`/`escapeLiteral`/`escapeIdent` — без
    /// перевірки тіла.
    QuoteHelper,
}

/// Одна шим-знахідка — [`find_pg_format_shims`].
struct ShimHit {
    line: usize,
    snippet: String,
    kind: ShimKind,
    name: String,
}

/// Mini-visitor «чи містить піддерево `%L`/`%I`/`%s`» — точний порт
/// `nodeContainsPgFormatPlaceholder`: string literal (cooked), template
/// literal (raw-текст quasis), regexp literal (pattern).
struct PgPlaceholderFinder<'r> {
    placeholder_re: &'r regex::Regex,
    found: bool,
}

impl<'a> Visit<'a> for PgPlaceholderFinder<'_> {
    fn visit_string_literal(&mut self, it: &StringLiteral<'a>) {
        if self.placeholder_re.is_match(it.value.as_str()) {
            self.found = true;
        }
    }

    fn visit_template_literal(&mut self, it: &TemplateLiteral<'a>) {
        if self.placeholder_re.is_match(&template_quasis_raw_text(it)) {
            self.found = true;
        }
        walk_template_literal(self, it);
    }

    fn visit_reg_exp_literal(&mut self, it: &RegExpLiteral<'a>) {
        if self.placeholder_re.is_match(it.regex.pattern.text.as_str()) {
            self.found = true;
        }
    }
}

/// Чи тіло функції містить pg-format-плейсхолдер (див. [`PgPlaceholderFinder`]).
fn function_body_has_pg_placeholder(body: &FunctionBody, placeholder_re: &regex::Regex) -> bool {
    let mut finder = PgPlaceholderFinder {
        placeholder_re,
        found: false,
    };
    finder.visit_function_body(body);
    finder.found
}

/// Visitor pg-format-шимів — точний порт `findPgFormatShimDefinitionInText`
/// разом з `asNamedFunctionDecl`: `function <name>(...) {...}` (лише
/// `FunctionDeclaration`) і `const <name> = (...) => {...}` / `= function(...)`.
struct PgFormatShimVisitor<'c> {
    content: &'c str,
    placeholder_re: regex::Regex,
    out: Vec<ShimHit>,
}

impl PgFormatShimVisitor<'_> {
    /// Точний порт вибору `kind` (quote-хелпер має пріоритет — той самий
    /// порядок гілок, що в JS).
    fn classify(&self, name: &str, body: Option<&FunctionBody>) -> Option<ShimKind> {
        if QUOTE_HELPER_NAMES.contains(&name) {
            return Some(ShimKind::QuoteHelper);
        }
        if PG_FORMAT_SHIM_FUNC_NAMES.contains(&name)
            && body.is_some_and(|b| function_body_has_pg_placeholder(b, &self.placeholder_re))
        {
            return Some(ShimKind::FormatFunction);
        }
        None
    }

    /// Сніпет — точний порт `content.slice(node.start, Math.min(node.end,
    /// node.start + 240))` (кап 240 байт ДО normalize).
    fn push_shim(&mut self, span: Span, name: &str, kind: ShimKind) {
        let end = span.end.min(span.start + 240) as usize;
        self.out.push(ShimHit {
            line: line_number_at_offset(self.content, span.start as usize),
            snippet: normalize_snippet(&self.content[span.start as usize..end]),
            kind,
            name: name.to_string(),
        });
    }
}

impl<'a> Visit<'a> for PgFormatShimVisitor<'_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        if it.r#type == FunctionType::FunctionDeclaration {
            if let Some(id) = &it.id {
                if let Some(kind) = self.classify(id.name.as_str(), it.body.as_deref()) {
                    self.push_shim(it.span, id.name.as_str(), kind);
                }
            }
        }
        walk_function(self, it, flags);
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let BindingPattern::BindingIdentifier(id) = &it.id {
            let body = match &it.init {
                Some(Expression::ArrowFunctionExpression(arrow)) => Some(&*arrow.body),
                Some(Expression::FunctionExpression(func)) => func.body.as_deref(),
                _ => None,
            };
            if body.is_some() {
                if let Some(kind) = self.classify(id.name.as_str(), body) {
                    self.push_shim(it.span, id.name.as_str(), kind);
                }
            }
        }
        walk_variable_declarator(self, it);
    }
}

/// Точний порт `findPgFormatShimDefinitionInText` (`bun-sql-scan.mjs`) —
/// включно з внутрішнім гейтом `textHasBunSqlImport` (щоб не плутати
/// форматер дат із SQL-шимом поза Bun SQL-файлами).
fn find_pg_format_shims(content: &str, path: &str) -> Vec<ShimHit> {
    if !has_bun_sql_import(content) {
        return Vec::new();
    }
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = PgFormatShimVisitor {
        content,
        placeholder_re: regex::Regex::new(PG_FORMAT_PLACEHOLDER_PATTERN)
            .expect("PG_FORMAT_PLACEHOLDER_PATTERN валідний"),
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Mini-visitor «чи містить піддерево виклик `<obj>.unsafe(...)`» — точний
/// порт `nodeContainsUnsafeCall`.
struct UnsafeCallFinder {
    found: bool,
}

impl<'a> Visit<'a> for UnsafeCallFinder {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if is_unsafe_call(it) {
            self.found = true;
        }
        walk_call_expression(self, it);
    }
}

/// Чи ключ property — `query` — точний порт `propertyKeyName` (Identifier
/// або string literal; числові ключі ніколи не дорівнюють `"query"`).
fn property_key_is_query(key: &PropertyKey) -> bool {
    match key {
        PropertyKey::StaticIdentifier(ident) => ident.name == "query",
        PropertyKey::StringLiteral(lit) => lit.value == "query",
        _ => false,
    }
}

/// Чи сигнатура — pg-style `query(text, params?)` — точний порт
/// `hasPgQuerySignature`: 1–2 параметри, перший — Identifier
/// `text`/`sql`/`query`.
fn has_pg_query_signature(params: &FormalParameters) -> bool {
    let len = params.items.len() + usize::from(params.rest.is_some());
    if !(1..=2).contains(&len) {
        return false;
    }
    let Some(first) = params.items.first() else {
        return false;
    };
    let BindingPattern::BindingIdentifier(ident) = &first.pattern else {
        return false;
    };
    PG_QUERY_FIRST_PARAM_NAMES.contains(&ident.name.as_str())
}

/// Чи property — pg-сумісна query-обгортка — точний порт
/// `asPgFormatLikeQueryProp`.
fn is_pg_query_wrapper_prop(prop: &ObjectProperty) -> bool {
    if !property_key_is_query(&prop.key) {
        return false;
    }
    let (params, body) = match &prop.value {
        Expression::FunctionExpression(func) => (&func.params, func.body.as_deref()),
        Expression::ArrowFunctionExpression(arrow) => (&arrow.params, Some(&*arrow.body)),
        _ => return false,
    };
    if !has_pg_query_signature(params) {
        return false;
    }
    body.is_some_and(|b| {
        let mut finder = UnsafeCallFinder { found: false };
        finder.visit_function_body(b);
        finder.found
    })
}

/// Visitor query-обгорток — точний порт `findPgFormatLikeQueryWrapperInText`:
/// обходить `ObjectExpression` і перевіряє КОЖЕН його property.
struct QueryWrapperVisitor<'c> {
    content: &'c str,
    out: Vec<AstHit>,
}

impl<'a> Visit<'a> for QueryWrapperVisitor<'_> {
    fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
        for prop_kind in &it.properties {
            if let ObjectPropertyKind::ObjectProperty(prop) = prop_kind {
                if is_pg_query_wrapper_prop(prop) {
                    self.out.push(AstHit::at(self.content, prop.span));
                }
            }
        }
        walk_object_expression(self, it);
    }
}

/// Точний порт `findPgFormatLikeQueryWrapperInText` (`bun-sql-scan.mjs`) —
/// включно з внутрішнім гейтом `textHasBunSqlImport`.
fn find_pg_query_wrappers(content: &str, path: &str) -> Vec<AstHit> {
    if !has_bun_sql_import(content) {
        return Vec::new();
    }
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = QueryWrapperVisitor {
        content,
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Чи це виклик `JSON.stringify(...)` — точний порт `isJsonStringifyCall`.
fn is_json_stringify_call(expr: &Expression) -> bool {
    let Expression::CallExpression(call) = expr else {
        return false;
    };
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return false;
    };
    member.property.name == "stringify"
        && matches!(&member.object, Expression::Identifier(obj) if obj.name == "JSON")
}

/// Чи це `sql.array(..., 'text')` — точний порт `isTextArrayCall`
/// (безпечний контракт `text[] → unnest → ::jsonb`).
fn is_text_array_call(expr: &Expression) -> bool {
    let Expression::CallExpression(call) = expr else {
        return false;
    };
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return false;
    };
    if member.property.name != "array" {
        return false;
    }
    matches!(call.arguments.get(1), Some(Argument::StringLiteral(lit)) if lit.value == "text")
}

/// Чи вираз — `CallExpression`, серед аргументів якого прямий
/// `JSON.stringify(...)` чи `.map(r => JSON.stringify(...))`-колбек
/// (expression-body arrow) — точний порт `hasSqlArrayStringify`-гілки
/// `findJsonStringifyBeforeJsonbInText` (`FunctionExpression`-тіло —
/// `BlockStatement`, тож у JS ніколи не матчиться — відтворено).
fn call_has_sql_array_stringify(expr: &Expression) -> bool {
    let Expression::CallExpression(call) = expr else {
        return false;
    };
    call.arguments.iter().any(|arg| {
        let Some(arg_expr) = arg.as_expression() else {
            return false;
        };
        if is_json_stringify_call(arg_expr) {
            return true;
        }
        if let Expression::CallExpression(inner) = arg_expr {
            if let Some(Expression::ArrowFunctionExpression(arrow)) =
                inner.arguments.first().and_then(|a| a.as_expression())
            {
                if let Some(body_expr) = arrow.get_expression() {
                    return is_json_stringify_call(body_expr);
                }
            }
        }
        false
    })
}

/// Visitor `JSON.stringify(...)::jsonb` — точний порт
/// `findJsonStringifyBeforeJsonbInText` (tagged template дає дублікати —
/// доккомент секції «Батч 4»).
struct JsonStringifyJsonbVisitor<'c> {
    content: &'c str,
    jsonb_re: regex::Regex,
    out: Vec<AstHit>,
}

impl JsonStringifyJsonbVisitor<'_> {
    fn process_template(&mut self, tpl: &TemplateLiteral) {
        for (index, expr) in tpl.expressions.iter().enumerate() {
            let is_direct = is_json_stringify_call(expr);
            let has_sql_array_stringify = !is_direct && call_has_sql_array_stringify(expr);
            if !is_direct && !has_sql_array_stringify {
                continue;
            }
            if is_text_array_call(expr) {
                continue;
            }
            let raw_after = tpl
                .quasis
                .get(index + 1)
                .map(|q| q.value.raw.as_str())
                .unwrap_or("");
            if self.jsonb_re.is_match(raw_after) || has_sql_array_stringify {
                self.out.push(AstHit::at(self.content, expr.span()));
            }
        }
    }
}

impl<'a> Visit<'a> for JsonStringifyJsonbVisitor<'_> {
    fn visit_template_literal(&mut self, it: &TemplateLiteral<'a>) {
        self.process_template(it);
        walk_template_literal(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        self.process_template(&it.quasi);
        walk_tagged_template_expression(self, it);
    }
}

/// Точний порт `findJsonStringifyBeforeJsonbInText` (`bun-sql-scan.mjs`).
fn find_json_stringify_before_jsonb(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = JsonStringifyJsonbVisitor {
        content,
        jsonb_re: regex::Regex::new(JSONB_CAST_PATTERN).expect("JSONB_CAST_PATTERN валідний"),
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Visitor `sql.array(arr)` без типу — точний порт
/// `findSqlArrayWithoutTypeArgInText`: об'єкт — Identifier зі
/// [`SQL_INSTANCE_NAMES`], РІВНО один аргумент.
struct SqlArrayNoTypeVisitor<'c> {
    content: &'c str,
    out: Vec<AstHit>,
}

impl<'a> Visit<'a> for SqlArrayNoTypeVisitor<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(member) = &it.callee {
            if member.property.name == "array"
                && matches!(&member.object, Expression::Identifier(obj)
                    if SQL_INSTANCE_NAMES.contains(&obj.name.as_str()))
                && it.arguments.len() == 1
            {
                self.out.push(AstHit::at(self.content, it.span));
            }
        }
        walk_call_expression(self, it);
    }
}

/// Точний порт `findSqlArrayWithoutTypeArgInText` (`bun-sql-scan.mjs`).
fn find_sql_array_without_type(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = SqlArrayNoTypeVisitor {
        content,
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Visitor імпортів пакета `pg` — точний порт `findPgLibImportInText`:
/// `ImportDeclaration` із source РІВНО `pg` (включно з side-effect формою) і
/// `require('pg')` з одним аргументом (`isRequireOfModule`).
struct PgLibImportVisitor<'c> {
    content: &'c str,
    out: Vec<AstHit>,
}

impl<'a> Visit<'a> for PgLibImportVisitor<'_> {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        if it.source.value == "pg" {
            self.out.push(AstHit::at(self.content, it.span));
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if matches!(&it.callee, Expression::Identifier(callee) if callee.name == "require")
            && it.arguments.len() == 1
            && matches!(it.arguments.first(), Some(Argument::StringLiteral(lit)) if lit.value == "pg")
        {
            self.out.push(AstHit::at(self.content, it.span));
        }
        walk_call_expression(self, it);
    }
}

/// Точний порт `findPgLibImportInText` (`bun-sql-scan.mjs`).
fn find_pg_lib_imports(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = PgLibImportVisitor {
        content,
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Visitor LISTEN/NOTIFY-сигналів — точний порт `findPgListenNotifyUsageInText`
/// (зведений до boolean: `kind`-и потрібні лише pass-повідомленням JS-боку):
/// `.query|queryArray|queryStream('LISTEN …')` (string чи template),
/// `.on('notification', …)`, tagged template з LISTEN/UNLISTEN/NOTIFY.
struct ListenNotifyFinder {
    sql_start_re: regex::Regex,
    found: bool,
}

impl<'a> Visit<'a> for ListenNotifyFinder {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(member) = &it.callee {
            let method = member.property.name.as_str();
            if let Some(first) = it.arguments.first().and_then(|a| a.as_expression()) {
                if method == "on" {
                    if string_literal_value(first) == Some("notification") {
                        self.found = true;
                    }
                } else if matches!(method, "query" | "queryArray" | "queryStream") {
                    let sql_text = match first {
                        Expression::StringLiteral(lit) => Some(lit.value.to_string()),
                        Expression::TemplateLiteral(tpl) => Some(template_quasis_raw_text(tpl)),
                        _ => None,
                    };
                    if sql_text.is_some_and(|text| self.sql_start_re.is_match(&text)) {
                        self.found = true;
                    }
                }
            }
        }
        walk_call_expression(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if self
            .sql_start_re
            .is_match(&template_quasis_raw_text(&it.quasi))
        {
            self.found = true;
        }
        walk_tagged_template_expression(self, it);
    }
}

/// Чи файл містить хоч один AST-рівневий LISTEN/NOTIFY-сигнал (точний порт
/// `findPgListenNotifyUsageInText(...).length > 0`).
fn has_pg_listen_notify_usage(content: &str, path: &str) -> bool {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return false;
    }
    let mut finder = ListenNotifyFinder {
        sql_start_re: regex::Regex::new(PG_LISTEN_NOTIFY_SQL_PATTERN)
            .expect("PG_LISTEN_NOTIFY_SQL_PATTERN валідний"),
        found: false,
    };
    finder.visit_program(&ret.program);
    finder.found
}

/// pg-сигнали одного файлу для `checkPgDependencyAndUsage` — точний порт
/// `collectPgUsageForFile`: `None`, якщо файл не пройшов дешевий текстовий
/// pre-filter АБО обидва AST-скани порожні (файл не потрапляє в `pgUsage`).
fn collect_pg_usage(content: &str, path: &str) -> Option<(Vec<AstHit>, bool)> {
    if !has_pg_lib_import(content) && !may_have_listen_notify(content) {
        return None;
    }
    let imports = find_pg_lib_imports(content, path);
    let has_listen_notify = has_pg_listen_notify_usage(content, path);
    if imports.is_empty() && !has_listen_notify {
        return None;
    }
    Some((imports, has_listen_notify))
}

/// Повідомлення guard-порушення `js-bun-db/safety` — точний порт
/// `messageForBunSqlInListGuard` (`main.mjs:299-316`).
fn bun_db_in_list_guard_message(rel: &str, hit: &InListGuardHit) -> String {
    match &hit.reason {
        InListGuardReason::MissingGuard(name) => format!(
            "js-bun-db: {rel}:{} — перед IN-списком {} потрібна перевірка на пустоту з throw \
             (наприклад if (!{}.length) throw ...), інакше можливі некоректні запити \
             (js-bun-db.mdc): {}",
            hit.line,
            json_escape_string(name),
            name,
            hit.snippet
        ),
        InListGuardReason::SqlHelperNotVar => format!(
            "js-bun-db: {rel}:{} — IN-список у ${{sql(...)}} має підставлятись зі змінної \
             (Identifier) після валідації на пустоту + throw (js-bun-db.mdc): {}",
            hit.line, hit.snippet
        ),
        InListGuardReason::NotVar => format!(
            "js-bun-db: {rel}:{} — значення для IN (...) у template literal треба винести в \
             окрему змінну і перевірити на пустоту (throw), не підставляти вираз напряму \
             (js-bun-db.mdc): {}",
            hit.line, hit.snippet
        ),
    }
}

/// Точний порт `scanFileForBunSqlPatterns` (`js-bun-db/safety/main.mjs:137-225`)
/// — десять сканерів у ТОМУ САМОМУ порядку, кожен зі своїм повідомленням
/// байт-у-байт; гейти `textHasBunSqlImport` живуть УСЕРЕДИНІ окремих
/// `find_*` (pg-leftover/shim/query-wrapper), решта сканерів ганяються без
/// гейта — точно як у JS.
fn scan_file_for_bun_sql_patterns(rel: &str, content: &str) -> Vec<String> {
    let mut out = Vec::new();
    for v in find_bun_sql_per_request_connection(content, rel) {
        out.push(format!(
            "js-bun-db: {rel}:{} — не створюй new SQL(...) всередині функцій; тримай singleton \
             на рівні модуля (js-bun-db.mdc): {}",
            v.line, v.snippet
        ));
    }
    for v in find_bun_sql_unsafe_without_marker(content, rel) {
        out.push(format!(
            "js-bun-db: {rel}:{} — sql.unsafe(...) заборонено за замовчуванням; допустимо лише \
             для підстановки назви таблиці/колонки чи dynamic SQL/DDL з code-controlled \
             значенням, інакше переробити на tagged template sql`...${{value}}...`. Якщо випадок \
             легітимний — додай маркер \"// n-rules:allow-unsafe: <причина>\" на тому ж рядку \
             або рядком вище (js-bun-db.mdc): {}",
            v.line, v.snippet
        ));
    }
    for v in find_bun_sql_unsafe_interpolated_template(content, rel) {
        out.push(format!(
            "js-bun-db: {rel}:{} — sql.unsafe(`...${{x}}...`) з template-літералом і \
             ${{...}}-інтерполяцією заборонено навіть з n-rules:n-rules:allow-unsafe маркером: \
             шаблонна підстановка identifier'у не екранує (reserved words, спецсимволи), а \
             значення не біндяться. Збери text через @scaleleap/pg-format format('%I', name) \
             для identifiers або позиційні $N для values, потім sql.unsafe(text, [params]). \
             Деталі — секція «Динамічна SQL-структура» в js-bun-db.mdc: {}",
            v.line, v.snippet
        ));
    }
    for v in find_bun_sql_pg_leftover(content, rel) {
        out.push(format!(
            "js-bun-db: {rel}:{} — pg-leftover виклик .{}(...): Bun SQL пулом керує сам, видали \
             зайвий .connect()/.end() або, якщо випадок легітимний (graceful shutdown тощо), \
             додай маркер \"// n-rules:allow-pg-leftover: <причина>\" на тому ж рядку або рядком \
             вище (js-bun-db.mdc): {}",
            v.line, v.method, v.snippet
        ));
    }
    for v in find_sql_dynamic_list(content, rel) {
        out.push(format!(
            "js-bun-db: {rel}:{} — заборонено підставляти у SQL динамічні списки через \
             .join(',') у IN (...) / VALUES (...); використовуй sql([...]) (js-bun-db.mdc): {}",
            v.line, v.snippet
        ));
    }
    for v in find_bun_sql_in_list_guard(content, rel) {
        out.push(bun_db_in_list_guard_message(rel, &v));
    }
    for v in find_pg_format_shims(content, rel) {
        match v.kind {
            ShimKind::FormatFunction => out.push(format!(
                "js-bun-db: {rel}:{} — функція {} виглядає як pg-format-сумісний шим (тіло \
                 містить %L / %I / %s). Видали шим і переведи всі call-site на tagged template \
                 sql`...${{value}}...` (js-bun-db.mdc): {}",
                v.line,
                json_escape_string(&v.name),
                v.snippet
            )),
            ShimKind::QuoteHelper => out.push(format!(
                "js-bun-db: {rel}:{} — {} — це pg-format-специфічний escape-хелпер; з Bun SQL \
                 він не потрібен (параметризація через tagged template), видали і перепиши \
                 call-site (js-bun-db.mdc): {}",
                v.line,
                json_escape_string(&v.name),
                v.snippet
            )),
        }
    }
    for v in find_pg_query_wrappers(content, rel) {
        out.push(format!(
            "js-bun-db: {rel}:{} — query(text, params)-обгортка над <obj>.unsafe(...) — це \
             прихований pg-сумісний шим. Видали обгортку (pgRead/pgWrite/db.query) і переведи \
             всі call-site на tagged template sql`...${{value}}...` (js-bun-db.mdc): {}",
            v.line, v.snippet
        ));
    }
    for v in find_json_stringify_before_jsonb(content, rel) {
        out.push(format!(
            "js-bun-db: {rel}:{} — JSON.stringify(...) перед ::jsonb зайвий: Bun SQL серіалізує \
             об'єкти/масиви у JSON автоматично, явний stringify призводить до подвійної \
             серіалізації (js-bun-db.mdc query-safety): {}",
            v.line, v.snippet
        ));
    }
    for v in find_sql_array_without_type(content, rel) {
        out.push(format!(
            "js-bun-db: {rel}:{} — sql.array(arr) без другого аргументу типу — вкажи явний \
             pg-тип: sql.array(arr, 'int8') / sql.array(arr, 'uuid') тощо (js-bun-db.mdc \
             sql-array): {}",
            v.line, v.snippet
        ));
    }
    out
}

/// Точний порт `lint()` `js-bun-db/safety` (`main.mjs:323-432`) — WHOLE-BATCH,
/// AST-реалізація (задача Q4 батч 4). Порядок violations — точно як порядок
/// `fail()`-викликів JS: спершу сканери джерел (файл за файлом, десять
/// сканерів у порядку [`scan_file_for_bun_sql_patterns`]), потім
/// `dependencies.pg`-перевірка per package.json, потім `import 'pg'` без
/// LISTEN/NOTIFY. Ранній вихід «немає JS/TS-джерел» стоїть ДО pg-перевірок
/// (точний порт `if (sourcePaths.length === 0) { pass; return }`).
fn detect_bun_db_safety(files: &[SourceFile]) -> Vec<Diagnostic> {
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
    let source_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| is_bun_db_scan_source_file(&f.path))
        .collect();
    if source_files.is_empty() {
        return Vec::new();
    }

    let mut messages: Vec<String> = Vec::new();
    let mut pg_usage: Vec<(&SourceFile, Vec<AstHit>, bool)> = Vec::new();
    for file in &source_files {
        messages.extend(scan_file_for_bun_sql_patterns(&file.path, &file.content));
        if let Some((imports, has_listen_notify)) = collect_pg_usage(&file.content, &file.path) {
            pg_usage.push((file, imports, has_listen_notify));
        }
    }

    let has_any_listen_notify = pg_usage.iter().any(|(_, _, listen)| *listen);
    for pkg in &package_json_files {
        // Невалідний JSON у package.json — проблема інших правил, тут
        // пропускаємо (точний порт `catch { continue }`).
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&pkg.content) else {
            continue;
        };
        if package_declares_pg(&parsed) && !has_any_listen_notify {
            messages.push(format!(
                "js-bun-db: {}: dependencies.pg заборонено — у проекті не знайдено LISTEN / \
                 NOTIFY / UNLISTEN (або listener'а .on('notification', ...)). Bun SQL покриває \
                 звичайні запити; `pg` дозволений лише як виняток для LISTEN/NOTIFY \
                 (js-bun-db.mdc, секція «pg для LISTEN/NOTIFY»)",
                pkg.path
            ));
        }
    }

    for (file, imports, has_listen_notify) in &pg_usage {
        if imports.is_empty() || *has_listen_notify {
            continue;
        }
        for imp in imports {
            messages.push(format!(
                "js-bun-db: {}:{} — import 'pg' дозволено лише у файлах з LISTEN / NOTIFY / \
                 UNLISTEN або .on('notification', ...). Перенеси звичайні запити на Bun SQL \
                 (import {{ sql }} from 'bun'), а LISTEN/NOTIFY-логіку лиши в окремому модулі \
                 (js-bun-db.mdc): {}",
                file.path, imp.line, imp.snippet
            ));
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

// =====================================================================
// Задача Q4 батч 4: `js-mssql/deps` — AST-концерн через `oxc_parser`
// (версійний аудит package.json через serde_json + шість AST-сканерів).

/// Точний порт `auditMssqlVersionInPackageJson` +
/// `aggregateMssqlVersionsAcrossPackages` (`js-mssql/deps/main.mjs:105-147`)
/// — повертає `(found, messages)`: справжній JSON-парсинг (`serde_json`,
/// дзеркало `JSON.parse` включно з fail «невалідний JSON»), рядки версій у
/// повідомленнях — через [`json_escape_string`] (дзеркало `JSON.stringify`).
fn audit_mssql_versions(package_json_files: &[&SourceFile]) -> (u32, Vec<String>) {
    let mut found = 0u32;
    let mut messages = Vec::new();
    for pkg in package_json_files {
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&pkg.content) else {
            messages.push(format!("js-mssql: {} — невалідний JSON", pkg.path));
            continue;
        };
        let Some(range) = mssql_dependency_range(&parsed) else {
            continue;
        };
        found += 1;
        match parse_leading_semver(&range) {
            None => messages.push(format!(
                "js-mssql: {}: dependencies.mssql має нечитабельну версію: {} (js-mssql.mdc)",
                pkg.path,
                json_escape_string(&range)
            )),
            Some(version) if !semver_gte(version, MIN_MSSQL_VERSION) => messages.push(format!(
                "js-mssql: {}: dependencies.mssql {} — має бути >=12.5.0 (js-mssql.mdc)",
                pkg.path,
                json_escape_string(&range)
            )),
            Some(_) => {}
        }
    }
    (found, messages)
}

/// Visitor shared Request — точний порт `findSharedMssqlRequestInText`:
/// `VariableDeclarator` з id-Identifier РІВНО `request` та init-викликом
/// `<obj>.request(...)` (`isRequestFactoryCall`).
struct SharedRequestVisitor<'c> {
    content: &'c str,
    out: Vec<AstHit>,
}

impl<'a> Visit<'a> for SharedRequestVisitor<'_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let BindingPattern::BindingIdentifier(id) = &it.id {
            if id.name == "request" {
                if let Some(Expression::CallExpression(call)) = &it.init {
                    if matches!(&call.callee, Expression::StaticMemberExpression(member)
                        if member.property.name == "request")
                    {
                        self.out.push(AstHit::at(self.content, it.span));
                    }
                }
            }
        }
        walk_variable_declarator(self, it);
    }
}

/// Точний порт `findSharedMssqlRequestInText` (`mssql-pool-scan.mjs`).
fn find_shared_mssql_request(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = SharedRequestVisitor {
        content,
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Visitor ``query(`...`)`` — точний порт
/// `findUnsafeMssqlQueryTemplateCallInText` (`isUnsafeQueryCallWithTemplateLiteral`):
/// виклик `.query(...)` з `TemplateLiteral` ПЕРШИМ аргументом (не tagged).
struct UnsafeQueryTemplateVisitor<'c> {
    content: &'c str,
    out: Vec<AstHit>,
}

impl<'a> Visit<'a> for UnsafeQueryTemplateVisitor<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(member) = &it.callee {
            if member.property.name == "query"
                && matches!(it.arguments.first(), Some(Argument::TemplateLiteral(_)))
            {
                self.out.push(AstHit::at(self.content, it.span));
            }
        }
        walk_call_expression(self, it);
    }
}

/// Точний порт `findUnsafeMssqlQueryTemplateCallInText` (`mssql-pool-scan.mjs`).
fn find_unsafe_mssql_query_template_call(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = UnsafeQueryTemplateVisitor {
        content,
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Класифікація `init`-виразу `VariableDeclarator`-а для трасування
/// `isInListExpressionParsed`: обчислюється на етапі збору (чиста функція —
/// той самий результат, що ліниве обчислення JS).
enum DeclInit {
    /// Літеральний числовий масив чи піддерево з числовим парсером.
    Parsed,
    /// `init` — Identifier: трасується далі за ім'ям.
    Ref(String),
    /// Решта — «не парсовано».
    NotParsed,
}

/// Visitor-збирач усіх `VariableDeclarator`-ів файлу — точний порт
/// `collectVariableDeclarators` (лише Identifier-id з непорожнім `init`,
/// дзеркало фільтра в `isInListExpressionParsed`).
struct DeclCollector {
    decls: Vec<(String, DeclInit)>,
}

impl<'a> Visit<'a> for DeclCollector {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let BindingPattern::BindingIdentifier(id) = &it.id {
            if let Some(init) = &it.init {
                let kind = if is_literal_numeric_array(init) || expression_has_numeric_parse(init) {
                    DeclInit::Parsed
                } else if let Expression::Identifier(reference) = init {
                    DeclInit::Ref(reference.name.to_string())
                } else {
                    DeclInit::NotParsed
                };
                self.decls.push((id.name.to_string(), kind));
            }
        }
        walk_variable_declarator(self, it);
    }
}

/// Чи це непорожній масив суто числових літералів — точний порт
/// `isLiteralNumericArrayExpression` (elision/spread → false).
fn is_literal_numeric_array(expr: &Expression) -> bool {
    let Expression::ArrayExpression(array) = expr else {
        return false;
    };
    !array.elements.is_empty()
        && array.elements.iter().all(|el| {
            matches!(
                el,
                ArrayExpressionElement::NumericLiteral(_)
                    | ArrayExpressionElement::BigIntLiteral(_)
            )
        })
}

/// Mini-visitor числових парсерів — точний порт `subtreeHasNumericParseCall`:
/// виклик `parseInt`/`parseFloat`/`Number`/`BigInt` (Identifier чи
/// non-computed member) або унарний `+` будь-де у піддереві.
struct NumericParseFinder {
    found: bool,
}

impl<'a> Visit<'a> for NumericParseFinder {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let is_parse_call = match &it.callee {
            Expression::Identifier(ident) => NUMERIC_PARSE_FN_NAMES.contains(&ident.name.as_str()),
            Expression::StaticMemberExpression(member) => {
                NUMERIC_PARSE_FN_NAMES.contains(&member.property.name.as_str())
            }
            _ => false,
        };
        if is_parse_call {
            self.found = true;
        }
        walk_call_expression(self, it);
    }

    fn visit_unary_expression(&mut self, it: &UnaryExpression<'a>) {
        if it.operator == UnaryOperator::UnaryPlus {
            self.found = true;
        }
        walk_unary_expression(self, it);
    }
}

/// Чи піддерево виразу містить числовий парсер (див. [`NumericParseFinder`]).
fn expression_has_numeric_parse(expr: &Expression) -> bool {
    let mut finder = NumericParseFinder { found: false };
    finder.visit_expression(expr);
    finder.found
}

/// Трасування Identifier → init за таблицею декларацій — точний порт
/// Identifier-гілки `isInListExpressionParsed`: `seen` захищає від циклів,
/// УСІ декларації з цим ім'ям мають резолвитись у «парсовано».
fn in_list_identifier_resolves(
    name: &str,
    decls: &[(String, DeclInit)],
    seen: &std::collections::HashSet<String>,
) -> bool {
    if seen.contains(name) {
        return false;
    }
    let matching: Vec<&DeclInit> = decls
        .iter()
        .filter(|(decl_name, _)| decl_name == name)
        .map(|(_, kind)| kind)
        .collect();
    if matching.is_empty() {
        return false;
    }
    let mut next = seen.clone();
    next.insert(name.to_string());
    matching.iter().all(|kind| match kind {
        DeclInit::Parsed => true,
        DeclInit::Ref(inner) => in_list_identifier_resolves(inner, decls, &next),
        DeclInit::NotParsed => false,
    })
}

/// Точний порт `isInListExpressionParsed` для виразу з `IN (${...})`.
fn is_in_list_expression_parsed(expr: &Expression, decls: &[(String, DeclInit)]) -> bool {
    if is_literal_numeric_array(expr) || expression_has_numeric_parse(expr) {
        return true;
    }
    if let Expression::Identifier(ident) = expr {
        return in_list_identifier_resolves(
            ident.name.as_str(),
            decls,
            &std::collections::HashSet::new(),
        );
    }
    false
}

/// Visitor непарсованих `IN (${...})` — точний порт
/// `collectInListUnparsedFromTemplate`: лише `TemplateLiteral`-вузли (tagged
/// оброблюється один раз — через свій quasi), лінія — за `expr.start`,
/// сніпет — за всім template-вузлом.
struct InListUnparsedVisitor<'c, 'd> {
    content: &'c str,
    in_end_re: regex::Regex,
    decls: &'d [(String, DeclInit)],
    out: Vec<AstHit>,
}

impl<'a> Visit<'a> for InListUnparsedVisitor<'_, '_> {
    fn visit_template_literal(&mut self, it: &TemplateLiteral<'a>) {
        if !it.expressions.is_empty() {
            for (index, expr) in it.expressions.iter().enumerate() {
                let raw = it
                    .quasis
                    .get(index)
                    .map(|q| q.value.raw.as_str())
                    .unwrap_or("");
                if !self.in_end_re.is_match(raw) {
                    continue;
                }
                if is_join_call(expr) {
                    continue;
                }
                if is_in_list_expression_parsed(expr, self.decls) {
                    continue;
                }
                self.out.push(AstHit {
                    line: line_number_at_offset(self.content, expr.span().start as usize),
                    snippet: span_snippet(self.content, it.span),
                });
            }
        }
        walk_template_literal(self, it);
    }
}

/// Точний порт `findUnsafeMssqlInListUnparsedInText` (`mssql-pool-scan.mjs`).
fn find_mssql_in_list_unparsed(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut collector = DeclCollector { decls: Vec::new() };
    collector.visit_program(&ret.program);
    let mut visitor = InListUnparsedVisitor {
        content,
        in_end_re: regex::Regex::new(MSSQL_IN_PLACEHOLDER_END_PATTERN)
            .expect("MSSQL_IN_PLACEHOLDER_END_PATTERN валідний"),
        decls: &collector.decls,
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

/// Повідомлення guard-порушення `js-mssql/deps` — точний порт двох гілок
/// `scanMssqlOneSourceFile` (`main.mjs:188-201`); `sql_helper_not_var` у
/// mssql-флейворі недосяжний ([`InListGuardVisitor::extract_var_name`]).
fn mssql_in_list_guard_message(rel: &str, hit: &InListGuardHit) -> String {
    match &hit.reason {
        InListGuardReason::MissingGuard(name) => format!(
            "js-mssql: {rel}:{} — перед IN-списком {} потрібна перевірка на пустоту з throw \
             (наприклад if (!{}.length) throw ...), інакше можливі некоректні запити \
             (js-mssql.mdc): {}",
            hit.line,
            json_escape_string(name),
            name,
            hit.snippet
        ),
        _ => format!(
            "js-mssql: {rel}:{} — значення для IN (${{...}}) у template literal треба винести \
             в окрему змінну і перевірити на пустоту (throw), не підставляти вираз напряму \
             (js-mssql.mdc): {}",
            hit.line, hit.snippet
        ),
    }
}

/// Точний порт `scanMssqlOneSourceFile` (`js-mssql/deps/main.mjs:157-202`) —
/// шість AST-сканерів у ТОМУ САМОМУ порядку, повідомлення байт-у-байт.
fn scan_mssql_source_file(rel: &str, content: &str) -> Vec<String> {
    let mut out = Vec::new();
    for v in find_mssql_per_request_connection(content, rel) {
        out.push(format!(
            "js-mssql: {rel}:{} — не створюй new sql.ConnectionPool(...) на кожен запит; \
             використовуй singleton sql.ConnectionPool: {}",
            v.line, v.snippet
        ));
    }
    for v in find_shared_mssql_request(content, rel) {
        out.push(format!(
            "js-mssql: {rel}:{} — заборонено шарити Request (наприклад export const request = \
             pool.request()); створюй pool.request() щоразу заново (js-mssql.mdc): {}",
            v.line, v.snippet
        ));
    }
    for v in find_unsafe_mssql_query_template_call(content, rel) {
        out.push(format!(
            "js-mssql: {rel}:{} — заборонено query(`...`): це не tagged template; використовуй \
             pool.request().query`...` (js-mssql.mdc): {}",
            v.line, v.snippet
        ));
    }
    for v in find_sql_dynamic_list(content, rel) {
        out.push(format!(
            "js-mssql: {rel}:{} — заборонено підставляти у SQL динамічні списки через \
             .join(',') (типово IN (...) / VALUES (...)); використовуй TVP (sql.Table) + \
             JOIN/INSERT (js-mssql.mdc): {}",
            v.line, v.snippet
        ));
    }
    for v in find_mssql_in_list_unparsed(content, rel) {
        out.push(format!(
            "js-mssql: {rel}:{} — у SQL IN (${{...}}) значення мають бути попередньо приведені \
             числовим парсером (parseInt/Number/BigInt/parseFloat) і відфільтровані від NaN, \
             інакше можливий SQL injection (js-mssql.mdc): {}",
            v.line, v.snippet
        ));
    }
    for v in find_mssql_in_list_guard(content, rel) {
        out.push(mssql_in_list_guard_message(rel, &v));
    }
    out
}

/// Точний порт `lint()` `js-mssql/deps` (`main.mjs:267-297`) — WHOLE-BATCH,
/// AST-реалізація (задача Q4 батч 4). Джерела скануються лише якщо ХОЧ ОДИН
/// `package.json` декларує `dependencies.mssql` (`found > 0`); при
/// `found == 0` уже накопичені version-fails (напр. «невалідний JSON») УСЕ
/// ОДНО повертаються (точний порт `return reporter.result()` після
/// аудиту — НЕ порожній список).
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

    let (found, mut messages) = audit_mssql_versions(&package_json_files);
    if found > 0 {
        let source_files: Vec<&SourceFile> = files
            .iter()
            .filter(|f| is_js_ts_source_file(&f.path) && !f.path.ends_with(".d.ts"))
            .collect();
        for file in &source_files {
            messages.extend(scan_mssql_source_file(&file.path, &file.content));
        }
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
///
/// **Два буфери, не один** (виправлено батчем 7 — прихована розбіжність
/// порядку, знайдена фікстурою `js/dep-policy` «два порушення в одному
/// файлі»): JS-оригінал спочатку зливає УВЕСЬ `parsed.module.staticImports`,
/// і лише потім ходить деревом за `import()`/`require()`. Тому у файлі, де
/// `require('a')` стоїть ВИЩЕ за `import b from 'x'`, JS віддає
/// `['x', 'a']`, а не порядок рядків. Один спільний `Vec` (як було до
/// батчу 7) віддавав DFS-порядок — той самий двофазний прийом, що
/// [`RedisImportVisitor`] батчу 4.
struct ImportSourceVisitor {
    static_sources: Vec<String>,
    walk_sources: Vec<String>,
}

impl<'a> Visit<'a> for ImportSourceVisitor {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        self.static_sources
            .push(it.source.value.as_str().to_string());
        // Навмисно БЕЗ `walk_import_declaration(self, it)` — специфікатори
        // (`{ a, b as c }`) не містять вкладених `import()`/`require()`,
        // яких мали б стосуватись інші visit-гілки цього visitor-а.
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if let Expression::StringLiteral(lit) = &it.source {
            self.walk_sources.push(lit.value.as_str().to_string());
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
                    self.walk_sources.push(lit.value.as_str().to_string());
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
        static_sources: Vec::new(),
        walk_sources: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    let mut sources = visitor.static_sources;
    sources.extend(visitor.walk_sources);
    sources
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
            // Три AST-концерни батчу 4 (задача Q4): глоби дзеркалять
            // `concern.json.lint.glob` JS-оригіналів (`**/package.json` у
            // globset матчить і кореневий `package.json` — потрібен гейту
            // «package.json існує» кожного з трьох концернів).
            ConcernContribution {
                key: CONCERN_REDIS_IMPORTS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string(),
                    "**/package.json".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_MSSQL_DEPS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string(),
                    "**/package.json".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_BUN_DB_SAFETY.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string(),
                    "**/package.json".to_string(),
                ],
            },
            // П'ять концернів storybook-сімейства (батч 5): глоби ШИРШІ за
            // `concern.json.lint.glob` JS-оригіналів — batch мусить містити
            // все, що ті читають напряму з диска (`.n-rules.json`/legacy
            // `.n-cursor.json` для optOut/detectApps/ignore, `**/package.json`
            // для workspace-розгортання, `**/*.vue` для порога скоупу,
            // quasar.variables-кандидати для sass-гейта hygiene). Extglob
            // `@(js|ts)` JS-оригіналу page-coverage розгорнуто у два патерни
            // — `globset` host-а (`build_full_scope_files`) його не підтримує
            // (невалідний патерн тихо випав би з фільтра).
            ConcernContribution {
                key: CONCERN_STORYBOOK_SCOPE.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    ".n-rules.json".to_string(),
                    ".n-cursor.json".to_string(),
                    "**/package.json".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_STORYBOOK_HYGIENE.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    ".n-rules.json".to_string(),
                    ".n-cursor.json".to_string(),
                    "**/package.json".to_string(),
                    "**/*.vue".to_string(),
                    "**/.storybook/**".to_string(),
                    "**/src/css/quasar.variables.scss".to_string(),
                    "**/src/css/quasar.variables.sass".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_STORYBOOK_PAGE_COVERAGE.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    ".n-rules.json".to_string(),
                    ".n-cursor.json".to_string(),
                    "**/package.json".to_string(),
                    "**/*.vue".to_string(),
                    "**/*.stories.js".to_string(),
                    "**/*.stories.ts".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_STORYBOOK_SCAFFOLD.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    ".n-rules.json".to_string(),
                    ".n-cursor.json".to_string(),
                    "**/package.json".to_string(),
                    "**/*.vue".to_string(),
                    "**/.storybook/**".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_STORYBOOK_CI.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    ".n-rules.json".to_string(),
                    ".n-cursor.json".to_string(),
                    "**/package.json".to_string(),
                    "**/*.vue".to_string(),
                    ".github/actions/setup-playwright-chromium/action.yml".to_string(),
                    ".github/workflows/lint-storybook.yml".to_string(),
                ],
            },
            // Батч 6: storybook-vitest-config (глоб — scope-детекція батчу 5
            // плюс самі конфіги) і три package_json rego-порти (лише
            // `**/package.json`, як `policy.files.walkGlob` оригіналів).
            ConcernContribution {
                key: CONCERN_STORYBOOK_VITEST_CONFIG.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    ".n-rules.json".to_string(),
                    ".n-cursor.json".to_string(),
                    "**/package.json".to_string(),
                    "**/*.vue".to_string(),
                    "**/vitest.config.mjs".to_string(),
                    "**/vitest.config.js".to_string(),
                    "**/vitest.config.ts".to_string(),
                    "**/vitest.stryker.config.*".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_BUN_DB_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/package.json".to_string()],
            },
            ConcernContribution {
                key: CONCERN_REDIS_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/package.json".to_string()],
            },
            ConcernContribution {
                key: CONCERN_MSSQL_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/package.json".to_string()],
            },
            // Батч 7: кластер `npm-module/*` + `js/dep-policy`. Глоби трьох
            // метадані-концернів СВІДОМО ВУЖЧІ за `concern.json.lint.glob`
            // (доккомент секції «Батч 7»): batch має містити рівно те, що
            // JS-канон читає з диска — `npm/rules/*/*` замість
            // `npm/rules/**/main.json`+…, чотири `*/js/*`-глоби замість
            // `**/*` цілого репо.
            ConcernContribution {
                key: CONCERN_RULE_META.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["npm/rules/*/*".to_string()],
            },
            ConcernContribution {
                key: CONCERN_SKILL_META.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["npm/skills/*/*".to_string()],
            },
            ConcernContribution {
                key: CONCERN_HEADER_DOC_POINTER.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "npm/rules/*/js/*".to_string(),
                    "npm/rules/*/js/docs/*".to_string(),
                    "npm/skills/*/js/*".to_string(),
                    "npm/skills/*/js/docs/*".to_string(),
                ],
            },
            // `**/*` `concern.json` звужено до реально читаного JS-каноном
            // простору: корінь-`package.json`, увесь `npm/` (tarball-простір
            // `files`), hk-конфіг і workflow-и. Літерал `npm` — щоб гілка
            // «`npm` є ФАЙЛОМ, а не каталогом» лишалась спостережуваною.
            ConcernContribution {
                key: CONCERN_PACKAGE_STRUCTURE.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "package.json".to_string(),
                    "npm".to_string(),
                    "npm/**".to_string(),
                    "hk.pkl".to_string(),
                    ".config/hk.pkl".to_string(),
                    ".github/workflows/**".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_DEP_POLICY.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string()],
            },
            ConcernContribution {
                key: CONCERN_BUN_LAYOUT.to_string(),
                scope: ConcernScope::Full,
                // Кореневі імена без `**/` — `existsSync(join(cwd, …))`
                // JS-канону дивиться ЛИШЕ корінь. `.yarn` поруч із
                // `.yarn/**` — доккомент секції «Батч 8», підсекція «Глоби
                // контрибуцій».
                glob: vec![
                    "package-lock.json".to_string(),
                    "yarn.lock".to_string(),
                    "pnpm-lock.yaml".to_string(),
                    ".yarnrc.yml".to_string(),
                    ".yarn".to_string(),
                    ".yarn/**".to_string(),
                    "bun.lock".to_string(),
                    "bunfig.toml".to_string(),
                    "package.json".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_STYLE_TOOLING.to_string(),
                scope: ConcernScope::Full,
                // Той самий кореневий принцип; brace-форми
                // `concern.json` (`.stylelintrc.{json,js,cjs,mjs}`)
                // розгорнуті в явні імена [`STYLELINT_CONFIG_FILES`].
                glob: vec![
                    "package.json".to_string(),
                    ".stylelintrc.json".to_string(),
                    ".stylelintrc.js".to_string(),
                    ".stylelintrc.cjs".to_string(),
                    ".stylelintrc.mjs".to_string(),
                    "stylelint.config.js".to_string(),
                    "stylelint.config.cjs".to_string(),
                    "stylelint.config.mjs".to_string(),
                    ".stylelintignore".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_SANDBOX_AWARE_TEST.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
            },
            ConcernContribution {
                key: CONCERN_VITEST_API_CONVENTIONS.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
            },
            ConcernContribution {
                key: CONCERN_VUE_PACKAGES.to_string(),
                scope: ConcernScope::Full,
                // `concern.json` цього концерну глоба не має взагалі
                // (`{ "lint": { "scope": "full" } }`) — тобто JS-канон бачив
                // УВЕСЬ репозиторій. Явний перелік нижче — точний
                // відповідник того, що канон реально читає з диска:
                // `[cm]?[jt]sx?`+`.vue` (import-скани, `SOURCE_FILE_RE`),
                // решта розширень — [`is_esbuild_scan_file`], плюс іменовані
                // конфіги (доккомент секції «Батч 9», підсекція «Глоб
                // контрибуції»).
                glob: vec![
                    "**/*.{js,jsx,mjs,mjsx,cjs,cjsx,ts,tsx,mts,mtsx,cts,ctsx}".to_string(),
                    "**/*.{vue,json,jsonc,yaml,yml,md,mdc}".to_string(),
                ],
            },
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

// =====================================================================
// Батч 5 (§3.5.5): storybook-сімейство — п'ять full-scope концернів
// `test/storybook-{scope,hygiene,page-coverage,scaffold,ci}`. JS-оригінали —
// `plugins/lang-js/rules/test/storybook-*/main.mjs`; спільна scope-детекція
// (`collectInScopeVuePackages`, `storybook-scope/main.mjs`) відтворена тут
// batch-функціями: замість власного filesystem-обходу (walkDir/existsSync
// JS-оригіналів) плагін працює з full-scope батчем, що його host
// (`crates/rules-napi::build_full_scope_files`) будує тим САМИМ walk-двигуном
// (`rules_core::scan::walk_dir`), що й JS-`walkDir` — тож множина видимих
// файлів збігається, а `existsSync`-гейти стають перевірками присутності
// шляху в батчі.
//
// Свідомо задокументовані мікро-розбіжності (недосяжні в реальних репо, не
// покриваються фікстурами):
// 1. Битий JSON кореневого `package.json` — JS-оригінал кидає DetectorError
//    (без try/catch у `getMonorepoPackageRootDirs`), порт толерантно
//    повертає лише корінь `.` (skip-not-crash дух контракту; консюмер із
//    битим кореневим package.json падає раніше на інших концернах).
// 2. `scanGlob` розгортання workspace-патернів НЕ поважає .gitignore, а
//    full-scope batch — поважає: workspace-пакет під .gitignore невидимий
//    порту (нереальний кейс — воркспейси комітяться).
// 3. Абсолютні шляхи в `.n-rules.json#ignore` — плагін не знає cwd, такі
//    записи пропускаються (машино-специфічний конфіг, зламаний за задумом).
// 4. `localeCompare`-сортування коренів наближене
//    ([`locale_compare_approx`]): точна ICU-колація недоступна в guest;
//    для реалістичних імен пакетів (ASCII, без пунктуаційних колізій)
//    порядок збігається.
// 5. Порожній каталог (`src/pages/` без файлів) невидимий у батчі, тоді як
//    `existsSync` JS-оригіналу його бачить — git не трекає порожні теки,
//    кейс недосяжний у чекауті.

/// Ключ контрибуції `test/storybook-scope` (батч 5).
const CONCERN_STORYBOOK_SCOPE: &str = "test/storybook-scope";

/// Ключ контрибуції `test/storybook-hygiene` (батч 5).
const CONCERN_STORYBOOK_HYGIENE: &str = "test/storybook-hygiene";

/// Ключ контрибуції `test/storybook-page-coverage` (батч 5).
const CONCERN_STORYBOOK_PAGE_COVERAGE: &str = "test/storybook-page-coverage";

/// Ключ контрибуції `test/storybook-scaffold` (батч 5).
const CONCERN_STORYBOOK_SCAFFOLD: &str = "test/storybook-scaffold";

/// Ключ контрибуції `test/storybook-ci` (батч 5).
const CONCERN_STORYBOOK_CI: &str = "test/storybook-ci";

/// Поріг кількості `.vue`-файлів для скоупу канону Storybook — точний порт
/// `VUE_FILE_THRESHOLD` (`storybook-scope/main.mjs:16`).
const VUE_FILE_THRESHOLD: usize = 3;

/// Канонічне значення `package.json#scripts.storybook` — точний порт
/// `STORYBOOK_SCRIPT` (`storybook-scaffold/main.mjs:10`).
const STORYBOOK_SCRIPT: &str = "storybook dev -p 6006 --no-open";

/// Теки, ігноровані при розгортанні workspace-патернів — точний порт
/// `WORKSPACE_IGNORED_DIRS` (`npm/scripts/lib/workspaces.mjs:17`).
const WORKSPACE_IGNORED_DIRS: [&str; 4] = ["node_modules", ".git", ".venv", "venv"];

/// Quasar CLI-конвенція глобальних SCSS-змінних — точний порт
/// `SASS_VARIABLES_CANDIDATES` (`storybook-hygiene/main.mjs:25`).
const SASS_VARIABLES_CANDIDATES: [&str; 2] = [
    "src/css/quasar.variables.scss",
    "src/css/quasar.variables.sass",
];

/// `quasar({ sassVariables: true|'шлях' })` — точний порт
/// `SASS_VARIABLES_MARKER_RE` (`storybook-hygiene/main.mjs:29`).
const SASS_VARIABLES_MARKER_PATTERN: &str = r#"sassVariables\s*:\s*(?:true|['"])"#;

/// `*.stories.js`/`*.stories.ts` — точний порт `STORIES_SUFFIX_RE`
/// (`storybook-page-coverage/main.mjs:10`).
const STORIES_SUFFIX_PATTERN: &str = r"\.stories\.(js|ts)$";

/// `<script …>…</script>`-блоки SFC — точний порт regex
/// `extractVueScriptBlocks` (`npm/scripts/lib/js-source-signals.mjs:30`,
/// `/<script\b[^>]*>([\s\S]*?)<\/script>/gi` → `(?is)` прапорці).
const VUE_SCRIPT_BLOCK_PATTERN: &str = r"(?is)<script\b[^>]*>(.*?)</script>";

/// Node-builtin модулі — статичне дзеркало `builtinModules` (`node:module`,
/// Node 25; порт `NODE_BUILTIN_MODULES` з
/// `plugins/lang-js/rules/vue/lib/vue-forbidden-imports.mjs:23`). `node:`-
/// префіксні записи (`node:test` тощо) опущено — їх уже покриває гілка
/// `starts_with("node:")` [`is_node_builtin_specifier`].
const NODE_BUILTIN_MODULES: [&str; 62] = [
    "_http_agent",
    "_http_client",
    "_http_common",
    "_http_incoming",
    "_http_outgoing",
    "_http_server",
    "_tls_common",
    "_tls_wrap",
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "inspector/promises",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "repl",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
];

/// Один канонічний маркер scaffold/ci-файлу — точне дзеркало елементів
/// `MAIN_JS_MARKERS`/`PREVIEW_JS_MARKERS`/… (`storybook-scaffold/main.mjs`,
/// `storybook-ci/main.mjs`): `token` шукається як підрядок (`content.includes`),
/// `hint` — людський текст повідомлення.
struct CanonMarker {
    token: &'static str,
    hint: &'static str,
}

/// Маркери канону `.storybook/main.js` бібліотек — точний порт
/// `MAIN_JS_MARKERS` (`storybook-scaffold/main.mjs:16-34`).
const MAIN_JS_MARKERS: [CanonMarker; 8] = [
    CanonMarker { token: "@storybook/vue3-vite", hint: "framework @storybook/vue3-vite" },
    CanonMarker { token: "viteFinal", hint: "viteFinal-override vite.config пакета" },
    CanonMarker { token: "'vite-plugin-pages'", hint: "фільтр vite-plugin-pages у viteFinal" },
    CanonMarker { token: "'vite-plugin-vue-layouts'", hint: "фільтр vite-plugin-vue-layouts у viteFinal" },
    CanonMarker { token: "'vite-plugin-vue-layouts-next'", hint: "фільтр vite-plugin-vue-layouts-next у viteFinal" },
    CanonMarker {
        token: "isVueTransformFamily",
        hint: "сімейний фільтр vue-трансформерів (vite:vue/vue-macros) — стійкість до VueMacros-стека",
    },
    CanonMarker {
        token: "resolvePluginEntry",
        hint: "resolve/flatten Promise/масиву плагінів перед фільтрацією (VueMacros повертає Promise)",
    },
    CanonMarker {
        token: "viteConfigPath",
        hint: "core.builder.options.viteConfigPath на empty-vite.config.js (блокує builder-vite autodiscovery vite.config пакета — інакше подвійна SFC-трансформація на storybook build)",
    },
];

/// Маркери канону `.storybook/preview.js` бібліотек — точний порт
/// `PREVIEW_JS_MARKERS` (`storybook-scaffold/main.mjs:37-44`).
const PREVIEW_JS_MARKERS: [CanonMarker; 6] = [
    CanonMarker {
        token: "Quasar",
        hint: "повний install Quasar",
    },
    CanonMarker {
        token: "iconSet",
        hint: "iconSet",
    },
    CanonMarker {
        token: "iconMapFn",
        hint: "iconMapFn (без нього внутрішні Quasar-іконки недоступні)",
    },
    CanonMarker {
        token: "msw-storybook-addon",
        hint: "msw-storybook-addon",
    },
    CanonMarker {
        token: "onUnhandledRequest",
        hint: "onUnhandledRequest-фільтр",
    },
    CanonMarker {
        token: "mswLoader",
        hint: "mswLoader (не mswDecorator — deprecated у msw-storybook-addon 2.x)",
    },
];

/// Маркери канону `.storybook/main.js` app-проєктів (хвиля 2a) — точний порт
/// `APP_MAIN_JS_MARKERS` (`storybook-scaffold/main.mjs:57-64`).
const APP_MAIN_JS_MARKERS: [CanonMarker; 6] = [
    CanonMarker {
        token: "@storybook/vue3-vite",
        hint: "framework @storybook/vue3-vite",
    },
    CanonMarker {
        token: "staticDirs",
        hint: "staticDirs на ./public (msw service worker)",
    },
    CanonMarker {
        token: "viteFinal",
        hint: "viteFinal-фільтр file-system-routing плагінів",
    },
    CanonMarker {
        token: "'vite-plugin-vue-layouts'",
        hint: "фільтр vite-plugin-vue-layouts у viteFinal",
    },
    CanonMarker {
        token: "'vite-plugin-vue-layouts-next'",
        hint: "фільтр vite-plugin-vue-layouts-next у viteFinal",
    },
    CanonMarker {
        token: "'unplugin-vue-router'",
        hint: "фільтр unplugin-vue-router у viteFinal",
    },
];

/// Маркери канону `.storybook/preview.js` app-проєктів — точний порт
/// `APP_PREVIEW_JS_MARKERS` (`storybook-scaffold/main.mjs:72-80`).
const APP_PREVIEW_JS_MARKERS: [CanonMarker; 7] = [
    CanonMarker {
        token: "msw-storybook-addon",
        hint: "msw-storybook-addon",
    },
    CanonMarker {
        token: "onUnhandledRequest",
        hint: "onUnhandledRequest-фільтр",
    },
    CanonMarker {
        token: "mswLoader",
        hint: "mswLoader (не mswDecorator — deprecated у msw-storybook-addon 2.x)",
    },
    CanonMarker {
        token: "pageLoader",
        hint: "pageLoader — router/pinia на кожну story за parameters.route/parameters.pinia",
    },
    CanonMarker {
        token: "createMemoryHistory",
        hint: "createMemoryHistory — реальний параметризований маршрут сторінки",
    },
    CanonMarker {
        token: "QLayout",
        hint: "явна реєстрація QLayout (q-page кидає без layout-предка)",
    },
    CanonMarker {
        token: "QPageContainer",
        hint: "явна реєстрація QPageContainer",
    },
];

/// Маркери канону `.storybook/empty-vite.config.js` — точний порт
/// `EMPTY_VITE_CONFIG_MARKERS` (`storybook-scaffold/main.mjs:93-95`).
const EMPTY_VITE_CONFIG_MARKERS: [CanonMarker; 1] = [CanonMarker {
    token: "defineConfig",
    hint: "порожній defineConfig({}) — стенд-ін для viteConfigPath",
}];

/// Маркери канону `.storybook/vitest.setup.js` — точний порт
/// `VITEST_SETUP_JS_MARKERS` (`storybook-scaffold/main.mjs:107-110`).
const VITEST_SETUP_JS_MARKERS: [CanonMarker; 2] = [
    CanonMarker {
        token: "setProjectAnnotations",
        hint: "setProjectAnnotations([previewAnnotations])",
    },
    CanonMarker {
        token: "beforeAll",
        hint: "beforeAll(project.beforeAll)",
    },
];

/// Repo-relative шлях канонічного composite action — точний порт
/// `PLAYWRIGHT_ACTION_REL` (`storybook-ci/main.mjs:11`).
const PLAYWRIGHT_ACTION_REL: &str = ".github/actions/setup-playwright-chromium/action.yml";

/// Repo-relative шлях канонічного workflow — точний порт
/// `STORYBOOK_WORKFLOW_REL` (`storybook-ci/main.mjs:14`).
const STORYBOOK_WORKFLOW_REL: &str = ".github/workflows/lint-storybook.yml";

/// Маркери канону composite action — точний порт `PLAYWRIGHT_ACTION_MARKERS`
/// (`storybook-ci/main.mjs:21-25`).
const PLAYWRIGHT_ACTION_MARKERS: [CanonMarker; 3] = [
    CanonMarker {
        token: "ms-playwright",
        hint: "кеш каталогу ms-playwright",
    },
    CanonMarker {
        token: "actions/cache@",
        hint: "actions/cache для Playwright-браузерів",
    },
    CanonMarker {
        token: "playwright install chromium",
        hint: "install лише chromium (не всі браузери)",
    },
];

/// Маркери канону `lint-storybook.yml` — точний порт
/// `STORYBOOK_WORKFLOW_MARKERS` (`storybook-ci/main.mjs:32-36`).
const STORYBOOK_WORKFLOW_MARKERS: [CanonMarker; 3] = [
    CanonMarker {
        token: "./.github/actions/setup-bun-deps",
        hint: "setup-bun-deps перед Playwright-кроком",
    },
    CanonMarker {
        token: "./.github/actions/setup-playwright-chromium",
        hint: "композитний Playwright-кеш",
    },
    CanonMarker {
        token: "--project=storybook",
        hint: "швидкий прогін лише storybook-проєкту (не повний coverage)",
    },
];

/// Шукає файл у батчі за точним posix-relative шляхом — batch-відповідник
/// `existsSync`+`readFile` JS-оригіналів (host уже прочитав вміст, спека §3.2).
fn batch_file<'a>(files: &'a [SourceFile], path: &str) -> Option<&'a SourceFile> {
    files.iter().find(|f| f.path == path)
}

/// Чи «існує каталог» `dir` з погляду батча: хоч один файл лежить під ним
/// (або сам шлях є файлом — тоді JS-`existsSync` теж true, а обхід такого
/// «каталогу» в обох реалізацій порожній). Порожні каталоги git не трекає —
/// задокументована мікро-розбіжність 5 (доккомент секції).
fn batch_dir_exists(files: &[SourceFile], dir: &str) -> bool {
    let prefix = format!("{dir}/");
    files
        .iter()
        .any(|f| f.path == dir || f.path.starts_with(&prefix))
}

/// Толерантний JSON-парсинг — дзеркало `try { JSON.parse } catch { … }`
/// JS-оригіналів (повертає `None` замість винятку).
fn parse_json_tolerant(content: &str) -> Option<serde_json::Value> {
    serde_json::from_str(content).ok()
}

/// JS-truthiness для JSON-значення — дзеркало `Boolean(x)` над результатом
/// `JSON.parse`: falsy — `null`/`false`/`0`/`""`.
fn js_truthy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        serde_json::Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// Конфіг-файл репо: `.n-rules.json`, fallback — legacy `.n-cursor.json`
/// (точний порт вибору файлу `readStorybookOptOut`/`loadCursorIgnorePaths`:
/// СПОЧАТКУ existsSync першого, і лише за відсутності — другий; битий JSON
/// першого НЕ вмикає fallback).
fn batch_root_config(files: &[SourceFile]) -> Option<&SourceFile> {
    batch_file(files, ".n-rules.json").or_else(|| batch_file(files, ".n-cursor.json"))
}

/// Точний порт `readStorybookOptOut` (`storybook-scope/main.mjs:37-50`):
/// значення НЕ трімляться (фільтр лише відкидає нерядкові/порожні-після-trim).
fn read_storybook_opt_out(files: &[SourceFile]) -> Vec<String> {
    let Some(config) = batch_root_config(files) else {
        return Vec::new();
    };
    let Some(raw) = parse_json_tolerant(&config.content) else {
        return Vec::new();
    };
    let Some(list) = raw
        .get("storybook")
        .and_then(|s| s.get("optOut"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Точний порт `readDetectAppsFlag` (`storybook-scope/main.mjs:59-70`).
fn read_detect_apps_flag(files: &[SourceFile]) -> bool {
    let Some(config) = batch_root_config(files) else {
        return false;
    };
    let Some(raw) = parse_json_tolerant(&config.content) else {
        return false;
    };
    raw.get("storybook")
        .and_then(|s| s.get("detectApps"))
        .and_then(|v| v.as_bool())
        == Some(true)
}

/// Нормалізує відносний posix-шлях: прибирає `./`, порожні сегменти й
/// trailing-slash, розвʼязує `..`. `None` — запис не застосовний (порожній,
/// абсолютний — мікро-розбіжність 3, доккомент секції — чи виходить за корінь).
fn normalize_rel_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('/') {
        return None;
    }
    let mut out: Vec<&str> = Vec::new();
    for seg in trimmed.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop()?;
            }
            s => out.push(s),
        }
    }
    if out.is_empty() {
        return None;
    }
    Some(out.join("/"))
}

/// Ignore-шляхи з `.n-rules.json#ignore` — порт `loadCursorIgnorePaths`
/// (`npm/scripts/lib/load-cursor-config.mjs`) у відносний простір батча:
/// замість абсолютних posix-шляхів — нормалізовані відносні префікси.
fn read_ignore_prefixes(files: &[SourceFile]) -> Vec<String> {
    let Some(config) = batch_root_config(files) else {
        return Vec::new();
    };
    let Some(raw) = parse_json_tolerant(&config.content) else {
        return Vec::new();
    };
    let Some(list) = raw.get("ignore").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|v| v.as_str())
        .filter_map(normalize_rel_path)
        .collect()
}

/// Ignore-префікси, дієві для обходу з коренем `walk_prefix` (`""` — корінь
/// репо, інакше `"<dir>/"`) — точне дзеркало нормалізації `walkDir`
/// (`npm/scripts/utils/walkDir.mjs:63-70`): запис поза walk-коренем чи
/// рівний йому — відкидається (`relative()` дала б `..`-шлях або `''`).
fn effective_ignore_for_walk(walk_prefix: &str, ignore: &[String]) -> Vec<String> {
    ignore
        .iter()
        .filter_map(|entry| {
            if walk_prefix.is_empty() {
                Some(entry.clone())
            } else {
                entry
                    .strip_prefix(walk_prefix)
                    .filter(|rest| !rest.is_empty())
                    .map(|rest| rest.to_string())
            }
        })
        .collect()
}

/// Чи відносний (від walk-кореня) шлях лежить в ignore-префіксі — дзеркало
/// glob-а `${rel}/**` `walkDir` (файли строго ВСЕРЕДИНІ каталогу).
fn is_ignored_in_walk(rel_path: &str, effective_ignore: &[String]) -> bool {
    effective_ignore.iter().any(|p| {
        rel_path
            .strip_prefix(p.as_str())
            .is_some_and(|rest| rest.starts_with('/'))
    })
}

/// Матч одного glob-сегмента (`*` — будь-які символи в межах сегмента,
/// `?` — один символ) — спрощене дзеркало `Bun.Glob`/`node:fs glob` для
/// workspace-патернів (брейси/класи символів свідомо поза скоупом — їх немає
/// в реальних `workspaces`-полях).
fn glob_segment_matches(pattern: &str, segment: &str) -> bool {
    fn rec(p: &[char], s: &[char]) -> bool {
        match p.first() {
            None => s.is_empty(),
            Some('*') => rec(&p[1..], s) || (!s.is_empty() && rec(p, &s[1..])),
            Some('?') => !s.is_empty() && rec(&p[1..], &s[1..]),
            Some(c) => s.first() == Some(c) && rec(&p[1..], &s[1..]),
        }
    }
    let p: Vec<char> = pattern.chars().collect();
    let s: Vec<char> = segment.chars().collect();
    rec(&p, &s)
}

/// Посегментний glob-матч шляху (`**` — нуль чи більше сегментів).
fn glob_path_matches(pattern_segments: &[&str], path_segments: &[&str]) -> bool {
    match pattern_segments.first() {
        None => path_segments.is_empty(),
        Some(&"**") => {
            glob_path_matches(&pattern_segments[1..], path_segments)
                || (!path_segments.is_empty()
                    && glob_path_matches(pattern_segments, &path_segments[1..]))
        }
        Some(seg) => {
            !path_segments.is_empty()
                && glob_segment_matches(seg, path_segments[0])
                && glob_path_matches(&pattern_segments[1..], &path_segments[1..])
        }
    }
}

/// Точний порт `isIgnoredWorkspaceRoot` (`npm/scripts/lib/workspaces.mjs:24-29`).
fn is_ignored_workspace_root(ws: &str) -> bool {
    if ws == "." {
        return false;
    }
    let stripped = ws.replace('\\', "/");
    let stripped = stripped.strip_prefix("./").unwrap_or(&stripped);
    stripped
        .split('/')
        .any(|seg| WORKSPACE_IGNORED_DIRS.contains(&seg))
}

/// Наближення дефолтного `String#localeCompare` для сортування коренів
/// (`getMonorepoPackageRootDirs`, `workspaces.mjs:102-106`): первинний ключ
/// — лише буквено-цифрові символи в нижньому регістрі (ICU ігнорує
/// пунктуацію на первинному рівні), потім case-insensitive повний рядок,
/// потім байтовий — мікро-розбіжність 4, доккомент секції.
fn locale_compare_approx(a: &str, b: &str) -> std::cmp::Ordering {
    let primary = |s: &str| -> String {
        s.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect()
    };
    primary(a)
        .cmp(&primary(b))
        .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
        .then_with(|| a.cmp(b))
}

/// Точний порт `normalizeWorkspacePattern` (`workspaces.mjs:36-42`).
fn normalize_workspace_pattern(raw: &str) -> String {
    let mut normalized = raw.replace('\\', "/");
    while normalized.ends_with('/') {
        normalized.pop();
    }
    if normalized.is_empty() {
        ".".to_string()
    } else {
        normalized
    }
}

/// Шлях `package.json` кореня пакета `root_dir` у батчі (нормалізований для
/// lookup-а; сам `root_dir` лишається сирим, як у JS-оригіналі).
fn pkg_json_path(root_dir: &str) -> String {
    match normalize_rel_path(root_dir) {
        Some(norm) => format!("{norm}/package.json"),
        None => "package.json".to_string(),
    }
}

/// Префікс walk-простору пакета: `""` для кореня `.`, інакше `"<dir>/"`.
fn pkg_walk_prefix(root_dir: &str) -> String {
    match normalize_rel_path(root_dir) {
        Some(norm) => format!("{norm}/"),
        None => String::new(),
    }
}

/// Точний порт `getMonorepoPackageRootDirs` (`workspaces.mjs:90-108`) у
/// batch-простір: розгортання патернів іде по `**/package.json`-файлах
/// батча (мікро-розбіжності 1–2, доккомент секції).
fn monorepo_package_root_dirs(files: &[SourceFile]) -> Vec<String> {
    let mut roots: Vec<String> = vec![".".to_string()];
    let mut seen: HashSet<String> = roots.iter().cloned().collect();
    let add = |roots: &mut Vec<String>, seen: &mut HashSet<String>, ws: String| {
        if !seen.contains(&ws) {
            seen.insert(ws.clone());
            roots.push(ws);
        }
    };

    let Some(root_pkg) = batch_file(files, "package.json") else {
        return roots;
    };
    let Some(pkg) = parse_json_tolerant(&root_pkg.content) else {
        // Мікро-розбіжність 1 (доккомент секції): JS кидає DetectorError.
        return roots;
    };
    let patterns: Vec<String> = match pkg.get("workspaces") {
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        Some(serde_json::Value::Object(obj)) => match obj.get("packages") {
            Some(serde_json::Value::Array(items)) => items
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };

    for raw in patterns {
        let pattern = normalize_workspace_pattern(&raw);
        if pattern.contains('*') {
            let glob = format!("{pattern}/package.json");
            let glob_segments: Vec<&str> = glob.split('/').collect();
            for file in files {
                if file.path != "package.json" && !file.path.ends_with("/package.json") {
                    continue;
                }
                let path_segments: Vec<&str> = file.path.split('/').collect();
                if !glob_path_matches(&glob_segments, &path_segments) {
                    continue;
                }
                let dir = posix_dirname(&file.path);
                let ws = if dir.is_empty() { "." } else { dir };
                if !is_ignored_workspace_root(ws) {
                    add(&mut roots, &mut seen, ws.to_string());
                }
            }
        } else if batch_file(files, &pkg_json_path(&pattern)).is_some()
            && !is_ignored_workspace_root(&pattern)
        {
            add(&mut roots, &mut seen, pattern);
        }
    }

    let mut list: Vec<String> = roots
        .into_iter()
        .filter(|ws| !is_ignored_workspace_root(ws))
        .collect();
    list.sort_by(|a, b| {
        if a == "." {
            std::cmp::Ordering::Less
        } else if b == "." {
            std::cmp::Ordering::Greater
        } else {
            locale_compare_approx(a, b)
        }
    });
    list
}

/// Точний порт `isVueComponentLibraryPkg` (`vue/packages/main.mjs:217-219`).
fn is_vue_component_library_pkg(pkg: &serde_json::Value) -> bool {
    pkg.get("peerDependencies")
        .and_then(|d| d.get("vue"))
        .is_some_and(js_truthy)
}

/// Точний порт `isVueAppPkg` (`storybook-scope/main.mjs:98-100`).
fn is_vue_app_pkg(pkg: &serde_json::Value) -> bool {
    pkg.get("dependencies")
        .and_then(|d| d.get("vue"))
        .is_some_and(js_truthy)
        && !is_vue_component_library_pkg(pkg)
}

/// Файли батча всередині walk-кореня `walk_prefix` (без ignore-нутих) у
/// порядку rel-шляхів — дзеркало `walkDir` (native walk уже байтово-лексико-
/// графічний; сортуємо явно, щоб не залежати від порядку батча). Повертає
/// пари (rel-від-walk-кореня, файл).
fn walk_batch_files<'a>(
    files: &'a [SourceFile],
    walk_prefix: &str,
    ignore: &[String],
) -> Vec<(&'a str, &'a SourceFile)> {
    let effective = effective_ignore_for_walk(walk_prefix, ignore);
    let mut out: Vec<(&str, &SourceFile)> = files
        .iter()
        .filter_map(|f| {
            let rel = if walk_prefix.is_empty() {
                Some(f.path.as_str())
            } else {
                f.path.strip_prefix(walk_prefix)
            }?;
            if rel.is_empty() || is_ignored_in_walk(rel, &effective) {
                return None;
            }
            Some((rel, f))
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(b.0));
    out
}

/// Точний порт `countVueFiles` (`storybook-scope/main.mjs:79-89`) у
/// batch-простір.
fn count_vue_files(files: &[SourceFile], walk_prefix: &str, ignore: &[String]) -> usize {
    walk_batch_files(files, walk_prefix, ignore)
        .iter()
        .filter(|(rel, _)| rel.ends_with(".vue"))
        .count()
}

/// Тип пакета у скоупі Storybook — дзеркало `InScopePackage.type`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ScopePkgKind {
    Library,
    App,
}

/// Пакет у скоупі канону Storybook — batch-дзеркало `InScopePackage`
/// (`storybook-scope/main.mjs`): без `absDir`/`vueFileCount` (перший
/// незнаний у guest-а, другий downstream-концернам не потрібен).
struct ScopePkg {
    root_dir: String,
    pkg: serde_json::Value,
    kind: ScopePkgKind,
}

/// Точний порт `evaluateCandidate` (`storybook-scope/main.mjs:116-131`).
fn evaluate_candidate(
    files: &[SourceFile],
    root_dir: &str,
    matches: impl Fn(&serde_json::Value) -> bool,
    ignore: &[String],
    require_threshold: bool,
) -> Option<serde_json::Value> {
    let pkg_file = batch_file(files, &pkg_json_path(root_dir))?;
    let pkg = parse_json_tolerant(&pkg_file.content)?;
    if !matches(&pkg) {
        return None;
    }
    if require_threshold {
        let count = count_vue_files(files, &pkg_walk_prefix(root_dir), ignore);
        if count < VUE_FILE_THRESHOLD {
            return None;
        }
    }
    Some(pkg)
}

/// Точний порт `collectInScopeVuePackages` (`storybook-scope/main.mjs:149-173`)
/// у batch-простір.
fn collect_in_scope_vue_packages(files: &[SourceFile]) -> Vec<ScopePkg> {
    let roots = monorepo_package_root_dirs(files);
    let ignore = read_ignore_prefixes(files);
    let opt_out: HashSet<String> = read_storybook_opt_out(files).into_iter().collect();
    let candidate_roots: Vec<&String> = roots.iter().filter(|r| !opt_out.contains(*r)).collect();

    let mut result: Vec<ScopePkg> = Vec::new();
    for root_dir in &candidate_roots {
        if let Some(pkg) =
            evaluate_candidate(files, root_dir, is_vue_component_library_pkg, &ignore, true)
        {
            result.push(ScopePkg {
                root_dir: (*root_dir).clone(),
                pkg,
                kind: ScopePkgKind::Library,
            });
        }
    }

    if read_detect_apps_flag(files) {
        for root_dir in &candidate_roots {
            if result.iter().any(|p| &&p.root_dir == root_dir) {
                continue;
            }
            let pages_dir = format!("{}src/pages", pkg_walk_prefix(root_dir));
            if !batch_dir_exists(files, &pages_dir) {
                continue;
            }
            if let Some(pkg) = evaluate_candidate(files, root_dir, is_vue_app_pkg, &ignore, false) {
                result.push(ScopePkg {
                    root_dir: (*root_dir).clone(),
                    pkg,
                    kind: ScopePkgKind::App,
                });
            }
        }
    }

    result
}

/// Точний порт `lint()` `test/storybook-scope`
/// (`storybook-scope/main.mjs:183-204`) — self-check конфігурації: застарілі
/// записи `storybook.optOut`.
fn detect_storybook_scope(files: &[SourceFile]) -> Vec<Diagnostic> {
    let opt_out = read_storybook_opt_out(files);
    if opt_out.is_empty() {
        return Vec::new();
    }
    let roots: HashSet<String> = monorepo_package_root_dirs(files).into_iter().collect();
    opt_out
        .iter()
        .filter(|root_dir| !roots.contains(*root_dir))
        .map(|root_dir| Diagnostic {
            reason: "stale-opt-out".to_string(),
            message: format!(
                ".n-rules.json storybook.optOut містить '{root_dir}' — такого workspace-пакета \
                 немає (застаріле opt-out, storybook.mdc)"
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        })
        .collect()
}

/// Точний порт `fileRelFromCwd` (`storybook-hygiene/main.mjs:147-149`).
fn file_rel_from_cwd(root_dir: &str, rel_from_pkg: &str) -> String {
    if root_dir == "." {
        rel_from_pkg.to_string()
    } else {
        format!("{root_dir}/{rel_from_pkg}")
    }
}

/// Точний порт `extractVueScriptBlocks` (`npm/scripts/lib/js-source-signals.mjs:28-37`).
/// Regex кешується процес-глобально (`OnceLock`) — функція викликається в
/// циклі по `.vue`-файлах батча (clippy `regex_creation_in_loops`).
fn extract_vue_script_blocks(sfc: &str) -> String {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(VUE_SCRIPT_BLOCK_PATTERN).expect("VUE_SCRIPT_BLOCK_PATTERN валідний")
    });
    re.captures_iter(sfc)
        .map(|c| c.get(1).map_or("", |m| m.as_str()))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Visitor для [`extract_import_specifiers`]: статичні імпорти окремо від
/// динамічних/`require` — JS-оригінал (`storybook-hygiene/main.mjs:50-75`)
/// СПОЧАТКУ віддає всі `parsed.module.staticImports`, а ПОТІМ обходить AST
/// за `import()`/`require()` (`walkAstWithAncestors`), тож порядок
/// specifier-ів — «усі статичні, далі динамічні у порядку обходу».
struct HygieneImportVisitor {
    static_sources: Vec<String>,
    dynamic_sources: Vec<String>,
}

impl<'a> Visit<'a> for HygieneImportVisitor {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        self.static_sources
            .push(it.source.value.as_str().to_string());
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if let Expression::StringLiteral(lit) = &it.source {
            self.dynamic_sources.push(lit.value.as_str().to_string());
        }
        walk_import_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::Identifier(ident) = &it.callee {
            if ident.name.as_str() == "require" {
                if let Some(Argument::StringLiteral(lit)) = it.arguments.first() {
                    self.dynamic_sources.push(lit.value.as_str().to_string());
                }
            }
        }
        walk_call_expression(self, it);
    }
}

/// Точний порт `extractImportSpecifiers` (`storybook-hygiene/main.mjs:50-75`):
/// `.vue` → лише `<script>`-блоки, віртуальний `.ts` для вибору мови; файл із
/// parse-помилками пропускається цілком (`parsed.errors?.length` → `[]` —
/// на відміну від best-effort [`extract_import_sources`] `js/utils_imports`).
fn extract_import_specifiers(content: &str, rel_path: &str) -> Vec<String> {
    let is_vue = rel_path.ends_with(".vue");
    let scan = if is_vue {
        extract_vue_script_blocks(content)
    } else {
        content.to_string()
    };
    let source_type = if is_vue {
        SourceType::ts()
    } else {
        SourceType::from_path(rel_path).unwrap_or_default()
    };
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, &scan, source_type).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = HygieneImportVisitor {
        static_sources: Vec::new(),
        dynamic_sources: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    let mut out = visitor.static_sources;
    out.extend(visitor.dynamic_sources);
    out
}

/// Точний порт `isRelativeOrAliasSpecifier` (`storybook-hygiene/main.mjs:85-87`).
fn is_relative_or_alias_specifier(spec: &str) -> bool {
    spec.starts_with('.')
        || spec.starts_with('/')
        || spec.starts_with("~/")
        || spec.starts_with("@/")
}

/// Точний порт `isNodeBuiltinSpecifier`
/// (`plugins/lang-js/rules/vue/lib/vue-forbidden-imports.mjs:186-204`).
fn is_node_builtin_specifier(spec: &str) -> bool {
    if spec.is_empty() {
        return false;
    }
    if spec.starts_with("node:") {
        return true;
    }
    if NODE_BUILTIN_MODULES.contains(&spec) {
        return true;
    }
    if let Some(idx) = spec.find('/') {
        if idx > 0 && NODE_BUILTIN_MODULES.contains(&&spec[..idx]) {
            return true;
        }
    }
    false
}

/// Точний порт `topLevelPackageName` (`storybook-hygiene/main.mjs:95-102`).
fn top_level_package_name(spec: &str) -> String {
    if spec.starts_with('@') {
        let parts: Vec<&str> = spec.split('/').collect();
        if parts.len() >= 2 {
            return format!("{}/{}", parts[0], parts[1]);
        }
        return spec.to_string();
    }
    match spec.find('/') {
        Some(idx) => spec[..idx].to_string(),
        None => spec.to_string(),
    }
}

/// Точний порт `collectDeclaredDeps` (`storybook-hygiene/main.mjs:111-120`).
fn collect_declared_deps(pkg: &serde_json::Value) -> HashSet<String> {
    let mut names = HashSet::new();
    for field in ["dependencies", "peerDependencies"] {
        if let Some(serde_json::Value::Object(obj)) = pkg.get(field) {
            for name in obj.keys() {
                names.insert(name.clone());
            }
        }
    }
    names
}

/// Точний порт `lint()` `test/storybook-hygiene`
/// (`storybook-hygiene/main.mjs:250-268`): undeclared third-party imports у
/// `.vue` + auto-detect глобальних Quasar SCSS-змінних — ЛИШЕ для
/// `type: 'library'` пакетів (хвиля 2a, доккомент JS-оригіналу).
fn detect_storybook_hygiene(files: &[SourceFile]) -> Vec<Diagnostic> {
    let pkgs: Vec<ScopePkg> = collect_in_scope_vue_packages(files)
        .into_iter()
        .filter(|p| p.kind == ScopePkgKind::Library)
        .collect();
    if pkgs.is_empty() {
        return Vec::new();
    }
    let ignore = read_ignore_prefixes(files);
    let marker_re = regex::Regex::new(SASS_VARIABLES_MARKER_PATTERN)
        .expect("SASS_VARIABLES_MARKER_PATTERN валідний");
    let mut diagnostics = Vec::new();

    for entry in &pkgs {
        let declared = collect_declared_deps(&entry.pkg);
        let walk_prefix = pkg_walk_prefix(&entry.root_dir);

        // checkUndeclaredImportsForPackage (`main.mjs:162-189`).
        for (rel_from_pkg, file) in walk_batch_files(files, &walk_prefix, &ignore) {
            if !rel_from_pkg.ends_with(".vue") {
                continue;
            }
            let specifiers = extract_import_specifiers(&file.content, rel_from_pkg);
            let mut reported_for_file: HashSet<String> = HashSet::new();
            for spec in specifiers {
                if is_relative_or_alias_specifier(&spec) || is_node_builtin_specifier(&spec) {
                    continue;
                }
                let pkg_name = top_level_package_name(&spec);
                if declared.contains(&pkg_name) || reported_for_file.contains(&pkg_name) {
                    continue;
                }
                reported_for_file.insert(pkg_name.clone());

                let file_rel = file_rel_from_cwd(&entry.root_dir, rel_from_pkg);
                let where_pkg = if entry.root_dir == "." {
                    "кореня монорепо".to_string()
                } else {
                    entry.root_dir.clone()
                };
                diagnostics.push(Diagnostic {
                    reason: "undeclared-import".to_string(),
                    message: format!(
                        "[undeclared-import] {file_rel}: import '{spec}' — пакет '{pkg_name}' \
                         відсутній у dependencies/peerDependencies {where_pkg} (storybook.mdc \
                         hygiene)"
                    ),
                    file: Some(file_rel),
                    severity: Severity::Error,
                    data: Some(
                        serde_json::json!({
                            "rootDir": entry.root_dir,
                            "package": pkg_name,
                            "specifier": spec,
                        })
                        .to_string(),
                    ),
                });
            }
        }

        // checkSassVariablesForPackage (`main.mjs:212-226`).
        let has_sass_variables = SASS_VARIABLES_CANDIDATES
            .iter()
            .any(|f| batch_file(files, &format!("{walk_prefix}{f}")).is_some());
        if !has_sass_variables {
            continue;
        }
        let Some(main_js) = batch_file(files, &format!("{walk_prefix}.storybook/main.js")) else {
            continue;
        };
        if marker_re.is_match(&main_js.content) {
            continue;
        }
        let file_rel = file_rel_from_cwd(&entry.root_dir, ".storybook/main.js");
        diagnostics.push(Diagnostic {
            reason: "missing-sass-variables".to_string(),
            message: format!(
                "[sass-variables] {file_rel}: пакет має глобальні Quasar SCSS-змінні ({}), але \
                 quasar({{ sassVariables }}) не задано в .storybook/main.js (storybook.mdc \
                 hygiene)",
                SASS_VARIABLES_CANDIDATES.join(" | ")
            ),
            file: Some(file_rel),
            severity: Severity::Warn,
            data: Some(serde_json::json!({ "rootDir": entry.root_dir }).to_string()),
        });
    }

    diagnostics
}

/// Точний порт `lint()` `test/storybook-page-coverage`
/// (`storybook-page-coverage/main.mjs:69-86`): кожен `.vue` під `src/pages/`
/// app-пакета має мати `*.stories.js|ts` поряд (warn, хвиля 2a).
fn detect_storybook_page_coverage(files: &[SourceFile]) -> Vec<Diagnostic> {
    let pkgs: Vec<ScopePkg> = collect_in_scope_vue_packages(files)
        .into_iter()
        .filter(|p| p.kind == ScopePkgKind::App)
        .collect();
    if pkgs.is_empty() {
        return Vec::new();
    }
    let ignore = read_ignore_prefixes(files);
    let stories_re =
        regex::Regex::new(STORIES_SUFFIX_PATTERN).expect("STORIES_SUFFIX_PATTERN валідний");
    let mut diagnostics = Vec::new();

    for entry in &pkgs {
        let pkg_prefix = pkg_walk_prefix(&entry.root_dir);
        let pages_dir = format!("{pkg_prefix}src/pages");
        if !batch_dir_exists(files, &pages_dir) {
            continue;
        }
        // collectPagesTree (`main.mjs:21-34`): walk-корінь — сам `src/pages/`.
        let pages_walk_prefix = format!("{pages_dir}/");
        let walked = walk_batch_files(files, &pages_walk_prefix, &ignore);
        let story_dirs: HashSet<&str> = walked
            .iter()
            .filter(|(rel, _)| stories_re.is_match(rel))
            .map(|(rel, _)| posix_dirname(rel))
            .collect();
        for (rel, _) in &walked {
            if !rel.ends_with(".vue") {
                continue;
            }
            if story_dirs.contains(posix_dirname(rel)) {
                continue;
            }
            let rel_from_pkg = format!("src/pages/{rel}");
            let file_rel = file_rel_from_cwd(&entry.root_dir, &rel_from_pkg);
            diagnostics.push(Diagnostic {
                reason: "page-missing-story".to_string(),
                message: format!(
                    "[page-coverage] {file_rel}: немає жодної *.stories.js поряд — сторінка \
                     app-проєкту без smoke-story (storybook.mdc, хвиля 2a)"
                ),
                file: Some(file_rel),
                severity: Severity::Warn,
                data: Some(serde_json::json!({ "rootDir": entry.root_dir }).to_string()),
            });
        }
    }

    diagnostics
}

/// Людський підпис пакета для повідомлень scaffold — дзеркало
/// `label = rootDir === '.' ? 'корінь' : rootDir`.
fn pkg_label(root_dir: &str) -> String {
    if root_dir == "." {
        "корінь".to_string()
    } else {
        root_dir.to_string()
    }
}

/// `relPrefix` scaffold-повідомлень — дзеркало
/// `rootDir === '.' ? '' : `${rootDir}/``.
fn pkg_rel_prefix(root_dir: &str) -> String {
    if root_dir == "." {
        String::new()
    } else {
        format!("{root_dir}/")
    }
}

/// Точний порт `missingMarkers` (`storybook-scaffold/main.mjs:153-155`).
fn missing_markers<'m>(content: &str, markers: &'m [CanonMarker]) -> Vec<&'m CanonMarker> {
    markers
        .iter()
        .filter(|m| !content.contains(m.token))
        .collect()
}

/// Точний порт `checkCanonFile` (`storybook-scaffold/main.mjs:172-199`) у
/// batch-простір: відсутній файл → `missing_reason` (+`data.rootDir`),
/// наявний без маркера → `marker_reason` на кожен маркер.
#[allow(clippy::too_many_arguments)]
fn check_canon_file(
    files: &[SourceFile],
    root_dir: &str,
    rel_file: &str,
    markers: &[CanonMarker],
    missing_reason: &str,
    marker_reason: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let label = pkg_label(root_dir);
    let file_rel = format!("{}{rel_file}", pkg_rel_prefix(root_dir));
    let abs_path = format!("{}{rel_file}", pkg_walk_prefix(root_dir));
    if let Some(file) = batch_file(files, &abs_path) {
        for m in missing_markers(&file.content, markers) {
            diagnostics.push(Diagnostic {
                reason: marker_reason.to_string(),
                message: format!(
                    "[{label}] {rel_file} не відповідає канону — бракує: {} (storybook.mdc)",
                    m.hint
                ),
                file: Some(file_rel.clone()),
                severity: Severity::Error,
                data: None,
            });
        }
        return;
    }
    diagnostics.push(Diagnostic {
        reason: missing_reason.to_string(),
        message: format!(
            "[{label}] відсутній {rel_file} — канонічний скафолд: npx @7n/rules fix storybook \
             (storybook.mdc)"
        ),
        file: Some(file_rel),
        severity: Severity::Error,
        data: Some(serde_json::json!({ "rootDir": root_dir }).to_string()),
    });
}

/// JS-подібне рядкове відображення JSON-значення для template-literal
/// інтерполяції (`${scriptValue}`): рядок — як є, число/булеве — канонічно,
/// масив — join(','), обʼєкт — `[object Object]`, `null` у масиві — порожньо.
fn js_display_json(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => String::new(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(js_display_json)
            .collect::<Vec<_>>()
            .join(","),
        serde_json::Value::Object(_) => "[object Object]".to_string(),
    }
}

/// Точний порт `checkPackageScaffold` (`storybook-scaffold/main.mjs:300-333`).
fn check_package_scaffold(
    files: &[SourceFile],
    entry: &ScopePkg,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let root_dir = entry.root_dir.as_str();

    if entry.kind == ScopePkgKind::App {
        // checkAppScaffold (`main.mjs:266-290`).
        check_canon_file(
            files,
            root_dir,
            ".storybook/main.js",
            &APP_MAIN_JS_MARKERS,
            "missing-app-main-js",
            "app-main-js-marker-missing",
            diagnostics,
        );
        check_canon_file(
            files,
            root_dir,
            ".storybook/preview.js",
            &APP_PREVIEW_JS_MARKERS,
            "missing-app-preview-js",
            "app-preview-js-marker-missing",
            diagnostics,
        );
    } else {
        // checkLibraryScaffold (`main.mjs:212-252`).
        check_canon_file(
            files,
            root_dir,
            ".storybook/main.js",
            &MAIN_JS_MARKERS,
            "missing-main-js",
            "main-js-marker-missing",
            diagnostics,
        );
        check_canon_file(
            files,
            root_dir,
            ".storybook/preview.js",
            &PREVIEW_JS_MARKERS,
            "missing-preview-js",
            "preview-js-marker-missing",
            diagnostics,
        );
        check_canon_file(
            files,
            root_dir,
            ".storybook/empty-vite.config.js",
            &EMPTY_VITE_CONFIG_MARKERS,
            "missing-empty-vite-config",
            "empty-vite-config-marker-missing",
            diagnostics,
        );
    }

    check_canon_file(
        files,
        root_dir,
        ".storybook/vitest.setup.js",
        &VITEST_SETUP_JS_MARKERS,
        "missing-vitest-setup-js",
        "vitest-setup-js-marker-missing",
        diagnostics,
    );

    let script_value = entry.pkg.get("scripts").and_then(|s| s.get("storybook"));
    let is_canonical = script_value.and_then(|v| v.as_str()) == Some(STORYBOOK_SCRIPT);
    if !is_canonical {
        let label = pkg_label(root_dir);
        let pkg_json_rel = format!("{}package.json", pkg_rel_prefix(root_dir));
        let current = match script_value {
            Some(v) if js_truthy(v) => format!("'{}'", js_display_json(v)),
            _ => "відсутній".to_string(),
        };
        diagnostics.push(Diagnostic {
            reason: "missing-storybook-script".to_string(),
            message: format!(
                "[{label}] package.json#scripts.storybook має бути '{STORYBOOK_SCRIPT}' (зараз: \
                 {current}) — storybook.mdc"
            ),
            file: Some(pkg_json_rel),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "rootDir": root_dir }).to_string()),
        });
    }
}

/// Точний порт `lint()` `test/storybook-scaffold`
/// (`storybook-scaffold/main.mjs:341-355`).
fn detect_storybook_scaffold(files: &[SourceFile]) -> Vec<Diagnostic> {
    let pkgs = collect_in_scope_vue_packages(files);
    if pkgs.is_empty() {
        return Vec::new();
    }
    let mut diagnostics = Vec::new();
    for entry in &pkgs {
        check_package_scaffold(files, entry, &mut diagnostics);
    }
    diagnostics
}

/// Точний порт `checkRepoCanonFile` (`storybook-ci/main.mjs:51-67`) —
/// репо-рівневий канонічний файл, без per-package `rootDir`.
fn check_repo_canon_file(
    files: &[SourceFile],
    rel_file: &str,
    markers: &[CanonMarker],
    missing_reason: &str,
    marker_reason: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    if let Some(file) = batch_file(files, rel_file) {
        for m in missing_markers(&file.content, markers) {
            diagnostics.push(Diagnostic {
                reason: marker_reason.to_string(),
                message: format!(
                    "{rel_file} не відповідає канону — бракує: {} (storybook.mdc, ADR Кластер 5)",
                    m.hint
                ),
                file: Some(rel_file.to_string()),
                severity: Severity::Error,
                data: None,
            });
        }
        return;
    }
    diagnostics.push(Diagnostic {
        reason: missing_reason.to_string(),
        message: format!(
            "Відсутній {rel_file} — канонічний Playwright-кеш для vitest storybook-проєкту: npx \
             @7n/rules fix storybook (storybook.mdc, ADR Кластер 5)"
        ),
        file: Some(rel_file.to_string()),
        severity: Severity::Error,
        data: None,
    });
}

/// Точний порт `lint()` `test/storybook-ci` (`storybook-ci/main.mjs:83-112`).
/// Гейт `requires.capability: ci:github` НЕ відтворюється тут — він
/// застосовується JS-планувальником ДО диспатчу за `concern.json`
/// JS-оригіналу (обидва фільтри — capabilities/applies — лишаються в JS,
/// доккомент `rules_core::lint_plan`), wasm-shadowing його не оминає.
fn detect_storybook_ci(files: &[SourceFile]) -> Vec<Diagnostic> {
    let pkgs = collect_in_scope_vue_packages(files);
    if pkgs.is_empty() {
        return Vec::new();
    }
    let mut diagnostics = Vec::new();
    check_repo_canon_file(
        files,
        PLAYWRIGHT_ACTION_REL,
        &PLAYWRIGHT_ACTION_MARKERS,
        "missing-playwright-action",
        "playwright-action-marker-missing",
        &mut diagnostics,
    );
    check_repo_canon_file(
        files,
        STORYBOOK_WORKFLOW_REL,
        &STORYBOOK_WORKFLOW_MARKERS,
        "missing-storybook-workflow",
        "storybook-workflow-marker-missing",
        &mut diagnostics,
    );
    diagnostics
}

// =====================================================================
// Батч 6 (§3.5.5): `test/storybook-vitest-config` через слот `repo-root@1`
// host-функції `host-context` + package_json-хвіст SQL/redis-правил.
//
// # `test/storybook-vitest-config` — розблоковано контрактним рішенням cwd
//
// Порт `plugins/lang-js/rules/test/storybook-vitest-config/main.mjs` поверх
// спільної scope-детекції батчу 5 ([`collect_in_scope_vue_packages`]).
// Блокер батчу 5 (задокументований у PR #354): JS-канон кладе АБСОЛЮТНИЙ
// `vitestConfigPath` у `violation.data` (`join(absDir, name)`), і саме його
// читає JS-фіксер `fix-storybook-vitest-config.mjs` — а WIT `detect-batch`
// знає лише posix-relative шляхи. Розблоковано слотом `repo-root@1`
// host-функції `host-context` (контрактне рішення — доккомент
// `wit/world.wit` біля `import host-context`): [`Guest::detect`] читає слот
// і передає значення в чистий [`detect_storybook_vitest_config`] аргументом
// — сама функція лишається без host-імпортів (host-таргет unit-тести
// кличуть її напряму, той самий мотив, що [`build_manifest`]).
// `repo-root@1` = `none` (хост без контексту) — задокументована деградація:
// `vitestConfigPath` стає repo-relative; на актуальному napi-хості цього ж
// репозиторію (`run_wasm_concern` виставляє `set_repo_root(cwd)` перед
// кожним `detect`) гілка недосяжна.
//
// AST-частина (`findTestObject`/`findProperty`/`classifyProjects`) — той
// самий `oxc_parser`, що JS-канон (`parseModule` → `parseSync`): DFS
// pre-order пошук першого `ObjectExpression` із property `test`, значення
// якого — теж `ObjectExpression` ([`FindTestObjectVisitor`]); зрізи
// елементів `test.projects` — байтові (`Span`), що для UTF-16-зрізів JS
// `src.slice(start, end)` збігається на ASCII-конфігах (та сама
// задокументована еквівалентність, що в mssql/bun-db сканерах батчу 4).
//
// # package_json-хвіст (`js-bun-db`/`js-bun-redis`/`js-mssql`)
//
// Фактичний перелік НЕ-портованого станом на батч 5 у трьох SQL/redis
// правилах (звірено по `plugins/lang-js/rules/**`):
//
// - `js-bun-db/package_json`, `js-bun-redis/package_json`,
//   `js-mssql/package_json` — НЕ JS-детектори, а Rego-полісі
//   (`package_json.rego` + `template/package.json.deny.json`), які
//   dispatch виконує через conftest (`evaluatePolicyConcern` →
//   `runConftestBatch`, зовнішній тул). Тут — їх точний порт на
//   `serde_json` (прецедент батчу 4): та сама форма violation, що віддає
//   policy-adapter (`reason: "policy-deny"`, `message` — рядок rego-`deny`,
//   `file` — relative шлях `package.json`), semantics звірені живим
//   conftest-прогоном. Порядок кількох deny-повідомлень одного файлу —
//   лексикографічний (OPA-set сортований, звірено живим прогоном) —
//   [`detect_package_json_deny`] сортує явно.
// - `js-bun-db/connection`, `js-bun-db/pg_format_identifiers`,
//   `js-mssql/mssql-tvp` — `.mdc`-only концерни (guidance для LLM, без
//   жодного детектора: ані `main.mjs`, ані `policy` у `concern.json`) —
//   портувати НЕМА ЧОГО, це не де-скоуп.
//
// Розбіжності rego-портів (задокументовані, фікстури їх не торкаються):
//
// 1. Невалідний JSON у `package.json`: conftest валить ВЕСЬ прогін концерну
//    (`Error: parse configurations`, порожній stdout → `runConftestBatch`
//    кидає → `DetectorError`, exit 2); wasm-порт пропускає файл
//    (`parse_json_tolerant` → `None`) — skip-not-crash дух контракту,
//    «зламати весь лінт битим JSON-джерелом» відтворювати свідомо не
//    стали.
// 2. Порядок файлів: JS `resolveTargetFiles` сортує `localeCompare`,
//    host-збірка батчу — байтово (та сама мікро-розбіжність 4 секції
//    «Батч 5», [`locale_compare_approx`]) — для реалістичних шляхів
//    порядок збігається.
// 3. Go-стиль `%q` (`sprintf` rego) проти Rust `{:?}`: для ASCII-діапазонів
//    версій (`"^10.0.0"`) — байт-у-байт той самий результат.

/// Ключ контрибуції `test/storybook-vitest-config` (батч 6).
const CONCERN_STORYBOOK_VITEST_CONFIG: &str = "test/storybook-vitest-config";

/// Ключ контрибуції `js-bun-db/package_json` (батч 6, rego-порт).
const CONCERN_BUN_DB_PACKAGE_JSON: &str = "js-bun-db/package_json";

/// Ключ контрибуції `js-bun-redis/package_json` (батч 6, rego-порт).
const CONCERN_REDIS_PACKAGE_JSON: &str = "js-bun-redis/package_json";

/// Ключ контрибуції `js-mssql/package_json` (батч 6, rego-порт).
const CONCERN_MSSQL_PACKAGE_JSON: &str = "js-mssql/package_json";

/// `reason` діагностик rego-портів — точний відповідник
/// `add('policy-deny', …)` у `evaluatePolicyConcern`
/// (`npm/scripts/lib/lint-surface/policy-lint-adapter.mjs`).
const POLICY_DENY_REASON: &str = "policy-deny";

/// Канонічні назви vitest-конфіга пакета — точний порт `VITEST_CONFIG_NAMES`
/// (`storybook-vitest-config/main.mjs:15`; ширший за [`VITEST_CONFIG_NAMES`]
/// pool-forks-концерну — тут ще `.ts`).
const STORYBOOK_VITEST_CONFIG_NAMES: [&str; 3] =
    ["vitest.config.mjs", "vitest.config.js", "vitest.config.ts"];

/// Скомпільовані маркер-regex-и storybook-запису `test.projects` — точні
/// порти module-scope констант `storybook-vitest-config/main.mjs`
/// (`UNIT_NAME_RE`…`VITE_PLUGIN_PAGES_RE`); `OnceLock` — компілюються раз на
/// процес (той самий мотив, що [`extract_vue_script_blocks`]).
struct VitestConfigMarkerRes {
    unit_name: regex::Regex,
    storybook_name: regex::Regex,
    chromium: regex::Regex,
    browser_key: regex::Regex,
    stories: regex::Regex,
    storybook_test_config_dir: regex::Regex,
    provider_factory: regex::Regex,
    quasar_plugin: regex::Regex,
    auto_import_plugin: regex::Regex,
    vite_plugin_pages: regex::Regex,
}

fn vitest_config_marker_res() -> &'static VitestConfigMarkerRes {
    static RES: std::sync::OnceLock<VitestConfigMarkerRes> = std::sync::OnceLock::new();
    RES.get_or_init(|| VitestConfigMarkerRes {
        unit_name: regex::Regex::new(r#"name\s*:\s*['"]unit['"]"#).expect("UNIT_NAME_RE валідний"),
        storybook_name: regex::Regex::new(r#"name\s*:\s*['"]storybook['"]"#)
            .expect("STORYBOOK_NAME_RE валідний"),
        chromium: regex::Regex::new("chromium").expect("CHROMIUM_RE валідний"),
        browser_key: regex::Regex::new(r"\bbrowser\s*:").expect("BROWSER_KEY_RE валідний"),
        stories: regex::Regex::new("(?i)stories").expect("STORIES_RE валідний"),
        storybook_test_config_dir: regex::Regex::new(r"storybookTest\([^)]*configDir")
            .expect("STORYBOOK_TEST_CONFIG_DIR_RE валідний"),
        provider_factory: regex::Regex::new(r"provider\s*:\s*playwright\s*\(")
            .expect("PROVIDER_FACTORY_RE валідний"),
        quasar_plugin: regex::Regex::new(r"quasar\s*\(").expect("QUASAR_PLUGIN_RE валідний"),
        auto_import_plugin: regex::Regex::new(r"AutoImport\s*\(")
            .expect("AUTO_IMPORT_PLUGIN_RE валідний"),
        vite_plugin_pages: regex::Regex::new(r"\bPages\s*\(")
            .expect("VITE_PLUGIN_PAGES_RE валідний"),
    })
}

/// Стан `test.projects` знайденого test-блоку — розгалуження
/// `checkVitestConfigContent` після `findTestObject`.
enum VitestProjectsState {
    /// `findProperty(testObj, 'projects')` → null.
    Missing,
    /// `projects` є, але значення — не `ArrayExpression` (spread/змінна).
    NotArray,
    /// Статичний масив: чи є запис `unit` і текстовий зріз запису
    /// `storybook` (останнього, як у JS-циклі `classifyProjects`).
    Classified {
        has_unit: bool,
        storybook_slice: Option<String>,
    },
}

/// Результат AST-аналізу vitest-конфіга — гілки `checkVitestConfigContent`.
enum VitestConfigAnalysis {
    /// `parsed.errors?.length` → «має syntax error».
    SyntaxError,
    /// `findTestObject` → null — test-блок не знайдено.
    NoTestBlock,
    /// test-блок знайдено — стан його `projects`.
    Projects(VitestProjectsState),
}

/// Перша non-computed property `name` обʼєкта — точний порт `findProperty`
/// (`storybook-vitest-config/main.mjs`): матчить `Identifier`-ключ за
/// `name` АБО `StringLiteral`-ключ за `value` (числові/computed ключі —
/// повз, як і в JS-предикаті).
fn find_object_property<'b, 'a>(
    obj: &'b ObjectExpression<'a>,
    name: &str,
) -> Option<&'b Expression<'a>> {
    for kind in &obj.properties {
        let ObjectPropertyKind::ObjectProperty(prop) = kind else {
            continue;
        };
        if prop.computed {
            continue;
        }
        let key_matches = match &prop.key {
            PropertyKey::StaticIdentifier(ident) => ident.name == name,
            PropertyKey::StringLiteral(lit) => lit.value == name,
            _ => false,
        };
        if key_matches {
            return Some(&prop.value);
        }
    }
    None
}

/// Точний порт `classifyProjects` (`storybook-vitest-config/main.mjs`):
/// обхід елементів `test.projects`, лише `ObjectExpression`-елементи, зріз
/// джерела за `Span` (байтовий — доккомент секції).
fn classify_vitest_projects(src: &str, arr: &oxc_ast::ast::ArrayExpression) -> VitestProjectsState {
    let res = vitest_config_marker_res();
    let mut has_unit = false;
    let mut storybook_slice: Option<String> = None;
    for element in &arr.elements {
        let ArrayExpressionElement::ObjectExpression(obj) = element else {
            continue;
        };
        let slice = &src[obj.span.start as usize..obj.span.end as usize];
        if res.unit_name.is_match(slice) {
            has_unit = true;
        }
        if res.storybook_name.is_match(slice) {
            storybook_slice = Some(slice.to_string());
        }
    }
    VitestProjectsState::Classified {
        has_unit,
        storybook_slice,
    }
}

/// Visitor DFS pre-order пошуку першого `ObjectExpression` із property
/// `test`, чиє значення — теж `ObjectExpression` — точний порт
/// `findTestObjectIn` (`storybook-vitest-config/main.mjs`): вузол
/// перевіряється ДО дітей, після першого збігу обхід зупиняється (guard
/// `self.result.is_none()`), а аналіз `projects` виконується одразу в
/// callback-у (visitor не може зберегти позичений AST-вузол — lifetime
/// обмежений викликом).
struct FindTestObjectVisitor<'src> {
    src: &'src str,
    result: Option<VitestProjectsState>,
}

impl<'a> Visit<'a> for FindTestObjectVisitor<'_> {
    fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
        if self.result.is_some() {
            return;
        }
        if let Some(Expression::ObjectExpression(test_obj)) = find_object_property(it, "test") {
            self.result = Some(match find_object_property(test_obj, "projects") {
                None => VitestProjectsState::Missing,
                Some(Expression::ArrayExpression(arr)) => classify_vitest_projects(self.src, arr),
                Some(_) => VitestProjectsState::NotArray,
            });
            return;
        }
        walk_object_expression(self, it);
    }
}

/// AST-аналіз vitest-конфіга — порт звʼязки `parseModule`, `findTestObject`,
/// `findProperty`, `classifyProjects`: мова за розширенням (`.ts` → ts,
/// інакше module-JS — дзеркало `lang = ext === '.ts' ? 'ts' : 'js'` із
/// `sourceType: 'module'`), файл із parse-помилками → syntax error гілка
/// (структурний `oxc_parser::Parser::parse` не кидає — окрема JS-гілка
/// «не парситься (…)» недосяжна тут, точний порт решти).
fn analyze_vitest_config(config_name: &str, content: &str) -> VitestConfigAnalysis {
    let allocator = Allocator::default();
    let source_type = if config_name.ends_with(".ts") {
        SourceType::ts()
    } else {
        SourceType::mjs()
    };
    let ret = Parser::new(&allocator, content, source_type).parse();
    if ret.panicked || !ret.diagnostics.is_empty() {
        return VitestConfigAnalysis::SyntaxError;
    }
    let mut visitor = FindTestObjectVisitor {
        src: content,
        result: None,
    };
    visitor.visit_program(&ret.program);
    match visitor.result {
        Some(state) => VitestConfigAnalysis::Projects(state),
        None => VitestConfigAnalysis::NoTestBlock,
    }
}

/// Точний порт `collectStorybookMarkerHints`
/// (`storybook-vitest-config/main.mjs`): спільні маркери обох типів пакета
/// плюс app-специфічні (хвиля 2a) — порядок підказок фіксований, як у JS.
fn collect_storybook_marker_hints(storybook_slice: &str, kind: ScopePkgKind) -> Vec<String> {
    let res = vitest_config_marker_res();
    let mut hints: Vec<String> = Vec::new();
    if !res.chromium.is_match(storybook_slice) {
        hints.push("chromium-інстанс".to_string());
    }
    if !res.browser_key.is_match(storybook_slice) {
        hints.push("browser-mode".to_string());
    }
    // `hasStoriesMarker`: явний stories-glob АБО `storybookTest({ configDir })`.
    if !res.stories.is_match(storybook_slice)
        && !res.storybook_test_config_dir.is_match(storybook_slice)
    {
        hints.push("stories-джерело (include або storybookTest({ configDir }))".to_string());
    }
    if !res.provider_factory.is_match(storybook_slice) {
        hints.push(
            "provider-factory (vitest v4: import { playwright } from '@vitest/browser-playwright')"
                .to_string(),
        );
    }
    if kind == ScopePkgKind::App {
        if !res.quasar_plugin.is_match(storybook_slice) {
            hints.push("quasar()-плагін (SCSS sassVariables для сторінок)".to_string());
        }
        if !res.auto_import_plugin.is_match(storybook_slice) {
            hints.push("AutoImport()-плагін (auto-import globals сторінок)".to_string());
        }
        if !res.vite_plugin_pages.is_match(storybook_slice) {
            hints.push("Pages()-плагін (обробник <route>-блоку)".to_string());
        }
    }
    hints
}

/// `InScopePackage.type` у рядковій формі `data.type` (`'library'|'app'`).
fn scope_pkg_kind_str(kind: ScopePkgKind) -> &'static str {
    match kind {
        ScopePkgKind::Library => "library",
        ScopePkgKind::App => "app",
    }
}

/// Абсолютний шлях файлу пакета — дзеркало `join(absDir, name)` JS-канону
/// (`absDir = rootDir === '.' ? cwd : join(cwd, rootDir)`); без
/// `repo-root@1` (хост-контекст відсутній) — repo-relative деградація
/// (доккомент секції).
fn abs_from_repo_root(repo_root: Option<&str>, rel: &str) -> String {
    match repo_root {
        Some(root) => format!("{root}/{rel}"),
        None => rel.to_string(),
    }
}

/// Контекст пакета для перевірок vitest-конфіга — порт `buildPackageCtx`
/// (`storybook-vitest-config/main.mjs`): усе, що обидві перевірки
/// (`checkVitestConfigContent` і `checkStrykerConfigPresence`) читають з
/// одного місця.
struct VitestPkgCtx<'p> {
    /// `entry.rootDir` — posix-relative корінь пакета (`.` для кореня репо).
    root_dir: &'p str,
    /// Людський підпис пакета в повідомленнях ([`pkg_label`]).
    label: String,
    /// Префікс relative-шляхів повідомлень ([`pkg_rel_prefix`]).
    rel_prefix: String,
    /// Префікс шляхів у батчі ([`pkg_walk_prefix`]).
    walk_prefix: String,
    /// `entry.type` рядком (`'library'|'app'`).
    kind_str: &'static str,
    /// Тип пакета — потрібен app-гілці маркер-підказок.
    kind: ScopePkgKind,
    /// Назва знайденого конфіга (`vitest.config.mjs|js|ts`).
    config_name: &'static str,
    /// `${relPrefix}${basename(vitestConfigPath)}` — поле `file` діагностик.
    rel_vitest_file: String,
    /// `data.vitestConfigPath` — абсолютний за наявності слота `repo-root@1`
    /// (доккомент секції «Батч 6»).
    vitest_config_path: String,
}

/// Точний порт `checkPackage` (`storybook-vitest-config/main.mjs`): немає
/// конфіга — одна діагностика й вихід; є — ЗАВЖДИ обидві перевірки поспіль
/// (early-return-и живуть усередині [`check_vitest_config_content`], тож
/// stryker-перевірка виконується навіть після них — саме так, як у JS).
fn check_package_vitest_config(
    files: &[SourceFile],
    entry: &ScopePkg,
    repo_root: Option<&str>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let root_dir = entry.root_dir.as_str();
    let label = pkg_label(root_dir);
    let rel_prefix = pkg_rel_prefix(root_dir);
    let walk_prefix = pkg_walk_prefix(root_dir);
    let kind_str = scope_pkg_kind_str(entry.kind);

    // `resolveVitestConfigPath`: перший наявний за пріоритетом NAMES.
    let found = STORYBOOK_VITEST_CONFIG_NAMES
        .iter()
        .find_map(|name| batch_file(files, &format!("{walk_prefix}{name}")).map(|f| (*name, f)));
    let Some((config_name, config_file)) = found else {
        diagnostics.push(Diagnostic {
            reason: "vitest-config-missing".to_string(),
            message: format!(
                "[{label}] відсутній vitest.config.{{mjs,js,ts}} — канонічні projects \
                 unit+storybook (vitest-config.mdc): npx @7n/rules fix storybook"
            ),
            file: Some(format!("{rel_prefix}vitest.config.mjs")),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "rootDir": root_dir, "type": kind_str }).to_string()),
        });
        return;
    };

    let ctx = VitestPkgCtx {
        root_dir,
        label,
        rel_vitest_file: format!("{rel_prefix}{config_name}"),
        vitest_config_path: abs_from_repo_root(repo_root, &format!("{rel_prefix}{config_name}")),
        rel_prefix,
        walk_prefix,
        kind_str,
        kind: entry.kind,
        config_name,
    };

    check_vitest_config_content(&ctx, &config_file.content, diagnostics);
    check_stryker_config_presence(&ctx, files, diagnostics);
}

/// Точний порт `checkVitestConfigContent`
/// (`storybook-vitest-config/main.mjs`) — усі early-return-и локальні для
/// цієї перевірки (stryker-перевірка кличеться викликачем незалежно).
fn check_vitest_config_content(
    ctx: &VitestPkgCtx,
    content: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let VitestPkgCtx {
        root_dir,
        label,
        kind_str,
        kind,
        config_name,
        rel_vitest_file,
        vitest_config_path,
        ..
    } = ctx;
    let data_full = serde_json::json!({
        "rootDir": root_dir,
        "type": kind_str,
        "vitestConfigPath": vitest_config_path,
    })
    .to_string();

    match analyze_vitest_config(config_name, content) {
        VitestConfigAnalysis::SyntaxError => {
            diagnostics.push(Diagnostic {
                reason: "vitest-config-unresolvable".to_string(),
                message: format!(
                    "[{label}] {rel_vitest_file} має syntax error — перевір вручну \
                     (vitest-config.mdc)"
                ),
                file: Some(rel_vitest_file.clone()),
                severity: Severity::Error,
                data: None,
            });
        }
        VitestConfigAnalysis::NoTestBlock => {
            diagnostics.push(Diagnostic {
                reason: "vitest-config-unresolvable".to_string(),
                message: format!(
                    "[{label}] {rel_vitest_file}: не вдалось знайти test-блок (defineConfig({{ \
                     test: {{...}} }})) — додай unit/storybook-projects вручну за template/ \
                     (vitest-config.mdc)"
                ),
                file: Some(rel_vitest_file.clone()),
                severity: Severity::Error,
                data: None,
            });
        }
        VitestConfigAnalysis::Projects(VitestProjectsState::Missing) => {
            for which in ["unit", "storybook"] {
                let reason = if which == "unit" {
                    "unit-project-missing"
                } else {
                    "storybook-project-missing"
                };
                diagnostics.push(Diagnostic {
                    reason: reason.to_string(),
                    message: format!(
                        "[{label}] {rel_vitest_file}: бракує test.projects ({which}) — npx \
                         @7n/rules fix storybook (vitest-config.mdc)"
                    ),
                    file: Some(rel_vitest_file.clone()),
                    severity: Severity::Error,
                    data: Some(data_full.clone()),
                });
            }
        }
        VitestConfigAnalysis::Projects(VitestProjectsState::NotArray) => {
            diagnostics.push(Diagnostic {
                reason: "projects-dynamic".to_string(),
                message: format!(
                    "[{label}] {rel_vitest_file}: test.projects — не статичний масив \
                     (spread/змінна) — додай unit/storybook-projects вручну (vitest-config.mdc)"
                ),
                file: Some(rel_vitest_file.clone()),
                severity: Severity::Error,
                data: None,
            });
        }
        VitestConfigAnalysis::Projects(VitestProjectsState::Classified {
            has_unit,
            storybook_slice,
        }) => {
            if !has_unit {
                diagnostics.push(Diagnostic {
                    reason: "unit-project-missing".to_string(),
                    message: format!(
                        "[{label}] {rel_vitest_file}: test.projects без 'unit' — npx @7n/rules \
                         fix storybook (vitest-config.mdc)"
                    ),
                    file: Some(rel_vitest_file.clone()),
                    severity: Severity::Error,
                    data: Some(data_full.clone()),
                });
            }
            match storybook_slice {
                Some(slice) => {
                    let hints = collect_storybook_marker_hints(&slice, *kind);
                    if !hints.is_empty() {
                        diagnostics.push(Diagnostic {
                            reason: "storybook-project-marker-missing".to_string(),
                            message: format!(
                                "[{label}] {rel_vitest_file}: storybook-project без канонічних \
                                 маркерів — бракує: {} (vitest-config.mdc)",
                                hints.join(", ")
                            ),
                            file: Some(rel_vitest_file.clone()),
                            severity: Severity::Error,
                            data: Some(
                                serde_json::json!({ "rootDir": root_dir, "type": kind_str })
                                    .to_string(),
                            ),
                        });
                    }
                }
                None => {
                    diagnostics.push(Diagnostic {
                        reason: "storybook-project-missing".to_string(),
                        message: format!(
                            "[{label}] {rel_vitest_file}: test.projects без 'storybook' — npx \
                             @7n/rules fix storybook (vitest-config.mdc)"
                        ),
                        file: Some(rel_vitest_file.clone()),
                        severity: Severity::Error,
                        data: Some(data_full.clone()),
                    });
                }
            }
        }
    }
}

/// Точний порт `checkStrykerConfigPresence`
/// (`storybook-vitest-config/main.mjs`): ізольований
/// `vitest.stryker.config.*` поруч із конфігом (той самий каталог і
/// розширення — дзеркало `strykerConfigPathFor`).
fn check_stryker_config_presence(
    ctx: &VitestPkgCtx,
    files: &[SourceFile],
    diagnostics: &mut Vec<Diagnostic>,
) {
    let VitestPkgCtx {
        root_dir,
        label,
        rel_prefix,
        walk_prefix,
        config_name,
        vitest_config_path,
        ..
    } = ctx;
    let extension = config_name
        .rsplit_once('.')
        .map(|(_, ext)| ext)
        .unwrap_or_default();
    let stryker_name = format!("vitest.stryker.config.{extension}");
    if batch_file(files, &format!("{walk_prefix}{stryker_name}")).is_none() {
        let rel_stryker_file = format!("{rel_prefix}{stryker_name}");
        diagnostics.push(Diagnostic {
            reason: "stryker-config-missing".to_string(),
            message: format!(
                "[{label}] відсутній ізольований {rel_stryker_file} — \
                 @stryker-mutator/vitest-runner крашиться на browser-mode projects: npx @7n/rules \
                 fix storybook (vitest-config.mdc)"
            ),
            file: Some(rel_stryker_file),
            severity: Severity::Error,
            data: Some(
                serde_json::json!({ "rootDir": root_dir, "vitestConfigPath": vitest_config_path })
                    .to_string(),
            ),
        });
    }
}

/// Точний порт `lint()` `test/storybook-vitest-config`
/// (`storybook-vitest-config/main.mjs`) — WHOLE-BATCH поверх спільної
/// scope-детекції батчу 5; `repo_root` — значення слота `repo-root@1`
/// (доккомент секції «Батч 6»).
fn detect_storybook_vitest_config(
    files: &[SourceFile],
    repo_root: Option<&str>,
) -> Vec<Diagnostic> {
    let pkgs = collect_in_scope_vue_packages(files);
    if pkgs.is_empty() {
        return Vec::new();
    }
    let mut diagnostics = Vec::new();
    for entry in &pkgs {
        check_package_vitest_config(files, entry, repo_root, &mut diagnostics);
    }
    diagnostics
}

/// Deny-таблиця `js-bun-db/package_json` — статичне дзеркало
/// `plugins/lang-js/rules/js-bun-db/package_json/template/package.json.deny.json`
/// (canonical лишається JSON-шаблон; дзеркальний тест — parity-фікстури
/// `wasm-plugin-parity.test.mjs` проти живого conftest-прогону).
const BUN_DB_PACKAGE_JSON_DENY: [(&str, &str); 2] = [
    (
        "pg-format",
        "заміни на Bun native SQL — без ручного форматування (js-bun-db.mdc)",
    ),
    ("mysql2", "заміни на Bun native SQL (js-bun-db.mdc)"),
];

/// Deny-таблиця `js-bun-redis/package_json` — статичне дзеркало
/// `plugins/lang-js/rules/js-bun-redis/package_json/template/package.json.deny.json`.
const REDIS_PACKAGE_JSON_DENY: [(&str, &str); 8] = [
    ("ioredis", "заміни на Bun native Redis (js-bun-redis.mdc)"),
    (
        "node-redis",
        "заміни на Bun native Redis (js-bun-redis.mdc)",
    ),
    ("redis", "заміни на Bun native Redis (js-bun-redis.mdc)"),
    (
        "@redis/client",
        "заміни на Bun native Redis (js-bun-redis.mdc)",
    ),
    (
        "@redis/json",
        "заміни на Bun native Redis (js-bun-redis.mdc)",
    ),
    (
        "@redis/search",
        "заміни на Bun native Redis (js-bun-redis.mdc)",
    ),
    (
        "@redis/time-series",
        "заміни на Bun native Redis (js-bun-redis.mdc)",
    ),
    (
        "@redis/bloom",
        "заміни на Bun native Redis (js-bun-redis.mdc)",
    ),
];

/// Точний порт deny-правила `package_json.rego` js-bun-db/js-bun-redis:
/// `some pkg, reason in data.template.deny.dependencies; pkg in
/// object.keys(input.dependencies)` → `sprintf("dependencies.%s — %s")`.
/// Повідомлення одного файлу сортуються лексикографічно — OPA-set
/// детермінований і сортований (звірено живим conftest-прогоном, доккомент
/// секції «Батч 6»).
fn detect_package_json_deny(files: &[SourceFile], deny: &[(&str, &str)]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for file in files {
        if file.path != "package.json" && !file.path.ends_with("/package.json") {
            continue;
        }
        // Невалідний JSON — задокументована розбіжність 1 секції «Батч 6».
        let Some(pkg) = parse_json_tolerant(&file.content) else {
            continue;
        };
        let Some(deps) = pkg.get("dependencies").and_then(|d| d.as_object()) else {
            continue;
        };
        let mut messages: Vec<String> = deny
            .iter()
            .filter(|(name, _)| deps.contains_key(*name))
            .map(|(name, reason)| format!("dependencies.{name} — {reason}"))
            .collect();
        messages.sort();
        for message in messages {
            diagnostics.push(Diagnostic {
                reason: POLICY_DENY_REASON.to_string(),
                message,
                file: Some(file.path.clone()),
                severity: Severity::Error,
                data: None,
            });
        }
    }
    diagnostics
}

/// Точний порт `mssql_version_meets_min` (`js-mssql/package_json/
/// package_json.rego`): `workspace:`-префікс (після trim) — OK; інакше
/// диапазон розбивається на числові токени (`regex.split(\D+)` → непорожні
/// → числа) і мінімум `>= 12.5.0` звіряється triple-compare-ом (менше трьох
/// токенів — НЕ проходить, як у rego, де жодне з тіл не виводиться).
fn mssql_version_meets_min(range: &str) -> bool {
    if range.trim().starts_with("workspace:") {
        return true;
    }
    let parts: Vec<u64> = range
        .split(|c: char| !c.is_ascii_digit())
        .filter(|token| !token.is_empty())
        .map(|token| token.parse::<u64>().unwrap_or(u64::MAX))
        .collect();
    if parts.len() < 3 {
        return false;
    }
    if parts[0] != 12 {
        return parts[0] > 12;
    }
    // `parts[1] == 5 && parts[2] >= 0` — третя умова rego завжди істинна
    // для невід'ємних токенів, лишається порівняння мінора.
    parts[1] >= 5
}

/// Точний порт deny-правила `js-mssql/package_json/package_json.rego`:
/// `dependencies.mssql` присутній і не проходить
/// [`mssql_version_meets_min`] → повідомлення зі `sprintf`-`%q` формою
/// діапазону (Rust `{:?}` — байт-у-байт для ASCII-діапазонів, розбіжність 3
/// секції «Батч 6»).
fn detect_mssql_package_json(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for file in files {
        if file.path != "package.json" && !file.path.ends_with("/package.json") {
            continue;
        }
        let Some(pkg) = parse_json_tolerant(&file.content) else {
            continue;
        };
        let Some(range) = pkg
            .get("dependencies")
            .and_then(|d| d.get("mssql"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        if range.is_empty() || mssql_version_meets_min(range) {
            continue;
        }
        diagnostics.push(Diagnostic {
            reason: POLICY_DENY_REASON.to_string(),
            message: format!(
                "dependencies.mssql має бути >= 12.5.0 (зараз {range:?}) (js-mssql.mdc)"
            ),
            file: Some(file.path.clone()),
            severity: Severity::Error,
            data: None,
        });
    }
    diagnostics
}

// =====================================================================
// Батч 7 (§3.5.5): кластер `npm-module/*` (метадані-перевірки, чотири
// концерни) плюс AST-концерн `js/dep-policy`.
//
// # Спільний прийом: `readdirSync` → реконструкція з батча
//
// Усі чотири `npm-module`-концерни JS-канону ходять диском самі
// (`readdirSync(npm/rules)`, `readdir(npm/skills/<id>/js)`, `walkDir(npm/…)`),
// а wasm-плагін бачить лише host-побудований batch. Реконструкція точна, бо
// каталог = префікс шляху: [`batch_child_dirs`] віддає імена піддиректорій
// першого рівня, [`batch_dir_entries`] — файли БЕЗПОСЕРЕДНЬО в каталозі.
// Порядок обходу: `readdirSync` на APFS/ext4 віддає імена вже
// відсортованими (перевірено живою фікстурою на цій машині), host-батч теж
// байтово-лексикографічний (`rules_core::scan::walk_dir` сортує явно), тож
// порядок діагностик збігається. `BTreeSet` тут — саме цей інваріант,
// а не «зручний контейнер».
//
// Глоби контрибуцій СВІДОМО вужчі за `concern.json.lint.glob` там, де це
// точно (не наближено) покриває те, що JS-канон реально читає з диска:
// `npm-module/rule_meta` — `npm/rules/*/*` (JS читає ЛИШЕ прямих дітей
// каталогу правила: `main.json`/`main.mdc`/`auto.md`), `skill_meta` —
// `npm/skills/*/*`, `header_doc_pointer` — чотири `*/js/*`-глоби замість
// `**/*` цілого репо. Мотив той самий, що ширші глоби батчу 5, лише в
// протилежний бік: batch має містити РІВНО те, що канон читає — ні менше
// (тоді розбіжність), ні більше (тоді кожен lint-прогін тягне через ABI
// мегабайти дарма). `npm-module/package_structure` — єдиний, кому потрібен
// увесь `npm/**` (він реально сканує tarball-простір `files`).
//
// # Задокументовані розбіжності (фікстури їх не торкаються)
//
// 1. **Невалідний JSON у `npm/package.json`**: JS-канон
//    (`checkNoTestsInPublishedFiles`/`checkNpmPackageJson`) кличе `JSON.parse`
//    БЕЗ `try/catch` — виняток вилітає з `lint()` і стає `DetectorError`
//    (exit 2, весь концерн падає); wasm-порт пропускає перевірку
//    ([`parse_json_tolerant`] → `None`). Той самий skip-not-crash дух, що
//    розбіжність 1 секції «Батч 6».
// 2. **Порожній каталог**: git не трекає порожні каталоги, а host-батч —
//    список ФАЙЛІВ, тож `existsSync(<порожній каталог>)` JS-канону = `true`,
//    а [`batch_dir_exists`] = `false` (та сама мікро-розбіжність 5 секції
//    «Батч 5»). Стосується `.github/workflows/` без жодного workflow і
//    каталогу правила взагалі без прямих файлів.
// 3. **`.cursorignore`**: `js/dep-policy` і `package_structure` JS-канону
//    звужують `walkDir` через `loadCursorIgnorePaths`, host-збірка батчу —
//    ні (`build_full_scope_files` кличе `walk_dir(cwd, &[])`). Успадкована
//    розбіжність усіх full-scope портів починаючи з батчу 4, не нова.
// 4. **Сортування рядків**: JS `Array.prototype.sort` — по UTF-16 code
//    units, `BTreeSet<String>` — байтово (UTF-8). Для ASCII-шляхів (усе,
//    що реально лежить у `npm/`) порядок тотожний.
// 5. **Невалідний glob у негативному патерні `files`**: `new RegExp` JS-боку
//    кинув би `SyntaxError` (весь концерн — exit 2), [`glob_to_regex`]
//    віддає `None` і патерн просто нічого не виключає.
// 6. **Синтаксично БИТИЙ JS-файл** (стосується `js/dep-policy`, а через
//    спільний [`extract_import_sources`] — і `js/utils_imports`):
//    `extractImportSpecifiers` НЕ звіряє `result.errors`, тож обидві
//    сторони читають частковий AST, але глибина error-recovery в
//    napi-`oxc-parser` і в crate-`oxc_parser` різна — на файлі
//    `import x from 'ua-parser-js'` + `const = = =` JS ще бачить імпорт, а
//    guest уже ні (живий прогін, батч 7). Виміряно й задокументовано, а не
//    «підігнано»: підганяти тут нема за що — це внутрішня поведінка
//    відновлення парсера, не наша логіка.
//
// # `js/dep-policy` — найчистіший порт цього батчу
//
// `reporter.pass()` у `createViolationReporter` — no-op, тож `files.length`
// з pass-повідомлення JS-канону НЕ спостережуване ззовні: єдиний вихід
// концерну — `fail`-и по забороненим specifier-ам. Тому питання «чи батч
// хоста збігається з `walkDir` до одного файлу» тут взагалі не виникає —
// на відміну від `js-bun-redis/imports` батчу 4. Сам скан — той самий
// [`extract_import_sources`] (`ImportDeclaration` + `import()` + `require()`),
// що `js/utils_imports`.

/// Ключ контрибуції `npm-module/rule_meta` (батч 7).
const CONCERN_RULE_META: &str = "npm-module/rule_meta";

/// Ключ контрибуції `npm-module/skill_meta` (батч 7).
const CONCERN_SKILL_META: &str = "npm-module/skill_meta";

/// Ключ контрибуції `npm-module/header_doc_pointer` (батч 7).
const CONCERN_HEADER_DOC_POINTER: &str = "npm-module/header_doc_pointer";

/// Ключ контрибуції `npm-module/package_structure` (батч 7).
const CONCERN_PACKAGE_STRUCTURE: &str = "npm-module/package_structure";

/// Ключ контрибуції `js/dep-policy` (батч 7).
const CONCERN_DEP_POLICY: &str = "js/dep-policy";

/// `reason` діагностик `npm-module/rule_meta` — усі `fail()` у `main.mjs`
/// без другого аргументу, тож дефолт `ctx.concernId` = bare `"rule_meta"`
/// (той самий мотив, що [`UTILS_IMPORTS_VIOLATION_REASON`]).
const RULE_META_REASON: &str = "rule_meta";

/// `reason` діагностик `npm-module/skill_meta` — той самий мотив.
const SKILL_META_REASON: &str = "skill_meta";

/// `reason` діагностик `npm-module/header_doc_pointer` — той самий мотив.
const HEADER_DOC_POINTER_REASON: &str = "header_doc_pointer";

/// `reason` діагностик `npm-module/package_structure` — той самий мотив.
const PACKAGE_STRUCTURE_REASON: &str = "package_structure";

/// `reason` діагностик `js/dep-policy` — той самий мотив (bare `concernId`,
/// без `js/`-префікса).
const DEP_POLICY_REASON: &str = "dep-policy";

/// Літерал безумовної активації — точний порт `RULE_ALWAYS`/`SKILL_ALWAYS`
/// (`npm/scripts/lib/rule-meta.mjs`, `npm/scripts/lib/skill-meta.mjs`).
const META_ALWAYS: &str = "завжди";

/// Імена предикатів реєстру `RULE_PREDICATES`
/// (`npm/scripts/lib/rule-predicates.mjs`) — `rule_meta` перевіряє САМЕ
/// наявність ключа (`Object.hasOwn`), самі реалізації для діагностики не
/// потрібні. Дрейф (новий предикат у JS без оновлення цього списку) ловить
/// parity-тест `предикати RULE_PREDICATES` — він ітерує реальний
/// `Object.keys(RULE_PREDICATES)` і ганяє кожен через ОБИДВІ реалізації.
const RULE_PREDICATE_NAMES: [&str; 6] = [
    "repoUrlMarker",
    "depInAnyPackageJson",
    "gqlTaggedTemplate",
    "hasuraConfigMarker",
    "jsBunDbSignal",
    "nestedPackageWithoutVite",
];

/// Допустимі тири скіла — точний порт `SKILL_TIERS`
/// (`npm/scripts/lib/skill-meta.mjs`).
const SKILL_TIERS: [&str; 3] = ["min", "avg", "max"];

/// Каталоги, що за конвенцією тримають тести/фікстури — точний порт
/// `TEST_DIR_NAMES` (`package_structure/main.mjs:26`).
const PUBLISHED_TEST_DIR_NAMES: [&str; 6] = [
    "tests",
    "__tests__",
    "fixtures",
    "__fixtures__",
    "spec",
    "test",
];

/// Модулі, імпорт яких видає test-файл — точний порт
/// `TEST_FRAMEWORK_MODULES` (`package_structure/main.mjs:41-51`).
const TEST_FRAMEWORK_MODULES: [&str; 9] = [
    "bun:test",
    "node:test",
    "vitest",
    "@jest/globals",
    "jest",
    "mocha",
    "ava",
    "tap",
    "tape",
];

/// Точний порт `TEST_FILE_PATTERNS[0]`
/// (`/^.+\.(test|spec)\.[cm]?[jt]sx?$/iu`, `package_structure/main.mjs:35`).
const PUBLISHED_TEST_FILE_PATTERN: &str = r"(?i)^.+\.(test|spec)\.[cm]?[jt]sx?$";

/// Точний порт `JS_LIKE_EXT_RE` (`/\.[cm]?[jt]sx?$/iu`,
/// `package_structure/main.mjs:38`).
const JS_LIKE_EXT_PATTERN: &str = r"(?i)\.[cm]?[jt]sx?$";

/// Точний порт `DEPRECATED_CHECK_CHANGELOG_RE` (`/\bcheck\s+changelog\b/u`,
/// `package_structure/main.mjs:127`).
const DEPRECATED_CHECK_CHANGELOG_PATTERN: &str = r"\bcheck\s+changelog\b";

/// Перший JSDoc-блок (не-жадібний) — точний порт `MODULE_JSDOC_RE`
/// (`/\/\*\*[\s\S]*?\*\//`, `header_doc_pointer/main.mjs:9`); `[\s\S]` →
/// `(?s).` (у Rust `regex` `.` за замовчуванням НЕ матчить `\n`).
const MODULE_JSDOC_PATTERN: &str = r"(?s)/\*\*.*?\*/";

/// `import`/`export` на початку рядка — точний порт `CODE_START_RE`
/// (`/^(?:import|export)\b/m`, `header_doc_pointer/main.mjs:15`).
const CODE_START_PATTERN: &str = r"(?m)^(?:import|export)\b";

/// Провідний `*`-відступ рядка JSDoc — точний порт `STAR_INDENT_RE`
/// (`/^\s*\*\s?/`, `header_doc_pointer/main.mjs:18`).
const STAR_INDENT_PATTERN: &str = r"^\s*\*\s?";

/// Спецсимволи RegExp, що в glob лишаються літералами — точний порт
/// `REGEX_SPECIAL_IN_GLOB` (`npm/scripts/lib/glob-to-regex.mjs:9`).
const GLOB_REGEX_SPECIAL: [char; 12] =
    ['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'];

/// Заборонені import-specifier-и та підказка про заміну — точний порт
/// `BANNED_SPECIFIERS` (`js/dep-policy/main.mjs:23-29`), порядок як у Map
/// (для лукапу неважливий, лишений 1:1 для звірки очима).
const DEP_POLICY_BANNED_SPECIFIERS: [(&str, &str); 2] = [
    (
        "@nitra/as-integrations-fastify",
        "використовуй @as-integrations/fastify",
    ),
    (
        "ua-parser-js",
        "замінити на bowser (MIT, ~6 KB) — npm i bowser. ua-parser-js v2 змінив \
         ліцензію на AGPL-3.0, несумісну з комерційним використанням",
    ),
];

// ---------------------------------------------------------------------
// Реконструкція каталогів із батча

/// Імена піддиректорій ПЕРШОГО рівня під `base` — batch-відповідник
/// `readdirSync(base, { withFileTypes: true })` з фільтрами
/// `entry.isDirectory()` (запис має бути КАТАЛОГОМ: у батчі це означає, що
/// під ним лежить хоч один файл) і `!entry.name.startsWith('.')`.
/// `BTreeSet` — байтово-лексикографічний порядок (доккомент секції).
fn batch_child_dirs(files: &[SourceFile], base: &str) -> Vec<String> {
    let prefix = format!("{base}/");
    let mut names: BTreeSet<String> = BTreeSet::new();
    for file in files {
        let Some(rest) = file.path.strip_prefix(&prefix) else {
            continue;
        };
        let mut segments = rest.split('/');
        let Some(name) = segments.next() else {
            continue;
        };
        // Немає наступного сегмента → `rest` — файл ПРЯМО в `base`, не
        // каталог (JS-фільтр `entry.isDirectory()`).
        if segments.next().is_none() || name.is_empty() || name.starts_with('.') {
            continue;
        }
        names.insert(name.to_string());
    }
    names.into_iter().collect()
}

/// Файли БЕЗПОСЕРЕДНЬО в каталозі `dir` (без рекурсії) — batch-відповідник
/// `readdir(dir, { withFileTypes: true })` + `entry.isFile()`.
fn batch_dir_entries<'a>(files: &'a [SourceFile], dir: &str) -> Vec<&'a SourceFile> {
    let prefix = format!("{dir}/");
    let mut out: Vec<&SourceFile> = files
        .iter()
        .filter(|f| {
            f.path
                .strip_prefix(&prefix)
                .is_some_and(|rest| !rest.is_empty() && !rest.contains('/'))
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

// ---------------------------------------------------------------------
// `npm-module/rule_meta` і `npm-module/skill_meta`

/// Чи `String(value).trim()` — порожній рядок. Єдине, що з JS-семантики
/// `String()` у `parseRuleAutoSpec`/`parseSkillAutoSpec` реально впливає на
/// діагностику: самі рядки нікуди не друкуються, важлива лише
/// «непорожність» після trim. `null`→`"null"`, число/булеве/обʼєкт — завжди
/// непорожні; масив із ≥2 елементів завжди дає кому від `join(',')`.
fn js_string_is_blank(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::String(s) => s.trim().is_empty(),
        serde_json::Value::Array(items) => match items.len() {
            0 => true,
            1 => js_array_element_is_blank(&items[0]),
            _ => false,
        },
        _ => false,
    }
}

/// Те саме для ЕЛЕМЕНТА масиву: `Array.prototype.join` перетворює `null` на
/// порожній рядок (на відміну від `String(null)` === `"null"`).
fn js_array_element_is_blank(value: &serde_json::Value) -> bool {
    matches!(value, serde_json::Value::Null) || js_string_is_blank(value)
}

/// Чи `value` — непорожній після `String(...).trim()` масив (спільна гілка
/// `parseRuleAutoSpec`/`parseSkillAutoSpec`: `["rule", …]`).
fn auto_spec_array_is_valid(items: &[serde_json::Value]) -> bool {
    items.iter().any(|item| !js_string_is_blank(item))
}

/// Розпізнаний `main.json.auto` правила — точний порт `parseRuleAutoSpec`
/// (`npm/scripts/lib/rule-meta.mjs:27-49`). `None` = «формат не розпізнано»
/// (JS `null`), `Some(None)` = розпізнано без предиката, `Some(Some(name))`
/// = `{ predicate }`.
#[allow(clippy::option_option)]
fn parse_rule_auto_spec(value: &serde_json::Value) -> Option<Option<String>> {
    if value.as_str() == Some(META_ALWAYS) {
        return Some(None);
    }
    if let serde_json::Value::Array(items) = value {
        return auto_spec_array_is_valid(items).then_some(None);
    }
    let serde_json::Value::Object(obj) = value else {
        return None;
    };
    if let Some(raw) = obj.get("glob") {
        let has_glob = match raw {
            serde_json::Value::Array(items) => items
                .iter()
                .any(|g| g.as_str().is_some_and(|s| !s.is_empty())),
            other => other.as_str().is_some_and(|s| !s.is_empty()),
        };
        return has_glob.then_some(None);
    }
    if let Some(raw) = obj.get("predicate") {
        return match raw.as_str() {
            Some(name) if !name.is_empty() => Some(Some(name.to_string())),
            _ => None,
        };
    }
    None
}

/// Точний порт `parseSkillAutoSpec` (`npm/scripts/lib/skill-meta.mjs:39-49`)
/// — на відміну від правила, ЛИШЕ `"завжди"` або непорожній масив.
fn skill_auto_spec_is_valid(value: &serde_json::Value) -> bool {
    if value.as_str() == Some(META_ALWAYS) {
        return true;
    }
    match value {
        serde_json::Value::Array(items) => auto_spec_array_is_valid(items),
        _ => false,
    }
}

/// Точний порт `readRuleMetaRaw`/`readSkillMetaRaw` (один алгоритм у двох
/// файлах): немає `main.json` / невалідний JSON / не plain-object → `None`.
fn read_meta_raw(
    files: &[SourceFile],
    dir: &str,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let file = batch_file(files, &format!("{dir}/main.json"))?;
    match parse_json_tolerant(&file.content) {
        Some(serde_json::Value::Object(obj)) => Some(obj),
        _ => None,
    }
}

/// Точний порт `checkRule` (`npm-module/rule_meta/main.mjs:70-97`) — pass-и
/// JS-канону no-op (`createViolationReporter`), тож локальний `ruleOk`
/// спостережуваного ефекту не має і сюди не переноситься.
fn check_rule_meta_one(
    files: &[SourceFile],
    id: &str,
    rule_dir: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let mut fail = |message: String| {
        diagnostics.push(Diagnostic {
            reason: RULE_META_REASON.to_string(),
            message,
            file: None,
            severity: Severity::Error,
            data: None,
        });
    };

    if batch_file(files, &format!("{rule_dir}/auto.md")).is_some() {
        fail(format!(
            "rules/{id}: залишковий auto.md — видали (метадані тепер у main.json)"
        ));
    }
    if batch_file(files, &format!("{rule_dir}/main.mdc")).is_none() {
        fail(format!(
            "rules/{id}: відсутній main.mdc — обов'язковий (scripts.mdc)"
        ));
    }

    let Some(raw) = read_meta_raw(files, rule_dir) else {
        fail(format!("rules/{id}: відсутній або невалідний main.json"));
        return;
    };

    if let Some(auto) = raw.get("auto") {
        match parse_rule_auto_spec(auto) {
            None => fail(format!(
                "rules/{id}: main.json.auto нерозпізнане (очікується \"завжди\" / масив / {{glob}} / {{predicate}})"
            )),
            Some(Some(predicate)) if !RULE_PREDICATE_NAMES.contains(&predicate.as_str()) => {
                fail(format!(
                    "rules/{id}: main.json — невідомий predicate \"{predicate}\" (немає в RULE_PREDICATES)"
                ));
            }
            Some(_) => {}
        }
    }
    if raw.contains_key("lint") {
        fail(format!(
            "rules/{id}: main.json.lint скасовано — lint-scope декларується у <concern>/concern.json#lint"
        ));
    }
    if raw.contains_key("llmFix") {
        fail(format!(
            "rules/{id}: main.json.llmFix скасовано — fix-можливість = наявність fix-*.mjs/fix-worker.mjs у концерні"
        ));
    }
}

/// Точний порт `lint()` `npm-module/rule_meta` (`main.mjs:104-119`) —
/// WHOLE-BATCH: немає `npm/rules/` (жодного файлу під ним у батчі) → без
/// діагностик (JS-гілка `pass('npm/rules/ відсутній …')`).
fn detect_rule_meta(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    if !batch_dir_exists(files, "npm/rules") {
        return diagnostics;
    }
    for id in batch_child_dirs(files, "npm/rules") {
        let rule_dir = format!("npm/rules/{id}");
        check_rule_meta_one(files, &id, &rule_dir, &mut diagnostics);
    }
    diagnostics
}

/// Точний порт `checkSkillFields` (`npm-module/skill_meta/main.mjs:15-41`) —
/// порядок перевірок (worktree → auto → requireRoot → конфлікт → tier)
/// дослівний, бо він і задає порядок діагностик.
fn check_skill_meta_fields(
    id: &str,
    raw: &serde_json::Map<String, serde_json::Value>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let mut fail = |message: String| {
        diagnostics.push(Diagnostic {
            reason: SKILL_META_REASON.to_string(),
            message,
            file: None,
            severity: Severity::Error,
            data: None,
        });
    };

    let worktree = raw.get("worktree");
    if !matches!(worktree, Some(serde_json::Value::Bool(_))) {
        fail(format!("skills/{id}: main.json.worktree має бути boolean"));
    }
    if let Some(auto) = raw.get("auto") {
        if !skill_auto_spec_is_valid(auto) {
            fail(format!(
                "skills/{id}: main.json.auto нерозпізнане — очікується \"завжди\" або непорожній масив правил"
            ));
        }
    }
    let require_root = raw.get("requireRoot");
    if let Some(value) = require_root {
        if !value.is_boolean() {
            fail(format!(
                "skills/{id}: main.json.requireRoot має бути boolean"
            ));
        }
    }
    if worktree == Some(&serde_json::Value::Bool(true))
        && require_root == Some(&serde_json::Value::Bool(false))
    {
        fail(format!(
            "skills/{id}: requireRoot:false суперечить worktree:true (worktree вже вимагає кореня — прибери поле)"
        ));
    }
    if let Some(tier) = raw.get("tier") {
        if !tier.as_str().is_some_and(|t| SKILL_TIERS.contains(&t)) {
            let tier_list = SKILL_TIERS
                .iter()
                .map(|t| format!("\"{t}\""))
                .collect::<Vec<_>>()
                .join(" | ");
            fail(format!("skills/{id}: main.json.tier має бути {tier_list}"));
        }
    }
}

/// Точний порт `lint()` `npm-module/skill_meta` (`main.mjs:50-90`).
fn detect_skill_meta(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    if !batch_dir_exists(files, "npm/skills") {
        return diagnostics;
    }
    for id in batch_child_dirs(files, "npm/skills") {
        let skill_dir = format!("npm/skills/{id}");
        if batch_file(files, &format!("{skill_dir}/auto.md")).is_some() {
            diagnostics.push(Diagnostic {
                reason: SKILL_META_REASON.to_string(),
                message: format!(
                    "skills/{id}: залишковий auto.md — видали (метадані тепер у main.json)"
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
        }
        let Some(raw) = read_meta_raw(files, &skill_dir) else {
            diagnostics.push(Diagnostic {
                reason: SKILL_META_REASON.to_string(),
                message: format!(
                    "skills/{id}: відсутній або невалідний main.json (очікується {{\"auto\"?, \"worktree\": bool}})"
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
            continue;
        };
        check_skill_meta_fields(&id, &raw, &mut diagnostics);
    }
    diagnostics
}

// ---------------------------------------------------------------------
// `npm-module/header_doc_pointer`

/// Кількість непорожніх рядків у тілі JSDoc-блоку — точний порт
/// `contentLineCount` (`header_doc_pointer/main.mjs:25-30`): без першого й
/// останнього рядка, після зрізання провідного `*`-відступу.
fn jsdoc_content_line_count(block: &str) -> usize {
    let star_re = regex::Regex::new(STAR_INDENT_PATTERN).expect("STAR_INDENT_PATTERN валідний");
    let lines: Vec<&str> = block.split('\n').collect();
    if lines.len() <= 2 {
        return 0;
    }
    lines[1..lines.len() - 1]
        .iter()
        .filter(|line| !star_re.replace(line, "").chars().all(char::is_whitespace))
        .count()
}

/// Module-level JSDoc або `None` — точний порт `moduleJsDoc`
/// (`header_doc_pointer/main.mjs:37-42`): шукаємо ЛИШЕ в префіксі до
/// першого рядка, що починається з `import`/`export`.
fn module_jsdoc(source: &str) -> Option<String> {
    let code_start_re = regex::Regex::new(CODE_START_PATTERN).expect("CODE_START_PATTERN валідний");
    let prefix = match code_start_re.find(source) {
        Some(m) => &source[..m.start()],
        None => source,
    };
    let jsdoc_re = regex::Regex::new(MODULE_JSDOC_PATTERN).expect("MODULE_JSDOC_PATTERN валідний");
    jsdoc_re.find(prefix).map(|m| m.as_str().to_string())
}

/// Точний порт `checkJsDir` (`header_doc_pointer/main.mjs:87-92`) з
/// вкладеним `checkSourceFile`: `isSourceMjs` (не-тестовий `.mjs`),
/// існування `docs/<stem>.md` поряд, module-level JSDoc > 1 рядка.
fn check_header_doc_pointer_js_dir(
    files: &[SourceFile],
    js_dir: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    for file in batch_dir_entries(files, js_dir) {
        let name = posix_basename(&file.path);
        if !name.ends_with(".mjs") || name.ends_with(".test.mjs") {
            continue;
        }
        let stem = &name[..name.len() - ".mjs".len()];
        if batch_file(files, &format!("{js_dir}/docs/{stem}.md")).is_none() {
            continue;
        }
        let Some(block) = module_jsdoc(&file.content) else {
            continue;
        };
        let count = jsdoc_content_line_count(&block);
        if count > 1 {
            diagnostics.push(Diagnostic {
                reason: HEADER_DOC_POINTER_REASON.to_string(),
                message: format!(
                    "{}: docs/{stem}.md вже описує поведінку — module-level JSDoc має бути \
                     pointer (≤1 рядок, зараз {count})",
                    file.path
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
        }
    }
}

/// Точний порт `lint()` `npm-module/header_doc_pointer`
/// (`main.mjs:120-131`): два base-сегменти, всередині — правила/скіли з
/// каталогом `js/`.
fn detect_header_doc_pointer(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for base in ["npm/rules", "npm/skills"] {
        if !batch_dir_exists(files, base) {
            continue;
        }
        for id in batch_child_dirs(files, base) {
            let js_dir = format!("{base}/{id}/js");
            if !batch_dir_exists(files, &js_dir) {
                continue;
            }
            check_header_doc_pointer_js_dir(files, &js_dir, &mut diagnostics);
        }
    }
    diagnostics
}

// ---------------------------------------------------------------------
// `npm-module/package_structure`

/// Точний порт `globToRegex` (`npm/scripts/lib/glob-to-regex.mjs:26-73`) —
/// та сама послідовність підстановок `__GLOBSTAR__`. `None` — регекс не
/// скомпілювався (розбіжність 5 доккоменту секції).
fn glob_to_regex(glob: &str) -> Option<regex::Regex> {
    let tokens: Vec<String> = glob
        .split('/')
        .map(|part| {
            if part == "**" {
                return "__GLOBSTAR__".to_string();
            }
            let mut out = String::new();
            let mut brace_depth = 0usize;
            for c in part.chars() {
                match c {
                    '*' => {
                        out.push_str("[^/]*");
                        continue;
                    }
                    '?' => {
                        out.push_str("[^/]");
                        continue;
                    }
                    '{' => {
                        out.push_str("(?:");
                        brace_depth += 1;
                        continue;
                    }
                    '}' if brace_depth > 0 => {
                        out.push(')');
                        brace_depth -= 1;
                        continue;
                    }
                    ',' if brace_depth > 0 => {
                        out.push('|');
                        continue;
                    }
                    _ => {}
                }
                if GLOB_REGEX_SPECIAL.contains(&c) {
                    out.push('\\');
                }
                out.push(c);
            }
            out
        })
        .collect();
    let mut re = tokens.join("/");
    re = re.replace("/__GLOBSTAR__/", "(?:/.*/|/)");
    if let Some(rest) = re.strip_prefix("__GLOBSTAR__/") {
        re = format!("(?:.*/)?{rest}");
    }
    if let Some(head) = re.strip_suffix("/__GLOBSTAR__") {
        re = format!("{head}(?:/.*)?");
    }
    re = re.replace("__GLOBSTAR__", ".*");
    regex::Regex::new(&format!("^{re}$")).ok()
}

/// Точний порт `collectPublishedFiles` (`package_structure/main.mjs:224-250`):
/// позитивні записи `files` (файл — СИРИЙ рядок запису, каталог — обхід
/// піддерева), мінус негативні glob-и, відсортовано.
fn collect_published_files(files: &[SourceFile], files_field: &[serde_json::Value]) -> Vec<String> {
    let negatives: Vec<regex::Regex> = files_field
        .iter()
        .filter_map(|v| v.as_str())
        .filter(|s| s.starts_with('!'))
        .filter_map(|s| glob_to_regex(&s[1..]))
        .collect();

    let mut collected: BTreeSet<String> = BTreeSet::new();
    for entry in files_field
        .iter()
        .filter_map(|v| v.as_str())
        .filter(|s| !s.starts_with('!'))
    {
        let Some(normalized) = normalize_rel_path(entry) else {
            continue;
        };
        let full = format!("npm/{normalized}");
        if batch_file(files, &full).is_some() {
            // `collected.add(entry)` JS-оригіналу — саме СИРИЙ запис
            // (не нормалізований `join`-шлях), відтворено дослівно.
            collected.insert(entry.to_string());
            continue;
        }
        if !batch_dir_exists(files, &full) {
            continue;
        }
        let prefix = format!("{full}/");
        for file in files {
            if let Some(rest) = file.path.strip_prefix(&prefix) {
                collected.insert(format!("{normalized}/{rest}"));
            }
        }
    }

    collected
        .into_iter()
        .filter(|rel| !negatives.iter().any(|re| re.is_match(rel)))
        .collect()
}

/// Visitor `findTestFrameworkImport` (`package_structure/main.mjs:260-288`):
/// СПОЧАТКУ `module.staticImports` (source order), потім walk-прохід
/// (`require` перевіряється ПЕРЕД динамічним `import()` у тому самому
/// вузлі) — два буфери, як [`RedisImportVisitor`].
struct TestFrameworkImportVisitor {
    static_hit: Option<String>,
    walk_hit: Option<String>,
}

impl<'a> Visit<'a> for TestFrameworkImportVisitor {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        let module = it.source.value.as_str();
        if self.static_hit.is_none() && TEST_FRAMEWORK_MODULES.contains(&module) {
            self.static_hit = Some(module.to_string());
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.walk_hit.is_none() {
            if let Expression::Identifier(ident) = &it.callee {
                if ident.name == "require" {
                    if let Some(Argument::StringLiteral(lit)) = it.arguments.first() {
                        let module = lit.value.as_str();
                        if TEST_FRAMEWORK_MODULES.contains(&module) {
                            self.walk_hit = Some(module.to_string());
                        }
                    }
                }
            }
        }
        walk_call_expression(self, it);
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if self.walk_hit.is_none() {
            if let Expression::StringLiteral(lit) = &it.source {
                let module = lit.value.as_str();
                if TEST_FRAMEWORK_MODULES.contains(&module) {
                    self.walk_hit = Some(module.to_string());
                }
            }
        }
        walk_import_expression(self, it);
    }
}

/// Точний порт `findTestFrameworkImport` — синтаксична помилка (`errors`
/// непорожній) дає `None`, як і JS-оригінал.
fn find_test_framework_import(content: &str, virtual_path: &str) -> Option<String> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(virtual_path)).parse();
    if !ret.diagnostics.is_empty() {
        return None;
    }
    let mut visitor = TestFrameworkImportVisitor {
        static_hit: None,
        walk_hit: None,
    };
    visitor.visit_program(&ret.program);
    visitor.static_hit.or(visitor.walk_hit)
}

/// Точний порт `classifyPublishedFileAsTest`
/// (`package_structure/main.mjs:303-321`) — включно з carve-out для
/// `rules/<rule-name>/…` (сегмент з індексом 1 — назва правила, не каталог).
fn classify_published_file_as_test(files: &[SourceFile], rel_path: &str) -> Option<String> {
    let segments: Vec<&str> = rel_path.split('/').collect();
    let base = *segments.last()?;
    let dirs = &segments[..segments.len() - 1];

    let test_dir = dirs.iter().enumerate().find_map(|(idx, seg)| {
        if idx == 1 && dirs.first() == Some(&"rules") {
            return None;
        }
        PUBLISHED_TEST_DIR_NAMES
            .contains(&seg.to_lowercase().as_str())
            .then_some(*seg)
    });
    if let Some(dir) = test_dir {
        return Some(format!("test-style каталог \"{dir}/\""));
    }

    let test_name_re = regex::Regex::new(PUBLISHED_TEST_FILE_PATTERN)
        .expect("PUBLISHED_TEST_FILE_PATTERN валідний");
    if test_name_re.is_match(base) {
        return Some("test-style ім'я файлу".to_string());
    }

    let js_like_re = regex::Regex::new(JS_LIKE_EXT_PATTERN).expect("JS_LIKE_EXT_PATTERN валідний");
    if js_like_re.is_match(base) {
        let file = batch_file(files, &format!("npm/{rel_path}"))?;
        if let Some(module) = find_test_framework_import(&file.content, rel_path) {
            return Some(format!("імпорт test-фреймворку \"{module}\""));
        }
    }
    None
}

/// Точний порт `checkNoTestsInPublishedFiles`
/// (`package_structure/main.mjs:332-353`).
fn check_no_tests_in_published_files(files: &[SourceFile], diagnostics: &mut Vec<Diagnostic>) {
    let Some(pkg_file) = batch_file(files, "npm/package.json") else {
        return;
    };
    // Розбіжність 1 (доккомент секції): JS кидає на битому JSON.
    let Some(pkg) = parse_json_tolerant(&pkg_file.content) else {
        return;
    };
    let Some(files_field) = pkg.get("files").and_then(|v| v.as_array()) else {
        return;
    };
    for rel in collect_published_files(files, files_field) {
        if let Some(reason) = classify_published_file_as_test(files, &rel) {
            diagnostics.push(Diagnostic {
                reason: PACKAGE_STRUCTURE_REASON.to_string(),
                message: format!(
                    "npm/{rel}: {reason} — додай у \"files\" у npm/package.json негативний glob, \
                     що виключає цей файл з tarball (наприклад \"!**/*.test.mjs\", \
                     \"!**/fixtures/**\", \"!**/*_test.rego\") (npm-module.mdc)"
                ),
                file: None,
                severity: Severity::Error,
                data: None,
            });
        }
    }
}

/// `String(value)` для повідомлення про поле `types` — `undefined` (ключа
/// немає) і `null` мають ВЛАСНІ рядкові форми, решта — [`js_display_json`].
fn js_string_of_field(value: Option<&serde_json::Value>) -> String {
    match value {
        None => "undefined".to_string(),
        Some(serde_json::Value::Null) => "null".to_string(),
        Some(other) => js_display_json(other),
    }
}

/// Точний порт `npmTypesFileFromPackageField`
/// (`package_structure/main.mjs:146-152`).
fn npm_types_file_from_package_field(value: Option<&serde_json::Value>) -> Option<String> {
    let raw = value?.as_str()?;
    if !raw.starts_with("./types/") {
        return None;
    }
    Some(format!("npm/{}", &raw[2..]))
}

/// Точний порт `checkNpmPackageJson` (`package_structure/main.mjs:163-178`).
fn check_npm_package_json_types(
    files: &[SourceFile],
    use_src_js_layout: bool,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let Some(pkg_file) = batch_file(files, "npm/package.json") else {
        return;
    };
    // Розбіжність 1 (доккомент секції).
    let Some(pkg) = parse_json_tolerant(&pkg_file.content) else {
        return;
    };
    let types_field = pkg.get("types");

    let types_rel = if use_src_js_layout {
        Some("npm/types/index.d.ts".to_string())
    } else {
        npm_types_file_from_package_field(types_field)
    };
    let ok = types_rel
        .as_deref()
        .is_some_and(|rel| batch_file(files, rel).is_some());
    if ok {
        return;
    }
    let message = if use_src_js_layout {
        "Відсутній npm/types/index.d.ts (згенеруй tsc з npm-module.mdc)".to_string()
    } else {
        format!(
            "Файл для поля types не знайдено або шлях не під ./types/ — {}",
            js_string_of_field(types_field)
        )
    };
    diagnostics.push(Diagnostic {
        reason: PACKAGE_STRUCTURE_REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    });
}

/// Відсутні підрядки hk-конфіга — точний порт трьох `missingHk*Fragments`
/// (`package_structure/main.mjs:99-139`) одним фільтром.
fn missing_hk_fragments(hk_text: &str, needed: &[&str]) -> Vec<String> {
    needed
        .iter()
        .filter(|fragment| !hk_text.contains(**fragment))
        .map(|fragment| (*fragment).to_string())
        .collect()
}

/// Точний порт hk-гілки `lint()` (`package_structure/main.mjs:412-437`).
fn check_hk_config(
    files: &[SourceFile],
    use_src_js_layout: bool,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let mut fail = |message: String| {
        diagnostics.push(Diagnostic {
            reason: PACKAGE_STRUCTURE_REASON.to_string(),
            message,
            file: None,
            severity: Severity::Error,
            data: None,
        });
    };

    let hk = ["hk.pkl", ".config/hk.pkl"]
        .into_iter()
        .find_map(|path| batch_file(files, path).map(|f| (path, f)));
    let Some((hk_path, hk_file)) = hk else {
        fail(
            "Очікується hk.pkl або .config/hk.pkl з pre-commit і tsc (npm-module.mdc)".to_string(),
        );
        return;
    };
    let hk_text = &hk_file.content;

    let needed: &[&str] = if use_src_js_layout {
        &[
            "[\"pre-commit\"]",
            "bunx -p typescript tsc",
            "src/**/*.js",
            "--declaration",
            "--allowJs",
            "--emitDeclarationOnly",
            "--outDir types",
            "--skipLibCheck",
        ]
    } else {
        &[
            "[\"pre-commit\"]",
            "bunx -p typescript tsc",
            "tsconfig.emit-types.json",
        ]
    };
    let missing = missing_hk_fragments(hk_text, needed);
    if !missing.is_empty() {
        fail(format!(
            "{hk_path}: онови pre-commit крок (npm-module.mdc); не знайдено: {}",
            missing.join(", ")
        ));
    }

    let deprecated_re = regex::Regex::new(DEPRECATED_CHECK_CHANGELOG_PATTERN)
        .expect("DEPRECATED_CHECK_CHANGELOG_PATTERN валідний");
    if deprecated_re.is_match(hk_text) {
        fail(format!(
            "{hk_path}: крок містить застарілий виклик \"check changelog\" — команду `check` \
             прибрано в v14 (уніфікована поверхня `lint`). Заміни на \
             \"npx @7n/rules lint changelog\" (npm-module.mdc)"
        ));
        return;
    }
    let missing_changelog = missing_hk_fragments(
        hk_text,
        &[
            "[\"npm-changelog\"]",
            "N_RULES_CHANGELOG_AUTOFIX=1",
            "lint changelog",
        ],
    );
    if !missing_changelog.is_empty() {
        fail(format!(
            "{hk_path}: онови крок npm-changelog (npm-module.mdc); не знайдено: {}",
            missing_changelog.join(", ")
        ));
    }
}

/// Точний порт `lint()` `npm-module/package_structure`
/// (`main.mjs:394-448`) — WHOLE-BATCH, порядок перевірок дослівний.
fn detect_package_structure(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let push = |message: String, out: &mut Vec<Diagnostic>| {
        out.push(Diagnostic {
            reason: PACKAGE_STRUCTURE_REASON.to_string(),
            message,
            file: None,
            severity: Severity::Error,
            data: None,
        });
    };

    // checkNpmModuleBasicStructure
    if batch_file(files, "package.json").is_none() {
        push("package.json не існує".to_string(), &mut diagnostics);
    }
    if batch_file(files, "npm").is_some() {
        // `npm` — звичайний файл: `existsSync` true, `stat().isDirectory()` false.
        push("npm має бути директорією".to_string(), &mut diagnostics);
    } else if !batch_dir_exists(files, "npm") {
        push("npm/ директорія не існує".to_string(), &mut diagnostics);
    }
    if batch_file(files, "npm/package.json").is_none() {
        push(
            "npm/package.json не існує — створи package.json для npm модуля".to_string(),
            &mut diagnostics,
        );
    }

    check_no_tests_in_published_files(files, &mut diagnostics);

    // npmSrcTreeHasJsFile
    let use_src_js_layout = batch_dir_exists(files, "npm/src")
        && files
            .iter()
            .any(|f| f.path.starts_with("npm/src/") && f.path.ends_with(".js"));

    check_npm_package_json_types(files, use_src_js_layout, &mut diagnostics);

    if !use_src_js_layout && batch_file(files, "npm/tsconfig.emit-types.json").is_none() {
        push(
            "Без .js під npm/src потрібен npm/tsconfig.emit-types.json (див. npm-module.mdc: \
             emit через tsconfig, без штучного src/index.js)"
                .to_string(),
            &mut diagnostics,
        );
    }

    check_hk_config(files, use_src_js_layout, &mut diagnostics);

    if !batch_dir_exists(files, ".github/workflows") {
        push(".github/workflows/ не існує".to_string(), &mut diagnostics);
    }
    if batch_file(files, ".github/workflows/npm-publish.yml").is_none() {
        push(
            "Відсутній .github/workflows/npm-publish.yml (npm-module.mdc: npm publish)".to_string(),
            &mut diagnostics,
        );
    }

    diagnostics
}

// ---------------------------------------------------------------------
// `js/dep-policy`

/// Точний порт `lint()` `js/dep-policy` (`main.mjs:66-98`) — WHOLE-BATCH:
/// для кожного JS/TS-джерела всі import-specifier-и
/// ([`extract_import_sources`], той самий двофазний порядок «статичні,
/// потім walk», що JS-оригінал) звіряються з [`DEP_POLICY_BANNED_SPECIFIERS`].
fn detect_dep_policy(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for file in files {
        if !is_js_ts_source_file(&file.path) {
            continue;
        }
        for spec in extract_import_sources(&file.content, &file.path) {
            let Some((_, hint)) = DEP_POLICY_BANNED_SPECIFIERS
                .iter()
                .find(|(banned, _)| *banned == spec)
            else {
                continue;
            };
            diagnostics.push(Diagnostic {
                reason: DEP_POLICY_REASON.to_string(),
                message: format!(
                    "{}: заборонений import '{spec}' — {hint} (js.mdc dep-policy)",
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
// Батч 8 (§3.5.5): чотири «файлово-структурні» концерни без жодного
// зовнішнього тула — `bun/layout`, `style/tooling`,
// `test/sandbox-aware-test`, `test/vitest-api-conventions`.
//
// # Чому саме ці чотири (і чому решта JS-канону лишилась)
//
// Інвентар lang-js на момент батчу — 76 `concern.json`, з них 39 із
// `export lint`. Після батчу 7 портовано 28; із 14, що лишались, ЧОТИРИ
// портуються чисто (цей батч), решта десять — ні, і причини різні за
// класом, не за складністю:
//
// - `bun/licensee`, `style/lint`, `js/eslint`, `js/jscpd_duplicates` —
//   detector'и-обгортки навколо ЗАПУСКУ зовнішнього процесу
//   (`bun x licensee`, `stylelint`, `bunx eslint`, `bunx jscpd`): їхній вихід
//   — розібраний stdout/exit-code тула, не аналіз вмісту файлів. Контракт v3
//   має `run-tool`, але жоден із цих тулів не задекларований у
//   `manifest.tools`, і сама семантика («порушення = те, що сказав чужий
//   лінтер») не дає byte-exact parity без вшивання версії тула.
// - `js/knip` — programmatic API `knip` (JS-модуль, не CLI), поза
//   `run-tool`-контрактом узагалі.
// - `js-run/runtime` — усередині кличе `runConftestBatch` (conftest/OPA
//   підпроцес) плюс шість lib-сканерів; та сама причина, що вище.
// - `test/stryker_config` — резолвить canonical baseline-файли, що лежать
//   у ПАКЕТІ (`<concern>/data/**`), а не в repo споживача: порт вимагає
//   вшити ці дані у компонент (той самий клас, що `js/check` — окремий
//   батч, свідоме рішення про розмір).
// - `js/check` — потребує вшитих canonical-json data-файлів (клас вище).
// - `js/doc_comments` — UTF-16-офсети napi-`oxc-parser` проти UTF-8-офсетів
//   crate-`oxc_parser`; розвʼязне, але потребує окремого свідомого рішення
//   про офсети, не побічного ефекту цього батчу.
// - `vue/packages` — єдиний із десяти, що портується технічно (чистий
//   FS+regex, жодного зовнішнього тула): 577 рядків, десяток під-перевірок
//   із власними текстами, плюс `getMonorepoPackageRootDirs`
//   (workspace-глоби) і `lib/vue-forbidden-imports.mjs`. Причина відкласти —
//   ОБСЯГ, не бюджет: батч 8 коштував 9,6 KB (2 385 161 → 2 395 019 байт),
//   тож розмір тут не обмежує. Наступний кандидат.
//
// # Глоби контрибуцій
//
// Той самий принцип, що батч 7: batch несе РІВНО те, що JS-канон читає з
// диска. `bun/layout` і `style/tooling` перелічують конкретні кореневі
// імена (`existsSync(join(cwd, …))` — лише корінь, не `**/`);
// `test/sandbox-aware-test`/`test/vitest-api-conventions` беруть ті самі два
// глоби `**/*.test.{mjs,js}`, що вже мають `test/no-process-chdir` і
// `test/no-relative-fs-path`.
//
// Одна ШИРША за `concern.json` позиція: до `.yarn/**` додано `.yarn` —
// JS-канон робить `existsSync(join(cwd, '.yarn'))`, що true і для
// каталогу, і для ФАЙЛУ з таким імʼям; без другого глоба файл `.yarn` не
// потрапив би в батч і порт мовчки б його не побачив.
//
// # Задокументовані розбіжності (фікстури їх не торкаються)
//
// 1. **Порожній каталог `.yarn/`**: git не трекає порожні каталоги, а
//    host-батч — список ФАЙЛІВ, тож `existsSync('.yarn')` JS-канону =
//    `true`, а [`batch_dir_exists`] = `false` (успадкована мікро-розбіжність
//    5 секції «Батч 5», не нова).
// 2. **Невалідний JSON у кореневому `package.json`** (`style/tooling`):
//    `JSON.parse` JS-канону — БЕЗ `try/catch`, виняток вилітає з `lint()`
//    і весь концерн падає (exit 2); порт через [`parse_json_tolerant`]
//    трактує це як «поля `stylelint` немає» (розбіжність 1 секції «Батч 7»,
//    той самий skip-not-crash дух).
// 3. **`.cursorignore`**: JS-канон `test/sandbox-aware-test` і
//    `test/vitest-api-conventions` звужує `walkDir` через
//    `loadCursorIgnorePaths`, host-збірка батчу — ні. Успадкована
//    розбіжність усіх full-scope портів з батчу 4.
// 4. **Вікно 400 «символів»** ([`has_deep_meta_navigation`]): JS
//    `body.slice(i, i + 400)` рахує UTF-16 code units, Rust-порт —
//    БАЙТИ (з корекцією до char boundary, аби не панікувати). На ASCII
//    (усе, де цей концерн реально спрацьовує — шляхи й `'..'`-літерали)
//    тотожно; на кириличному коментарі всередині вікна Rust-вікно коротше.
//    Той самий клас, що baseline-розбіжність офсетів
//    ([`line_number_at_offset`]).
// 5. **`\s` у `skipWhitespace`** ([`vitest_api_skip_whitespace`]): JS
//    `/\s/u` матчить і non-ASCII пробіли (` `, ` `, `﻿`),
//    байтовий сканер порту — лише ASCII-набір. Між `.toBe(` і `{`/`[`
//    non-ASCII пробіл — синтаксично валідний, але не трапляється в коді.
//
// # Чому байтовий сканер, а не `Vec<char>` (`test/vitest-api-conventions`)
//
// JS-оригінал індексує `body[i]` по UTF-16 code units і порівнює ЛИШЕ з
// ASCII-символами (`{`, `[`, `}`, `]`, лапки, `\`, `)`). У UTF-8
// продовжувальні байти багатобайтового символу завжди `>= 0x80`, тож жоден
// із них не може випадково збігтись з ASCII-літералом — байтовий обхід дає
// той самий результат, що code-unit-обхід, без алокації `Vec<char>`.

/// Ключ контрибуції `bun/layout` (батч 8).
const CONCERN_BUN_LAYOUT: &str = "bun/layout";

/// Ключ контрибуції `style/tooling` (батч 8).
const CONCERN_STYLE_TOOLING: &str = "style/tooling";

/// Ключ контрибуції `test/sandbox-aware-test` (батч 8).
const CONCERN_SANDBOX_AWARE_TEST: &str = "test/sandbox-aware-test";

/// Ключ контрибуції `test/vitest-api-conventions` (батч 8).
const CONCERN_VITEST_API_CONVENTIONS: &str = "test/vitest-api-conventions";

/// `reason` діагностик `bun/layout` — усі `fail()` `main.mjs` без другого
/// аргументу, тож дефолт `ctx.concernId` = bare `"layout"` (той самий мотив,
/// що [`RULE_META_REASON`]).
const BUN_LAYOUT_REASON: &str = "layout";

/// `reason` діагностик `style/tooling` — той самий мотив.
const STYLE_TOOLING_REASON: &str = "tooling";

/// `reason` діагностик `test/sandbox-aware-test` — той самий мотив.
const SANDBOX_AWARE_TEST_REASON: &str = "sandbox-aware-test";

/// `reason` діагностик `test/vitest-api-conventions` — той самий мотив.
const VITEST_API_CONVENTIONS_REASON: &str = "vitest-api-conventions";

/// Заборонені кореневі lock/конфіг-файли чужих пакет-менеджерів — точний
/// порт масиву-літерала у `lint()` (`bun/layout/main.mjs:21`), порядок
/// значущий (визначає порядок діагностик).
const BUN_LAYOUT_FORBIDDEN_FILES: [&str; 4] = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    ".yarnrc.yml",
];

/// Зовнішні файли конфігу stylelint, які підхоплює cosmiconfig — точний
/// порт `STYLELINT_CONFIG_FILES` (`style/tooling/main.mjs:10-18`).
const STYLELINT_CONFIG_FILES: [&str; 7] = [
    ".stylelintrc.json",
    ".stylelintrc.js",
    ".stylelintrc.cjs",
    ".stylelintrc.mjs",
    "stylelint.config.js",
    "stylelint.config.cjs",
    "stylelint.config.mjs",
];

/// Вживання `import.meta.dirname`/`import.meta.url` — точний порт `RE`
/// (`sandbox-aware-test/main.mjs:26`).
const IMPORT_META_NAV_PATTERN: &str = r"import\.meta\.(?:dirname|url)\b";

/// Рядковий літерал `'..'`/`".."` — точний порт другого regex
/// `hasDeepMetaNavigation` (`sandbox-aware-test/main.mjs:30`).
const DOT_DOT_LITERAL_PATTERN: &str = r#"'\.\.'|"\.\.""#;

/// Захист через тимчасову пісочницю — точний порт `WITH_TMP_DIR_RE`
/// (`sandbox-aware-test/main.mjs:37`).
const WITH_TMP_DIR_PATTERN: &str = r"\bwithTmpDir\b";

/// Захист через явний skip у Stryker-sandbox — точний порт
/// `SKIP_IF_STRYKER_RE` (`sandbox-aware-test/main.mjs:40`).
const SKIP_IF_STRYKER_PATTERN: &str =
    r"\btest\.skipIf\s*\(\s*(?:env|process\.env)\.STRYKER_MUTATOR_WORKER\b";

/// Мінімальна кількість `'..'`-літералів у вікні, що робить навігацію
/// «глибокою» — точний порт `if (dots >= 4)`
/// (`sandbox-aware-test/main.mjs:32`).
const DEEP_NAV_MIN_DOTS: usize = 4;

/// Розмір вікна після вживання `import.meta.*` — точний порт
/// `body.slice(match.index, match.index + 400)`
/// (`sandbox-aware-test/main.mjs:29`), у БАЙТАХ (розбіжність 4 секції).
const DEEP_NAV_WINDOW: usize = 400;

/// Виклик `.toBe(` — точний порт `TO_BE_CALL_RE`
/// (`vitest-api-conventions/main.mjs:14`).
const TO_BE_CALL_PATTERN: &str = r"\.toBe\(";

/// Діагностика форми `fail(msg)` (без `file`/`data`) — дефолтний `reason`
/// `createViolationReporter` уже підставлений викликачем.
fn plain_violation(reason: &str, message: String) -> Diagnostic {
    Diagnostic {
        reason: reason.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Точний порт `lint()` `bun/layout`
/// (`plugins/lang-js/rules/bun/layout/main.mjs:16-52`) — WHOLE-BATCH,
/// суто `existsSync`-перевірки кореня репо (жодного читання вмісту).
/// Порядок діагностик — точний порядок гілок JS-оригіналу.
fn detect_bun_layout(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for name in BUN_LAYOUT_FORBIDDEN_FILES {
        if batch_file(files, name).is_some() {
            diagnostics.push(plain_violation(
                BUN_LAYOUT_REASON,
                format!("Знайдено заборонений файл: {name} — видали його"),
            ));
        }
    }
    if batch_dir_exists(files, ".yarn") {
        diagnostics.push(plain_violation(
            BUN_LAYOUT_REASON,
            "Знайдено директорію .yarn — видали її".to_string(),
        ));
    }
    if batch_file(files, "bun.lock").is_none() {
        diagnostics.push(plain_violation(
            BUN_LAYOUT_REASON,
            "Відсутній bun.lock — запусти bun i".to_string(),
        ));
    }
    if batch_file(files, "bunfig.toml").is_none() {
        diagnostics.push(plain_violation(
            BUN_LAYOUT_REASON,
            "Відсутній bunfig.toml — створи з [install] linker = \"hoisted\" (bun.mdc)".to_string(),
        ));
    }
    if batch_file(files, "package.json").is_none() {
        diagnostics.push(plain_violation(
            BUN_LAYOUT_REASON,
            "Відсутній package.json у корені".to_string(),
        ));
    }
    diagnostics
}

/// Точний порт `checkStylelintConfigPresence`
/// (`style/tooling/main.mjs:27-39`): без кореневого `package.json` перевірка
/// взагалі не виконується (`return` до будь-якого `fail`). Умова
/// `pkg.stylelint && typeof pkg.stylelint === 'object'` істинна і для
/// МАСИВУ (`typeof [] === 'object'`) — тому `Object | Array`, а не лише
/// `Object`.
fn stylelint_config_present(files: &[SourceFile]) -> Option<bool> {
    let pkg = batch_file(files, "package.json")?;
    let has_field = parse_json_tolerant(&pkg.content)
        .and_then(|json| json.get("stylelint").cloned())
        .is_some_and(|value| {
            matches!(
                value,
                serde_json::Value::Object(_) | serde_json::Value::Array(_)
            )
        });
    let has_external_cfg = STYLELINT_CONFIG_FILES
        .iter()
        .any(|name| batch_file(files, name).is_some());
    Some(has_field || has_external_cfg)
}

/// Точний порт `lint()` `style/tooling`
/// (`plugins/lang-js/rules/style/tooling/main.mjs:51-73`) — WHOLE-BATCH:
/// конфіг stylelint (поле в `package.json` АБО зовнішній файл) плюс рядок
/// `dist/` у `.stylelintignore`.
fn detect_style_tooling(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    if stylelint_config_present(files) == Some(false) {
        diagnostics.push(plain_violation(
            STYLE_TOOLING_REASON,
            "Немає конфігу stylelint — додай \"stylelint\": { \"extends\": \
             \"@nitra/stylelint-config\" } до package.json"
                .to_string(),
        ));
    }
    match batch_file(files, ".stylelintignore") {
        Some(ignore) => {
            if !ignore
                .content
                .split('\n')
                .any(|line| line.trim() == "dist/")
            {
                diagnostics.push(plain_violation(
                    STYLE_TOOLING_REASON,
                    ".stylelintignore не містить рядка dist/ — додай його (style.mdc)".to_string(),
                ));
            }
        }
        None => diagnostics.push(plain_violation(
            STYLE_TOOLING_REASON,
            ".stylelintignore не існує — створи з вмістом: dist/".to_string(),
        )),
    }
    diagnostics
}

/// Найбільша позиція `<= limit`, що є межею символу — байтовий еквівалент
/// «обрізати вікно», який не панікує на кириличному вмісті (розбіжність 4
/// секції).
fn clamp_to_char_boundary(content: &str, limit: usize) -> usize {
    let mut end = limit.min(content.len());
    while end > 0 && !content.is_char_boundary(end) {
        end -= 1;
    }
    end
}

/// Точний порт `hasDeepMetaNavigation`
/// (`sandbox-aware-test/main.mjs:25-34`): для КОЖНОГО вживання
/// `import.meta.dirname|url` рахує `'..'`/`".."` у вікні
/// [`DEEP_NAV_WINDOW`] і повертає `true` на першому вікні з
/// [`DEEP_NAV_MIN_DOTS`]+ літералами.
fn has_deep_meta_navigation(content: &str, nav_re: &regex::Regex, dots_re: &regex::Regex) -> bool {
    for m in nav_re.find_iter(content) {
        let end = clamp_to_char_boundary(content, m.start() + DEEP_NAV_WINDOW);
        if dots_re.find_iter(&content[m.start()..end]).count() >= DEEP_NAV_MIN_DOTS {
            return true;
        }
    }
    false
}

/// Точний порт `lint()` `test/sandbox-aware-test`
/// (`plugins/lang-js/rules/test/sandbox-aware-test/main.mjs:50-88`) —
/// WHOLE-BATCH, гість-фільтр [`is_test_file_no_process_chdir`] (той самий
/// предикат `isTestFile`, що решта test-концернів). `pass`-гілка
/// (`Усі N тестові файли sandbox-aware`) — no-op у
/// `createViolationReporter`, тож ззовні не спостережувана.
fn detect_sandbox_aware_test(files: &[SourceFile]) -> Vec<Diagnostic> {
    let nav_re =
        regex::Regex::new(IMPORT_META_NAV_PATTERN).expect("IMPORT_META_NAV_PATTERN валідний");
    let dots_re =
        regex::Regex::new(DOT_DOT_LITERAL_PATTERN).expect("DOT_DOT_LITERAL_PATTERN валідний");
    let with_tmp_dir_re =
        regex::Regex::new(WITH_TMP_DIR_PATTERN).expect("WITH_TMP_DIR_PATTERN валідний");
    let skip_if_re =
        regex::Regex::new(SKIP_IF_STRYKER_PATTERN).expect("SKIP_IF_STRYKER_PATTERN валідний");

    let mut diagnostics = Vec::new();
    for file in files {
        if !is_test_file_no_process_chdir(&file.path) {
            continue;
        }
        if !has_deep_meta_navigation(&file.content, &nav_re, &dots_re) {
            continue;
        }
        if with_tmp_dir_re.is_match(&file.content) || skip_if_re.is_match(&file.content) {
            continue;
        }
        diagnostics.push(plain_violation(
            SANDBOX_AWARE_TEST_REASON,
            format!(
                "{}: import.meta deep navigation (≥4 рівні ..) без ізоляції — оберни у \
                 withTmpDir() або захисти test.skipIf(env.STRYKER_MUTATOR_WORKER) (test.mdc, \
                 sandbox-aware-test)",
                file.path
            ),
        ));
    }
    diagnostics
}

/// Чи байт — whitespace у сенсі JS `/\s/u` (ASCII-підмножина, розбіжність 5
/// секції): пробіл, `\t`, `\n`, `\v`, `\f`, `\r`.
fn is_js_ascii_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | 0x0b | 0x0c | b'\r')
}

/// Точний порт `skipWhitespace` (`vitest-api-conventions/main.mjs:28-32`)
/// над байтами (доккомент секції, «Чому байтовий сканер»).
fn vitest_api_skip_whitespace(body: &[u8], from: usize) -> usize {
    let mut i = from;
    while i < body.len() && is_js_ascii_whitespace(body[i]) {
        i += 1;
    }
    i
}

/// Точний порт `findMatchingBracketEnd`
/// (`vitest-api-conventions/main.mjs:59-98`): індекс одразу за парною
/// дужкою, що закриває `body[open_index]`; `None` — незбалансовано (та сама
/// «здаємось»-гілка, що JS-оригінал). Дужки всередині рядкових/template-
/// літералів ігноруються, `\` екранує наступний байт.
fn find_matching_bracket_end(body: &[u8], open_index: usize) -> Option<usize> {
    let mut stack = vec![body[open_index]];
    let mut i = open_index + 1;
    let mut quote: Option<u8> = None;

    while i < body.len() {
        let ch = body[i];
        if let Some(q) = quote {
            if ch == b'\\' {
                i += 2;
            } else {
                if ch == q {
                    quote = None;
                }
                i += 1;
            }
            continue;
        }
        if matches!(ch, b'"' | b'\'' | b'`') {
            quote = Some(ch);
            i += 1;
            continue;
        }
        if matches!(ch, b'{' | b'[') {
            stack.push(ch);
            i += 1;
            continue;
        }
        let open = match ch {
            b'}' => Some(b'{'),
            b']' => Some(b'['),
            _ => None,
        };
        if let Some(open) = open {
            if stack.last() != Some(&open) {
                return None;
            }
            stack.pop();
            if stack.is_empty() {
                return Some(i + 1);
            }
        }
        i += 1;
    }

    None
}

/// Точний порт `findOffenders` (`vitest-api-conventions/main.mjs:106-123`):
/// 1-індексовані рядки викликів `.toBe(` з АРГУМЕНТОМ-літералом
/// (`{…}`/`[…]`), до якого нічого не приєднано, окрім опційних пробілів
/// і `)`.
fn find_to_be_literal_offenders(content: &str, to_be_re: &regex::Regex) -> Vec<usize> {
    let body = content.as_bytes();
    let mut offenders = Vec::new();
    for m in to_be_re.find_iter(content) {
        let arg_start = vitest_api_skip_whitespace(body, m.end());
        if !matches!(body.get(arg_start), Some(b'{') | Some(b'[')) {
            continue;
        }
        let Some(after_literal) = find_matching_bracket_end(body, arg_start) else {
            continue;
        };
        let after_ws = vitest_api_skip_whitespace(body, after_literal);
        if body.get(after_ws) != Some(&b')') {
            continue;
        }
        offenders.push(line_number_at_offset(content, m.start()));
    }
    offenders
}

/// Точний порт `lint()` `test/vitest-api-conventions`
/// (`plugins/lang-js/rules/test/vitest-api-conventions/main.mjs:132-153`) —
/// WHOLE-BATCH через спільний `collectTestFileOffenders`-скелет; на відміну
/// від решти test-концернів батчу, `fail(msg, { file })` заповнює
/// `diagnostic.file`.
fn detect_vitest_api_conventions(files: &[SourceFile]) -> Vec<Diagnostic> {
    let to_be_re = regex::Regex::new(TO_BE_CALL_PATTERN).expect("TO_BE_CALL_PATTERN валідний");
    let mut diagnostics = Vec::new();
    for file in files {
        if !is_test_file_no_process_chdir(&file.path) {
            continue;
        }
        for line in find_to_be_literal_offenders(&file.content, &to_be_re) {
            diagnostics.push(Diagnostic {
                reason: VITEST_API_CONVENTIONS_REASON.to_string(),
                message: format!(
                    "{}:{line}: expect(...).toBe(...) з об'єктним/масивним літералом завжди false \
                     (Object.is на новому посиланні) — використовуй toEqual (test.mdc, \
                     vitest-api-conventions)",
                    file.path
                ),
                file: Some(file.path.clone()),
                severity: Severity::Error,
                data: None,
            });
        }
    }
    diagnostics
}

// =====================================================================
// Батч 9 (§3.5.5): `vue/packages` — останній придатний до порту концерн
// lang-js, названий наступним кандидатом у доккоменті секції «Батч 8».
//
// # Інвентаризація: чому цей концерн — один
//
// Інвентар lang-js на момент батчу — 97 каталогів `concern.json` під
// `plugins/lang-js/rules/**`, з них 39 із `export lint` (решта — суто описові
// концерни LLM-тіру без детектора, чисті rego-полісі й helper-модулі без
// `lint`: `js/tooling`, `js/lint-findings`, `npm-module/applies`,
// `test/storybook-adopt`). Після батчу 8 портовано 32; із 10, що лишались,
// придатний до порту рівно один — цей. Решта дев'ять — три класи причин,
// і причина в кожному класі структурна, не «складно»:
//
// 1. **Обгортка зовнішнього процесу** — `bun/licensee` (`bun x licensee`),
//    `style/lint` (`stylelint`), `js/eslint` (`bunx eslint`/`bunx oxlint`),
//    `js/jscpd_duplicates` (`bunx jscpd`), `js-run/runtime`
//    (`runConftestBatch` → conftest/OPA). Вихід = розібраний stdout/exit-code
//    чужого лінтера; `run-tool` контракту v3 це технічно вміє, але жоден із
//    тулів не задекларований у `manifest.tools`, а byte-exact parity вимагав
//    би ще й вшитої версії тула.
// 2. **Поза `run-tool` узагалі** — `js/knip` кличе programmatic API пакета
//    `knip` (JS-модуль у процесі, не CLI): у wasm-guest немає JS-рантайму.
// 3. **Потребує поверхні, якої в контракті v3 немає**:
//    - `js/check` — (а) читає canonical-json з ПАКЕТА `@7n/rules`
//      (`<concern>/data/tooling/*.json`), а не з репо споживача: `detect-batch`
//      несе лише файли репо, а `capabilities.fs_read` — доступ до диска, не до
//      package-асетів гостя; (б) `checkKnipConfig` РОБИТЬ `copyFile` під час
//      `detect` — запису на диск фаза детекту контракту v3 не має взагалі
//      (мутації живуть лише у `FixPlan`).
//    - `test/stryker_config` — той самий package-асет-клас, що (а) вище.
//    - `js/doc_comments` — розвʼязне, але не безкоштовно: `data.{start,end}`
//      діагностик (їх споживає T0-фіксер `fix-doc_comments.mjs`) — офсети
//      napi-`oxc-parser` у UTF-16 code units, тоді як crate-`oxc_parser`
//      віддає БАЙТИ. Byte-exact parity вимагає конверсії байт→UTF-16 на боці
//      guest-а плюс порту T0-фіксера у `export fix` (інакше JS-фіксер
//      отримав би офсети чужої системи координат і різав файл не там).
//      Це окремий батч зі своїм fix-контуром, не побічний ефект цього.
//
// Тобто §3.5.5 після цього батчу фактично вичерпано: усе, що лишається,
// потребує або декларації тулів у `manifest.tools` (клас 1), або розширення
// контракту (клас 3), або не має сенсу взагалі (клас 2).
//
// # Глоб контрибуції
//
// Найширший у плагіні — і це не недогляд: `checkEsbuildMentions` JS-канону
// обходить УСЕ дерево пакета й читає кожен `.md`/`.json`/`.yaml`/`.yml`
// ([`is_esbuild_scan_file`]), тож batch має нести рівно те саме. Розширення
// `[cm]?[jt]sx?` розгорнуте з `SOURCE_FILE_RE`
// (`vue-forbidden-imports.mjs:26`) у явний brace-список.
//
// # Задокументовані розбіжності
//
// 1. **`.cursorignore` / `.n-rules.json` `ignore`**: JS-канон звужує
//    `walkDir` через `loadCursorIgnorePaths(cwd)`, host-збірка батчу — ні
//    (`build_full_scope_files` кличе `walk_dir(cwd, &[])`). Успадкована
//    розбіжність усіх full-scope портів починаючи з батчу 4.
// 2. **Невалідний JSON**: `collectVueRoots` і `checkVueVolarRecommendation`
//    JS-канону роблять `JSON.parse` БЕЗ `try/catch` — виняток валить весь
//    концерн (exit 2); порт через [`parse_json_tolerant`] трактує битий файл
//    як «пакет не vue» / «немає `recommendations`». Той самий skip-not-crash
//    дух, що розбіжність 2 секції «Батч 8». Виняток —
//    `checkRootVitestDevDeps`: там `try/catch` є в оригіналі, тож гілка
//    «не вдалося розпарсити» портується дослівно й parity точна.
// 3. **Порожній каталог**: `existsSync(join(cwd, rootDir, f))` JS-канону
//    true і для каталогу з таким імʼям; batch — список ФАЙЛІВ. Успадкована
//    мікро-розбіжність 5 секції «Батч 5»; для `vite.config.*`/`jsconfig.json`/
//    `src/vite-env.d.ts` каталог із таким імʼям — не сценарій.
// 4. **Вікно 160 символів сніпета** ([`normalize_snippet_160`]): JS
//    `slice(0, 160)` рахує UTF-16 code units, порт — `chars().take(160)`
//    (code points). Для BMP-вмісту (усе, що трапляється в import-виразах)
//    тотожно; різниця лише на surrogate-парах (емодзі в шляху імпорту).
// 5. **`ukFilesCountPhrase`** (`main.mjs:154-167`) НЕ портовано свідомо:
//    єдиний її споживач — `passFn(...)`, а `reporter.pass()`
//    (`violation-reporter.mjs:30`) — no-op, тож текст не спостережуваний
//    ззовні. Той самий мотив, що «`js/dep-policy` — найчистіший порт»
//    (секція «Батч 7»).
//
// # Чому лінії рахуються по тексту скану, а не по сирому файлу
//
// `findForbiddenVueImportsInSourceFile`/`findForbiddenNodeImportsInVueFile`
// віддають `offsetToLine(content, imp.start)`, де `content` — уже
// ВИТЯГНУТІ `<script>`-блоки `.vue` ([`extract_vue_script_blocks`]), а не
// сирий SFC. Це поведінка канону (номер рядка у `.vue` зміщений на розмір
// `<template>`), і порт її відтворює 1:1, а не «виправляє».

/// Ключ контрибуції `vue/packages` (батч 9).
const CONCERN_VUE_PACKAGES: &str = "vue/packages";

/// `reason` діагностик `vue/packages`: JS-канон кличе `fail(msg)` без
/// другого аргументу, тож дефолт `ctx.concernId` = bare `"packages"` (той
/// самий мотив, що [`BUN_LAYOUT_REASON`]).
const VUE_PACKAGES_REASON: &str = "packages";

/// Згадка `esbuild` як окремого слова — точний порт `ESBUILD_RE`
/// (`vue/packages/main.mjs:18`).
const ESBUILD_PATTERN: &str = r"\besbuild\b";

/// Triple-slash `reference types="vite/client"` — точний порт
/// `VITE_CLIENT_REFERENCE_RE` (`vue/packages/main.mjs:21`).
const VITE_CLIENT_REFERENCE_PATTERN: &str =
    r#"///\s*<reference\s+types\s*=\s*["']vite/client["']\s*/>"#;

/// Тестовий файл за іменем — точний порт `TEST_SOURCE_FILE_RE`
/// (`vue-forbidden-imports.mjs:27`).
const TEST_SOURCE_FILE_PATTERN: &str = r"\.(?:test|spec)\.[cm]?[jt]sx?$";

/// Кандидати vite-конфігу в порядку пошуку — точний порт `configFiles`
/// (`vue/packages/main.mjs:269`); порядок значущий (перший знайдений виграє).
const VITE_CONFIG_FILES: [&str; 3] = ["vite.config.js", "vite.config.ts", "vite.config.mjs"];

/// Vitest-пакети, обовʼязкові в кореневому `devDependencies` — точний порт
/// `ROOT_VITEST_DEV_DEPS` (`vue/packages/main.mjs:511`), порядок значущий
/// (визначає порядок діагностик).
const ROOT_VITEST_DEV_DEPS: [&str; 3] = [
    "vitest",
    "@vitest/coverage-v8",
    "@stryker-mutator/vitest-runner",
];

/// Максимум зібраних `esbuild`-збігів — точний порт `const maxMatches = 30`
/// (`vue/packages/main.mjs:124`).
const ESBUILD_MAX_MATCHES: usize = 30;

/// Токени vite-конфігу, обовʼязкові для НЕ-бібліотечного пакета — точний
/// порт масиву `checks` (`vue/packages/main.mjs:293-296`): `(токен, суфікс
/// повідомлення про відсутність)`.
const VITE_REQUIRED_TOKENS: [&str; 2] = ["VueMacros", "AutoImport"];

/// Стискає пробіли й обрізає до 160 символів — точний порт
/// `normalizeSnippet` (`vue-forbidden-imports.mjs:70-72`). Окрема функція
/// від [`normalize_snippet`] (`ast-scan-utils.mjs`) саме через межу: там
/// 180, тут 160, і плутанина дала б розбіжність тексту повідомлення.
fn normalize_snippet_160(s: &str) -> String {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let ws_re = RE.get_or_init(|| {
        regex::Regex::new(SNIPPET_WHITESPACE_PATTERN).expect("SNIPPET_WHITESPACE_PATTERN валідний")
    });
    ws_re.replace_all(s, " ").trim().chars().take(160).collect()
}

/// Точний порт `packageLabel` (`vue/packages/main.mjs:145-147`).
fn package_label(root_dir: &str) -> &str {
    if root_dir == "." {
        "корінь"
    } else {
        root_dir
    }
}

/// Точний порт `isEsbuildScanFile` (`vue/packages/main.mjs:28-64`).
/// Звертай увагу: lock-файли звіряються з ПОВНИМ відносним шляхом
/// (`lower === 'bun.lock'`), а не з basename — тобто виключаються лише
/// кореневі, як у JS-оригіналі.
fn is_esbuild_scan_file(rel_posix: &str) -> bool {
    if rel_posix.starts_with("node_modules/")
        || rel_posix.starts_with("dist/")
        || rel_posix.starts_with("build/")
        || rel_posix.starts_with("coverage/")
        || rel_posix.starts_with(".git/")
    {
        return false;
    }
    let lower = rel_posix.to_lowercase();
    if matches!(
        lower.as_str(),
        "bun.lock" | "bun.lockb" | "package-lock.json" | "yarn.lock" | "pnpm-lock.yaml"
    ) {
        return false;
    }
    [
        ".js", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".json", ".jsonc", ".yaml", ".yml", ".md",
        ".mdc",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

/// Точний порт `shouldSkipFileForVueImportScan`
/// (`vue-forbidden-imports.mjs:135-141`).
fn should_skip_file_for_vue_import_scan(rel_posix: &str) -> bool {
    let base = posix_basename(rel_posix);
    if base == "auto-imports.d.ts" || base == "components.d.ts" {
        return true;
    }
    rel_posix.ends_with(".d.ts")
}

/// Точний порт `shouldSkipFileForVueAutoImportScan`
/// (`vue-forbidden-imports.mjs:150-156`).
fn should_skip_file_for_vue_auto_import_scan(rel_posix: &str, test_re: &regex::Regex) -> bool {
    if should_skip_file_for_vue_import_scan(rel_posix) {
        return true;
    }
    rel_posix.contains("/__tests__/") || test_re.is_match(posix_basename(rel_posix))
}

/// Точний порт `isVueImportScanSourceFile` (`SOURCE_FILE_RE`,
/// `vue-forbidden-imports.mjs:26`): `.vue` або `[cm]?[jt]sx?`.
fn is_vue_import_scan_source_file(rel_path: &str) -> bool {
    if rel_path.ends_with(".vue") {
        return true;
    }
    let bytes = rel_path.as_bytes();
    // Хвіст `[cm]?[jt]sx?` — максимум 4 символи після крапки.
    for len in 2..=4usize {
        if bytes.len() < len + 1 {
            break;
        }
        let tail = &rel_path[rel_path.len() - len..];
        if bytes[bytes.len() - len - 1] != b'.' {
            continue;
        }
        let mut chars = tail.chars();
        let mut c = chars.next().expect("непорожній хвіст");
        if c == 'c' || c == 'm' {
            let Some(next) = chars.next() else { continue };
            c = next;
        }
        if c != 'j' && c != 't' {
            continue;
        }
        let Some('s') = chars.next() else { continue };
        match chars.next() {
            None => return true,
            Some('x') if chars.next().is_none() => return true,
            _ => continue,
        }
    }
    false
}

/// Віртуальний шлях для парсера — точний порт `virtualPathForParse`
/// (`vue-forbidden-imports.mjs:91-96`): `.vue` розбирається як TypeScript.
fn virtual_path_for_parse(rel_path: &str) -> String {
    match rel_path.strip_suffix(".vue") {
        Some(stem) => format!("{stem}.ts"),
        None => rel_path.to_string(),
    }
}

/// Один статичний імпорт у формі, потрібній обом сканерам
/// (`result.module.staticImports[]` napi-`oxc-parser`).
struct StaticImport {
    /// `imp.start`/`imp.end` — span усієї `ImportDeclaration`.
    span: Span,
    /// `imp.moduleRequest.value`.
    source: String,
    /// `entries.length === 0 || entries.every(e => e.isType)` —
    /// точний порт `isAllowedVueStaticImport`
    /// (`vue-forbidden-imports.mjs:79-84`).
    type_only_or_bare: bool,
}

/// Статичні імпорти вже підготовленого тексту (без `<template>`).
/// `None` = «парсер віддав помилки» → обидва сканери повертають `[]`
/// (`if (result.errors?.length) return []`, `vue-forbidden-imports.mjs:114`).
fn collect_static_imports(content: &str, virtual_path: &str) -> Option<Vec<StaticImport>> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(virtual_path)).parse();
    if !ret.diagnostics.is_empty() {
        return None;
    }
    let mut out = Vec::new();
    for stmt in &ret.program.body {
        let Statement::ImportDeclaration(decl) = stmt else {
            continue;
        };
        let type_only_or_bare = match &decl.specifiers {
            None => true,
            Some(specs) if specs.is_empty() => true,
            Some(specs) => {
                decl.import_kind.is_type()
                    || specs.iter().all(|spec| match spec {
                        oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(named) => {
                            named.import_kind.is_type()
                        }
                        _ => false,
                    })
            }
        };
        out.push(StaticImport {
            span: decl.span,
            source: decl.source.value.as_str().to_string(),
            type_only_or_bare,
        });
    }
    Some(out)
}

/// Знахідка сканера імпортів: `{ line, snippet }` (+ `specifier` для
/// Node-сканера).
struct ImportHit {
    line: usize,
    snippet: String,
    specifier: String,
}

/// Точний порт `findForbiddenVueImportsInText`
/// (`vue-forbidden-imports.mjs:105-128`).
fn find_forbidden_vue_imports_in_text(content: &str, virtual_path: &str) -> Vec<ImportHit> {
    let Some(imports) = collect_static_imports(content, virtual_path) else {
        return Vec::new();
    };
    imports
        .into_iter()
        .filter(|imp| imp.source == "vue" && !imp.type_only_or_bare)
        .map(|imp| ImportHit {
            line: line_number_at_offset(content, imp.span.start as usize),
            snippet: normalize_snippet_160(
                &content[imp.span.start as usize..imp.span.end as usize],
            ),
            specifier: imp.source,
        })
        .collect()
}

/// Точний порт `findForbiddenNodeImportsInText`
/// (`vue-forbidden-imports.mjs:214-239`).
fn find_forbidden_node_imports_in_text(content: &str, virtual_path: &str) -> Vec<ImportHit> {
    let Some(imports) = collect_static_imports(content, virtual_path) else {
        return Vec::new();
    };
    imports
        .into_iter()
        .filter(|imp| is_node_builtin_specifier(&imp.source))
        .map(|imp| ImportHit {
            line: line_number_at_offset(content, imp.span.start as usize),
            snippet: normalize_snippet_160(
                &content[imp.span.start as usize..imp.span.end as usize],
            ),
            specifier: imp.source,
        })
        .collect()
}

/// Точний порт `findForbiddenVueImportsInSourceFile`
/// (`vue-forbidden-imports.mjs:173-177`) — `contentForVueImportScan` +
/// віртуальний `.ts`.
fn find_forbidden_vue_imports_in_source_file(content: &str, rel_path: &str) -> Vec<ImportHit> {
    let scan = if rel_path.ends_with(".vue") {
        extract_vue_script_blocks(content)
    } else {
        content.to_string()
    };
    find_forbidden_vue_imports_in_text(&scan, &virtual_path_for_parse(rel_path))
}

/// Точний порт `findForbiddenNodeImportsInVueFile`
/// (`vue-forbidden-imports.mjs:249-256`) — лише `.vue`, лише `<script>`.
fn find_forbidden_node_imports_in_vue_file(content: &str, rel_path: &str) -> Vec<ImportHit> {
    if !rel_path.ends_with(".vue") {
        return Vec::new();
    }
    let scan = extract_vue_script_blocks(content);
    find_forbidden_node_imports_in_text(&scan, &virtual_path_for_parse(rel_path))
}

/// Текст аргументів першого виклику `AutoImport(` зі збалансованими
/// дужками — точний порт `extractAutoImportCallArgs`
/// (`vue/packages/main.mjs:228-243`). Обхід байтовий: JS індексує по UTF-16
/// code units, але порівнює лише з ASCII `(`/`)`, продовжувальні байти UTF-8
/// завжди `>= 0x80` (той самий аргумент, що секція «Батч 8»).
fn extract_auto_import_call_args(content: &str) -> Option<&str> {
    const MARKER: &str = "AutoImport(";
    let idx = content.find(MARKER)?;
    let start = idx + MARKER.len();
    let bytes = content.as_bytes();
    let mut depth = 1usize;
    for i in start..bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&content[start..i]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Точний порт `viteConfigHasVueInAutoImports`
/// (`vue/packages/main.mjs:252-256`).
fn vite_config_has_vue_in_auto_imports(content: &str) -> bool {
    match extract_auto_import_call_args(content) {
        Some(args) => args.contains("'vue'") || args.contains("\"vue\""),
        None => false,
    }
}

/// JS-truthiness JSON-значення (`pkg.dependencies?.vue` у `if`): `null`,
/// `false`, `0`, `""` — falsy, решта — truthy.
fn json_truthy(value: Option<&serde_json::Value>) -> bool {
    match value {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::String(s)) => !s.is_empty(),
        Some(serde_json::Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(_) => true,
    }
}

/// Файл пакета `root_dir` у батчі: `join(cwd, rootDir, rel)` JS-канону.
fn pkg_file<'a>(files: &'a [SourceFile], root_dir: &str, rel: &str) -> Option<&'a SourceFile> {
    batch_file(files, &format!("{}{rel}", pkg_walk_prefix(root_dir)))
}

/// Файли батча всередині walk-простору пакета, у порядку батча (він же —
/// байтово-лексикографічний порядок `walk_dir`, тотожний `walkDir` JS-канону
/// у межах піддерева), з відносним від кореня пакета шляхом.
fn pkg_walk_files<'a>(
    files: &'a [SourceFile],
    root_dir: &str,
) -> Vec<(&'a SourceFile, std::borrow::Cow<'a, str>)> {
    let prefix = pkg_walk_prefix(root_dir);
    files
        .iter()
        .filter_map(|file| {
            if prefix.is_empty() {
                Some((file, std::borrow::Cow::Borrowed(file.path.as_str())))
            } else {
                file.path
                    .strip_prefix(prefix.as_str())
                    .map(|rel| (file, std::borrow::Cow::Borrowed(rel)))
            }
        })
        .collect()
}

/// Точний порт `checkViteClientEnvAndEditorConfig`
/// (`vue/packages/main.mjs:178-205`).
fn check_vite_client_env_and_editor_config(
    files: &[SourceFile],
    root_dir: &str,
    prefix: &str,
    out: &mut Vec<Diagnostic>,
) {
    let Some(env_file) = pkg_file(files, root_dir, "src/vite-env.d.ts") else {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            format!(
                "{prefix}немає src/vite-env.d.ts — додай файл з рядком /// <reference types=\"vite/client\" /> \
                 (інакше TS/Volar не бачать типів для імпортів асетів: png, avif, css як URL)."
            ),
        ));
        return;
    };
    let vite_client_re = regex::Regex::new(VITE_CLIENT_REFERENCE_PATTERN)
        .expect("VITE_CLIENT_REFERENCE_PATTERN валідний");
    if !vite_client_re.is_match(&env_file.content) {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            format!(
                "{prefix}src/vite-env.d.ts має містити /// <reference types=\"vite/client\" /> \
                 (без цього імпорти статичних файлів у .vue дають «Cannot find module … type declarations»)."
            ),
        ));
        return;
    }
    if pkg_file(files, root_dir, "jsconfig.json").is_none() {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            format!(
                "{prefix}немає jsconfig.json у корені пакета — додай файл з \"include\": [\"src/**/*\"] тощо, \
                 щоб IDE підхопила vite-env.d.ts і .vue."
            ),
        ));
    }
}

/// Точний порт `checkViteConfig` (`vue/packages/main.mjs:268-325`) —
/// повертає `hasVueAutoImport` для [`check_vue_import_violations`].
fn check_vite_config(
    files: &[SourceFile],
    root_dir: &str,
    is_component_library: bool,
    prefix: &str,
    out: &mut Vec<Diagnostic>,
) -> bool {
    let Some((vite_config, file)) = VITE_CONFIG_FILES
        .iter()
        .find_map(|name| pkg_file(files, root_dir, name).map(|file| (*name, file)))
    else {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            format!("{prefix}немає vite.config.js|ts|mjs у каталозі пакета"),
        ));
        return false;
    };
    let content = &file.content;
    let esbuild_re = regex::Regex::new(ESBUILD_PATTERN).expect("ESBUILD_PATTERN валідний");
    if esbuild_re.is_match(content) {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            format!("{prefix}{vite_config} містить 'esbuild' — заміни на 'rolldown'"),
        ));
    }
    if !is_component_library && !content.contains("lightningcss") {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            format!(
                "{prefix}{vite_config} не містить css: {{ transformer: 'lightningcss' }} — \
                 додай у vite.config і встанови lightningcss у devDependencies (vue.mdc)"
            ),
        ));
    }
    let has_vue_auto_import = vite_config_has_vue_in_auto_imports(content);
    if !is_component_library {
        for token in VITE_REQUIRED_TOKENS {
            if !content.contains(token) {
                out.push(plain_violation(
                    VUE_PACKAGES_REASON,
                    format!("{prefix}{vite_config} не містить {token}"),
                ));
            }
        }
        if content.contains("AutoImport(") && !has_vue_auto_import {
            out.push(plain_violation(
                VUE_PACKAGES_REASON,
                format!(
                    "{prefix}{vite_config}: AutoImport не містить 'vue' у imports — додай 'vue' \
                     (інакше прибирати value-імпорти на кшталт `import {{ ref }} from 'vue'` \
                     небезпечно: ref/createApp тощо нікому буде надати)"
                ),
            ));
        }
    }
    if content.contains("process.env.npm_lifecycle_event") {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            format!(
                "{prefix}{vite_config} використовує process.env.npm_lifecycle_event — у Bun це не працює. \
                 Перенеси логіку на mode (defineConfig(({{ mode }}) => ...)) і передавай mode в helper-функції."
            ),
        ));
    }
    has_vue_auto_import
}

/// Точний порт `checkVueImportViolations` (`vue/packages/main.mjs:383-431`).
fn check_vue_import_violations(
    files: &[SourceFile],
    root_dir: &str,
    is_component_library: bool,
    has_vue_auto_import: bool,
    prefix: &str,
    out: &mut Vec<Diagnostic>,
) {
    if is_component_library || !has_vue_auto_import {
        return;
    }
    let test_re =
        regex::Regex::new(TEST_SOURCE_FILE_PATTERN).expect("TEST_SOURCE_FILE_PATTERN валідний");
    for (file, rel) in pkg_walk_files(files, root_dir) {
        if should_skip_file_for_vue_auto_import_scan(&rel, &test_re)
            || !is_vue_import_scan_source_file(&rel)
        {
            continue;
        }
        for hit in find_forbidden_vue_imports_in_source_file(&file.content, &rel) {
            out.push(plain_violation(
                VUE_PACKAGES_REASON,
                format!(
                    "{prefix}{rel}:{} — прибери явний value-імпорт з 'vue' (unplugin-auto-import): {}",
                    hit.line, hit.snippet
                ),
            ));
        }
    }
}

/// Точний порт `checkVueNodeImportViolations`
/// (`vue/packages/main.mjs:337-366`).
fn check_vue_node_import_violations(
    files: &[SourceFile],
    root_dir: &str,
    prefix: &str,
    out: &mut Vec<Diagnostic>,
) {
    for (file, rel) in pkg_walk_files(files, root_dir) {
        if should_skip_file_for_vue_import_scan(&rel) || !rel.ends_with(".vue") {
            continue;
        }
        for hit in find_forbidden_node_imports_in_vue_file(&file.content, &rel) {
            out.push(plain_violation(
                VUE_PACKAGES_REASON,
                format!(
                    "{prefix}{rel}:{} — імпорт Node-нативного модуля '{}' у .vue заборонено \
                     (SFC виконується в браузері, Node API недоступне). Винеси логіку у server-side утіліту. \
                     Фрагмент: {}",
                    hit.line, hit.specifier, hit.snippet
                ),
            ));
        }
    }
}

/// Точний порт `checkEsbuildMentions` + `collectEsbuildMatchesInFiles` +
/// `appendEsbuildLineMatches` (`vue/packages/main.mjs:73-138`): збір
/// зупиняється на [`ESBUILD_MAX_MATCHES`], і рівно на межі додається
/// підсумкова діагностика «показано перші N».
fn check_esbuild_mentions(
    files: &[SourceFile],
    root_dir: &str,
    prefix: &str,
    out: &mut Vec<Diagnostic>,
) {
    let esbuild_re = regex::Regex::new(ESBUILD_PATTERN).expect("ESBUILD_PATTERN валідний");
    let mut matches: Vec<(String, usize, String)> = Vec::new();
    'outer: for (file, rel) in pkg_walk_files(files, root_dir) {
        if !is_esbuild_scan_file(&rel) {
            continue;
        }
        if matches.len() >= ESBUILD_MAX_MATCHES {
            break;
        }
        if !esbuild_re.is_match(&file.content) {
            continue;
        }
        for (index, line) in file.content.split('\n').enumerate() {
            if matches.len() >= ESBUILD_MAX_MATCHES {
                break 'outer;
            }
            if esbuild_re.is_match(line) {
                matches.push((rel.to_string(), index + 1, line.trim().to_string()));
            }
        }
    }
    if matches.is_empty() {
        return;
    }
    for (rel, line, snippet) in &matches {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            format!("{prefix}{rel}:{line} — знайдено 'esbuild'. Замінити на 'rolldown'. Фрагмент: {snippet}"),
        ));
    }
    if matches.len() >= ESBUILD_MAX_MATCHES {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            format!(
                "{prefix}показано перші {ESBUILD_MAX_MATCHES} збігів 'esbuild' (замінити на 'rolldown')"
            ),
        ));
    }
}

/// Точний порт `checkVueVolarRecommendation` (`vue/packages/main.mjs:495-507`).
fn check_vue_volar_recommendation(files: &[SourceFile], out: &mut Vec<Diagnostic>) {
    let Some(ext_file) = batch_file(files, ".vscode/extensions.json") else {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            "\
.vscode/extensions.json не існує (для Vue-проєкту потрібна рекомендація Vue.volar)"
                .to_string(),
        ));
        return;
    };
    let has_volar = parse_json_tolerant(&ext_file.content)
        .and_then(|json| json.get("recommendations").cloned())
        .and_then(|value| match value {
            serde_json::Value::Array(items) => Some(items),
            _ => None,
        })
        .is_some_and(|items| items.iter().any(|v| v.as_str() == Some("Vue.volar")));
    if !has_volar {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            "extensions.json не містить Vue.volar — додай до recommendations".to_string(),
        ));
    }
}

/// Точний порт `checkRootVitestDevDeps` (`vue/packages/main.mjs:521-546`) —
/// єдина гілка концерну з `try/catch` у JS-оригіналі, тож обидві помилкові
/// гілки портуються дослівно (розбіжність 2 секції її не стосується).
fn check_root_vitest_dev_deps(files: &[SourceFile], out: &mut Vec<Diagnostic>) {
    let Some(root_pkg) = batch_file(files, "package.json") else {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            "vue: кореневий package.json не знайдено — неможливо перевірити vitest devDependencies"
                .to_string(),
        ));
        return;
    };
    let Some(pkg) = parse_json_tolerant(&root_pkg.content) else {
        out.push(plain_violation(
            VUE_PACKAGES_REASON,
            "vue: кореневий package.json не вдалося розпарсити — неможливо перевірити vitest devDependencies"
                .to_string(),
        ));
        return;
    };
    let dev_deps: HashSet<&str> = match pkg.get("devDependencies") {
        Some(serde_json::Value::Object(obj)) => obj.keys().map(String::as_str).collect(),
        _ => HashSet::new(),
    };
    for name in ROOT_VITEST_DEV_DEPS {
        if !dev_deps.contains(name) {
            out.push(plain_violation(
                VUE_PACKAGES_REASON,
                format!(
                    "vue: кореневий devDependencies не містить '{name}' — перенеси з Vue workspace \
                     у корінь монорепо (vue.mdc testing)"
                ),
            ));
        }
    }
}

/// Точний порт `collectVueRoots` (`vue/packages/main.mjs:476-486`) у
/// batch-простір: `(rootDir, isComponentLibrary)`.
fn collect_vue_roots(files: &[SourceFile]) -> Vec<(String, bool)> {
    let mut vue_roots = Vec::new();
    for root in monorepo_package_root_dirs(files) {
        let Some(file) = batch_file(files, &pkg_json_path(&root)) else {
            continue;
        };
        // Розбіжність 2 секції: JS `JSON.parse` без try/catch валить концерн.
        let Some(pkg) = parse_json_tolerant(&file.content) else {
            continue;
        };
        if json_truthy(pkg.pointer("/dependencies/vue")) {
            let is_component_library = json_truthy(pkg.pointer("/peerDependencies/vue"));
            vue_roots.push((root, is_component_library));
        }
    }
    vue_roots
}

/// Точний порт `lint()` `vue/packages` (`vue/packages/main.mjs:553-576`) —
/// WHOLE-BATCH: порядок діагностик — Volar → кореневі vitest-devDeps →
/// пер-пакетні перевірки у порядку [`monorepo_package_root_dirs`].
fn detect_vue_packages(files: &[SourceFile]) -> Vec<Diagnostic> {
    let vue_roots = collect_vue_roots(files);
    if vue_roots.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    check_vue_volar_recommendation(files, &mut out);
    check_root_vitest_dev_deps(files, &mut out);
    for (root_dir, is_component_library) in &vue_roots {
        let prefix = format!("[{}] ", package_label(root_dir));
        check_vite_client_env_and_editor_config(files, root_dir, &prefix, &mut out);
        let has_vue_auto_import =
            check_vite_config(files, root_dir, *is_component_library, &prefix, &mut out);
        check_vue_import_violations(
            files,
            root_dir,
            *is_component_library,
            has_vue_auto_import,
            &prefix,
            &mut out,
        );
        check_vue_node_import_violations(files, root_dir, &prefix, &mut out);
        check_esbuild_mentions(files, root_dir, &prefix, &mut out);
    }
    out
}

/// Guest-реалізація world `plugin` — тридцять три контрибуції ([`CONCERN_TFM`],
/// [`CONCERN_GAP`], [`CONCERN_POOL_FORKS`], [`CONCERN_NO_PROCESS_CHDIR`],
/// [`CONCERN_ADMIN_TABLE`], [`CONCERN_QUASAR_FIXES`], [`CONCERN_LOCATION`],
/// [`CONCERN_NO_CONSOLE_STORE_RESTORE`], [`CONCERN_NO_BUN_TEST_IMPORT`],
/// [`CONCERN_UTILS_IMPORTS`], [`CONCERN_NO_RELATIVE_FS_PATH`],
/// [`CONCERN_REDIS_IMPORTS`], [`CONCERN_MSSQL_DEPS`],
/// [`CONCERN_BUN_DB_SAFETY`] — батч 4, задача Q4; [`CONCERN_STORYBOOK_SCOPE`],
/// [`CONCERN_STORYBOOK_HYGIENE`], [`CONCERN_STORYBOOK_PAGE_COVERAGE`],
/// [`CONCERN_STORYBOOK_SCAFFOLD`], [`CONCERN_STORYBOOK_CI`] — батч 5,
/// storybook-сімейство, доккомент секції «Батч 5» вище;
/// [`CONCERN_STORYBOOK_VITEST_CONFIG`], [`CONCERN_BUN_DB_PACKAGE_JSON`],
/// [`CONCERN_REDIS_PACKAGE_JSON`], [`CONCERN_MSSQL_PACKAGE_JSON`] — батч 6;
/// [`CONCERN_RULE_META`], [`CONCERN_SKILL_META`],
/// [`CONCERN_HEADER_DOC_POINTER`], [`CONCERN_PACKAGE_STRUCTURE`],
/// [`CONCERN_DEP_POLICY`] — батч 7, доккомент секції «Батч 7» вище;
/// [`CONCERN_BUN_LAYOUT`], [`CONCERN_STYLE_TOOLING`],
/// [`CONCERN_SANDBOX_AWARE_TEST`], [`CONCERN_VITEST_API_CONVENTIONS`] —
/// батч 8, доккомент секції «Батч 8» вище; [`CONCERN_VUE_PACKAGES`] — батч 9,
/// доккомент секції «Батч 9» вище).
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
            CONCERN_STORYBOOK_SCOPE => {
                report_progress(total, total);
                detect_storybook_scope(&batch.files)
            }
            CONCERN_STORYBOOK_HYGIENE => {
                report_progress(total, total);
                detect_storybook_hygiene(&batch.files)
            }
            CONCERN_STORYBOOK_PAGE_COVERAGE => {
                report_progress(total, total);
                detect_storybook_page_coverage(&batch.files)
            }
            CONCERN_STORYBOOK_SCAFFOLD => {
                report_progress(total, total);
                detect_storybook_scaffold(&batch.files)
            }
            CONCERN_STORYBOOK_CI => {
                report_progress(total, total);
                detect_storybook_ci(&batch.files)
            }
            CONCERN_STORYBOOK_VITEST_CONFIG => {
                report_progress(total, total);
                // Слот `repo-root@1` host-контексту читається лише тут (у
                // host-import шарі), чиста функція отримує значення
                // аргументом — доккомент секції «Батч 6».
                let repo_root = host_context("repo-root@1");
                detect_storybook_vitest_config(&batch.files, repo_root.as_deref())
            }
            CONCERN_BUN_DB_PACKAGE_JSON => {
                report_progress(total, total);
                detect_package_json_deny(&batch.files, &BUN_DB_PACKAGE_JSON_DENY)
            }
            CONCERN_REDIS_PACKAGE_JSON => {
                report_progress(total, total);
                detect_package_json_deny(&batch.files, &REDIS_PACKAGE_JSON_DENY)
            }
            CONCERN_MSSQL_PACKAGE_JSON => {
                report_progress(total, total);
                detect_mssql_package_json(&batch.files)
            }
            CONCERN_RULE_META => {
                report_progress(total, total);
                detect_rule_meta(&batch.files)
            }
            CONCERN_SKILL_META => {
                report_progress(total, total);
                detect_skill_meta(&batch.files)
            }
            CONCERN_HEADER_DOC_POINTER => {
                report_progress(total, total);
                detect_header_doc_pointer(&batch.files)
            }
            CONCERN_PACKAGE_STRUCTURE => {
                report_progress(total, total);
                detect_package_structure(&batch.files)
            }
            CONCERN_DEP_POLICY => {
                report_progress(total, total);
                detect_dep_policy(&batch.files)
            }
            CONCERN_BUN_LAYOUT => {
                report_progress(total, total);
                detect_bun_layout(&batch.files)
            }
            CONCERN_STYLE_TOOLING => {
                report_progress(total, total);
                detect_style_tooling(&batch.files)
            }
            CONCERN_SANDBOX_AWARE_TEST => {
                report_progress(total, total);
                detect_sandbox_aware_test(&batch.files)
            }
            CONCERN_VITEST_API_CONVENTIONS => {
                report_progress(total, total);
                detect_vitest_api_conventions(&batch.files)
            }
            CONCERN_VUE_PACKAGES => {
                report_progress(total, total);
                detect_vue_packages(&batch.files)
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

    /// fix-контур contract v3 (пілот): `test/no-bun-test-import` будує
    /// реальний план ([`fix_no_bun_test_import`] — Rust-порт видаленого
    /// `fix-no-bun-test-import.mjs`); решта концернів — порожній план
    /// («нічого не чинити», сумісна заглушка — доккомент `wit/world.wit`
    /// біля `export fix`).
    fn fix(request: FixRequest) -> FixPlan {
        match request.concern_id.as_str() {
            CONCERN_NO_BUN_TEST_IMPORT => fix_no_bun_test_import(&request),
            _ => FixPlan { edits: vec![] },
        }
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

    // --- test/no-bun-test-import: guest-фікс (пілот fix-контуру contract v3,
    // порт кейсів видаленого JS-тесту `no-bun-test-import.test.mjs` секції
    // «T0-fix») ---

    /// Діагностика в формі, яку реально віддає [`detect_no_bun_test_import`]
    /// — тести фіксу нижче ганяють detect → fix парою, як конвеєр.
    fn fix_request_for(files: Vec<SourceFile>) -> FixRequest {
        let diagnostics = detect_no_bun_test_import(&files);
        FixRequest {
            concern_id: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
            files,
            diagnostics,
        }
    }

    fn single_write_content(plan: &FixPlan) -> &str {
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(write) => &write.content,
            FileEdit::Delete(_) => panic!("очікували write-edit"),
        }
    }

    /// Дзеркало JS-кейсу «fixable import переписується на vitest, тест-код
    /// не чіпається».
    #[test]
    fn fix_no_bun_test_import_rewrites_fixable_import_preserving_body() {
        let bun_test = ["bun", "test"].join(":");
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!(
                "import {{ describe, test, expect, beforeEach }} from '{bun_test}'\n\n\
                 describe('x', () => {{\n  beforeEach(() => {{}})\n  test('ok', () => expect(1).toBe(1))\n}})\n"
            ),
        )];
        let plan = fix_no_bun_test_import(&fix_request_for(files));
        let content = single_write_content(&plan);
        assert!(content.contains("from 'vitest'"));
        assert!(!content.contains(&bun_test));
        assert!(content.contains("import { describe, test, expect, beforeEach } from"));
        assert!(content.contains("test('ok', () => expect(1).toBe(1))"));
    }

    /// Дзеркало JS-кейсу «не-fixable import (mock) лишається недоторканим».
    #[test]
    fn fix_no_bun_test_import_leaves_unfixable_import_untouched() {
        let bun_test = ["bun", "test"].join(":");
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("import {{ test, mock }} from '{bun_test}'\ntest('x', () => mock(() => 1))\n"),
        )];
        let plan = fix_no_bun_test_import(&fix_request_for(files));
        assert!(plan.edits.is_empty());
    }

    /// Дзеркало JS-кейсу «подвійні лапки зберігаються після заміни».
    #[test]
    fn fix_no_bun_test_import_preserves_double_quotes() {
        let bun_test = ["bun", "test"].join(":");
        let files = vec![source(
            "tests/foo.test.mjs",
            &format!("import {{ test }} from \"{bun_test}\"\ntest('x', () => {{}})\n"),
        )];
        let plan = fix_no_bun_test_import(&fix_request_for(files));
        assert!(single_write_content(&plan).contains("from \"vitest\""));
    }

    /// Дзеркало JS-кейсу «кілька файлів у одному прогоні — фіксується лише
    /// fixable».
    #[test]
    fn fix_no_bun_test_import_fixes_only_fixable_files_in_batch() {
        let bun_test = ["bun", "test"].join(":");
        let files = vec![
            source(
                "tests/a.test.mjs",
                &format!("import {{ test }} from '{bun_test}'\ntest('a', () => {{}})\n"),
            ),
            source(
                "tests/b.test.mjs",
                &format!("import {{ test, spyOn }} from '{bun_test}'\ntest('b', () => {{}})\n"),
            ),
        ];
        let plan = fix_no_bun_test_import(&fix_request_for(files));
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(write) => {
                assert_eq!(write.path, "tests/a.test.mjs");
                assert!(write.content.contains("from 'vitest'"));
            }
            FileEdit::Delete(_) => panic!("очікували write-edit"),
        }
    }

    /// Порожні діагностики (чи файл без діагностики) → порожній план — той
    /// самий контракт «порожній план = нічого не чинити».
    #[test]
    fn fix_no_bun_test_import_returns_empty_plan_without_diagnostics() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "import { test } from 'vitest'\n",
        )];
        let plan = fix_no_bun_test_import(&fix_request_for(files));
        assert!(plan.edits.is_empty());
    }

    /// Діагностика вказує на файл, якого немає в `request.files` —
    /// пропускається без паніки (guest не має IO, перечитати нізвідки).
    #[test]
    fn fix_no_bun_test_import_skips_diagnostic_for_missing_file() {
        let bun_test = ["bun", "test"].join(":");
        let detected = vec![source(
            "tests/foo.test.mjs",
            &format!("import {{ test }} from '{bun_test}'\n"),
        )];
        let diagnostics = detect_no_bun_test_import(&detected);
        let request = FixRequest {
            concern_id: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
            files: vec![],
            diagnostics,
        };
        assert!(fix_no_bun_test_import(&request).edits.is_empty());
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

    // --- батч 4 (задача Q4): AST-специфічні поведінки, які regex-groundwork
    // не відтворював — дзеркала live-прогонів JS-оригіналів.

    #[test]
    fn detect_redis_imports_ignores_comments_and_strings() {
        // Regex-groundwork тут брехав би: імпорт у коментарі та require у
        // рядковому літералі — НЕ порушення для AST.
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/x.ts",
                "// import Redis from 'ioredis'\nconst s = \"require('redis')\"\nexport const y = s\n",
            ),
        ];
        assert!(detect_redis_imports(&files).is_empty());
    }

    #[test]
    fn detect_redis_imports_orders_static_imports_before_walk_hits() {
        // Дзеркало двофазного порядку JS-оригіналу: staticImports (лінія 2)
        // ПЕРЕД require (лінія 1) — не в порядку ліній.
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/x.cjs",
                "const a = require('redis')\nimport Redis from 'ioredis'\n",
            ),
        ];
        let diagnostics = detect_redis_imports(&files);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics[0].message.contains(":2 —"));
        assert!(diagnostics[1].message.contains(":1 —"));
    }

    #[test]
    fn detect_redis_imports_skips_file_with_syntax_error() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/broken.ts",
                "import Redis from 'ioredis'\ninvalid <<<< syntax\n",
            ),
        ];
        assert!(detect_redis_imports(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_tagged_dynamic_join_yields_duplicate_diagnostics() {
        // Дубль-обхід tagged template (доккомент секції «Батч 4») — ДВІ
        // ідентичні діагностики, як у JS-оригіналі.
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport async function findMany(ids) {\n  return sql`SELECT * FROM users WHERE id IN (${ids.join(',')})`\n}\n",
            ),
        ];
        let dynamic_list: Vec<Diagnostic> = detect_bun_db_safety(&files)
            .into_iter()
            .filter(|d| {
                d.message
                    .contains("заборонено підставляти у SQL динамічні списки")
            })
            .collect();
        assert_eq!(dynamic_list.len(), 2);
        assert_eq!(dynamic_list[0].message, dynamic_list[1].message);
    }

    #[test]
    fn detect_bun_db_safety_guard_in_same_block_passes() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport function f(ids) {\n  if (!ids.length) throw new Error('empty')\n  return sql`SELECT 1 FROM t WHERE id IN (${ids})`\n}\n",
            ),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_guard_outside_nested_block_does_not_help() {
        // Guard у зовнішньому блоці НЕ рятує вкладений блок — точний порт
        // findEnclosingBlockAndStatementIndex (live-прогін JS-оригіналу).
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport function f(ids, x) {\n  if (!ids.length) throw new Error('empty')\n  if (x) {\n    return sql`SELECT 1 FROM t WHERE id IN (${ids})`\n  }\n  return null\n}\n",
            ),
        ];
        let diagnostics = detect_bun_db_safety(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("перед IN-списком \"ids\"")));
    }

    #[test]
    fn detect_bun_db_safety_ignores_unsafe_in_comment_and_string() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\n// sql.unsafe('SELECT 1')\nconst s = \"new SQL(url)\"\nexport const ping = () => sql`SELECT ${s}`\n",
            ),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_side_effect_pg_import_not_flagged_prefilter_mirror() {
        // `import 'pg'` (side-effect) не проходить текстовий pre-filter
        // PG_LIB_IMPORT_RE JS-оригіналу — файл НЕ потрапляє в pgUsage,
        // import-порушення немає (відтворено, не «поліпшено»).
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("src/side-effect.ts", "import 'pg'\nexport const x = 1\n"),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_bun_db_safety_flags_pg_import_without_listen_notify() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/app.ts",
                "import { Client } from 'pg'\nexport const c = new Client()\n",
            ),
        ];
        let diagnostics = detect_bun_db_safety(&files);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .contains("import 'pg' дозволено лише"));
    }

    #[test]
    fn detect_bun_db_safety_flags_sql_array_without_type() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport const q = ids => sql`SELECT ${sql.array(ids)}`\n",
            ),
        ];
        let diagnostics = detect_bun_db_safety(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("sql.array(arr) без другого аргументу")));
    }

    #[test]
    fn detect_bun_db_safety_passes_sql_array_with_type() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport const q = ids => sql`SELECT ${sql.array(ids, 'int8')}`\n",
            ),
        ];
        assert!(detect_bun_db_safety(&files).is_empty());
    }

    #[test]
    fn detect_mssql_deps_returns_invalid_json_fail_even_without_mssql_found() {
        // found == 0 → джерела не скануються, але «невалідний JSON»-fail
        // повертається (точний порт reporter.result() після аудиту).
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source("sub/package.json", "NOT_VALID_JSON"),
            source(
                "src/db.ts",
                "export function f() {\n  const pool = new sql.ConnectionPool(config)\n  return pool\n}\n",
            ),
        ];
        let diagnostics = detect_mssql_deps(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].message,
            "js-mssql: sub/package.json — невалідний JSON"
        );
    }

    #[test]
    fn detect_mssql_deps_in_list_with_parse_int_trace_passes() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
            ),
            source(
                "src/db.ts",
                "export function f(raw) {\n  const ids = raw.map(x => parseInt(x, 10)).filter(n => !Number.isNaN(n))\n  if (!ids.length) throw new Error('empty')\n  return pool.request().query`SELECT 1 WHERE id IN (${ids})`\n}\n",
            ),
        ];
        assert!(detect_mssql_deps(&files).is_empty());
    }

    #[test]
    fn detect_mssql_deps_in_list_unparsed_and_unguarded_flags_both() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
            ),
            source(
                "src/db.ts",
                "export function f(ids) {\n  return pool.request().query`SELECT 1 WHERE id IN (${ids})`\n}\n",
            ),
        ];
        let diagnostics = detect_mssql_deps(&files);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics[0].message.contains("числовим парсером"));
        assert!(diagnostics[1].message.contains("перед IN-списком \"ids\""));
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

    // --- батч 5: storybook-сімейство ---

    /// Мінімальна Vue-бібліотека `packages/ui` з `count` `.vue`-файлами —
    /// дзеркало `writeVueLibraryPkg` (`storybook-scope/tests/scope.test.mjs`).
    fn vue_library_files(count: usize) -> Vec<SourceFile> {
        let mut files = vec![
            source(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}",
            ),
            source(
                "packages/ui/package.json",
                "{\"name\":\"ui\",\"peerDependencies\":{\"vue\":\"^3.6.0\"}}",
            ),
        ];
        for i in 0..count {
            files.push(source(
                &format!("packages/ui/src/components/Comp{i}.vue"),
                "<template><div/></template>\n",
            ));
        }
        files
    }

    #[test]
    fn monorepo_roots_expand_star_pattern_and_sort_root_first() {
        let files = vec![
            source("package.json", "{\"workspaces\":[\"packages/*\",\"npm\"]}"),
            source("packages/ui/package.json", "{\"name\":\"ui\"}"),
            source("packages/app/package.json", "{\"name\":\"app\"}"),
            source("npm/package.json", "{\"name\":\"npm\"}"),
            source("packages/node_modules/x/package.json", "{\"name\":\"x\"}"),
        ];
        assert_eq!(
            monorepo_package_root_dirs(&files),
            vec![".", "npm", "packages/app", "packages/ui"]
        );
    }

    #[test]
    fn monorepo_roots_without_root_package_json_is_only_dot() {
        let files = vec![source("packages/ui/package.json", "{\"name\":\"ui\"}")];
        assert_eq!(monorepo_package_root_dirs(&files), vec!["."]);
    }

    #[test]
    fn workspace_glob_star_does_not_cross_segments_but_double_star_does() {
        let files = vec![
            source("package.json", "{\"workspaces\":[\"packages/**\"]}"),
            source("packages/group/deep/package.json", "{\"name\":\"deep\"}"),
        ];
        assert_eq!(
            monorepo_package_root_dirs(&files),
            vec![".", "packages/group/deep"]
        );
        let star_only = vec![
            source("package.json", "{\"workspaces\":[\"packages/*\"]}"),
            source("packages/group/deep/package.json", "{\"name\":\"deep\"}"),
        ];
        assert_eq!(monorepo_package_root_dirs(&star_only), vec!["."]);
    }

    #[test]
    fn read_storybook_opt_out_prefers_n_rules_and_keeps_raw_values() {
        let files = vec![
            source(
                ".n-rules.json",
                "{\"storybook\":{\"optOut\":[\"packages/ui\",\" \",42]}}",
            ),
            source(
                ".n-cursor.json",
                "{\"storybook\":{\"optOut\":[\"legacy\"]}}",
            ),
        ];
        assert_eq!(read_storybook_opt_out(&files), vec!["packages/ui"]);
    }

    #[test]
    fn read_storybook_opt_out_broken_n_rules_does_not_fall_back_to_legacy() {
        // existsSync-вибір файлу відбувається ДО парсингу: битий
        // `.n-rules.json` → порожньо, БЕЗ fallback-у на `.n-cursor.json`.
        let files = vec![
            source(".n-rules.json", "не json"),
            source(
                ".n-cursor.json",
                "{\"storybook\":{\"optOut\":[\"legacy\"]}}",
            ),
        ];
        assert!(read_storybook_opt_out(&files).is_empty());
    }

    #[test]
    fn collect_in_scope_respects_threshold_and_opt_out() {
        // Поріг: 2 < VUE_FILE_THRESHOLD → поза скоупом.
        assert!(collect_in_scope_vue_packages(&vue_library_files(2)).is_empty());
        // 3 — у скоупі, type library.
        let in_scope = collect_in_scope_vue_packages(&vue_library_files(3));
        assert_eq!(in_scope.len(), 1);
        assert_eq!(in_scope[0].root_dir, "packages/ui");
        assert!(in_scope[0].kind == ScopePkgKind::Library);
        // optOut знімає зі скоупу.
        let mut opted_out = vue_library_files(3);
        opted_out.push(source(
            ".n-rules.json",
            "{\"storybook\":{\"optOut\":[\"packages/ui\"]}}",
        ));
        assert!(collect_in_scope_vue_packages(&opted_out).is_empty());
    }

    #[test]
    fn collect_in_scope_app_requires_detect_apps_flag_and_pages_dir() {
        let base = vec![
            source(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}",
            ),
            source(
                "packages/demo/package.json",
                "{\"name\":\"demo\",\"dependencies\":{\"vue\":\"^3.6.0\"}}",
            ),
            source("packages/demo/src/pages/task/[id].vue", "<template/>"),
        ];
        // Без прапорця detectApps — поза скоупом.
        assert!(collect_in_scope_vue_packages(&base).is_empty());
        // З прапорцем — у скоупі як app, БЕЗ порога (одна сторінка досить).
        let mut with_flag = base.clone();
        with_flag.push(source(
            ".n-rules.json",
            "{\"storybook\":{\"detectApps\":true}}",
        ));
        let in_scope = collect_in_scope_vue_packages(&with_flag);
        assert_eq!(in_scope.len(), 1);
        assert!(in_scope[0].kind == ScopePkgKind::App);
    }

    #[test]
    fn count_vue_files_respects_n_rules_ignore() {
        let files = vec![
            source(
                ".n-rules.json",
                "{\"ignore\":[\"packages/ui/src/legacy/\"]}",
            ),
            source("packages/ui/src/components/A.vue", "<template/>"),
            source("packages/ui/src/legacy/B.vue", "<template/>"),
        ];
        let ignore = read_ignore_prefixes(&files);
        assert_eq!(count_vue_files(&files, "packages/ui/", &ignore), 1);
        assert_eq!(count_vue_files(&files, "", &ignore), 1);
    }

    #[test]
    fn detect_storybook_scope_flags_stale_opt_out_only() {
        let mut files = vue_library_files(3);
        files.push(source(
            ".n-rules.json",
            "{\"storybook\":{\"optOut\":[\"packages/ghost\",\"packages/ui\"]}}",
        ));
        let diagnostics = detect_storybook_scope(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "stale-opt-out");
        assert_eq!(
            diagnostics[0].message,
            ".n-rules.json storybook.optOut містить 'packages/ghost' — такого workspace-пакета \
             немає (застаріле opt-out, storybook.mdc)"
        );
        assert!(diagnostics[0].file.is_none());
    }

    #[test]
    fn detect_storybook_scope_empty_opt_out_is_silent() {
        assert!(detect_storybook_scope(&vue_library_files(3)).is_empty());
    }

    #[test]
    fn extract_import_specifiers_orders_statics_before_dynamics_and_requires() {
        let content = "<template><div/></template>\n<script setup>\nconst legacy = \
                       require('legacy-pkg')\nimport { thing } from 'static-pkg'\nawait \
                       import('dyn-pkg')\n</script>\n";
        assert_eq!(
            extract_import_specifiers(content, "src/components/A.vue"),
            vec!["static-pkg", "legacy-pkg", "dyn-pkg"]
        );
    }

    #[test]
    fn extract_import_specifiers_skips_file_with_syntax_error() {
        let content = "<script setup>\nimport { x } from 'pkg'\ninvalid <<<< syntax\n</script>\n";
        assert!(extract_import_specifiers(content, "A.vue").is_empty());
    }

    #[test]
    fn detect_storybook_hygiene_flags_undeclared_import_once_per_package_name() {
        let mut files = vue_library_files(3);
        files.push(source(
            "packages/ui/src/components/Picker.vue",
            "<script setup>\nimport Datepicker from '@vuepic/vue-datepicker'\nimport { x } from \
             '@vuepic/vue-datepicker/sub'\nimport { join } from 'node:path'\nimport rel from \
             './local.js'\nimport aliased from '@/utils'\n</script>\n",
        ));
        let diagnostics = detect_storybook_hygiene(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "undeclared-import");
        assert_eq!(
            diagnostics[0].message,
            "[undeclared-import] packages/ui/src/components/Picker.vue: import \
             '@vuepic/vue-datepicker' — пакет '@vuepic/vue-datepicker' відсутній у \
             dependencies/peerDependencies packages/ui (storybook.mdc hygiene)"
        );
        assert_eq!(
            diagnostics[0].file.as_deref(),
            Some("packages/ui/src/components/Picker.vue")
        );
    }

    #[test]
    fn detect_storybook_hygiene_declared_deps_pass() {
        let mut files = vec![
            source(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}",
            ),
            source(
                "packages/ui/package.json",
                "{\"name\":\"ui\",\"peerDependencies\":{\"vue\":\"^3.6.0\"},\"dependencies\":{\"@vuepic/vue-datepicker\":\"^14.0.0\"}}",
            ),
        ];
        for i in 0..3 {
            files.push(source(
                &format!("packages/ui/src/components/Comp{i}.vue"),
                "<script setup>\nimport Datepicker from '@vuepic/vue-datepicker'\n</script>\n",
            ));
        }
        assert!(detect_storybook_hygiene(&files).is_empty());
    }

    #[test]
    fn detect_storybook_hygiene_sass_variables_warn() {
        let mut files = vue_library_files(3);
        files.push(source(
            "packages/ui/src/css/quasar.variables.scss",
            "$primary: #000;\n",
        ));
        files.push(source(
            "packages/ui/.storybook/main.js",
            "export default { framework: '@storybook/vue3-vite' }\n",
        ));
        let diagnostics = detect_storybook_hygiene(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "missing-sass-variables");
        assert!(diagnostics[0].severity == Severity::Warn);
        assert_eq!(
            diagnostics[0].message,
            "[sass-variables] packages/ui/.storybook/main.js: пакет має глобальні Quasar \
             SCSS-змінні (src/css/quasar.variables.scss | src/css/quasar.variables.sass), але \
             quasar({ sassVariables }) не задано в .storybook/main.js (storybook.mdc hygiene)"
        );
        // З маркером — тихо.
        let last = files.len() - 1;
        files[last] = source(
            "packages/ui/.storybook/main.js",
            "export default { viteFinal: () => quasar({ sassVariables: true }) }\n",
        );
        assert!(detect_storybook_hygiene(&files).is_empty());
    }

    /// App-пакет `packages/demo` у скоупі (detectApps) з опційними stories.
    fn app_pkg_files(with_story: bool) -> Vec<SourceFile> {
        let mut files = vec![
            source(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}",
            ),
            source(".n-rules.json", "{\"storybook\":{\"detectApps\":true}}"),
            source(
                "packages/demo/package.json",
                "{\"name\":\"demo\",\"dependencies\":{\"vue\":\"^3.6.0\"}}",
            ),
            source("packages/demo/src/pages/task/[id].vue", "<template/>"),
        ];
        if with_story {
            files.push(source(
                "packages/demo/src/pages/task/task-detail.stories.js",
                "export default { title: 'task' }\n",
            ));
        }
        files
    }

    #[test]
    fn detect_storybook_page_coverage_warns_without_story_nearby() {
        let diagnostics = detect_storybook_page_coverage(&app_pkg_files(false));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "page-missing-story");
        assert!(diagnostics[0].severity == Severity::Warn);
        assert_eq!(
            diagnostics[0].message,
            "[page-coverage] packages/demo/src/pages/task/[id].vue: немає жодної *.stories.js \
             поряд — сторінка app-проєкту без smoke-story (storybook.mdc, хвиля 2a)"
        );
    }

    #[test]
    fn detect_storybook_page_coverage_story_in_same_dir_passes() {
        // Ім'я story НЕ мусить збігатись із basename сторінки — досить "поряд".
        assert!(detect_storybook_page_coverage(&app_pkg_files(true)).is_empty());
    }

    #[test]
    fn detect_storybook_scaffold_reports_missing_files_and_script() {
        let diagnostics = detect_storybook_scaffold(&vue_library_files(3));
        let reasons: Vec<&str> = diagnostics.iter().map(|d| d.reason.as_str()).collect();
        assert_eq!(
            reasons,
            vec![
                "missing-main-js",
                "missing-preview-js",
                "missing-empty-vite-config",
                "missing-vitest-setup-js",
                "missing-storybook-script",
            ]
        );
        assert_eq!(
            diagnostics[0].message,
            "[packages/ui] відсутній .storybook/main.js — канонічний скафолд: npx @7n/rules fix \
             storybook (storybook.mdc)"
        );
        assert_eq!(
            diagnostics[4].message,
            "[packages/ui] package.json#scripts.storybook має бути 'storybook dev -p 6006 \
             --no-open' (зараз: відсутній) — storybook.mdc"
        );
        assert_eq!(
            diagnostics[4].file.as_deref(),
            Some("packages/ui/package.json")
        );
    }

    #[test]
    fn detect_storybook_scaffold_marker_violations_on_partial_files() {
        let mut files = vue_library_files(3);
        // main.js з УСІМА маркерами, крім viteConfigPath.
        files.push(source(
            "packages/ui/.storybook/main.js",
            "// @storybook/vue3-vite viteFinal 'vite-plugin-pages' 'vite-plugin-vue-layouts' \
             'vite-plugin-vue-layouts-next' isVueTransformFamily resolvePluginEntry\n",
        ));
        let diagnostics = detect_storybook_scaffold(&files);
        let main_js_markers: Vec<&Diagnostic> = diagnostics
            .iter()
            .filter(|d| d.reason == "main-js-marker-missing")
            .collect();
        assert_eq!(main_js_markers.len(), 1);
        assert!(main_js_markers[0].message.contains("viteConfigPath"));
        assert!(main_js_markers[0]
            .message
            .starts_with("[packages/ui] .storybook/main.js не відповідає канону — бракує:"));
    }

    #[test]
    fn detect_storybook_scaffold_canonical_package_is_silent() {
        let mut files = vec![
            source(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}",
            ),
            source(
                "packages/ui/package.json",
                "{\"name\":\"ui\",\"peerDependencies\":{\"vue\":\"^3.6.0\"},\"scripts\":{\"storybook\":\"storybook dev -p 6006 --no-open\"}}",
            ),
            source(
                "packages/ui/.storybook/main.js",
                "// @storybook/vue3-vite viteFinal 'vite-plugin-pages' 'vite-plugin-vue-layouts' \
                 'vite-plugin-vue-layouts-next' isVueTransformFamily resolvePluginEntry \
                 viteConfigPath\n",
            ),
            source(
                "packages/ui/.storybook/preview.js",
                "// Quasar iconSet iconMapFn msw-storybook-addon onUnhandledRequest mswLoader\n",
            ),
            source(
                "packages/ui/.storybook/empty-vite.config.js",
                "import { defineConfig } from 'vite'\nexport default defineConfig({})\n",
            ),
            source(
                "packages/ui/.storybook/vitest.setup.js",
                "// setProjectAnnotations beforeAll\n",
            ),
        ];
        for i in 0..3 {
            files.push(source(
                &format!("packages/ui/src/components/Comp{i}.vue"),
                "<template><div/></template>\n",
            ));
        }
        assert!(detect_storybook_scaffold(&files).is_empty());
    }

    #[test]
    fn detect_storybook_ci_reports_both_missing_repo_files() {
        let diagnostics = detect_storybook_ci(&vue_library_files(3));
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].reason, "missing-playwright-action");
        assert_eq!(
            diagnostics[0].message,
            "Відсутній .github/actions/setup-playwright-chromium/action.yml — канонічний \
             Playwright-кеш для vitest storybook-проєкту: npx @7n/rules fix storybook \
             (storybook.mdc, ADR Кластер 5)"
        );
        assert_eq!(diagnostics[1].reason, "missing-storybook-workflow");
    }

    #[test]
    fn detect_storybook_ci_marker_check_and_out_of_scope_silence() {
        // Поза скоупом (немає бібліотек) — тихо, навіть без .github-файлів.
        assert!(detect_storybook_ci(&vue_library_files(2)).is_empty());
        // У скоупі: action без одного маркера + канонічний workflow.
        let mut files = vue_library_files(3);
        files.push(source(
            ".github/actions/setup-playwright-chromium/action.yml",
            "# ms-playwright кеш через actions/cache@v4\n",
        ));
        files.push(source(
            ".github/workflows/lint-storybook.yml",
            "# ./.github/actions/setup-bun-deps ./.github/actions/setup-playwright-chromium \
             vitest --project=storybook\n",
        ));
        let diagnostics = detect_storybook_ci(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "playwright-action-marker-missing");
        assert!(diagnostics[0].message.contains("install лише chromium"));
    }

    // --- батч 6 ---

    /// Бібліотека у скоупі + переданий вміст `vitest.config.mjs` (і, за
    /// потреби, ізольований stryker-конфіг) — спільна фікстура тестів
    /// `test/storybook-vitest-config`.
    fn vitest_config_files(config: &str, with_stryker: bool) -> Vec<SourceFile> {
        let mut files = vue_library_files(3);
        files.push(source("packages/ui/vitest.config.mjs", config));
        if with_stryker {
            files.push(source(
                "packages/ui/vitest.stryker.config.mjs",
                "export default {}\n",
            ));
        }
        files
    }

    #[test]
    fn detect_storybook_vitest_config_reports_missing_config_with_data() {
        let diagnostics = detect_storybook_vitest_config(&vue_library_files(3), None);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "vitest-config-missing");
        assert_eq!(
            diagnostics[0].file.as_deref(),
            Some("packages/ui/vitest.config.mjs")
        );
        let data: serde_json::Value =
            serde_json::from_str(diagnostics[0].data.as_deref().unwrap()).unwrap();
        assert_eq!(data["rootDir"], "packages/ui");
        assert_eq!(data["type"], "library");
    }

    #[test]
    fn detect_storybook_vitest_config_stryker_check_survives_early_returns() {
        // Порт `checkPackage`: early-return-и `checkVitestConfigContent` НЕ
        // скасовують stryker-перевірку (вона в самому `checkPackage`).
        let diagnostics = detect_storybook_vitest_config(
            &vitest_config_files("export default {}\n", false),
            None,
        );
        assert_eq!(
            diagnostics
                .iter()
                .map(|d| d.reason.as_str())
                .collect::<Vec<_>>(),
            vec!["vitest-config-unresolvable", "stryker-config-missing"]
        );
    }

    #[test]
    fn detect_storybook_vitest_config_repo_root_slot_switches_path_form() {
        let files = vitest_config_files(
            "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { \
             globals: true } })\n",
            true,
        );
        // Без слота — repo-relative (задокументована деградація).
        let degraded = detect_storybook_vitest_config(&files, None);
        let data: serde_json::Value =
            serde_json::from_str(degraded[0].data.as_deref().unwrap()).unwrap();
        assert_eq!(data["vitestConfigPath"], "packages/ui/vitest.config.mjs");
        // Зі слотом — абсолютний (саме його споживає JS-фіксер).
        let absolute = detect_storybook_vitest_config(&files, Some("/repo"));
        let data: serde_json::Value =
            serde_json::from_str(absolute[0].data.as_deref().unwrap()).unwrap();
        assert_eq!(
            data["vitestConfigPath"],
            "/repo/packages/ui/vitest.config.mjs"
        );
        assert_eq!(
            absolute
                .iter()
                .map(|d| d.reason.as_str())
                .collect::<Vec<_>>(),
            vec!["unit-project-missing", "storybook-project-missing"]
        );
    }

    #[test]
    fn detect_storybook_vitest_config_flags_dynamic_projects() {
        let diagnostics = detect_storybook_vitest_config(
            &vitest_config_files(
                "import { defineConfig } from 'vitest/config'\nconst projects = []\nexport default \
                 defineConfig({ test: { projects } })\n",
                true,
            ),
            None,
        );
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "projects-dynamic");
    }

    #[test]
    fn detect_storybook_vitest_config_lists_missing_storybook_markers() {
        let diagnostics = detect_storybook_vitest_config(
            &vitest_config_files(
                "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ \
                 test: { projects: [{ name: 'unit' }, { name: 'storybook' }] } })\n",
                true,
            ),
            None,
        );
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "storybook-project-marker-missing");
        // library-гілка: БЕЗ app-специфічних quasar/AutoImport/Pages підказок.
        assert!(diagnostics[0].message.contains("chromium-інстанс"));
        assert!(!diagnostics[0].message.contains("Pages()-плагін"));
    }

    #[test]
    fn detect_storybook_vitest_config_canonical_config_is_silent() {
        let diagnostics = detect_storybook_vitest_config(
            &vitest_config_files(
                "import { defineConfig } from 'vitest/config'\nimport { playwright } from \
                 '@vitest/browser-playwright'\nexport default defineConfig({ test: { projects: [{ \
                 name: 'unit' }, { name: 'storybook', test: { browser: { instances: [{ browser: \
                 'chromium' }], provider: playwright() } }, plugins: [storybookTest({ configDir: \
                 '.storybook' })] }] } })\n",
                true,
            ),
            None,
        );
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_package_json_deny_sorts_messages_and_skips_broken_json() {
        let files = vec![
            source(
                "package.json",
                "{\"dependencies\":{\"pg-format\":\"^1.0.0\",\"mysql2\":\"^3.0.0\"}}",
            ),
            // Невалідний JSON — skip-not-crash (розбіжність 1 секції «Батч 6»).
            source("packages/broken/package.json", "{ not json"),
        ];
        let diagnostics = detect_package_json_deny(&files, &BUN_DB_PACKAGE_JSON_DENY);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics.iter().all(|d| d.reason == POLICY_DENY_REASON));
        assert_eq!(
            diagnostics[0].message,
            "dependencies.mysql2 — заміни на Bun native SQL (js-bun-db.mdc)"
        );
        assert!(diagnostics[1].message.starts_with("dependencies.pg-format"));
    }

    #[test]
    fn detect_package_json_deny_redis_table_matches_nested_files() {
        let files = vec![source(
            "packages/api/package.json",
            "{\"dependencies\":{\"@redis/bloom\":\"^1.0.0\",\"vue\":\"^3.6.0\"}}",
        )];
        let diagnostics = detect_package_json_deny(&files, &REDIS_PACKAGE_JSON_DENY);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].file.as_deref(),
            Some("packages/api/package.json")
        );
        assert!(diagnostics[0].message.contains("Bun native Redis"));
    }

    #[test]
    fn mssql_version_meets_min_matches_rego_semantics() {
        assert!(mssql_version_meets_min("workspace:*"));
        assert!(mssql_version_meets_min("  workspace:^1"));
        assert!(mssql_version_meets_min("^12.5.0"));
        assert!(mssql_version_meets_min(">=12.6.1"));
        assert!(mssql_version_meets_min("13.0.0"));
        assert!(!mssql_version_meets_min("^12.4.9"));
        assert!(!mssql_version_meets_min("^10.0.0"));
        // Менше трьох числових токенів — жодне тіло rego не виводиться.
        assert!(!mssql_version_meets_min("^12.5"));
        assert!(!mssql_version_meets_min("latest"));
    }

    #[test]
    fn detect_mssql_package_json_reports_quoted_range() {
        let files = vec![
            source("package.json", "{\"dependencies\":{\"mssql\":\"^10.0.0\"}}"),
            source(
                "packages/ok/package.json",
                "{\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
            ),
            source(
                "packages/none/package.json",
                "{\"dependencies\":{\"vue\":\"^3.6.0\"}}",
            ),
        ];
        let diagnostics = detect_mssql_package_json(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].message,
            "dependencies.mssql має бути >= 12.5.0 (зараз \"^10.0.0\") (js-mssql.mdc)"
        );
        assert_eq!(diagnostics[0].file.as_deref(), Some("package.json"));
    }

    #[test]
    fn locale_compare_approx_orders_ascii_dirs_like_byte_sort() {
        let mut roots = vec!["packages/ui", "npm", "packages/app"];
        roots.sort_by(|a, b| locale_compare_approx(a, b));
        assert_eq!(roots, vec!["npm", "packages/app", "packages/ui"]);
    }

    // --- маніфест ---

    #[test]
    fn build_manifest_declares_all_thirty_three_concerns_with_expected_scopes() {
        let manifest = build_manifest();
        // Задача Q4 батч 4: `CONCERN_REDIS_IMPORTS`/`CONCERN_MSSQL_DEPS`/
        // `CONCERN_BUN_DB_SAFETY` тепер У контрибуції (AST-порти, де-скоуп
        // батчу 2 знято — доккомент модуля вище). Батч 5 додає п'ять
        // концернів storybook-сімейства (доккомент секції «Батч 5»), батч 6 —
        // `test/storybook-vitest-config` і три rego-порти `*/package_json`
        // (доккомент секції «Батч 6»), батч 7 — чотири `npm-module/*` і
        // `js/dep-policy` (доккомент секції «Батч 7»), батч 8 — `bun/layout`,
        // `style/tooling`, `test/sandbox-aware-test` і
        // `test/vitest-api-conventions` (доккомент секції «Батч 8»), батч 9 —
        // `vue/packages` (доккомент секції «Батч 9»).
        assert_eq!(manifest.concerns.len(), 33);
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
            CONCERN_REDIS_IMPORTS,
            CONCERN_MSSQL_DEPS,
            CONCERN_BUN_DB_SAFETY,
            CONCERN_STORYBOOK_SCOPE,
            CONCERN_STORYBOOK_HYGIENE,
            CONCERN_STORYBOOK_PAGE_COVERAGE,
            CONCERN_STORYBOOK_SCAFFOLD,
            CONCERN_STORYBOOK_CI,
            CONCERN_STORYBOOK_VITEST_CONFIG,
            CONCERN_BUN_DB_PACKAGE_JSON,
            CONCERN_REDIS_PACKAGE_JSON,
            CONCERN_MSSQL_PACKAGE_JSON,
            CONCERN_RULE_META,
            CONCERN_SKILL_META,
            CONCERN_HEADER_DOC_POINTER,
            CONCERN_PACKAGE_STRUCTURE,
            CONCERN_DEP_POLICY,
            CONCERN_BUN_LAYOUT,
            CONCERN_STYLE_TOOLING,
            CONCERN_SANDBOX_AWARE_TEST,
            CONCERN_VITEST_API_CONVENTIONS,
            CONCERN_VUE_PACKAGES,
        ] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .unwrap_or_else(|| panic!("{key} contribution має бути в маніфесті"));
            assert_eq!(contribution.scope, ConcernScope::Full);
            assert!(!contribution.glob.is_empty());
        }
        // Батч 6: rego-порти ходять ЛИШЕ по `**/package.json` (дзеркало
        // `policy.files.walkGlob` їхніх `concern.json`), а
        // `storybook-vitest-config` — по scope-детекції плюс самі конфіги.
        for key in [
            CONCERN_BUN_DB_PACKAGE_JSON,
            CONCERN_REDIS_PACKAGE_JSON,
            CONCERN_MSSQL_PACKAGE_JSON,
        ] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .expect("контрибуція є (перевірено вище)");
            assert_eq!(contribution.glob, vec!["**/package.json".to_string()]);
        }
        let vitest_config = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_STORYBOOK_VITEST_CONFIG)
            .expect("контрибуція є (перевірено вище)");
        assert!(vitest_config.glob.iter().any(|g| g == ".n-rules.json"));
        assert!(vitest_config
            .glob
            .iter()
            .any(|g| g == "**/vitest.config.mjs"));
        assert!(vitest_config
            .glob
            .iter()
            .any(|g| g == "**/vitest.stryker.config.*"));
        // Глоби storybook-сімейства (батч 5) мусять покривати `.n-rules.json`
        // і `**/package.json` — без них optOut/workspace-розгортання порту
        // «сліпі» (доккомент build_manifest, секція про ширші глоби).
        for key in [
            CONCERN_STORYBOOK_SCOPE,
            CONCERN_STORYBOOK_HYGIENE,
            CONCERN_STORYBOOK_PAGE_COVERAGE,
            CONCERN_STORYBOOK_SCAFFOLD,
            CONCERN_STORYBOOK_CI,
        ] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .expect("контрибуція є (перевірено вище)");
            assert!(contribution.glob.iter().any(|g| g == ".n-rules.json"));
            assert!(contribution.glob.iter().any(|g| g == "**/package.json"));
        }
        // Глоби трьох AST-концернів батчу 4 мусять покривати package.json —
        // гейт «кореневий package.json існує» інакше ніколи не пройде.
        for key in [
            CONCERN_REDIS_IMPORTS,
            CONCERN_MSSQL_DEPS,
            CONCERN_BUN_DB_SAFETY,
        ] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .expect("контрибуція є (перевірено вище)");
            assert!(contribution.glob.iter().any(|g| g.contains("package.json")));
        }
        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
        assert_eq!(manifest.domains, vec![Domain::Lint]);
    }

    /// `plugin.toml` — статичний дублікат `describe()` (доккомент самого
    /// файлу). Батч 6 оновив `build_manifest`, але НЕ `plugin.toml` — файл
    /// проїхав із дев'ятнадцятьма контрибуціями проти двадцяти трьох у
    /// рантаймі, і ніщо про це не сигналило. Цей тест — гейт від повторення:
    /// набір `key = "…"` у маніфесті-довіднику мусить точно збігатись із
    /// набором ключів `describe()`. Парсер навмисно примітивний (рядки
    /// `key = "..."`), щоб не тягнути toml-залежність у крейт.
    #[test]
    fn plugin_toml_concern_keys_match_describe() {
        let toml_src = include_str!("../plugin.toml");
        let mut declared: Vec<&str> = toml_src
            .lines()
            .filter_map(|line| line.trim().strip_prefix("key = \""))
            .filter_map(|rest| rest.strip_suffix('"'))
            .collect();
        declared.sort_unstable();
        let mut runtime: Vec<String> = build_manifest()
            .concerns
            .into_iter()
            .map(|c| c.key)
            .collect();
        runtime.sort();
        assert_eq!(
            declared,
            runtime.iter().map(String::as_str).collect::<Vec<_>>(),
            "plugin.toml розійшовся з describe() — синхронізуй маніфест-довідник"
        );
    }

    // --- батч 7: `npm-module/*` + `js/dep-policy` ---

    /// Компактний конструктор елемента батча для тестів батчу 7 (фікстури
    /// цього кластера — це десятки дрібних файлів, інлайнити `SourceFile {}`
    /// щоразу нечитабельно).
    fn src(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn batch_child_dirs_skips_plain_files_and_dot_dirs() {
        let files = vec![
            src("npm/rules/README.md", ""),
            src("npm/rules/.cache/x.json", ""),
            src("npm/rules/zeta/main.json", ""),
            src("npm/rules/alpha/js/deep.mjs", ""),
        ];
        assert_eq!(batch_child_dirs(&files, "npm/rules"), vec!["alpha", "zeta"]);
    }

    #[test]
    fn batch_dir_entries_returns_only_direct_children() {
        let files = vec![
            src("a/js/one.mjs", ""),
            src("a/js/docs/one.md", ""),
            src("a/other.mjs", ""),
        ];
        let entries: Vec<&str> = batch_dir_entries(&files, "a/js")
            .into_iter()
            .map(|f| f.path.as_str())
            .collect();
        assert_eq!(entries, vec!["a/js/one.mjs"]);
    }

    #[test]
    fn js_string_is_blank_mirrors_js_string_semantics() {
        // `String(null)` === "null" (непорожньо), але `[null]` join-иться в "".
        assert!(!js_string_is_blank(&serde_json::json!(null)));
        assert!(js_string_is_blank(&serde_json::json!([null])));
        assert!(js_string_is_blank(&serde_json::json!([])));
        assert!(js_string_is_blank(&serde_json::json!("   ")));
        // Два елементи → join(',') завжди дає кому → непорожньо.
        assert!(!js_string_is_blank(&serde_json::json!([null, null])));
        assert!(!js_string_is_blank(&serde_json::json!({})));
        assert!(!js_string_is_blank(&serde_json::json!(0)));
    }

    #[test]
    fn parse_rule_auto_spec_covers_all_four_shapes() {
        assert!(parse_rule_auto_spec(&serde_json::json!("завжди")).is_some());
        assert!(parse_rule_auto_spec(&serde_json::json!(["n-js"])).is_some());
        assert!(parse_rule_auto_spec(&serde_json::json!({ "glob": "src/**" })).is_some());
        assert_eq!(
            parse_rule_auto_spec(&serde_json::json!({ "predicate": "repoUrlMarker" })),
            Some(Some("repoUrlMarker".to_string()))
        );
        assert!(parse_rule_auto_spec(&serde_json::json!([])).is_none());
        assert!(parse_rule_auto_spec(&serde_json::json!({ "glob": [] })).is_none());
        assert!(parse_rule_auto_spec(&serde_json::json!({ "predicate": "" })).is_none());
        assert!(parse_rule_auto_spec(&serde_json::json!(7)).is_none());
    }

    #[test]
    fn detect_rule_meta_reports_missing_mdc_and_residual_auto_md_in_order() {
        let files = vec![
            src("npm/rules/n-js/auto.md", "завжди\n"),
            src("npm/rules/n-js/main.json", r#"{"auto": "завжди"}"#),
        ];
        let diagnostics = detect_rule_meta(&files);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics[0].message.contains("залишковий auto.md"));
        assert!(diagnostics[1].message.contains("відсутній main.mdc"));
        assert_eq!(diagnostics[0].reason, RULE_META_REASON);
    }

    #[test]
    fn detect_skill_meta_emits_all_field_violations_in_canonical_order() {
        let files = vec![src(
            "npm/skills/n-lint/main.json",
            r#"{"worktree": "yes", "auto": [], "requireRoot": "no", "tier": "ultra"}"#,
        )];
        let diagnostics = detect_skill_meta(&files);
        let messages: Vec<&str> = diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .map(|m| m.split(": ").nth(1).unwrap_or(m))
            .collect();
        assert_eq!(
            messages,
            vec![
                "main.json.worktree має бути boolean",
                "main.json.auto нерозпізнане — очікується \"завжди\" або непорожній масив правил",
                "main.json.requireRoot має бути boolean",
                "main.json.tier має бути \"min\" | \"avg\" | \"max\"",
            ]
        );
    }

    #[test]
    fn module_jsdoc_stops_at_first_import_or_export_line() {
        assert_eq!(
            module_jsdoc("/** pointer */\nexport const a = 1\n").as_deref(),
            Some("/** pointer */")
        );
        // JSDoc ПІСЛЯ першого `export` — не module-level (regex-межа канону).
        assert!(module_jsdoc("export const a = 1\n/** пізно */\n").is_none());
    }

    #[test]
    fn jsdoc_content_line_count_strips_star_indent() {
        assert_eq!(jsdoc_content_line_count("/** pointer */"), 0);
        assert_eq!(jsdoc_content_line_count("/**\n * один\n */"), 1);
        assert_eq!(jsdoc_content_line_count("/**\n * один\n *\n * два\n */"), 2);
    }

    #[test]
    fn glob_to_regex_ports_globstar_braces_and_specials() {
        let re = glob_to_regex("**/*.test.mjs").expect("валідний glob");
        assert!(re.is_match("a/b/x.test.mjs"));
        assert!(re.is_match("x.test.mjs"));
        assert!(!re.is_match("x.mjs"));
        let braces = glob_to_regex("*.{png,jpg}").expect("валідний glob");
        assert!(braces.is_match("a.png"));
        assert!(braces.is_match("a.jpg"));
        assert!(!braces.is_match("a.gif"));
        let nested = glob_to_regex("**/fixtures/**").expect("валідний glob");
        assert!(nested.is_match("rules/x/fixtures/y.json"));
        assert!(!nested.is_match("rules/x/tests/y.json"));
    }

    #[test]
    fn classify_published_file_carves_out_rule_name_segment() {
        let files = vec![src("npm/rules/test/main.mdc", "")];
        // `rules/<rule-name>/…` — сегмент з індексом 1 не є test-каталогом.
        assert!(classify_published_file_as_test(&files, "rules/test/main.mdc").is_none());
        assert_eq!(
            classify_published_file_as_test(&files, "rules/n-js/tests/x.json"),
            Some("test-style каталог \"tests/\"".to_string())
        );
    }

    #[test]
    fn find_test_framework_import_prefers_static_over_walk() {
        let content = "const a = require('mocha')\nimport { test } from 'vitest'\n";
        assert_eq!(
            find_test_framework_import(content, "x.mjs"),
            Some("vitest".to_string())
        );
        assert_eq!(
            find_test_framework_import("// import { it } from 'vitest'\n", "x.mjs"),
            None
        );
    }

    #[test]
    fn extract_import_sources_puts_static_imports_before_walk_hits() {
        // Регресія батчу 7: `require` НА РЯДОК ВИЩЕ статичного імпорту, а
        // JS-канон однаково віддає статичний першим (двофазний порядок).
        let sources = extract_import_sources(
            "const legacy = require('a')\nimport b from 'x'\nexport const c = [legacy, b]\n",
            "mix.mjs",
        );
        assert_eq!(sources, vec!["x".to_string(), "a".to_string()]);
    }

    #[test]
    fn detect_dep_policy_ignores_comments_strings_and_subpaths() {
        let files = vec![src(
            "src/noise.mjs",
            "// import x from 'ua-parser-js'\nexport const s = \"ua-parser-js\"\n\
             import ok from 'ua-parser-js/helpers'\nexport const o = ok\n",
        )];
        assert!(detect_dep_policy(&files).is_empty());
        let hit = vec![src("src/ua.mjs", "import p from 'ua-parser-js'\n")];
        let diagnostics = detect_dep_policy(&hit);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, DEP_POLICY_REASON);
        assert!(diagnostics[0]
            .message
            .starts_with("src/ua.mjs: заборонений"));
    }

    // --- Батч 8: bun/layout ---

    /// Мінімально «чистий» корінь: обидва обовʼязкові файли на місці, жодного
    /// забороненого — нуль діагностик.
    fn bun_layout_clean_root() -> Vec<SourceFile> {
        vec![
            src("bun.lock", ""),
            src("bunfig.toml", "[install]\nlinker = \"hoisted\"\n"),
            src("package.json", "{}\n"),
        ]
    }

    #[test]
    fn detect_bun_layout_passes_on_canonical_root() {
        assert!(detect_bun_layout(&bun_layout_clean_root()).is_empty());
    }

    #[test]
    fn detect_bun_layout_flags_each_forbidden_lockfile_in_declared_order() {
        let mut files = bun_layout_clean_root();
        files.push(src("yarn.lock", ""));
        files.push(src("package-lock.json", "{}"));
        let diagnostics = detect_bun_layout(&files);
        let messages: Vec<&str> = diagnostics.iter().map(|d| d.message.as_str()).collect();
        assert_eq!(
            messages,
            vec![
                "Знайдено заборонений файл: package-lock.json — видали його",
                "Знайдено заборонений файл: yarn.lock — видали його",
            ]
        );
        assert!(diagnostics.iter().all(|d| d.reason == BUN_LAYOUT_REASON));
        assert!(diagnostics.iter().all(|d| d.file.is_none()));
    }

    #[test]
    fn detect_bun_layout_flags_yarn_dir_reconstructed_from_batch() {
        let mut files = bun_layout_clean_root();
        files.push(src(".yarn/cache/foo.zip", ""));
        let diagnostics = detect_bun_layout(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].message,
            "Знайдено директорію .yarn — видали її"
        );
    }

    #[test]
    fn detect_bun_layout_flags_missing_required_files() {
        let diagnostics = detect_bun_layout(&[]);
        let messages: Vec<&str> = diagnostics.iter().map(|d| d.message.as_str()).collect();
        assert_eq!(
            messages,
            vec![
                "Відсутній bun.lock — запусти bun i",
                "Відсутній bunfig.toml — створи з [install] linker = \"hoisted\" (bun.mdc)",
                "Відсутній package.json у корені",
            ]
        );
    }

    #[test]
    fn detect_bun_layout_ignores_nested_lockfiles() {
        // Глоби контрибуції кореневі — вкладений `sub/yarn.lock` у батч не
        // потрапляє; тут перевіряємо, що навіть якби потрапив, детектор
        // порівнює ПОВНИЙ шлях, як `existsSync(join(cwd, f))`.
        let mut files = bun_layout_clean_root();
        files.push(src("sub/yarn.lock", ""));
        assert!(detect_bun_layout(&files).is_empty());
    }

    // --- Батч 8: style/tooling ---

    #[test]
    fn detect_style_tooling_passes_with_field_and_dist_ignore() {
        let files = vec![
            src(
                "package.json",
                "{ \"stylelint\": { \"extends\": \"@nitra/stylelint-config\" } }",
            ),
            src(".stylelintignore", "dist/\n"),
        ];
        assert!(detect_style_tooling(&files).is_empty());
    }

    #[test]
    fn detect_style_tooling_accepts_external_config_file() {
        let files = vec![
            src("package.json", "{}"),
            src("stylelint.config.mjs", "export default {}\n"),
            src(".stylelintignore", "  dist/  \n"),
        ];
        assert!(detect_style_tooling(&files).is_empty());
    }

    #[test]
    fn detect_style_tooling_flags_missing_config_and_ignore_file() {
        let files = vec![src("package.json", "{}")];
        let diagnostics = detect_style_tooling(&files);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics[0]
            .message
            .starts_with("Немає конфігу stylelint"));
        assert_eq!(
            diagnostics[1].message,
            ".stylelintignore не існує — створи з вмістом: dist/"
        );
        assert!(diagnostics.iter().all(|d| d.reason == STYLE_TOOLING_REASON));
    }

    #[test]
    fn detect_style_tooling_flags_ignore_without_dist_line() {
        let files = vec![
            src("package.json", "{ \"stylelint\": {} }"),
            src(".stylelintignore", "build/\ncoverage/\n"),
        ];
        let diagnostics = detect_style_tooling(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].message,
            ".stylelintignore не містить рядка dist/ — додай його (style.mdc)"
        );
    }

    #[test]
    fn detect_style_tooling_skips_config_check_without_root_package_json() {
        // Без кореневого `package.json` JS-канон робить `return` ДО будь-якого
        // `fail` — лишається тільки `.stylelintignore`-гілка.
        let files = vec![src(".stylelintignore", "dist/\n")];
        assert!(detect_style_tooling(&files).is_empty());
    }

    #[test]
    fn detect_style_tooling_treats_non_object_stylelint_field_as_absent() {
        // `pkg.stylelint && typeof pkg.stylelint === 'object'` — рядок falsy
        // для цієї умови, масив — truthy (`typeof [] === 'object'`).
        let string_field = vec![
            src(
                "package.json",
                "{ \"stylelint\": \"@nitra/stylelint-config\" }",
            ),
            src(".stylelintignore", "dist/\n"),
        ];
        assert_eq!(detect_style_tooling(&string_field).len(), 1);
        let array_field = vec![
            src("package.json", "{ \"stylelint\": [] }"),
            src(".stylelintignore", "dist/\n"),
        ];
        assert!(detect_style_tooling(&array_field).is_empty());
    }

    // --- Батч 8: test/sandbox-aware-test ---

    /// Тіло з `import.meta.dirname` і чотирма `'..'`-літералами у вікні.
    const DEEP_NAV_BODY: &str =
        "import { join } from 'node:path'\nconst root = join(import.meta.dirname, '..', '..', '..', '..')\n";

    #[test]
    fn detect_sandbox_aware_test_flags_unguarded_deep_navigation() {
        let files = vec![src("tests/deep.test.mjs", DEEP_NAV_BODY)];
        let diagnostics = detect_sandbox_aware_test(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, SANDBOX_AWARE_TEST_REASON);
        assert!(diagnostics[0].file.is_none());
        assert!(diagnostics[0].message.starts_with("tests/deep.test.mjs: "));
        assert!(diagnostics[0].message.contains("withTmpDir()"));
    }

    #[test]
    fn detect_sandbox_aware_test_accepts_with_tmp_dir_guard() {
        let body = format!("{DEEP_NAV_BODY}await withTmpDir(async dir => {{}})\n");
        let files = vec![src("tests/deep.test.mjs", &body)];
        assert!(detect_sandbox_aware_test(&files).is_empty());
    }

    #[test]
    fn detect_sandbox_aware_test_accepts_stryker_skip_if_guard() {
        for guard in [
            "test.skipIf(env.STRYKER_MUTATOR_WORKER)('x', () => {})\n",
            "test.skipIf( process.env.STRYKER_MUTATOR_WORKER )('x', () => {})\n",
        ] {
            let body = format!("{DEEP_NAV_BODY}{guard}");
            let files = vec![src("tests/deep.test.mjs", &body)];
            assert!(
                detect_sandbox_aware_test(&files).is_empty(),
                "guard: {guard}"
            );
        }
    }

    #[test]
    fn detect_sandbox_aware_test_ignores_shallow_navigation() {
        let files = vec![src(
            "tests/shallow.test.mjs",
            "const root = join(import.meta.dirname, '..', '..', '..')\n",
        )];
        assert!(detect_sandbox_aware_test(&files).is_empty());
    }

    #[test]
    fn detect_sandbox_aware_test_ignores_dots_outside_window() {
        // `'..'`-літерали далі за 400 байтів від вживання `import.meta.*` у
        // вікно не потрапляють — точний порт `body.slice(i, i + 400)`.
        let filler = "x".repeat(420);
        let body = format!(
            "const d = import.meta.dirname\n// {filler}\nconst r = join(d, '..', '..', '..', '..')\n"
        );
        let files = vec![src("tests/far.test.mjs", &body)];
        assert!(detect_sandbox_aware_test(&files).is_empty());
    }

    #[test]
    fn detect_sandbox_aware_test_ignores_non_test_files() {
        let files = vec![src("src/deep.mjs", DEEP_NAV_BODY)];
        assert!(detect_sandbox_aware_test(&files).is_empty());
    }

    #[test]
    fn has_deep_meta_navigation_does_not_panic_on_multibyte_window_edge() {
        // Розбіжність 4 секції «Батч 8»: вікно ріжеться по БАЙТАХ, тож межа
        // може впасти всередину кириличного символу — [`clamp_to_char_boundary`]
        // мусить це витримати.
        let nav_re = regex::Regex::new(IMPORT_META_NAV_PATTERN).unwrap();
        let dots_re = regex::Regex::new(DOT_DOT_LITERAL_PATTERN).unwrap();
        let body = format!("import.meta.url{}", "ї".repeat(300));
        assert!(!has_deep_meta_navigation(&body, &nav_re, &dots_re));
    }

    // --- Батч 8: test/vitest-api-conventions ---

    #[test]
    fn detect_vitest_api_conventions_flags_object_and_array_literals() {
        let files = vec![src(
            "tests/api.test.mjs",
            "expect(a).toBe({ x: 1 })\nexpect(b).toBe([1, 2])\n",
        )];
        let diagnostics = detect_vitest_api_conventions(&files);
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].reason, VITEST_API_CONVENTIONS_REASON);
        assert_eq!(diagnostics[0].file.as_deref(), Some("tests/api.test.mjs"));
        assert!(diagnostics[0]
            .message
            .starts_with("tests/api.test.mjs:1: expect(...).toBe(...)"));
        assert!(diagnostics[1]
            .message
            .starts_with("tests/api.test.mjs:2: expect(...).toBe(...)"));
    }

    #[test]
    fn detect_vitest_api_conventions_ignores_chained_literal_result() {
        // `.toBe([...].join('\n'))` — результат `.join()` рядок-примітив,
        // не масив-посилання; після літерала стоїть НЕ `)`.
        let files = vec![src(
            "tests/api.test.mjs",
            "expect(a).toBe(['x', 'y'].join('\\n'))\n",
        )];
        assert!(detect_vitest_api_conventions(&files).is_empty());
    }

    #[test]
    fn detect_vitest_api_conventions_ignores_primitive_arguments() {
        let files = vec![src(
            "tests/api.test.mjs",
            "expect(a).toBe(1)\nexpect(b).toBe('x')\nexpect(c).toBe(undefined)\n",
        )];
        assert!(detect_vitest_api_conventions(&files).is_empty());
    }

    #[test]
    fn detect_vitest_api_conventions_survives_brackets_inside_string_literals() {
        let files = vec![src(
            "tests/api.test.mjs",
            "expect(a).toBe({ s: '}', t: \"]\", u: `}` })\n",
        )];
        assert_eq!(detect_vitest_api_conventions(&files).len(), 1);
    }

    #[test]
    fn detect_vitest_api_conventions_skips_unbalanced_brackets() {
        let files = vec![src("tests/api.test.mjs", "expect(a).toBe({ x: 1\n")];
        assert!(detect_vitest_api_conventions(&files).is_empty());
    }

    #[test]
    fn detect_vitest_api_conventions_allows_whitespace_around_literal() {
        let files = vec![src(
            "tests/api.test.mjs",
            "expect(a).toBe(\n  { x: 1 }\n)\n",
        )];
        let diagnostics = detect_vitest_api_conventions(&files);
        assert_eq!(diagnostics.len(), 1);
        // Рядок рахується від позиції `.toBe(`, не від літерала.
        assert!(diagnostics[0].message.starts_with("tests/api.test.mjs:1:"));
    }

    #[test]
    fn detect_vitest_api_conventions_ignores_non_test_files() {
        let files = vec![src("src/api.mjs", "expect(a).toBe({ x: 1 })\n")];
        assert!(detect_vitest_api_conventions(&files).is_empty());
    }

    #[test]
    fn find_matching_bracket_end_handles_escaped_quote() {
        let body = b"{ s: 'a\\'}' }";
        assert_eq!(find_matching_bracket_end(body, 0), Some(body.len()));
    }

    // -----------------------------------------------------------------
    // Батч 9 — `vue/packages`

    /// Канонічний `vite.config.js` Vue-додатка: усі токени на місці, жодної
    /// згадки `esbuild`, `AutoImport` містить `'vue'` (тобто заборона явних
    /// value-імпортів АКТИВНА).
    const CLEAN_VITE_CONFIG: &str = "\
import AutoImport from 'unplugin-auto-import/vite'\n\
import VueMacros from 'unplugin-vue-macros/vite'\n\
export default { css: { transformer: 'lightningcss' }, \
plugins: [VueMacros({}), AutoImport({ imports: ['vue'] })] }\n";

    /// Чистий Vue-репозиторій з одним пакетом у корені (жодного порушення).
    fn vue_pkg_files() -> Vec<SourceFile> {
        vec![
            src(
                "package.json",
                "{\"name\":\"app\",\"dependencies\":{\"vue\":\"^3.6.0\"},\
                 \"devDependencies\":{\"vitest\":\"1\",\"@vitest/coverage-v8\":\"1\",\
                 \"@stryker-mutator/vitest-runner\":\"1\"}}",
            ),
            src(
                ".vscode/extensions.json",
                "{\"recommendations\":[\"Vue.volar\"]}",
            ),
            src("jsconfig.json", "{}"),
            src(
                "src/vite-env.d.ts",
                "/// <reference types=\"vite/client\" />\n",
            ),
            src("vite.config.js", CLEAN_VITE_CONFIG),
        ]
    }

    #[test]
    fn detect_vue_packages_clean_repo_has_no_diagnostics() {
        assert!(detect_vue_packages(&vue_pkg_files()).is_empty());
    }

    #[test]
    fn detect_vue_packages_skips_repo_without_vue_dependency() {
        let files = vec![src("package.json", "{\"name\":\"app\"}")];
        assert!(detect_vue_packages(&files).is_empty());
    }

    #[test]
    fn detect_vue_packages_reports_missing_volar_recommendation() {
        let mut files = vue_pkg_files();
        files.retain(|f| f.path != ".vscode/extensions.json");
        let diagnostics = detect_vue_packages(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, VUE_PACKAGES_REASON);
        assert_eq!(
            diagnostics[0].message,
            ".vscode/extensions.json не існує (для Vue-проєкту потрібна рекомендація Vue.volar)"
        );
    }

    #[test]
    fn detect_vue_packages_reports_each_missing_root_vitest_dev_dep() {
        let mut files = vue_pkg_files();
        files[0] = src(
            "package.json",
            "{\"name\":\"app\",\"dependencies\":{\"vue\":\"^3.6.0\"},\
             \"devDependencies\":{\"vitest\":\"1\"}}",
        );
        let diagnostics = detect_vue_packages(&files);
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(
            diagnostics[0].message,
            "vue: кореневий devDependencies не містить '@vitest/coverage-v8' — перенеси з Vue \
             workspace у корінь монорепо (vue.mdc testing)"
        );
        assert!(diagnostics[1]
            .message
            .contains("'@stryker-mutator/vitest-runner'"));
    }

    #[test]
    fn detect_vue_packages_reports_missing_vite_env_and_stops_that_check() {
        let mut files = vue_pkg_files();
        files.retain(|f| f.path != "src/vite-env.d.ts");
        let diagnostics = detect_vue_packages(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].message,
            "[корінь] немає src/vite-env.d.ts — додай файл з рядком \
             /// <reference types=\"vite/client\" /> (інакше TS/Volar не бачать типів для \
             імпортів асетів: png, avif, css як URL)."
        );
    }

    #[test]
    fn detect_vue_packages_reports_missing_jsconfig() {
        let mut files = vue_pkg_files();
        files.retain(|f| f.path != "jsconfig.json");
        let diagnostics = detect_vue_packages(&files);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .starts_with("[корінь] немає jsconfig.json у корені пакета"));
    }

    #[test]
    fn detect_vue_packages_reports_vite_config_gaps() {
        let mut files = vue_pkg_files();
        files[4] = src("vite.config.js", "export default {}\n");
        let messages: Vec<String> = detect_vue_packages(&files)
            .into_iter()
            .map(|d| d.message)
            .collect();
        assert_eq!(messages.len(), 3);
        assert!(messages[0].contains("не містить css: { transformer: 'lightningcss' }"));
        assert_eq!(messages[1], "[корінь] vite.config.js не містить VueMacros");
        assert_eq!(messages[2], "[корінь] vite.config.js не містить AutoImport");
    }

    #[test]
    fn detect_vue_packages_reports_auto_import_without_vue() {
        let mut files = vue_pkg_files();
        files[4] = src(
            "vite.config.js",
            "export default { css: { transformer: 'lightningcss' }, \
             plugins: [VueMacros({}), AutoImport({ imports: ['quasar'] })] }\n",
        );
        let diagnostics = detect_vue_packages(&files);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .contains("AutoImport не містить 'vue' у imports"));
    }

    #[test]
    fn detect_vue_packages_flags_explicit_vue_value_import() {
        let mut files = vue_pkg_files();
        files.push(src(
            "src/Page.vue",
            "<template><div /></template>\n<script setup>\nimport { ref } from 'vue'\n</script>\n",
        ));
        let diagnostics = detect_vue_packages(&files);
        assert_eq!(diagnostics.len(), 1);
        // Рядок — по ВИТЯГНУТОМУ script-блоку, не по сирому SFC (доккомент секції).
        assert_eq!(
            diagnostics[0].message,
            "[корінь] src/Page.vue:2 — прибери явний value-імпорт з 'vue' \
             (unplugin-auto-import): import { ref } from 'vue'"
        );
    }

    #[test]
    fn detect_vue_packages_allows_type_only_and_side_effect_vue_imports() {
        let mut files = vue_pkg_files();
        files.push(src(
            "src/types.ts",
            "import type { Ref } from 'vue'\nimport { type ComputedRef } from 'vue'\nimport 'vue'\n",
        ));
        assert!(detect_vue_packages(&files).is_empty());
    }

    #[test]
    fn detect_vue_packages_skips_vue_import_check_for_test_files_and_dts() {
        let mut files = vue_pkg_files();
        files.push(src("src/a.test.ts", "import { ref } from 'vue'\n"));
        files.push(src("src/auto-imports.d.ts", "import { ref } from 'vue'\n"));
        files.push(src("src/__tests__/b.ts", "import { ref } from 'vue'\n"));
        assert!(detect_vue_packages(&files).is_empty());
    }

    #[test]
    fn detect_vue_packages_flags_node_builtin_import_in_vue_sfc() {
        let mut files = vue_pkg_files();
        files.push(src(
            "src/Bad.vue",
            "<script setup>\nimport { readFile } from 'node:fs/promises'\n</script>\n",
        ));
        let diagnostics = detect_vue_packages(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].message,
            "[корінь] src/Bad.vue:2 — імпорт Node-нативного модуля 'node:fs/promises' у .vue \
             заборонено (SFC виконується в браузері, Node API недоступне). Винеси логіку у \
             server-side утіліту. Фрагмент: import { readFile } from 'node:fs/promises'"
        );
    }

    #[test]
    fn detect_vue_packages_ignores_node_builtin_import_outside_vue() {
        let mut files = vue_pkg_files();
        files.push(src("src/server.ts", "import { join } from 'node:path'\n"));
        assert!(detect_vue_packages(&files).is_empty());
    }

    #[test]
    fn detect_vue_packages_flags_esbuild_mentions_with_line_and_snippet() {
        let mut files = vue_pkg_files();
        files.push(src(
            "docs/build.md",
            "# Збірка\n\nМи використовуємо esbuild.\n",
        ));
        let diagnostics = detect_vue_packages(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].message,
            "[корінь] docs/build.md:3 — знайдено 'esbuild'. Замінити на 'rolldown'. \
             Фрагмент: Ми використовуємо esbuild."
        );
    }

    #[test]
    fn detect_vue_packages_esbuild_scan_skips_lockfiles_and_node_modules() {
        let mut files = vue_pkg_files();
        files.push(src("bun.lock", "esbuild\n"));
        files.push(src("node_modules/x/index.js", "esbuild\n"));
        assert!(detect_vue_packages(&files).is_empty());
    }

    #[test]
    fn detect_vue_packages_esbuild_scan_caps_at_thirty_matches() {
        let mut files = vue_pkg_files();
        let body: String = (0..40).map(|_| "esbuild\n").collect();
        files.push(src("notes.md", &body));
        let diagnostics = detect_vue_packages(&files);
        // 30 знахідок + підсумкова «показано перші 30».
        assert_eq!(diagnostics.len(), ESBUILD_MAX_MATCHES + 1);
        assert_eq!(
            diagnostics[ESBUILD_MAX_MATCHES].message,
            "[корінь] показано перші 30 збігів 'esbuild' (замінити на 'rolldown')"
        );
    }

    #[test]
    fn detect_vue_packages_component_library_skips_auto_import_requirements() {
        let mut files = vue_pkg_files();
        files[0] = src(
            "package.json",
            "{\"name\":\"ui\",\"dependencies\":{\"vue\":\"^3.6.0\"},\
             \"peerDependencies\":{\"vue\":\"^3.6.0\"},\
             \"devDependencies\":{\"vitest\":\"1\",\"@vitest/coverage-v8\":\"1\",\
             \"@stryker-mutator/vitest-runner\":\"1\"}}",
        );
        files[4] = src("vite.config.js", "export default {}\n");
        // Бібліотека компонентів: ні lightningcss, ні VueMacros/AutoImport не вимагаються…
        files.push(src(
            "src/Widget.vue",
            "<script setup>\nimport { ref } from 'vue'\n</script>\n",
        ));
        // …і явний value-імпорт з 'vue' дозволений.
        assert!(detect_vue_packages(&files).is_empty());
    }

    #[test]
    fn detect_vue_packages_prefixes_messages_with_workspace_dir() {
        let files = vec![
            src(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"],\
                 \"devDependencies\":{\"vitest\":\"1\",\"@vitest/coverage-v8\":\"1\",\
                 \"@stryker-mutator/vitest-runner\":\"1\"}}",
            ),
            src(
                ".vscode/extensions.json",
                "{\"recommendations\":[\"Vue.volar\"]}",
            ),
            src(
                "packages/site/package.json",
                "{\"name\":\"site\",\"dependencies\":{\"vue\":\"^3.6.0\"}}",
            ),
        ];
        let diagnostics = detect_vue_packages(&files);
        assert!(diagnostics
            .iter()
            .all(|d| d.message.starts_with("[packages/site] ")));
    }

    #[test]
    fn is_vue_import_scan_source_file_matches_source_file_re() {
        for path in [
            "a.vue", "a.js", "a.jsx", "a.ts", "a.tsx", "a.mjs", "a.cjs", "a.mts", "a.cts", "a.ctsx",
        ] {
            assert!(is_vue_import_scan_source_file(path), "{path}");
        }
        for path in ["a.json", "a.md", "a.scss", "ajs", "a.d", "ats"] {
            assert!(!is_vue_import_scan_source_file(path), "{path}");
        }
    }

    #[test]
    fn extract_auto_import_call_args_balances_nested_parens() {
        assert_eq!(
            extract_auto_import_call_args("AutoImport({ resolvers: [f()], imports: ['vue'] })"),
            Some("{ resolvers: [f()], imports: ['vue'] }")
        );
        // Незбалансовані дужки → None (перевірка `'vue'` просто пропускається).
        assert_eq!(extract_auto_import_call_args("AutoImport({ a: 1"), None);
        assert!(!vite_config_has_vue_in_auto_imports(
            "AutoImport({ imports: ['quasar'] })"
        ));
        assert!(vite_config_has_vue_in_auto_imports(
            "AutoImport({ imports: [\"vue\"] })"
        ));
    }

    #[test]
    fn normalize_snippet_160_collapses_whitespace_and_truncates() {
        assert_eq!(
            normalize_snippet_160("  import {\n  ref\n} from 'vue'  "),
            "import { ref } from 'vue'"
        );
        assert_eq!(normalize_snippet_160(&"я".repeat(200)).chars().count(), 160);
    }
}
