//! wasm-компонент `n-rules:plugin@4.0.0` — `lang-js/wasm-concerns` (задачі N2,
//! Q1 батч 1, Q2 батч 2, Q3, Q4 батч 4, батчі 5–9 і зрізи 1–2, 4 контракту v3.1
//! (`docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`), спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5 і
//! `docs/specs/2026-08-01-wasm-ast-strategy.md`),
//! створений за флоу скіла `npm/skills/wasm-plugin/` (scaffold → реалізація →
//! golden-тести).
//!
//! # §2.93 — цей крейт ЄДИНА реалізація фіксу девʼятнадцяти концернів
//!
//! Борг «спершу парність» для `plugins/lang-js` закрито: девʼятнадцять
//! `fix-<concern>.mjs` знято (`bun/layout`, `bun/licensee`, `js/check`,
//! `js/doc_comments`, `js/jscpd_config`, `js/package_json`,
//! `js/vscode_extensions`, `js-run/jsconfig`, `js-run/runtime`,
//! `npm-module/emit_types_config`, `npm-module/npm_package_json`,
//! `npm-module/root_package_json`, `style/lint`, `style/package_json`,
//! `style/tooling`, `style/vscode_extensions`, `style/vscode_settings`,
//! `test/storybook-ci`, `test/storybook-scaffold`). Для КОЖНОГО з них
//! читання «порожній `FixPlan` → підхопить JS-канон» відтоді НЕПРАВДИВЕ:
//! `loadT0Patterns` (`run-fix.mjs`) третього шару для них більше не має,
//! тож кожна гілка, що віддає порожній план, мусить бути СВІДОМИМ no-op, а
//! не «нехай доробить JS». Гейт складу резолву — `§2.93` у
//! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs`.
//!
//! Чотири концерни плагіна фікс у JS ЗБЕРЕГЛИ, і кожен з іменованою
//! причиною: `js/eslint` (доккомент [`ESLINT_TOOL`] — канон робить те,
//! чого гість не робить), `bun/package_json` (§2.92 — не портований),
//! `test/storybook-vitest-config` (§2.87 — не портований),
//! `test/stryker_config` (портовано лише detect-половину — доккомент
//! секції «Зріз 1 контракту v3.1»).
//!
//! ТРИДЦЯТЬ ШІСТЬ концернів у контрибуції (перелік нижче —
//! перші чотирнадцять; батчі 5–9 і зріз 1 описані в доккоментах однойменних секцій
//! нижче за текстом; `js/doc_comments` зрізу 4 — секція «Зріз 4»), порт чинних
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
//! # `test/no-process-chdir` — гість-фільтр поверх host-глобу
//!
//! JS-оригінал (`collectTestFiles`, `npm/scripts/lib/collect-test-files.mjs`)
//! фільтрує `*.test.{mjs,js}` через `walkDir(cwd, onFile, ignorePaths)`, де
//! `ignorePaths` — `loadCursorIgnorePaths(cwd)`: додаткові шляхи з
//! `.n-rules.json` `ignore` (напр. `npm/schemas/vendor` цього репозиторію),
//! ПОНАД дефолтний `.gitignore`/`.git`/`node_modules`/worktrees-набір
//! (`ALWAYS_IGNORE`, `npm/scripts/utils/walkDir.mjs`). Host-бік full-scope
//! мосту (`crates/rules-napi::build_full_scope_files`) цей самий
//! `.n-rules.json`-ignore тепер теж читає (доккомент
//! `crates/rules-core/src/concerns/cursor_ignore.rs`, реєстр §2.25) — раніше
//! задокументована розбіжність закрита; `style/gap`/`style/admin_table`/
//! `style/quasar_fixes` лишаються окремим випадком: їхні JS-оригінали самі
//! ходять `walkDir(cwd, …)` БЕЗ `ignorePaths` (ignore там не застосовувався
//! й у JS-каноні, тож паритет тут не змінився). Крім консультації з
//! конфігом:
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
//! **Сам детект — AST, не порядковий regex** (розбіжність зі знятим
//! JS-каноном, свідома; задача 2026-08-26). Regex `process\.chdir\s*\(`
//! спрацьовував на ЗГАДЦІ виклику в прозі — доккоментар
//! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-php.test.mjs`
//! цитує `no-process-chdir.mdc` разом із дужкою, тож `lint --no-fix` репортив
//! порушення на будь-якому дереві, включно з `origin/main`, а LLM-автофікс
//! «лагодив» його переписуванням цитати — псував документацію замість коду.
//! [`find_process_chdir_call_lines`] шукає `CallExpression` через `oxc_parser`
//! (той самий движок, що AST-концерни задач Q3/Q4), тож коментарі й
//! рядкові/шаблонні літерали структурно не спрацьовують. Еталони
//! `fixtures/wasm-parity/test/no-process-chdir.json` від цього не змінилися —
//! усі три кейси там суто кодові.
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
//! **Розбіжність full-scope мосту (частково закрита, реєстр §2.25):**
//! JS-оригінал додатково фільтрує через `loadCursorIgnorePaths`
//! (`.n-rules.json` `ignore`) і `getMonorepoPackageRootDirs` (обмежує пошук
//! `utils/`-каталогів межами workspace-пакетів). `crates/rules-napi::build_full_scope_files`
//! тепер відтворює перше (сама читає `.n-rules.json` перед `walk_dir`), але
//! ДРУГЕ й досі не відтворює — host не знає про межі workspace-пакетів,
//! тож пошук `utils/`-каталогів лишається whole-repo. Єдиний JS-тест, що
//! покладався саме на `.n-rules.json` ignore (`utils_imports.test.mjs`, «у
//! .n-rules.json ignore → ігнорується»), і досі СВІДОМО не мав дзеркала в
//! `wasm-plugin-parity.test.mjs` до цього фіксу — чи додавати дзеркало
//! тепер, коли причина skip-у для ignore-частини знята, лишається окремим
//! рішенням (`getMonorepoPackageRootDirs`-частина розбіжності нікуди не
//! ділась, тож параметри конкретної фікстури тесту треба перевірити перед
//! розкриттям).
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
    Argument, ArrayExpression, ArrayExpressionElement, ArrowFunctionExpression, BinaryOperator,
    BindingPattern, BlockStatement, CallExpression, Comment, Declaration,
    ExportDefaultDeclarationKind, Expression, FormalParameters, Function, FunctionBody,
    FunctionType, ImportDeclaration, ImportDeclarationSpecifier, ImportExpression, NewExpression,
    ObjectExpression, ObjectProperty, ObjectPropertyKind, Program, PropertyKey, RegExpLiteral,
    Statement, StringLiteral, TaggedTemplateExpression, TemplateLiteral, UnaryExpression,
    UnaryOperator, VariableDeclarator,
};
use oxc_ast_visit::{
    walk::{
        walk_arrow_function_expression, walk_call_expression, walk_computed_member_expression,
        walk_function, walk_import_expression, walk_new_expression, walk_object_expression,
        walk_static_member_expression, walk_tagged_template_expression, walk_template_literal,
        walk_unary_expression, walk_variable_declarator,
    },
    Visit,
};
use oxc_parser::Parser;
use rules_template_merge::{
    is_subset, json_to_pretty_string, json_to_string as tm_json_to_string, merge_json_value,
    parse_jsonc_document, try_surgical_merge, Format as TmFormat, Json as TmJson,
};
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

/// Викличний паттерн `process.chdir(` з відкривною дужкою — історичний
/// `CHDIR_CALL_RE` знятого JS-канону
/// (`plugins/lang-js/rules/test/no-process-chdir/main.mjs:7`). Відкривна
/// дужка НЕ рятує від згадки у прозі: доккоментар, що цитує саме це правило,
/// пише `process.chdir(dir)` разом із дужкою — реальний false positive, через
/// який детект переїхав на AST (доккомент [`find_process_chdir_call_lines`]).
/// Лишається ЛИШЕ як фолбек для файлу, що не парситься.
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
/// `FS_PATH_ARG_POSITIONS` (`plugins/lang-js/rules/test/no-relative-fs-path/main.mjs:16-63`).
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
    // symlink: перевіряємо ЛИШЕ 2-й аргумент (шлях самого посилання). 1-й — це
    // ЦІЛЬ посилання, тобто рядок, який запишеться всередину symlink-а; відносна
    // ціль там нормальна й осмислена (`../real.txt`), а не помилка тесту. Пор.
    // `link`/`copyFile`/`rename`, де обидва аргументи — справжні шляхи на диску.
    ("symlink", &[1]),
    ("symlinkSync", &[1]),
    ("link", &[0, 1]),
    ("linkSync", &[0, 1]),
    ("cp", &[0, 1]),
    ("cpSync", &[0, 1]),
    ("writeJson", &[0]),
    ("ensureDir", &[0]),
];

/// Точний порт `ABSOLUTE_PREFIXES` (`main.mjs:69`, `test/no-relative-fs-path`).
const NO_RELATIVE_FS_PATH_ABSOLUTE_PREFIXES: [&str; 6] =
    ["/", "\\", "file:", "http:", "https:", "data:"];

/// Точний порт `WINDOWS_DRIVE_RE` (`main.mjs:70`).
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
/// (`main.mjs:116-126`): `Identifier` напряму (`writeFile(...)`) або
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
/// (`main.mjs:166-195`) на ASCII-фікстурах: `oxc_span::Span`-офсети — байтові
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
/// (`main.mjs:143-164`): для кожного `CallExpression` з callee з
/// [`FS_PATH_ARG_POSITIONS`] перевіряє ВСІ задекларовані path-позиції
/// аргументів (не лише перший — `copyFile`/`rename`/`link`/`cp` мають дві,
/// `symlink` — лише другу).
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

/// Точний порт `findOffendersInBody` (`main.mjs:143-164`) — на відміну від
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
/// (`plugins/lang-js/rules/test/no-relative-fs-path/main.mjs:204-244`) —
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
        world_version: "4.0.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![
            ConcernContribution {
                key: CONCERN_TFM.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.vue".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_GAP.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.vue".to_string(),
                    "**/*.scss".to_string(),
                    "**/*.css".to_string(),
                ],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_POOL_FORKS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "vitest.config.mjs".to_string(),
                    "vitest.config.js".to_string(),
                ],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_NO_PROCESS_CHDIR.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_ADMIN_TABLE.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.vue".to_string(),
                    "**/*.scss".to_string(),
                    "**/*.css".to_string(),
                ],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_QUASAR_FIXES.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.vue".to_string(),
                    "**/*.scss".to_string(),
                    "**/*.css".to_string(),
                ],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_LOCATION.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_NO_CONSOLE_STORE_RESTORE.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_NO_BUN_TEST_IMPORT.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_UTILS_IMPORTS.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/utils/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_NO_RELATIVE_FS_PATH.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
                fix_glob: vec![],
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
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_MSSQL_DEPS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string(),
                    "**/package.json".to_string(),
                ],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_BUN_DB_SAFETY.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string(),
                    "**/package.json".to_string(),
                ],
                fix_glob: vec![],
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
                fix_glob: vec![],
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
                fix_glob: vec![],
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
                fix_glob: vec![],
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
                // §2.87 — ПЕРШИЙ реальний споживач `fix-glob` (§2.84).
                // Детект-глоб фіксу замало: [`detect_stories_glob`] питає
                // «чи є `<pkg>/src/components/`», а детекту вміст цієї теки
                // не потрібен. Розширювати ДЕТЕКТ заради фіксу — саме та
                // вада, яку §2.72 записала в реєстр, тож розрив скоупів
                // оголошений явно.
                fix_glob: vec![
                    ".n-rules.json".to_string(),
                    ".n-cursor.json".to_string(),
                    "**/package.json".to_string(),
                    "**/*.vue".to_string(),
                    "**/.storybook/**".to_string(),
                    "**/src/components/**".to_string(),
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
                // §2.87: скоуп той самий, що детекту (матриця workflow-а —
                // фактичний список пакетів), але оголошений ЯВНО — саме
                // непорожній `fix-glob` вмикає в хості full-scope
                // fix-батч. Без нього гість дістав би два ВІДСУТНІ шляхи з
                // діагностик, тобто порожній батч, і мусив би писати
                // наосліп (доккомент секції §2.87).
                fix_glob: vec![
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
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_BUN_DB_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/package.json".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_REDIS_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/package.json".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_MSSQL_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/package.json".to_string()],
                fix_glob: vec![],
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
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_SKILL_META.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["npm/skills/*/*".to_string()],
                fix_glob: vec![],
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
                fix_glob: vec![],
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
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_DEP_POLICY.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string()],
                fix_glob: vec![],
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
                fix_glob: vec![],
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
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_SANDBOX_AWARE_TEST.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_VITEST_API_CONVENTIONS.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["**/*.test.mjs".to_string(), "**/*.test.js".to_string()],
                fix_glob: vec![],
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
                fix_glob: vec![],
            },
            // Зріз 1 контракту v3.1: `test/stryker_config`. Глоб —
            // `concern.json.lint.glob` плюс два кореневі файли, які канон
            // читає повз `ctx.files` (`.n-rules.json` self-gate і
            // `.gitignore`), плюс сам vue-plugin-файл, чию наявність
            // перевіряє `planBaselineFile` (доккомент секції «Зріз 1»).
            ConcernContribution {
                key: CONCERN_STRYKER_CONFIG.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    ".n-rules.json".to_string(),
                    ".n-cursor.json".to_string(),
                    ".gitignore".to_string(),
                    "**/package.json".to_string(),
                    "**/stryker.config.mjs".to_string(),
                    "**/stryker-vue-macros-ignorer.mjs".to_string(),
                    "**/vitest.config.{mjs,js}".to_string(),
                    "**/src/**/*.vue".to_string(),
                ],
                fix_glob: vec![],
            },
            // Зріз 2 контракту v3.1: `js/check`. Глоб — `concern.json.lint.glob`
            // плюс `**/*.vue` (детекція vue-воркспейсів `isVueWorkspace`,
            // доккомент секції «Зріз 2»).
            // Зріз 4 контракту v3.1: PER-FILE-контрибуція (єдина, крім
            // [`CONCERN_TFM`]) — глоб дослівно з `concern.json.lint.glob`
            // JS-канону; `IGNORE_GLOBS` сюди не переїжджають, бо живуть у
            // недосяжній globby-гілці (розбіжність 3 секції «Зріз 4»).
            ConcernContribution {
                key: CONCERN_DOC_COMMENTS.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.{js,mjs,cjs,ts}".to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_JS_CHECK.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "eslint.config.js".to_string(),
                    "eslint.config.mjs".to_string(),
                    "**/package.json".to_string(),
                    "**/*.vue".to_string(),
                    ".oxlintrc.json".to_string(),
                    ".github/workflows/lint-js.yml".to_string(),
                    ".github/workflows/lint.yml".to_string(),
                    "knip.json".to_string(),
                    ".eslintrc".to_string(),
                    ".eslintrc.js".to_string(),
                    ".eslintrc.json".to_string(),
                    ".eslintrc.yml".to_string(),
                ],
                fix_glob: vec![],
            },
            // Зріз 5 контракту v3.1: `bun/licensee` — пілот `exec-tool`.
            // Детектор читає з диска рівно `.licensee.json` (його
            // наявність), решту вердикту дає спавнений тул (доккомент
            // секції «Зріз 5»). `**/package.json` глоб додав ПОРТ
            // T0-ФІКСЕРА ([`fix_bun_licensee`], патерн
            // `bun-licensee-workspace-license-metadata`): щоб проставити
            // `"license": "ISC"` власному workspace-пакету, гість мусить
            // бачити його `package.json` у батчі — інакше `FixRequest`
            // просто не несе файлу, який треба переписати. Детектор ці
            // записи ІГНОРУЄ (перевіряє лише `.licensee.json`), тож
            // розширення глоба не міняє жодної діагностики.
            ConcernContribution {
                key: CONCERN_BUN_LICENSEE.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    LICENSEE_CONFIG_PATH.to_string(),
                    "**/package.json".to_string(),
                ],
                fix_glob: vec![],
            },
            // Зріз 6 контракту v3.1: `style/lint`. `scope: PerFile` —
            // дослівно `concern.json.lint.scope`, глоб — дослівно
            // `concern.json.lint.glob`.
            //
            // Тут БУЛО `Full` — свідомий обхід дефекту хоста, а не опис
            // концерну: до §2.65 `per-file` контрибуція діставала в `lint
            // --full` порожній batch і концерн мовчки звітував «чисто».
            // §2.65 полагодила detect-бік (`build_detect_batch_files`
            // будує batch glob-обходом і для `per-file`), а порт
            // T0-фіксера ([`fix_style_lint`]) полагодив fix-бік
            // (`run_wasm_concern_fix`, `crates/rules-napi`): обхід більше
            // не потрібен, і тримати його ШКІДЛИВО — `Full` на fix-боці
            // ІГНОРУЄ дельту запиту, тобто дельта-прогін ганяв би
            // `stylelint --fix` по ВСЬОМУ репозиторію й переписував файли
            // поза дельтою.
            ConcernContribution {
                key: CONCERN_STYLE_LINT.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec![STYLE_LINT_GLOB.to_string()],
                fix_glob: vec![],
            },
            // Зріз 6 контракту v3.1: `js/jscpd_duplicates`. Глоб ПОРОЖНІЙ —
            // це не пропуск: канон не читає з диска НІЧОГО перед спавном
            // (репозиторій обходить сам `jscpd`), а глоб контрибуції
            // описує рівно те, що хост кладе в batch. Гість цей batch
            // ігнорує ([`detect_jscpd_duplicates`] навіть не приймає
            // `files`), тож будь-який непорожній глоб тут був би платою за
            // читання файлів у нікуди.
            ConcernContribution {
                key: CONCERN_JSCPD_DUPLICATES.to_string(),
                scope: ConcernScope::Full,
                glob: vec![],
                fix_glob: vec![],
            },
            // Зріз 7: глоб ШИРШИЙ за `concern.json` в одному місці —
            // `**/k8s/**/*.{yaml,yml}` замість `**/k8s/base/configmap.yaml` (доккомент
            // секції «Зріз 7», «Глоб контрибуції ШИРШИЙ за `concern.json`»):
            // під-перевірка 8 мусить відрізнити «каталогу k8s/ немає» від
            // «є, але без `base/configmap.yaml`», а з батчу, що містить лише
            // сам файл, ці два стани не відрізнити.
            ConcernContribution {
                key: CONCERN_JS_RUN_RUNTIME.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}".to_string(),
                    "**/package.json".to_string(),
                    "**/jsconfig.json".to_string(),
                    "**/k8s/**/*.{yaml,yml}".to_string(),
                ],
                fix_glob: vec![],
            },
            // §2.78 — родина `vscode_extensions` + четвірка `package_json`
            // (доккомент секції «§2.78» вище). Глоб КОЖНОГО — рівно
            // `policy.files.single` свого `concern.json`, і це свідомо: після
            // §2.72 той самий глоб годує не лише detect, а й `fix`
            // (`run_wasm_concern_fix` будує batch через
            // `build_full_scope_files(&cwd, &c.glob)`). Вужчий за таргет глоб
            // тут беззвучно каструє фікс — гість не побачив би файлу, віддав
            // порожній план, гейт `edits.length > 0` не пустив би його, і
            // JS-канон тихо проганяв би фікс удруге. Ширший — теж не потрібен:
            // жодна з шести політик не читає нічого, крім свого таргета.
            ConcernContribution {
                key: CONCERN_JS_VSCODE_EXTENSIONS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![VSCODE_EXTENSIONS_TARGET.to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_STYLE_VSCODE_EXTENSIONS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![VSCODE_EXTENSIONS_TARGET.to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_JS_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec![ROOT_PACKAGE_JSON_TARGET.to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_NPM_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec![NPM_PACKAGE_JSON_TARGET.to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_ROOT_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec![ROOT_PACKAGE_JSON_TARGET.to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_STYLE_PACKAGE_JSON.to_string(),
                scope: ConcernScope::Full,
                glob: vec![ROOT_PACKAGE_JSON_TARGET.to_string()],
                fix_glob: vec![],
            },
            // §2.80 — той самий принцип «глоб = таргет», лише
            // `js-run/jsconfig` має форму `walkGlob` і тому багатофайловий
            // глоб ([`JSCONFIG_GLOBS`]). Джерело істини — [`PolicyFiles`]
            // кожного конфігу, тож розійтись таблиця й маніфест не можуть
            // (гейт [`hlob_kozhnoho_policy_kontsernu_dorivniuie_ioho_taryetam`]).
            ConcernContribution {
                key: CONCERN_STYLE_VSCODE_SETTINGS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![VSCODE_SETTINGS_TARGET.to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_JSCPD_CONFIG.to_string(),
                scope: ConcernScope::Full,
                glob: vec![JSCPD_CONFIG_TARGET.to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_EMIT_TYPES_CONFIG.to_string(),
                scope: ConcernScope::Full,
                glob: vec![EMIT_TYPES_CONFIG_TARGET.to_string()],
                fix_glob: vec![],
            },
            ConcernContribution {
                key: CONCERN_JSCONFIG.to_string(),
                scope: ConcernScope::Full,
                // Єдиний багатофайловий policy-концерн — і єдиний, чий глоб
                // не читається з першого погляду як «ось цей файл». Тому він
                // береться з [`PolicyFiles`] напряму, а не дублюється
                // літералом: розійтись тут двом спискам просто нема де.
                glob: policy_cfg(CONCERN_JSCONFIG)
                    .expect("конфіг `js-run/jsconfig` у POLICY_CONFIGS")
                    .files
                    .contribution_glob(),
                fix_glob: vec![],
            },
        ],
        ci_artifacts: vec![],
        capabilities: Capabilities {
            // Вміст файлів хост передає inline (per-file чи host-побудований
            // full-scope batch, доккомент `wit/world.wit`) — плагін не читає
            // диск сам.
            //
            // `bun/licensee` цього не змінює: capabilities описують доступ
            // WASM-ГОСТЯ до ФС, а спавнений через `exec-tool` тул до них не
            // належить взагалі — він виконується поза пісочницею, з правами
            // хоста (trust boundary, рішення З спеки; доккомент
            // `record tool-result` у `wit/world.wit`).
            fs_read: vec![],
            network: false,
        },
        // Перша реальна декларація тула first-party плагіном (до зрізу 5
        // контур `manifest.tools` → `ensureDeclaredTools` → `toolPaths` →
        // `ToolResolver` був наскрізним, але жодним продакшн-плагіном не вживаним).
        // Зріз 6 добив набір до всіх ТРЬОХ схем рішення В: `path:` (`bun`,
        // `bunx` — резолв по `PATH`) і `npm:` (`stylelint` —
        // `node_modules/.bin` консюмера з фолбеком на `PATH`). Схема
        // `pinned:` (github-реліз) у цьому компоненті поки не вживана — її
        // споживач `js-run/runtime` (`pinned:conftest`, зріз 7).
        // §2.86 додала `path:tee` — єдиний тул, чий споживач не детектор, а
        // фіксер: `js/eslint` кладе ним механічно виправлений вміст на диск
        // ДО спавну лінтерів (доккомент секції «§2.86»). `bunx` того самого
        // концерну вже є у списку ([`JSCPD_TOOL`]) — декларації тулів це
        // множина, не мапа «концерн → тул».
        tools: vec![
            LICENSEE_TOOL.to_string(),
            STYLELINT_TOOL.to_string(),
            JSCPD_TOOL.to_string(),
            TEE_TOOL.to_string(),
        ],
        // §2.86 — перший (і поки єдиний) запис ДРУГОГО списку контрибуцій
        // мажора `4.0.0`: `js/eslint` віддає гостю ЛИШЕ fix, а detect
        // лишається за `main.mjs` («вічний JS», доккомент секції «§2.86»).
        // Ключ у цьому списку НЕ шедоуїть detect — `detect.mjs` читає лише
        // `concerns`.
        fix_only_concerns: vec![ConcernContribution {
            key: CONCERN_JS_ESLINT.to_string(),
            scope: ConcernScope::PerFile,
            glob: vec![JS_ESLINT_GLOB.to_string()],
            fix_glob: vec![],
        }],
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

/// Чи `expr` — ідентифікатор `process` (крізь дужки: `(process).chdir(…)` —
/// той самий виклик).
fn is_process_identifier(expr: &Expression) -> bool {
    matches!(
        expr.get_inner_expression(),
        Expression::Identifier(ident) if ident.name.as_str() == "process"
    )
}

/// Чи `callee` — саме `process.chdir`: статичний доступ (`process.chdir(…)`,
/// зокрема optional-chaining `process?.chdir(…)`) або computed із рядковим
/// ключем (`process['chdir'](…)`, який порядковий regex не бачив зовсім).
/// `foo.chdir(…)` — НЕ цей виклик. Голий `chdir(…)` з
/// `import { chdir } from 'node:process'` теж НЕ ловиться: це відома діра
/// знятого JS-канону (`npm/CHANGELOG.md`, запис про `stryker_config`), яку цей
/// фікс свідомо не розширює — він прибирає хибні спрацювання, не додає нові
/// сутності детекту.
fn is_process_chdir_callee(callee: &Expression) -> bool {
    match callee.get_inner_expression() {
        Expression::StaticMemberExpression(member) => {
            member.property.name.as_str() == "chdir" && is_process_identifier(&member.object)
        }
        Expression::ComputedMemberExpression(member) => {
            matches!(
                member.expression.get_inner_expression(),
                Expression::StringLiteral(literal) if literal.value.as_str() == "chdir"
            ) && is_process_identifier(&member.object)
        }
        _ => false,
    }
}

/// Visitor для [`find_process_chdir_call_lines`] — 1-індексовані рядки ВСІХ
/// `process.chdir(…)`-викликів у програмі. Коментарі й рядкові/шаблонні
/// літерали сюди СТРУКТУРНО не потрапляють: у AST це не `CallExpression`.
/// `BTreeSet` — щоб два виклики в одному рядку дали одну діагностику
/// (поведінка порядкового скану, який рахував саме РЯДКИ), і щоб порядок був
/// зростаючим незалежно від обходу.
struct ProcessChdirVisitor<'c> {
    content: &'c str,
    lines: BTreeSet<usize>,
}

impl<'a, 'c> Visit<'a> for ProcessChdirVisitor<'c> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if is_process_chdir_callee(&it.callee) {
            self.lines
                .insert(line_number_at_offset(self.content, it.span.start as usize));
        }
        walk_call_expression(self, it);
    }
}

/// Рядки з ВИКЛИКОМ `process.chdir(…)` у `content` — зростаюче, без дублів.
///
/// **AST, а не порядковий regex.** [`CHDIR_CALL_PATTERN`] спрацьовував і на
/// ЗГАДЦІ виклику в прозі: доккоментар
/// `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-php.test.mjs`
/// цитує `no-process-chdir.mdc` разом із `process.chdir(dir)`, тож
/// `lint --no-fix` репортив порушення на будь-якому дереві, включно з
/// `origin/main`. Гірше за сам false positive був його «фікс»: LLM-автофікс
/// переписував прозу, підміняючи точну цитату правила — псував документацію
/// замість коду (задача 2026-08-26 відкотила такий автофікс свідомо).
/// Детект тепер дивиться на КОД, тож цитата правила у коментарі чи рядковому
/// літералі (фікстура, що ЗАПИСУЄ такий тест) більше не порушення.
///
/// Файл, що НЕ парситься, не мовчить: тоді працює regex-фолбек
/// [`CHDIR_CALL_PATTERN`] — синтаксично зламаний тест краще перевірити
/// приблизно, ніж пропустити тихо (свідома розбіжність із
/// [`find_offenders_in_body`], де порт `parseProgramOrNull` такий файл
/// відкидає цілком; там ціна помилки — хибний шлях у діагностиці, тут —
/// process-wide мутація cwd, через яку вже був rogue-коміт у реальний
/// репозиторій, `no-process-chdir.mdc`).
fn find_process_chdir_call_lines(content: &str) -> Vec<usize> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path("test.mjs").unwrap_or_default();
    let ret = Parser::new(&allocator, content, source_type).parse();
    if !ret.diagnostics.is_empty() {
        return chdir_call_lines_by_regex(content);
    }
    let mut visitor = ProcessChdirVisitor {
        content,
        lines: BTreeSet::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.lines.into_iter().collect()
}

/// Фолбек [`find_process_chdir_call_lines`] для файлу з syntax-error —
/// історична порядкова поведінка: рядок, у якому regex знайшов
/// `process.chdir(`. Коментарі тут знову хибно спрацьовують, але це шлях
/// для НЕПАРСОВНОГО файлу, а не штатний.
fn chdir_call_lines_by_regex(content: &str) -> Vec<usize> {
    let chdir_re = regex::Regex::new(CHDIR_CALL_PATTERN).expect("CHDIR_CALL_PATTERN валідний");
    content
        .split('\n')
        .enumerate()
        .filter(|(_, line)| chdir_re.is_match(line))
        .map(|(index, _)| index + 1)
        .collect()
}

/// `test/no-process-chdir` — WHOLE-BATCH: кожен `*.test.{mjs,js}` (гість-фільтр
/// [`is_test_file_no_process_chdir`], доккомент модуля «розбіжність
/// full-scope мосту») перевіряємо через AST
/// ([`find_process_chdir_call_lines`]), одна діагностика на кожен рядок із
/// викликом. `data` — вручну зібраний JSON-рядок (той самий мотив, що
/// `crates/test-plugin-guest`, доккомент модуля тут): `{ line }`.
///
/// Дешевий префільтр `contains("chdir")` — щоб не парсити КОЖЕН тестовий файл
/// репозиторію заради концерну, який майже завжди мовчить (full-scope обхід
/// віддає сюди весь `**/*.test.{mjs,js}`). Підрядок `chdir` — надмножина обох
/// форм виклику, які ловить [`is_process_chdir_callee`], тож префільтр нічого
/// не приховує.
fn detect_no_process_chdir(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for file in files {
        if !is_test_file_no_process_chdir(&file.path) {
            continue;
        }
        if !file.content.contains("chdir") {
            continue;
        }
        for line_number in find_process_chdir_call_lines(&file.content) {
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
//    звужують `walkDir` через `loadCursorIgnorePaths`, host-збірка батчу
//    тепер теж (`build_full_scope_files` читає `.n-rules.json` перед
//    `walk_dir` — реєстр §2.25). Раніше задокументована розбіжність усіх
//    full-scope портів закрита.
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
//    `loadCursorIgnorePaths`, host-збірка батчу — тепер теж (реєстр §2.25).
//    Раніше задокументована розбіжність усіх full-scope портів закрита.
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

/// Точний порт трьох T0-патернів видаленого
/// `plugins/lang-js/rules/bun/layout/fix-layout.mjs` — `rm-forbidden-file`
/// (видаляє кожен заборонений lock/конфіг-файл, чиє ім'я виймається з
/// `diagnostic.message`), `bun-bunfig-create` (створює `bunfig.toml`, лише
/// коли його ще немає в батчі — не перезаписує чужий вміст) і
/// `bun-yarn-dir-remove` (видаляє директорію `.yarn` цілком, разом із
/// вкладеним вмістом — `FileEdit::Delete` на батьківський шлях, той самий
/// контракт, що `rmSync(target, { recursive: true })` JS-канону).
///
/// `bun/layout` — `scope: full`, WHOLE-BATCH-концерн (жодна діагностика не
/// несе `file`, [`detect_bun_layout`]): `request.files` тут — не дельта
/// запиту, а повний full-scope glob-обхід (`run_wasm_concern_fix`,
/// `crates/rules-napi/src/lib.rs`, гілка `ConcernScope::Full`), тож
/// `batch_file`/`batch_dir_exists` над ним коректно відповідають на
/// «чи файл/каталог реально існує на диску консюмера зараз» — той самий
/// `existsSync`, що робив JS-канон безпосередньо.
///
/// Імена заборонених файлів читаються з тексту повідомлення (не з
/// `BUN_LAYOUT_FORBIDDEN_FILES` напряму), точний порт
/// `FORBIDDEN_FILE_NAME_RE` (`/Знайдено заборонений файл: (\S+)/u`,
/// `fix-layout.mjs:13`): `\S+` — до першого пробілу, тут — `split(' ')`,
/// той самий ефект, бо жодне з чотирьох заборонених імен пробілів не несе.
fn fix_bun_layout(request: &FixRequest) -> FixPlan {
    let mut edits = Vec::new();

    for diagnostic in &request.diagnostics {
        let Some(rest) = diagnostic
            .message
            .strip_prefix("Знайдено заборонений файл: ")
        else {
            continue;
        };
        let name = rest.split(' ').next().unwrap_or(rest);
        if batch_file(&request.files, name).is_some() {
            edits.push(FileEdit::Delete(name.to_string()));
        }
    }

    let bunfig_missing = request
        .diagnostics
        .iter()
        .any(|d| d.message.starts_with("Відсутній bunfig.toml"));
    if bunfig_missing && batch_file(&request.files, "bunfig.toml").is_none() {
        edits.push(FileEdit::Write(WriteFile {
            path: "bunfig.toml".to_string(),
            content: "[install]\nlinker = \"hoisted\"\n".to_string(),
        }));
    }

    let yarn_dir_found = request
        .diagnostics
        .iter()
        .any(|d| d.message.starts_with("Знайдено директорію .yarn"));
    if yarn_dir_found && batch_dir_exists(&request.files, ".yarn") {
        edits.push(FileEdit::Delete(".yarn".to_string()));
    }

    FixPlan { edits }
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
//    `walkDir` через `loadCursorIgnorePaths(cwd)`, host-збірка батчу — тепер
//    теж (`build_full_scope_files` читає `.n-rules.json` перед `walk_dir` —
//    реєстр §2.25). Раніше задокументована розбіжність усіх full-scope
//    портів закрита.
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

// =====================================================================
// Зріз 1 контракту v3.1 (`docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`,
// §7): `test/stryker_config` — порт detect-половини.
//
// # Чому цей концерн узагалі був заблокований — і чому блокер знявся
//
// Доккомент секції «Батч 9» відніс `test/stryker_config` до класу «потребує
// поверхні, якої в контракті немає» (package-асетів: чотири canonical
// baseline-файли лежать у `<concern>/data/**` ПАКЕТА `@7n/rules`, не в репо
// споживача). Ревізія (спека v3.1, §2 рядок 3 і §3 рішення Г)
// показала, що клас описано ширше, ніж він є: **detect-половина концерну
// вмісту асетів не читає взагалі**. Єдина її взаємодія з ними —
// `existsSync(baselinePath)` (`main.mjs:447-457`), тобто перевірка
// «інсталяція пакета не пошкоджена». У wasm-компоненті ця перевірка
// вироджується в константу: файли, які були б `include_str!`-нуті, з
// компонента зникнути не можуть. Тому гілка `plan.fatal =
// "canonical baseline не знайдено (…) — перевстанови @7n/rules"` у порті
// НЕДОСЯЖНА за конструкцією, а не «пропущена» (задокументована розбіжність 1
// нижче), і жодного байта асетів у компонент вшивати не треба.
//
// Вміст асетів потрібен ЛИШЕ fix-половині (T0 пише baseline у дерево). Її
// цей зріз свідомо лишає в JS (`fix-stryker_config.mjs`, незмінний):
// napi-міст будує `FixRequest::files` виключно з полів `file` переданих
// violations (`crates/rules-napi::run_wasm_concern_fix`), тобто гість у
// `export fix` бачить лише ВІДСУТНІ (нечитані) цільові файли й не може
// повторити планувальник — а весь T0 цього концерну на повторному
// плануванні й тримається (`planStrykerActions(cwd)` у `apply`). Це
// обмеження host-мосту, не контракту, і воно поза бюджетом зрізу, який за
// умовою контракту не торкається. Диспатч від цього не страждає:
// `loadT0Patterns` (`run-fix.mjs`) ДОДАЄ wasm-патерн ПЕРЕД JS-патерном, а не
// заміщає його, тож порожній `fix-plan` гостя (дефолтна гілка `Guest::fix`)
// — це рівно «нічого не чиню», і фіксить далі JS-канон.
//
// # Глоб контрибуції
//
// Ширший за `concern.json.lint.glob` цього концерну рівно на два кореневі
// файли, які JS-канон читає з диска повз `ctx.files`: `.n-rules.json`
// (self-gate `js`-правила, `main.mjs:475-480`) і `.gitignore`
// (`missingGitignoreEntries`). Той самий мотив, що глоби батчу 7: batch має
// містити РІВНО те, що канон реально читає.
//
// # Задокументовані розбіжності
//
// 1. **`plan.fatal` про canonical baseline** — недосяжна в порті (див. вище).
//    Спостережувано вона й у JS-каноні означає лише пошкоджену інсталяцію
//    `@7n/rules`, не стан репо споживача, тож parity на здоровому дереві
//    точна.
// 2. **Невалідний JSON** у `.n-rules.json` чи кореневому `package.json`:
//    JS-канон (`readNRulesConfigLite`, `resolveAllJsRoots`) кличе `JSON.parse`
//    БЕЗ `try/catch` — виняток валить увесь концерн (exit 2); порт через
//    [`parse_json_tolerant`] трактує битий `.n-rules.json` як «правило `js`
//    не ввімкнене» (мовчання), а битий `package.json` — як «немає
//    `workspaces`» (єдиний js-root — корінь). Той самий skip-not-crash дух,
//    що розбіжність 1 секції «Батч 6».
// 3. **`migrateRuleIds`** (`rule-meta-helpers.mjs`) у порті НЕ відтворено як
//    крок: уся карта міграцій — `image → [image-compress, image-avif]` і
//    `ci4 → [doc-files]`; жоден запис не породжує й не поглинає `js`, тож
//    пряма перевірка членства в `rules`/`disable-rules` тотожна. Якщо в
//    `RULE_MIGRATIONS` колись зʼявиться запис із `js` у будь-якому боці —
//    цей порт треба оновити (анти-дрейф тримає parity-фікстура self-gate).
// 4. **`.gitignore` як фільтр обходу**: host-збірка батчу
//    (`rules_core::scan::walk_dir`, `git_ignore(true)`) ПОВАЖАЄ `.gitignore`
//    репо, тоді як `hasVueFiles` JS-канону ходить `node:fs/promises#glob` без
//    gitignore-фільтра. Репо, що ігнорує власні `src/**/*.vue`, дало б у
//    порті «не vue-root». Успадкована розбіжність усіх full-scope портів,
//    але тут вона вперше має свій сценарій — названа явно.
// 5. **Порожній каталог**: `existsSync` JS-канону true і для каталогу з
//    імʼям цільового файлу; batch — список ФАЙЛІВ. Успадкована
//    мікро-розбіжність 5 секції «Батч 5».
// 6. **Текст syntax-error** гілки `augment` (`stryker.config.mjs має syntax
//    error (…): <msg>`): `<msg>` — повідомлення першої діагностики парсера.
//    Обидві сторони — oxc 0.137.0 (пін `oxc-version-pin.test.mjs`), тож
//    рядок той самий; parity-фікстура «битий stryker.config.mjs» тримає це
//    твердження живим, а не припущенням.
//
// # Офсети augment-у — чому UTF-16 тут не блокер
//
// На відміну від `js/doc_comments` (§3.5.5, клас 3), офсети цього концерну
// НЕ витікають у діагностику: `planVueAugment` використовує їх виключно
// всередині себе — щоб зробити точкові string-splice-и у ВЛАСНОМУ ж тексті
// й повторно розібрати результат. JS індексує UTF-16 і ріже UTF-16-рядок, порт
// індексує байти й ріже UTF-8-рядок — обидва внутрішньо консистентні, тож і
// текст результату, і спостережуваний назовні предикат «edits непорожні»
// збігаються без жодної конверсії.
// =====================================================================

/// Ключ контрибуції `test/stryker_config` (зріз 1 контракту v3.1).
const CONCERN_STRYKER_CONFIG: &str = "test/stryker_config";

/// Дефолтний `reason` fatal-гілки — `reporter.fail(plan.fatal)` без другого
/// аргументу, тож `createViolationReporter` підставляє `ctx.concernId`
/// (bare `stryker_config`, без `test/`-префікса — той самий мотив, що
/// [`PACKAGE_STRUCTURE_REASON`]).
const STRYKER_CONFIG_REASON: &str = "stryker_config";

/// `STRYKER_CONFIG_MISSING` (`main.mjs:33`) — відсутній baseline-файл.
const STRYKER_CONFIG_MISSING_REASON: &str = "stryker-config-missing";

/// `STRYKER_VUE_AUGMENT` (`main.mjs:35`) — vue-macros ignorer не зареєстровано.
const STRYKER_VUE_AUGMENT_REASON: &str = "stryker-vue-augment";

/// `STRYKER_VUE_AUGMENT_FAIL` (`main.mjs:37`) — augment неможливий.
const STRYKER_VUE_AUGMENT_FAIL_REASON: &str = "stryker-vue-augment-fail";

/// `GITIGNORE_MISSING` (`main.mjs:39`) — бракує тест-патернів у `.gitignore`.
const STRYKER_GITIGNORE_MISSING_REASON: &str = "gitignore-missing";

/// Імʼя stryker-конфіга у js-root (ціль baseline-копії й augment-у).
const STRYKER_CONFIG_FILENAME: &str = "stryker.config.mjs";

/// `STRYKER_VUE_PLUGIN_FILENAME` (`main.mjs:28`).
const STRYKER_VUE_PLUGIN_FILENAME: &str = "stryker-vue-macros-ignorer.mjs";

/// `TEST_GITIGNORE_ENTRIES` (`main.mjs:80`) — порядок значущий (він же
/// порядок у тексті діагностики).
const TEST_GITIGNORE_ENTRIES: [&str; 2] = ["**/reports/stryker/", "**/coverage/"];

/// `VITEST_RUNNER_PLUGIN` (`main.mjs:64`).
const VITEST_RUNNER_PLUGIN: &str = "@stryker-mutator/vitest-runner";

/// `VUE_MACROS_PLUGIN` (`main.mjs:65`).
const VUE_MACROS_PLUGIN: &str = "./stryker-vue-macros-ignorer.mjs";

/// `VUE_MACROS_IGNORER` (`main.mjs:66`).
const VUE_MACROS_IGNORER: &str = "vue-macros";

/// `VUE_GLOB_IGNORE` (`main.mjs:85`) у формі імен сегментів — усі три
/// патерни там мають вигляд `**/<dir>/**`.
const STRYKER_VUE_GLOB_IGNORED_DIRS: [&str; 3] = ["node_modules", "dist", "reports"];

/// Ігноровані сегменти `WORKSPACE_IGNORED_DIRS` (`resolve-js-root.mjs:13`) —
/// СВІДОМО окрема константа від однойменного списку `workspaces.mjs`
/// (там чотири записи, `.venv`/`venv` включно): js-root-резолвер знає рівно
/// два, і порт має дзеркалити саме його.
const JS_ROOT_IGNORED_DIRS: [&str; 2] = ["node_modules", ".git"];

/// Порожній рядок-відступ (`INDENT_WS_RE`, `main.mjs:70`).
const INDENT_WS_PATTERN: &str = r"^\s*$";

/// Провідна кома після останньої property (`LEADING_COMMA_RE`, `main.mjs:71`).
const LEADING_COMMA_PATTERN: &str = r"^\s*,";

/// `join(<jsRoot>, name)` у просторі repo-relative posix-шляхів батча:
/// корінь репо — порожній рядок (JS `jsRoot === cwd`, і тоді
/// `relative(cwd, target)` дає голе імʼя файлу).
fn js_root_join(root: &str, name: &str) -> String {
    if root.is_empty() {
        name.to_string()
    } else {
        format!("{root}/{name}")
    }
}

/// Порт self-gate `lint()` (`main.mjs:475-480`): `readNRulesConfigLite` +
/// `config.rules.includes('js') && !config.disableRules.includes('js')`.
/// Відсутній конфіг → `rules: []` → правило вимкнене (мовчання) — рівно
/// поведінка JS-канону, а не «open by default» (`isRuleEnabled` тут не
/// викликається). Про `migrateRuleIds` — розбіжність 3 доккоменту секції.
fn stryker_js_rule_enabled(files: &[SourceFile]) -> bool {
    let Some(config) = batch_root_config(files) else {
        return false;
    };
    // Розбіжність 2 секції: JS `JSON.parse` без try/catch валить концерн.
    let Some(raw) = parse_json_tolerant(&config.content) else {
        return false;
    };
    let has = |key: &str, id: &str| {
        raw.get(key)
            .and_then(|v| v.as_array())
            .is_some_and(|list| list.iter().filter_map(|v| v.as_str()).any(|s| s == id))
    };
    has("rules", "js") && !has("disable-rules", "js")
}

/// Порт `expandWorkspacePattern` (`resolve-js-root.mjs:24-34`): літеральний
/// патерн — `existsSync(<pattern>/package.json)`, glob-патерн — збіги
/// `scanGlob('<pattern>/package.json')` мінус ігноровані сегменти,
/// відсортовані (`toSorted()` без компаратора — UTF-16 code units; для
/// ASCII-шляхів тотожно байтовому порядку).
fn expand_workspace_pattern(files: &[SourceFile], pattern: &str) -> Vec<String> {
    if !pattern.contains('*') {
        let Some(dir) = normalize_rel_path(pattern) else {
            return Vec::new();
        };
        return if batch_file(files, &format!("{dir}/package.json")).is_some() {
            vec![dir]
        } else {
            Vec::new()
        };
    }
    let Some(re) = glob_to_regex(&format!("{pattern}/package.json")) else {
        return Vec::new();
    };
    let mut roots: Vec<String> = files
        .iter()
        .map(|f| f.path.as_str())
        .filter(|path| re.is_match(path))
        .filter(|path| {
            !path
                .split('/')
                .any(|seg| JS_ROOT_IGNORED_DIRS.contains(&seg))
        })
        .filter_map(|path| path.strip_suffix("/package.json").map(str::to_string))
        .collect();
    roots.sort();
    roots
}

/// Порт `resolveAllJsRoots` (`resolve-js-root.mjs:51-63`) у простір
/// repo-relative шляхів: порожній рядок = корінь репо (JS `cwd`). Порожній
/// результат = кореневого `package.json` немає взагалі (fatal-гілка
/// планувальника).
fn resolve_all_js_roots(files: &[SourceFile]) -> Vec<String> {
    let Some(root_pkg) = batch_file(files, "package.json") else {
        return Vec::new();
    };
    // Розбіжність 2 секції: JS `JSON.parse` без try/catch валить концерн.
    let patterns: Vec<String> = parse_json_tolerant(&root_pkg.content)
        .as_ref()
        .and_then(|pkg| pkg.get("workspaces"))
        .and_then(|w| w.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if patterns.is_empty() {
        return vec![String::new()];
    }
    let mut roots = Vec::new();
    for pattern in &patterns {
        roots.extend(expand_workspace_pattern(files, pattern));
    }
    if roots.is_empty() {
        vec![String::new()]
    } else {
        roots
    }
}

/// Порт `hasVueFiles` (`main.mjs:92-97`): хоч один `.vue` під `<jsRoot>/src/`
/// повз `VUE_GLOB_IGNORE`. Про gitignore-фільтр host-обходу — розбіжність 4
/// доккоменту секції.
fn has_vue_files(files: &[SourceFile], root: &str) -> bool {
    let prefix = js_root_join(root, "src/");
    files.iter().any(|file| {
        file.path.starts_with(&prefix)
            && file.path.ends_with(".vue")
            && !file.path[prefix.len()..]
                .split('/')
                .any(|seg| STRYKER_VUE_GLOB_IGNORED_DIRS.contains(&seg))
    })
}

/// Порт `resolveVitestConfigName` (`main.mjs:55-57`).
fn resolve_vitest_config_name(files: &[SourceFile], root: &str) -> &'static str {
    VITEST_CONFIG_NAMES
        .iter()
        .copied()
        .find(|name| batch_file(files, &js_root_join(root, name)).is_some())
        .unwrap_or("vitest.config.mjs")
}

/// Порт `missingGitignoreEntries` (`main.mjs:360-365`): `.gitignore` немає —
/// порожній вміст, тобто бракує ВСІХ канонічних entries.
fn missing_gitignore_entries(files: &[SourceFile]) -> Vec<String> {
    let existing = batch_file(files, ".gitignore")
        .map(|f| f.content.as_str())
        .unwrap_or("");
    let lines: HashSet<&str> = existing.split('\n').map(str::trim).collect();
    TEST_GITIGNORE_ENTRIES
        .iter()
        .copied()
        .filter(|entry| !lines.contains(entry))
        .map(str::to_string)
        .collect()
}

/// Одна `BaselineAction` (`main.mjs:100-109`) у батч-просторі: detect-половині
/// потрібні лише ціль (repo-relative — вона ж `relative(cwd, target)`
/// діагностики) і людиночитна мітка. `baselinePath`/`transform` живуть у
/// fix-половині, яка лишається в JS (доккомент секції).
struct BaselineAction {
    target: String,
    label: String,
}

/// План `planStrykerActions` (`main.mjs:368-374`) у батч-просторі.
#[derive(Default)]
struct StrykerPlan {
    fatal: Option<String>,
    baseline_actions: Vec<BaselineAction>,
    augment_writes: Vec<String>,
    augment_fails: Vec<String>,
    gitignore_missing: Vec<String>,
}

/// Порт `planBaselineFile` (`main.mjs:119-125`): дія потрібна, лише якщо
/// цілі ще немає (idempotent).
fn plan_baseline_file(files: &[SourceFile], target: String, label: &str) -> Option<BaselineAction> {
    if batch_file(files, &target).is_some() {
        return None;
    }
    Some(BaselineAction {
        target,
        label: label.to_string(),
    })
}

/// Порт `quote` (`main.mjs:134-136`): канонічні entries лапок не містять,
/// тож escaping не потрібен.
fn quote_single(value: &str) -> String {
    format!("'{value}'")
}

/// Порт `findDefaultExportObject` (`main.mjs:145-149`): ПЕРШИЙ
/// `ExportDefaultDeclaration` у `program.body`; не object-literal → `None`
/// (augment не чіпає файл).
fn find_default_export_object<'a>(program: &'a Program<'a>) -> Option<&'a ObjectExpression<'a>> {
    let export = program.body.iter().find_map(|stmt| match stmt {
        Statement::ExportDefaultDeclaration(export) => Some(export),
        _ => None,
    })?;
    match &export.declaration {
        ExportDefaultDeclarationKind::ObjectExpression(obj) => Some(obj),
        _ => None,
    }
}

/// Стан property-масиву — порт `analyzeArrayProperty` (`main.mjs:160-175`).
/// `array: None` разом із `dynamic: false` = property взагалі немає (нову
/// треба створити); `dynamic: true` = зливати небезпечно.
struct ArrayPropertyState<'a> {
    array: Option<&'a ArrayExpression<'a>>,
    values: Vec<String>,
    dynamic: bool,
}

/// Порт `analyzeArrayProperty` (`main.mjs:160-175`). Spread-property не має
/// типу `Property` в ESTree-виводі JS-боку, тож і тут пропускається
/// (`ObjectPropertyKind::SpreadProperty`).
fn analyze_array_property<'a>(obj: &'a ObjectExpression<'a>, name: &str) -> ArrayPropertyState<'a> {
    let prop = obj.properties.iter().find_map(|kind| {
        let ObjectPropertyKind::ObjectProperty(prop) = kind else {
            return None;
        };
        if prop.computed {
            return None;
        }
        let matches = match &prop.key {
            PropertyKey::StaticIdentifier(ident) => ident.name == name,
            PropertyKey::StringLiteral(lit) => lit.value == name,
            _ => false,
        };
        matches.then_some(&**prop)
    });
    let Some(prop) = prop else {
        return ArrayPropertyState {
            array: None,
            values: Vec::new(),
            dynamic: false,
        };
    };
    let Expression::ArrayExpression(array) = &prop.value else {
        return ArrayPropertyState {
            array: None,
            values: Vec::new(),
            dynamic: true,
        };
    };
    let mut values = Vec::new();
    for element in &array.elements {
        let ArrayExpressionElement::StringLiteral(lit) = element else {
            return ArrayPropertyState {
                array: Some(array),
                values: Vec::new(),
                dynamic: true,
            };
        };
        values.push(lit.value.to_string());
    }
    ArrayPropertyState {
        array: Some(array),
        values,
        dynamic: false,
    }
}

/// Одна точкова вставка (`{pos, text}` JS-оригіналу). `pos` — БАЙТОВИЙ офсет
/// (JS — UTF-16); обидва боки ріжуть власний рядок тим самим індексом, тож
/// результат тотожний (доккомент секції, «Офсети augment-у»).
struct SpliceEdit {
    pos: usize,
    text: String,
}

/// Порт `arrayAppendEdit` (`main.mjs:186-192`).
fn array_append_edit(array: &ArrayExpression, values: &[String], missing: &[String]) -> SpliceEdit {
    if values.is_empty() {
        return SpliceEdit {
            pos: array.span.end as usize - 1,
            text: missing
                .iter()
                .map(|v| quote_single(v))
                .collect::<Vec<_>>()
                .join(", "),
        };
    }
    // `values` непорожній ⇒ усі елементи — рядкові літерали ⇒ `elements`
    // непорожній (JS `arr.elements.at(-1)`).
    let last_end = array
        .elements
        .last()
        .map(|el| el.span().end as usize)
        .unwrap_or(array.span.end as usize - 1);
    SpliceEdit {
        pos: last_end,
        text: missing
            .iter()
            .map(|v| format!(", {}", quote_single(v)))
            .collect(),
    }
}

/// Порт `detectIndent` (`main.mjs:201-210`).
fn detect_indent(src: &str, obj: &ObjectExpression) -> String {
    let Some(last) = obj.properties.last() else {
        return "  ".to_string();
    };
    let start = last.span().start as usize;
    let line_start = src[..start].rfind('\n').map(|idx| idx + 1).unwrap_or(0);
    let ws = &src[line_start..start];
    let re = regex::Regex::new(INDENT_WS_PATTERN).expect("INDENT_WS_PATTERN валідний");
    if re.is_match(ws) {
        ws.to_string()
    } else {
        "  ".to_string()
    }
}

/// Порт `newPropertyEdit` (`main.mjs:222-235`).
fn new_property_edit(
    src: &str,
    obj: &ObjectExpression,
    indent: &str,
    lines: &[String],
) -> SpliceEdit {
    let block = lines.join(&format!(",\n{indent}"));
    let Some(last) = obj.properties.last() else {
        return SpliceEdit {
            pos: obj.span.start as usize + 1,
            text: format!("\n{indent}{block}\n"),
        };
    };
    let last_end = last.span().end as usize;
    let tail = &src[last_end..obj.span.end as usize - 1];
    let re = regex::Regex::new(LEADING_COMMA_PATTERN).expect("LEADING_COMMA_PATTERN валідний");
    if let Some(m) = re.find(tail) {
        return SpliceEdit {
            pos: last_end + m.end(),
            text: format!("\n{indent}{block}"),
        };
    }
    SpliceEdit {
        pos: last_end,
        text: format!(",\n{indent}{block}"),
    }
}

/// Порт `applyEdits` (`main.mjs:244-250`): сортування за СПАДАННЯМ `pos`
/// (стабільне, як `Array.prototype.toSorted`), щоб ранні офсети лишались
/// валідними після вставок справа.
fn apply_splice_edits(src: &str, mut edits: Vec<SpliceEdit>) -> String {
    edits.sort_by_key(|edit| std::cmp::Reverse(edit.pos));
    let mut out = src.to_string();
    for edit in edits {
        out.insert_str(edit.pos, &edit.text);
    }
    out
}

/// Порт `planVueAugment` (`main.mjs:271-349`): `Err` — augment неможливий
/// (fail-повідомлення), `Ok(None)` — no-op, `Ok(Some(content))` — обчислений
/// новий вміст (його споживає fix-половина; detect дивиться лише на факт).
fn plan_vue_augment(files: &[SourceFile], root: &str) -> Result<Option<String>, String> {
    let rel = js_root_join(root, STRYKER_CONFIG_FILENAME);
    // Викликається лише за `wasMissing == false`, тобто файл у батчі є.
    let Some(file) = batch_file(files, &rel) else {
        return Ok(None);
    };
    let src = file.content.as_str();

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, src, SourceType::mjs()).parse();
    if let Some(first) = parsed.diagnostics.first() {
        return Err(format!(
            "stryker.config.mjs має syntax error ({rel}): {} — augment скіпнуто",
            first.message
        ));
    }

    let Some(obj) = find_default_export_object(&parsed.program) else {
        return Err(format!(
            "stryker.config.mjs has non-literal default export ({rel}) — augment скіпнуто, \
             додай вручну plugins/ignorers згідно stryker.config.vue.baseline.mjs"
        ));
    };

    let plugins = analyze_array_property(obj, "plugins");
    let ignorers = analyze_array_property(obj, "ignorers");
    if plugins.dynamic || ignorers.dynamic {
        return Err(format!(
            "stryker.config.mjs: plugins/ignorers — динамічний вираз (spread/computed) ({rel}) — \
             augment скіпнуто, додай vue-macros ignorer вручну згідно stryker.config.vue.baseline.mjs"
        ));
    }

    let mut edits: Vec<SpliceEdit> = Vec::new();
    let mut new_property_lines: Vec<String> = Vec::new();
    for (name, state, required) in [
        (
            "plugins",
            &plugins,
            vec![VITEST_RUNNER_PLUGIN, VUE_MACROS_PLUGIN],
        ),
        ("ignorers", &ignorers, vec![VUE_MACROS_IGNORER]),
    ] {
        let missing: Vec<String> = required
            .iter()
            .filter(|value| !state.values.iter().any(|have| have == *value))
            .map(|value| (*value).to_string())
            .collect();
        match state.array {
            Some(array) => {
                if !missing.is_empty() {
                    edits.push(array_append_edit(array, &state.values, &missing));
                }
            }
            None => new_property_lines.push(format!(
                "{name}: [{}]",
                required
                    .iter()
                    .map(|v| quote_single(v))
                    .collect::<Vec<_>>()
                    .join(", ")
            )),
        }
    }
    if !new_property_lines.is_empty() {
        let indent = detect_indent(src, obj);
        edits.push(new_property_edit(src, obj, &indent, &new_property_lines));
    }
    if edits.is_empty() {
        return Ok(None);
    }

    let next = apply_splice_edits(src, edits);
    // Safety (`main.mjs:329-346`): результат має компілюватись, інакше відкат.
    let recheck_allocator = Allocator::default();
    let recheck = Parser::new(&recheck_allocator, &next, SourceType::mjs()).parse();
    if !recheck.diagnostics.is_empty() {
        return Err(format!(
            "stryker.config.mjs: augment дав некоректний результат ({rel}) — відкат, додай вручну"
        ));
    }
    Ok(Some(next))
}

/// Порт `planVueRootActions` (`main.mjs:385-400`).
fn plan_vue_root_actions(
    plan: &mut StrykerPlan,
    files: &[SourceFile],
    root: &str,
    was_missing: bool,
) {
    if !was_missing {
        match plan_vue_augment(files, root) {
            Err(message) => plan.augment_fails.push(message),
            Ok(Some(_)) => plan
                .augment_writes
                .push(js_root_join(root, STRYKER_CONFIG_FILENAME)),
            Ok(None) => {}
        }
    }
    if let Some(action) = plan_baseline_file(
        files,
        js_root_join(root, STRYKER_VUE_PLUGIN_FILENAME),
        STRYKER_VUE_PLUGIN_FILENAME,
    ) {
        plan.baseline_actions.push(action);
    }
}

/// Порт `planJsRootActions` (`main.mjs:409-429`) — порядок дій значущий
/// (stryker → vue-plugin → vitest), він же порядок діагностик.
fn plan_js_root_actions(plan: &mut StrykerPlan, files: &[SourceFile], root: &str) {
    let is_vue_root = has_vue_files(files, root);
    let stryker_target = js_root_join(root, STRYKER_CONFIG_FILENAME);
    let was_missing = batch_file(files, &stryker_target).is_none();
    if let Some(action) = plan_baseline_file(files, stryker_target, STRYKER_CONFIG_FILENAME) {
        plan.baseline_actions.push(action);
    }
    if is_vue_root {
        plan_vue_root_actions(plan, files, root, was_missing);
    }
    let vitest_name = resolve_vitest_config_name(files, root);
    if let Some(action) = plan_baseline_file(files, js_root_join(root, vitest_name), vitest_name) {
        plan.baseline_actions.push(action);
    }
}

/// Порт `planStrykerActions` (`main.mjs:437-465`). Гілка «canonical baseline
/// не знайдено» — розбіжність 1 доккоменту секції (недосяжна в компоненті).
fn plan_stryker_actions(files: &[SourceFile]) -> StrykerPlan {
    let mut plan = StrykerPlan::default();
    let js_roots = resolve_all_js_roots(files);
    if js_roots.is_empty() {
        plan.fatal =
            Some("test: js enabled, але кореневий package.json не знайдено (test.mdc)".to_string());
        return plan;
    }
    for root in &js_roots {
        plan_js_root_actions(&mut plan, files, root);
    }
    plan.gitignore_missing = missing_gitignore_entries(files);
    plan
}

/// Порт `lint()` `test/stryker_config` (`main.mjs:472-511`) — WHOLE-BATCH.
fn detect_stryker_config(files: &[SourceFile]) -> Vec<Diagnostic> {
    if !stryker_js_rule_enabled(files) {
        return Vec::new();
    }
    let plan = plan_stryker_actions(files);
    if let Some(fatal) = plan.fatal {
        return vec![Diagnostic {
            reason: STRYKER_CONFIG_REASON.to_string(),
            message: fatal,
            file: None,
            severity: Severity::Error,
            data: None,
        }];
    }

    let mut out = Vec::new();
    for action in &plan.baseline_actions {
        out.push(Diagnostic {
            reason: STRYKER_CONFIG_MISSING_REASON.to_string(),
            message: format!(
                "{} відсутній ({}) — запусти `npx @7n/rules lint test` для canonical baseline (test.mdc)",
                action.label, action.target
            ),
            file: Some(action.target.clone()),
            severity: Severity::Error,
            data: None,
        });
    }
    for target in &plan.augment_writes {
        out.push(Diagnostic {
            reason: STRYKER_VUE_AUGMENT_REASON.to_string(),
            message: format!(
                "vue-macros ignorer не зареєстровано у stryker.config.mjs ({target}) — запусти `npx @7n/rules lint test` (test.mdc)"
            ),
            file: Some(target.clone()),
            severity: Severity::Error,
            data: None,
        });
    }
    for message in &plan.augment_fails {
        out.push(Diagnostic {
            reason: STRYKER_VUE_AUGMENT_FAIL_REASON.to_string(),
            message: message.clone(),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
    if !plan.gitignore_missing.is_empty() {
        out.push(Diagnostic {
            reason: STRYKER_GITIGNORE_MISSING_REASON.to_string(),
            message: format!(
                ".gitignore: бракує тест-патернів ({}) — запусти `npx @7n/rules lint test` (test.mdc)",
                plan.gitignore_missing.join(", ")
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
    out
}

// =====================================================================
// Зріз 2 контракту v3.1 (`docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`,
// §7): `js/check` — рефакторинг концерну (рішення Ґ) плюс порт detect.
//
// # Чому цей концерн був заблокований подвійно — і що з цим сталося
//
// Доккомент секції «Батч 9» назвав дві причини: (а) канон oxlint читається з
// ПАКЕТА `@7n/rules`, а не з репо споживача, і (б) `checkKnipConfig` робить
// `copyFile` під час `detect`. Обидві зняті, але по-різному:
//
// (а) **Асет вшито** (рішення Г спеки): [`OXLINT_CANONICAL_JSON`] —
// `include_str!` того самого файлу, що читав JS-канон. Поверхні до
// package-асетів не додано: контракт свідомо не знає про структуру
// npm-пакета, а вшитий асет і компонент версіонуються одним релізом
// (lockstep builtin-пінів), тож дрейфу за конструкцією немає — на відміну від
// читання з диска, де асет і компонент могли б розʼїхатись.
//
// (б) **Концерн полагоджено, не обійдено** (рішення Ґ): `checkKnipConfig`
// JS-канону тепер read-only й звітує `KNIP_MISSING`, а копію робить T0
// (`fix-check.mjs`, патерн `js-check-knip`). Це ЗМІНА СПОСТЕРЕЖУВАНОЇ
// ПОВЕДІНКИ — до неї стан «`knip.json` немає» був неспостережуваний узагалі
// (детектор звітував `pass`, тихо створивши файл), тож у консюмерів
// зʼявляється нове порушення. Порт дзеркалить уже полагоджений канон, а не
// стару поведінку: писати з `detect` контракт не вміє і не має вміти.
//
// # Глоб контрибуції
//
// `concern.json.lint.glob` плюс `**/*.vue` — `isVueWorkspace`
// (`eslint-config.mjs:88-100`) сканує `.vue` під кожним воркспейсом, і без
// них детекція vue-воркспейсів була б сліпою.
//
// # Задокументовані розбіжності
//
// 1. **Невалідний JSON** у кореневому/воркспейсному `package.json`: JS-канон
//    (`checkPackageJsonJsLint`) кличе `JSON.parse` БЕЗ `try/catch` — виняток
//    валить концерн (exit 2); порт трактує битий файл як «полів немає».
//    `detectWorkspaceTypes` тут виняток: у нього `readJsonOrNull` із
//    `try/catch`, тож там parity точна. Для `.oxlintrc.json` `try/catch` теж
//    є в оригіналі — гілка «не є валідним JSON» портується дослівно.
// 2. **Порожній каталог**: `existsSync(join(cwd, norm))` `expandWorkspaces` і
//    `existsSync(wsPkgAbs)` `checkWorkspacePackages` бачать каталог; batch —
//    список ФАЙЛІВ. Успадкована мікро-розбіжність 5 секції «Батч 5».
// 3. **`.gitignore`/`.cursorignore` як фільтр обходу**: `globby` JS-канону
//    викликається з `gitignore: false`, host-збірка батчу
//    (`rules_core::scan::walk_dir`) поважає `.gitignore`. Репо, що ігнорує
//    власні `.vue`, дасть у порті «не vue-воркспейс».
// 4. **Числа з дробовою частиною у `JSON.stringify`**: JS `JSON.stringify(1.0)`
//    друкує `1`, `serde_json::Number` для розібраного `1.0` — `1.0`. У
//    конфігах oxlint числові значення правил не трапляються (усе — рядки й
//    масиви), тож сценарію немає; названо, бо це єдина відома щілина
//    [`js_json_stringify`].
// 5. **`engines.node`/`engines.bun` нерядкового типу**: JS `String(nodeEngine)`
//    перетворює будь-що; порт обробляє рядок і число, решту (обʼєкт/масив)
//    трактує як «поле відсутнє». У реальних `package.json` це рядок.
//
// # Порядок ключів — чому [`JsonOrdered`], а не `serde_json::Value`
//
// `verifyOxlintRcAgainstCanonical` ітерує `Object.entries(canonical)` і
// `Object.entries(canonical.rules)`, тобто ПОРЯДОК ключів канону визначає
// порядок діагностик; `JSON.stringify(value)` у тексті повідомлення теж
// друкує ключі в порядку документа. `serde_json::Value` тримає обʼєкт у
// `BTreeMap` (ключі відсортовані) — цього досить для порівняння, але не для
// byte-exact parity ні порядку, ні тексту. Тому і канон, і `.oxlintrc.json`
// споживача розбираються в [`JsonOrdered`] із документним порядком.
// =====================================================================

/// Канон oxlint, вшитий у компонент (рішення Г спеки v3.1) — ТОЙ САМИЙ файл,
/// що читає JS-канон через `OXLINT_CANONICAL_JSON_PATH`
/// (`plugins/lang-js/rules/js/tooling/main.mjs`). `include_str!` вказує на
/// канонічне місце, а не на копію в крейті: копія була б другим джерелом
/// правди й неминучим дрейфом. Анти-дрейф — тест
/// [`oxlint_canonical_asset_parses_and_matches_js_path`].
const OXLINT_CANONICAL_JSON: &str =
    include_str!("../../../plugins/lang-js/rules/js/tooling/data/tooling/oxlint-canonical.json");

/// JSON-значення зі збереженим порядком ключів обʼєктів — мотив у доккоменті
/// секції («Порядок ключів»).
#[derive(Clone, Debug, PartialEq)]
enum JsonOrdered {
    Null,
    Bool(bool),
    Number(serde_json::Number),
    Str(String),
    Array(Vec<JsonOrdered>),
    Object(Vec<(String, JsonOrdered)>),
}

impl<'de> serde::Deserialize<'de> for JsonOrdered {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct JsonOrderedVisitor;

        impl<'de> serde::de::Visitor<'de> for JsonOrderedVisitor {
            type Value = JsonOrdered;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("будь-яке JSON-значення")
            }

            fn visit_unit<E>(self) -> Result<JsonOrdered, E> {
                Ok(JsonOrdered::Null)
            }

            fn visit_bool<E>(self, value: bool) -> Result<JsonOrdered, E> {
                Ok(JsonOrdered::Bool(value))
            }

            fn visit_i64<E>(self, value: i64) -> Result<JsonOrdered, E> {
                Ok(JsonOrdered::Number(value.into()))
            }

            fn visit_u64<E>(self, value: u64) -> Result<JsonOrdered, E> {
                Ok(JsonOrdered::Number(value.into()))
            }

            fn visit_f64<E>(self, value: f64) -> Result<JsonOrdered, E> {
                Ok(serde_json::Number::from_f64(value)
                    .map(JsonOrdered::Number)
                    .unwrap_or(JsonOrdered::Null))
            }

            fn visit_str<E>(self, value: &str) -> Result<JsonOrdered, E> {
                Ok(JsonOrdered::Str(value.to_string()))
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<JsonOrdered, A::Error> {
                let mut out = Vec::new();
                while let Some(item) = seq.next_element()? {
                    out.push(item);
                }
                Ok(JsonOrdered::Array(out))
            }

            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<JsonOrdered, A::Error> {
                let mut out = Vec::new();
                while let Some((key, value)) = map.next_entry::<String, JsonOrdered>()? {
                    out.push((key, value));
                }
                Ok(JsonOrdered::Object(out))
            }
        }

        deserializer.deserialize_any(JsonOrderedVisitor)
    }
}

impl JsonOrdered {
    /// Значення за ключем — `obj[key]` JS (перше входження, як і в
    /// JS-обʼєкті після парсингу).
    fn get(&self, key: &str) -> Option<&JsonOrdered> {
        match self {
            JsonOrdered::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// Записи обʼєкта в документному порядку (`Object.entries`).
    fn entries(&self) -> &[(String, JsonOrdered)] {
        match self {
            JsonOrdered::Object(entries) => entries,
            _ => &[],
        }
    }

    /// Елементи масиву або порожньо (`Array.isArray` + доступ).
    fn as_array(&self) -> Option<&[JsonOrdered]> {
        match self {
            JsonOrdered::Array(items) => Some(items),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            JsonOrdered::Str(s) => Some(s),
            _ => None,
        }
    }

    /// `typeof v === 'object' && v !== null && !Array.isArray(v)`.
    fn is_plain_object(&self) -> bool {
        matches!(self, JsonOrdered::Object(_))
    }
}

/// Толерантний парсинг у [`JsonOrdered`] — дзеркало `try { JSON.parse } catch`.
fn parse_json_ordered(content: &str) -> Option<JsonOrdered> {
    serde_json::from_str(content).ok()
}

/// Дзеркало `JSON.stringify(value)` без відступів: компактний вивід із
/// документним порядком ключів. Про числа — розбіжність 4 доккоменту секції.
fn js_json_stringify(value: &JsonOrdered) -> String {
    match value {
        JsonOrdered::Null => "null".to_string(),
        JsonOrdered::Bool(true) => "true".to_string(),
        JsonOrdered::Bool(false) => "false".to_string(),
        JsonOrdered::Number(n) => n.to_string(),
        JsonOrdered::Str(s) => json_escape_string(s),
        JsonOrdered::Array(items) => {
            let inner: Vec<String> = items.iter().map(js_json_stringify).collect();
            format!("[{}]", inner.join(","))
        }
        JsonOrdered::Object(entries) => {
            let inner: Vec<String> = entries
                .iter()
                .map(|(k, v)| format!("{}:{}", json_escape_string(k), js_json_stringify(v)))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
    }
}

/// `JSON.stringify(undefined)` віддає `undefined` (не рядок) — саме він
/// потрапляє у шаблонний рядок повідомлення `compareOxlintRules`, коли
/// правила в `.oxlintrc.json` немає взагалі.
fn js_json_stringify_opt(value: Option<&JsonOrdered>) -> String {
    value.map_or_else(|| "undefined".to_string(), js_json_stringify)
}

/// Точний порт `deepEqualOxlintCanonical` (`tooling/main.mjs:37-60`).
fn deep_equal_oxlint_canonical(actual: Option<&JsonOrdered>, expected: &JsonOrdered) -> bool {
    match expected {
        JsonOrdered::Array(_) => actual.is_some_and(|a| {
            a.as_array().is_some() && js_json_stringify(a) == js_json_stringify(expected)
        }),
        JsonOrdered::Object(exp_entries) => {
            let Some(act) = actual else { return false };
            if !act.is_plain_object() {
                return false;
            }
            let act_entries = act.entries();
            if act_entries.len() != exp_entries.len() {
                return false;
            }
            exp_entries.iter().all(|(key, exp_value)| {
                act.get(key)
                    .is_some_and(|a| deep_equal_oxlint_canonical(Some(a), exp_value))
            })
        }
        // Примітив (включно з `null`) — строга рівність `actual === expected`.
        _ => actual == Some(expected),
    }
}

/// Точний порт `compareOxlintRules` (`tooling/main.mjs:77-87`).
fn compare_oxlint_rules(
    expected: Option<&JsonOrdered>,
    actual: Option<&JsonOrdered>,
    failures: &mut Vec<String>,
) {
    let empty = JsonOrdered::Object(Vec::new());
    let expected_record = expected.filter(|v| v.is_plain_object()).unwrap_or(&empty);
    let actual_record = actual.filter(|v| v.is_plain_object()).unwrap_or(&empty);
    for (rule_key, expected_value) in expected_record.entries() {
        let actual_value = actual_record.get(rule_key);
        if !deep_equal_oxlint_canonical(actual_value, expected_value) {
            failures.push(format!(
                ".oxlintrc.json: rules[\"{rule_key}\"] очікується {}, зараз {}",
                js_json_stringify(expected_value),
                js_json_stringify_opt(actual_value)
            ));
        }
    }
}

/// Точний порт `compareOxlintIgnorePatterns` (`tooling/main.mjs:96-113`).
fn compare_oxlint_ignore_patterns(
    expected: Option<&JsonOrdered>,
    actual: Option<&JsonOrdered>,
    failures: &mut Vec<String>,
) {
    let Some(expected_items) = expected.and_then(JsonOrdered::as_array) else {
        return;
    };
    let Some(actual_items) = actual.and_then(JsonOrdered::as_array) else {
        failures.push(
            ".oxlintrc.json: поле \"ignorePatterns\" має бути масивом (канон задає мінімум, додаткові патерни дозволені)"
                .to_string(),
        );
        return;
    };
    // `new Set(actual)` + `has(p)` — SameValueZero над примітивами; канонічні
    // патерни — рядки, тож звірка за значенням тотожна.
    let missing: Vec<&JsonOrdered> = expected_items
        .iter()
        .filter(|p| !actual_items.iter().any(|a| a == *p))
        .collect();
    if !missing.is_empty() {
        let rendered: Vec<String> = missing.iter().map(|p| js_json_stringify(p)).collect();
        failures.push(format!(
            ".oxlintrc.json: ignorePatterns має містити канонічні патерни — додай: {}",
            rendered.join(", ")
        ));
    }
}

/// Точний порт `compareOxlintJsPlugins` (`tooling/main.mjs:122-136`).
fn compare_oxlint_js_plugins(
    expected: Option<&JsonOrdered>,
    actual: Option<&JsonOrdered>,
    failures: &mut Vec<String>,
) {
    let Some(expected_items) = expected.and_then(JsonOrdered::as_array) else {
        return;
    };
    let Some(actual_items) = actual.and_then(JsonOrdered::as_array) else {
        failures.push(
            ".oxlintrc.json: поле \"jsPlugins\" має бути масивом (канон задає мінімум, локальні wrapper-и дозволені)"
                .to_string(),
        );
        return;
    };
    let missing: Vec<&JsonOrdered> = expected_items
        .iter()
        .filter(|plugin| {
            actual_items
                .iter()
                .all(|entry| !deep_equal_oxlint_canonical(Some(entry), plugin))
        })
        .collect();
    if !missing.is_empty() {
        let rendered: Vec<String> = missing.iter().map(|p| js_json_stringify(p)).collect();
        failures.push(format!(
            ".oxlintrc.json: jsPlugins має містити канонічні plugins — додай: {}",
            rendered.join(", ")
        ));
    }
}

/// Точний порт `verifyOxlintRcAgainstCanonical` (`tooling/main.mjs:145-182`).
/// Канон завжди валідний обʼєкт (вшитий асет), тож гілка «канон має бути
/// object» недосяжна — на відміну від JS, де канон читається з диска.
fn verify_oxlintrc_against_canonical(cfg: &JsonOrdered, canonical: &JsonOrdered) -> Vec<String> {
    if !cfg.is_plain_object() {
        return vec![".oxlintrc.json: корінь має бути значенням типу object".to_string()];
    }
    let mut failures = Vec::new();
    for (key, expected) in canonical.entries() {
        let actual = cfg.get(key);
        match key.as_str() {
            "rules" => compare_oxlint_rules(Some(expected), actual, &mut failures),
            "ignorePatterns" => {
                compare_oxlint_ignore_patterns(Some(expected), actual, &mut failures)
            }
            "jsPlugins" => compare_oxlint_js_plugins(Some(expected), actual, &mut failures),
            _ => {
                if !deep_equal_oxlint_canonical(actual, expected) {
                    failures.push(format!(
                        ".oxlintrc.json: поле \"{key}\" має збігатися з каноном пакета @7n/rules (npm/rules/js/tooling/data/tooling/oxlint-canonical.json)"
                    ));
                }
            }
        }
    }
    failures
}

/// Ключ контрибуції `js/check` (зріз 2 контракту v3.1).
const CONCERN_JS_CHECK: &str = "js/check";

/// Дефолтний `reason` — `ctx.concernId` (bare `check`, без `js/`-префікса).
const JS_CHECK_REASON: &str = "check";

/// `ESLINT_CONFIG_MISSING` (`eslint-config.mjs:23`).
const ESLINT_CONFIG_MISSING_REASON: &str = "eslint-config-missing";

/// `ESLINT_CONFIG_IGNORES` (`eslint-config.mjs:25`).
const ESLINT_CONFIG_IGNORES_REASON: &str = "eslint-config-ignores";

/// `ESLINT_CONFIG_VUE_WORKSPACE` (`eslint-config.mjs:27`).
const ESLINT_CONFIG_VUE_WORKSPACE_REASON: &str = "eslint-config-vue-workspace";

/// `OXLINTRC_MISSING` (`tooling/main.mjs`).
const OXLINTRC_MISSING_REASON: &str = "oxlintrc-missing";

/// `OXLINTRC_DRIFT` (`tooling/main.mjs`).
const OXLINTRC_DRIFT_REASON: &str = "oxlintrc-drift";

/// `KNIP_MISSING` (`tooling/main.mjs`) — новий reason рішення Ґ.
const KNIP_MISSING_REASON: &str = "knip-missing";

/// `AUTO_IMPORTS_IGNORE` (`eslint-config.mjs:30`).
const AUTO_IMPORTS_IGNORE: &str = "**/auto-imports.d.ts";

/// Кандидати flat-config (`main.mjs:35-40`) — порядок значущий.
const ESLINT_CONFIG_NAMES: [&str; 2] = ["eslint.config.js", "eslint.config.mjs"];

/// Застарілі конфіги ESLint (`main.mjs:305`) — порядок значущий.
const LEGACY_ESLINT_CONFIGS: [&str; 4] = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
    ".eslintrc.yml",
];

/// `deep: 8` у `globby('**/*.vue', …)` (`eslint-config.mjs:97`) — максимальна
/// кількість сегментів відносного шляху збігу (виміряно живим прогоном
/// `globby`, не вгадано).
const VUE_SCAN_MAX_DEPTH: usize = 8;

/// `VUE_LIST_RE` (`eslint-config.mjs:32`).
const VUE_LIST_PATTERN: &str = r"\bvue\s*:\s*\[([^\]]*)\]";

/// `NODE_LIST_RE` (`eslint-config.mjs:33`) — потрібен лише T0-фіксеру
/// (`mergeEslintConfig` вилучає vue-воркспейси зі списку `node`); детектор
/// список `node` не читає взагалі.
const NODE_LIST_PATTERN: &str = r"\bnode\s*:\s*\[([^\]]*)\]";

/// `IGNORES_OPEN_RE` (`eslint-config.mjs:35`) — теж лише для T0-фіксера
/// (вставка `AUTO_IMPORTS_IGNORE` у перший `ignores: [`).
const IGNORES_OPEN_PATTERN: &str = r"\bignores\s*:\s*\[";

/// `GET_CONFIG_OBJ_RE` (`eslint-config.mjs:34`) — fallback-точка вставки
/// `vue: [...]`, коли в конфігу ще немає власного списку.
const GET_CONFIG_OBJ_PATTERN: &str = r"getConfig\(\s*\{";

/// `STRING_ENTRY_RE` (`eslint-config.mjs:36`).
const STRING_ENTRY_PATTERN: &str = r#"'([^']*)'|"([^"]*)""#;

/// `NON_DIGITS_RE` (`main.mjs:25`) — роздільник числових токенів версії.
const NON_DIGITS_PATTERN: &str = r"\D+";

/// Точний порт `normalizeWs` (`eslint-config.mjs:42-46`).
fn normalize_ws(path: &str) -> String {
    let stripped = path.strip_prefix("./").unwrap_or(path);
    let trimmed = stripped.trim_end_matches('/');
    if trimmed.is_empty() {
        ".".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Каталоги батча, що збігаються з glob-патерном — batch-відповідник
/// `globby(norm, { onlyDirectories: true })`: каталог «існує», якщо під ним
/// є хоч один файл (розбіжність 2 доккоменту секції).
fn batch_dirs_matching_glob(files: &[SourceFile], glob: &str) -> Vec<String> {
    let Some(re) = glob_to_regex(glob) else {
        return Vec::new();
    };
    let mut dirs: BTreeSet<String> = BTreeSet::new();
    for file in files {
        // Кожен каталог-предок файлу — кандидат на «існуючий каталог».
        for (idx, ch) in file.path.char_indices() {
            if ch == '/' {
                let prefix = &file.path[..idx];
                if re.is_match(prefix) {
                    dirs.insert(prefix.to_string());
                }
            }
        }
    }
    dirs.into_iter().collect()
}

/// Точний порт `expandWorkspaces` (`eslint-config.mjs:67-79`).
fn expand_workspaces(files: &[SourceFile], patterns: &[JsonOrdered]) -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    for pattern in patterns {
        let Some(raw) = pattern.as_str() else {
            continue;
        };
        if raw.is_empty() {
            continue;
        }
        let norm = normalize_ws(raw);
        if norm.contains('*') {
            dirs.extend(batch_dirs_matching_glob(files, &norm));
        } else if batch_dir_exists(files, &norm) {
            dirs.push(norm);
        }
    }
    // `[...new Set(dirs.map(normalizeWs))]` — дедуп зі збереженням порядку.
    let mut seen: HashSet<String> = HashSet::new();
    dirs.into_iter()
        .map(|d| normalize_ws(&d))
        .filter(|d| seen.insert(d.clone()))
        .collect()
}

/// Точний порт `isVueWorkspace` (`eslint-config.mjs:88-100`).
fn is_vue_workspace(files: &[SourceFile], ws: &str) -> bool {
    let dir_prefix = if ws == "." {
        String::new()
    } else {
        format!("{ws}/")
    };
    let pkg = batch_file(files, &format!("{dir_prefix}package.json"))
        .and_then(|f| parse_json_ordered(&f.content));
    // `{ ...pkg?.dependencies, ...pkg?.devDependencies }` — наявність ключа в
    // будь-якому з двох блоків.
    let has_dep = |name: &str| {
        pkg.as_ref().is_some_and(|p| {
            p.get("dependencies").and_then(|d| d.get(name)).is_some()
                || p.get("devDependencies").and_then(|d| d.get(name)).is_some()
        })
    };
    if has_dep("vue") || has_dep("nuxt") {
        return true;
    }
    files.iter().any(|file| {
        if !file.path.ends_with(".vue") || !file.path.starts_with(&dir_prefix) {
            return false;
        }
        let rel = &file.path[dir_prefix.len()..];
        rel.split('/').count() <= VUE_SCAN_MAX_DEPTH
            && !rel
                .split('/')
                .any(|seg| seg == "node_modules" || seg == "dist")
    })
}

/// Точний порт `detectWorkspaceTypes` (`eslint-config.mjs:109-129`) — ПОВНА
/// форма `{ node, vue }`. Детектор читає лише `vue`-половину
/// ([`detect_vue_workspaces`]); T0-фіксер ([`plan_eslint_config_fix`])
/// потребує обидві — те саме розгортання `dirs`, без другого проходу.
fn detect_workspace_types(files: &[SourceFile]) -> (Vec<String>, Vec<String>) {
    let root_pkg = batch_file(files, "package.json").and_then(|f| parse_json_ordered(&f.content));
    let ws_field: Vec<JsonOrdered> = root_pkg
        .as_ref()
        .and_then(|p| p.get("workspaces"))
        .and_then(JsonOrdered::as_array)
        .map(<[JsonOrdered]>::to_vec)
        .unwrap_or_default();
    let dirs = expand_workspaces(files, &ws_field);
    if dirs.is_empty() {
        return if is_vue_workspace(files, ".") {
            (Vec::new(), vec![".".to_string()])
        } else {
            (vec![".".to_string()], Vec::new())
        };
    }
    let mut node = Vec::new();
    let mut vue = Vec::new();
    for ws in dirs {
        if is_vue_workspace(files, &ws) {
            vue.push(ws);
        } else {
            node.push(ws);
        }
    }
    (node, vue)
}

/// Vue-половина [`detect_workspace_types`] — усе, що читає детектор
/// (`checkEslintWorkspaceTypes` у JS-каноні теж дивиться лише на `vue`).
fn detect_vue_workspaces(files: &[SourceFile]) -> Vec<String> {
    detect_workspace_types(files).1
}

/// Записи string-літералів усередині вмісту списку — точний порт `listEntries`
/// (`eslint-config.mjs:136-142`), винесений окремо від [`parse_list`], бо
/// `mergeEslintConfig` (`eslint-config.mjs:217-224`) викликає його НАПРЯМУ на
/// вже захопленому `nodeMatch[1]`, а не через повторний пошук регексу.
fn list_entries_from_capture(inner: &str) -> Vec<String> {
    let entry_re = regex::Regex::new(STRING_ENTRY_PATTERN).expect("STRING_ENTRY_PATTERN валідний");
    entry_re
        .captures_iter(inner)
        .map(|caps| {
            let value = caps
                .get(1)
                .or_else(|| caps.get(2))
                .map(|m| m.as_str())
                .unwrap_or("");
            normalize_ws(value)
        })
        .collect()
}

/// Спільна форма `parseVueList`/аналогічного розбору `node: [...]`
/// (`eslint-config.mjs:149-151`): знаходить перший список за `pattern`,
/// розбирає його вміст [`list_entries_from_capture`].
fn parse_list(raw: &str, pattern: &str) -> Vec<String> {
    let list_re = regex::Regex::new(pattern).expect("список-патерн валідний");
    let Some(inner) = list_re.captures(raw).and_then(|c| c.get(1)) else {
        return Vec::new();
    };
    list_entries_from_capture(inner.as_str())
}

/// Точний порт `parseVueList` (`eslint-config.mjs:149-151`).
fn parse_vue_list(raw: &str) -> Vec<String> {
    parse_list(raw, VUE_LIST_PATTERN)
}

/// Створює діагностику концерну — дефолтний `reason` (`ctx.concernId`)
/// підставляється викликом із [`JS_CHECK_REASON`].
fn js_check_diagnostic(reason: &str, message: String) -> Diagnostic {
    Diagnostic {
        reason: reason.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Точний порт `checkEslintConfig` + `checkEslintWorkspaceTypes`
/// (`main.mjs:33-100`).
fn check_eslint_config(files: &[SourceFile], out: &mut Vec<Diagnostic>) {
    let Some(eslint_path) = ESLINT_CONFIG_NAMES
        .iter()
        .copied()
        .find(|name| batch_file(files, name).is_some())
    else {
        out.push(js_check_diagnostic(
            ESLINT_CONFIG_MISSING_REASON,
            "Відсутній eslint.config.js або eslint.config.mjs — flat config з getConfig (js.mdc)"
                .to_string(),
        ));
        return;
    };
    let raw = batch_file(files, eslint_path)
        .map(|f| f.content.as_str())
        .unwrap_or("");

    for (needle, message, reason) in [
        (
            "getConfig",
            format!("{eslint_path}: потрібен виклик getConfig (js.mdc)"),
            JS_CHECK_REASON,
        ),
        (
            "@nitra/eslint-config",
            format!("{eslint_path}: імпортуй getConfig з @nitra/eslint-config"),
            JS_CHECK_REASON,
        ),
        (
            AUTO_IMPORTS_IGNORE,
            format!("{eslint_path}: додай у ignores запис {AUTO_IMPORTS_IGNORE} (js.mdc)"),
            ESLINT_CONFIG_IGNORES_REASON,
        ),
    ] {
        if !raw.contains(needle) {
            out.push(js_check_diagnostic(reason, message));
        }
    }

    let vue_workspaces = detect_vue_workspaces(files);
    if vue_workspaces.is_empty() {
        return;
    }
    let declared = parse_vue_list(raw);
    for ws in vue_workspaces {
        if !declared.contains(&ws) {
            out.push(js_check_diagnostic(
                ESLINT_CONFIG_VUE_WORKSPACE_REASON,
                format!(
                    "{eslint_path}: воркспейс '{ws}' містить Vue-код, але відсутній у vue: [...] getConfig — .vue файли не парсяться (js.mdc)"
                ),
            ));
        }
    }
}

/// Рядкове представлення значення `engines.*` — дзеркало `String(value)` для
/// типів, які реально трапляються (розбіжність 5 доккоменту секції).
fn engines_value_string(value: Option<&JsonOrdered>) -> Option<String> {
    match value? {
        JsonOrdered::Str(s) if !s.is_empty() => Some(s.clone()),
        JsonOrdered::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Точний порт `checkEnginesNode` (`main.mjs:150-162`).
fn check_engines_node(label: &str, pkg: &JsonOrdered, out: &mut Vec<Diagnostic>) {
    let Some(engine) = engines_value_string(pkg.get("engines").and_then(|e| e.get("node"))) else {
        out.push(js_check_diagnostic(
            JS_CHECK_REASON,
            format!(
                "{label} не містить engines.node — додай: \"engines\": {{ \"node\": \">=24\" }}"
            ),
        ));
        return;
    };
    let re = regex::Regex::new(NON_DIGITS_PATTERN).expect("NON_DIGITS_PATTERN валідний");
    let first_numeric = re.split(&engine).find(|token| !token.is_empty());
    let ok = first_numeric.is_some_and(|token| token.parse::<f64>().is_ok_and(|n| n >= 24.0));
    if !ok {
        out.push(js_check_diagnostic(
            JS_CHECK_REASON,
            format!("{label}: engines.node \"{engine}\" — має бути >=24"),
        ));
    }
}

/// Точний порт `checkEnginesBun` (`main.mjs:171-183`).
fn check_engines_bun(label: &str, pkg: &JsonOrdered, out: &mut Vec<Diagnostic>) {
    let Some(engine) = engines_value_string(pkg.get("engines").and_then(|e| e.get("bun"))) else {
        out.push(js_check_diagnostic(
            JS_CHECK_REASON,
            format!(
                "{label} не містить engines.bun — додай: \"engines\": {{ \"bun\": \">=1.4\" }}"
            ),
        ));
        return;
    };
    let re = regex::Regex::new(NON_DIGITS_PATTERN).expect("NON_DIGITS_PATTERN валідний");
    let tokens: Vec<f64> = re
        .split(&engine)
        .filter(|token| !token.is_empty())
        .map(|token| token.parse::<f64>().unwrap_or(f64::NAN))
        .collect();
    let major = tokens.first().copied();
    let minor = tokens.get(1).copied();
    let ok = match (major, minor) {
        (Some(major), Some(minor)) if major.is_finite() && minor.is_finite() => {
            major > 1.0 || (major == 1.0 && minor >= 4.0)
        }
        _ => false,
    };
    if !ok {
        out.push(js_check_diagnostic(
            JS_CHECK_REASON,
            format!("{label}: engines.bun \"{engine}\" — має бути >=1.4"),
        ));
    }
}

/// Точний порт `checkPackageJsonJsLint` + `checkWorkspacePackages` +
/// `checkPackageJsonTypeModule` (`main.mjs:115-200`): ітерація по СИРИХ
/// записах `workspaces` (без розгортання глобів — `existsSync` на
/// glob-рядку завжди false).
fn check_package_json_js_lint(files: &[SourceFile], out: &mut Vec<Diagnostic>) {
    let Some(root) = batch_file(files, "package.json") else {
        return;
    };
    // Розбіжність 1 секції: JS `JSON.parse` без try/catch валить концерн.
    let Some(pkg) = parse_json_ordered(&root.content) else {
        return;
    };
    let Some(workspaces) = pkg.get("workspaces").and_then(JsonOrdered::as_array) else {
        return;
    };
    for ws in workspaces {
        let Some(ws) = ws.as_str() else { continue };
        let ws_pkg_rel = format!("{ws}/package.json");
        let Some(ws_file) = batch_file(files, &ws_pkg_rel) else {
            continue;
        };
        let Some(ws_pkg) = parse_json_ordered(&ws_file.content) else {
            continue;
        };
        if ws_pkg.get("type").and_then(JsonOrdered::as_str) != Some("module") {
            out.push(js_check_diagnostic(
                JS_CHECK_REASON,
                format!("{ws_pkg_rel}: має містити \"type\": \"module\" (js.mdc)"),
            ));
        }
        check_engines_node(&ws_pkg_rel, &ws_pkg, out);
        check_engines_bun(&ws_pkg_rel, &ws_pkg, out);
    }
}

/// Точний порт `checkOxlintRc` (`main.mjs:208-237`). Гілка «не вдалося
/// прочитати канон з пакета» недосяжна — асет вшито (доккомент секції).
fn check_oxlintrc(files: &[SourceFile], out: &mut Vec<Diagnostic>) {
    let Some(file) = batch_file(files, ".oxlintrc.json") else {
        out.push(js_check_diagnostic(
            OXLINTRC_MISSING_REASON,
            ".oxlintrc.json не існує — додай конфіг oxlint (js.mdc)".to_string(),
        ));
        return;
    };
    let Some(cfg) = parse_json_ordered(&file.content) else {
        out.push(js_check_diagnostic(
            JS_CHECK_REASON,
            ".oxlintrc.json не є валідним JSON".to_string(),
        ));
        return;
    };
    let canonical =
        parse_json_ordered(OXLINT_CANONICAL_JSON).expect("вшитий канон oxlint — валідний JSON");
    for message in verify_oxlintrc_against_canonical(&cfg, &canonical) {
        out.push(js_check_diagnostic(OXLINTRC_DRIFT_REASON, message));
    }
}

/// Точний порт `checkLintJsWorkflows` (`main.mjs:247-260`).
fn check_lint_js_workflows(files: &[SourceFile], out: &mut Vec<Diagnostic>) {
    let Some(file) = batch_file(files, ".github/workflows/lint.yml") else {
        return;
    };
    let content = file.content.as_str();
    if content.contains("bunx oxlint")
        && content.contains("bunx eslint")
        && content.contains("jscpd")
    {
        out.push(js_check_diagnostic(
            JS_CHECK_REASON,
            ".github/workflows/lint.yml дублює кроки lint-js.yml — залиш один workflow на лінт JS (js.mdc)"
                .to_string(),
        ));
    }
}

/// Точний порт `checkKnipConfig` ПІСЛЯ рефакторингу рішення Ґ
/// (`main.mjs`, read-only): відсутність — звичайне порушення, копію робить T0.
fn check_knip_config(files: &[SourceFile], out: &mut Vec<Diagnostic>) {
    if batch_file(files, "knip.json").is_none() {
        out.push(js_check_diagnostic(
            KNIP_MISSING_REASON,
            "knip.json відсутній — T0 створить його з канону пакета @7n/rules (js.mdc)".to_string(),
        ));
    }
}

/// Точний порт `lint()` `js/check` (`main.mjs`) — WHOLE-BATCH, порядок
/// перевірок значущий (він же порядок діагностик).
fn detect_js_check(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    check_eslint_config(files, &mut out);
    check_package_json_js_lint(files, &mut out);
    check_oxlintrc(files, &mut out);
    check_lint_js_workflows(files, &mut out);
    check_knip_config(files, &mut out);
    for legacy in LEGACY_ESLINT_CONFIGS {
        if batch_file(files, legacy).is_some() {
            out.push(js_check_diagnostic(
                JS_CHECK_REASON,
                format!("Знайдено застарілий конфіг ESLint: {legacy} — видали, використовуй flat config"),
            ));
        }
    }
    out
}

// ---------------------------------------------------------------------
// `js/check` — T0-фіксер ПОРТОВАНО (`fix-check.mjs`, `eslint-config.mjs`,
// `tooling/main.mjs`).
//
// # Чому саме цей фіксер — з підтвердженим дублюванням, не за замовчуванням
//
// `planOxlintrcFix` (`tooling/main.mjs:203-230`) — не незалежна реалізація
// merge-у, а structural mirror `verifyOxlintRcAgainstCanonical`
// (`tooling/main.mjs:155-192`), яку гість УЖЕ портував раніше
// ([`verify_oxlintrc_against_canonical`], доккомент секції «Зріз 2» вище):
// той самий перелік спеціальних ключів (`rules`/`ignorePatterns`/
// `jsPlugins`), та сама трійка допоміжних понять (`asRecordOrEmpty` ⇄
// [`as_record_or_empty`], `deepEqualOxlintCanonical` ⇄
// [`deep_equal_oxlint_canonical`]) — verify ЗВІРЯЄ те саме дерево рішень,
// яке fix БУДУЄ. Портувати лише [`plan_oxlintrc_fix`] і лишити
// `verifyOxlintRcAgainstCanonical` як єдиний JS-канон означало б тримати
// ДВІ копії одного дерева галузей — тут обидві половини вже в гості.
//
// # Package-асети — та сама межа, той самий прецедент
//
// Як і `verifyOxlintRcAgainstCanonical` раніше, [`plan_oxlintrc_fix`]
// потребує канон `oxlint-canonical.json` — [`OXLINT_CANONICAL_JSON`] уже
// вшитий (доккомент секції «Зріз 2»), другого `include_str!` не додано.
// `knip-canonical.json` для `js-check-knip`-патерна вшивається ВПЕРШЕ цією
// хвилею — [`KNIP_CANONICAL_JSON`], прецедент `CARGO_MUTANTS_CONFIG_BASELINE`
// (`crates/plugin-lang-rust/src/lib.rs`, PR #508): читає ТОЙ САМИЙ файл, що
// JS-канон через `KNIP_CANONICAL_JSON_PATH`, копії не створено. Розмір —
// 765 байт (`wc -c knip-canonical.json`), проти 15 407 байт уже вшитого
// oxlint-канону — не вплинуло помітно на бюджет компонента (задача порту,
// звіт). Анти-дрейф-гейт — [`embedded_knip_canonical_matches_source_file`],
// той самий шаблон, що PR #508: байт-у-байт звірка з файлом-джерелом через
// `env!("CARGO_MANIFEST_DIR")`, незалежно від шляху `include_str!`.
//
// # `eslint.config.js` — третій патерн, найбільший за обсягом порту
//
// `js-check-eslint-config` (scaffold/merge) — увесь `eslint-config.mjs`,
// детектор уже читав `vue`-половину [`detect_workspace_types`]
// ([`detect_vue_workspaces`]); [`plan_eslint_config_fix`] — перший
// споживач `node`-половини. Регекс-плани [`merge_eslint_config`] —
// текстовий хірургічний merge (не AST-переписування): той самий
// fail-safe, що в JS-каноні (немає `getConfig({` — вставка `vue: [...]`
// не відбувається, решта merge-кроків усе одно застосовується).
//
// # `FixRequest` без диск-IO — детермінований і без capability
//
// На відміну від `fix-check.mjs` (три окремі `fs`-виклики: `readFile`
// `.oxlintrc.json`, `readFile`/`writeFile` `eslint.config.js`, `copyFile`
// `knip.json`), [`fix_js_check`] читає ЛИШЕ `request.files` (той самий
// батч, що бачив [`detect_js_check`], спека §3.2) — жодного `fs-read`
// не потребує, WriteFile-контент повністю обчислюється з батчу й вшитих
// канонів.
//
// # Доказ парності
//
// `detect → fix → detect` чисто — тест
// [`fix_js_check_round_trip_with_detect_is_clean`] нижче (гість-only
// раунд-трип, дзеркало `fix_cargo_mutants_config_round_trip_with_detect_is_clean`
// PR #508). Parity JS-канон ⇄ гість — новий блок
// `wasm-plugin-parity.test.mjs` (секція «js/check T0-фікс»), той самий
// `runWasmConcernFix`, що вже ганяє `js/doc_comments`.

/// Канон knip, вшитий у компонент — ТОЙ САМИЙ файл, що читає JS-канон через
/// `KNIP_CANONICAL_JSON_PATH` (`tooling/main.mjs`). Анти-дрейф —
/// [`embedded_knip_canonical_matches_source_file`] (доккомент секції вище).
const KNIP_CANONICAL_JSON: &str =
    include_str!("../../../plugins/lang-js/rules/js/tooling/data/tooling/knip-canonical.json");

/// Одинарно-квотований літерал списку — точний порт `quote`
/// (`eslint-config.mjs:157-159`).
fn quote_ws(ws: &str) -> String {
    format!("'{ws}'")
}

/// Точний порт `renderEslintConfigScaffold` (`eslint-config.mjs:167-184`) —
/// повний шаблон файлу, коли `eslint.config.{js,mjs}` відсутній.
fn render_eslint_config_scaffold(node: &[String], vue: &[String]) -> String {
    let mut args: Vec<String> = Vec::new();
    if !node.is_empty() {
        let list = node.iter().map(|w| quote_ws(w)).collect::<Vec<_>>().join(", ");
        args.push(format!("    node: [{list}]"));
    }
    if !vue.is_empty() {
        let list = vue.iter().map(|w| quote_ws(w)).collect::<Vec<_>>().join(", ");
        args.push(format!("    vue: [{list}]"));
    }
    [
        "import { getConfig } from '@nitra/eslint-config'".to_string(),
        String::new(),
        "export default [".to_string(),
        "  {".to_string(),
        format!("    ignores: ['{AUTO_IMPORTS_IGNORE}']"),
        "  },".to_string(),
        "  ...getConfig({".to_string(),
        args.join(",\n"),
        "  })".to_string(),
        "]".to_string(),
        String::new(),
    ]
    .join("\n")
}

/// Точний порт `mergeEslintConfig` (`eslint-config.mjs:197-227`) —
/// хірургічний merge наявного `eslint.config.{js,mjs}` без переписування
/// решти файлу (кастомні ignores/overrides/коментарі не чіпаються). Бере
/// лише `vue` — сам JS-оригінал приймає весь `types`, але читає з нього
/// ЛИШЕ `types.vue` (`node`-список фільтрується від vue-записів, не від
/// `types.node`); порт відображає це явно сигнатурою, а не мовчазним
/// ігноруванням параметра.
fn merge_eslint_config(raw: &str, vue: &[String]) -> String {
    let mut out = raw.to_string();

    if !out.contains(AUTO_IMPORTS_IGNORE) {
        let ignores_re = regex::Regex::new(IGNORES_OPEN_PATTERN).expect("IGNORES_OPEN_PATTERN валідний");
        if let Some(m) = ignores_re.find(&out) {
            let replacement = format!("{}'{AUTO_IMPORTS_IGNORE}', ", m.as_str());
            out = format!("{}{replacement}{}", &out[..m.start()], &out[m.end()..]);
        }
    }

    let current_vue_list = parse_vue_list(&out);
    let missing_vue: Vec<&String> = vue.iter().filter(|ws| !current_vue_list.contains(ws)).collect();
    if !missing_vue.is_empty() {
        let inserted = missing_vue.iter().map(|w| quote_ws(w)).collect::<Vec<_>>().join(", ");
        let vue_re = regex::Regex::new(VUE_LIST_PATTERN).expect("VUE_LIST_PATTERN валідний");
        if let Some(caps) = vue_re.captures(&out) {
            let whole = caps.get(0).expect("група 0 завжди присутня");
            let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let rest = if !inner.trim().is_empty() {
                format!(", {inner}")
            } else {
                inner.to_string()
            };
            let replacement = format!("vue: [{inserted}{rest}]");
            out = format!("{}{replacement}{}", &out[..whole.start()], &out[whole.end()..]);
        } else {
            let get_config_re =
                regex::Regex::new(GET_CONFIG_OBJ_PATTERN).expect("GET_CONFIG_OBJ_PATTERN валідний");
            if let Some(m) = get_config_re.find(&out) {
                let replacement = format!("{}\n    vue: [{inserted}],", m.as_str());
                out = format!("{}{replacement}{}", &out[..m.start()], &out[m.end()..]);
            }
            // без `getConfig({` — merge неможливий, лишаємо як є (fail-safe,
            // дзеркало JS-коментаря `eslint-config.mjs:214`).
        }
    }

    let node_re = regex::Regex::new(NODE_LIST_PATTERN).expect("NODE_LIST_PATTERN валідний");
    if let Some(caps) = node_re.captures(&out) {
        let whole = caps.get(0).expect("група 0 завжди присутня");
        let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let entries = list_entries_from_capture(inner);
        let kept: Vec<&String> = entries.iter().filter(|e| !vue.contains(e)).collect();
        if kept.len() != entries.len() {
            let replacement = format!(
                "node: [{}]",
                kept.iter().map(|w| quote_ws(w)).collect::<Vec<_>>().join(", ")
            );
            out = format!("{}{replacement}{}", &out[..whole.start()], &out[whole.end()..]);
        }
    }

    out
}

/// Результат [`plan_eslint_config_fix`] — точний відповідник JS
/// `{ path, content, message }` (`eslint-config.mjs:236`), без `message`
/// (WIT `fix-plan` v3.0 не несе людських повідомлень, доккомент
/// `crates/rules-contract/src/fix.rs`).
struct EslintConfigPlan {
    path: String,
    content: String,
}

/// Точний порт `planEslintConfigFix` (`eslint-config.mjs:236-263`) — scaffold
/// відсутнього `eslint.config.js` або merge наявного під детектовані типи.
/// `None` — «нічого міняти» (файл уже узгоджений, дзеркало JS `return null`).
fn plan_eslint_config_fix(files: &[SourceFile]) -> Option<EslintConfigPlan> {
    let (node, vue) = detect_workspace_types(files);

    let Some(existing) = ESLINT_CONFIG_NAMES
        .iter()
        .copied()
        .find(|name| batch_file(files, name).is_some())
    else {
        // JS-канон тут ще будує людський `summary` для `message`
        // (`eslint-config.mjs:241-246`) — WIT `fix-plan` v3.0 його не несе
        // (доккомент `EslintConfigPlan`), тож у порту цей текст не потрібен.
        return Some(EslintConfigPlan {
            path: "eslint.config.js".to_string(),
            content: render_eslint_config_scaffold(&node, &vue),
        });
    };

    let raw = batch_file(files, existing).map(|f| f.content.as_str()).unwrap_or("");
    let merged = merge_eslint_config(raw, &vue);
    if merged == raw {
        return None;
    }
    Some(EslintConfigPlan {
        path: existing.to_string(),
        content: merged,
    })
}

/// Запис-як-record-або-порожньо — точний порт `asRecordOrEmpty`
/// (`tooling/main.mjs:72-79`).
fn as_record_or_empty(v: Option<&JsonOrdered>) -> Vec<(String, JsonOrdered)> {
    match v {
        Some(JsonOrdered::Object(entries)) => entries.clone(),
        _ => Vec::new(),
    }
}

/// Значення за ключем у записі впорядкованих пар — дзеркало `record[key]`.
fn record_get<'a>(record: &'a [(String, JsonOrdered)], key: &str) -> Option<&'a JsonOrdered> {
    record.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

/// `record[key] = value` зі збереженням JS-семантики порядку ключів
/// (`{...a, ...b}`): наявний ключ оновлюється НА МІСЦІ (позиція не
/// змінюється), новий — додається в кінець.
fn record_set(record: &mut Vec<(String, JsonOrdered)>, key: &str, value: JsonOrdered) {
    if let Some(entry) = record.iter_mut().find(|(k, _)| k == key) {
        entry.1 = value;
    } else {
        record.push((key.to_string(), value));
    }
}

/// `{ ...base, ...incoming }` — точний порядок ключів JS spread-обʼєкта:
/// ключі `base` першими (значення можуть бути перезаписані), потім ключі
/// `incoming`, яких не було в `base`, у порядку `incoming`.
fn spread_merge_records(
    base: Vec<(String, JsonOrdered)>,
    incoming: &[(String, JsonOrdered)],
) -> Vec<(String, JsonOrdered)> {
    let mut out = base;
    for (key, value) in incoming {
        record_set(&mut out, key, value.clone());
    }
    out
}

/// Точний порт `planOxlintrcFix` (`tooling/main.mjs:203-230`) — детермінований
/// merge `.oxlintrc.json` до відповідності канону. ДЗЕРКАЛИТЬ
/// [`verify_oxlintrc_against_canonical`] (доккомент секції вище): та сама
/// трійка спецключів (`rules`/`ignorePatterns`/`jsPlugins`), той самий
/// прохід `canonical.entries()` в документному порядку. Project-specific
/// розширення (зайві `rules`-ключі, зайві `ignorePatterns`) НЕ видаляються.
fn plan_oxlintrc_fix(actual: Option<&JsonOrdered>, canonical: &JsonOrdered) -> JsonOrdered {
    let mut merged = as_record_or_empty(actual);
    for (key, expected) in canonical.entries() {
        match key.as_str() {
            "rules" => {
                let base = as_record_or_empty(record_get(&merged, "rules"));
                let expected_entries = match expected {
                    JsonOrdered::Object(entries) => entries.clone(),
                    _ => Vec::new(),
                };
                let merged_rules = spread_merge_records(base, &expected_entries);
                record_set(&mut merged, "rules", JsonOrdered::Object(merged_rules));
            }
            "ignorePatterns" => {
                let existing: Vec<JsonOrdered> = record_get(&merged, "ignorePatterns")
                    .and_then(JsonOrdered::as_array)
                    .map(<[JsonOrdered]>::to_vec)
                    .unwrap_or_default();
                let canon_patterns: &[JsonOrdered] = expected.as_array().unwrap_or(&[]);
                let mut combined = existing.clone();
                for pattern in canon_patterns {
                    if !existing.contains(pattern) {
                        combined.push(pattern.clone());
                    }
                }
                record_set(&mut merged, "ignorePatterns", JsonOrdered::Array(combined));
            }
            "jsPlugins" => {
                let existing: Vec<JsonOrdered> = record_get(&merged, "jsPlugins")
                    .and_then(JsonOrdered::as_array)
                    .map(<[JsonOrdered]>::to_vec)
                    .unwrap_or_default();
                let canon_plugins: &[JsonOrdered] = expected.as_array().unwrap_or(&[]);
                let mut combined = existing.clone();
                for plugin in canon_plugins {
                    if existing
                        .iter()
                        .all(|entry| !deep_equal_oxlint_canonical(Some(entry), plugin))
                    {
                        combined.push(plugin.clone());
                    }
                }
                record_set(&mut merged, "jsPlugins", JsonOrdered::Array(combined));
            }
            _ => record_set(&mut merged, key, expected.clone()),
        }
    }
    JsonOrdered::Object(merged)
}

/// Дзеркало `JSON.stringify(value, null, 2)` — документний порядок ключів
/// (як і компактний [`js_json_stringify`]), 2-пробільний відступ на рівень,
/// порожні обʼєкт/масив БЕЗ переносу рядка (`{}`/`[]`, той самий edge-case,
/// що в JS). Потрібен лише для запису `.oxlintrc.json` — детект-шлях
/// повідомлень лишається на компактній формі.
fn js_json_stringify_pretty(value: &JsonOrdered, indent_level: usize) -> String {
    let pad = "  ".repeat(indent_level);
    let child_pad = "  ".repeat(indent_level + 1);
    match value {
        JsonOrdered::Null => "null".to_string(),
        JsonOrdered::Bool(true) => "true".to_string(),
        JsonOrdered::Bool(false) => "false".to_string(),
        JsonOrdered::Number(n) => n.to_string(),
        JsonOrdered::Str(s) => json_escape_string(s),
        JsonOrdered::Array(items) => {
            if items.is_empty() {
                return "[]".to_string();
            }
            let inner: Vec<String> = items
                .iter()
                .map(|item| format!("{child_pad}{}", js_json_stringify_pretty(item, indent_level + 1)))
                .collect();
            format!("[\n{}\n{pad}]", inner.join(",\n"))
        }
        JsonOrdered::Object(entries) => {
            if entries.is_empty() {
                return "{}".to_string();
            }
            let inner: Vec<String> = entries
                .iter()
                .map(|(k, v)| {
                    format!(
                        "{child_pad}{}: {}",
                        json_escape_string(k),
                        js_json_stringify_pretty(v, indent_level + 1)
                    )
                })
                .collect();
            format!("{{\n{}\n{pad}}}", inner.join(",\n"))
        }
    }
}

/// T0-фіксер `js/check` — точний порт трьох патернів `fix-check.mjs`
/// (`js-check-eslint-config`, `js-check-oxlintrc`, `js-check-knip`, у тому
/// самому порядку). Кожен патерн — окремий `test`/`apply` у JS-каноні;
/// тут — незалежна `if`-гілка за належним `reason` у `request.diagnostics`
/// (доккомент секції вище пояснює вибір package-асетів і межу `FixRequest`).
fn fix_js_check(request: &FixRequest) -> FixPlan {
    let mut edits = Vec::new();

    let needs_eslint_config = request.diagnostics.iter().any(|d| {
        matches!(
            d.reason.as_str(),
            ESLINT_CONFIG_MISSING_REASON | ESLINT_CONFIG_IGNORES_REASON | ESLINT_CONFIG_VUE_WORKSPACE_REASON
        )
    });
    if needs_eslint_config {
        if let Some(plan) = plan_eslint_config_fix(&request.files) {
            edits.push(FileEdit::Write(WriteFile {
                path: plan.path,
                content: plan.content,
            }));
        }
    }

    let needs_oxlintrc = request
        .diagnostics
        .iter()
        .any(|d| matches!(d.reason.as_str(), OXLINTRC_MISSING_REASON | OXLINTRC_DRIFT_REASON));
    if needs_oxlintrc {
        let actual = batch_file(&request.files, ".oxlintrc.json").and_then(|f| parse_json_ordered(&f.content));
        let canonical =
            parse_json_ordered(OXLINT_CANONICAL_JSON).expect("вшитий канон oxlint — валідний JSON");
        let merged = plan_oxlintrc_fix(actual.as_ref(), &canonical);
        let content = format!("{}\n", js_json_stringify_pretty(&merged, 0));
        edits.push(FileEdit::Write(WriteFile {
            path: ".oxlintrc.json".to_string(),
            content,
        }));
    }

    let needs_knip = request.diagnostics.iter().any(|d| d.reason == KNIP_MISSING_REASON);
    if needs_knip && batch_file(&request.files, "knip.json").is_none() {
        edits.push(FileEdit::Write(WriteFile {
            path: "knip.json".to_string(),
            content: KNIP_CANONICAL_JSON.to_string(),
        }));
    }

    FixPlan { edits }
}

// =====================================================================
// Зріз 4 контракту v3.1 (`docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`,
// §7, рішення Е): `js/doc_comments` — detect + T0-фікс разом.
//
// # Чому detect без fix тут неповний
//
// Це ОСТАННІЙ придатний до порту концерн `lang-js` (доккомент секції «Батч 8» відніс
// його до класу 3 — «розвʼязне, але не безкоштовно»). Його `data.{start,end}`
// — не декоративне поле: на ньому цілком тримається T0-контур
// (`promotable`-блок `//`-коментарів механічно підвищується до `/** … */`).
// Портувати лише `detect` означало б віддати JS-фіксеру офсети чужої системи
// координат — тому обидві половини їдуть одним зрізом.
//
// # Офсети: де конверсія потрібна, а де ні
//
// napi-`oxc-parser` (JS-бік) індексує **UTF-16 code units**, crate-`oxc_parser`
// — **байти**. На ASCII-файлі числа збігаються, тож наївний порт пройшов би
// тести й розійшовся на першому файлі з кирилицею чи емодзі. Розкладка:
//
// - **Конверсія ПОТРІБНА рівно у двох точках — на WIT-межі.**
//   1. `detect`: [`check_file_doc_comments`] кладе в `data.{start,end}` не
//      байтові офсети, а результат [`byte_offset_to_utf16`]. Причина
//      конкретна: `data` — частина WIT-контракту діагностики, яку читає
//      JS-оркестрація й із якою звіряється parity-еталон детекту
//      (`goldenJs`). §2.93 зняла JS-канон ФІКСУ (`fix-doc_comments.mjs`),
//      тож споживачем `data.{start,end}` лишився рівно один — [`fix_doc_comments`]
//      нижче, який тими самими офсетами ходить назад; конверсія
//      симетрична, і саме тому вона й далі потрібна в ОБИДВІ сторони.
//   2. `fix`: [`fix_doc_comments`] читає ті самі `data.{start,end}` назад і
//      переводить їх [`utf16_offset_to_byte`] ПЕРЕД тим, як різати
//      UTF-8-рядок `SourceFile::content`.
//
// - **Конверсія НЕ потрібна ніде всередині.** Порівняння (`c.end <= pos`),
//   проміжки (`src.slice(c.end, pos)`), `trim()`, підрахунок переводів рядка,
//   пошук початку рядка й сам splice — усе рахується в байтовому просторі на
//   UTF-8-рядку. Обидва простори монотонні й внутрішньо консистентні: `a < b`
//   у байтах ⇔ `a < b` у UTF-16, а зрізаний текст той самий. Це той самий
//   аргумент, що вже задокументований для `planVueAugment` (секція «Зріз 1»,
//   підрозділ «Офсети augment-у») — різниця лише в тому, що ТУТ офсети
//   витікають назовні, тож дві межові точки конверсії обовʼязкові.
//
// Анти-дрейф — parity-фікстури з не-ASCII вмістом (кирилиця в коментарях і
// в іменах експортів, емодзі поза BMP, тобто сурогатна пара): на них байтовий
// офсет і UTF-16-офсет розходяться, і забутий виклик конверсії падає.
//
// # Дефект JS-канону, який ПОЛАГОДЖЕНО, а не скопійовано (Р11)
//
// `applyT0` (`run-fix.mjs`) ганяє ВСІ патерни концерну одним масивом
// `violations`: спершу синтетичний `wasm-fix:*`, потім патерни
// `fix-doc_comments.mjs`. Після того, як wasm-план уже переписав файл,
// офсети тих самих `violations` стають несвіжими — JS-фіксер різав би вже
// підвищений `/** … */` як «блок `//`-коментарів». Пілот
// `test/no-bun-test-import` уникнув цього видаленням JS-фіксера; тут канон
// потрібен як fallback, тож замість видалення в ОБИДВІ реалізації додано
// один і той самий guard [`is_line_comment_block`]: підвищується лише
// зріз, кожен рядок якого досі починається з `//`. Це робить фікс
// ідемпотентним і закриває клас «несвіжі офсети» взагалі, а не лише
// wasm-сценарій.
//
// # Задокументовані розбіжності
//
// 1. **`violation.file` відсутній**: JS-фіксер зробив би
//    `join(ctx.cwd, undefined)` і впав; [`fix_doc_comments`] такі діагностики
//    пропускає (skip-not-crash дух решти порту). Недосяжно з власного
//    `detect` — обидві гілки завжди виставляють `file`.
// 2. **`.trim()`**: JS-набір WhiteSpace/LineTerminator і Rust
//    `char::is_whitespace` (Unicode `White_Space`) розходяться на двох
//    символах — `U+FEFF` (JS тримає за пробіл, Rust ні) і `U+0085` (навпаки).
//    Замість `str::trim` порт використовує [`js_trim`] з точним
//    ECMA-262-набором: файл із BOM перед header-JSDoc інакше давав би різні
//    вердикти.
// 3. **`files === undefined`** (globby-гілка `lint()` з власними
//    `IGNORE_GLOBS`) у порті недосяжна: контрибуція `per-file`, host завжди
//    передає явний список файлів. Гість застосовує рівно другу гілку
//    JS-канону — фільтр [`is_doc_comment_target`].
// =====================================================================

/// Ключ контрибуції `js/doc_comments` (зріз 4 контракту v3.1).
const CONCERN_DOC_COMMENTS: &str = "js/doc_comments";

/// `reason` порушення «файл з експортами без header-JSDoc» — точний порт
/// `main.mjs:160`.
const DOC_COMMENTS_MISSING_HEADER_REASON: &str = "missing-file-header";

/// `reason` порушення «експорт без JSDoc-опису» — точний порт `main.mjs:170`.
const DOC_COMMENTS_MISSING_EXPORT_REASON: &str = "missing-export-doc";

/// Точний порт `FILE_HEADER_HINT` (`main.mjs:39-40`) — текст іде у `message`
/// біт-у-біт.
const DOC_COMMENTS_FILE_HEADER_HINT: &str = "Глобальний сенс: конвеєр doc-files копіює цей коментар ДОСЛІВНО в секцію «Огляд» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього «Огляд» вигадує LLM із самого коду.";

/// Точний порт `EXPORT_DOC_HINT` (`main.mjs:41-42`).
const DOC_COMMENTS_EXPORT_DOC_HINT: &str = "Глобальний сенс: конвеєр doc-files бере цей опис ДОСЛІВНО в секцію «Публічний API» автоматично згенерованої документації файлу (0 LLM-токенів, isApiGap/renderApiLine) — без нього опис вигадує LLM.";

/// Точний порт `EXCLUDED_FILE_RE` (`main.mjs:31`) — тести/фікстури/декларації
/// поза вимогою.
const DOC_COMMENTS_EXCLUDED_FILE_PATTERN: &str =
    r"(\.test\.|\.spec\.|\.d\.ts$)|(^|/)(tests|fixtures|__mocks__)/";

/// Точний порт `SOURCE_EXT_RE` (`main.mjs:32`).
const DOC_COMMENTS_SOURCE_EXT_PATTERN: &str = r"\.(js|mjs|cjs|ts)$";

/// Точний порт `SHEBANG_RE` (`main.mjs:33`, `/^#!.*$/m`) — прапорець `m` без
/// `g`, тож `replace` знімає ЛИШЕ перше входження (дзеркало
/// `String.prototype.replace` з non-global regex).
const DOC_COMMENTS_SHEBANG_PATTERN: &str = r"(?m)^#!.*$";

/// Точний порт `LINE_COMMENT_PREFIX_RE` (`fix-doc_comments.mjs:11`).
const DOC_COMMENTS_LINE_PREFIX_PATTERN: &str = r"^\s*//\s?";

/// Рядок усе ще починається з `//` — guard ідемпотентності T0-фікса
/// (доккомент секції, підрозділ «Дефект JS-канону»); дзеркало
/// `LINE_COMMENT_LINE_RE` у `fix-doc_comments.mjs`.
const DOC_COMMENTS_LINE_START_PATTERN: &str = r"^\s*//";

/// Чи `c` — `WhiteSpace` ‖ `LineTerminator` за ECMA-262 (те, що реально
/// зрізає `String.prototype.trim`). Свідомо НЕ `char::is_whitespace`:
/// Unicode-властивість `White_Space` і JS-набір розходяться на `U+FEFF`
/// (JS зрізає, Unicode — ні) та `U+0085` (навпаки) — розбіжність 2
/// доккомента секції.
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}'
            | '\u{b}'
            | '\u{c}'
            | '\u{20}'
            | '\u{a0}'
            | '\u{feff}'
            | '\u{a}'
            | '\u{d}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}' | '\u{202f}' | '\u{205f}' | '\u{3000}'
    )
}

/// Дзеркало `String.prototype.trim` ([`is_js_whitespace`]).
fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// Дзеркало `String.prototype.trimEnd` ([`is_js_whitespace`]).
fn js_trim_end(s: &str) -> &str {
    s.trim_end_matches(is_js_whitespace)
}

/// Байтовий офсет у `src` → офсет у UTF-16 code units. ПЕРША з двох межових
/// точок конверсії (доккомент секції): усе, що йде в `data.{start,end}`
/// діагностики, проходить через неї.
fn byte_offset_to_utf16(src: &str, byte_offset: usize) -> usize {
    src[..byte_offset].chars().map(char::len_utf16).sum()
}

/// Офсет у UTF-16 code units → байтовий офсет у `src`. ДРУГА межова точка:
/// `fix` отримує `data.{start,end}` у координатах JS і мусить повернути їх
/// у байти, перш ніж різати UTF-8-рядок. Офсет за межами рядка обрізається до
/// `src.len()` (діагностика з чужого файлу не панікує гість).
fn utf16_offset_to_byte(src: &str, utf16_offset: usize) -> usize {
    let mut units = 0usize;
    for (byte_index, ch) in src.char_indices() {
        if units >= utf16_offset {
            return byte_index;
        }
        units += ch.len_utf16();
    }
    src.len()
}

/// Точний порт `isDocCommentTarget` (`main.mjs:49-52`).
fn is_doc_comment_target(
    rel_posix: &str,
    excluded_re: &regex::Regex,
    ext_re: &regex::Regex,
) -> bool {
    if excluded_re.is_match(rel_posix) {
        return false;
    }
    ext_re.is_match(rel_posix)
}

/// Один експорт із позицією для пошуку JSDoc — дзеркало елемента
/// `collectExports` (`{ name, start }`, БАЙТОВИЙ офсет усередині гостя).
struct DocCommentExport {
    /// Ім'я символу для `message`/`data.name`.
    name: String,
    /// Байтовий офсет початку `Export*Declaration` (`node.start` JS-канону).
    start: usize,
}

/// Ім'я `FunctionDeclaration`/`ClassDeclaration` або `"default"` — дзеркало
/// `decl.id?.name ?? 'default'` (`main.mjs:69`).
fn binding_name_or_default(id: Option<&oxc_ast::ast::BindingIdentifier>) -> String {
    id.map_or_else(|| "default".to_string(), |i| i.name.to_string())
}

/// Точний порт `collectExports` (`main.mjs:61-79`): named/default із
/// `declaration`; `export { a, b }`-специфікатори свідомо пропускаються
/// (символ оголошено інде). TS-only декларації (`export type …`,
/// `export interface …`) у жодну з гілок JS-канону не потрапляють — тут теж.
fn collect_doc_comment_exports(program: &Program) -> Vec<DocCommentExport> {
    let mut out = Vec::new();
    for stmt in &program.body {
        match stmt {
            Statement::ExportNamedDeclaration(node) => {
                let Some(declaration) = &node.declaration else {
                    continue;
                };
                let start = node.span.start as usize;
                match declaration {
                    Declaration::FunctionDeclaration(func) => out.push(DocCommentExport {
                        name: binding_name_or_default(func.id.as_ref()),
                        start,
                    }),
                    Declaration::ClassDeclaration(class) => out.push(DocCommentExport {
                        name: binding_name_or_default(class.id.as_ref()),
                        start,
                    }),
                    Declaration::VariableDeclaration(var) => {
                        for declarator in &var.declarations {
                            if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                                out.push(DocCommentExport {
                                    name: id.name.to_string(),
                                    start,
                                });
                            }
                        }
                    }
                    _ => {}
                }
            }
            Statement::ExportDefaultDeclaration(node) => {
                let start = node.span.start as usize;
                let name = match &node.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(func) => {
                        binding_name_or_default(func.id.as_ref())
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                        binding_name_or_default(class.id.as_ref())
                    }
                    // `export default 42` / `export default interface X {}` —
                    // гілка `else if (isDefault)` JS-канону (`main.mjs:74-75`).
                    _ => "default".to_string(),
                };
                out.push(DocCommentExport { name, start });
            }
            _ => {}
        }
    }
    out
}

/// Вміст коментаря (`Comment::content_span`) — дзеркало `comment.value`
/// ESTree-форми napi-парсера.
fn comment_value<'a>(src: &'a str, comment: &Comment) -> &'a str {
    let span = comment.content_span();
    &src[span.start as usize..span.end as usize]
}

/// Точний порт `jsDocCommentBefore` (`plugins/lang-js/doc-files/js-facts.mjs`)
/// у предикатній формі: JS-версія віддає ДОСЛІВНИЙ текст коментаря, але
/// `js/doc_comments` використовує лише його істинність (`if (…) continue`).
fn has_js_doc_comment_before(comments: &[Comment], src: &str, pos: usize) -> bool {
    let mut best: Option<&Comment> = None;
    for comment in comments {
        if !comment.is_block() || !comment_value(src, comment).starts_with('*') {
            continue;
        }
        if comment.span.end as usize > pos {
            continue;
        }
        let better = match best {
            None => true,
            Some(current) => comment.span.end > current.span.end,
        };
        if better {
            best = Some(comment);
        }
    }
    match best {
        None => false,
        Some(best) => js_trim(&src[best.span.end as usize..pos]).is_empty(),
    }
}

/// Точний порт `hasFileHeader` (`main.mjs:136-141`).
fn has_doc_comment_file_header(comments: &[Comment], src: &str, shebang_re: &regex::Regex) -> bool {
    let Some(first) = comments.first() else {
        return false;
    };
    if !first.is_block() || !comment_value(src, first).starts_with('*') {
        return false;
    }
    let before = &src[..first.span.start as usize];
    js_trim(&shebang_re.replace(before, "")).is_empty()
}

/// Чи проміжок `gap` розриває «впритул»-звʼязок: між блоком і символом є код
/// або порожній рядок. Спільна умова `promotableLineBlockBefore` і
/// `promotableHeaderBlock` (`gapAfter.trim() !== '' || gapAfter.split('\n').length > 2`).
fn doc_comment_gap_breaks(gap: &str) -> bool {
    !js_trim(gap).is_empty() || gap.matches('\n').count() > 1
}

/// Точний порт `promotableLineBlockBefore` (`main.mjs:90-105`) — байтові межі
/// суцільного блоку `//`-коментарів впритул над `pos`.
fn promotable_line_block_before(
    comments: &[Comment],
    src: &str,
    pos: usize,
) -> Option<(usize, usize)> {
    let mut lines: Vec<&Comment> = comments
        .iter()
        .filter(|c| c.is_line() && (c.span.end as usize) <= pos)
        .collect();
    lines.sort_by_key(|c| c.span.start);

    let mut end: Option<usize> = None;
    let mut start: Option<usize> = None;
    for comment in lines.iter().rev() {
        // `end === -1 ? pos : start` — `start` тут ще від ПОПЕРЕДНЬОЇ ітерації.
        let gap_end = start.unwrap_or(pos);
        if doc_comment_gap_breaks(&src[comment.span.end as usize..gap_end]) {
            break;
        }
        if end.is_none() {
            end = Some(comment.span.end as usize);
        }
        start = Some(comment.span.start as usize);
    }
    match (start, end) {
        (Some(start), Some(end)) => Some((start, end)),
        _ => None,
    }
}

/// Точний порт `promotableHeaderBlock` (`main.mjs:114-127`).
fn promotable_header_block(
    comments: &[Comment],
    src: &str,
    shebang_re: &regex::Regex,
) -> Option<(usize, usize)> {
    let first = comments.first()?;
    if !first.is_line() {
        return None;
    }
    let before = &src[..first.span.start as usize];
    if !js_trim(&shebang_re.replace(before, "")).is_empty() {
        return None;
    }
    let mut end = first.span.end as usize;
    for comment in comments.iter().skip(1) {
        if !comment.is_line() {
            break;
        }
        if doc_comment_gap_breaks(&src[end..comment.span.start as usize]) {
            break;
        }
        end = comment.span.end as usize;
    }
    Some((first.span.start as usize, end))
}

/// `data`-payload promotable-порушення: `{promotable, start, end}` плюс
/// опційний `name`. ЄДИНЕ місце, де байтові офсети стають UTF-16
/// (доккомент секції, точка конверсії 1).
fn doc_comment_promotable_data(src: &str, block: (usize, usize), name: Option<&str>) -> String {
    let start = byte_offset_to_utf16(src, block.0);
    let end = byte_offset_to_utf16(src, block.1);
    match name {
        Some(name) => format!(
            "{{\"promotable\":true,\"start\":{start},\"end\":{end},\"name\":{}}}",
            json_escape_string(name)
        ),
        None => format!("{{\"promotable\":true,\"start\":{start},\"end\":{end}}}"),
    }
}

/// Точний порт `checkFileDocComments` (`main.mjs:149-177`): header + JSDoc над
/// кожним експортом; файл без експортів і файл із syntax-error — поза вимогою.
fn check_file_doc_comments(src: &str, rel_posix: &str) -> Vec<Diagnostic> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, src, scan_source_type(rel_posix)).parse();
    // Порт `parseProgramAndCommentsOrNull` → `null` (`result.errors?.length`):
    // синтаксис ловлять інші концерни.
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let comments = ret.program.comments.as_slice();
    let exports = collect_doc_comment_exports(&ret.program);
    if exports.is_empty() {
        return Vec::new();
    }

    let shebang_re = regex::Regex::new(DOC_COMMENTS_SHEBANG_PATTERN)
        .expect("DOC_COMMENTS_SHEBANG_PATTERN валідний");
    let mut violations = Vec::new();
    if !has_doc_comment_file_header(comments, src, &shebang_re) {
        let block = promotable_header_block(comments, src, &shebang_re);
        violations.push(Diagnostic {
            reason: DOC_COMMENTS_MISSING_HEADER_REASON.to_string(),
            message: format!(
                "{rel_posix}: файл з експортами без провідного header-JSDoc. {DOC_COMMENTS_FILE_HEADER_HINT}"
            ),
            file: Some(rel_posix.to_string()),
            severity: Severity::Error,
            data: Some(match block {
                Some(block) => doc_comment_promotable_data(src, block, None),
                None => "{}".to_string(),
            }),
        });
    }
    for export in &exports {
        if has_js_doc_comment_before(comments, src, export.start) {
            continue;
        }
        let block = promotable_line_block_before(comments, src, export.start);
        violations.push(Diagnostic {
            reason: DOC_COMMENTS_MISSING_EXPORT_REASON.to_string(),
            message: format!(
                "{rel_posix}: export {} без JSDoc-опису. {DOC_COMMENTS_EXPORT_DOC_HINT}",
                export.name
            ),
            file: Some(rel_posix.to_string()),
            severity: Severity::Error,
            data: Some(match block {
                Some(block) => doc_comment_promotable_data(src, block, Some(&export.name)),
                None => format!("{{\"name\":{}}}", json_escape_string(&export.name)),
            }),
        });
    }
    violations
}

/// Точний порт `lint()` `js/doc_comments` (`main.mjs:184-198`), гілка з
/// переданими `files` — PER-FILE (розбіжність 3 доккомента секції).
fn detect_doc_comments(files: &[SourceFile]) -> Vec<Diagnostic> {
    let excluded_re = regex::Regex::new(DOC_COMMENTS_EXCLUDED_FILE_PATTERN)
        .expect("DOC_COMMENTS_EXCLUDED_FILE_PATTERN валідний");
    let ext_re = regex::Regex::new(DOC_COMMENTS_SOURCE_EXT_PATTERN)
        .expect("DOC_COMMENTS_SOURCE_EXT_PATTERN валідний");
    let mut out = Vec::new();
    for file in files {
        if !is_doc_comment_target(&file.path, &excluded_re, &ext_re) {
            continue;
        }
        out.extend(check_file_doc_comments(&file.content, &file.path));
    }
    out
}

/// Чи `block` усе ще суцільний блок `//`-коментарів. Guard ідемпотентності
/// (доккомент секції, підрозділ «Дефект JS-канону»): зріз за несвіжими
/// офсетами вже підвищеного блоку цю перевірку не проходить, тож фікс стає
/// no-op замість того, щоб різати `/** … */` посередині.
fn is_line_comment_block(block: &str, line_start_re: &regex::Regex) -> bool {
    block.split('\n').all(|line| line_start_re.is_match(line))
}

/// Точний порт `promoteLineBlock` (`fix-doc_comments.mjs:19-32`) — текст
/// автора зберігається дослівно, `*/` усередині екранується.
fn promote_line_block(block: &str, indent: &str, prefix_re: &regex::Regex) -> String {
    let texts: Vec<String> = block
        .split('\n')
        .map(|line| js_trim_end(&prefix_re.replace(line, "")).replace("*/", r"*\/"))
        .collect();
    if texts.len() == 1 {
        return format!("{indent}/** {} */", texts[0]);
    }
    let mut out = Vec::with_capacity(texts.len() + 2);
    out.push(format!("{indent}/**"));
    for text in &texts {
        out.push(js_trim_end(&format!("{indent} * {text}")).to_string());
    }
    out.push(format!("{indent} */"));
    out.join("\n")
}

/// Promotable-блоки з `data` однієї діагностики — `(start, end)` у **UTF-16**
/// (як їх поклав [`doc_comment_promotable_data`]).
fn promotable_block_from_data(diagnostic: &Diagnostic) -> Option<(usize, usize)> {
    let value: serde_json::Value = serde_json::from_str(diagnostic.data.as_deref()?).ok()?;
    if value.get("promotable").and_then(serde_json::Value::as_bool) != Some(true) {
        return None;
    }
    let start = value.get("start").and_then(serde_json::Value::as_u64)?;
    let end = value.get("end").and_then(serde_json::Value::as_u64)?;
    Some((start as usize, end as usize))
}

/// Fix-план `js/doc_comments` — семантичний порт T0-патерна
/// `promote-line-comments-to-jsdoc` (`fix-doc_comments.mjs:35-75`):
///
/// 1. групування promotable-порушень за файлом (порядок вставки — дзеркало
///    `Map`); вміст береться з `request.files`, не з диска (спека §3.2);
/// 2. дедуплікація за `start` (header і export можуть вказувати на ТОЙ САМИЙ
///    блок; при збігу перемагає останній запис — дзеркало
///    `new Map(blocks.map(b => [b.start, b]))`);
/// 3. заміна з кінця файлу до початку, щоб офсети попередніх блоків не
///    зсувались;
/// 4. блок не на початку рядка — не чіпаємо; блок, що вже не є `//`-блоком —
///    теж (guard [`is_line_comment_block`]);
/// 5. файл без реальних змін у план не потрапляє (`next === content`).
fn fix_doc_comments(request: &FixRequest) -> FixPlan {
    let prefix_re = regex::Regex::new(DOC_COMMENTS_LINE_PREFIX_PATTERN)
        .expect("DOC_COMMENTS_LINE_PREFIX_PATTERN валідний");
    let line_start_re = regex::Regex::new(DOC_COMMENTS_LINE_START_PATTERN)
        .expect("DOC_COMMENTS_LINE_START_PATTERN валідний");

    let mut by_file: Vec<(&str, Vec<(usize, usize)>)> = Vec::new();
    for diagnostic in &request.diagnostics {
        let Some(block) = promotable_block_from_data(diagnostic) else {
            continue;
        };
        // Розбіжність 1 доккомента секції: без `file` JS-фіксер впав би.
        let Some(file) = diagnostic.file.as_deref() else {
            continue;
        };
        match by_file.iter_mut().find(|(path, _)| *path == file) {
            Some((_, blocks)) => blocks.push(block),
            None => by_file.push((file, vec![block])),
        }
    }

    let mut edits = Vec::new();
    for (file, blocks) in &by_file {
        let Some(source) = request.files.iter().find(|f| f.path == *file) else {
            continue;
        };
        let mut unique: Vec<(usize, usize)> = Vec::new();
        for &(start, end) in blocks {
            match unique.iter_mut().find(|(known, _)| *known == start) {
                Some(slot) => slot.1 = end,
                None => unique.push((start, end)),
            }
        }
        // Спадання позиції — спільний інваріант усіх edit-планів гостя.
        unique.sort_by_key(|entry| std::cmp::Reverse(entry.0));

        let mut next = source.content.clone();
        for (start_utf16, end_utf16) in unique {
            // Точка конверсії 2 (доккомент секції): UTF-16 з `data` → байти
            // ОРИГІНАЛЬНОГО вмісту. Заміни йдуть від кінця, тож префікс до
            // `start` у `next` ще не змінений — байтові офсети лишаються
            // валідними й після попередніх ітерацій.
            let start = utf16_offset_to_byte(&source.content, start_utf16);
            let end = utf16_offset_to_byte(&source.content, end_utf16);
            if start >= end || end > next.len() {
                continue;
            }
            let line_start = next[..start].rfind('\n').map_or(0, |index| index + 1);
            let indent = next[line_start..start].to_string();
            if !js_trim(&indent).is_empty() {
                continue;
            }
            if !is_line_comment_block(&next[start..end], &line_start_re) {
                continue;
            }
            let promoted = promote_line_block(&next[start..end], &indent, &prefix_re);
            next.replace_range(line_start..end, &promoted);
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

// cspell:ignore npmcli
// =====================================================================
// Зріз 5 контракту v3.1 — ПІЛОТ поверхні `exec-tool`: `bun/licensee`
// (спека `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, §7)
//
// # Чому саме цей концерн пілотний
//
// `bun/licensee` — найпростіша з чотирьох обгорток зовнішніх процесів
// (264 рядки JS): один спавн, один розбір тексту, жодного scratch-обміну.
// Він доводить наскрізність поверхні (декларація тула → ensure-tool →
// `toolPaths` → `ToolResolver` → `exec-tool` → діагностика) на випадку, де
// нема чому ще зламатись. `style/lint`, `js/jscpd_duplicates` (перший
// реальний споживач `scratch-out`) і `js-run/runtime` (перший споживач
// `scratch-in`) — наступні зрізи, свідомо не тут.
//
// # Що саме дає `exec-tool`, чого не дав би `run-tool`
//
// JS-канон спавнить `bun x licensee` з `cwd: ctx.cwd` — коренем
// consumer-репо. `run-tool` не має поля `cwd` взагалі: процес успадкував би
// cwd ХОСТ-процесу, який для napi-виклику збігається з коренем репо
// ВИПАДКОВО (JS-оркестрація стартує там), а для `rules-cli` — ні. Для
// `licensee`, який читає `node_modules` і `package.json` відносно свого
// cwd, це різниця між «перевірив репо» і «перевірив казна-що». Тут гість
// передає `cwd: None` — тобто явно «корінь репо», який хост бере зі слоту
// `repo-root@1`, а не зі свого випадкового стану.
//
// # Розбіжності з JS-каноном (свідомі, не дрейф)
//
// 1. **`bun-missing` ширший за канон.** Канон розрізняє «`bun` немає в
//    PATH» (`resolveCmd` → null) і «процес не стартував/впав». Гість бачить
//    лише `status: none`, який покриває обидва випадки плюс таймаут. Усі
//    вони означають одне: тул не дав вердикту — тож гість репортує ту саму
//    канонічну діагностику `bun-missing`. Канон таймауту не має взагалі
//    (`spawnAsync` без ліміту), тож розходитись тут нема з чим.
// 2. **Warn-гілка — `Diagnostic` із `severity: warn`, а не `LintResult
//    .diagnostics`.** Канон на crash тула пише в ОКРЕМИЙ канал
//    (`result.diagnostics`, не `violations`) — у WIT такого каналу немає,
//    список один. Семантика зберігається (`warn` не блокує гейт), форма —
//    ні, тож у цієї гілки з'явився `reason`, якого в канону не було
//    ([`LICENSEE_TOOL_ERROR_REASON`]).
// 3. **T0-фікс лишається JS.** — БІЛЬШЕ НЕПРАВДА, і виправлено тут, а не
//    прибрано, щоб історія читалась. Зріз 5 справді не портував фікс
//    (`fix-licensee.mjs` спавнив `licensee --init`, зливав `.licensee.json`
//    і обходив workspace-и через `resolveAllJsRoots`). Пізніша хвиля
//    портувала ВСІ ТРИ патерни ([`fix_bun_licensee`]), а §2.93 зняла
//    JS-канон: цей крейт — ЄДИНИЙ виконавець фіксу `bun/licensee`.
//    Читання «порожній план → підхопить JS» відтоді неправдиве.
// =====================================================================

/// Ключ контрибуції `bun/licensee` (зріз 5 контракту v3.1 — пілот
/// `exec-tool`).
const CONCERN_BUN_LICENSEE: &str = "bun/licensee";

/// Декларація тула в `manifest.tools` — схема `path:` (рішення В спеки):
/// `bun` резолвиться по `PATH`, а не завантажується з GitHub-релізу, як
/// уміє дефолтна схема `pinned:`.
const LICENSEE_TOOL: &str = "path:bun";

/// Конфіг-файл, чию наявність перевіряє детектор — той самий
/// `join(cwd, '.licensee.json')`, що `existsSync` JS-канону; у гостя це
/// перевірка наявності шляху в батчі (глоб контрибуції звужений рівно до
/// нього).
const LICENSEE_CONFIG_PATH: &str = ".licensee.json";

/// `Terms:`-значення, яким `licensee` позначає ВЛАСНИЙ пакет без валідного
/// SPDX у `license` (не сторонню ліцензію) — дослівно з JS-канону.
const LICENSEE_INVALID_METADATA_TERMS: &str = "Invalid license metadata";

/// Роздільник блоків одного пакета у `--errors-only` stdout (порожній
/// рядок) — порт `BLOCK_SEPARATOR_RE` JS-канону 1:1.
const LICENSEE_BLOCK_SEPARATOR_PATTERN: &str = r"\n\s*\n";

/// `reason` warn-гілки «тул впав» — його в JS-канону НЕМАЄ (розбіжність 2
/// доккомента секції): канон пише crash в окремий `diagnostics`-канал
/// `LintResult`, у якого поля `reason` не існує.
const LICENSEE_TOOL_ERROR_REASON: &str = "licensee-tool-error";

/// Ліміт довжини вставки чужого виводу в повідомлення — порт
/// `.slice(0, 2000)` JS-канону.
const LICENSEE_DETAIL_LIMIT: usize = 2000;

/// Один розібраний блок `--errors-only` stdout — порт результату
/// `parseLicenseeBlocks`.
struct LicenseeBlock {
    name: String,
    terms: String,
    block: String,
}

/// Обрізає рядок до `limit` СИМВОЛІВ — наближення `String.prototype.slice`
/// JS-канону (той рахує UTF-16 code unit-и). Вивід `licensee` — імена
/// npm-пакетів і SPDX-ідентифікатори, тобто ASCII, де обидві міри
/// збігаються; різниця проявилась би лише на не-ASCII виводі, якого цей тул
/// не породжує. Байтового зрізу тут бути не може взагалі — він розрубав би
/// UTF-8 послідовність.
fn truncate_chars(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        Some((index, _)) => text[..index].to_string(),
        None => text.to_string(),
    }
}

/// Порт `parseLicenseeBlocks` (`main.mjs:25-40`) 1:1: розбиває stdout на
/// блоки одного пакета, з кожного дістає `name` (заголовок до ОСТАННЬОГО
/// `@` — scoped-імена `@scope/name@version` теж) і `Terms:`.
fn parse_licensee_blocks(stdout: &str) -> Vec<LicenseeBlock> {
    let separator = regex::Regex::new(LICENSEE_BLOCK_SEPARATOR_PATTERN)
        .expect("LICENSEE_BLOCK_SEPARATOR_PATTERN валідний");
    separator
        .split(stdout)
        .map(|block| block.trim())
        .filter(|block| !block.is_empty())
        .filter_map(|block| {
            let mut lines = block.lines();
            let header = lines.next().unwrap_or_default().trim();
            let terms = block
                .lines()
                .find(|line| line.trim().starts_with("Terms:"))
                .and_then(|line| line.split_once("Terms:").map(|(_, value)| value))
                .map(|value| value.trim().to_string())
                .unwrap_or_default();
            // `lastIndexOf('@') > 0` JS-канону: провідний `@` scoped-пакета
            // не рахується за роздільник версії.
            let name = match header.rfind('@') {
                Some(index) if index > 0 => &header[..index],
                _ => header,
            };
            if name.is_empty() {
                return None;
            }
            Some(LicenseeBlock {
                name: name.to_string(),
                terms,
                block: block.to_string(),
            })
        })
        .collect()
}

/// Порт `lint()` `bun/licensee` (`main.mjs:47-123`) — ПІЛОТ `exec-tool`.
///
/// `files` несе рівно те, що канон читає з диска перед спавном: наявність
/// `.licensee.json` (глоб контрибуції звужений до нього). Решта роботи —
/// спавн тула через host-медіацію й розбір його stdout; сам гість жодного
/// IO не робить.
fn detect_bun_licensee(files: &[SourceFile]) -> Vec<Diagnostic> {
    if !files.iter().any(|file| file.path == LICENSEE_CONFIG_PATH) {
        return vec![Diagnostic {
            reason: "licensee-config-missing".to_string(),
            message: "lint-bun: licensee — немає .licensee.json; запустіть \
                      `npx @7n/rules lint bun` локально для генерації (bun.mdc)"
                .to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        }];
    }

    let result = exec_tool(&ToolRequest {
        tool: LICENSEE_TOOL.to_string(),
        args: vec![
            "x".to_string(),
            "licensee".to_string(),
            "--production".to_string(),
            "--errors-only".to_string(),
        ],
        stdin: None,
        // `None` — корінь репо (слот `repo-root@1` на боці хоста), рівно
        // `cwd: ctx.cwd` JS-канону. Саме заради цього поля концерн і чекав
        // `exec-tool` (доккомент секції).
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });

    let Some(exit_code) = result.status else {
        // Розбіжність 1 доккомента секції: `status: none` покриває і
        // «тула немає», і «процес не стартував», і таймаут.
        return vec![Diagnostic {
            reason: "bun-missing".to_string(),
            message: "lint-bun: `bun` не знайдено в PATH (bun.mdc)".to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        }];
    };
    if exit_code == 0 {
        return vec![];
    }

    // Канал розрізняє crash тула від реального порушення: `licensee` пише
    // legitimate NOT APPROVED записи у stdout через print(), а власні
    // die()-помилки (invalid config, виняток усередині @npmcli/arborist на
    // bun-дереві) — у stderr. Дослівно логіка JS-канону.
    let stderr = truncate_chars(result.stderr.trim(), LICENSEE_DETAIL_LIMIT);
    if !stderr.is_empty() {
        return vec![Diagnostic {
            reason: LICENSEE_TOOL_ERROR_REASON.to_string(),
            message: format!(
                "lint-bun: licensee — інструмент завершився з помилкою, це НЕ підтверджене \
                 ліцензійне порушення (код {exit_code}, bun.mdc). Ймовірна причина — \
                 несумісність @npmcli/arborist з деревом bun install. Перевір вручну: \
                 `bunx licensee --production`.\n{stderr}"
            ),
            file: None,
            // Fail-open (не блокує CI-гейт): fail-closed тут перманентно
            // червонив би bun-монорепо — доккомент JS-канону.
            severity: Severity::Warn,
            data: None,
        }];
    }

    let stdout = result.stdout.trim();
    let blocks = parse_licensee_blocks(stdout);
    if blocks.is_empty() {
        // Формат `licensee` змінився — fallback на агрегований
        // `license-violation` із повним stdout, щоб не втратити сигнал.
        let detail = if stdout.is_empty() {
            String::new()
        } else {
            format!("\n{}", truncate_chars(stdout, LICENSEE_DETAIL_LIMIT))
        };
        return vec![Diagnostic {
            reason: "license-violation".to_string(),
            message: format!(
                "lint-bun: licensee — порушення ліцензій (код {exit_code}, bun.mdc){detail}"
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        }];
    }

    let mut diagnostics: Vec<Diagnostic> = blocks
        .iter()
        .filter(|block| block.terms == LICENSEE_INVALID_METADATA_TERMS)
        .map(|block| Diagnostic {
            reason: "license-metadata-invalid".to_string(),
            message: format!(
                "lint-bun: licensee — {}: Invalid license metadata (bun.mdc)",
                block.name
            ),
            file: None,
            severity: Severity::Error,
            // `data.package` споживає T0-фікс `fix-licensee.mjs` (патерн
            // `bun-licensee-workspace-license-metadata`) — контракт між
            // детектором і фіксером, який порт зобов'язаний зберегти.
            data: Some(format!(
                "{{\"package\":{}}}",
                json_escape_string(&block.name)
            )),
        })
        .collect();

    let third_party: Vec<&LicenseeBlock> = blocks
        .iter()
        .filter(|block| block.terms != LICENSEE_INVALID_METADATA_TERMS)
        .collect();
    if !third_party.is_empty() {
        let joined = third_party
            .iter()
            .map(|block| block.block.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        diagnostics.push(Diagnostic {
            reason: "license-violation".to_string(),
            message: format!(
                "lint-bun: licensee — порушення ліцензій (код {exit_code}, bun.mdc)\n{}",
                truncate_chars(&joined, LICENSEE_DETAIL_LIMIT)
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
    diagnostics
}

/// Канонічний SPDX-allowlist policy — дослівно `CANONICAL_SPDX`
/// `fix-licensee.mjs`. Перші чотири — дефолт самого `licensee --init`,
/// решта три (`ISC`, `BlueOak-1.0.0`, `0BSD`) — узгоджене розширення під
/// реальні транзитивні ліцензії consumer-репо (bun.mdc).
const LICENSEE_CANONICAL_SPDX: [&str; 7] = [
    "MIT",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "Apache-2.0",
    "ISC",
    "BlueOak-1.0.0",
    "0BSD",
];

/// Ліцензія, яку T0-фікс проставляє власним workspace-пакетам без поля
/// `license` — дослівно `DEFAULT_OWN_LICENSE` JS-канону (bun.mdc).
const LICENSEE_DEFAULT_OWN_LICENSE: &str = "ISC";

/// Канонічний початковий `.licensee.json` — рівно те, що дає ланцюжок
/// JS-канону «`bun x licensee --init --production --quiet`, далі
/// `normalizeCanonicalSpdx`»: дефолтна policy тула плюс три канонічні
/// SPDX. Вміст `--init` СТАТИЧНИЙ (перевірено емпірично: той самий файл у
/// порожньому каталозі й у справжньому репо — тул не консультується ні з
/// деревом залежностей, ні з lock-файлом), тому гість пише його
/// декларативно, БЕЗ спавна.
///
/// Чому не `exec_tool` + host-diff, як `style/lint`: після `--init` канон
/// ЧИТАЄ щойно створений файл і доливає в нього три SPDX — а гість читати
/// диск не може (`capabilities.fs_read` порожній) і `cwd` поза коренем
/// репо теж не дістане (host відхиляє escape-шлях). Спавн через host-diff
/// дав би на диску сирий `--init`-файл БЕЗ канонічного розширення, тобто
/// реальну втрату поведінки: ISC-залежності лишились би порушенням і
/// поїхали б у LLM-ladder замість тихого T0. Декларативний запис знімає
/// заразом мережевий `bunx`-крок із fix-контуру.
const LICENSEE_CANONICAL_CONFIG: &str = r#"{
  "licenses": {
    "spdx": [
      "MIT",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "Apache-2.0",
      "ISC",
      "BlueOak-1.0.0",
      "0BSD"
    ]
  },
  "packages": {
    "optimist": "<=0.6.1"
  },
  "corrections": false
}
"#;

/// Результат [`normalize_canonical_spdx`]. Окремий тип, а не
/// `Option<String>`, рівно заради того, щоб сам розбір лишався ЧИСТОЮ
/// функцією (без host-імпортів — вони абортують поза реальним хостом, тож
/// інакше гілку `NotAnObject` не можна було б юніт-тестувати): гучний лог
/// на невалідній формі робить [`fix_bun_licensee`], а не розбір. Той самий
/// прийом, що `run_ruff_step` у `crates/plugin-lang-python`.
enum SpdxNormalization {
    /// Файл уже канонічний (нічого не бракує) або нечитаний — у канону
    /// обидва випадки дають `false` (ідемпотентність).
    Unchanged,
    /// Корінь `.licensee.json` — не JSON-обʼєкт (канон тут вибухає
    /// TypeError-ом, доккомент [`normalize_canonical_spdx`]).
    NotAnObject,
    /// Нормалізований вміст файлу.
    Changed(String),
}

/// Порт `normalizeCanonicalSpdx` (`fix-licensee.mjs`): union наявного
/// `licenses.spdx` із [`LICENSEE_CANONICAL_SPDX`] зі збереженням порядку й
/// усіх користувацьких полів (`packages`, `corrections`, власні SPDX).
/// `None` — файл уже канонічний (нічого не бракує) або нечитаний: у
/// канону обидва випадки теж дають `false` (ідемпотентність).
fn normalize_canonical_spdx(content: &str) -> SpdxNormalization {
    let Some(config) = parse_json_ordered(content) else {
        return SpdxNormalization::Unchanged;
    };
    let JsonOrdered::Object(entries) = &config else {
        // Дефект канону, ПОЛАГОДЖЕНО: `config.licenses = …` на не-обʼєкті
        // (число, масив, рядок у `.licensee.json`) — TypeError у strict
        // ESM, тобто вибух усього fix-прогону концерну. Тут — окремий
        // варіант, який [`fix_bun_licensee`] переводить у гучний лог.
        return SpdxNormalization::NotAnObject;
    };

    let existing: Vec<String> = config
        .get("licenses")
        .and_then(|licenses| licenses.get("spdx"))
        .map(|spdx| match spdx {
            JsonOrdered::Array(items) => items
                .iter()
                .filter_map(|item| match item {
                    JsonOrdered::Str(s) => Some(s.clone()),
                    _ => None,
                })
                .collect(),
            _ => Vec::new(),
        })
        .unwrap_or_default();
    let missing: Vec<&str> = LICENSEE_CANONICAL_SPDX
        .iter()
        .copied()
        .filter(|spdx| !existing.iter().any(|have| have == spdx))
        .collect();
    if missing.is_empty() {
        return SpdxNormalization::Unchanged;
    }

    let mut spdx: Vec<JsonOrdered> = existing.into_iter().map(JsonOrdered::Str).collect();
    spdx.extend(missing.iter().map(|s| JsonOrdered::Str((*s).to_string())));
    // `{ ...config.licenses, spdx: [...] }` JS: наявний ключ ЛИШАЄТЬСЯ на
    // своєму місці, відсутній — дописується в кінець.
    let licenses = match config.get("licenses") {
        Some(JsonOrdered::Object(fields)) => {
            let mut next: Vec<(String, JsonOrdered)> = fields.clone();
            match next.iter_mut().find(|(key, _)| key == "spdx") {
                Some((_, value)) => *value = JsonOrdered::Array(spdx),
                None => next.push(("spdx".to_string(), JsonOrdered::Array(spdx))),
            }
            JsonOrdered::Object(next)
        }
        _ => JsonOrdered::Object(vec![("spdx".to_string(), JsonOrdered::Array(spdx))]),
    };

    let mut next: Vec<(String, JsonOrdered)> = entries.clone();
    match next.iter_mut().find(|(key, _)| key == "licenses") {
        Some((_, value)) => *value = licenses,
        None => next.push(("licenses".to_string(), licenses)),
    }
    SpdxNormalization::Changed(format!(
        "{}\n",
        js_json_stringify_pretty(&JsonOrdered::Object(next), 0)
    ))
}

/// Порт патерна `bun-licensee-workspace-license-metadata`: додає
/// `"license": "ISC"` власному пакету, який `licensee` підтвердив як
/// `Invalid license metadata` і в якого поля `license` ще немає.
/// `None` — не той пакет, поле вже є, або `package.json` нечитаний
/// (канон: `continue` у трьох тих самих випадках).
fn plan_own_package_license(content: &str, reported: &[String]) -> Option<String> {
    let package = parse_json_ordered(content)?;
    let JsonOrdered::Object(entries) = &package else {
        return None;
    };
    let name = match package.get("name") {
        Some(JsonOrdered::Str(name)) => name.clone(),
        _ => return None,
    };
    if !reported.iter().any(|reported| *reported == name) {
        return None;
    }
    // `Object.hasOwn(pkg, 'license')` канону — саме НАЯВНІСТЬ ключа, а не
    // «значення істинне»: `"license": null` теж лишається недоторканим.
    if entries.iter().any(|(key, _)| key == "license") {
        return None;
    }

    let mut next = entries.clone();
    next.push((
        "license".to_string(),
        JsonOrdered::Str(LICENSEE_DEFAULT_OWN_LICENSE.to_string()),
    ));
    Some(format!(
        "{}\n",
        js_json_stringify_pretty(&JsonOrdered::Object(next), 0)
    ))
}

/// T0-фіксер `bun/licensee` — ПОРТОВАНО: усі три патерни `fix-licensee.mjs`
/// у тому самому порядку.
///
/// 1. `bun-licensee-config-init` (`licensee-config-missing`) — запис
///    [`LICENSEE_CANONICAL_CONFIG`] (доккомент константи пояснює, чому
///    декларативно, а не спавном);
/// 2. `bun-licensee-canonical-policy` (`license-violation`) —
///    [`normalize_canonical_spdx`] над `.licensee.json` із батчу;
/// 3. `bun-licensee-workspace-license-metadata`
///    (`license-metadata-invalid` + `data.package`) —
///    [`plan_own_package_license`] над кожним `package.json` батчу.
///
/// План ПОВНІСТЮ декларативний (жодного `exec_tool`), тож host-diff
/// (§2.64) тут не задіяний — усі три патерни працюють із вмістом, який
/// хост уже приніс у `FixRequest::files` (глоб контрибуції розширено
/// `**/package.json` рівно заради патерна 3).
///
/// Обхід власних пакетів — корінь плюс [`resolve_all_js_roots`] (порт
/// `resolveAllJsRoots`, зріз 1), тобто рівно `ownPackageDirs` канону:
/// корінь плюс розкриті `workspaces`-глоби. Другий, вужчий гейт — той
/// самий, що в канону: збіг `pkg.name` з іменем, яке `licensee` повідомив
/// у `data.package` (сторонні пакети сюди не долітають — їхні блоки мають
/// інший `Terms:` і дають `license-violation`, не
/// `license-metadata-invalid`).
fn fix_bun_licensee(request: &FixRequest) -> FixPlan {
    let mut edits = Vec::new();

    let config_missing = request
        .diagnostics
        .iter()
        .any(|d| d.reason == "licensee-config-missing");
    if config_missing {
        edits.push(FileEdit::Write(WriteFile {
            path: LICENSEE_CONFIG_PATH.to_string(),
            content: LICENSEE_CANONICAL_CONFIG.to_string(),
        }));
    }

    // Патерни 1 і 2 пишуть ОДИН файл. Детектор їх не змішує (нема
    // `.licensee.json` → рання гілка `licensee-config-missing`, далі
    // жодного `license-violation`), але покладатись на це в плані не
    // можна: два `Write` на той самий шлях — не той контракт, який хост
    // зобовʼязаний розводити.
    let policy_violation = !config_missing
        && request
            .diagnostics
            .iter()
            .any(|d| d.reason == "license-violation");
    if policy_violation {
        if let Some(config) = batch_file(&request.files, LICENSEE_CONFIG_PATH) {
            match normalize_canonical_spdx(&config.content) {
                SpdxNormalization::Changed(content) => edits.push(FileEdit::Write(WriteFile {
                    path: LICENSEE_CONFIG_PATH.to_string(),
                    content,
                })),
                SpdxNormalization::NotAnObject => log(
                    LogLevel::Error,
                    "plugin-lang-js: fix(bun/licensee) — корінь `.licensee.json` не є \
                     JSON-обʼєктом, канонічний SPDX-allowlist НЕ нормалізовано.",
                ),
                SpdxNormalization::Unchanged => {}
            }
        }
    }

    let reported: Vec<String> = request
        .diagnostics
        .iter()
        .filter(|d| d.reason == "license-metadata-invalid")
        .filter_map(|d| {
            let data: serde_json::Value = serde_json::from_str(d.data.as_deref()?).ok()?;
            data.get("package")?.as_str().map(str::to_string)
        })
        .collect();
    if !reported.is_empty() {
        // `ownPackageDirs` канону — `[...new Set([cwd, ...resolveAllJsRoots(cwd)])]`:
        // САМ корінь плюс члени воркспейсу. Порожній рядок попереду —
        // це той `cwd` (при непорожніх `workspaces` [`resolve_all_js_roots`]
        // віддає ЛИШЕ членів), `dedup` — той самий `Set`.
        let mut dirs = vec![String::new()];
        dirs.extend(resolve_all_js_roots(&request.files));
        dirs.dedup();
        for dir in dirs {
            let path = if dir.is_empty() {
                "package.json".to_string()
            } else {
                format!("{dir}/package.json")
            };
            let Some(file) = batch_file(&request.files, &path) else {
                continue;
            };
            if let Some(content) = plan_own_package_license(&file.content, &reported) {
                edits.push(FileEdit::Write(WriteFile { path, content }));
            }
        }
    }

    FixPlan { edits }
}

// cspell:ignore jscpd stylelint
// =====================================================================
// Зріз 6 контракту v3.1 — решта дрібних обгорток на `exec-tool`:
// `style/lint` і `js/jscpd_duplicates`
// (спека `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, §7)
//
// # Що цей зріз доводить понад пілот
//
// Пілот (`bun/licensee`, секція «Зріз 5») перевірив мінімум: один спавн,
// один розбір тексту. Тут перевіряються дві поверхні, яких він не торкав:
//
// 1. **Схема `npm:`** (рішення В спеки, третя й остання) — `style/lint`
//    резолвить `stylelint` із `node_modules/.bin` консюмера, а не з
//    github-релізу (`pinned:`) і не з PATH (`path:`). Порядок «локальний
//    `.bin` → PATH» — дослівно `resolveStylelint` JS-канону; саме тому це
//    окрема схема, а не `path:` із фолбеком.
// 2. **`scratch-out`** — `js/jscpd_duplicates` перший реальний споживач:
//    `jscpd` не пише вердикт у stdout, він пише JSON-звіт НА ДИСК. Канон
//    віддавав йому `mkdtempSync(tmpdir())` і читав файл сам; тут каталог дає
//    хост (слот `scratch-dir@1`), а забирає звіт — теж хост, за глобом
//    `scratch-out`. Гість не має ні `fs_read`, ні шляху поза scratch — і не
//    потребує їх.
//
// # `scope` контрибуцій — розбіжність з `concern.json`, свідома
//
// `concern.json` `style/lint` каже `per-file`, а контрибуція нижче —
// `Full`. Це не дрейф: `scope` у `concern.json` читає ПЛАНУВАЛЬНИК
// (`buildLintPlan` — що вважати дельтою, що ганяти в `--repo-wide`), а
// `scope` контрибуції читає ХОСТ (`run_wasm_concern`) і рівно для одного
// рішення — «чи будувати batch самому, коли JS не передав `files`».
// У повному режимі (`lint --full`) планувальник лишає `files: undefined`
// і для per-file концернів (`buildPlan`, гілка `full`) — а хост будує
// full-scope batch ЛИШЕ для контрибуції зі `scope: Full`. Тобто
// контрибуція `PerFile` тут означала б: у `lint --full` стилі не
// перевіряються взагалі, мовчки. Дельта-режим від цього не змінюється —
// там `files` приходить явним списком у будь-якому разі.
//
// # Розбіжності з JS-каноном (свідомі, не дрейф)
//
// 1. **`status: none` ширший за канон** — той самий пункт, що в пілоті:
//    гість не розрізняє «тула немає», «процес не стартував» і таймаут.
//    Канон розрізняє перший випадок (`resolveStylelint` → `null`) і репортує
//    його окремим warn-каналом; порт віддає warn-`Diagnostic` із власним
//    `reason` ([`STYLELINT_UNRESOLVED_REASON`],
//    [`JSCPD_REPORT_UNREADABLE_REASON`]), бо каналу `LintResult.diagnostics`
//    у WIT немає — список один.
// 2. **`style/lint` у повному режимі передає тулу СПИСОК файлів, а не
//    глоб.** Канон при `ctx.files === undefined` віддає `stylelint`
//    аргумент `**/*.{css,scss,vue}` і дає тулу самому його розкрити; порт
//    отримує вже розкритий список від хоста (той самий глоб контрибуції).
//    Наслідок помітний рівно в одному місці: у репо БЕЗ жодного
//    css/scss/vue канон однаково спавнить тул, а `stylelint` на глобі, що
//    ні з чим не збігся, виходить ненульовим кодом — тобто канон репортує
//    порушення там, де порушення немає. Порт у цьому випадку не спавнить
//    нічого (порожній список цілей — ранній вихід, той самий, що канон уже
//    має для дельти). Це рішення Р11 спеки міграції: дефект канону
//    лагодиться, а не копіюється.
// 3. **`r.exitCode ?? 1` канону недосяжний у порті.** `null` exit code на
//    боці канону означає «вбито сигналом»; у гостя той самий випадок — це
//    `status: none`, який перехоплює гілка розбіжності 1 вище.
// 4. **T0-фікси обох концернів лишаються JS.** — для `style/lint` БІЛЬШЕ
//    НЕПРАВДА: пізніша хвиля портувала фікс класом exec-tool + host-diff
//    ([`fix_style_lint`]), а §2.93 зняла JS-канон `fix-lint.mjs`, тож цей
//    крейт — ЄДИНИЙ виконавець фіксу `style/lint`, і порожній план тут
//    означає СВІДОМИЙ no-op, а не «підхопить JS». Твердження зрізу
//    лишилось чинним рівно для `js/jscpd_duplicates` — той фіксера не має
//    взагалі, ні в JS, ні в гості.
// 5. **Запис `duplicates` не за схемою `jscpd` порт ПРОПУСКАЄ.** Канон
//    читає поля без перевірки, тож клон без `firstFile.name` дав би
//    повідомлення з рядком `undefined` і `data.line: undefined` — знову
//    Р11: дефект канону не копіюється. Реальний звіт `jscpd` цієї гілки не
//    досягає взагалі ([`parse_jscpd_file_ref`]).
//
// # Що лишається після цього зрізу
//
// З чотирьох обгорток зовнішніх процесів (§6 спеки v3.1) портовані три:
// `bun/licensee` (зріз 5) і ці дві. Четверта — `js-run/runtime` — окремий
// зріз 7 і найбільший поодинокий зріз усієї §3.5.5: 496 рядків
// `runtime/main.mjs` плюс 983 рядки шести lib-сканерів (`js-run/lib/*.mjs`),
// вісім під-перевірок, перший споживач `scratch-in` (rego-політики
// `js-run/jsconfig/*.rego` для `pinned:conftest`) і перший споживач схеми
// `pinned:` у цьому компоненті. `js/eslint` і `js/knip` — вічний JS
// (рішення Є спеки), жодна поверхня цього не змінює.
//
// Уточнення §2.86: «вічний JS» стосується ДЕТЕКТУ. T0-ФІКС `js/eslint`
// портовано — через `fix_only_concerns` мажора `4.0.0` (секція «§2.86»
// нижче), яка й існує рівно для того, щоб віддати fix, не чіпаючи детект.
// `js/knip` лишається вічним JS цілком: його канон — programmatic API
// пакета, а не CLI.
// =====================================================================

/// Ключ контрибуції `style/lint` (зріз 6 контракту v3.1).
const CONCERN_STYLE_LINT: &str = "style/lint";

/// Декларація тула `style/lint` — схема `npm:` (рішення В спеки):
/// `<cwd>/node_modules/.bin/stylelint`, фолбек `PATH`. Це дослівний порядок
/// `resolveStylelint` JS-канону.
const STYLELINT_TOOL: &str = "npm:stylelint";

/// Розширення, які канон віддає `stylelint` (`STYLE_EXT_RE`
/// `/\.(?:css|scss|vue)$/u` — прив'язаний до кінця рядка, тож `ends_with`
/// точний, а не наближення).
const STYLE_EXTENSIONS: [&str; 3] = [".css", ".scss", ".vue"];

/// Предикат «шлях віддаємо `stylelint`» — порт `filterStyleFiles`
/// (`style/lint/fix-lint.mjs`, JS-канон знято §2.93). Винесений з тіла
/// [`fix_style_lint`] в іменовану функцію рівно заради того, щоб перевірка
/// набору розширень лишалась ОКРЕМИМ твердженням тесту, а не побічним
/// ефектом exec-tool-сценарію: єдиний JS-тест, що це доводив
/// (`style/tests/main.test.mjs`), помер разом із каноном.
fn is_style_path(path: &str) -> bool {
    STYLE_EXTENSIONS
        .iter()
        .any(|extension| path.ends_with(extension))
}

/// Глоб контрибуції `style/lint` — той самий набір розширень, що
/// [`STYLE_EXTENSIONS`], у формі, яку хост розкриває у full-scope batch.
const STYLE_LINT_GLOB: &str = "**/*.{css,scss,vue}";

/// `reason` warn-гілки «тул не дав вердикту» — у канону його немає
/// (розбіжність 1 доккомента секції): канон пише це в окремий
/// `LintResult.diagnostics`, у якого поля `reason` не існує.
const STYLELINT_UNRESOLVED_REASON: &str = "stylelint-unresolved";

/// Ліміт вставки чужого виводу в повідомлення — порт `.slice(0, 2000)`
/// JS-канону `style/lint`.
const STYLELINT_DETAIL_LIMIT: usize = 2000;

/// Порт `lint()` `style/lint` (`main.mjs:41-80`).
///
/// `files` — або дельта від JS-оркестрації, або full-scope batch, який хост
/// побудував за [`STYLE_LINT_GLOB`] (доккомент секції, «`scope` контрибуцій»).
/// В обох випадках гість фільтрує його тим самим предикатом, що
/// `filterStyleFiles` канону, і віддає результат тулу як аргументи.
fn detect_style_lint(files: &[SourceFile]) -> Vec<Diagnostic> {
    let targets: Vec<String> = files
        .iter()
        .filter(|file| {
            STYLE_EXTENSIONS
                .iter()
                .any(|extension| file.path.ends_with(extension))
        })
        .map(|file| file.path.clone())
        .collect();
    // Порт `if (style.length === 0) return reporter.result()` канону — і,
    // на додачу, гілка, що знімає дефект канону в повному режимі
    // (розбіжність 2 доккомента секції).
    if targets.is_empty() {
        return vec![];
    }

    let result = exec_tool(&ToolRequest {
        tool: STYLELINT_TOOL.to_string(),
        args: targets,
        stdin: None,
        // `None` — корінь репо, рівно `cwd: ctx.cwd` канону: `stylelint`
        // резолвить свій конфіг і `.stylelintignore` відносно cwd.
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });

    let Some(exit_code) = result.status else {
        return vec![Diagnostic {
            reason: STYLELINT_UNRESOLVED_REASON.to_string(),
            message: "lint-style: `stylelint` не резолвиться (ні node_modules/.bin, ні PATH) — \
                      CSS/SCSS/Vue-стилі НЕ перевірені цим прогоном (style.mdc). `stylelint` — \
                      залежність @7n/rules-lang-js; переустанови плагін, якщо бачиш це."
                .to_string(),
            file: None,
            // Fail-open, як і в канону: відсутність тула не блокує гейт.
            severity: Severity::Warn,
            data: None,
        }];
    };
    if exit_code == 0 {
        return vec![];
    }

    // Канон склеює stdout і stderr БЕЗ роздільника (`${stdout}${stderr}`),
    // тримає trim і зріз до 2000 — порт 1:1.
    let joined = format!("{}{}", result.stdout, result.stderr);
    let out = truncate_chars(joined.trim(), STYLELINT_DETAIL_LIMIT);
    let suffix = if out.is_empty() {
        String::new()
    } else {
        format!("\n{out}")
    };
    vec![Diagnostic {
        reason: "stylelint-violation".to_string(),
        message: format!("lint-style: stylelint — порушення (код {exit_code}, style.mdc){suffix}"),
        file: None,
        severity: Severity::Error,
        data: None,
    }]
}

/// T0-фіксер `style/lint` — ПОРТОВАНО (клас exec-tool, host-diff §2.64;
/// прецедент — `fix_ruff`, `crates/plugin-lang-python`). Точний порт
/// патерна `style-stylelint-fix` (`fix-lint.mjs`): зовнішній процес
/// (`stylelint --fix <цілі>`) сам мутує файли НА ДИСКУ, синхронно,
/// всередині [`exec_tool`]. Гість повертає ПОРОЖНІЙ план — edits синтезує
/// хост (`run_wasm_concern_fix` → `diff_snapshot_edits`,
/// `crates/rules-napi/src/lib.rs`), діфаючи знімок [`STYLE_LINT_GLOB`] до
/// і після цього виклику.
///
/// # Звідки беруться цілі
///
/// `request.files` — рівно те, що `listStyleFiles` канону збирає двома
/// різними шляхами: у дельта-прогоні це `ctx.files` (хост проводить її
/// через `delta_files`), у `lint --full` — glob-обхід
/// [`STYLE_LINT_GLOB`], який хост робить сам. Тобто окремої гілки «дельта
/// чи повний режим» тут немає взагалі, і `git ls-files` канону
/// (`spawnAsync('git', ['ls-files', …])`) не потрібен: обхід хоста вже
/// поважає `.n-rules.json`-ignore і `cursor_ignore`, тоді як `git
/// ls-files` бачив рівно tracked-підмножину. Розбіжність задокументована,
/// не випадкова: untracked, але не зігнорований `.scss` канон у
/// `--full` мовчки НЕ форматував.
///
/// # Дефект канону, який ПОЛАГОДЖЕНО, а не скопійовано
///
/// `fix-lint.mjs` на відсутній `stylelint` (`resolveStylelint` → `null`)
/// повертає `{ touchedFiles: [] }` — тобто `--fix` тихо не робить нічого,
/// і користувач бачить рівно те саме, що й при «нічого не треба
/// виправляти». Тут це [`LogLevel::Error`] із явною причиною: тула немає —
/// значить стилі НЕ виправлені, і про це треба сказати. Детектор того
/// самого концерну вже сигналить цей стан окремою warn-діагностикою
/// ([`STYLELINT_UNRESOLVED_REASON`]), тож fix-бік лишався єдиним тихим
/// місцем.
fn fix_style_lint(request: &FixRequest) -> FixPlan {
    let targets: Vec<String> = request
        .files
        .iter()
        .filter(|file| is_style_path(&file.path))
        .map(|file| file.path.clone())
        .collect();
    // Порт `if (files.length === 0) return { touchedFiles: [] }` канону.
    if targets.is_empty() {
        return FixPlan { edits: vec![] };
    }

    let mut args = vec!["--fix".to_string()];
    args.extend(targets);
    let result = exec_tool(&ToolRequest {
        tool: STYLELINT_TOOL.to_string(),
        args,
        stdin: None,
        // `None` — корінь репо, рівно `cwd: ctx.cwd` канону.
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    if result.status.is_none() {
        log(
            LogLevel::Error,
            "plugin-lang-js: fix(style/lint) — `stylelint` не резолвиться \
             (ні node_modules/.bin, ні PATH), жоден CSS/SCSS/Vue-файл НЕ виправлено. \
             `stylelint` — залежність @7n/rules-lang-js; переустанови плагін.",
        );
    }
    // Код виходу ІГНОРУЄТЬСЯ, як і в канону (`await spawnAsync(...)` без
    // перевірки `exitCode`): `stylelint --fix` виходить ненульовим і тоді,
    // коли частину порушень виправив, а частину лишив невиправною.
    FixPlan { edits: vec![] }
}

// =====================================================================
// §2.86 — `js/eslint`: ПЕРШИЙ споживач `fix-only-concerns` (мажор `4.0.0`,
// §2.84). Портовано РІВНО fix; detect лишається «вічним JS».
//
// # Чому fix-only, а не звичайна контрибуція
//
// Detect цього концерну стоїть на programmatic API `eslint` (JS-модуль
// у процесі, не CLI) і на LLM-контурі `agent-fix` — рішення Є спеки
// `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md` називає його
// «вічним JS», і жодна поверхня цього не змінює. До мажора `4.0.0`
// оголосити ключ у `describe().concerns` заради самого лише фіксу було
// НЕМОЖЛИВО без тихої шкоди: `detect.mjs` (гілка `wasmEntry !== undefined`)
// ПОВНІСТЮ заміняє `main.mjs` гостем, тобто порт заради фіксу мовчки
// вимкнув би детект — рівно той тихий зелений, який закрила §2.65. Тому
// ключ живе у ДРУГОМУ списку маніфеста (`fix_only_concerns`): fix-контур
// (`loadT0Patterns` → `wasmFixPattern`) читає обидві мапи, `detect.mjs` —
// лише першу.
//
// # Клас фіксера — exec-tool + host-diff (§2.64), як `style/lint`
//
// Обидва T0-патерни канону (`fix-eslint.mjs`) портовані ОБИДВА, і це не
// педантизм: `T0Pattern.guestFix` зупиняє `applyT0` на першому
// непорожньому плані гостя, тож частковий порт МОВЧКИ вимкнув би
// невіддану половину JS-канону (пастка, через яку §2.81 свідомо НЕ
// портувала два CI-концерни). Гість не будує `FixPlan` узагалі — усі три
// його кроки мутують диск через `exec-tool`, а edits синтезує хост,
// діфаючи знімок глоба контрибуції до і після `fix()`.
//
// # Порядок кроків ПЕРЕВЕРНУТО відносно канону — свідомо
//
// Канон: `oxlint --fix` → `eslint --fix` → механічні заміни, причому
// механічний патерн ЧИТАЄ файл із диска ВЖЕ ПІСЛЯ лінтерів
// (`readOrNull(abs)`), тобто рядки, пораховані детектором, можуть бути
// зсунуті — і канон тоді свою заміну мовчки пропускає («файл змінився з
// моменту detect-у — не гадаємо», його ж доккомент).
//
// Гість читати диск ПІСЛЯ `exec-tool` не може в принципі: контракт не має
// імпорту читання файлу, `scratch-out` збирає лише scratch-каталог, а
// `fix-request.files` — знімок, зроблений хостом ДО `fix()`. Тому порядок
// перевернуто: механічні заміни рахуються з `fix-request.files` (рівно той
// вміст, на якому детектор порахував `data.line` — зсув неможливий за
// побудовою), лягають на диск ПЕРШИМИ, і вже по них ідуть `oxlint --fix` і
// `eslint --fix`. Це СТРОГО точніше за канон: зникає його тихий пропуск, а
// лінтери бачать уже виправлений код.
//
// Ціна перевороту — запис механічної правки МУСИТЬ статись усередині
// `fix()`, до спавну лінтерів, тобто через `exec-tool`, а не через
// `FixPlan` (план хост застосовує вже ПІСЛЯ повернення з `fix()`). Звідси
// [`TEE_TOOL`]: `tee -- <file>` зі stdin — найпростіший спосіб покласти
// готовий вміст на диск у межах наявного контракту. Альтернатива —
// віддати механічну правку планом, а лінтери НЕ пускати на ці файли —
// відкинута: `diff_snapshot_edits` не дублює шляхи, які гість назвав сам
// (`already_covered`), тож план гостя переміг би диск і АНУЛЮВАВ би
// правки лінтерів на тому самому файлі; а виключення таких файлів зі
// спавну відклало б їхній autofix у (дорогий) LLM-ладдер. Обидва варіанти
// гірші за один задекларований `path:`-тул.
// =====================================================================

/// Ключ fix-only контрибуції `js/eslint` (§2.86) — ЄДИНИЙ запис
/// `manifest.fix_only_concerns` цього компонента.
const CONCERN_JS_ESLINT: &str = "js/eslint";

/// Глоб fix-only контрибуції — дослівно `lint.glob` із `concern.json`
/// концерну. Він же скоуп знімків host-diff
/// (`ConcernContribution::effective_fix_glob` → порожній `fix_glob` падає
/// назад на цей). Власного `fix-glob` тут НЕ треба: скоуп фіксу — дельта
/// ЗАПИТУ (файли, у яких детектор знайшов порушення), а не інший статичний
/// глоб, тож §2.72 («вузький detect-glob каструє fix») цього концерну не
/// стосується.
const JS_ESLINT_GLOB: &str = "**/*.{js,mjs,cjs,jsx,ts,tsx,vue}";

/// Розширення, які канон вважає JS-подібними — дослівний порт `JS_EXT_RE`
/// (`plugins/lang-js/rules/js/eslint/main.mjs`), що його `filterJsFiles`
/// застосовує і на detect-, і на fix-боці.
const JS_ESLINT_EXTENSIONS: [&str; 7] = [".mjs", ".cjs", ".js", ".jsx", ".ts", ".tsx", ".vue"];

/// Декларація тула лінтерів — та сама `path:bunx`, що вже несе
/// `js/jscpd_duplicates` ([`JSCPD_TOOL`]). Свідомо ТОЙ САМИЙ рядок, а не
/// другий запис у `manifest.tools`: список тулів — множина декларацій, не
/// мапа «концерн → тул».
///
/// # Розбіжність із каноном (§2.93) — ЄДИНА причина, чому `fix-eslint.mjs` живий
///
/// Попередня редакція цього доккомента стверджувала «канон теж кличе саме
/// `bunx oxlint` / `bunx eslint`». Для oxlint це правда; для eslint —
/// НІ: канон гейтить на `resolveCmd('bunx')` тільки oxlint, а
/// `eslint --fix` кличе programmatic API (`new ESLint({ cwd, fix: true })`
/// + `ESLint.outputFixes`) і тому працює й БЕЗ `bunx`. Гість такої гілки
/// не має — за нерезолвного `bunx` він голосно логує
/// ([`run_js_eslint_linter_fix`]) і НЕ фіксить нічого.
///
/// Тому §2.93, яка зняла девʼятнадцять JS-канонів фіксу цього плагіна,
/// СВІДОМО лишила `plugins/lang-js/rules/js/eslint/fix-eslint.mjs`: гість
/// віддає порожній `FixPlan` (клас host-diff), тож `guestFix`-брейк
/// `applyT0` канон не глушить, і драбина «спершу гість, а якщо він нічого
/// не зробив — канон» тут не залишок міграції, а робочий контур. Знімати
/// канон можна лише разом із портом eslint-половини так, щоб вона не
/// вимагала `bunx`.
const ESLINT_TOOL: &str = "path:bunx";

/// Декларація тула запису — `tee` з `PATH`. Потрібен рівно для одного:
/// покласти механічно виправлений вміст на диск ДО спавну лінтерів
/// (доккомент секції). Не резолвиться — механічні заміни не застосовані,
/// і про це треба сказати вголос, а не мовчки пропустити.
const TEE_TOOL: &str = "path:tee";

/// Одна «механічна» текстова заміна — порт запису `MECHANICAL_TEXT_FIXES`
/// (`fix-eslint.mjs`). `reasons` — обидва формати, якими те саме правило
/// приходить від двох тулів: eslint (`ruleId`, `plugin/rule`) і oxlint
/// (`d.code`, `plugin(rule)`).
struct MechanicalTextFix {
    reasons: [&'static str; 2],
    needle: &'static str,
    replacement: &'static str,
}

/// Реєстр механічних замін — сьогодні рівно один запис, як і в канону.
/// `Number.isInteger` не ловить значення поза `Number.MIN/MAX_SAFE_INTEGER`;
/// `oxlint --fix`/`eslint --fix` цього правила НЕ покривають (у самих тулах
/// воно suggestion-only), а заміна імені методу на позначеному рядку
/// однозначна без AST.
const MECHANICAL_TEXT_FIXES: [MechanicalTextFix; 1] = [MechanicalTextFix {
    reasons: [
        "unicorn/prefer-number-is-safe-integer",
        "unicorn(prefer-number-is-safe-integer)",
    ],
    needle: "Number.isInteger",
    replacement: "Number.isSafeInteger",
}];

/// Механічна заміна для `reason` діагностики — порт `mechanicalFixFor`.
fn mechanical_fix_for(reason: &str) -> Option<&'static MechanicalTextFix> {
    MECHANICAL_TEXT_FIXES
        .iter()
        .find(|fix| fix.reasons.contains(&reason))
}

/// `data.line` діагностики (1-indexed) — те, що `main.mjs` кладе у
/// `data: { line, tool }`. `None` — поля немає чи воно не число: канон у
/// такому разі теж нічого не робить (`v.data?.line` у `test`/`apply`).
fn js_eslint_diagnostic_line(diagnostic: &Diagnostic) -> Option<usize> {
    let value: serde_json::Value = serde_json::from_str(diagnostic.data.as_deref()?).ok()?;
    usize::try_from(value.get("line")?.as_u64()?).ok()
}

/// Чи шлях JS-подібний — порт `filterJsFiles`.
fn is_js_like_path(path: &str) -> bool {
    JS_ESLINT_EXTENSIONS
        .iter()
        .any(|extension| path.ends_with(extension))
}

/// Крок 1 фіксера: механічні текстові заміни по рядках, які назвав
/// детектор, з вмісту `fix-request.files` — і запис результату на диск
/// через [`TEE_TOOL`] (чому саме так — доккомент секції).
/// Повертає шляхи, які реально переписано.
fn apply_js_eslint_mechanical_fixes(request: &FixRequest, targets: &[String]) -> Vec<String> {
    let mut written = Vec::new();
    for path in targets {
        let Some(source) = request.files.iter().find(|file| &file.path == path) else {
            // Хост не приніс вміст цього файлу (видалений між detect і fix)
            // — канон тут теж мовчки пропускає (`readOrNull` → `null`).
            continue;
        };
        let mut lines: Vec<String> = source.content.split('\n').map(str::to_string).collect();
        let mut changed = false;
        for diagnostic in &request.diagnostics {
            if diagnostic.file.as_deref() != Some(path.as_str()) {
                continue;
            }
            let Some(fix) = mechanical_fix_for(&diagnostic.reason) else {
                continue;
            };
            let Some(line_no) = js_eslint_diagnostic_line(diagnostic) else {
                continue;
            };
            let Some(index) = line_no.checked_sub(1) else {
                continue;
            };
            let Some(line) = lines.get_mut(index) else {
                continue;
            };
            // Порт «рядок без збігу очікуваного шаблону — пропускаємо, не
            // гадаємо»: тут він лишається лише як strict-гвардія, бо вміст
            // — рівно той, на якому рахувався `data.line`.
            if !line.contains(fix.needle) {
                continue;
            }
            let next = line.replace(fix.needle, fix.replacement);
            if &next != line {
                *line = next;
                changed = true;
            }
        }
        if !changed {
            continue;
        }
        let result = exec_tool(&ToolRequest {
            tool: TEE_TOOL.to_string(),
            args: vec!["--".to_string(), path.clone()],
            stdin: Some(lines.join("\n")),
            // `None` — корінь репо: `path` posix-relative саме від нього.
            cwd: None,
            env: vec![],
            scratch_in: vec![],
            scratch_out: vec![],
        });
        if result.status == Some(0) {
            written.push(path.clone());
        } else {
            log(
                LogLevel::Error,
                &format!(
                    "plugin-lang-js: fix(js/eslint) — запис механічної заміни у `{path}` через \
                     `tee` НЕ вдався (status {:?}): {}. Файл лишився невиправленим.",
                    result.status,
                    result.stderr.trim()
                ),
            );
        }
    }
    written
}

/// Один спавн лінтера у fix-режимі через `bunx` — `oxlint --fix` /
/// `eslint --fix`. Код виходу ІГНОРУЄТЬСЯ (як і в канону: обидва лінтери
/// виходять ненульовим, коли лишились невиправні порушення), а от
/// «процес не стартував» — гучна помилка: канон тут best-effort мовчав.
fn run_js_eslint_linter_fix(linter: &str, targets: &[String]) {
    let mut args = vec![linter.to_string(), "--fix".to_string()];
    args.extend(targets.iter().cloned());
    let result = exec_tool(&ToolRequest {
        tool: ESLINT_TOOL.to_string(),
        args,
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    if result.status.is_none() {
        log(
            LogLevel::Error,
            &format!(
                "plugin-lang-js: fix(js/eslint) — `bunx` не резолвиться, `{linter} --fix` НЕ \
                 виконано, жоден файл цим лінтером не виправлено."
            ),
        );
    }
}

/// T0-фіксер `js/eslint` — порт ОБОХ патернів `fix-eslint.mjs`
/// (`js-eslint-autofix` разом із `js-eslint-mechanical-text-fix`), клас
/// exec-tool із host-diff. Гість повертає ПОРОЖНІЙ план: усі edits синтезує хост,
/// діфаючи знімок [`JS_ESLINT_GLOB`] до і після виклику.
///
/// Цілі беруться з `diagnostics[].file` (`[...new Set(violations.map(v =>
/// v.file))]` канону), а не з `request.files`: у `lint --full` хост
/// приносить у `files` ВЕСЬ глоб, і спавн лінтерів по ньому розійшовся б із
/// каноном, який навіть у повному прогоні фіксить рівно ті файли, де
/// детектор щось знайшов.
fn fix_js_eslint(request: &FixRequest) -> FixPlan {
    let mut targets: Vec<String> = Vec::new();
    for diagnostic in &request.diagnostics {
        let Some(path) = diagnostic.file.as_deref() else {
            continue;
        };
        if !is_js_like_path(path) || targets.iter().any(|t| t == path) {
            continue;
        }
        targets.push(path.to_string());
    }
    // Порт `if (jsFiles.length === 0) return { touchedFiles: [] }`.
    if targets.is_empty() {
        return FixPlan { edits: vec![] };
    }

    apply_js_eslint_mechanical_fixes(request, &targets);
    run_js_eslint_linter_fix("oxlint", &targets);
    run_js_eslint_linter_fix("eslint", &targets);

    FixPlan { edits: vec![] }
}

/// Ключ контрибуції `js/jscpd_duplicates` (зріз 6 контракту v3.1 — перший
/// реальний споживач `scratch-out`).
const CONCERN_JSCPD_DUPLICATES: &str = "js/jscpd_duplicates";

/// Декларація тула — схема `path:` (`bunx` резолвиться по PATH, як у
/// `bun/licensee`).
const JSCPD_TOOL: &str = "path:bunx";

/// Ім'я JSON-звіту, яке `jscpd` дає репортеру `json` — воно ж
/// `scratch-out`-глоб (без `**/`: звіт лежить рівно в каталозі `--output`).
const JSCPD_REPORT_NAME: &str = "jscpd-report.json";

/// Слот host-context з абсолютним шляхом scratch-каталогу виклику — те, що
/// канон робив сам через `mkdtempSync(join(tmpdir(), 'jscpd-'))`.
const SCRATCH_DIR_SLOT: &str = "scratch-dir@1";

/// `reason` warn-гілки «звіту немає» — у канону його немає (розбіжність 1
/// доккомента секції), там це `LintResult.diagnostics`.
const JSCPD_REPORT_UNREADABLE_REASON: &str = "jscpd-report-unreadable";

/// Ліміт вставки чужого виводу в warn-повідомлення — порт `.slice(0, 500)`
/// JS-канону `js/jscpd_duplicates` (інший, ніж у `style/lint`).
const JSCPD_DETAIL_LIMIT: usize = 500;

/// Один клон зі звіту `jscpd` — рівно ті поля, які читає
/// `cloneToViolation` JS-канону.
struct JscpdClone {
    first_name: String,
    first_start: i64,
    first_end: i64,
    second_name: String,
    second_start: i64,
    second_end: i64,
    lines: i64,
    format: String,
}

/// Дістає `{ name, start, end }` одного боку клону. `None` — запис не має
/// схеми звіту `jscpd` (розбіжність 5 доккомента секції: канон надрукував би
/// у повідомленні `undefined`, порт такий запис пропускає).
fn parse_jscpd_file_ref(value: Option<&serde_json::Value>) -> Option<(String, i64, i64)> {
    let value = value?;
    Some((
        value.get("name")?.as_str()?.to_string(),
        value.get("start")?.as_i64()?,
        value.get("end")?.as_i64()?,
    ))
}

/// Розбирає `report.duplicates` у клони. Не-масив (чи відсутнє поле) —
/// порожній результат: порт `Array.isArray(report.duplicates) ? … : []`.
fn parse_jscpd_report(report: &serde_json::Value) -> Vec<JscpdClone> {
    let Some(duplicates) = report.get("duplicates").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    duplicates
        .iter()
        .filter_map(|clone| {
            let (first_name, first_start, first_end) =
                parse_jscpd_file_ref(clone.get("firstFile"))?;
            let (second_name, second_start, second_end) =
                parse_jscpd_file_ref(clone.get("secondFile"))?;
            Some(JscpdClone {
                first_name,
                first_start,
                first_end,
                second_name,
                second_start,
                second_end,
                lines: clone.get("lines")?.as_i64()?,
                format: clone.get("format")?.as_str()?.to_string(),
            })
        })
        .collect()
}

/// Порт `cloneToViolation` (`main.mjs:22-39`) 1:1 — повідомлення, `file`
/// (anchored на `firstFile`) і `data`, на яку спирається рендер.
fn jscpd_clone_to_diagnostic(clone: &JscpdClone) -> Diagnostic {
    let first_location = format!(
        "{}:{}-{}",
        clone.first_name, clone.first_start, clone.first_end
    );
    let second_location = format!(
        "{}:{}-{}",
        clone.second_name, clone.second_start, clone.second_end
    );
    let data = serde_json::json!({
        "line": clone.first_start,
        "lines": clone.lines,
        "format": clone.format,
        "first": { "file": clone.first_name, "start": clone.first_start, "end": clone.first_end },
        "second": { "file": clone.second_name, "start": clone.second_start, "end": clone.second_end },
    });
    Diagnostic {
        reason: "duplicate-clone".to_string(),
        message: format!(
            "jscpd: дубльований фрагмент ({} рядків, {}) {first_location} ↔ {second_location}",
            clone.lines, clone.format
        ),
        file: Some(clone.first_name.clone()),
        severity: Severity::Error,
        data: Some(data.to_string()),
    }
}

/// Будує warn-діагностику «звіту немає» з тим самим суфіксом виводу тула,
/// що й канон (`${stdout}${stderr}`, trim, зріз до 500).
fn jscpd_report_unreadable(stdout: &str, stderr: &str) -> Vec<Diagnostic> {
    let joined = format!("{stdout}{stderr}");
    let detail = truncate_chars(joined.trim(), JSCPD_DETAIL_LIMIT);
    let suffix = if detail.is_empty() {
        String::new()
    } else {
        format!(": {detail}")
    };
    vec![Diagnostic {
        reason: JSCPD_REPORT_UNREADABLE_REASON.to_string(),
        message: format!("jscpd: не вдалося прочитати JSON-звіт{suffix}"),
        file: None,
        // Fail-open, як і в канону: краш тула не блокує гейт.
        severity: Severity::Warn,
        data: None,
    }]
}

/// Порт `lint()` `js/jscpd_duplicates` (`main.mjs:47-69`) — перший реальний
/// споживач `scratch-out`.
///
/// `files` ІГНОРУЄТЬСЯ повністю (глоб контрибуції порожній): канон теж не
/// читає з диска нічого перед спавном — репозиторій обходить сам `jscpd`.
fn detect_jscpd_duplicates() -> Vec<Diagnostic> {
    // Канон писав звіт у власний `mkdtemp` поза репо; тут той самий інваріант
    // «дерево не мутується» тримає хост. `none` (каталог не створився) —
    // деградуємо в ту саму warn-гілку, що й нечитаний звіт: без каталогу
    // `--output` передати нема чого.
    let Some(scratch_dir) = host_context(SCRATCH_DIR_SLOT) else {
        return jscpd_report_unreadable("", "хост не надав scratch-каталогу (слот scratch-dir@1)");
    };

    let result = exec_tool(&ToolRequest {
        tool: JSCPD_TOOL.to_string(),
        args: vec![
            "jscpd".to_string(),
            ".".to_string(),
            "--reporters".to_string(),
            "json".to_string(),
            "--output".to_string(),
            scratch_dir,
            "--silent".to_string(),
        ],
        stdin: None,
        // `None` — корінь репо, рівно `cwd: ctx.cwd` канону: `jscpd` читає
        // `.jscpd.json` і обходить дерево відносно cwd.
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![JSCPD_REPORT_NAME.to_string()],
    });

    let Some(report_file) = result
        .scratch_out
        .iter()
        .find(|file| file.path == JSCPD_REPORT_NAME)
    else {
        return jscpd_report_unreadable(&result.stdout, &result.stderr);
    };
    let Ok(report) = serde_json::from_str::<serde_json::Value>(&report_file.content) else {
        // Той самий `catch`, що в канону навколо `JSON.parse`.
        return jscpd_report_unreadable(&result.stdout, &result.stderr);
    };

    parse_jscpd_report(&report)
        .iter()
        .map(jscpd_clone_to_diagnostic)
        .collect()
}

// =====================================================================
// Зріз 7 контракту v3.1 — `js-run/runtime`: найбільший поодинокий зріз усієї
// §3.5.5 (спека `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`,
// рядок 7 таблиці; реєстр відкладених питань, п. 5.3)
//
// # Що це за концерн
//
// `plugins/lang-js/rules/js-run/runtime/main.mjs` (496 рядків) плюс шість
// lib-сканерів (`js-run/lib/*.mjs`, 983 рядки) — ОДИН ключ контрибуції з
// дев'ятьма НЕЗАЛЕЖНИМИ під-перевірками, які канон ганяє по кожному
// workspace-пакету (корінь `.` виключено):
//
// | # | під-перевірка | джерело | зовнішній тул |
// |---|---|---|---|
// | 1 | `jsconfig.json` існує, якщо є `src/` | `main.mjs` | — (див. нижче) |
// | 2 | немає імпортів `@nitra/bunyan`/`bunyan` | `lib/bunyan-imports.mjs` | — |
// | 3 | фабрики підключень лише в `connDir/` | `lib/conn-imports-scan.mjs` | — |
// | 4 | нейминг і експорти файлів `connDir/` | `lib/conn-file-rules.mjs` | — |
// | 5 | `process.env` / незакритий `checkEnv` | `lib/check-env-scan.mjs` | — |
// | 6 | `new Promise(r => setTimeout(r, ms))` | `lib/promise-settimeout-scan.mjs` | — |
// | 7 | `Temporal` у Bun-рантаймі | `lib/temporal-scan.mjs` | — |
// | 8 | `k8s/base/configmap.yaml` існує | `main.mjs` | — |
// | 9 | `package.json#imports["#conn/*"]` оголошений | `main.mjs` | — |
//
// Спека рахує їх за розділами `runtime.mdc` і каже «вісім»; у коді функцій
// дев'ять — під-перевірки 3 і 9 в `.mdc` живуть в одному розділі
// «Внутрішні аліаси», але це два незалежні предикати з різними
// повідомленнями, тож тут вони окремі рядки.
//
// # Головне відкриття зрізу: `scratch-in`-споживача тут НЕМАЄ
//
// І спека (рядок 7 таблиці §7), і реєстр (п. 5.3) називають цей зріз
// «першим споживачем `scratch-in`» — через `runConftestBatch` у
// під-перевірці 1, яка мала б валідувати СТРУКТУРУ `jsconfig.json`
// rego-пакетом `js_run.jsconfig`. Перевірка цієї передумови виміром показала,
// що виклик канону **вакуумний — він не може віддати жодного порушення**:
//
// * `jsconfig.rego` бере канон із `data.template.snippet` (`--data`);
// * `runtime/main.mjs` кличе `runConftestBatch` БЕЗ `templateData`, тобто
//   без `--data` взагалі;
// * conftest НЕ підвантажує JSON/YAML із каталогу `-p` у `data` — там
//   лишається лише rego. Отже `data.template` не існує, усі чотири `deny`
//   не мають по чому ітеруватись, і `conftest` віддає `successes: 4`,
//   `exit 0` навіть на свідомо неканонічному `jsconfig.json`
//   (`{"compilerOptions":{"module":"commonjs"},"include":["lib/**/*"]}`).
//
// Структурна валідація при цьому НЕ втрачена: її робить ОКРЕМИЙ
// policy-концерн `js-run/jsconfig` (`jsconfig/concern.json`,
// `engine: rego` через `policy-lint-adapter.mjs`), який `--data` формує
// правильно — `resolveConcernTemplateData` читає той самий
// `template/jsconfig.json.snippet.json`. Його `walkGlob: **/jsconfig.json`
// ще й ШИРШИЙ за гілку в `runtime` (усі `jsconfig.json` репо проти
// backend-пакетів із `src/`).
//
// Тобто виклик у `runtime/main.mjs` — не «перевірка, яку треба портувати»,
// а мертвий дублікат: спавн процесу на кожен workspace-пакет, який ніколи
// не дає вердикту, зате може завалити ВЕСЬ концерн винятком, якщо
// `conftest` не встановлено (`runConftestBatch` → `ensureToolAsync`
// hard-fail). Рішення Р11 спеки міграції («дефект канону лагодиться, а не
// копіюється») тут читається однозначно: порт лишає під-перевірці 1 рівно
// той предикат, який у канону справді працює — FS-гейт «є `src/`, немає
// `jsconfig.json`» — і не відтворює вакуумний спавн. Відтворити його
// «правильно» (передати вшитий сніпет у `--data`) було б гірше за обидва
// варіанти: це дало б ДРУГЕ повідомлення про ту саму розбіжність, яку вже
// репортує `js-run/jsconfig`.
//
// Наслідок для контракту: цей зріз НЕ додає ні `pinned:conftest` у
// `manifest.tools`, ні `scratch-in`-виклику. Обидві поверхні лишаються
// нереалізованими на боці цього плагіна — але вже не тому, що «наступний
// зріз», а тому, що концерн, заради якого вони планувались, їх не потребує.
//
// # Глоб контрибуції ШИРШИЙ за `concern.json` — у двох місцях
//
// `concern.json` дає `**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}`,
// `**/package.json`, `**/jsconfig.json`, `**/k8s/base/configmap.yaml`.
// Порт додає:
//
// 1. `**/k8s/**/*.{yaml,yml}` замість `**/k8s/base/configmap.yaml`.
//    Під-перевірка 8 розрізняє ТРИ стани: каталогу `k8s/` немає (пропуск),
//    `k8s/` є без `base/configmap.yaml` (порушення), файл є (ок). З батчу,
//    що містить лише сам `configmap.yaml`, перші два стани не відрізнити —
//    без розширення глоба гілка «порушення» зникла б МОВЧКИ. Звужено до
//    yaml навмисно: голий `**/k8s/**` на цьому репозиторії тягне 81 файл /
//    708 150 байтів (тут є ПРАВИЛО з назвою `k8s` — `npm/rules/k8s/`), а
//    yaml-варіант — 3 файли / 3 882 байти при тій самій здатності
//    відрізнити три стани. Ціна звуження — пакет, чий `k8s/` не містить
//    ЖОДНОГО yaml, для порту виглядає як пакет без `k8s/` (той самий клас
//    крайового випадку, що розбіжність 2 нижче).
// 2. `**/jsconfig.json` лишається (гейт існування під-перевірки 1).
//
// # Розбіжності з JS-каноном (свідомі, не дрейф)
//
// 1. **Вакуумний `runConftestBatch` не портовано** — розбір вище (Р11).
//    Спостережувана поведінка не змінюється: гілка не давала порушень.
//    Змінюється НЕспостережувана — зникає N процесів `conftest` на прогін і
//    hard-fail у середовищі без нього.
// 2. **`src/` вважається наявним, якщо в батчі є хоч один файл під
//    `<pkg>/src/`.** Канон робить `statSync(<pkg>/src).isDirectory()`.
//    Розбіжність видима лише для пакета, чий `src/` не містить ЖОДНОГО
//    файлу з глоба контрибуції (порожній каталог або, скажімо, лише `.sql`)
//    — тоді порт гілку «немає jsconfig.json» пропустить. Альтернатива —
//    глоб `**/src/**`, тобто вміст усього дерева в батчі; ціна не варта
//    цього крайового випадку.
// 3. **Невалідний `package.json` — не виняток.** Канон робить `JSON.parse`
//    без `try`, тобто валить увесь концерн `DetectorError`-ом; порт
//    трактує маніфест, що не парситься, як «полів немає»
//    ([`parse_json_tolerant`], та сама мікро-розбіжність, що в решті
//    batch-портів цього модуля).
// 4. **`.cursorignore` / `.n-rules.json` `ignore` звужують батч** — раніше
//    задокументована розбіжність УСІХ full-scope портів (реєстр §2.25,
//    successor #403) закрита: канон передає `loadCursorIgnorePaths(cwd)` у
//    `walkDir`, хост тепер теж читає `.n-rules.json` перед побудовою батчу.
//    Двигун обходу той самий (`rules_core::scan::walk_dir`), тож
//    `.gitignore`/`node_modules` поводяться однаково.
// 5. **T0-фікс портовано ОКРЕМОЮ хвилею, ПІСЛЯ цього зрізу** —
//    [`fix_js_run_runtime`] нижче. Це ВИПРАВЛЯЄ, а не підтверджує,
//    попереднє твердження цього пункту («`fix-runtime.mjs` — текстовий
//    патч `package.json#imports`»): на момент того запису опис уже не
//    відповідав файлу — `fix-runtime.mjs` встиг спроститись до ОДНОГО
//    FS-патерну (`js-run-jsconfig-create`, `git log` показує кілька хвиль
//    видалення старих патернів) задовго до цього доккомента. Доккомент
//    біля [`fix_js_run_runtime`] — джерело правди для fix-половини.
// =====================================================================

/// Ключ контрибуції `js-run/runtime` (зріз 7 контракту v3.1).
const CONCERN_JS_RUN_RUNTIME: &str = "js-run/runtime";

/// `reason` УСІХ дев'яти під-перевірок — дефолт `createViolationReporter`
/// (`ctx.concernId`, тобто `runtime` без префікса правила): жоден із
/// викликів `fail(...)` у `runtime/main.mjs` другого аргументу не передає.
const JS_RUN_RUNTIME_REASON: &str = "runtime";

/// Дефолт каталогу підключень — порт `fallback` `resolveConnDirFromPackageJson`
/// (`conn-imports-scan.mjs:52`).
const CONN_DIR_FALLBACK: &str = "src/conn";

/// Канон `jsconfig.json`, вшитий у компонент — ТОЙ САМИЙ файл, що читає
/// T0-фіксер `fix-runtime.mjs` (`readFileSync(new URL('../jsconfig/template/…'))`)
/// і policy-концерн `js-run/jsconfig` (`--data` для `jsconfig.rego`). Той самий
/// прецедент, що [`KNIP_CANONICAL_JSON`] (доккомент секції «`js/check` —
/// T0-фіксер ПОРТОВАНО», PR #513): жодної копії, анти-дрейф —
/// [`embedded_jsconfig_canonical_matches_source_file`] нижче. Джерело файлу
/// вже нормалізоване (`trimEnd() + '\n'` == сирі байти на диску, перевірено
/// вручну при порту) — `include_str!` тут не потребує додаткової нормалізації,
/// на відміну від того, як [`fix_js_run_runtime`] це робить у прода-Rust-порту
/// [`fix-runtime.mjs`]'s `JSCONFIG_CONTENT` (JS-бік перестраховується
/// нормалізацією про всяк випадок; порт вимагає, щоб файл-джерело ВЖЕ був
/// нормалізований — анти-дрейф-тест це й перевіряє).
const JSCONFIG_CANONICAL_JSON: &str =
    include_str!("../../../plugins/lang-js/rules/js-run/jsconfig/template/jsconfig.json.snippet.json");

/// Заборонені logger-модулі під-перевірки 2 — порт `FORBIDDEN_MODULES`
/// (`bunyan-imports.mjs:24`).
const BUNYAN_FORBIDDEN_MODULES: [&str; 2] = ["@nitra/bunyan", "bunyan"];

/// Пакет, з якого має приходити `env` під-перевірки 5 — порт
/// `CHECK_ENV_PACKAGE` (`check-env-scan.mjs:37`).
const CHECK_ENV_PACKAGE: &str = "@nitra/check-env";

/// Маркер точкового приглушення під-перевірки 5 — порт
/// `IGNORE_DIRECTIVE_RE` (`check-env-scan.mjs:35`) 1:1, без lookaround.
const CHECK_ENV_IGNORE_DIRECTIVE_PATTERN: &str = r"//\s*n-rules:ignore-next-line\s+checkEnv\b";

/// Канонічне імʼя GraphQL-файла в `connDir/` — порт `CONN_FILENAME_QL_RE`
/// (`conn-file-rules.mjs:25`) 1:1.
const CONN_FILENAME_QL_PATTERN: &str = r"^ql-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[cm]?[jt]sx?$";

/// Канонічне імʼя файла БД-підключення — порт `CONN_FILENAME_DB_RE`
/// (`conn-file-rules.mjs:31`) 1:1.
const CONN_FILENAME_DB_PATTERN: &str =
    r"^(?:pg|mysql|mssql)-(?:read|write)(?:-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)?\.[cm]?[jt]sx?$";

/// Патерн kebab→camel переходу — порт `/-([a-z0-9])/gu` (`kebabToCamel`,
/// `conn-file-rules.mjs:60`).
const KEBAB_SEGMENT_PATTERN: &str = r"-([a-z0-9])";

/// Спільний предикат «сканувати цей файл» УСІХ шести lib-сканерів:
/// `SOURCE_FILE_RE` ([`is_js_ts_source_file`]) без `.d.ts`. У JS це п'ять
/// однакових експортів (`isCheckEnvScanSourceFile`,
/// `isConnImportsScanSourceFile`, `isConnFileRulesSourceFile`,
/// `isPromiseSetTimeoutScanSourceFile`, `isTemporalScanSourceFile`) плюс
/// пара `isBunyanScanSourceFile`+`shouldSkipFileForBunyanScan`, що дає той
/// самий результат.
fn is_js_run_scan_source_file(rel: &str) -> bool {
    is_js_ts_source_file(rel) && !rel.ends_with(".d.ts")
}

/// Шлях файла батчу відносно кореня пакета — порт `relPosix`
/// (`runtime/main.mjs:82`): `None`, якщо файл поза підпростором пакета.
fn pkg_rel<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    if prefix.is_empty() {
        return Some(path);
    }
    path.strip_prefix(prefix)
}

// ---------------------------------------------------------------------
// Під-перевірка 2 — `lib/bunyan-imports.mjs`
// ---------------------------------------------------------------------

/// Visitor [`find_bunyan_imports_in_text`] — два буфери, що дзеркалять
/// ДВОФАЗНИЙ порядок JS-оригіналу (`bunyan-imports.mjs:48-77`): спершу всі
/// статичні імпорти (`result.module.staticImports`), потім walk за
/// `require('…')`/динамічним `import('…')`. Той самий мотив і та сама
/// форма, що [`RedisImportVisitor`].
struct BunyanImportVisitor<'c> {
    content: &'c str,
    static_hits: Vec<RedisImportHit>,
    walk_hits: Vec<RedisImportHit>,
}

impl BunyanImportVisitor<'_> {
    fn hit(&self, span: Span, module: &str) -> RedisImportHit {
        let base = AstHit::at(self.content, span);
        RedisImportHit {
            line: base.line,
            snippet: base.snippet,
            module: module.to_string(),
        }
    }
}

impl<'a> Visit<'a> for BunyanImportVisitor<'_> {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        let module = it.source.value.as_str();
        if BUNYAN_FORBIDDEN_MODULES.contains(&module) {
            self.static_hits.push(self.hit(it.span, module));
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::Identifier(ident) = &it.callee {
            if ident.name == "require" {
                if let Some(Argument::StringLiteral(lit)) = it.arguments.first() {
                    let module = lit.value.as_str();
                    if BUNYAN_FORBIDDEN_MODULES.contains(&module) {
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
            if BUNYAN_FORBIDDEN_MODULES.contains(&module) {
                self.walk_hits.push(self.hit(it.span, module));
            }
        }
        walk_import_expression(self, it);
    }
}

/// Точний порт `findBunyanImportsInText` (`bunyan-imports.mjs:32-80`).
fn find_bunyan_imports_in_text(content: &str, path: &str) -> Vec<RedisImportHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = BunyanImportVisitor {
        content,
        static_hits: Vec::new(),
        walk_hits: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    let mut hits = visitor.static_hits;
    hits.extend(visitor.walk_hits);
    hits
}

// ---------------------------------------------------------------------
// Під-перевірки 3 і 9 — `lib/conn-imports-scan.mjs` + `checkConnAliasDeclaration`
// ---------------------------------------------------------------------

/// Порт `toPosixDir` (`conn-imports-scan.mjs:40-44`) разом зі
/// `stripTrailingSlashes`.
fn to_posix_dir(raw: &str) -> String {
    let replaced = raw.replace('\\', "/");
    let trimmed = replaced.trim();
    let without_dot_slash = trimmed.strip_prefix("./").unwrap_or(trimmed);
    without_dot_slash.trim_end_matches('/').to_string()
}

/// Точний порт `resolveConnDirFromPackageJson` (`conn-imports-scan.mjs:51-71`):
/// `imports['#conn/*']` рядком або умовним експортом (`default`, потім
/// `import`), з відрізанням хвоста `/*`.
fn resolve_conn_dir_from_package_json(pkg_json: Option<&serde_json::Value>) -> String {
    let fallback = CONN_DIR_FALLBACK.to_string();
    let Some(target) = pkg_json
        .and_then(|pkg| pkg.get("imports"))
        .filter(|imports| imports.is_object())
        .and_then(|imports| imports.get("#conn/*"))
    else {
        return fallback;
    };
    let raw = match target {
        serde_json::Value::String(s) => Some(s.as_str()),
        serde_json::Value::Object(obj) => obj
            .get("default")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("import").and_then(|v| v.as_str())),
        _ => None,
    };
    // JS-канон бере `raw` за truthy — порожній рядок теж падає у fallback.
    let Some(raw) = raw.filter(|s| !s.is_empty()) else {
        return fallback;
    };
    let mut dir = to_posix_dir(raw);
    if dir.ends_with("/*") {
        dir.truncate(dir.len() - 2);
    }
    let dir = dir.trim_end_matches('/').to_string();
    if dir.is_empty() {
        fallback
    } else {
        dir
    }
}

/// Точний порт `isInsideConnDir` (`conn-imports-scan.mjs:79-82`).
fn is_inside_conn_dir(rel: &str, conn_dir: &str) -> bool {
    if conn_dir.is_empty() {
        return false;
    }
    rel == conn_dir || rel.starts_with(&format!("{conn_dir}/"))
}

/// Одна знахідка «фабричного» імпорту: рядок, сніпет, модуль, специфікатор.
struct ConnImportHit {
    line: usize,
    snippet: String,
    module: String,
    specifier: String,
}

/// Точний порт `classifyConnImport` (`conn-imports-scan.mjs:91-114`):
/// `bun` зі специфікатором `SQL`, БУДЬ-ЯКИЙ імпорт з `mssql`,
/// `@nitra/graphql-request` зі специфікатором `GraphQLClient`.
fn classify_conn_import(decl: &ImportDeclaration<'_>) -> Option<&'static str> {
    let module = decl.source.value.as_str();
    let has_named = |wanted: &str| {
        decl.specifiers.iter().flatten().any(|spec| match spec {
            ImportDeclarationSpecifier::ImportSpecifier(named) => named.imported.name() == wanted,
            _ => false,
        })
    };
    match module {
        "bun" if has_named("SQL") => Some("SQL"),
        "mssql" => Some("*"),
        "@nitra/graphql-request" if has_named("GraphQLClient") => Some("GraphQLClient"),
        _ => None,
    }
}

/// Visitor [`find_conn_factory_imports_in_text`] — лише статичні імпорти
/// (JS-оригінал читає рівно `result.module.staticImports`, без walk-фази).
struct ConnImportVisitor<'c> {
    content: &'c str,
    hits: Vec<ConnImportHit>,
}

impl<'a> Visit<'a> for ConnImportVisitor<'_> {
    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        let Some(specifier) = classify_conn_import(it) else {
            return;
        };
        let base = AstHit::at(self.content, it.span);
        self.hits.push(ConnImportHit {
            line: base.line,
            snippet: base.snippet,
            module: it.source.value.to_string(),
            specifier: specifier.to_string(),
        });
    }
}

/// Точний порт `findConnFactoryImportsInText` (`conn-imports-scan.mjs:122-145`).
fn find_conn_factory_imports_in_text(content: &str, path: &str) -> Vec<ConnImportHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = ConnImportVisitor {
        content,
        hits: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.hits
}

// ---------------------------------------------------------------------
// Під-перевірка 4 — `lib/conn-file-rules.mjs`
// ---------------------------------------------------------------------

/// Порушення канону файла з `connDir/` — порт union-типу
/// `{ kind: 'name' | 'default-export' | 'export-name', … }`.
enum ConnFileViolation {
    Name,
    DefaultExport,
    ExportName {
        expected: String,
        found: Vec<String>,
    },
}

/// Точний порт `isConnFileNameValid` (`conn-file-rules.mjs:68-72`).
fn is_conn_file_name_valid(rel: &str) -> bool {
    let base = posix_basename(rel);
    regex::Regex::new(CONN_FILENAME_QL_PATTERN)
        .expect("CONN_FILENAME_QL_PATTERN валідний")
        .is_match(base)
        || regex::Regex::new(CONN_FILENAME_DB_PATTERN)
            .expect("CONN_FILENAME_DB_PATTERN валідний")
            .is_match(base)
}

/// Точний порт `basenameNoExt` (`conn-file-rules.mjs:47-52`): крапка на
/// позиції 0 розширенням НЕ вважається (`dot > 0`).
fn basename_no_ext(rel: &str) -> &str {
    let base = posix_basename(rel);
    match base.rfind('.') {
        Some(dot) if dot > 0 => &base[..dot],
        _ => base,
    }
}

/// Точний порт `kebabToCamel` (`conn-file-rules.mjs:59-61`).
fn kebab_to_camel(kebab: &str) -> String {
    regex::Regex::new(KEBAB_SEGMENT_PATTERN)
        .expect("KEBAB_SEGMENT_PATTERN валідний")
        .replace_all(kebab, |caps: &regex::Captures<'_>| caps[1].to_uppercase())
        .into_owned()
}

/// Порт `collectNamedExportNames` (`conn-file-rules.mjs:146-159`) — ЛИШЕ
/// верхній рівень `program.body`, без обходу вглиб (експорт валідний лише
/// там).
fn collect_named_export_names(program: &Program<'_>) -> Vec<String> {
    let mut out = Vec::new();
    for stmt in &program.body {
        let Statement::ExportNamedDeclaration(export) = stmt else {
            continue;
        };
        match &export.declaration {
            Some(Declaration::VariableDeclaration(decl)) => {
                for declarator in &decl.declarations {
                    // Строго `Identifier` — порт `id.type === 'Identifier'`
                    // (`namesFromVariableDeclaration`): експорт із деструктуризацією
                    // імені для звірки не дає.
                    if let oxc_ast::ast::BindingPattern::BindingIdentifier(ident) = &declarator.id {
                        out.push(ident.name.to_string());
                    }
                }
            }
            Some(Declaration::FunctionDeclaration(func)) => {
                if let Some(id) = &func.id {
                    out.push(id.name.to_string());
                }
            }
            Some(Declaration::ClassDeclaration(class)) => {
                if let Some(id) = &class.id {
                    out.push(id.name.to_string());
                }
            }
            // Порт `nameFromFnOrClassDeclaration` → null для решти
            // (TS-декларації) і, як наслідок, порожній список.
            Some(_) => {}
            None => {
                for spec in &export.specifiers {
                    out.push(spec.exported.name().to_string());
                }
            }
        }
    }
    out
}

/// Порт `hasDefaultExport` (`conn-file-rules.mjs:166-180`).
fn has_default_export(program: &Program<'_>) -> bool {
    program
        .body
        .iter()
        .any(|stmt| matches!(stmt, Statement::ExportDefaultDeclaration(_)))
}

/// Точний порт `findConnFileRuleViolations` (`conn-file-rules.mjs:191-214`),
/// включно з порядком: `name` → (парсинг) → `default-export` → ранній вихід
/// при невалідному імені → `export-name`.
fn find_conn_file_rule_violations(content: &str, rel: &str) -> Vec<ConnFileViolation> {
    let mut out = Vec::new();
    let name_invalid = !is_conn_file_name_valid(rel);
    if name_invalid {
        out.push(ConnFileViolation::Name);
    }

    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(rel)).parse();
    if !ret.diagnostics.is_empty() {
        return out;
    }

    if has_default_export(&ret.program) {
        out.push(ConnFileViolation::DefaultExport);
    }
    if name_invalid {
        return out;
    }

    let expected = kebab_to_camel(basename_no_ext(rel));
    let names = collect_named_export_names(&ret.program);
    if !names.contains(&expected) {
        out.push(ConnFileViolation::ExportName {
            expected,
            found: names,
        });
    }
    out
}

/// Порт `formatConnFileViolation` (`runtime/main.mjs:218-234`).
fn format_conn_file_violation(
    violation: &ConnFileViolation,
    label: &str,
    rel: &str,
    conn_dir: &str,
) -> String {
    match violation {
        ConnFileViolation::Name => format!(
            "{label}{rel} — назва файла в '{conn_dir}/' не відповідає канону js-run: \
             'ql-<id>', 'pg-{{read|write}}[-<id>]', 'mysql-{{read|write}}[-<id>]' або \
             'mssql-{{read|write}}[-<id>]' (kebab-case, [a-z0-9-])"
        ),
        ConnFileViolation::DefaultExport => format!(
            "{label}{rel} — 'export default' заборонений у '{conn_dir}/'; зроби іменований експорт"
        ),
        ConnFileViolation::ExportName { expected, found } => {
            let found = if found.is_empty() {
                "—".to_string()
            } else {
                found.join(", ")
            };
            format!(
                "{label}{rel} — очікується іменований експорт 'export const {expected} = …' \
                 (camelCase від назви файла); знайдено: {found}"
            )
        }
    }
}

// ---------------------------------------------------------------------
// Під-перевірка 5 — `lib/check-env-scan.mjs`
// ---------------------------------------------------------------------

/// Тип порушення `check-env-scan` — порт поля `kind`.
#[derive(PartialEq, Eq, Hash, Clone, Copy)]
enum EnvViolationKind {
    ProcessEnv,
    MissingCheckEnv,
}

/// Одне порушення під-перевірки 5.
struct EnvViolation {
    line: usize,
    name: String,
    kind: EnvViolationKind,
}

/// Чи вузол — `process.env` (StaticMemberExpression `process` . `env`) —
/// порт `isProcessEnvAccess` (`check-env-scan.mjs:44-57`): `computed`
/// форма (`process['env']`) НЕ вважається доступом, як і в канону.
fn is_process_env_expression(expr: &Expression<'_>) -> bool {
    let Expression::StaticMemberExpression(member) = expr else {
        return false;
    };
    matches!(&member.object, Expression::Identifier(obj) if obj.name == "process")
        && member.property.name == "env"
}

/// Чи вузол — Identifier `env` (об'єкт `env.X` / init `const {…} = env`).
fn is_env_identifier(expr: &Expression<'_>) -> bool {
    matches!(expr, Expression::Identifier(ident) if ident.name == "env")
}

/// Порт `staticPropertyName` (`check-env-scan.mjs:303-311`): ключ
/// ObjectPattern-властивості, якщо він статичний (Identifier або
/// string-літерал).
fn static_property_name(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(ident) => Some(ident.name.to_string()),
        PropertyKey::StringLiteral(lit) => Some(lit.value.to_string()),
        _ => None,
    }
}

/// Стан обходу під-перевірки 5 — порт замикань `collectViolations`
/// (`check-env-scan.mjs:219-296`) разом із дедуплікацією за
/// `kind|name|line` і ignore-маркером.
struct CheckEnvVisitor<'c> {
    content: &'c str,
    lines: Vec<&'c str>,
    ignore_re: regex::Regex,
    checked: HashSet<String>,
    env_from_check_env: bool,
    reported: HashSet<(EnvViolationKind, String, usize)>,
    out: Vec<EnvViolation>,
}

impl CheckEnvVisitor<'_> {
    /// Порт `hasIgnoreDirective` (`check-env-scan.mjs:137-141`).
    fn has_ignore_directive(&self, one_based_line: usize) -> bool {
        if one_based_line <= 1 {
            return false;
        }
        let prev = self.lines.get(one_based_line - 2).copied().unwrap_or("");
        self.ignore_re.is_match(prev)
    }

    /// Порт замикання `report`.
    fn report(&mut self, kind: EnvViolationKind, name: String, line: usize) {
        if self.has_ignore_directive(line) {
            return;
        }
        let key = (kind, name.clone(), line);
        if self.reported.contains(&key) {
            return;
        }
        self.reported.insert(key);
        self.out.push(EnvViolation { line, name, kind });
    }

    /// Порт замикання `reportObjectPatternKeys`: рядок беремо за офсетом
    /// САМОЇ властивості, з фолбеком на офсет самої декларації.
    fn report_object_pattern_keys(
        &mut self,
        pattern: &oxc_ast::ast::ObjectPattern<'_>,
        declarator_start: usize,
        kind: EnvViolationKind,
        skip_checked: bool,
    ) {
        for prop in &pattern.properties {
            let Some(name) = static_property_name(&prop.key) else {
                continue;
            };
            if prop.computed || (skip_checked && self.checked.contains(&name)) {
                continue;
            }
            let offset = if prop.span.start == 0 {
                declarator_start
            } else {
                prop.span.start as usize
            };
            let line = line_number_at_offset(self.content, offset);
            self.report(kind, name, line);
        }
    }
}

impl<'a> Visit<'a> for CheckEnvVisitor<'_> {
    /// `process.env.X` і `env.X` — обидві форми репортяться на ЗОВНІШНЬОМУ
    /// вузлі. Для `process.env.X` канон робить це під час візиту
    /// ВНУТРІШНЬОГО `process.env` (через `ancestors.at(-1)`), але той —
    /// перша дитина зовнішнього, тож порядок вибірки збігається.
    fn visit_static_member_expression(&mut self, it: &oxc_ast::ast::StaticMemberExpression<'a>) {
        if is_process_env_expression(&it.object) {
            let name = it.property.name.to_string();
            let line = line_number_at_offset(self.content, it.span.start as usize);
            self.report(EnvViolationKind::ProcessEnv, name, line);
        } else if self.env_from_check_env && is_env_identifier(&it.object) {
            let name = it.property.name.to_string();
            if !self.checked.contains(&name) {
                let line = line_number_at_offset(self.content, it.span.start as usize);
                self.report(EnvViolationKind::MissingCheckEnv, name, line);
            }
        }
        walk_static_member_expression(self, it);
    }

    fn visit_computed_member_expression(
        &mut self,
        it: &oxc_ast::ast::ComputedMemberExpression<'a>,
    ) {
        // `envNameFromMember` для computed-форми бере ЛИШЕ string-літерал.
        let key = match &it.expression {
            Expression::StringLiteral(lit) => Some(lit.value.to_string()),
            _ => None,
        };
        if let Some(name) = key {
            if is_process_env_expression(&it.object) {
                let line = line_number_at_offset(self.content, it.span.start as usize);
                self.report(EnvViolationKind::ProcessEnv, name, line);
            } else if self.env_from_check_env
                && is_env_identifier(&it.object)
                && !self.checked.contains(&name)
            {
                let line = line_number_at_offset(self.content, it.span.start as usize);
                self.report(EnvViolationKind::MissingCheckEnv, name, line);
            }
        }
        walk_computed_member_expression(self, it);
    }

    /// `const { A } = env` канон репортить на САМІЙ декларації (до дітей),
    /// а `const { A } = process.env` — на його `init` (тобто ПІСЛЯ `id`).
    /// Обидва порядки відтворені дослівно, тому обхід тут ручний.
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let object_pattern = match &it.id {
            oxc_ast::ast::BindingPattern::ObjectPattern(pattern) => Some(pattern),
            _ => None,
        };
        let init_is_env = it.init.as_ref().is_some_and(is_env_identifier);
        let init_is_process_env = it.init.as_ref().is_some_and(is_process_env_expression);

        if self.env_from_check_env && init_is_env {
            if let Some(pattern) = object_pattern {
                self.report_object_pattern_keys(
                    pattern,
                    it.span.start as usize,
                    EnvViolationKind::MissingCheckEnv,
                    true,
                );
            }
        }
        self.visit_binding_pattern(&it.id);
        if init_is_process_env {
            if let Some(pattern) = object_pattern {
                self.report_object_pattern_keys(
                    pattern,
                    it.span.start as usize,
                    EnvViolationKind::ProcessEnv,
                    false,
                );
            }
        }
        if let Some(init) = &it.init {
            self.visit_expression(init);
        }
    }
}

/// Порт `collectCheckedEnvNames` (`check-env-scan.mjs:80-99`) — усі
/// string-літерали з `checkEnv([...])` у файлі.
struct CheckEnvNamesVisitor {
    names: HashSet<String>,
}

impl<'a> Visit<'a> for CheckEnvNamesVisitor {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::Identifier(callee) = &it.callee {
            if callee.name == "checkEnv" {
                if let Some(Argument::ArrayExpression(array)) = it.arguments.first() {
                    for element in &array.elements {
                        if let ArrayExpressionElement::StringLiteral(lit) = element {
                            self.names.insert(lit.value.to_string());
                        }
                    }
                }
            }
        }
        walk_call_expression(self, it);
    }
}

/// Порт `hasCheckEnvImport` (`check-env-scan.mjs:109-129`): `import { env }`
/// саме з `@nitra/check-env`, БЕЗ аліасів (`imported.name === local.name === 'env'`).
fn has_check_env_import(program: &Program<'_>) -> bool {
    program.body.iter().any(|stmt| {
        let Statement::ImportDeclaration(decl) = stmt else {
            return false;
        };
        if decl.source.value != CHECK_ENV_PACKAGE {
            return false;
        }
        decl.specifiers.iter().flatten().any(|spec| match spec {
            ImportDeclarationSpecifier::ImportSpecifier(named) => {
                named.imported.name() == "env" && named.local.name == "env"
            }
            _ => false,
        })
    })
}

/// Точний порт `findUncheckedProcessEnvInText` (`check-env-scan.mjs:319-328`).
fn find_unchecked_process_env_in_text(content: &str, path: &str) -> Vec<EnvViolation> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut names = CheckEnvNamesVisitor {
        names: HashSet::new(),
    };
    names.visit_program(&ret.program);

    let mut visitor = CheckEnvVisitor {
        content,
        lines: content
            .split('\n')
            .map(|line| line.strip_suffix('\r').unwrap_or(line))
            .collect(),
        ignore_re: regex::Regex::new(CHECK_ENV_IGNORE_DIRECTIVE_PATTERN)
            .expect("CHECK_ENV_IGNORE_DIRECTIVE_PATTERN валідний"),
        checked: names.names,
        env_from_check_env: has_check_env_import(&ret.program),
        reported: HashSet::new(),
        out: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.out
}

// ---------------------------------------------------------------------
// Під-перевірка 6 — `lib/promise-settimeout-scan.mjs`
// ---------------------------------------------------------------------

/// Порт `extractSingleCallExpression` (`promise-settimeout-scan.mjs:43-52`):
/// тіло функції — рівно один `CallExpression` (concise-стрілка або блок з
/// єдиним `ExpressionStatement`). У `oxc` обидві форми — той самий
/// `FunctionBody`, тож тест один.
fn single_call_expression<'a, 'b>(body: &'b FunctionBody<'a>) -> Option<&'b CallExpression<'a>> {
    if body.statements.len() != 1 {
        return None;
    }
    let Statement::ExpressionStatement(stmt) = &body.statements[0] else {
        return None;
    };
    match &stmt.expression {
        Expression::CallExpression(call) => Some(call),
        _ => None,
    }
}

/// Тіло й кількість параметрів функції-аргументу (стрілка або
/// `function`-вираз) — спільний доступ для [`is_bare_resolve_callback`] і
/// [`is_promise_set_timeout_delay`].
fn function_like_parts<'a, 'b>(
    expr: &'b Expression<'a>,
) -> Option<(&'b FormalParameters<'a>, &'b FunctionBody<'a>)> {
    match expr {
        Expression::ArrowFunctionExpression(arrow) => Some((&arrow.params, &arrow.body)),
        Expression::FunctionExpression(func) => {
            func.body.as_deref().map(|body| (&*func.params, body))
        }
        _ => None,
    }
}

/// Порт `isBareResolveCallback` (`promise-settimeout-scan.mjs:26-35`).
fn is_bare_resolve_callback(arg: Option<&Argument<'_>>, param_name: &str) -> bool {
    let Some(arg) = arg else {
        return false;
    };
    let Some(expr) = arg.as_expression() else {
        return false;
    };
    if let Expression::Identifier(ident) = expr {
        return ident.name == param_name;
    }
    let Some((params, body)) = function_like_parts(expr) else {
        return false;
    };
    if !params.items.is_empty() || params.rest.is_some() {
        return false;
    }
    let Some(call) = single_call_expression(body) else {
        return false;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return false;
    };
    callee.name == param_name && call.arguments.is_empty()
}

/// Порт `isPromiseSetTimeoutDelay` (`promise-settimeout-scan.mjs:62-76`).
fn is_promise_set_timeout_delay(node: &NewExpression<'_>) -> bool {
    let Expression::Identifier(callee) = &node.callee else {
        return false;
    };
    if callee.name != "Promise" || node.arguments.len() != 1 {
        return false;
    }
    let Some(fn_expr) = node.arguments[0].as_expression() else {
        return false;
    };
    let Some((params, body)) = function_like_parts(fn_expr) else {
        return false;
    };
    let Some(first_param) = params.items.first() else {
        return false;
    };
    // Строго `Identifier`, як `firstParam.type !== 'Identifier'` канону:
    // `get_binding_identifier` розгортав би ще й `AssignmentPattern`
    // (`(resolve = x) => …`), який JS-оригінал відкидає.
    let oxc_ast::ast::BindingPattern::BindingIdentifier(param_name) = &first_param.pattern else {
        return false;
    };
    let Some(call) = single_call_expression(body) else {
        return false;
    };
    let Expression::Identifier(call_callee) = &call.callee else {
        return false;
    };
    if call_callee.name != "setTimeout" || call.arguments.is_empty() {
        return false;
    }
    is_bare_resolve_callback(call.arguments.first(), param_name.name.as_str())
}

/// Visitor [`find_promise_set_timeout_in_text`] — порт generic-обходу
/// `walkAst` JS-оригіналу (шукає `NewExpression` на будь-якій глибині).
struct PromiseSetTimeoutVisitor<'c> {
    content: &'c str,
    hits: Vec<AstHit>,
}

impl<'a> Visit<'a> for PromiseSetTimeoutVisitor<'_> {
    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        if is_promise_set_timeout_delay(it) {
            self.hits.push(AstHit::at(self.content, it.span));
        }
        walk_new_expression(self, it);
    }
}

/// Точний порт `findPromiseSetTimeoutInText` (`promise-settimeout-scan.mjs:105-118`).
fn find_promise_set_timeout_in_text(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = PromiseSetTimeoutVisitor {
        content,
        hits: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.hits
}

// ---------------------------------------------------------------------
// Під-перевірка 7 — `lib/temporal-scan.mjs`
// ---------------------------------------------------------------------

/// Visitor [`find_temporal_usage_in_text`]: JS-оригінал ходить УСІ вузли з
/// `type === 'Identifier'`, а в ESTree це і посилання (`Temporal.Now`), і
/// властивість (`obj.Temporal`), і біндинг, і специфікатор імпорту. У
/// `oxc` це чотири різні типи вузлів — звідси чотири методи; дедуплікація
/// за span-ом (порт `seen` JS-оригіналу) знімає подвійний рахунок
/// `import { Temporal }`, де `imported` і `local` мають той самий span.
struct TemporalVisitor<'c> {
    content: &'c str,
    seen: HashSet<(u32, u32)>,
    hits: Vec<AstHit>,
}

impl TemporalVisitor<'_> {
    fn record(&mut self, name: &str, span: Span) {
        if name != "Temporal" || !self.seen.insert((span.start, span.end)) {
            return;
        }
        self.hits.push(AstHit::at(self.content, span));
    }
}

impl<'a> Visit<'a> for TemporalVisitor<'_> {
    fn visit_identifier_reference(&mut self, it: &oxc_ast::ast::IdentifierReference<'a>) {
        self.record(it.name.as_str(), it.span);
    }

    fn visit_binding_identifier(&mut self, it: &oxc_ast::ast::BindingIdentifier<'a>) {
        self.record(it.name.as_str(), it.span);
    }

    fn visit_identifier_name(&mut self, it: &oxc_ast::ast::IdentifierName<'a>) {
        self.record(it.name.as_str(), it.span);
    }

    fn visit_label_identifier(&mut self, it: &oxc_ast::ast::LabelIdentifier<'a>) {
        self.record(it.name.as_str(), it.span);
    }
}

/// Точний порт `findTemporalUsageInText` (`temporal-scan.mjs:24-42`).
fn find_temporal_usage_in_text(content: &str, path: &str) -> Vec<AstHit> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, content, scan_source_type(path)).parse();
    if !ret.diagnostics.is_empty() {
        return Vec::new();
    }
    let mut visitor = TemporalVisitor {
        content,
        seen: HashSet::new(),
        hits: Vec::new(),
    };
    visitor.visit_program(&ret.program);
    visitor.hits
}

// ---------------------------------------------------------------------
// Оркестрація концерну — порт `checkWorkspacePackage` і `lint`
// ---------------------------------------------------------------------

/// Порт `packageJsonHasViteDevDependency` (`runtime/main.mjs:388-393`) —
/// маркер frontend-пакета, який виходить за межі js-run цілком.
fn package_json_has_vite_dev_dependency(pkg_json: Option<&serde_json::Value>) -> bool {
    pkg_json
        .and_then(|pkg| pkg.get("devDependencies"))
        .and_then(|deps| deps.as_object())
        .is_some_and(|deps| deps.contains_key("vite"))
}

/// Файли батчу, що лежать у підпросторі пакета, у вигляді пар
/// («шлях відносно кореня пакета», сам файл) — база для всіх шести
/// сканерів (порт `collectSourceFiles` + `walkDir` per-package обходів).
fn package_source_files<'a>(
    files: &'a [SourceFile],
    prefix: &str,
) -> Vec<(&'a str, &'a SourceFile)> {
    files
        .iter()
        .filter_map(|file| pkg_rel(&file.path, prefix).map(|rel| (rel, file)))
        .filter(|(rel, _)| is_js_run_scan_source_file(rel))
        .collect()
}

/// Порт `checkWorkspacePackage` (`runtime/main.mjs:318-379`) — дев'ять
/// під-перевірок у ТОМУ САМОМУ порядку, що канон (порядок визначає порядок
/// діагностик у результаті).
fn check_js_run_workspace_package(files: &[SourceFile], root_dir: &str, out: &mut Vec<Diagnostic>) {
    let label = format!("[{root_dir}] ");
    let prefix = pkg_walk_prefix(root_dir);
    let pkg_json = batch_file(files, &pkg_json_path(root_dir))
        .and_then(|file| parse_json_tolerant(&file.content));
    if package_json_has_vite_dev_dependency(pkg_json.as_ref()) {
        return;
    }

    let mut fail = |message: String| {
        out.push(Diagnostic {
            reason: JS_RUN_RUNTIME_REASON.to_string(),
            message,
            file: None,
            severity: Severity::Error,
            data: None,
        });
    };

    let conn_dir = resolve_conn_dir_from_package_json(pkg_json.as_ref());
    let sources = package_source_files(files, &prefix);

    // 1 — `jsconfig.json` існує, якщо є `src/` (розбіжності 1–2 доккомента
    // секції: без вакуумного conftest-спавна, `src/` — за наявністю файлів).
    let has_src_dir = files
        .iter()
        .filter_map(|file| pkg_rel(&file.path, &prefix))
        .any(|rel| rel.starts_with("src/"));
    if has_src_dir && batch_file(files, &format!("{prefix}jsconfig.json")).is_none() {
        fail(format!(
            "{label}є каталог src/, але немає jsconfig.json — додай канонічний файл з js-run.mdc \
             (NodeNext, include: src/**/*)."
        ));
    }

    // 2 — заборонені logger-імпорти.
    for (rel, file) in &sources {
        for hit in find_bunyan_imports_in_text(&file.content, rel) {
            fail(format!(
                "{label}{rel}:{} — заміни '{}' на '@nitra/pino': {}",
                hit.line, hit.module, hit.snippet
            ));
        }
    }

    // 3 — фабрики підключень поза `connDir/`.
    for (rel, file) in &sources {
        if is_inside_conn_dir(rel, &conn_dir) {
            continue;
        }
        for hit in find_conn_factory_imports_in_text(&file.content, rel) {
            let target = if hit.specifier == "*" {
                format!("'{}'", hit.module)
            } else {
                format!("{{ {} }} from '{}'", hit.specifier, hit.module)
            };
            fail(format!(
                "{label}{rel}:{} — імпорт {target} має бути в '{conn_dir}/' і реекспортуватися \
                 через '#conn/*': {}",
                hit.line, hit.snippet
            ));
        }
    }

    // 4 — нейминг і експорти всередині `connDir/` (порт `isConnFileToCheck`:
    // `index.*` — реекспортний барель, пропускається).
    for (rel, file) in &sources {
        if !is_inside_conn_dir(rel, &conn_dir) || posix_basename(rel).starts_with("index.") {
            continue;
        }
        for violation in find_conn_file_rule_violations(&file.content, rel) {
            fail(format_conn_file_violation(
                &violation, &label, rel, &conn_dir,
            ));
        }
    }

    // 5 — `process.env` / незакритий `checkEnv`.
    for (rel, file) in &sources {
        for violation in find_unchecked_process_env_in_text(&file.content, rel) {
            let name = &violation.name;
            fail(match violation.kind {
                EnvViolationKind::ProcessEnv => format!(
                    "{label}{rel}:{} — process.env.{name}: заміни на env з '@nitra/check-env' \
                     (обов'язкова змінна + checkEnv(['{name}'])) або з 'node:process' (опційна)",
                    violation.line
                ),
                EnvViolationKind::MissingCheckEnv => format!(
                    "{label}{rel}:{} — env.{name} (з '@nitra/check-env') без checkEnv(['{name}']) \
                     (або '// n-rules:ignore-next-line checkEnv' попереду)",
                    violation.line
                ),
            });
        }
    }

    // 6 — пауза через `new Promise` + `setTimeout`.
    for (rel, file) in &sources {
        for hit in find_promise_set_timeout_in_text(&file.content, rel) {
            fail(format!(
                "{label}{rel}:{} — заміни 'new Promise(r => setTimeout(r, ms))' на \
                 'await setTimeout(ms)' з 'node:timers/promises': {}",
                hit.line, hit.snippet
            ));
        }
    }

    // 7 — `Temporal` у Bun-рантаймі.
    for (rel, file) in &sources {
        for hit in find_temporal_usage_in_text(&file.content, rel) {
            fail(format!(
                "{label}{rel}:{} — Temporal API заборонений у Bun runtime; використовуй Date або \
                 інʼєктований timestamp",
                hit.line
            ));
        }
    }

    // 8 — OTEL configmap (єдина під-перевірка БЕЗ `label`-префікса — канон
    // будує повідомлення від `rootDir` напряму).
    let has_k8s_dir = files
        .iter()
        .filter_map(|file| pkg_rel(&file.path, &prefix))
        .any(|rel| rel.starts_with("k8s/"));
    if has_k8s_dir && batch_file(files, &format!("{prefix}k8s/base/configmap.yaml")).is_none() {
        fail(format!(
            "{root_dir}/k8s/base/configmap.yaml відсутній — додай з полем \
             OTEL_RESOURCE_ATTRIBUTES (service.name=, service.namespace=), js-run.mdc"
        ));
    }

    // 9 — декларація аліаса `#conn/*`.
    let has_conn_files = sources
        .iter()
        .any(|(rel, _)| is_inside_conn_dir(rel, &conn_dir));
    let alias_declared = pkg_json
        .as_ref()
        .and_then(|pkg| pkg.get("imports"))
        .and_then(|imports| imports.as_object())
        .and_then(|imports| imports.get("#conn/*"))
        .is_some_and(|value| !matches!(value, serde_json::Value::Null));
    if has_conn_files && !alias_declared {
        fail(format!(
            "{label}є файли у '{conn_dir}/', але в package.json відсутній аліас \"#conn/*\" — \
             додай \"imports\": {{ \"#conn/*\": \"./{conn_dir}/*\" }} (js-run.mdc conn-aliases)"
        ));
    }
}

/// Точний порт `lint()` `js-run/runtime` (`runtime/main.mjs:477-496`) —
/// WHOLE-BATCH: workspace-пакети кореневого `package.json` без самого
/// кореня `.`; порожній список — жодної діагностики.
fn detect_js_run_runtime(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for root_dir in monorepo_package_root_dirs(files) {
        if root_dir == "." {
            continue;
        }
        check_js_run_workspace_package(files, &root_dir, &mut out);
    }
    out
}

// ---------------------------------------------------------------------
// T0-фікс `js-run/runtime` — портовано ЦІЄЮ хвилею (розбіжність 5 доккомента
// секції «Зріз 7» вище — СКАСОВАНА, не жива: `fix-runtime.mjs` на момент
// того запису вже був спрощений до одного FS-патерну, доккомент
// [`fix_js_run_runtime`] нижче деталізує).
//
// # Що саме портовано
//
// `fix-runtime.mjs` (46 рядків, `git log` показує кілька попередніх хвиль
// спрощення) несе РІВНО один T0Pattern — `js-run-jsconfig-create`, T0-фікс
// під-перевірки 1 («є `src/`, немає `jsconfig.json`»): для КОЖНОГО violation
// виду `[<ws>] є каталог src/, але немає jsconfig.json…` пише канонічний
// `<ws>/jsconfig.json`, якщо файла ще немає. Це вже НЕ текстовий патч
// `package.json#imports` (застаріле твердження доккомента секції «Зріз 7» —
// стосувалось попередньої, ширшої версії файлу; поточний канон і порт нижче
// узгоджені з РЕАЛЬНИМ станом `fix-runtime.mjs`, не з історичним).
//
// # `FixRequest` — whole-batch, той самий full-scope fallback, що `js/check`
//
// [`detect_js_run_runtime`] НІКОЛИ не кладе `file` у `Diagnostic`
// (`check_js_run_workspace_package`, кожен `fail(...)` — `file: None`) —
// тобто `js-run/runtime` СТАЄ другим (після [`CONCERN_JS_CHECK`]) whole-batch
// концерном контрибуції, і його T0-фікс так само проходить крізь full-scope
// fallback `run_wasm_concern_fix` (`crates/rules-napi`, задокументований
// доккоментом секції «`js/check` — T0-фіксер ПОРТОВАНО» і §2.47/§2.49
// реєстру): `FixRequest::files` тут — увесь батч концерну (глоб контрибуції
// вже несе `**/jsconfig.json` — гейт «файл уже існує» під-перевірки 1),
// не лише файли з `diagnostic.file`. Саме тому доказ парності — РЕАЛЬНИЙ
// napi-міст (`runWasmConcern` → `runWasmConcernFix`), не прямий виклик
// гостя (той самий урок §2.47/§2.49: пряме тестування гостя не бачить цю
// гілку взагалі).
//
// # Workspace — з `message`, не з `diagnostic.data`
//
// JS-канон кодує workspace ПРЯМО в тексті повідомлення
// (`[<ws>] є каталог src/, …`) і витягує його назад анхореним регексом
// (`JSCONFIG_MISSING_WS_RE`) — жодного структурованого поля `data` немає.
// [`jsconfig_missing_ws`] — точний порт того самого регекса (анхор на
// ПОЧАТОК рядка: `message`, що містить підрядок, але без провідного
// `[ws] `, мовчки ігнорується — той самий edge case, що характеризаційний
// гейт `fix-runtime/tests/fix-runtime.test.mjs` фіксує для JS-канону).
//
// # Дедуп і ідемпотентність — БЕЗ диск-IO, на відміну від JS
//
// JS-канон — синхронний цикл `existsSync`/`writeFileSync`: ДРУГЕ violation
// з тим самим workspace бачить файл, щойно записаний ПЕРШИМ, і мовчки
// пропускає його (реальний FS-side-effect у межах одного виклику `apply`).
// Порт не пише на диск узагалі (`FixPlan` — декларація, не побічний ефект),
// тож той самий результат («той самий шлях — рівно один edit») дає явний
// `planned`-набір: перше входження шляху лишає його в `planned`, друге —
// коротко пропускається БЕЗ повторної перевірки `batch_file`.
fn fix_js_run_runtime(request: &FixRequest) -> FixPlan {
    let mut edits = Vec::new();
    let mut planned: HashSet<String> = HashSet::new();
    for diagnostic in &request.diagnostics {
        let Some(ws) = jsconfig_missing_ws(&diagnostic.message) else {
            continue;
        };
        let path = jsconfig_target_path(ws);
        if !planned.insert(path.clone()) {
            continue;
        }
        if batch_file(&request.files, &path).is_some() {
            continue;
        }
        edits.push(FileEdit::Write(WriteFile {
            path,
            content: JSCONFIG_CANONICAL_JSON.to_string(),
        }));
    }
    FixPlan { edits }
}

/// Точний порт `JSCONFIG_MISSING_WS_RE` (`fix-runtime.mjs`) —
/// `^\[([^\]]*)\] є каталог src\/, але немає jsconfig\.json`: якір на
/// ПОЧАТОК рядка (на відміну від тестового `JSCONFIG_MISSING_RE`, який
/// матчиться будь-де), тому повертає `None`, якщо `message` не починається
/// РІВНО з `[<ws>] ` перед підрядком.
fn jsconfig_missing_ws(message: &str) -> Option<&str> {
    let rest = message.strip_prefix('[')?;
    let (ws, rest) = rest.split_once(']')?;
    let rest = rest.strip_prefix(' ')?;
    if rest.starts_with(JSCONFIG_MISSING_SUBSTR) {
        Some(ws)
    } else {
        None
    }
}

/// Підрядок, який матчить substring-регекс `JSCONFIG_MISSING_RE`
/// (`fix-runtime.mjs`) — тут використовується лише як частина
/// [`jsconfig_missing_ws`] (анхорена перевірка `test()`-регекса тут не
/// потрібна: `fix()` викликається хостом лише коли якесь violation вже
/// пройшло `test()` на JS/wasm-диспетчер-рівні, доккомент `run-fix.mjs`).
const JSCONFIG_MISSING_SUBSTR: &str = "є каталог src/, але немає jsconfig.json";

/// Точний порт `join(cwd, ws, 'jsconfig.json')` (`fix-runtime.mjs`) у
/// repo-relative форму `FileEdit::Write::path` — той самий
/// [`normalize_rel_path`], що [`pkg_json_path`] використовує для
/// `package.json` (`.`/`""` → корінь без префікса).
fn jsconfig_target_path(ws: &str) -> String {
    match normalize_rel_path(ws) {
        Some(norm) => format!("{norm}/jsconfig.json"),
        None => "jsconfig.json".to_string(),
    }
}

// =====================================================================
// §2.78 — родина `vscode_extensions` + четвірка `package_json`:
// rego-детект через host-import `rego-engine` + два template-рушії.
//
// Це ПЕРША хвиля цього гостя, чий детект — не власний Rust-сканер, а
// вшита `.rego`-політика, оцінена `regorus`. Мотив — не смак: декларація
// концерну в `describe().concerns` ПОВНІСТЮ затінює JS/policy-детект
// (`npm/scripts/lib/lint-surface/detect.mjs`, `if (wasmEntry !== undefined)`),
// тож порт fix БЕЗ порту detect мовчки вимкнув би перевірку — рівно той
// тихий зелений, який §2.65 зробила гучним. Отже detect мусив переїхати
// разом, а детект усіх шести концернів — rego.
//
// # Чому host-import, а не шість ручних Rust-портів policy
//
// §2.66 винесла `regorus` із wasm-гостя в ХОСТ (перший imported resource
// контракту, `rego-engine`), а §2.69 показала, що новий гість дістає
// rego-двигун БЕЗКОШТОВНО. Ручний Rust-переказ шести policy був би шостим
// джерелом правди для тих самих правил (і §2.75 уже зафіксувала, чим це
// закінчується: `.rego` з літеральним списком, який ніхто не звіряє зі
// snippet-ом). Тут джерело правди лишається `.rego` — вшитий `include_str!`
// НАПРЯМУ з `plugins/lang-js/rules/...`, без копії в крейті.
//
// # Дві відомі пастки regorus, які тут НЕ стрельнули
//
// 1. `%q` (§2.68/§2.76) — Go-верб, якого `regorus` не знає; з усіх
//    `.rego` `lang-js` прибраний ЗАЗДАЛЕГІДЬ, а `lang-js` заведений у
//    перелік regorus-консюмерів гейта `npm/tests/rego-regorus-verbs.test.mjs`.
// 2. `walk()` (§2.69) — потребує фіту `"graph"` у `rules-rego-engine`;
//    жодна з шести політик цієї хвилі `walk` не кличе, а сам фіт там уже є.
//
// # Порядок ключів
//
// `rules_template_merge::Json::Object` — `Vec<(String, Json)>`, тобто
// ДОКУМЕНТНИЙ порядок (доккомент залежності в `Cargo.toml`). Це критично:
// обидві колії серіалізують `package.json` через `JSON.stringify(obj, null, 2)`,
// і `serde_json::Value` (BTreeMap, ключі відсортовані) перетасував би весь
// файл на кожному фіксі. Окремий [`JsonOrdered`] цій родині не потрібен.
// =====================================================================

// ---------------------------------------------------------------------
// rego-двигун — той самий `RegoEngineHandle`-мотив, що `plugin-ci-github`
// (§2.66) і `plugin-ci-azure` (§2.69): wasm32 кличе host-import resource
// `rego-engine`, будь-який інший таргет (нативні `cargo test`) кличе
// `rules_rego_engine::RegoEngine` in-process.
// ---------------------------------------------------------------------

#[cfg(target_arch = "wasm32")]
type RegoEngineHandle = RegoEngine;
#[cfg(not(target_arch = "wasm32"))]
type RegoEngineHandle = rules_rego_engine::RegoEngine;

#[cfg(target_arch = "wasm32")]
fn rego_error_stage_message(err: RegoError) -> (&'static str, String) {
    let stage = match err.stage {
        RegoStage::Compile => "compile",
        RegoStage::Input => "set_input",
        RegoStage::Eval => "eval",
    };
    (stage, err.message)
}

#[cfg(not(target_arch = "wasm32"))]
fn rego_error_stage_message(err: rules_rego_engine::RegoError) -> (&'static str, String) {
    (err.stage.as_str(), err.message)
}

/// Один rego-виклик: новий [`RegoEngineHandle`], один `add_policy`, один
/// `add_data_json`, один `eval_rule` — точний відповідник ОДНОГО спавну
/// `conftest test <file> -p <policyDir> --namespace <namespace> --data <tmp>`
/// (`runConftestBatch`, той самий контракт, що
/// `plugin-ci-azure::eval_deny_rule`). Усі шість політик цієї хвилі читають
/// `data.template.snippet`, тож `data_json` тут — не `Option`.
#[allow(unused_mut)] // wasm32: resource-хендл методи беруть `&self`, `mut` потрібен лише нативній гілці.
fn eval_deny_rule(
    rego_source: &str,
    namespace: &str,
    data_json: &str,
    input_json: &str,
) -> Result<Vec<String>, (&'static str, String)> {
    let mut engine = RegoEngineHandle::new();
    engine
        .add_policy(&format!("{namespace}.rego"), rego_source)
        .map_err(rego_error_stage_message)?;
    engine
        .add_data_json(data_json)
        .map_err(rego_error_stage_message)?;
    engine
        .eval_rule(input_json, &format!("data.{namespace}.deny"))
        .map_err(rego_error_stage_message)
}

/// `reason` діагностики про провал самого regorus-виклику — fail loud, НЕ
/// мовчазний fail-open (той самий контракт, що
/// `plugin-ci-github::push_rego_engine_error`).
const REGO_ENGINE_ERROR_REASON: &str = "rego-engine-error";

/// `reason`, яким policy-адаптер (`policy-lint-adapter.mjs`) позначає
/// відсутній обовʼязковий `files.single`.
const POLICY_FILE_MISSING_REASON: &str = "policy-file-missing";

/// `reason` діагностики «таргет є, але не парситься» — гілки, якої в
/// JS-каноні НЕМАЄ: там `conftest` на побитому JSON віддає помилку процесу,
/// і концерн лишається без вердикту. Мовчазний skip — вада, тож тут це
/// видима діагностика (той самий мотив і той самий тег, що
/// `plugin-ci-azure::POLICY_INPUT_INVALID_REASON`).
const POLICY_INPUT_INVALID_REASON: &str = "policy-input-invalid";

/// Видима діагностика про провал rego-виклику (compile/set_input/eval).
fn push_rego_engine_error(
    diagnostics: &mut Vec<Diagnostic>,
    file: &str,
    namespace: &str,
    rego_source_name: &str,
    stage: &str,
    err: &str,
) {
    diagnostics.push(Diagnostic {
        reason: REGO_ENGINE_ERROR_REASON.to_string(),
        message: format!(
            "{file}: regorus-виклик policy-пакета {namespace} ({rego_source_name}) провалився \
             на етапі {stage}: {err} — це має бути структурно недосяжно (живий rego \
             верифікований conftest verify-тестами); якщо бачиш це в реальному прогоні, \
             перевір недавні зміни в .rego чи версію regorus"
        ),
        file: Some(file.to_string()),
        severity: Severity::Error,
        data: Some(format!(
            "{{\"kind\":\"rego-engine-error\",\"namespace\":\"{namespace}\",\"stage\":\"{stage}\"}}"
        )),
    });
}

/// Обгортає розпарсений snippet у `{"template":{"snippet": …}}` — точна
/// JSON-форма, яку канон пише у `--data <tmpfile>` (`runConftestBatch`
/// серіалізує `{ template: templateData }`, а `resolveConcernTemplateData`
/// дає `{ snippet: … }` для `template/<basename>.snippet.json`).
fn wrap_template_data(snippet: TmJson) -> String {
    tm_json_to_string(&TmJson::Object(vec![(
        "template".to_string(),
        TmJson::Object(vec![("snippet".to_string(), snippet)]),
    )]))
}

/// Розбирає вшитий snippet концерну. `panic` — це інваріант ЗБІРКИ, не
/// рантайм-умова: snippet приїхав через `include_str!`, тож «невалідний
/// JSON» тут означає зламаний файл у репозиторії, і мовчазна деградація
/// сховала б це від усіх (той самий контракт, що
/// `rules_core::concerns::fix_template_merge::parse_embedded_snippet`).
fn parse_embedded_snippet(source_name: &str, raw: &str) -> TmJson {
    parse_jsonc_document(raw)
        .unwrap_or_else(|| panic!("вшитий snippet {source_name} — валідний JSON-обʼєкт"))
}

// ---------------------------------------------------------------------
// Спільний rego-детект шести концернів.
// ---------------------------------------------------------------------

/// Дві форми `policy.files`, які резолвить `resolveTargetFiles`
/// (`npm/scripts/lib/resolve-target-files.mjs`) — і рівно ті дві, у яких
/// живуть портовані концерни.
enum PolicyFiles {
    /// `files.single` — один posix-relative шлях від кореня репо.
    Single {
        /// Сам шлях.
        target: &'static str,
        /// `policy.missingMessage`, якщо `policy.files.required == true`;
        /// `None` — концерн НЕ вимагає файлу, і його відсутність не дає
        /// жодної діагностики (точний порт `files.length === 0` гілки
        /// `evaluatePolicyConcern`).
        missing_message: Option<&'static str>,
    },
    /// `files.walkGlob` — УСІ файли дерева, що матчать glob (канон:
    /// `ignore().add(globs).ignores(rel)` по повному обходу репо). Гість
    /// отримує вже відфільтрований хостом batch, тож звужувати його
    /// лишається до цільового `basename` — глоб контрибуції може бути
    /// ширшим за сам таргет.
    WalkGlob {
        /// Патерни контрибуції (див. [`PolicyFiles::contribution_glob`]).
        globs: &'static [&'static str],
        /// Basename цільових файлів (`jsconfig.json`).
        basename: &'static str,
    },
}

impl PolicyFiles {
    /// Глоб контрибуції концерну — рівно те, що хост має покласти в batch і
    /// на детекті, і на фіксі (§2.72).
    fn contribution_glob(&self) -> Vec<String> {
        match self {
            PolicyFiles::Single { target, .. } => vec![(*target).to_string()],
            PolicyFiles::WalkGlob { globs, .. } => {
                globs.iter().map(|g| (*g).to_string()).collect()
            }
        }
    }

    /// `files.single`-шлях, якщо форма саме така — фіксери, що працюють
    /// рівно з одним таргетом, звіряються з цим, а не припускають.
    fn single_target(&self) -> Option<&'static str> {
        match self {
            PolicyFiles::Single { target, .. } => Some(target),
            PolicyFiles::WalkGlob { .. } => None,
        }
    }

    /// Порт `resolveTargetFiles` поверх batch-у: posix-relative шляхи
    /// наявних таргетів. Для `WalkGlob` порядок явно відсортований —
    /// канон теж сортує (`walkAllRelative` → `toSorted`), і без цього
    /// порядок діагностик залежав би від порядку обходу хоста.
    fn resolve(&self, files: &[SourceFile]) -> Vec<String> {
        match self {
            PolicyFiles::Single { target, .. } => batch_file(files, target)
                .map(|f| vec![f.path.clone()])
                .unwrap_or_default(),
            PolicyFiles::WalkGlob { basename, .. } => {
                let mut out: Vec<String> = files
                    .iter()
                    .filter(|f| posix_basename(&f.path) == *basename)
                    .map(|f| f.path.clone())
                    .collect();
                out.sort();
                out
            }
        }
    }
}

/// Статична конфігурація rego-детекту одного концерну — усе, чим
/// концерни цієї родини відрізняються один від одного.
struct PolicyCfg {
    /// `ruleId/concernId` — ключ контрибуції.
    key: &'static str,
    /// Форма `policy.files` — які саме файли перевіряє концерн.
    files: PolicyFiles,
    /// `${ruleId.replaceAll('-','_')}.${concernId}` — namespace, який
    /// будує `evaluatePolicyConcern`; він же `package` вшитого `.rego`.
    namespace: &'static str,
    /// Шлях `.rego` у дереві репо — для тексту помилки.
    rego_source_name: &'static str,
    /// Текст `.rego`-політики концерну (`include_str!` НАПРЯМУ з
    /// `plugins/lang-js/rules/...` — джерело правди лишається Rego).
    rego: &'static str,
    /// Шлях snippet-а у дереві репо — для тексту помилки.
    snippet_source_name: &'static str,
    /// Текст `template/<basename>.snippet.json` концерну.
    snippet_raw: &'static str,
}

/// Спільний T0-детект policy-концерну — точний функціональний відповідник
/// `evaluatePolicyConcern` (`policy-lint-adapter.mjs`) для `engine: 'rego'`
/// з `files.single`.
///
/// # Одне свідоме відхилення від канону (НА КРАЩЕ)
///
/// Таргет читається [`parse_jsonc_document`] (реальний JSONC: `//`,
/// `/* */`, trailing-кома), а не строгим JSON-парсером `conftest`. Для
/// `.vscode/extensions.json` це не косметика: VS Code сам пише туди
/// коментарі, і канон на такому файлі не давав вердикту взагалі. Побитий
/// (СПРАВДІ невалідний) вміст чи не-обʼєктний корінь дає ВИДИМУ
/// діагностику [`POLICY_INPUT_INVALID_REASON`], а не тишу.
fn detect_policy(cfg: &PolicyCfg, files: &[SourceFile]) -> Vec<Diagnostic> {
    let targets = cfg.files.resolve(files);
    if targets.is_empty() {
        // `resolveTargetFiles` дав порожній список: `required` → одна
        // діагностика, інакше — тиша (обидві гілки канону). Для
        // `walkGlob`-форми `required` неможливий за побудовою (канон
        // вимагає `cfg.files.single` у тій самій умові), тож там завжди
        // тиша.
        return match &cfg.files {
            PolicyFiles::Single {
                target,
                missing_message: Some(message),
            } => vec![Diagnostic {
                reason: POLICY_FILE_MISSING_REASON.to_string(),
                message: message.to_string(),
                file: Some(target.to_string()),
                severity: Severity::Error,
                data: None,
            }],
            _ => Vec::new(),
        };
    }
    let snippet = parse_embedded_snippet(cfg.snippet_source_name, cfg.snippet_raw);
    let data_json = wrap_template_data(snippet);
    let mut diagnostics = Vec::new();
    for target in targets {
        let source = batch_file(files, &target).expect("щойно резолвлений таргет є в батчі");
        let Some(actual) = parse_jsonc_document(&source.content) else {
            diagnostics.push(Diagnostic {
                reason: POLICY_INPUT_INVALID_REASON.to_string(),
                message: format!(
                    "{}: невалідний JSON/JSONC або не-обʼєктний корінь — виправ синтаксис ({})",
                    target, cfg.namespace
                ),
                file: Some(target.clone()),
                severity: Severity::Error,
                data: None,
            });
            continue;
        };
        let input_json = tm_json_to_string(&actual);
        match eval_deny_rule(cfg.rego, cfg.namespace, &data_json, &input_json) {
            Ok(mut messages) => {
                // `conftest` віддає `deny`-множину відсортованою (Go-шний
                // `sort.Strings` у виводі), `regorus` — теж множина, але
                // порядок ітерації свій; явний sort робить вивід
                // детермінованим і рівним канонному.
                messages.sort();
                diagnostics.extend(messages.into_iter().map(|message| Diagnostic {
                    reason: POLICY_DENY_REASON.to_string(),
                    message,
                    file: Some(target.clone()),
                    severity: Severity::Error,
                    data: None,
                }));
            }
            Err((stage, err)) => push_rego_engine_error(
                &mut diagnostics,
                &target,
                cfg.namespace,
                cfg.rego_source_name,
                stage,
                &err,
            ),
        }
    }
    diagnostics
}

/// Знаходить конфіг за ключем концерну (`None` — ключ не з цієї родини).
fn policy_cfg(key: &str) -> Option<&'static PolicyCfg> {
    POLICY_CONFIGS.iter().find(|c| c.key == key)
}

// ---------------------------------------------------------------------
// Концерни родини `vscode_extensions` (два) і четвірка `package_json`.
// ---------------------------------------------------------------------

/// Ключ контрибуції `js/vscode_extensions` (§2.78).
const CONCERN_JS_VSCODE_EXTENSIONS: &str = "js/vscode_extensions";
/// Ключ контрибуції `style/vscode_extensions` (§2.78).
const CONCERN_STYLE_VSCODE_EXTENSIONS: &str = "style/vscode_extensions";
/// Ключ контрибуції `js/package_json` (§2.78).
const CONCERN_JS_PACKAGE_JSON: &str = "js/package_json";
/// Ключ контрибуції `npm-module/npm_package_json` (§2.78).
const CONCERN_NPM_PACKAGE_JSON: &str = "npm-module/npm_package_json";
/// Ключ контрибуції `npm-module/root_package_json` (§2.78).
const CONCERN_ROOT_PACKAGE_JSON: &str = "npm-module/root_package_json";
/// Ключ контрибуції `style/package_json` (§2.78).
const CONCERN_STYLE_PACKAGE_JSON: &str = "style/package_json";

// =====================================================================
// §2.80 — решта конфіг-подібних концернів `plugin-lang-js`.
//
// # Що саме портовано
//
// Пʼять концернів, чотири з них — той самий rego-детект, що §2.78
// ([`detect_policy`]), лише на своїх таргетах:
//
// - `style/vscode_settings` — ОСТАННІЙ незакритий член родини
//   `vscode_*`/`zed_settings` (решта 14 портовані §2.77/§2.78). Рушій
//   фіксу — [`template_merge_fix`], тобто ОДИН запис у
//   [`TEMPLATE_FIX_CONFIGS`], без власного коду;
// - `js/jscpd_config` — те саме, плюс ЧИСЛОВИЙ поріг [`MinLeaf`];
// - `npm-module/emit_types_config` — те саме, без порогів;
// - `js-run/jsconfig` — ЄДИНИЙ `files.walkGlob`-концерн цього гостя
//   (звідси [`PolicyFiles`]) і єдиний із власним рушієм фіксу
//   ([`jsconfig_fix`]): його `.rego` порівнює top-level масиви як множини
//   на РІВНІСТЬ, тож union-мерж спільного двигуна лишав би концерн
//   червоним назавжди;
// - `style/tooling` — детект переїхав ще батчем 8, тут добудовано
//   fix-половину ([`fix_style_tooling`]): три FS-патерни, жодного
//   policy-шару.
//
// # Що СВІДОМО не портовано — `test/stryker_config`
//
// Детект цього концерну переїхав зрізом 1 контракту v3.1; fix-половина
// лишається в JS (`fix-stryker_config.mjs`), і §2.80 цього не змінює.
// Причина та сама, що зафіксував зріз 1, і вона не в бюджеті задачі, а в
// формі host-мосту: весь T0 концерну тримається на ПОВТОРНОМУ прогоні
// планувальника (`planStrykerActions(cwd)` у `apply`), а `FixRequest::files`
// хост будує з `file`-полів переданих violations
// (`rules-napi::run_wasm_concern_fix`). Full-scope fallback на глоб
// контрибуції там спрацьовує ЛИШЕ коли ЖОДНА діагностика не назвала файл —
// а `stryker-config-missing` свій файл несе. Тобто гість дістав би батч із
// самих (відсутніх) цільових файлів і не побачив би ні `package.json`
// воркспейсів, ні `vitest.config.mjs`, ні `src/**/*.vue`, з яких
// планувальник і будує план. Оголосити концерн заради fix і лишити його
// half-wired не можна: ключ у реєстрі гостя ЗАТІНЮЄ JS-гілку
// (`detect.mjs`, `if (wasmEntry !== undefined)`), і єдиний робочий автофікс
// мовчки вимкнувся б. Порожній `fix-plan` гостя тут — коректне «нічого не
// чиню», далі фіксить JS-канон (`loadT0Patterns` ДОДАЄ wasm-патерн перед
// JS-патерном, а не заміщає його).
//
// # Полагоджені дефекти канону (не відтворені заради парності)
//
// 1. `minLines` збивався назад на поріг — [`MinLeaf`], та сама вада, що
//    §2.78 знайшла на `@nitra/eslint-config`, лише числова;
// 2. `jsconfig.json` із коментарями (легальний JSONC для VS Code) валив
//    `JSON.parse` канону, і фікс мовчки нічого не робив — [`jsconfig_fix`];
// 3. `"stylelint": "рядок"` у `package.json`: детект такий конфіг за
//    наявний не вважає, а канонний фікс виходив на будь-якому truthy —
//    концерн не сходився ніколи ([`fix_style_tooling`]).
// =====================================================================

/// Ключ контрибуції `style/vscode_settings` (§2.80) — ОСТАННІЙ незакритий
/// член родини `vscode_*`/`zed_settings`.
const CONCERN_STYLE_VSCODE_SETTINGS: &str = "style/vscode_settings";
/// Ключ контрибуції `js/jscpd_config` (§2.80).
const CONCERN_JSCPD_CONFIG: &str = "js/jscpd_config";
/// Ключ контрибуції `npm-module/emit_types_config` (§2.80).
const CONCERN_EMIT_TYPES_CONFIG: &str = "npm-module/emit_types_config";
/// Ключ контрибуції `js-run/jsconfig` (§2.80) — ЄДИНИЙ `walkGlob`-концерн
/// цього компонента.
const CONCERN_JSCONFIG: &str = "js-run/jsconfig";

/// Спільний таргет обох `vscode_extensions`-концернів.
const VSCODE_EXTENSIONS_TARGET: &str = ".vscode/extensions.json";
/// Таргет `js/package_json`, `npm-module/root_package_json`, `style/package_json`.
const ROOT_PACKAGE_JSON_TARGET: &str = "package.json";
/// Таргет `npm-module/npm_package_json`.
const NPM_PACKAGE_JSON_TARGET: &str = "npm/package.json";
/// Таргет `style/vscode_settings` (§2.80).
const VSCODE_SETTINGS_TARGET: &str = ".vscode/settings.json";
/// Таргет `js/jscpd_config` (§2.80).
const JSCPD_CONFIG_TARGET: &str = ".jscpd.json";
/// Таргет `npm-module/emit_types_config` (§2.80).
const EMIT_TYPES_CONFIG_TARGET: &str = "npm/tsconfig.emit-types.json";
/// Basename таргетів `js-run/jsconfig` (§2.80).
const JSCONFIG_BASENAME: &str = "jsconfig.json";

/// Глоб контрибуції `js-run/jsconfig` — дослівно `files.walkGlob` канону.
/// Обидва матчери трактують `**/` як «нуль або більше каталогів», тобто
/// КОРЕНЕВИЙ `jsconfig.json` теж потрапляє в набір: gitignore-матчер канону
/// (`ignore().add(['**/jsconfig.json'])`) — за специфікацією gitignore,
/// `globset` (яким хост будує batch, `build_full_scope_files`) — за власною
/// семантикою `**`. Перевірено емпірично, а не припущено: розходження тут
/// беззвучно викинуло б кореневий таргет і з детекту, і з фіксу (§2.72).
const JSCONFIG_GLOBS: &[&str] = &["**/jsconfig.json"];

/// Policy-конфіги цієї родини — по одному на концерн (шість §2.78 плюс
/// чотири §2.80).
const POLICY_CONFIGS: &[PolicyCfg] = &[
    PolicyCfg {
        key: CONCERN_JS_VSCODE_EXTENSIONS,
        files: PolicyFiles::Single {
            target: VSCODE_EXTENSIONS_TARGET,
            // `concern.json`: `files.required = true` + `missingMessage`.
            missing_message: Some(
                ".vscode/extensions.json не існує — додай recommendations з js.mdc",
            ),
        },
        namespace: "js.vscode_extensions",
        rego_source_name: "plugins/lang-js/rules/js/vscode_extensions/vscode_extensions.rego",
        rego: include_str!(
            "../../../plugins/lang-js/rules/js/vscode_extensions/vscode_extensions.rego"
        ),
        snippet_source_name:
            "plugins/lang-js/rules/js/vscode_extensions/template/extensions.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/js/vscode_extensions/template/extensions.json.snippet.json"
        ),
    },
    PolicyCfg {
        key: CONCERN_STYLE_VSCODE_EXTENSIONS,
        files: PolicyFiles::Single {
            target: VSCODE_EXTENSIONS_TARGET,
            // `concern.json` НЕ має `required` — відсутній файл не дає діагностики.
            missing_message: None,
        },
        namespace: "style.vscode_extensions",
        rego_source_name: "plugins/lang-js/rules/style/vscode_extensions/vscode_extensions.rego",
        rego: include_str!(
            "../../../plugins/lang-js/rules/style/vscode_extensions/vscode_extensions.rego"
        ),
        snippet_source_name:
            "plugins/lang-js/rules/style/vscode_extensions/template/extensions.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/style/vscode_extensions/template/extensions.json.snippet.json"
        ),
    },
    PolicyCfg {
        key: CONCERN_JS_PACKAGE_JSON,
        files: PolicyFiles::Single {
            target: ROOT_PACKAGE_JSON_TARGET,
            missing_message: None,
        },
        namespace: "js.package_json",
        rego_source_name: "plugins/lang-js/rules/js/package_json/package_json.rego",
        rego: include_str!("../../../plugins/lang-js/rules/js/package_json/package_json.rego"),
        snippet_source_name:
            "plugins/lang-js/rules/js/package_json/template/package.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/js/package_json/template/package.json.snippet.json"
        ),
    },
    PolicyCfg {
        key: CONCERN_NPM_PACKAGE_JSON,
        files: PolicyFiles::Single {
            target: NPM_PACKAGE_JSON_TARGET,
            missing_message: None,
        },
        namespace: "npm_module.npm_package_json",
        rego_source_name:
            "plugins/lang-js/rules/npm-module/npm_package_json/npm_package_json.rego",
        rego: include_str!(
            "../../../plugins/lang-js/rules/npm-module/npm_package_json/npm_package_json.rego"
        ),
        snippet_source_name:
            "plugins/lang-js/rules/npm-module/npm_package_json/template/package.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/npm-module/npm_package_json/template/package.json.snippet.json"
        ),
    },
    PolicyCfg {
        key: CONCERN_ROOT_PACKAGE_JSON,
        files: PolicyFiles::Single {
            target: ROOT_PACKAGE_JSON_TARGET,
            missing_message: None,
        },
        namespace: "npm_module.root_package_json",
        rego_source_name:
            "plugins/lang-js/rules/npm-module/root_package_json/root_package_json.rego",
        rego: include_str!(
            "../../../plugins/lang-js/rules/npm-module/root_package_json/root_package_json.rego"
        ),
        snippet_source_name:
            "plugins/lang-js/rules/npm-module/root_package_json/template/package.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/npm-module/root_package_json/template/package.json.snippet.json"
        ),
    },
    PolicyCfg {
        key: CONCERN_STYLE_PACKAGE_JSON,
        files: PolicyFiles::Single {
            target: ROOT_PACKAGE_JSON_TARGET,
            missing_message: None,
        },
        namespace: "style.package_json",
        rego_source_name: "plugins/lang-js/rules/style/package_json/package_json.rego",
        rego: include_str!("../../../plugins/lang-js/rules/style/package_json/package_json.rego"),
        snippet_source_name:
            "plugins/lang-js/rules/style/package_json/template/package.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/style/package_json/template/package.json.snippet.json"
        ),
    },
    // --- §2.80 ---
    PolicyCfg {
        key: CONCERN_STYLE_VSCODE_SETTINGS,
        files: PolicyFiles::Single {
            target: VSCODE_SETTINGS_TARGET,
            // `concern.json` без `required` — як у `style/vscode_extensions`.
            missing_message: None,
        },
        namespace: "style.vscode_settings",
        rego_source_name: "plugins/lang-js/rules/style/vscode_settings/vscode_settings.rego",
        rego: include_str!(
            "../../../plugins/lang-js/rules/style/vscode_settings/vscode_settings.rego"
        ),
        snippet_source_name:
            "plugins/lang-js/rules/style/vscode_settings/template/settings.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/style/vscode_settings/template/settings.json.snippet.json"
        ),
    },
    PolicyCfg {
        key: CONCERN_JSCPD_CONFIG,
        files: PolicyFiles::Single {
            target: JSCPD_CONFIG_TARGET,
            // `concern.json`: `files.required = true` + `missingMessage`.
            missing_message: Some(".jscpd.json не існує — створи з полями згідно js.mdc"),
        },
        namespace: "js.jscpd_config",
        rego_source_name: "plugins/lang-js/rules/js/jscpd_config/jscpd_config.rego",
        rego: include_str!("../../../plugins/lang-js/rules/js/jscpd_config/jscpd_config.rego"),
        snippet_source_name:
            "plugins/lang-js/rules/js/jscpd_config/template/.jscpd.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/js/jscpd_config/template/.jscpd.json.snippet.json"
        ),
    },
    PolicyCfg {
        key: CONCERN_EMIT_TYPES_CONFIG,
        files: PolicyFiles::Single {
            target: EMIT_TYPES_CONFIG_TARGET,
            missing_message: None,
        },
        namespace: "npm_module.emit_types_config",
        rego_source_name:
            "plugins/lang-js/rules/npm-module/emit_types_config/emit_types_config.rego",
        rego: include_str!(
            "../../../plugins/lang-js/rules/npm-module/emit_types_config/emit_types_config.rego"
        ),
        snippet_source_name:
            "plugins/lang-js/rules/npm-module/emit_types_config/template/tsconfig.emit-types.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/npm-module/emit_types_config/template/tsconfig.emit-types.json.snippet.json"
        ),
    },
    PolicyCfg {
        key: CONCERN_JSCONFIG,
        files: PolicyFiles::WalkGlob {
            globs: JSCONFIG_GLOBS,
            basename: JSCONFIG_BASENAME,
        },
        namespace: "js_run.jsconfig",
        rego_source_name: "plugins/lang-js/rules/js-run/jsconfig/jsconfig.rego",
        rego: include_str!("../../../plugins/lang-js/rules/js-run/jsconfig/jsconfig.rego"),
        snippet_source_name:
            "plugins/lang-js/rules/js-run/jsconfig/template/jsconfig.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/js-run/jsconfig/template/jsconfig.json.snippet.json"
        ),
    },
];

// ---------------------------------------------------------------------
// Рушій 1 — `vscode-ext-add` (union `recommendations` за РЯДКОВИМ значенням).
// ---------------------------------------------------------------------

/// Дві альтернативи `REC_REQUIRE_RE`
/// (`/recommendations має містити|extensions\.json/u`) — літеральні
/// підрядки, регулярка тут не потрібна.
const REC_REQUIRE_NEEDLES: [&str; 2] = ["recommendations має містити", "extensions.json"];

/// Ключ `recommendations` — єдине поле, яке рушій читає й пише.
const RECOMMENDATIONS_KEY: &str = "recommendations";

/// `obj[key]` як вектор рядків — той самий контракт, що
/// `Array.isArray(parsed.recommendations) ? … : []` канону.
fn recommendations_of(value: &TmJson) -> Vec<String> {
    value
        .get(RECOMMENDATIONS_KEY)
        .and_then(TmJson::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(TmJson::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// T0-фіксер обох `vscode_extensions`-концернів — точний порт
/// `npm/scripts/lib/fix/vscode-ext-add.mjs`: union
/// `.vscode/extensions.json#recommendations` із канонічним
/// `template/extensions.json.snippet.json#recommendations` за РЯДКОВИМ
/// значенням (не структурний deep-merge — це свідомо ІНШИЙ, простіший
/// рушій, ніж [`template_merge_fix`]).
///
/// Запис — ПОВНА регенерація ([`json_to_pretty_string`], 2 пробіли +
/// кінцевий `\n`), точний відповідник `JSON.stringify(parsed, null, 2) +
/// '\n'` канону: коментарі вхідного JSONC запис НЕ переживають, і це
/// задокументована межа рушія (канон губить їх так само), не тиха
/// регресія — жоден ключ і жодна рекомендація при цьому не зникають.
///
/// # Полагоджені дефекти канону (не відтворені заради парності)
///
/// 1. **JSONC-вхід.** Канон читав таргет `JSON.parse` → виняток → мовчазний
///    `return { touchedFiles: [] }` на цілком легальному для VS Code файлі
///    з `//`-коментарями. Тут читання йде [`parse_jsonc_document`].
/// 2. **Не-обʼєктний корінь.** Канон робив `parsed.recommendations = …` на
///    будь-якому результаті `JSON.parse`: для масиву властивість губилась
///    при `JSON.stringify`, для скаляра — кидало. Тут це явний no-op.
fn vscode_extensions_fix(cfg: &PolicyCfg, request: &FixRequest) -> FixPlan {
    let empty = FixPlan { edits: vec![] };
    // Рушій працює рівно з одним таргетом; `walkGlob`-форма сюди не
    // диспатчиться за побудовою (гілка `Guest::fix` перелічує два ключі
    // поіменно), і це закріплено тестом
    // [`vscode_extensions_kontserny_maiut_single_formu`].
    let target = cfg
        .files
        .single_target()
        .expect("vscode_extensions-концерн — `files.single`");
    let applicable = request.diagnostics.iter().any(|d| {
        d.reason == POLICY_FILE_MISSING_REASON
            || REC_REQUIRE_NEEDLES.iter().any(|n| d.message.contains(n))
    });
    if !applicable {
        return empty;
    }
    let snippet = parse_embedded_snippet(cfg.snippet_source_name, cfg.snippet_raw);
    let canonical = recommendations_of(&snippet);
    assert!(
        !canonical.is_empty(),
        "вшитий снапшот {} має непорожній «{RECOMMENDATIONS_KEY}»",
        cfg.snippet_source_name
    );

    let existing = batch_file(&request.files, target);
    let (mut entries, recs): (Vec<(String, TmJson)>, Vec<String>) = match existing {
        None => (Vec::new(), Vec::new()),
        Some(source) => match parse_jsonc_document(&source.content) {
            Some(parsed) => {
                let recs = recommendations_of(&parsed);
                let TmJson::Object(entries) = parsed else {
                    unreachable!("parse_jsonc_document повертає лише обʼєктний корінь")
                };
                (entries, recs)
            }
            // Побитий вміст або не-обʼєктний корінь: детермінованому фіксу
            // нема з чого будувати мерж, а перезаписати сміття «канонічним»
            // файлом означало б знищити дані користувача — порушення при
            // цьому лишається видимим у звіті лінту.
            None => return empty,
        },
    };

    let to_add: Vec<&String> = canonical.iter().filter(|c| !recs.contains(c)).collect();
    if to_add.is_empty() && existing.is_some() {
        return empty;
    }
    let mut new_recs: Vec<TmJson> = recs.into_iter().map(TmJson::Str).collect();
    new_recs.extend(to_add.into_iter().cloned().map(TmJson::Str));
    match entries.iter_mut().find(|(k, _)| k == RECOMMENDATIONS_KEY) {
        Some(entry) => entry.1 = TmJson::Array(new_recs),
        None => entries.push((RECOMMENDATIONS_KEY.to_string(), TmJson::Array(new_recs))),
    }
    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: target.to_string(),
            content: json_to_pretty_string(&TmJson::Object(entries)),
        })],
    }
}

// ---------------------------------------------------------------------
// Рушій 2 — `createTemplateFixPattern` (deep-merge snippet → target).
// ---------------------------------------------------------------------

/// Як порівнювати фактичне значення листка-порогу з канонічним.
enum MinKind {
    /// semver-діапазон (`^3.10.0`) — [`version_meets_min`].
    SemverRange,
    /// число (`minLines: 25`) — просте `>=`.
    Number,
}

/// Листок snippet-а, чиє канонічне значення — МІНІМАЛЬНИЙ поріг, а не точне
/// значення: детект приймає будь-яке значення `>= порогу`, тож і мерж мусить
/// лишати ВИЩЕ значення на місці.
///
/// # Це полагоджений баг канону, а не оптимізація
///
/// Два незалежні приклади одного дефекту, обидва в цьому компоненті:
///
/// - `js/package_json.rego` вимагає `devDependencies["@nitra/eslint-config"]`
///   **≥ порогу зі snippet-а** (`eslint_config_meets_min`);
/// - `js/jscpd_config.rego` вимагає `minLines` як число **≥ 25**
///   (`is_valid_min_lines`).
///
/// А `createTemplateFixPattern` мерджить листя ТОЧНОЮ рівністю
/// (`mergeJsonValue`: `return snippet`). Наслідок у каноні: будь-яке
/// порушення концерну (напр. `engines.node < 24` чи брак `reporters`)
/// запускає merge, який мовчки ЗБИВАЄ вже коректний `^3.20.0` назад на
/// `^3.10.0` (відповідно `minLines: 40` назад на `25`) — тобто
/// «виправлення» ПОГІРШУЄ файл і при цьому не гасить порушення, через яке
/// його викликали. Порт цього дефекту біт-у-біт не відтворює: видима зміна
/// поведінки тут — НА КРАЩЕ, і зафіксована тестами
/// [`js_package_json_fix_ne_znyzhuie_vyshchu_versiiu_eslint_config`] і
/// [`jscpd_config_fix_ne_znyzhuie_vyshchyi_min_lines`].
struct MinLeaf {
    /// Ключ секції верхнього рівня (`devDependencies`); `None` — листок
    /// лежить у КОРЕНІ snippet-а (`minLines`).
    section: Option<&'static str>,
    /// Ключ самого листка (`@nitra/eslint-config`, `minLines`).
    name: &'static str,
    /// Семантика порівняння.
    kind: MinKind,
}

/// Статична конфігурація одного `createTemplateFixPattern`-концерну.
struct TemplateFixCfg {
    /// `ruleId/concernId` — ключ контрибуції.
    key: &'static str,
    /// Posix-relative шлях цільового файлу.
    target: &'static str,
    /// Шлях snippet-а у дереві репо — для тексту помилки.
    snippet_source_name: &'static str,
    /// БАЙТ-У-БАЙТ текст `template/<basename>.snippet.json`: на відсутньому
    /// таргеті копіюється verbatim, точно як
    /// `writeFileSync(absTarget, rawSnippet, 'utf8')` канону.
    snippet_raw: &'static str,
    /// Листя-пороги ([`MinLeaf`]) — порожньо для всіх, крім
    /// `js/package_json`.
    min_leaves: &'static [MinLeaf],
}

/// Чотири конфіги рушія `template-deep-merge` цієї хвилі.
///
/// `bun/package_json` сюди СВІДОМО не входить: він іншого класу (deny-мапа
/// замість snippet-а, видалення замість мержу, cross-file переписування
/// чужих `package.json`/workflow-yml) і винесений в окрему задачу.
const TEMPLATE_FIX_CONFIGS: &[TemplateFixCfg] = &[
    TemplateFixCfg {
        key: CONCERN_JS_PACKAGE_JSON,
        target: ROOT_PACKAGE_JSON_TARGET,
        snippet_source_name:
            "plugins/lang-js/rules/js/package_json/template/package.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/js/package_json/template/package.json.snippet.json"
        ),
        min_leaves: &[MinLeaf {
            section: Some("devDependencies"),
            name: "@nitra/eslint-config",
            kind: MinKind::SemverRange,
        }],
    },
    TemplateFixCfg {
        key: CONCERN_NPM_PACKAGE_JSON,
        target: NPM_PACKAGE_JSON_TARGET,
        snippet_source_name:
            "plugins/lang-js/rules/npm-module/npm_package_json/template/package.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/npm-module/npm_package_json/template/package.json.snippet.json"
        ),
        min_leaves: &[],
    },
    TemplateFixCfg {
        key: CONCERN_ROOT_PACKAGE_JSON,
        target: ROOT_PACKAGE_JSON_TARGET,
        snippet_source_name:
            "plugins/lang-js/rules/npm-module/root_package_json/template/package.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/npm-module/root_package_json/template/package.json.snippet.json"
        ),
        min_leaves: &[],
    },
    TemplateFixCfg {
        key: CONCERN_STYLE_PACKAGE_JSON,
        target: ROOT_PACKAGE_JSON_TARGET,
        snippet_source_name:
            "plugins/lang-js/rules/style/package_json/template/package.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/style/package_json/template/package.json.snippet.json"
        ),
        min_leaves: &[],
    },
    // --- §2.80: три з чотирьох нових концернів — той самий рушій ---
    TemplateFixCfg {
        key: CONCERN_STYLE_VSCODE_SETTINGS,
        target: VSCODE_SETTINGS_TARGET,
        snippet_source_name:
            "plugins/lang-js/rules/style/vscode_settings/template/settings.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/style/vscode_settings/template/settings.json.snippet.json"
        ),
        min_leaves: &[],
    },
    TemplateFixCfg {
        key: CONCERN_JSCPD_CONFIG,
        target: JSCPD_CONFIG_TARGET,
        snippet_source_name:
            "plugins/lang-js/rules/js/jscpd_config/template/.jscpd.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/js/jscpd_config/template/.jscpd.json.snippet.json"
        ),
        // `minLines` — поріг, не точне значення (доккомент [`MinLeaf`]).
        // `reporters`/`ignore` окремого механізму НЕ потребують: детект
        // вимагає їх як SUBSET, а `merge_json_value` мерджить масиви
        // UNION-ом ([`contained_in`]) — зайві елементи користувача
        // переживають фікс без жодної спеціальної обробки.
        min_leaves: &[MinLeaf {
            section: None,
            name: "minLines",
            kind: MinKind::Number,
        }],
    },
    TemplateFixCfg {
        key: CONCERN_EMIT_TYPES_CONFIG,
        target: EMIT_TYPES_CONFIG_TARGET,
        snippet_source_name:
            "plugins/lang-js/rules/npm-module/emit_types_config/template/tsconfig.emit-types.json.snippet.json",
        snippet_raw: include_str!(
            "../../../plugins/lang-js/rules/npm-module/emit_types_config/template/tsconfig.emit-types.json.snippet.json"
        ),
        min_leaves: &[],
    },
];

/// Знаходить конфіг template-фіксу за ключем концерну.
fn template_fix_cfg(key: &str) -> Option<&'static TemplateFixCfg> {
    TEMPLATE_FIX_CONFIGS.iter().find(|c| c.key == key)
}

/// Точний порт rego-хелпера `split_to_numbers` (`js/package_json.rego`):
/// `regex.split("\D+", spec)` → відкидання порожніх → `to_number`.
/// `u64`-парсинг замість `to_number` достатній: усі токени тут — цифрові
/// прогони, нецифрове в них потрапити не може за побудовою.
fn split_to_numbers(spec: &str) -> Vec<u64> {
    spec.split(|c: char| !c.is_ascii_digit())
        .filter(|t| !t.is_empty())
        .filter_map(|t| t.parse::<u64>().ok())
        .collect()
}

/// Точний порт rego-хелпера `eslint_config_meets_min`: `workspace:`-протокол
/// задовольняє поріг завжди; інакше — лексикографічне порівняння
/// major.minor.patch (`semver_gte`), і обидві сторони мусять дати ≥3 числа.
fn version_meets_min(range: &str, min_range: &str) -> bool {
    if range.trim().starts_with("workspace:") {
        return true;
    }
    let actual = split_to_numbers(range);
    let min = split_to_numbers(min_range);
    if actual.len() < 3 || min.len() < 3 {
        return false;
    }
    actual[..3] >= min[..3]
}

/// Числове значення листка — точний відповідник rego-предиката
/// `is_number(actual)` (`js/jscpd_config.rego`): і ціле, і дробове, решта —
/// `None`.
fn json_number(value: &TmJson) -> Option<f64> {
    match value {
        #[expect(
            clippy::cast_precision_loss,
            reason = "пороги концернів — малі цілі (`minLines: 25`); f64 представляє їх точно"
        )]
        TmJson::Int(i) => Some(*i as f64),
        TmJson::Float(f) => Some(*f),
        _ => None,
    }
}

/// Чи фактичне значення листка вже задовольняє канонічний поріг — рівно та
/// сама перевірка, яку робить detect у своїй `.rego`.
fn meets_min(actual: &TmJson, min: &TmJson, kind: &MinKind) -> bool {
    match kind {
        MinKind::SemverRange => match (actual.as_str(), min.as_str()) {
            (Some(a), Some(m)) => version_meets_min(a, m),
            _ => false,
        },
        MinKind::Number => match (json_number(actual), json_number(min)) {
            (Some(a), Some(m)) => a >= m,
            _ => false,
        },
    }
}

/// Замінює у snippet-і листя-пороги ([`MinLeaf`]) на ФАКТИЧНЕ значення
/// таргета, коли воно вже задовольняє поріг. Далі мерж бачить листок, що вже
/// збігається, і не чіпає його; коли ж фактичне значення порогу НЕ
/// задовольняє (або відсутнє), snippet лишається як є, і мерж підтягує його
/// до канону.
fn apply_min_leaves(snippet: TmJson, actual: &TmJson, leaves: &[MinLeaf]) -> TmJson {
    let TmJson::Object(mut entries) = snippet else {
        return snippet;
    };
    for leaf in leaves {
        let actual_leaf = match leaf.section {
            Some(section) => actual.get(section).and_then(|s| s.get(leaf.name)),
            None => actual.get(leaf.name),
        };
        let Some(actual_leaf) = actual_leaf else {
            continue;
        };
        let slot = match leaf.section {
            Some(section) => match entries.iter_mut().find(|(k, _)| k == section) {
                Some((_, TmJson::Object(inner))) => inner.iter_mut().find(|(k, _)| k == leaf.name),
                _ => None,
            },
            None => entries.iter_mut().find(|(k, _)| k == leaf.name),
        };
        let Some(slot) = slot else {
            continue;
        };
        if meets_min(actual_leaf, &slot.1, &leaf.kind) {
            slot.1 = actual_leaf.clone();
        }
    }
    TmJson::Object(entries)
}

/// T0-фіксер чотирьох `package_json`-концернів — точний порт
/// `createTemplateFixPattern(...).apply` (`template-deep-merge.mjs`) для
/// JSON-таргета, поверх СПІЛЬНОГО двигуна `rules-template-merge` (§2.71):
/// та сама семантика мержу, що на нативній колії, за побудовою.
///
/// Послідовність: жодної діагностики про `cfg.target` → порожній план (порт
/// `violations.every(v => v.file !== targetPath)`); файлу немає в батчі →
/// snippet копіюється verbatim; файл є, але не парситься як JSONC-обʼєкт →
/// порожній план; файл уже задовольняє snippet ([`is_subset`]) → порожній
/// план (idempotent, без reformat); інакше — хірургічний
/// comment-preserving splice із fallback-ом на повну регенерацію.
///
/// Три свідомі відхилення від JS-канону — ті самі, що вже задокументовані
/// нативною половиною (`rules_core::concerns::fix_template_merge`): JSONC-вхід
/// більше не втрачається, не-обʼєктний корінь більше не знищується,
/// коментарі й форматування виживають. Четверте, специфічне саме для цієї
/// хвилі, — [`MinLeaf`].
fn template_merge_fix(cfg: &TemplateFixCfg, request: &FixRequest) -> FixPlan {
    let empty = FixPlan { edits: vec![] };
    if !request
        .diagnostics
        .iter()
        .any(|d| d.file.as_deref() == Some(cfg.target))
    {
        return empty;
    }
    let Some(source) = batch_file(&request.files, cfg.target) else {
        // Файлу немає → копіюємо snippet як є: мерджити немає з чим (той
        // самий контракт, що `prevText === null` у каноні).
        return FixPlan {
            edits: vec![FileEdit::Write(WriteFile {
                path: cfg.target.to_string(),
                content: cfg.snippet_raw.to_string(),
            })],
        };
    };
    let Some(actual) = parse_jsonc_document(&source.content) else {
        return empty; // побитий синтаксис або не-обʼєктний корінь — не чіпаємо
    };
    let snippet = apply_min_leaves(
        parse_embedded_snippet(cfg.snippet_source_name, cfg.snippet_raw),
        &actual,
        cfg.min_leaves,
    );
    if is_subset(Some(&actual), &snippet) {
        return empty;
    }
    let content = try_surgical_merge(&source.content, &snippet, TmFormat::Jsonc)
        .unwrap_or_else(|| json_to_pretty_string(&merge_json_value(Some(&actual), &snippet)));
    if content == source.content {
        return empty;
    }
    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: cfg.target.to_string(),
            content,
        })],
    }
}

// ---------------------------------------------------------------------
// Рушій 3 — `js-run/jsconfig` (§2.80): ВЛАСНИЙ merge, не
// `createTemplateFixPattern`.
// ---------------------------------------------------------------------

/// Записує (чи додає) поле обʼєкта зі збереженням порядку вставки — та сама
/// семантика, що `obj[key] = value` у JS.
fn set_entry(entries: &mut Vec<(String, TmJson)>, key: &str, value: TmJson) {
    match entries.iter_mut().find(|(k, _)| k == key) {
        Some(entry) => entry.1 = value,
        None => entries.push((key.to_string(), value)),
    }
}

/// Чи фактичне значення листка збігається з канонічним — точний порт
/// `valuesMatch` (`fix-jsconfig.mjs`): масиви порівнюються як МНОЖИНИ
/// (`new Set(a).size === new Set(b).size && b.every(x => a.includes(x))`),
/// решта — строгою рівністю.
fn jsconfig_values_match(actual: Option<&TmJson>, expected: &TmJson) -> bool {
    let TmJson::Array(expected_items) = expected else {
        return actual == Some(expected);
    };
    let Some(actual_items) = actual.and_then(TmJson::as_array) else {
        return false;
    };
    let uniq = |items: &[TmJson]| {
        let mut out: Vec<TmJson> = Vec::new();
        for item in items {
            if !out.contains(item) {
                out.push(item.clone());
            }
        }
        out
    };
    uniq(actual_items).len() == uniq(expected_items).len()
        && expected_items.iter().all(|x| actual_items.contains(x))
}

/// Мерджить канонічний snippet у розібраний `jsconfig.json` — точний порт
/// `mergeSnippet`/`mergeSection` (`fix-jsconfig.mjs`). Повертає `true`, якщо
/// щось справді змінилось (порт `changes.length === 0 → continue`).
///
/// # Чому масив ЗАМІНЮЄТЬСЯ, а не мерджиться union-ом
///
/// Це не спрощення, а вимога збіжності: `jsconfig.rego` порівнює top-level
/// масиви як МНОЖИНИ на РІВНІСТЬ (`{x | …} != {x | …}`), не як subset. Union
/// (семантика [`merge_json_value`], якою живуть усі template-merge-концерни)
/// лишив би зайвий елемент користувача на місці — детект після фіксу
/// лишався б червоним НАЗАВЖДИ, а фікс щоразу звітував би про
/// «виправлення». Саме тому цей концерн має власний рушій, а не запис у
/// [`TEMPLATE_FIX_CONFIGS`].
fn jsconfig_merge_snippet(entries: &mut Vec<(String, TmJson)>, snippet: &TmJson) -> bool {
    let TmJson::Object(fields) = snippet else {
        return false;
    };
    let mut changed = false;
    for (field, expected) in fields {
        let actual = entries
            .iter()
            .find(|(k, _)| k == field)
            .map(|(_, v)| v)
            .cloned();
        let TmJson::Object(inner_fields) = expected else {
            if !jsconfig_values_match(actual.as_ref(), expected) {
                set_entry(entries, field, expected.clone());
                changed = true;
            }
            continue;
        };
        // `mergeSection`: не-обʼєктне (чи відсутнє) значення секції канон
        // заміняє порожнім обʼєктом і наповнює каноном.
        let mut inner: Vec<(String, TmJson)> = match actual {
            Some(TmJson::Object(existing)) => existing,
            _ => Vec::new(),
        };
        let mut section_changed = false;
        for (leaf, leaf_expected) in inner_fields {
            let leaf_actual = inner.iter().find(|(k, _)| k == leaf).map(|(_, v)| v);
            if jsconfig_values_match(leaf_actual, leaf_expected) {
                continue;
            }
            set_entry(&mut inner, leaf, leaf_expected.clone());
            section_changed = true;
        }
        if section_changed {
            set_entry(entries, field, TmJson::Object(inner));
            changed = true;
        }
    }
    changed
}

/// T0-фіксер `js-run/jsconfig` — порт `fix-jsconfig.mjs`: для КОЖНОГО файлу,
/// на який вказала діагностика, мерж канонічного snippet-а
/// ([`jsconfig_merge_snippet`]) і повна регенерація тексту
/// ([`json_to_pretty_string`] — точний відповідник
/// `JSON.stringify(cfg, null, 2) + '\n'`).
///
/// # Полагоджений дефект канону
///
/// **JSONC-вхід.** `jsconfig.json` — файл VS Code, і `//`-коментарі в ньому
/// легальні (TypeScript-сервер читає його як JSONC). Канон читав його
/// `JSON.parse` у `try`, і на такому файлі мовчки робив `continue`: фікс
/// «спрацьовував», нічого не змінивши, а порушення лишалось. Тут читання йде
/// [`parse_jsonc_document`]. Коментарі повної регенерації НЕ переживають —
/// задокументована межа рушія (та сама, що [`vscode_extensions_fix`]), але це
/// видима зміна файлу, а не тиша.
fn jsconfig_fix(request: &FixRequest) -> FixPlan {
    let cfg = policy_cfg(CONCERN_JSCONFIG).expect("конфіг `js-run/jsconfig` у POLICY_CONFIGS");
    let snippet = parse_embedded_snippet(cfg.snippet_source_name, cfg.snippet_raw);
    let mut targets: Vec<&str> = Vec::new();
    for diagnostic in &request.diagnostics {
        let Some(file) = diagnostic.file.as_deref() else {
            continue;
        };
        if !targets.contains(&file) {
            targets.push(file);
        }
    }
    let mut edits = Vec::new();
    for target in targets {
        // Файл, якого немає в батчі, канон теж пропускає (`readFileSync`
        // кидає → `continue`): scaffold-у в цього концерну немає взагалі —
        // `walkGlob` не породжує діагностики про відсутній файл.
        let Some(source) = batch_file(&request.files, target) else {
            continue;
        };
        let Some(TmJson::Object(mut entries)) = parse_jsonc_document(&source.content) else {
            continue;
        };
        if !jsconfig_merge_snippet(&mut entries, &snippet) {
            continue;
        }
        let content = json_to_pretty_string(&TmJson::Object(entries));
        if content == source.content {
            continue;
        }
        edits.push(FileEdit::Write(WriteFile {
            path: target.to_string(),
            content,
        }));
    }
    FixPlan { edits }
}

// ---------------------------------------------------------------------
// Рушій 4 — `style/tooling` (§2.80): три FS-патерни без policy-шару.
// ---------------------------------------------------------------------

/// Таргет двох перших патернів `style/tooling`.
const STYLELINTIGNORE_TARGET: &str = ".stylelintignore";

/// Рядок, якого вимагає детект у `.stylelintignore`.
const STYLELINTIGNORE_DIST_LINE: &str = "dist/";

/// `STYLELINTIGNORE_MISSING_RE` (`fix-tooling.mjs`) — літеральний підрядок,
/// регулярка тут не потрібна.
const STYLELINTIGNORE_MISSING_NEEDLE: &str = ".stylelintignore не існує";

/// `STYLELINTIGNORE_NO_DIST_RE` — той самий мотив.
const STYLELINTIGNORE_NO_DIST_NEEDLE: &str = ".stylelintignore не містить рядка dist/";

/// `NO_STYLELINT_CONFIG_RE` — той самий мотив.
const NO_STYLELINT_CONFIG_NEEDLE: &str = "Немає конфігу stylelint";

/// Поле `stylelint` у `package.json` — його читає детект і пише фікс.
const STYLELINT_PKG_FIELD: &str = "stylelint";

/// Канонічний snippet третього патерну — `{ "stylelint": { "extends":
/// "@nitra/stylelint-config" } }`. Літерала в `template/` у цього концерну
/// немає: він не policy-, а FS-класу, і канон теж будує обʼєкт у коді.
fn stylelint_pkg_snippet() -> TmJson {
    TmJson::Object(vec![(
        STYLELINT_PKG_FIELD.to_string(),
        TmJson::Object(vec![(
            "extends".to_string(),
            TmJson::Str("@nitra/stylelint-config".to_string()),
        )]),
    )])
}

/// T0-фіксер `style/tooling` — порт трьох патернів `fix-tooling.mjs`.
///
/// Патерни 1 і 2 взаємовиключні за побудовою детекту (файл або є, або
/// немає), тож двох `Write` в один шлях у плані бути не може.
///
/// # Полагоджені дефекти канону
///
/// 1. **Не-обʼєктне поле `stylelint`.** Детект вважає конфіг присутнім лише
///    для `Object | Array` ([`stylelint_config_present`]), а канонний фікс
///    виходив на будь-якому TRUTHY значенні (`if (pkg.stylelint) return`).
///    На `"stylelint": "щось"` фікс мовчки не робив нічого, а порушення
///    лишалось — концерн не сходився ніколи. Тут гейт — ТОЙ САМИЙ предикат,
///    що в детекті.
/// 2. **Повна регенерація `package.json`.** Канон переписував файл
///    `JSON.stringify(pkg, null, 2)`, губивши коментарі й форматування; тут
///    спершу хірургічна вставка ([`try_surgical_merge`]) з fallback-ом на
///    регенерацію — той самий контракт, що [`template_merge_fix`].
fn fix_style_tooling(request: &FixRequest) -> FixPlan {
    let has = |needle: &str| {
        request
            .diagnostics
            .iter()
            .any(|d| d.message.contains(needle))
    };
    let mut edits = Vec::new();

    if has(STYLELINTIGNORE_MISSING_NEEDLE) {
        edits.push(FileEdit::Write(WriteFile {
            path: STYLELINTIGNORE_TARGET.to_string(),
            content: format!("{STYLELINTIGNORE_DIST_LINE}\n"),
        }));
    } else if has(STYLELINTIGNORE_NO_DIST_NEEDLE) {
        // `appendFileSync(target, '\ndist/\n')` — контракт `FileEdit` знає
        // лише ПОВНИЙ запис файлу, тож дописуємо до вмісту з батчу. Файл,
        // якого в батчі немає, у цій гілці неможливий (діагностика «не
        // містить рядка» виникає лише коли файл прочитано), але писати
        // наосліп однаково не можна — це затерло б чужий вміст.
        if let Some(source) = batch_file(&request.files, STYLELINTIGNORE_TARGET) {
            edits.push(FileEdit::Write(WriteFile {
                path: STYLELINTIGNORE_TARGET.to_string(),
                content: format!("{}\n{STYLELINTIGNORE_DIST_LINE}\n", source.content),
            }));
        }
    }

    if has(NO_STYLELINT_CONFIG_NEEDLE) {
        if let Some(source) = batch_file(&request.files, ROOT_PACKAGE_JSON_TARGET) {
            if let Some(actual) = parse_jsonc_document(&source.content) {
                let already = matches!(
                    actual.get(STYLELINT_PKG_FIELD),
                    Some(TmJson::Object(_) | TmJson::Array(_))
                );
                if !already {
                    let snippet = stylelint_pkg_snippet();
                    let content = try_surgical_merge(&source.content, &snippet, TmFormat::Jsonc)
                        .unwrap_or_else(|| {
                            json_to_pretty_string(&merge_json_value(Some(&actual), &snippet))
                        });
                    if content != source.content {
                        edits.push(FileEdit::Write(WriteFile {
                            path: ROOT_PACKAGE_JSON_TARGET.to_string(),
                            content,
                        }));
                    }
                }
            }
        }
    }

    FixPlan { edits }
}

// =====================================================================
// §2.87 — fix-половина storybook-пари (`test/storybook-ci`,
// `test/storybook-scaffold`).
//
// # Гіпотеза «це шими над `createTemplateFixPattern`» — СПРОСТОВАНА
//
// Наявність `template/` у трійки storybook (ci/scaffold/vitest-config)
// зовні читалась як родина `vscode_*`/`package_json` (§2.78/§2.80), тобто
// три РЯДКИ в [`TEMPLATE_FIX_CONFIGS`]. Насправді `template/` тут — інший
// вид артефакта: не `*.snippet.json` для deep-merge, а ГОТОВІ ФАЙЛИ
// скафолда (`main.js`, `preview.js`, `action.yml`), що копіюються
// verbatim або з однією токен-підстановкою. Жоден із трьох не імпортує
// `createTemplateFixPattern` узагалі (звірено grep-ом по
// `plugins/lang-js/rules/test/`), і жоден їхній таргет не є JSON-ом, який
// можна змержити. Спільного рушія тут немає — кожен портується окремо.
//
// # Реальний блокер, який довелось зняти, — форма fix-batch-у хоста
//
// `run_wasm_concern_fix` будує `fix-request.files` з `file`-полів
// діагностик. Для КОНЦЕРНУ КЛАСУ «канонічного файлу бракує» це фатально
// вдвічі:
//
// 1. усі шляхи, які назвали діагностики, на диску ВІДСУТНІ, тож
//    `read_source_files` пропускає їх усі й гість дістає ПОРОЖНІЙ `files`
//    при непорожніх `diagnostics` — рівно двозначність #513, яку
//    `ambiguous_empty_fix_batch_err` нібито закрив (гейт дивиться на
//    `target_files` ДО читання, не на фактичний батч);
// 2. обидва фікси рахують скоуп САМІ ([`collect_in_scope_vue_packages`]) —
//    їм потрібне все дерево, а не два відсутні шляхи.
//
// Заявлений `fix-glob` цього не рятував: до §2.87 хост читав його ЛИШЕ у
// гілці `target_files.is_empty()`, тобто для концерну з file-ними
// діагностиками поле мовчки не працювало — та сама вада класу §2.72, від
// якої `fix-glob` і мав рятувати. Зміна в `crates/rules-napi`: ЯВНИЙ
// (непорожній) `fix-glob` тепер вмикає full-scope батч завжди, з union-ом
// названих діагностиками файлів. Це перший реальний споживач поля.
//
// # `test/storybook-vitest-config` СВІДОМО не портовано
//
// Блокер тут не в скоупі (його зняв той самий `fix-glob`), а в самій
// природі фіксу: він не ГЕНЕРУЄ файл із шаблону, а хірургічно РЕДАГУЄ
// чужий `vitest.config.*` — oxc-parse, пошук `test.projects`, точкові
// string-splice-и з підбором відступу під наявне форматування, повторний
// parse і відкат при невалідному результаті, плюс витяг
// `ObjectExpression`-літерала з шести template-модулів тим самим парсером.
// Це не порт таблицею, а перенос ~400 рядків AST-хірургії, де byte-exact
// parity вимірюється в пробілах усередині ЧУЖОГО файлу, і де будь-яка
// розбіжність splice-офсету псує робочий конфіг консюмера мовчки. Такий
// обсяг не має лягати в хвіст задачі, що вже несе host-зміну; концерн
// лишається на JS-каноні (він робочий), а гість його fix НЕ оголошує —
// half-wired заглушка тут заборонена (`guestFix` зупиняє `applyT0` на
// першому непорожньому плані гостя).

// # `bun/package_json` СВІДОМО не портовано — блокує форма `source-file`
//
// Розвідка §2.92. Концерн НЕ оголошений у [`build_manifest`] взагалі — ані
// в `concerns`, ані в `fix_only_concerns`. Це рішення, а не пропуск.
//
// ## Що робить канон (`fix-package_json.mjs`)
//
// Дві операції в одному патерні: (а) видалення заборонених top-level полів
// за `template/package.json.deny.json`; (б) видалення `scripts.lint*`. Друга
// — cross-file: ПЕРЕД видаленням скрипта канон обходить УСЕ дерево
// (`walkDir` + `loadCursorIgnorePaths`), переписує знайдені виклики
// `bun|yarn|pnpm [run] <script>` / `npm run <script>` у workflow-yml і чужих
// `package.json` на `bunx n-rules lint <surface>`, робить ДРУГИЙ прохід і
// видаляє скрипт лише тоді, коли не лишилось жодного нерозпізнаного виклику
// — у ЖОДНОМУ файлі репо, включно з тими, які канон свідомо НЕ переписує
// (`kind: 'other'` — Makefile, README, довільний shell). Саме ця
// консервативність і є суттю фіксу: `other`-збіг БЛОКУЄ видалення.
//
// ## Дві межі, що виявились НЕ блокерами
//
// 1. **`.cursorignore`-фільтрація.** Не розбіжність: `loadCursorIgnorePaths`
//    читає `.n-rules.json:ignore` (fallback `.n-cursor.json`), і рівно те
//    саме робить хост — `build_full_scope_files` іде через
//    `rules_core::concerns::cursor_ignore::walk_repo`, порт того ж
//    `loadCursorIgnorePaths` + inline-нормалізації `walkDir.mjs`. Скоупи
//    збігаються.
// 2. **Другий верифікаційний прохід.** Теж не блокер, і не потребує
//    перестановки кроків §2.86: гість САМ обчислює переписаний вміст, тож
//    другий прохід виконується над in-memory мапою (переписаний вміст для
//    workflow/`package.json`, вихідний — для `other`), а не над диском.
//    Результат тотожний, ще й детермінований.
//
// ## Блокер: `**/*` як `fix-glob` неможливий у чинному контракті
//
// Щоб відтворити «`other`-збіг блокує видалення», `fix-glob` мусить
// покривати ВСІ текстові файли репо — тобто `**/*`. Але `source-file.content`
// у `wit/world.wit` — `string`, і `read_source_files` (`crates/rules-napi`)
// на першому ж не-UTF-8 байті повертає `non_utf8_source_file_err` (§2.83)
// — навмисне гучна відмова: до неї тут стояв `from_utf8_lossy`, чий
// покалічений вміст ішов у знімки host-diff і фікс ПЕРЕЗАПИСАВ БИ бінарник
// мозаїкою. Отже `**/*` завалює КОЖЕН fix-виклик у будь-якому репо з хоча
// б одним бінарником. У цьому репо таких файлів шість (три
// `rules-napi.*.node`, `welcome.png`, `welcome.png.avif`,
// `.codex/hooks/capture-decisions.log`).
//
// Обійти `!`-виключеннями не можна: денилист бінарних розширень для ЧУЖОГО
// репо принципово неповний, і кожне неперелічене (`.ico`, `.woff2`, `.pdf`,
// `.zip`, …) знову валить фікс. Звузити `fix-glob` до алловліста текстових
// розширень — ще гірше: extensionless `Makefile`/`Justfile`/`Dockerfile` і
// будь-який shell без розширення стають НЕВИДИМИМИ, гість видаляє скрипт,
// який канон лишив би, і мовчки ламає консюмера. Це рівно та шкода, задля
// уникнення якої канон і має свою `other`-гілку.
//
// ## Другий блокер: ціна батчу
//
// Замір на цьому репо: `**/*` після gitignore-обходу — 3389 файлів,
// 130 118 732 Б (124,09 MiB); лише валідний UTF-8 — 3383 файли,
// 30,37 MiB. `run_wasm_concern_fix` із непорожнім `fix-glob` читає цей
// скоуп ТРИЧІ за виклик (батч + `before_snapshot` + `after_snapshot`), тож
// ~91 MiB IO і ~30 MiB копії у лінійну памʼять гостя на КОЖЕН fix одного
// `package.json`. Для порівняння цільові файли важать 985 331 Б
// (13 `package.json` = 929 212 Б + 15 workflow = 56 119 Б) — тобто
// ~1 % корисного скоупу до ~99 % накладних.
//
// ## Чому не `capabilities.fs_read`
//
// Формально preopen існує (`PluginHost::build_host_state`), і `fs_read:
// ["."]` дав би гостю власний обхід із байтовим читанням. Три «ні»: (а)
// capability оголошується на ВЕСЬ плагін, тобто всі 25+ концернів
// `lang-js` дістали б read-доступ до цілого репо заради одного; (б) гість
// мусив би вдруге реалізувати gitignore-обхід усередині wasm, дублюючи
// `rules_core::scan` і породжуючи саме той дрейф скоупу, який §2.72/§2.87
// робили гучним; (в) preopen резолвиться від `std::env::current_dir()`
// ХОСТ-ПРОЦЕСУ, а не від `cwd`-параметра `run_wasm_concern_fix` — для
// `lint --path <інше-дерево>` гість дивився б не туди. Останнє — окремий
// латентний дефект хоста, зафіксований у §2.92; чинних споживачів
// `fs_read` немає, тож він досі не спостерігався.
//
// ## Чому НЕ half-порт «лише deny-поля»
//
// Технічно безпечний варіант існує: оголосити концерн, віддавати план лише
// коли в цільовому `package.json` НЕМАЄ `scripts.lint*`, інакше — порожній
// план, який `applyT0` підхопить JS-каноном. Він не half-wired (порожній
// план не зупиняє `applyT0`), але й не наближає мету: канон лишається
// обовʼязковим НАЗАВЖДИ, а в дерево лягає міна для хвилі зняття канонів
// (§2.88, урок 9) — оголошений гість-фікс виглядає як завершений порт, і
// зняття канону тихо вимкне саме lint-скриптову гілку. Тому концерн не
// оголошений узагалі.

/// Токен матриці пакетів у `lint-storybook.yml.snippet.yml` — точний порт
/// `PACKAGE_DIRS_TOKEN` (`fix-storybook-ci.mjs:21`).
const STORYBOOK_CI_PACKAGE_DIRS_TOKEN: &str = "__STORYBOOK_CI_PACKAGE_DIRS__";

/// Токен stories-глоба у scaffold-шаблонах — точний порт
/// `STORIES_GLOB_TOKEN` (`fix-storybook-scaffold.mjs:14`).
const STORYBOOK_STORIES_GLOB_TOKEN: &str = "__STORYBOOK_STORIES_GLOB__";

/// Стандартний stories-глоб app-проєкта — точний порт `APP_STORIES_GLOB`
/// (`storybook-scaffold/main.mjs:82`).
const APP_STORIES_GLOB: &str = "../src/**/*.stories.@(js|ts)";

/// `template/setup-playwright-chromium.action.yml` — verbatim.
const PLAYWRIGHT_ACTION_TEMPLATE: &str = include_str!(
    "../../../plugins/lang-js/rules/test/storybook-ci/template/setup-playwright-chromium.action.yml"
);

/// `template/lint-storybook.yml.snippet.yml` — із токеном матриці.
const STORYBOOK_WORKFLOW_TEMPLATE: &str = include_str!(
    "../../../plugins/lang-js/rules/test/storybook-ci/template/lint-storybook.yml.snippet.yml"
);

/// `template/main.js` бібліотеки — із токеном stories-глоба.
const SCAFFOLD_MAIN_JS_TEMPLATE: &str =
    include_str!("../../../plugins/lang-js/rules/test/storybook-scaffold/template/main.js");

/// `template/app-main.js` — із токеном stories-глоба ([`APP_STORIES_GLOB`]).
const SCAFFOLD_APP_MAIN_JS_TEMPLATE: &str =
    include_str!("../../../plugins/lang-js/rules/test/storybook-scaffold/template/app-main.js");

/// `template/preview.js` — verbatim.
const SCAFFOLD_PREVIEW_JS_TEMPLATE: &str =
    include_str!("../../../plugins/lang-js/rules/test/storybook-scaffold/template/preview.js");

/// `template/app-preview.js` — verbatim.
const SCAFFOLD_APP_PREVIEW_JS_TEMPLATE: &str =
    include_str!("../../../plugins/lang-js/rules/test/storybook-scaffold/template/app-preview.js");

/// `template/mocks/gql-sse.js` — verbatim.
const SCAFFOLD_MOCKS_GQL_SSE_TEMPLATE: &str =
    include_str!("../../../plugins/lang-js/rules/test/storybook-scaffold/template/mocks/gql-sse.js");

/// `template/empty-vite.config.js` — verbatim.
const SCAFFOLD_EMPTY_VITE_CONFIG_TEMPLATE: &str = include_str!(
    "../../../plugins/lang-js/rules/test/storybook-scaffold/template/empty-vite.config.js"
);

/// `template/vitest.setup.js` — verbatim.
const SCAFFOLD_VITEST_SETUP_TEMPLATE: &str =
    include_str!("../../../plugins/lang-js/rules/test/storybook-scaffold/template/vitest.setup.js");

/// `rootDir` із `diagnostic.data` (`{"rootDir": "..."}`), який кладуть
/// [`check_package_scaffold`] і scope-детект.
fn diagnostic_root_dir(diagnostic: &Diagnostic) -> Option<String> {
    let raw = diagnostic.data.as_ref()?;
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    value.get("rootDir")?.as_str().map(str::to_string)
}

/// Шлях, якого торкається одна правка плану — guest-бік WIT-варіанта
/// `file-edit` метода не має (на host-боці це `FileEdit::path`).
fn edit_path(edit: &FileEdit) -> &str {
    match edit {
        FileEdit::Write(w) => &w.path,
        FileEdit::WriteBytes(w) => &w.path,
        FileEdit::Delete(path) => path.as_str(),
    }
}

/// Posix-join кореня пакета з відносним шляхом усередині нього
/// (`rootDir === '.'` → без префікса) — дзеркало `resolvePkgDir` + `join`
/// JS-канону, лише в relative-просторі `SourceFile::path`.
fn pkg_join(root_dir: &str, rel: &str) -> String {
    format!("{}{rel}", pkg_rel_prefix(root_dir))
}

/// Точний порт `renderPackageDirsYaml` (`fix-storybook-ci.mjs:41-43`) —
/// по одному `- <rootDir>` на рядок із десятьма пробілами відступу
/// (рівень елемента списку під `strategy.matrix.package:`).
fn render_package_dirs_yaml(root_dirs: &[String]) -> String {
    root_dirs
        .iter()
        .map(|dir| format!("          - {dir}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Точний порт `renderStorybookWorkflow` (`fix-storybook-ci.mjs:52-58`):
/// РЯДОК-токен (з його провідними пробілами, без переносу) заміщається
/// згенерованою матрицею. JS робить це regex-ом
/// `^[ \t]*TOKEN[ \t]*$` із прапорцем `m`; тут — порядковий обхід, бо
/// `regex`-крейт без `multi_line` дав би інший матч, а вмикати його заради
/// одного патерна зайве. Семантика збігається: у шаблоні токен-рядок один
/// (звірено [`storybook_ci_workflow_token_line_is_unique`]).
fn render_storybook_workflow(root_dirs: &[String]) -> String {
    let matrix = render_package_dirs_yaml(root_dirs);
    let mut out: Vec<String> = Vec::new();
    let mut replaced = false;
    for line in STORYBOOK_WORKFLOW_TEMPLATE.split('\n') {
        let trimmed = line.trim_matches(|c| c == ' ' || c == '\t');
        if !replaced && trimmed == STORYBOOK_CI_PACKAGE_DIRS_TOKEN {
            out.push(matrix.clone());
            replaced = true;
        } else {
            out.push(line.to_string());
        }
    }
    out.join("\n")
}

/// fix-половина `test/storybook-ci` (§2.87) — порт
/// `fix-storybook-ci.mjs`, обидва патерни.
///
/// Скоуп бере `fix-glob` контрибуції (той самий список, що детект-глоб):
/// матриця `strategy.matrix.package` будується з ФАКТИЧНОГО списку пакетів
/// у скоупі, інакше CI покрив би не всі Storybook-пакети репозиторію.
/// Порожній список пакетів → workflow НЕ пишеться (порт гейта
/// `rootDirs.length === 0`), але composite action пишеться однаково — він
/// від скоупу не залежить.
fn fix_storybook_ci(request: &FixRequest) -> FixPlan {
    let has = |reason: &str| request.diagnostics.iter().any(|d| d.reason == reason);
    let mut edits = Vec::new();

    if has("missing-playwright-action") {
        edits.push(FileEdit::Write(WriteFile {
            path: PLAYWRIGHT_ACTION_REL.to_string(),
            content: PLAYWRIGHT_ACTION_TEMPLATE.to_string(),
        }));
    }

    if has("missing-storybook-workflow") {
        let root_dirs: Vec<String> = collect_in_scope_vue_packages(&request.files)
            .into_iter()
            .map(|p| p.root_dir)
            .collect();
        if !root_dirs.is_empty() {
            edits.push(FileEdit::Write(WriteFile {
                path: STORYBOOK_WORKFLOW_REL.to_string(),
                content: render_storybook_workflow(&root_dirs),
            }));
        }
    }

    FixPlan { edits }
}

/// Точний порт `hasFlatRootVueFiles` (`storybook-scaffold/main.mjs:94-101`)
/// у batch-просторі: НЕрекурсивно — лише `.vue` безпосередньо в корені
/// пакета.
fn has_flat_root_vue_files(files: &[SourceFile], root_dir: &str) -> bool {
    let prefix = pkg_rel_prefix(root_dir);
    files.iter().any(|f| {
        f.path.starts_with(&prefix)
            && f.path.ends_with(".vue")
            && !f.path[prefix.len()..].contains('/')
    })
}

/// Точний порт `detectStoriesGlob` (`storybook-scaffold/main.mjs:113-118`).
///
/// `existsSync(src/components)` стає [`batch_dir_exists`] — та сама
/// підміна, що вже зробив детект батчу 5, із тією ж задокументованою
/// мікро-розбіжністю: каталог, у якому НЕМАЄ жодного файлу під
/// `fix-glob`-ом, батчу невидимий. Заради саме цієї перевірки `fix-glob`
/// scaffold-а ШИРШИЙ за детект-глоб (`**/src/components/**`): детекту
/// вміст `src/components/` не потрібен, фіксу — потрібен. Це і є той
/// розрив скоупів, заради якого §2.84 додала поле.
fn detect_stories_glob(files: &[SourceFile], root_dir: &str) -> &'static str {
    if has_flat_root_vue_files(files, root_dir) {
        return "../*.stories.@(js|ts)";
    }
    if batch_dir_exists(files, &pkg_join(root_dir, "src/components")) {
        "../src/components/**/*.stories.@(js|ts)"
    } else {
        "../src/**/*.stories.@(js|ts)"
    }
}

/// Додає `Write`-правку, якщо шляху ще немає ні в плані, ні в батчі —
/// дзеркало `if (!existsSync(abs))`-гейтів JS-канону для супутніх файлів
/// (`mocks/gql-sse.js`, `empty-vite.config.js`), які НЕ мають затирати
/// наявний користувацький вміст.
fn push_write_if_absent(
    edits: &mut Vec<FileEdit>,
    files: &[SourceFile],
    path: String,
    content: &str,
) {
    if batch_file(files, &path).is_some() || edits.iter().any(|e| edit_path(e) == path) {
        return;
    }
    edits.push(FileEdit::Write(WriteFile {
        path,
        content: content.to_string(),
    }));
}

/// Додає безумовну `Write`-правку (канонічний файл відтворюється завжди),
/// але не дублює шлях, уже наявний у плані.
fn push_write(edits: &mut Vec<FileEdit>, path: String, content: String) {
    if edits.iter().any(|e| edit_path(e) == path) {
        return;
    }
    edits.push(FileEdit::Write(WriteFile { path, content }));
}

/// `package.json#scripts.storybook` → канонічне значення, зі збереженням
/// документного порядку ключів ([`TmJson::Object`] — `Vec<(String, Json)>`)
/// і форматуванням `JSON.stringify(pkg, null, 2) + '\n'` канону.
///
/// Полагоджений дефект канону: `JSON.parse` JS-фіксу валиться на
/// `package.json` із коментарями чи trailing-комою, і `catch { continue }`
/// мовчки пропускає пакет — концерн лишається червоним НАЗАВЖДИ, без
/// жодного сліду в виводі. Тут вхід читає [`parse_jsonc_document`] (той
/// самий JSONC-парсер, що §2.80 застосувала до `jsconfig.json`), тож
/// толерантний до коментарів вхід фіксується, а не тихо пропускається.
fn storybook_script_edit(source: &SourceFile) -> Option<FileEdit> {
    let TmJson::Object(mut root) = parse_jsonc_document(&source.content)? else {
        unreachable!("parse_jsonc_document повертає лише обʼєктний корінь")
    };
    let canonical = TmJson::Str(STORYBOOK_SCRIPT.to_string());

    // `pkg.scripts = pkg.scripts && typeof … === 'object' ? … : {}` канону:
    // не-обʼєктне `scripts` (рядок, масив, число) ЗАМІЩАЄТЬСЯ обʼєктом.
    let mut scripts: Vec<(String, TmJson)> = match root.iter().find(|(k, _)| k == "scripts") {
        Some((_, TmJson::Object(entries))) => entries.clone(),
        _ => Vec::new(),
    };
    if scripts
        .iter()
        .any(|(k, v)| k == "storybook" && *v == canonical)
    {
        return None;
    }
    // Наявний ключ оновлюється НА МІСЦІ (порядок ключів консюмера
    // зберігається), новий — дописується в хвіст, як `pkg.scripts.storybook =`
    // у JS.
    match scripts.iter_mut().find(|(k, _)| k == "storybook") {
        Some(entry) => entry.1 = canonical,
        None => scripts.push(("storybook".to_string(), canonical)),
    }
    match root.iter_mut().find(|(k, _)| k == "scripts") {
        Some(entry) => entry.1 = TmJson::Object(scripts),
        None => root.push(("scripts".to_string(), TmJson::Object(scripts))),
    }

    // [`json_to_pretty_string`] уже завершує вивід переносом — це і є
    // `JSON.stringify(pkg, null, 2) + '\n'` канону, другий `\n` тут був би
    // зайвим байтом і зламав би byte-exact parity.
    let content = json_to_pretty_string(&TmJson::Object(root));
    if content == source.content {
        return None;
    }
    Some(FileEdit::Write(WriteFile {
        path: source.path.clone(),
        content,
    }))
}

/// fix-половина `test/storybook-scaffold` (§2.87) — порт
/// `fix-storybook-scaffold.mjs`, усі сім патернів.
fn fix_storybook_scaffold(request: &FixRequest) -> FixPlan {
    let files = &request.files;
    let mut edits: Vec<FileEdit> = Vec::new();

    let roots_for = |reason: &str| -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for d in request.diagnostics.iter().filter(|d| d.reason == reason) {
            if let Some(root) = diagnostic_root_dir(d) {
                if !out.contains(&root) {
                    out.push(root);
                }
            }
        }
        out
    };

    // `storybook-scaffold-main-js` — main.js + супутні mocks/empty-vite.
    for root in roots_for("missing-main-js") {
        let content = SCAFFOLD_MAIN_JS_TEMPLATE.replace(
            STORYBOOK_STORIES_GLOB_TOKEN,
            detect_stories_glob(files, &root),
        );
        push_write(&mut edits, pkg_join(&root, ".storybook/main.js"), content);
        push_write_if_absent(
            &mut edits,
            files,
            pkg_join(&root, ".storybook/mocks/gql-sse.js"),
            SCAFFOLD_MOCKS_GQL_SSE_TEMPLATE,
        );
        push_write_if_absent(
            &mut edits,
            files,
            pkg_join(&root, ".storybook/empty-vite.config.js"),
            SCAFFOLD_EMPTY_VITE_CONFIG_TEMPLATE,
        );
    }

    // `storybook-scaffold-empty-vite-config` — окремий патерн для випадку
    // «main.js канонічний, видалено лише цей файл».
    for root in roots_for("missing-empty-vite-config") {
        push_write_if_absent(
            &mut edits,
            files,
            pkg_join(&root, ".storybook/empty-vite.config.js"),
            SCAFFOLD_EMPTY_VITE_CONFIG_TEMPLATE,
        );
    }

    // `storybook-scaffold-preview-js`.
    for root in roots_for("missing-preview-js") {
        push_write(
            &mut edits,
            pkg_join(&root, ".storybook/preview.js"),
            SCAFFOLD_PREVIEW_JS_TEMPLATE.to_string(),
        );
    }

    // `storybook-scaffold-app-main-js` (хвиля 2a).
    for root in roots_for("missing-app-main-js") {
        let content =
            SCAFFOLD_APP_MAIN_JS_TEMPLATE.replace(STORYBOOK_STORIES_GLOB_TOKEN, APP_STORIES_GLOB);
        push_write(&mut edits, pkg_join(&root, ".storybook/main.js"), content);
        push_write_if_absent(
            &mut edits,
            files,
            pkg_join(&root, ".storybook/mocks/gql-sse.js"),
            SCAFFOLD_MOCKS_GQL_SSE_TEMPLATE,
        );
    }

    // `storybook-scaffold-app-preview-js` (хвиля 2a).
    for root in roots_for("missing-app-preview-js") {
        push_write(
            &mut edits,
            pkg_join(&root, ".storybook/preview.js"),
            SCAFFOLD_APP_PREVIEW_JS_TEMPLATE.to_string(),
        );
    }

    // `storybook-scaffold-vitest-setup-js`.
    for root in roots_for("missing-vitest-setup-js") {
        push_write(
            &mut edits,
            pkg_join(&root, ".storybook/vitest.setup.js"),
            SCAFFOLD_VITEST_SETUP_TEMPLATE.to_string(),
        );
    }

    // `storybook-scaffold-package-script` — єдиний патерн, що РЕДАГУЄ
    // наявний файл, а не створює новий.
    for d in request
        .diagnostics
        .iter()
        .filter(|d| d.reason == "missing-storybook-script")
    {
        let Some(rel) = d.file.as_ref() else { continue };
        let Some(source) = batch_file(files, rel) else {
            continue;
        };
        if let Some(edit) = storybook_script_edit(source) {
            if !edits.iter().any(|e| edit_path(e) == edit_path(&edit)) {
                edits.push(edit);
            }
        }
    }

    FixPlan { edits }
}

/// Guest-реалізація world `plugin` — тридцять дев'ять контрибуцій ([`CONCERN_TFM`],
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
/// доккомент секції «Батч 9» вище; [`CONCERN_STRYKER_CONFIG`] — зріз 1
/// контракту v3.1, доккомент секції «Зріз 1» вище; [`CONCERN_JS_CHECK`] —
/// зріз 2, доккомент секції «Зріз 2» вище; [`CONCERN_DOC_COMMENTS`] — зріз 4,
/// ЄДИНИЙ (крім [`CONCERN_TFM`]) per-file концерн і другий після
/// [`CONCERN_NO_BUN_TEST_IMPORT`] із реальним `export fix`, доккомент секції
/// «Зріз 4» вище; [`CONCERN_BUN_LICENSEE`] — зріз 5, пілот `exec-tool`,
/// доккомент секції «Зріз 5» вище; [`CONCERN_STYLE_LINT`] і
/// [`CONCERN_JSCPD_DUPLICATES`] — зріз 6, решта обгорток зовнішніх процесів,
/// доккомент секції «Зріз 6» вище).
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
            CONCERN_STRYKER_CONFIG => {
                report_progress(total, total);
                detect_stryker_config(&batch.files)
            }
            CONCERN_JS_CHECK => {
                report_progress(total, total);
                detect_js_check(&batch.files)
            }
            // Зріз 5 контракту v3.1 — пілот `exec-tool` (доккомент секції
            // «Зріз 5»): єдиний концерн цього компонента, що спавнить
            // зовнішній процес.
            CONCERN_BUN_LICENSEE => {
                report_progress(total, total);
                detect_bun_licensee(&batch.files)
            }
            // Зріз 6 контракту v3.1 (доккомент секції «Зріз 6») — решта
            // обгорток зовнішніх процесів цього компонента.
            CONCERN_STYLE_LINT => {
                report_progress(total, total);
                detect_style_lint(&batch.files)
            }
            CONCERN_JSCPD_DUPLICATES => {
                report_progress(total, total);
                detect_jscpd_duplicates()
            }
            CONCERN_JS_RUN_RUNTIME => {
                report_progress(total, total);
                detect_js_run_runtime(&batch.files)
            }
            // §2.78 — шість rego-детектів на одному [`detect_policy`]
            // (host-import `rego-engine`, доккомент секції «§2.78»).
            key if policy_cfg(key).is_some() => {
                report_progress(total, total);
                detect_policy(
                    policy_cfg(key).expect("щойно перевірений guard"),
                    &batch.files,
                )
            }
            // PER-FILE (зріз 4): кожен файл — свій крок прогресу, як
            // дефолтна `CONCERN_TFM`-гілка нижче.
            CONCERN_DOC_COMMENTS => {
                let mut diagnostics = Vec::new();
                for (index, file) in batch.files.iter().enumerate() {
                    report_progress(index as u32 + 1, total);
                    diagnostics.extend(detect_doc_comments(std::slice::from_ref(file)));
                }
                diagnostics
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

    /// fix-контур contract v3: `test/no-bun-test-import` (пілот,
    /// [`fix_no_bun_test_import`] — Rust-порт видаленого
    /// `fix-no-bun-test-import.mjs`), `js/doc_comments` (зріз 4 контракту
    /// v3.1, [`fix_doc_comments`] — порт `fix-doc_comments.mjs`), `js/check`
    /// (доккомент секції «`js/check` — T0-фіксер ПОРТОВАНО»,
    /// [`fix_js_check`] — порт `fix-check.mjs`), `js-run/runtime`
    /// (доккомент біля [`fix_js_run_runtime`], порт `fix-runtime.mjs`) і
    /// `bun/layout` ([`fix_bun_layout`] — порт `fix-layout.mjs`, ПЕРШИЙ
    /// реальний споживач `FileEdit::Delete` на КАТАЛОГ у цьому крейті),
    /// `bun/licensee` ([`fix_bun_licensee`] — порт `fix-licensee.mjs`, усі
    /// три патерни) і `style/lint` ([`fix_style_lint`] — порт
    /// `fix-lint.mjs`, ПЕРШИЙ у цьому крейті фіксер класу exec-tool:
    /// порожній план, edits синтезує host-diff §2.64) — усі сім JS-канонів
    /// тут, на відміну від пілота, ЛИШАЮТЬСЯ як JS-fallback; решта
    /// концернів — порожній план («нічого не чинити», сумісна заглушка —
    /// доккомент `wit/world.wit` біля `export fix`).
    fn fix(request: FixRequest) -> FixPlan {
        match request.concern_id.as_str() {
            CONCERN_NO_BUN_TEST_IMPORT => fix_no_bun_test_import(&request),
            CONCERN_DOC_COMMENTS => fix_doc_comments(&request),
            CONCERN_JS_CHECK => fix_js_check(&request),
            CONCERN_JS_RUN_RUNTIME => fix_js_run_runtime(&request),
            CONCERN_BUN_LAYOUT => fix_bun_layout(&request),
            CONCERN_BUN_LICENSEE => fix_bun_licensee(&request),
            CONCERN_STYLE_LINT => fix_style_lint(&request),
            // §2.86 — ЄДИНИЙ концерн, чий ключ приходить сюди з
            // `fix_only_concerns`, а не з `concerns`: гість дає лише fix,
            // detect лишається за `main.mjs` (доккомент секції «§2.86»).
            CONCERN_JS_ESLINT => fix_js_eslint(&request),
            // §2.78: два `vscode_extensions`-концерни — рушій
            // `vscode-ext-add` (union рядків), чотири `package_json` —
            // рушій `createTemplateFixPattern` (deep-merge). Обидва
            // диспатчаться таблицями конфігів, не окремими гілками на
            // концерн.
            CONCERN_JS_VSCODE_EXTENSIONS | CONCERN_STYLE_VSCODE_EXTENSIONS => {
                match policy_cfg(request.concern_id.as_str()) {
                    Some(cfg) => vscode_extensions_fix(cfg, &request),
                    None => FixPlan { edits: vec![] },
                }
            }
            // §2.80: `js-run/jsconfig` — ВЛАСНИЙ рушій (масиви замінюються,
            // не мерджаться union-ом; доккомент [`jsconfig_merge_snippet`]),
            // `style/tooling` — три FS-патерни без policy-шару взагалі.
            CONCERN_JSCONFIG => jsconfig_fix(&request),
            CONCERN_STYLE_TOOLING => fix_style_tooling(&request),
            // §2.87: storybook-пара — обидва фікси рахують скоуп самі
            // ([`collect_in_scope_vue_packages`]) і живляться ЯВНИМ
            // `fix-glob` контрибуції (доккомент секції §2.87).
            CONCERN_STORYBOOK_CI => fix_storybook_ci(&request),
            CONCERN_STORYBOOK_SCAFFOLD => fix_storybook_scaffold(&request),
            key if template_fix_cfg(key).is_some() => match template_fix_cfg(key) {
                Some(cfg) => template_merge_fix(cfg, &request),
                None => FixPlan { edits: vec![] },
            },
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

    /// Регресія 2026-08-26: `lint --no-fix` репортив порушення на будь-якому
    /// дереві, включно з `origin/main`, бо доккоментар
    /// `wasm-plugin-parity-php.test.mjs` ЦИТУЄ правило разом із дужкою.
    /// Фрагмент нижче — скорочена копія того самого JSDoc.
    #[test]
    fn detect_no_process_chdir_passes_on_jsdoc_citation_with_paren() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "/**\n * Перша спроба обходила її `process.chdir(dir)` на час JS-виклику —\n              * і це прямо заборонено `npm/rules/test/main.mdc`.\n */\ntest(\"ok\", () => {})\n",
        )];
        assert!(detect_no_process_chdir(&files).is_empty());
    }

    #[test]
    fn detect_no_process_chdir_passes_on_line_comment_with_paren() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "// Заборонено: process.chdir(dir) — process-wide мутація.\ntest(\"ok\", () => {})\n",
        )];
        assert!(detect_no_process_chdir(&files).is_empty());
    }

    /// Фікстура, що ЗАПИСУЄ на диск тест із забороненим викликом (саме так
    /// влаштований parity-тест самого концерну), — не порушення: виклику в
    /// коді немає, є рядковий літерал.
    #[test]
    fn detect_no_process_chdir_passes_on_string_literal_fixture() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "await writeFile(join(dir, \"a.test.mjs\"), \"process.chdir('/tmp')\")\n",
        )];
        assert!(detect_no_process_chdir(&files).is_empty());
    }

    #[test]
    fn detect_no_process_chdir_passes_on_template_literal_fixture() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "const fixture = `test(\"bad\", () => { process.chdir(dir) })`\n",
        )];
        assert!(detect_no_process_chdir(&files).is_empty());
    }

    /// `chdir` в іншому обʼєкті — не `process.chdir`.
    #[test]
    fn detect_no_process_chdir_passes_on_foreign_object_chdir() {
        let files = vec![source("tests/foo.test.mjs", "shell.chdir(\"/tmp\")\n")];
        assert!(detect_no_process_chdir(&files).is_empty());
    }

    /// AST бачить те, чого порядковий regex не бачив зовсім.
    #[test]
    fn detect_no_process_chdir_flags_computed_member_call() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "process[\"chdir\"](\"/tmp\")\n",
        )];
        assert_eq!(detect_no_process_chdir(&files).len(), 1);
    }

    #[test]
    fn detect_no_process_chdir_flags_optional_chaining_call() {
        let files = vec![source("tests/foo.test.mjs", "process?.chdir(\"/tmp\")\n")];
        assert_eq!(detect_no_process_chdir(&files).len(), 1);
    }

    /// Дві діагностики на один рядок були б шумом — рахуємо РЯДКИ, як і
    /// порядковий скан до переїзду на AST.
    #[test]
    fn detect_no_process_chdir_reports_one_diagnostic_per_line() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "process.chdir(\"/tmp\"); process.chdir(\"/var\")\n",
        )];
        assert_eq!(detect_no_process_chdir(&files).len(), 1);
    }

    /// Непарсовний тест не мовчить — фолбек на regex (краще хибне
    /// спрацювання, ніж тиха діра).
    #[test]
    fn detect_no_process_chdir_falls_back_to_regex_on_syntax_error() {
        let files = vec![source(
            "tests/foo.test.mjs",
            "function broken( {\nprocess.chdir(\"/tmp\")\n",
        )];
        let diagnostics = detect_no_process_chdir(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].data.as_deref(), Some("{\"line\":2}"));
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

    /// `no-console-store-restore.test.mjs` — «порушення: console.error/warn =
    /// stub → exit 1»: метод-альтернація [`CONSOLE_ASSIGN_PATTERN`] не лише
    /// для `log`.
    #[test]
    fn detect_no_console_store_restore_flags_error_and_warn_assignment() {
        let err_assign = ["console.err", "or ="].join("");
        let warn_assign = ["console.wa", "rn ="].join("");
        assert_eq!(
            detect_no_console_store_restore(&[source(
                "tests/bad.test.mjs",
                &format!("{err_assign} () => {{}}\n"),
            )])
            .len(),
            1
        );
        assert_eq!(
            detect_no_console_store_restore(&[source(
                "tests/bad.test.mjs",
                &format!("{warn_assign} vi.fn()\n"),
            )])
            .len(),
            1
        );
    }

    /// `no-console-store-restore.test.mjs` — «vi.spyOn(...) не порушення» і
    /// «console.log(...) виклик (не присвоєння) не порушення»: обидва не
    /// матчать `console.<method> =` взагалі (не про негативний lookahead, а
    /// про відсутність символу `=` одразу після методу).
    #[test]
    fn detect_no_console_store_restore_ignores_spy_on_and_plain_call() {
        assert!(detect_no_console_store_restore(&[source(
            "tests/ok.test.mjs",
            "vi.spyOn(console, \"log\").mockReturnValue()\n",
        )])
        .is_empty());
        assert!(detect_no_console_store_restore(&[source(
            "tests/ok.test.mjs",
            "console.log(\"msg\")\nconsole.error(\"err\")\n",
        )])
        .is_empty());
    }

    /// `no-console-store-restore.test.mjs` — «кілька порушень у різних файлах
    /// — повідомляється кожне»: батч агрегує діагностики по ВСІХ файлах, не
    /// зупиняється на першому.
    #[test]
    fn detect_no_console_store_restore_flags_across_multiple_files() {
        let log_assign = ["console.lo", "g ="].join("");
        let err_assign = ["console.err", "or ="].join("");
        let files = vec![
            source("tests/a.test.mjs", &format!("{log_assign} fn1\n")),
            source("tests/b.test.mjs", &format!("{err_assign} fn2\n")),
        ];
        assert_eq!(detect_no_console_store_restore(&files).len(), 2);
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
            other => panic!("очікували write-edit, отримали {other:?}"),
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
            other => panic!("очікували write-edit, отримали {other:?}"),
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

    // Спільний [`find_sql_dynamic_list`] (bun-db і mssql) уже покритий
    // тестами bun-db-боку — тут перевіряємо САМЕ mssql-виклик і його
    // повідомлення (раніше жодного тесту не було, знахідка grepped
    // `findUnsafeMssqlDynamicSqlListInText` не мала прямого виклику з тестів).
    #[test]
    fn detect_mssql_deps_flags_join_dynamic_sql_list() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"t\",\"dependencies\":{\"mssql\":\"^12.5.0\"}}",
            ),
            source(
                "src/db.ts",
                "export async function findUsers(ids) {\n  return pool.request().query`SELECT * FROM users WHERE id IN (${ids.join(',')})`\n}\n",
            ),
        ];
        let diagnostics = detect_mssql_deps(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("динамічні списки через")
                && d.message.contains(".join(',')")));
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

    // Три сканери нижче ([`find_pg_format_shims`], [`find_pg_query_wrappers`],
    // [`find_json_stringify_before_jsonb`]) раніше не мали ЖОДНОГО прямого
    // `#[test]` (ні тут, ні у фікстурах parity-файлу) — знайдено grep-ом по
    // JS-оригіналах `findPgFormatShimDefinitionInText`/
    // `findPgFormatLikeQueryWrapperInText`/аналогу для `::jsonb` при
    // видаленні JS-фолбеку кластера `js/*`.

    #[test]
    fn detect_bun_db_safety_flags_pg_format_shim_function() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nfunction pgFormat(tpl, val) {\n  return tpl.replace('%L', val)\n}\nexport const f = pgFormat\n",
            ),
        ];
        let diagnostics = detect_bun_db_safety(&files);
        assert!(diagnostics.iter().any(
            |d| d.message.contains("pg-format-сумісний шим") && d.message.contains("pgFormat")
        ));
    }

    #[test]
    fn detect_bun_db_safety_flags_pg_format_quote_helper() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nfunction quoteLiteral(v) {\n  return `'${v}'`\n}\nexport const q = quoteLiteral\n",
            ),
        ];
        let diagnostics = detect_bun_db_safety(&files);
        assert!(diagnostics.iter().any(|d| d
            .message
            .contains("pg-format-специфічний escape-хелпер")
            && d.message.contains("quoteLiteral")));
    }

    #[test]
    fn detect_bun_db_safety_flags_pg_format_like_query_wrapper() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport const db = {\n  query(text, params) {\n    return sql.unsafe(text, params)\n  }\n}\n",
            ),
        ];
        let diagnostics = detect_bun_db_safety(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("query(text, params)-обгортка над")));
    }

    #[test]
    fn detect_bun_db_safety_flags_json_stringify_before_jsonb_cast() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport const q = obj => sql`INSERT INTO t (data) VALUES (${JSON.stringify(obj)}::jsonb)`\n",
            ),
        ];
        let diagnostics = detect_bun_db_safety(&files);
        assert!(diagnostics.iter().any(|d| d
            .message
            .contains("JSON.stringify(...) перед ::jsonb зайвий")));
    }

    #[test]
    fn detect_bun_db_safety_passes_json_stringify_without_jsonb_cast() {
        let files = vec![
            source("package.json", "{\"name\":\"t\"}"),
            source(
                "src/db.ts",
                "import { sql } from 'bun'\nexport const q = obj => sql`INSERT INTO t (data) VALUES (${JSON.stringify(obj)})`\n",
            ),
        ];
        assert!(!detect_bun_db_safety(&files).iter().any(|d| d
            .message
            .contains("JSON.stringify(...) перед ::jsonb зайвий")));
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

    // --- §2.87: fix-половина storybook-пари ---

    /// Діагностика, яку [`check_package_scaffold`] кладе разом із
    /// `data.rootDir`, — вхід обох fix-портів.
    fn scaffold_diag(reason: &str, file: &str, root_dir: &str) -> Diagnostic {
        Diagnostic {
            reason: reason.to_string(),
            message: String::new(),
            file: Some(file.to_string()),
            severity: Severity::Error,
            data: Some(serde_json::json!({ "rootDir": root_dir }).to_string()),
        }
    }

    fn sb_fix_request(concern: &str, files: Vec<SourceFile>, diagnostics: Vec<Diagnostic>) -> FixRequest {
        FixRequest {
            concern_id: concern.to_string(),
            files,
            diagnostics,
        }
    }

    fn sb_written<'a>(plan: &'a FixPlan, path: &str) -> Option<&'a str> {
        plan.edits.iter().find_map(|e| match e {
            FileEdit::Write(w) if w.path == path => Some(w.content.as_str()),
            _ => None,
        })
    }

    /// Токен матриці у шаблоні workflow-а — РІВНО один рядок; на цьому
    /// тримається порядковий (не regex-овий) порт `renderStorybookWorkflow`.
    #[test]
    fn storybook_ci_workflow_token_line_is_unique() {
        let hits = STORYBOOK_WORKFLOW_TEMPLATE
            .lines()
            .filter(|l| l.trim() == STORYBOOK_CI_PACKAGE_DIRS_TOKEN)
            .count();
        assert_eq!(hits, 1, "шаблон мусить містити рівно один токен-рядок");
    }

    /// Матриця `strategy.matrix.package` будується з ФАКТИЧНОГО списку
    /// пакетів у скоупі — саме заради цього fix-батч full-scope.
    #[test]
    fn fix_storybook_ci_renders_action_and_workflow_matrix() {
        let plan = fix_storybook_ci(&sb_fix_request(
            CONCERN_STORYBOOK_CI,
            vue_library_files(3),
            vec![
                Diagnostic {
                    reason: "missing-playwright-action".to_string(),
                    message: String::new(),
                    file: Some(PLAYWRIGHT_ACTION_REL.to_string()),
                    severity: Severity::Error,
                    data: None,
                },
                Diagnostic {
                    reason: "missing-storybook-workflow".to_string(),
                    message: String::new(),
                    file: Some(STORYBOOK_WORKFLOW_REL.to_string()),
                    severity: Severity::Error,
                    data: None,
                },
            ],
        ));

        assert_eq!(
            sb_written(&plan, PLAYWRIGHT_ACTION_REL),
            Some(PLAYWRIGHT_ACTION_TEMPLATE),
            "composite action — verbatim-копія шаблону"
        );
        let workflow = sb_written(&plan, STORYBOOK_WORKFLOW_REL).expect("workflow у плані");
        assert!(
            workflow.contains("          - packages/ui\n"),
            "матриця мусить містити пакет у скоупі:\n{workflow}"
        );
        assert!(!workflow.contains(STORYBOOK_CI_PACKAGE_DIRS_TOKEN));
    }

    /// Порт гейта `rootDirs.length === 0`: без пакетів у скоупі workflow НЕ
    /// пишеться (порожня матриця дала б невалідний YAML), але composite
    /// action — пишеться, він від скоупу не залежить.
    #[test]
    fn fix_storybook_ci_skips_workflow_without_packages_in_scope() {
        let plan = fix_storybook_ci(&sb_fix_request(
            CONCERN_STORYBOOK_CI,
            vec![source("package.json", "{\"name\":\"root\"}")],
            vec![Diagnostic {
                reason: "missing-storybook-workflow".to_string(),
                message: String::new(),
                file: Some(STORYBOOK_WORKFLOW_REL.to_string()),
                severity: Severity::Error,
                data: None,
            }],
        ));
        assert!(plan.edits.is_empty());
    }

    /// `main.js` бібліотеки: stories-глоб звужується до `src/components/`,
    /// а разом із ним створюються супутні `mocks/gql-sse.js` і
    /// `empty-vite.config.js` (без них щойно відтворений `main.js`
    /// неробочий).
    #[test]
    fn fix_storybook_scaffold_main_js_narrows_glob_and_adds_companions() {
        let plan = fix_storybook_scaffold(&sb_fix_request(
            CONCERN_STORYBOOK_SCAFFOLD,
            vue_library_files(3),
            vec![scaffold_diag(
                "missing-main-js",
                "packages/ui/.storybook/main.js",
                "packages/ui",
            )],
        ));

        let main_js = sb_written(&plan, "packages/ui/.storybook/main.js").expect("main.js у плані");
        assert!(main_js.contains("'../src/components/**/*.stories.@(js|ts)'"), "{main_js}");
        assert!(!main_js.contains(STORYBOOK_STORIES_GLOB_TOKEN));
        assert!(sb_written(&plan, "packages/ui/.storybook/mocks/gql-sse.js").is_some());
        assert!(sb_written(&plan, "packages/ui/.storybook/empty-vite.config.js").is_some());
    }

    /// Flat-root layout (пілотний консюмер `components/npm`): `.vue` лежать
    /// прямо в корені пакета — глоб інший.
    #[test]
    fn fix_storybook_scaffold_detects_flat_root_layout() {
        let mut files = vue_library_files(0);
        for i in 0..3 {
            files.push(source(
                &format!("packages/ui/N{i}.vue"),
                "<template><div/></template>\n",
            ));
        }
        let plan = fix_storybook_scaffold(&sb_fix_request(
            CONCERN_STORYBOOK_SCAFFOLD,
            files,
            vec![scaffold_diag(
                "missing-main-js",
                "packages/ui/.storybook/main.js",
                "packages/ui",
            )],
        ));
        let main_js = sb_written(&plan, "packages/ui/.storybook/main.js").expect("main.js у плані");
        assert!(main_js.contains("'../*.stories.@(js|ts)'"), "{main_js}");
    }

    /// Супутні файли НЕ затираються, якщо вже є в батчі — дзеркало
    /// `if (!existsSync(abs))` канону.
    #[test]
    fn fix_storybook_scaffold_keeps_existing_companions() {
        let mut files = vue_library_files(3);
        files.push(source(
            "packages/ui/.storybook/mocks/gql-sse.js",
            "// власний мок консюмера\n",
        ));
        let plan = fix_storybook_scaffold(&sb_fix_request(
            CONCERN_STORYBOOK_SCAFFOLD,
            files,
            vec![scaffold_diag(
                "missing-main-js",
                "packages/ui/.storybook/main.js",
                "packages/ui",
            )],
        ));
        assert!(sb_written(&plan, "packages/ui/.storybook/mocks/gql-sse.js").is_none());
    }

    /// `scripts.storybook` дописується зі збереженням документного порядку
    /// решти ключів і формату `JSON.stringify(pkg, null, 2) + '\n'`.
    #[test]
    fn fix_storybook_scaffold_sets_package_script() {
        let files = vec![source(
            "packages/ui/package.json",
            "{\n  \"name\": \"ui\",\n  \"scripts\": {\n    \"build\": \"vite build\"\n  }\n}\n",
        )];
        let plan = fix_storybook_scaffold(&sb_fix_request(
            CONCERN_STORYBOOK_SCAFFOLD,
            files,
            vec![scaffold_diag(
                "missing-storybook-script",
                "packages/ui/package.json",
                "packages/ui",
            )],
        ));
        assert_eq!(
            sb_written(&plan, "packages/ui/package.json"),
            Some(
                "{\n  \"name\": \"ui\",\n  \"scripts\": {\n    \"build\": \"vite build\",\n    \
                 \"storybook\": \"storybook dev -p 6006 --no-open\"\n  }\n}\n"
            )
        );
    }

    /// Полагоджений дефект канону: `package.json` із коментарями валив
    /// `JSON.parse` JS-фіксу, і `catch { continue }` МОВЧКИ пропускав пакет
    /// — концерн лишався червоним назавжди. Порт читає той самий вхід
    /// JSONC-парсером і таки фіксить.
    #[test]
    fn fix_storybook_scaffold_survives_jsonc_package_json() {
        let files = vec![source(
            "packages/ui/package.json",
            "{\n  // канонний коментар консюмера\n  \"name\": \"ui\"\n}\n",
        )];
        let plan = fix_storybook_scaffold(&sb_fix_request(
            CONCERN_STORYBOOK_SCAFFOLD,
            files,
            vec![scaffold_diag(
                "missing-storybook-script",
                "packages/ui/package.json",
                "packages/ui",
            )],
        ));
        let written_pkg = sb_written(&plan, "packages/ui/package.json").expect("фікс не мовчить");
        assert!(written_pkg.contains("\"storybook\": \"storybook dev -p 6006 --no-open\""));
    }

    /// Уже канонічний скрипт — жодної правки (гейт `=== STORYBOOK_SCRIPT`).
    #[test]
    fn fix_storybook_scaffold_noop_on_canonical_script() {
        let files = vec![source(
            "packages/ui/package.json",
            "{\n  \"name\": \"ui\",\n  \"scripts\": {\n    \"storybook\": \"storybook dev -p 6006 \
             --no-open\"\n  }\n}\n",
        )];
        let plan = fix_storybook_scaffold(&sb_fix_request(
            CONCERN_STORYBOOK_SCAFFOLD,
            files,
            vec![scaffold_diag(
                "missing-storybook-script",
                "packages/ui/package.json",
                "packages/ui",
            )],
        ));
        assert!(plan.edits.is_empty());
    }

    /// app-гілка (хвиля 2a): фіксований глоб, без layout-детекції.
    #[test]
    fn fix_storybook_scaffold_app_branch_uses_fixed_glob() {
        let plan = fix_storybook_scaffold(&sb_fix_request(
            CONCERN_STORYBOOK_SCAFFOLD,
            vue_library_files(3),
            vec![
                scaffold_diag(
                    "missing-app-main-js",
                    "packages/app/.storybook/main.js",
                    "packages/app",
                ),
                scaffold_diag(
                    "missing-app-preview-js",
                    "packages/app/.storybook/preview.js",
                    "packages/app",
                ),
            ],
        ));
        let main_js = sb_written(&plan, "packages/app/.storybook/main.js").expect("app main.js");
        assert!(main_js.contains(APP_STORIES_GLOB), "{main_js}");
        assert_eq!(
            sb_written(&plan, "packages/app/.storybook/preview.js"),
            Some(SCAFFOLD_APP_PREVIEW_JS_TEMPLATE)
        );
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

    /// «немає Vue component library пакетів у скоупі — без порушень»
    /// (`hygiene.test.mjs` — перший тест describe-блоку): порожній батч і
    /// батч, де жоден пакет не долає поріг `VUE_FILE_THRESHOLD`, обидва
    /// дають нуль діагностик через ранній `pkgs.is_empty()` guard.
    #[test]
    fn detect_storybook_hygiene_empty_scope_is_silent() {
        assert!(detect_storybook_hygiene(&[]).is_empty());
        // Пакет під порогом (2 < VUE_FILE_THRESHOLD) — теж поза скоупом.
        assert!(detect_storybook_hygiene(&vue_library_files(2)).is_empty());
    }

    /// «subpath-імпорт: pkg/sub звіряється за іменем пакета верхнього рівня»
    /// (`hygiene.test.mjs`) — звичайний (не scoped) пакет: `lodash/debounce`
    /// при задекларованому `lodash` не мусить давати undeclared-import,
    /// гілка `top_level_package_name` без `@`-префікса.
    #[test]
    fn detect_storybook_hygiene_declared_top_level_covers_plain_subpath_import() {
        let mut files = vec![
            source(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}",
            ),
            source(
                "packages/ui/package.json",
                "{\"name\":\"ui\",\"peerDependencies\":{\"vue\":\"^3.6.0\"},\"dependencies\":{\"lodash\":\"^4.17.21\"}}",
            ),
        ];
        files.push(source(
            "packages/ui/src/components/Debounced.vue",
            "<script setup>\nimport debounce from 'lodash/debounce'\n</script>\n",
        ));
        for i in 0..2 {
            files.push(source(
                &format!("packages/ui/src/components/Filler{i}.vue"),
                "<template><div/></template>\n",
            ));
        }
        assert!(detect_storybook_hygiene(&files).is_empty());
    }

    /// Хвиля 2a (app-пакети): свідомо ЛИШЕ `type: 'library'` проходить
    /// hygiene-перевірки (`main.mjs:235-246`) — app-пакет із тим самим
    /// undeclared-import і тими самими sass-variables-умовами, що дають
    /// порушення для library, тут не перевіряється взагалі (структурний
    /// `Kind::Library`-фільтр на початку [`detect_storybook_hygiene`]).
    #[test]
    fn detect_storybook_hygiene_skips_app_packages_entirely() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}",
            ),
            source(".n-rules.json", "{\"storybook\":{\"detectApps\":true}}"),
            source(
                "packages/demo/package.json",
                "{\"name\":\"demo\",\"dependencies\":{\"vue\":\"^3.6.0\"}}",
            ),
            // Той самий undeclared import, що дав би порушення для library.
            source(
                "packages/demo/src/pages/task/[id].vue",
                "<script setup>\nimport VueDatePicker from '@vuepic/vue-datepicker'\n</script>\n",
            ),
            source(
                "packages/demo/src/css/quasar.variables.scss",
                "$primary: #000;\n",
            ),
            // main.js без sassVariables-маркера — теж дав би warn для library.
            source(
                "packages/demo/.storybook/main.js",
                "export default { framework: '@storybook/vue3-vite' }\n",
            ),
        ];
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

    /// `page-coverage.test.mjs` — «немає app-пакетів у скоупі — без порушень»:
    /// ранній `pkgs.is_empty()` guard.
    #[test]
    fn detect_storybook_page_coverage_empty_scope_is_silent() {
        assert!(detect_storybook_page_coverage(&[]).is_empty());
    }

    /// `page-coverage.test.mjs` — «кілька сторінок — репортує лише ту, що без
    /// story»: story поряд з однією сторінкою НЕ приховує порушення для іншої.
    #[test]
    fn detect_storybook_page_coverage_reports_only_uncovered_page() {
        let mut files = app_pkg_files(true);
        files.push(source(
            "packages/demo/src/pages/Tasks.vue",
            "<template><div/></template>\n",
        ));
        let diagnostics = detect_storybook_page_coverage(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].file.as_deref(),
            Some("packages/demo/src/pages/Tasks.vue")
        );
    }

    /// `page-coverage.test.mjs` — «бібліотечний пакет (type library) не
    /// потрапляє в перевірку page-coverage»: [`ScopePkgKind::App`]-фільтр на
    /// початку [`detect_storybook_page_coverage`] структурно виключає library.
    #[test]
    fn detect_storybook_page_coverage_skips_library_packages() {
        assert!(detect_storybook_page_coverage(&vue_library_files(3)).is_empty());
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

    /// `scaffold.test.mjs` — «немає пакетів у скоупі — без порушень»: ранній
    /// `pkgs.is_empty()` guard.
    #[test]
    fn detect_storybook_scaffold_empty_scope_is_silent() {
        assert!(detect_storybook_scaffold(&[]).is_empty());
    }

    /// `scaffold.test.mjs` — «script неканонічний — лише
    /// missing-storybook-script»: усі канонічні файли присутні, лише
    /// `scripts.storybook` не збігається — жодного marker/missing-файл
    /// порушення, ЛИШЕ script.
    #[test]
    fn detect_storybook_scaffold_script_only_mismatch() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}",
            ),
            source(
                "packages/ui/package.json",
                "{\"name\":\"ui\",\"peerDependencies\":{\"vue\":\"^3.6.0\"},\"scripts\":{\"storybook\":\"storybook dev\"}}",
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
            source("packages/ui/src/components/Comp0.vue", "<template/>\n"),
            source("packages/ui/src/components/Comp1.vue", "<template/>\n"),
            source("packages/ui/src/components/Comp2.vue", "<template/>\n"),
        ];
        let diagnostics = detect_storybook_scaffold(&files);
        assert_eq!(
            diagnostics
                .iter()
                .map(|d| d.reason.as_str())
                .collect::<Vec<_>>(),
            vec!["missing-storybook-script"]
        );
    }

    /// `scaffold.test.mjs` — «vitest.setup.js без канонічних маркерів —
    /// marker-порушення, не missing»: обидва маркери [`VITEST_SETUP_JS_MARKERS`]
    /// відсутні → ДВІ окремі `vitest-setup-js-marker-missing` діагностики
    /// (`missingMarkers` повертає масив, `checkCanonFile` репортить кожен).
    #[test]
    fn detect_storybook_scaffold_vitest_setup_marker_missing_reports_each_marker() {
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
            source("packages/ui/.storybook/vitest.setup.js", "export default {}\n"),
        ];
        for i in 0..3 {
            files.push(source(
                &format!("packages/ui/src/components/Comp{i}.vue"),
                "<template><div/></template>\n",
            ));
        }
        let diagnostics = detect_storybook_scaffold(&files);
        assert_eq!(
            diagnostics
                .iter()
                .map(|d| d.reason.as_str())
                .collect::<Vec<_>>(),
            vec![
                "vitest-setup-js-marker-missing",
                "vitest-setup-js-marker-missing"
            ]
        );
    }

    /// `scaffold.test.mjs` — «app-пакет без .storybook/ — 4 порушення
    /// (app-main.js, app-preview.js, vitest.setup.js, script), БЕЗ
    /// empty-vite-config» (дзеркальна асиметрія app/library, `main.mjs:254-290`).
    #[test]
    fn detect_storybook_scaffold_app_reports_missing_files_without_empty_vite_config() {
        let diagnostics = detect_storybook_scaffold(&app_pkg_files(false));
        assert_eq!(
            diagnostics
                .iter()
                .map(|d| d.reason.as_str())
                .collect::<Vec<_>>(),
            vec![
                "missing-app-main-js",
                "missing-app-preview-js",
                "missing-vitest-setup-js",
                "missing-storybook-script",
            ]
        );
        assert!(!diagnostics
            .iter()
            .any(|d| d.reason.contains("empty-vite-config")));
    }

    /// `scaffold.test.mjs` — «app-пакет з канонічним app-main.js/app-preview.js/
    /// vitest.setup.js — без порушень».
    #[test]
    fn detect_storybook_scaffold_app_canonical_is_silent() {
        let files = vec![
            source(
                "package.json",
                "{\"name\":\"root\",\"workspaces\":[\"packages/*\"]}",
            ),
            source(".n-rules.json", "{\"storybook\":{\"detectApps\":true}}"),
            source(
                "packages/demo/package.json",
                "{\"name\":\"demo\",\"dependencies\":{\"vue\":\"^3.6.0\"},\"scripts\":{\"storybook\":\"storybook dev -p 6006 --no-open\"}}",
            ),
            source("packages/demo/src/pages/task/[id].vue", "<template/>"),
            source(
                "packages/demo/.storybook/main.js",
                "// @storybook/vue3-vite staticDirs viteFinal 'vite-plugin-vue-layouts' \
                 'vite-plugin-vue-layouts-next' 'unplugin-vue-router'\n",
            ),
            source(
                "packages/demo/.storybook/preview.js",
                "// msw-storybook-addon onUnhandledRequest mswLoader pageLoader createMemoryHistory \
                 QLayout QPageContainer\n",
            ),
            source(
                "packages/demo/.storybook/vitest.setup.js",
                "// setProjectAnnotations beforeAll\n",
            ),
        ];
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

    /// `ci.test.mjs` — «workflow без канонічних маркерів — marker-порушення,
    /// не missing»: канонічний action + неканонічний workflow → лише
    /// `storybook-workflow-marker-missing`.
    #[test]
    fn detect_storybook_ci_flags_workflow_marker_violations_only() {
        let mut files = vue_library_files(3);
        files.push(source(
            ".github/actions/setup-playwright-chromium/action.yml",
            "# ms-playwright кеш через actions/cache@v4 playwright install chromium\n",
        ));
        files.push(source(
            ".github/workflows/lint-storybook.yml",
            "name: Lint Storybook\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n",
        ));
        let diagnostics = detect_storybook_ci(&files);
        assert!(!diagnostics.is_empty());
        assert!(diagnostics
            .iter()
            .all(|d| d.reason == "storybook-workflow-marker-missing"));
    }

    /// `ci.test.mjs` — «повністю канонічний репо — без порушень».
    #[test]
    fn detect_storybook_ci_fully_canonical_repo_is_silent() {
        let mut files = vue_library_files(3);
        files.push(source(
            ".github/actions/setup-playwright-chromium/action.yml",
            "# ms-playwright кеш через actions/cache@v4 playwright install chromium\n",
        ));
        files.push(source(
            ".github/workflows/lint-storybook.yml",
            "# ./.github/actions/setup-bun-deps ./.github/actions/setup-playwright-chromium \
             vitest --project=storybook\n",
        ));
        assert!(detect_storybook_ci(&files).is_empty());
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

    /// `vitest-config.test.mjs` — «немає пакетів у скоупі — без порушень»:
    /// ранній `pkgs.is_empty()` guard.
    #[test]
    fn detect_storybook_vitest_config_empty_scope_is_silent() {
        assert!(detect_storybook_vitest_config(&[], None).is_empty());
    }

    /// `vitest-config.test.mjs` — «базовий vitest.config без projects —
    /// unit+storybook+stryker-config відсутні»: test-блок присутній, `projects`
    /// взагалі немає, stryker-файл теж відсутній — ТРИ причини одразу
    /// (`checkPackage` не зупиняється на ранньому return
    /// `checkVitestConfigContent`).
    #[test]
    fn detect_storybook_vitest_config_no_projects_field_reports_three_reasons() {
        let diagnostics = detect_storybook_vitest_config(
            &vitest_config_files(
                "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ \
                 test: { include: ['**/*.test.mjs'] } })\n",
                false,
            ),
            None,
        );
        let mut reasons: Vec<&str> = diagnostics.iter().map(|d| d.reason.as_str()).collect();
        reasons.sort_unstable();
        let mut expected = vec![
            "unit-project-missing",
            "storybook-project-missing",
            "stryker-config-missing",
        ];
        expected.sort_unstable();
        assert_eq!(reasons, expected);
    }

    /// `vitest-config.test.mjs` — «storybookTest({ configDir }) без явного
    /// include — валідний stories-маркер»: `hasStoriesMarker` приймає
    /// `STORYBOOK_TEST_CONFIG_DIR_RE` як альтернативу до `STORIES_RE`.
    #[test]
    fn detect_storybook_vitest_config_config_dir_without_include_is_valid_marker() {
        let diagnostics = detect_storybook_vitest_config(
            &vitest_config_files(
                "import { defineConfig } from 'vitest/config'\nimport { playwright } from \
                 '@vitest/browser-playwright'\nexport default defineConfig({ test: { projects: [{ \
                 name: 'unit' }, { name: 'storybook', plugins: [storybookTest({ configDir: \
                 join(dirName, '.storybook') })], test: { browser: { enabled: true, provider: \
                 playwright({}), instances: [{ browser: 'chromium' }] } } }] } })\n",
                true,
            ),
            None,
        );
        assert!(diagnostics.is_empty());
    }

    /// `vitest-config.test.mjs` — «provider: 'playwright' (застаріле рядкове
    /// API) — marker-порушення навіть з chromium/browser/stories»:
    /// [`PROVIDER_FACTORY_PATTERN`] вимагає саме factory-виклик
    /// `playwright(...)`, не рядок.
    #[test]
    fn detect_storybook_vitest_config_string_provider_is_marker_violation() {
        let diagnostics = detect_storybook_vitest_config(
            &vitest_config_files(
                "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ \
                 test: { projects: [{ name: 'unit' }, { name: 'storybook', test: { include: \
                 ['src/components/**/*.stories.@(js|ts)'], browser: { enabled: true, provider: \
                 'playwright', instances: [{ browser: 'chromium' }] } } }] } })\n",
                true,
            ),
            None,
        );
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "storybook-project-marker-missing");
        assert!(diagnostics[0].message.contains("provider-factory"));
    }

    /// `vitest-config.test.mjs` — «лише unit-проєкт наявний — тільки
    /// storybook-project-missing (+ stryker)»: `hasUnit` вже `true`, тож БЕЗ
    /// unit-project-missing.
    #[test]
    fn detect_storybook_vitest_config_only_unit_present_skips_unit_missing() {
        let diagnostics = detect_storybook_vitest_config(
            &vitest_config_files(
                "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ \
                 test: { projects: [{ extends: true, test: { name: 'unit' } }] } })\n",
                false,
            ),
            None,
        );
        let mut reasons: Vec<&str> = diagnostics.iter().map(|d| d.reason.as_str()).collect();
        reasons.sort_unstable();
        let mut expected = vec!["storybook-project-missing", "stryker-config-missing"];
        expected.sort_unstable();
        assert_eq!(reasons, expected);
    }

    /// App-пакет `packages/demo` у скоупі (detectApps) з переданим вмістом
    /// `vitest.config.mjs`.
    fn app_vitest_config_files(config: &str) -> Vec<SourceFile> {
        vec![
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
            source("packages/demo/vitest.config.mjs", config),
            source(
                "packages/demo/vitest.stryker.config.mjs",
                "export default {}\n",
            ),
        ]
    }

    /// `vitest-config.test.mjs` — «app-пакет: storybook-project без
    /// quasar/AutoImport/Pages — marker-порушення (хвиля 2a)».
    #[test]
    fn detect_storybook_vitest_config_app_without_wave2a_plugins_is_marker_violation() {
        let diagnostics = detect_storybook_vitest_config(
            &app_vitest_config_files(
                "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ \
                 test: { projects: [{ name: 'unit' }, { name: 'storybook', plugins: \
                 [storybookTest({ configDir: '.storybook' })], test: { include: \
                 ['src/**/*.stories.@(js|ts)'], browser: { enabled: true, provider: playwright(), \
                 instances: [{ browser: 'chromium' }] } } }] } })\n",
            ),
            None,
        );
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, "storybook-project-marker-missing");
        assert!(diagnostics[0].message.contains("quasar()"));
        assert!(diagnostics[0].message.contains("AutoImport()"));
        assert!(diagnostics[0].message.contains("Pages()"));
    }

    /// `vitest-config.test.mjs` — «app-пакет: storybook-project з
    /// quasar/AutoImport/Pages — без порушень».
    #[test]
    fn detect_storybook_vitest_config_app_with_wave2a_plugins_is_silent() {
        let diagnostics = detect_storybook_vitest_config(
            &app_vitest_config_files(
                "import { defineConfig } from 'vitest/config'\nexport default defineConfig({ \
                 test: { projects: [{ name: 'unit' }, { name: 'storybook', plugins: \
                 [storybookTest({ configDir: '.storybook' }), quasar({ sassVariables: true }), \
                 AutoImport({ imports: ['vue'] }), Pages()], test: { include: \
                 ['src/**/*.stories.@(js|ts)'], browser: { enabled: true, provider: playwright(), \
                 instances: [{ browser: 'chromium' }] } } }] } })\n",
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

    // --- зріз 1 контракту v3.1: `test/stryker_config` ---

    /// Мінімальний батч «js увімкнено, single-package репо».
    fn stryker_files(extra: Vec<SourceFile>) -> Vec<SourceFile> {
        let mut files = vec![
            source(".n-rules.json", r#"{"rules":["js","test"]}"#),
            source("package.json", "{}"),
        ];
        files.extend(extra);
        files
    }

    #[test]
    fn detect_stryker_config_is_silent_without_js_rule() {
        let files = vec![
            source(".n-rules.json", r#"{"rules":["test"]}"#),
            source("package.json", "{}"),
        ];
        assert!(detect_stryker_config(&files).is_empty());
    }

    #[test]
    fn detect_stryker_config_is_silent_when_js_rule_disabled() {
        let files = vec![
            source(
                ".n-rules.json",
                r#"{"rules":["js"],"disable-rules":["js"]}"#,
            ),
            source("package.json", "{}"),
        ];
        assert!(detect_stryker_config(&files).is_empty());
    }

    #[test]
    fn detect_stryker_config_is_silent_without_config_file() {
        // `readNRulesConfigLite` без файлу → `rules: []` → правило вимкнене.
        let files = vec![source("package.json", "{}")];
        assert!(detect_stryker_config(&files).is_empty());
    }

    #[test]
    fn detect_stryker_config_fatal_without_root_package_json() {
        let files = vec![source(".n-rules.json", r#"{"rules":["js"]}"#)];
        let diagnostics = detect_stryker_config(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, STRYKER_CONFIG_REASON);
        assert_eq!(
            diagnostics[0].message,
            "test: js enabled, але кореневий package.json не знайдено (test.mdc)"
        );
        assert_eq!(diagnostics[0].file, None);
    }

    #[test]
    fn detect_stryker_config_reports_baselines_and_gitignore_for_bare_repo() {
        let diagnostics = detect_stryker_config(&stryker_files(vec![]));
        // stryker.config.mjs, vitest.config.mjs, .gitignore — саме в цьому порядку.
        assert_eq!(diagnostics.len(), 3);
        assert_eq!(diagnostics[0].reason, STRYKER_CONFIG_MISSING_REASON);
        assert_eq!(diagnostics[0].file.as_deref(), Some("stryker.config.mjs"));
        assert_eq!(
            diagnostics[0].message,
            "stryker.config.mjs відсутній (stryker.config.mjs) — запусти `npx @7n/rules lint test` для canonical baseline (test.mdc)"
        );
        assert_eq!(diagnostics[1].file.as_deref(), Some("vitest.config.mjs"));
        assert_eq!(diagnostics[2].reason, STRYKER_GITIGNORE_MISSING_REASON);
        assert_eq!(
            diagnostics[2].message,
            ".gitignore: бракує тест-патернів (**/reports/stryker/, **/coverage/) — запусти `npx @7n/rules lint test` (test.mdc)"
        );
        assert_eq!(diagnostics[2].file, None);
    }

    #[test]
    fn detect_stryker_config_keeps_legacy_vitest_config_js_name() {
        let files = stryker_files(vec![source("vitest.config.js", "export default {}\n")]);
        let diagnostics = detect_stryker_config(&files);
        // vitest-дії немає (файл є), лишаються stryker + .gitignore.
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].file.as_deref(), Some("stryker.config.mjs"));
        assert_eq!(diagnostics[1].reason, STRYKER_GITIGNORE_MISSING_REASON);
    }

    #[test]
    fn detect_stryker_config_adds_vue_plugin_baseline_for_vue_root() {
        let files = stryker_files(vec![
            source("src/App.vue", "<template><div /></template>\n"),
            source(".gitignore", "**/reports/stryker/\n**/coverage/\n"),
        ]);
        let diagnostics = detect_stryker_config(&files);
        assert_eq!(diagnostics.len(), 3);
        assert_eq!(diagnostics[0].file.as_deref(), Some("stryker.config.mjs"));
        assert_eq!(
            diagnostics[1].file.as_deref(),
            Some("stryker-vue-macros-ignorer.mjs")
        );
        assert_eq!(diagnostics[2].file.as_deref(), Some("vitest.config.mjs"));
    }

    #[test]
    fn has_vue_files_skips_ignored_dirs() {
        let files = vec![
            source("src/node_modules/dep/A.vue", ""),
            source("src/dist/B.vue", ""),
            source("src/reports/C.vue", ""),
        ];
        assert!(!has_vue_files(&files, ""));
        let files = vec![source("src/pages/D.vue", "")];
        assert!(has_vue_files(&files, ""));
    }

    #[test]
    fn resolve_all_js_roots_expands_glob_workspaces_sorted() {
        let files = vec![
            source("package.json", r#"{"workspaces":["packages/*","npm"]}"#),
            source("packages/ui/package.json", "{}"),
            source("packages/app/package.json", "{}"),
            source("packages/app/node_modules/x/package.json", "{}"),
            source("npm/package.json", "{}"),
        ];
        assert_eq!(
            resolve_all_js_roots(&files),
            vec!["packages/app", "packages/ui", "npm"]
        );
    }

    #[test]
    fn resolve_all_js_roots_falls_back_to_repo_root() {
        // Немає `workspaces` → сам корінь; є, але жоден не резолвиться → теж корінь.
        assert_eq!(
            resolve_all_js_roots(&[source("package.json", "{}")]),
            vec![String::new()]
        );
        assert_eq!(
            resolve_all_js_roots(&[source("package.json", r#"{"workspaces":["apps/*"]}"#)]),
            vec![String::new()]
        );
        // Битий кореневий package.json — розбіжність 2 доккоменту секції.
        assert_eq!(
            resolve_all_js_roots(&[source("package.json", "{ not json")]),
            vec![String::new()]
        );
    }

    #[test]
    fn plan_vue_augment_appends_missing_entries_to_existing_arrays() {
        let files = vec![source(
            "stryker.config.mjs",
            "export default {\n  plugins: ['@stryker-mutator/vitest-runner'],\n  ignorers: []\n}\n",
        )];
        let content = plan_vue_augment(&files, "")
            .expect("augment можливий")
            .expect("є що дописати");
        assert_eq!(
            content,
            "export default {\n  plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs'],\n  ignorers: ['vue-macros']\n}\n"
        );
    }

    #[test]
    fn plan_vue_augment_creates_missing_properties_with_detected_indent() {
        let files = vec![source(
            "stryker.config.mjs",
            "export default {\n    testRunner: 'vitest'\n}\n",
        )];
        let content = plan_vue_augment(&files, "")
            .expect("augment можливий")
            .expect("є що дописати");
        assert_eq!(
            content,
            "export default {\n    testRunner: 'vitest',\n    plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs'],\n    ignorers: ['vue-macros']\n}\n"
        );
    }

    #[test]
    fn plan_vue_augment_is_noop_when_everything_registered() {
        let files = vec![source(
            "stryker.config.mjs",
            "export default {\n  plugins: ['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs'],\n  ignorers: ['vue-macros']\n}\n",
        )];
        assert!(plan_vue_augment(&files, "")
            .expect("augment можливий")
            .is_none());
    }

    #[test]
    fn plan_vue_augment_fails_on_non_literal_default_export() {
        let files = vec![source(
            "stryker.config.mjs",
            "export default defineConfig({ plugins: [] })\n",
        )];
        let message = plan_vue_augment(&files, "").expect_err("не object-literal");
        assert_eq!(
            message,
            "stryker.config.mjs has non-literal default export (stryker.config.mjs) — augment скіпнуто, \
             додай вручну plugins/ignorers згідно stryker.config.vue.baseline.mjs"
        );
    }

    #[test]
    fn plan_vue_augment_fails_on_dynamic_arrays() {
        let files = vec![source(
            "stryker.config.mjs",
            "export default {\n  plugins: [...base]\n}\n",
        )];
        let message = plan_vue_augment(&files, "").expect_err("spread — динамічний вираз");
        assert!(message.starts_with("stryker.config.mjs: plugins/ignorers — динамічний вираз"));
    }

    #[test]
    fn missing_gitignore_entries_trims_lines() {
        let files = vec![source(".gitignore", "  **/coverage/  \nnode_modules\n")];
        assert_eq!(
            missing_gitignore_entries(&files),
            vec!["**/reports/stryker/"]
        );
    }

    // --- зріз 2 контракту v3.1: `js/check` ---

    /// Анти-дрейф вшитого асета: `include_str!` вказує на ТОЙ САМИЙ файл, що
    /// читає JS-канон, і він лишається валідним JSON із очікуваними блоками.
    #[test]
    fn oxlint_canonical_asset_parses_and_keeps_key_order() {
        let canonical = parse_json_ordered(OXLINT_CANONICAL_JSON).expect("канон — валідний JSON");
        let keys: Vec<&str> = canonical
            .entries()
            .iter()
            .map(|(k, _)| k.as_str())
            .collect();
        // Документний порядок (НЕ алфавітний — саме він задає порядок
        // діагностик, доккомент секції «Зріз 2»).
        assert_eq!(keys.first(), Some(&"$schema"));
        assert!(keys.contains(&"rules"));
        assert!(keys.contains(&"jsPlugins"));
        assert!(keys.contains(&"ignorePatterns"));
        assert_ne!(keys, {
            let mut sorted = keys.clone();
            sorted.sort_unstable();
            sorted
        });
    }

    #[test]
    fn js_json_stringify_mirrors_json_stringify() {
        let value =
            parse_json_ordered(r#"{"b":1,"a":["x",{"n":null,"t":true}]}"#).expect("валідний");
        assert_eq!(
            js_json_stringify(&value),
            r#"{"b":1,"a":["x",{"n":null,"t":true}]}"#
        );
        assert_eq!(js_json_stringify_opt(None), "undefined");
    }

    #[test]
    fn detect_js_check_reports_everything_on_empty_repo() {
        let diagnostics = detect_js_check(&[]);
        let reasons: Vec<&str> = diagnostics.iter().map(|d| d.reason.as_str()).collect();
        assert_eq!(
            reasons,
            vec!["eslint-config-missing", "oxlintrc-missing", "knip-missing"]
        );
    }

    #[test]
    fn detect_js_check_reports_knip_missing_without_writing_anything() {
        // Регресія рішення Ґ: `knip.json` немає → СПОСТЕРЕЖУВАНЕ порушення
        // (до рефакторингу детектор мовчки створював файл і звітував pass).
        let files = vec![source("knip.json", "{}")];
        assert!(detect_js_check(&files)
            .iter()
            .all(|d| d.reason != KNIP_MISSING_REASON));
        assert!(detect_js_check(&[])
            .iter()
            .any(|d| d.reason == KNIP_MISSING_REASON));
    }

    #[test]
    fn detect_js_check_flags_vue_workspace_missing_from_get_config() {
        let files = vec![
            source(
                "eslint.config.js",
                "import { getConfig } from '@nitra/eslint-config'\nexport default [{ ignores: ['**/auto-imports.d.ts'] }, ...getConfig({ node: ['app'] })]\n",
            ),
            source("package.json", r#"{"workspaces":["app"]}"#),
            source("app/package.json", r#"{"dependencies":{"vue":"^3.6.0"}}"#),
            source(".oxlintrc.json", OXLINT_CANONICAL_JSON),
            source("knip.json", "{}"),
        ];
        let diagnostics = detect_js_check(&files);
        let vue = diagnostics
            .iter()
            .find(|d| d.reason == ESLINT_CONFIG_VUE_WORKSPACE_REASON)
            .expect("vue-воркспейс поза vue: [...]");
        assert!(vue.message.contains("воркспейс 'app' містить Vue-код"));
        // Канонічний `.oxlintrc.json` дрейфу не дає.
        assert!(diagnostics
            .iter()
            .all(|d| d.reason != OXLINTRC_DRIFT_REASON));
    }

    #[test]
    fn detect_js_check_engines_thresholds() {
        let files = vec![
            source("package.json", r#"{"workspaces":["a","b"]}"#),
            source(
                "a/package.json",
                r#"{"type":"module","engines":{"node":">=24","bun":">=1.4"}}"#,
            ),
            source(
                "b/package.json",
                r#"{"type":"commonjs","engines":{"node":">=22","bun":">=1.3"}}"#,
            ),
        ];
        let diagnostics = detect_js_check(&files);
        // Межа: "a/package.json" з engines.bun ">=1.4" — валідний, без bun-порушень.
        assert!(diagnostics.iter().all(|d| !(d
            .message
            .starts_with("a/package.json")
            && d.message.contains("engines.bun"))));
        let messages: Vec<String> = diagnostics
            .into_iter()
            .map(|d| d.message)
            .filter(|m| m.starts_with("b/package.json"))
            .collect();
        assert_eq!(
            messages,
            vec![
                "b/package.json: має містити \"type\": \"module\" (js.mdc)",
                "b/package.json: engines.node \">=22\" — має бути >=24",
                // Межа піднялась: ">=1.3" (колишній валідний поріг) тепер порушення.
                "b/package.json: engines.bun \">=1.3\" — має бути >=1.4",
            ]
        );
    }

    #[test]
    fn detect_js_check_oxlintrc_drift_message_keeps_json_stringify_form() {
        let mut cfg = parse_json_ordered(OXLINT_CANONICAL_JSON).expect("валідний");
        if let JsonOrdered::Object(entries) = &mut cfg {
            for (key, value) in entries.iter_mut() {
                if key == "rules" {
                    if let JsonOrdered::Object(rules) = value {
                        rules.retain(|(k, _)| k != "eqeqeq");
                    }
                }
            }
        }
        let files = vec![source(".oxlintrc.json", &js_json_stringify(&cfg))];
        let drift: Vec<String> = detect_js_check(&files)
            .into_iter()
            .filter(|d| d.reason == OXLINTRC_DRIFT_REASON)
            .map(|d| d.message)
            .collect();
        assert_eq!(
            drift,
            vec![
                ".oxlintrc.json: rules[\"eqeqeq\"] очікується [\"deny\",\"always\",{\"null\":\"ignore\"}], зараз undefined"
            ]
        );
    }

    // Дзеркало `check.test.mjs` «є eslint.config.mjs без getConfig → fail»
    // — прибрано разом з JS-фолбеком (видалення JS-детектора кластера
    // `js/*`), випадок переносимо сюди, щоб не втратити покриття.
    #[test]
    fn detect_js_check_flags_eslint_config_without_get_config() {
        let files = vec![source("eslint.config.mjs", "export default []\n")];
        let diagnostics = detect_js_check(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.reason == JS_CHECK_REASON && d.message.contains("getConfig")));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("@nitra/eslint-config")));
    }

    // Дзеркало `check.test.mjs` «невалідний JSON у .oxlintrc.json → fail».
    #[test]
    fn detect_js_check_flags_invalid_oxlintrc_json() {
        let files = vec![source(".oxlintrc.json", "{ invalid json ]")];
        let diagnostics = detect_js_check(&files);
        assert!(diagnostics.iter().any(
            |d| d.reason == JS_CHECK_REASON && d.message == ".oxlintrc.json не є валідним JSON"
        ));
        // Розбіжність-drift не звітується — розбір взагалі не дійшов до порівняння.
        assert!(diagnostics
            .iter()
            .all(|d| d.reason != OXLINTRC_DRIFT_REASON));
    }

    // Дзеркало `check.test.mjs` «lint.yml з дубльованими кроками
    // oxlint+eslint+jscpd → fail» і «lint.yml існує, але не дублює lint-js
    // → pass для lint.yml».
    #[test]
    fn detect_js_check_flags_duplicate_lint_yml_steps() {
        let dup = vec![source(
            ".github/workflows/lint.yml",
            "steps:\n  - run: bunx oxlint .\n  - run: bunx eslint .\n  - run: jscpd .\n",
        )];
        assert!(detect_js_check(&dup)
            .iter()
            .any(|d| d.reason == JS_CHECK_REASON
                && d.message
                    .contains(".github/workflows/lint.yml дублює кроки lint-js.yml")));

        let clean = vec![source(
            ".github/workflows/lint.yml",
            "steps:\n  - run: echo hello\n",
        )];
        assert!(detect_js_check(&clean)
            .iter()
            .all(|d| !d.message.contains("дублює кроки lint-js.yml")));
    }

    // Дзеркало `wasm-plugin-parity.test.mjs` «vue-воркспейс (за `.vue`-файлом,
    // glob-патерн workspaces)» і «`.vue` під `dist/` не робить воркспейс
    // vue-воркспейсом» — `expand_workspaces`/`is_vue_workspace` досі не мали
    // прямого `#[test]` через `detect_js_check` (лише непрямо, через
    // фіксований `workspaces: ["app"]` в іншому тесті).
    #[test]
    fn detect_js_check_expands_glob_workspaces_and_ignores_vue_under_dist() {
        let files = vec![
            source(
                "eslint.config.js",
                "import { getConfig } from '@nitra/eslint-config'\nexport default [{ ignores: ['**/auto-imports.d.ts'] }, ...getConfig({ node: ['packages/ui'] })]\n",
            ),
            source("package.json", r#"{"workspaces":["packages/*"]}"#),
            source(
                "packages/ui/package.json",
                r#"{"type":"module","engines":{"node":">=24","bun":">=1.4"}}"#,
            ),
            source("packages/ui/src/Widget.vue", "<template><div /></template>\n"),
            // `dist/` — навіть під vue-воркспейсом не рахується (`is_vue_workspace`).
            source("packages/ui/dist/Bundled.vue", "<template><div /></template>\n"),
            source(".oxlintrc.json", OXLINT_CANONICAL_JSON),
            source("knip.json", "{}"),
        ];
        let diagnostics = detect_js_check(&files);
        let vue = diagnostics
            .iter()
            .find(|d| d.reason == ESLINT_CONFIG_VUE_WORKSPACE_REASON)
            .expect("glob-розгорнутий packages/ui — vue-воркспейс поза vue: [...]");
        assert!(vue
            .message
            .contains("воркспейс 'packages/ui' містить Vue-код"));
    }

    // Дзеркало «`.oxlintrc.json` із вилученими jsPlugins/ignorePatterns —
    // порядок повідомлень за порядком ключів канону» (jsPlugins ПЕРЕД
    // ignorePatterns у каноні).
    #[test]
    fn detect_js_check_oxlintrc_drift_orders_js_plugins_before_ignore_patterns() {
        let mut cfg = parse_json_ordered(OXLINT_CANONICAL_JSON).expect("валідний");
        if let JsonOrdered::Object(entries) = &mut cfg {
            for (key, value) in entries.iter_mut() {
                if key == "jsPlugins" || key == "ignorePatterns" {
                    *value = JsonOrdered::Array(Vec::new());
                }
            }
        }
        let files = vec![source(".oxlintrc.json", &js_json_stringify(&cfg))];
        let drift: Vec<String> = detect_js_check(&files)
            .into_iter()
            .filter(|d| d.reason == OXLINTRC_DRIFT_REASON)
            .map(|d| d.message)
            .collect();
        assert_eq!(drift.len(), 2);
        assert!(drift[0].contains("jsPlugins має містити канонічні plugins"));
        assert!(drift[1].contains("ignorePatterns має містити канонічні патерни"));
    }

    // Дзеркало «застарілі конфіги ESLint — по одному порушенню на кожен, у
    // фіксованому порядку» — `LEGACY_ESLINT_CONFIGS`-цикл раніше не мав
    // прямого тесту з ДВОМА одночасними легасі-файлами.
    #[test]
    fn detect_js_check_flags_multiple_legacy_eslint_configs_in_order() {
        let files = vec![
            source(".eslintrc", "{}"),
            source(".eslintrc.yml", "root: true\n"),
        ];
        let messages: Vec<String> = detect_js_check(&files)
            .into_iter()
            .map(|d| d.message)
            .filter(|m| m.contains("застарілий конфіг ESLint"))
            .collect();
        assert_eq!(
            messages,
            vec![
                "Знайдено застарілий конфіг ESLint: .eslintrc — видали, використовуй flat config",
                "Знайдено застарілий конфіг ESLint: .eslintrc.yml — видали, використовуй flat config",
            ]
        );
    }

    // --- js/check: T0-фіксер (доккомент секції «`js/check` — T0-фіксер
    // ПОРТОВАНО»), дзеркало трьох патернів `fix-check.mjs` ---

    /// Діагностики реально віддає [`detect_js_check`] — той самий мотив, що
    /// [`fix_request_for`] для `no-bun-test-import` вище.
    fn js_check_fix_request(files: Vec<SourceFile>) -> FixRequest {
        let diagnostics = detect_js_check(&files);
        FixRequest {
            concern_id: CONCERN_JS_CHECK.to_string(),
            files,
            diagnostics,
        }
    }

    /// Вміст `.oxlintrc.json` конкретного write-edit у плані (панікує, якщо
    /// його немає).
    fn oxlintrc_write_content(plan: &FixPlan) -> &str {
        plan.edits
            .iter()
            .find_map(|edit| match edit {
                FileEdit::Write(write) if write.path == ".oxlintrc.json" => Some(write.content.as_str()),
                _ => None,
            })
            .expect(".oxlintrc.json write-edit відсутній у плані")
    }

    /// Доказ парності «детект → фікс → повторний детект чисто» —
    /// гість-only раунд-трип на порожньому репо: усі три патерни
    /// спрацьовують одночасно (`eslint-config-missing`, `oxlintrc-missing`,
    /// `knip-missing`), застосований план задовольняє повторний детект.
    #[test]
    fn fix_js_check_round_trip_with_detect_is_clean() {
        let before: Vec<SourceFile> = vec![];
        let diagnostics_before = detect_js_check(&before);
        assert_eq!(
            diagnostics_before.iter().map(|d| d.reason.as_str()).collect::<Vec<_>>(),
            vec!["eslint-config-missing", "oxlintrc-missing", "knip-missing"]
        );

        let plan = fix_js_check(&FixRequest {
            concern_id: CONCERN_JS_CHECK.to_string(),
            files: before.clone(),
            diagnostics: diagnostics_before,
        });
        assert_eq!(plan.edits.len(), 3);

        // Симуляція застосування host-ом: кожен write-edit додається в батч.
        let mut after = before;
        for edit in &plan.edits {
            let FileEdit::Write(write) = edit else {
                panic!("js/check не видаляє файлів")
            };
            after.push(source(&write.path, &write.content));
        }
        // Root package.json з жодним workspaces-полем не потрібен для
        // "node: ['.']" сценарію (детектор вважає корінь єдиним воркспейсом),
        // тож повторний детект на `after` має бути повністю чистим.
        assert!(
            detect_js_check(&after).is_empty(),
            "план не задовольнив повторний детект: {:?}",
            detect_js_check(&after)
        );
    }

    /// Порожній `.oxlintrc.json` (файл відсутній) — T0 копіює канон один в
    /// один: [`plan_oxlintrc_fix`] на `actual = None` дає структурно ТОЙ
    /// САМИЙ обʼєкт, що й сам канон (задовольняє
    /// [`verify_oxlintrc_against_canonical`] — доказ того, що фікс і verify
    /// дзеркалять те саме дерево рішень, доккомент секції).
    #[test]
    fn fix_js_check_missing_oxlintrc_copies_canonical_and_passes_own_verify() {
        let files = vec![source("knip.json", "{}"), source("eslint.config.js", "x")];
        let plan = js_check_fix_request(files);
        let result = fix_js_check(&plan);
        let content = oxlintrc_write_content(&result);
        let written = parse_json_ordered(content).expect("вшитий T0-запис — валідний JSON");
        let canonical = parse_json_ordered(OXLINT_CANONICAL_JSON).expect("канон — валідний JSON");
        assert!(verify_oxlintrc_against_canonical(&written, &canonical).is_empty());
        // `JSON.stringify(merged, null, 2)` завершується `\n` (`fix-check.mjs:85`).
        assert!(content.ends_with('\n'));
    }

    /// ГОЛОВНИЙ тест duplication-твердження звіту порту: `.oxlintrc.json` із
    /// вирізаним правилом і зайвим project-specific ключем — T0-merge
    /// [`plan_oxlintrc_fix`] заповнює прогалину, зберігає зайве, і
    /// РЕЗУЛЬТАТ проходить [`verify_oxlintrc_against_canonical`] БЕЗ жодної
    /// додаткової синхронізації між ними — саме тому вони описані як
    /// дзеркальна пара, а не дві незалежні реалізації.
    #[test]
    fn fix_js_check_oxlintrc_drift_merge_satisfies_own_verify_and_keeps_extra_rule() {
        let mut cfg = parse_json_ordered(OXLINT_CANONICAL_JSON).expect("валідний");
        if let JsonOrdered::Object(entries) = &mut cfg {
            for (key, value) in entries.iter_mut() {
                if key == "rules" {
                    if let JsonOrdered::Object(rules) = value {
                        rules.retain(|(k, _)| k != "eqeqeq");
                        rules.push((
                            "project-specific/no-foo".to_string(),
                            JsonOrdered::Str("error".to_string()),
                        ));
                    }
                }
            }
        }
        let files = vec![
            source(".oxlintrc.json", &js_json_stringify(&cfg)),
            source("knip.json", "{}"),
            source("eslint.config.js", "x"),
        ];
        let request = js_check_fix_request(files);
        assert!(request
            .diagnostics
            .iter()
            .any(|d| d.reason == OXLINTRC_DRIFT_REASON));

        let plan = fix_js_check(&request);
        let content = oxlintrc_write_content(&plan);
        let written = parse_json_ordered(content).expect("валідний JSON");
        let canonical = parse_json_ordered(OXLINT_CANONICAL_JSON).expect("канон валідний");

        // T0-merge задовольняє ТОЙ САМИЙ verify, що видав diagnostics-drift.
        assert!(verify_oxlintrc_against_canonical(&written, &canonical).is_empty());
        // Project-specific розширення не видалене.
        let rules = written.get("rules").expect("rules присутнє");
        assert!(rules.get("project-specific/no-foo").is_some());
    }

    /// `.oxlintrc.json` уже канонічний — [`plan_oxlintrc_fix`] повертає
    /// СТРУКТУРНО ідентичний обʼєкт (порожній diff), не порожній план: на
    /// відміну від `planEslintConfigFix`, у JS-каноні немає гілки
    /// «нічого не робити» для oxlintrc-патерна — T0 завжди пише файл, коли
    /// `oxlintrc-missing`/`oxlintrc-drift` присутні серед діагностик.
    #[test]
    fn fix_js_check_canonical_oxlintrc_merge_is_a_no_op_rewrite() {
        let canonical_content = OXLINT_CANONICAL_JSON;
        let files = vec![
            source(".oxlintrc.json", canonical_content),
            source("knip.json", "{}"),
            source("eslint.config.js", "x"),
        ];
        // Канонічний файл не дає жодного drift — тест перевіряє напряму
        // виклик [`plan_oxlintrc_fix`], не проходить через `test()`-гейт.
        let canonical = parse_json_ordered(OXLINT_CANONICAL_JSON).expect("валідний");
        let merged = plan_oxlintrc_fix(Some(&canonical), &canonical);
        assert!(verify_oxlintrc_against_canonical(&merged, &canonical).is_empty());
        assert!(detect_js_check(&files)
            .iter()
            .all(|d| d.reason != OXLINTRC_DRIFT_REASON));
    }

    /// Відсутній `eslint.config.{js,mjs}` без workspaces — scaffold з
    /// `node: ['.']` (корінь — єдиний non-vue воркспейс).
    #[test]
    fn fix_js_check_scaffolds_eslint_config_for_plain_root() {
        let files = vec![source(".oxlintrc.json", OXLINT_CANONICAL_JSON), source("knip.json", "{}")];
        let plan = fix_js_check(&js_check_fix_request(files));
        let write = plan
            .edits
            .iter()
            .find_map(|e| match e {
                FileEdit::Write(w) if w.path == "eslint.config.js" => Some(w),
                _ => None,
            })
            .expect("eslint.config.js write-edit відсутній");
        assert!(write.content.contains("import { getConfig } from '@nitra/eslint-config'"));
        assert!(write.content.contains("node: ['.']"));
        assert!(!write.content.contains("vue:"));
        assert!(write.content.contains("ignores: ['**/auto-imports.d.ts']"));
    }

    /// Vue-воркспейс поза `vue: [...]` — T0 хірургічно дописує запис, решта
    /// файлу (кастомний коментар) недоторкана.
    #[test]
    fn fix_js_check_merges_missing_vue_workspace_into_existing_config() {
        let files = vec![
            source(
                "eslint.config.js",
                "// custom header comment\nimport { getConfig } from '@nitra/eslint-config'\nexport default [\n  { ignores: ['**/auto-imports.d.ts'] },\n  ...getConfig({\n    node: ['app']\n  })\n]\n",
            ),
            source("package.json", r#"{"workspaces":["app"]}"#),
            source("app/package.json", r#"{"dependencies":{"vue":"^3.6.0"}}"#),
            source(".oxlintrc.json", OXLINT_CANONICAL_JSON),
            source("knip.json", "{}"),
        ];
        let request = js_check_fix_request(files);
        assert!(request
            .diagnostics
            .iter()
            .any(|d| d.reason == ESLINT_CONFIG_VUE_WORKSPACE_REASON));
        let plan = fix_js_check(&request);
        let write = plan
            .edits
            .iter()
            .find_map(|e| match e {
                FileEdit::Write(w) if w.path == "eslint.config.js" => Some(w),
                _ => None,
            })
            .expect("eslint.config.js write-edit відсутній");
        assert!(write.content.contains("// custom header comment"));
        assert!(write.content.contains("vue: ['app']"));
        // `app` вилучено зі списку `node`.
        assert!(!write.content.contains("node: ['app']"));
    }

    /// Ідемпотентність: узгоджений `eslint.config.js` (getConfig +
    /// @nitra/eslint-config + ignores + жоден vue-воркспейс поза списком) —
    /// жодного `eslint.config.js` write-edit у плані, навіть якщо ІНШІ
    /// патерни (тут — `oxlintrc-missing`) все ще спрацьовують.
    #[test]
    fn fix_js_check_leaves_consistent_eslint_config_untouched() {
        let files = vec![
            source(
                "eslint.config.js",
                "import { getConfig } from '@nitra/eslint-config'\nexport default [{ ignores: ['**/auto-imports.d.ts'] }, ...getConfig({ node: ['.'] })]\n",
            ),
            source("knip.json", "{}"),
        ];
        let request = js_check_fix_request(files);
        assert!(request.diagnostics.iter().any(|d| d.reason == OXLINTRC_MISSING_REASON));
        let plan = fix_js_check(&request);
        assert!(plan
            .edits
            .iter()
            .all(|e| !matches!(e, FileEdit::Write(w) if w.path == "eslint.config.js")));
        // …а `oxlintrc-missing` усе одно фіксується — патерни незалежні.
        assert!(plan
            .edits
            .iter()
            .any(|e| matches!(e, FileEdit::Write(w) if w.path == ".oxlintrc.json")));
    }

    /// `knip.json` відсутній — T0 копіює вшитий канон байт-у-байт (те саме,
    /// що `copyFile` у JS-каноні).
    #[test]
    fn fix_js_check_copies_knip_canonical_when_missing() {
        let files = vec![source(".oxlintrc.json", OXLINT_CANONICAL_JSON), source("eslint.config.js", "x")];
        let plan = fix_js_check(&js_check_fix_request(files));
        let write = plan
            .edits
            .iter()
            .find_map(|e| match e {
                FileEdit::Write(w) if w.path == "knip.json" => Some(w),
                _ => None,
            })
            .expect("knip.json write-edit відсутній");
        assert_eq!(write.content, KNIP_CANONICAL_JSON);
    }

    /// Ідемпотентність `js-check-knip` (доккомент `fix-check.mjs:101-103`):
    /// `knip.json` уже присутній у батчі (паралельний фіксер/попередній
    /// прогін) — план НЕ перезаписує чужий вміст, навіть якщо діагностика
    /// (застаріла) все ще в запиті.
    #[test]
    fn fix_js_check_does_not_overwrite_existing_knip_json() {
        let files = vec![
            source(".oxlintrc.json", OXLINT_CANONICAL_JSON),
            source("eslint.config.js", "x"),
            source("knip.json", "{\"custom\":true}"),
        ];
        // `detect_js_check` на цьому батчі вже не видасть `knip-missing`
        // (файл присутній) — тест емулює «застарілу» діагностику явно, щоб
        // перевірити ІДЕМПОТЕНТНІСТЬ фіксера окремо від детектора.
        let request = FixRequest {
            concern_id: CONCERN_JS_CHECK.to_string(),
            files,
            diagnostics: vec![js_check_diagnostic(KNIP_MISSING_REASON, "стала діагностика".to_string())],
        };
        let plan = fix_js_check(&request);
        assert!(plan
            .edits
            .iter()
            .all(|e| !matches!(e, FileEdit::Write(w) if w.path == "knip.json")));
    }

    /// Анти-дрейф-гейт для [`KNIP_CANONICAL_JSON`] (доккомент секції «`js/check`
    /// — T0-фіксер ПОРТОВАНО»): читає канонічний файл-джерело НЕЗАЛЕЖНО від
    /// `include_str!`-шляху (через `CARGO_MANIFEST_DIR`) і звіряє байт-у-байт
    /// із вшитою константою — той самий шаблон, що
    /// `embedded_cargo_mutants_baseline_matches_canonical_source_file`
    /// (`crates/plugin-lang-rust/src/lib.rs`, PR #508).
    #[test]
    fn embedded_knip_canonical_matches_source_file() {
        let canonical_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../plugins/lang-js/rules/js/tooling/data/tooling/knip-canonical.json",
        );
        let on_disk = std::fs::read_to_string(&canonical_path).unwrap_or_else(|err| {
            panic!("не вдалось прочитати канонічний knip-canonical.json {canonical_path:?}: {err}")
        });
        assert_eq!(
            KNIP_CANONICAL_JSON, on_disk,
            "вшитий `include_str!`-вміст розійшовся з канонічним файлом-джерелом \
             {canonical_path:?} — JS-фіксер (`fix-check.mjs`, `KNIP_CANONICAL_JSON_PATH`) \
             і гість мають вшивати/читати ІДЕНТИЧНИЙ канон"
        );
    }

    /// [`js_json_stringify_pretty`] — дзеркало `JSON.stringify(v, null, 2)`:
    /// вкладені обʼєкт/масив з відступом 2 проб./рівень, порожні — без
    /// переносу рядка.
    #[test]
    fn js_json_stringify_pretty_mirrors_json_stringify_with_indent() {
        let value = parse_json_ordered(r#"{"b":1,"a":["x",{"n":null,"empty":{},"list":[]}]}"#)
            .expect("валідний");
        assert_eq!(
            js_json_stringify_pretty(&value, 0),
            "{\n  \"b\": 1,\n  \"a\": [\n    \"x\",\n    {\n      \"n\": null,\n      \"empty\": {},\n      \"list\": []\n    }\n  ]\n}"
        );
    }

    // --- js-run/runtime (доповнення при звірці покриття перед видаленням
    // JS-фолбеку кластера `js/*`) ---
    //
    // `detect_js_run_runtime` не мала ЖОДНОГО прямого `#[test]` тут —
    // покриття було виключно інтеграційне (18 сценаріїв колишньої
    // parity-фікстури `wasm-plugin-parity.test.mjs`, перетвореної на
    // wasm-регресію, + 5 edge-case-тестів
    // `crates/rules-plugin-host/tests/plugin_lang_js.rs`). Тести нижче
    // закривають частину додаткових сценаріїв із семи видалених
    // `plugins/lang-js/rules/js-run/runtime/tests/*.test.mjs`, які НЕ
    // дублюють уже наявне покриття: side-effect bunyan-імпорт і дозволений
    // `@nitra/pino`, специфічні db-conn-імена (mssql-read, невалідний
    // префікс, kebab→camel багатосегментний), Temporal у формі імпорту.
    // Решта дрібних сценаріїв цих семи файлів (варіанти форм
    // Promise+setTimeout, `resolveConnDirFromPackageJson`, комп'ютед-ключі
    // `process.env[...]`) СВІДОМО не продубльована — ті самі чисті функції
    // (`function_like_parts`, `single_call_expression`) уже покриті іншими
    // тестами через спільний код, регресія в форму НЕ вносить нову гілку.

    /// Мінімальний workspace-батч (root `package.json` з `workspaces: ["api"]`
    /// разом з `api/package.json`) — той самий мотив, що JS-фікстура
    /// `writeWorkspaceRoot` колишнього parity-файлу. `api_pkg_extra` — сирі
    /// поля, що домішуються у `api/package.json` (напр.
    /// `"imports":{"#conn/*":"./lib/conn/*"}` — без цього connDir падає на
    /// дефолтний `src/conn`, доккомент [`CONN_DIR_FALLBACK`]).
    fn js_run_workspace_files(
        api_pkg_extra: &str,
        api_file_path: &str,
        api_file_content: &str,
    ) -> Vec<SourceFile> {
        vec![
            source("package.json", r#"{"name":"root","workspaces":["api"]}"#),
            source(
                "api/package.json",
                &format!("{{\"name\":\"api\"{api_pkg_extra}}}"),
            ),
            source(&format!("api/{api_file_path}"), api_file_content),
        ]
    }

    #[test]
    fn detect_js_run_runtime_flags_bunyan_side_effect_import_and_allows_pino() {
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/log.mjs",
            "import 'bunyan'\nimport { createLogger } from '@nitra/pino'\nexport const log = createLogger()\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .contains("заміни 'bunyan' на '@nitra/pino'"));
    }

    /// Домішка `package.json`, що декларує канонічний conn-аліас —
    /// той самий мотив, що `writeWorkspaceRoot(dir, { imports: { '#conn/*':
    /// './lib/conn/*' } })` колишньої parity-фікстури.
    const CONN_ALIAS_PKG_EXTRA: &str = r##","imports":{"#conn/*":"./lib/conn/*"}"##;

    #[test]
    fn detect_js_run_runtime_conn_file_valid_mssql_read_name_passes() {
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mssql-read.mjs",
            "export const mssqlRead = 1\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_invalid_prefix_is_flagged() {
        // `msql-` (без другого `s`) не входить у канонічний набір
        // префіксів (`pg`/`mysql`/`mssql`).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/msql-read.mjs",
            "export const msqlRead = 1\n",
        ));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("не відповідає канону js-run")));
    }

    #[test]
    fn detect_js_run_runtime_conn_file_kebab_to_camel_multi_segment() {
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mssql-write-b2b.mjs",
            "export const mssqlWriteB2b = 1\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_flags_temporal_import_form() {
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/time.mjs",
            "import { Temporal } from '@js-temporal/polyfill'\nexport const now = () => Temporal.Now.instant()\n",
        ));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("Temporal API заборонений у Bun runtime")));
    }

    // --- маніфест ---

    // --- bun/licensee (зріз 5 контракту v3.1) ---
    //
    // Тут — лише ЧИСТІ хелпери: сам `detect_bun_licensee` кличе host-імпорт
    // `exec-tool`, який поза реальним хостом абортує (доккомент модуля
    // `tests`). Живий контур — golden-тести
    // `crates/rules-plugin-host/tests/plugin_lang_js.rs` із резолвленим
    // фейковим `bun`.

    #[test]
    fn parse_licensee_blocks_splits_packages_and_reads_terms() {
        let blocks = parse_licensee_blocks(
            "@scope/own@1.0.0\n  Terms: Invalid license metadata\n\nthird@2.0.0\n  Terms: GPL-3.0\n",
        );
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].name, "@scope/own");
        assert_eq!(blocks[0].terms, LICENSEE_INVALID_METADATA_TERMS);
        assert_eq!(blocks[1].name, "third");
        assert_eq!(blocks[1].terms, "GPL-3.0");
    }

    /// `lastIndexOf('@') > 0` JS-канону: провідний `@` scoped-пакета БЕЗ
    /// версії не має відрізатись у порожнє ім'я.
    #[test]
    fn parse_licensee_blocks_keeps_scoped_name_without_version() {
        let blocks = parse_licensee_blocks("@scope/own\n  Terms: MIT\n");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].name, "@scope/own");
    }

    #[test]
    fn parse_licensee_blocks_skips_empty_and_nameless_blocks() {
        assert!(parse_licensee_blocks("").is_empty());
        assert!(parse_licensee_blocks("   \n\n  \n").is_empty());
        // Заголовок з одного `@` дає порожнє ім'я лише за `index > 0`;
        // сам по собі `@` лишається іменем — і саме так поводиться канон.
        assert_eq!(parse_licensee_blocks("@\n").len(), 1);
    }

    #[test]
    fn parse_licensee_blocks_tolerates_missing_terms_line() {
        let blocks = parse_licensee_blocks("pkg@1.0.0\n  License: MIT\n");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].terms, "");
    }

    // --- bun/licensee: T0-фіксер ---

    /// Компактний конструктор діагностики для fix-тестів `bun/licensee`.
    fn licensee_diagnostic(reason: &str, data: Option<&str>) -> Diagnostic {
        Diagnostic {
            reason: reason.to_string(),
            message: "m".to_string(),
            file: None,
            severity: Severity::Error,
            data: data.map(str::to_string),
        }
    }

    fn licensee_fix_request(files: Vec<SourceFile>, diagnostics: Vec<Diagnostic>) -> FixRequest {
        FixRequest {
            concern_id: CONCERN_BUN_LICENSEE.to_string(),
            files,
            diagnostics,
        }
    }

    #[test]
    fn licensee_canonical_config_carries_all_seven_spdx() {
        let config =
            parse_json_ordered(LICENSEE_CANONICAL_CONFIG).expect("вшитий канон — валідний JSON");
        let JsonOrdered::Array(spdx) = config
            .get("licenses")
            .and_then(|l| l.get("spdx"))
            .expect("licenses.spdx є")
        else {
            panic!("licenses.spdx — масив");
        };
        let listed: Vec<&str> = spdx
            .iter()
            .map(|item| match item {
                JsonOrdered::Str(s) => s.as_str(),
                _ => panic!("елемент spdx — рядок"),
            })
            .collect();
        assert_eq!(listed, LICENSEE_CANONICAL_SPDX);
        // Ідемпотентність: вшитий канон уже нормалізований.
        assert!(matches!(
            normalize_canonical_spdx(LICENSEE_CANONICAL_CONFIG),
            SpdxNormalization::Unchanged
        ));
    }

    #[test]
    fn fix_bun_licensee_writes_canonical_config_when_missing() {
        let plan = fix_bun_licensee(&licensee_fix_request(
            vec![],
            vec![licensee_diagnostic("licensee-config-missing", None)],
        ));
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікується Write");
        };
        assert_eq!(plan.edits.len(), 1);
        assert_eq!(write.path, ".licensee.json");
        assert_eq!(write.content, LICENSEE_CANONICAL_CONFIG);
    }

    #[test]
    fn normalize_canonical_spdx_preserves_user_fields_and_order() {
        let content = "{\n  \"licenses\": {\n    \"spdx\": [\n      \"MIT\",\n      \
                       \"MPL-2.0\"\n    ]\n  },\n  \"packages\": {\n    \
                       \"legacy-pkg\": \"<=1.0.0\"\n  },\n  \"corrections\": true\n}\n";
        let SpdxNormalization::Changed(next) = normalize_canonical_spdx(content) else {
            panic!("бракує канонічних SPDX — очікується Changed");
        };
        let parsed = parse_json_ordered(&next).expect("результат — валідний JSON");
        let JsonOrdered::Array(spdx) = parsed
            .get("licenses")
            .and_then(|l| l.get("spdx"))
            .expect("licenses.spdx є")
        else {
            panic!("licenses.spdx — масив");
        };
        let listed: Vec<&str> = spdx
            .iter()
            .map(|item| match item {
                JsonOrdered::Str(s) => s.as_str(),
                _ => panic!("елемент spdx — рядок"),
            })
            .collect();
        // Порядок: наявні (у своєму порядку) + відсутні канонічні.
        assert_eq!(
            listed,
            vec![
                "MIT",
                "MPL-2.0",
                "BSD-2-Clause",
                "BSD-3-Clause",
                "Apache-2.0",
                "ISC",
                "BlueOak-1.0.0",
                "0BSD"
            ]
        );
        assert!(matches!(parsed.get("corrections"), Some(JsonOrdered::Bool(true))));
        assert!(parsed
            .get("packages")
            .and_then(|p| p.get("legacy-pkg"))
            .is_some());
        // Ключі кореня — у документному порядку, `licenses` лишився першим.
        assert_eq!(parsed.entries()[0].0, "licenses");
        // Ідемпотентність: другий прогін нічого не міняє.
        assert!(matches!(
            normalize_canonical_spdx(&next),
            SpdxNormalization::Unchanged
        ));
    }

    #[test]
    fn normalize_canonical_spdx_skips_unparsable_and_flags_non_object() {
        assert!(matches!(
            normalize_canonical_spdx("{не json"),
            SpdxNormalization::Unchanged
        ));
        // Канон на цьому вибухає TypeError-ом; гість віддає окремий
        // варіант, який `fix_bun_licensee` переводить у гучний лог.
        assert!(matches!(
            normalize_canonical_spdx("[1, 2]"),
            SpdxNormalization::NotAnObject
        ));
    }

    #[test]
    fn fix_bun_licensee_adds_license_only_to_reported_package_without_field() {
        let files = vec![
            SourceFile {
                path: "package.json".to_string(),
                content: "{\n  \"name\": \"root\",\n  \"version\": \"1.0.0\",\n  \
                          \"workspaces\": [\"npm\", \"member-b\"]\n}\n"
                    .to_string(),
            },
            // Член воркспейсу, у якого `license` уже є — не чіпаємо.
            SourceFile {
                path: "npm/package.json".to_string(),
                content: "{\n  \"name\": \"member\",\n  \"license\": \"MIT\"\n}\n".to_string(),
            },
            // Член воркспейсу без `license`, але `licensee` про нього не
            // звітував — теж не чіпаємо.
            SourceFile {
                path: "member-b/package.json".to_string(),
                content: "{\n  \"name\": \"member-b\"\n}\n".to_string(),
            },
            // Не член воркспейсу — поза обходом `ownPackageDirs`, попри
            // збіг імені (той самий гейт, що в канону).
            SourceFile {
                path: "other/package.json".to_string(),
                content: "{\n  \"name\": \"outsider\"\n}\n".to_string(),
            },
        ];
        let plan = fix_bun_licensee(&licensee_fix_request(
            files,
            vec![
                licensee_diagnostic("license-metadata-invalid", Some("{\"package\":\"root\"}")),
                licensee_diagnostic("license-metadata-invalid", Some("{\"package\":\"member\"}")),
                licensee_diagnostic("license-metadata-invalid", Some("{\"package\":\"outsider\"}")),
            ],
        ));
        assert_eq!(
            plan.edits.len(),
            1,
            "лише root: у member вже є license, outsider поза воркспейсом: {:?}",
            plan.edits
        );
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікується Write");
        };
        assert_eq!(write.path, "package.json");
        assert_eq!(
            write.content,
            "{\n  \"name\": \"root\",\n  \"version\": \"1.0.0\",\n  \
             \"workspaces\": [\n    \"npm\",\n    \"member-b\"\n  ],\n  \
             \"license\": \"ISC\"\n}\n"
        );
    }

    #[test]
    fn fix_bun_licensee_normalizes_existing_config_on_license_violation() {
        let files = vec![SourceFile {
            path: ".licensee.json".to_string(),
            content: "{\n  \"licenses\": {\n    \"spdx\": [\n      \"MIT\"\n    ]\n  }\n}\n"
                .to_string(),
        }];
        let plan = fix_bun_licensee(&licensee_fix_request(
            files,
            vec![licensee_diagnostic("license-violation", None)],
        ));
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікується Write");
        };
        assert_eq!(write.path, ".licensee.json");
        assert!(write.content.contains("BlueOak-1.0.0"));
    }

    #[test]
    fn fix_bun_licensee_without_matching_diagnostics_is_empty() {
        let plan = fix_bun_licensee(&licensee_fix_request(
            vec![SourceFile {
                path: ".licensee.json".to_string(),
                content: LICENSEE_CANONICAL_CONFIG.to_string(),
            }],
            vec![licensee_diagnostic("licensee-tool-error", None)],
        ));
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn truncate_chars_cuts_on_char_boundary_not_bytes() {
        // Кирилиця — 2 байти на символ: байтовий зріз на 3 розрубав би
        // послідовність і запанікував би.
        // cspell:disable-next-line
        assert_eq!(truncate_chars("абвгд", 3), "абв");
        assert_eq!(truncate_chars("abc", 10), "abc");
        assert_eq!(truncate_chars("", 5), "");
    }

    #[test]
    fn build_manifest_declares_all_concerns_with_expected_scopes() {
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
        // `vue/packages` (доккомент секції «Батч 9»), зріз 1 контракту
        // v3.1 — `test/stryker_config` (доккомент секції «Зріз 1»), зріз 2
        // — `js/check` (доккомент секції «Зріз 2»), зріз 4 —
        // `js/doc_comments` (доккомент секції «Зріз 4», ДРУГА per-file
        // контрибуція плагіна), зріз 5 — `bun/licensee` (доккомент секції
        // «Зріз 5», ПЕРШИЙ концерн плагіна, що спавнить зовнішній процес),
        // зріз 6 — `style/lint` і `js/jscpd_duplicates` (доккомент секції
        // «Зріз 6»), зріз 7 — `js-run/runtime` (доккомент секції «Зріз 7»,
        // найбільший поодинокий зріз §3.5.5: дев'ять під-перевірок одного
        // ключа), §2.78 — шість rego-детектів родини `vscode_extensions`
        // (два) і четвірки `package_json` (доккомент секції «§2.78»,
        // ПЕРША хвиля цього гостя на host-import `rego-engine`), §2.80 —
        // ще чотири rego-детекти того самого класу
        // (`style/vscode_settings`, `js/jscpd_config`,
        // `npm-module/emit_types_config`, `js-run/jsconfig` — доккомент
        // секції «§2.80»).
        assert_eq!(manifest.concerns.len(), 50);
        // `CONCERN_STYLE_LINT` — ТРЕТЯ per-file контрибуція: до порту
        // T0-фіксера вона стояла `Full` як обхід дефекту хоста (§2.65,
        // доккомент контрибуції в [`build_manifest`]).
        for key in [CONCERN_TFM, CONCERN_DOC_COMMENTS, CONCERN_STYLE_LINT] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .unwrap_or_else(|| panic!("{key} contribution має бути в маніфесті"));
            assert_eq!(contribution.scope, ConcernScope::PerFile);
            assert!(!contribution.glob.is_empty());
        }
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
            CONCERN_STRYKER_CONFIG,
            CONCERN_JS_CHECK,
            CONCERN_BUN_LICENSEE,
            CONCERN_JS_RUN_RUNTIME,
        ] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .unwrap_or_else(|| panic!("{key} contribution має бути в маніфесті"));
            assert_eq!(contribution.scope, ConcernScope::Full);
            assert!(!contribution.glob.is_empty());
        }
        // `js/jscpd_duplicates` — ЄДИНА контрибуція з порожнім глобом, і це
        // перевіряється окремо саме тому, що загальний цикл вище забороняє
        // порожній глоб як типову помилку. Тут він навпаки обов'язковий:
        // детектор не читає batch взагалі (доккомент секції «Зріз 6»), тож
        // будь-який непорожній глоб змусив би хост читати файли в нікуди.
        let jscpd = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_JSCPD_DUPLICATES)
            .expect("js/jscpd_duplicates contribution має бути в маніфесті");
        assert_eq!(jscpd.scope, ConcernScope::Full);
        assert!(jscpd.glob.is_empty());
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
    /// набір `key = "…"`, `tools` і `ci_artifacts` у маніфесті-довіднику
    /// мусять точно збігатись із тим, що повертає `describe()`.
    ///
    /// Парсинг — справжнім TOML-парсером (dev-only `toml`), а НЕ порядковим
    /// скануванням рядків, як було раніше: попередній примітивний варіант
    /// пропустив другий клас дрейфу — `ci_artifacts = []`/`tools = []` стояли
    /// ПІСЛЯ останнього заголовка `[[concerns]]`, тож TOML читав їх як поля
    /// останнього концерну, а не як top-level поля маніфеста. Порядкове
    /// сканування такого не бачить у принципі (рядок присутній — і байдуже
    /// де), структурний парсинг ловить це напряму.
    #[test]
    fn plugin_toml_concern_keys_match_describe() {
        let manifest: toml::Table = include_str!("../plugin.toml")
            .parse()
            .expect("plugin.toml має бути валідним TOML");
        let runtime = build_manifest();

        // Ключі концернів — той самий гейт, що й до батчу 6, але тепер із
        // масиву `concerns`, а не з довільних рядків файлу.
        // `get(...)`, а не індексація: індексація `toml::Table` панікує
        // безликим «no entry found for key» ще ДО `.as_array()`, і саме
        // діагностика про неправильне розташування поля губиться.
        let mut declared: Vec<&str> = manifest
            .get("concerns")
            .and_then(|v| v.as_array())
            .expect("`concerns` — array of tables у корені маніфеста")
            .iter()
            .map(|c| c["key"].as_str().expect("`key` — рядок"))
            .collect();
        declared.sort_unstable();
        let mut runtime_keys: Vec<&str> = runtime.concerns.iter().map(|c| c.key.as_str()).collect();
        runtime_keys.sort_unstable();
        assert_eq!(
            declared, runtime_keys,
            "plugin.toml розійшовся з describe() по concerns — синхронізуй маніфест-довідник"
        );

        // Другий список контрибуцій (мажор `4.0.0`, §2.84; перший запис —
        // §2.86). Гейт окремий і ТАК САМО точний: ключ, що переїхав із
        // `concerns` у `fix_only_concerns` (чи навпаки), міняє те, чи
        // шедоуїться detect — найтихіша з можливих регресій, і збіг лише за
        // сумарною кількістю її б не спіймав.
        let mut declared_fix_only: Vec<&str> = manifest
            .get("fix_only_concerns")
            .and_then(|v| v.as_array())
            .expect(
                "`fix_only_concerns` мусить бути top-level array of tables — якщо він стоїть \
                 ПІСЛЯ заголовка `[[concerns]]`, TOML читає його як поле останнього концерну",
            )
            .iter()
            .map(|c| c["key"].as_str().expect("`key` — рядок"))
            .collect();
        declared_fix_only.sort_unstable();
        let mut runtime_fix_only: Vec<&str> = runtime
            .fix_only_concerns
            .iter()
            .map(|c| c.key.as_str())
            .collect();
        runtime_fix_only.sort_unstable();
        assert_eq!(
            declared_fix_only, runtime_fix_only,
            "plugin.toml розійшовся з describe() по fix_only_concerns"
        );

        // `tools` шукається В КОРЕНІ таблиці — сам пошук тут і є перевіркою
        // розташування: якщо ключ з'їхав під `[[concerns]]`, у корені його
        // просто немає.
        let declared_tools: Vec<&str> = manifest
            .get("tools")
            .and_then(|v| v.as_array())
            .expect(
                "`tools` мусить бути top-level масивом маніфеста — якщо він стоїть ПІСЛЯ \
                 заголовка `[[concerns]]`, TOML читає його як поле останнього концерну; \
                 перенеси до `id`/`version`/`world_version`/`domains`",
            )
            .iter()
            .map(|t| t.as_str().expect("елемент `tools` — рядок"))
            .collect();
        assert_eq!(
            declared_tools,
            runtime.tools.iter().map(String::as_str).collect::<Vec<_>>(),
            "plugin.toml розійшовся з describe() по tools"
        );

        // `ci_artifacts` — так само з кореня; звіряємо `artifact_id`-и
        // (ідентичність дескриптора) плюс їх кількість.
        let declared_artifacts: Vec<&str> = manifest
            .get("ci_artifacts")
            .and_then(|v| v.as_array())
            .expect(
                "`ci_artifacts` мусить бути top-level масивом маніфеста — якщо він стоїть \
                 ПІСЛЯ заголовка `[[concerns]]`, TOML читає його як поле останнього концерну; \
                 перенеси до `id`/`version`/`world_version`/`domains`",
            )
            .iter()
            .map(|a| a["artifact_id"].as_str().expect("`artifact_id` — рядок"))
            .collect();
        assert_eq!(
            declared_artifacts,
            runtime
                .ci_artifacts
                .iter()
                .map(|a| a.artifact_id.as_str())
                .collect::<Vec<_>>(),
            "plugin.toml розійшовся з describe() по ci_artifacts"
        );

        // `scope`/`glob` — до порту exec-tool-фіксерів звірялись ЛИШЕ
        // ключі, тож маніфест-довідник міг тихо брехати про поведінку, від
        // якої залежить хост (`scope` вирішує, чи будувати batch glob-ом і
        // чи поважати дельту запиту на fix-боці). Саме така розбіжність і
        // накопичилась у `style/lint`. Тепер вона гучна.
        for contribution in &runtime.concerns {
            let declared = manifest
                .get("concerns")
                .and_then(|v| v.as_array())
                .expect("`concerns` — array of tables")
                .iter()
                .find(|c| c["key"].as_str() == Some(contribution.key.as_str()))
                .expect("ключі вже звірені вище");
            let declared_scope = declared["scope"].as_str().expect("`scope` — рядок");
            let runtime_scope = match contribution.scope {
                ConcernScope::Full => "full",
                ConcernScope::PerFile => "per-file",
            };
            assert_eq!(
                declared_scope, runtime_scope,
                "plugin.toml розійшовся з describe() по scope концерну {}",
                contribution.key
            );
            let declared_glob: Vec<&str> = declared
                .get("glob")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .map(|g| g.as_str().expect("елемент `glob` — рядок"))
                        .collect()
                })
                .unwrap_or_default();
            assert_eq!(
                declared_glob,
                contribution.glob.iter().map(String::as_str).collect::<Vec<_>>(),
                "plugin.toml розійшовся з describe() по glob концерну {}",
                contribution.key
            );
        }
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

    // Дзеркало `rule_meta.test.mjs` — залишкові `main.json.lint`/`.llmFix`
    // раніше не мали жодного `#[test]` (знайдено при звірці покриття перед
    // видаленням JS-фолбеку кластера `js/*`).
    #[test]
    fn detect_rule_meta_flags_residual_lint_and_llm_fix_fields() {
        let files = vec![
            src("npm/rules/n-js/main.mdc", "# n-js\n"),
            src(
                "npm/rules/n-js/main.json",
                r#"{"auto": "завжди", "lint": {}, "llmFix": true}"#,
            ),
        ];
        let diagnostics = detect_rule_meta(&files);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics[0].message.contains("main.json.lint скасовано"));
        assert!(diagnostics[1]
            .message
            .contains("main.json.llmFix скасовано"));
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

    // Дзеркало `skill_meta.test.mjs` — відсутній main.json і залишковий
    // auto.md раніше не мали жодного `#[test]` для skill_meta (лише
    // rule_meta-еквіваленти були покриті).
    #[test]
    fn detect_skill_meta_flags_missing_main_json() {
        let diagnostics = detect_skill_meta(&[src("npm/skills/n-lint/skill.mdc", "# n-lint\n")]);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .contains("відсутній або невалідний main.json"));
        assert_eq!(diagnostics[0].reason, SKILL_META_REASON);
    }

    #[test]
    fn detect_skill_meta_flags_residual_auto_md() {
        let files = vec![
            src("npm/skills/n-lint/auto.md", "завжди\n"),
            src("npm/skills/n-lint/main.json", r#"{"worktree": false}"#),
        ];
        let diagnostics = detect_skill_meta(&files);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("залишковий auto.md"));
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

    // `detect_header_doc_pointer` мала лише golden-тест у
    // `crates/rules-plugin-host/tests/plugin_lang_js.rs`
    // (`detect_header_doc_pointer_flags_narrative_jsdoc_next_to_docs`), не
    // прямий `#[test]` тут — і жоден з двох не покривав `.test.mjs`-фільтр
    // чи гілку `npm/skills` (лише `npm/rules`). Знайдено при звірці
    // покриття перед видаленням JS-фолбеку кластера `js/*`.
    #[test]
    fn detect_header_doc_pointer_skips_test_files_and_covers_skills_base() {
        let files = vec![
            // `npm/rules/...` — `.test.mjs` з тим самим module JSDoc, що
            // тригерив би порушення на не-тестовому файлі, ігнорується.
            src(
                "npm/rules/n-js/js/check.test.mjs",
                "/**\n * Опис поведінки.\n * Другий рядок.\n */\nexport const a = 1\n",
            ),
            src("npm/rules/n-js/js/docs/check.test.md", "# check.test\n"),
            // `npm/skills/...` — той самий сценарій, що для `npm/rules`, але
            // друга base-гілка `detect_header_doc_pointer`.
            src(
                "npm/skills/n-lint/js/run.mjs",
                "/**\n * Опис поведінки.\n * Другий рядок.\n */\nexport const b = 1\n",
            ),
            src("npm/skills/n-lint/js/docs/run.md", "# run\n"),
        ];
        let diagnostics = detect_header_doc_pointer(&files);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .starts_with("npm/skills/n-lint/js/run.mjs"));
    }

    /// Мінімальний "чистий" батч для `detect_package_structure`: усе, що
    /// НЕ стосується hk.pkl/types, вже на місці — лишається ізольовано
    /// звірити hk-гілку.
    fn package_structure_clean_batch_except_hk(hk_pkl: &str) -> Vec<SourceFile> {
        vec![
            src("package.json", "{\"name\":\"root\"}"),
            src(
                "npm/package.json",
                "{\"name\":\"@7n/rules\",\"types\":\"./types/index.d.ts\"}",
            ),
            src("npm/types/index.d.ts", "export {}\n"),
            src("npm/tsconfig.emit-types.json", "{}"),
            src(".github/workflows/npm-publish.yml", "on: push\n"),
            src("hk.pkl", hk_pkl),
        ]
    }

    // Дзеркало `package_structure.test.mjs` — `detect_package_structure` не
    // мала ЖОДНОГО `#[test]` тут (лише інтеграційний golden-тест у
    // `crates/rules-plugin-host/tests/plugin_lang_js.rs` і тести чистих
    // хелперів нижче). Чотири гілки — deprecated "check changelog", відсутній
    // npm-changelog крок, `use_src_js_layout`, `npm` як файл — не мали
    // прямого покриття. Знайдено при звірці покриття перед видаленням
    // JS-фолбеку кластера `js/*`.
    #[test]
    fn detect_package_structure_flags_deprecated_check_changelog_step() {
        let hk =
            "[\"pre-commit\"]\nbunx -p typescript tsc tsconfig.emit-types.json\ncheck changelog\n";
        let diagnostics = detect_package_structure(&package_structure_clean_batch_except_hk(hk));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("застарілий виклик \"check changelog\"")));
    }

    #[test]
    fn detect_package_structure_flags_missing_npm_changelog_step() {
        let hk = "[\"pre-commit\"]\nbunx -p typescript tsc tsconfig.emit-types.json\n";
        let diagnostics = detect_package_structure(&package_structure_clean_batch_except_hk(hk));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("онови крок npm-changelog")
                && d.message.contains("npm-changelog")));
    }

    #[test]
    fn detect_package_structure_passes_hk_with_npm_changelog_step() {
        let hk = "[\"pre-commit\"]\nbunx -p typescript tsc tsconfig.emit-types.json\n\
                  [\"npm-changelog\"]\nN_RULES_CHANGELOG_AUTOFIX=1 npx @7n/rules lint changelog\n";
        let diagnostics = detect_package_structure(&package_structure_clean_batch_except_hk(hk));
        assert!(diagnostics.iter().all(|d| !d.message.contains("hk.pkl")));
    }

    #[test]
    fn detect_package_structure_flags_npm_as_plain_file_not_directory() {
        let files = vec![
            src("package.json", "{\"name\":\"root\"}"),
            // `npm` — звичайний ФАЙЛ, не каталог.
            src("npm", "not a directory\n"),
        ];
        let diagnostics = detect_package_structure(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.message == "npm має бути директорією"));
        // `npm/` "не існує" гілка НЕ повинна дублюватись — `npm`-як-файл
        // виключна альтернатива (else if у канонічному порту).
        assert!(diagnostics
            .iter()
            .all(|d| d.message != "npm/ директорія не існує"));
    }

    #[test]
    fn detect_package_structure_use_src_js_layout_switches_types_and_hk_requirements() {
        let files = vec![
            src("package.json", "{\"name\":\"root\"}"),
            src("npm/package.json", "{\"name\":\"@7n/rules\"}"),
            src("npm/src/index.js", "module.exports = {}\n"),
            // Немає npm/types/index.d.ts → фейл use_src_js_layout-гілки types.
            src(
                "hk.pkl",
                "[\"pre-commit\"]\nbunx -p typescript tsc src/**/*.js --declaration --allowJs \
                 --emitDeclarationOnly --outDir types --skipLibCheck\n[\"npm-changelog\"]\n\
                 N_RULES_CHANGELOG_AUTOFIX=1 npx @7n/rules lint changelog\n",
            ),
            src(".github/workflows/npm-publish.yml", "on: push\n"),
        ];
        let diagnostics = detect_package_structure(&files);
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("Відсутній npm/types/index.d.ts")));
        // use_src_js_layout=true → tsconfig.emit-types.json НЕ вимагається.
        assert!(diagnostics
            .iter()
            .all(|d| !d.message.contains("tsconfig.emit-types.json")));
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

    // Дзеркало `dep-policy.test.mjs` («порушення: dynamic import(...)»,
    // «порушення: у .ts файлі», «кілька порушень у різних файлах — всі
    // репортуються») — прибрано разом з JS-фолбеком (видалення
    // JS-детектора кластера `js/*`), випадки переносимо сюди.
    #[test]
    fn detect_dep_policy_flags_dynamic_import_ts_files_and_multiple_files() {
        let files = vec![
            src(
                "src/a.mjs",
                "const m = await import('@nitra/as-integrations-fastify')\n",
            ),
            src(
                "src/b.ts",
                "import fastifyApollo, { fastifyApolloDrainPlugin } from '@nitra/as-integrations-fastify'\n",
            ),
        ];
        let diagnostics = detect_dep_policy(&files);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics.iter().all(|d| d.reason == DEP_POLICY_REASON));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.starts_with("src/a.mjs")));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.starts_with("src/b.ts")));
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

    /// Будує `FixRequest` для `bun/layout` — діагностики беруться реальним
    /// `detect_bun_layout` над переданим батчем (full-scope, `files` —
    /// увесь батч, той самий контракт, що `run_wasm_concern_fix` дає для
    /// `ConcernScope::Full` на `target_files.is_empty()`).
    fn bun_layout_fix_request(files: Vec<SourceFile>) -> FixRequest {
        let diagnostics = detect_bun_layout(&files);
        FixRequest {
            concern_id: CONCERN_BUN_LAYOUT.to_string(),
            files,
            diagnostics,
        }
    }

    #[test]
    fn fix_bun_layout_deletes_each_forbidden_file_named_in_message() {
        let mut files = bun_layout_clean_root();
        files.push(src("yarn.lock", ""));
        files.push(src("package-lock.json", "{}"));
        let plan = fix_bun_layout(&bun_layout_fix_request(files));
        let deleted: Vec<&str> = plan
            .edits
            .iter()
            .filter_map(|e| match e {
                FileEdit::Delete(path) => Some(path.as_str()),
                FileEdit::Write(_) | FileEdit::WriteBytes(_) => None,
            })
            .collect();
        assert_eq!(deleted, vec!["package-lock.json", "yarn.lock"]);
    }

    #[test]
    fn fix_bun_layout_creates_bunfig_when_missing() {
        let files = vec![src("bun.lock", ""), src("package.json", "{}\n")];
        let plan = fix_bun_layout(&bun_layout_fix_request(files));
        let write = plan
            .edits
            .iter()
            .find_map(|e| match e {
                FileEdit::Write(w) if w.path == "bunfig.toml" => Some(w),
                _ => None,
            })
            .expect("план містить write bunfig.toml");
        assert_eq!(write.content, "[install]\nlinker = \"hoisted\"\n");
    }

    #[test]
    fn fix_bun_layout_does_not_touch_existing_bunfig() {
        // canonical root уже несе bunfig.toml — detect_bun_layout не видасть
        // діагностику "Відсутній bunfig.toml", тож і write-edit не з'явиться.
        let plan = fix_bun_layout(&bun_layout_fix_request(bun_layout_clean_root()));
        assert!(plan
            .edits
            .iter()
            .all(|e| !matches!(e, FileEdit::Write(w) if w.path == "bunfig.toml")));
    }

    #[test]
    fn fix_bun_layout_deletes_yarn_dir_as_single_edit() {
        let mut files = bun_layout_clean_root();
        files.push(src(".yarn/releases/yarn-4.0.0.cjs", "// yarn\n"));
        let plan = fix_bun_layout(&bun_layout_fix_request(files));
        let deleted: Vec<&str> = plan
            .edits
            .iter()
            .filter_map(|e| match e {
                FileEdit::Delete(path) => Some(path.as_str()),
                FileEdit::Write(_) | FileEdit::WriteBytes(_) => None,
            })
            .collect();
        assert_eq!(deleted, vec![".yarn"]);
    }

    #[test]
    fn fix_bun_layout_clean_root_yields_empty_plan() {
        let plan = fix_bun_layout(&bun_layout_fix_request(bun_layout_clean_root()));
        assert!(plan.edits.is_empty());
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

    /// `sandbox-aware-test.test.mjs` — «успіх: тест без import.meta навігації»:
    /// `has_deep_meta_navigation` не знаходить жодного `import.meta.*` взагалі
    /// → рано повертає `false`, без діагностики.
    #[test]
    fn detect_sandbox_aware_test_passes_without_any_meta_navigation() {
        let files = vec![src(
            "tests/foo.test.mjs",
            "import { test } from \"vitest\"\ntest(\"ok\", () => {})\n",
        )];
        assert!(detect_sandbox_aware_test(&files).is_empty());
    }

    /// `sandbox-aware-test.test.mjs` — «import.meta.url (не лише dirname) теж
    /// детектується»: [`IMPORT_META_NAV_PATTERN`] — альтернація
    /// `dirname|url`, цей тест тримає живою гілку `url`, не лише `dirname`.
    #[test]
    fn detect_sandbox_aware_test_flags_import_meta_url_variant() {
        let files = vec![src(
            "tests/url-based.test.mjs",
            "const d = dirname(fileURLToPath(import.meta.url))\nconst R = join(d, '..', '..', '..', \
             '..')\n",
        )];
        let diagnostics = detect_sandbox_aware_test(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, SANDBOX_AWARE_TEST_REASON);
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

    // -----------------------------------------------------------------
    // Зріз 4 контракту v3.1: `js/doc_comments` (detect + T0-фікс).
    // -----------------------------------------------------------------

    /// Хелпер: `FixRequest` з одного файлу й списку `(reason, data)`.
    fn doc_comments_fix_request(path: &str, content: &str, diagnostics: &[&str]) -> FixRequest {
        FixRequest {
            concern_id: CONCERN_DOC_COMMENTS.to_string(),
            files: vec![src(path, content)],
            diagnostics: diagnostics
                .iter()
                .map(|data| Diagnostic {
                    reason: DOC_COMMENTS_MISSING_EXPORT_REASON.to_string(),
                    message: String::new(),
                    file: Some(path.to_string()),
                    severity: Severity::Error,
                    data: Some((*data).to_string()),
                })
                .collect(),
        }
    }

    /// Вміст першого `write`-edit плану (або `None`, якщо план порожній).
    fn first_write_content(plan: &FixPlan) -> Option<&str> {
        plan.edits.first().map(|edit| match edit {
            FileEdit::Write(write) => write.content.as_str(),
            other => panic!("doc_comments не видаляє файлів, отримали {other:?}"),
        })
    }

    #[test]
    fn is_doc_comment_target_mirrors_js_predicate() {
        let excluded = regex::Regex::new(DOC_COMMENTS_EXCLUDED_FILE_PATTERN).unwrap();
        let ext = regex::Regex::new(DOC_COMMENTS_SOURCE_EXT_PATTERN).unwrap();
        for path in ["a.js", "a.mjs", "a.cjs", "a.ts", "src/deep/a.mjs"] {
            assert!(is_doc_comment_target(path, &excluded, &ext), "{path}");
        }
        for path in [
            "a.test.mjs",
            "a.spec.js",
            "types/a.d.ts",
            "tests/a.mjs",
            "src/fixtures/a.mjs",
            "__mocks__/a.mjs",
            "a.vue",
            "a.json",
        ] {
            assert!(!is_doc_comment_target(path, &excluded, &ext), "{path}");
        }
    }

    /// ЦЕНТРАЛЬНИЙ тест зрізу: на не-ASCII вмісті байтовий і UTF-16 офсети
    /// РОЗХОДЯТЬСЯ, і `data` мусить нести саме UTF-16 (точка конверсії 1).
    #[test]
    fn detect_doc_comments_emits_utf16_offsets_not_byte_offsets() {
        // Кирилиця (2 байти/1 UTF-16 unit) + емодзі поза BMP
        // (4 байти/2 UTF-16 units) ПЕРЕД promotable-блоком.
        let content = "const кирилиця = '😀'\n// опис експорту\nexport function f() {}\n";
        let diagnostics = detect_doc_comments(&[src("src/файл.mjs", content)]);
        let export = diagnostics
            .iter()
            .find(|d| d.reason == DOC_COMMENTS_MISSING_EXPORT_REASON)
            .expect("export без JSDoc — порушення");
        let data: serde_json::Value =
            serde_json::from_str(export.data.as_deref().unwrap()).unwrap();
        assert_eq!(data["promotable"], serde_json::json!(true));

        let byte_start = content.find("// опис").unwrap();
        let utf16_start = data["start"].as_u64().unwrap() as usize;
        // Саме це й ловить фікстура: наївний порт віддав би байти.
        assert_ne!(utf16_start, byte_start);
        assert_eq!(
            utf16_start,
            content[..byte_start]
                .chars()
                .map(char::len_utf16)
                .sum::<usize>()
        );
        assert_eq!(
            utf16_offset_to_byte(content, utf16_start),
            byte_start,
            "зворотна конверсія має бути точною"
        );
        let utf16_end = data["end"].as_u64().unwrap() as usize;
        assert_eq!(
            &content[byte_start..utf16_offset_to_byte(content, utf16_end)],
            "// опис експорту"
        );
    }

    #[test]
    fn byte_and_utf16_offset_conversions_round_trip() {
        let src = "а😀b";
        assert_eq!(byte_offset_to_utf16(src, 0), 0);
        assert_eq!(byte_offset_to_utf16(src, 2), 1); // після 'а' (2 байти)
        assert_eq!(byte_offset_to_utf16(src, 6), 3); // після емодзі (сурогатна пара)
        assert_eq!(utf16_offset_to_byte(src, 3), 6);
        assert_eq!(utf16_offset_to_byte(src, 999), src.len());
    }

    #[test]
    fn detect_doc_comments_reports_header_and_each_export() {
        let content = "export const a = 1\nexport function b() {}\n";
        let diagnostics = detect_doc_comments(&[src("src/a.mjs", content)]);
        assert_eq!(diagnostics.len(), 3);
        assert_eq!(diagnostics[0].reason, DOC_COMMENTS_MISSING_HEADER_REASON);
        assert_eq!(diagnostics[0].data.as_deref(), Some("{}"));
        assert!(diagnostics[1].message.contains("export a без JSDoc-опису"));
        assert!(diagnostics[2].message.contains("export b без JSDoc-опису"));
        assert_eq!(diagnostics[2].data.as_deref(), Some("{\"name\":\"b\"}"));
    }

    #[test]
    fn detect_doc_comments_skips_files_without_exports_and_broken_syntax() {
        assert!(detect_doc_comments(&[src("a.mjs", "const x = 1\n")]).is_empty());
        assert!(detect_doc_comments(&[src("a.mjs", "export function (\n")]).is_empty());
        // Не-цільовий файл фільтрується ще до парсингу.
        assert!(detect_doc_comments(&[src("tests/a.mjs", "export const a = 1\n")]).is_empty());
    }

    #[test]
    fn detect_doc_comments_accepts_jsdoc_header_after_shebang() {
        let content =
            "#!/usr/bin/env node\n/** Огляд файлу. */\n/** Опис. */\nexport const a = 1\n";
        assert!(detect_doc_comments(&[src("bin/a.mjs", content)]).is_empty());
    }

    /// Порожній рядок між `//`-блоком і символом розриває «впритул»-звʼязок —
    /// порушення лишається, але вже НЕ promotable.
    #[test]
    fn detect_doc_comments_blank_line_breaks_promotable_link() {
        let content = "/** Огляд. */\n// відірваний коментар\n\nexport const a = 1\n";
        let diagnostics = detect_doc_comments(&[src("a.mjs", content)]);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].data.as_deref(), Some("{\"name\":\"a\"}"));
    }

    #[test]
    fn collect_doc_comment_exports_covers_default_and_destructuring() {
        let allocator = Allocator::default();
        let source = "export default class {}\n";
        let ret = Parser::new(&allocator, source, scan_source_type("a.mjs")).parse();
        let exports = collect_doc_comment_exports(&ret.program);
        assert_eq!(exports.len(), 1);
        assert_eq!(exports[0].name, "default");

        let allocator = Allocator::default();
        let source = "export const { a } = obj\nexport const b = 1, c = 2\n";
        let ret = Parser::new(&allocator, source, scan_source_type("a.mjs")).parse();
        let names: Vec<String> = collect_doc_comment_exports(&ret.program)
            .into_iter()
            .map(|e| e.name)
            .collect();
        // `{ a }` — не `Identifier`, тож поза вимогою (дзеркало `collectExports`).
        assert_eq!(names, vec!["b", "c"]);
    }

    #[test]
    fn fix_doc_comments_promotes_single_and_multi_line_blocks() {
        let content = "// Огляд файлу\nexport const a = 1\n";
        let plan = fix_doc_comments(&doc_comments_fix_request(
            "a.mjs",
            content,
            &["{\"promotable\":true,\"start\":0,\"end\":14,\"name\":\"a\"}"],
        ));
        assert_eq!(
            first_write_content(&plan),
            Some("/** Огляд файлу */\nexport const a = 1\n")
        );

        let content = "  // перший\n  // другий\n  export const a = 1\n";
        // Офсети в `data` — UTF-16 (точка конверсії 1), а `find` віддає байти.
        let start = byte_offset_to_utf16(content, content.find("//").unwrap());
        let end = byte_offset_to_utf16(content, content.find("\n  export").unwrap());
        let plan = fix_doc_comments(&doc_comments_fix_request(
            "a.mjs",
            content,
            &[&format!(
                "{{\"promotable\":true,\"start\":{start},\"end\":{end},\"name\":\"a\"}}"
            )],
        ));
        assert_eq!(
            first_write_content(&plan),
            Some("  /**\n   * перший\n   * другий\n   */\n  export const a = 1\n")
        );
    }

    /// Той самий не-ASCII ризик, але з боку `fix`: без зворотної конверсії
    /// зріз поїхав би й guard [`is_line_comment_block`] відкинув би блок.
    #[test]
    fn fix_doc_comments_converts_utf16_offsets_back_to_bytes() {
        let content = "const кирилиця = '😀'\n// опис 😀\nexport function f() {}\n";
        let diagnostics = detect_doc_comments(&[src("a.mjs", content)]);
        let data = diagnostics
            .iter()
            .find(|d| d.reason == DOC_COMMENTS_MISSING_EXPORT_REASON)
            .and_then(|d| d.data.clone())
            .unwrap();
        let plan = fix_doc_comments(&doc_comments_fix_request("a.mjs", content, &[&data]));
        assert_eq!(
            first_write_content(&plan),
            Some("const кирилиця = '😀'\n/** опис 😀 */\nexport function f() {}\n")
        );
    }

    /// Guard ідемпотентності: повторний прогін тих самих (уже несвіжих)
    /// офсетів по ВЖЕ підвищеному файлу нічого не чинить.
    #[test]
    fn fix_doc_comments_is_idempotent_on_stale_offsets() {
        let content = "// Огляд файлу\nexport const a = 1\n";
        let data = "{\"promotable\":true,\"start\":0,\"end\":14,\"name\":\"a\"}";
        let promoted = first_write_content(&fix_doc_comments(&doc_comments_fix_request(
            "a.mjs",
            content,
            &[data],
        )))
        .unwrap()
        .to_string();
        let plan = fix_doc_comments(&doc_comments_fix_request("a.mjs", &promoted, &[data]));
        assert!(plan.edits.is_empty(), "другий прогін має бути no-op");
    }

    #[test]
    fn fix_doc_comments_skips_non_promotable_and_indented_blocks() {
        // Не-promotable діагностика → порожній план.
        let plan = fix_doc_comments(&doc_comments_fix_request(
            "a.mjs",
            "export const a = 1\n",
            &["{\"name\":\"a\"}"],
        ));
        assert!(plan.edits.is_empty());

        // Блок не на початку рядка (перед ним код) — не чіпаємо.
        let content = "const x = 1 // хвостовий\nexport const a = 1\n";
        let start = byte_offset_to_utf16(content, content.find("//").unwrap());
        let end = byte_offset_to_utf16(content, content.find('\n').unwrap());
        let plan = fix_doc_comments(&doc_comments_fix_request(
            "a.mjs",
            content,
            &[&format!(
                "{{\"promotable\":true,\"start\":{start},\"end\":{end},\"name\":\"a\"}}"
            )],
        ));
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn promote_line_block_escapes_closing_delimiter() {
        let prefix_re = regex::Regex::new(DOC_COMMENTS_LINE_PREFIX_PATTERN).unwrap();
        assert_eq!(
            promote_line_block("// глоб **/*.js", "", &prefix_re),
            r"/** глоб **\/*.js */"
        );
    }

    /// Header і export можуть вказувати на ТОЙ САМИЙ блок — дедуп за `start`
    /// не дає підвищити його двічі.
    #[test]
    fn fix_doc_comments_deduplicates_shared_block() {
        let content = "// Спільний блок\nexport const a = 1\n";
        let diagnostics = detect_doc_comments(&[src("a.mjs", content)]);
        assert_eq!(diagnostics.len(), 2, "header + export на тому самому блоці");
        let request = FixRequest {
            concern_id: CONCERN_DOC_COMMENTS.to_string(),
            files: vec![src("a.mjs", content)],
            diagnostics,
        };
        assert_eq!(
            first_write_content(&fix_doc_comments(&request)),
            Some("/** Спільний блок */\nexport const a = 1\n")
        );
    }

    #[test]
    fn js_trim_matches_ecma_whitespace_set() {
        // U+FEFF — пробіл для JS, але не для `char::is_whitespace`.
        assert!(js_trim("\u{feff}  ").is_empty());
        // U+0085 — навпаки: Unicode `White_Space`, але не JS-пробіл.
        assert_eq!(js_trim("\u{85}"), "\u{85}");
    }

    // --- js-run/runtime (продовження — звірка покриття видаленого
    // `plugins/lang-js/rules/js-run/runtime/tests/check-fixture.test.mjs`,
    // 19 наскрізних сценаріїв через `lint()`) ---
    //
    // 17 із 19 уже покриті: 15 — через `wasm-plugin-parity.test.mjs`
    // (`fixtures/wasm-parity/js-run/runtime.json`, золотий вивід колишнього
    // JS-канону проти wasm-плагіна), 4 — через `#[test]` вище в цьому ж
    // блоці (`detect_js_run_runtime_flags_bunyan_side_effect_import_and_allows_pino`,
    // conn-файл mssql-read / невалідний префікс / kebab→camel,
    // `detect_js_run_runtime_flags_temporal_import_form`) — ті самі чисті
    // гілки, що й у check-fixture, лише з іншими конкретними значеннями:
    // bunyan default-import класифікується ЛИШЕ за `it.source.value`
    // (`visit_import_declaration`), специфікатор ролі не грає, тож
    // `import log from '@nitra/bunyan'` іде тим самим кодом, що вже
    // перевірений на side-effect `import 'bunyan'`; camelCase-звірка
    // conn-файла — точна рівність у `Vec::contains` (`find_conn_file_rule_violations`),
    // не префікс, тож "mssqlWriter" проти очікуваного "mssqlWrite" ловиться
    // тим самим кодом, що вже перевірений на "pgWriteContract"; повністю
    // валідний "mssql-write"-варіант — та сама гілка регексу
    // `CONN_FILENAME_DB_PATTERN`, що вже пройдена на "mssql-write-b2b";
    // кастомний `#conn/*`-аліас на інший каталог — та сама opaque-рядкова
    // гілка `resolve_conn_dir_from_package_json`, що вже перевірена на
    // `lib/conn/*`; checkEnv(['X']) поряд із СИРИМ `process.env.X` не
    // впливає на `EnvViolationKind::ProcessEnv` (`visit_static_member_expression`
    // репортить її БЕЗУМОВНО, `checked`-множина читається лише в гілці
    // `env.X`) — той самий код, що вже покритий на "check-env: process.env,
    // деструктуризація і env без checkEnv".
    //
    // Два сценарії — СПРАВЖНІ прогалини, жодна наявна перевірка їх не
    // будує, і обидві гілки нетривіальні:

    /// `await setTimeout(ms)` — простий `CallExpression`, не
    /// `NewExpression`; [`is_promise_set_timeout_delay`] дивиться ЛИШЕ на
    /// `new Promise(...)`, тож коректний канонічний патерн
    /// `node:timers/promises` не повинен зачепити цю гілку. Жодна наявна
    /// перевірка (ні parity-фікстура, ні #[test] вище) не будує саме "0" на
    /// цьому патерні — лише хибний `new Promise` + `setTimeout`.
    #[test]
    fn detect_js_run_runtime_allows_set_timeout_from_node_timers_promises() {
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/sleep.mjs",
            "import { setTimeout } from 'node:timers/promises'\n\nexport async function pause() {\n  await setTimeout(500)\n}\n",
        ));
        assert!(diagnostics.is_empty());
    }

    /// `has_check_env_import` вимагає `import { env } … from '@nitra/check-env'`
    /// САМЕ з цього пакета (`decl.source.value != CHECK_ENV_PACKAGE` — рання
    /// відсіч); той самий локальний біндінг `env`, імпортований з
    /// `node:process`, не вмикає `env_from_check_env`, тож `env.OPTIONAL`
    /// не дає `MissingCheckEnv`. Ані parity-фікстура, ані
    /// #[test] вище не конструюють `env` з ІНШОГО пакета — лише з
    /// `@nitra/check-env`.
    #[test]
    fn detect_js_run_runtime_ignores_env_imported_from_node_process() {
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/env.mjs",
            "import { env } from 'node:process'\nconsole.log(env.OPTIONAL)\n",
        ));
        assert!(diagnostics.is_empty());
    }

    // --- js-run/runtime: conn-file-rules + conn-imports-scan (борг покриття
    // видалених `conn-file-rules.test.mjs`/`conn-imports-scan.test.mjs`) ---

    #[test]
    fn detect_js_run_runtime_conn_file_valid_mssql_write_name_passes() {
        // mssql-write, дзеркало гілки `write` (сусідній тест покриває лише `read`).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mssql-write.mjs",
            "import sql from 'mssql'\nexport const mssqlWrite = sql\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_valid_mssql_id_variants_multiple_extensions_pass() {
        // `mssql-{read|write}-<id>` з розширеннями `.cjs`/`.ts` (не лише `.mjs`).
        let write_diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mssql-write-tenant.cjs",
            "export const mssqlWriteTenant = 1\n",
        ));
        assert!(write_diagnostics.is_empty());

        let read_diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mssql-read-warehouse.ts",
            "export const mssqlReadWarehouse = 1\n",
        ));
        assert!(read_diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_valid_mysql_prefix_passes() {
        // `mysql-` — backward-compat префікс, окрема гілка альтернації регексу.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mysql-read.js",
            "export const mysqlRead = 1\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_mssql_without_read_write_suffix_is_flagged() {
        // `mssql.js` без `-read`/`-write` — інша гілка невалідності, ніж
        // `msql-read` (помилковий префікс) із сусіднього тесту.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mssql.js",
            "export const mssql = 1\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .contains("не відповідає канону js-run"));
    }

    #[test]
    fn detect_js_run_runtime_conn_file_d_ts_is_not_scanned() {
        // `.d.ts` виключений із джерел (`is_js_run_scan_source_file`) — навіть
        // з канонічно-невалідним іменем і `export default` файл НЕ звучить.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/types.d.ts",
            "export default {}\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_json_is_not_scanned() {
        // `.json` не входить у `SOURCE_FILE_RE` — інша гілка виключення, ніж
        // явний carve-out `.d.ts` вище.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/data.json",
            "{\"a\":1}\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_valid_ql_prefix_passes() {
        // `ql-<id>` — окремий регекс (`CONN_FILENAME_QL_PATTERN`), досі не
        // зачеплений жодним conn-тестом.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/ql-dashboard.js",
            "export const qlDashboard = 1\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_ql_without_id_is_flagged() {
        // `ql-.js` — префікс є, але `id`-частина порожня (регекс вимагає
        // мінімум один символ `[a-z0-9]`).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/ql-.js",
            "export const x = 1\n",
        ));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("не відповідає канону js-run")));
    }

    #[test]
    fn detect_js_run_runtime_conn_file_pg_prefix_with_and_without_id_pass() {
        // `pg-` — префікс досі не зачеплений жодним conn-тестом; перевіряємо
        // обидві гілки опційного `-<id>` суфіксу.
        let without_id = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/pg-write.ts",
            "export const pgWrite = 1\n",
        ));
        assert!(without_id.is_empty());

        let with_id = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/pg-read-analytics.js",
            "export const pgReadAnalytics = 1\n",
        ));
        assert!(with_id.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_function_declaration_export_passes() {
        // `export function pgRead() {}` — гілка `Declaration::FunctionDeclaration`
        // у `collect_named_export_names`, досі не зачеплена (сусідні тести
        // використовують лише `export const`).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/pg-read.js",
            "export function pgRead() { return null }\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_class_export_wrong_name_is_flagged() {
        // `export class PgWrite {}` — гілка `Declaration::ClassDeclaration`,
        // імʼя класу (PascalCase) не збігається з очікуваним camelCase `pgWrite`.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/pg-write.js",
            "export class PgWrite {}\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("export const pgWrite = "));
        assert!(diagnostics[0].message.contains("знайдено: PgWrite"));
    }

    #[test]
    fn detect_js_run_runtime_conn_file_class_export_correct_name_passes() {
        // `export class pgRead {}` — той самий вузол, що вище, але імʼя
        // класу вже точно дорівнює очікуваному camelCase.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/pg-read.js",
            "export class pgRead {}\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_aliased_reexport_passes() {
        // `export { pool as pgRead }` — гілка `declaration = None` +
        // `specifiers` у `collect_named_export_names` (re-export з аліасом).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/pg-read.js",
            "import { pool } from './internal'\nexport { pool as pgRead }\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_invalid_name_and_default_export_both_flagged() {
        // Невалідне імʼя + `export default` одночасно — перевіряє порядок з
        // доккоменту `find_conn_file_rule_violations`: `default-export`
        // рахується РАНІШЕ раннього виходу через невалідне імʼя, тож обидва
        // порушення потрапляють у результат (а не лише `name`).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/bad-name.js",
            "export default {}\n",
        ));
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("не відповідає канону js-run")));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("'export default' заборонений")));
    }

    #[test]
    fn detect_js_run_runtime_conn_file_syntax_error_yields_no_violations() {
        // Валідне імʼя + синтаксична помилка: парсер падає, `default-export`
        // і `export-name` перевірки НЕ виконуються — жодного порушення (а не
        // крах чи best-effort аналіз часткового AST).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/pg-read.js",
            "import { from broken\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_file_wrong_export_name_is_flagged() {
        // Неправильне імʼя експорту для файла з одним сегментом
        // `mssql-write` — `expectedName` має дорівнювати саме `mssqlWrite`,
        // не префіксу знайденого імені `mssqlWriter` (перевіряємо точний
        // фрагмент з прогалиною, щоб не зловити цей самий префікс).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mssql-write.mjs",
            "import sql from 'mssql'\nexport const mssqlWriter = sql\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .contains("export const mssqlWrite = "));
    }

    #[test]
    fn detect_js_run_runtime_conn_file_default_export_with_valid_name_is_flagged() {
        // `export default` у файлі з ВАЛІДНИМ іменем (на відміну від
        // `..._invalid_name_and_default_export_both_flagged` вище) — `name`
        // не порушено, тож `export-name`-перевірка теж виконується і теж
        // падає (нема жодного `export const mssqlWrite`), разом — 2 діагностики.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mssql-write.js",
            "import sql from 'mssql'\nexport default sql\n",
        ));
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("'export default' заборонений")));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("export const mssqlWrite = ")));
    }

    #[test]
    fn detect_js_run_runtime_conn_file_multi_segment_wrong_export_is_flagged() {
        // Негативна пара до існуючого
        // `detect_js_run_runtime_conn_file_kebab_to_camel_multi_segment`
        // (там — коректний `mssqlWriteB2b` без порушень): тут імʼя файла те
        // саме, але експорт `wrong` — очікуване імʼя все одно обчислюється з
        // kebab-case basename файла, а не задається напряму.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "lib/conn/mssql-write-b2b.mts",
            "import sql from 'mssql'\nexport const wrong = sql\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .contains("export const mssqlWriteB2b = "));
    }

    #[test]
    fn detect_js_run_runtime_conn_import_bun_sql_flagged_spawn_allowed() {
        // `import { SQL } from 'bun'` поза `connDir/` — порушення; `spawn` з
        // того самого модуля — НЕ порушення (перевіряємо разом, щоб довести,
        // що фільтр специфікатора `SQL`, а не сам модуль `bun`).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "index.mjs",
            "import { SQL } from 'bun'\nimport { spawn } from 'bun'\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("{ SQL } from 'bun'"));
        assert!(!diagnostics[0].message.contains("spawn"));
    }

    #[test]
    fn detect_js_run_runtime_conn_import_mssql_default_import_flagged() {
        // БУДЬ-ЯКИЙ імпорт з `mssql` (не лише named) — порушення
        // (`classifyConnImport` повертає специфікатор `*` для цього модуля).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "index.mjs",
            "import sql from 'mssql'\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("імпорт 'mssql'"));
    }

    #[test]
    fn detect_js_run_runtime_conn_import_graphql_client_flagged_gql_allowed() {
        // `GraphQLClient` з `@nitra/graphql-request` — порушення; `gql` з
        // того самого модуля — НЕ порушення (аналогічно до bun/SQL вище).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            CONN_ALIAS_PKG_EXTRA,
            "index.mjs",
            "import { GraphQLClient } from '@nitra/graphql-request'\nimport { gql } from '@nitra/graphql-request'\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("GraphQLClient"));
    }

    #[test]
    fn detect_js_run_runtime_conn_dir_defaults_to_src_conn_without_alias() {
        // Без `imports["#conn/*"]` у package.json — `connDir` за замовчуванням
        // `src/conn` (`CONN_DIR_FALLBACK`): факторний імпорт і нейминг файла
        // ВСЕРЕДИНІ `src/conn/` не звучать (на відміну від
        // `..._conn_import_boundary_prefix_is_not_inside_conn_dir` нижче, де
        // файл лише СХОЖИЙ на шлях під conn, але насправді поза ним).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "src/conn/mssql-read.mjs",
            "import sql from 'mssql'\nexport const mssqlRead = sql\n",
        ));
        assert!(!diagnostics.iter().any(|d| d.message.contains("має бути в")));
        assert!(!diagnostics
            .iter()
            .any(|d| d.message.contains("не відповідає канону js-run")));
        assert!(!diagnostics
            .iter()
            .any(|d| d.message.contains("export const mssqlRead = ")));
    }

    #[test]
    fn detect_js_run_runtime_conn_dir_reads_conditional_exports_default() {
        // `imports["#conn/*"]` як умовний експорт `{ default: '...' }`
        // (не рядком, як у `CONN_ALIAS_PKG_EXTRA`) — інша гілка
        // `resolve_conn_dir_from_package_json` (`serde_json::Value::Object`).
        // Факторний імпорт `mssql` у складі контенту — якщо об'єктну форму
        // не розпізнати і впасти на дефолтний `src/conn`, цей файл (реально
        // під `app/conn/`) вважався б ПОЗА conn-каталогом і диагностика
        // фабричного імпорту з'явилася б помилково.
        let extra = r##","imports":{"#conn/*":{"default":"./app/conn/*"}}"##;
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            extra,
            "app/conn/pg-read.js",
            "import sql from 'mssql'\nexport const pgRead = sql\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_conn_import_boundary_prefix_is_not_inside_conn_dir() {
        // `src/connect.js` — рядок ПОЧИНАЄТЬСЯ з `src/conn`, але не є ні самим
        // каталогом, ні вкладеним у нього файлом (немає `/` одразу після
        // `src/conn`). `is_inside_conn_dir` мусить трактувати його як «поза
        // conn» — інакше факторний імпорт mssql тут пройшов би непоміченим.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "src/connect.js",
            "import sql from 'mssql'\n",
        ));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("імпорт 'mssql'") && d.message.contains("src/conn/")));
    }

    // =====================================================================
    // js-run/runtime — борг покриття видалених JS-тестів (реєстр боргу,
    // видалений канон `js-run-canon/tests/{check-env-scan,
    // promise-settimeout-scan,bunyan-imports,temporal-scan}.test.mjs`).
    // Через `detect_js_run_runtime` + `js_run_workspace_files`, той самий
    // тестовий каркас, що сусідні `detect_js_run_runtime_flags_bunyan_…`/
    // `..._flags_temporal_…` вище.
    // =====================================================================

    // ---------------------------------------------------------------------
    // Під-перевірка 5 — `lib/check-env-scan.mjs`
    // (check-env-scan.test.mjs)
    // ---------------------------------------------------------------------

    #[test]
    fn detect_js_run_runtime_check_env_process_env_dot_access_is_violation() {
        // 'process.env.X — порушення з kind=process-env'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "console.log(process.env.PG_CONN)\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0]
            .message
            .contains("lib/x.ts:1 — process.env.PG_CONN: заміни на env"));
    }

    #[test]
    fn detect_js_run_runtime_check_env_process_env_survives_check_env_call() {
        // 'process.env.X навіть із checkEnv лишається порушенням (треба
        // замінити на env)' — checkEnv([...]) закриває лише `env.X`, не
        // `process.env.X`.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { checkEnv } from '@nitra/check-env'\ncheckEnv(['PG_CONN'])\nconsole.log(process.env.PG_CONN)\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("process.env.PG_CONN"));
    }

    #[test]
    fn detect_js_run_runtime_check_env_process_env_computed_string_literal_key() {
        // 'process.env["X"] (computed string) теж ловиться як process-env'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "const v = process.env['SECRET']\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("process.env.SECRET"));
    }

    #[test]
    fn detect_js_run_runtime_check_env_process_env_computed_dynamic_key_is_skipped() {
        // 'process.env[varName] (динамічний ключ) — пропускаємо без помилки'
        // — статичний AST не може встановити ім'я змінної.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "const k = 'X'\nconst v = process.env[k]\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_check_env_process_env_object_destructuring() {
        // 'деструктуризація { X, Y } = process.env — кожне поле як
        // process-env'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "const { A, B } = process.env\n",
        ));
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("process.env.A")));
        assert!(diagnostics
            .iter()
            .any(|d| d.message.contains("process.env.B")));
    }

    #[test]
    fn detect_js_run_runtime_check_env_process_env_ignore_directive_suppresses() {
        // 'коментар-маркер на попередньому рядку приглушує і process.env'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "// n-rules:ignore-next-line checkEnv\nconsole.log(process.env.OPTIONAL)\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_check_env_env_without_check_env_call_is_violation() {
        // "env.X без checkEnv після import { env } from '@nitra/check-env' —
        // порушення".
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { env } from '@nitra/check-env'\nconsole.log(env.PG_CONN)\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("env.PG_CONN"));
        assert!(diagnostics[0].message.contains("без checkEnv"));
    }

    #[test]
    fn detect_js_run_runtime_check_env_env_with_check_env_call_passes() {
        // 'env.X з checkEnv — без порушення'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { checkEnv, env } from '@nitra/check-env'\ncheckEnv(['PG_CONN'])\nconsole.log(env.PG_CONN)\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_check_env_check_env_call_order_does_not_matter() {
        // 'checkEnv після використання теж покриває (порядок не важливий)' —
        // collectCheckedEnvNames проходить весь файл окремим першим
        // walk-ом, ще до генерації порушень.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { checkEnv, env } from '@nitra/check-env'\nconsole.log(env.PG_CONN)\ncheckEnv(['PG_CONN'])\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_check_env_partial_destructuring_flags_only_uncovered() {
        // 'частково покрита деструктуризація — лише непокрите поле fail'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { checkEnv, env } from '@nitra/check-env'\ncheckEnv(['A'])\nconst { A, B } = env\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("env.B"));
    }

    #[test]
    fn detect_js_run_runtime_check_env_multiple_check_env_calls_merge() {
        // 'кілька checkEnv-викликів зливаються в один список'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { checkEnv, env } from '@nitra/check-env'\ncheckEnv(['A'])\ncheckEnv(['B'])\nconst { A, B } = env\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_check_env_env_from_other_package_is_ignored() {
        // "env без імпорту з '@nitra/check-env' — не наша турбота" — `env`
        // імпортований з 'node:process'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { env } from 'node:process'\nconsole.log(env.OPTIONAL)\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_check_env_local_env_parameter_is_not_confused() {
        // 'локальний env без імпорту — не плутаємо з check-env'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "function f(env) { return env.X }\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_check_env_ignore_directive_suppresses_env_x() {
        // 'коментар-маркер приглушує і env.X'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { env } from '@nitra/check-env'\n// n-rules:ignore-next-line checkEnv\nconsole.log(env.LEGACY)\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_check_env_scan_source_file_extension_filter() {
        // 'isCheckEnvScanSourceFile фільтрує розширення' — спільний предикат
        // [`is_js_run_scan_source_file`] (doc-коментар вище, «Спільний
        // предикат... УСІХ шести lib-сканерів»): `.json`/`.d.ts` не
        // сканує, `.ts`/`.mjs`/`.tsx` — так.
        assert!(detect_js_run_runtime(&js_run_workspace_files(
            "",
            "config.json",
            "process.env.PG_CONN\n",
        ))
        .is_empty());
        assert!(detect_js_run_runtime(&js_run_workspace_files(
            "",
            "types.d.ts",
            "console.log(process.env.PG_CONN)\n",
        ))
        .is_empty());
        assert!(!detect_js_run_runtime(&js_run_workspace_files(
            "",
            "index.mjs",
            "console.log(process.env.PG_CONN)\n",
        ))
        .is_empty());
    }

    #[test]
    fn detect_js_run_runtime_check_env_syntax_error_yields_no_diagnostics() {
        // 'синтаксична помилка → порожній результат'.
        let diagnostics =
            detect_js_run_runtime(&js_run_workspace_files("", "lib/x.ts", "function (\n"));
        assert!(diagnostics.is_empty());
    }

    // ---------------------------------------------------------------------
    // Під-перевірка 6 — `lib/promise-settimeout-scan.mjs`
    // (promise-settimeout-scan.test.mjs)
    // ---------------------------------------------------------------------

    #[test]
    fn detect_js_run_runtime_promise_settimeout_await_bare_resolve_is_violation() {
        // 'await new Promise(r => setTimeout(r, 500)) — порушення'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "await new Promise(resolve => setTimeout(resolve, 500))\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("lib/x.ts:1 —"));
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_without_await_still_flagged() {
        // 'без await — все одно порушення (інших легітимних застосувань
        // паттерна нема)'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.js",
            "const p = new Promise(r => setTimeout(r, 100))\n",
        ));
        assert_eq!(diagnostics.len(), 1);
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_block_body_form() {
        // 'block-body форма: new Promise(r => { setTimeout(r, 1000) })'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "await new Promise(r => { setTimeout(r, 1000) })\n",
        ));
        assert_eq!(diagnostics.len(), 1);
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_function_expression_form() {
        // 'function expression: new Promise(function (r) { setTimeout(r, 50) })'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "await new Promise(function (resolve) { setTimeout(resolve, 50) })\n",
        ));
        assert_eq!(diagnostics.len(), 1);
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_wrapped_arrow_resolve_call() {
        // 'обгорнутий arrow: new Promise(r => setTimeout(() => r(), 200))'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "await new Promise(r => setTimeout(() => r(), 200))\n",
        ));
        assert_eq!(diagnostics.len(), 1);
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_timers_promises_import_is_clean() {
        // "імпорт promise-варіанта setTimeout — без порушень".
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { setTimeout } from 'node:timers/promises'\n\nawait setTimeout(500)\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_non_timer_promise_is_clean() {
        // "Promise з логікою (не таймер) — без порушень".
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "await new Promise((resolve, reject) => fetch('/x').then(resolve, reject))\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_resolve_with_value_is_out_of_pattern() {
        // 'Promise з resolve(value) у callback — поза паттерном (передає
        // значення)'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "await new Promise(r => setTimeout(() => r(42), 500))\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_non_resolve_first_arg_is_out_of_pattern() {
        // 'setTimeout без resolve у першому аргументі — поза паттерном'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "await new Promise(resolve => setTimeout(otherCb, 500))\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_multiple_statements_in_block_is_out_of_pattern() {
        // 'кілька стейтментів у блоці — поза паттерном (не «чиста» пауза)'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "await new Promise(r => { log('wait'); setTimeout(r, 500) })\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_multiline_keeps_new_expression_start_line() {
        // 'multiline зберігає номер рядка початку NewExpression'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "// header\nawait new Promise(\n  resolve => setTimeout(resolve, 1000)\n)\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("lib/x.ts:2 —"));
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_multiple_occurrences_each_flagged() {
        // 'кілька входжень в одному файлі — кожне порушення окремо'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "await new Promise(r => setTimeout(r, 100))\nconst p = new Promise(r => setTimeout(r, 200))\n",
        ));
        assert_eq!(diagnostics.len(), 2);
    }

    #[test]
    fn detect_js_run_runtime_promise_settimeout_scan_source_file_extension_filter() {
        // "isPromiseSetTimeoutScanSourceFile — JS/TS-сім'я, без .d.ts".
        assert!(detect_js_run_runtime(&js_run_workspace_files(
            "",
            "types.d.ts",
            "await new Promise(r => setTimeout(r, 100))\n",
        ))
        .is_empty());
        assert!(!detect_js_run_runtime(&js_run_workspace_files(
            "",
            "index.tsx",
            "await new Promise(r => setTimeout(r, 100))\n",
        ))
        .is_empty());
    }

    // ---------------------------------------------------------------------
    // Під-перевірка 2 — `lib/bunyan-imports.mjs`
    // (bunyan-imports.test.mjs; 'side-effect import все одно порушення' і
    // половина 'імпорти з @nitra/pino — без порушень' уже покриті сусіднім
    // `detect_js_run_runtime_flags_bunyan_side_effect_import_and_allows_pino`
    // вище — тут лише сценарії, яких там нема.)
    // ---------------------------------------------------------------------

    #[test]
    fn detect_js_run_runtime_bunyan_default_import_is_violation() {
        // 'default import з @nitra/bunyan'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import log from '@nitra/bunyan'\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("'@nitra/bunyan'"));
        assert!(diagnostics[0].message.contains("lib/x.ts:1 —"));
    }

    #[test]
    fn detect_js_run_runtime_bunyan_named_import_from_legacy_module() {
        // 'named import з застарілого bunyan'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.js",
            "import { createLogger } from 'bunyan'\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("'bunyan'"));
    }

    #[test]
    fn detect_js_run_runtime_bunyan_require_call_is_violation() {
        // 'require("@nitra/bunyan") — порушення'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.cjs",
            "const log = require('@nitra/bunyan')\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("'@nitra/bunyan'"));
    }

    #[test]
    fn detect_js_run_runtime_bunyan_dynamic_import_is_violation() {
        // 'динамічний import("@nitra/bunyan") — порушення'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "const m = await import('@nitra/bunyan')\n",
        ));
        assert_eq!(diagnostics.len(), 1);
    }

    #[test]
    fn detect_js_run_runtime_bunyan_require_from_pino_is_clean() {
        // 'імпорти з @nitra/pino — без порушень' — половина `require`
        // (import-половина вже покрита сусіднім тестом вище).
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.cjs",
            "const x = require('@nitra/pino')\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_bunyan_multiline_import_keeps_start_line() {
        // 'multiline import зберігає номер рядка початку'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "// header\nimport {\n  a,\n  b\n} from '@nitra/bunyan'\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("lib/x.ts:2 —"));
    }

    #[test]
    fn detect_js_run_runtime_bunyan_scan_source_file_extension_filter() {
        // 'isBunyanScanSourceFile / shouldSkipFileForBunyanScan'.
        assert!(detect_js_run_runtime(&js_run_workspace_files(
            "",
            "types.d.ts",
            "import log from '@nitra/bunyan'\n",
        ))
        .is_empty());
        assert!(!detect_js_run_runtime(&js_run_workspace_files(
            "",
            "index.mjs",
            "import log from '@nitra/bunyan'\n",
        ))
        .is_empty());
    }

    // ---------------------------------------------------------------------
    // Під-перевірка 7 — `lib/temporal-scan.mjs`
    // (temporal-scan.test.mjs)
    // ---------------------------------------------------------------------

    #[test]
    fn detect_js_run_runtime_temporal_bare_global_usage_without_import() {
        // 'Temporal.Now.instant() — порушення' — без імпорту, лише
        // глобальний ідентифікатор `Temporal`.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.js",
            "const now = Temporal.Now.instant()\n",
        ));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("lib/x.js:1 —"));
    }

    #[test]
    fn detect_js_run_runtime_temporal_import_specifier_without_usage() {
        // "import { Temporal } from '@js-temporal/polyfill' — порушення" —
        // сам імпорт, без подальшого використання ідентифікатора.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.ts",
            "import { Temporal } from '@js-temporal/polyfill'\n",
        ));
        assert_eq!(diagnostics.len(), 1);
    }

    #[test]
    fn detect_js_run_runtime_temporal_plain_date_is_clean() {
        // 'звичайний Date не дає порушень'.
        let diagnostics = detect_js_run_runtime(&js_run_workspace_files(
            "",
            "lib/x.js",
            "const stamp = new Date().toISOString()\n",
        ));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn detect_js_run_runtime_temporal_scan_source_file_extension_filter() {
        // "isTemporalScanSourceFile — JS/TS-сім'я, без .d.ts".
        assert!(detect_js_run_runtime(&js_run_workspace_files(
            "",
            "types.d.ts",
            "const now = Temporal.Now.instant()\n",
        ))
        .is_empty());
        assert!(!detect_js_run_runtime(&js_run_workspace_files(
            "",
            "index.mjs",
            "const now = Temporal.Now.instant()\n",
        ))
        .is_empty());
    }

    // =====================================================================
    // js-run/runtime — T0-фікс `js-run-jsconfig-create` (доккомент біля
    // [`fix_js_run_runtime`]): порт `fix-runtime.mjs`, характеризаційний
    // JS-гейт — `plugins/lang-js/rules/js-run/runtime/tests/fix-runtime.test.mjs`.
    // =====================================================================

    /// Точний формат `message`, який реально видає [`check_js_run_workspace_package`]
    /// для під-перевірки 1 — той самий рядок, що `fix-runtime.mjs`'s
    /// `JSCONFIG_MISSING_WS_RE` парсить назад.
    fn jsconfig_missing_message(ws: &str) -> String {
        format!(
            "[{ws}] є каталог src/, але немає jsconfig.json — додай канонічний файл з js-run.mdc \
             (NodeNext, include: src/**/*)."
        )
    }

    fn jsconfig_missing_diagnostic(ws: &str) -> Diagnostic {
        Diagnostic {
            reason: JS_RUN_RUNTIME_REASON.to_string(),
            message: jsconfig_missing_message(ws),
            file: None,
            severity: Severity::Error,
            data: None,
        }
    }

    #[test]
    fn jsconfig_missing_ws_parses_anchored_bracket_prefix() {
        assert_eq!(jsconfig_missing_ws(&jsconfig_missing_message("api")), Some("api"));
        assert_eq!(
            jsconfig_missing_ws(&jsconfig_missing_message("packages/api")),
            Some("packages/api")
        );
    }

    /// Точний порт асиметрії `JSCONFIG_MISSING_WS_RE` vs `JSCONFIG_MISSING_RE`
    /// (доккомент [`jsconfig_missing_ws`]): підрядок без провідного `[ws] `
    /// не дає workspace, навіть якщо substring-тест (`test()` JS-канону)
    /// спрацював би.
    #[test]
    fn jsconfig_missing_ws_none_without_anchored_bracket_prefix() {
        assert_eq!(
            jsconfig_missing_ws("десь тут є каталог src/, але немає jsconfig.json теж"),
            None
        );
        assert_eq!(jsconfig_missing_ws("[api]є каталог src/, але немає jsconfig.json"), None);
        assert_eq!(jsconfig_missing_ws("немає дужок узагалі"), None);
    }

    /// Основний сценарій: один workspace, `jsconfig.json` відсутній у батчі —
    /// один `Write`-edit з ТОЧНИМ вшитим каноном.
    #[test]
    fn fix_js_run_runtime_creates_missing_jsconfig() {
        let request = FixRequest {
            concern_id: CONCERN_JS_RUN_RUNTIME.to_string(),
            files: vec![source("api/package.json", r#"{"name":"api"}"#)],
            diagnostics: vec![jsconfig_missing_diagnostic("api")],
        };
        let plan = fix_js_run_runtime(&request);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("js-run/runtime не видаляє файлів")
        };
        assert_eq!(write.path, "api/jsconfig.json");
        assert_eq!(write.content, JSCONFIG_CANONICAL_JSON);
    }

    /// Кілька workspace-ів одразу — edit на КОЖЕН, у порядку `diagnostics`
    /// (той самий порядок, що `touchedFiles` JS-канону).
    #[test]
    fn fix_js_run_runtime_creates_jsconfig_for_each_workspace_in_order() {
        let request = FixRequest {
            concern_id: CONCERN_JS_RUN_RUNTIME.to_string(),
            files: vec![],
            diagnostics: vec![
                jsconfig_missing_diagnostic("api"),
                jsconfig_missing_diagnostic("worker"),
            ],
        };
        let plan = fix_js_run_runtime(&request);
        let paths: Vec<&str> = plan
            .edits
            .iter()
            .map(|e| match e {
                FileEdit::Write(w) => w.path.as_str(),
                other => panic!("js-run/runtime не видаляє файлів, отримали {other:?}"),
            })
            .collect();
        assert_eq!(paths, vec!["api/jsconfig.json", "worker/jsconfig.json"]);
    }

    /// `jsconfig.json` уже присутній у батчі (full-scope fallback читає його
    /// з диска, доккомент [`fix_js_run_runtime`]) — ідемпотентність:
    /// відсутній edit для ЦЬОГО workspace-а, інший (справді відсутній)
    /// лишається в плані.
    #[test]
    fn fix_js_run_runtime_skips_workspace_whose_jsconfig_already_exists() {
        let request = FixRequest {
            concern_id: CONCERN_JS_RUN_RUNTIME.to_string(),
            files: vec![source("api/jsconfig.json", "{\"custom\":true}\n")],
            diagnostics: vec![
                jsconfig_missing_diagnostic("api"),
                jsconfig_missing_diagnostic("worker"),
            ],
        };
        let plan = fix_js_run_runtime(&request);
        assert_eq!(plan.edits.len(), 1);
        assert!(matches!(&plan.edits[0], FileEdit::Write(w) if w.path == "worker/jsconfig.json"));
    }

    /// `message`, що містить підрядок, але не проходить анхор [`jsconfig_missing_ws`]
    /// — мовчки ігнорується, план порожній (той самий edge case, що
    /// характеризаційний JS-гейт).
    #[test]
    fn fix_js_run_runtime_ignores_non_anchored_diagnostic() {
        let request = FixRequest {
            concern_id: CONCERN_JS_RUN_RUNTIME.to_string(),
            files: vec![],
            diagnostics: vec![Diagnostic {
                reason: JS_RUN_RUNTIME_REASON.to_string(),
                message: "десь тут є каталог src/, але немає jsconfig.json теж".to_string(),
                file: None,
                severity: Severity::Error,
                data: None,
            }],
        };
        assert!(fix_js_run_runtime(&request).edits.is_empty());
    }

    /// Дублікат діагностики для ТОГО САМОГО workspace-а (напр. повторний
    /// прогін детекту на неоновленому батчі) — рівно ОДИН edit, не два
    /// (доккомент [`fix_js_run_runtime`] пояснює, чому порт емулює
    /// `existsSync`-побічний ефект JS-циклу через явний `planned`-набір).
    #[test]
    fn fix_js_run_runtime_dedupes_duplicate_diagnostics_for_same_workspace() {
        let request = FixRequest {
            concern_id: CONCERN_JS_RUN_RUNTIME.to_string(),
            files: vec![],
            diagnostics: vec![jsconfig_missing_diagnostic("api"), jsconfig_missing_diagnostic("api")],
        };
        assert_eq!(fix_js_run_runtime(&request).edits.len(), 1);
    }

    /// Доказ парності «детект → фікс → повторний детект чисто» — гість-only
    /// раунд-трип (той самий прийом, що [`fix_js_check_round_trip_with_detect_is_clean`]):
    /// РЕАЛЬНИЙ [`detect_js_run_runtime`] на батчі з `src/`, без `jsconfig.json`,
    /// дає під-перевірку 1; застосований план задовольняє повторний детект.
    #[test]
    fn fix_js_run_runtime_round_trip_with_detect_is_clean() {
        let before = js_run_workspace_files("", "src/index.mjs", "export const app = 1\n");
        let diagnostics_before = detect_js_run_runtime(&before);
        assert_eq!(diagnostics_before.len(), 1);
        assert!(diagnostics_before[0].message.contains("є каталог src/, але немає jsconfig.json"));

        let plan = fix_js_run_runtime(&FixRequest {
            concern_id: CONCERN_JS_RUN_RUNTIME.to_string(),
            files: before.clone(),
            diagnostics: diagnostics_before,
        });
        assert_eq!(plan.edits.len(), 1);

        let mut after = before;
        for edit in &plan.edits {
            let FileEdit::Write(write) = edit else {
                panic!("js-run/runtime не видаляє файлів")
            };
            after.push(source(&write.path, &write.content));
        }
        assert!(
            detect_js_run_runtime(&after).is_empty(),
            "план не задовольнив повторний детект: {:?}",
            detect_js_run_runtime(&after)
        );
    }

    /// Анти-дрейф-гейт для [`JSCONFIG_CANONICAL_JSON`] — той самий шаблон,
    /// що [`embedded_knip_canonical_matches_source_file`]: читає канонічний
    /// файл-джерело НЕЗАЛЕЖНО від `include_str!`-шляху (через
    /// `CARGO_MANIFEST_DIR`) і звіряє байт-у-байт із вшитою константою.
    #[test]
    fn embedded_jsconfig_canonical_matches_source_file() {
        let canonical_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../plugins/lang-js/rules/js-run/jsconfig/template/jsconfig.json.snippet.json",
        );
        let on_disk = std::fs::read_to_string(&canonical_path).unwrap_or_else(|err| {
            panic!("не вдалось прочитати канонічний jsconfig.json.snippet.json {canonical_path:?}: {err}")
        });
        assert_eq!(
            JSCONFIG_CANONICAL_JSON, on_disk,
            "вшитий `include_str!`-вміст розійшовся з канонічним файлом-джерелом \
             {canonical_path:?} — T0-фіксер (`fix-runtime.mjs`) і гість мають вшивати/читати \
             ІДЕНТИЧНИЙ канон"
        );
    }

    // =================================================================
    // §2.78 — родина `vscode_extensions` + четвірка `package_json`.
    //
    // Нативні тести кличуть `regorus` IN-PROCESS через
    // `rules_rego_engine::RegoEngine` (`cfg(not(target_arch = "wasm32"))`,
    // доккомент секції «§2.78»), тобто перевіряють РІВНО ту саму
    // rego-семантику, що продакшн-wasm отримає через host-import.
    // =================================================================

    /// Діагностика policy-deny на заданому таргеті — вхід T0-фіксерів.
    fn policy_deny(file: &str, message: &str) -> Diagnostic {
        Diagnostic {
            reason: POLICY_DENY_REASON.to_string(),
            message: message.to_string(),
            file: Some(file.to_string()),
            severity: Severity::Error,
            data: None,
        }
    }

    fn cfg_of(key: &str) -> &'static PolicyCfg {
        policy_cfg(key).expect("конфіг концерну §2.78")
    }

    fn written(plan: FixPlan) -> (String, String) {
        assert_eq!(plan.edits.len(), 1, "очікували рівно один write");
        match plan.edits.into_iter().next().expect("щойно перевірений write") {
            FileEdit::Write(w) => (w.path, w.content),
            other => panic!("очікували Write, отримали {other:?}"),
        }
    }

    /// Кожен із шести концернів §2.78 задекларований у `describe()` рівно з
    /// тим глобом, що дорівнює його таргету — гейт пастки §2.72 («вузький
    /// detect-glob беззвучно каструє fix»), сформульований як інваріант, а
    /// не як прогін.
    #[test]
    fn hlob_kozhnoho_policy_kontsernu_dorivniuie_ioho_taryetam() {
        let manifest = build_manifest();
        for cfg in POLICY_CONFIGS {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == cfg.key)
                .unwrap_or_else(|| panic!("контрибуція {} має бути в describe()", cfg.key));
            assert_eq!(
                contribution.glob,
                cfg.files.contribution_glob(),
                "глоб {} мусить дорівнювати його таргету — інакше fix отримає порожній batch",
                cfg.key
            );
        }
    }

    /// Обидва `vscode_extensions`-концерни — `files.single`: рушій
    /// [`vscode_extensions_fix`] інших форм не вміє й падає на них
    /// `expect`-ом, тож інваріант мусить бути перевіреним, а не припущеним.
    #[test]
    fn vscode_extensions_kontserny_maiut_single_formu() {
        for key in [CONCERN_JS_VSCODE_EXTENSIONS, CONCERN_STYLE_VSCODE_EXTENSIONS] {
            assert_eq!(
                cfg_of(key).files.single_target(),
                Some(VSCODE_EXTENSIONS_TARGET),
                "{key}"
            );
        }
    }

    /// Кожен template-фікс-конфіг має policy-конфіг із ТИМ САМИМ таргетом:
    /// розходження двох таблиць було б тихим (detect бачив би один файл, fix
    /// писав би в інший).
    #[test]
    fn template_fix_konfihy_uzghodzheni_z_policy_konfihamy() {
        for fix_cfg in TEMPLATE_FIX_CONFIGS {
            let policy = cfg_of(fix_cfg.key);
            assert_eq!(
                policy.files.single_target(),
                Some(fix_cfg.target),
                "{}",
                fix_cfg.key
            );
            assert_eq!(
                policy.snippet_raw, fix_cfg.snippet_raw,
                "{}: detect і fix мусять читати ОДИН snippet",
                fix_cfg.key
            );
        }
    }

    /// Вшиті `.rego` УСІХ policy-концернів реально КОМПІЛЮЮТЬСЯ І ЕВАЛЮЮТЬСЯ під
    /// `regorus` (а не лише під Go-шним `conftest`) — гейт обох відомих
    /// пасток міграції (`%q` §2.68/§2.76, відсутні builtin-и §2.69) на
    /// чистому вході, де жодна `deny` не має спрацювати випадково.
    #[test]
    fn vsi_rego_polityky_evaliuiutsia_pid_regorus() {
        for cfg in POLICY_CONFIGS {
            let snippet = parse_embedded_snippet(cfg.snippet_source_name, cfg.snippet_raw);
            let data_json = wrap_template_data(snippet);
            let result = eval_deny_rule(cfg.rego, cfg.namespace, &data_json, "{}");
            assert!(
                result.is_ok(),
                "policy {} ({}) не еваліюється під regorus: {:?}",
                cfg.namespace,
                cfg.rego_source_name,
                result.err()
            );
        }
    }

    /// Вшиті snippet-и — валідні JSON-обʼєкти (інваріант `include_str!`).
    #[test]
    fn vshyti_snippety_policy_kontserniv_parsiatsia() {
        for cfg in POLICY_CONFIGS {
            assert!(
                matches!(
                    parse_jsonc_document(cfg.snippet_raw),
                    Some(TmJson::Object(_))
                ),
                "{}",
                cfg.snippet_source_name
            );
        }
    }

    // --- detect: js/vscode_extensions ---

    #[test]
    fn detect_js_vscode_extensions_vymahaie_obydvi_rekomendatsii() {
        let cfg = cfg_of(CONCERN_JS_VSCODE_EXTENSIONS);
        let files = vec![source(
            VSCODE_EXTENSIONS_TARGET,
            r#"{ "recommendations": ["dbaeumer.vscode-eslint"] }"#,
        )];
        let diagnostics = detect_policy(cfg, &files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_DENY_REASON);
        assert!(diagnostics[0].message.contains("oxc.oxc-vscode"));
        assert_eq!(diagnostics[0].file.as_deref(), Some(VSCODE_EXTENSIONS_TARGET));
    }

    #[test]
    fn detect_js_vscode_extensions_movchyt_koly_vse_ie() {
        let cfg = cfg_of(CONCERN_JS_VSCODE_EXTENSIONS);
        let files = vec![source(
            VSCODE_EXTENSIONS_TARGET,
            r#"{ "recommendations": ["dbaeumer.vscode-eslint", "oxc.oxc-vscode"] }"#,
        )];
        assert!(detect_policy(cfg, &files).is_empty());
    }

    /// `files.required = true` + `missingMessage` — відсутній таргет дає
    /// РІВНО одну `policy-file-missing` (порт гілки `files.length === 0`).
    #[test]
    fn detect_js_vscode_extensions_vidsutnii_fail_daie_file_missing() {
        let cfg = cfg_of(CONCERN_JS_VSCODE_EXTENSIONS);
        let diagnostics = detect_policy(cfg, &[]);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_FILE_MISSING_REASON);
        assert!(diagnostics[0].message.contains("не існує"));
    }

    /// `style/vscode_extensions` НЕ має `required` — відсутній таргет дає
    /// тишу, не діагностику (розходження двох `concern.json` тієї самої
    /// родини — саме те, що конфіг-таблиця мусить зберігати).
    #[test]
    fn detect_style_vscode_extensions_vidsutnii_fail_daie_tyshu() {
        let cfg = cfg_of(CONCERN_STYLE_VSCODE_EXTENSIONS);
        assert!(detect_policy(cfg, &[]).is_empty());
    }

    /// JSONC-вхід (`//`-коментар + trailing-кома) — канон валив його
    /// `JSON.parse` і МОВЧКИ не давав вердикту; порт бачить реальний
    /// `recommendations`.
    #[test]
    fn detect_vscode_extensions_chytaie_jsonc() {
        let cfg = cfg_of(CONCERN_JS_VSCODE_EXTENSIONS);
        let files = vec![source(
            VSCODE_EXTENSIONS_TARGET,
            "{\n  // канонічні розширення\n  \"recommendations\": [\n    \"dbaeumer.vscode-eslint\",\n    \"oxc.oxc-vscode\",\n  ],\n}\n",
        )];
        assert!(detect_policy(cfg, &files).is_empty());
    }

    /// СПРАВДІ побитий вміст — ВИДИМА діагностика, не тиша.
    #[test]
    fn detect_policy_pobytyi_vkhid_daie_vydymu_diahnostyku() {
        let cfg = cfg_of(CONCERN_JS_VSCODE_EXTENSIONS);
        let files = vec![source(VSCODE_EXTENSIONS_TARGET, "{ це не json")];
        let diagnostics = detect_policy(cfg, &files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_INPUT_INVALID_REASON);
    }

    // --- detect: js/package_json ---

    #[test]
    fn detect_js_package_json_lovyt_type_engines_i_eslint_config() {
        let cfg = cfg_of(CONCERN_JS_PACKAGE_JSON);
        let files = vec![source(
            ROOT_PACKAGE_JSON_TARGET,
            r#"{"name":"x","type":"commonjs","engines":{"node":">=20","bun":">=1.2"},"devDependencies":{"@nitra/eslint-config":"^3.1.0"}}"#,
        )];
        let messages: Vec<String> = detect_policy(cfg, &files)
            .into_iter()
            .map(|d| d.message)
            .collect();
        assert!(messages.iter().any(|m| m.contains("\"type\"")), "{messages:?}");
        assert!(
            messages.iter().any(|m| m.contains("engines.node")),
            "{messages:?}"
        );
        assert!(
            messages.iter().any(|m| m.contains("engines.bun")),
            "{messages:?}"
        );
        assert!(
            messages.iter().any(|m| m.contains("@nitra/eslint-config")),
            "{messages:?}"
        );
    }

    /// `@nitra/eslint-config` ВИЩЕ порогу — detect мовчить про нього
    /// (`eslint_config_meets_min` — саме `>=`, не рівність). Це та половина
    /// асиметрії, яку fix ламав.
    #[test]
    fn detect_js_package_json_vyshcha_versiia_eslint_config_ne_porushennia() {
        let cfg = cfg_of(CONCERN_JS_PACKAGE_JSON);
        let files = vec![source(
            ROOT_PACKAGE_JSON_TARGET,
            r#"{"type":"module","engines":{"node":">=24","bun":">=1.4"},"devDependencies":{"@nitra/eslint-config":"^3.20.0"}}"#,
        )];
        assert!(detect_policy(cfg, &files).is_empty());
    }

    /// `workspace:`-протокол задовольняє поріг завжди — окрема гілка rego,
    /// яку [`version_meets_min`] мусить відтворювати для фікс-боку.
    #[test]
    fn version_meets_min_vidtvoriuie_rego_helper() {
        assert!(version_meets_min("workspace:*", "^3.10.0"));
        assert!(version_meets_min("^3.20.0", "^3.10.0"));
        assert!(version_meets_min("^3.10.0", "^3.10.0"));
        assert!(version_meets_min("^4.0.0", "^3.10.0"));
        assert!(!version_meets_min("^3.9.9", "^3.10.0"));
        assert!(!version_meets_min("^3.10", "^3.10.0"), "менше трьох чисел");
        assert!(!version_meets_min("", "^3.10.0"));
    }

    // --- detect: npm-module + style ---

    #[test]
    fn detect_npm_package_json_vymahaie_files_types() {
        let cfg = cfg_of(CONCERN_NPM_PACKAGE_JSON);
        let files = vec![source(
            NPM_PACKAGE_JSON_TARGET,
            r#"{"types":"./types/index.d.ts","files":["dist"]}"#,
        )];
        let diagnostics = detect_policy(cfg, &files);
        assert!(
            diagnostics.iter().any(|d| d.message.contains("\"types\"")
                || d.message.contains("має містити \"types\"")),
            "{diagnostics:?}"
        );
        assert!(diagnostics
            .iter()
            .all(|d| d.file.as_deref() == Some(NPM_PACKAGE_JSON_TARGET)));
    }

    #[test]
    fn detect_root_package_json_vymahaie_workspaces_npm() {
        let cfg = cfg_of(CONCERN_ROOT_PACKAGE_JSON);
        let bad = vec![source(ROOT_PACKAGE_JSON_TARGET, r#"{"name":"root"}"#)];
        assert_eq!(detect_policy(cfg, &bad).len(), 1);
        let good = vec![source(
            ROOT_PACKAGE_JSON_TARGET,
            r#"{"name":"root","workspaces":["npm"]}"#,
        )];
        assert!(detect_policy(cfg, &good).is_empty());
    }

    #[test]
    fn detect_style_package_json_vymahaie_stylelint_config() {
        let cfg = cfg_of(CONCERN_STYLE_PACKAGE_JSON);
        let bad = vec![source(ROOT_PACKAGE_JSON_TARGET, r#"{"name":"x"}"#)];
        let diagnostics = detect_policy(cfg, &bad);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("@nitra/stylelint-config"));
        let good = vec![source(
            ROOT_PACKAGE_JSON_TARGET,
            r#"{"devDependencies":{"@nitra/stylelint-config":"^1.0.0"}}"#,
        )];
        assert!(detect_policy(cfg, &good).is_empty());
    }

    // --- fix: vscode_extensions ---

    #[test]
    fn fix_vscode_extensions_dopysuie_vidsutni_rekomendatsii_v_khvist() {
        let cfg = cfg_of(CONCERN_JS_VSCODE_EXTENSIONS);
        let request = FixRequest {
            concern_id: CONCERN_JS_VSCODE_EXTENSIONS.to_string(),
            files: vec![source(
                VSCODE_EXTENSIONS_TARGET,
                "{\n  \"recommendations\": [\n    \"local.only\"\n  ]\n}\n",
            )],
            diagnostics: vec![policy_deny(
                VSCODE_EXTENSIONS_TARGET,
                ".vscode/extensions.json: recommendations має містити \"oxc.oxc-vscode\" (js.mdc)",
            )],
        };
        let plan = vscode_extensions_fix(cfg, &request);
        let (path, content) = written(plan);
        assert_eq!(path, VSCODE_EXTENSIONS_TARGET);
        assert_eq!(
            content,
            "{\n  \"recommendations\": [\n    \"local.only\",\n    \"dbaeumer.vscode-eslint\",\n    \"oxc.oxc-vscode\"\n  ]\n}\n"
        );
    }

    /// Відсутній таргет + `policy-file-missing` → файл створюється.
    #[test]
    fn fix_vscode_extensions_stvoriuie_vidsutnii_fail() {
        let cfg = cfg_of(CONCERN_STYLE_VSCODE_EXTENSIONS);
        let request = FixRequest {
            concern_id: CONCERN_STYLE_VSCODE_EXTENSIONS.to_string(),
            files: vec![],
            diagnostics: vec![Diagnostic {
                reason: POLICY_FILE_MISSING_REASON.to_string(),
                message: ".vscode/extensions.json не існує".to_string(),
                file: Some(VSCODE_EXTENSIONS_TARGET.to_string()),
                severity: Severity::Error,
                data: None,
            }],
        };
        let (_, content) = written(vscode_extensions_fix(cfg, &request));
        assert_eq!(
            content,
            "{\n  \"recommendations\": [\n    \"stylelint.vscode-stylelint\"\n  ]\n}\n"
        );
    }

    /// Ідемпотентність: усе на місці → порожній план (жодного зайвого
    /// переформатування файлу).
    #[test]
    fn fix_vscode_extensions_idempotentnyi() {
        let cfg = cfg_of(CONCERN_JS_VSCODE_EXTENSIONS);
        let request = FixRequest {
            concern_id: CONCERN_JS_VSCODE_EXTENSIONS.to_string(),
            files: vec![source(
                VSCODE_EXTENSIONS_TARGET,
                r#"{"recommendations":["dbaeumer.vscode-eslint","oxc.oxc-vscode"]}"#,
            )],
            diagnostics: vec![policy_deny(VSCODE_EXTENSIONS_TARGET, "extensions.json")],
        };
        assert!(vscode_extensions_fix(cfg, &request).edits.is_empty());
    }

    /// Побитий вміст — порожній план (не перезаписуємо сміття «канонічним»
    /// файлом; порушення лишається видимим у звіті).
    #[test]
    fn fix_vscode_extensions_ne_chipaie_pobytyi_fail() {
        let cfg = cfg_of(CONCERN_JS_VSCODE_EXTENSIONS);
        let request = FixRequest {
            concern_id: CONCERN_JS_VSCODE_EXTENSIONS.to_string(),
            files: vec![source(VSCODE_EXTENSIONS_TARGET, "[1,2,3]")],
            diagnostics: vec![policy_deny(VSCODE_EXTENSIONS_TARGET, "extensions.json")],
        };
        assert!(vscode_extensions_fix(cfg, &request).edits.is_empty());
    }

    /// Повний T0-цикл: детект → фікс → детект чистий.
    #[test]
    fn vscode_extensions_t0_tsykl_zamykaietsia() {
        let cfg = cfg_of(CONCERN_JS_VSCODE_EXTENSIONS);
        let before = vec![source(VSCODE_EXTENSIONS_TARGET, "{}\n")];
        let diagnostics = detect_policy(cfg, &before);
        assert_eq!(diagnostics.len(), 2);
        let request = FixRequest {
            concern_id: CONCERN_JS_VSCODE_EXTENSIONS.to_string(),
            files: before,
            diagnostics,
        };
        let (_, content) = written(vscode_extensions_fix(cfg, &request));
        let after = vec![source(VSCODE_EXTENSIONS_TARGET, &content)];
        assert!(detect_policy(cfg, &after).is_empty());
    }

    // --- fix: template-deep-merge ---

    /// ГОЛОВНИЙ гейт §2.78: detect/fix-асиметрія `js/package_json`.
    ///
    /// Канон на цьому вході мерджить лист `@nitra/eslint-config` ТОЧНОЮ
    /// рівністю і збиває `^3.20.0` назад на `^3.10.0`. Порт цього не робить:
    /// фактична версія вже задовольняє поріг, тож лишається на місці, а
    /// правиться рівно те, через що концерн червоний.
    #[test]
    fn js_package_json_fix_ne_znyzhuie_vyshchu_versiiu_eslint_config() {
        let cfg = template_fix_cfg(CONCERN_JS_PACKAGE_JSON).expect("конфіг");
        let before = r#"{
  "name": "x",
  "type": "commonjs",
  "devDependencies": {
    "@nitra/eslint-config": "^3.20.0"
  }
}
"#;
        let request = FixRequest {
            concern_id: CONCERN_JS_PACKAGE_JSON.to_string(),
            files: vec![source(ROOT_PACKAGE_JSON_TARGET, before)],
            diagnostics: vec![policy_deny(
                ROOT_PACKAGE_JSON_TARGET,
                "package.json: \"type\" має бути \"module\" (js.mdc)",
            )],
        };
        let (_, content) = written(template_merge_fix(cfg, &request));
        assert!(
            content.contains("\"@nitra/eslint-config\": \"^3.20.0\""),
            "версію збито назад на поріг — рівно той дефект канону, який порт лагодить:\n{content}"
        );
        assert!(content.contains("\"type\": \"module\""), "{content}");
    }

    /// Друга половина того самого: версія НИЖЧА за поріг — тоді мерж
    /// ЗОБОВʼЯЗАНИЙ підтягнути її до канону.
    #[test]
    fn js_package_json_fix_pidtiahuie_nyzhchu_versiiu_do_porohu() {
        let cfg = template_fix_cfg(CONCERN_JS_PACKAGE_JSON).expect("конфіг");
        let request = FixRequest {
            concern_id: CONCERN_JS_PACKAGE_JSON.to_string(),
            files: vec![source(
                ROOT_PACKAGE_JSON_TARGET,
                "{\n  \"type\": \"module\",\n  \"devDependencies\": {\n    \"@nitra/eslint-config\": \"^3.1.0\"\n  }\n}\n",
            )],
            diagnostics: vec![policy_deny(ROOT_PACKAGE_JSON_TARGET, "package.json")],
        };
        let (_, content) = written(template_merge_fix(cfg, &request));
        assert!(
            content.contains("\"@nitra/eslint-config\": \"^3.10.0\""),
            "{content}"
        );
    }

    /// `workspace:`-протокол теж задовольняє поріг — і теж не збивається.
    #[test]
    fn js_package_json_fix_ne_chipaie_workspace_protokol() {
        let cfg = template_fix_cfg(CONCERN_JS_PACKAGE_JSON).expect("конфіг");
        let request = FixRequest {
            concern_id: CONCERN_JS_PACKAGE_JSON.to_string(),
            files: vec![source(
                ROOT_PACKAGE_JSON_TARGET,
                "{\n  \"type\": \"commonjs\",\n  \"devDependencies\": {\n    \"@nitra/eslint-config\": \"workspace:*\"\n  }\n}\n",
            )],
            diagnostics: vec![policy_deny(ROOT_PACKAGE_JSON_TARGET, "package.json")],
        };
        let (_, content) = written(template_merge_fix(cfg, &request));
        assert!(content.contains("\"workspace:*\""), "{content}");
    }

    /// Порядок ключів документа зберігається (не сортується) — інакше кожен
    /// фікс перетасував би весь `package.json`.
    #[test]
    fn template_merge_fix_zberihaie_poriadok_kliuchiv() {
        let cfg = template_fix_cfg(CONCERN_ROOT_PACKAGE_JSON).expect("конфіг");
        let request = FixRequest {
            concern_id: CONCERN_ROOT_PACKAGE_JSON.to_string(),
            files: vec![source(
                ROOT_PACKAGE_JSON_TARGET,
                "{\n  \"zzz\": 1,\n  \"name\": \"root\",\n  \"aaa\": 2\n}\n",
            )],
            diagnostics: vec![policy_deny(ROOT_PACKAGE_JSON_TARGET, "package.json")],
        };
        let (_, content) = written(template_merge_fix(cfg, &request));
        let zzz = content.find("\"zzz\"").expect("zzz");
        let name = content.find("\"name\"").expect("name");
        let aaa = content.find("\"aaa\"").expect("aaa");
        assert!(zzz < name && name < aaa, "порядок перетасовано:\n{content}");
        assert!(content.contains("\"workspaces\""), "{content}");
    }

    /// Ідемпотентність: snippet уже задовольняється → порожній план, БЕЗ
    /// переформатування (компактний однорядковий файл лишається компактним).
    #[test]
    fn template_merge_fix_idempotentnyi_bez_reformatu() {
        let cfg = template_fix_cfg(CONCERN_STYLE_PACKAGE_JSON).expect("конфіг");
        let request = FixRequest {
            concern_id: CONCERN_STYLE_PACKAGE_JSON.to_string(),
            files: vec![source(
                ROOT_PACKAGE_JSON_TARGET,
                r#"{"stylelint":{"extends":"@nitra/stylelint-config"}}"#,
            )],
            diagnostics: vec![policy_deny(ROOT_PACKAGE_JSON_TARGET, "package.json")],
        };
        assert!(template_merge_fix(cfg, &request).edits.is_empty());
    }

    /// Немає діагностики про таргет → порожній план (порт
    /// `violations.every(v => v.file !== targetPath)`).
    #[test]
    fn template_merge_fix_bez_diahnostyky_pro_target_movchyt() {
        let cfg = template_fix_cfg(CONCERN_NPM_PACKAGE_JSON).expect("конфіг");
        let request = FixRequest {
            concern_id: CONCERN_NPM_PACKAGE_JSON.to_string(),
            files: vec![source(NPM_PACKAGE_JSON_TARGET, "{}")],
            diagnostics: vec![policy_deny("other/package.json", "щось інше")],
        };
        assert!(template_merge_fix(cfg, &request).edits.is_empty());
    }

    /// Файлу немає в батчі → snippet копіюється БАЙТ-У-БАЙТ (порт
    /// `writeFileSync(absTarget, rawSnippet)`).
    #[test]
    fn template_merge_fix_kopiiuie_snippet_verbatim_na_vidsutnii_fail() {
        let cfg = template_fix_cfg(CONCERN_NPM_PACKAGE_JSON).expect("конфіг");
        let request = FixRequest {
            concern_id: CONCERN_NPM_PACKAGE_JSON.to_string(),
            files: vec![],
            diagnostics: vec![policy_deny(NPM_PACKAGE_JSON_TARGET, "npm/package.json")],
        };
        let (path, content) = written(template_merge_fix(cfg, &request));
        assert_eq!(path, NPM_PACKAGE_JSON_TARGET);
        assert_eq!(content, cfg.snippet_raw);
    }

    /// Побитий/не-обʼєктний вміст — не чіпаємо (дані користувача важливіші
    /// за «канонічний» перезапис; порушення лишається видимим).
    #[test]
    fn template_merge_fix_ne_chipaie_pobytyi_fail() {
        let cfg = template_fix_cfg(CONCERN_ROOT_PACKAGE_JSON).expect("конфіг");
        let request = FixRequest {
            concern_id: CONCERN_ROOT_PACKAGE_JSON.to_string(),
            files: vec![source(ROOT_PACKAGE_JSON_TARGET, "[1, 2]")],
            diagnostics: vec![policy_deny(ROOT_PACKAGE_JSON_TARGET, "package.json")],
        };
        assert!(template_merge_fix(cfg, &request).edits.is_empty());
    }

    /// Повний T0-цикл КОЖНОГО template-merge-концерну: детект → фікс →
    /// детект чистий. Саме це доводить, що фікс гасить РІВНО те, що світить
    /// детект (а не «щось пише і йде»).
    #[test]
    fn template_merge_t0_tsykl_zamykaietsia_dlia_vsikh() {
        let starts: &[(&str, &str)] = &[
            (
                CONCERN_JS_PACKAGE_JSON,
                r#"{"name":"x","type":"commonjs","engines":{"node":">=24","bun":">=1.4"}}"#,
            ),
            (CONCERN_NPM_PACKAGE_JSON, r#"{"types":"./types/index.d.ts","files":["dist"]}"#),
            (CONCERN_ROOT_PACKAGE_JSON, r#"{"name":"root"}"#),
            // `stylelint.extends` розійшовся з каноном — саме та половина
            // `style/package_json`, що КЕРУЄТЬСЯ snippet-ом. Друга половина
            // (`@nitra/stylelint-config` у devDependencies) — inverse-правило
            // без template-значення, і template-фікс її задовольнити не може
            // НІ в каноні, ні тут (snippet її просто не містить): цикл
            // замикається лише для snippet-керованих порушень, і фікстура це
            // фіксує явно, а не ховає.
            (
                CONCERN_STYLE_PACKAGE_JSON,
                r#"{"devDependencies":{"@nitra/stylelint-config":"^1.0.0"},"stylelint":{"extends":"wrong"}}"#,
            ),
            // --- §2.80 ---
            (CONCERN_STYLE_VSCODE_SETTINGS, r#"{"css.validate":true}"#),
            // `minLines` ВИЩИЙ за поріг + бракує `ignore` і правильного
            // `gitignore`: цикл мусить замкнутись, НЕ збивши 40 назад на 25.
            (
                CONCERN_JSCPD_CONFIG,
                r#"{"gitignore":false,"exitCode":1,"reporters":["console"],"minLines":40}"#,
            ),
            (CONCERN_EMIT_TYPES_CONFIG, r#"{"compilerOptions":{"allowJs":false}}"#),
        ];
        for (key, before) in starts {
            let policy = cfg_of(key);
            let fix_cfg = template_fix_cfg(key).expect("конфіг");
            let files = vec![source(fix_cfg.target, before)];
            let diagnostics = detect_policy(policy, &files);
            assert!(!diagnostics.is_empty(), "{key}: очікували порушення");
            let request = FixRequest {
                concern_id: (*key).to_string(),
                files,
                diagnostics,
            };
            let plan = template_merge_fix(fix_cfg, &request);
            let (_, content) = written(plan);
            let after = vec![source(fix_cfg.target, &content)];
            assert!(
                detect_policy(policy, &after).is_empty(),
                "{key}: після фіксу детект мусить мовчати, отримали:\n{content}"
            );
        }
    }

    // --- §2.80: `js-run/jsconfig` (walkGlob) ---

    /// Мінімальний `jsconfig.json`, що вже задовольняє канон — база фікстур.
    const JSCONFIG_CANON: &str = r#"{
  "compilerOptions": {
    "lib": ["esnext"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "esnext",
    "checkJs": false
  },
  "include": ["src/**/*"]
}
"#;

    /// `walkGlob`-форма бачить УСІ `jsconfig.json` батчу, не лише кореневий, і
    /// кожна діагностика несе СВІЙ файл — без цього фікс писав би не туди.
    #[test]
    fn jsconfig_detect_okhoplue_vsi_faily_dereva() {
        let cfg = cfg_of(CONCERN_JSCONFIG);
        let files = vec![
            source("jsconfig.json", r#"{"compilerOptions":{"target":"es2020"}}"#),
            source("packages/a/jsconfig.json", JSCONFIG_CANON),
            source("packages/b/jsconfig.json", r#"{"include":["lib/**/*"]}"#),
            // Не-таргет із того самого батчу: глоб контрибуції може бути
            // ширшим за таргет, і звуження за basename мусить це витримати.
            source("package.json", r#"{"name":"x"}"#),
        ];
        let diagnostics = detect_policy(cfg, &files);
        let flagged: Vec<&str> = diagnostics
            .iter()
            .filter_map(|d| d.file.as_deref())
            .collect();
        assert!(flagged.contains(&"jsconfig.json"), "{flagged:?}");
        assert!(flagged.contains(&"packages/b/jsconfig.json"), "{flagged:?}");
        assert!(
            !flagged.contains(&"packages/a/jsconfig.json"),
            "канонічний файл не мав дати жодної діагностики: {flagged:?}"
        );
        assert!(!flagged.contains(&"package.json"), "{flagged:?}");
    }

    /// Відсутність файлів `walkGlob`-концерну — ТИША: `required` у канону
    /// прив'язаний до `files.single`, тож іншої гілки тут не існує.
    #[test]
    fn jsconfig_detect_movchyt_koly_faily_vidsutni() {
        let cfg = cfg_of(CONCERN_JSCONFIG);
        let files = vec![source("package.json", "{}")];
        assert!(detect_policy(cfg, &files).is_empty());
    }

    /// Повний T0-цикл `js-run/jsconfig` на ДВОХ файлах одразу: детект → фікс
    /// → детект чистий на обох.
    #[test]
    fn jsconfig_t0_tsykl_zamykaietsia_dlia_kilkokh_failiv() {
        let cfg = cfg_of(CONCERN_JSCONFIG);
        let files = vec![
            source("jsconfig.json", r#"{"compilerOptions":{"target":"es2020"}}"#),
            source("packages/b/jsconfig.json", r#"{"include":["lib/**/*"]}"#),
        ];
        let diagnostics = detect_policy(cfg, &files);
        assert!(!diagnostics.is_empty());
        let plan = jsconfig_fix(&FixRequest {
            concern_id: CONCERN_JSCONFIG.to_string(),
            files,
            diagnostics,
        });
        assert_eq!(plan.edits.len(), 2, "обидва файли мали бути виправлені");
        let after: Vec<SourceFile> = plan
            .edits
            .into_iter()
            .map(|edit| match edit {
                FileEdit::Write(w) => source(&w.path, &w.content),
                other => panic!("очікували Write, отримали {other:?}"),
            })
            .collect();
        let rest = detect_policy(cfg, &after);
        assert!(
            rest.is_empty(),
            "після фіксу детект мусить мовчати, отримали: {rest:?}"
        );
    }

    /// Top-level масив ЗАМІНЮЄТЬСЯ, а не мерджиться union-ом: детект
    /// порівнює його як множину на РІВНІСТЬ, тож union лишив би концерн
    /// червоним назавжди (доккомент [`jsconfig_merge_snippet`]).
    #[test]
    fn jsconfig_fix_zaminiuie_masyv_a_ne_merdzhyt_unionom() {
        let cfg = cfg_of(CONCERN_JSCONFIG);
        let before = r#"{"compilerOptions":{"lib":["esnext"],"module":"NodeNext","moduleResolution":"NodeNext","target":"esnext","checkJs":false},"include":["src/**/*","legacy/**/*"]}"#;
        let files = vec![source("jsconfig.json", before)];
        let diagnostics = detect_policy(cfg, &files);
        assert!(!diagnostics.is_empty(), "зайвий елемент мав дати deny");
        let plan = jsconfig_fix(&FixRequest {
            concern_id: CONCERN_JSCONFIG.to_string(),
            files,
            diagnostics,
        });
        let (_, content) = written(plan);
        assert!(!content.contains("legacy/**/*"), "{content}");
        assert!(
            detect_policy(cfg, &[source("jsconfig.json", &content)]).is_empty(),
            "{content}"
        );
    }

    /// JSONC-вхід: канон валився на `JSON.parse` і мовчки нічого не робив —
    /// порт читає його й ФІКСИТЬ (полагоджений дефект канону).
    #[test]
    fn jsconfig_fix_pratsiuie_na_jsonc_vkhodi() {
        let cfg = cfg_of(CONCERN_JSCONFIG);
        let before = "{\n  // vscode дозволяє коментарі тут\n  \"compilerOptions\": { \"target\": \"es2020\" },\n}\n";
        let files = vec![source("jsconfig.json", before)];
        let diagnostics = detect_policy(cfg, &files);
        assert!(!diagnostics.is_empty());
        let plan = jsconfig_fix(&FixRequest {
            concern_id: CONCERN_JSCONFIG.to_string(),
            files,
            diagnostics,
        });
        let (_, content) = written(plan);
        assert!(
            detect_policy(cfg, &[source("jsconfig.json", &content)]).is_empty(),
            "{content}"
        );
    }

    /// Ідемпотентність: на вже канонічному файлі план порожній.
    #[test]
    fn jsconfig_fix_idempotentnyi() {
        let cfg = cfg_of(CONCERN_JSCONFIG);
        let files = vec![source("jsconfig.json", JSCONFIG_CANON)];
        assert!(detect_policy(cfg, &files).is_empty());
        let plan = jsconfig_fix(&FixRequest {
            concern_id: CONCERN_JSCONFIG.to_string(),
            files,
            diagnostics: vec![policy_deny("jsconfig.json", "jsconfig.json: щось")],
        });
        assert!(plan.edits.is_empty());
    }

    // --- §2.80: `js/jscpd_config` — поріг `minLines` ---

    /// Дзеркало [`js_package_json_fix_ne_znyzhuie_vyshchu_versiiu_eslint_config`]
    /// для ЧИСЛОВОГО порогу: детект вимагає `minLines >= 25`, тож фікс не
    /// сміє збивати 40 назад на 25.
    #[test]
    fn jscpd_config_fix_ne_znyzhuie_vyshchyi_min_lines() {
        let cfg = template_fix_cfg(CONCERN_JSCPD_CONFIG).expect("конфіг");
        let before = r#"{"gitignore":false,"exitCode":1,"reporters":["console"],"minLines":40}"#;
        let request = FixRequest {
            concern_id: CONCERN_JSCPD_CONFIG.to_string(),
            files: vec![source(JSCPD_CONFIG_TARGET, before)],
            diagnostics: vec![policy_deny(
                JSCPD_CONFIG_TARGET,
                ".jscpd.json має містити \"gitignore\": true (js.mdc)",
            )],
        };
        let (_, content) = written(template_merge_fix(cfg, &request));
        assert!(
            content.contains("\"minLines\": 40"),
            "поріг збито назад — рівно той дефект канону, який порт лагодить:\n{content}"
        );
        assert!(content.contains("\"gitignore\": true"), "{content}");
    }

    /// Нижчий за поріг `minLines` — навпаки, підтягується до канону.
    #[test]
    fn jscpd_config_fix_pidtiahuie_nyzhchyi_min_lines() {
        let cfg = template_fix_cfg(CONCERN_JSCPD_CONFIG).expect("конфіг");
        let request = FixRequest {
            concern_id: CONCERN_JSCPD_CONFIG.to_string(),
            files: vec![source(
                JSCPD_CONFIG_TARGET,
                r#"{"gitignore":true,"exitCode":1,"reporters":["console"],"minLines":5}"#,
            )],
            diagnostics: vec![policy_deny(JSCPD_CONFIG_TARGET, ".jscpd.json")],
        };
        let (_, content) = written(template_merge_fix(cfg, &request));
        assert!(content.contains("\"minLines\": 25"), "{content}");
    }

    /// Зайвий (не канонічний) `reporters`-елемент переживає фікс: детект
    /// вимагає масив як SUBSET, і union-мерж [`merge_json_value`] це шанує.
    #[test]
    fn jscpd_config_fix_zberihaie_chuzhyi_reporter() {
        let cfg = template_fix_cfg(CONCERN_JSCPD_CONFIG).expect("конфіг");
        let request = FixRequest {
            concern_id: CONCERN_JSCPD_CONFIG.to_string(),
            files: vec![source(
                JSCPD_CONFIG_TARGET,
                r#"{"gitignore":false,"exitCode":1,"reporters":["json"],"minLines":25}"#,
            )],
            diagnostics: vec![policy_deny(JSCPD_CONFIG_TARGET, ".jscpd.json")],
        };
        let (_, content) = written(template_merge_fix(cfg, &request));
        assert!(content.contains("\"json\""), "{content}");
        assert!(content.contains("\"console\""), "{content}");
    }

    /// Відсутній `.jscpd.json` (`required: true`) — детект дає
    /// `policy-file-missing`, фікс кладе snippet ВЕРБАТИМ, і цикл
    /// замикається.
    #[test]
    fn jscpd_config_scaffold_vidsutnoho_faila() {
        let policy = cfg_of(CONCERN_JSCPD_CONFIG);
        let fix_cfg = template_fix_cfg(CONCERN_JSCPD_CONFIG).expect("конфіг");
        let files = vec![source("package.json", "{}")];
        let diagnostics = detect_policy(policy, &files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, POLICY_FILE_MISSING_REASON);
        let request = FixRequest {
            concern_id: CONCERN_JSCPD_CONFIG.to_string(),
            files,
            diagnostics,
        };
        let (path, content) = written(template_merge_fix(fix_cfg, &request));
        assert_eq!(path, JSCPD_CONFIG_TARGET);
        assert_eq!(content, fix_cfg.snippet_raw);
        assert!(detect_policy(policy, &[source(JSCPD_CONFIG_TARGET, &content)]).is_empty());
    }

    // --- §2.80: `style/tooling` (FS-патерни) ---

    /// Повний T0-цикл `style/tooling` з ПОРОЖНЬОГО стану: немає ні
    /// `.stylelintignore`, ні поля `stylelint` — фікс мусить закрити обидві
    /// діагностики одним планом.
    #[test]
    fn style_tooling_t0_tsykl_zamykaietsia() {
        let files = vec![source(ROOT_PACKAGE_JSON_TARGET, "{\n  \"name\": \"x\"\n}\n")];
        let diagnostics = detect_style_tooling(&files);
        assert_eq!(diagnostics.len(), 2, "{diagnostics:?}");
        let plan = fix_style_tooling(&FixRequest {
            concern_id: CONCERN_STYLE_TOOLING.to_string(),
            files,
            diagnostics,
        });
        let after: Vec<SourceFile> = plan
            .edits
            .into_iter()
            .map(|edit| match edit {
                FileEdit::Write(w) => source(&w.path, &w.content),
                other => panic!("очікували Write, отримали {other:?}"),
            })
            .collect();
        assert_eq!(after.len(), 2, "{after:?}");
        let rest = detect_style_tooling(&after);
        assert!(rest.is_empty(), "{rest:?}");
    }

    /// `.stylelintignore` є, але без `dist/` — дозапис, а не перезапис:
    /// чужі рядки мусять вижити.
    #[test]
    fn style_tooling_fix_dopysuie_dist_zberihaiuchy_chuzhi_riadky() {
        let files = vec![
            source(ROOT_PACKAGE_JSON_TARGET, r#"{"stylelint":{"extends":"x"}}"#),
            source(STYLELINTIGNORE_TARGET, "vendor/\n"),
        ];
        let diagnostics = detect_style_tooling(&files);
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let plan = fix_style_tooling(&FixRequest {
            concern_id: CONCERN_STYLE_TOOLING.to_string(),
            files,
            diagnostics,
        });
        let (path, content) = written(plan);
        assert_eq!(path, STYLELINTIGNORE_TARGET);
        assert!(content.contains("vendor/"), "{content}");
        assert!(content.contains("dist/"), "{content}");
    }

    /// Полагоджений дефект канону: `"stylelint"` НЕ-обʼєкт. Детект такий
    /// конфіг за наявний не вважає, а канонний фікс виходив на будь-якому
    /// truthy-значенні — концерн не сходився ніколи.
    #[test]
    fn style_tooling_fix_perekryvaie_ne_obiektnyi_stylelint() {
        let files = vec![
            source(ROOT_PACKAGE_JSON_TARGET, "{\n  \"stylelint\": \"wrong\"\n}\n"),
            source(STYLELINTIGNORE_TARGET, "dist/\n"),
        ];
        let diagnostics = detect_style_tooling(&files);
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let plan = fix_style_tooling(&FixRequest {
            concern_id: CONCERN_STYLE_TOOLING.to_string(),
            files,
            diagnostics,
        });
        let (path, content) = written(plan);
        assert_eq!(path, ROOT_PACKAGE_JSON_TARGET);
        assert!(content.contains("@nitra/stylelint-config"), "{content}");
        assert!(
            detect_style_tooling(&[
                source(ROOT_PACKAGE_JSON_TARGET, &content),
                source(STYLELINTIGNORE_TARGET, "dist/\n"),
            ])
            .is_empty(),
            "{content}"
        );
    }

    /// Наявне обʼєктне поле `stylelint` фікс не чіпає взагалі — детект на
    /// нього й не світить, тож жодного запису бути не може.
    #[test]
    fn style_tooling_fix_ne_chipaie_naiavnyi_konfih() {
        let files = vec![
            source(
                ROOT_PACKAGE_JSON_TARGET,
                r#"{"stylelint":{"extends":"@nitra/stylelint-config"}}"#,
            ),
            source(STYLELINTIGNORE_TARGET, "dist/\n"),
        ];
        assert!(detect_style_tooling(&files).is_empty());
        let plan = fix_style_tooling(&FixRequest {
            concern_id: CONCERN_STYLE_TOOLING.to_string(),
            files,
            diagnostics: vec![],
        });
        assert!(plan.edits.is_empty());
    }

    // --- style/lint: набір розширень ---

    /// Дзеркало знятого §2.93 JS-тесту `filterStyleFiles`
    /// (`plugins/lang-js/rules/style/tests/main.test.mjs`): той самий вхід,
    /// той самий очікуваний вихід. Тест НЕ про exec-tool-сценарій (його
    /// покриває `wasm-plugin-parity.test.mjs`), а рівно про те, що набір
    /// розширень не поповз.
    #[test]
    fn is_style_path_mirrors_filter_style_files() {
        let input = ["a.css", "b.scss", "c.vue", "d.js"];
        let kept: Vec<&str> = input
            .into_iter()
            .filter(|path| is_style_path(path))
            .collect();
        assert_eq!(kept, vec!["a.css", "b.scss", "c.vue"]);
        // Розширення — суфікс, не підрядок: `styles.cssx` не стиль.
        assert!(!is_style_path("styles.cssx"));
        assert!(!is_style_path("vue"));
    }
}
