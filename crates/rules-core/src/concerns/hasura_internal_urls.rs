//! Native-порт `hasura/internal_urls` (`npm/rules/hasura/internal_urls/main.mjs`,
//! 234 рядки) — у кожному `*.env` файлі значення `HASURA_GRAPHQL_ENDPOINT`
//! (якщо присутнє) має бути внутрішнім кластерним URL (`http://<svc>.<ns>.svc.
//! <cluster>.internal:<port>`), а `service`/`namespace` — збігатися з
//! `metadata.name` у `hasura/k8s/base/{svc-hl,namespace}.yaml`. Правило діє
//! лише для nitra/abie репозиторіїв (`package.json` `repository`).
//!
//! # `getRepositoryUrl` — портована лише потрібна функція
//!
//! JS-версія імпортує `getRepositoryUrl` з `npm/scripts/auto-rules.mjs`
//! (реекспорт з `rule-meta-helpers.mjs`) — спільний хелпер автодетекту
//! правил. Тут портована лише сама функція ([`get_repository_url`], точний
//! порт `rule-meta-helpers.mjs:73-84`), не весь модуль — решта
//! `rule-meta-helpers.mjs` (`migrateRuleIds`, `isMonorepoPackage`, ...)
//! стосується JS-оркестрації автодетекту правил, поза мандатом detector-а.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use crate::concerns::abie_yaml::parse_all_documents;
use crate::concerns::cursor_ignore::{load_cursor_ignore_paths, walk_with_ignore_paths};
use crate::diagnostics::{Severity, Violation};

const NITRA_REPOSITORY_URL_MARKER: &str = "https://github.com/nitra/";
const ABIE_REPOSITORY_URL_MARKER: &str = "https://github.com/abinbevefes/";

// `HASURA_BASE_DIR` (`main.mjs:16`) лишається інлайнованим у двох констант
// нижче — на відміну від JS-шаблонних рядків, тут нема окремого
// проміжного identifier-а, щоб уникнути "unused const" (clippy -D warnings):
// сам каталог ніде більше не використовується.
const HASURA_SVC_HL_FILE: &str = "hasura/k8s/base/svc-hl.yaml";
const HASURA_NAMESPACE_FILE: &str = "hasura/k8s/base/namespace.yaml";

const INTERNAL_DNS_SUFFIX: &str = ".internal";

/// Знаходить рядок присвоєння `HASURA_GRAPHQL_ENDPOINT` у env-файлі; захоплює
/// значення URL без лапок і коментаря — точний порт `HASURA_ENDPOINT_LINE_RE`
/// (`main.mjs:22-23`, `(?m)` = JS-флаг `m`). `pub(crate)` — перевикористовує
/// native-фікс цього concern-а (`super::fix`, T2 зрізу 5 фази 7).
pub(crate) static HASURA_ENDPOINT_LINE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?m)^[ \t]*(?:export[ \t]+)?HASURA_GRAPHQL_ENDPOINT[ \t]*=[ \t]*['"]?([^'"\r\n#]+)"#,
    )
    .expect("valid regex")
});

/// Дозволяє лише DNS-суфікс кластера `<name>.internal` — точний порт
/// `INTERNAL_HASURA_URL_RE` (`main.mjs:25`).
static INTERNAL_HASURA_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^http://([^./]+)\.([^./]+)\.svc\.([^./:]+\.internal):(\d+)/?$")
        .expect("valid regex")
});

/// Розібраний внутрішній кластерний URL — точний порт `{ ok: true, service,
/// namespace, cluster, port }` (`main.mjs:34`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedHasuraEndpoint {
    pub service: String,
    pub namespace: String,
    pub cluster: String,
    pub port: String,
}

/// Розбір значення `HASURA_GRAPHQL_ENDPOINT` як внутрішнього кластерного URL —
/// точний порт `parseInternalHasuraEndpoint` (`main.mjs:37-45`). `None` —
/// еквівалент `{ ok: false }`.
pub fn parse_internal_hasura_endpoint(url: &str) -> Option<ParsedHasuraEndpoint> {
    let caps = INTERNAL_HASURA_URL_RE.captures(url.trim())?;
    let suffix = &caps[3];
    let cluster = suffix
        .strip_suffix(INTERNAL_DNS_SUFFIX)
        .unwrap_or(suffix)
        .to_string();
    Some(ParsedHasuraEndpoint {
        service: caps[1].to_string(),
        namespace: caps[2].to_string(),
        cluster,
        port: caps[4].to_string(),
    })
}

/// Чи відносний шлях вказує на `*.env`, який треба перевіряти hasura.mdc —
/// точний порт `isEnvFile` (`main.mjs:79-84`). Файл рівно `.env` (без імені)
/// — виключення з правила.
pub fn is_env_file(rel_path: &str) -> bool {
    if !rel_path.ends_with(".env") {
        return false;
    }
    let basename = rel_path.rsplit('/').next().unwrap_or(rel_path);
    basename != ".env"
}

/// Чи URL репозиторію вказує на nitra або abie — точний порт
/// `isNitraOrAbieRepository` (`main.mjs:176-182`).
pub fn is_nitra_or_abie_repository(url: Option<&str>) -> bool {
    let Some(url) = url else { return false };
    let lc = url.to_lowercase();
    lc.contains(NITRA_REPOSITORY_URL_MARKER) || lc.contains(ABIE_REPOSITORY_URL_MARKER)
}

/// Повертає URL репозиторію з поля `repository` `package.json` (рядок або
/// `{ url }`-об'єкт) — точний порт `getRepositoryUrl`
/// (`rule-meta-helpers.mjs:73-84`, секція «портована лише потрібна функція»
/// у doc-коменті модуля).
fn get_repository_url(repository: Option<&serde_json::Value>) -> Option<String> {
    let repository = repository?;
    if let Some(s) = repository.as_str() {
        return Some(s.to_string());
    }
    if repository.is_object() {
        if let Some(url) = repository.get("url").and_then(|v| v.as_str()) {
            return Some(url.to_string());
        }
    }
    None
}

/// Зчитує URL репозиторію з кореневого `package.json` — точний порт
/// `readRootRepositoryUrl` (`main.mjs:158-169`). Fail-safe: файл відсутній чи
/// невалідний JSON → `None` (той самий видимий ефект, що й JS `try/catch`).
fn read_root_repository_url(cwd: &Path) -> Option<String> {
    let content = std::fs::read_to_string(cwd.join("package.json")).ok()?;
    let pkg: serde_json::Value = serde_json::from_str(&content).ok()?;
    get_repository_url(pkg.get("repository"))
}

/// Очікувані `service`/`namespace` з `hasura/k8s/base/{svc-hl,namespace}.yaml`.
/// `pub(crate)` — перевикористовує native-фікс (`super::fix`).
#[derive(Debug, Default)]
pub(crate) struct ExpectedSegments {
    pub(crate) service: Option<String>,
    pub(crate) namespace: Option<String>,
}

/// Зчитує `metadata.name` з першого документа YAML, який має заданий `kind` —
/// точний порт `readYamlMetadataName` (`main.mjs:53-70`). Мультидокументний
/// парсинг — через [`parse_all_documents`] (той самий видимий ефект, що й
/// `parseAllDocuments` пакета `yaml`, секція «Спрощення» у doc-коменті
/// `abie_yaml.rs` щодо catastrophic-parse гілки).
fn read_yaml_metadata_name(abs_path: &Path, kind: &str) -> Option<String> {
    if !abs_path.exists() {
        return None;
    }
    let raw = std::fs::read_to_string(abs_path).ok()?;
    for doc in parse_all_documents(&raw) {
        let Some(obj) = doc.as_object() else {
            continue;
        };
        let kind_matches = obj.get("kind").and_then(|k| k.as_str()) == Some(kind);
        if !kind_matches {
            continue;
        }
        let name = obj.get("metadata").and_then(|m| m.get("name"));
        let name_str = match name {
            Some(serde_json::Value::String(s)) if !s.is_empty() => Some(s.clone()),
            Some(serde_json::Value::Number(n)) => Some(n.to_string()),
            Some(serde_json::Value::Bool(b)) => Some(b.to_string()),
            _ => None,
        };
        if let Some(name_str) = name_str {
            return Some(name_str);
        }
    }
    None
}

/// Обчислює очікувані `service`/`namespace` з
/// `hasura/k8s/base/{svc-hl,namespace}.yaml` — точний порт
/// `computeExpectedEndpointSegments` (`main.mjs:190-195`). `pub(crate)` —
/// перевикористовує native-фікс (`super::fix`).
pub(crate) fn compute_expected_endpoint_segments(root: &Path) -> ExpectedSegments {
    ExpectedSegments {
        service: read_yaml_metadata_name(&root.join(HASURA_SVC_HL_FILE), "Service"),
        namespace: read_yaml_metadata_name(&root.join(HASURA_NAMESPACE_FILE), "Namespace"),
    }
}

/// Збирає всі `*.env` файли в дереві, окрім службових каталогів — точний
/// порт `collectEnvFiles` (`main.mjs:92-106`). `walk_dir` уже повертає
/// байтово-лексикографічно відсортований результат (`scan.rs`), тому
/// повторне сортування не потрібне (той самий підхід, що й
/// `env_dns::collect_abie_env_files`).
fn collect_env_files(root: &Path, ignore_paths: &[String]) -> Vec<String> {
    walk_with_ignore_paths(root, ignore_paths)
        .into_iter()
        .filter(|rel| is_env_file(rel))
        .collect()
}

/// Перевіряє один `.env` файл на коректність `HASURA_GRAPHQL_ENDPOINT` —
/// точний порт `checkEnvFile` (`main.mjs:117-151`). Якщо в файлі немає
/// змінної — OK (нічого не додається). Читання файлу, що зникло/недоступне
/// між обходом і читанням — тихо пропускається (fail-safe; JS-версія в
/// такому разі впала б у rejected promise, нетестований edge-case).
fn check_env_file(
    rel: &str,
    cwd: &Path,
    expected: &ExpectedSegments,
    violations: &mut Vec<Violation>,
) {
    let Ok(content) = std::fs::read_to_string(cwd.join(rel)) else {
        return;
    };
    let Some(caps) = HASURA_ENDPOINT_LINE_RE.captures(&content) else {
        return;
    };
    let value = caps[1].trim().to_string();
    let Some(parsed) = parse_internal_hasura_endpoint(&value) else {
        let example = "http://<service>.<namespace>.svc.<cluster>.internal:<port>";
        violations.push(Violation {
            reason: "internal-url-invalid".to_string(),
            message: format!(
                "{rel}: HASURA_GRAPHQL_ENDPOINT=\"{value}\" — потрібен внутрішній кластерний URL виду {example} (hasura.mdc)"
            ),
            file: Some(rel.to_string()),
            severity: Severity::Error,
            data: None,
        });
        return;
    };

    if let Some(expected_service) = &expected.service {
        if &parsed.service != expected_service {
            violations.push(Violation {
                reason: "internal-url-service-mismatch".to_string(),
                message: format!(
                    "{rel}: HASURA_GRAPHQL_ENDPOINT — сервіс \"{}\" не збігається з metadata.name \"{expected_service}\" із {HASURA_SVC_HL_FILE} (hasura.mdc)",
                    parsed.service
                ),
                file: Some(rel.to_string()),
                severity: Severity::Error,
                data: None,
            });
            return;
        }
    }

    if let Some(expected_namespace) = &expected.namespace {
        if &parsed.namespace != expected_namespace {
            violations.push(Violation {
                reason: "internal-url-namespace-mismatch".to_string(),
                message: format!(
                    "{rel}: HASURA_GRAPHQL_ENDPOINT — namespace \"{}\" не збігається з metadata.name \"{expected_namespace}\" із {HASURA_NAMESPACE_FILE} (hasura.mdc)",
                    parsed.namespace
                ),
                file: Some(rel.to_string()),
                severity: Severity::Error,
                data: None,
            });
        }
    }
}

/// Detector `hasura/internal_urls` — точний порт `lint(ctx)` (`main.mjs:202-234`).
pub fn hasura_internal_urls(cwd: &Path) -> Vec<Violation> {
    let repository_url = read_root_repository_url(cwd);
    if !is_nitra_or_abie_repository(repository_url.as_deref()) {
        return Vec::new();
    }

    let expected = compute_expected_endpoint_segments(cwd);

    let ignore_paths = load_cursor_ignore_paths(cwd);
    let env_files = collect_env_files(cwd, &ignore_paths);
    if env_files.is_empty() {
        return Vec::new();
    }

    let mut violations = Vec::new();
    for rel in &env_files {
        check_env_file(rel, cwd, &expected, &mut violations);
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

    // --- parse_internal_hasura_endpoint: дзеркало internal_urls.test.mjs ---

    #[test]
    fn parse_valid_internal_url_gke_style() {
        let r = parse_internal_hasura_endpoint(
            "http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080",
        )
        .unwrap();
        assert_eq!(
            r,
            ParsedHasuraEndpoint {
                service: "contract-h-hl".to_string(),
                namespace: "ua-contract".to_string(),
                cluster: "abie-ua".to_string(),
                port: "8080".to_string(),
            }
        );
    }

    #[test]
    fn parse_abie_clusters_dev_and_ua() {
        let dev = parse_internal_hasura_endpoint(
            "http://apruv-h-hl.dev-apruv.svc.abie-dev.internal:8080",
        )
        .unwrap();
        assert_eq!(dev.cluster, "abie-dev");
        assert_eq!(dev.namespace, "dev-apruv");
        let ua =
            parse_internal_hasura_endpoint("http://apruv-h-hl.ua-apruv.svc.abie-ua.internal:8080")
                .unwrap();
        assert_eq!(ua.cluster, "abie-ua");
        assert_eq!(ua.namespace, "ua-apruv");
    }

    #[test]
    fn parse_rejects_external_https_url() {
        assert!(parse_internal_hasura_endpoint("https://vybeerai.com.ua/contract/ql").is_none());
    }

    #[test]
    fn parse_rejects_http_without_cluster_segments() {
        assert!(parse_internal_hasura_endpoint("http://localhost:8080").is_none());
    }

    #[test]
    fn parse_requires_explicit_port() {
        assert!(parse_internal_hasura_endpoint("https://h.ns.svc.cl.internal").is_none());
    }

    #[test]
    fn parse_rejects_unexpected_suffix() {
        assert!(parse_internal_hasura_endpoint("https://h.ns.svc.example.com:8080").is_none());
    }

    // --- is_env_file ---

    #[test]
    fn is_env_file_basic_forms() {
        assert!(is_env_file("dev.env"));
        assert!(is_env_file("hasura/production.env"));
        assert!(!is_env_file("package.json"));
        assert!(!is_env_file("env.json"));
    }

    #[test]
    fn is_env_file_bare_dot_env_is_excluded() {
        assert!(!is_env_file(".env"));
        assert!(!is_env_file("hasura/.env"));
    }

    // --- is_nitra_or_abie_repository ---

    #[test]
    fn is_nitra_or_abie_repository_detects_both() {
        assert!(is_nitra_or_abie_repository(Some(
            "https://github.com/nitra/foo"
        )));
        assert!(is_nitra_or_abie_repository(Some(
            "https://github.com/abinbevefes/bar"
        )));
        assert!(!is_nitra_or_abie_repository(Some(
            "https://github.com/other/baz"
        )));
        assert!(!is_nitra_or_abie_repository(None));
    }

    // --- hasura_internal_urls(cwd): дзеркало check-hasura ---

    #[test]
    fn skips_non_nitra_abie_projects() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/other/foo" }),
        );
        write(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=https://example.com/ql\n",
        );
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn public_https_endpoint_is_violation() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/abinbevefes/foo" }),
        );
        write(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n",
        );
        assert!(!hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn internal_cluster_url_without_yaml_service_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/nitra/foo" }),
        );
        write(
            &tmp,
            "production.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn matches_metadata_name_from_svc_hl_and_namespace_yaml() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/abinbevefes/foo" }),
        );
        write(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: contract-h-hl\nspec:\n  clusterIP: None\n",
        );
        write(
            &tmp,
            "hasura/k8s/base/namespace.yaml",
            "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ua-contract\n",
        );
        write(
            &tmp,
            "production.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn service_mismatch_with_svc_hl_is_violation() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/abinbevefes/foo" }),
        );
        write(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n",
        );
        write(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        let violations = hasura_internal_urls(tmp.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "internal-url-service-mismatch"));
    }

    #[test]
    fn missing_endpoint_in_env_files_is_not_violation() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/nitra/foo" }),
        );
        write(&tmp, "dev.env", "OTHER=value\n");
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn export_prefixed_endpoint_is_recognized() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/nitra/foo" }),
        );
        write(
            &tmp,
            "shell.env",
            "export HASURA_GRAPHQL_ENDPOINT=https://api.example.com\n",
        );
        assert!(!hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn no_env_files_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/nitra/foo" }),
        );
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn bare_dot_env_is_ignored_even_with_bad_url() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/nitra/foo" }),
        );
        write(
            &tmp,
            ".env",
            "HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n",
        );
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn missing_package_json_skips_as_not_nitra_abie() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/ql\n",
        );
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn invalid_json_package_json_skips() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "{ broken json");
        write(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/ql\n",
        );
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn svc_hl_without_matching_resource_is_clean() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/abinbevefes/foo" }),
        );
        write(&tmp, "hasura/k8s/base/svc-hl.yaml", "foo: bar\n");
        write(
            &tmp,
            "production.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn service_matches_but_namespace_does_not_is_violation() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/abinbevefes/foo" }),
        );
        write(
            &tmp,
            "hasura/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: contract-h-hl\n",
        );
        write(
            &tmp,
            "hasura/k8s/base/namespace.yaml",
            "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ua-wrong-ns\n",
        );
        write(
            &tmp,
            "production.env",
            "HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n",
        );
        let violations = hasura_internal_urls(tmp.path());
        assert!(violations
            .iter()
            .any(|v| v.reason == "internal-url-namespace-mismatch"));
    }

    #[test]
    fn cursor_ignore_config_excludes_subtree() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/nitra/foo" }),
        );
        write(
            &tmp,
            "vendor/dev.env",
            "HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/ql\n",
        );
        write(&tmp, ".n-rules.json", r#"{"rules":[],"ignore":["vendor"]}"#);
        assert!(hasura_internal_urls(tmp.path()).is_empty());
    }

    #[test]
    fn all_violations_carry_file_field() {
        let tmp = TempDir::new().unwrap();
        write_json(
            &tmp,
            "package.json",
            serde_json::json!({ "name": "t", "repository": "https://github.com/nitra/foo" }),
        );
        write(
            &tmp,
            "dev.env",
            "HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n",
        );
        let violations = hasura_internal_urls(tmp.path());
        assert!(!violations.is_empty());
        assert!(violations.iter().all(|v| v.file.is_some()));
    }
}
