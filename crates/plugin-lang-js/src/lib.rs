//! wasm-компонент `n-rules:plugin@3.0.0` — `lang-js/wasm-concerns` (задачі N2
//! та Q1 батч 1, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
//! §3.5.5), створений за флоу скіла `npm/skills/wasm-plugin/` (scaffold →
//! реалізація → golden-тести). Сім концернів, порт чинних JS-оригіналів 1:1
//! (той самий `reason`/`message` біт-у-біт):
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
//!
//! JS-реалізації лишаються канонічними (Plugin API v2, дистрибуція wasm —
//! окремий крок) — цей компонент лише переносить логіку в native/wasm шлях,
//! parity-тест `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs`
//! ганяє ОДНІ фікстури через обидві реалізації.
//!
//! # Сім концернів в одному Guest — мотив із `test-plugin-guest`
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

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

use std::collections::BTreeSet;

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

/// Guest-реалізація world `plugin` — сім контрибуцій ([`CONCERN_TFM`],
/// [`CONCERN_GAP`], [`CONCERN_POOL_FORKS`], [`CONCERN_NO_PROCESS_CHDIR`],
/// [`CONCERN_ADMIN_TABLE`], [`CONCERN_QUASAR_FIXES`], [`CONCERN_LOCATION`]).
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

    // --- маніфест ---

    #[test]
    fn build_manifest_declares_all_seven_concerns_with_expected_scopes() {
        let manifest = build_manifest();
        assert_eq!(manifest.concerns.len(), 7);
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
        ] {
            let contribution = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .unwrap_or_else(|| panic!("{key} contribution має бути в маніфесті"));
            assert_eq!(contribution.scope, ConcernScope::Full);
            assert!(!contribution.glob.is_empty());
        }
        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
        assert_eq!(manifest.domains, vec![Domain::Lint]);
    }
}
