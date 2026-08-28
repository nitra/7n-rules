//! wasm-компонент `n-rules:plugin@3.1.0` — `ci-github/wasm-concerns`, П'ЯТИЙ
//! first-party wasm-гість репозиторію (перший — `crates/plugin-lang-js`,
//! другий — `crates/plugin-lang-python`, третій — `crates/plugin-lang-rust`,
//! четвертий — `crates/plugin-lang-php`, доккомент того `src/lib.rs` пояснює
//! форму), створений за тим самим флоу скіла `npm/skills/wasm-plugin/`.
//! ПЕРШИЙ НЕ-lang first-party гість — плагін-джерело `@7n/rules-ci-github`
//! (`plugins/ci-github/`), доккомент `plugin.toml` пояснює вибір `id`.
//!
//! ПЕРША хвиля: рівно ОДИН концерн, `rust/toolchain_cache`, порт
//! `plugins/ci-github/rules/rust/toolchain_cache/main.mjs` (181 рядок) —
//! [`detect_toolchain_cache`].
//!
//! ДРУГА хвиля (цей блок): `ga/workflows`, порт
//! `plugins/ci-github/rules/ga/workflows/main.mjs` (446 рядків) —
//! [`detect_workflows`]. Найбільший один концерн усієї міграції: пʼять
//! зовнішніх tool-інтеграцій (`git`/`github-actionlint`/`uvx zizmor`/
//! `shellcheck`-проба, доккомент розділу «Чотири зовнішні тули» нижче) плюс
//! 851 рядок Rego (пʼять `.rego`-пакетів у `plugins/ci-github/rules/ga/`),
//! який виконується IN-PROCESS через [`regorus`] (Microsoft, MIT AND
//! Apache-2.0 AND BSD-3-Clause) — жодного `conftest`-субпроцесу (доккомент
//! розділу «Regorus замість conftest» нижче). `ci_artifact/consume` і решта
//! `ga/*`-каталогів із власними `.rego` (вони НЕ окремі `ruleId/concernId`
//! контрибуції — вшиті сюди як внутрішні rego-namespace-и) лишаються поза
//! обсягом.
//!
//! # Regorus замість conftest
//!
//! П'ять policy-файлів (`clean_ga_workflows`/`clean_merged_branch`/
//! `lint_ga`/`git_ai`/`workflow_common`) вшиті `include_str!` НАПРЯМУ з
//! `plugins/ci-github/rules/ga/<name>/<name>.rego` — джерело правди
//! лишається Rego, не Rust-парафраз (той самий мотив, що `BLUE_OAK_SNAPSHOT_JSON`
//! у `crates/plugin-lang-python`/`RULE_MAIN_JSON` у `crates/plugin-lang-rust`).
//! Rego вже підготовлений parser-агностично (окрема підготовча задача на цій
//! гілці, ДО цього порту): пʼять `%q`→`\"%v\"` (regorus відкидає `%q` як
//! HARD RUNTIME ERROR, не тихий деградейшн — байт-у-байт доведено під
//! conftest, що обидва дають ідентичний рядок) і три
//! `gha_on := object.get(input, "on", object.get(input, "true", {}))`
//! (conftest парсить YAML 1.1, де голий `on:` стає булевим ключем `"true"`;
//! будь-який YAML 1.2-парсер — і наш [`saphyr`], і `yaml` npm-пакет канону —
//! дає рядок `"on"`). Це друге застереження в порту фактично MOOT: наш
//! `input` парситься ЗАВЖДИ через [`saphyr`] (YAML 1.2), тож гілка
//! `object.get(input, "true", {})` структурно недосяжна тут (на відміну від
//! `conftest`, де це реальний рантайм-канал) —лишена в Rego як є, бо
//! джерело спільне з живим JS-каноном (conftest і далі читає YAML 1.1 у 55
//! `conftest verify`-тестах).
//!
//! regorus дає РІВНО один `input` на `Engine` за раз — батчинг `conftest`
//! (один спавн на весь список файлів) замінено явним Rust-циклом
//! `set_input` + `eval_rule` per file, ім'я файлу трекається Rust-боку (не
//! в самому Rego). Мапінг на 5 окремих `Engine` дзеркалить 5 окремих
//! спавнів conftest канону (`GA_PER_WORKFLOW_REGO_TARGETS` + один батч-виклик
//! `workflow_common`, `main.mjs:301-377`) — порядок `data`-merge лишається
//! однозначним: кожен `Engine` бачить РІВНО один policy + один data-документ.
//!
//! # `--data` template merge → `Value::from_json_str` + `add_data_json`
//!
//! Кожен з чотирьох per-workflow policy-пакетів очікує канон через
//! `data.template.snippet.*` (доккомент кожного `.rego`) — конон будує це
//! з `template/<workflow>.yml.snippet.yml` через `loadTemplate()`
//! (`npm/scripts/lib/template.mjs`) і передає `conftest --data <tmpfile>`
//! із вмістом `{"template": {"snippet": <parsed YAML>}}`. Порт відтворює
//! РІВНО ту саму JSON-форму: пʼять шаблонних файлів (чотири `.yml.snippet.yml`
//! та один `uses-min-versions.snippet.json` для `workflow_common`) вшиті
//! `include_str!` (той самий мотив, що самі `.rego`), розпарсені ОДИН раз
//! через [`saphyr`] (JSON — валідний YAML 1.2, тож той самий парсер працює
//! для обох розширень без окремого JSON-крейта), обгорнуті в
//! `{"template":{"snippet": …}}` і подані через `Engine::add_data_json`
//! ([`build_rego_templates`]).
//!
//! # Чотири зовнішні тули
//!
//! `manifest.tools` (доккомент `plugin.toml`) — `path:git` (`git ls-files`,
//! `main.mjs:65`), `npm:github-actionlint` (канон спавнить
//! `bunx github-actionlint`, `main.mjs:401` — порт резолвить бін напряму
//! через npm:-схему, той самий бінарник, недослівна відмінність — звіт
//! задачі), `path:uvx` (канон спавнить `uvx zizmor …`, `main.mjs:404`),
//! `shellcheck` (bare/managed-схема — канон керує через
//! `ensureTool('shellcheck')`, `main.mjs:398`, не голий `resolveCmd`).
//! `conftest`-декларація канону (`ensureTool('conftest')`, `main.mjs:399`)
//! СВІДОМО відсутня в порту — regorus замінює субпроцес.
//!
//! # `ci_artifact/consume` і решта `ga/*` — поза обсягом
//!
//! Не чіпай їх у цьому крейті без нової задачі.
//!
//! # Текстовий, не YAML-AST аналіз — навмисне рішення канону, збережене тут
//!
//! JS-оригінал (доккомент модуля `main.mjs:11-15`) свідомо аналізує
//! workflow-файли РЯДКАМИ й відступами, а не через YAML-парсер — мінімізує
//! diff і не залежить від того, чи canonical formatter зберігає коментарі
//! при round-trip через YAML. Порт зберігає ту саму форму: жодного
//! YAML-крейта серед залежностей, лише [`scan_toolchain_steps`] (рядки +
//! indentation) — той самий мотив, що задокументовано в задачі, яка
//! готувала цю хвилю.
//!
//! # Чотири патерни канону — портовані вручну, без regex-крейта
//!
//! `TOOLCHAIN_RE`/`CACHE_RE`/`TAURI_ACTION_RE` (усі — `uses:\s*<owner>/<repo>@`,
//! незаякорені, будь-де в рядку) і `WORKSPACES_KEY_RE` (`^\s*workspaces\s*:`,
//! заякорений на початок рядка) — жоден не має lookaround/backreference, і
//! жоден не використовує `\w`/`\d` (лише `\s`, семантика якого в Rust і JS
//! regex-двигунах збігається для звичайного ASCII/латинського тексту —
//! перевірено юніт-тестом на нелатинській фікстурі,
//! [`tests::scan_toolchain_steps_handles_non_ascii_job_name`]). Замість
//! тягнути `regex`-крейт заради чотирьох простих «літеральний підрядок
//! після `uses:`» патернів — [`line_has_uses_target`]/[`is_workspaces_key`]
//! реалізують ту саму семантику вручну (той самий мотив, що
//! `extract_php_version` у `crates/plugin-lang-php/src/lib.rs`, портований
//! без regex заради ваги wasm-компонента). Розмір — звіт задачі.
//!
//! # Неуніформний ланцюжок: `continue` після ПЕРШОЇ діагностики на крок
//!
//! `lint()` JS-оригіналу (рядки 160-178) для КОЖНОГО `dtolnay/rust-toolchain`
//! кроку: якщо кешу немає — `fail` + `continue` (другу перевірку для цього
//! кроку НЕ виконує, навіть якщо `workspaceDir` заданий і job має
//! tauri-action); лише коли кеш Є, виконується друга перевірка
//! (`workspaceDir && jobHasTauriAction && !cacheHasWorkspaces`). [`detect_toolchain_cache`]
//! відтворює це буквально через `if !has_cache { ...; continue; }` —
//! ОБИДВІ діагностики на один крок структурно неможливі (`continue` кожного
//! разу гарантує максимум одну на крок).
//!
//! # Розмір — найлегший з п'яти гостей
//!
//! Жодної залежності, крім `wit-bindgen` (доккомент `Cargo.toml`) —
//! точний паритет з `crates/plugin-lang-php` (обидва — нуль стороннього
//! крейта в рантайм-графі). Виміряний фінальний розмір — звіт задачі.
//!
//! ТРЕТЯ хвиля (задача, що додала цей блок): три policy-концерни, кожен —
//! ОДИН target-файл + ОДИН `.rego`-пакет + ОДИН `template/*.snippet.*` —
//! [`detect_policy`]/[`PolicyCfg`]. Detect-двигун — той самий `regorus`
//! IN-PROCESS-шлях, що друга хвиля ([`eval_deny_rule`], перевикористаний
//! буквально): `engine: "rego"` (дефолт `concern-meta.mjs`, коли
//! `concern.json` не декларує `check: "template"`) — попри `template/`-теку в
//! кожного з трьох, детект-логіку несе САМ Rego-пакет
//! (`data.template.snippet` — вхід, не JS `checkSnippet`). Fix-двигун —
//! ДВА спільні JS T0-рушії, портовані сюди Rust-функціями, які теж
//! ПЕРЕВИКОРИСТОВУЮТЬСЯ між концернами (не 1:1 копії):
//! - `ga/vscode_extensions` ([`fix_vscode_extensions`]) — точний порт
//!   `npm/scripts/lib/fix/vscode-ext-add.mjs` (union `recommendations` за
//!   рядковим значенням, решта `.vscode/extensions.json` незайманою);
//! - `ga/vscode_settings`/`security/lint_security_yml`
//!   ([`fix_template_merge`]/[`TemplateFixCfg`]) — точний порт
//!   `npm/scripts/lib/fix/template-deep-merge.mjs` (deep-merge snippet →
//!   target: обʼєкти мерджаться по ключах, масиви — union за структурним
//!   підмножинним збігом чи `name`/`uses`-ідентичністю on-place,
//!   [`is_subset`]/[`merge_json_value`]; файл відсутній → snippet копіюється
//!   verbatim). Вибір другого й третього концерну — доккомент задачі: з 14
//!   концернів, що шимлять `template-deep-merge.mjs` у цьому плагіні, РІВНО
//!   ОДИН (`ga/vscode_settings`) має JSON-таргет — решта 13, включно з
//!   `security/lint_security_yml`, мають YAML-workflow-таргет; порт свідомо
//!   бере ОДИН представник кожної форми, а не два зручні JSON-и.
//!
//! Спільна інфраструктура ОБОХ рушіїв — [`Json`] (той самий тип, що друга
//! хвиля) + два джерела читання ([`parse_target_document`], доккомент
//! розділу «Справжня JSONC-підтримка»: `.yml`-таргет — [`saphyr`]/
//! [`parse_yaml_document`] (YAML 1.2, той самий, що друга хвиля); `.json`-
//! таргет — [`jsonc_parser`]/[`parse_jsonc_document`], СПРАВЖНІЙ JSONC
//! (`//`/`/* */`-коментарі, trailing-кома — `.vscode/*.json` у продакшн-
//! VS-Code-конвенції часто саме такий, доккомент розділу — не «JSON — це
//! підмножина YAML 1.2», тим шляхом раніше тихо псувало дані) + два
//! серіалізатори ([`write_json_pretty`] — `.json`-таргет, [`write_yaml_block`]
//! — `.yml`-таргет), ОБИДВА СВІДОМО не comment-preserving самі по собі
//! (регенерують з [`Json`] з нуля, рядкові скаляри ЗАВЖДИ в подвійних
//! лапках) — та ОКРЕМИЙ хірургічний шлях, що ставить розбіжність із каноном
//! на місце (§2.5x реєстру відкритих питань, розширення обсягу власником
//! репозиторію — доккомент розділу «Хірургічний comment-preserving merge»
//! біля [`try_surgical_merge`], нижче за текстом файлу): [`fix_template_merge`]
//! спершу пробує хірургічний шлях (вставка/заміна байтових діапазонів на
//! анотованому дереві — `saphyr::MarkedYamlOwned`-спани для YAML,
//! `jsonc_parser::ast::Value`-`Range` для JSON, обидва конвертовані в один
//! [`MNode`]; недоторкані байти — байт-у-байт оригінал, коментарі виживають
//! СТРУКТУРНО, бо не входять у діапазон жодного вузла жодного з двох
//! парсерів) і лише коли він недосяжний для конкретного дерева (порожній
//! контейнер, тип не збігається, вставка вийшла б за межі власного
//! `}`/`]`) — падає на старий шлях повної регенерації. Паритет цього порту
//! — і «повторний detect чистий» ([`eval_deny_rule`] знову на записаному
//! вмісті), і (коли хірургічний шлях застосовний — реалістичний, покритий
//! тестами випадок для ОБОХ таргетів цього крейта, включно з коментованим
//! JSON) byte-у-byte збереження коментарів/форматування наявного файлу;
//! повна регенерація лишається чесно задокументованим fallback-ом для
//! нетипових дерев (звіт задачі), не видана за повне рішення.
//! [`fix_vscode_extensions`] — ОКРЕМИЙ, простіший union-merge рушій (не
//! хірургічний, точний порт `vscode-ext-add.mjs`, доккомент вище) — тепер
//! теж читає `.json`-таргет за JSONC-контрактом, але, як і сам канон,
//! ЗАВЖДИ повністю регенерує вивід при записі (`JSON.stringify`-подібно):
//! коментарі НЕ переживають запис ЦИМ рушієм — чесна, задокументована межа
//! (доккомент [`fix_vscode_extensions`]), не тиха.
//!
//! # Порядок workflow-файлів у batch — недетермінований, як і в каноні
//!
//! JS-оригінал перебирає `readdir(wfDir)` (порядок залежить від ФС, НЕ
//! гарантовано алфавітний); wasm-порт перебирає `files: &[SourceFile]` у
//! тому порядку, в якому їх зібрав host (`build_full_scope_files` →
//! `walk_dir` + `globset`-фільтр, теж без явного сортування). Обидва канали
//! з ОДНИМ workflow-файлом на тест дають детермінований результат; сценарій
//! «два workflow-файли в одному прогоні» свідомо НЕ покритий
//! parity-тестом (`wasm-plugin-parity-ci-github.test.mjs`) — порядок
//! violations між реалізаціями там не гарантовано збігається (документована
//! межа, не пропущений кейс: JS-тест `toolchain_cache.test.mjs::«другий job
//! у файлі не впливає на перший»` теж лишається в межах ОДНОГО файла).

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

/// Ключ контрибуції `rust/toolchain_cache` — точний відповідник
/// `ruleId: 'rust', concernId: 'toolchain_cache'` JS-виклику
/// (`toolchain_cache.test.mjs`).
const CONCERN_TOOLCHAIN_CACHE: &str = "rust/toolchain_cache";

/// `reason` «job без `Swatinem/rust-cache@v2`» — точний відповідник
/// `MISSING_RUST_CACHE = 'missing-rust-cache'` (`main.mjs`).
const MISSING_RUST_CACHE_REASON: &str = "missing-rust-cache";

/// `reason` «Tauri-job без `with.workspaces`» — точний відповідник
/// `MISSING_RUST_CACHE_WORKSPACES = 'missing-rust-cache-workspaces'`
/// (`main.mjs`).
const MISSING_RUST_CACHE_WORKSPACES_REASON: &str = "missing-rust-cache-workspaces";

/// Літеральний підрядок ПІСЛЯ `uses:\s*`, що ідентифікує крок встановлення
/// Rust toolchain — точний відповідник `TOOLCHAIN_RE` (`main.mjs`).
const TOOLCHAIN_TARGET: &str = "dtolnay/rust-toolchain@";

/// Літеральний підрядок кроку кешування Cargo-артефактів — точний
/// відповідник `CACHE_RE`.
const CACHE_TARGET: &str = "Swatinem/rust-cache@";

/// Літеральний підрядок кроку Tauri-релізу/білда — точний відповідник
/// `TAURI_ACTION_RE`.
const TAURI_ACTION_TARGET: &str = "tauri-apps/tauri-action@";

/// `data.kind` для [`MISSING_RUST_CACHE_REASON`] — статичний JSON-рядок
/// (значення відоме на compile-time, жодної інтерполяції) — точний
/// відповідник `data: { kind: MISSING_RUST_CACHE }` (`main.mjs`).
const MISSING_RUST_CACHE_DATA: &str = "{\"kind\":\"missing-rust-cache\"}";

/// Шукає ПЕРШЕ (будь-де в рядку) входження `uses:`, за яким — після
/// опційного пробілу (`\s*`) — іде літеральний `target`. Точний
/// функціональний відповідник `/uses:\s*<target>/u.test(line)`: `\s*` —
/// жадібний, але backtrack тут ніколи не потрібен (`target` сам не починається
/// з пробілу, тож «зʼїсти максимум пробілів, тоді звірити літерал» —
/// єдиний спосіб матчу, який взагалі міг би спрацювати). Перебирає ВСІ
/// входження `uses:` у рядку (не лише перше), той самий контракт, що
/// `.test()` — матч будь-де.
fn line_has_uses_target(line: &str, target: &str) -> bool {
    let mut search_from = 0usize;
    while let Some(rel) = line[search_from..].find("uses:") {
        let idx = search_from + rel;
        let after = idx + "uses:".len();
        if line[after..].trim_start().starts_with(target) {
            return true;
        }
        search_from = idx + 1;
    }
    false
}

/// Точний відповідник `/^\s*workspaces\s*:/u.test(line)`: опційний
/// провідний пробіл, літерал `workspaces`, опційний пробіл, `:` — усе
/// заякорене на початок рядка.
fn is_workspaces_key(line: &str) -> bool {
    let trimmed = line.trim_start();
    match trimmed.strip_prefix("workspaces") {
        Some(rest) => rest.trim_start().starts_with(':'),
        None => false,
    }
}

/// Відступ рядка (кількість байтів-пробілів перед першим непробільним
/// символом) — точний функціональний відповідник `indentOf` (`main.mjs`):
/// `line.length - line.trimStart().length`. Байтова, не char-міра —
/// безпечно, бо відступ і `- uses:`-префікс YAML-структури завжди ASCII
/// (нелатинський текст, якщо є, іде ПІСЛЯ цих маркерів — коментарі/назви
/// job-ів, доккомент модуля).
fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// Дашова колонка кроку (`- uses: …`) з колонки `uses:` — точний
/// відповідник `Math.max(usesCol - 2, 0)` (`main.mjs::dashColFor`).
fn dash_col_for(uses_col: usize) -> usize {
    uses_col.saturating_sub(2)
}

/// Результат сканування job-а від рядка ОДРАЗУ ПІСЛЯ toolchain-кроку до
/// dedent-у — точний відповідник результату `scanJobForCache` (`main.mjs`).
struct JobCacheScan {
    has_cache: bool,
    cache_line: Option<usize>,
    job_has_tauri_action: bool,
}

/// Точний порт `scanJobForCache` (`main.mjs`): від `from_line` до dedent-у
/// (перший рядок з відступом МЕНШИМ за `dash_col`) шукає перший
/// `Swatinem/rust-cache@…` крок і чи job також викликає
/// `tauri-apps/tauri-action@…`. Порожні рядки пропускаються ПЕРЕД
/// перевіркою відступу (той самий порядок гілок, що оригінал) — інакше
/// порожній рядок (`indentOf('') === 0`) хибно завершив би скан як dedent.
fn scan_job_for_cache(lines: &[&str], from_line: usize, dash_col: usize) -> JobCacheScan {
    let mut has_cache = false;
    let mut cache_line = None;
    let mut job_has_tauri_action = false;
    for (j, line) in lines.iter().enumerate().skip(from_line) {
        if line.trim().is_empty() {
            continue;
        }
        if indent_of(line) < dash_col {
            break;
        }
        if !has_cache && line_has_uses_target(line, CACHE_TARGET) {
            has_cache = true;
            cache_line = Some(j);
        }
        if line_has_uses_target(line, TAURI_ACTION_TARGET) {
            job_has_tauri_action = true;
        }
    }
    JobCacheScan {
        has_cache,
        cache_line,
        job_has_tauri_action,
    }
}

/// Точний порт `cacheStepHasWorkspaces` (`main.mjs`): чи кеш-крок уже має
/// ключ `with.workspaces` у своєму блоці (до dedent-у за `dash_col`).
fn cache_step_has_workspaces(lines: &[&str], cache_line: usize, dash_col: usize) -> bool {
    for line in lines.iter().skip(cache_line + 1) {
        if line.trim().is_empty() {
            continue;
        }
        if indent_of(line) < dash_col {
            break;
        }
        if is_workspaces_key(line) {
            return true;
        }
    }
    false
}

/// Один запис аналізу `dtolnay/rust-toolchain` кроку в межах його job-а —
/// точний порт `ToolchainStepScan` (`main.mjs`). `line`/`dash_col`/
/// `cache_line` спершу НЕ читав тут ніхто (`detect_toolchain_cache` їх не
/// потребує, той самий обсяг, що `lint()` JS-оригіналу, `main.mjs:160-178`)
/// — повернуті поля-відповідники, коли до цього ж скана додався
/// [`insert_rust_cache`]/[`add_cache_workspaces`] (T0-фіксер, звіт задачі):
/// обом потрібні координати вставки, які `detect` ігнорує.
struct ToolchainStepScan {
    line: usize,
    dash_col: usize,
    has_cache: bool,
    cache_line: Option<usize>,
    cache_has_workspaces: bool,
    job_has_tauri_action: bool,
}

/// Точний порт `scanToolchainSteps` (`main.mjs`) — пуста функція без
/// host-імпортів, тож юніт-тестована напряму на host-таргеті (немає
/// `exec_tool`, на відміну від `rust/check`-подібних концернів попередніх
/// гостей).
fn scan_toolchain_steps(content: &str) -> Vec<ToolchainStepScan> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let Some(uses_col) = line.find("uses:") else {
            continue;
        };
        if !line_has_uses_target(line, TOOLCHAIN_TARGET) {
            continue;
        }
        let dash_col = dash_col_for(uses_col);
        let job_scan = scan_job_for_cache(&lines, i + 1, dash_col);
        let cache_has_workspaces = job_scan.has_cache
            && job_scan
                .cache_line
                .is_some_and(|cache_line| cache_step_has_workspaces(&lines, cache_line, dash_col));
        out.push(ToolchainStepScan {
            line: i,
            dash_col,
            has_cache: job_scan.has_cache,
            cache_line: job_scan.cache_line,
            cache_has_workspaces,
            job_has_tauri_action: job_scan.job_has_tauri_action,
        });
    }
    out
}

// =====================================================================
// `rust/toolchain_cache` — Т0-фіксер ПОРТОВАНО (доккомент модуля пояснює
// хвилі; тут — той самий прийом текстового splice-у, що `add_persist_credentials`
// у розділі `ga/workflows` нижче, лише над [`scan_toolchain_steps`] замість
// окремого регекс-скана). Точний семантичний порт двох T0-трансформерів
// `fix-toolchain_cache.mjs` (лишається JS-каноном — доккомент того файла):
// [`insert_rust_cache`] ← `insertRustCache`, [`add_cache_workspaces`] ←
// `addCacheWorkspaces`. `fix_toolchain_cache` (розділ нижче, біля
// `fix_workflows`) компонує обидва послідовно на одному буфері — той самий
// мотив, що композиція трьох трансформерів `ga/workflows`.
// =====================================================================

/// Індекс першого рядка ПІСЛЯ step-блоку, що починається на `step_line`
/// (дашова колонка `dash_col`) — точний порт `stepBlockEnd`
/// (`fix-toolchain_cache.mjs`): перший рядок з відступом НЕ БІЛЬШИМ за
/// `dash_col` (сусідній крок того самого рівня чи dedent), або EOF.
fn step_block_end(lines: &[&str], step_line: usize, dash_col: usize) -> usize {
    let mut j = step_line + 1;
    while j < lines.len() {
        let line = lines[j];
        if !line.trim().is_empty() && indent_of(line) <= dash_col {
            break;
        }
        j += 1;
    }
    j
}

/// Точний порт `insertRustCache` (`fix-toolchain_cache.mjs`): вставляє
/// `Swatinem/rust-cache@v2` одразу після КОЖНОГО `dtolnay/rust-toolchain@…`
/// кроку без cache-кроку в тому самому job-і (`!step.has_cache`). Коли
/// `workspace_dir` заданий і job також викликає `tauri-apps/tauri-action`
/// (`step.job_has_tauri_action`) — новий крок одразу отримує
/// `with.workspaces: <dir>` (той самий текстовий splice, не два проходи).
/// Вставки застосовуються ЗГОРИ ВНИЗ (`sort_by` за спаданням `at`) — той
/// самий мотив, що коментар `inserts.sort` JS-оригіналу: індекси попередніх
/// вставок не зсуваються під час `splice`. `None` — жодного кроку без кешу
/// (файл уже чистий).
fn insert_rust_cache(content: &str, workspace_dir: Option<&str>) -> Option<String> {
    let borrowed: Vec<&str> = content.split('\n').collect();
    let missing: Vec<ToolchainStepScan> = scan_toolchain_steps(content)
        .into_iter()
        .filter(|s| !s.has_cache)
        .collect();
    if missing.is_empty() {
        return None;
    }
    let mut inserts: Vec<(usize, Vec<String>)> = missing
        .iter()
        .map(|step| {
            let at = step_block_end(&borrowed, step.line, step.dash_col);
            let ind = " ".repeat(step.dash_col);
            let mut text = vec![format!("{ind}- uses: Swatinem/rust-cache@v2")];
            if let (Some(dir), true) = (workspace_dir, step.job_has_tauri_action) {
                text.push(format!("{ind}  with:"));
                text.push(format!("{ind}    workspaces: {dir}"));
            }
            (at, text)
        })
        .collect();
    inserts.sort_by(|a, b| b.0.cmp(&a.0));
    let mut lines: Vec<String> = borrowed.into_iter().map(str::to_string).collect();
    for (at, text) in inserts {
        lines.splice(at..at, text);
    }
    Some(lines.join("\n"))
}

/// Точний порт `addCacheWorkspaces` (`fix-toolchain_cache.mjs`): дописує
/// `with: workspaces: <dir>` у КОЖЕН уже наявний `Swatinem/rust-cache@…` крок
/// Tauri-job-а (`step.job_has_tauri_action`), якому бракує `workspaces`
/// (`!step.cache_has_workspaces`). Колонка вставки — `uses:`-колонка самого
/// кеш-кроку (не `dash_col` toolchain-кроку, той самий зсув, що JS
/// `usesCol`); [`dash_col_for`] тут — той самий float-guard, що JS
/// `usesCol - 2` без явного `Math.max` (перевикористання, не новий inline
/// код). `None` — жодного кеш-кроку без `workspaces` серед `targets`.
fn add_cache_workspaces(content: &str, workspace_dir: &str) -> Option<String> {
    let borrowed: Vec<&str> = content.split('\n').collect();
    let targets: Vec<ToolchainStepScan> = scan_toolchain_steps(content)
        .into_iter()
        .filter(|s| s.has_cache && s.job_has_tauri_action && !s.cache_has_workspaces)
        .collect();
    if targets.is_empty() {
        return None;
    }
    let mut inserts: Vec<(usize, Vec<String>)> = Vec::new();
    for step in &targets {
        let Some(cache_line) = step.cache_line else {
            continue;
        };
        let Some(uses_col) = borrowed[cache_line].find("uses:") else {
            continue;
        };
        let ind = " ".repeat(uses_col);
        let at = step_block_end(&borrowed, cache_line, dash_col_for(uses_col));
        inserts.push((
            at,
            vec![
                format!("{ind}with:"),
                format!("{ind}  workspaces: {workspace_dir}"),
            ],
        ));
    }
    inserts.sort_by(|a, b| b.0.cmp(&a.0));
    let mut lines: Vec<String> = borrowed.into_iter().map(str::to_string).collect();
    for (at, text) in inserts {
        lines.splice(at..at, text);
    }
    Some(lines.join("\n"))
}

/// Шукає файл у батчі за точним posix-relative шляхом — batch-відповідник
/// `existsSync` JS-оригіналу (той самий helper, що в решти чотирьох гостей,
/// продубльований тут: крейти не діляться кодом через wasm-межу).
fn batch_file<'a>(files: &'a [SourceFile], path: &str) -> Option<&'a SourceFile> {
    files.iter().find(|f| f.path == path)
}

/// Каталог Rust-workspace-а для `Swatinem/rust-cache` `with.workspaces`, якщо
/// `Cargo.toml` не в корені репо, а під `src-tauri/` (типовий Tauri-layout).
/// `None`, якщо корінь репо вже є workspace-коренем — точний функціональний
/// відповідник `tauriWorkspaceDir` (`main.mjs`), лише замість `existsSync`
/// на реальному диску читає вже наданий host-ом батч (той самий `Cargo.toml`/
/// `src-tauri/Cargo.toml` glob контрибуції, доккомент `plugin.toml`).
fn tauri_workspace_dir(files: &[SourceFile]) -> Option<String> {
    if batch_file(files, "Cargo.toml").is_some() {
        return None;
    }
    if batch_file(files, "src-tauri/Cargo.toml").is_some() {
        Some("src-tauri".to_string())
    } else {
        None
    }
}

/// Escape рядка для вбудовування в JSON — той самий helper, що в
/// `crates/plugin-lang-rust`/`crates/plugin-lang-python` (крейти не діляться
/// кодом через wasm-межу, окрема копія).
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

/// Чи `path` — workflow-файл у `.github/workflows/` з розширенням
/// `.yml`/`.yaml` — захисний фільтр УСЕРЕДИНІ [`detect_toolchain_cache`]
/// (той самий мотив, що `!file.path.ends_with(".vue")` у
/// `crates/plugin-lang-js`, доккомент `npm/skills/wasm-plugin/SKILL.md`,
/// розділ «Full-scope … предикат файлу ПОНАД glob»): захист, якщо
/// `detect` колись викличуть з батчем, що містить і `Cargo.toml`/
/// `src-tauri/Cargo.toml` (потрібні лише [`tauri_workspace_dir`]), і
/// workflow-файли одразу — не кожен елемент `files` є workflow-файлом.
fn is_workflow_path(path: &str) -> bool {
    path.starts_with(".github/workflows/") && (path.ends_with(".yml") || path.ends_with(".yaml"))
}

/// Точний порт `lint()` `rust/toolchain_cache`
/// (`plugins/ci-github/rules/rust/toolchain_cache/main.mjs`) — WHOLE-BATCH,
/// пуста функція без host-імпортів (жодного `exec_tool`/`log` — на відміну
/// від `rust/check`-подібних концернів попередніх гостей, юніт-тестована
/// напряму). Неуніформний ланцюжок на крок — доккомент модуля.
fn detect_toolchain_cache(files: &[SourceFile]) -> Vec<Diagnostic> {
    let workspace_dir = tauri_workspace_dir(files);
    let mut diagnostics = Vec::new();

    for wf in files.iter().filter(|f| is_workflow_path(&f.path)) {
        for step in scan_toolchain_steps(&wf.content) {
            if !step.has_cache {
                diagnostics.push(Diagnostic {
                    reason: MISSING_RUST_CACHE_REASON.to_string(),
                    message: format!(
                        "{}: job зі `dtolnay/rust-toolchain@stable` потребує `Swatinem/rust-cache@v2` одразу після (rust.mdc)",
                        wf.path
                    ),
                    file: Some(wf.path.clone()),
                    severity: Severity::Error,
                    data: Some(MISSING_RUST_CACHE_DATA.to_string()),
                });
                continue;
            }
            if let Some(dir) = &workspace_dir {
                if step.job_has_tauri_action && !step.cache_has_workspaces {
                    diagnostics.push(Diagnostic {
                        reason: MISSING_RUST_CACHE_WORKSPACES_REASON.to_string(),
                        message: format!(
                            "{}: Swatinem/rust-cache@v2 у Tauri-job-і потребує `with.workspaces: {dir}` (rust.mdc)",
                            wf.path
                        ),
                        file: Some(wf.path.clone()),
                        severity: Severity::Error,
                        data: Some(format!(
                            "{{\"kind\":\"{}\",\"workspaceDir\":{}}}",
                            MISSING_RUST_CACHE_WORKSPACES_REASON,
                            json_escape_string(dir)
                        )),
                    });
                }
            }
        }
    }
    diagnostics
}

// =====================================================================
// `ga/workflows` — друга хвиля порту (доккомент модуля).
// =====================================================================

/// Ключ контрибуції `ga/workflows` — точний відповідник `ruleId: 'ga',
/// concernId: 'workflows'` JS-виклику (`main.test.mjs`/`workflows.test.mjs`).
const CONCERN_WORKFLOWS: &str = "ga/workflows";

/// Дефолтний `reason` — точний відповідник `ctx.concernId` JS-канону:
/// `createViolationReporter(ctx)` (`violation-reporter.mjs`) даб `reason =
/// ctx?.concernId ?? 'violation'`, коли `fail(msg)` викликається БЕЗ опцій
/// (більшість перевірок цього концерну).
const DEFAULT_REASON: &str = "workflows";

/// Обовʼязкові workflow-файли (ga.mdc) — точний відповідник
/// `REQUIRED_WORKFLOWS` (`main.mjs`).
const REQUIRED_WORKFLOWS: [&str; 4] = [
    "clean-ga-workflows.yml",
    "clean-merged-branch.yml",
    "lint-ga.yml",
    "git-ai.yml",
];

/// Типові конфіги MegaLinter у корені репо — точний відповідник
/// `MEGALINTER_CONFIG_NAMES` (`main.mjs`).
const MEGALINTER_CONFIG_NAMES: [&str; 3] =
    [".mega-linter.yml", ".megalinter.yaml", ".mega-linter.yaml"];

/// Canonical language config paths, які policy language-workflow-ів
/// вимагають наперед — точний відповідник `OPTIONAL_CANONICAL_PATH_GLOBS`
/// (`main.mjs`).
const OPTIONAL_CANONICAL_PATH_GLOBS: [&str; 4] = [
    "pyproject.toml",
    "uv.lock",
    "**/rustfmt.toml",
    "**/clippy.toml",
];

// --- Rego-політики, вшиті `include_str!` з ТИХ САМИХ файлів, що читає
// живий JS-канон (доккомент модуля, розділ «Regorus замість conftest»):
// джерело правди лишається `.rego`, не Rust-парафраз.

const CLEAN_GA_WORKFLOWS_REGO: &str =
    include_str!("../../../plugins/ci-github/rules/ga/clean_ga_workflows/clean_ga_workflows.rego");
const CLEAN_GA_WORKFLOWS_SNIPPET_YML: &str = include_str!(
    "../../../plugins/ci-github/rules/ga/clean_ga_workflows/template/clean-ga-workflows.yml.snippet.yml"
);

const CLEAN_MERGED_BRANCH_REGO: &str = include_str!(
    "../../../plugins/ci-github/rules/ga/clean_merged_branch/clean_merged_branch.rego"
);
const CLEAN_MERGED_BRANCH_SNIPPET_YML: &str = include_str!(
    "../../../plugins/ci-github/rules/ga/clean_merged_branch/template/clean-merged-branch.yml.snippet.yml"
);

const LINT_GA_REGO: &str = include_str!("../../../plugins/ci-github/rules/ga/lint_ga/lint_ga.rego");
const LINT_GA_SNIPPET_YML: &str =
    include_str!("../../../plugins/ci-github/rules/ga/lint_ga/template/lint-ga.yml.snippet.yml");

const GIT_AI_REGO: &str = include_str!("../../../plugins/ci-github/rules/ga/git_ai/git_ai.rego");
const GIT_AI_SNIPPET_YML: &str =
    include_str!("../../../plugins/ci-github/rules/ga/git_ai/template/git-ai.yml.snippet.yml");

const WORKFLOW_COMMON_REGO: &str =
    include_str!("../../../plugins/ci-github/rules/ga/workflow_common/workflow_common.rego");
const USES_MIN_VERSIONS_SNIPPET_JSON: &str = include_str!(
    "../../../plugins/ci-github/rules/ga/workflow_common/template/uses-min-versions.snippet.json"
);

// --- ТРЕТЯ хвиля: три policy-концерни, кожен свій `.rego` + свій snippet
// (доккомент модуля, розділ «ТРЕТЯ хвиля») — той самий `include_str!`-мотив.

const VSCODE_EXTENSIONS_REGO: &str =
    include_str!("../../../plugins/ci-github/rules/ga/vscode_extensions/vscode_extensions.rego");
const VSCODE_EXTENSIONS_SNIPPET_JSON: &str = include_str!(
    "../../../plugins/ci-github/rules/ga/vscode_extensions/template/extensions.json.snippet.json"
);

const VSCODE_SETTINGS_REGO: &str =
    include_str!("../../../plugins/ci-github/rules/ga/vscode_settings/vscode_settings.rego");
const VSCODE_SETTINGS_SNIPPET_JSON: &str = include_str!(
    "../../../plugins/ci-github/rules/ga/vscode_settings/template/settings.json.snippet.json"
);

const LINT_SECURITY_YML_REGO: &str = include_str!(
    "../../../plugins/ci-github/rules/security/lint_security_yml/lint_security_yml.rego"
);
const LINT_SECURITY_YML_SNIPPET_YML: &str = include_str!(
    "../../../plugins/ci-github/rules/security/lint_security_yml/template/lint-security.yml.snippet.yml"
);

/// Мінімальне self-describing dynamic-значення YAML/JSON-документа — спільне
/// представлення і для конвертації в JSON-текст regorus `input`/`data`
/// ([`json_to_string`]), і для JS-паритетної логіки цього концерну
/// (`checkApplyWorkflow`/`verifyWorkflowEventPathsGlobsExist`), яка в каноні
/// індексує вже розпарсений YAML-обʼєкт (`yaml` npm-пакет). Один AST замість
/// двох (текст + типізований доступ) — [`saphyr`] дає власний `YamlOwned`,
/// цей enum лише звужує його до JSON-сумісної підмножини.
#[derive(Debug, Clone, PartialEq)]
enum Json {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Array(Vec<Json>),
    /// Порядок вставки збережено (як і `saphyr`'s `MappingOwned` —
    /// `LinkedHashMap`) — не для коректності Rego (обʼєкти незалежні від
    /// порядку ключів), а для детермінованого JSON-тексту.
    Object(Vec<(String, Json)>),
}

impl Json {
    /// Доступ до поля обʼєкта за ключем — точний відповідник `getObjKey`
    /// (`main.mjs`): `None`, якщо `self` не обʼєкт чи ключа немає.
    fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(items) => Some(items.as_slice()),
            _ => None,
        }
    }
}

/// Конвертує вже розпарсений `saphyr`-AST у [`Json`] — рекурсивний спуск по
/// `Mapping`/`Sequence`/`Value`(скаляр). `Representation`/`Tagged`/`Alias`/
/// `BadValue` не очікувані в GH Actions workflow YAML після `early_parse`
/// (дефолт `saphyr`-лоадера — скаляри вже розв'язані у `Value`) —
/// трактуються як `Json::Null` (skip-not-crash, той самий дух, що решта
/// контракту).
fn yaml_owned_to_json(node: &saphyr::YamlOwned) -> Json {
    use saphyr::YamlOwned;
    match node {
        YamlOwned::Value(scalar) => scalar_owned_to_json(scalar),
        YamlOwned::Sequence(items) => Json::Array(items.iter().map(yaml_owned_to_json).collect()),
        YamlOwned::Mapping(map) => Json::Object(
            map.iter()
                .map(|(k, v)| (yaml_key_to_string(k), yaml_owned_to_json(v)))
                .collect(),
        ),
        _ => Json::Null,
    }
}

fn scalar_owned_to_json(scalar: &saphyr::ScalarOwned) -> Json {
    use saphyr::ScalarOwned;
    match scalar {
        ScalarOwned::Null => Json::Null,
        ScalarOwned::Boolean(b) => Json::Bool(*b),
        ScalarOwned::Integer(i) => Json::Int(*i),
        ScalarOwned::FloatingPoint(f) => Json::Float(f.into_inner()),
        ScalarOwned::String(s) => Json::Str(s.clone()),
    }
}

/// Ключ мапи як рядок — GH Actions workflow YAML завжди має рядкові ключі;
/// нестроковий ключ (не очікуваний у цьому домені) деградує у `Debug`-текст
/// замість паніки.
fn yaml_key_to_string(key: &saphyr::YamlOwned) -> String {
    key.as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("{key:?}"))
}

/// Точний відповідник `parseWorkflowYaml` (`gha-workflow.mjs`): парсить
/// цілий YAML-документ і повертає `Some` лише коли корінь — обʼєкт (мапа);
/// парс-помилка чи не-обʼєктний корінь (скаляр/масив) — `None`, той самий
/// подвійний fallback, що JS `try { parse(content) } catch { null }` +
/// `typeof root === 'object'`.
fn parse_yaml_document(content: &str) -> Option<Json> {
    use saphyr::{LoadableYamlNode, YamlOwned};
    let docs = YamlOwned::load_from_str(content).ok()?;
    let doc = docs.into_iter().next()?;
    match yaml_owned_to_json(&doc) {
        json @ Json::Object(_) => Some(json),
        _ => None,
    }
}

// =====================================================================
// Справжня JSONC-підтримка (коментарі, trailing-кома) — заміна floor-
// валідатора `is_strict_json`, що жив тут раніше (звіт задачі §2.58, друга
// поправка — «target 2 (JSONC comment-preserving support) НЕ реалізовано.
// Свідомо... floor — повна, коректна... реалізація; target 2 лишається
// нереалізованою метою» — ЦЯ секція її реалізує). [`parse_yaml_document`] —
// YAML 1.2-парсер, СВІДОМО толерантний (доккомент вище — той самий парсер
// обслуговує і `.yml`, і `.json`-таргети, бо JSON — валідний YAML 1.2). Але
// `.vscode/*.json` у продакшн-конвенції VS Code — часто JSONC
// (`//`/`/* */`-коментарі, іноді trailing-кома), а JSONC НЕ є валідним
// YAML 1.2: `//`-рядок читається як plain-скаляр і, залежно від контексту,
// ЗЛИВАЄТЬСЯ із сусіднім ключем у СТРУКТУРНО валідний, але СЕМАНТИЧНО
// хибний YAML-документ (підтверджено мінімальним репро поза цим модулем:
// `// коментар\n"key": true` парситься в ОДИН ключ
// `"// коментар \"key\""` зі значенням `true` — не помилка парсингу, тиха
// втрата `key`).
//
// Попередня задача (§2.58) закрила це floor-гейтом (`is_strict_json` —
// ручний RFC 8259-валідатор, що відхиляв БУДЬ-ЯКИЙ JSONC-вхід — файл просто
// не чіпався). Ця секція замінює floor на СПРАВЖНЄ рішення — крейт
// [`jsonc_parser`] (dprint, MIT, `Cargo.toml` пояснює вибір і бюджет):
// [`parse_jsonc_document`] (аналог [`parse_yaml_document`] — той самий
// подвійний fallback: помилка парсингу чи не-обʼєктний корінь → `None`) для
// НЕанотованого читання ([`detect_policy`]/[`fix_vscode_extensions`]), і
// [`parse_marked_jsonc_document`] (аналог [`parse_marked_document`] —
// байтові `Range` на кожному вузлі) для хірургічного шляху
// ([`try_surgical_merge`], доккомент розділу «Хірургічний comment-preserving
// merge» нижче за текстом файлу — той самий [`MNode`]/[`Edit`]-обхід, лише
// annotated-джерело тепер може бути І `saphyr::MarkedYamlOwned` (YAML), І
// `jsonc_parser::ast::Value` (JSON) — коментарі виживають структурно: вони
// НЕ входять у діапазон жодного вузла AST (окрема `CommentMap`, яку ми
// свідомо НЕ збираємо — `CollectOptions::default()` лишає
// `CommentCollectionStrategy::Off`, нам потрібні лише діапазони «живих»
// вузлів), тож недоторкані діапазони вихідного тексту (де коментарі й
// живуть) лишаються байт-у-байт як є — той самий мотив, що робить YAML-гілку
// comment-preserving.
//
// [`jsonc_parse_options`] СВІДОМО обмежує дефолтну (дуже permissive,
// JSON5-подібну) поведінку крейта до РІВНО контракту JSONC, яким його читає
// сам VS Code (`//`/`/* */`-коментарі й trailing-кома — і НІЧОГО понад це):
// `allow_loose_object_property_names`/`allow_single_quoted_strings`/
// `allow_hexadecimal_numbers`/`allow_unary_plus_numbers`/
// `allow_missing_commas` — усі `false`. Не «максимально толерантний
// парсер», а «точно JSONC» — той самий дух, що [`is_strict_json`] мав для
// строгого JSON (замінений цією секцією, не «розмитий»).
// =====================================================================

/// Чи `target_path` — `.json`-таргет (за розширенням) — обидва `.vscode/*.json`
/// концерни цього крейта, на відміну від `.github/workflows/*.yml` —
/// той самий бінарний розподіл, що `cfg.is_yaml` у [`TemplateFixCfg`],
/// лише для [`PolicyCfg`], де такого явного поля немає (три policy-концерни
/// на один спільний [`detect_policy`], доккомент там).
fn target_path_is_json(target_path: &str) -> bool {
    target_path.ends_with(".json")
}

/// Опції [`jsonc_parser`] — РІВНО контракт JSONC (доккомент розділу вище):
/// коментарі й trailing-кома дозволені, жоден інший JSON5-подібний виняток
/// (unquoted-ключі/одинарні лапки/hex-числа/unary `+`/пропущені коми) — ні.
fn jsonc_parse_options() -> jsonc_parser::ParseOptions {
    jsonc_parser::ParseOptions {
        allow_comments: true,
        allow_trailing_commas: true,
        allow_loose_object_property_names: false,
        allow_missing_commas: false,
        allow_single_quoted_strings: false,
        allow_hexadecimal_numbers: false,
        allow_unary_plus_numbers: false,
    }
}

/// Текст числового літерала JSONC → [`Json`] — ціле, якщо парситься як
/// `i64` (той самий пріоритет, що [`saphyr::ScalarOwned::Integer`] для
/// YAML-гілки), інакше `f64`; будь-який нерозпізнаний текст (не мало б
/// статись — [`jsonc_parser`] уже підтвердив, що це валідний число-токен
/// власної граматики) деградує в `Json::Null` замість паніки — той самий
/// skip-not-crash мотив, що [`yaml_owned_to_json`] для неочікуваних вузлів.
fn jsonc_number_to_json(raw: &str) -> Json {
    if raw.contains(['.', 'e', 'E']) {
        raw.parse::<f64>().map(Json::Float).unwrap_or(Json::Null)
    } else {
        raw.parse::<i64>()
            .map(Json::Int)
            .unwrap_or_else(|_| raw.parse::<f64>().map(Json::Float).unwrap_or(Json::Null))
    }
}

/// [`jsonc_parser::JsonValue`] (НЕанотоване дерево — без спанів) → [`Json`] —
/// точний відповідник [`yaml_owned_to_json`], лише джерело JSONC, не YAML.
fn jsonc_value_to_json(v: jsonc_parser::JsonValue) -> Json {
    use jsonc_parser::JsonValue as JV;
    match v {
        JV::Null => Json::Null,
        JV::Boolean(b) => Json::Bool(b),
        JV::Number(s) => jsonc_number_to_json(s),
        JV::String(s) => Json::Str(s.into_owned()),
        JV::Array(arr) => Json::Array(arr.into_iter().map(jsonc_value_to_json).collect()),
        JV::Object(obj) => {
            Json::Object(obj.into_iter().map(|(k, v)| (k.into_owned(), jsonc_value_to_json(v))).collect())
        }
    }
}

/// Точний відповідник [`parse_yaml_document`] для JSONC-таргетів: парсить
/// цілий документ за [`jsonc_parse_options`] і повертає `Some` лише коли
/// корінь — обʼєкт; помилка парсингу (побитий синтаксис, порожній вхід,
/// сміття після кореневого значення) чи не-обʼєктний корінь — `None`, той
/// самий подвійний fallback.
fn parse_jsonc_document(content: &str) -> Option<Json> {
    let value = jsonc_parser::parse_to_value(content, &jsonc_parse_options()).ok()??;
    match jsonc_value_to_json(value) {
        json @ Json::Object(_) => Some(json),
        _ => None,
    }
}

/// Диспетчер [`parse_yaml_document`]/[`parse_jsonc_document`] за типом
/// таргету — єдина точка, де [`fix_template_merge`]/[`fix_vscode_extensions`]/
/// [`detect_policy`] читають вміст файлу, щоб жоден з них не забув
/// врахувати JSONC-контракт для `.json`-таргетів.
fn parse_target_document(content: &str, is_json: bool) -> Option<Json> {
    if is_json {
        parse_jsonc_document(content)
    } else {
        parse_yaml_document(content)
    }
}

/// Рядкове імʼя властивості обʼєкта JSONC AST (лапкове чи «слово» — останнє
/// [`jsonc_parse_options`] забороняє на вході, але тип
/// [`jsonc_parser::ast::ObjectPropName`] лишається двоваріантним у самому
/// крейті, тож matching — вичерпний) разом з його ВЛАСНИМ байтовим
/// діапазоном — точний відповідник [`marked_key_to_string`] для YAML-гілки,
/// потрібен [`surgical_merge_object`] для колонки відступу нового запису.
fn jsonc_prop_name(name: &jsonc_parser::ast::ObjectPropName) -> (String, (usize, usize)) {
    use jsonc_parser::ast::ObjectPropName as PropName;
    match name {
        PropName::String(lit) => (lit.value.clone().into_owned(), (lit.range.start, lit.range.end)),
        PropName::Word(lit) => (lit.value.to_string(), (lit.range.start, lit.range.end)),
    }
}

/// [`jsonc_parser::ast::Value`] (анотоване дерево — байтові `Range` на
/// кожному вузлі, доккомент розділу вище) → [`MNode`] — точний відповідник
/// [`build_mnode`] для YAML-гілки. На відміну від [`build_mnode`], НЕ
/// потребує `char_byte_table`-конвертації: `jsonc_parser::common::Range` уже
/// байтові офсети в вихідному `&str` (доккомент `jsonc-parser`-крейта —
/// сканер рахує байти, не символи, на відміну від `saphyr::Marker`).
fn jsonc_ast_value_to_mnode(v: &jsonc_parser::ast::Value) -> MNode {
    use jsonc_parser::ast::Value as JV;
    match v {
        JV::Object(obj) => MNode::Object(
            obj.properties
                .iter()
                .map(|p| {
                    let (name, key_span) = jsonc_prop_name(&p.name);
                    (name, key_span, jsonc_ast_value_to_mnode(&p.value))
                })
                .collect(),
            (obj.range.start, obj.range.end),
        ),
        JV::Array(arr) => MNode::Array(
            arr.elements.iter().map(jsonc_ast_value_to_mnode).collect(),
            (arr.range.start, arr.range.end),
        ),
        JV::StringLit(s) => MNode::Scalar(Json::Str(s.value.clone().into_owned()), (s.range.start, s.range.end)),
        JV::NumberLit(n) => MNode::Scalar(jsonc_number_to_json(n.value), (n.range.start, n.range.end)),
        JV::BooleanLit(b) => MNode::Scalar(Json::Bool(b.value), (b.range.start, b.range.end)),
        JV::NullKeyword(nk) => MNode::Scalar(Json::Null, (nk.range.start, nk.range.end)),
    }
}

/// Той самий подвійний fallback, що [`parse_marked_document`] (YAML-гілка),
/// лише джерело — [`jsonc_parser::parse_to_ast`] за [`jsonc_parse_options`]:
/// помилка парсингу чи не-обʼєктний корінь → `None`, інакше — annotated
/// [`MNode`]-дерево зі спанами.
fn parse_marked_jsonc_document(content: &str) -> Option<MNode> {
    use jsonc_parser::{parse_to_ast, CollectOptions};
    let result = parse_to_ast(content, &CollectOptions::default(), &jsonc_parse_options()).ok()?;
    let value = result.value?;
    match &value {
        jsonc_parser::ast::Value::Object(_) => Some(jsonc_ast_value_to_mnode(&value)),
        _ => None,
    }
}

/// Обхідний шлях regorus 0.11.0-специфічного бага в evaluator-і (підтверджено
/// мінімальним репро поза цим крейтом): shorthand-форма multi-value rule
/// head `s contains arr[_].field` дає `Err("not an object")`, коли ХОЧА Б
/// ОДИН елемент масиву не має поля `field` (undefined mid-iteration) —
/// LONGHAND-форма (`s contains v if { some x in arr; v := x.field }`) з ТИМ
/// САМИМ входом працює коректно. РІВНО ОДИН рядок серед пʼяти вшитих
/// `.rego`-джерел використовує саме цю крихку форму:
/// `lint_ga.rego:17: job_uses_set contains job.steps[_].uses` (кроки БЕЗ
/// `uses:`, напр. чисті `run:`-кроки, тригерять баг). Rego-текст НЕ можна
/// правити (спільне джерело з живим JS-каноном, 55 `conftest verify`-тестів
/// його стережуть) — обхід тут, на боці Rust, ПЕРЕД `set_input`: кожен
/// `jobs.*.steps[]`-елемент отримує явний `"uses": ""`, якщо ключа не було.
/// Застосовано УНІВЕРСАЛЬНО (усі пʼять namespace-ів, доккомент
/// [`run_all_ga_rego`]), а не лише для `ga.lint_ga` — нейтрально для решти
/// чотирьох: кожне звернення до `step.uses` там або індексує КОНКРЕТНИЙ,
/// заздалегідь відомий крок (`step0.uses`), або йде через
/// `object.get(step, "uses", "")`, який дає ТОЙ САМИЙ результат для «ключа
/// немає» і «ключ є, значення `""`» — перевірено grep-ом по всіх пʼяти
/// файлах на відсутність `not …\.uses`-подібних existence-перевірок, які
/// відрізняли б «відсутній» від «порожній рядок».
fn ensure_step_uses_key_present(root: &Json) -> Json {
    let Json::Object(top) = root else {
        return root.clone();
    };
    Json::Object(
        top.iter()
            .map(|(k, v)| {
                if k == "jobs" {
                    (k.clone(), normalize_jobs_steps(v))
                } else {
                    (k.clone(), v.clone())
                }
            })
            .collect(),
    )
}

fn normalize_jobs_steps(jobs: &Json) -> Json {
    let Json::Object(entries) = jobs else {
        return jobs.clone();
    };
    Json::Object(
        entries
            .iter()
            .map(|(job_id, job)| (job_id.clone(), normalize_job_steps(job)))
            .collect(),
    )
}

fn normalize_job_steps(job: &Json) -> Json {
    let Json::Object(entries) = job else {
        return job.clone();
    };
    Json::Object(
        entries
            .iter()
            .map(|(k, v)| {
                if k == "steps" {
                    (k.clone(), normalize_steps_array(v))
                } else {
                    (k.clone(), v.clone())
                }
            })
            .collect(),
    )
}

fn normalize_steps_array(steps: &Json) -> Json {
    let Json::Array(items) = steps else {
        return steps.clone();
    };
    Json::Array(items.iter().map(normalize_step_uses).collect())
}

fn normalize_step_uses(step: &Json) -> Json {
    let Json::Object(fields) = step else {
        return step.clone();
    };
    if fields.iter().any(|(k, _)| k == "uses") {
        return step.clone();
    }
    let mut new_fields = fields.clone();
    new_fields.push(("uses".to_string(), Json::Str(String::new())));
    Json::Object(new_fields)
}

/// Escape рядка для вбудовування в JSON — той самий helper, що
/// [`json_escape_string`] вище (`rust/toolchain_cache`), перевикористаний
/// тут для JSON-серіалізації [`Json`].
fn write_json(value: &Json, out: &mut String) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Int(i) => out.push_str(&i.to_string()),
        Json::Float(f) => {
            if f.is_finite() {
                out.push_str(&f.to_string());
            } else {
                // JSON не має NaN/Infinity — GH Actions workflow YAML ніколи
                // не містить такого скаляра; захисний фолбек, не досяжний
                // на практиці.
                out.push('0');
            }
        }
        Json::Str(s) => out.push_str(&json_escape_string(s)),
        Json::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        Json::Object(entries) => {
            out.push('{');
            for (i, (k, v)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&json_escape_string(k));
                out.push(':');
                write_json(v, out);
            }
            out.push('}');
        }
    }
}

fn json_to_string(value: &Json) -> String {
    let mut out = String::new();
    write_json(value, &mut out);
    out
}

// =====================================================================
// ТРЕТЯ хвиля — `Json` deep-subset/deep-merge (точний порт `checkSnippet`/
// `mergeJsonValue`/`containedIn`/`identityKey`, `npm/scripts/lib/template.mjs`
// і `npm/scripts/lib/fix/template-deep-merge.mjs`) + два нові серіалізатори
// (доккомент модуля, розділ «ТРЕТЯ хвиля»).
// =====================================================================

/// Deep subset-of перевірка — точний функціональний відповідник
/// `checkSnippet(actual, snippet, opts).length === 0` (`template.mjs`), БЕЗ
/// побудови повідомлень (порт тут використовує тексти з Rego-виводу
/// [`eval_deny_rule`] для видимих violation-ів; ЦЯ функція лише вирішує
/// «чи fix-writer вже задовольняє snippet», той самий контракт, що
/// `computeJsonNextText`/`computeYamlNextText` — булевий шорткат навколо
/// `checkSnippet(...).length === 0`). `actual: None` — той самий канал, що
/// JS `actual[k] === undefined` (ключа немає ЧИ `actual` не обʼєкт).
fn is_subset(actual: Option<&Json>, snippet: &Json) -> bool {
    match snippet {
        Json::Null => true,
        Json::Array(items) => match actual {
            Some(Json::Array(arr)) => items.iter().all(|needle| contained_in(arr, needle)),
            _ => false,
        },
        Json::Object(entries) => match actual {
            Some(Json::Object(_)) => entries
                .iter()
                .all(|(k, v)| is_subset(actual.and_then(|a| a.get(k)), v)),
            _ => false,
        },
        leaf => actual == Some(leaf),
    }
}

/// Чи `needle` структурно вже присутній у якомусь елементі `actual_array` —
/// точний відповідник `containedIn` (`template-deep-merge.mjs`).
fn contained_in(actual_array: &[Json], needle: &Json) -> bool {
    actual_array.iter().any(|a| is_subset(Some(a), needle))
}

/// Ключ ідентичності елемента масиву обʼєктів — точний відповідник
/// `identityKey` (`template-deep-merge.mjs`): `name`-поле, інакше
/// `uses`-поле БЕЗ версії (`actions/x@v6` → `uses:actions/x`).
fn identity_key(obj: &Json) -> Option<String> {
    let Json::Object(_) = obj else {
        return None;
    };
    if let Some(name) = obj.get("name").and_then(Json::as_str) {
        return Some(format!("name:{name}"));
    }
    if let Some(uses) = obj.get("uses").and_then(Json::as_str) {
        let base = uses.split('@').next().unwrap_or(uses);
        return Some(format!("uses:{base}"));
    }
    None
}

/// Індекс елемента `actual_array` з тим самим [`identity_key`], що й
/// `needle` — точний відповідник `findIdentityIndex`.
fn find_identity_index(actual_array: &[Json], needle: &Json) -> Option<usize> {
    let key = identity_key(needle)?;
    actual_array
        .iter()
        .position(|a| identity_key(a).as_deref() == Some(key.as_str()))
}

/// Рекурсивний deep-merge snippet у [`Json`] — точний відповідник
/// `mergeJsonValue` (`template-deep-merge.mjs`): масиви — union за
/// [`contained_in`]/[`find_identity_index`] (структурний збіг пропускається,
/// той самий `name`/`uses` оновлюється on-place, інакше — додається);
/// обʼєкти — рекурсія по ключах snippet-а (зайві поля `actual` незайманими);
/// листя — canonical-значення перезаписує.
fn merge_json_value(actual: Option<&Json>, snippet: &Json) -> Json {
    match snippet {
        Json::Array(items) => {
            let mut arr: Vec<Json> = match actual {
                Some(Json::Array(a)) => a.clone(),
                _ => Vec::new(),
            };
            for needle in items {
                if contained_in(&arr, needle) {
                    continue;
                }
                match find_identity_index(&arr, needle) {
                    Some(idx) => {
                        let merged = merge_json_value(Some(&arr[idx]), needle);
                        arr[idx] = merged;
                    }
                    None => arr.push(needle.clone()),
                }
            }
            Json::Array(arr)
        }
        Json::Object(entries) => {
            let mut obj: Vec<(String, Json)> = match actual {
                Some(Json::Object(o)) => o.clone(),
                _ => Vec::new(),
            };
            for (k, v) in entries {
                let child = obj.iter().find(|(kk, _)| kk == k).map(|(_, vv)| vv);
                let merged = merge_json_value(child, v);
                match obj.iter_mut().find(|(kk, _)| kk == k) {
                    Some(entry) => entry.1 = merged,
                    None => obj.push((k.clone(), merged)),
                }
            }
            Json::Object(obj)
        }
        leaf => leaf.clone(),
    }
}

/// Pretty JSON — точний відповідник `JSON.stringify(x, null, 2) + '\n'`
/// (2-пробільний відступ). Використовується лише для `.json`-таргетів
/// ([`fix_vscode_extensions`]/[`fix_template_merge`] з `is_yaml: false`) —
/// на відміну від [`write_json`]/[`json_to_string`] (компактний, лише для
/// regorus `input`/`data`).
fn write_json_pretty(value: &Json, indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    let pad_in = "  ".repeat(indent + 1);
    match value {
        Json::Array(items) if items.is_empty() => out.push_str("[]"),
        Json::Array(items) => {
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                out.push_str(&pad_in);
                write_json_pretty(item, indent + 1, out);
                if i + 1 < items.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&pad);
            out.push(']');
        }
        Json::Object(entries) if entries.is_empty() => out.push_str("{}"),
        Json::Object(entries) => {
            out.push_str("{\n");
            for (i, (k, v)) in entries.iter().enumerate() {
                out.push_str(&pad_in);
                out.push_str(&json_escape_string(k));
                out.push_str(": ");
                write_json_pretty(v, indent + 1, out);
                if i + 1 < entries.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&pad);
            out.push('}');
        }
        scalar => write_json(scalar, out),
    }
}

fn json_to_pretty_string(value: &Json) -> String {
    let mut out = String::new();
    write_json_pretty(value, 0, &mut out);
    out.push('\n');
    out
}

/// Block-стиль YAML-серіалізатор [`Json`] — доккомент модуля, розділ «ТРЕТЯ
/// хвиля»: НЕ comment-preserving (регенерує з нуля, на відміну від JS-канону
/// `yaml`-пакета), рядкові скаляри ЗАВЖДИ у подвійних лапках ([`json_escape_string`],
/// валідний YAML double-quoted scalar — той самий escaping, що JSON), щоб
/// уникнути plain-scalar quoting-евристик (`: `, `#`, provisions GH Actions
/// `${{ }}`-виразів тощо) — гарантовано валідний YAML 1.2 ЦІНОЮ втрати
/// «природної» неквотованої форми канону. Корінь має бути [`Json::Object`]
/// (обидва наші YAML-таргети — мапи), інакше — panics (внутрішній інваріант
/// викличної сторони, не runtime-умова).
fn write_yaml_block(root: &Json) -> String {
    let Json::Object(entries) = root else {
        panic!("write_yaml_block: корінь має бути обʼєктом");
    };
    let mut out = String::new();
    write_yaml_object_entries(entries, 0, &mut out);
    out
}

fn write_yaml_object_entries(entries: &[(String, Json)], indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    for (k, v) in entries {
        out.push_str(&pad);
        out.push_str(&yaml_key(k));
        out.push(':');
        write_yaml_value_after_colon(v, indent, out);
    }
}

/// Пише значення після `key:` — inline скаляр/`{}`/`[]`, чи блок з нового
/// рядка для непорожніх обʼєктів/масивів. `indent` — рівень БАТЬКІВСЬКОГО
/// ключа (масиви — той самий рівень відступу, що ключ; обʼєкти — +1).
fn write_yaml_value_after_colon(v: &Json, indent: usize, out: &mut String) {
    match v {
        Json::Object(e) if e.is_empty() => out.push_str(" {}\n"),
        Json::Object(e) => {
            out.push('\n');
            write_yaml_object_entries(e, indent + 1, out);
        }
        Json::Array(items) if items.is_empty() => out.push_str(" []\n"),
        Json::Array(items) => {
            out.push('\n');
            write_yaml_array_items(items, indent, out);
        }
        scalar => {
            out.push(' ');
            out.push_str(&yaml_scalar(scalar));
            out.push('\n');
        }
    }
}

fn write_yaml_array_items(items: &[Json], indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    for item in items {
        out.push_str(&pad);
        out.push_str("- ");
        match item {
            Json::Object(entries) if !entries.is_empty() => {
                // Перший ключ — на тому самому рядку, що `- `; решта — з
                // відступом на один рівень глибше (стандартна GH Actions
                // block-форма `- uses: …\n  with: …`).
                let (first, rest) = entries.split_first().expect("непорожній");
                out.push_str(&yaml_key(&first.0));
                out.push(':');
                write_yaml_value_after_colon(&first.1, indent + 1, out);
                write_yaml_object_entries(rest, indent + 1, out);
            }
            Json::Array(sub) if !sub.is_empty() => {
                out.push('\n');
                write_yaml_array_items(sub, indent + 1, out);
            }
            _ => {
                out.push_str(&yaml_scalar(item));
                out.push('\n');
            }
        }
    }
}

/// Ключ мапи — YAML-ключі в цих snippet-ах завжди прості ідентифікатори
/// (`name`/`uses`/`on`/`jobs`/…) чи `[github-actions-workflow]`-подібні
/// VS-Code-специфічні рядки ([`ga/vscode_settings`]) — той самий
/// double-quote мотив, що [`yaml_scalar`], щоб не вгадувати безпечність.
fn yaml_key(k: &str) -> String {
    json_escape_string(k)
}

/// Скаляр — рядки завжди в подвійних лапках (доккомент [`write_yaml_block`]),
/// решта — той самий текст, що [`write_json`] (валідний і в YAML: `null`/
/// `true`/`false`/число — той самий literal-запис в обох форматах).
fn yaml_scalar(v: &Json) -> String {
    match v {
        Json::Str(s) => json_escape_string(s),
        other => {
            let mut out = String::new();
            write_json(other, &mut out);
            out
        }
    }
}

/// Парсить довільний вшитий шаблонний текст (YAML чи JSON — JSON є валідним
/// YAML 1.2, тож той самий [`saphyr`]-парсер обслуговує обидва розширення
/// без окремого JSON-крейта) у [`Json`]. Панікує на помилці — вшиті
/// template-файли є ЧАСТИНОЮ крейта (не user-вхід): парс-помилка тут
/// означала б зламаний `include_str!`-асет, структурний баг порту, не
/// runtime-умову, яку варто деградувати.
fn parse_embedded_template(source_name: &str, content: &str) -> Json {
    use saphyr::{LoadableYamlNode, YamlOwned};
    let docs = YamlOwned::load_from_str(content)
        .unwrap_or_else(|e| panic!("вшитий template {source_name} — валідний YAML/JSON: {e}"));
    let doc = docs
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("вшитий template {source_name} — непорожній"));
    yaml_owned_to_json(&doc)
}

/// Обгортає розпарсений шаблонний снапшот у `{"template":{"snippet": …}}` —
/// точна JSON-форма, яку канон пише у `--data <tmpfile>` через
/// `runConftestBatch` (`{ template: templateData }`, `templateData.snippet`
/// = розпарсений `.snippet.yml`/`.snippet.json`, доккомент модуля).
fn wrap_template_data(snippet: Json) -> String {
    json_to_string(&Json::Object(vec![(
        "template".to_string(),
        Json::Object(vec![("snippet".to_string(), snippet)]),
    )]))
}

/// Пʼять `--data`-документів, розпарсені й обгорнуті ОДИН раз (не на кожен
/// workflow-файл) — [`run_all_ga_rego`] викликає це на вході, а не всередині
/// циклу.
struct RegoTemplates {
    clean_ga_workflows: String,
    clean_merged_branch: String,
    lint_ga: String,
    git_ai: String,
    workflow_common: String,
}

fn build_rego_templates() -> RegoTemplates {
    RegoTemplates {
        clean_ga_workflows: wrap_template_data(parse_embedded_template(
            "clean-ga-workflows.yml.snippet.yml",
            CLEAN_GA_WORKFLOWS_SNIPPET_YML,
        )),
        clean_merged_branch: wrap_template_data(parse_embedded_template(
            "clean-merged-branch.yml.snippet.yml",
            CLEAN_MERGED_BRANCH_SNIPPET_YML,
        )),
        lint_ga: wrap_template_data(parse_embedded_template(
            "lint-ga.yml.snippet.yml",
            LINT_GA_SNIPPET_YML,
        )),
        git_ai: wrap_template_data(parse_embedded_template(
            "git-ai.yml.snippet.yml",
            GIT_AI_SNIPPET_YML,
        )),
        workflow_common: wrap_template_data(parse_embedded_template(
            "uses-min-versions.snippet.json",
            USES_MIN_VERSIONS_SNIPPET_JSON,
        )),
    }
}

/// Витягує рядкові елементи з результату `eval_rule("data.<ns>.deny")` —
/// `deny contains msg if {...}` компілюється в regorus `Value::Set`
/// (`BTreeSet<Value>`, природно відсортований — той самий порядок, що OPA
/// маршалить set у JSON, node conftest на боці канону читає). `Array`
/// толерується про запас (той самий дух, що решта контракту), інші
/// варіанти (Undefined тощо) дають порожній результат.
fn extract_string_set(value: &regorus::Value) -> Vec<String> {
    match value {
        regorus::Value::Set(set) => set.iter().filter_map(value_as_owned_string).collect(),
        regorus::Value::Array(arr) => arr.iter().filter_map(value_as_owned_string).collect(),
        _ => Vec::new(),
    }
}

fn value_as_owned_string(value: &regorus::Value) -> Option<String> {
    match value {
        regorus::Value::String(s) => Some(s.to_string()),
        _ => None,
    }
}

/// Один regorus-виклик: новий [`regorus::Engine`], один `add_policy`,
/// опційний `add_data_json` (шаблон-канон), один `set_input_json` +
/// `eval_rule("data.<namespace>.deny")` — точний відповідник ОДНОГО спавну
/// `conftest test <file> -p <policyDir> --namespace <namespace> [--data …]`
/// (`runConftestBatch`) для ОДНОГО файла. Помилка (побитий policy-текст чи
/// вхідний JSON) позначена стадією (`"compile"`/`"set_input"`/`"eval"`,
/// перший елемент кортежу помилки) — [`run_all_ga_rego`] перетворює її на
/// видиму діагностику через [`push_rego_engine_error`], НЕ ковтає мовчки:
/// живий rego верифікований 55 `conftest verify`-тестами, тож продакшн-шлях
/// сюди не потрапляє СЬОГОДНІ, але мовчазний fail-open — найгірший режим
/// відмови лінтера (зелено, бо нічого не перевірено), тож про регресію
/// (апгрейд `regorus`, зламаний вшитий `.rego`) користувач має дізнатись з
/// діагностики, а не з тиші (звіт задачі, «правка 1»). Викликається лише
/// для чотирьох per-workflow таргетів, НЕ для `workflow_common` (там один
/// `Engine` на весь батч файлів, [`build_workflow_common_engine`] —
/// доккомент модуля, розділ «regorus дає РІВНО один `input`»).
fn eval_deny_rule(
    rego_source: &str,
    namespace: &str,
    data_json: &str,
    input_json: &str,
) -> Result<Vec<String>, (&'static str, String)> {
    let mut engine = regorus::Engine::new();
    engine
        .add_policy(format!("{namespace}.rego"), rego_source.to_string())
        .map_err(|e| ("compile", e.to_string()))?;
    engine
        .add_data_json(data_json)
        .map_err(|e| ("compile", e.to_string()))?;
    engine
        .set_input_json(input_json)
        .map_err(|e| ("set_input", e.to_string()))?;
    let result = engine
        .eval_rule(format!("data.{namespace}.deny"))
        .map_err(|e| ("eval", e.to_string()))?;
    Ok(extract_string_set(&result))
}

/// Один `Engine` для `ga.workflow_common`, підготовлений ОДИН раз (policy +
/// data), потім `set_input`+`eval_rule` у циклі по файлах
/// ([`run_all_ga_rego`]) — точний відповідник ОДНОГО батч-спавну
/// `conftest test <files...> --namespace ga.workflow_common --data …`
/// канону, перекладений у явний Rust-цикл (доккомент модуля).
fn build_workflow_common_engine(data_json: &str) -> Result<regorus::Engine, String> {
    let mut engine = regorus::Engine::new();
    engine
        .add_policy(
            "workflow_common.rego".to_string(),
            WORKFLOW_COMMON_REGO.to_string(),
        )
        .map_err(|e| e.to_string())?;
    engine.add_data_json(data_json).map_err(|e| e.to_string())?;
    Ok(engine)
}

/// Патерн rego-violation про відсутній `persist-credentials` — точний
/// відповідник `CHECKOUT_PERSIST_RE = /persist-credentials/u` (`main.mjs`):
/// простий substring-тест (регекс без метасимволів), regex-крейт тут зайвий.
const CHECKOUT_PERSIST_NEEDLE: &str = "persist-credentials";

/// `reason`/`data.kind` — точний відповідник `CHECKOUT_PERSIST_CREDENTIALS`
/// (`main.mjs`). Спільна константа для detect ([`checkout_persist_hint`]) і
/// fix ([`fix_workflows`], доккомент розділу «`ga/workflows` — Т0-фіксер
/// ПОРТОВАНО») — ОДНЕ джерело рядка, не дві копії, що можуть розійтись.
const WORKFLOWS_CHECKOUT_PERSIST_REASON: &str = "checkout-persist-credentials";

/// `reason`/`data.kind` — точний відповідник `UNMATCHED_PATHS_GLOB`
/// (`main.mjs`). Спільна константа для detect ([`verify_one_paths_glob`]) і
/// fix ([`fix_workflows`]) — той самий мотив, що [`WORKFLOWS_CHECKOUT_PERSIST_REASON`].
const WORKFLOWS_UNMATCHED_PATHS_GLOB_REASON: &str = "unmatched-paths-glob";

/// `reason`/`data.kind` — точний відповідник `BARE_N_RULES`
/// (`main.mjs`). Спільна константа для detect ([`verify_no_bare_n_cursor`])
/// і fix ([`fix_workflows`]) — той самий мотив, що [`WORKFLOWS_CHECKOUT_PERSIST_REASON`].
const WORKFLOWS_BARE_NCURSOR_REASON: &str = "bare-n-rules";

/// Structured fix-hint для rego-violation про `actions/checkout` без
/// `persist-credentials: false` — точний відповідник `checkoutPersistHint`
/// (`main.mjs`). Повертає `(reason, file, data)` чи `None`.
fn checkout_persist_hint(
    file: &str,
    message: &str,
) -> Option<(&'static str, String, &'static str)> {
    if message.contains(CHECKOUT_PERSIST_NEEDLE) {
        Some((
            WORKFLOWS_CHECKOUT_PERSIST_REASON,
            file.to_string(),
            "{\"kind\":\"checkout-persist-credentials\"}",
        ))
    } else {
        None
    }
}

/// Пуш rego-violation у формі, яку `main.mjs` дає ОБИДВОМ вузлам
/// (`runAllGaRego`, per-workflow ЦИКЛ і `workflow_common`): `message =
/// "<prefix>: <rego msg>"`, `reason`/`file`/`data` — з [`checkout_persist_hint`]
/// (`prefix` — той самий рядок, що і message-префікс, і `file`-параметр
/// хінта: для per-workflow це `target.workflow`, для `workflow_common` —
/// `v.filename`/`relative(cwd, v.filename)`, які в порту завжди РІВНІ
/// `SourceFile.path` — доккомент модуля).
fn push_rego_violation(diagnostics: &mut Vec<Diagnostic>, prefix: &str, rego_message: &str) {
    let message = format!("{prefix}: {rego_message}");
    let (reason, file, data) = match checkout_persist_hint(prefix, rego_message) {
        Some((reason, file, data)) => (reason.to_string(), Some(file), Some(data.to_string())),
        None => (DEFAULT_REASON.to_string(), None, None),
    };
    diagnostics.push(Diagnostic {
        reason,
        message,
        file,
        severity: Severity::Error,
        data,
    });
}

/// `reason` видимої діагностики, коли сам regorus-виклик (не rego-правило,
/// а інфраструктура навколо нього) провалюється — compile/set_input/eval,
/// доккомент [`eval_deny_rule`]. Заміна мовчазного fail-open (звіт задачі,
/// «правка 1»): без каноничного `main.mjs`-відповідника, тому reason новий
/// (не порт існуючого JS-рядка).
const REGO_ENGINE_ERROR_REASON: &str = "rego-engine-error";

/// Пуш видимої діагностики про провал самого regorus-виклику
/// (compile/set_input/eval) — точна протилежність мовчазного fail-open, що
/// був тут раніше (`if let Ok(...)`/`let Ok(...) else { continue }`, звіт
/// задачі «правка 1»): якщо гілка, яку доккомент [`eval_deny_rule`] називає
/// «структурно недосяжною», раптом стане досяжною (регресія в одному з
/// пʼяти вшитих `.rego`, апгрейд `regorus`, зміна форми YAML), лінт має
/// показати помилку, а не тишу. `file` — шлях workflow-файлу для per-file
/// помилок (per-workflow таргети, `workflow_common` per-file
/// `set_input`/`eval`); `None` — для batch-рівня (провал компіляції
/// `workflow_common`-engine ще до першого файлу батчу).
fn push_rego_engine_error(
    diagnostics: &mut Vec<Diagnostic>,
    file: Option<&str>,
    namespace: &str,
    stage: &str,
    err: &str,
) {
    let location = file.unwrap_or(".github/workflows");
    diagnostics.push(Diagnostic {
        reason: REGO_ENGINE_ERROR_REASON.to_string(),
        message: format!(
            "{location}: regorus-виклик policy-пакета {namespace} провалився на етапі \
             {stage}: {err} — це має бути структурно недосяжно (живий rego верифікований \
             55 conftest verify-тестами); якщо бачиш це в реальному прогоні, перевір недавні \
             зміни в .rego чи версію regorus"
        ),
        file: file.map(str::to_string),
        severity: Severity::Error,
        data: Some(format!(
            "{{\"kind\":\"rego-engine-error\",\"namespace\":\"{namespace}\",\"stage\":\"{stage}\"}}"
        )),
    });
}

/// Fail-діагностика з дефолтним `reason` (`DEFAULT_REASON`) і без `file`/
/// `data` — точний відповідник `fail(msg)` БЕЗ опцій (`violation-reporter.mjs`).
fn simple_fail(message: String) -> Diagnostic {
    Diagnostic {
        reason: DEFAULT_REASON.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Чи `path` — прямий (не вкладений) запис `.github/workflows/` — точний
/// відповідник елементів `readdir(wfDir)` (`main.mjs`): нерекурсивний
/// listing директорії. Host-батч будується за glob `.github/workflows/*`
/// (`plugin.toml`), який структурно не матчить вкладені шляхи, але фільтр
/// тут — захист понад це (той самий мотив, що `is_workflow_path` у
/// `rust/toolchain_cache`).
fn is_workflow_dir_entry(path: &str) -> bool {
    match path.strip_prefix(".github/workflows/") {
        Some(rest) => !rest.is_empty() && !rest.contains('/'),
        None => false,
    }
}

/// Базове імʼя файлу в `.github/workflows/` — панікує лише якщо викликано
/// не на `is_workflow_dir_entry`-відфільтрованому шляху (внутрішній
/// інваріант порту).
fn workflow_basename(path: &str) -> &str {
    path.strip_prefix(".github/workflows/").unwrap_or(path)
}

/// Чи варто перевіряти glob з `on.*.paths` на наявність збігів у
/// репозиторії — точний відповідник `shouldValidateWorkflowPathsGlob`
/// (`main.mjs`).
fn should_validate_workflow_paths_glob(p: &str) -> bool {
    if p.starts_with('!') {
        return false;
    }
    if OPTIONAL_CANONICAL_PATH_GLOBS.contains(&p) {
        return false;
    }
    !p.contains("*.")
}

/// Точний відповідник `gitHasAnyTrackedFileMatchingGlob` (`main.mjs`):
/// `git ls-files -z -- :(glob)<p>` через `exec-tool` (`path:git`,
/// `plugin.toml`). Порожній рядок — `false`; негативний патерн (`!…`) —
/// `true` без спавну (той самий захисний branch, що канон — практично
/// недосяжний тут, бо виклик відбувається лише після
/// [`should_validate_workflow_paths_glob`], яка вже відфільтрувала `!…`,
/// але порт зберігає ту саму двошарову форму, що JS).
fn git_has_any_tracked_file_matching_glob(pattern: &str) -> bool {
    let p = pattern.trim();
    if p.is_empty() {
        return false;
    }
    if p.starts_with('!') {
        return true;
    }
    let result = exec_tool(&ToolRequest {
        tool: "path:git".to_string(),
        args: vec![
            "ls-files".to_string(),
            "-z".to_string(),
            "--".to_string(),
            format!(":(glob){p}"),
        ],
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    matches!(result.status, Some(0)) && !result.stdout.is_empty()
}

/// Точний відповідник `verifyOnePathsGlob` (`main.mjs`).
fn verify_one_paths_glob(
    diagnostics: &mut Vec<Diagnostic>,
    rel_path: &str,
    event_name: &str,
    raw: &str,
) {
    let p = raw.trim();
    if p.is_empty() {
        return;
    }
    if !should_validate_workflow_paths_glob(p) {
        return;
    }
    if git_has_any_tracked_file_matching_glob(p) {
        return;
    }
    diagnostics.push(Diagnostic {
        reason: WORKFLOWS_UNMATCHED_PATHS_GLOB_REASON.to_string(),
        message: format!(
            "{rel_path}: on.{event_name}.paths glob не матчитсья ні на один файл: {}",
            json_escape_string(p)
        ),
        file: Some(rel_path.to_string()),
        severity: Severity::Error,
        data: Some(format!(
            "{{\"kind\":\"unmatched-paths-glob\",\"event\":{},\"glob\":{}}}",
            json_escape_string(event_name),
            json_escape_string(p)
        )),
    });
}

/// Точний відповідник `verifyWorkflowEventPathsGlobsExist` (`main.mjs`).
/// На відміну від Rego-боку ([`build_rego_templates`]-споживачів), `on`
/// тут читається БЕЗ `"true"`-фолбеку: `root` — [`Json`] з [`parse_yaml_document`]
/// (наш власний [`saphyr`]-парсер, YAML 1.2 завжди), не conftest-параметр
/// (Go-yaml, YAML 1.1) — фолбек-гілка структурно недосяжна (доккомент модуля).
fn verify_workflow_event_paths_globs_exist(
    diagnostics: &mut Vec<Diagnostic>,
    rel_path: &str,
    root: &Json,
) {
    let Some(on) = root.get("on") else {
        return;
    };
    if !matches!(on, Json::Object(_)) {
        return;
    }
    for event_name in ["push", "pull_request"] {
        let Some(paths) = on
            .get(event_name)
            .and_then(|ev| ev.get("paths"))
            .and_then(Json::as_array)
        else {
            continue;
        };
        for raw in paths {
            let Some(s) = raw.as_str() else {
                continue;
            };
            verify_one_paths_glob(diagnostics, rel_path, event_name, s);
        }
    }
}

/// Точний відповідник `RUN_INLINE_NCURSOR_RE`/`BARE_LINE_NCURSOR_RE`/
/// `WRAPPED_NCURSOR_RE` + `verifyNoBareNCursor` (`main.mjs`).
fn verify_no_bare_n_cursor(diagnostics: &mut Vec<Diagnostic>, rel_path: &str, content: &str) {
    let run_inline = regex::Regex::new(r"^\s*(?:-\s*)?run:\s*n-(?:cursor|rules)\s")
        .expect("RUN_INLINE_NCURSOR_RE валідний");
    let bare_line =
        regex::Regex::new(r"^\s+n-(?:cursor|rules)\s").expect("BARE_LINE_NCURSOR_RE валідний");
    let wrapped = regex::Regex::new(r"\b(?:bunx|npx)\s+n-(?:cursor|rules)")
        .expect("WRAPPED_NCURSOR_RE валідний");
    for (i, line) in content.split('\n').enumerate() {
        if wrapped.is_match(line) {
            continue;
        }
        if !run_inline.is_match(line) && !bare_line.is_match(line) {
            continue;
        }
        diagnostics.push(Diagnostic {
            reason: WORKFLOWS_BARE_NCURSOR_REASON.to_string(),
            message: format!(
                "{rel_path}: `n-rules …` (рядок {}) має бути `bunx n-rules …` — n-rules не на PATH у CI (ga.mdc)",
                i + 1
            ),
            file: Some(rel_path.to_string()),
            severity: Severity::Error,
            data: Some("{\"kind\":\"bare-n-rules\"}".to_string()),
        });
    }
}

/// Точний відповідник `checkGaWorkflowFiles` (`main.mjs`) — УВАГА:
/// `.yaml`-файл дає ДВІ окремі violation (specific rename-message з першого
/// циклу + generic "має бути .yml" з другого, бо `.yaml` не закінчується на
/// `.yml`) — канон буквально так, порт НЕ згортає в одну.
fn check_ga_workflow_files(diagnostics: &mut Vec<Diagnostic>, filenames: &[String]) {
    for f in filenames.iter().filter(|f| f.ends_with(".yaml")) {
        diagnostics.push(simple_fail(format!(
            "Workflow з розширенням .yaml: .github/workflows/{f} — перейменуй на .yml"
        )));
    }
    for f in filenames.iter().filter(|f| !f.ends_with(".yml")) {
        diagnostics.push(simple_fail(format!(
            "Workflow має бути з розширенням .yml: .github/workflows/{f} (ga.mdc)"
        )));
    }
    for req in REQUIRED_WORKFLOWS {
        if !filenames.iter().any(|f| f == req) {
            diagnostics.push(simple_fail(format!("Відсутній .github/workflows/{req}")));
        }
    }
}

/// Точний відповідник `eventPathsIncludeExact` (`gha-workflow.mjs`), над
/// [`Json`] замість JS-обʼєкта.
fn event_paths_include_exact(root: &Json, event: &str, exact: &str) -> bool {
    root.get("on")
        .and_then(|on| on.get(event))
        .and_then(|ev| ev.get("paths"))
        .and_then(Json::as_array)
        .is_some_and(|paths| paths.iter().any(|p| p.as_str() == Some(exact)))
}

/// Точний відповідник `checkApplyWorkflow` (`main.mjs`).
fn check_apply_workflow(
    diagnostics: &mut Vec<Diagnostic>,
    files: &[SourceFile],
    filename: &str,
    expected_path: &str,
) {
    let path = format!(".github/workflows/{filename}");
    let Some(file) = files.iter().find(|f| f.path == path) else {
        return;
    };
    let ok = match parse_yaml_document(&file.content) {
        Some(root) => event_paths_include_exact(&root, "push", expected_path),
        None => file.content.contains(expected_path),
    };
    if !ok {
        diagnostics.push(simple_fail(format!(
            "{filename} не містить paths: {expected_path}"
        )));
    }
}

/// Точний відповідник `MEGALINTER_USE_PATTERNS` + `checkMegalinter`
/// (`main.mjs`) — case-insensitive substring (обидва патерни канону не
/// мають regex-метасимволів понад буквальний `/`, тож lowercase-contains —
/// той самий контракт, що `/…/i`).
fn check_megalinter(
    diagnostics: &mut Vec<Diagnostic>,
    yml_workflows: &[&SourceFile],
    files: &[SourceFile],
) {
    for f in yml_workflows {
        let lower = f.content.to_lowercase();
        if lower.contains("oxsecurity/megalinter-action") || lower.contains("megalinter/megalinter")
        {
            let name = workflow_basename(&f.path);
            diagnostics.push(simple_fail(format!(
                "MegaLinter у workflow .github/workflows/{name} — видали інтеграцію (ga.mdc: MegaLinter)"
            )));
        }
    }
    for name in MEGALINTER_CONFIG_NAMES {
        if files.iter().any(|f| f.path == name) {
            diagnostics.push(simple_fail(format!(
                "Файл {name} — видали конфіг MegaLinter (ga.mdc: MegaLinter)"
            )));
        }
    }
}

/// Точний відповідник `checkShellcheckInstalled` (`main.mjs`) — структурна
/// відмінність (звіт задачі): канон лише ПЕРЕВІРЯЄ присутність
/// (`resolveCmd`, без спавну), порт СПАВНИТЬ `shellcheck --version` через
/// `exec-tool` (WIT-контракт не дає «перевір presence без запуску»-примітиву
/// — той самий підхід, що `status: None`-проба в `rust/check`-подібних
/// концернів попередніх гостей). Спостережувана поведінка (є/немає
/// shellcheck у PATH) — та сама.
fn check_shellcheck_installed(diagnostics: &mut Vec<Diagnostic>) {
    let result = exec_tool(&ToolRequest {
        tool: "shellcheck".to_string(),
        args: vec!["--version".to_string()],
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    if result.status.is_some() {
        return;
    }
    diagnostics.push(simple_fail(
        [
            "shellcheck не знайдено в PATH — actionlint без нього мовчки пропускає shell-перевірки в run: блоках,",
            "тому локальний `bun lint-ga` буде зелений, а CI на ubuntu-latest (де shellcheck передвстановлений) падатиме.",
            "Встанови: macOS — `brew install shellcheck`; Debian/Ubuntu — `sudo apt-get install -y shellcheck`;",
            "Arch — `sudo pacman -S shellcheck` (ga.mdc)",
        ]
        .join(" "),
    ));
}

/// Точний відповідник кроку `actionlint` у `lint()` (`main.mjs:401-402`):
/// `bunx github-actionlint` → `npm:github-actionlint` напряму (доккомент
/// модуля, розділ «Чотири зовнішні тули»). `status: None` (тул не
/// зарезолвлено) трактується як skip — той самий контракт, що code `127`
/// канону (`resolveCmd` не знайшов `bunx`).
fn run_actionlint(diagnostics: &mut Vec<Diagnostic>) {
    let result = exec_tool(&ToolRequest {
        tool: "npm:github-actionlint".to_string(),
        args: vec![],
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    let Some(code) = result.status else {
        push_tool_unavailable(
            diagnostics,
            "actionlint",
            "Тул береться як npm-пакет `github-actionlint`; перевір, що `node_modules/.bin` цілий (`bun install`).",
        );
        return;
    };
    if code == 127 {
        push_tool_unavailable(
            diagnostics,
            "actionlint",
            "Код 127 — виконуваний файл не знайдено; перевір, що `node_modules/.bin` цілий (`bun install`).",
        );
        return;
    }
    if code != 0 {
        diagnostics.push(Diagnostic {
            reason: "actionlint".to_string(),
            message: "actionlint знайшов порушення (ga.mdc)".to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
}

/// Точний відповідник кроку `zizmor` (`main.mjs:403-406`) — з ОДНІЄЮ
/// структурною відмінністю (звіт задачі): канон гейтить сам ВИКЛИК на
/// `resolveCmd('uv')` (presence-проба ОКРЕМОГО бінарника `uv`, не `uvx`);
/// WIT-контракт не дає presence-проби без спавну, тож порт завжди намагається
/// `exec-tool("path:uvx", …)` — `status: None` (тул не зарезолвлено чи не
/// зміг стартувати) дає ТОЙ САМИЙ спостережуваний результат (жодної
/// zizmor-діагностики), лише без раннього skip до спавну.
fn run_zizmor(diagnostics: &mut Vec<Diagnostic>) {
    let result = exec_tool(&ToolRequest {
        tool: "path:uvx".to_string(),
        args: vec![
            "zizmor".to_string(),
            "--offline".to_string(),
            "--collect=workflows".to_string(),
            ".".to_string(),
        ],
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    let Some(code) = result.status else {
        push_tool_unavailable(
            diagnostics,
            "zizmor",
            "Це SECURITY-скан workflow-ів — його мовчазний пропуск лишав лінт зеленим без перевірки. Потрібен `uvx` у PATH (`brew install uv` / `pipx install uv`).",
        );
        return;
    };
    if code == 127 {
        push_tool_unavailable(
            diagnostics,
            "zizmor",
            "Код 127 — `uvx` не знайдено в PATH (`brew install uv` / `pipx install uv`).",
        );
        return;
    }
    if code != 0 {
        diagnostics.push(Diagnostic {
            reason: "zizmor".to_string(),
            message: "zizmor знайшов ризики у workflow (ga.mdc)".to_string(),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
}

/// Діагностика «зовнішній тул не запустився» — спільна для `actionlint` і
/// `zizmor` (§2.29). До фіксу обидві функції мовчали і на `status: None`
/// (тул не зарезолвлено), і на коді `127` (`resolveCmd` не знайшов `bunx`):
/// перевірка просто не виконувалась, а лінт лишався зеленим. Для `zizmor`
/// це особливо погано — це security-скан workflow-ів.
///
/// Форма взята з [`check_shellcheck_installed`], що вже робив це правильно
/// в цьому ж файлі: назвати тул, пояснити наслідок, дати команду.
fn push_tool_unavailable(diagnostics: &mut Vec<Diagnostic>, tool: &str, hint: &str) {
    diagnostics.push(Diagnostic {
        reason: format!("{tool}-unavailable"),
        message: format!(
            "{tool} не вдалося запустити — перевірку workflow-ів ПРОПУЩЕНО, \
             а не пройдено. {hint} (ga.mdc)"
        ),
        file: None,
        severity: Severity::Error,
        data: None,
    });
}

/// Точний відповідник `runAllGaRego` (`main.mjs`) — доккомент модуля,
/// розділи «regorus замість conftest» і «`--data` template merge».
fn run_all_ga_rego(
    diagnostics: &mut Vec<Diagnostic>,
    wf_files: &[&SourceFile],
    yml_workflows: &[&SourceFile],
) {
    let templates = build_rego_templates();

    let targets: [(&str, &str, &str, &str); 4] = [
        (
            ".github/workflows/clean-ga-workflows.yml",
            "ga.clean_ga_workflows",
            CLEAN_GA_WORKFLOWS_REGO,
            templates.clean_ga_workflows.as_str(),
        ),
        (
            ".github/workflows/clean-merged-branch.yml",
            "ga.clean_merged_branch",
            CLEAN_MERGED_BRANCH_REGO,
            templates.clean_merged_branch.as_str(),
        ),
        (
            ".github/workflows/lint-ga.yml",
            "ga.lint_ga",
            LINT_GA_REGO,
            templates.lint_ga.as_str(),
        ),
        (
            ".github/workflows/git-ai.yml",
            "ga.git_ai",
            GIT_AI_REGO,
            templates.git_ai.as_str(),
        ),
    ];

    for (workflow_path, namespace, rego_source, data_json) in targets {
        let Some(file) = wf_files.iter().find(|f| f.path == workflow_path) else {
            continue;
        };
        let Some(root) = parse_yaml_document(&file.content) else {
            continue;
        };
        let input_json = json_to_string(&ensure_step_uses_key_present(&root));
        match eval_deny_rule(rego_source, namespace, data_json, &input_json) {
            Ok(messages) => {
                for msg in messages {
                    push_rego_violation(diagnostics, workflow_path, &msg);
                }
            }
            Err((stage, err)) => {
                push_rego_engine_error(diagnostics, Some(workflow_path), namespace, stage, &err);
            }
        }
    }

    if yml_workflows.is_empty() {
        return;
    }
    let mut engine = match build_workflow_common_engine(&templates.workflow_common) {
        Ok(engine) => engine,
        Err(err) => {
            push_rego_engine_error(diagnostics, None, "ga.workflow_common", "compile", &err);
            return;
        }
    };
    for file in yml_workflows {
        let Some(root) = parse_yaml_document(&file.content) else {
            continue;
        };
        let input_json = json_to_string(&ensure_step_uses_key_present(&root));
        if let Err(err) = engine.set_input_json(&input_json) {
            push_rego_engine_error(
                diagnostics,
                Some(&file.path),
                "ga.workflow_common",
                "set_input",
                &err.to_string(),
            );
            continue;
        }
        let result = match engine.eval_rule("data.ga.workflow_common.deny".to_string()) {
            Ok(result) => result,
            Err(err) => {
                push_rego_engine_error(
                    diagnostics,
                    Some(&file.path),
                    "ga.workflow_common",
                    "eval",
                    &err.to_string(),
                );
                continue;
            }
        };
        for msg in extract_string_set(&result) {
            push_rego_violation(diagnostics, &file.path, &msg);
        }
    }
}

/// Точний порт `lint()` `ga/workflows` (`main.mjs:392-446`) — доккомент
/// модуля. Єдина структурна межа (не байт-у-байт): [`is_workflow_dir_entry`]
/// на батчі, без прямого `existsSync(wfDir)` — host-батч без жодного
/// `.github/workflows/*`-файла НЕВІДРІЗНИМИЙ від "директорії не існує" (обидва
/// дають порожній список збігів по glob-у). Git не трекає порожні директорії,
/// тож "директорія існує, але порожня" СТРУКТУРНО недосяжна для будь-якого
/// реального репозиторію, який пройшов `git add`/checkout — розбіжність
/// неспостережувана на практиці (звіт задачі).
fn detect_workflows(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    run_actionlint(&mut diagnostics);
    run_zizmor(&mut diagnostics);

    let wf_files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| is_workflow_dir_entry(&f.path))
        .collect();
    if wf_files.is_empty() {
        diagnostics.push(simple_fail(
            "Директорія .github/workflows не існує".to_string(),
        ));
        return diagnostics;
    }

    let yml_workflows: Vec<&SourceFile> = wf_files
        .iter()
        .copied()
        .filter(|f| f.path.ends_with(".yml"))
        .collect();

    run_all_ga_rego(&mut diagnostics, &wf_files, &yml_workflows);

    if !files
        .iter()
        .any(|f| f.path == ".github/actions/setup-bun-deps/action.yml")
    {
        diagnostics.push(simple_fail(
            "Відсутній .github/actions/setup-bun-deps/action.yml — запустіть npx @7n/rules або скопіюйте з пакету (ga.mdc: composite setup-bun-deps)".to_string(),
        ));
    }

    let filenames: Vec<String> = wf_files
        .iter()
        .map(|f| workflow_basename(&f.path).to_string())
        .collect();
    check_ga_workflow_files(&mut diagnostics, &filenames);

    check_apply_workflow(&mut diagnostics, files, "apply-k8s.yml", "**/k8s/**/*.yaml");
    check_apply_workflow(
        &mut diagnostics,
        files,
        "apply-nats-consumer.yml",
        "**/consumer.yaml",
    );

    check_megalinter(&mut diagnostics, &yml_workflows, files);

    for f in &yml_workflows {
        if let Some(root) = parse_yaml_document(&f.content) {
            verify_workflow_event_paths_globs_exist(&mut diagnostics, &f.path, &root);
        }
        verify_no_bare_n_cursor(&mut diagnostics, &f.path, &f.content);
    }

    check_shellcheck_installed(&mut diagnostics);

    diagnostics
}

// =====================================================================
// `ga/workflows` — Т0-фіксер ПОРТОВАНО (перший реальний план цього гостя,
// той самий заголовок-прецедент, що `rust/cargo_mutants_config`/
// `rust/doc_comments` у `crates/plugin-lang-rust`).
//
// Точний семантичний порт трьох чисто текстових T0-патернів
// `fix-workflows.mjs` (`plugins/ci-github/rules/ga/workflows/fix-workflows.mjs`):
// `addPersistCredentials`/`removePathsGlobs`/`prefixBunxNCursor`. Ключова
// відмінність від `rust/cargo_mutants_config`/`rust/doc_comments`: JS-канон
// реєструє ЦІ ТРИ трансформери як ОКРЕМІ `T0Pattern` (застосовуються
// послідовно, кожен через `applyToFiles`, що перечитує файл із ДИСКА між
// викликами — `npm/scripts/utils/apply-to-files.mjs`), тоді як
// `wasmFixPattern` (`npm/scripts/lib/lint-surface/run-fix.mjs`) синтезує
// РІВНО ОДИН `T0Pattern` на весь wasm-концерн: `applyT0` викликає гостьовий
// `fix()` ОДИН раз з ПОВНИМ масивом `violations` цього concern-а (усіх трьох
// kind-ів разом). [`fix_workflows`] тому сам компонує всі три трансформери
// послідовно на ОДНОМУ `content`-буфері (той самий порядок, що масив
// `patterns` JS-канону), а не покладається на проміжний re-detect між ними.
// =====================================================================

/// Літеральний підрядок ПІСЛЯ `uses:`, що ідентифікує крок checkout —
/// точний відповідник `CHECKOUT_USES_RE = /uses:\s*actions\/checkout@/u`
/// (`fix-workflows.mjs`); перевіряється через [`line_has_uses_target`] (той
/// самий helper, що [`scan_toolchain_steps`] вище).
const WORKFLOWS_CHECKOUT_ACTION_TARGET: &str = "actions/checkout@";

/// Індекс першого непорожнього рядка з `from` (включно) — точний
/// відповідник `nextNonEmpty` (`fix-workflows.mjs`).
fn next_non_empty_workflow_line(lines: &[&str], from: usize) -> usize {
    let mut j = from;
    while j < lines.len() && lines[j].trim().is_empty() {
        j += 1;
    }
    j
}

/// Точний відповідник `WITH_LINE_RE = /^\s*with:\s*$/u` — увесь (trim-ований)
/// рядок дорівнює `with:`.
fn is_with_block_line(line: &str) -> bool {
    line.trim() == "with:"
}

/// Точний відповідник `PERSIST_KEY_RE = /^\s*persist-credentials\s*:/u` —
/// той самий підхід, що [`is_workspaces_key`] вище (`strip_prefix` замість
/// regex-крейта).
fn is_persist_credentials_key(line: &str) -> bool {
    match line.trim_start().strip_prefix("persist-credentials") {
        Some(rest) => rest.trim_start().starts_with(':'),
        None => false,
    }
}

/// Точний відповідник `withBlockHasPersist` (`fix-workflows.mjs`): скан від
/// `with_line + 1` до dedent-у (відступ ≤ `col`) на предмет уже наявного
/// `persist-credentials`.
fn with_block_has_persist(lines: &[&str], with_line: usize, col: usize) -> bool {
    for line in lines.iter().skip(with_line + 1) {
        if line.trim().is_empty() {
            continue;
        }
        if indent_of(line) <= col {
            return false; // dedent → блок `with:` завершився
        }
        if is_persist_credentials_key(line) {
            return true;
        }
    }
    false
}

/// Insert-план для одного checkout-кроку — точний відповідник
/// `persistInsertFor` (`fix-workflows.mjs`): `at` — індекс рядка ПЕРЕД яким
/// вставляти, `text` — самі рядки вставки.
struct PersistCredentialsInsert {
    at: usize,
    text: Vec<String>,
}

/// Точний відповідник `persistInsertFor` (`fix-workflows.mjs`): чи крок уже
/// має блок `with:` (на рядку `j`, тій самій колонці, що `uses:`) — якщо
/// так, вставляє ключ УСЕРЕДИНУ (чи `None`, якщо ключ уже там); інакше
/// створює новий блок `with:` одразу ПІСЛЯ рядка `uses:`.
fn persist_credentials_insert_for(
    lines: &[&str],
    i: usize,
    col: usize,
) -> Option<PersistCredentialsInsert> {
    let ind = " ".repeat(col);
    let j = next_non_empty_workflow_line(lines, i + 1);
    let has_with_block =
        j < lines.len() && is_with_block_line(lines[j]) && lines[j].find("with:") == Some(col);
    if has_with_block {
        if with_block_has_persist(lines, j, col) {
            None
        } else {
            Some(PersistCredentialsInsert {
                at: j + 1,
                text: vec![format!("{ind}  persist-credentials: false")],
            })
        }
    } else {
        Some(PersistCredentialsInsert {
            at: i + 1,
            text: vec![
                format!("{ind}with:"),
                format!("{ind}  persist-credentials: false"),
            ],
        })
    }
}

/// Т0-фіксер `checkout-persist-credentials` — точний семантичний порт
/// `addPersistCredentials` (`fix-workflows.mjs`): дописує
/// `with: persist-credentials: false` у кожен `actions/checkout` крок, де
/// його бракує. Усі insert-и зібрані наперед і застосовані ЗГОРИ ВНИЗ (спад
/// за `at`), щоб індекси попередніх вставок не зсувались наступними (той
/// самий коментар, що JS-оригінал).
fn add_persist_credentials(content: &str) -> Option<String> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut inserts: Vec<PersistCredentialsInsert> = Vec::new();
    for i in 0..lines.len() {
        let Some(col) = lines[i].find("uses:") else {
            continue;
        };
        if !line_has_uses_target(lines[i], WORKFLOWS_CHECKOUT_ACTION_TARGET) {
            continue;
        }
        if let Some(ins) = persist_credentials_insert_for(&lines, i, col) {
            inserts.push(ins);
        }
    }
    if inserts.is_empty() {
        return None;
    }
    inserts.sort_by(|a, b| b.at.cmp(&a.at));
    let mut out: Vec<String> = lines.iter().map(|s| (*s).to_string()).collect();
    for ins in &inserts {
        for (k, text_line) in ins.text.iter().enumerate() {
            out.insert(ins.at + k, text_line.clone());
        }
    }
    Some(out.join("\n"))
}

/// Точний відповідник `PATHS_KEY_RE = /^\s*paths:\s*$/u` — той самий
/// шаблон, що [`is_with_block_line`].
fn is_paths_block_line(line: &str) -> bool {
    line.trim() == "paths:"
}

/// Точний відповідник `QUOTE_EDGE_RE = /^['"]|['"]$/gu`: знімає ОДНУ
/// провідну й ОДНУ кінцеву лапку (`'`/`"`), якщо є, незалежно від типу —
/// послідовні `strip_prefix`/`strip_suffix` дають той самий результат, що
/// послідовна пара regex-заміщень (доккомент [`remove_paths_globs`]).
fn strip_quote_edges(s: &str) -> &str {
    let s = s
        .strip_prefix('\'')
        .or_else(|| s.strip_prefix('"'))
        .unwrap_or(s);
    s.strip_suffix('\'')
        .or_else(|| s.strip_suffix('"'))
        .unwrap_or(s)
}

/// Т0-фіксер `unmatched-paths-glob` — точний семантичний порт
/// `removePathsGlobs` (`fix-workflows.mjs`): прибирає list-елементи із
/// заданими значеннями всередині блоків `paths:` (scoped до самого блоку —
/// dedent завершує сканування, той самий контракт, що
/// [`with_block_has_persist`]).
fn remove_paths_globs(content: &str, globs: &[String]) -> Option<String> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut out: Vec<&str> = Vec::with_capacity(lines.len());
    let mut paths_col: Option<usize> = None;
    let mut changed = false;
    for line in &lines {
        if is_paths_block_line(line) {
            paths_col = line.find("paths:");
            out.push(line);
            continue;
        }
        if let Some(pcol) = paths_col {
            if !line.trim().is_empty() {
                let col = indent_of(line);
                if col > pcol {
                    let trimmed = line.trim_start();
                    if let Some(rest) = trimmed.strip_prefix("- ") {
                        let val = strip_quote_edges(rest.trim());
                        if globs.iter().any(|g| g == val) {
                            changed = true;
                            continue;
                        }
                    }
                    out.push(line);
                    continue;
                }
                paths_col = None; // dedent → блок `paths:` завершився
            }
        }
        out.push(line);
    }
    if changed {
        Some(out.join("\n"))
    } else {
        None
    }
}

/// Т0-фіксер `bare-n-rules` — точний семантичний порт `prefixBunxNCursor`
/// (`fix-workflows.mjs`, три регекси: `WRAPPED_NCURSOR_RE`/
/// `RUN_INLINE_NCURSOR_MATCH`/`BARE_LINE_NCURSOR_MATCH`). Regex-крейт тут —
/// ЖОДНОЇ нової залежності: той самий крейт+фіти (`unicode-perl`, потрібен
/// саме для `\b`), що вже лінкований і виконується в
/// [`verify_no_bare_n_cursor`] (detect-бік цього самого концерну,
/// доккомент `Cargo.toml` пояснює, чому `\b` взагалі вимагає `unicode-perl`).
fn prefix_bunx_n_command(content: &str) -> Option<String> {
    let wrapped = regex::Regex::new(r"\b(?:bunx|npx)\s+n-(?:cursor|rules)")
        .expect("WRAPPED_NCURSOR_RE валідний");
    let run_inline = regex::Regex::new(r"^(\s*(?:-\s*)?run:\s*)n-(?:cursor|rules)(\s.*)$")
        .expect("RUN_INLINE_NCURSOR_MATCH валідний");
    let bare_line = regex::Regex::new(r"^(\s+)n-(?:cursor|rules)(\s.*)$")
        .expect("BARE_LINE_NCURSOR_MATCH валідний");
    let mut changed = false;
    let out: Vec<String> = content
        .split('\n')
        .map(|line| {
            if wrapped.is_match(line) {
                return line.to_string();
            }
            if let Some(caps) = run_inline.captures(line) {
                changed = true;
                return format!("{}bunx n-rules{}", &caps[1], &caps[2]);
            }
            if let Some(caps) = bare_line.captures(line) {
                changed = true;
                return format!("{}bunx n-rules{}", &caps[1], &caps[2]);
            }
            line.to_string()
        })
        .collect();
    if changed {
        Some(out.join("\n"))
    } else {
        None
    }
}

/// Читає значення рядкового поля `"field":"…"` із flat-JSON `data` —
/// зворотне до [`json_escape_string`] (розпізнає РІВНО ті самі
/// escape-послідовності, які той виробляє: `data` цього концерну —
/// самопороджений формат, не consumer-контрольований вхід, той самий мотив,
/// що [`json_bool_field_is_true`]/`json_usize_field` у
/// `crates/plugin-lang-rust`). `None` — поле відсутнє, не рядок, чи
/// обірваний escape (застаріла/чужа діагностика).
fn json_string_field(data: &str, field: &str) -> Option<String> {
    let needle = format!("\"{field}\":\"");
    let start = data.find(&needle)? + needle.len();
    let mut out = String::new();
    let mut chars = data[start..].chars();
    loop {
        match chars.next()? {
            '"' => return Some(out),
            '\\' => match chars.next()? {
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                'u' => {
                    let hex: String = chars.by_ref().take(4).collect();
                    out.push(char::from_u32(u32::from_str_radix(&hex, 16).ok()?)?);
                }
                _ => return None,
            },
            c => out.push(c),
        }
    }
}

/// Т0-фіксер `ga/workflows` — єдина точка входу [`Guest::fix`] для цього
/// концерну (доккомент розділу вище). Групує `request.diagnostics` за
/// файлом для ТРЬОХ `reason`-ів
/// ([`WORKFLOWS_CHECKOUT_PERSIST_REASON`]/[`WORKFLOWS_UNMATCHED_PATHS_GLOB_REASON`]/
/// [`WORKFLOWS_BARE_NCURSOR_REASON`]), для `unmatched-paths-glob` додатково
/// збирає `data.glob` per-file (той самий `Map<file, Set<glob>>`-дедуп, що
/// JS `byFile`). Кожен цільовий файл проходить усі три трансформери
/// послідовно на ОДНОМУ буфері (доккомент розділу вище пояснює, чому це не
/// три окремі проходи, як у JS-каноні) — файл без реальних змін у план не
/// потрапляє.
fn fix_workflows(request: &FixRequest) -> FixPlan {
    let mut files: Vec<&str> = Vec::new();
    let mut globs_by_file: Vec<(&str, Vec<String>)> = Vec::new();

    for diagnostic in &request.diagnostics {
        let Some(file) = diagnostic.file.as_deref() else {
            continue;
        };
        let reason = diagnostic.reason.as_str();
        let is_relevant = reason == WORKFLOWS_CHECKOUT_PERSIST_REASON
            || reason == WORKFLOWS_UNMATCHED_PATHS_GLOB_REASON
            || reason == WORKFLOWS_BARE_NCURSOR_REASON;
        if !is_relevant {
            continue;
        }
        if !files.contains(&file) {
            files.push(file);
        }
        if reason == WORKFLOWS_UNMATCHED_PATHS_GLOB_REASON {
            let Some(glob) = diagnostic
                .data
                .as_deref()
                .and_then(|d| json_string_field(d, "glob"))
            else {
                continue;
            };
            match globs_by_file.iter_mut().find(|(f, _)| *f == file) {
                Some((_, globs)) => {
                    if !globs.contains(&glob) {
                        globs.push(glob);
                    }
                }
                None => globs_by_file.push((file, vec![glob])),
            }
        }
    }

    let empty_globs: Vec<String> = Vec::new();
    let mut edits = Vec::new();
    for file in files {
        let Some(source) = batch_file(&request.files, file) else {
            continue;
        };
        let mut content = source.content.clone();
        if let Some(next) = add_persist_credentials(&content) {
            content = next;
        }
        let globs = globs_by_file
            .iter()
            .find(|(f, _)| *f == file)
            .map(|(_, g)| g)
            .unwrap_or(&empty_globs);
        if let Some(next) = remove_paths_globs(&content, globs) {
            content = next;
        }
        if let Some(next) = prefix_bunx_n_command(&content) {
            content = next;
        }
        if content != source.content {
            edits.push(FileEdit::Write(WriteFile {
                path: source.path.clone(),
                content,
            }));
        }
    }
    FixPlan { edits }
}

/// Т0-фіксер `rust/toolchain_cache` — єдина точка входу [`Guest::fix`] для
/// цього концерну (доккомент розділу біля [`insert_rust_cache`]). Групує
/// `request.diagnostics` за файлом для ДВОХ reason-ів
/// ([`MISSING_RUST_CACHE_REASON`]/[`MISSING_RUST_CACHE_WORKSPACES_REASON`]),
/// `workspace_dir` бере з `data.workspaceDir` ПЕРШОЇ діагностики, де воно є
/// (той самий `.find(…)`-прийом, що `workspaceDir` у [`fix_workflows`] для
/// `glob`). Кожен цільовий файл проходить [`insert_rust_cache`], тоді
/// [`add_cache_workspaces`] послідовно на ОДНОМУ буфері — той самий мотив
/// композиції, що доккомент розділу «`ga/workflows` — Т0-фіксер ПОРТОВАНО»
/// пояснює для [`fix_workflows`]. Файл без реальних змін у план не потрапляє.
fn fix_toolchain_cache(request: &FixRequest) -> FixPlan {
    let mut files: Vec<&str> = Vec::new();
    let mut workspace_dir: Option<String> = None;
    for diagnostic in &request.diagnostics {
        let Some(file) = diagnostic.file.as_deref() else {
            continue;
        };
        let reason = diagnostic.reason.as_str();
        if reason != MISSING_RUST_CACHE_REASON && reason != MISSING_RUST_CACHE_WORKSPACES_REASON {
            continue;
        }
        if !files.contains(&file) {
            files.push(file);
        }
        if workspace_dir.is_none() {
            workspace_dir = diagnostic
                .data
                .as_deref()
                .and_then(|d| json_string_field(d, "workspaceDir"));
        }
    }

    let mut edits = Vec::new();
    for file in files {
        let Some(source) = batch_file(&request.files, file) else {
            continue;
        };
        let mut content = source.content.clone();
        if let Some(next) = insert_rust_cache(&content, workspace_dir.as_deref()) {
            content = next;
        }
        if let Some(dir) = &workspace_dir {
            if let Some(next) = add_cache_workspaces(&content, dir) {
                content = next;
            }
        }
        if content != source.content {
            edits.push(FileEdit::Write(WriteFile {
                path: source.path.clone(),
                content,
            }));
        }
    }
    FixPlan { edits }
}

// =====================================================================
// ТРЕТЯ хвиля — три policy-концерни (доккомент модуля, розділ «ТРЕТЯ хвиля»).
// =====================================================================

/// Ключі контрибуцій ТРЕТЬОЇ хвилі — точний відповідник `ruleId/concernId`
/// відповідних `concern.json`.
const CONCERN_VSCODE_EXTENSIONS: &str = "ga/vscode_extensions";
const CONCERN_VSCODE_SETTINGS: &str = "ga/vscode_settings";
const CONCERN_LINT_SECURITY_YML: &str = "security/lint_security_yml";

/// `reason` — точний відповідник `'policy-file-missing'`
/// (`policy-lint-adapter.mjs::evaluatePolicyConcern`, гілка «файл
/// відсутній»).
const POLICY_FILE_MISSING_REASON: &str = "policy-file-missing";

/// `reason` — точний відповідник `'policy-deny'` (та сама функція, гілка
/// rego: КОЖЕН `deny`-рядок conftest/regorus дає ОДНУ діагностику з цим
/// reason-ом, незалежно від concern-а — не concern-specific код).
const POLICY_DENY_REASON: &str = "policy-deny";

/// `reason` — НЕМАЄ канонічного відповідника: JS-канон для `engine: "rego"`
/// не парсить `input` сам (`runConftestBatch` передає ШЛЯХИ файлів,
/// `conftest`-субпроцес сам парсить YAML/JSON і сам вирішує, як
/// повідомляти про синтаксичну помилку — зовнішній Go-бінарник, текст його
/// помилки не є частиною JS-логіки, що порт мав би відтворити). Тут вхід
/// парситься ЗАЗДАЛЕГІДЬ (`set_input_json` regorus вимагає готовий JSON,
/// доккомент [`eval_deny_rule`]) — побитий JSON/YAML target-файл дає видиму
/// діагностику з НОВИМ reason-ом замість silent-skip, той самий мотив, що
/// [`REGO_ENGINE_ERROR_REASON`] (fail loud, не мовчазний no-op).
const POLICY_INPUT_INVALID_REASON: &str = "policy-input-invalid";

/// Статична конфігурація одного policy-концерну ТРЕТЬОЇ хвилі — доккомент
/// [`detect_policy`].
struct PolicyCfg {
    target_path: &'static str,
    missing_message: &'static str,
    rego_source: &'static str,
    namespace: &'static str,
    snippet_source_name: &'static str,
    snippet_raw: &'static str,
}

const VSCODE_EXTENSIONS_CFG: PolicyCfg = PolicyCfg {
    target_path: ".vscode/extensions.json",
    missing_message:
        ".vscode/extensions.json не існує — додай github.vscode-github-actions (ga.mdc)",
    rego_source: VSCODE_EXTENSIONS_REGO,
    namespace: "ga.vscode_extensions",
    snippet_source_name: "extensions.json.snippet.json",
    snippet_raw: VSCODE_EXTENSIONS_SNIPPET_JSON,
};

const VSCODE_SETTINGS_CFG: PolicyCfg = PolicyCfg {
    target_path: ".vscode/settings.json",
    missing_message:
        ".vscode/settings.json не існує — додай [github-actions-workflow].editor.defaultFormatter (ga.mdc)",
    rego_source: VSCODE_SETTINGS_REGO,
    namespace: "ga.vscode_settings",
    snippet_source_name: "settings.json.snippet.json",
    snippet_raw: VSCODE_SETTINGS_SNIPPET_JSON,
};

const LINT_SECURITY_YML_CFG: PolicyCfg = PolicyCfg {
    target_path: ".github/workflows/lint-security.yml",
    missing_message:
        ".github/workflows/lint-security.yml не знайдено — створи за каноном security.mdc",
    rego_source: LINT_SECURITY_YML_REGO,
    namespace: "security.lint_security_yml",
    snippet_source_name: "lint-security.yml.snippet.yml",
    snippet_raw: LINT_SECURITY_YML_SNIPPET_YML,
};

/// Т0-детект одного policy-концерну ТРЕТЬОЇ хвилі — точний функціональний
/// відповідник `evaluatePolicyConcern` (`policy-lint-adapter.mjs`), гілка
/// `engine !== 'template'` (rego): `files.length === 0` → `policy-file-missing`
/// ([`POLICY_FILE_MISSING_REASON`]); інакше — ОДИН `eval_deny_rule` виклик
/// ([`eval_deny_rule`], той самий regorus-примітив, що друга хвиля),
/// `data.template.snippet` — розпарсений `cfg.snippet_raw`
/// ([`wrap_template_data`]/[`parse_embedded_template`]), `input` —
/// розпарсений `cfg.target_path` з батчу ([`parse_target_document`] —
/// диспетчер [`parse_yaml_document`]/[`parse_jsonc_document`] за
/// [`target_path_is_json`], доккомент розділу «Справжня JSONC-підтримка»).
/// Кожен `deny`-рядок → ОДНА діагностика `policy-deny` — `message` НЕ
/// префіксується Rust-боком (кожен `.rego` вже вбудовує `<targetPath>: ` у
/// `sprintf`, доккомент трьох `.rego`-джерел), той самий контракт, що
/// `add('policy-deny', d.message, file)` канону.
fn detect_policy(files: &[SourceFile], cfg: &PolicyCfg) -> Vec<Diagnostic> {
    let Some(source) = batch_file(files, cfg.target_path) else {
        return vec![Diagnostic {
            reason: POLICY_FILE_MISSING_REASON.to_string(),
            message: cfg.missing_message.to_string(),
            file: Some(cfg.target_path.to_string()),
            severity: Severity::Error,
            data: None,
        }];
    };
    // `.json`-таргет ([`ga/vscode_extensions`]/[`ga/vscode_settings`]) читає
    // за JSONC-контрактом ([`parse_jsonc_document`], доккомент розділу вище
    // за текстом файлу) — коментарі й trailing-кома більше НЕ ведуть до
    // `policy-input-invalid`, лише СПРАВЖНЯ побита синтаксична форма падає
    // в гілку нижче.
    let Some(actual) = parse_target_document(&source.content, target_path_is_json(cfg.target_path)) else {
        return vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: format!(
                "{}: невалідний JSON/YAML — виправ синтаксис ({})",
                cfg.target_path, cfg.namespace
            ),
            file: Some(cfg.target_path.to_string()),
            severity: Severity::Error,
            data: None,
        }];
    };
    let snippet = parse_embedded_template(cfg.snippet_source_name, cfg.snippet_raw);
    let data_json = wrap_template_data(snippet);
    let input_json = json_to_string(&actual);
    match eval_deny_rule(cfg.rego_source, cfg.namespace, &data_json, &input_json) {
        Ok(messages) => messages
            .into_iter()
            .map(|message| Diagnostic {
                reason: POLICY_DENY_REASON.to_string(),
                message,
                file: Some(cfg.target_path.to_string()),
                severity: Severity::Error,
                data: None,
            })
            .collect(),
        Err((stage, err)) => {
            let mut diagnostics = Vec::new();
            push_rego_engine_error(
                &mut diagnostics,
                Some(cfg.target_path),
                cfg.namespace,
                stage,
                &err,
            );
            diagnostics
        }
    }
}

/// Т0-фіксер `ga/vscode_extensions` — точний порт
/// `npm/scripts/lib/fix/vscode-ext-add.mjs`: union `.vscode/extensions.json#recommendations`
/// із канонічним `template/extensions.json.snippet.json#recommendations` за
/// РЯДКОВИМ значенням (не структурний `mergeJsonValue` — `vscode-ext-add.mjs`
/// свідомо ІНШИЙ, простіший рушій, ніж `template-deep-merge.mjs`, доккомент
/// обох файлів). Порожні `request.diagnostics` (концерн викликаний БЕЗ жодної
/// релевантної діагностики) → порожній план — той самий контракт, що
/// [`fix_toolchain_cache`]/[`fix_workflows`] (єдиний reason цього концерну —
/// `policy-file-missing`/`policy-deny`, обидва релевантні тут, тож
/// filter-by-reason тут зайвий, на відміну від тих двох концернів, що
/// ділять кілька reason-ів на файл).
fn fix_vscode_extensions(request: &FixRequest) -> FixPlan {
    if request.diagnostics.is_empty() {
        return FixPlan { edits: vec![] };
    }
    let snippet = parse_embedded_template(
        VSCODE_EXTENSIONS_CFG.snippet_source_name,
        VSCODE_EXTENSIONS_CFG.snippet_raw,
    );
    let canonical: Vec<String> = snippet
        .get("recommendations")
        .and_then(Json::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Json::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if canonical.is_empty() {
        return FixPlan { edits: vec![] };
    }

    let target_path = VSCODE_EXTENSIONS_CFG.target_path;
    let existing = batch_file(&request.files, target_path);
    let (existing_entries, recs): (Vec<(String, Json)>, Vec<String>) = match existing {
        None => (Vec::new(), Vec::new()),
        // Читання за JSONC-контрактом ([`parse_jsonc_document`], доккомент
        // розділу «Справжня JSONC-підтримка» вище за текстом файлу) —
        // `.vscode/extensions.json` з `//`-коментарем тепер читається
        // коректно (union-мердж бачить РЕАЛЬНИЙ `recommendations`, не
        // сміттєвий ключ). Запис лишається ПОВНОЮ регенерацією
        // ([`json_to_pretty_string`] нижче) — той самий контракт, що
        // канонічний `vscode-ext-add.mjs` (`JSON.stringify(parsed, null,
        // 2)`, доккомент функції), тож коментарі НЕ переживають запис (чесна
        // деградація форматування, не втрата ДАНИХ — жоден наявний ключ чи
        // рекомендація не зникає).
        Some(source) => match parse_jsonc_document(&source.content) {
            Some(Json::Object(entries)) => {
                let recs = entries
                    .iter()
                    .find(|(k, _)| k == "recommendations")
                    .and_then(|(_, v)| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(Json::as_str)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                (entries, recs)
            }
            // Невалідний JSON — не чіпаємо (той самий `catch { return
            // {touchedFiles: []} }`, що `vscode-ext-add.mjs`).
            _ => return FixPlan { edits: vec![] },
        },
    };

    let to_add: Vec<&String> = canonical.iter().filter(|c| !recs.contains(c)).collect();
    if to_add.is_empty() && existing.is_some() {
        return FixPlan { edits: vec![] };
    }

    let mut new_recs: Vec<Json> = recs.into_iter().map(Json::Str).collect();
    new_recs.extend(to_add.into_iter().cloned().map(Json::Str));

    let mut new_entries = existing_entries;
    match new_entries.iter_mut().find(|(k, _)| k == "recommendations") {
        Some(entry) => entry.1 = Json::Array(new_recs),
        None => new_entries.push(("recommendations".to_string(), Json::Array(new_recs))),
    }
    let content = json_to_pretty_string(&Json::Object(new_entries));
    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: target_path.to_string(),
            content,
        })],
    }
}

// =====================================================================
// Хірургічний comment-preserving merge (YAML і JSON) — заміна старого
// «розпарсити → перегенерувати з нуля» шляху [`fix_template_merge`] брав
// раніше (звіт задачі, доккомент модуля розділ «ТРЕТЯ хвиля» — виправлений
// нижче за текстом файлу). Джерело правди — `saphyr::MarkedYamlOwned`
// ([`build_mnode`]/[`parse_marked_document`]): той самий парсер, що
// [`parse_yaml_document`], але annotated-варіант несе `Span` (байтовий —
// точніше, char-індексний, звідси [`char_byte_table`] — діапазон кожного
// вузла в ВИХІДНОМУ тексті. Алгоритм — той самий `mergeJsonValue`-обхід, що
// [`merge_json_value`] (той самий [`is_subset`]/[`contained_in`]/
// [`identity_key`]/[`find_identity_index`], перевикористані буквально), але
// замість побудови нового [`Json`]-дерева й серіалізації його з нуля —
// [`surgical_merge_node`] породжує список [`Edit`] (вставка/заміна
// байтового діапазону) і застосовує їх ЗГОРИ ВНИЗ ([`apply_edits`], той
// самий мотив, що `inserts.sort` у [`insert_rust_cache`]/
// [`add_cache_workspaces`] вище): недоторкані діапазони вихідного тексту
// лишаються байт-у-байт як є — коментарі й форматування зберігаються НЕ як
// «намагання», а як структурний наслідок того, що ми ніколи не чіпаємо
// текст поза обчисленими діапазонами.
//
// Коли шлях недосяжний — [`surgical_merge_node`] повертає `false`
// (обʼєкт/масив очікувався, а прийшов інший тип; об�ʼєкт/масив порожній
// (нема на що спертись вставкою); чи для JSON — обчислена точка вставки
// вийшла б ЗА межі власного `}`/`]` контейнера, найпевніше через
// однорядковий/flow-стиль) — [`fix_template_merge`] тоді падає назад на
// СТАРИЙ шлях повної регенерації ([`write_yaml_block`]/
// [`json_to_pretty_string`] над [`merge_json_value`]): завжди коректний
// результат (критерій 1 — повторний детект чистий), не завжди
// comment-preserving (критерій 2) — чесна деградація, не тиха, задокумен-
// тована тут і в звіті задачі, а не видана за повне рішення.
// =====================================================================

/// Один запис редагування вихідного тексту — байтовий діапазон [start,end)
/// замінюється на `text`; `start == end` — чиста вставка (нічого не
/// видаляється).
enum Edit {
    Insert(usize, String),
    Replace(usize, usize, String),
}

fn edit_start(e: &Edit) -> usize {
    match e {
        Edit::Insert(at, _) => *at,
        Edit::Replace(start, _, _) => *start,
    }
}

/// Застосовує список [`Edit`] до `content` — сортує ЗА СПАДАННЯМ початкової
/// позиції (той самий мотив, що `inserts.sort_by` в [`insert_rust_cache`]:
/// індекси попередніх, ще не застосованих правок не зсуваються, коли
/// пізніша (нижче за текстом) правка застосовується першою).
/// Застосовує `edits` у порядку `push` (доккомент [`apply_edits`] пояснює
/// чому це НЕ довільний вибір): [`surgical_merge_node`] — DFS
/// post-order-подібний обхід — дочірні правки завжди `push`-нуться в
/// `edits` РАНІШЕ за правку «бракує ключів» їхнього ВЛАСНОГО батька (та
/// послідовно РАНІШЕ за правки будь-якого предка вище), тож вихідний
/// порядок вектора вже несе інформацію про глибину вкладеності — саме її
/// [`apply_edits`] мусить зберегти на в'язках з однаковою `at`.
fn apply_edits(content: &str, edits: Vec<Edit>) -> String {
    // Вставки на ОДНАКОВІЙ позиції — реальний сценарій, не крайній випадок:
    // коли «останній наявний запис» кількох різних предків (кроку в
    // масиві, job-а, кореня) структурно дном впирається в ТУ САМУ
    // найглибшу скалярну позицію документа (§2.58, доккомент
    // [`deepest_last_leaf_end`]), усі їхні вставки анкеряться в ОДНУ й ТУ
    // САМУ байтову точку. `String::insert_str` при повторній вставці в ТУ
    // САМУ позицію ставить НОВИЙ текст ПЕРЕД раніше вставленим — тож щоб
    // найглибша (найпізніше `push`-нута) правка опинилась НАЙБЛИЖЧЕ до
    // якоря (структурно правильно — вона належить найглибшому контейнеру),
    // її треба застосувати ОСТАННЬОЮ серед в'язки. Сортуємо за спаданням
    // `at`, а в'язки з однаковим `at` — за СПАДАННЯМ індексу `push` (пізніше
    // `push`-нуте — раніше в порядку застосування, отже раніше «зсунуте
    // праворуч» наступними й опиняється НАЙДАЛІ від якоря; найраніше
    // `push`-нуте — найглибше — застосовується останнім і лишається
    // найближче до якоря).
    let mut indexed: Vec<(usize, Edit)> = edits.into_iter().enumerate().collect();
    indexed.sort_by_key(|(idx, e)| (std::cmp::Reverse(edit_start(e)), std::cmp::Reverse(*idx)));
    let mut out = content.to_string();
    for (_, edit) in indexed {
        match edit {
            Edit::Insert(at, text) => out.insert_str(at, &text),
            Edit::Replace(start, end, text) => out.replace_range(start..end, &text),
        }
    }
    out
}

/// [`Json`] з байтовим діапазоном ([`Span`][saphyr::Marker], конвертований
/// з char- у byte-індекси через [`char_byte_table`]) на кожному вузлі —
/// той самий обхід дерева, що [`Json`] (`Scalar`/`Array`/`Object` —
/// [`yaml_owned_to_json`]-подібна форма), лише annotated. Ключі обʼєкта
/// несуть ВЛАСНИЙ діапазон (не лише значення) — потрібен для колонки
/// відступу нового запису при вставці ([`surgical_merge_object`]).
enum MNode {
    Scalar(Json, (usize, usize)),
    Array(Vec<MNode>, (usize, usize)),
    Object(Vec<(String, (usize, usize), MNode)>, (usize, usize)),
}

fn mnode_span(n: &MNode) -> (usize, usize) {
    match n {
        MNode::Scalar(_, s) | MNode::Array(_, s) | MNode::Object(_, s) => *s,
    }
}

/// Байтовий кінець ОСТАННЬОГО скалярного листка в піддереві `n` — НЕ
/// `mnode_span(n).1` напряму: block-стиль YAML не має явного закриваючого
/// токена для мап/масивів, тож `Span.end` контейнера, що є ОСТАННІМ
/// реальним вмістом документа (нема жодного наступного YAML-токена після
/// нього — трейлінг-коментарі НЕ токени, скановані як пробіл), резолвиться
/// в позицію НАСТУПНОЇ події сканера, а не в кінець власного вмісту — на
/// практиці це EOF, ПОЗА трейлінг-коментарем (емпірично перевірено:
/// `saphyr-parser` скановий тест на цьому самому файлі). Скалярний листок
/// натомість завжди має тугий, надійний `Span.end` (кінець власного
/// токена) — рекурсивний спуск до останнього листка обходить цю
/// розбіжність, даючи стабільну точку прив'язки вставки незалежно від
/// позиції в документі.
fn deepest_last_leaf_end(n: &MNode) -> usize {
    match n {
        MNode::Scalar(_, s) => s.1,
        MNode::Array(items, s) => items.last().map_or(s.1, deepest_last_leaf_end),
        MNode::Object(entries, s) => entries.last().map_or(s.1, |(_, _, v)| deepest_last_leaf_end(v)),
    }
}

/// Забуває діапазони — точний відповідник [`yaml_owned_to_json`] над уже
/// побудованим [`MNode`] (використовується для [`is_subset`]/
/// [`contained_in`]/[`find_identity_index`] — ці примітиви оперують
/// [`Json`], не [`MNode`]).
fn mnode_to_json(n: &MNode) -> Json {
    match n {
        MNode::Scalar(j, _) => j.clone(),
        MNode::Array(items, _) => Json::Array(items.iter().map(mnode_to_json).collect()),
        MNode::Object(entries, _) => {
            Json::Object(entries.iter().map(|(k, _, v)| (k.clone(), mnode_to_json(v))).collect())
        }
    }
}

/// Таблиця char-індекс → byte-індекс вихідного тексту — `saphyr::Marker`
/// індексує В СИМВОЛАХ (доккомент поля `Marker::index` каже «bytes», але
/// сканер інкрементує його на кількість ПРОЧИТАНИХ СИМВОЛІВ, не байтів —
/// перевірено читанням `saphyr-parser` scanner-коду; розбіжність
/// зауваження й факту в самому крейті). Кожен наш workflow/JSON-таргет
/// потенційно містить нелатинський текст (українські коментарі/назви
/// job-ів) — байт-індекс і char-індекс розходяться там, тож пряме
/// використання `Marker::index()` як byte-офсету в `&str`-зрізи було б
/// некоректним (панікує чи ріже посеред UTF-8 символу) без цієї таблиці.
fn char_byte_table(content: &str) -> Vec<usize> {
    let mut table: Vec<usize> = content.char_indices().map(|(b, _)| b).collect();
    table.push(content.len());
    table
}

fn byte_of(table: &[usize], char_index: usize) -> usize {
    table
        .get(char_index)
        .copied()
        .unwrap_or_else(|| *table.last().unwrap_or(&0))
}

/// Рядковий ключ вузла-мапи annotated-дерева — той самий контракт, що
/// [`yaml_key_to_string`], лише джерело — `MarkedYamlOwned`, не `YamlOwned`.
fn marked_key_to_string(k: &saphyr::MarkedYamlOwned) -> String {
    use saphyr::{ScalarOwned, YamlDataOwned};
    match &k.data {
        YamlDataOwned::Value(ScalarOwned::String(s)) => s.clone(),
        other => format!("{other:?}"),
    }
}

fn build_mnode(node: &saphyr::MarkedYamlOwned, table: &[usize]) -> MNode {
    use saphyr::YamlDataOwned;
    let span = (
        byte_of(table, node.span.start.index()),
        byte_of(table, node.span.end.index()),
    );
    match &node.data {
        YamlDataOwned::Value(scalar) => MNode::Scalar(scalar_owned_to_json(scalar), span),
        YamlDataOwned::Sequence(items) => {
            MNode::Array(items.iter().map(|n| build_mnode(n, table)).collect(), span)
        }
        YamlDataOwned::Mapping(map) => MNode::Object(
            map.iter()
                .map(|(k, v)| {
                    let key_span = (
                        byte_of(table, k.span.start.index()),
                        byte_of(table, k.span.end.index()),
                    );
                    (marked_key_to_string(k), key_span, build_mnode(v, table))
                })
                .collect(),
            span,
        ),
        // `Representation`/`Tagged`/`Alias`/`BadValue` — той самий
        // skip-not-crash фолбек, що [`yaml_owned_to_json`] (доккомент
        // там): порівняння з очікуваним snippet-ом просто не збіжеться
        // (`Json::Null`), [`surgical_merge_node`] тоді або замінить цей
        // вузол на канонічний, або (якщо він мав бути обʼєктом/масивом)
        // впаде в fallback.
        _ => MNode::Scalar(Json::Null, span),
    }
}

/// Той самий подвійний fallback, що [`parse_yaml_document`] (парс-помилка
/// чи не-обʼєктний корінь → `None`), лише annotated-дерево зі спанами.
fn parse_marked_document(content: &str) -> Option<MNode> {
    use saphyr::{LoadableYamlNode, MarkedYamlOwned};
    let table = char_byte_table(content);
    let docs = MarkedYamlOwned::load_from_str(content).ok()?;
    let doc = docs.into_iter().next()?;
    let node = build_mnode(&doc, &table);
    match &node {
        MNode::Object(..) => Some(node),
        _ => None,
    }
}

/// Колонка байтового офсету в його рядку (кількість байтів від початку
/// рядка) — та сама байтова, не char-міра, що [`indent_of`] (той самий
/// мотив: відступ/структурні маркери завжди ASCII в цих файлах).
fn column_at(content: &str, byte_offset: usize) -> usize {
    let line_start = content[..byte_offset].rfind('\n').map_or(0, |i| i + 1);
    byte_offset - line_start
}

/// Байтовий офсет ПОЧАТКУ рядка, що йде ПІСЛЯ рядка, який містить
/// `from_byte` — `None`, якщо `from_byte` на останньому рядку файлу (нема
/// куди безпечно вставити повний новий рядок ПЕРЕД можливим закриттям
/// контейнера) — той самий guard-мотив, що обмеження нижче в
/// [`surgical_merge_object`]/[`surgical_merge_array`] для JSON.
fn next_line_start(content: &str, from_byte: usize) -> Option<usize> {
    content.get(from_byte..)?.find('\n').map(|rel| from_byte + rel + 1)
}

/// `true`, якщо одразу після байтового офсету `pos` (пропускаючи лише ASCII
/// пробіли/таби/переведення рядка — НЕ коментарі, доккомент нижче) уже
/// стоїть кома — JSONC (на відміну від floor `is_strict_json`, який
/// повністю відхиляв trailing-кому) дозволяє її, тож
/// [`surgical_merge_object`]/[`surgical_merge_array`] НЕ мають дописувати
/// ДРУГУ (подвійна кома — синтаксично невалідний JSON; [`try_surgical_merge`]
/// post-generation guard спіймав би це й відкотився на повну регенерацію,
/// але безпечніше не створювати сам випадок). Комент МІЖ значенням і його
/// власною комою — нетиповий стиль (жодна з фікстур задачі його не має) —
/// НЕ розпізнається тут навмисно (спрощення, не баг): найгірший наслідок —
/// той самий post-generation guard ловить подвійну кому й падає на
/// коректний, лише не-хірургічний fallback, той самий «чесна деградація»
/// контракт, що решта цього модуля.
fn already_has_trailing_comma(content: &str, pos: usize) -> bool {
    content[pos..].trim_start_matches([' ', '\t', '\r', '\n']).starts_with(',')
}

// --- Flow-стиль inline-вставка (§2.62 звузила виміряну межу §2.61 з
// «anchor/alias І flow-стиль непідтримні разом» до РІВНО одного класу:
// вставка ВСЕРЕДИНУ однорядкового flow-контейнера (`{…}`/`[…]`) —
// [`next_line_start`] шукає `\n` ПІСЛЯ якоря, щоб вставити НОВИЙ рядок, а в
// однорядковому flow-контейнері такого `\n` нема, тож [`surgical_merge_object`]/
// [`surgical_merge_array`] падали в `None` навіть коли решта дерева (анкер/
// аліас, звичайний block-стиль) мержилась би хірургічно. Наслідок —
// каскадний all-or-nothing провал ([`surgical_merge_node`] пробрасує `false`
// від будь-якого дочірнього виклику до самого кореня): ОДНА нездійсненна
// flow-вставка будь-де в дереві валила ВЕСЬ документ на повну регенерацію,
// втрачаючи ВСІ коментарі файлу, не лише ті, що біля flow-вузла. §2.62 оцінила
// латку в ~80–150 рядків, без нової залежності, без приросту розміру гостя —
// саме це нижче.
//
// Ключ рушія — [`flow_insert_point`]: на відміну від block-стилю, де немає
// явного закриваючого токена (§2.58, [`deepest_last_leaf_end`]), flow-
// контейнер МАЄ явний `}`/`]`, і `MarkedYamlOwned`-спан вузла дає його
// офсет ТОЧНО (перевірено емпірично — доккомент функції нижче): вставка
// відбувається безпосередньо ПЕРЕД цим байтом, з комою-роздільником лише
// коли потрібно, БЕЗ жодного переносу рядка. ---

/// `true`, якщо вузол `actual` — flow-стиль (перший байт його спану —
/// відкриваючий `{`/`[`, а не перший символ першого ключа/елемента, як у
/// block-стилі). `open` — очікуваний відкриваючий байт (`b'{'` для обʼєкта,
/// `b'['` для масиву) — розрізняти два випадки одним викликом безпечно, бо
/// [`MNode::Object`] не може фізично починатись з `[`, і навпаки.
fn is_flow_container(content: &str, span: (usize, usize), open: u8) -> bool {
    content.as_bytes().get(span.0) == Some(&open)
}

/// Байтовий офсет закриваючого `}`/`]` вузла flow-контейнера, і префікс
/// (кома-роздільник чи порожній рядок), який слід вставити ПЕРЕД новим
/// вмістом. **Пастка, знайдена ЛИШЕ емпіричною перевіркою спанів
/// (`saphyr::MarkedYamlOwned`), не документацією крейта:** на відміну від
/// НАЇВНОГО припущення «flow МАЄ явний закриваючий токен, тож `Span.end`
/// вказує ОДРАЗУ ЗА ним» (як для скалярного листка, §2.58) — для flow-
/// контейнера `Span.end` дорівнює ТОЧНОМУ офсету самого закриваючого байта
/// (не `span.1 - 1`, а РІВНО `span.1`); той самий клас розбіжності
/// «зауваження vs факт сканера», що вже задокументований для
/// `Marker::index()` ([`char_byte_table`]) і для контейнерів-останнього-
/// вмісту-документа ([`deepest_last_leaf_end`]), лише в інший бік
/// (тугіше, не слабше, ніж наївне припущення). Перевірено прямим виводом
/// спанів на фікстурах `{}`/`[]`/`{push: {branches: [main]}}` (звіт задачі,
/// не залишено в крейті як тест — сам факт закодований у цій функції й
/// перевіряється НЕПРЯМО кожним flow-тестом нижче через byte-точний
/// `assert_eq!` на результаті).
///
/// Кома потрібна, якщо вміст контейнера (усе між `{`/`[` і закриваючим
/// байтом, з обрізаними КІНЦЕВИМИ ASCII-пробілами) непорожній і ще не
/// закінчується комою (той самий трейлінг-комою мотив, що
/// [`already_has_trailing_comma`], лише скануючи НАЗАД від точки вставки —
/// дзеркальний напрямок, бо flow-вставка завжди відбувається ПЕРЕД
/// закриваючим токеном, не ПІСЛЯ останнього елемента).
fn flow_insert_point(content: &str, span: (usize, usize)) -> (usize, &'static str) {
    let close_at = span.1;
    let inner = content[span.0 + 1..close_at].trim_end_matches([' ', '\t', '\r', '\n']);
    let prefix = if inner.is_empty() {
        "" // порожній контейнер (`{}`/`[]`) — перший елемент, кома не потрібна.
    } else if inner.ends_with(',') {
        " " // trailing-кома вже є — лише пробіл-роздільник, не друга кома.
    } else {
        ", "
    };
    (close_at, prefix)
}

/// Inline-серіалізатор [`Json`] для flow-контексту — БЕЗ жодного переносу
/// рядка (на відміну від [`write_yaml_object_entries`]/
/// [`write_yaml_array_items`], бо вставка відбувається ВСЕРЕДИНУ
/// однорядкового контейнера — block-стиль дочірнього вузла тут синтаксично
/// недопустимий у YAML). Рекурсивний — вкладений обʼєкт/масив у ЩОЙНО
/// вставленому дереві теж пишеться flow-стилем (`{k: v, …}`/`[e, …]`).
/// Скаляри — той самий [`yaml_scalar`], що block-шлях (рядки завжди в
/// подвійних лапках, доккомент [`write_yaml_block`]).
fn write_yaml_flow_value(v: &Json, out: &mut String) {
    match v {
        Json::Object(entries) => {
            out.push('{');
            for (i, (k, val)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                out.push_str(&yaml_key(k));
                out.push_str(": ");
                write_yaml_flow_value(val, out);
            }
            out.push('}');
        }
        Json::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                write_yaml_flow_value(item, out);
            }
            out.push(']');
        }
        scalar => out.push_str(&yaml_scalar(scalar)),
    }
}

/// Обхід ОДНОГО вузла snippet-а проти відповідного [`MNode`] наявного
/// тексту — точний семантичний відповідник [`merge_json_value`], лише
/// замість побудови нового значення накопичує [`Edit`]-и в `edits`.
/// Повертає `false`, якщо цей шлях не можна виразити хірургічно (доккомент
/// розділу вище) — виклична сторона тоді падає на повну регенерацію.
fn surgical_merge_node(
    content: &str,
    actual: &MNode,
    snippet: &Json,
    is_yaml: bool,
    edits: &mut Vec<Edit>,
) -> bool {
    match snippet {
        Json::Object(entries) => surgical_merge_object(content, actual, entries, is_yaml, edits),
        Json::Array(items) => surgical_merge_array(content, actual, items, is_yaml, edits),
        leaf => mnode_to_json(actual) == *leaf,
    }
}

/// Обʼєктна гілка [`surgical_merge_node`] — точний відповідник обʼєктної
/// гілки [`merge_json_value`]: присутні ключі — рекурсія (листя, що
/// розійшлись, — [`Edit::Replace`] на діапазоні наявного скаляра);
/// відсутні ключі — один [`Edit::Insert`] (усі відсутні ключі одним блоком,
/// не окремими вставками в ту саму позицію) одразу ПІСЛЯ останнього
/// наявного запису.
fn surgical_merge_object(
    content: &str,
    actual: &MNode,
    snippet_entries: &[(String, Json)],
    is_yaml: bool,
    edits: &mut Vec<Edit>,
) -> bool {
    let MNode::Object(a_entries, obj_span) = actual else {
        return false;
    };
    let mut missing: Vec<(&str, &Json)> = Vec::new();
    for (k, v) in snippet_entries {
        match a_entries.iter().find(|(ak, _, _)| ak == k) {
            Some((_, _, a_child)) => match v {
                Json::Object(_) | Json::Array(_) => {
                    if !surgical_merge_node(content, a_child, v, is_yaml, edits) {
                        return false;
                    }
                }
                leaf => {
                    if mnode_to_json(a_child) != *leaf {
                        let MNode::Scalar(_, span) = a_child else {
                            return false;
                        };
                        edits.push(Edit::Replace(span.0, span.1, yaml_scalar(leaf)));
                    }
                }
            },
            None => missing.push((k.as_str(), v)),
        }
    }
    if missing.is_empty() {
        return true;
    }
    // Flow-стиль (`{…}`) — inline-вставка ПЕРЕД закриваючим `}`, без
    // переносу рядка (доккомент розділу «Flow-стиль inline-вставка» вище).
    // Перевіряється ДО `a_entries.last()`-guard-у нижче: порожній flow-
    // обʼєкт (`{}`) не має наявного запису, після якого вставляти (block-
    // шлях впав би в fallback), але для flow це РІВНО той самий «перший
    // елемент, кома не потрібна» випадок, що [`flow_insert_point`] уже
    // розпізнає — не крайній випадок, гілка нижче.
    if is_yaml && is_flow_container(content, *obj_span, b'{') {
        let (insert_at, prefix) = flow_insert_point(content, *obj_span);
        let mut block = prefix.to_string();
        for (i, (k, v)) in missing.iter().enumerate() {
            if i > 0 {
                block.push_str(", ");
            }
            block.push_str(&yaml_key(k));
            block.push_str(": ");
            write_yaml_flow_value(v, &mut block);
        }
        edits.push(Edit::Insert(insert_at, block));
        return true;
    }
    let Some((_, last_key_span, last_value)) = a_entries.last() else {
        return false; // порожній обʼєкт — нема запису, після якого вставляти.
    };
    let level = column_at(content, last_key_span.0) / 2;
    let anchor_end = deepest_last_leaf_end(last_value);
    let Some(insert_at) = next_line_start(content, anchor_end) else {
        return false;
    };
    if !is_yaml && insert_at >= obj_span.1 {
        return false; // точка вставки вийшла б за межі власного `}`.
    }
    let mut block = String::new();
    if is_yaml {
        for (k, v) in &missing {
            write_yaml_object_entries(&[((*k).to_string(), (*v).clone())], level, &mut block);
        }
    } else {
        let pad = "  ".repeat(level);
        for (i, (k, v)) in missing.iter().enumerate() {
            if i > 0 {
                block.push_str(",\n");
            }
            block.push_str(&pad);
            block.push_str(&json_escape_string(k));
            block.push_str(": ");
            write_json_pretty(v, level, &mut block);
        }
        block.push('\n');
        if !already_has_trailing_comma(content, anchor_end) {
            edits.push(Edit::Replace(anchor_end, anchor_end, ",".to_string()));
        }
    }
    edits.push(Edit::Insert(insert_at, block));
    true
}

/// Масивна гілка [`surgical_merge_node`] — точний відповідник масивної
/// гілки [`merge_json_value`]: [`contained_in`] — no-op; [`find_identity_index`]
/// — рекурсія в елемент on-place; інакше — один [`Edit::Insert`] з усіма
/// відсутніми елементами одразу ПІСЛЯ останнього наявного.
fn surgical_merge_array(
    content: &str,
    actual: &MNode,
    snippet_items: &[Json],
    is_yaml: bool,
    edits: &mut Vec<Edit>,
) -> bool {
    let MNode::Array(a_items, arr_span) = actual else {
        return false;
    };
    let a_items_json: Vec<Json> = a_items.iter().map(mnode_to_json).collect();
    let mut missing: Vec<Json> = Vec::new();
    for needle in snippet_items {
        if contained_in(&a_items_json, needle) {
            continue;
        }
        match find_identity_index(&a_items_json, needle) {
            Some(idx) => {
                if !surgical_merge_node(content, &a_items[idx], needle, is_yaml, edits) {
                    return false;
                }
            }
            None => missing.push(needle.clone()),
        }
    }
    if missing.is_empty() {
        return true;
    }
    // Flow-стиль (`[…]`) — той самий inline-мотив, що обʼєктна гілка вище.
    if is_yaml && is_flow_container(content, *arr_span, b'[') {
        let (insert_at, prefix) = flow_insert_point(content, *arr_span);
        let mut block = prefix.to_string();
        for (i, v) in missing.iter().enumerate() {
            if i > 0 {
                block.push_str(", ");
            }
            write_yaml_flow_value(v, &mut block);
        }
        edits.push(Edit::Insert(insert_at, block));
        return true;
    }
    let Some(last_item) = a_items.last() else {
        return false; // порожній масив — нема елемента, після якого вставляти.
    };
    let last_start = mnode_span(last_item).0;
    let last_end = deepest_last_leaf_end(last_item);
    let item_col = column_at(content, last_start);
    let dash_col = item_col.saturating_sub(2);
    let Some(insert_at) = next_line_start(content, last_end) else {
        return false;
    };
    if !is_yaml && insert_at >= arr_span.1 {
        return false; // точка вставки вийшла б за межі власного `]`.
    }
    let mut block = String::new();
    if is_yaml {
        write_yaml_array_items(&missing, dash_col / 2, &mut block);
    } else {
        let pad = "  ".repeat(dash_col / 2);
        for (i, v) in missing.iter().enumerate() {
            if i > 0 {
                block.push_str(",\n");
            }
            block.push_str(&pad);
            write_json_pretty(v, dash_col / 2, &mut block);
        }
        block.push('\n');
        if !already_has_trailing_comma(content, last_end) {
            edits.push(Edit::Replace(last_end, last_end, ",".to_string()));
        }
    }
    edits.push(Edit::Insert(insert_at, block));
    true
}

/// Публічний вхід хірургічного шляху — `None`, якщо наявний текст
/// непарситься annotated-парсером ([`parse_marked_document`] для YAML,
/// [`parse_marked_jsonc_document`] для JSON — не мало б статись,
/// [`fix_template_merge`] уже перевірив [`parse_target_document`] на тому
/// самому `content` вище) чи якщо [`surgical_merge_node`] десь по дорозі
/// впала в непідтримуваний випадок — виклична сторона (`fix_template_merge`)
/// падає на повну регенерацію.
/// `None` — хірургічний шлях недосяжний ЧИ (незалежно від причини)
/// результат не пройшов ПОСТ-ГЕНЕРАЦІЙНУ перевірку коректності (доккомент
/// нижче) — виклична сторона (`fix_template_merge`) падає на повну
/// регенерацію в ОБОХ випадках однаково.
fn try_surgical_merge(content: &str, snippet: &Json, is_yaml: bool) -> Option<String> {
    let root = if is_yaml {
        parse_marked_document(content)?
    } else {
        parse_marked_jsonc_document(content)?
    };
    let mut edits = Vec::new();
    if !surgical_merge_node(content, &root, snippet, is_yaml, &mut edits) {
        return None;
    }
    if edits.is_empty() {
        // `is_subset` вище в `fix_template_merge` уже встановив, що щось
        // відрізняється — порожній `edits` тут означав би розбіжність між
        // цим обходом і `is_subset`-семантикою: безпечніше відкотитись на
        // регенерацію, ніж мовчки повернути незмінний текст.
        return None;
    }
    let result = apply_edits(content, edits);
    // Обовʼязковий post-generation guard (рішення власника репозиторію,
    // звіт задачі — незалежна перевірка на реальній фікстурі з кількома
    // одночасними вставками на різних рівнях вклад дала невалідний YAML,
    // хоч усі юніт-тести цього модуля були зелені): коректність байтового
    // splice-у НЕ приймається на віру з побудови — результат ПОВТОРНО
    // парситься тим самим [`parse_yaml_document`], що виклична сторона
    // використовує для `actual`, і звіряється [`is_subset`]-ом проти
    // ТОГО САМОГО snippet-а, що й [`fix_template_merge`] звіряв ДО фіксу
    // (той самий контракт, що «повторний детект чистий»). Будь-яка
    // невідповідність — синтаксична (побитий YAML/JSON) чи семантична
    // (результат усе ще НЕ задовольняє snippet, симптом помилково
    // обчисленого якоря чи порядку застосування правок) — трактується
    // ОДНАКОВО: `None`, `fix_template_merge` падає на стару повну
    // регенерацію. Це не «спробувати й подивитись», а «перевірити перед
    // тим, як віддати» — ціна фальшивого fallback-у (втрачені коментарі на
    // рідкісному дереві, де хірургічний шлях насправді спрацював би)
    // прийнятна; ціна протилежної помилки (відданий побитий YAML/JSON
    // користувачу) — ні. [`parse_target_document`] — той самий диспетчер,
    // що [`fix_template_merge`] використав для `actual` ДО фіксу: JSON-гілка
    // тепер реально перевіряє JSONC-сумісний результат ([`parse_jsonc_document`]),
    // не YAML-парсер (доккомент розділу «Справжня JSONC-підтримка») —
    // подвійна вставка чи зіпсований байтовий діапазон на `.json`-таргеті
    // ловиться ТУТ так само надійно, як на `.yml`.
    let reparsed = parse_target_document(&result, !is_yaml)?;
    if !is_subset(Some(&reparsed), snippet) {
        return None;
    }
    Some(result)
}

/// Статична конфігурація одного `createTemplateFixPattern`-концерну —
/// доккомент [`fix_template_merge`].
struct TemplateFixCfg {
    target_path: &'static str,
    snippet_raw: &'static str,
    is_yaml: bool,
}

const VSCODE_SETTINGS_FIX_CFG: TemplateFixCfg = TemplateFixCfg {
    target_path: VSCODE_SETTINGS_CFG.target_path,
    snippet_raw: VSCODE_SETTINGS_CFG.snippet_raw,
    is_yaml: false,
};

const LINT_SECURITY_YML_FIX_CFG: TemplateFixCfg = TemplateFixCfg {
    target_path: LINT_SECURITY_YML_CFG.target_path,
    snippet_raw: LINT_SECURITY_YML_CFG.snippet_raw,
    is_yaml: true,
};

/// Т0-фіксер `ga/vscode_settings`/`security/lint_security_yml` — точний
/// функціональний порт `createTemplateFixPattern`
/// (`npm/scripts/lib/fix/template-deep-merge.mjs`): файл відсутній →
/// snippet копіюється VERBATIM (байт-у-байт вшитий текст, той самий
/// контракт, що `writeFileSync(absTarget, rawSnippet, 'utf8')`); файл є, але
/// невалідний JSON/YAML → без змін (`catch { return null }`); файл є і вже
/// задовольняє snippet ([`is_subset`]) → без змін (idempotent, без
/// reformat); інакше → [`merge_json_value`] + серіалізація
/// ([`write_yaml_block`] чи [`json_to_pretty_string`], `cfg.is_yaml`).
fn fix_template_merge(request: &FixRequest, cfg: &TemplateFixCfg) -> FixPlan {
    if request.diagnostics.is_empty() {
        return FixPlan { edits: vec![] };
    }
    let existing = batch_file(&request.files, cfg.target_path);
    let Some(source) = existing else {
        return FixPlan {
            edits: vec![FileEdit::Write(WriteFile {
                path: cfg.target_path.to_string(),
                content: cfg.snippet_raw.to_string(),
            })],
        };
    };
    // `.json`-таргет читає за JSONC-контрактом ([`parse_jsonc_document`],
    // доккомент розділу «Справжня JSONC-підтримка» — заміна floor-гейту
    // `is_strict_json`, що раніше жив тут: звіт задачі §2.58 знайшов
    // реальну втрату даних, бо [`parse_yaml_document`] (YAML-парсер) НЕ
    // трактує `//` як коментар, і сусідній ключ тихо зливався в
    // СМІТТЄВИЙ ключ — floor тоді просто НЕ чіпав файл; ЦЯ функція тепер
    // реально мерджить JSONC-вхід, коментарі виживають через хірургічний
    // шлях нижче). Побитий синтаксис (не JSONC — СПРАВДІ невалідний) —
    // той самий JS-канон-контракт: `JSON.parse` кидає → `catch { return
    // null }` → файл не чіпається.
    let Some(actual) = parse_target_document(&source.content, !cfg.is_yaml) else {
        return FixPlan { edits: vec![] };
    };
    let snippet = parse_embedded_template("template-deep-merge snippet", cfg.snippet_raw);
    if is_subset(Some(&actual), &snippet) {
        return FixPlan { edits: vec![] };
    }
    // Хірургічний шлях (доккомент розділу «Хірургічний comment-preserving
    // merge» вище) — коли він застосовний, недоторкані діапазони наявного
    // тексту лишаються байт-у-байт як є (коментарі, форматування, стиль
    // лапок). `None` — шлях недосяжний для цього конкретного дерева (тип
    // не збігається/порожній контейнер/вставка вийшла б за межі власного
    // `}`/`]`) — падає на СТАРУ повну регенерацію ([`merge_json_value`] +
    // [`write_yaml_block`]/[`json_to_pretty_string`]): завжди коректний
    // результат, не завжди comment-preserving.
    let content = try_surgical_merge(&source.content, &snippet, cfg.is_yaml).unwrap_or_else(|| {
        let merged = merge_json_value(Some(&actual), &snippet);
        if cfg.is_yaml {
            write_yaml_block(&merged)
        } else {
            json_to_pretty_string(&merged)
        }
    });
    if content == source.content {
        return FixPlan { edits: vec![] };
    }
    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: cfg.target_path.to_string(),
            content,
        })],
    }
}

/// Чиста (без host-імпортів `log`/`report-progress`) конструктор
/// маніфеста — винесений з [`Guest::describe`] окремо, щоб host-таргет
/// unit-тести могли звірити форму маніфеста без реального wasmtime-хоста
/// (той самий мотив, що решта чотирьох гостей).
fn build_manifest() -> Manifest {
    Manifest {
        id: "ci-github/wasm-concerns".to_string(),
        version: "0.3.0".to_string(),
        world_version: "3.1.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![
            ConcernContribution {
                key: CONCERN_TOOLCHAIN_CACHE.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    ".github/workflows/*.yml".to_string(),
                    ".github/workflows/*.yaml".to_string(),
                    "Cargo.toml".to_string(),
                    "src-tauri/Cargo.toml".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_WORKFLOWS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    ".github/workflows/*".to_string(),
                    ".github/actions/setup-bun-deps/action.yml".to_string(),
                    ".mega-linter.yml".to_string(),
                    ".megalinter.yaml".to_string(),
                    ".mega-linter.yaml".to_string(),
                ],
            },
            // ТРЕТЯ хвиля — три policy-концерни, кожен ОДИН target-файл
            // (доккомент модуля, розділ «ТРЕТЯ хвиля»).
            ConcernContribution {
                key: CONCERN_VSCODE_EXTENSIONS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![VSCODE_EXTENSIONS_CFG.target_path.to_string()],
            },
            ConcernContribution {
                key: CONCERN_VSCODE_SETTINGS.to_string(),
                scope: ConcernScope::Full,
                glob: vec![VSCODE_SETTINGS_CFG.target_path.to_string()],
            },
            ConcernContribution {
                key: CONCERN_LINT_SECURITY_YML.to_string(),
                scope: ConcernScope::Full,
                glob: vec![LINT_SECURITY_YML_CFG.target_path.to_string()],
            },
        ],
        ci_artifacts: vec![],
        // Вміст файлів хост передає inline (host-побудований full-scope
        // batch) — плагін не читає диск сам (той самий мотив, що решта
        // чотирьох гостей). `git`/`github-actionlint`/`uvx`/`shellcheck`
        // отримують доступ до реального диска через `exec-tool`
        // (спавнений процес, ПОЗА пісочницею — доккомент `plugin.toml`), не
        // через WASI `fs_read`.
        capabilities: Capabilities {
            fs_read: vec![],
            network: false,
        },
        tools: vec![
            "path:git".to_string(),
            "npm:github-actionlint".to_string(),
            "path:uvx".to_string(),
            "shellcheck".to_string(),
        ],
    }
}

/// Guest-реалізація `n-rules:plugin@3.1.0` для `ci-github/wasm-concerns` —
/// п'ять концернів, три хвилі (доккомент модуля).
struct CiGithub;

impl Guest for CiGithub {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-ci-github: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        let total = batch.files.len() as u32;
        let diagnostics = match batch.concern_id.as_str() {
            CONCERN_TOOLCHAIN_CACHE => {
                report_progress(total, total);
                detect_toolchain_cache(&batch.files)
            }
            CONCERN_WORKFLOWS => {
                report_progress(total, total);
                detect_workflows(&batch.files)
            }
            CONCERN_VSCODE_EXTENSIONS => {
                report_progress(total, total);
                detect_policy(&batch.files, &VSCODE_EXTENSIONS_CFG)
            }
            CONCERN_VSCODE_SETTINGS => {
                report_progress(total, total);
                detect_policy(&batch.files, &VSCODE_SETTINGS_CFG)
            }
            CONCERN_LINT_SECURITY_YML => {
                report_progress(total, total);
                detect_policy(&batch.files, &LINT_SECURITY_YML_CFG)
            }
            _ => Vec::new(),
        };
        log(
            LogLevel::Info,
            &format!(
                "plugin-ci-github: detect({}) опрацював {total} файл(ів)",
                batch.concern_id
            ),
        );
        diagnostics
    }

    /// П'ять портованих T0-фіксерів — `ga/workflows` ([`fix_workflows`],
    /// доккомент розділу «`ga/workflows` — Т0-фіксер ПОРТОВАНО») і
    /// `rust/toolchain_cache` ([`fix_toolchain_cache`], доккомент розділу
    /// біля [`insert_rust_cache`]) з другої хвилі; `ga/vscode_extensions`
    /// ([`fix_vscode_extensions`]), `ga/vscode_settings`/
    /// `security/lint_security_yml` ([`fix_template_merge`]) з третьої
    /// (доккомент модуля, розділ «ТРЕТЯ хвиля»). `fixability: "config"` у
    /// всіх пʼятьох `concern.json` — не про це: то прапор LLM-ladder-а
    /// (host-side `run-fix.mjs`), guestFix-пріоритет — окремий механізм.
    fn fix(request: FixRequest) -> FixPlan {
        match request.concern_id.as_str() {
            CONCERN_WORKFLOWS => fix_workflows(&request),
            CONCERN_TOOLCHAIN_CACHE => fix_toolchain_cache(&request),
            CONCERN_VSCODE_EXTENSIONS => fix_vscode_extensions(&request),
            CONCERN_VSCODE_SETTINGS => fix_template_merge(&request, &VSCODE_SETTINGS_FIX_CFG),
            CONCERN_LINT_SECURITY_YML => fix_template_merge(&request, &LINT_SECURITY_YML_FIX_CFG),
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

export!(CiGithub);

#[cfg(test)]
mod tests {
    //! Юніт-тести на host-таргеті (`cargo test -p plugin-ci-github`, без
    //! wasm-збірки). На відміну від решти чотирьох гостей —
    //! [`detect_toolchain_cache`] сам НЕ має host-імпортів (жодного
    //! `exec_tool`), тож тут тестується НАПРЯМУ (не лише через
    //! `#[cfg(test)]`-обгортки над чистими helper-ами): повне покриття
    //! `lint()`-поведінки живе тут; `wasm-plugin-parity-ci-github.test.mjs`
    //! (реальний wasmtime-хост) звіряє wasm-`Guest::detect`/`describe`
    //! проти ЖИВОГО JS-канону біт-у-біт понад це.
    use super::*;

    fn sf(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    /// Точні фікстури `toolchain_cache.test.mjs::NO_CACHE_YML`.
    const NO_CACHE_YML: &str = "name: Release\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: dtolnay/rust-toolchain@stable\n        with:\n          components: rustfmt, clippy\n      - uses: tauri-apps/tauri-action@v0\n";

    /// Точні фікстури `toolchain_cache.test.mjs::WITH_CACHE_YML`.
    const WITH_CACHE_YML: &str = "name: Lint\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n      - run: cargo fmt --all -- --check\n";

    // --- line_has_uses_target / is_workspaces_key / indent_of ---

    #[test]
    fn line_has_uses_target_matches_with_and_without_space() {
        assert!(line_has_uses_target(
            "      - uses: dtolnay/rust-toolchain@stable",
            TOOLCHAIN_TARGET
        ));
        assert!(line_has_uses_target(
            "uses:dtolnay/rust-toolchain@stable",
            TOOLCHAIN_TARGET
        ));
        assert!(!line_has_uses_target(
            "      - uses: actions/checkout@v6",
            TOOLCHAIN_TARGET
        ));
    }

    #[test]
    fn line_has_uses_target_ignores_unrelated_uses_prefix() {
        // Перше входження "uses:" не збігається з target-ом, друге — так;
        // регекс шукав би БУДЬ-ДЕ в рядку, той самий контракт тут.
        assert!(line_has_uses_target(
            "# uses: not-a-real-step, uses: dtolnay/rust-toolchain@stable",
            TOOLCHAIN_TARGET
        ));
    }

    #[test]
    fn is_workspaces_key_matches_indented_key_with_and_without_space() {
        assert!(is_workspaces_key("          workspaces: src-tauri"));
        assert!(is_workspaces_key("workspaces:src-tauri"));
        assert!(!is_workspaces_key("          workspaces-extra: x"));
        assert!(!is_workspaces_key("          cache-on-failure: true"));
    }

    #[test]
    fn indent_of_counts_leading_spaces() {
        assert_eq!(indent_of("      - uses: x"), 6);
        assert_eq!(indent_of("no-indent"), 0);
        assert_eq!(indent_of(""), 0);
    }

    #[test]
    fn dash_col_for_floors_at_zero() {
        assert_eq!(dash_col_for(8), 6);
        assert_eq!(dash_col_for(1), 0);
        assert_eq!(dash_col_for(0), 0);
    }

    // --- scan_toolchain_steps — не-ASCII фікстура (доккомент модуля, розділ «Чотири патерни») ---

    #[test]
    fn scan_toolchain_steps_handles_non_ascii_job_name() {
        // Назва job-а й коментар — кирилиця/емодзі ПІСЛЯ структурних
        // ASCII-маркерів (`- uses:`), той самий випадок, що доккомент
        // модуля обіцяє: жоден з чотирьох патернів не використовує `\w`/`\d`,
        // тож нелатинський текст деінде в рядку не впливає на матч.
        let yaml = "name: Лінт 🦀\njobs:\n  lint-важливий:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable # тулчейн для проєкту\n      - uses: Swatinem/rust-cache@v2\n";
        let steps = scan_toolchain_steps(yaml);
        assert_eq!(steps.len(), 1);
        assert!(steps[0].has_cache);
    }

    // --- scan_toolchain_steps — межі job-а / кінець jobs: (доккомент модуля) ---

    #[test]
    fn scan_toolchain_steps_no_cache_reports_missing() {
        let steps = scan_toolchain_steps(NO_CACHE_YML);
        assert_eq!(steps.len(), 1);
        assert!(!steps[0].has_cache);
    }

    #[test]
    fn scan_toolchain_steps_cache_immediately_after_is_clean() {
        let steps = scan_toolchain_steps(WITH_CACHE_YML);
        assert_eq!(steps.len(), 1);
        assert!(steps[0].has_cache);
        assert!(!steps[0].job_has_tauri_action);
    }

    #[test]
    fn scan_toolchain_steps_second_job_does_not_leak_into_first() {
        let yaml = "name: CI\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: tauri-apps/tauri-action@v0\n";
        let steps = scan_toolchain_steps(yaml);
        assert_eq!(steps.len(), 2);
        assert!(steps[0].has_cache, "перший job має кеш одразу після");
        assert!(
            !steps[1].has_cache,
            "другий job без кешу — dedent межа не мала протекти кеш першого job-а сюди"
        );
        assert!(steps[1].job_has_tauri_action);
    }

    #[test]
    fn scan_toolchain_steps_toolchain_step_is_last_line_of_file() {
        // Кінець `jobs:` — файл обривається одразу після toolchain-кроку,
        // без наступного job-а й без trailing newline. `scan_job_for_cache`
        // мусить завершитись природним вичерпанням `lines`, не панікою чи
        // хибним `hasCache`.
        let yaml = "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable";
        let steps = scan_toolchain_steps(yaml);
        assert_eq!(steps.len(), 1);
        assert!(!steps[0].has_cache);
    }

    #[test]
    fn scan_toolchain_steps_blank_line_inside_job_does_not_break_scan() {
        // Порожній рядок МІЖ toolchain- і cache-кроком не має хибно
        // завершити скан як dedent (`indentOf('') === 0 < dashCol`) —
        // `main.mjs` явно пропускає порожні рядки ПЕРЕД перевіркою відступу.
        let yaml = "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n\n      - uses: Swatinem/rust-cache@v2\n";
        let steps = scan_toolchain_steps(yaml);
        assert_eq!(steps.len(), 1);
        assert!(steps[0].has_cache);
    }

    // --- tauri_workspace_dir ---

    #[test]
    fn tauri_workspace_dir_root_cargo_toml_present_is_none() {
        let files = vec![sf("Cargo.toml", "[workspace]\n")];
        assert_eq!(tauri_workspace_dir(&files), None);
    }

    #[test]
    fn tauri_workspace_dir_only_src_tauri_cargo_toml_present() {
        let files = vec![sf("src-tauri/Cargo.toml", "[package]\nname=\"t\"\n")];
        assert_eq!(tauri_workspace_dir(&files), Some("src-tauri".to_string()));
    }

    #[test]
    fn tauri_workspace_dir_neither_present_is_none() {
        assert_eq!(tauri_workspace_dir(&[]), None);
    }

    // --- detect_toolchain_cache — пряме end-to-end покриття (без exec_tool) ---

    #[test]
    fn detect_toolchain_cache_no_workflows_dir_is_empty() {
        assert!(detect_toolchain_cache(&[]).is_empty());
    }

    #[test]
    fn detect_toolchain_cache_missing_cache_reports_violation() {
        let files = vec![sf(".github/workflows/release.yml", NO_CACHE_YML)];
        let violations = detect_toolchain_cache(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, MISSING_RUST_CACHE_REASON);
        assert_eq!(
            violations[0].file.as_deref(),
            Some(".github/workflows/release.yml")
        );
        assert_eq!(violations[0].data.as_deref(), Some(MISSING_RUST_CACHE_DATA));
    }

    #[test]
    fn detect_toolchain_cache_with_cache_is_clean() {
        let files = vec![sf(".github/workflows/lint-rust.yml", WITH_CACHE_YML)];
        assert!(detect_toolchain_cache(&files).is_empty());
    }

    #[test]
    fn detect_toolchain_cache_tauri_without_root_cargo_toml_requires_workspaces() {
        let files = vec![
            sf("src-tauri/Cargo.toml", "[package]\nname=\"t\"\n"),
            sf(
                ".github/workflows/release.yml",
                "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n      - uses: tauri-apps/tauri-action@v0\n"
            ),
        ];
        let violations = detect_toolchain_cache(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, MISSING_RUST_CACHE_WORKSPACES_REASON);
        let data = violations[0].data.as_deref().expect("data є");
        assert!(data.contains("\"workspaceDir\":\"src-tauri\""));
    }

    #[test]
    fn detect_toolchain_cache_tauri_with_root_cargo_toml_skips_workspaces_check() {
        // `tauri_workspace_dir` повертає `None`, коли корінь репо вже є
        // Cargo-workspace — друга перевірка структурно недосяжна (доккомент
        // `if let Some(dir) = &workspace_dir`), навіть якщо job має
        // tauri-action і кеш без `workspaces`.
        let files = vec![
            sf("Cargo.toml", "[workspace]\n"),
            sf(
                ".github/workflows/release.yml",
                "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n      - uses: tauri-apps/tauri-action@v0\n"
            ),
        ];
        assert!(detect_toolchain_cache(&files).is_empty());
    }

    #[test]
    fn detect_toolchain_cache_cache_step_already_has_workspaces_is_clean() {
        let files = vec![
            sf("src-tauri/Cargo.toml", "[package]\nname=\"t\"\n"),
            sf(
                ".github/workflows/release.yml",
                "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n        with:\n          workspaces: src-tauri\n      - uses: tauri-apps/tauri-action@v0\n"
            ),
        ];
        assert!(detect_toolchain_cache(&files).is_empty());
    }

    #[test]
    fn detect_toolchain_cache_ignores_non_workflow_files_in_batch() {
        // `Cargo.toml`/`src-tauri/Cargo.toml` — самі не workflow-файли,
        // `is_workflow_path` мусить їх відфільтрувати з циклу перебору.
        let files = vec![sf("Cargo.toml", "[workspace]\n")];
        assert!(detect_toolchain_cache(&files).is_empty());
    }

    // --- insert_rust_cache / add_cache_workspaces — точні відповідники
    // `fix-toolchain_cache.test.mjs::describe('fix rust.toolchain_cache — T0
    // текстові трансформери')` ---

    #[test]
    fn insert_rust_cache_inserts_after_toolchain_step_and_its_with_block() {
        let next = insert_rust_cache(NO_CACHE_YML, None).expect("має змінитись");
        let lines: Vec<&str> = next.split('\n').collect();
        let components_idx = lines
            .iter()
            .position(|l| l.contains("components: rustfmt, clippy"))
            .expect("components-рядок є");
        let cache_idx = lines
            .iter()
            .position(|l| l.contains("Swatinem/rust-cache@v2"))
            .expect("cache-рядок вставлено");
        let tauri_idx = lines
            .iter()
            .position(|l| l.contains("tauri-apps/tauri-action@v0"))
            .expect("tauri-рядок є");
        assert!(cache_idx > components_idx);
        assert!(cache_idx < tauri_idx);
    }

    #[test]
    fn insert_rust_cache_already_has_cache_is_none() {
        assert!(insert_rust_cache(WITH_CACHE_YML, None).is_none());
    }

    #[test]
    fn insert_rust_cache_with_workspace_dir_appends_with_block_only_for_tauri_job() {
        let next = insert_rust_cache(NO_CACHE_YML, Some("src-tauri")).expect("має змінитись");
        assert!(next.contains("workspaces: src-tauri"));
    }

    #[test]
    fn add_cache_workspaces_appends_with_block_to_existing_cache_step() {
        let src = "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n      - uses: tauri-apps/tauri-action@v0\n";
        let next = add_cache_workspaces(src, "src-tauri").expect("має змінитись");
        assert!(next.contains("workspaces: src-tauri"));
    }

    #[test]
    fn add_cache_workspaces_already_present_is_none() {
        let src = "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n        with:\n          workspaces: src-tauri\n      - uses: tauri-apps/tauri-action@v0\n";
        assert!(add_cache_workspaces(src, "src-tauri").is_none());
    }

    #[test]
    fn add_cache_workspaces_non_tauri_job_is_none() {
        let src =
            "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n";
        assert!(add_cache_workspaces(src, "src-tauri").is_none());
    }

    // --- fix_toolchain_cache: guest FixRequest → FixPlan ---

    #[test]
    fn fix_toolchain_cache_missing_cache_writes_edit() {
        let rel = ".github/workflows/release.yml";
        let request = FixRequest {
            concern_id: CONCERN_TOOLCHAIN_CACHE.to_string(),
            files: vec![sf(rel, NO_CACHE_YML)],
            diagnostics: vec![Diagnostic {
                reason: MISSING_RUST_CACHE_REASON.to_string(),
                message: "x".to_string(),
                file: Some(rel.to_string()),
                severity: Severity::Error,
                data: Some(MISSING_RUST_CACHE_DATA.to_string()),
            }],
        };
        let plan = fix_toolchain_cache(&request);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікували write-edit")
        };
        assert_eq!(write.path, rel);
        assert!(write.content.contains("Swatinem/rust-cache@v2"));
    }

    #[test]
    fn fix_toolchain_cache_missing_workspaces_writes_edit() {
        let rel = ".github/workflows/release.yml";
        let content = "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n      - uses: tauri-apps/tauri-action@v0\n";
        let request = FixRequest {
            concern_id: CONCERN_TOOLCHAIN_CACHE.to_string(),
            files: vec![sf(rel, content)],
            diagnostics: vec![Diagnostic {
                reason: MISSING_RUST_CACHE_WORKSPACES_REASON.to_string(),
                message: "x".to_string(),
                file: Some(rel.to_string()),
                severity: Severity::Error,
                data: Some(
                    "{\"kind\":\"missing-rust-cache-workspaces\",\"workspaceDir\":\"src-tauri\"}"
                        .to_string(),
                ),
            }],
        };
        let plan = fix_toolchain_cache(&request);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікували write-edit")
        };
        assert!(write.content.contains("workspaces: src-tauri"));
    }

    #[test]
    fn fix_toolchain_cache_ignores_foreign_reason() {
        let request = FixRequest {
            concern_id: CONCERN_TOOLCHAIN_CACHE.to_string(),
            files: vec![sf(".github/workflows/release.yml", NO_CACHE_YML)],
            diagnostics: vec![Diagnostic {
                reason: "other".to_string(),
                message: "x".to_string(),
                file: Some(".github/workflows/release.yml".to_string()),
                severity: Severity::Error,
                data: None,
            }],
        };
        assert!(fix_toolchain_cache(&request).edits.is_empty());
    }

    /// T0-раунд-трип ВСЕРЕДИНІ гостя для `missing-rust-cache` — той самий
    /// прийом, що `add_persist_credentials_round_trip_with_rego_detect_is_clean`:
    /// [`detect_toolchain_cache`] — реальний detect-шлях цього reason-а, БЕЗ
    /// host-імпортів.
    #[test]
    fn fix_toolchain_cache_missing_cache_round_trip_with_detect_is_clean() {
        let rel = ".github/workflows/release.yml";
        let before = vec![sf(rel, NO_CACHE_YML)];
        let diagnostics_before = detect_toolchain_cache(&before);
        assert_eq!(diagnostics_before.len(), 1);
        assert_eq!(diagnostics_before[0].reason, MISSING_RUST_CACHE_REASON);

        let plan = fix_toolchain_cache(&FixRequest {
            concern_id: CONCERN_TOOLCHAIN_CACHE.to_string(),
            files: before.clone(),
            diagnostics: diagnostics_before,
        });
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікували write-edit")
        };
        let after = vec![sf(rel, &write.content)];
        assert!(detect_toolchain_cache(&after).is_empty());
    }

    /// T0-раунд-трип ВСЕРЕДИНІ гостя для `missing-rust-cache-workspaces` —
    /// той самий мотив, що тест вище.
    #[test]
    fn fix_toolchain_cache_missing_workspaces_round_trip_with_detect_is_clean() {
        let rel = ".github/workflows/release.yml";
        let content = "jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable\n      - uses: Swatinem/rust-cache@v2\n      - uses: tauri-apps/tauri-action@v0\n";
        let before = vec![
            sf("src-tauri/Cargo.toml", "[package]\nname=\"t\"\n"),
            sf(rel, content),
        ];
        let diagnostics_before = detect_toolchain_cache(&before);
        assert_eq!(diagnostics_before.len(), 1);
        assert_eq!(
            diagnostics_before[0].reason,
            MISSING_RUST_CACHE_WORKSPACES_REASON
        );

        let plan = fix_toolchain_cache(&FixRequest {
            concern_id: CONCERN_TOOLCHAIN_CACHE.to_string(),
            files: before.clone(),
            diagnostics: diagnostics_before,
        });
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікували write-edit")
        };
        let after = vec![
            sf("src-tauri/Cargo.toml", "[package]\nname=\"t\"\n"),
            sf(rel, &write.content),
        ];
        assert!(detect_toolchain_cache(&after).is_empty());
    }

    // --- маніфест: anti-drift `plugin.toml` ---

    #[test]
    fn build_manifest_declares_five_full_scope_concerns() {
        let manifest = build_manifest();
        assert_eq!(manifest.id, "ci-github/wasm-concerns");
        assert_eq!(manifest.concerns.len(), 5);
        assert_eq!(manifest.concerns[0].key, CONCERN_TOOLCHAIN_CACHE);
        assert_eq!(manifest.concerns[0].scope, ConcernScope::Full);
        let workflows = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_WORKFLOWS)
            .expect("ga/workflows contribution має бути в маніфесті");
        assert_eq!(workflows.scope, ConcernScope::Full);
        assert_eq!(
            workflows.glob,
            vec![
                ".github/workflows/*".to_string(),
                ".github/actions/setup-bun-deps/action.yml".to_string(),
                ".mega-linter.yml".to_string(),
                ".megalinter.yaml".to_string(),
                ".mega-linter.yaml".to_string(),
            ]
        );
        assert_eq!(
            manifest.tools,
            vec![
                "path:git".to_string(),
                "npm:github-actionlint".to_string(),
                "path:uvx".to_string(),
                "shellcheck".to_string(),
            ]
        );
        for (key, glob) in [
            (CONCERN_VSCODE_EXTENSIONS, ".vscode/extensions.json"),
            (CONCERN_VSCODE_SETTINGS, ".vscode/settings.json"),
            (
                CONCERN_LINT_SECURITY_YML,
                ".github/workflows/lint-security.yml",
            ),
        ] {
            let c = manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .unwrap_or_else(|| panic!("{key} contribution має бути в маніфесті"));
            assert_eq!(c.scope, ConcernScope::Full);
            assert_eq!(c.glob, vec![glob.to_string()]);
        }
    }

    #[test]
    fn plugin_toml_concern_keys_match_describe() {
        let manifest: toml::Table = include_str!("../plugin.toml")
            .parse()
            .expect("plugin.toml має бути валідним TOML");
        let runtime = build_manifest();

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

        let declared_tools: Vec<&str> = manifest
            .get("tools")
            .and_then(|v| v.as_array())
            .expect("`tools` мусить бути top-level масивом маніфеста")
            .iter()
            .map(|t| t.as_str().expect("елемент `tools` — рядок"))
            .collect();
        assert_eq!(
            declared_tools,
            runtime.tools.iter().map(String::as_str).collect::<Vec<_>>(),
            "plugin.toml розійшовся з describe() по tools"
        );
    }

    // =====================================================================
    // `ga/workflows` — host-таргет unit-тести. `check_shellcheck_installed`/
    // `run_actionlint`/`run_zizmor`/`git_has_any_tracked_file_matching_glob`/
    // `verify_one_paths_glob`/`verify_workflow_event_paths_globs_exist`/
    // `detect_workflows` (ціла функція) НЕ тестуються тут напряму — усі
    // кличуть `exec_tool` (host-import, `wit_bindgen::generate!`), який на
    // host-таргеті ПАНІКУЄ (перевірено емпірично: non-unwinding abort,
    // `wit_import19`) — той самий структурний бар'єр, що документують
    // `crates/plugin-lang-rust`/`crates/plugin-lang-php` для `rust/check`-
    // подібних концернів. Ці гілки покриває ЛИШЕ
    // `wasm-plugin-parity-ci-github.test.mjs` (реальний wasmtime-хост).
    //
    // `run_all_ga_rego`/`eval_deny_rule` — НАВПАКИ, без жодного host-імпорту
    // (regorus виконується цілком у Rust) — найризикованіша частина порту
    // (YAML→JSON конвертація + Rego-виконання) тому ПОВНІСТЮ покрита тут.
    // =====================================================================

    fn sfw(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    // --- Json / YAML→JSON конвертація ---

    #[test]
    fn parse_yaml_document_scalar_root_is_none() {
        assert_eq!(parse_yaml_document("just a string\n"), None);
        assert_eq!(parse_yaml_document("- 1\n- 2\n"), None);
    }

    #[test]
    fn parse_yaml_document_invalid_syntax_is_none() {
        assert_eq!(parse_yaml_document("name: [unterminated\n"), None);
    }

    #[test]
    fn parse_yaml_document_on_key_stays_string_yaml_12() {
        // YAML 1.2 (saphyr) — на відміну від Go-yaml conftest (YAML 1.1) —
        // НІКОЛИ не читає голий `on:` як булевий ключ. Той самий парсер, що
        // й `yaml` npm-пакет канону.
        let root = parse_yaml_document("on:\n  push: {}\n").expect("валідний YAML-обʼєкт");
        assert!(root.get("on").is_some());
        assert!(root.get("true").is_none());
    }

    #[test]
    fn parse_yaml_document_nested_mapping_and_sequence() {
        let root = parse_yaml_document(
            "name: CI\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v6\n      - run: echo hi\n",
        )
        .expect("валідний YAML-обʼєкт");
        assert_eq!(root.get("name").and_then(Json::as_str), Some("CI"));
        let steps = root
            .get("jobs")
            .and_then(|j| j.get("build"))
            .and_then(|b| b.get("steps"))
            .and_then(Json::as_array);
        let steps = steps.expect("steps — масив");
        assert_eq!(steps.len(), 2);
        assert_eq!(
            steps[0].get("uses").and_then(Json::as_str),
            Some("actions/checkout@v6")
        );
    }

    #[test]
    fn json_to_string_escapes_and_types_correctly() {
        let value = Json::Object(vec![
            ("s".to_string(), Json::Str("a\"b\n".to_string())),
            ("n".to_string(), Json::Int(-5)),
            ("f".to_string(), Json::Float(1.5)),
            ("b".to_string(), Json::Bool(true)),
            ("nil".to_string(), Json::Null),
            (
                "arr".to_string(),
                Json::Array(vec![Json::Int(1), Json::Int(2)]),
            ),
        ]);
        let text = json_to_string(&value);
        assert!(text.contains("\"s\":\"a\\\"b\\n\""));
        assert!(text.contains("\"n\":-5"));
        assert!(text.contains("\"f\":1.5"));
        assert!(text.contains("\"b\":true"));
        assert!(text.contains("\"nil\":null"));
        assert!(text.contains("\"arr\":[1,2]"));
    }

    // --- should_validate_workflow_paths_glob ---

    #[test]
    fn should_validate_workflow_paths_glob_rejects_negation() {
        assert!(!should_validate_workflow_paths_glob("!node_modules/**"));
    }

    #[test]
    fn should_validate_workflow_paths_glob_rejects_optional_canonical_configs() {
        assert!(!should_validate_workflow_paths_glob("pyproject.toml"));
        assert!(!should_validate_workflow_paths_glob("**/rustfmt.toml"));
    }

    #[test]
    fn should_validate_workflow_paths_glob_rejects_extension_filters() {
        assert!(!should_validate_workflow_paths_glob("*.vue"));
        assert!(!should_validate_workflow_paths_glob("**/*.php"));
    }

    #[test]
    fn should_validate_workflow_paths_glob_accepts_plain_dir_glob() {
        assert!(should_validate_workflow_paths_glob("some-dir/**"));
        assert!(should_validate_workflow_paths_glob(".github/workflows/**"));
    }

    // --- checkout_persist_hint ---

    #[test]
    fn checkout_persist_hint_matches_persist_credentials_message() {
        let hint = checkout_persist_hint(
            ".github/workflows/foo.yml",
            "jobs.build: actions/checkout@v6 потребує `with: persist-credentials: false` (ga.mdc)",
        );
        let (reason, file, data) = hint.expect("має матчитись");
        assert_eq!(reason, "checkout-persist-credentials");
        assert_eq!(file, ".github/workflows/foo.yml");
        assert_eq!(data, "{\"kind\":\"checkout-persist-credentials\"}");
    }

    #[test]
    fn checkout_persist_hint_no_match_for_unrelated_message() {
        assert!(
            checkout_persist_hint(".github/workflows/foo.yml", "name має бути \"X\" (ga.mdc)")
                .is_none()
        );
    }

    // --- check_ga_workflow_files ---

    #[test]
    fn check_ga_workflow_files_all_required_present_no_violations() {
        let mut d = Vec::new();
        let filenames: Vec<String> = REQUIRED_WORKFLOWS.iter().map(|s| s.to_string()).collect();
        check_ga_workflow_files(&mut d, &filenames);
        assert!(d.is_empty());
    }

    #[test]
    fn check_ga_workflow_files_missing_required_reports_one_each() {
        let mut d = Vec::new();
        check_ga_workflow_files(&mut d, &[]);
        assert_eq!(d.len(), REQUIRED_WORKFLOWS.len());
        assert!(d.iter().all(|v| v.reason == DEFAULT_REASON));
        assert!(d[0].message.contains("clean-ga-workflows.yml"));
    }

    #[test]
    fn check_ga_workflow_files_yaml_extension_gives_two_violations() {
        // Канон буквально дає ДВІ violation на один `.yaml`-файл (доккомент
        // `check_ga_workflow_files`) — порт НЕ згортає в одну.
        let mut d = Vec::new();
        let filenames = vec!["stray.yaml".to_string()];
        check_ga_workflow_files(&mut d, &filenames);
        let stray: Vec<&Diagnostic> = d
            .iter()
            .filter(|v| v.message.contains("stray.yaml"))
            .collect();
        assert_eq!(stray.len(), 2);
        assert!(stray[0].message.contains("перейменуй на .yml"));
        assert!(stray[1].message.contains("має бути з розширенням .yml"));
    }

    // --- check_apply_workflow ---

    #[test]
    fn check_apply_workflow_absent_file_is_noop() {
        let mut d = Vec::new();
        check_apply_workflow(&mut d, &[], "apply-k8s.yml", "**/k8s/**/*.yaml");
        assert!(d.is_empty());
    }

    #[test]
    fn check_apply_workflow_correct_paths_trigger_is_clean() {
        let mut d = Vec::new();
        let files = vec![sfw(
            ".github/workflows/apply-k8s.yml",
            "on:\n  push:\n    paths:\n      - '**/k8s/**/*.yaml'\njobs:\n  apply:\n    steps: []\n",
        )];
        check_apply_workflow(&mut d, &files, "apply-k8s.yml", "**/k8s/**/*.yaml");
        assert!(d.is_empty());
    }

    #[test]
    fn check_apply_workflow_missing_paths_trigger_reports_violation() {
        let mut d = Vec::new();
        let files = vec![sfw(
            ".github/workflows/apply-k8s.yml",
            "on:\n  push:\n    branches: [main]\njobs:\n  apply:\n    steps: []\n",
        )];
        check_apply_workflow(&mut d, &files, "apply-k8s.yml", "**/k8s/**/*.yaml");
        assert_eq!(d.len(), 1);
        assert!(d[0].message.contains("apply-k8s.yml не містить paths"));
    }

    #[test]
    fn check_apply_workflow_malformed_yaml_falls_back_to_raw_content_substring() {
        let mut d = Vec::new();
        // Некоректний YAML (tab у ключі) — `parse_yaml_document` дає `None`,
        // порт мусить впасти на `content.contains(expected_path)`, точний
        // відповідник `content.includes(expectedPath)` канону.
        let files = vec![sfw(
            ".github/workflows/apply-k8s.yml",
            "not: [valid\nraw text with **/k8s/**/*.yaml inside",
        )];
        check_apply_workflow(&mut d, &files, "apply-k8s.yml", "**/k8s/**/*.yaml");
        assert!(d.is_empty());
    }

    // --- check_megalinter ---

    #[test]
    fn check_megalinter_detects_use_pattern_case_insensitively() {
        let mut d = Vec::new();
        let wf = sfw(
            ".github/workflows/megalint.yml",
            "jobs:\n  lint:\n    steps:\n      - uses: OxSecurity/MegaLinter-Action@v8\n",
        );
        check_megalinter(&mut d, &[&wf], &[]);
        assert_eq!(d.len(), 1);
        assert!(d[0].message.contains("megalint.yml"));
    }

    #[test]
    fn check_megalinter_detects_root_config_file() {
        let mut d = Vec::new();
        let files = vec![sfw(".mega-linter.yml", "MEGALINTER_CONFIG:\n")];
        check_megalinter(&mut d, &[], &files);
        assert_eq!(d.len(), 1);
        assert!(d[0].message.contains(".mega-linter.yml"));
    }

    #[test]
    fn check_megalinter_clean_project_has_no_violations() {
        let mut d = Vec::new();
        let wf = sfw(
            ".github/workflows/lint.yml",
            "jobs:\n  lint:\n    steps:\n      - run: echo ok\n",
        );
        check_megalinter(&mut d, &[&wf], &[]);
        assert!(d.is_empty());
    }

    // --- verify_no_bare_n_cursor ---

    #[test]
    fn verify_no_bare_n_cursor_flags_bare_run_step() {
        let mut d = Vec::new();
        verify_no_bare_n_cursor(
            &mut d,
            ".github/workflows/lint-ga.yml",
            "steps:\n  - run: n-rules lint ga\n",
        );
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].reason, "bare-n-rules");
        assert!(d[0].message.contains("рядок 2"));
    }

    #[test]
    fn verify_no_bare_n_cursor_ignores_bunx_wrapped_invocation() {
        let mut d = Vec::new();
        verify_no_bare_n_cursor(
            &mut d,
            ".github/workflows/lint-ga.yml",
            "steps:\n  - run: bunx n-rules lint ga\n",
        );
        assert!(d.is_empty());
    }

    #[test]
    fn verify_no_bare_n_cursor_flags_bare_line_without_run_prefix() {
        let mut d = Vec::new();
        verify_no_bare_n_cursor(
            &mut d,
            ".github/workflows/lint-ga.yml",
            "run: |\n  n-rules lint ga --no-fix\n",
        );
        assert_eq!(d.len(), 1);
    }

    // --- is_workflow_dir_entry / workflow_basename ---

    #[test]
    fn is_workflow_dir_entry_rejects_nested_and_unrelated_paths() {
        assert!(is_workflow_dir_entry(".github/workflows/lint.yml"));
        assert!(!is_workflow_dir_entry(".github/workflows/nested/lint.yml"));
        assert!(!is_workflow_dir_entry(
            ".github/actions/setup-bun-deps/action.yml"
        ));
        assert!(!is_workflow_dir_entry(".mega-linter.yml"));
    }

    #[test]
    fn workflow_basename_strips_prefix() {
        assert_eq!(workflow_basename(".github/workflows/lint.yml"), "lint.yml");
    }

    // --- anti-drift: namespace Rust-константи ↔ `package` вшитого .rego ---

    /// Той самий прийом, що `ignored_dir_names_match_declarative_rule_gate`
    /// у `crates/plugin-lang-rust` — тут перевіряє не список значень, а що
    /// `data.<namespace>.deny` ВЗАГАЛІ обчислюється (не помилка компіляції/
    /// eval) на кожному з пʼяти вшитих `.rego` — намespace-рядок,
    /// захардкоджений у [`run_all_ga_rego`]/[`build_workflow_common_engine`],
    /// має РЕАЛЬНО збігатися з `package ga.<name>` усередині вшитого файлу
    /// (не окрема Rust-копія, яка могла б розійтися).
    #[test]
    fn embedded_rego_policies_namespace_matches_rust_side_constant() {
        let cases: [(&str, &str); 5] = [
            (CLEAN_GA_WORKFLOWS_REGO, "ga.clean_ga_workflows"),
            (CLEAN_MERGED_BRANCH_REGO, "ga.clean_merged_branch"),
            (LINT_GA_REGO, "ga.lint_ga"),
            (GIT_AI_REGO, "ga.git_ai"),
            (WORKFLOW_COMMON_REGO, "ga.workflow_common"),
        ];
        for (rego_source, namespace) in cases {
            let mut engine = regorus::Engine::new();
            engine
                .add_policy(format!("{namespace}.rego"), rego_source.to_string())
                .unwrap_or_else(|e| panic!("{namespace}: policy має компілюватись: {e}"));
            engine.set_input(regorus::Value::new_object());
            let result = engine.eval_rule(format!("data.{namespace}.deny")).unwrap_or_else(|e| {
                panic!(
                    "{namespace}: eval_rule(deny) провалився — Rust-side namespace-константа розійшлась \
                     з `package`, вшитим у .rego: {e}"
                )
            });
            assert!(
                matches!(result, regorus::Value::Set(_) | regorus::Value::Array(_)),
                "{namespace}: `deny` має бути set/array, отримано {result:?}"
            );
        }
    }

    // --- run_all_ga_rego: канонічні фікстури (template-и, доккомент модуля) ---

    #[test]
    fn run_all_ga_rego_canonical_clean_ga_workflows_is_clean() {
        let wf = sfw(
            ".github/workflows/clean-ga-workflows.yml",
            CLEAN_GA_WORKFLOWS_SNIPPET_YML,
        );
        let mut d = Vec::new();
        run_all_ga_rego(&mut d, &[&wf], &[&wf]);
        assert!(
            d.is_empty(),
            "канонічний clean-ga-workflows.yml має бути чистим: {d:?}"
        );
    }

    #[test]
    fn run_all_ga_rego_canonical_clean_merged_branch_is_clean() {
        let wf = sfw(
            ".github/workflows/clean-merged-branch.yml",
            CLEAN_MERGED_BRANCH_SNIPPET_YML,
        );
        let mut d = Vec::new();
        run_all_ga_rego(&mut d, &[&wf], &[&wf]);
        assert!(
            d.is_empty(),
            "канонічний clean-merged-branch.yml має бути чистим: {d:?}"
        );
    }

    #[test]
    fn run_all_ga_rego_canonical_lint_ga_is_clean() {
        let wf = sfw(".github/workflows/lint-ga.yml", LINT_GA_SNIPPET_YML);
        let mut d = Vec::new();
        run_all_ga_rego(&mut d, &[&wf], &[&wf]);
        assert!(
            d.is_empty(),
            "канонічний lint-ga.yml має бути чистим: {d:?}"
        );
    }

    #[test]
    fn run_all_ga_rego_canonical_git_ai_is_clean() {
        let wf = sfw(".github/workflows/git-ai.yml", GIT_AI_SNIPPET_YML);
        let mut d = Vec::new();
        run_all_ga_rego(&mut d, &[&wf], &[&wf]);
        assert!(d.is_empty(), "канонічний git-ai.yml має бути чистим: {d:?}");
    }

    #[test]
    fn run_all_ga_rego_wrong_name_reports_double_prefixed_message() {
        let mutated = CLEAN_GA_WORKFLOWS_SNIPPET_YML.replacen(
            "name: Clean action for removing completed workflow runs",
            "name: Wrong Name",
            1,
        );
        let wf = sfw(".github/workflows/clean-ga-workflows.yml", &mutated);
        let mut d = Vec::new();
        run_all_ga_rego(&mut d, &[&wf], &[&wf]);
        assert_eq!(d.len(), 1);
        // Подвійний префікс — доккомент `push_rego_violation`: канон буквально
        // так (`${target.workflow}: ${v.message}`, а `v.message` вже сам
        // починається з `clean-ga-workflows.yml:`).
        assert_eq!(
            d[0].message,
            "clean-ga-workflows.yml: name має бути \"Clean action for removing completed workflow runs\" (ga.mdc)"
                .replacen("clean-ga-workflows.yml:", ".github/workflows/clean-ga-workflows.yml: clean-ga-workflows.yml:", 1)
        );
        assert_eq!(d[0].reason, DEFAULT_REASON);
        assert!(d[0].file.is_none());
        assert!(d[0].data.is_none());
    }

    #[test]
    fn run_all_ga_rego_missing_workflow_file_is_skipped() {
        // Жоден з чотирьох per-workflow таргетів не матчить — `run_all_ga_rego`
        // не падає, просто нічого не évalu (`continue`, доккомент `runAllGaRego`).
        let mut d = Vec::new();
        run_all_ga_rego(&mut d, &[], &[]);
        assert!(d.is_empty());
    }

    #[test]
    fn run_all_ga_rego_workflow_common_flags_checkout_without_persist_credentials() {
        let wf = sfw(
            ".github/workflows/other.yml",
            "name: Sample\non:\n  push:\n    branches: [main]\nconcurrency:\n  group: ${{ github.ref }}-${{ github.workflow }}\n  cancel-in-progress: true\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n",
        );
        let mut d = Vec::new();
        // Шлях НЕ збігається з жодним з 4 per-workflow таргетів — лише
        // `workflow_common` бачить цей файл (доккомент тесту).
        run_all_ga_rego(&mut d, &[&wf], &[&wf]);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].reason, "checkout-persist-credentials");
        assert_eq!(d[0].file.as_deref(), Some(".github/workflows/other.yml"));
        assert_eq!(
            d[0].data.as_deref(),
            Some("{\"kind\":\"checkout-persist-credentials\"}")
        );
        assert!(d[0].message.contains("persist-credentials"));
        assert!(d[0]
            .message
            .starts_with(".github/workflows/other.yml: jobs.build:"));
    }

    #[test]
    fn run_all_ga_rego_workflow_common_missing_concurrency_reports_violation() {
        let wf = sfw(
            ".github/workflows/other.yml",
            "name: Sample\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    steps: []\n",
        );
        let mut d = Vec::new();
        run_all_ga_rego(&mut d, &[&wf], &[&wf]);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].reason, DEFAULT_REASON);
        assert!(d[0].message.contains("відсутня секція concurrency"));
    }

    #[test]
    fn run_all_ga_rego_empty_yml_workflows_skips_workflow_common() {
        // `wf_files` непорожній (per-workflow петля все одно щось перебирає),
        // але `yml_workflows` порожній — `workflow_common`-блок виходить
        // раннім `return` (доккомент `runAllGaRego`), не панікує.
        let non_yml = sfw(".github/workflows/readme.txt", "not a workflow");
        let mut d = Vec::new();
        run_all_ga_rego(&mut d, &[&non_yml], &[]);
        assert!(d.is_empty());
    }

    // --- правка 1: видима діагностика замість мовчазного fail-open ---
    //
    // Три rego-помилки нижче зроблено ЛИШЕ тестовими (test-local) рядками —
    // жоден реальний `.rego`-файл не чіпається. Продакшн-шлях
    // [`run_all_ga_rego`] справді недосяжний для цих гілок (rego-джерело й
    // `--data`-шаблони вшиті на compile-time, JSON-`input` завжди валідний —
    // [`write_json`] не може випустити побитий синтаксис), тож єдиний спосіб
    // довести, що діагностика зʼявляється замість тиші — прямий виклик
    // [`eval_deny_rule`]/[`push_rego_engine_error`] зі зламаним входом,
    // сконструйованим тут.

    #[test]
    fn eval_deny_rule_reports_compile_stage_error_for_unparsable_rego() {
        // Незбалансована дужка — policy взагалі не парситься.
        let broken_rego = "package ga.broken\ndeny contains msg if { msg := \"x\"";
        let result = eval_deny_rule(broken_rego, "ga.broken", "{}", "{}");
        let Err((stage, err)) = result else {
            panic!("зламаний rego мав дати Err, отримано {result:?}");
        };
        assert_eq!(stage, "compile");
        assert!(!err.is_empty());
    }

    #[test]
    fn eval_deny_rule_reports_set_input_stage_error_for_malformed_input_json() {
        let ok_rego = "package ga.ok\ndeny contains msg if { msg := \"x\" }";
        let result = eval_deny_rule(ok_rego, "ga.ok", "{}", "not-json");
        let Err((stage, err)) = result else {
            panic!("побитий input_json мав дати Err, отримано {result:?}");
        };
        assert_eq!(stage, "set_input");
        assert!(!err.is_empty());
    }

    #[test]
    fn eval_deny_rule_reports_eval_stage_error_for_namespace_mismatch() {
        // `namespace`, переданий викликачем, не збігається з `package`
        // усередині policy — `data.ga.wrong.deny` не існує (регорус: "not a
        // valid rule path", доккомент [`eval_deny_rule`]).
        let rego = "package ga.actual\ndeny contains msg if { msg := \"x\" }";
        let result = eval_deny_rule(rego, "ga.wrong", "{}", "{}");
        let Err((stage, err)) = result else {
            panic!("розбіжність namespace мала дати Err, отримано {result:?}");
        };
        assert_eq!(stage, "eval");
        assert!(!err.is_empty());
    }

    #[test]
    fn broken_policy_produces_visible_diagnostic_not_silence() {
        // Пряме порівняння СТАРОЇ (до правки 1) і НОВОЇ поведінки на ОДНІЙ і
        // тій самій зламаній policy — доводить сáме твердження задачі: там,
        // де стара гілка (`if let Ok(messages) = eval_deny_rule(...) { … }`,
        // без `else`) мовчки ковтала Err, нова (`match … Err((stage, err)) =>
        // push_rego_engine_error(...)`) дає РІВНО одну діагностику.
        let broken_rego = "package ga.broken\ndeny contains msg if { msg := \"x\"";
        let namespace = "ga.broken";
        let workflow_path = ".github/workflows/broken.yml";
        let result = eval_deny_rule(broken_rego, namespace, "{}", "{}");

        // СТАРА поведінка, відтворена буквально (звіт задачі, «правка 1»):
        // `if let Ok(messages) = eval_deny_rule(...) { push violations }` —
        // жодної гілки на `Err`, тож `Err` просто випадає в нікуди.
        let mut old_style_diagnostics: Vec<Diagnostic> = Vec::new();
        if let Ok(messages) = &result {
            for msg in messages {
                push_rego_violation(&mut old_style_diagnostics, workflow_path, msg);
            }
        }
        assert!(
            old_style_diagnostics.is_empty(),
            "стара гілка мовчки ковтає зламаний rego — саме це й є fail-open баг"
        );

        // НОВА поведінка (правка 1) — той самий `result`, але через
        // актуальний `match`, що тепер стоїть у [`run_all_ga_rego`].
        let mut new_diagnostics: Vec<Diagnostic> = Vec::new();
        match result {
            Ok(messages) => {
                for msg in messages {
                    push_rego_violation(&mut new_diagnostics, workflow_path, &msg);
                }
            }
            Err((stage, err)) => {
                push_rego_engine_error(
                    &mut new_diagnostics,
                    Some(workflow_path),
                    namespace,
                    stage,
                    &err,
                );
            }
        }
        assert_eq!(
            new_diagnostics.len(),
            1,
            "зламана policy має дати РІВНО одну видиму діагностику, не тишу"
        );
        assert_eq!(new_diagnostics[0].reason, REGO_ENGINE_ERROR_REASON);
        assert_eq!(new_diagnostics[0].file.as_deref(), Some(workflow_path));
        assert_eq!(new_diagnostics[0].severity, Severity::Error);
        assert!(new_diagnostics[0].message.contains(namespace));
        assert!(new_diagnostics[0].message.contains("compile"));
    }

    #[test]
    fn push_rego_engine_error_batch_level_has_no_file() {
        // `build_workflow_common_engine`-провал (доккомент
        // [`push_rego_engine_error`]) — batch-рівень, `file: None`.
        let mut d = Vec::new();
        push_rego_engine_error(&mut d, None, "ga.workflow_common", "compile", "boom");
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].reason, REGO_ENGINE_ERROR_REASON);
        assert!(d[0].file.is_none());
        assert!(d[0].message.contains(".github/workflows"));
        assert!(d[0].message.contains("ga.workflow_common"));
        assert!(d[0].message.contains("boom"));
        assert_eq!(
            d[0].data.as_deref(),
            Some("{\"kind\":\"rego-engine-error\",\"namespace\":\"ga.workflow_common\",\"stage\":\"compile\"}")
        );
    }

    // =====================================================================
    // `ga/workflows` — guest-фікс (перший портований T0-план цього гостя,
    // доккомент модуля, розділ «`ga/workflows` — Т0-фіксер ПОРТОВАНО»).
    // Фікстури нижче — точні відповідники `fix-workflows.test.mjs`.
    // =====================================================================

    // --- prefix_bunx_n_command ---

    #[test]
    fn prefix_bunx_n_command_rewrites_inline_run() {
        let src = "      - name: lint\n        run: n-rules lint text --no-fix\n";
        let out = prefix_bunx_n_command(src).expect("має змінитись");
        assert!(out.contains("run: bunx n-rules lint text --no-fix"));
    }

    #[test]
    fn prefix_bunx_n_command_rewrites_bare_line_in_run_block() {
        let src = "        run: |\n          n-rules lint ga --no-fix\n";
        let out = prefix_bunx_n_command(src).expect("має змінитись");
        assert!(out.contains("          bunx n-rules lint ga --no-fix"));
    }

    #[test]
    fn prefix_bunx_n_command_already_wrapped_is_none() {
        assert!(prefix_bunx_n_command("        run: bunx n-rules release\n").is_none());
        assert!(prefix_bunx_n_command("        run: npx n-rules lint\n").is_none());
    }

    #[test]
    fn prefix_bunx_n_command_without_n_rules_is_none() {
        assert!(prefix_bunx_n_command("        run: echo hi\n").is_none());
    }

    /// T0-раунд-трип ВСЕРЕДИНІ гостя для `bare-n-rules` (доповнює
    /// `wasm-plugin-parity-ci-github.test.mjs`'s гість-детект → JS-фікс →
    /// гість-детект чисто цикл доказом, що гість-детект → гість-фікс →
    /// гість-детект теж замикається чисто, той самий прийом, що
    /// `fix_cargo_mutants_config_round_trip_with_detect_is_clean`,
    /// `crates/plugin-lang-rust`): [`verify_no_bare_n_cursor`] — реальний
    /// detect-шлях цього reason-а, БЕЗ host-імпортів (той самий контракт,
    /// що тести `verify_no_bare_n_cursor_*` вище).
    #[test]
    fn prefix_bunx_n_command_round_trip_with_detect_is_clean() {
        let before = "        run: n-rules lint ga --no-fix\n";
        let mut diagnostics_before = Vec::new();
        verify_no_bare_n_cursor(&mut diagnostics_before, "wf.yml", before);
        assert_eq!(diagnostics_before.len(), 1);
        assert_eq!(diagnostics_before[0].reason, WORKFLOWS_BARE_NCURSOR_REASON);

        let after = prefix_bunx_n_command(before).expect("має змінитись");
        let mut diagnostics_after = Vec::new();
        verify_no_bare_n_cursor(&mut diagnostics_after, "wf.yml", &after);
        assert!(diagnostics_after.is_empty());
    }

    // --- add_persist_credentials ---

    #[test]
    fn add_persist_credentials_creates_with_block_when_missing() {
        let src = "jobs:\n  main:\n    steps:\n      - uses: actions/checkout@v6\n";
        let out = add_persist_credentials(src).expect("має змінитись");
        assert_eq!(
            out,
            "jobs:\n  main:\n    steps:\n      - uses: actions/checkout@v6\n        with:\n          persist-credentials: false\n"
        );
    }

    #[test]
    fn add_persist_credentials_appends_key_into_existing_with_block() {
        let src = "      - name: Checkout\n        uses: actions/checkout@v6\n        with:\n          fetch-depth: 0 # коментар\n";
        let out = add_persist_credentials(src).expect("має змінитись");
        assert!(out.contains(
            "        with:\n          persist-credentials: false\n          fetch-depth: 0 # коментар"
        ));
        // не додав другий with:
        assert_eq!(out.matches("with:").count(), 1);
    }

    #[test]
    fn add_persist_credentials_already_present_is_none() {
        let src =
            "      - uses: actions/checkout@v6\n        with:\n          persist-credentials: false\n";
        assert!(add_persist_credentials(src).is_none());
    }

    #[test]
    fn add_persist_credentials_fixes_all_checkout_steps() {
        let src =
            "      - uses: actions/checkout@v6\n      - run: echo a\n      - uses: actions/checkout@v6\n";
        let out = add_persist_credentials(src).expect("має змінитись");
        assert_eq!(out.matches("persist-credentials: false").count(), 2);
    }

    #[test]
    fn add_persist_credentials_ignores_non_checkout_uses() {
        assert!(add_persist_credentials("      - uses: actions/setup-node@v4\n").is_none());
    }

    /// T0-раунд-трип ВСЕРЕДИНІ гостя для `checkout-persist-credentials` —
    /// той самий прийом, що [`prefix_bunx_n_command_round_trip_with_detect_is_clean`]:
    /// [`run_all_ga_rego`] — реальний detect-шлях цього reason-а (regorus,
    /// БЕЗ host-імпортів, той самий контракт, що
    /// [`run_all_ga_rego_workflow_common_flags_checkout_without_persist_credentials`]
    /// вище).
    #[test]
    fn add_persist_credentials_round_trip_with_rego_detect_is_clean() {
        let before = sfw(
            ".github/workflows/other.yml",
            "name: Sample\non:\n  push:\n    branches: [main]\nconcurrency:\n  group: ${{ github.ref }}-${{ github.workflow }}\n  cancel-in-progress: true\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n",
        );
        let mut diagnostics_before = Vec::new();
        run_all_ga_rego(&mut diagnostics_before, &[&before], &[&before]);
        assert_eq!(diagnostics_before.len(), 1);
        assert_eq!(
            diagnostics_before[0].reason,
            WORKFLOWS_CHECKOUT_PERSIST_REASON
        );

        let fixed_content = add_persist_credentials(&before.content).expect("має змінитись");
        let after = sfw(&before.path, &fixed_content);
        let mut diagnostics_after = Vec::new();
        run_all_ga_rego(&mut diagnostics_after, &[&after], &[&after]);
        assert!(diagnostics_after.is_empty());
    }

    // --- remove_paths_globs ---

    const WORKFLOWS_PATHS_GLOBS_FIXTURE: &str = "on:\n  push:\n    paths:\n      - '**/*.php'\n      - 'composer.json'\n      - 'composer.lock'\n      - 'psalm.xml'\n  pull_request:\n    paths:\n      - 'composer.lock'\n      - 'psalm.xml'\njobs: {}\n";

    #[test]
    fn remove_paths_globs_removes_only_listed_values_in_both_blocks() {
        let globs = vec!["composer.lock".to_string(), "psalm.xml".to_string()];
        let out = remove_paths_globs(WORKFLOWS_PATHS_GLOBS_FIXTURE, &globs).expect("має змінитись");
        assert!(!out.contains("composer.lock"));
        assert!(!out.contains("psalm.xml"));
        assert!(out.contains("**/*.php"));
        assert!(out.contains("composer.json"));
    }

    #[test]
    fn remove_paths_globs_ignores_values_outside_paths_block() {
        let src = "env:\n  X: 'composer.lock'\non:\n  push:\n    paths:\n      - 'composer.lock'\njobs: {}\n";
        let globs = vec!["composer.lock".to_string()];
        let out = remove_paths_globs(src, &globs).expect("має змінитись");
        assert!(out.contains("X: 'composer.lock'"));
        assert_eq!(out.matches("composer.lock").count(), 1);
    }

    #[test]
    fn remove_paths_globs_no_match_is_none() {
        let globs = vec!["nope.toml".to_string()];
        assert!(remove_paths_globs(WORKFLOWS_PATHS_GLOBS_FIXTURE, &globs).is_none());
    }

    // --- json_string_field ---

    #[test]
    fn json_string_field_reads_plain_value() {
        assert_eq!(
            json_string_field(
                "{\"kind\":\"unmatched-paths-glob\",\"glob\":\"**/*.php\"}",
                "glob"
            )
            .as_deref(),
            Some("**/*.php")
        );
    }

    #[test]
    fn json_string_field_unescapes_quotes_and_backslashes() {
        assert_eq!(
            json_string_field("{\"glob\":\"a\\\"b\\\\c\"}", "glob").as_deref(),
            Some("a\"b\\c")
        );
    }

    #[test]
    fn json_string_field_missing_field_is_none() {
        assert!(json_string_field("{\"kind\":\"bare-n-rules\"}", "glob").is_none());
    }

    // --- fix_workflows: guest FixRequest → FixPlan ---

    #[test]
    fn fix_workflows_persist_credentials_writes_edit() {
        let rel = "wf.yml";
        let request = FixRequest {
            concern_id: CONCERN_WORKFLOWS.to_string(),
            files: vec![sf(rel, "      - uses: actions/checkout@v6\n")],
            diagnostics: vec![Diagnostic {
                reason: WORKFLOWS_CHECKOUT_PERSIST_REASON.to_string(),
                message: "x".to_string(),
                file: Some(rel.to_string()),
                severity: Severity::Error,
                data: Some("{\"kind\":\"checkout-persist-credentials\"}".to_string()),
            }],
        };
        let plan = fix_workflows(&request);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікували write-edit")
        };
        assert_eq!(write.path, rel);
        assert!(write.content.contains("persist-credentials: false"));
    }

    #[test]
    fn fix_workflows_unmatched_paths_glob_removes_only_addressed_glob() {
        let rel = "lint-php.yml";
        let content =
            "on:\n  push:\n    paths:\n      - 'psalm.xml'\n      - '**/*.php'\njobs: {}\n";
        let request = FixRequest {
            concern_id: CONCERN_WORKFLOWS.to_string(),
            files: vec![sf(rel, content)],
            diagnostics: vec![Diagnostic {
                reason: WORKFLOWS_UNMATCHED_PATHS_GLOB_REASON.to_string(),
                message: "x".to_string(),
                file: Some(rel.to_string()),
                severity: Severity::Error,
                data: Some(
                    "{\"kind\":\"unmatched-paths-glob\",\"event\":\"push\",\"glob\":\"psalm.xml\"}"
                        .to_string(),
                ),
            }],
        };
        let plan = fix_workflows(&request);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікували write-edit")
        };
        assert!(!write.content.contains("psalm.xml"));
        assert!(write.content.contains("**/*.php"));
    }

    #[test]
    fn fix_workflows_bare_n_rules_writes_edit() {
        let rel = "wf.yml";
        let request = FixRequest {
            concern_id: CONCERN_WORKFLOWS.to_string(),
            files: vec![sf(rel, "        run: n-rules lint ga --no-fix\n")],
            diagnostics: vec![Diagnostic {
                reason: WORKFLOWS_BARE_NCURSOR_REASON.to_string(),
                message: "x".to_string(),
                file: Some(rel.to_string()),
                severity: Severity::Error,
                data: Some("{\"kind\":\"bare-n-rules\"}".to_string()),
            }],
        };
        let plan = fix_workflows(&request);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікували write-edit")
        };
        assert!(write.content.contains("bunx n-rules lint ga --no-fix"));
    }

    #[test]
    fn fix_workflows_ignores_foreign_reason() {
        let request = FixRequest {
            concern_id: CONCERN_WORKFLOWS.to_string(),
            files: vec![sf("wf.yml", "jobs: {}\n")],
            diagnostics: vec![Diagnostic {
                reason: "other".to_string(),
                message: "x".to_string(),
                file: Some("wf.yml".to_string()),
                severity: Severity::Error,
                data: None,
            }],
        };
        assert!(fix_workflows(&request).edits.is_empty());
    }

    #[test]
    fn fix_workflows_returns_empty_plan_without_diagnostics() {
        let request = FixRequest {
            concern_id: CONCERN_WORKFLOWS.to_string(),
            files: vec![sf("wf.yml", "      - uses: actions/checkout@v6\n")],
            diagnostics: vec![],
        };
        assert!(fix_workflows(&request).edits.is_empty());
    }

    #[test]
    fn fix_workflows_composes_all_three_transforms_on_one_file() {
        // Один файл, три різні kind-и одночасно — [`fix_workflows`] мусить
        // застосувати ВСІ три трансформери на ОДНОМУ буфері (доккомент
        // розділу «`ga/workflows` — Т0-фіксер ПОРТОВАНО»), не лише перший
        // ("гість-пріоритет" ЗАМІНЯЄ всі три JS-патерни одним викликом).
        let rel = "wf.yml";
        let content = "on:\n  push:\n    paths:\n      - 'psalm.xml'\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v6\n      - run: n-rules lint ga --no-fix\n";
        let request = FixRequest {
            concern_id: CONCERN_WORKFLOWS.to_string(),
            files: vec![sf(rel, content)],
            diagnostics: vec![
                Diagnostic {
                    reason: WORKFLOWS_CHECKOUT_PERSIST_REASON.to_string(),
                    message: "x".to_string(),
                    file: Some(rel.to_string()),
                    severity: Severity::Error,
                    data: Some("{\"kind\":\"checkout-persist-credentials\"}".to_string()),
                },
                Diagnostic {
                    reason: WORKFLOWS_UNMATCHED_PATHS_GLOB_REASON.to_string(),
                    message: "y".to_string(),
                    file: Some(rel.to_string()),
                    severity: Severity::Error,
                    data: Some(
                        "{\"kind\":\"unmatched-paths-glob\",\"event\":\"push\",\"glob\":\"psalm.xml\"}"
                            .to_string(),
                    ),
                },
                Diagnostic {
                    reason: WORKFLOWS_BARE_NCURSOR_REASON.to_string(),
                    message: "z".to_string(),
                    file: Some(rel.to_string()),
                    severity: Severity::Error,
                    data: Some("{\"kind\":\"bare-n-rules\"}".to_string()),
                },
            ],
        };
        let plan = fix_workflows(&request);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(write) = &plan.edits[0] else {
            panic!("очікували write-edit")
        };
        assert!(write.content.contains("persist-credentials: false"));
        assert!(!write.content.contains("psalm.xml"));
        assert!(write.content.contains("bunx n-rules lint ga --no-fix"));
    }

    // =====================================================================
    // ТРЕТЯ хвиля — характеризаційні й round-trip тести трьох policy-концернів
    // (доккомент модуля, розділ «ТРЕТЯ хвиля»). Жоден із трьох НЕ мав власних
    // JS fix-тестів у `plugins/ci-github/rules/**` (лише `.rego`-conftest
    // тести й `main.test.mjs` на detect-боці) — ці тести замінюють
    // характеризаційний гейт задачі: `file відсутній`/`file є з локальними
    // полями`/`file вже канонічний`/`побитий JSON`.
    // =====================================================================

    fn fix_req(concern: &str, files: Vec<SourceFile>, diagnostics: Vec<Diagnostic>) -> FixRequest {
        FixRequest {
            concern_id: concern.to_string(),
            files,
            diagnostics,
        }
    }

    // --- `ga/vscode_extensions` ---

    #[test]
    fn detect_vscode_extensions_missing_file() {
        let diags = detect_policy(&[], &VSCODE_EXTENSIONS_CFG);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].reason, POLICY_FILE_MISSING_REASON);
        assert_eq!(diags[0].file.as_deref(), Some(".vscode/extensions.json"));
        assert!(diags[0].message.contains("github.vscode-github-actions"));
    }

    #[test]
    fn detect_vscode_extensions_already_canonical_is_clean() {
        let files = vec![sf(
            ".vscode/extensions.json",
            r#"{"recommendations":["github.vscode-github-actions","local.ext"]}"#,
        )];
        assert!(detect_policy(&files, &VSCODE_EXTENSIONS_CFG).is_empty());
    }

    #[test]
    fn detect_vscode_extensions_missing_recommendation_is_deny() {
        let files = vec![sf(".vscode/extensions.json", r#"{"recommendations":[]}"#)];
        let diags = detect_policy(&files, &VSCODE_EXTENSIONS_CFG);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].reason, POLICY_DENY_REASON);
        assert!(diags[0].message.contains("github.vscode-github-actions"));
    }

    #[test]
    fn detect_vscode_extensions_broken_json_is_input_invalid() {
        let files = vec![sf(".vscode/extensions.json", "{ not valid json")];
        let diags = detect_policy(&files, &VSCODE_EXTENSIONS_CFG);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].reason, POLICY_INPUT_INVALID_REASON);
    }

    #[test]
    fn fix_vscode_extensions_no_diagnostics_is_noop() {
        let req = fix_req(CONCERN_VSCODE_EXTENSIONS, vec![], vec![]);
        assert!(fix_vscode_extensions(&req).edits.is_empty());
    }

    #[test]
    fn fix_vscode_extensions_missing_file_creates_recommendations_only() {
        let diags = detect_policy(&[], &VSCODE_EXTENSIONS_CFG);
        let req = fix_req(CONCERN_VSCODE_EXTENSIONS, vec![], diags);
        let plan = fix_vscode_extensions(&req);
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        assert_eq!(w.path, ".vscode/extensions.json");
        assert!(w.content.contains("github.vscode-github-actions"));
        let parsed = parse_yaml_document(&w.content).expect("валідний JSON");
        assert_eq!(
            parsed
                .get("recommendations")
                .and_then(Json::as_array)
                .map(<[Json]>::len),
            Some(1)
        );
    }

    #[test]
    fn fix_vscode_extensions_preserves_local_fields_and_local_recommendations() {
        let files = vec![sf(
            ".vscode/extensions.json",
            r#"{"unwantedRecommendations":["foo.bar"],"recommendations":["local.ext"]}"#,
        )];
        let diags = detect_policy(&files, &VSCODE_EXTENSIONS_CFG);
        assert_eq!(diags.len(), 1); // канонічної рекомендації бракує
        let plan = fix_vscode_extensions(&fix_req(CONCERN_VSCODE_EXTENSIONS, files, diags));
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        let parsed = parse_yaml_document(&w.content).expect("валідний JSON");
        assert!(parsed.get("unwantedRecommendations").is_some());
        let recs: Vec<&str> = parsed
            .get("recommendations")
            .and_then(Json::as_array)
            .unwrap()
            .iter()
            .filter_map(Json::as_str)
            .collect();
        assert!(recs.contains(&"local.ext"));
        assert!(recs.contains(&"github.vscode-github-actions"));
    }

    #[test]
    fn fix_vscode_extensions_broken_json_target_is_noop() {
        let files = vec![sf(".vscode/extensions.json", "{ not valid json")];
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/extensions.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_vscode_extensions(&fix_req(CONCERN_VSCODE_EXTENSIONS, files, diags));
        assert!(plan.edits.is_empty());
    }

    /// Ціль задачі §2.5x (JSONC-хвиля — доккомент розділу «Хірургічний
    /// JSONC comment-preserving merge»): [`fix_vscode_extensions`] — той
    /// самий простіший union-merge рушій, що канонічний `vscode-ext-add.mjs`
    /// (ЗАВЖДИ повна регенерація через `JSON.stringify`, доккомент функції —
    /// НЕ хірургічний, на відміну від [`fix_template_merge`]), тож коментар
    /// тут ЧЕСНО НЕ переживає запис (той самий контракт, що канон: канон
    /// теж губить будь-яке форматування при `JSON.stringify(parsed, null, 2)`,
    /// коментарів там нема НАВІТЬ для plain-JSON входу). Ціль ЦЬОГО тесту —
    /// не байт-у-байт коментар, а що floor «не строгий JSON → не чіпаємо»
    /// замінений на РЕАЛЬНЕ читання: локальний запис і нове канонічне
    /// розширення обидва присутні в результаті (дані НЕ втрачені), і
    /// повторний детект чистий.
    #[test]
    fn fix_vscode_extensions_jsonc_leading_comment_merges_without_data_loss() {
        let files = vec![sf(
            ".vscode/extensions.json",
            "{\n  // локальний коментар\n  \"recommendations\": [\"local.ext\"]\n}\n",
        )];
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/extensions.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_vscode_extensions(&fix_req(CONCERN_VSCODE_EXTENSIONS, files, diags));
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        assert!(w.content.contains("local.ext"), "локальний запис мусить вижити");
        assert!(w.content.contains("github.vscode-github-actions"));
        let after = vec![sf(".vscode/extensions.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_EXTENSIONS_CFG).is_empty());
    }

    /// Симетричний випадок — хвостовий `//`-коментар на рядку значення
    /// (`"key": 1 // comment`, теж поширений JSONC-стиль VS Code); той самий
    /// контракт «дані не втрачені», що тест вище.
    #[test]
    fn fix_vscode_extensions_jsonc_trailing_comment_merges_without_data_loss() {
        let files = vec![sf(
            ".vscode/extensions.json",
            "{\n  \"recommendations\": [\"local.ext\"] // хвостовий коментар\n}\n",
        )];
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/extensions.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_vscode_extensions(&fix_req(CONCERN_VSCODE_EXTENSIONS, files, diags));
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        assert!(w.content.contains("local.ext"));
        assert!(w.content.contains("github.vscode-github-actions"));
        let after = vec![sf(".vscode/extensions.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_EXTENSIONS_CFG).is_empty());
    }

    #[test]
    fn vscode_extensions_t0_round_trip_missing_file_is_clean() {
        let diags_before = detect_policy(&[], &VSCODE_EXTENSIONS_CFG);
        assert_eq!(diags_before[0].reason, POLICY_FILE_MISSING_REASON);
        let plan = fix_vscode_extensions(&fix_req(CONCERN_VSCODE_EXTENSIONS, vec![], diags_before));
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        let after = vec![sf(".vscode/extensions.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_EXTENSIONS_CFG).is_empty());
    }

    #[test]
    fn vscode_extensions_t0_round_trip_local_fields_preserved_is_clean() {
        let before = vec![sf(
            ".vscode/extensions.json",
            r#"{"recommendations":["local.ext"]}"#,
        )];
        let diags_before = detect_policy(&before, &VSCODE_EXTENSIONS_CFG);
        assert_eq!(diags_before.len(), 1);
        let plan = fix_vscode_extensions(&fix_req(CONCERN_VSCODE_EXTENSIONS, before, diags_before));
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        let after = vec![sf(".vscode/extensions.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_EXTENSIONS_CFG).is_empty());
        assert!(w.content.contains("local.ext"));
    }

    // --- `ga/vscode_settings` (template-deep-merge, JSON-таргет) ---

    #[test]
    fn detect_vscode_settings_missing_file() {
        let diags = detect_policy(&[], &VSCODE_SETTINGS_CFG);
        assert_eq!(diags[0].reason, POLICY_FILE_MISSING_REASON);
        assert!(diags[0].message.contains("editor.defaultFormatter"));
    }

    #[test]
    fn fix_vscode_settings_missing_file_copies_snippet_verbatim() {
        let diags = detect_policy(&[], &VSCODE_SETTINGS_CFG);
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, vec![], diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        assert_eq!(w.content, VSCODE_SETTINGS_CFG.snippet_raw);
    }

    #[test]
    fn fix_vscode_settings_preserves_local_keys_and_adds_canonical() {
        let files = vec![sf(
            ".vscode/settings.json",
            r#"{"[github-actions-workflow]":{"local.key":true},"editor.tabSize":2}"#,
        )];
        let diags = detect_policy(&files, &VSCODE_SETTINGS_CFG);
        assert_eq!(diags.len(), 1);
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        let parsed = parse_yaml_document(&w.content).expect("валідний JSON");
        assert_eq!(parsed.get("editor.tabSize"), Some(&Json::Int(2)));
        let block = parsed.get("[github-actions-workflow]").expect("блок є");
        assert_eq!(block.get("local.key"), Some(&Json::Bool(true)));
        assert_eq!(
            block.get("editor.defaultFormatter").and_then(Json::as_str),
            Some("oxc.oxc-vscode")
        );
    }

    /// Критерій приймання §2.5x (розширення обсягу власником репозиторію —
    /// доккомент [`try_surgical_merge`]): не лише «повторний детект чистий»,
    /// а й «усі рядки поза вставленою ділянкою — байт-у-байт оригінал».
    /// Наявний `.vscode/settings.json` уже має ДВА локальні ключі (один —
    /// сестра-обʼєкт [`[github-actions-workflow]`] з локальним підключем,
    /// інший — незалежний `editor.tabSize`) з НЕстандартним 4-пробільним
    /// відступом і незвичним порядком ключів — жоден із цих деталей
    /// форматування не входить у snippet, тож старий шлях
    /// ([`json_to_pretty_string`] над [`merge_json_value`]) регенерував би
    /// ввесь файл 2-пробільним canonical-стилем, знищуючи їх. Перевіряємо
    /// буквально: недоторкані рядки — той самий текст, що на вході.
    #[test]
    fn fix_vscode_settings_surgical_merge_preserves_formatting_byte_identical() {
        let before = concat!(
            "{\n",
            "    \"editor.tabSize\": 4,\n",
            "    \"[github-actions-workflow]\": {\n",
            "        \"local.key\": true\n",
            "    }\n",
            "}\n"
        );
        let files = vec![sf(".vscode/settings.json", before)];
        let diags = detect_policy(&files, &VSCODE_SETTINGS_CFG);
        assert_eq!(diags.len(), 1);
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        // Точний очікуваний вміст — не лише "detect чистий": усі три
        // наявні рядки (відкриваюча дужка, `editor.tabSize`, вкладений
        // `local.key`) лишаються байт-у-байт, лише кома дописана після
        // `true` і новий канонічний ключ вставлений усередину того самого
        // вкладеного блоку, ПЕРЕД його закриваючою `}`.
        let expected = concat!(
            "{\n",
            "    \"editor.tabSize\": 4,\n",
            "    \"[github-actions-workflow]\": {\n",
            "        \"local.key\": true,\n",
            "        \"editor.defaultFormatter\": \"oxc.oxc-vscode\"\n",
            "    }\n",
            "}\n"
        );
        assert_eq!(w.content, expected);
        let after = vec![sf(".vscode/settings.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_SETTINGS_CFG).is_empty());
    }

    #[test]
    fn fix_vscode_settings_broken_json_target_is_noop() {
        let files = vec![sf(".vscode/settings.json", "{ broken")];
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/settings.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        assert!(plan.edits.is_empty());
    }

    /// РІВНО фікстура незалежного ревʼю PR #528 (звіт задачі §2.58,
    /// поправка) — ТЕПЕР ціль задачі §2.5x (JSONC-хвиля): `.vscode/settings.json`
    /// з JSONC `//`-коментарем ПЕРЕД ключем. `[github-actions-workflow]`
    /// цілком відсутній у наявному файлі → один [`Edit::Insert`] одразу
    /// ПІСЛЯ останнього наявного запису (`my.local`) — точний очікуваний
    /// вміст, не лише «detect чистий»: коментар і ОБИДВА локальних
    /// налаштування (`editor.formatOnSave`, `my.local`) лишаються
    /// байт-у-байт, кома дописана рівно один раз.
    #[test]
    fn fix_vscode_settings_jsonc_leading_comment_merges_and_preserves_comment_byte_identical() {
        let before = concat!(
            "{\n",
            "  // коментар перед ключем\n",
            "  \"editor.formatOnSave\": true,\n",
            "  \"my.local\": 42\n",
            "}\n"
        );
        let files = vec![sf(".vscode/settings.json", before)];
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/settings.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write, отримано: {:?}", plan.edits)
        };
        let expected = concat!(
            "{\n",
            "  // коментар перед ключем\n",
            "  \"editor.formatOnSave\": true,\n",
            "  \"my.local\": 42,\n",
            "  \"[github-actions-workflow]\": {\n",
            "    \"editor.defaultFormatter\": \"oxc.oxc-vscode\"\n",
            "  }\n",
            "}\n"
        );
        assert_eq!(w.content, expected);
        let after = vec![sf(".vscode/settings.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_SETTINGS_CFG).is_empty());
    }

    /// Симетричний випадок — хвостовий `//`-коментар на рядку значення.
    #[test]
    fn fix_vscode_settings_jsonc_trailing_comment_merges_and_preserves_comment_byte_identical() {
        let before = concat!(
            "{\n",
            "  \"editor.formatOnSave\": true, // хвостовий коментар\n",
            "  \"my.local\": 42\n",
            "}\n"
        );
        let files = vec![sf(".vscode/settings.json", before)];
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/settings.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write, отримано: {:?}", plan.edits)
        };
        let expected = concat!(
            "{\n",
            "  \"editor.formatOnSave\": true, // хвостовий коментар\n",
            "  \"my.local\": 42,\n",
            "  \"[github-actions-workflow]\": {\n",
            "    \"editor.defaultFormatter\": \"oxc.oxc-vscode\"\n",
            "  }\n",
            "}\n"
        );
        assert_eq!(w.content, expected);
        let after = vec![sf(".vscode/settings.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_SETTINGS_CFG).is_empty());
    }

    /// Блоковий `/* … */`-коментар (третя фікстура брифу задачі, поряд із
    /// `//`-лінійним) — той самий контракт: коментар вижив байт-у-байт,
    /// merge відбувся.
    #[test]
    fn fix_vscode_settings_jsonc_block_comment_merges_and_preserves_comment_byte_identical() {
        let before = concat!(
            "{\n",
            "  /* блоковий коментар */\n",
            "  \"editor.formatOnSave\": true,\n",
            "  \"my.local\": 42\n",
            "}\n"
        );
        let files = vec![sf(".vscode/settings.json", before)];
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/settings.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write, отримано: {:?}", plan.edits)
        };
        let expected = concat!(
            "{\n",
            "  /* блоковий коментар */\n",
            "  \"editor.formatOnSave\": true,\n",
            "  \"my.local\": 42,\n",
            "  \"[github-actions-workflow]\": {\n",
            "    \"editor.defaultFormatter\": \"oxc.oxc-vscode\"\n",
            "  }\n",
            "}\n"
        );
        assert_eq!(w.content, expected);
        let after = vec![sf(".vscode/settings.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_SETTINGS_CFG).is_empty());
    }

    /// Trailing-кома вже присутня ПЕРЕД точкою вставки (`\"my.local\": 42,`) —
    /// четверта фікстура брифу задачі: [`already_has_trailing_comma`] мусить
    /// розпізнати наявну кому й НЕ дописати другу (подвійна кома —
    /// синтаксично невалідний JSON, доккомент функції). Очікуваний вивід —
    /// БУКВАЛЬНО той самий, що без trailing-коми на вході (existing кома
    /// стає роздільником замість synthетичної).
    #[test]
    fn fix_vscode_settings_jsonc_trailing_comma_merges_without_double_comma() {
        let before = concat!(
            "{\n",
            "  \"editor.formatOnSave\": true,\n",
            "  \"my.local\": 42,\n",
            "}\n"
        );
        let files = vec![sf(".vscode/settings.json", before)];
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/settings.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write, отримано: {:?}", plan.edits)
        };
        let expected = concat!(
            "{\n",
            "  \"editor.formatOnSave\": true,\n",
            "  \"my.local\": 42,\n",
            "  \"[github-actions-workflow]\": {\n",
            "    \"editor.defaultFormatter\": \"oxc.oxc-vscode\"\n",
            "  }\n",
            "}\n"
        );
        assert_eq!(
            w.content, expected,
            "подвійна кома чи зіпсований вивід — недопустимо; отримано:\n{}",
            w.content
        );
        let after = vec![sf(".vscode/settings.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_SETTINGS_CFG).is_empty());
    }

    /// Пʼята фікстура брифу задачі — ВКЛАДЕНИЙ обʼєкт, куди треба вставити
    /// ключ, і в ньому вже є коментар: `[github-actions-workflow]` наявний,
    /// але БЕЗ `editor.defaultFormatter`, а поряд із наявним `local.key` —
    /// власний коментар усередині ТОГО САМОГО вкладеного блоку. Вставка
    /// мусить приземлитись усередині вкладеного обʼєкта, ПІСЛЯ `local.key`,
    /// НЕ зачепивши коментар.
    #[test]
    fn fix_vscode_settings_jsonc_nested_object_with_comment_merges_byte_identical() {
        let before = concat!(
            "{\n",
            "  \"[github-actions-workflow]\": {\n",
            "    // локальний коментар усередині\n",
            "    \"local.key\": true\n",
            "  }\n",
            "}\n"
        );
        let files = vec![sf(".vscode/settings.json", before)];
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/settings.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write, отримано: {:?}", plan.edits)
        };
        let expected = concat!(
            "{\n",
            "  \"[github-actions-workflow]\": {\n",
            "    // локальний коментар усередині\n",
            "    \"local.key\": true,\n",
            "    \"editor.defaultFormatter\": \"oxc.oxc-vscode\"\n",
            "  }\n",
            "}\n"
        );
        assert_eq!(w.content, expected);
        let after = vec![sf(".vscode/settings.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_SETTINGS_CFG).is_empty());
    }

    /// Регрес-фіксатура брифу задачі — звичайний JSON БЕЗ коментарів не має
    /// зрегресувати після додавання JSONC-підтримки (той самий вхід/вихід,
    /// що [`fix_vscode_settings_surgical_merge_preserves_formatting_byte_identical`]
    /// вище, лише мінімальний варіант без нестандартного відступу — окрема
    /// фікстура НАВМИСНО, брифом задачі просив саме «звичайний JSON без
    /// коментарів» серед обовʼязкових фікстур).
    #[test]
    fn fix_vscode_settings_plain_json_no_comments_still_merges_no_regression() {
        let before = concat!("{\n", "  \"editor.formatOnSave\": true,\n", "  \"my.local\": 42\n", "}\n");
        let files = vec![sf(".vscode/settings.json", before)];
        let diags = vec![Diagnostic {
            reason: POLICY_DENY_REASON.to_string(),
            message: "x".to_string(),
            file: Some(".vscode/settings.json".to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, diags),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write, отримано: {:?}", plan.edits)
        };
        let expected = concat!(
            "{\n",
            "  \"editor.formatOnSave\": true,\n",
            "  \"my.local\": 42,\n",
            "  \"[github-actions-workflow]\": {\n",
            "    \"editor.defaultFormatter\": \"oxc.oxc-vscode\"\n",
            "  }\n",
            "}\n"
        );
        assert_eq!(w.content, expected);
        let after = vec![sf(".vscode/settings.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_SETTINGS_CFG).is_empty());
    }

    #[test]
    fn fix_vscode_settings_already_canonical_is_noop() {
        let files = vec![sf(".vscode/settings.json", VSCODE_SETTINGS_CFG.snippet_raw)];
        // Уже канонічний → detect чистий → fix не викликається продакшн-шляхом,
        // але й прямий виклик з порожніми diagnostics — no-op за контрактом.
        assert!(detect_policy(&files, &VSCODE_SETTINGS_CFG).is_empty());
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, files, vec![]),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn vscode_settings_t0_round_trip_missing_file_is_clean() {
        let diags_before = detect_policy(&[], &VSCODE_SETTINGS_CFG);
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, vec![], diags_before),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        let after = vec![sf(".vscode/settings.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_SETTINGS_CFG).is_empty());
    }

    #[test]
    fn vscode_settings_t0_round_trip_local_fields_preserved_is_clean() {
        let before = vec![sf(
            ".vscode/settings.json",
            r#"{"[github-actions-workflow]":{"local.key":true}}"#,
        )];
        let diags_before = detect_policy(&before, &VSCODE_SETTINGS_CFG);
        assert_eq!(diags_before.len(), 1);
        let plan = fix_template_merge(
            &fix_req(CONCERN_VSCODE_SETTINGS, before, diags_before),
            &VSCODE_SETTINGS_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        let after = vec![sf(".vscode/settings.json", &w.content)];
        assert!(detect_policy(&after, &VSCODE_SETTINGS_CFG).is_empty());
        assert!(w.content.contains("local.key"));
    }

    // --- `security/lint_security_yml` (template-deep-merge, YAML-таргет) ---

    #[test]
    fn detect_lint_security_yml_missing_file() {
        let diags = detect_policy(&[], &LINT_SECURITY_YML_CFG);
        assert_eq!(diags[0].reason, POLICY_FILE_MISSING_REASON);
    }

    #[test]
    fn detect_lint_security_yml_missing_trufflehog_step_is_deny() {
        let files = vec![sf(
            ".github/workflows/lint-security.yml",
            "on: push\njobs:\n  security:\n    steps:\n      - uses: actions/checkout@v6\n",
        )];
        let diags = detect_policy(&files, &LINT_SECURITY_YML_CFG);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].reason, POLICY_DENY_REASON);
        assert!(diags[0].message.contains("trufflesecurity/trufflehog@main"));
    }

    #[test]
    fn fix_lint_security_yml_missing_file_copies_snippet_verbatim() {
        let diags = detect_policy(&[], &LINT_SECURITY_YML_CFG);
        let plan = fix_template_merge(
            &fix_req(CONCERN_LINT_SECURITY_YML, vec![], diags),
            &LINT_SECURITY_YML_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        assert_eq!(w.content, LINT_SECURITY_YML_CFG.snippet_raw);
    }

    #[test]
    fn fix_lint_security_yml_broken_yaml_target_is_noop() {
        let files = vec![sf(
            ".github/workflows/lint-security.yml",
            "jobs: [ this is not: valid yaml :::",
        )];
        // Побитий YAML — parse_yaml_document дає None; detect дав би
        // policy-input-invalid, фікс тут викликається напряму з непорожнім
        // diagnostics-заглушкою, щоб перевірити branch без реального detect.
        let diags = vec![Diagnostic {
            reason: POLICY_INPUT_INVALID_REASON.to_string(),
            message: "x".to_string(),
            file: Some(LINT_SECURITY_YML_CFG.target_path.to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_LINT_SECURITY_YML, files, diags),
            &LINT_SECURITY_YML_FIX_CFG,
        );
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn lint_security_yml_t0_round_trip_missing_file_is_clean() {
        let diags_before = detect_policy(&[], &LINT_SECURITY_YML_CFG);
        let plan = fix_template_merge(
            &fix_req(CONCERN_LINT_SECURITY_YML, vec![], diags_before),
            &LINT_SECURITY_YML_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        let after = vec![sf(LINT_SECURITY_YML_CFG.target_path, &w.content)];
        assert!(detect_policy(&after, &LINT_SECURITY_YML_CFG).is_empty());
    }

    /// Найважливіший round-trip цього концерну: наявний workflow-файл з
    /// ЛОКАЛЬНИМ кроком (не з каноничного snippet-а) і БЕЗ trufflehog-кроку —
    /// fix має дописати канонічний крок, ЗБЕРІГШИ локальний, а повторний
    /// detect (через реальний [`eval_deny_rule`] на РЕГЕНЕРОВАНОМУ
    /// [`write_yaml_block`]-виводі) — чистий.
    #[test]
    fn lint_security_yml_t0_round_trip_local_step_preserved_is_clean() {
        let before = vec![sf(
            LINT_SECURITY_YML_CFG.target_path,
            "name: Lint Security\non:\n  push: {}\njobs:\n  security:\n    runs-on: ubuntu-latest\n    steps:\n      - name: local-step\n        run: echo hi\n",
        )];
        let diags_before = detect_policy(&before, &LINT_SECURITY_YML_CFG);
        assert_eq!(diags_before.len(), 1);
        let plan = fix_template_merge(
            &fix_req(CONCERN_LINT_SECURITY_YML, before, diags_before),
            &LINT_SECURITY_YML_FIX_CFG,
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        assert!(w.content.contains("local-step"));
        assert!(w.content.contains("trufflesecurity/trufflehog@main"));
        let after = vec![sf(LINT_SECURITY_YML_CFG.target_path, &w.content)];
        assert!(detect_policy(&after, &LINT_SECURITY_YML_CFG).is_empty());
    }

    /// Критерій приймання §2.5x (розширення обсягу — доккомент
    /// [`try_surgical_merge`]): фікстура з ДВОМА коментарями, кожен у своїй
    /// позиції з брифу задачі — (а) коментар УСЕРЕДИНІ блоку, який merge
    /// зачіпає (`# обмежуємо чутливість сканування` прямо перед
    /// `extra_args`, чиє значення відрізняється від snippet-а — leaf-replace
    /// зачіпає лише сам скаляр `--results=verified`, не сусідній
    /// коментар), і (б) коментар ОДРАЗУ ПЕРЕД точкою вставки (job-рівня
    /// `# дозволи мінімально необхідні для сканування` одразу після
    /// `steps:`, де відсутній ключ `permissions` вставляється — коментар не
    /// має бути зʼїдений вставкою). Перевіряємо не «detect чистий», а
    /// точний очікуваний вміст: усі наявні рядки — байт-у-байт, і обидва
    /// коментарі присутні на місці.
    #[test]
    fn fix_lint_security_yml_surgical_merge_preserves_comments_byte_identical() {
        let before = concat!(
            "name: Lint Security\n",
            "\n",
            "on:\n",
            "  push:\n",
            "    branches:\n",
            "      - dev\n",
            "      - main\n",
            "  pull_request:\n",
            "    branches:\n",
            "      - dev\n",
            "      - main\n",
            "\n",
            "concurrency:\n",
            "  group: ${{ github.ref }}-${{ github.workflow }}\n",
            "  cancel-in-progress: true\n",
            "\n",
            "jobs:\n",
            "  security:\n",
            "    runs-on: ubuntu-latest\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
            "        with:\n",
            "          persist-credentials: false\n",
            "          fetch-depth: 0\n",
            "      - uses: trufflesecurity/trufflehog@main\n",
            "        with:\n",
            "          # обмежуємо чутливість сканування\n",
            "          extra_args: --results=verified\n",
            "    # дозволи мінімально необхідні для сканування\n"
        );
        let files = vec![sf(LINT_SECURITY_YML_CFG.target_path, before)];
        // `security.lint_security_yml.rego` (доккомент над файлом) сигналить
        // лише про ПОВНІСТЮ відсутній `uses:`-крок — не про drift усередині
        // вже наявного (`extra_args`/`permissions`). Обидва `uses:` тут уже
        // присутні, тож живий `detect_policy` дав би порожній список і
        // `fix_template_merge` (гейт — лише непорожність `diagnostics`,
        // доккомент функції) не викликався б продакшн-шляхом — той самий
        // `POLICY_DENY_REASON`-заглушка, що `fix_lint_security_yml_broken_yaml_target_is_noop`
        // вище, щоб перевірити САМ merge-рушій напряму, а не межу detect-у.
        let diags = vec![Diagnostic {
            reason: POLICY_DENY_REASON.to_string(),
            message: "x".to_string(),
            file: Some(LINT_SECURITY_YML_CFG.target_path.to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_LINT_SECURITY_YML, files, diags),
            &LINT_SECURITY_YML_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        let expected = concat!(
            "name: Lint Security\n",
            "\n",
            "on:\n",
            "  push:\n",
            "    branches:\n",
            "      - dev\n",
            "      - main\n",
            "  pull_request:\n",
            "    branches:\n",
            "      - dev\n",
            "      - main\n",
            "\n",
            "concurrency:\n",
            "  group: ${{ github.ref }}-${{ github.workflow }}\n",
            "  cancel-in-progress: true\n",
            "\n",
            "jobs:\n",
            "  security:\n",
            "    runs-on: ubuntu-latest\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
            "        with:\n",
            "          persist-credentials: false\n",
            "          fetch-depth: 0\n",
            "      - uses: trufflesecurity/trufflehog@main\n",
            "        with:\n",
            "          # обмежуємо чутливість сканування\n",
            "          extra_args: \"--results=verified,unknown\"\n",
            "    \"permissions\":\n",
            "      \"contents\": \"read\"\n",
            "    # дозволи мінімально необхідні для сканування\n"
        );
        assert_eq!(w.content, expected);
        let after = vec![sf(LINT_SECURITY_YML_CFG.target_path, &w.content)];
        assert!(detect_policy(&after, &LINT_SECURITY_YML_CFG).is_empty());
    }

    /// Регрес-тест на баг, знайдений незалежним ревʼю PR #528 (звіт задачі
    /// §2.58): фікстура, де snippet-у бракує КІЛЬКОХ гілок дерева одразу —
    /// вставка в послідовність, де вже є елемент (`on.push.branches`),
    /// цілком відсутній сусідній ключ (`on.pull_request`), цілком відсутній
    /// кореневий ключ (`concurrency`), відсутній ключ усередині елемента
    /// масиву (`steps[0].with`) і відсутній ЦІЛИЙ елемент масиву
    /// (`steps[1]`, trufflehog). Кілька з цих вставок структурно
    /// «дном впираються» в ТУ САМУ найглибшу скалярну позицію документа
    /// (`uses: actions/checkout@v6` — останній реальний YAML-токен файлу,
    /// доккомент [`deepest_last_leaf_end`]) — перша версія
    /// [`apply_edits`] застосовувала прив'язані до однієї позиції правки в
    /// ПОМИЛКОВОМУ порядку (стабільне сортування залишало в'язки в порядку
    /// `push`, що на практиці ІНВЕРТувало вкладеність при застосуванні) і
    /// давала синтаксично НЕВАЛІДНИЙ YAML з дубльованими/неправильно
    /// вкладеними ключами. Виправлено: (а) [`apply_edits`] застосовує
    /// в'язки з однаковою `at` у порядку СПАДАННЯ `push`-індексу (найглибше
    /// `push`-нута правка застосовується ОСТАННЬОЮ й лишається найближче до
    /// якоря); (б) [`try_surgical_merge`] ДОДАТКОВО (незалежно від (а) —
    /// belt-and-suspenders, рішення власника: «валідність виводу не
    /// підлягає компромісу») повторно парсить результат і звіряє
    /// [`is_subset`] проти snippet-а ПЕРЕД тим, як його повернути — будь-яка
    /// розбіжність (синтаксична чи семантична) падає на стару повну
    /// регенерацію, а не віддає непідтверджений вивід. Цей тест перевіряє
    /// ОБИДВІ половини критерію приймання одночасно: валідний YAML (парситься)
    /// І чистий повторний детект (`is_subset`) — а не лише одну з них.
    #[test]
    fn fix_lint_security_yml_multi_insertion_produces_valid_reparseable_yaml() {
        let before = concat!(
            "# Верхній коментар файлу — мусить вижити\n",
            "name: Lint Security\n",
            "\n",
            "on:\n",
            "  # коментар усередині мапи\n",
            "  push:\n",
            "    branches:\n",
            "      - main # хвостовий коментар на елементі\n",
            "\n",
            "jobs:\n",
            "  security:\n",
            "    runs-on: ubuntu-latest\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
            "# нижній коментар наприкінці файлу\n"
        );
        let files = vec![sf(LINT_SECURITY_YML_CFG.target_path, before)];
        let diags = vec![Diagnostic {
            reason: POLICY_DENY_REASON.to_string(),
            message: "x".to_string(),
            file: Some(LINT_SECURITY_YML_CFG.target_path.to_string()),
            severity: Severity::Error,
            data: None,
        }];
        let plan = fix_template_merge(
            &fix_req(CONCERN_LINT_SECURITY_YML, files, diags),
            &LINT_SECURITY_YML_FIX_CFG,
        );
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("write")
        };
        // Критерій 1 — синтаксично валідний YAML (незалежно від того, чи
        // спрацював хірургічний шлях, чи fallback на повну регенерацію —
        // ОБИДВА зобовʼязані давати валідний результат).
        let reparsed = parse_yaml_document(&w.content)
            .unwrap_or_else(|| panic!("вивід має бути валідним YAML, отримано:\n{}", w.content));
        // Критерій 2 — повторний детект чистий (snippet — підмножина
        // записаного дерева).
        let snippet = parse_embedded_template("lint-security snippet", LINT_SECURITY_YML_CFG.snippet_raw);
        assert!(
            is_subset(Some(&reparsed), &snippet),
            "повторний детект має бути чистим, отримано:\n{}",
            w.content
        );
        // Критерій 3 (доккомент вище — байт-у-байт де застосовний) — усі
        // чотири коментарі з input-фікстури лишаються присутніми дослівно.
        assert!(w.content.contains("# Верхній коментар файлу — мусить вижити"));
        assert!(w.content.contains("# коментар усередині мапи"));
        assert!(w.content.contains("- main # хвостовий коментар на елементі"));
        assert!(w.content.contains("# нижній коментар наприкінці файлу"));
    }

    // --- Flow-стиль inline-вставка (§2.62 звузила межу §2.61 з «anchor/alias
    // І flow-стиль» до РІВНО одного класу: вставка ВСЕРЕДИНУ однорядкового
    // flow-контейнера, `{…}`/`[…]`, де [`next_line_start`] не має де шукати
    // `\n`) — [`is_flow_container`]/[`flow_insert_point`]/
    // [`write_yaml_flow_value`] (доккомент розділу вище). Ці тести
    // викликають [`try_surgical_merge`] НАПРЯМУ (ізольовані фікстури, не
    // production-снипети `LINT_SECURITY_YML_FIX_CFG`/`VSCODE_SETTINGS_FIX_CFG`
    // — той самий підхід, що §2.62 використала для трьох тимчасових
    // юніт-тестів, якими знайдено звуження межі, лише ці — постійні). ---

    /// Flow-послідовність у корені документа (`branches: [main]`, точна
    /// фікстура з постановки) — вставка НОВОГО елемента поряд з наявним
    /// (потрібна кома-роздільник). Рядкові скаляри — той самий double-quote
    /// контракт, що [`yaml_scalar`] на block-шляху (жодного вгадування
    /// безпечності plain-форми).
    #[test]
    fn surgical_merge_flow_sequence_root_insert_appends_with_comma() {
        let before = "on:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet = parse_yaml_document(
            "on:\n  push:\n    branches: [main, dev]\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
        )
        .expect("snippet валідний YAML");
        let result = try_surgical_merge(before, &snippet, true)
            .expect("flow-послідовність має мержитись хірургічно, без fallback на регенерацію");
        assert_eq!(
            result,
            "on:\n  push:\n    branches: [main, \"dev\"]\njobs:\n  build:\n    runs-on: ubuntu-latest\n"
        );
        let reparsed = parse_yaml_document(&result).expect("вивід — валідний YAML");
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    /// Порожній flow-масив (`[]`) — перший елемент НЕ потребує коми-
    /// роздільника (`flow_insert_point` розпізнає порожній вміст).
    #[test]
    fn surgical_merge_flow_sequence_empty_insert_first_no_comma() {
        let before = "tags: []\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet =
            parse_yaml_document("tags: [v1]\njobs:\n  build:\n    runs-on: ubuntu-latest\n").unwrap();
        let result = try_surgical_merge(before, &snippet, true)
            .expect("порожній flow-масив має отримати перший елемент без коми");
        assert_eq!(result, "tags: [\"v1\"]\njobs:\n  build:\n    runs-on: ubuntu-latest\n");
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    /// Порожня flow-мапа (`{}`) — симетричний випадок для обʼєктної гілки.
    #[test]
    fn surgical_merge_flow_mapping_empty_insert_first_no_comma() {
        let before = "permissions: {}\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet = parse_yaml_document(
            "permissions: {contents: read}\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
        )
        .unwrap();
        let result = try_surgical_merge(before, &snippet, true)
            .expect("порожня flow-мапа має отримати перший ключ без коми");
        assert_eq!(
            result,
            "permissions: {\"contents\": \"read\"}\njobs:\n  build:\n    runs-on: ubuntu-latest\n"
        );
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    /// Вкладена flow-мапа (`on: {push: {branches: [main]}}`, точна фікстура
    /// з постановки) — вставка ОДНОЧАСНО на верхньому рівні (`on`, сусідній
    /// ключ `workflow_dispatch` поряд з `push`) і на вкладеному (`push`,
    /// сусідній ключ `tags` поряд з `branches`). Обидва рівні — окремі
    /// [`Edit::Insert`] на різних байтових офсетах, обчислені проти
    /// ОРИГІНАЛЬНОГО тексту (той самий мотив, що [`apply_edits`] — порядок
    /// застосування не впливає на коректність, бо офсети не перетинаються).
    #[test]
    fn surgical_merge_flow_mapping_nested_and_top_level_insert() {
        let before = "on: {push: {branches: [main]}}\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet = parse_yaml_document(concat!(
            "on: {push: {branches: [main], tags: dev-tag}, workflow_dispatch: {}}\n",
            "jobs:\n  build:\n    runs-on: ubuntu-latest\n",
        ))
        .unwrap();
        let result = try_surgical_merge(before, &snippet, true).expect(
            "вставка і на верхньому, і на вкладеному рівні flow-мапи має бути хірургічною",
        );
        assert_eq!(
            result,
            concat!(
                "on: {push: {branches: [main], \"tags\": \"dev-tag\"}, \"workflow_dispatch\": {}}\n",
                "jobs:\n  build:\n    runs-on: ubuntu-latest\n",
            )
        );
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    /// Flow-контейнер з наявною trailing-комою (`[main,]` — валідний YAML,
    /// перевірено окремо через `saphyr::YamlOwned::load_from_str` перед
    /// написанням цього тесту) — [`flow_insert_point`] НЕ має дописувати
    /// ДРУГУ кому (дзеркальний мотив до [`already_has_trailing_comma`] на
    /// JSON block-шляху, лише скануючи НАЗАД від точки вставки, не вперед).
    #[test]
    fn surgical_merge_flow_sequence_existing_trailing_comma_not_doubled() {
        let before = "branches: [main,]\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet =
            parse_yaml_document("branches: [main, dev]\njobs:\n  build:\n    runs-on: ubuntu-latest\n")
                .unwrap();
        let result = try_surgical_merge(before, &snippet, true)
            .expect("наявна trailing-кома не має блокувати хірургічну вставку");
        assert!(!result.contains(",,"), "подвійна кома: {result}");
        assert_eq!(result, "branches: [main, \"dev\"]\njobs:\n  build:\n    runs-on: ubuntu-latest\n");
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    /// Найважливіший тест — точно той каскад, що §2.61 виміряла як «anchor
    /// І flow непідтримні разом», а §2.62 звузила до «лише flow-nested-
    /// insert» (доккомент розділу вище): документ, де flow-контейнер
    /// (`branches: […]`) СУСІДИТЬ із коментарями в іншій частині того
    /// самого дерева (`# top-level file comment`, трейлінг-коментар на
    /// самій flow-лінії) і потребує ЩЕ ОДНОЇ, окремої block-style вставки
    /// на кореневому рівні (`concurrency`). ДО фіксу — [`surgical_merge_node`]
    /// пробрасує `false` від flow-гілки вгору (`if !surgical_merge_node(…)
    /// { return false; }`, обхід «все або нічого») аж до кореня,
    /// [`try_surgical_merge`] повертає `None`, ВЕСЬ документ (включно з
    /// block-вставкою `concurrency`, яка сама по собі хірургічна) валиться
    /// на повну регенерацію — ВСІ коментарі втрачаються. ПІСЛЯ фіксу — обидві
    /// вставки (flow і block) застосовуються хірургічно, коментарі
    /// зберігаються.
    #[test]
    fn surgical_merge_mixed_flow_inside_block_tree_preserves_all_comments() {
        let before = concat!(
            "# top-level file comment\n",
            "name: CI\n",
            "\n",
            "on:\n",
            "  push:\n",
            "    branches: [main] # trailing comment on flow line\n",
            "\n",
            "jobs:\n",
            "  build:\n",
            "    runs-on: ubuntu-latest\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
        );
        let snippet = parse_yaml_document(concat!(
            "name: CI\n",
            "on:\n",
            "  push:\n",
            "    branches: [main, dev]\n",
            "jobs:\n",
            "  build:\n",
            "    runs-on: ubuntu-latest\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
            "concurrency:\n",
            "  group: x\n",
        ))
        .unwrap();
        let result = try_surgical_merge(before, &snippet, true).expect(
            "ОДНА нездійсненна вставка всередині flow-контейнера НЕ має валити весь мердж на \
             повну регенерацію — саме той каскад, що §2.61 виміряла як «anchor/flow непідтримні \
             разом»",
        );
        assert!(result.contains("# top-level file comment"));
        assert!(result.contains("branches: [main, \"dev\"] # trailing comment on flow line"));
        assert!(result.contains("concurrency"));
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    /// РЕГРЕСІЯ — anchor/alias БЕЗ жодного flow (§2.62: «анкер/аліас уже
    /// працює в нашому власному [`try_surgical_merge`], без жодного крейта»,
    /// не має регресувати від додавання flow-підтримки). Три коментарі
    /// (файловий, інлайновий на полі anchor-мапи, і перед `steps:` у job-і,
    /// що використовує `<<: *common`) мусять вижити 3/3.
    #[test]
    fn surgical_merge_anchor_alias_regression_all_comments_preserved() {
        let before = concat!(
            "# top-level file comment\n",
            "x-common: &common\n",
            "  timeout-minutes: 5 # anchor field comment\n",
            "  runs-on: ubuntu-latest\n",
            "\n",
            "jobs:\n",
            "  security:\n",
            "    <<: *common\n",
            "    # job comment before steps\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
        );
        let snippet = parse_yaml_document(concat!(
            "jobs:\n",
            "  security:\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
            "concurrency:\n",
            "  group: x\n",
        ))
        .unwrap();
        let result = try_surgical_merge(before, &snippet, true)
            .expect("anchor/alias без flow має мержитись хірургічно (без регресії від §2.62-фіксу)");
        assert!(result.contains("# top-level file comment"));
        assert!(result.contains("timeout-minutes: 5 # anchor field comment"));
        assert!(result.contains("# job comment before steps"));
        assert!(result.contains("<<: *common"));
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    /// РЕГРЕСІЯ — чистий block-стиль (жодного flow, жодного anchor), точно
    /// такий, як мержився ДО цієї задачі — не має змінити поведінку.
    #[test]
    fn surgical_merge_pure_block_style_regression_unaffected_by_flow_support() {
        let before = concat!(
            "name: X\n",
            "# comment before jobs\n",
            "jobs:\n",
            "  build:\n",
            "    runs-on: ubuntu-latest\n",
        );
        let snippet = parse_yaml_document(concat!(
            "name: X\n",
            "jobs:\n",
            "  build:\n",
            "    runs-on: ubuntu-latest\n",
            "concurrency:\n",
            "  group: x\n",
        ))
        .unwrap();
        let result = try_surgical_merge(before, &snippet, true)
            .expect("block-стиль surgical merge має спрацювати як і раніше");
        assert!(result.contains("# comment before jobs"));
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    // --- `parse_jsonc_document`/`parse_marked_jsonc_document` (справжня
    // JSONC-підтримка, доккомент розділу «Справжня JSONC-підтримка» — заміна
    // floor-валідатора `is_strict_json`, який тут жив раніше) ---

    #[test]
    fn parse_jsonc_document_accepts_plain_json_object_root() {
        let parsed = parse_jsonc_document(r#"{"a":1,"b":[true,false,null,"x",1.5e10],"c":{}}"#)
            .expect("звичайний JSON без коментарів мусить парситись");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
    }

    #[test]
    fn parse_jsonc_document_accepts_leading_line_comment() {
        let parsed = parse_jsonc_document("{\n  // коментар\n  \"a\": 1\n}\n")
            .expect("справжня JSONC-підтримка мусить приймати `//`-коментар");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
    }

    #[test]
    fn parse_jsonc_document_accepts_trailing_line_comment() {
        let parsed = parse_jsonc_document("{\"a\": 1 // коментар\n}")
            .expect("хвостовий `//`-коментар на рядку значення мусить прийматись");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
    }

    #[test]
    fn parse_jsonc_document_accepts_block_comment() {
        let parsed = parse_jsonc_document("{\n  /* блоковий коментар */\n  \"a\": 1\n}\n")
            .expect("блоковий `/* */`-коментар мусить прийматись");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
    }

    #[test]
    fn parse_jsonc_document_accepts_trailing_comma() {
        let parsed =
            parse_jsonc_document(r#"{"a":1,}"#).expect("trailing-кома в обʼєкті мусить прийматись");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
        let arr = parse_jsonc_document(r#"{"a":[1,2,]}"#)
            .expect("trailing-кома в масиві мусить прийматись")
            .get("a")
            .and_then(Json::as_array)
            .map(<[Json]>::len);
        assert_eq!(arr, Some(2));
    }

    /// Не-обʼєктний корінь (масив/скаляр) — той самий подвійний fallback, що
    /// [`parse_yaml_document`] (доккомент [`parse_jsonc_document`]): валідний
    /// синтаксично, але `None` за контрактом «нам потрібен обʼєкт».
    #[test]
    fn parse_jsonc_document_rejects_non_object_root() {
        assert!(parse_jsonc_document("[]").is_none());
        assert!(parse_jsonc_document("\"тест\"").is_none());
        assert!(parse_jsonc_document("-0.5").is_none());
    }

    /// [`jsonc_parse_options`] обмежує дефолтну JSON5-подібну поведінку
    /// крейта до РІВНО контракту JSONC (доккомент розділу) — unquoted-ключі
    /// (JSON5, не JSONC) лишаються ВІДХИЛЕНІ, той самий floor, що
    /// `is_strict_json` мав раніше.
    #[test]
    fn parse_jsonc_document_rejects_unquoted_key() {
        assert!(parse_jsonc_document("{a: 1}").is_none());
    }

    #[test]
    fn parse_jsonc_document_rejects_single_quotes() {
        assert!(parse_jsonc_document("{'a': 1}").is_none());
    }

    #[test]
    fn parse_jsonc_document_rejects_trailing_garbage() {
        assert!(parse_jsonc_document("{}garbage").is_none());
    }

    #[test]
    fn parse_jsonc_document_rejects_broken_syntax() {
        assert!(parse_jsonc_document("{ not valid json").is_none());
    }

    /// [`parse_marked_jsonc_document`] — той самий подвійний fallback
    /// annotated-варіанту, і байтові `Range` НЕ включають коментар (той
    /// самий «trivia»-контракт, що робить хірургічний шлях
    /// comment-preserving — доккомент розділу).
    #[test]
    fn parse_marked_jsonc_document_span_excludes_leading_comment() {
        let content = "{\n  // коментар\n  \"a\": 1\n}\n";
        let root = parse_marked_jsonc_document(content).expect("валідний JSONC");
        let MNode::Object(entries, _) = &root else {
            panic!("obj")
        };
        let (_, key_span, value) = &entries[0];
        // Ключ починається РІВНО з `"a"`, не захоплює коментар вище.
        assert_eq!(&content[key_span.0..key_span.1], "\"a\"");
        let MNode::Scalar(_, value_span) = value else {
            panic!("scalar")
        };
        assert_eq!(&content[value_span.0..value_span.1], "1");
    }

    // --- deep-subset/deep-merge примітиви ---

    #[test]
    fn is_subset_object_missing_key_is_false() {
        let actual = Json::Object(vec![("a".to_string(), Json::Int(1))]);
        let snippet = Json::Object(vec![("b".to_string(), Json::Int(2))]);
        assert!(!is_subset(Some(&actual), &snippet));
    }

    #[test]
    fn is_subset_array_identity_update_keeps_structural_check_strict() {
        let actual = Json::Array(vec![Json::Object(vec![(
            "uses".to_string(),
            Json::Str("actions/checkout@v5".to_string()),
        )])]);
        let snippet = Json::Array(vec![Json::Object(vec![(
            "uses".to_string(),
            Json::Str("actions/checkout@v6".to_string()),
        )])]);
        // Різна версія — структурно НЕ той самий елемент (subset-check не
        // знає про identity-key, той самий контракт, що JS `checkSnippet`).
        assert!(!is_subset(Some(&actual), &snippet));
    }

    #[test]
    fn merge_json_value_updates_same_identity_element_in_place() {
        // `identity_key` перевіряє `name` РАНІШЕ `uses` (доккомент
        // `identity_key`, той самий пріоритет, що JS `identityKey`) — обидва
        // елементи тут БЕЗ `name`, тож збіг рахується за `uses` без версії.
        let actual = Json::Array(vec![Json::Object(vec![
            (
                "uses".to_string(),
                Json::Str("actions/checkout@v5".to_string()),
            ),
            (
                "with".to_string(),
                Json::Object(vec![("local-flag".to_string(), Json::Bool(true))]),
            ),
        ])]);
        let snippet = Json::Array(vec![Json::Object(vec![(
            "uses".to_string(),
            Json::Str("actions/checkout@v6".to_string()),
        )])]);
        let merged = merge_json_value(Some(&actual), &snippet);
        let Json::Array(items) = merged else {
            panic!("array")
        };
        assert_eq!(items.len(), 1, "оновлення on-place, не дублювання");
        assert_eq!(
            items[0].get("uses").and_then(Json::as_str),
            Some("actions/checkout@v6")
        );
        assert_eq!(
            items[0].get("with").and_then(|w| w.get("local-flag")),
            Some(&Json::Bool(true)),
            "локальне поле того самого елемента збережено"
        );
    }

    #[test]
    fn write_yaml_block_round_trips_through_saphyr() {
        let value = Json::Object(vec![
            ("name".to_string(), Json::Str("with: colon".to_string())),
            (
                "steps".to_string(),
                Json::Array(vec![Json::Object(vec![
                    (
                        "uses".to_string(),
                        Json::Str("actions/checkout@v6".to_string()),
                    ),
                    (
                        "with".to_string(),
                        Json::Object(vec![("persist-credentials".to_string(), Json::Bool(false))]),
                    ),
                ])]),
            ),
        ]);
        let text = write_yaml_block(&value);
        let parsed = parse_yaml_document(&text).expect("write_yaml_block дає валідний YAML");
        assert_eq!(parsed, value);
    }

    #[test]
    fn write_json_pretty_round_trips() {
        let value = Json::Object(vec![(
            "recommendations".to_string(),
            Json::Array(vec![Json::Str("a".to_string()), Json::Str("b".to_string())]),
        )]);
        let text = json_to_pretty_string(&value);
        assert!(text.ends_with('\n'));
        let parsed = parse_yaml_document(&text).expect("валідний JSON");
        assert_eq!(parsed, value);
    }
}
