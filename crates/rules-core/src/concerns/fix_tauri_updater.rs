//! T0-фікси концерну `tauri/updater` (§2.79 реєстру
//! `docs/plans/2026-08-05-open-questions-register.md`, розділ 4 «Поодинокі»
//! плану `docs/plans/2026-08-29-js-rust-migration-completion-plan.md`) —
//! порт чотирьох патернів `npm/rules/tauri/updater/fix-updater.mjs`.
//!
//! Детектор концерну вже native ([`super::tauri_updater`]), тож read-only
//! хелпери (`find_tauri_app_workspaces`, `group_cargo_deps_by_section`,
//! `meets_min_version`, `has_major`) беруться ЗВІДТИ, а не дублюються —
//! на відміну від JS, де `fix-updater.mjs` мусив задублювати їх після
//! видалення `main.mjs`.
//!
//! # Чому це НЕ той випадок, що `tauri/release`
//!
//! Сусідній `tauri/release` свідомо лишається JS: його патерни правлять
//! `.github/workflows/*.yml` через format-preserving YAML Document API,
//! якого Rust-екосистема не має (доккомент [`super::fix`], секція
//! «Свідомо НЕ портовані»). `tauri/updater` у ту саму стіну НЕ впирається —
//! жодного YAML: package.json і capabilities/*.json (JSON), Cargo.toml і
//! lib.rs (порядкові splice-и, формат зберігається сам собою, бо решта
//! рядків не переписується). Процесних дій теж немає.
//!
//! # Чотири патерни (порт один-в-один)
//!
//! 1. `updater-package-json-deps` — канонічні updater-залежності в
//!    `<ws>/package.json`.
//! 2. `updater-cargo-toml-canon` — `tauri-plugin-process` у `[dependencies]`
//!    і `tauri-plugin-updater` у desktop-only target-секції (append або
//!    ПЕРЕНЕСЕННЯ рядка з безумовної секції).
//! 3. `updater-lib-rs-cfg-guard` — `#[cfg(desktop)]` над УЖЕ наявним рядком
//!    реєстрації `tauri_plugin_updater::Builder`.
//! 4. `updater-capabilities-canon` — permissions у `capabilities/*.json`.
//!
//! Native-обгортка одна ([`tauri_updater_fix`]) — JS-конвеєр звертається до
//! синтетичного `nativeFixPattern` із УСІМА violations концерну, тож
//! чотири `test()`-предикати стають чотирма гілками одного плану.
//!
//! # Свідомо НЕ фіксяться (як у каноні)
//!
//! `lib-rs-process-missing`/`lib-rs-updater-missing` — треба вставити НОВИЙ
//! `.plugin(...)` у середину довільного builder-ланцюжка (точка вставки не
//! детермінована між проєктами); `use-updater-not-called` — редагування
//! чужого SFC. Обидва лишаються manual (`fixability: "structural"`).
//!
//! # Дефекти канону, полагоджені тут (не відтворені заради парності)
//!
//! 1. **Фікс, що ніколи не сходився, коли залежність сидить у
//!    `devDependencies`.** Детектор зливає секції як
//!    `{...dependencies, ...devDependencies}` — тобто ефективною є
//!    devDependencies-версія. Канонічний фікс писав канон ЗАВЖДИ в
//!    `dependencies`, тож застарілий `"@tauri-apps/plugin-updater": "^1"`
//!    у `devDependencies` продовжував затінювати щойно записаний `^2`:
//!    `--fix` звітував «змінено», re-detect бачив те саме порушення, і так
//!    нескінченно. Тут канон пишеться в ТУ САМУ секцію, яка вже оголошує
//!    пакет (`devDependencies`, якщо він там), і лише інакше — у
//!    `dependencies`. Нічого не видаляється; у типовому випадку (пакета в
//!    devDependencies немає) поведінка байт-у-байт канонічна.
//! 2. **Побитий `capabilities/*.json` — мовчазний пропуск.**
//!    `ensureCapabilityPermission` ловив виняток `JSON.parse` і робив
//!    `return false`, тобто «файл не змінено» — не відрізнити від «усе вже
//!    гаразд». Тут нечитабельний capability-файл — гучний
//!    [`RulesError::Concern`] з іменем файлу (той самий клас, що вже має
//!    `package.json` у каноні, де `JSON.parse` не обгорнутий у try/catch).
//! 3. **JSONC-вхід.** Обидва JSON-таргети читаються
//!    [`parse_jsonc_document`], тож `//`-коментар у capability-файлі більше
//!    не робить фікс невидимо неефективним.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use rules_template_merge::{json_to_pretty_string, parse_jsonc_document, Json};

use crate::diagnostics::Violation;
use crate::RulesError;

use super::find_src_tauri::relative_posix;
use super::fix::{FileEdit, FixPlan, WriteFile};
use super::tauri_updater::{
    find_tauri_app_workspaces, group_cargo_deps_by_section, has_major, meets_min_version,
    CARGO_MOBILE_SECTION_RE, CARGO_TARGET_SECTION_RE, MIN_TAURI_COMPONENTS_VERSION,
};

/// Канонічний заголовок desktop-only секції залежностей — порт
/// `CARGO_DESKTOP_TARGET_HEADER` (`fix-updater.mjs:37`).
const CARGO_DESKTOP_TARGET_HEADER: &str =
    r#"target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies"#;

/// Рядок, яким додається `tauri-plugin-process` у `[dependencies]`.
const CARGO_PROCESS_LINE: &str = r#"tauri-plugin-process = "2.3.1""#;

/// Рядок, яким додається `tauri-plugin-updater` у desktop-only секцію.
const CARGO_UPDATER_LINE: &str = r#"tauri-plugin-updater = "2""#;

/// `reason`-и, що вмикають патерн `updater-package-json-deps`.
const PKG_REASONS: [&str; 3] = [
    "tauri-components-version",
    "plugin-updater-missing",
    "plugin-process-missing",
];

/// `reason`-и, що вмикають патерн `updater-cargo-toml-canon`.
const CARGO_REASONS: [&str; 3] = [
    "cargo-plugin-process-missing",
    "cargo-plugin-updater-missing",
    "cargo-plugin-updater-not-scoped",
];

/// `reason`-и, що вмикають патерн `updater-capabilities-canon`.
const CAPABILITY_REASONS: [&str; 2] = [
    "capability-updater-missing",
    "capability-process-restart-missing",
];

/// Абсолютний корінь workspace (`'.'` — сам `cwd`).
fn ws_base(cwd: &Path, ws: &str) -> PathBuf {
    if ws == "." {
        cwd.to_path_buf()
    } else {
        cwd.join(ws)
    }
}

fn any_reason(violations: &[Violation], reasons: &[&str]) -> bool {
    violations
        .iter()
        .any(|v| reasons.contains(&v.reason.as_str()))
}

/// Читає JSON/JSONC-файл як обʼєкт; побитий вміст або не-обʼєктний корінь —
/// гучна помилка (доккомент модуля, дефект канону №2).
fn read_json_object(path: &Path, rel: &str) -> Result<Vec<(String, Json)>, RulesError> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| RulesError::Concern(format!("{rel}: не вдалося прочитати: {e}")))?;
    match parse_jsonc_document(&text) {
        Some(Json::Object(entries)) => Ok(entries),
        _ => Err(RulesError::Concern(format!(
            "{rel}: не вдалося розпарсити JSON — детермінований фікс не може безпечно доповнити файл"
        ))),
    }
}

/// Значення поля-обʼєкта `section` за ключем `name`.
fn dep_version<'a>(root: &'a [(String, Json)], section: &str, name: &str) -> Option<&'a str> {
    root.iter()
        .find(|(k, _)| k == section)
        .and_then(|(_, v)| v.get(name))
        .and_then(Json::as_str)
}

/// Записує `name = range` у секцію `section`, створюючи секцію за потреби
/// (нові ключі — у хвіст, як `{...obj, name: range}` у JS).
fn set_dep(root: &mut Vec<(String, Json)>, section: &str, name: &str, range: &str) {
    let slot = match root.iter_mut().find(|(k, _)| k == section) {
        Some((_, Json::Object(entries))) => entries,
        Some((_, other)) => {
            *other = Json::Object(Vec::new());
            let Json::Object(entries) = other else {
                unreachable!("щойно призначили Json::Object")
            };
            entries
        }
        None => {
            root.push((section.to_string(), Json::Object(Vec::new())));
            let Some((_, Json::Object(entries))) = root.last_mut() else {
                unreachable!("щойно додали Json::Object")
            };
            entries
        }
    };
    if let Some((_, v)) = slot.iter_mut().find(|(k, _)| k == name) {
        *v = Json::Str(range.to_string());
    } else {
        slot.push((name.to_string(), Json::Str(range.to_string())));
    }
}

/// Канон однієї залежності: імʼя, записуваний діапазон і предикат «поточне
/// значення вже канонічне» (той самий предикат, що в детекторі).
struct DepCanon {
    name: &'static str,
    range: &'static str,
    ok: fn(&str) -> bool,
}

fn tauri_components_ok(range: &str) -> bool {
    meets_min_version(range, MIN_TAURI_COMPONENTS_VERSION)
}

fn major2_ok(range: &str) -> bool {
    has_major(range, 2)
}

const DEP_CANONS: [DepCanon; 3] = [
    DepCanon {
        name: "@7n/tauri-components",
        range: "^0.8.0",
        ok: tauri_components_ok,
    },
    DepCanon {
        name: "@tauri-apps/plugin-updater",
        range: "^2",
        ok: major2_ok,
    },
    DepCanon {
        name: "@tauri-apps/plugin-process",
        range: "^2",
        ok: major2_ok,
    },
];

/// Доповнює `<ws>/package.json` канонічними updater-залежностями — порт
/// `fixPackageJson` плюс полагоджений дефект №1 (секція в доккоменті).
fn fix_package_json(cwd: &Path, ws: &str) -> Result<Option<FileEdit>, RulesError> {
    let path = ws_base(cwd, ws).join("package.json");
    if !path.exists() {
        return Ok(None);
    }
    let rel = relative_posix(cwd, &path);
    let mut pkg = read_json_object(&path, &rel)?;
    let mut changed = false;

    for canon in &DEP_CANONS {
        // Ефективна версія — та сама, що бачить детектор:
        // `{...dependencies, ...devDependencies}`, тобто devDependencies
        // перекриває dependencies.
        let in_dev = dep_version(&pkg, "devDependencies", canon.name);
        let effective = in_dev
            .or_else(|| dep_version(&pkg, "dependencies", canon.name))
            .unwrap_or("");
        if (canon.ok)(effective) {
            continue;
        }
        let section = if in_dev.is_some() {
            "devDependencies"
        } else {
            "dependencies"
        };
        set_dep(&mut pkg, section, canon.name, canon.range);
        changed = true;
    }

    if !changed {
        return Ok(None);
    }
    Ok(Some(FileEdit::Write(WriteFile {
        path: rel,
        content: json_to_pretty_string(&Json::Object(pkg)),
    })))
}

/// Вставляє `line_text` одразу після заголовка `[section]`; якщо секції
/// немає — додає нову секцію в кінець файла. Ідемпотентно — точний порт
/// `insertLineIntoCargoSection`.
fn insert_line_into_cargo_section(
    lines: &[String],
    section_header_exact: &str,
    line_text: &str,
) -> Option<Vec<String>> {
    if lines.iter().any(|l| l.trim() == line_text.trim()) {
        return None;
    }
    let header = format!("[{section_header_exact}]");
    if let Some(idx) = lines.iter().position(|l| l.trim() == header) {
        let mut next = lines.to_vec();
        next.insert(idx + 1, line_text.to_string());
        return Some(next);
    }
    let mut next = lines.to_vec();
    if next.last().map(|l| l.trim()) != Some("") {
        next.push(String::new());
    }
    next.push(header);
    next.push(line_text.to_string());
    next.push(String::new());
    Some(next)
}

/// Видаляє перший рядок, що оголошує залежність `dep_name` (незалежно від
/// секції) — порт `removeCargoDependencyLine`.
fn remove_cargo_dependency_line(lines: &[String], dep_name: &str) -> Option<(Vec<String>, String)> {
    let prefix = format!("{dep_name} =");
    let idx = lines.iter().position(|l| {
        let t = l.trim();
        t == dep_name || t.starts_with(&prefix) || t.starts_with(&format!("{dep_name}="))
    })?;
    let mut next = lines.to_vec();
    let removed = next.remove(idx);
    Some((next, removed))
}

/// Доповнює `<ws>/src-tauri/Cargo.toml` — порт `fixCargoToml`.
fn fix_cargo_toml(cwd: &Path, ws: &str) -> Result<Option<FileEdit>, RulesError> {
    let path = ws_base(cwd, ws).join("src-tauri").join("Cargo.toml");
    if !path.exists() {
        return Ok(None);
    }
    let rel = relative_posix(cwd, &path);
    let content = std::fs::read_to_string(&path)
        .map_err(|e| RulesError::Concern(format!("{rel}: не вдалося прочитати: {e}")))?;
    let mut lines: Vec<String> = content.split('\n').map(str::to_string).collect();
    let mut changed = false;

    let by_section = group_cargo_deps_by_section(&content);
    let has_process = by_section
        .iter()
        .any(|(_, keys)| keys.iter().any(|k| k == "tauri-plugin-process"));
    if !has_process {
        if let Some(next) =
            insert_line_into_cargo_section(&lines, "dependencies", CARGO_PROCESS_LINE)
        {
            lines = next;
            changed = true;
        }
    }

    let updater_section = by_section
        .iter()
        .find(|(_, keys)| keys.iter().any(|k| k == "tauri-plugin-updater"))
        .map(|(section, _)| section.clone());
    match updater_section {
        None => {
            if let Some(next) = insert_line_into_cargo_section(
                &lines,
                CARGO_DESKTOP_TARGET_HEADER,
                CARGO_UPDATER_LINE,
            ) {
                lines = next;
                changed = true;
            }
        }
        Some(section) => {
            let desktop_scoped = CARGO_TARGET_SECTION_RE.is_match(&section)
                && CARGO_MOBILE_SECTION_RE.is_match(&section);
            if !desktop_scoped {
                if let Some((without, removed)) =
                    remove_cargo_dependency_line(&lines, "tauri-plugin-updater")
                {
                    if let Some(next) = insert_line_into_cargo_section(
                        &without,
                        CARGO_DESKTOP_TARGET_HEADER,
                        removed.trim(),
                    ) {
                        lines = next;
                    } else {
                        lines = without;
                    }
                    changed = true;
                }
            }
        }
    }

    if !changed {
        return Ok(None);
    }
    Ok(Some(FileEdit::Write(WriteFile {
        path: rel,
        content: lines.join("\n"),
    })))
}

/// Вставляє `#[cfg(desktop)]` над рядком реєстрації updater-плагіна — порт
/// `fixLibRsGuard`. Відсутній рядок реєстрації — не цей патерн (окрема,
/// не-T0 причина `lib-rs-updater-missing`).
fn fix_lib_rs_guard(cwd: &Path, ws: &str) -> Result<Option<FileEdit>, RulesError> {
    let path = ws_base(cwd, ws)
        .join("src-tauri")
        .join("src")
        .join("lib.rs");
    if !path.exists() {
        return Ok(None);
    }
    let rel = relative_posix(cwd, &path);
    let content = std::fs::read_to_string(&path)
        .map_err(|e| RulesError::Concern(format!("{rel}: не вдалося прочитати: {e}")))?;
    let mut lines: Vec<String> = content.split('\n').map(str::to_string).collect();
    let Some(idx) = lines
        .iter()
        .position(|l| l.contains("tauri_plugin_updater::Builder"))
    else {
        return Ok(None);
    };
    let guard_line = lines[..idx].iter().rev().find(|l| !l.trim().is_empty());
    if guard_line.is_some_and(|l| l.contains("#[cfg(desktop)]")) {
        return Ok(None);
    }
    let indent: String = lines[idx]
        .chars()
        .take_while(|c| c.is_whitespace())
        .collect();
    lines.insert(idx, format!("{indent}#[cfg(desktop)]"));
    Ok(Some(FileEdit::Write(WriteFile {
        path: rel,
        content: lines.join("\n"),
    })))
}

/// Додає permission у `permissions[]` capability-файла; відсутній файл —
/// створюється з канонічного baseline. Порт `ensureCapabilityPermission`
/// (мовчазний пропуск побитого JSON замінено на гучну помилку — дефект №2).
fn ensure_capability_permission(
    cwd: &Path,
    path: &Path,
    permission: &str,
    baseline: Json,
) -> Result<Option<FileEdit>, RulesError> {
    let rel = relative_posix(cwd, path);
    if !path.exists() {
        return Ok(Some(FileEdit::Write(WriteFile {
            path: rel,
            content: json_to_pretty_string(&baseline),
        })));
    }
    let mut cap = read_json_object(path, &rel)?;
    let perms: Vec<Json> = cap
        .iter()
        .find(|(k, _)| k == "permissions")
        .and_then(|(_, v)| v.as_array().map(<[Json]>::to_vec))
        .unwrap_or_default();
    if perms.iter().any(|p| p.as_str() == Some(permission)) {
        return Ok(None);
    }
    let mut merged = perms;
    merged.push(Json::Str(permission.to_string()));
    match cap.iter_mut().find(|(k, _)| k == "permissions") {
        Some((_, v)) => *v = Json::Array(merged),
        None => cap.push(("permissions".to_string(), Json::Array(merged))),
    }
    Ok(Some(FileEdit::Write(WriteFile {
        path: rel,
        content: json_to_pretty_string(&Json::Object(cap)),
    })))
}

fn json_str_array(items: &[&str]) -> Json {
    Json::Array(items.iter().map(|s| Json::Str((*s).to_string())).collect())
}

/// Доповнює `<ws>/src-tauri/capabilities/*.json` — порт `fixCapabilities`.
fn fix_capabilities(
    cwd: &Path,
    ws: &str,
    reasons: &BTreeSet<String>,
) -> Result<Vec<FileEdit>, RulesError> {
    let cap_dir = ws_base(cwd, ws).join("src-tauri").join("capabilities");
    if !cap_dir.exists() {
        return Ok(Vec::new());
    }
    let mut edits = Vec::new();

    if reasons.contains("capability-updater-missing") {
        let baseline = Json::Object(vec![
            ("identifier".to_string(), Json::Str("updater".to_string())),
            ("windows".to_string(), json_str_array(&["main"])),
            (
                "platforms".to_string(),
                json_str_array(&["macOS", "windows", "linux"]),
            ),
            (
                "permissions".to_string(),
                json_str_array(&["updater:default"]),
            ),
        ]);
        if let Some(edit) = ensure_capability_permission(
            cwd,
            &cap_dir.join("updater.json"),
            "updater:default",
            baseline,
        )? {
            edits.push(edit);
        }
    }

    if reasons.contains("capability-process-restart-missing") {
        let baseline = Json::Object(vec![
            ("identifier".to_string(), Json::Str("default".to_string())),
            ("windows".to_string(), json_str_array(&["main"])),
            (
                "permissions".to_string(),
                json_str_array(&["core:default", "process:allow-restart"]),
            ),
        ]);
        if let Some(edit) = ensure_capability_permission(
            cwd,
            &cap_dir.join("default.json"),
            "process:allow-restart",
            baseline,
        )? {
            edits.push(edit);
        }
    }

    Ok(edits)
}

/// Групує reasons за workspace (`v.file` починається з `<ws>/`) — порт
/// `groupReasonsByWorkspace`: специфічні workspace-и перевіряються ПЕРШИМИ,
/// корінь (`'.'`) — останній і всеїдний fallback.
fn group_reasons_by_workspace(
    violations: &[Violation],
    apps: &[String],
) -> Vec<(String, BTreeSet<String>)> {
    let mut by_ws: Vec<(String, BTreeSet<String>)> = apps
        .iter()
        .map(|ws| (ws.clone(), BTreeSet::new()))
        .collect();
    let mut order: Vec<&String> = apps.iter().collect();
    order.sort_by_key(|a| i32::from(*a == "."));
    for v in violations {
        let matched = order.iter().find(|a| {
            **a == "."
                || v.file
                    .as_deref()
                    .is_some_and(|f| f.starts_with(&format!("{a}/")))
        });
        let target = matched.map_or(".", |a| a.as_str());
        if let Some((_, set)) = by_ws.iter_mut().find(|(ws, _)| ws == target) {
            set.insert(v.reason.clone());
        }
    }
    by_ws
}

/// Native fix-поверхня `tauri/updater` — обʼєднує чотири T0-патерни канону
/// в один [`FixPlan`] (доккомент модуля).
pub(crate) fn tauri_updater_fix(
    cwd: &Path,
    violations: &[Violation],
) -> Result<FixPlan, RulesError> {
    let interesting = any_reason(violations, &PKG_REASONS)
        || any_reason(violations, &CARGO_REASONS)
        || any_reason(violations, &CAPABILITY_REASONS)
        || any_reason(violations, &["lib-rs-updater-not-guarded"]);
    if !interesting {
        return Ok(FixPlan::default());
    }

    let apps = find_tauri_app_workspaces(cwd);
    let mut edits = Vec::new();

    if any_reason(violations, &PKG_REASONS) {
        for ws in &apps {
            edits.extend(fix_package_json(cwd, ws)?);
        }
    }
    if any_reason(violations, &CARGO_REASONS) {
        for ws in &apps {
            edits.extend(fix_cargo_toml(cwd, ws)?);
        }
    }
    if any_reason(violations, &["lib-rs-updater-not-guarded"]) {
        for ws in &apps {
            edits.extend(fix_lib_rs_guard(cwd, ws)?);
        }
    }
    if any_reason(violations, &CAPABILITY_REASONS) {
        let by_ws = group_reasons_by_workspace(violations, &apps);
        for (ws, reasons) in &by_ws {
            edits.extend(fix_capabilities(cwd, ws, reasons)?);
        }
    }

    Ok(FixPlan { edits })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Severity;

    fn violation(reason: &str, file: Option<&str>) -> Violation {
        Violation {
            reason: reason.to_string(),
            message: "m".to_string(),
            file: file.map(str::to_string),
            severity: Severity::Error,
            data: None,
        }
    }

    /// Мінімальний Tauri-репо-скелет у корені (`ws == "."`).
    fn scaffold(dir: &Path) {
        std::fs::create_dir_all(dir.join("src-tauri/src")).unwrap();
        std::fs::create_dir_all(dir.join("src-tauri/capabilities")).unwrap();
        std::fs::write(dir.join("src-tauri/tauri.conf.json"), "{}").unwrap();
        std::fs::write(dir.join("package.json"), "{\n  \"name\": \"app\"\n}\n").unwrap();
    }

    fn content_of(plan: &FixPlan, path: &str) -> String {
        for edit in &plan.edits {
            if let FileEdit::Write(w) = edit {
                if w.path == path {
                    return w.content.clone();
                }
            }
        }
        panic!("у плані немає запису для {path}: {plan:?}");
    }

    #[test]
    fn empty_plan_without_matching_violations() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        assert!(tauri_updater_fix(tmp.path(), &[]).unwrap().edits.is_empty());
        assert!(
            tauri_updater_fix(tmp.path(), &[violation("use-updater-not-called", None)])
                .unwrap()
                .edits
                .is_empty()
        );
    }

    #[test]
    fn package_json_gets_canonical_deps() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        let plan = tauri_updater_fix(
            tmp.path(),
            &[violation("plugin-updater-missing", Some("package.json"))],
        )
        .unwrap();
        let text = content_of(&plan, "package.json");
        let doc = parse_jsonc_document(&text).unwrap();
        let deps = doc.get("dependencies").unwrap();
        assert_eq!(
            deps.get("@tauri-apps/plugin-updater")
                .and_then(Json::as_str),
            Some("^2")
        );
        assert_eq!(
            deps.get("@tauri-apps/plugin-process")
                .and_then(Json::as_str),
            Some("^2")
        );
        assert_eq!(
            deps.get("@7n/tauri-components").and_then(Json::as_str),
            Some("^0.8.0")
        );
        assert_eq!(doc.get("name").and_then(Json::as_str), Some("app"));
    }

    /// Полагоджений дефект канону №1: застаріла версія в `devDependencies`
    /// затінювала щойно записану — фікс не сходився ніколи.
    #[test]
    fn stale_dev_dependency_is_updated_in_place() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"devDependencies":{"@tauri-apps/plugin-updater":"^1"}}"#,
        )
        .unwrap();
        let plan = tauri_updater_fix(
            tmp.path(),
            &[violation("plugin-updater-missing", Some("package.json"))],
        )
        .unwrap();
        let doc = parse_jsonc_document(&content_of(&plan, "package.json")).unwrap();
        assert_eq!(
            doc.get("devDependencies")
                .and_then(|d| d.get("@tauri-apps/plugin-updater"))
                .and_then(Json::as_str),
            Some("^2"),
            "канон мав приземлитись у ту саму секцію, яку читає детектор"
        );
        assert!(
            doc.get("dependencies")
                .and_then(|d| d.get("@tauri-apps/plugin-updater"))
                .is_none(),
            "дубля в dependencies бути не має"
        );
    }

    #[test]
    fn package_json_canonical_is_noop() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"dependencies":{"@7n/tauri-components":"^0.9.0","@tauri-apps/plugin-updater":"^2","@tauri-apps/plugin-process":"^2"}}"#,
        )
        .unwrap();
        let plan = tauri_updater_fix(
            tmp.path(),
            &[violation("plugin-updater-missing", Some("package.json"))],
        )
        .unwrap();
        assert!(plan.edits.is_empty(), "{plan:?}");
    }

    #[test]
    fn cargo_toml_appends_process_and_desktop_scoped_updater() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        std::fs::write(
            tmp.path().join("src-tauri/Cargo.toml"),
            "[package]\nname = \"app\"\n\n[dependencies]\ntauri = \"2\"\n",
        )
        .unwrap();
        let plan = tauri_updater_fix(
            tmp.path(),
            &[violation(
                "cargo-plugin-updater-missing",
                Some("src-tauri/Cargo.toml"),
            )],
        )
        .unwrap();
        let text = content_of(&plan, "src-tauri/Cargo.toml");
        assert!(text.contains("tauri = \"2\""), "{text}");
        assert!(text.contains(CARGO_PROCESS_LINE), "{text}");
        assert!(
            text.contains(&format!("[{CARGO_DESKTOP_TARGET_HEADER}]")),
            "{text}"
        );
        assert!(text.contains(CARGO_UPDATER_LINE), "{text}");
    }

    #[test]
    fn cargo_toml_moves_unscoped_updater_into_desktop_section() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        std::fs::write(
            tmp.path().join("src-tauri/Cargo.toml"),
            "[dependencies]\ntauri-plugin-process = \"2.3.1\"\ntauri-plugin-updater = \"2.1.0\"\n",
        )
        .unwrap();
        let plan = tauri_updater_fix(
            tmp.path(),
            &[violation(
                "cargo-plugin-updater-not-scoped",
                Some("src-tauri/Cargo.toml"),
            )],
        )
        .unwrap();
        let text = content_of(&plan, "src-tauri/Cargo.toml");
        let desktop_idx = text
            .find(&format!("[{CARGO_DESKTOP_TARGET_HEADER}]"))
            .expect("desktop-секція");
        let updater_idx = text.find("tauri-plugin-updater").expect("рядок updater");
        assert!(updater_idx > desktop_idx, "{text}");
        assert_eq!(text.matches("tauri-plugin-updater").count(), 1, "{text}");
        // Версію рядка збережено (перенесення, не заміна канонічним літералом).
        assert!(text.contains("2.1.0"), "{text}");
    }

    #[test]
    fn lib_rs_guard_inserted_above_existing_registration() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        std::fs::write(
            tmp.path().join("src-tauri/src/lib.rs"),
            "pub fn run() {\n    let b = tauri::Builder::default();\n    let b = b.plugin(tauri_plugin_updater::Builder::new().build());\n}\n",
        )
        .unwrap();
        let plan = tauri_updater_fix(
            tmp.path(),
            &[violation(
                "lib-rs-updater-not-guarded",
                Some("src-tauri/src/lib.rs"),
            )],
        )
        .unwrap();
        let text = content_of(&plan, "src-tauri/src/lib.rs");
        assert!(
            text.contains("    #[cfg(desktop)]\n    let b = b.plugin(tauri_plugin_updater"),
            "{text}"
        );
    }

    #[test]
    fn lib_rs_guard_is_idempotent() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        std::fs::write(
            tmp.path().join("src-tauri/src/lib.rs"),
            "pub fn run() {\n    #[cfg(desktop)]\n    let b = b.plugin(tauri_plugin_updater::Builder::new().build());\n}\n",
        )
        .unwrap();
        let plan = tauri_updater_fix(
            tmp.path(),
            &[violation(
                "lib-rs-updater-not-guarded",
                Some("src-tauri/src/lib.rs"),
            )],
        )
        .unwrap();
        assert!(plan.edits.is_empty(), "{plan:?}");
    }

    #[test]
    fn capabilities_created_and_merged() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        std::fs::write(
            tmp.path().join("src-tauri/capabilities/default.json"),
            r#"{"identifier":"default","permissions":["core:default"]}"#,
        )
        .unwrap();
        let plan = tauri_updater_fix(
            tmp.path(),
            &[
                violation("capability-updater-missing", None),
                violation("capability-process-restart-missing", None),
            ],
        )
        .unwrap();

        let updater =
            parse_jsonc_document(&content_of(&plan, "src-tauri/capabilities/updater.json"))
                .unwrap();
        assert_eq!(
            updater.get("permissions").and_then(Json::as_array),
            Some(&[Json::Str("updater:default".to_string())][..])
        );

        let default =
            parse_jsonc_document(&content_of(&plan, "src-tauri/capabilities/default.json"))
                .unwrap();
        assert_eq!(
            default.get("permissions").and_then(Json::as_array),
            Some(
                &[
                    Json::Str("core:default".to_string()),
                    Json::Str("process:allow-restart".to_string())
                ][..]
            )
        );
    }

    /// Полагоджений дефект канону №2: побитий capability більше не мовчить.
    #[test]
    fn broken_capability_json_is_loud() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        std::fs::write(
            tmp.path().join("src-tauri/capabilities/default.json"),
            "{ not json",
        )
        .unwrap();
        let err = tauri_updater_fix(
            tmp.path(),
            &[violation("capability-process-restart-missing", None)],
        )
        .unwrap_err();
        assert!(
            format!("{err}").contains("default.json"),
            "помилка має називати файл: {err}"
        );
    }

    /// Полагоджений дефект №3: JSONC-коментар більше не робить фікс no-op.
    #[test]
    fn jsonc_capability_is_parsed() {
        let tmp = tempfile::TempDir::new().unwrap();
        scaffold(tmp.path());
        std::fs::write(
            tmp.path().join("src-tauri/capabilities/default.json"),
            "{\n  // локальний коментар\n  \"permissions\": [\"core:default\"]\n}\n",
        )
        .unwrap();
        let plan = tauri_updater_fix(
            tmp.path(),
            &[violation("capability-process-restart-missing", None)],
        )
        .unwrap();
        let doc = parse_jsonc_document(&content_of(&plan, "src-tauri/capabilities/default.json"))
            .unwrap();
        assert_eq!(
            doc.get("permissions")
                .and_then(Json::as_array)
                .unwrap()
                .len(),
            2
        );
    }
}
