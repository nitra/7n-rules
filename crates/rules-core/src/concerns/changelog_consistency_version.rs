//! `changelog/consistency` — версійний шар: semver-порівняння ядра версій і
//! резолв опублікованої версії (npm view / PyPI fetch) для
//! [`super::changelog_consistency`].
//!
//! # PyPI-резолв — субпроцес `curl`, не HTTP-клієнт
//!
//! JS-канон резолвить PyPI через нативний `fetch`. `rules-core` навмисно
//! НЕ тягне HTTP-клієнт: `llm-lib` тут узятий з `default-features = false`
//! САМЕ щоб уникнути `genai`/`tokio`/`reqwest`-стеку (доккомент
//! `Cargo.toml`), і `ureq` (навіть sync) заводив би `rustls`/`ring`/
//! `webpki-roots` назад у граф `rules-core` — перевірено:
//! `cargo tree -p rules-core -e normal` (не workspace-wide, де `reqwest`
//! справді вже є через `llm-lib`-стек інших крейтів) до такої спроби не
//! мав жодного з цих вузлів. Замість HTTP-клієнта — субпроцес `curl`,
//! знайдений через [`crate::tool_resolve::resolve_cmd`] (той самий канал,
//! що `git`/`conftest`/`hadolint`/`shellcheck` в інших концернах цього
//! крейта) — симетрично тому, що канон УЖЕ робить для npm
//! (`execFileAsync('npm', ['view', ...])` — теж субпроцес, не бібліотека).
//!
//! # Канал помилок реєстрових викликів
//!
//! `npm view` і PyPI-`curl` — КОЖЕН обгорнутий власним `try/catch`-
//! еквівалентом, що зводить будь-яку помилку (`curl` не резолвиться,
//! мережа, тайм-аут, не-200, невалідний JSON) до `null`. Порт зберігає це
//! буквально: обидві функції-резолвери повертають `Option<String>`, ніколи
//! `Err` — виклик, для якого реєстр недосяжний, репортується як «перевірку
//! пропущено» (`super::changelog_consistency_workspace`), не як провал
//! детектора. Відсутність `curl` у PATH — той самий fail-open випадок, що
//! й мережева помилка в JS-каноні (`fetch` у `try/catch`), НЕ окремий
//! `ConcernDiagnostic`: канон при збої `fetch` мовчить, а реєстровий
//! резолв і так вимкнений у autofix/hook-режимі (`main.mjs:640-646`).

use std::path::PathBuf;
use std::process::Command;

use crate::concerns::package_manifest::PackageKind;
use crate::tool_resolve::resolve_cmd;

/// Таймаут на `npm view` / PyPI (мс) — точний порт `REGISTRY_TIMEOUT_MS`
/// (`main.mjs:49`).
pub(super) const REGISTRY_TIMEOUT_MS: u64 = 10_000;

/// Числове ядро semver (`x.y.z`); хвіст (prerelease/build) ігнорується —
/// точний порт `parseSemverCore` (`main.mjs:354-358`). `Ord` — лексикографічне
/// порівняння полів у порядку оголошення (major, потім minor, потім patch)
/// збігається з точковою семантикою `compareSemverCore`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct SemverCore {
    major: u64,
    minor: u64,
    patch: u64,
}

fn parse_semver_core(v: &str) -> Option<SemverCore> {
    let mut parts = v.splitn(4, '.');
    let major_part = parts.next()?;
    let minor_part = parts.next()?;
    // Хвостова частина `patch` може мати prerelease/build-суфікс
    // (`1.2.3-rc.1`) — беремо лише ведучу цифрову послідовність.
    let patch_part = parts.next()?;
    let major = major_part.parse::<u64>().ok()?;
    let minor = minor_part.parse::<u64>().ok()?;
    let patch_digits: String = patch_part
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if patch_digits.is_empty() {
        return None;
    }
    let patch = patch_digits.parse::<u64>().ok()?;
    Some(SemverCore {
        major,
        minor,
        patch,
    })
}

/// Порівнює semver-ядра двох версій — точний порт `compareSemverCore`
/// (`main.mjs:366-374`). `None` — нерозпізнано (хоча б одна не парситься).
pub(super) fn compare_semver_core(a: Option<&str>, b: Option<&str>) -> Option<std::cmp::Ordering> {
    let pa = parse_semver_core(a?)?;
    let pb = parse_semver_core(b?)?;
    Some(pa.cmp(&pb))
}

/// Чи `current` випереджає `base` (ручний bump поза CI) — точний порт
/// `versionIsAhead` (`main.mjs:383-386`). Нерозпізнаний semver → fail-closed
/// на будь-яку нерівність рядків (консервативно, як у JS).
pub(super) fn version_is_ahead(current: Option<&str>, base: Option<&str>) -> bool {
    match compare_semver_core(current, base) {
        Some(ordering) => ordering == std::cmp::Ordering::Greater,
        None => current != base,
    }
}

/// `npm view <name> version` — точний порт `defaultGetPublishedNpmVersion`
/// (`main.mjs:308-316`): будь-яка помилка спавну/парсингу → `None`.
fn default_get_published_npm_version(name: &str) -> Option<String> {
    let output = Command::new("npm")
        .args(["view", name, "version"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!v.is_empty()).then_some(v)
}

/// PyPI `https://pypi.org/pypi/<name>/json` — точний порт
/// `defaultGetPublishedPyPiVersion` (`main.mjs:322-334`): будь-яка помилка
/// (curl не резолвиться/спавн падає/не-200/невалідний JSON) → `None`, той
/// самий `try/catch`-контракт, що й JS-версія (`fetch` +
/// `AbortSignal.timeout`). Субпроцес `curl`, не HTTP-клієнт (доккомент
/// модуля вище).
fn default_get_published_pypi_version(name: &str) -> Option<String> {
    default_get_published_pypi_version_with(name, &resolve_cmd)
}

/// Тіло з інжектованим резолвом `curl` — той самий патерн ін'єкції, що в
/// `super::docker_lint_hadolint`/`super::k8s_kubeconform`: підміняти
/// процес-глобальний `PATH` не можна (паралельні тести крейта спавнять
/// `git`/інші тули).
fn default_get_published_pypi_version_with(
    name: &str,
    resolve_curl: &dyn Fn(&str) -> Option<PathBuf>,
) -> Option<String> {
    let curl_bin = resolve_curl("curl")?;
    let url = format!("https://pypi.org/pypi/{}/json", urlencoding_component(name));
    // `--max-time` у секундах (дробових) — звірено з `REGISTRY_TIMEOUT_MS`.
    let max_time = format!("{:.3}", REGISTRY_TIMEOUT_MS as f64 / 1000.0);
    let output = Command::new(curl_bin)
        .args(["--silent", "--fail", "--max-time", &max_time, &url])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let body = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&body).ok()?;
    let v = data.get("info")?.get("version")?.as_str()?.to_string();
    (!v.is_empty()).then_some(v)
}

/// Мінімальний `encodeURIComponent`-еквівалент для назви пакета в URL —
/// назви PyPI-пакетів обмежені `[A-Za-z0-9._-]` на практиці, але порт не
/// покладається на це і екранує решту символів як JS `encodeURIComponent`.
fn urlencoding_component(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for byte in name.bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Резолвить опубліковану версію за типом пакета — точний порт
/// `defaultGetPublishedVersion` (`main.mjs:393-398`).
pub(super) fn default_get_published_version(name: &str, kind: PackageKind) -> Option<String> {
    match kind {
        PackageKind::Python => default_get_published_pypi_version(name),
        PackageKind::Npm => default_get_published_npm_version(name),
    }
}

/// Заглушка типу для документації сигнатур нижче — DI-injection точки
/// резолвера в тестах [`super::changelog_consistency_workspace`] (пряма
/// заміна мережевого виклику функцією-замиканням, без fake-бінарників у
/// PATH, на відміну від JS-тестів `check.test.mjs`).
pub(super) type GetPublishedVersionFn<'a> = dyn Fn(&str, PackageKind) -> Option<String> + 'a;

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Fake `curl`, що ігнорує аргументи (включно з реальним URL) і завжди
    /// друкує заданий `stdout`/exit-код — той самий підхід, що
    /// `fake_hadolint` у `super::docker_lint_hadolint`: тест перевіряє
    /// парсинг/канал помилок, не реальну мережу.
    #[cfg(unix)]
    fn fake_curl(dir: &std::path::Path, exit_code: i32, stdout: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let bin = dir.join("curl");
        let stdout_part = if stdout.is_empty() {
            String::new()
        } else {
            format!("printf '%s' '{stdout}'\n")
        };
        fs::write(&bin, format!("#!/bin/sh\n{stdout_part}exit {exit_code}\n")).unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    fn resolver_found(bin: PathBuf) -> impl Fn(&str) -> Option<PathBuf> {
        move |_| Some(bin.clone())
    }

    fn resolver_missing(_tool: &str) -> Option<PathBuf> {
        None
    }

    #[test]
    fn pypi_curl_missing_returns_none() {
        assert_eq!(
            default_get_published_pypi_version_with("my-lib", &resolver_missing),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn pypi_curl_nonzero_exit_returns_none() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_curl(&tmp.path().join("bin"), 22, "");
        assert_eq!(
            default_get_published_pypi_version_with("my-lib", &resolver_found(bin)),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn pypi_curl_garbage_stdout_returns_none() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_curl(&tmp.path().join("bin"), 0, "not json");
        assert_eq!(
            default_get_published_pypi_version_with("my-lib", &resolver_found(bin)),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn pypi_curl_valid_json_returns_version() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_curl(
            &tmp.path().join("bin"),
            0,
            r#"{"info":{"version":"1.2.3"}}"#,
        );
        assert_eq!(
            default_get_published_pypi_version_with("my-lib", &resolver_found(bin)),
            Some("1.2.3".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn pypi_curl_empty_version_string_returns_none() {
        let tmp = TempDir::new().unwrap();
        let bin = fake_curl(&tmp.path().join("bin"), 0, r#"{"info":{"version":""}}"#);
        assert_eq!(
            default_get_published_pypi_version_with("my-lib", &resolver_found(bin)),
            None
        );
    }

    #[test]
    fn parse_semver_core_basic() {
        assert_eq!(
            parse_semver_core("1.2.3"),
            Some(SemverCore {
                major: 1,
                minor: 2,
                patch: 3
            })
        );
    }

    #[test]
    fn parse_semver_core_ignores_prerelease_tail() {
        assert_eq!(
            parse_semver_core("1.2.3-rc.1"),
            Some(SemverCore {
                major: 1,
                minor: 2,
                patch: 3
            })
        );
    }

    #[test]
    fn parse_semver_core_invalid_is_none() {
        assert_eq!(parse_semver_core("not-a-version"), None);
        assert_eq!(parse_semver_core("1.2"), None);
    }

    #[test]
    fn compare_semver_core_orders_correctly() {
        assert_eq!(
            compare_semver_core(Some("1.0.0"), Some("1.0.1")),
            Some(std::cmp::Ordering::Less)
        );
        assert_eq!(
            compare_semver_core(Some("2.0.0"), Some("1.5.0")),
            Some(std::cmp::Ordering::Greater)
        );
        assert_eq!(
            compare_semver_core(Some("1.0.0"), Some("1.0.0")),
            Some(std::cmp::Ordering::Equal)
        );
    }

    #[test]
    fn compare_semver_core_unrecognized_is_none() {
        assert_eq!(compare_semver_core(Some("x"), Some("1.0.0")), None);
        assert_eq!(compare_semver_core(None, Some("1.0.0")), None);
    }

    #[test]
    fn version_is_ahead_true_only_when_strictly_greater() {
        assert!(version_is_ahead(Some("2.0.0"), Some("1.5.0")));
        assert!(!version_is_ahead(Some("1.0.0"), Some("1.0.1")));
        assert!(!version_is_ahead(Some("1.0.0"), Some("1.0.0")));
    }

    #[test]
    fn version_is_ahead_unrecognized_fails_closed_on_any_inequality() {
        assert!(version_is_ahead(Some("x"), Some("1.0.0")));
        assert!(!version_is_ahead(Some("x"), Some("x")));
    }

    #[test]
    fn urlencoding_component_escapes_special_chars() {
        assert_eq!(urlencoding_component("my-lib"), "my-lib");
        assert_eq!(urlencoding_component("a/b"), "a%2Fb");
    }
}
