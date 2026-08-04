//! Native-порт `capacitor/platforms` (`npm/rules/capacitor/platforms/main.mjs`,
//! 490 рядків) — capacitor.mdc: `@capacitor/core` не молодша за
//! `MIN_CAPACITOR_MAJOR`, iOS без CocoaPods (`Podfile`) поза `nitra`-винятком.
//!
//! # Власний парсер npm semver-діапазонів
//!
//! JS-версія НЕ використовує пакет `semver` — власний мінімалістичний парсер
//! нижньої межі мажорної версії (`capacitorSegmentMinMajor` +
//! `capacitorVersionRangeMinMajor`), що підтримує лише те, що реально
//! трапляється в `package.json` цього репо: `^`/`~`/`=`-префікси, `>`/`>=`/`<`/`<=`,
//! hyphen-range (`a - b`), `||`-обʼєднання, `workspace:`-протокол (завжди `Infinity`
//! — прийнятний), `*`/`x`/`latest` (невідомо → `null`). Тут — **буквальний**
//! порт того самого парсера (не `semver`-крейт): parity з JS важливіша за
//! використання стандартного semver-двигуна, який трактує крайні випадки
//! (наприклад, порожній рядок після оператора) інакше.
//!
//! `Option<f64>` — заміна JS `number | null`, з `f64::INFINITY` замість
//! `Infinity` (`workspace:`-гілка); порівняння `>=` між `f64` і звичайним
//! мажором працює так само, як і в JS.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::diagnostics::{Severity, Violation};

/// Мінімальна допустима мажорна версія Capacitor (capacitor.mdc) — точний
/// порт `MIN_CAPACITOR_MAJOR` (`main.mjs:9`).
const MIN_CAPACITOR_MAJOR: f64 = 8.0;

/// Стабільний reason для всіх violations цього concern-а — дефолтний
/// `ctx.concernId` JS-reporter-а; жоден `fail()`-виклик у `main.mjs` не
/// передає явний reason, тож усі падіння звітуються з reason-ом самого
/// concern-а (`capacitor/platforms`).
const REASON: &str = "platforms";

fn fail(message: impl Into<String>) -> Violation {
    Violation {
        reason: REASON.to_string(),
        message: message.into(),
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Каталоги, що пропускаються при пошуку `package.json` — точний порт
/// `IGNORED_DIRS_FOR_PACKAGE_JSON` (`main.mjs:12-21`).
const IGNORED_DIRS_FOR_PACKAGE_JSON: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "coverage",
    "Pods",
    ".turbo",
    ".next",
    "build",
];

/// Один whitespace-символ (`\s` JS-класу — Unicode whitespace, той самий
/// набір, що й `char::is_whitespace`).
fn is_ws(c: char) -> bool {
    c.is_whitespace()
}

/// Ліва межа npm hyphen-діапазону `low - high` — точний порт
/// `npmHyphenRangeLeft` (`main.mjs:39-58`): перша поява `<ws>-<ws>` лінійним
/// пошуком (без backtracking), розширена на суміжні пробіли з обох боків.
fn npm_hyphen_range_left(s: &str) -> Option<String> {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut match_start = None;
    let mut i = 0;
    while i + 2 < n {
        if is_ws(chars[i]) && chars[i + 1] == '-' && is_ws(chars[i + 2]) {
            match_start = Some(i);
            break;
        }
        i += 1;
    }
    let start0 = match_start?;
    let mut start = start0;
    while start > 0 && is_ws(chars[start - 1]) {
        start -= 1;
    }
    let mut end = start0 + 3;
    while end < n && is_ws(chars[end]) {
        end += 1;
    }
    let left: String = chars[..start].iter().collect();
    let right: String = chars[end..].iter().collect();
    if left.is_empty() || right.is_empty() {
        return None;
    }
    Some(left)
}

/// Витягує **major** з першого числа у вигляді `X`/`X.Y`/`X.Y.Z` (опційно `v`)
/// — точний порт `firstVersionMajorFromNpmValue` (`main.mjs:119-129`).
fn first_version_major_from_npm_value(t: &str) -> Option<f64> {
    let s = t.trim();
    if s.is_empty() {
        return None;
    }
    let rest = if s.starts_with('v') || s.starts_with('V') {
        &s[1..]
    } else {
        s
    };
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<f64>().ok()
}

/// Мінімальний **major** для однієї OR-частини npm-діапазону (без `||`
/// усередині) — точний порт `capacitorSegmentMinMajor` (`main.mjs:80-112`).
/// `Some(f64::INFINITY)` — `workspace:`-протокол (завжди прийнятний).
pub fn capacitor_segment_min_major(segment: &str) -> Option<f64> {
    let s0 = segment.trim();
    if s0.is_empty() {
        return None;
    }
    let low = s0.to_lowercase();
    if low.starts_with("workspace:") {
        return Some(f64::INFINITY);
    }
    if s0 == "*" || low == "x" || low == "latest" {
        return None;
    }
    if s0.starts_with('<') {
        // покриває і `<=` (обидва почитаються з '<').
        return Some(0.0);
    }
    if s0.starts_with('>') && !s0.starts_with(">=") {
        return first_version_major_from_npm_value(s0[1..].trim_start());
    }
    if let Some(hyphen_left) = npm_hyphen_range_left(s0) {
        return first_version_major_from_npm_value(hyphen_left.trim());
    }
    if s0.starts_with('^') || s0.starts_with('~') || s0.starts_with('=') {
        let stripped = s0.trim_start_matches(['=', '^', '~']);
        return first_version_major_from_npm_value(stripped.trim_start());
    }
    if let Some(rest) = s0.strip_prefix(">=") {
        return first_version_major_from_npm_value(rest.trim_start());
    }
    first_version_major_from_npm_value(s0)
}

/// Мінімальна можлива (нижня) **major**-версія для повного npm-діапазону,
/// у т. ч. з `||` — точний порт `capacitorVersionRangeMinMajor`
/// (`main.mjs:136-152`).
pub fn capacitor_version_range_min_major(version_range: &str) -> Option<f64> {
    let mut overall_min: Option<f64> = None;
    for part in version_range.split("||") {
        let m = capacitor_segment_min_major(part)?;
        overall_min = Some(match overall_min {
            Some(cur) if cur <= m => cur,
            _ => m,
        });
    }
    overall_min
}

/// `true`, якщо нижня межа діапазону `>= min` — точний порт
/// `isCapacitorCoreVersionAtLeast8` (`main.mjs:159-165`).
pub fn is_capacitor_core_version_at_least(version_range: &str, min: f64) -> bool {
    match capacitor_version_range_min_major(version_range) {
        None => false,
        Some(low) => low >= min,
    }
}

/// Накопичувач `@capacitor/core`-версій по `package.json` дерева — точний
/// порт акумулятора `{ byPath, anyCapacitor }` (`main.mjs:187,206,234`).
#[derive(Debug, Default)]
struct CapacitorAcc {
    by_path: Vec<(String, String)>,
    any_capacitor: bool,
}

/// Posix-relative шлях від `root`, лексично (без звернень до диска) — той
/// самий `replaceAll('\\','/')`-конвертер, що й в інших native-концернах.
fn to_relative_posix(root: &Path, abs: &Path) -> String {
    let rel = abs.strip_prefix(root).unwrap_or(abs);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Записує `@capacitor/*`-залежності з одного `dependencies`/... обʼєкта —
/// точний порт `recordCapacitorFromDependencyObject` (`main.mjs:189-198`).
fn record_capacitor_from_dependency_object(
    rel: &str,
    obj: &serde_json::Map<String, serde_json::Value>,
    out: &mut CapacitorAcc,
) {
    for (name, val) in obj {
        if name.starts_with("@capacitor/") {
            out.any_capacitor = true;
        }
        if name == "@capacitor/core" {
            if let Some(s) = val.as_str() {
                if !s.is_empty() {
                    out.by_path.push((rel.to_string(), s.to_string()));
                }
            }
        }
    }
}

/// Обробляє один `package.json`: читає, парсить, накопичує `@capacitor/*` —
/// точний порт `recordCapacitorFromOnePackageJson` (`main.mjs:206-226`).
/// Fail-safe: read/parse-помилка → тихо повертається (той самий видимий
/// ефект, що й JS `try/catch`).
fn record_capacitor_from_one_package_json(abs_path: &Path, root: &Path, out: &mut CapacitorAcc) {
    let Ok(raw) = std::fs::read_to_string(abs_path) else {
        return;
    };
    let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let rel_computed = to_relative_posix(root, abs_path);
    let rel = if rel_computed.is_empty() {
        abs_path.to_string_lossy().replace('\\', "/")
    } else {
        rel_computed
    };
    for block in [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
    ] {
        if let Some(obj) = pkg.get(block).and_then(|v| v.as_object()) {
            record_capacitor_from_dependency_object(&rel, obj, out);
        }
    }
}

/// Рекурсивний обхід дерева для збору `package.json`, пропускаючи
/// [`IGNORED_DIRS_FOR_PACKAGE_JSON`] — точний порт внутрішньої `walk`
/// (`main.mjs:246-261`). Fail-safe: недоступний каталог → тихо
/// пропускається. Записи сортуються за іменем для детермінізму (JS-порядок
/// `readdir` платформозалежний і не спостерігається тестами).
fn walk_for_package_json(root: &Path, dir: &Path, out: &mut CapacitorAcc) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut items: Vec<_> = entries.filter_map(Result::ok).collect();
    items.sort_by_key(std::fs::DirEntry::file_name);
    for entry in items {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        let path = entry.path();
        if is_dir && !IGNORED_DIRS_FOR_PACKAGE_JSON.contains(&name.as_str()) {
            walk_for_package_json(root, &path, out);
        } else if is_file && name == "package.json" {
            record_capacitor_from_one_package_json(&path, root, out);
        }
    }
}

/// Зчитує всі `package.json` з дерева — точний порт
/// `collectCapacitorDataFromAllPackageJson` (`main.mjs:234-264`).
fn collect_capacitor_data_from_all_package_json(root: &Path) -> CapacitorAcc {
    let mut out = CapacitorAcc::default();
    walk_for_package_json(root, root, &mut out);
    out
}

/// `true`, якщо `capacitor.config.{json,ts,mjs}` існує в корені — точний
/// порт `hasCapacitorConfigInRoot` (`main.mjs:270-276`).
pub fn has_capacitor_config_in_root(root: &Path) -> bool {
    root.join("capacitor.config.json").exists()
        || root.join("capacitor.config.ts").exists()
        || root.join("capacitor.config.mjs").exists()
}

/// Чи варто застосовувати правило — точний порт `isCapacitorRelevantForCheck`
/// (`main.mjs:284-286`).
pub fn is_capacitor_relevant_for_check(root: &Path, any_capacitor: bool) -> bool {
    has_capacitor_config_in_root(root) || any_capacitor
}

/// Рекурсивно шукає перший `Podfile` в `dir`, не заходячи в `Pods`/`build`/
/// `DerivedData` — точний порт `walkIosForPodfileSkipPods` (`main.mjs:295-318`).
/// Зупиняється на першій знахідці (short-circuit, той самий `return true`
/// нагору по стеку, що й у JS). Fail-safe: недоступний каталог → `false`.
fn walk_ios_for_podfile_skip_pods(
    root: &Path,
    dir: &Path,
    on_podfile: &mut impl FnMut(String),
) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let mut items: Vec<_> = entries.filter_map(Result::ok).collect();
    items.sort_by_key(std::fs::DirEntry::file_name);
    for entry in items {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "Pods" || name == "build" || name == "DerivedData" {
            continue;
        }
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let path = entry.path();
        if is_file && name == "Podfile" {
            on_podfile(to_relative_posix(root, &path));
            return true;
        } else if is_dir && walk_ios_for_podfile_skip_pods(root, &path, on_podfile) {
            return true;
        }
    }
    false
}

/// Знаходить перший `Podfile` під `ios/`, поза `Pods/` — точний порт
/// `findFirstPodfileUnderIosExcludingPods` (`main.mjs:324-336`).
pub fn find_first_podfile_under_ios_excluding_pods(root: &Path) -> Option<String> {
    let ios_dir = root.join("ios");
    if !ios_dir.exists() {
        return None;
    }
    let mut first: Option<String> = None;
    walk_ios_for_podfile_skip_pods(root, &ios_dir, &mut |rel| {
        if first.as_ref().is_none_or(|f| rel.len() < f.len()) {
            first = Some(rel);
        }
    });
    first
}

/// Чи `nitra`-обʼєкт (з `package.json`/`capacitor.config`) дозволяє Podfile
/// (CocoaPods) на iOS — точний порт `nitrAObjectAllowsIosCocoaPods`
/// (`main.mjs:344-353`).
pub fn nitra_object_allows_ios_cocoa_pods(o: &serde_json::Value) -> bool {
    let Some(obj) = o.as_object() else {
        return false;
    };
    if obj.get("iosCocoaPodsBecausePluginsLackSpm") == Some(&serde_json::Value::Bool(true)) {
        return true;
    }
    obj.get("iosCocoaPodsAllowed") == Some(&serde_json::Value::Bool(true))
}

/// Початок блока `nitra: {` у `.ts`/`.mjs` (capacitor.config) — точний порт
/// `RE_NITRA_CONFIG_OBJECT_LEAD_IN` (`main.mjs:69`).
static RE_NITRA_LEAD_IN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"\bnitra\b\s*:\s*\{|['"]nitra['"]\s*:\s*\{"#).expect("valid regex")
});

static RE_COCOAPODS_EXEMPT_SPM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\biosCocoaPodsBecausePluginsLackSpm\s*:\s*true\b").expect("valid regex")
});
static RE_COCOAPODS_EXEMPT_ALLOW: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\biosCocoaPodsAllowed\s*:\s*true\b").expect("valid regex"));

/// Витягає вихідний текст тіла `{ ... }` після `nitra:`/`"nitra":` (перша
/// відповідність, баланс фігурних дужок) — точний порт
/// `extractNitraObjectBodySource` (`main.mjs:361-380`).
fn extract_nitra_object_body_source(source: &str) -> Option<String> {
    let m = RE_NITRA_LEAD_IN.find(source)?;
    let open_brace = m.end() - 1;
    let mut depth = 0i32;
    for (idx, ch) in source[open_brace..].char_indices() {
        if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                let end = open_brace + idx;
                return Some(source[open_brace..=end].to_string());
            }
        }
    }
    None
}

/// Чи тіло obʼєкта `nitra` містить дозвіл CocoaPods-винятку — точний порт
/// `nitraObjectBodyStringAllowsCocoaPodsExempt` (`main.mjs:386-388`).
fn nitra_object_body_string_allows_cocoa_pods_exempt(object_body: &str) -> bool {
    RE_COCOAPODS_EXEMPT_SPM.is_match(object_body) || RE_COCOAPODS_EXEMPT_ALLOW.is_match(object_body)
}

/// Чи `obj.nitra` у JSON-файлі — валідний виняток — точний порт
/// `pathJsonShowsNitraCocoapodsExempt` (`main.mjs:394-405`). Fail-safe:
/// відсутній/невалідний JSON → `false`.
fn path_json_shows_nitra_cocoapods_exempt(abs_path: &Path) -> bool {
    if !abs_path.exists() {
        return false;
    }
    let Ok(raw) = std::fs::read_to_string(abs_path) else {
        return false;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    json.get("nitra")
        .map(nitra_object_allows_ios_cocoa_pods)
        .unwrap_or(false)
}

/// Чи `.ts`/`.mjs` capacitor-конфіг містить валідний виняток `nitra` —
/// точний порт `capacitorConfigTsMjsNitraCocoapodsExempt` (`main.mjs:411-423`).
fn capacitor_config_ts_mjs_nitra_cocoapods_exempt(root: &Path) -> bool {
    for name in ["capacitor.config.ts", "capacitor.config.mjs"] {
        let p = root.join(name);
        if p.exists() {
            let Ok(text) = std::fs::read_to_string(&p) else {
                continue;
            };
            if let Some(body) = extract_nitra_object_body_source(&text) {
                if nitra_object_body_string_allows_cocoa_pods_exempt(&body) {
                    return true;
                }
            }
        }
    }
    false
}

/// Чи Podfile виправданий `nitra`-конфігом (package.json/capacitor.config.json/ts/mjs)
/// — точний порт `isIosCocoaPodsExemptByNitraConfig` (`main.mjs:429-437`).
fn is_ios_cocoa_pods_exempt_by_nitra_config(root: &Path) -> bool {
    if path_json_shows_nitra_cocoapods_exempt(&root.join("package.json")) {
        return true;
    }
    if path_json_shows_nitra_cocoapods_exempt(&root.join("capacitor.config.json")) {
        return true;
    }
    capacitor_config_ts_mjs_nitra_cocoapods_exempt(root)
}

/// Detector `capacitor/platforms` — точний порт `lint(ctx)` (`main.mjs:444-490`).
pub fn capacitor_platforms(cwd: &Path) -> Vec<Violation> {
    let mut violations = Vec::new();

    let acc = collect_capacitor_data_from_all_package_json(cwd);

    if !is_capacitor_relevant_for_check(cwd, acc.any_capacitor) {
        return violations;
    }

    if acc.by_path.is_empty() {
        violations.push(fail(format!(
            "додай залежність @capacitor/core з діапазоном ^{min}.0.0 (або іншим, сумісним лише з {min}+) у package.json (capacitor.mdc)",
            min = MIN_CAPACITOR_MAJOR as u32
        )));
    } else {
        for (rel, range) in &acc.by_path {
            if !is_capacitor_core_version_at_least(range, MIN_CAPACITOR_MAJOR) {
                violations.push(fail(format!(
                    "«{rel}»: @capacitor/core «{range}» — мінімальна допустима мажорна версія Capacitor {min} (capacitor.mdc). Вкажи, наприклад, ^{min}.0.0",
                    min = MIN_CAPACITOR_MAJOR as u32
                )));
            }
        }
    }

    if let Some(podfile_rel) = find_first_podfile_under_ios_excluding_pods(cwd) {
        if !is_ios_cocoa_pods_exempt_by_nitra_config(cwd) {
            violations.push(fail(format!(
                "iOS: знайдено Podfile «{podfile_rel}» — для Capacitor використовуй лише SPM, без CocoaPods, або додай виняток nitra (capacitor.mdc)"
            )));
        }
    }

    violations
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    fn write_json(tmp: &TempDir, rel: &str, value: serde_json::Value) {
        write(tmp, rel, &value.to_string());
    }

    // --- capacitor_segment_min_major / capacitor_version_range_min_major ---

    #[test]
    fn caret_8_is_ok() {
        assert!(is_capacitor_core_version_at_least(
            "^8.0.0",
            MIN_CAPACITOR_MAJOR
        ));
    }

    #[test]
    fn caret_7_is_not_ok() {
        assert!(!is_capacitor_core_version_at_least(
            "^7.0.0",
            MIN_CAPACITOR_MAJOR
        ));
    }

    #[test]
    fn star_is_not_ok() {
        assert!(!is_capacitor_core_version_at_least(
            "*",
            MIN_CAPACITOR_MAJOR
        ));
    }

    #[test]
    fn or_with_lower_bound_is_not_ok() {
        assert!(!is_capacitor_core_version_at_least(
            "^7.0.0 || ^8.0.0",
            MIN_CAPACITOR_MAJOR
        ));
    }

    #[test]
    fn caret_9_is_ok() {
        assert!(is_capacitor_core_version_at_least(
            "^9.0.0",
            MIN_CAPACITOR_MAJOR
        ));
    }

    #[test]
    fn nitra_object_allows_flags() {
        assert!(nitra_object_allows_ios_cocoa_pods(
            &serde_json::json!({ "iosCocoaPodsBecausePluginsLackSpm": true })
        ));
        assert!(nitra_object_allows_ios_cocoa_pods(
            &serde_json::json!({ "iosCocoaPodsAllowed": true })
        ));
        assert!(!nitra_object_allows_ios_cocoa_pods(&serde_json::json!({})));
        assert!(!nitra_object_allows_ios_cocoa_pods(
            &serde_json::Value::Null
        ));
    }

    #[test]
    fn range_with_upper_bound() {
        assert_eq!(
            capacitor_version_range_min_major(">=8.0.0 <9.0.0"),
            Some(8.0)
        );
    }

    #[test]
    fn star_segment_is_none() {
        assert_eq!(capacitor_segment_min_major("*"), None);
    }

    #[test]
    fn workspace_star_is_infinity() {
        assert_eq!(
            capacitor_segment_min_major("workspace:*"),
            Some(f64::INFINITY)
        );
    }

    #[test]
    fn workspace_star_range_is_ok() {
        assert!(is_capacitor_core_version_at_least(
            "workspace:*",
            MIN_CAPACITOR_MAJOR
        ));
    }

    #[test]
    fn workspace_caret_8_is_ok() {
        assert!(is_capacitor_core_version_at_least(
            "workspace:^8.0.0",
            MIN_CAPACITOR_MAJOR
        ));
    }

    #[test]
    fn segment_edge_cases() {
        assert_eq!(capacitor_segment_min_major(">   "), None);
        assert_eq!(capacitor_segment_min_major(">xyz"), None);
        assert_eq!(capacitor_segment_min_major(""), None);
        assert_eq!(capacitor_segment_min_major("x"), None);
        assert_eq!(capacitor_segment_min_major("latest"), None);
        assert_eq!(capacitor_segment_min_major("<8.0.0"), Some(0.0));
        assert_eq!(capacitor_segment_min_major("<=7.0.0"), Some(0.0));
        assert_eq!(capacitor_segment_min_major(">7.0.0"), Some(7.0));
        assert_eq!(capacitor_segment_min_major("7.0.0 - 9.0.0"), Some(7.0));
        assert_eq!(capacitor_segment_min_major("~8.0.0"), Some(8.0));
        assert_eq!(capacitor_segment_min_major("=8.0.0"), Some(8.0));
        assert_eq!(capacitor_segment_min_major("8.0.0"), Some(8.0));
    }

    /// Живий A/B-звірений набір (`v`/`V`-префікс, plain major, `||`-обʼєднання
    /// з `workspace:`) супроти JS `main.mjs` перед видаленням — parity-check.
    #[test]
    fn segment_edge_cases_v_prefix_and_or_with_workspace() {
        assert_eq!(capacitor_segment_min_major("v8.0.0"), Some(8.0));
        assert_eq!(capacitor_segment_min_major("V9.0.0"), Some(9.0));
        assert_eq!(capacitor_segment_min_major("10.2.3"), Some(10.0));
        assert_eq!(
            capacitor_version_range_min_major("^8.0.0 || ^7.0.0"),
            Some(7.0)
        );
        assert_eq!(
            capacitor_version_range_min_major("workspace:* || ^7.0.0"),
            Some(7.0)
        );
    }

    // --- record_capacitor_from_one_package_json / collect ---

    #[test]
    fn missing_package_json_is_silently_skipped() {
        let acc = &mut CapacitorAcc::default();
        record_capacitor_from_one_package_json(
            Path::new("/nonexistent/package.json"),
            Path::new("/"),
            acc,
        );
        assert!(!acc.any_capacitor);
        assert!(acc.by_path.is_empty());
    }

    #[test]
    fn invalid_json_package_json_is_silently_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "not json at all");
        let acc = &mut CapacitorAcc::default();
        record_capacitor_from_one_package_json(&tmp.path().join("package.json"), tmp.path(), acc);
        assert!(!acc.any_capacitor);
    }

    #[test]
    fn collect_walks_nested_package_json() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        let acc = collect_capacitor_data_from_all_package_json(tmp.path());
        assert!(acc.any_capacitor);
        assert_eq!(acc.by_path.len(), 1);
    }

    #[test]
    fn collect_on_missing_dir_is_empty() {
        let acc =
            collect_capacitor_data_from_all_package_json(Path::new("/nonexistent-dir-xyz-123456"));
        assert!(!acc.any_capacitor);
        assert!(acc.by_path.is_empty());
    }

    // --- findFirstPodfileUnderIosExcludingPods / walk ---

    #[test]
    fn no_ios_dir_yields_none() {
        let tmp = TempDir::new().unwrap();
        assert!(find_first_podfile_under_ios_excluding_pods(tmp.path()).is_none());
    }

    #[test]
    fn detects_ios_podfile() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "ios/Podfile", "platform :ios, '16'\n");
        assert_eq!(
            find_first_podfile_under_ios_excluding_pods(tmp.path()),
            Some("ios/Podfile".to_string())
        );
    }

    #[test]
    fn podfile_under_pods_is_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "ios/Pods/Podfile", "pod 'AFNetworking'\n");
        assert!(find_first_podfile_under_ios_excluding_pods(tmp.path()).is_none());
    }

    #[test]
    fn podfile_under_build_is_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "ios/build/Podfile", "pod\n");
        let mut found: Option<String> = None;
        walk_ios_for_podfile_skip_pods(tmp.path(), &tmp.path().join("ios"), &mut |rel| {
            found = Some(rel);
        });
        assert!(found.is_none());
    }

    #[test]
    fn walk_on_nonexistent_dir_returns_false() {
        let tmp = TempDir::new().unwrap();
        let found = walk_ios_for_podfile_skip_pods(
            tmp.path(),
            &tmp.path().join("nonexistent"),
            &mut |_| {},
        );
        assert!(!found);
    }

    #[test]
    fn podfile_in_subdirectory_found_recursively() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "ios/App/Podfile", "platform :ios, '16'\n");
        let mut found_rel: Option<String> = None;
        let result =
            walk_ios_for_podfile_skip_pods(tmp.path(), &tmp.path().join("ios"), &mut |rel| {
                found_rel = Some(rel);
            });
        assert!(result);
        assert_eq!(found_rel, Some("ios/App/Podfile".to_string()));
    }

    // --- check (integration via capacitor_platforms) ---

    #[test]
    fn not_capacitor_project_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true }),
        );
        assert!(capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn capacitor_core_8_without_ios_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        assert!(capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn capacitor_core_7_is_violation() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^7.0.0" } }),
        );
        assert!(!capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn config_json_without_capacitor_core_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "capacitor.config.json", "{}\n");
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true }),
        );
        assert!(!capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn ios_podfile_without_exemption_is_violation() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        write(&tmp, "ios/Podfile", "platform :ios, '15.0'\n");
        assert!(!capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn ios_podfile_with_package_json_nitra_exemption_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({
                "name": "x", "private": true,
                "dependencies": { "@capacitor/core": "^8.0.0" },
                "nitra": { "iosCocoaPodsBecausePluginsLackSpm": true }
            }),
        );
        write(&tmp, "ios/Podfile", "platform :ios, '15.0'\n");
        assert!(capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn ios_podfile_with_capacitor_config_mjs_exemption_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        write(
            &tmp,
            "capacitor.config.mjs",
            "const c = { appId: \"a\", nitra: { iosCocoaPodsBecausePluginsLackSpm: true } }\nexport default c\n",
        );
        write(&tmp, "ios/Podfile", "platform :ios, '15.0'\n");
        assert!(capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn ios_without_podfile_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        write(&tmp, "ios/App/Info.plist", "<?xml version=\"1.0\"?>\n");
        assert!(capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn nitra_exemption_in_capacitor_config_json() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        write_json(
            &tmp,
            "capacitor.config.json",
            serde_json::json!({ "nitra": { "iosCocoaPodsAllowed": true } }),
        );
        write(&tmp, "ios/Podfile", "platform :ios, '15.0'\n");
        assert!(capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn nitra_exemption_in_capacitor_config_ts() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        write(
            &tmp,
            "capacitor.config.ts",
            "export default { appId: \"a\", nitra: { iosCocoaPodsAllowed: true } }\n",
        );
        write(&tmp, "ios/Podfile", "platform :ios, '15.0'\n");
        assert!(capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn capacitor_config_ts_without_nitra_is_violation() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        write(
            &tmp,
            "capacitor.config.ts",
            "export default { appId: \"a\" }\n",
        );
        write(&tmp, "ios/Podfile", "platform :ios, '15.0'\n");
        assert!(!capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn capacitor_config_ts_unclosed_brace_is_violation() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        write(
            &tmp,
            "capacitor.config.ts",
            "export default { appId: \"a\", nitra: { iosCocoaPodsAllowed: true\n",
        );
        write(&tmp, "ios/Podfile", "platform :ios, '15.0'\n");
        assert!(!capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn capacitor_config_json_invalid_is_violation() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^8.0.0" } }),
        );
        write(&tmp, "capacitor.config.json", "{ broken json");
        write(&tmp, "ios/Podfile", "platform :ios, '15.0'\n");
        assert!(!capacitor_platforms(tmp.path()).is_empty());
    }

    #[test]
    fn all_violations_use_platforms_reason() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "x", "private": true, "dependencies": { "@capacitor/core": "^7.0.0" } }),
        );
        for v in capacitor_platforms(tmp.path()) {
            assert_eq!(v.reason, "platforms");
            assert!(v.file.is_none());
        }
    }
}
