//! 1:1 семантичний порт `npm/scripts/lib/slot-contracts-ci.mjs` —
//! `validateCiArtifactPayload`/`isSafeRepoRelativePath`/`isSafeTemplateRelPath`/
//! `CI_ARTIFACT_ID_RE`. Рішення Л спеки
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`: семантичні
//! перевірки, які WIT-типізація не покриває (regex вмісту рядка, safe-path),
//! лишаються host-валідаторами тут — [`CiArtifactDescriptor`]
//! (`crate::slots::ci_artifact`) типізує лише форму (обов'язковість полів,
//! enum-membership), не вміст рядків.
//!
//! Ці функції приймають **сирий, ще не типізований** `serde_json::Value` —
//! той самий вхід, що й JS-оригінал (`raw` payload contribution-у, перш ніж
//! він стане типізованим [`CiArtifactDescriptor`]) — не вже розпарсений WIT
//! record. Це свідомо: `validateCiArtifactPayload` у JS робить одразу і
//! shape-валідацію (обов'язковість/тип полів), і семантичну (regex/path) —
//! перед WIT-декодуванням (яке ще не існує в цій задачі, I2) це єдиний
//! спосіб зберегти «семантика 1:1» з JS-тестами дослівно.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use crate::slots::ci_artifact::{
    CiArtifactDescriptor, CiArtifactFormat, CiArtifactMergeStrategy, CiArtifactMode,
};

/// `artifactId` — той самий regex, що й `id` contribution-у в universal
/// envelope (JS `CI_ARTIFACT_ID_RE`, `slot-contracts-ci.mjs:21`).
pub static CI_ARTIFACT_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]*$").expect("valid regex"));

const KNOWN_PAYLOAD_FIELDS: &[&str] = &[
    "targetCapability",
    "artifactId",
    "targetPath",
    "format",
    "mode",
    "template",
    "mergeStrategy",
    "fix",
];

/// Перевіряє, що `p` — безпечний repo-relative шлях (`targetPath`): рядок,
/// без ведучого `/`, без `..`-сегментів. Порт JS `isSafeRepoRelativePath`
/// (`slot-contracts-ci.mjs:57-61`). Не перевіряє існування — лише форму.
pub fn is_safe_repo_relative_path(p: &str) -> bool {
    if p.is_empty() {
        return false;
    }
    if p.starts_with('/') {
        return false;
    }
    !p.split('/').any(|segment| segment == "..")
}

/// Перевіряє, що `p` — безпечний package-relative шлях у стилі envelope
/// (`template`): починається з `./`, без `..`-сегментів. Порт JS
/// `isSafeTemplateRelPath` (`slot-contracts-ci.mjs:70-72`).
pub fn is_safe_template_rel_path(p: &str) -> bool {
    p.starts_with("./") && !p.split('/').any(|segment| segment == "..")
}

/// Валідує payload `ci.artifact@1` (`raw`, сирий JSON — не ще
/// не-типізований `serde_json::Value`, той самий вхід, що й JS-оригінал).
/// Порт JS `validateCiArtifactPayload` (`slot-contracts-ci.mjs:81-129`):
/// невідомі поля відхиляються, усі помилки акумулюються в одному виклику
/// (не early-return на першій).
pub fn validate_ci_artifact_payload(raw: &Value) -> Result<CiArtifactDescriptor, Vec<String>> {
    let obj = match raw.as_object() {
        Some(obj) if raw.is_object() => obj,
        _ => return Err(vec!["payload ci.artifact@1 має бути обʼєктом".to_string()]),
    };

    let mut errors: Vec<String> = Vec::new();

    let unknown: Vec<&String> = obj
        .keys()
        .filter(|k| !KNOWN_PAYLOAD_FIELDS.contains(&k.as_str()))
        .collect();
    if !unknown.is_empty() {
        let names = unknown
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        errors.push(format!("невідомі поля payload (v1 їх відхиляє): {names}"));
    }

    let target_capability = obj.get("targetCapability").and_then(Value::as_str);
    if target_capability.is_none_or(str::is_empty) {
        errors.push("targetCapability має бути непорожнім рядком".to_string());
    }

    let artifact_id = obj.get("artifactId").and_then(Value::as_str);
    let artifact_id_valid = artifact_id.is_some_and(|s| CI_ARTIFACT_ID_RE.is_match(s));
    if !artifact_id_valid {
        errors.push(format!(
            "artifactId має відповідати {}",
            CI_ARTIFACT_ID_RE.as_str()
        ));
    }

    let target_path = obj.get("targetPath").and_then(Value::as_str);
    let target_path_valid = target_path.is_some_and(is_safe_repo_relative_path);
    if !target_path_valid {
        errors.push(
            "targetPath має бути безпечним repo-relative шляхом (без абсолютних і \"..\" сегментів)"
                .to_string(),
        );
    }

    let format = obj.get("format").and_then(Value::as_str);
    let format_parsed = format.and_then(|s| match s {
        "yaml" => Some(CiArtifactFormat::Yaml),
        _ => None,
    });
    if format_parsed.is_none() {
        errors.push("format підтримує лише: yaml (v1)".to_string());
    }

    let mode = obj.get("mode").and_then(Value::as_str);
    let mode_parsed = mode.and_then(|s| match s {
        "required-file" => Some(CiArtifactMode::RequiredFile),
        "patch-existing" => Some(CiArtifactMode::PatchExisting),
        _ => None,
    });
    if mode_parsed.is_none() {
        errors.push("mode підтримує лише: required-file, patch-existing".to_string());
    }

    let template = obj.get("template").and_then(Value::as_str);
    let template_valid = template.is_some_and(is_safe_template_rel_path);
    if !template_valid {
        errors.push(
            "template має бути безпечним шляхом від каталогу дескриптора (починається з \"./\", без \"..\" сегментів)"
                .to_string(),
        );
    }

    let merge_strategy = obj.get("mergeStrategy").and_then(Value::as_str);
    let merge_strategy_parsed = merge_strategy.and_then(|s| match s {
        "deep-subset" => Some(CiArtifactMergeStrategy::DeepSubset),
        "contains-step" => Some(CiArtifactMergeStrategy::ContainsStep),
        _ => None,
    });
    if merge_strategy_parsed.is_none() {
        errors.push("mergeStrategy підтримує лише: deep-subset, contains-step".to_string());
    }

    let fix = obj.get("fix").and_then(Value::as_bool);
    if fix.is_none() {
        errors.push("fix має бути boolean".to_string());
    }

    if !errors.is_empty() {
        return Err(errors);
    }

    Ok(CiArtifactDescriptor {
        target_capability: target_capability.unwrap().to_string(),
        artifact_id: artifact_id.unwrap().to_string(),
        target_path: target_path.unwrap().to_string(),
        format: format_parsed.unwrap(),
        mode: mode_parsed.unwrap(),
        template: template.unwrap().to_string(),
        merge_strategy: merge_strategy_parsed.unwrap(),
        fix: fix.unwrap(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Мінімальний валідний payload — базис для мутацій у негативних
    /// тестах (дзеркало JS `VALID_PAYLOAD`,
    /// `tests/slot-contracts-ci.test.mjs:23-32`).
    fn valid_payload() -> Value {
        json!({
            "targetCapability": "ci:github",
            "artifactId": "lint-demo",
            "targetPath": ".github/workflows/lint-demo.yml",
            "format": "yaml",
            "mode": "required-file",
            "template": "./github/lint-demo.yml.snippet.yml",
            "mergeStrategy": "deep-subset",
            "fix": true
        })
    }

    fn with_field(mut payload: Value, key: &str, value: Value) -> Value {
        payload[key] = value;
        payload
    }

    #[test]
    fn valid_payload_returns_ok_descriptor() {
        let result = validate_ci_artifact_payload(&valid_payload());
        assert!(result.is_ok());
        let descriptor = result.unwrap();
        assert_eq!(descriptor.target_capability, "ci:github");
        assert_eq!(descriptor.artifact_id, "lint-demo");
        assert!(descriptor.fix);
    }

    /// Дзеркало JS «додаткове поле payload → ok:false з переліком невідомих
    /// полів» (`tests/slot-contracts-ci.test.mjs:44-49`).
    #[test]
    fn unknown_field_is_rejected_with_name_in_error() {
        let payload = with_field(valid_payload(), "priority", json!(1));
        let errors = validate_ci_artifact_payload(&payload).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("priority")));
    }

    #[test]
    fn template_without_dot_slash_prefix_is_rejected() {
        let payload = with_field(
            valid_payload(),
            "template",
            json!("github/lint-demo.yml.snippet.yml"),
        );
        let errors = validate_ci_artifact_payload(&payload).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("template")));
    }

    #[test]
    fn template_with_dot_dot_segment_is_rejected() {
        let payload = with_field(valid_payload(), "template", json!("../escape.yml"));
        assert!(validate_ci_artifact_payload(&payload).is_err());
    }

    #[test]
    fn absolute_template_path_is_rejected() {
        let payload = with_field(valid_payload(), "template", json!("/etc/passwd"));
        assert!(validate_ci_artifact_payload(&payload).is_err());
    }

    #[test]
    fn format_other_than_yaml_is_rejected() {
        let payload = with_field(valid_payload(), "format", json!("json"));
        let errors = validate_ci_artifact_payload(&payload).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("format")));
    }

    #[test]
    fn artifact_id_with_uppercase_letter_is_rejected() {
        let payload = with_field(valid_payload(), "artifactId", json!("Lint-Demo"));
        assert!(validate_ci_artifact_payload(&payload).is_err());
    }

    #[test]
    fn absolute_target_path_is_rejected() {
        let payload = with_field(valid_payload(), "targetPath", json!("/etc/passwd"));
        assert!(validate_ci_artifact_payload(&payload).is_err());
    }

    #[test]
    fn target_path_with_dot_dot_is_rejected() {
        let payload = with_field(valid_payload(), "targetPath", json!("../escape.yml"));
        assert!(validate_ci_artifact_payload(&payload).is_err());
    }

    #[test]
    fn mode_outside_known_set_is_rejected() {
        let payload = with_field(valid_payload(), "mode", json!("delete"));
        assert!(validate_ci_artifact_payload(&payload).is_err());
    }

    #[test]
    fn merge_strategy_outside_known_set_is_rejected() {
        let payload = with_field(valid_payload(), "mergeStrategy", json!("overwrite"));
        assert!(validate_ci_artifact_payload(&payload).is_err());
    }

    #[test]
    fn fix_not_boolean_is_rejected() {
        let payload = with_field(valid_payload(), "fix", json!("true"));
        assert!(validate_ci_artifact_payload(&payload).is_err());
    }

    #[test]
    fn payload_not_an_object_is_rejected() {
        assert!(validate_ci_artifact_payload(&Value::Null).is_err());
        assert!(validate_ci_artifact_payload(&json!("nope")).is_err());
        assert!(validate_ci_artifact_payload(&json!([1, 2])).is_err());
    }

    /// Дзеркало JS «усі помилки акумулюються в одному виклику»
    /// (`tests/slot-contracts-ci.test.mjs:108-112`).
    #[test]
    fn all_errors_accumulate_in_a_single_call() {
        let payload = json!({ "mode": "delete" });
        let errors = validate_ci_artifact_payload(&payload).unwrap_err();
        assert!(errors.len() > 3);
    }

    #[test]
    fn ci_artifact_id_regex_matches_js_format() {
        assert!(CI_ARTIFACT_ID_RE.is_match("lint-php"));
        assert!(!CI_ARTIFACT_ID_RE.is_match("LintPhp"));
        assert!(!CI_ARTIFACT_ID_RE.is_match(""));
    }

    #[test]
    fn is_safe_repo_relative_path_matches_js_semantics() {
        assert!(is_safe_repo_relative_path(".github/workflows/x.yml"));
        assert!(!is_safe_repo_relative_path("/abs"));
        assert!(!is_safe_repo_relative_path("a/../b"));
        assert!(!is_safe_repo_relative_path(""));
    }

    #[test]
    fn is_safe_template_rel_path_matches_js_semantics() {
        assert!(is_safe_template_rel_path("./a/b.yml"));
        assert!(!is_safe_template_rel_path("a/b.yml"));
        assert!(!is_safe_template_rel_path("./a/../b.yml"));
    }
}
