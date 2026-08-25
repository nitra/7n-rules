//! Native-порт `text/run-v8r` (`npm/rules/text/run-v8r/main.mjs`, 410 рядків) —
//! read-only schema-валідація `json`/`json5`/`yaml`/`yml`/`toml` зовнішнім `v8r`
//! (Schema Store) з офлайн `customCatalog` пакета `@7n/rules`.
//!
//! # Що саме портовано
//!
//! Лише `lint(ctx)` і ланцюг, який він РЕАЛЬНО проходить:
//! - `ctx.files === undefined` (full) → `findV8rFiles(ctx.cwd)` (`main.mjs:357-368`,
//!   `walkDir` + `.n-rules.json:ignore`, фільтр `V8R_EXT_RE`);
//! - дельта → `ctx.files`, відфільтровані `V8R_EXT_RE` (`main.mjs:399`,
//!   case-insensitive — на відміну від `text/markdownlint`'s `MD_EXT_RE`);
//! - порожній список цілей у дельті → 0 violations без жодного спавна
//!   (`main.mjs:400`, рання перевірка в самому `lint()`);
//! - обидві гілки завершуються ОДНИМ виконанням `runV8rWithFiles`
//!   (`main.mjs:394,401`) — один batched виклик `bun x v8r <files...>`, не
//!   послідовність по glob-ам.
//!
//! `runV8rWithGlobs` (`main.mjs:308-324`) НЕ портується: це шлях лише прямого
//! CLI-запуску скрипта (`isRunAsCli`-блок, `main.mjs:406-410`) — `lint(ctx)`
//! його ніколи не викликає, full-режим лінту йде через `findV8rFiles` +
//! `runV8rWithFiles`, той самий один-batched-виклик шлях, що й дельта.
//! Той самий `runV8rWithGlobs` (і `runV8rWithFiles`, і `V8R_CATALOG_PATH`)
//! лишається живим на JS-боці — його використовують два guard-тести каталогу
//! схем ПОЗА детектором (`npm/rules/text/tests/run-v8r-catalog.test.mjs`,
//! `run-v8r-layers-config.test.mjs`, реальні прогони справжнього `v8r` проти
//! `npm/schemas/v8r-catalog.json`), тому ця логіка не видаляється разом з
//! `main.mjs`, а переїжджає у `npm/rules/text/tests/v8r-catalog-runner.mjs`
//! (звіт задачі, розділ «JS-бік»).
//!
//! # `bunPath = resolveCmd('bun') ?? process.execPath` — немає точного відповідника
//!
//! JS ніколи не лишається без виконуваного шляху: якщо `bun` не в `PATH`,
//! канон падає назад на `process.execPath` — шлях до інтерпретатора, що
//! ЗАРАЗ виконує сам скрипт (найчастіше сам `bun`, коли весь тулчейн
//! bun-based, тож `<execPath> x v8r …` працює як `bunx`). У Rust немає
//! еквівалента `process.execPath`: **свідома розбіжність**, без спроби
//! «один в один».
//!
//! Обране рішення — [`std::env::current_exe`]: коли `rules-core` завантажено
//! як napi-аддон у Node/Bun-процес, ОС-процес — це САМЕ той хост-рантайм
//! (`current_exe()` резолвить шлях до бінарника Node/Bun, що його виконує) —
//! найближчий практичний аналог `process.execPath` у цьому сценарії. Але коли
//! `rules-core` викликається з чистого Rust-бінарника (`rules-cli`, без
//! napi-хоста), `current_exe()` повертає шлях до самого `rules-cli` —
//! НЕ JS-рантайм, і `<rules-cli> x v8r …` не має сенсу: спроба спавну
//! завершиться помилкою запуску процесу (`ExitError`-шлях нижче), що
//! ГРАЦІОЗНО (не панічно) деградує в generic non-verbose violation — той
//! самий шлях, що й будь-яка інша `spawn`-помилка, але змістовно це вже не
//! «еквівалент process.execPath», а просто «bun відсутній». Якщо навіть
//! `current_exe()` провалюється (рідкісний OS-збій) — останній fallback:
//! літерал `"bun"` (PATH-lookup під час спавну, з тим самим наслідком:
//! або спрацює, або graceful `ExitError`).
//!
//! # `stripBunNodeShimDirs` — портовано буквально
//!
//! [`strip_bun_node_shim_dirs`] точно дзеркалить `main.mjs:233-239`: дочірній
//! `v8r` (node-shebang) під `bun run --bun` бачив би підмінений `node`
//! (symlink на bun) у PATH і падав на непідтримуваному `node:sea` — тому
//! дочірній процес завжди отримує PATH без `bun-node-*`-shim-тек.
//!
//! # Коди виходу
//!
//! `0` і `98` (порожній glob — тут неможливо, бо цілі завжди явні шляхи, а
//! не glob-и, але код зберігається на паритет із `runOneV8rInvocation`) —
//! НЕ порушення. Будь-який інший код → violation `reason: "v8r"`, ЯКЩО тільки
//! весь `detail` не складається виключно з ajv schema-compile-помилок
//! (нижче).
//!
//! # `isOnlyAjvSchemaCompileErrors` — дві гілки навмисно
//!
//! Якщо ВЕСЬ non-`✔` `detail` — ajv-помилки компіляції ЗОВНІШНЬОЇ схеми
//! (несправна чужа схема, не наш файл; типова причина — ajv `unicodeRegExp`
//! проти legacy over-escaped regex у реальних опублікованих схемах), код
//! примусово стає `0`, а причина йде окремим `⚠`-попередженням через
//! [`report_ajv_schema_compile_failures`] — НЕ як `✖`-порушення. Мішаний
//! випадок (є хоч один genuine validation-рядок) лишається порушенням без
//! змін — навмисно, щоб не замаскувати реальну проблему.
//!
//! # Два `⚠`-канали → `ConcernDiagnostic`
//!
//! [`report_ajv_schema_compile_failures`] і [`warn_about_remote_schema_fallback`]
//! у JS-каноні (`main.mjs:170-178,209-224`) обидва пишуть у **`process.stdout`**
//! (НЕ stderr, попри те, що задача це стверджувала — читання самого коду
//! `main.mjs` це не підтверджує; розбіжність із задачею зафіксована у звіті).
//! Незалежно від фактичного JS-потоку, у порті обидва мапляться в
//! [`crate::diagnostics::ConcernDiagnostic`] (`level: "warn"`) — це
//! структурований канал САМЕ для цього класу «не порушення, але вартий уваги»
//! повідомлень.
//!
//! # `ctx.verbose` не проводиться
//!
//! Контракт [`super::run_concern`] (сигнатура `(cwd, files)`) не несе
//! `verbose` — той самий свідомий вибір, що й у [`super::k8s_kubeconform`]/
//! [`super::k8s_manifests_kubescape`] («Р12: поверхня не росте»). Тут це
//! безпечніше, ніж могло б здатись: `verbose` в JS керує ЛИШЕ тим, що
//! друкується в реальний stdout/stderr процесу (сирий вивід тула проти
//! лише `✖`-рядків) — обчислення `code`/`detail`, що йдуть у violation,
//! **ідентичне** для обох режимів (`main.mjs:279-292`: гілка `if (verbose)`
//! і non-verbose гілка обидві завершуються тим самим forced-`exitCode=0`
//! при `onlySchemaCompileErrors`, і тим самим `detail` інакше). Порт завжди
//! йде non-verbose шляхом (друкує лише `detail`, не сирі stdout/stderr) —
//! це не втрачає жодного violation/diagnostic, лише «сирий» дебаг-вивід у
//! термінал.
//!
//! # cwd дочірнього процесу — явний, не успадкований
//!
//! JS не передає `cwd` у `spawnAsync` для v8r-виклику (`main.mjs:264-266`) —
//! дочірній процес успадковує `process.cwd()` ЦІЛОГО Node-процесу, не
//! обов'язково `ctx.cwd`. У консольному використанні ці два завжди
//! збігаються (лінт-раннер не робить `chdir` після старту), тож розбіжності
//! на практиці нема — але як точний контракт це implicit invariant, не
//! явний параметр. Порт явно ставить `.current_dir(cwd)`: детермінований
//! і testable (той самий підхід, що й [`super::text_markdownlint`]/
//! [`super::text_oxfmt`]), і поведінково еквівалентний реальному
//! використанню. Свідома розбіжність.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::cursor_ignore::walk_repo;
use crate::diagnostics::{ConcernDiagnostic, ConcernReport, Severity, Violation};
use crate::rules_package::{missing_package_root_hint, package_root};
use crate::tool_resolve::resolve_cmd;
use crate::RulesError;

/// `V8R_EXT_RE` (`main.mjs:61`, `/\.(?:json|json5|ya?ml|toml)$/iu`) —
/// case-INsensitive (на відміну від `text/markdownlint`'s `MD_EXT_RE`).
static V8R_EXT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\.(?:json|json5|ya?ml|toml)$").expect("valid regex"));

/// `PROCESSING_LINE_RE` (`main.mjs:117`).
static PROCESSING_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^ℹ Processing (.+)$").expect("valid regex"));

/// `FOUND_REMOTE_SCHEMA_RE` (`main.mjs:118`).
static FOUND_REMOTE_SCHEMA_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^ℹ Found schema in (https?://\S+)").expect("valid regex"));

/// `NOISE_LINE_RE` (`main.mjs:119`).
static NOISE_LINE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:ℹ .*|Resolving dependencies|Resolved, downloaded and extracted.*|Saved lockfile)$",
    )
    .expect("valid regex")
});

/// `AJV_SCHEMA_COMPILE_ERROR_RE` (`main.mjs:134`).
static AJV_SCHEMA_COMPILE_ERROR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:✖ )?Invalid regular expression:.*$").expect("valid regex"));

/// `AJV_SUCCESS_LINE_RE` (`main.mjs:143`).
static AJV_SUCCESS_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^✔ .+ is valid$").expect("valid regex"));

/// `V8R_CATALOG_PATH` відносно кореня пакета `@7n/rules` (`npm/`) —
/// `join(dirname(import.meta.url), '../../../schemas/v8r-catalog.json')`
/// (`main.mjs:67`) з точки `npm/rules/text/run-v8r/main.mjs` веде рівно у
/// `npm/schemas/v8r-catalog.json`, тобто `<package_root>/schemas/…`.
const V8R_CATALOG_REL: &str = "schemas/v8r-catalog.json";

/// Імʼя тимчасового згенерованого конфіг-файлу — `RESOLVED_V8R_CONFIG_PATH`
/// (`main.mjs:70`, `join(tmpdir(), 'n-rules-v8r-config.resolved.json')`).
const RESOLVED_CONFIG_FILE_NAME: &str = "n-rules-v8r-config.resolved.json";

/// `V8R_CACHE_TTL_SECONDS` (`main.mjs:104`) — доба замість дефолтних 600 с.
const V8R_CACHE_TTL_SECONDS: u64 = 86_400;

/// reason violation-у — `fail(msg, 'v8r')` (`main.mjs:395,402`).
const LINT_REASON: &str = "v8r";

/// Базове повідомлення — `v8rFailMessage` без деталі (`main.mjs:377`).
const LINT_MESSAGE_BASE: &str = "v8r schema-валідація json/yaml/toml не пройшла (text.mdc)";

/// Чи файл підпадає під `V8R_EXT_RE`.
fn is_v8r_target(rel: &str) -> bool {
    V8R_EXT_RE.is_match(rel)
}

/// `isLocalSchemaPath` (`main.mjs:79-81`) — не http(s)-адреса.
fn is_local_schema_path(url: &str) -> bool {
    !(url.starts_with("http://") || url.starts_with("https://"))
}

/// `resolveCustomCatalogSchemas` (`main.mjs:90-98`) — читає джерельний
/// каталог і мапить кожен запис у форму v8r `customCatalog.schemas`
/// (`url` → `location`; локальні відносні шляхи стають абсолютними,
/// обчисленими відносно каталогу схем `<package_root>/schemas/`).
///
/// Побитий чи нечитаний каталог → [`RulesError::Concern`] — той самий
/// клас помилки, що й неспійманий `readFileSync`/`JSON.parse`-throw у JS
/// (`writeResolvedV8rConfig` не огортає `resolveCustomCatalogSchemas` у
/// `try/catch`, тож ця помилка вилітає з `lint()` уже в каноні).
fn resolve_custom_catalog_schemas(
    package_root: &Path,
) -> Result<Vec<serde_json::Value>, RulesError> {
    let catalog_path = package_root.join(V8R_CATALOG_REL);
    let raw = std::fs::read_to_string(&catalog_path).map_err(|error| {
        RulesError::Concern(format!(
            "text/run-v8r: не читається каталог схем {}: {error}",
            catalog_path.display()
        ))
    })?;
    let catalog: serde_json::Value = serde_json::from_str(&raw).map_err(|error| {
        RulesError::Concern(format!(
            "text/run-v8r: каталог схем {} не парситься як JSON: {error}",
            catalog_path.display()
        ))
    })?;
    let schemas_dir = catalog_path.parent().unwrap_or(package_root);
    let entries = catalog
        .get("schemas")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let serde_json::Value::Object(mut obj) = entry else {
            continue;
        };
        let url = obj
            .remove("url")
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default();
        let location = if is_local_schema_path(&url) && !Path::new(&url).is_absolute() {
            schemas_dir.join(&url).to_string_lossy().into_owned()
        } else {
            url
        };
        obj.insert("location".to_string(), serde_json::Value::String(location));
        out.push(serde_json::Value::Object(obj));
    }
    Ok(out)
}

/// `writeResolvedV8rConfig` (`main.mjs:111-115`) — матеріалізує тимчасовий
/// v8r-конфіг (`{ cacheTtl, customCatalog: { schemas } }`) у
/// `<tmpdir>/n-rules-v8r-config.resolved.json` і повертає шлях.
fn write_resolved_v8r_config(package_root: &Path) -> Result<PathBuf, RulesError> {
    let schemas = resolve_custom_catalog_schemas(package_root)?;
    let config = serde_json::json!({
        "cacheTtl": V8R_CACHE_TTL_SECONDS,
        "customCatalog": { "schemas": schemas }
    });
    let path = std::env::temp_dir().join(RESOLVED_CONFIG_FILE_NAME);
    let body = serde_json::to_string(&config).map_err(|error| {
        RulesError::Concern(format!(
            "text/run-v8r: не серіалізується v8r-конфіг: {error}"
        ))
    })?;
    std::fs::write(&path, body).map_err(|error| {
        RulesError::Concern(format!(
            "text/run-v8r: не записується v8r-конфіг {}: {error}",
            path.display()
        ))
    })?;
    Ok(path)
}

/// `extractFailureLines` (`main.mjs:194-200`) — фільтрує `ℹ`-шум і bunx
/// install-вивід з об'єднаного `stdout+stderr`, лишає непорожні рядки.
fn extract_failure_lines(combined: &str) -> String {
    combined
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty() && !NOISE_LINE_RE.is_match(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// `isOnlyAjvSchemaCompileErrors` (`main.mjs:155-162`) — усі непорожні
/// не-`✔` рядки `detail` є ajv schema-compile-помилками.
fn is_only_ajv_schema_compile_errors(detail: &str) -> bool {
    let lines: Vec<&str> = detail
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty() && !AJV_SUCCESS_LINE_RE.is_match(line))
        .collect();
    if lines.is_empty() {
        return false;
    }
    lines
        .iter()
        .all(|line| AJV_SCHEMA_COMPILE_ERROR_RE.is_match(line))
}

/// `reportAjvSchemaCompileFailures` (`main.mjs:170-178`) — по одному `⚠`
/// [`ConcernDiagnostic`] (`level: "warn"`) на кожен non-`✔` рядок `detail`.
fn report_ajv_schema_compile_failures(detail: &str, diagnostics: &mut Vec<ConcernDiagnostic>) {
    for line in detail.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() || AJV_SUCCESS_LINE_RE.is_match(trimmed) {
            continue;
        }
        diagnostics.push(ConcernDiagnostic {
            level: "warn".to_string(),
            message: format!(
                "run-v8r: зовнішня схема не компілюється в ajv (не файл) — {trimmed} \
                 Ймовірно, ajv unicodeRegExp-несумісність зі старим стилем escape у чужій схемі; \
                 помилка не рахується як порушення."
            ),
        });
    }
}

/// `warnAboutRemoteSchemaFallback` (`main.mjs:209-224`) — по одному `⚠`
/// [`ConcernDiagnostic`] на кожен файл, чию схему знайдено мережевим
/// fallback-ом (schemastore.org), а не в локальному `customCatalog`.
fn warn_about_remote_schema_fallback(stderr_text: &str, diagnostics: &mut Vec<ConcernDiagnostic>) {
    let mut current_file: Option<&str> = None;
    for line in stderr_text.split('\n') {
        if let Some(caps) = PROCESSING_LINE_RE.captures(line) {
            current_file = caps.get(1).map(|m| m.as_str());
            continue;
        }
        if let Some(caps) = FOUND_REMOTE_SCHEMA_RE.captures(line) {
            if let Some(file) = current_file {
                let url = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
                diagnostics.push(ConcernDiagnostic {
                    level: "warn".to_string(),
                    message: format!(
                        "run-v8r: {file} — схему знайдено через мережевий fallback ({url}), а не в \
                         локальному каталозі @7n/rules. Додай схему в npm/schemas/v8r-catalog.json \
                         (+ npm/schemas/vendor/ за потреби), щоб прогін лишався офлайн."
                    ),
                });
            }
        }
    }
}

/// `stripBunNodeShimDirs` (`main.mjs:233-239`) — прибирає з PATH shim-теки
/// `bun-node-*`, які `bun run --bun` додає з підміненим `node`.
fn strip_bun_node_shim_dirs(path_value: Option<&str>) -> Option<String> {
    let raw = path_value?;
    if raw.is_empty() {
        // `!pathValue` у JS ловить і `''` — falsy, повертає як є.
        return Some(String::new());
    }
    let filtered: Vec<PathBuf> = std::env::split_paths(raw)
        .filter(|entry| {
            let base = entry
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            !base.starts_with("bun-node-")
        })
        .collect();
    std::env::join_paths(&filtered)
        .ok()
        .map(|joined| joined.to_string_lossy().into_owned())
}

/// Результат одного спавну `bun x v8r <targets>` — дзеркало union-типу
/// `{ exitError: true } | { exitError: false, code, detail }` (`main.mjs:253`).
enum V8rInvocation {
    /// Сам спавн не вдався (бінарник зник, ENOENT тощо) — у каноні це
    /// ЛОВИТЬСЯ (`try/catch` у `runOneV8rInvocation`, `main.mjs:263-270`) і
    /// НЕ вилітає з `lint()`, а стає звичайним `fail()` без деталі.
    ExitError,
    /// Спавн відбувся; `code`/`detail` — уже після ajv-only-маскування.
    Done { code: i32, detail: String },
}

/// `resolveCmd('bun') ?? process.execPath` (`main.mjs:261`) — розбіжність
/// задокументована в доккоменті модуля («немає точного відповідника»).
fn resolve_bun_path(resolve_tool: &dyn Fn(&str) -> Option<PathBuf>) -> PathBuf {
    resolve_tool("bun")
        .unwrap_or_else(|| std::env::current_exe().unwrap_or_else(|_| PathBuf::from("bun")))
}

/// `runOneV8rInvocation` (`main.mjs:260-294`), без гілки `verbose`
/// (доккомент модуля, «`ctx.verbose` не проводиться»).
fn run_one_v8r_invocation(
    cwd: &Path,
    targets: &[String],
    config_path: &Path,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
    diagnostics: &mut Vec<ConcernDiagnostic>,
) -> V8rInvocation {
    let bun_path = resolve_bun_path(resolve_tool);

    let mut command = Command::new(&bun_path);
    command.current_dir(cwd).arg("x").arg("v8r").args(targets);
    if let Some(stripped) = strip_bun_node_shim_dirs(std::env::var("PATH").ok().as_deref()) {
        command.env("PATH", stripped);
    }
    command.env("V8R_CONFIG_FILE", config_path);

    let output = match command.output() {
        Ok(output) => output,
        Err(error) => {
            eprintln!("{error}");
            return V8rInvocation::ExitError;
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    // Викликається БЕЗУМОВНО (навіть при exitCode 0) — `main.mjs:272`.
    warn_about_remote_schema_fallback(&stderr, diagnostics);

    let mut exit_code = output.status.code().unwrap_or(1);
    let mut detail = String::new();
    if exit_code != 0 && exit_code != 98 {
        detail = extract_failure_lines(&format!("{stdout}\n{stderr}"));
        let only_schema_compile_errors = is_only_ajv_schema_compile_errors(&detail);
        if only_schema_compile_errors {
            report_ajv_schema_compile_failures(&detail, diagnostics);
        } else if !detail.is_empty() {
            println!("{detail}");
        }
        if only_schema_compile_errors {
            exit_code = 0;
            detail = String::new();
        }
    }
    V8rInvocation::Done {
        code: exit_code,
        detail,
    }
}

/// `runV8rWithFiles` (`main.mjs:336-349`) — один batched виклик по
/// конкретному списку файлів; `code` 98 мапиться в 0 (тут по суті
/// недосяжно — цілі завжди явні шляхи, не glob-и — але мапінг зберігається
/// на буквальний паритет).
fn run_v8r_with_files(
    cwd: &Path,
    files: &[String],
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<(i32, String, Vec<ConcernDiagnostic>), RulesError> {
    if files.is_empty() {
        return Ok((0, String::new(), Vec::new()));
    }

    let root = package_root(cwd).ok_or_else(|| RulesError::Concern(missing_package_root_hint()))?;
    let catalog_path = root.join(V8R_CATALOG_REL);
    if !catalog_path.exists() {
        eprintln!(
            "run-v8r: не знайдено каталог схем за шляхом {} (очікується npm/schemas/v8r-catalog.json у пакеті)",
            catalog_path.display()
        );
        return Ok((2, String::new(), Vec::new()));
    }

    let config_path = write_resolved_v8r_config(&root)?;
    let mut diagnostics = Vec::new();
    let outcome = run_one_v8r_invocation(cwd, files, &config_path, resolve_tool, &mut diagnostics);
    let (code, detail) = match outcome {
        V8rInvocation::ExitError => (1, String::new()),
        V8rInvocation::Done { code, detail } => (if code == 98 { 0 } else { code }, detail),
    };
    Ok((code, detail, diagnostics))
}

/// `findV8rFiles` (`main.mjs:357-368`) — full-scope збір `V8R_EXT_RE`-файлів
/// із повагою до `.gitignore` та `.n-rules.json:ignore`.
fn find_v8r_files(root: &Path) -> Vec<String> {
    walk_repo(root)
        .into_iter()
        .filter(|rel| is_v8r_target(rel))
        .collect()
}

/// `v8rFailMessage` (`main.mjs:376-379`).
fn v8r_fail_message(detail: &str) -> String {
    if detail.is_empty() {
        LINT_MESSAGE_BASE.to_string()
    } else {
        format!("{LINT_MESSAGE_BASE}:\n{detail}")
    }
}

/// Detector `text/run-v8r` — порт `lint(ctx)` (`main.mjs:386-404`).
pub fn text_run_v8r(cwd: &Path, files: Option<&[String]>) -> Result<ConcernReport, RulesError> {
    text_run_v8r_with(cwd, files, &resolve_cmd)
}

/// Тіло детектора з інжектованим резолвом `bun` — та сама інжекція, що в
/// `text_markdownlint_with`/`text_oxfmt_with`: підміняти процес-глобальний
/// `PATH` не можна, бо в тому ж тест-процесі паралельно біжать тести, що
/// спавнять `git`/інші тули.
fn text_run_v8r_with(
    cwd: &Path,
    files: Option<&[String]>,
    resolve_tool: &dyn Fn(&str) -> Option<PathBuf>,
) -> Result<ConcernReport, RulesError> {
    let targets: Vec<String> = match files {
        None => find_v8r_files(cwd),
        Some(list) => {
            let filtered: Vec<String> = list.iter().filter(|f| is_v8r_target(f)).cloned().collect();
            if filtered.is_empty() {
                // `main.mjs:400` — рання відповідь ДО `runV8rWithFiles`, без
                // жодного спавна чи резолву каталогу.
                return Ok(ConcernReport::default());
            }
            filtered
        }
    };

    let (code, detail, diagnostics) = run_v8r_with_files(cwd, &targets, resolve_tool)?;
    let mut violations = Vec::new();
    if code != 0 {
        violations.push(Violation {
            reason: LINT_REASON.to_string(),
            message: v8r_fail_message(&detail),
            file: None,
            severity: Severity::Error,
            data: None,
        });
    }
    Ok(ConcernReport {
        violations,
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    /// Кладе виконуваний shell-скрипт `bun`, що ігнорує аргументи, друкує
    /// `stdout`/`stderr` і завершується з `exit_code`.
    #[cfg(unix)]
    fn fake_bun(dir: &Path, exit_code: i32, stdout: &str, stderr: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join("bun");
        fs::write(
            &bin,
            format!(
                "#!/bin/sh\ncat <<'N_EOF_OUT'\n{stdout}\nN_EOF_OUT\ncat <<'N_EOF_ERR' >&2\n{stderr}\nN_EOF_ERR\nexit {exit_code}\n"
            ),
        )
        .unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    /// Резолвер, що завжди повертає заданий шлях.
    fn resolver_found(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
        move |_| Some(bin.clone())
    }

    /// Резолвер, що не знаходить нічого (fallback → `current_exe`).
    fn resolver_missing(_tool: &str) -> Option<PathBuf> {
        None
    }

    /// Резолвер, що ПАНІКУЄ, якщо його викликали — доказ «жодного спавна не
    /// відбулось» для ранніх-return гілок.
    fn resolver_unreachable(_tool: &str) -> Option<PathBuf> {
        unreachable!("resolve_tool не мав викликатись у цьому сценарії")
    }

    /// `write_resolved_v8r_config` пише за ФІКСОВАНИМ шляхом у `tmpdir()`
    /// (`RESOLVED_CONFIG_FILE_NAME`, точний паритет із `RESOLVED_V8R_CONFIG_PATH`
    /// у `main.mjs:70`) — той самий файл для всього процесу. `cargo test`
    /// виконує тести цього модуля паралельними потоками в одному процесі,
    /// тож кілька тестів, що пишуть/читають цей самий файл одночасно,
    /// гонять один із одним. Лок серіалізує лише тести ЦЬОГО модуля (інші
    /// concern-тести крейта не чіпає) — суто test-only засіб, не зміна
    /// продакшен-поведінки.
    fn config_write_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        LOCK.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Готує dev-репо layout `@7n/rules` під `tmp/npm/` — маркер
    /// `npm/package.json` (щоб `package_root(cwd)` резолвився) плюс
    /// `npm/schemas/v8r-catalog.json` (`content` — сирий JSON). Повертає
    /// `tmp/npm` — придатний і як `package_root`, і як `cwd` (ancestors
    /// цього шляху знаходять маркер на батьківському рівні, як і в
    /// реальному dev-репо, де `cwd` — усередині `npm/`).
    fn write_catalog(tmp: &TempDir, content: &str) -> PathBuf {
        write(tmp, "npm/package.json", r#"{"name": "@7n/rules"}"#);
        write(tmp, "npm/schemas/v8r-catalog.json", content);
        tmp.path().join("npm")
    }

    // --- is_v8r_target ---

    /// `V8R_EXT_RE` — case-INsensitive (`iu`-флаги, на відміну від
    /// `MD_EXT_RE` у `text/markdownlint`).
    #[test]
    fn is_v8r_target_is_case_insensitive() {
        assert!(is_v8r_target("config.json"));
        assert!(is_v8r_target("Config.JSON"));
        assert!(is_v8r_target("a.json5"));
        assert!(is_v8r_target("a.yml"));
        assert!(is_v8r_target("a.YAML"));
        assert!(is_v8r_target("a.toml"));
        assert!(!is_v8r_target("a.txt"));
        assert!(!is_v8r_target("a.md"));
    }

    // --- дельта-режим: фільтр і порожній список ---

    /// Порожній `ctx.files` → 0 violations без жодного спавна ні резолву
    /// каталогу (`resolver_unreachable` довів би панікою протилежне).
    #[test]
    fn empty_delta_files_yields_no_violations_without_spawn() {
        let tmp = TempDir::new().unwrap();
        let report = text_run_v8r_with(tmp.path(), Some(&[]), &resolver_unreachable).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Дельта-режим відфільтровує файли поза `V8R_EXT_RE`; якщо після
    /// фільтра порожньо — так само жодного спавна.
    #[test]
    fn delta_mode_filters_non_v8r_extensions() {
        let tmp = TempDir::new().unwrap();
        let files = vec!["README.md".to_string(), "src/lib.rs".to_string()];
        let report = text_run_v8r_with(tmp.path(), Some(&files), &resolver_unreachable).unwrap();
        assert!(report.violations.is_empty());
    }

    /// Full-режим на порожньому дереві (без жодного v8r-типу файлу) → 0
    /// violations без резолву `package_root`/каталогу (`findV8rFiles`
    /// повертає `[]`, а `run_v8r_with_files` короткочасно виходить ДО
    /// `package_root`) — доводиться `resolver_unreachable`.
    #[test]
    fn full_mode_on_empty_tree_skips_without_package_root() {
        let tmp = TempDir::new().unwrap();
        let report = text_run_v8r_with(tmp.path(), None, &resolver_unreachable).unwrap();
        assert!(report.violations.is_empty());
    }

    /// Full-режим поважає `.n-rules.json:ignore` — той самий сценарій, що
    /// в JS-тесті `lint — full scope` (`run-v8r.test.mjs:290-316`). Сам
    /// `.n-rules.json` теж підпадає під `V8R_EXT_RE` (`.json`) і лишається
    /// в результаті — так само, як у JS (тест там перевіряє лише
    /// присутність `kept.json` через `arrayContaining` і відсутність
    /// `generated/ignored.json`, не повний виключний список).
    #[test]
    fn full_mode_respects_n_rules_ignore() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".n-rules.json", r#"{"ignore": ["generated"]}"#);
        write(&tmp, "kept.json", "{}");
        write(&tmp, "generated/ignored.json", "{}");
        let files = find_v8r_files(tmp.path());
        assert_eq!(
            files,
            vec![".n-rules.json".to_string(), "kept.json".to_string()]
        );
    }

    // --- package_root / каталог ---

    /// Каталог схем відсутній (package_root резолвиться, файлу нема) →
    /// код 2 → violation з БАЗОВИМ повідомленням (без хвоста-деталі,
    /// `main.mjs:342-343` `detail: ''`).
    #[test]
    fn missing_catalog_file_gives_base_message_violation() {
        let tmp = TempDir::new().unwrap();
        // package_root резолвиться через маркер package.json (dev-репо
        // layout, `DEV_REL = "npm"`), без файлу schemas/v8r-catalog.json.
        write(&tmp, "npm/package.json", r#"{"name": "@7n/rules"}"#);
        let files = vec!["a.json".to_string()];
        let report =
            text_run_v8r_with(&tmp.path().join("npm"), Some(&files), &resolver_unreachable)
                .unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, "v8r");
        assert_eq!(report.violations[0].message, LINT_MESSAGE_BASE);
    }

    /// `package_root` не резолвиться взагалі (немає `npm/package.json` ні
    /// `node_modules/@7n/rules/package.json` вище) → fail-closed
    /// [`RulesError::Concern`] — сценарій, недосяжний у JS-каноні (там
    /// `import.meta.url` статично знає своє розташування). Тест навмисно
    /// НЕ мутує `N_RULES_PACKAGE_ROOT` (паралельні тести крейта) — той
    /// самий застережний патерн, що й у `text_markdownlint`.
    #[test]
    fn missing_package_root_fails_closed() {
        if std::env::var("N_RULES_PACKAGE_ROOT").is_ok() {
            return; // оточення з явним override — сценарій недосяжний
        }
        let tmp = TempDir::new().unwrap();
        let files = vec!["a.json".to_string()];
        let err = text_run_v8r_with(tmp.path(), Some(&files), &resolver_unreachable).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("N_RULES_PACKAGE_ROOT"), "{err}");
    }

    /// Каталог існує, але це не валідний JSON → [`RulesError::Concern`] —
    /// дзеркалить неспійманий `JSON.parse`-throw усередині
    /// `writeResolvedV8rConfig` (не огорнутий `try/catch` у JS-каноні,
    /// секція доккоменту модуля).
    #[test]
    fn malformed_catalog_json_fails_closed() {
        let _guard = config_write_lock();
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(&tmp, "not valid json {{{");
        let files = vec!["a.json".to_string()];
        let err = text_run_v8r_with(&root, Some(&files), &resolver_unreachable).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
    }

    // --- resolve_custom_catalog_schemas / write_resolved_v8r_config ---

    /// Локальний відносний `url` стає абсолютним `location` (відносно
    /// каталогу схем); http(s) `url` лишається без змін.
    #[test]
    fn resolve_custom_catalog_schemas_maps_local_and_remote_urls() {
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(
            &tmp,
            r#"{"schemas":[
                {"name":"n-rules.json","url":"n-rules.json","fileMatch":[".n-rules.json"]},
                {"name":"remote","url":"https://example.com/schema.json","fileMatch":["remote.json"]}
            ]}"#,
        );
        let schemas = resolve_custom_catalog_schemas(&root).unwrap();
        assert_eq!(schemas.len(), 2);
        let local = &schemas[0];
        let expected_local = root.join("schemas").join("n-rules.json");
        assert_eq!(
            local["location"].as_str().unwrap(),
            expected_local.to_string_lossy()
        );
        assert!(local.get("url").is_none(), "url має замінитись на location");
        assert_eq!(
            schemas[1]["location"].as_str().unwrap(),
            "https://example.com/schema.json"
        );
    }

    /// `write_resolved_v8r_config` пише `{cacheTtl, customCatalog:{schemas}}`
    /// у tmpdir і повертає шлях до нього.
    #[test]
    fn write_resolved_v8r_config_writes_expected_shape() {
        let _guard = config_write_lock();
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(&tmp, r#"{"schemas":[{"name":"any","url":"any.json"}]}"#);
        let path = write_resolved_v8r_config(&root).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["cacheTtl"], serde_json::json!(V8R_CACHE_TTL_SECONDS));
        assert!(parsed["customCatalog"]["schemas"].as_array().unwrap().len() == 1);
    }

    // --- extract_failure_lines / is_only_ajv_schema_compile_errors ---

    #[test]
    fn extract_failure_lines_strips_noise_keeps_detail() {
        let combined = "docs/layers.json# must NOT have additional properties\nℹ Pre-warming the cache\n✖ docs/layers.json is invalid\n";
        assert_eq!(
            extract_failure_lines(combined),
            "docs/layers.json# must NOT have additional properties\n✖ docs/layers.json is invalid"
        );
    }

    #[test]
    fn is_only_ajv_schema_compile_errors_true_for_pure_ajv_detail() {
        let detail = "✖ Invalid regular expression: /x/u: Invalid escape";
        assert!(is_only_ajv_schema_compile_errors(detail));
    }

    #[test]
    fn is_only_ajv_schema_compile_errors_ignores_success_lines() {
        let detail = "✔ a.yml is valid\n✔ b.yml is valid\n✖ Invalid regular expression: /x/u: Invalid escape";
        assert!(is_only_ajv_schema_compile_errors(detail));
    }

    #[test]
    fn is_only_ajv_schema_compile_errors_false_for_mixed_genuine_error() {
        let detail = "✖ Invalid regular expression: /x/u: Invalid escape\n✖ other.yml is invalid";
        assert!(!is_only_ajv_schema_compile_errors(detail));
    }

    #[test]
    fn is_only_ajv_schema_compile_errors_false_for_empty_detail() {
        assert!(!is_only_ajv_schema_compile_errors(""));
    }

    // --- strip_bun_node_shim_dirs ---

    #[test]
    fn strip_bun_node_shim_dirs_removes_shim_entries() {
        let joined = std::env::join_paths(["/usr/bin", "/tmp/bun-node-abc123", "/opt/bin"])
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let stripped = strip_bun_node_shim_dirs(Some(&joined)).unwrap();
        let dirs: Vec<PathBuf> = std::env::split_paths(&stripped).collect();
        assert_eq!(
            dirs,
            vec![PathBuf::from("/usr/bin"), PathBuf::from("/opt/bin")]
        );
    }

    #[test]
    fn strip_bun_node_shim_dirs_passes_through_none_and_empty() {
        assert_eq!(strip_bun_node_shim_dirs(None), None);
        assert_eq!(strip_bun_node_shim_dirs(Some("")), Some(String::new()));
    }

    // --- resolve_bun_path fallback ---

    /// Резолвер «нічого не знаходить» → fallback на `current_exe()` — той
    /// самий шлях, що повертає сам тест-бінарник.
    #[test]
    fn resolve_bun_path_falls_back_to_current_exe() {
        let path = resolve_bun_path(&resolver_missing);
        assert_eq!(path, std::env::current_exe().unwrap());
    }

    #[test]
    fn resolve_bun_path_prefers_resolved_tool() {
        let bin = PathBuf::from("/opt/bin/bun");
        let path = resolve_bun_path(&resolver_found(bin.clone()));
        assert_eq!(path, bin);
    }

    // --- наскрізні сценарії через fake_bun ---

    /// Код виходу 0 → 0 violations, 0 diagnostics.
    #[cfg(unix)]
    #[test]
    fn exit_zero_gives_no_violations() {
        let _guard = config_write_lock();
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(&tmp, r#"{"schemas":[]}"#);
        let bun = fake_bun(&tmp.path().join("bin"), 0, "", "");
        let files = vec!["a.json".to_string()];
        let report = text_run_v8r_with(&root, Some(&files), &resolver_found(bun)).unwrap();
        assert!(report.violations.is_empty());
        assert!(report.diagnostics.is_empty());
    }

    /// Код виходу 98 (JS: «порожній glob») теж НЕ порушення — мапиться в 0.
    #[cfg(unix)]
    #[test]
    fn exit_98_gives_no_violations() {
        let _guard = config_write_lock();
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(&tmp, r#"{"schemas":[]}"#);
        let bun = fake_bun(&tmp.path().join("bin"), 98, "", "");
        let files = vec!["a.json".to_string()];
        let report = text_run_v8r_with(&root, Some(&files), &resolver_found(bun)).unwrap();
        assert!(report.violations.is_empty());
    }

    /// Ненульовий код (не 0/98) із genuine validation-деталлю → одна
    /// violation `reason: "v8r"` з деталлю в повідомленні.
    #[cfg(unix)]
    #[test]
    fn nonzero_exit_with_genuine_detail_gives_violation() {
        let _guard = config_write_lock();
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(&tmp, r#"{"schemas":[]}"#);
        let bun = fake_bun(
            &tmp.path().join("bin"),
            1,
            "",
            "✖ docs/layers.json is invalid",
        );
        let files = vec!["docs/layers.json".to_string()];
        let report = text_run_v8r_with(&root, Some(&files), &resolver_found(bun)).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].reason, "v8r");
        assert!(report.violations[0]
            .message
            .contains("docs/layers.json is invalid"));
        assert!(report.diagnostics.is_empty());
    }

    /// `detail`, що складається ВИКЛЮЧНО з ajv schema-compile-помилки →
    /// НЕ порушення (код примусово 0), а `⚠`-[`ConcernDiagnostic`] замість.
    #[cfg(unix)]
    #[test]
    fn pure_ajv_schema_compile_error_becomes_warning_not_violation() {
        let _guard = config_write_lock();
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(&tmp, r#"{"schemas":[]}"#);
        let bun = fake_bun(
            &tmp.path().join("bin"),
            1,
            "",
            "✖ Invalid regular expression: /x/u: Invalid escape",
        );
        let files = vec!["azure-pipelines.yml".to_string()];
        let report = text_run_v8r_with(&root, Some(&files), &resolver_found(bun)).unwrap();
        assert!(report.violations.is_empty(), "{:?}", report.violations);
        assert_eq!(report.diagnostics.len(), 1);
        assert_eq!(report.diagnostics[0].level, "warn");
        assert!(report.diagnostics[0]
            .message
            .contains("Invalid regular expression"));
    }

    /// Мішаний випадок (ajv-помилка + genuine validation-рядок в одному
    /// batch) лишається порушенням БЕЗ ЗМІН — не маскуємо реальну проблему.
    #[cfg(unix)]
    #[test]
    fn mixed_ajv_and_genuine_error_stays_a_violation() {
        let _guard = config_write_lock();
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(&tmp, r#"{"schemas":[]}"#);
        let bun = fake_bun(
            &tmp.path().join("bin"),
            1,
            "",
            "✖ Invalid regular expression: /x/u: Invalid escape\n✖ other.yml is invalid",
        );
        let files = vec!["other.yml".to_string()];
        let report = text_run_v8r_with(&root, Some(&files), &resolver_found(bun)).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert!(report.violations[0]
            .message
            .contains("other.yml is invalid"));
    }

    /// `warnAboutRemoteSchemaFallback` спрацьовує НЕЗАЛЕЖНО від коду виходу
    /// (навіть на успіху) — Processing+Found-schema пара в stderr дає
    /// warn-diagnostic без жодної violation.
    #[cfg(unix)]
    #[test]
    fn remote_schema_fallback_warns_even_on_success() {
        let _guard = config_write_lock();
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(&tmp, r#"{"schemas":[]}"#);
        let bun = fake_bun(
            &tmp.path().join("bin"),
            0,
            "",
            "ℹ Processing weird.json\nℹ Found schema in https://schemastore.org/x.json",
        );
        let files = vec!["weird.json".to_string()];
        let report = text_run_v8r_with(&root, Some(&files), &resolver_found(bun)).unwrap();
        assert!(report.violations.is_empty());
        assert_eq!(report.diagnostics.len(), 1);
        assert_eq!(report.diagnostics[0].level, "warn");
        assert!(report.diagnostics[0].message.contains("weird.json"));
        assert!(report.diagnostics[0].message.contains("мережевий fallback"));
    }

    /// Бінарник, на який вказує резолвер, фізично не існує → спавн
    /// провалюється (`ExitError`-шлях) → та сама violation, що й будь-яке
    /// інше ненульове завершення, але БЕЗ деталі (`main.mjs:267-269`:
    /// `catch` ловить, `detail` лишається `''`).
    #[test]
    fn vanished_bun_binary_gives_base_message_violation_not_concern_error() {
        let _guard = config_write_lock();
        let tmp = TempDir::new().unwrap();
        let root = write_catalog(&tmp, r#"{"schemas":[]}"#);
        let ghost = tmp.path().join("nowhere").join("bun");
        let files = vec!["a.json".to_string()];
        let report = text_run_v8r_with(&root, Some(&files), &resolver_found(ghost)).unwrap();
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].message, LINT_MESSAGE_BASE);
    }

    // --- v8r_fail_message ---

    #[test]
    fn v8r_fail_message_without_detail_is_base_only() {
        assert_eq!(v8r_fail_message(""), LINT_MESSAGE_BASE);
    }

    #[test]
    fn v8r_fail_message_with_detail_appends_suffix() {
        let msg = v8r_fail_message("✖ a.json is invalid");
        assert!(msg.starts_with(LINT_MESSAGE_BASE));
        assert!(msg.contains("✖ a.json is invalid"));
    }
}
