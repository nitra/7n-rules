//! Native fix-домен для builtin-концернів (T1 зрізу 4 + T2 зрізу 5 фази 7,
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4) — Rust-порт
//! T0-патернів (`fix-<concern>.mjs`, `npm/scripts/lib/lint-surface/types.mjs`
//! `T0Pattern`). Два пілотні builtin-концерни (T1 зрізу 4):
//! `doc-files/marksman_config` і `hasura/migrations`; розгортання на решту T0
//! (T2 зрізу 5): `tauri/gitignore_target`, `tauri/linux_deps`,
//! `tauri/cargo_mutants_config`, `hasura/internal_urls` — кожен точний
//! семантичний порт свого видаленого `fix-<concern>.mjs`.
//!
//! # Свідомо НЕ портовані T0-фікси (лишаються JS)
//!
//! - **`tauri/release`** (`npm/rules/tauri/release/fix-release.mjs`) —
//!   augmentation-патерни редагують `changelog-release.yml`/`release.yml`
//!   через format-preserving YAML Document API (`parseDocument`/`setIn`
//!   пакета `yaml`: коментарі, порядок ключів і стиль лишаються на місці).
//!   Rust-екосистема не має format-preserving YAML-редактора рівня
//!   `toml_edit` (serde-серіалізація знищила б коментарі й форматування
//!   workflow-файлів), а `FixPlan` вимагає повного нового вмісту файла.
//!   Додатково `resolveGithubOwnerRepo` запускає `git remote get-url origin`
//!   (процесна дія — поза мандатом чистого плану). Не силуємо — фікс
//!   лишається JS до появи адекватного інструмента.
//! - **`image-avif/avif_generation`**
//!   (`npm/rules/image-avif/avif_generation/fix-avif_generation.mjs`) —
//!   перший крок фіксу запускає `npx @nitra/minify-image --avif`
//!   (перекодування зображень бінарною залежністю), і лише потім rescan
//!   вирішує rewrite/orphan-и. Зовнішній процес + залежність від його
//!   side-effect-ів не виражаються декларативним [`FixPlan`]. Лишається JS.
//!
//! # Форма — спільні типи `rules-contract::fix` (дзеркало злито)
//!
//! [`FixPlan`]/[`FileEdit`]/[`WriteFile`] — реекспорт
//! `rules_contract::fix::{FixPlan, FileEdit, WriteFile}` (той самий
//! `#[serde(tag = "type", rename_all = "lowercase")]` дискримінант
//! `"write"`/`"delete"`, той самий мінімум "повний новий вміст або
//! видалення", доккомент модуля `crates/rules-contract/src/fix.rs`).
//! Раніше тут жило структурне дзеркало БЕЗ залежності на `rules-contract`
//! (задокументований план злиття T1 зрізу 4); умова плану — «коли fix-домен
//! узагальниться до єдиного інтерфейсу builtin ↔ wasm» — виконана з
//! активацією fix-контуру contract v3 (napi `run_wasm_concern_fix` +
//! `run-fix.mjs` подають ОБИДВА шляхи через один конвеєр T0Pattern-обгорток
//! над однаковим JSON-планом), тож дублікат видалено. Напрямок залежності
//! `rules-core` → `rules-contract` — рівно той, що з самого початку
//! документує `crate`-doc-коментар `rules-contract/src/lib.rs` («Залежність
//! — лише в один бік: `rules-core` → `rules-contract`, ніколи навпаки»);
//! `rules-contract` — чистий serde-DTO крейт без WIT-кодогенерації і без
//! wasm-рушія (wasmtime лінкує лише `rules-plugin-host`), тож native-шлях
//! нічого зайвого не тягне. Diagnostics DTO
//! ([`crate::diagnostics::Violation`] ⇄ `rules_contract::diagnostic::Diagnostic`)
//! лишається дзеркалом зі своїм окремим планом злиття (доккомент
//! `rules-contract/src/lib.rs`) — воно поза обсягом цього кроку.
//!
//! # Реєстр [`NATIVE_FIXES`] і диспетчер [`run_concern_fix`]
//!
//! Дзеркалить [`super::NATIVE_CONCERNS`]/[`super::run_concern`]: JS-оркестратор
//! (`run-fix.mjs`) звіряє належність `ruleId/concernId`-ключа до
//! [`NATIVE_FIXES`] ДО виклику — невідомий ключ тут теж повертає
//! `RulesError::Concern`, той самий останній рубіж захисту, не основний
//! контракт маршрутизації.
//!
//! На відміну від [`super::run_concern`] (детектор може мати
//! `files`-параметр), fix-домен нічого не ПИШЕ сам — [`run_concern_fix`]
//! лише БУДУЄ [`FixPlan`] (декларативний список операцій); застосування
//! (`fs::write`/`fs::remove_file`, `ctx.recordWrite` для rollback-контракту)
//! лишається на JS-боці (`run-fix.mjs`, обгортка над T0Pattern — секція
//! нижче). ЧИТАТИ файлову систему від `cwd` фіксам дозволено (і T2-фікси
//! зрізу 5 це роблять: умовний edit залежно від наявного вмісту файлу —
//! splice в `.gitignore`/workflow, rescan `src-tauri/`-каталогів, звірка
//! k8s-yaml) — той самий read-only мандат, що й у детекторів; два пілоти T1
//! (`marksman_config`, `migrations`) `cwd` не потребують.
//!
//! # Зміна семантики: install-guard недосяжний у native
//!
//! JS-версія `fix-marksman_config.mjs` перевіряє `existsSync(MARKSMAN_BASELINE_PATH)`
//! ПЕРЕД копіюванням і кидає дружню помилку «інсталяція @7n/rules пошкоджена,
//! перевстанови пакет» — це install-sanity-guard проти зламаного npm-пакета
//! (відсутній `data/marksman_config/marksman.baseline.toml` через обрізаний
//! `files`-whitelist чи пошкоджений `node_modules`). Native-порт вбудовує
//! baseline у бінарник через `include_str!` НА ЕТАПІ КОМПІЛЯЦІЇ — файл
//! стає частиною самого cdylib/бінаря, а не окремим artifact-ом на диску,
//! який можна «загубити» при встановленні npm-пакета. Це означає:
//!
//!   - клас помилки «canonical baseline відсутній на диску» СТРУКТУРНО
//!     неможливий для native-шляху — якщо аддон завантажився і
//!     [`contract_version`](../../../rules-napi) збігається, baseline ГАРАНТОВАНО
//!     є (він зашитий у той самий бінарний файл, що й код перевірки);
//!   - install-guard і його дружнє повідомлення («перевстанови пакет»)
//!     НЕ портуються — немає стану, який вони мали б ловити;
//!   - це свідома зміна поведінки зламаної інсталяції, не забутий кейс:
//!     стара JS-гілка (і її тест) явно документують, що вона більше не
//!     застосовна до native-шляху (секція в тесті fix-run.mjs/T0-обгортки,
//!     дивись план задачі — «install-guard тест marksman — його онови під
//!     нову семантику»).

use std::path::Path;

use crate::{diagnostics::Violation, RulesError};

/// Спільні DTO fix-домену — реекспорт із `rules-contract` (злиття дзеркала,
/// доккомент модуля вище): `FixPlan` — впорядкований список операцій,
/// порожній = «для цих violations фіксити нічого» (контракт «непорожній
/// план» ⇔ «застосовний», який JS-обгортка (`run-fix.mjs`) використовує
/// замість окремого `T0Pattern.test()`); `FileEdit` — `type`-дискримінант
/// `"write"`/`"delete"`; `WriteFile.path` — posix-relative шлях від cwd
/// (той самий контракт, що `rules_contract::detect::SourceFile::path`).
pub use rules_contract::fix::{FileEdit, FixPlan, WriteFile};

/// Canonical baseline `.marksman.toml`, вбудований у бінарник на етапі
/// компіляції — джерело правди те саме, що постачається в npm-пакеті
/// (`npm/rules/doc-files/marksman_config/data/marksman_config/marksman.baseline.toml`,
/// той самий файл, який читає JS-фіксер через `MARKSMAN_BASELINE_PATH`).
/// Секція «Зміна семантики» вище пояснює, чому install-guard,
/// що охороняв JS-версію цього читання, тут не потрібен.
const MARKSMAN_BASELINE: &str = include_str!(
    "../../../../npm/rules/doc-files/marksman_config/data/marksman_config/marksman.baseline.toml"
);

/// Ціль copy-фіксу — порт `MARKSMAN_TARGET_FILENAME`
/// (`fix-marksman_config.mjs:18`, `crates/rules-core/src/concerns/marksman_config.rs:29`).
const MARKSMAN_TARGET_FILENAME: &str = ".marksman.toml";

/// Ключ `data.kind`, за яким детектор [`super::marksman_config`] позначає
/// violation (`crates/rules-core/src/concerns/marksman_config.rs:33,50`) —
/// той самий, за яким матчився JS T0-патерн (`v.data?.kind`).
const MARKSMAN_MISSING_KIND: &str = "marksman-config-missing";

/// T0-фікс `doc-files/marksman_config` — точний семантичний порт
/// `patterns[0]` з `fix-marksman_config.mjs` (мінус install-guard, секція
/// доккомент модуля вище). Застосовність: хоча б одна violation з
/// `data.kind === "marksman-config-missing"` (`test()` у JS-версії) — план
/// непорожній лише тоді.
fn marksman_config_fix(violations: &[Violation]) -> FixPlan {
    let applicable = violations.iter().any(|v| {
        v.data
            .as_ref()
            .and_then(|d| d.get("kind"))
            .and_then(|k| k.as_str())
            == Some(MARKSMAN_MISSING_KIND)
    });
    if !applicable {
        return FixPlan::default();
    }
    FixPlan {
        edits: vec![FileEdit::Write(WriteFile {
            path: MARKSMAN_TARGET_FILENAME.to_string(),
            content: MARKSMAN_BASELINE.to_string(),
        })],
    }
}

/// `reason`, за яким детектор [`super::hasura_migrations`] позначає
/// violation (`crates/rules-core/src/concerns/hasura_migrations.rs:19`) —
/// той самий, за яким матчився JS T0-патерн (`v.reason === 'down-sql-forbidden'`).
const HASURA_DOWN_SQL_REASON: &str = "down-sql-forbidden";

/// T0-фікс `hasura/migrations` — точний семантичний порт `patterns[0]` з
/// `fix-migrations.mjs`: видалити кожен `down.sql`, на який вказує
/// violation з `reason === "down-sql-forbidden"`. Дедуп за шляхом (той самий
/// `[...new Set(...)]` у JS) — план не містить дублікатів `Delete` для
/// одного файлу, навіть якщо кілька violations вказують на нього.
fn hasura_migrations_fix(violations: &[Violation]) -> FixPlan {
    let mut seen = std::collections::HashSet::new();
    let mut edits = Vec::new();
    for v in violations {
        if v.reason != HASURA_DOWN_SQL_REASON {
            continue;
        }
        let Some(file) = &v.file else { continue };
        if !seen.insert(file.clone()) {
            continue;
        }
        edits.push(FileEdit::Delete { path: file.clone() });
    }
    FixPlan { edits }
}

// ── tauri/gitignore_target ──────────────────────────────────────────────────

/// Заголовок-коментар секції Tauri build-артефактів у корінному `.gitignore` —
/// порт `GITIGNORE_TARGET_HEADER` (`fix-gitignore_target.mjs:25`).
const GITIGNORE_TARGET_HEADER: &str = "# Tauri — Rust build artifacts (tauri.mdc)";

/// Знаходить кінець контурного блоку entries, що йде одразу за заголовком
/// (перший порожній рядок, наступний коментар або кінець файла) — точний
/// порт `findBlockEnd` (`fix-gitignore_target.mjs:34-38`).
fn find_gitignore_block_end(lines: &[&str], header_idx: usize) -> usize {
    let mut i = header_idx + 1;
    while i < lines.len() {
        let t = lines[i].trim();
        if t.is_empty() || t.starts_with('#') {
            break;
        }
        i += 1;
    }
    i
}

/// Дописує відсутні `<ws>/src-tauri/target/` entries: якщо секція
/// [`GITIGNORE_TARGET_HEADER`] вже є — вставляє в кінець її блоку (поруч з
/// наявними entries); інакше додає новий блок (заголовок + entries) у кінець
/// файла — точний порт `insertMissingTargetEntries`
/// (`fix-gitignore_target.mjs:48-68`). `None` — нічого не змінилось.
fn insert_missing_target_entries(content: &str, missing: &[String]) -> Option<String> {
    if missing.is_empty() {
        return None;
    }

    let lines: Vec<&str> = content.split('\n').collect();
    if let Some(header_idx) = lines
        .iter()
        .position(|l| l.trim() == GITIGNORE_TARGET_HEADER)
    {
        let block_end = find_gitignore_block_end(&lines, header_idx);
        let mut next: Vec<&str> = lines.clone();
        next.splice(block_end..block_end, missing.iter().map(String::as_str));
        return Some(next.join("\n"));
    }

    let trailing_blank = lines.last() == Some(&"");
    let body = if trailing_blank {
        &lines[..lines.len() - 1]
    } else {
        &lines[..]
    };
    let needs_blank_sep = body.last().is_some_and(|l| !l.trim().is_empty());

    let mut next: Vec<&str> = body.to_vec();
    if needs_blank_sep {
        next.push("");
    }
    next.push(GITIGNORE_TARGET_HEADER);
    next.extend(missing.iter().map(String::as_str));
    next.push("");
    Some(next.join("\n"))
}

/// T0-фікс `tauri/gitignore_target` — точний семантичний порт `patterns[0]` з
/// `fix-gitignore_target.mjs`: для кожної violation з
/// `data.kind == "missing-gitignore-target-entries"` і `file` читає файл від
/// `cwd`, вставляє `data.missing`-entries і планує write повним новим вмістом.
/// Дедуп за шляхом + «перша violation файла перемагає» — той самий
/// `[...new Set(files)]` + `targets.find(x => x.file === rel)` у
/// `applyToFiles`-обгортці JS. Нечитабельний/відсутній файл — skip (той самий
/// `try { readFileSync } catch { continue }` в `apply-to-files.mjs:22-27`:
/// JS-фіксер ніколи не СТВОРЮВАВ `.gitignore` з нуля, лише доповнював
/// наявний — поведінка збережена 1:1).
fn tauri_gitignore_target_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    let mut seen = std::collections::HashSet::new();
    let mut edits = Vec::new();
    for v in violations {
        let kind = v
            .data
            .as_ref()
            .and_then(|d| d.get("kind"))
            .and_then(|k| k.as_str());
        if kind != Some(super::tauri_gitignore_target::MISSING_GITIGNORE_TARGET_ENTRIES) {
            continue;
        }
        let Some(file) = &v.file else { continue };
        if !seen.insert(file.clone()) {
            continue;
        }
        let missing: Vec<String> = v
            .data
            .as_ref()
            .and_then(|d| d.get("missing"))
            .and_then(|m| m.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let Ok(content) = std::fs::read_to_string(cwd.join(file)) else {
            continue;
        };
        if let Some(next) = insert_missing_target_entries(&content, &missing) {
            if next != content {
                edits.push(FileEdit::Write(WriteFile {
                    path: file.clone(),
                    content: next,
                }));
            }
        }
    }
    FixPlan { edits }
}

// ── tauri/linux_deps ────────────────────────────────────────────────────────

/// Порт `TOOLCHAIN_RE` (`fix-linux_deps.mjs:58`,
/// `/uses:\s*dtolnay\/rust-toolchain@/u`).
static TOOLCHAIN_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"uses:\s*dtolnay/rust-toolchain@").expect("valid regex")
});

/// Вставляє канонічний apt-крок перед першим `dtolnay/rust-toolchain@…`
/// кроком (той самий рівень step-list-а). Якщо apt-крок уже є або
/// toolchain-кроку немає (нетипове форматування — лишаємо T1/LLM), нічого не
/// змінює — точний порт `insertLinuxDepsStep` (`fix-linux_deps.mjs:67-84`).
fn insert_linux_deps_step(content: &str) -> Option<String> {
    use super::tauri_linux_deps::{APT_INSTALL_RE, REQUIRED_LINUX_PACKAGES};
    if content.lines().any(|l| APT_INSTALL_RE.is_match(l)) {
        return None;
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let at = lines.iter().position(|l| TOOLCHAIN_RE.is_match(l))?;
    // `uses:` гарантовано присутній (TOOLCHAIN_RE щойно зматчив цей рядок).
    let uses_col = lines[at].find("uses:").unwrap_or(0);
    let ind = " ".repeat(uses_col.saturating_sub(2));
    let step = [
        format!("{ind}- name: Системні залежності Tauri (Linux)"),
        format!("{ind}  run: |"),
        format!("{ind}    sudo apt-get update"),
        format!(
            "{ind}    sudo apt-get install -y {}",
            REQUIRED_LINUX_PACKAGES.join(" ")
        ),
        String::new(),
    ];
    let mut next: Vec<String> = lines.iter().map(|s| (*s).to_string()).collect();
    next.splice(at..at, step);
    Some(next.join("\n"))
}

/// Дописує відсутні канонічні пакети в кінець наявного `apt-get
/// install`-рядка (з урахуванням trailing `\` shell-continuation) — точний
/// порт `appendMissingPackages` (`fix-linux_deps.mjs:92-101`).
fn append_missing_packages(content: &str) -> Option<String> {
    use super::tauri_linux_deps::{APT_INSTALL_RE, REQUIRED_LINUX_PACKAGES};
    let lines: Vec<&str> = content.split('\n').collect();
    let apt_idx = lines.iter().position(|l| APT_INSTALL_RE.is_match(l))?;
    let missing: Vec<&str> = REQUIRED_LINUX_PACKAGES
        .iter()
        .copied()
        .filter(|p| !content.contains(p))
        .collect();
    if missing.is_empty() {
        return None;
    }
    let trimmed = lines[apt_idx].trim_end();
    let new_line = if let Some(stripped) = trimmed.strip_suffix('\\') {
        format!("{} {} \\", stripped.trim_end(), missing.join(" "))
    } else {
        format!("{} {}", trimmed, missing.join(" "))
    };
    let mut next: Vec<&str> = lines.clone();
    next[apt_idx] = &new_line;
    Some(next.join("\n"))
}

/// T0-фікс `tauri/linux_deps` — точний семантичний порт обох патернів з
/// `fix-linux_deps.mjs` (`tauri-linux-deps-insert` +
/// `tauri-linux-deps-packages`): по `data.kind` кожної violation читає
/// workflow-файл від `cwd`, повторно сканує його стан (як JS — індекс
/// apt-рядка не входить у `violation.data`) і планує write повним новим
/// вмістом. Дедуп за шляхом: перша violation файла перемагає — детектор
/// ніколи не емить обидва kind-и для одного файла (`tauri_linux_deps.rs`:
/// step-гілка повертається раніше packages-гілки), тож розбіжності з
/// двопатерновим JS-порядком тут структурно немає.
fn tauri_linux_deps_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    use super::tauri_linux_deps::{MISSING_LINUX_DEPS_PACKAGES, MISSING_LINUX_DEPS_STEP};
    let mut seen = std::collections::HashSet::new();
    let mut edits = Vec::new();
    for v in violations {
        let kind = v
            .data
            .as_ref()
            .and_then(|d| d.get("kind"))
            .and_then(|k| k.as_str());
        let transform = match kind {
            Some(k) if k == MISSING_LINUX_DEPS_STEP => insert_linux_deps_step,
            Some(k) if k == MISSING_LINUX_DEPS_PACKAGES => append_missing_packages,
            _ => continue,
        };
        let Some(file) = &v.file else { continue };
        if !seen.insert(file.clone()) {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(cwd.join(file)) else {
            continue;
        };
        if let Some(next) = transform(&content) {
            if next != content {
                edits.push(FileEdit::Write(WriteFile {
                    path: file.clone(),
                    content: next,
                }));
            }
        }
    }
    FixPlan { edits }
}

// ── tauri/cargo_mutants_config ──────────────────────────────────────────────

/// Шапка-коментар канонічного mutants-конфігу Tauri — порт
/// `TAURI_BASELINE_HEADER` (`fix-cargo_mutants_config.mjs:34-37`).
const TAURI_BASELINE_HEADER: &str = "# .cargo/mutants.toml — Tauri canonical cargo-mutants config (tauri.mdc).\n# Виключаємо --bins і --doc щоб бінарник Tauri та doc-tests не збиралися повторно\n# з нуля під кожного мутанта (секунди → хвилини).\n";

/// TOML-фрагмент ключа `additional_cargo_test_args` — порт
/// `TAURI_KEY_SNIPPETS.additional_cargo_test_args`
/// (`fix-cargo_mutants_config.mjs:41`).
const TAURI_SNIPPET_TEST_ARGS: &str = "additional_cargo_test_args = [\"--lib\", \"--tests\"]\n";

/// TOML-фрагмент ключа `exclude_globs` — порт
/// `TAURI_KEY_SNIPPETS.exclude_globs` (`fix-cargo_mutants_config.mjs:42-58`).
const TAURI_SNIPPET_EXCLUDE_GLOBS: &str = r#"# Platform bridge / app shell — boundary-файли (тестуються smoke/e2e, не mutation unit).
# Якщо у bridge-файлі з'являється pure/business logic — винеси її у platform-neutral
# модуль (src/auth/oauth.rs, src/gmail/message.rs, ...) і тестуй mutation-testing там.
# src/lib.rs (Tauri pub fn run) — runtime entrypoint, що запускає весь app shell:
# один мутант там тримає весь Tauri runtime, тому ділить sandbox-фейл з src/main.rs.
exclude_globs = [
  "src/main.rs",
  "src/lib.rs",
  "src/**/android.rs",
  "src/**/ios.rs",
  "src/**/mobile.rs",
  "src/**/desktop.rs",
  "src/**/macos.rs",
  "src/**/windows.rs",
  "src/**/linux.rs"
]
"#;

/// TOML-фрагмент за канонічним ключем — порт `TAURI_KEY_SNIPPETS[key]`
/// (кожен ключ з `TAURI_CANONICAL_KEYS` детектора має свій сніпет).
fn tauri_key_snippet(key: &str) -> &'static str {
    match key {
        "additional_cargo_test_args" => TAURI_SNIPPET_TEST_ARGS,
        "exclude_globs" => TAURI_SNIPPET_EXCLUDE_GLOBS,
        other => unreachable!("невідомий канонічний ключ mutants-конфігу: {other}"),
    }
}

/// Будує повний Tauri-canonical baseline (для випадку, коли файла ще немає) —
/// точний порт `buildBaseline` (`fix-cargo_mutants_config.mjs:110-112`):
/// сніпети через `join('\n')` — між ними порожній рядок (кожен сніпет уже
/// завершується `\n`).
fn build_mutants_baseline() -> String {
    let snippets: Vec<&str> = super::tauri_cargo_mutants_config::TAURI_CANONICAL_KEYS
        .iter()
        .map(|k| tauri_key_snippet(k))
        .collect();
    format!("{TAURI_BASELINE_HEADER}{}", snippets.join("\n"))
}

/// Будує append-блок з відсутніх ключів; існуючий вміст не торкається —
/// точний порт `buildAppended` (`fix-cargo_mutants_config.mjs:99-104`).
fn build_mutants_appended(existing: &str, missing_keys: &[&str]) -> String {
    let tail = if existing.ends_with('\n') {
        existing.to_string()
    } else {
        format!("{existing}\n")
    };
    let mut block = String::from("\n# Tauri canonical cargo-mutants additions (tauri.mdc)\n");
    for key in missing_keys {
        block.push_str(tauri_key_snippet(key));
    }
    format!("{tail}{block}")
}

/// T0-фікс `tauri/cargo_mutants_config` — точний семантичний порт
/// `patterns[0]` з `fix-cargo_mutants_config.mjs`: застосовність — хоч одна
/// violation з reason `mutants-config-missing`/`mutants-keys-missing`;
/// далі (як JS) НЕ читає per-violation дані, а повторно сканує
/// `src-tauri/`-каталоги від `cwd` і стан кожного файла наново (idempotent —
/// already-complete пропускається). Відсутній файл → write повного baseline;
/// неповний → append лише відсутніх ключів (скан —
/// [`super::tauri_cargo_mutants_config::detect_missing_keys`], той самий, що
/// в detector-а; його fail-safe деградація «нечитабельний/побитий TOML → усі
/// ключі відсутні» тут дає append до фактичного вмісту, а не панік — JS у
/// цьому нетестованому edge-кейсі кидав rejected promise).
fn tauri_cargo_mutants_config_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    use super::tauri_cargo_mutants_config::{
        detect_missing_keys, MUTANTS_CONFIG_MISSING, MUTANTS_KEYS_MISSING,
    };
    let applicable = violations
        .iter()
        .any(|v| v.reason == MUTANTS_CONFIG_MISSING || v.reason == MUTANTS_KEYS_MISSING);
    if !applicable {
        return FixPlan::default();
    }

    let mut edits = Vec::new();
    for dir in super::find_src_tauri::find_src_tauri_dirs(cwd) {
        let target = dir.join(".cargo").join("mutants.toml");
        let rel = super::find_src_tauri::relative_posix(cwd, &target);
        if !target.exists() {
            edits.push(FileEdit::Write(WriteFile {
                path: rel,
                content: build_mutants_baseline(),
            }));
            continue;
        }
        let missing = detect_missing_keys(&target);
        if missing.is_empty() {
            continue;
        }
        let existing = std::fs::read_to_string(&target).unwrap_or_default();
        edits.push(FileEdit::Write(WriteFile {
            path: rel,
            content: build_mutants_appended(&existing, &missing),
        }));
    }
    FixPlan { edits }
}

// ── hasura/internal_urls ────────────────────────────────────────────────────

/// Mismatch-reasons, які фіксить T0 — порт `MISMATCH_REASONS`
/// (`fix-internal_urls.mjs:30`). Структурно невалідний URL
/// (`internal-url-invalid`) — НЕ T0-фікс: `cluster`/`port` нізвідки
/// достовірно вивести, це людське рішення про інфраструктуру.
const INTERNAL_URL_MISMATCH_REASONS: &[&str] = &[
    "internal-url-service-mismatch",
    "internal-url-namespace-mismatch",
];

/// Переписує значення `HASURA_GRAPHQL_ENDPOINT` у вмісті на очікувані
/// `service`/`namespace`, зберігаючи `cluster`/`port` з наявного значення —
/// точний порт `rewriteEndpoint` (`fix-internal_urls.mjs:91-109`), без
/// запису: повертає новий вміст (`None` — нічого не змінилось).
fn rewrite_hasura_endpoint(
    content: &str,
    expected: &super::hasura_internal_urls::ExpectedSegments,
) -> Option<String> {
    use super::hasura_internal_urls::{parse_internal_hasura_endpoint, HASURA_ENDPOINT_LINE_RE};
    let caps = HASURA_ENDPOINT_LINE_RE.captures(content)?;
    let raw = caps.get(1)?;
    let parsed = parse_internal_hasura_endpoint(raw.as_str().trim())?;

    let service = expected.service.as_deref().unwrap_or(&parsed.service);
    let namespace = expected.namespace.as_deref().unwrap_or(&parsed.namespace);
    let next_value = format!(
        "http://{service}.{namespace}.svc.{}.internal:{}",
        parsed.cluster, parsed.port
    );
    if next_value == raw.as_str().trim() {
        return None;
    }
    Some(format!(
        "{}{next_value}{}",
        &content[..raw.start()],
        &content[raw.end()..]
    ))
}

/// T0-фікс `hasura/internal_urls` — точний семантичний порт `patterns[0]` з
/// `fix-internal_urls.mjs`: для унікальних файлів mismatch-violations читає
/// очікувані `service`/`namespace` з `hasura/k8s/base/{svc-hl,namespace}.yaml`
/// (той самий скан, що в detector-а —
/// [`super::hasura_internal_urls::compute_expected_endpoint_segments`]) і
/// планує write повним новим вмістом `.env`-файла.
fn hasura_internal_urls_fix(cwd: &Path, violations: &[Violation]) -> FixPlan {
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();
    for v in violations {
        if !INTERNAL_URL_MISMATCH_REASONS.contains(&v.reason.as_str()) {
            continue;
        }
        let Some(file) = &v.file else { continue };
        if seen.insert(file.clone()) {
            files.push(file.clone());
        }
    }
    if files.is_empty() {
        return FixPlan::default();
    }

    let expected = super::hasura_internal_urls::compute_expected_endpoint_segments(cwd);
    let mut edits = Vec::new();
    for file in files {
        let Ok(content) = std::fs::read_to_string(cwd.join(&file)) else {
            continue;
        };
        if let Some(next) = rewrite_hasura_endpoint(&content, &expected) {
            edits.push(FileEdit::Write(WriteFile {
                path: file,
                content: next,
            }));
        }
    }
    FixPlan { edits }
}

/// Ключі native-портованих fix-ів (`ruleId/concernId`) — той самий формат,
/// що [`super::NATIVE_CONCERNS`]. Підмножина: не кожен native-детектор має
/// native-фікс (T1 зрізу 4 — два пілоти; T2 зрізу 5 — ще чотири; `tauri/release`
/// і `image-avif/avif_generation` свідомо лишаються JS — доккомент модуля).
pub const NATIVE_FIXES: &[&str] = &[
    "abie/env_dns",
    "abie/firebase_hosting",
    "doc-files/marksman_config",
    "hasura/internal_urls",
    "hasura/migrations",
    "k8s/dremio_logging",
    "security/sample_secret",
    "tauri/cargo_mutants_config",
    "tauri/gitignore_target",
    "tauri/linux_deps",
];

/// Будує [`FixPlan`] для native-fix-концерну за ключем `ruleId/concernId`.
///
/// - `cwd` — абсолютний корінь consumer-репо: T2-фікси зрізу 5 читають від
///   нього поточний стан файлів (умовні edit-и залежно від наявного вмісту —
///   саме той сценарій, під який параметр закладався в пілоті); два пілоти
///   T1 його не використовують.
/// - `violations` — підмножина результату `detect` для цього concern-а
///   (дзеркало `FixRequest::diagnostics` у `rules-contract::fix`).
///
/// Невідомий ключ → [`RulesError::Concern`] (JS-бік має звіряти належність
/// до [`NATIVE_FIXES`] ДО виклику — остання лінія захисту, не основний
/// контракт, той самий мотив, що документує [`super::run_concern`]).
pub fn run_concern_fix(
    key: &str,
    cwd: &Path,
    violations: &[Violation],
) -> Result<FixPlan, RulesError> {
    match key {
        "abie/env_dns" => Ok(super::fix_env_dremio::env_dns_fix(cwd, violations)),
        "abie/firebase_hosting" => Ok(super::fix_abie_security::firebase_hosting_fix(violations)),
        "doc-files/marksman_config" => Ok(marksman_config_fix(violations)),
        "hasura/internal_urls" => Ok(hasura_internal_urls_fix(cwd, violations)),
        "hasura/migrations" => Ok(hasura_migrations_fix(violations)),
        "k8s/dremio_logging" => Ok(super::fix_env_dremio::dremio_logging_fix(cwd, violations)),
        "security/sample_secret" => {
            Ok(super::fix_abie_security::sample_secret_fix(cwd, violations))
        }
        "tauri/cargo_mutants_config" => Ok(tauri_cargo_mutants_config_fix(cwd, violations)),
        "tauri/gitignore_target" => Ok(tauri_gitignore_target_fix(cwd, violations)),
        "tauri/linux_deps" => Ok(tauri_linux_deps_fix(cwd, violations)),
        other => Err(RulesError::Concern(format!(
            "невідомий native fix: {other}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;

    fn violation(reason: &str, file: Option<&str>, data: Option<serde_json::Value>) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: "m".to_string(),
            file: file.map(|f| f.to_string()),
            severity: Severity::Error,
            data,
        }
    }

    // ── marksman_config ──

    #[test]
    fn marksman_fix_empty_plan_without_matching_violation() {
        let plan = marksman_config_fix(&[]);
        assert!(plan.edits.is_empty());
        let plan = marksman_config_fix(&[violation("other", None, None)]);
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn marksman_fix_writes_embedded_baseline_when_missing_kind_present() {
        let v = violation(
            "marksman-config-missing",
            Some(".marksman.toml"),
            Some(serde_json::json!({ "kind": "marksman-config-missing" })),
        );
        let plan = marksman_config_fix(&[v]);
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, ".marksman.toml");
                assert!(w.content.contains("[core]"));
                assert!(w.content.contains("[completion]"));
                assert!(w.content.contains("[code_action]"));
            }
            FileEdit::Delete { .. } => panic!("очікували write"),
        }
    }

    #[test]
    fn marksman_fix_ignores_violations_without_matching_kind() {
        let v = violation("marksman-config-missing", Some(".marksman.toml"), None);
        assert!(marksman_config_fix(&[v]).edits.is_empty());
    }

    // ── hasura/migrations ──

    #[test]
    fn hasura_fix_empty_plan_without_violations() {
        assert!(hasura_migrations_fix(&[]).edits.is_empty());
    }

    #[test]
    fn hasura_fix_deletes_each_down_sql_file() {
        let violations = vec![
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/1000_add_foo/down.sql"),
                None,
            ),
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/2000_add_bar/down.sql"),
                None,
            ),
        ];
        let plan = hasura_migrations_fix(&violations);
        assert_eq!(plan.edits.len(), 2);
        for edit in &plan.edits {
            match edit {
                FileEdit::Delete { path } => assert!(path.ends_with("down.sql")),
                FileEdit::Write(_) => panic!("очікували delete"),
            }
        }
    }

    #[test]
    fn hasura_fix_dedup_same_file_across_multiple_violations() {
        let violations = vec![
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/1000_add_foo/down.sql"),
                None,
            ),
            violation(
                "down-sql-forbidden",
                Some("hasura/migrations/default/1000_add_foo/down.sql"),
                None,
            ),
        ];
        assert_eq!(hasura_migrations_fix(&violations).edits.len(), 1);
    }

    #[test]
    fn hasura_fix_ignores_other_reasons_and_missing_file() {
        let violations = vec![
            violation("other-reason", Some("hasura/migrations/x/down.sql"), None),
            violation("down-sql-forbidden", None, None),
        ];
        assert!(hasura_migrations_fix(&violations).edits.is_empty());
    }

    // ── tauri/gitignore_target ──

    /// Хелпер: violation з `data.kind = missing-gitignore-target-entries` і
    /// переліком missing-entries — та сама форма, що емить detector
    /// (`tauri_gitignore_target.rs`).
    fn gitignore_violation(missing: &[&str]) -> Violation {
        violation(
            "missing-gitignore-target-entries",
            Some(".gitignore"),
            Some(serde_json::json!({
                "kind": "missing-gitignore-target-entries",
                "missing": missing
            })),
        )
    }

    #[test]
    fn gitignore_fix_empty_plan_without_matching_violation() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(tauri_gitignore_target_fix(tmp.path(), &[]).edits.is_empty());
        assert!(tauri_gitignore_target_fix(
            tmp.path(),
            &[violation("other", Some(".gitignore"), None)]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «вставляє новий блок у кінець файла, коли секції ще немає»
    /// (`gitignore_target.test.mjs`, fix-блок до T2-порту).
    #[test]
    fn gitignore_fix_appends_new_block_when_no_section() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "node_modules/\ndist/\n").unwrap();
        let plan = tauri_gitignore_target_fix(
            tmp.path(),
            &[gitignore_violation(&["owner/src-tauri/target/"])],
        );
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert_eq!(w.path, ".gitignore");
                assert_eq!(
                    w.content,
                    format!(
                        "node_modules/\ndist/\n\n{GITIGNORE_TARGET_HEADER}\nowner/src-tauri/target/\n"
                    )
                );
            }
            FileEdit::Delete { .. } => panic!("очікували write"),
        }
    }

    /// Дзеркало «дописує запис у вже наявну секцію поруч з іншими entries,
    /// зберігаючи оточення».
    #[test]
    fn gitignore_fix_inserts_into_existing_section_preserving_surroundings() {
        let tmp = tempfile::TempDir::new().unwrap();
        let content =
            format!("node_modules/\n\n{GITIGNORE_TARGET_HEADER}\napp/src-tauri/target/\n\ndist/\n");
        std::fs::write(tmp.path().join(".gitignore"), &content).unwrap();
        let plan = tauri_gitignore_target_fix(
            tmp.path(),
            &[gitignore_violation(&["owner/src-tauri/target/"])],
        );
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(w) => assert_eq!(
                w.content,
                format!(
                    "node_modules/\n\n{GITIGNORE_TARGET_HEADER}\napp/src-tauri/target/\nowner/src-tauri/target/\n\ndist/\n"
                )
            ),
            FileEdit::Delete { .. } => panic!("очікували write"),
        }
    }

    /// JS-паритет: `.gitignore` відсутній на диску → `applyToFiles` скіпав
    /// нечитабельний файл (`try/catch continue`) — план порожній, файл не
    /// створюється з нуля.
    #[test]
    fn gitignore_fix_skips_missing_file_like_js_apply_to_files() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plan = tauri_gitignore_target_fix(
            tmp.path(),
            &[gitignore_violation(&["owner/src-tauri/target/"])],
        );
        assert!(plan.edits.is_empty());
    }

    /// Ідемпотентність: порожній `missing` (нічого дописувати) → без edit-ів.
    #[test]
    fn gitignore_fix_empty_missing_list_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "node_modules/\n").unwrap();
        assert!(
            tauri_gitignore_target_fix(tmp.path(), &[gitignore_violation(&[])])
                .edits
                .is_empty()
        );
    }

    /// Дедуп: дві violations на той самий файл → один edit (перша перемагає).
    #[test]
    fn gitignore_fix_dedups_same_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "node_modules/\n").unwrap();
        let plan = tauri_gitignore_target_fix(
            tmp.path(),
            &[
                gitignore_violation(&["owner/src-tauri/target/"]),
                gitignore_violation(&["app/src-tauri/target/"]),
            ],
        );
        assert_eq!(plan.edits.len(), 1);
        match &plan.edits[0] {
            FileEdit::Write(w) => {
                assert!(w.content.contains("owner/src-tauri/target/"));
                assert!(!w.content.contains("app/src-tauri/target/"));
            }
            FileEdit::Delete { .. } => panic!("очікували write"),
        }
    }

    // ── tauri/linux_deps ──

    const NO_DEPS_YML: &str = "name: Lint Rust\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: dtolnay/rust-toolchain@stable\n        with:\n          components: rustfmt, clippy\n      - run: cargo clippy --all-targets --all-features -- -D warnings\n";
    const PARTIAL_DEPS_YML: &str = "name: Lint Rust\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - run: |\n          sudo apt-get update\n          sudo apt-get install -y libwebkit2gtk-4.1-dev\n      - uses: dtolnay/rust-toolchain@stable\n";

    /// Хелпер: violation з `data.kind` linux_deps-детектора.
    fn linux_deps_violation(kind: &str) -> Violation {
        violation(
            kind,
            Some(".github/workflows/lint-rust.yml"),
            Some(serde_json::json!({ "kind": kind })),
        )
    }

    fn write_lint_rust(tmp: &tempfile::TempDir, content: &str) {
        let dir = tmp.path().join(".github/workflows");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("lint-rust.yml"), content).unwrap();
    }

    #[test]
    fn linux_deps_fix_empty_plan_without_matching_violation() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(&tmp, NO_DEPS_YML);
        assert!(tauri_linux_deps_fix(tmp.path(), &[]).edits.is_empty());
        assert!(tauri_linux_deps_fix(
            tmp.path(),
            &[violation(
                "other",
                Some(".github/workflows/lint-rust.yml"),
                None
            )]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «вставляє apt-крок перед dtolnay/rust-toolchain»
    /// (`linux_deps.test.mjs`, fix-блок до T2-порту).
    #[test]
    fn linux_deps_fix_inserts_step_before_toolchain() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(&tmp, NO_DEPS_YML);
        let plan = tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-step")],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        let lines: Vec<&str> = w.content.split('\n').collect();
        let apt_idx = lines
            .iter()
            .position(|l| l.contains("apt-get install"))
            .unwrap();
        let toolchain_idx = lines
            .iter()
            .position(|l| l.contains("dtolnay/rust-toolchain"))
            .unwrap();
        let checkout_idx = lines
            .iter()
            .position(|l| l.contains("actions/checkout"))
            .unwrap();
        assert!(apt_idx > checkout_idx);
        assert!(apt_idx < toolchain_idx);
        assert!(w
            .content
            .contains("libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev"));
        // Відступ apt-кроку — той самий рівень step-list-а, що toolchain-крок.
        assert!(w
            .content
            .contains("      - name: Системні залежності Tauri (Linux)"));
    }

    /// Дзеркало «без toolchain-кроку не вставляє (нетипове форматування —
    /// T1/LLM)».
    #[test]
    fn linux_deps_fix_no_toolchain_step_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(
            &tmp,
            "jobs:\n  lint:\n    steps:\n      - run: cargo clippy\n",
        );
        assert!(tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-step")]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «appendMissingPackages дописує відсутні пакети в наявний
    /// apt-рядок».
    #[test]
    fn linux_deps_fix_appends_missing_packages() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(&tmp, PARTIAL_DEPS_YML);
        let plan = tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-packages")],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert!(w.content.contains(
            "sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev"
        ));
    }

    /// Дзеркало «appendMissingPackages зберігає shell-continuation `\`».
    #[test]
    fn linux_deps_fix_append_preserves_shell_continuation() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(
            &tmp,
            "jobs:\n  lint:\n    steps:\n      - run: |\n          sudo apt-get install -y libwebkit2gtk-4.1-dev \\\n            build-essential\n      - uses: dtolnay/rust-toolchain@stable\n",
        );
        let plan = tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-packages")],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert!(w
            .content
            .contains("libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \\"));
        assert!(w.content.contains("            build-essential"));
    }

    /// Ідемпотентність: файл уже канонічний → обидва kind-и дають порожній
    /// план (insert бачить apt-рядок, append не знаходить відсутніх пакетів).
    #[test]
    fn linux_deps_fix_canonical_file_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_lint_rust(
            &tmp,
            "jobs:\n  lint:\n    steps:\n      - run: sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev\n      - uses: dtolnay/rust-toolchain@stable\n",
        );
        assert!(tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-step")]
        )
        .edits
        .is_empty());
        assert!(tauri_linux_deps_fix(
            tmp.path(),
            &[linux_deps_violation("missing-linux-deps-packages")]
        )
        .edits
        .is_empty());
    }

    // ── tauri/cargo_mutants_config ──

    fn make_tauri_proj(tmp: &tempfile::TempDir) {
        let write = |rel: &str, content: &str| {
            let path = tmp.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        };
        write("package.json", r#"{"workspaces":["app"]}"#);
        write("app/package.json", r#"{"name":"app","version":"0.0.0"}"#);
        write(
            "app/src-tauri/Cargo.toml",
            "[package]\nname=\"t\"\nversion=\"0.1.0\"\n",
        );
    }

    #[test]
    fn mutants_fix_empty_plan_without_matching_violation() {
        let tmp = tempfile::TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        assert!(tauri_cargo_mutants_config_fix(tmp.path(), &[])
            .edits
            .is_empty());
        assert!(
            tauri_cargo_mutants_config_fix(tmp.path(), &[violation("other", None, None)])
                .edits
                .is_empty()
        );
    }

    /// Дзеркало «mutants.toml відсутній — створено Tauri canonical baseline»
    /// (`cargo_mutants_config.test.mjs`).
    #[test]
    fn mutants_fix_missing_file_plans_full_baseline() {
        let tmp = tempfile::TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        let plan = tauri_cargo_mutants_config_fix(
            tmp.path(),
            &[violation(
                "mutants-config-missing",
                Some("app/src-tauri/.cargo/mutants.toml"),
                None,
            )],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.path, "app/src-tauri/.cargo/mutants.toml");
        let parsed: toml::Table = toml::from_str(&w.content).unwrap();
        assert_eq!(
            parsed["additional_cargo_test_args"],
            toml::Value::try_from(vec!["--lib", "--tests"]).unwrap()
        );
        let globs = parsed["exclude_globs"].as_array().unwrap();
        assert!(globs.iter().any(|g| g.as_str() == Some("src/main.rs")));
        assert!(globs.iter().any(|g| g.as_str() == Some("src/lib.rs")));
        assert!(globs
            .iter()
            .any(|g| g.as_str() == Some("src/**/android.rs")));
        assert!(globs.iter().any(|g| g.as_str() == Some("src/**/macos.rs")));
    }

    /// Дзеркало «частково сконфігурований файл — T0 додає лише відсутні
    /// ключі, наявні байтово незмінні».
    #[test]
    fn mutants_fix_partial_file_appends_only_missing_keys() {
        let tmp = tempfile::TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        let target = tmp.path().join("app/src-tauri/.cargo/mutants.toml");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        let manual = "additional_cargo_test_args = [\"--lib\"]\ntimeout_multiplier = 5.0\n";
        std::fs::write(&target, manual).unwrap();
        let plan = tauri_cargo_mutants_config_fix(
            tmp.path(),
            &[violation(
                "mutants-keys-missing",
                Some("app/src-tauri/.cargo/mutants.toml"),
                None,
            )],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert!(w.content.starts_with(manual));
        let parsed: toml::Table = toml::from_str(&w.content).unwrap();
        // Наявний ключ не перетерто (duplicate-key зламав би парсинг).
        assert_eq!(
            parsed["additional_cargo_test_args"],
            toml::Value::try_from(vec!["--lib"]).unwrap()
        );
        assert!(parsed["exclude_globs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g.as_str() == Some("src/main.rs")));
    }

    /// Ідемпотентність: усі канонічні ключі вже є → порожній план (rescan
    /// пропускає already-complete файл).
    #[test]
    fn mutants_fix_complete_file_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        make_tauri_proj(&tmp);
        let target = tmp.path().join("app/src-tauri/.cargo/mutants.toml");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(
            &target,
            "additional_cargo_test_args = [\"--lib\"]\nexclude_globs = [\"src/custom.rs\"]\n",
        )
        .unwrap();
        // Навіть зі stale violation (напр. race) rescan не знаходить роботи.
        assert!(tauri_cargo_mutants_config_fix(
            tmp.path(),
            &[violation(
                "mutants-keys-missing",
                Some("app/src-tauri/.cargo/mutants.toml"),
                None
            )]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «кілька src-tauri у різних workspaces — у кожному
    /// з'являється Tauri-config».
    #[test]
    fn mutants_fix_multi_workspace_plans_each_src_tauri() {
        let tmp = tempfile::TempDir::new().unwrap();
        let write = |rel: &str, content: &str| {
            let path = tmp.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        };
        write("package.json", r#"{"workspaces":["app","desktop"]}"#);
        write("app/package.json", r#"{"name":"app","version":"0.0.0"}"#);
        write(
            "desktop/package.json",
            r#"{"name":"desktop","version":"0.0.0"}"#,
        );
        write("app/src-tauri/Cargo.toml", "[package]\nname=\"a\"\n");
        write("desktop/src-tauri/Cargo.toml", "[package]\nname=\"d\"\n");
        let plan = tauri_cargo_mutants_config_fix(
            tmp.path(),
            &[violation(
                "mutants-config-missing",
                Some("app/src-tauri/.cargo/mutants.toml"),
                None,
            )],
        );
        let paths: Vec<&str> = plan
            .edits
            .iter()
            .map(|e| match e {
                FileEdit::Write(w) => w.path.as_str(),
                FileEdit::Delete { path } => path.as_str(),
            })
            .collect();
        assert_eq!(
            paths,
            vec![
                "app/src-tauri/.cargo/mutants.toml",
                "desktop/src-tauri/.cargo/mutants.toml"
            ]
        );
    }

    // ── hasura/internal_urls ──

    fn write_hasura_yaml(tmp: &tempfile::TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn internal_urls_fix_empty_plan_without_mismatch_reasons() {
        let tmp = tempfile::TempDir::new().unwrap();
        assert!(hasura_internal_urls_fix(tmp.path(), &[]).edits.is_empty());
        // `internal-url-invalid` — НЕ T0-фікс (людське рішення про cluster/port).
        assert!(hasura_internal_urls_fix(
            tmp.path(),
            &[violation("internal-url-invalid", Some("dev.env"), None)]
        )
        .edits
        .is_empty());
    }

    /// Дзеркало «apply: переписує service, зберігаючи namespace/cluster/port»
    /// (`fix-internal_urls.test.mjs`).
    #[test]
    fn internal_urls_fix_rewrites_service_preserving_cluster_and_port() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n",
        );
        write_hasura_yaml(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        let plan = hasura_internal_urls_fix(
            tmp.path(),
            &[violation(
                "internal-url-service-mismatch",
                Some("dev.env"),
                None,
            )],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(w.path, "dev.env");
        assert_eq!(
            w.content,
            "HASURA_GRAPHQL_ENDPOINT=http://order-h.ua-contract.svc.abie-ua.internal:8080\n"
        );
    }

    /// namespace-mismatch: очікуваний namespace з namespace.yaml, service —
    /// збережений з наявного URL (yaml для service відсутній).
    #[test]
    fn internal_urls_fix_rewrites_namespace_from_namespace_yaml() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/namespace.yaml",
            "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ua-order\n",
        );
        write_hasura_yaml(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        let plan = hasura_internal_urls_fix(
            tmp.path(),
            &[violation(
                "internal-url-namespace-mismatch",
                Some("dev.env"),
                None,
            )],
        );
        assert_eq!(plan.edits.len(), 1);
        let FileEdit::Write(w) = &plan.edits[0] else {
            panic!("очікували write");
        };
        assert_eq!(
            w.content,
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-order.svc.abie-ua.internal:8080\n"
        );
    }

    /// Ідемпотентність: URL уже збігається з очікуваними сегментами →
    /// порожній план (rewrite повертає `None` на рівному значенні).
    #[test]
    fn internal_urls_fix_matching_url_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: contract-h-hl\n",
        );
        write_hasura_yaml(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        assert!(hasura_internal_urls_fix(
            tmp.path(),
            &[violation(
                "internal-url-service-mismatch",
                Some("dev.env"),
                None
            )]
        )
        .edits
        .is_empty());
    }

    /// Структурно невалідний URL у файлі mismatch-violation (stale/гонка) —
    /// rewrite не застосовується, план порожній.
    #[test]
    fn internal_urls_fix_invalid_url_in_file_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n",
        );
        write_hasura_yaml(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n",
        );
        assert!(hasura_internal_urls_fix(
            tmp.path(),
            &[violation(
                "internal-url-service-mismatch",
                Some("dev.env"),
                None
            )]
        )
        .edits
        .is_empty());
    }

    /// Кілька env-файлів → по одному edit на унікальний файл (дедуп).
    #[test]
    fn internal_urls_fix_dedups_files_across_violations() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_hasura_yaml(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n",
        );
        for f in ["dev.env", "production.env"] {
            write_hasura_yaml(
                &tmp,
                f,
                "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
            );
        }
        let plan = hasura_internal_urls_fix(
            tmp.path(),
            &[
                violation("internal-url-service-mismatch", Some("dev.env"), None),
                violation("internal-url-service-mismatch", Some("dev.env"), None),
                violation(
                    "internal-url-service-mismatch",
                    Some("production.env"),
                    None,
                ),
            ],
        );
        assert_eq!(plan.edits.len(), 2);
    }

    // ── реєстр/диспетчер ──

    #[test]
    fn native_fixes_lists_all_ported_keys() {
        assert_eq!(
            NATIVE_FIXES,
            &[
                "abie/env_dns",
                "abie/firebase_hosting",
                "doc-files/marksman_config",
                "hasura/internal_urls",
                "hasura/migrations",
                "k8s/dremio_logging",
                "security/sample_secret",
                "tauri/cargo_mutants_config",
                "tauri/gitignore_target",
                "tauri/linux_deps",
            ]
        );
    }

    /// Кожен ключ реєстру диспатчиться без помилки (порожні violations →
    /// порожній план, не `RulesError::Concern`).
    #[test]
    fn run_concern_fix_dispatches_every_registered_key() {
        let tmp = tempfile::TempDir::new().unwrap();
        for key in NATIVE_FIXES {
            let plan = run_concern_fix(key, tmp.path(), &[]).unwrap();
            assert!(
                plan.edits.is_empty(),
                "порожні violations → порожній план для {key}"
            );
        }
    }

    #[test]
    fn run_concern_fix_dispatches_marksman_config() {
        let tmp = tempfile::TempDir::new().unwrap();
        let v = violation(
            "marksman-config-missing",
            Some(".marksman.toml"),
            Some(serde_json::json!({ "kind": "marksman-config-missing" })),
        );
        let plan = run_concern_fix("doc-files/marksman_config", tmp.path(), &[v]).unwrap();
        assert_eq!(plan.edits.len(), 1);
    }

    #[test]
    fn run_concern_fix_dispatches_hasura_migrations() {
        let tmp = tempfile::TempDir::new().unwrap();
        let v = violation(
            "down-sql-forbidden",
            Some("hasura/migrations/x/down.sql"),
            None,
        );
        let plan = run_concern_fix("hasura/migrations", tmp.path(), &[v]).unwrap();
        assert_eq!(plan.edits.len(), 1);
    }

    #[test]
    fn run_concern_fix_rejects_unknown_key() {
        let tmp = tempfile::TempDir::new().unwrap();
        let err = run_concern_fix("k8s/unknown-concern", tmp.path(), &[]).unwrap_err();
        assert!(matches!(err, RulesError::Concern(_)));
        assert!(err.to_string().contains("k8s/unknown-concern"));
    }
}
