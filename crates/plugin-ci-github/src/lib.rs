//! wasm-компонент `n-rules:plugin@3.1.0` — `ci-github/wasm-concerns`, П'ЯТИЙ
//! first-party wasm-гість репозиторію (перший — `crates/plugin-lang-js`,
//! другий — `crates/plugin-lang-python`, третій — `crates/plugin-lang-rust`,
//! четвертий — `crates/plugin-lang-php`, доккомент того `src/lib.rs` пояснює
//! форму), створений за тим самим флоу скіла `npm/skills/wasm-plugin/`.
//! ПЕРШИЙ НЕ-lang first-party гість — плагін-джерело `@7n/rules-ci-github`
//! (`plugins/ci-github/`), доккомент `plugin.toml` пояснює вибір `id`.
//!
//! ОДНА хвиля порту: рівно ОДИН концерн, `rust/toolchain_cache`, порт
//! `plugins/ci-github/rules/rust/toolchain_cache/main.mjs` (181 рядок) —
//! [`detect_toolchain_cache`]. `ga/workflows` і `ci_artifact/consume`
//! СВІДОМО поза обсягом цієї хвилі (окремі, ще-не-вирішені хвилі — не
//! чіпай їх у цьому крейті без нової задачі).
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
/// звужений порт `ToolchainStepScan` (`main.mjs`): поля `line`/`dashCol`/
/// `cacheLine` оригіналу тут НЕ потрібні (`lint()` JS-оригіналу їх теж не
/// читає — лише `hasCache`/`cacheHasWorkspaces`/`jobHasTauriAction`, звірено
/// читанням `main.mjs:160-178`), тож структура несе лише те, що споживає
/// [`detect_toolchain_cache`].
struct ToolchainStepScan {
    has_cache: bool,
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
            has_cache: job_scan.has_cache,
            cache_has_workspaces,
            job_has_tauri_action: job_scan.job_has_tauri_action,
        });
    }
    out
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

/// Чиста (без host-імпортів `log`/`report-progress`) конструктор
/// маніфеста — винесений з [`Guest::describe`] окремо, щоб host-таргет
/// unit-тести могли звірити форму маніфеста без реального wasmtime-хоста
/// (той самий мотив, що решта чотирьох гостей).
fn build_manifest() -> Manifest {
    Manifest {
        id: "ci-github/wasm-concerns".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.1.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![ConcernContribution {
            key: CONCERN_TOOLCHAIN_CACHE.to_string(),
            scope: ConcernScope::Full,
            glob: vec![
                ".github/workflows/*.yml".to_string(),
                ".github/workflows/*.yaml".to_string(),
                "Cargo.toml".to_string(),
                "src-tauri/Cargo.toml".to_string(),
            ],
        }],
        ci_artifacts: vec![],
        // Вміст файлів хост передає inline (host-побудований full-scope
        // batch) — плагін не читає диск сам (той самий мотив, що решта
        // чотирьох гостей).
        capabilities: Capabilities {
            fs_read: vec![],
            network: false,
        },
        tools: vec![],
    }
}

/// Guest-реалізація `n-rules:plugin@3.1.0` для `ci-github/wasm-concerns` —
/// один концерн однієї хвилі (доккомент модуля).
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

    /// Жоден T0-фіксер не портований цією хвилею (`fixability: "config"` у
    /// `concern.json`) — порожній план, та сама сумісна заглушка, що в
    /// решти чотирьох гостей на своїй першій хвилі.
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

    // --- маніфест: anti-drift `plugin.toml` ---

    #[test]
    fn build_manifest_declares_single_full_scope_concern() {
        let manifest = build_manifest();
        assert_eq!(manifest.id, "ci-github/wasm-concerns");
        assert_eq!(manifest.concerns.len(), 1);
        assert_eq!(manifest.concerns[0].key, CONCERN_TOOLCHAIN_CACHE);
        assert_eq!(manifest.concerns[0].scope, ConcernScope::Full);
        assert!(manifest.tools.is_empty());
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
}
