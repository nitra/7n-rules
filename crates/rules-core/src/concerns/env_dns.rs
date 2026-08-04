//! Native-порт `abie/env_dns` (`npm/rules/abie/env_dns/main.mjs`, 47 рядків +
//! `npm/rules/abie/lib/env-dns.mjs`, 81 рядок) — у кожному `*.dev.env`/
//! `*.ua.env` усі internal-URL (`http(s)://<svc>.<ns>.svc.<dns>`) мають
//! відповідати кластеру, закодованому в імені файлу (`abie.mdc`).
//!
//! # Обхід дерева й repo-локальний конфіг
//!
//! JS-версія читає `ignorePaths` через `loadCursorIgnorePaths(root)`
//! (`main.mjs:19`) ДО виклику `walkDir` — цей порт читає той самий
//! `.n-rules.json`/`.n-cursor.json` сам через
//! [`crate::concerns::cursor_ignore`] (док-комент цього модуля пояснює
//! відхилення від Р5), нормалізує їх у relative-posix-`/**`-глоби
//! (`cursor_ignore::to_relative_ignore_globs`, дзеркало inline-нормалізації
//! `walkDir.mjs:60-67`) і передає у [`crate::scan::walk_dir`].

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::cursor_ignore::{load_cursor_ignore_paths, to_relative_ignore_globs};
use crate::diagnostics::{Severity, Violation};
use crate::scan::walk_dir;

/// Basename abie env-файлу (опційна провідна крапка) — порт
/// `ABIE_ENV_FILE_BASENAME_RE` (`env-dns.mjs:13`, `/^\.?(dev|ua)\.env$/u`),
/// case-sensitive (без `i`-флагу в оригіналі).
static ABIE_ENV_FILE_BASENAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\.?(dev|ua)\.env$").expect("valid regex"));

/// Internal-URL усередині вмісту env-файлу — порт
/// `ABIE_INTERNAL_URL_GLOBAL_RE` (`env-dns.mjs:15-16`). Три захоплені
/// групи: `svc` (не використовується у validate, лишена для парності
/// індексів із JS-деструктуризацією `[fullUrl, , namespace, clusterDns]`),
/// `namespace`, `clusterDns`.
static ABIE_INTERNAL_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)\bhttps?://([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)\.svc\.([a-z0-9][a-z0-9-]*\.internal)(?::\d+)?(?:/[^\s"'`]*)?"#,
    )
    .expect("valid regex")
});

/// Очікуваний кластерний DNS + namespace-префікс на env — порт
/// `ABIE_ENV_CLUSTER_DNS_MAP` (`env-dns.mjs:18-21`).
fn expected_for(env_name: &str) -> Option<(&'static str, &'static str)> {
    match env_name {
        "dev" => Some(("abie-dev.internal", "dev-")),
        "ua" => Some(("abie-ua.internal", "ua-")),
        _ => None,
    }
}

/// Дефолтний `reason` (`fail(msg)` без `opts` на обох call site'ах
/// `main.mjs:35,42` → `ctx.concernId` = `env_dns`).
const REASON: &str = "env_dns";

/// Дістає `dev`/`ua` з basename env-файлу abie; не-abie env-файли (`.env` без
/// імені, `production.env`) → `None` — точний порт `abieEnvNameFromBasename`
/// (`env-dns.mjs:29-32`).
pub fn abie_env_name_from_basename(basename_of_env_file: &str) -> Option<&'static str> {
    let caps = ABIE_ENV_FILE_BASENAME_RE.captures(basename_of_env_file)?;
    match &caps[1] {
        "dev" => Some("dev"),
        "ua" => Some("ua"),
        _ => None,
    }
}

/// Сканує вміст env-файла, повертає помилки невідповідності кластерного
/// DNS/namespace для кожного internal-URL — точний порт
/// `validateAbieEnvInternalUrls` (`env-dns.mjs:41-60`).
pub fn validate_abie_env_internal_urls(content: &str, env_name: &str) -> Vec<String> {
    let Some((cluster_dns, namespace_prefix)) = expected_for(env_name) else {
        return Vec::new();
    };
    let mut errors = Vec::new();
    for caps in ABIE_INTERNAL_URL_RE.captures_iter(content) {
        let full_url = &caps[0];
        let namespace = &caps[2];
        let cluster_dns_found = &caps[3];
        if cluster_dns_found != cluster_dns {
            errors.push(format!(
                "{full_url}: кластерний DNS \"{cluster_dns_found}\" не відповідає env \"{env_name}\" (очікується \"{cluster_dns}\")"
            ));
        }
        if !namespace.starts_with(namespace_prefix) {
            errors.push(format!(
                "{full_url}: namespace \"{namespace}\" не починається з \"{namespace_prefix}\" (env \"{env_name}\")"
            ));
        }
    }
    errors
}

/// Збирає `*.env` файли, які є abie env (`dev.env`/`ua.env`, опц. з
/// провідною крапкою), відсортовані байтово-лексикографічно (та сама
/// парність з `localeCompare` для ASCII-імен, що й у `sample_secret`, доп.
/// коментар там) — точний порт `collectAbieEnvFiles` (`env-dns.mjs:68-81`).
fn collect_abie_env_files(root: &Path, ignore_paths: &[String]) -> Vec<String> {
    let extra_globs = to_relative_ignore_globs(root, ignore_paths);
    walk_dir(root, &extra_globs)
        .into_iter()
        .filter(|rel| {
            let basename = rel.split('/').next_back().unwrap_or(rel.as_str());
            abie_env_name_from_basename(basename).is_some()
        })
        .collect()
}

/// Detector `abie/env_dns` — точний порт `lint(ctx)` (`main.mjs:14-47`).
pub fn env_dns(cwd: &Path) -> Vec<Violation> {
    let ignore_paths = load_cursor_ignore_paths(cwd);
    let env_files = collect_abie_env_files(cwd, &ignore_paths);

    let mut violations = Vec::new();
    for rel in &env_files {
        let basename = rel.split('/').next_back().unwrap_or(rel.as_str());
        let Some(env_name) = abie_env_name_from_basename(basename) else {
            continue;
        };
        let abs = cwd.join(rel);
        let raw = match std::fs::read_to_string(&abs) {
            Ok(s) => s,
            Err(err) => {
                violations.push(Violation {
                    reason: REASON.to_string(),
                    message: format!("{rel}: не вдалося прочитати ({err})"),
                    file: None,
                    severity: Severity::Error,
                    data: None,
                });
                continue;
            }
        };
        for err in validate_abie_env_internal_urls(&raw, env_name) {
            violations.push(Violation {
                reason: REASON.to_string(),
                message: format!("{rel}: {err} (abie.mdc)"),
                file: None,
                severity: Severity::Error,
                data: None,
            });
        }
    }
    violations
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    // --- abie_env_name_from_basename: дзеркало lib/tests/env-dns.test.mjs:5-15 ---

    #[test]
    fn env_name_from_basename_matches_only_dev_and_ua() {
        assert_eq!(abie_env_name_from_basename("dev.env"), Some("dev"));
        assert_eq!(abie_env_name_from_basename(".dev.env"), Some("dev"));
        assert_eq!(abie_env_name_from_basename("ua.env"), Some("ua"));
        assert_eq!(abie_env_name_from_basename(".ua.env"), Some("ua"));
        assert_eq!(abie_env_name_from_basename("production.env"), None);
        assert_eq!(abie_env_name_from_basename(".env"), None);
        assert_eq!(abie_env_name_from_basename("dev.env.example"), None);
    }

    // --- validate_abie_env_internal_urls: дзеркало lib/tests/env-dns.test.mjs:17-50 ---

    #[test]
    fn consistent_dev_urls_have_no_errors() {
        let env = "HASURA_GRAPHQL_ENDPOINT=https://apruv-h-hl.dev-apruv.svc.abie-dev.internal:8080\nKVCMS_URL=https://kvcms-hl.dev-apruv.svc.abie-dev.internal:8080\n";
        assert!(validate_abie_env_internal_urls(env, "dev").is_empty());
    }

    #[test]
    fn ua_url_without_port_is_also_caught() {
        let env = "KVCMS_URL=https://kvcms-hl.ua-apruv.svc.abie-ua.internal\n";
        assert!(validate_abie_env_internal_urls(env, "ua").is_empty());
    }

    #[test]
    fn wrong_cluster_for_env_fails() {
        let env = "KVCMS_URL=https://kvcms-hl.dev-apruv.svc.abie-dev.internal:8080\n";
        let errs = validate_abie_env_internal_urls(env, "ua");
        assert!(errs.len() >= 2);
        assert!(errs.iter().any(|e| e.contains("abie-ua.internal")));
        assert!(errs.iter().any(|e| e.contains("ua-")));
    }

    #[test]
    fn public_external_urls_are_untouched() {
        let env = "EXTERNAL=https://example.com/contract/ql\nLOCAL=http://localhost:8080\n";
        assert!(validate_abie_env_internal_urls(env, "dev").is_empty());
    }

    #[test]
    fn multiple_urls_with_different_violations() {
        let env = "A=https://a-hl.dev-foo.svc.abie-dev.internal:8080\nB=https://b-hl.ua-foo.svc.abie-ua.internal:8080\n";
        let errs = validate_abie_env_internal_urls(env, "ua");
        assert_eq!(errs.len(), 2);
    }

    // --- env_dns(cwd): дзеркало tests/env_dns.test.mjs ---

    /// «репозиторій без env-файлів → clean» (`:18-23`).
    #[test]
    fn no_env_files_is_clean() {
        let tmp = TempDir::new().unwrap();
        assert!(env_dns(tmp.path()).is_empty());
    }

    /// «коректний dev.env з валідним URL → clean» (`:25-36`).
    #[test]
    fn valid_dev_env_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/dev.env",
            "API_URL=https://auth-run-hl.dev-pkg.svc.abie-dev.internal:8080\n",
        );
        assert!(env_dns(tmp.path()).is_empty());
    }

    /// «коректний ua.env з валідним URL → clean» (`:38-45`).
    #[test]
    fn valid_ua_env_is_clean() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/ua.env",
            "API_URL=https://file-link-hl.ua-pkg.svc.abie-ua.internal\n",
        );
        assert!(env_dns(tmp.path()).is_empty());
    }

    /// «dev.env з URL для іншого кластера (abie-ua) → violation» (`:47-54`).
    #[test]
    fn dev_env_with_wrong_cluster_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/dev.env",
            "API_URL=https://x.dev-y.svc.abie-ua.internal\n",
        );
        assert!(!env_dns(tmp.path()).is_empty());
    }

    /// «ua.env з намспейсом без префікса ua- → violation» (`:56-63`).
    #[test]
    fn ua_env_with_wrong_namespace_prefix_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/ua.env",
            "API_URL=https://x.dev-y.svc.abie-ua.internal\n",
        );
        assert!(!env_dns(tmp.path()).is_empty());
    }

    /// «файл `.env` (локальний без імені) — НЕ перевіряється» (`:65-72`).
    #[test]
    fn bare_dot_env_is_not_checked() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/.env", "API_URL=https://x.y.svc.bad.internal\n");
        assert!(env_dns(tmp.path()).is_empty());
    }

    /// «кілька env-файлів — один невалідний → violation» (`:74-83`).
    #[test]
    fn one_of_several_env_files_invalid_is_violation() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "a/dev.env",
            "API_URL=https://x.dev-a.svc.abie-dev.internal\n",
        );
        write(
            &tmp,
            "b/ua.env",
            "API_URL=https://x.dev-b.svc.abie-ua.internal\n",
        );
        assert!(!env_dns(tmp.path()).is_empty());
    }

    /// `.n-rules.json`-`ignore` виключає піддерево з обходу — repo-локальний
    /// конфіг читається самим concern-ом (док-комент модуля).
    #[test]
    fn cursor_ignore_config_excludes_subtree() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "vendor/dev.env",
            "API_URL=https://x.dev-y.svc.abie-ua.internal\n",
        );
        write(&tmp, ".n-rules.json", r#"{"rules":[],"ignore":["vendor"]}"#);
        assert!(env_dns(tmp.path()).is_empty());
    }
}
