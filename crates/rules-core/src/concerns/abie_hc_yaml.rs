//! Валідація modeline у `hc.yaml` для abie — точний порт
//! `npm/rules/abie/lib/hc-yaml.mjs` (27 рядків).
//!
//! Per-document структурна валідація `HealthCheckPolicy` живе у
//! `policy/health_check_policy/health_check_policy.rego` (rego-концерн, поза
//! обсягом цього H1-кластеру) — тут лише перевірка службового першого рядка.

use super::abie_yaml::{strip_bom, MODELINE_RE};

/// Очікуваний URL `$schema` для **hc.yaml** (abie.mdc) — точний порт
/// `ABIE_HC_SCHEMA_URL` (`hc-yaml.mjs:9`).
pub(crate) const ABIE_HC_SCHEMA_URL: &str =
    "https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json";

/// Перевіряє modeline (`# yaml-language-server: $schema=...`) у `hc.yaml` —
/// точний порт `validateAbieHcModeline` (`hc-yaml.mjs:17-27`). На відміну
/// від [`super::abie_yaml::strip_bom_and_modeline`], перший рядок тут
/// перевіряється БЕЗ `.trim()` перед `.match()` (лише `.trim() === ''` для
/// empty-гілки) — точний порт іншого call site в оригіналі.
pub(crate) fn validate_abie_hc_modeline(raw: &str, rel_path: &str) -> Option<String> {
    let body = strip_bom(raw);
    let normalized = body.replace("\r\n", "\n");
    let mut parts = normalized.splitn(2, '\n');
    let first = parts.next().unwrap_or("");

    if first.trim().is_empty() {
        return Some(format!(
            "{rel_path}: перший рядок порожній — потрібен # yaml-language-server: $schema=… (abie.mdc)"
        ));
    }
    let Some(caps) = MODELINE_RE.captures(first) else {
        return Some(format!(
            "{rel_path}: перший рядок має бути modeline $schema (abie.mdc)"
        ));
    };
    let schema = &caps[1];
    if schema != ABIE_HC_SCHEMA_URL {
        return Some(format!(
            "{rel_path}: $schema має бути\n     {ABIE_HC_SCHEMA_URL}\n     (abie.mdc)"
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const REL_PATH: &str = "k8s/foo/hc.yaml";

    // --- дзеркало lib/tests/hc-yaml.test.mjs ---

    #[test]
    fn ok_valid_modeline_returns_none() {
        let raw = format!(
            "# yaml-language-server: $schema={ABIE_HC_SCHEMA_URL}\napiVersion: networking.gke.io/v1\nkind: HealthCheckPolicy\n"
        );
        assert!(validate_abie_hc_modeline(&raw, REL_PATH).is_none());
    }

    #[test]
    fn empty_first_line_gives_empty_line_error() {
        let raw = "\napiVersion: networking.gke.io/v1\n";
        assert_eq!(
            validate_abie_hc_modeline(raw, REL_PATH).unwrap(),
            format!("{REL_PATH}: перший рядок порожній — потрібен # yaml-language-server: $schema=… (abie.mdc)")
        );
    }

    #[test]
    fn whitespace_only_first_line_is_also_empty_error() {
        let err = validate_abie_hc_modeline("   \napiVersion: x\n", REL_PATH).unwrap();
        assert!(err.contains("перший рядок порожній"));
    }

    #[test]
    fn non_modeline_first_line_gives_modeline_error() {
        let raw = "apiVersion: networking.gke.io/v1\nkind: HealthCheckPolicy\n";
        assert_eq!(
            validate_abie_hc_modeline(raw, REL_PATH).unwrap(),
            format!("{REL_PATH}: перший рядок має бути modeline $schema (abie.mdc)")
        );
    }

    #[test]
    fn wrong_schema_url_gives_schema_error_with_expected_url() {
        let raw = "# yaml-language-server: $schema=https://example.com/wrong.json\napiVersion: x\n";
        let err = validate_abie_hc_modeline(raw, REL_PATH).unwrap();
        assert!(err.contains(&format!("{REL_PATH}: $schema має бути")));
        assert!(err.contains(ABIE_HC_SCHEMA_URL));
        assert!(err.contains("(abie.mdc)"));
    }

    #[test]
    fn crlf_newlines_also_parse() {
        let raw =
            format!("# yaml-language-server: $schema={ABIE_HC_SCHEMA_URL}\r\napiVersion: x\r\n");
        assert!(validate_abie_hc_modeline(&raw, REL_PATH).is_none());
    }

    #[test]
    fn bom_prefix_is_stripped_before_validation() {
        let raw = format!(
            "\u{FEFF}# yaml-language-server: $schema={ABIE_HC_SCHEMA_URL}\napiVersion: x\n"
        );
        assert!(validate_abie_hc_modeline(&raw, REL_PATH).is_none());
    }

    #[test]
    fn fully_empty_file_is_empty_line_error() {
        assert!(validate_abie_hc_modeline("", REL_PATH)
            .unwrap()
            .contains("перший рядок порожній"));
    }

    #[test]
    fn rel_path_is_included_in_all_error_messages() {
        let custom = "pkg-x/k8s/hc.yaml";
        assert!(validate_abie_hc_modeline("", custom)
            .unwrap()
            .starts_with("pkg-x/k8s/hc.yaml:"));
        assert!(validate_abie_hc_modeline("foo\n", custom)
            .unwrap()
            .starts_with("pkg-x/k8s/hc.yaml:"));
        assert!(validate_abie_hc_modeline(
            "# yaml-language-server: $schema=https://x.json\n",
            custom
        )
        .unwrap()
        .starts_with("pkg-x/k8s/hc.yaml:"));
    }
}
