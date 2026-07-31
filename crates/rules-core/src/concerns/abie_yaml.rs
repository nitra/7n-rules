//! Спільні YAML-хелпери для abie-перевірок — порт `npm/rules/abie/lib/yaml.mjs`
//! (74 рядки): BOM-strip, розпізнавання modeline `# yaml-language-server:
//! $schema=…`, мультидокументний парсинг з конвертацією в `serde_json::Value`
//! для структурних перевірок (аналог `doc.toJSON()` пакета `yaml`).
//!
//! # Вибір крейта — `serde_yaml`
//!
//! Обґрунтування — doc-комент дужки `serde_yaml` у `Cargo.toml` цього крейта
//! (коротко: `serde_yaml::Value` вже `Serialize`, тож `serde_json::to_value`
//! дає прямий еквівалент `doc.toJSON()`; мультидокументність — через
//! `Deserializer::from_str`, той самий лінивий по-документний підхід, що й
//! `parseAllDocuments`).
//!
//! # Спрощення відносно JS: без «catastrophic parse»-гілки
//!
//! `readAndParseYamlDocs` (`yaml.mjs:54-74`) обгортає весь виклик
//! `parseAllDocuments` у `try/catch` — гілка `catch` (репортує `"$rel: YAML
//! ($msg)"`) спрацьовує лише при фундаментально неможливому парсингу всього
//! потоку; окремі биті документи в інакше валідному мультидокументному потоці
//! **не** тригерять цю гілку — `yaml`-пакет лінивий: помилка одного документа
//! лишається в його власному `.errors`, не валить сусідні. Жоден тест
//! H1-кластеру (concern- чи lib-рівня) не покладається на "catastrophic
//! parse"-гілку (лише на per-file read-помилки — `EACCES` через `chmod
//! 0o000`). `serde_yaml::Deserializer::from_str` розбиває потік на документи
//! лексично (за `---`/`...` межами), незалежно від валідності вмісту кожного
//! документа — тож для наших фікстур ця гілка практично недосяжна і тут:
//! [`read_and_parse_yaml_docs`] повертає `Err` лише на помилку читання файлу,
//! а помилкові документи в мультидокументному потоці — [`parse_all_documents`]
//! мовчки пропускає (той самий видимий ефект, що й `doc.errors.length > 0`
//! перевірка на кожному call site у JS).

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;

/// Розпізнає modeline `yaml-language-server` з `$schema=` — порт
/// `MODELINE_RE` (`yaml.mjs:10`, `/^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/`).
/// Використовується і тут (лінива перевірка на `.trim()`-нутому рядку), і в
/// `abie_hc_yaml` (перевірка на сирому рядку без trim — інша семантика на
/// іншому call site, звірено з `hc-yaml.mjs:23`).
pub(crate) static MODELINE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$").expect("valid regex")
});

/// Прибирає BOM (U+FEFF) на початку тексту — точний порт `stripBom`
/// (`yaml.mjs:19-21`).
pub(crate) fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{FEFF}').unwrap_or(s)
}

/// Прибирає BOM і, за наявності на першому рядку, service-modeline
/// `# yaml-language-server: $schema=...` — точний порт спільного
/// inline-блоку (`stripBom` + `LINE_SPLIT_RE`-спліт першого рядка +
/// `MODELINE_RE.test(first.trim())`), що дублюється в `yaml.mjs:63-66` і
/// `kustomization-patches.mjs:81-84,142-144`. CRLF нормалізується в LF лише
/// для побудови "rest"-фрагмента (коли modeline знайдено); коли modeline
/// немає — повертається оригінальний `body` без змін (той самий контракт, що
/// й `rest = body` у JS, зберігає CRLF).
pub(crate) fn strip_bom_and_modeline(raw: &str) -> String {
    let body = strip_bom(raw);
    let normalized = body.replace("\r\n", "\n");
    let mut parts = normalized.splitn(2, '\n');
    let first = parts.next().unwrap_or("");
    if MODELINE_RE.is_match(first.trim()) {
        parts.next().unwrap_or("").to_string()
    } else {
        body.to_string()
    }
}

/// Чи YAML-документ (уже конвертований у `serde_json::Value`) — це `kind:
/// Deployment` — точний порт `isDeploymentDoc` (`yaml.mjs:28-35`).
pub(crate) fn is_deployment_doc(value: &serde_json::Value) -> bool {
    value
        .as_object()
        .and_then(|obj| obj.get("kind"))
        .and_then(|k| k.as_str())
        == Some("Deployment")
}

/// Парсить (уже без BOM/modeline) YAML-текст як мультидокументний потік,
/// повертає лише успішно розпарсені документи — точний видимий ефект
/// `parseAllDocuments(rest)` + по-документна перевірка `doc.errors.length ===
/// 0` на кожному call site (докладніше — секція «Спрощення» у doc-коменті
/// модуля). Порожній `rest` чи потік без документів → порожній `Vec`.
pub(crate) fn parse_all_documents(rest: &str) -> Vec<serde_json::Value> {
    serde_yaml::Deserializer::from_str(rest)
        .filter_map(|doc| serde_yaml::Value::deserialize(doc).ok())
        .filter_map(|v| serde_json::to_value(v).ok())
        .collect()
}

/// Читає й парсить YAML-документи з файлу — точний порт `readAndParseYamlDocs`
/// (`yaml.mjs:54-74`) за винятком "catastrophic parse"-гілки (секція
/// «Спрощення» у doc-коменті модуля). `Err` — лише при помилці читання файлу,
/// з тим самим форматом повідомлення, що й JS (`"$rel: не вдалося прочитати
/// ($msg)"`).
pub(crate) fn read_and_parse_yaml_docs(
    abs: &Path,
    rel: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let raw = std::fs::read_to_string(abs)
        .map_err(|err| format!("{rel}: не вдалося прочитати ({err})"))?;
    let rest = strip_bom_and_modeline(&raw);
    Ok(parse_all_documents(&rest))
}

/// posix-relative шлях від `root`, або сам `abs` (як рядок, as-is), якщо
/// `abs` збігається з `root` (relative() дає порожній рядок) — точний порт
/// повторюваного патерну `relative(root, x).replaceAll('\\','/') || x`,
/// що зустрічається по всьому abie main.mjs/lib кластеру.
pub(crate) fn rel_posix_or_self(root: &Path, abs: &Path) -> String {
    match abs.strip_prefix(root) {
        Ok(rel) if !rel.as_os_str().is_empty() => rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
        _ => abs.to_string_lossy().into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    // --- strip_bom: дзеркало lib/tests/yaml.test.mjs:12-24 ---

    #[test]
    fn strip_bom_removes_leading_bom() {
        assert_eq!(strip_bom("\u{FEFF}apiVersion: v1"), "apiVersion: v1");
    }

    #[test]
    fn strip_bom_no_bom_unchanged() {
        assert_eq!(strip_bom("apiVersion: v1"), "apiVersion: v1");
    }

    #[test]
    fn strip_bom_empty_string() {
        assert_eq!(strip_bom(""), "");
    }

    // --- is_deployment_doc: дзеркало lib/tests/yaml.test.mjs:48-68 ---

    #[test]
    fn is_deployment_doc_true_for_deployment_kind() {
        assert!(is_deployment_doc(
            &serde_json::json!({ "kind": "Deployment", "apiVersion": "apps/v1" })
        ));
    }

    #[test]
    fn is_deployment_doc_false_for_service_kind() {
        assert!(!is_deployment_doc(
            &serde_json::json!({ "kind": "Service" })
        ));
    }

    #[test]
    fn is_deployment_doc_false_for_null() {
        assert!(!is_deployment_doc(&serde_json::Value::Null));
    }

    #[test]
    fn is_deployment_doc_false_for_array() {
        assert!(!is_deployment_doc(
            &serde_json::json!([{ "kind": "Deployment" }])
        ));
    }

    #[test]
    fn is_deployment_doc_false_for_string() {
        assert!(!is_deployment_doc(&serde_json::json!("Deployment")));
    }

    // --- strip_bom_and_modeline / parse_all_documents ---

    #[test]
    fn strip_bom_and_modeline_removes_modeline_line() {
        let raw = "# yaml-language-server: $schema=https://example.com/s.json\nkind: Service\n";
        let rest = strip_bom_and_modeline(raw);
        assert_eq!(rest.trim(), "kind: Service");
    }

    #[test]
    fn strip_bom_and_modeline_keeps_body_without_modeline() {
        let raw = "kind: Service\n";
        assert_eq!(strip_bom_and_modeline(raw), raw);
    }

    #[test]
    fn parse_all_documents_parses_multiple_docs_separated_by_dashes() {
        let rest = "kind: Deployment\n---\nkind: Service\n";
        let docs = parse_all_documents(rest);
        assert_eq!(docs.len(), 2);
        assert!(is_deployment_doc(&docs[0]));
        assert!(!is_deployment_doc(&docs[1]));
    }

    #[test]
    fn parse_all_documents_empty_input_yields_no_deployment_doc() {
        // Порожній вхід — один "null"-документ (конвенція YAML-парсерів для
        // порожнього потоку), не помилка і не []; для наших структурних
        // перевірок (kind/patches/...) null поводиться як «немає збігу»
        // (усі `.as_object()` повертають `None`) — той самий видимий ефект,
        // що й порожній результат.
        let docs = parse_all_documents("");
        assert!(docs.iter().all(|d| !is_deployment_doc(d)));
    }

    // --- read_and_parse_yaml_docs: дзеркало lib/tests/yaml.test.mjs:77-118 ---

    #[test]
    fn read_and_parse_yaml_docs_reads_valid_yaml() {
        let tmp = TempDir::new().unwrap();
        let abs = tmp.path().join("test.yaml");
        fs::write(&abs, "kind: Deployment\napiVersion: apps/v1\n").unwrap();
        let docs = read_and_parse_yaml_docs(&abs, "test.yaml").unwrap();
        assert_eq!(docs.len(), 1);
    }

    #[test]
    fn read_and_parse_yaml_docs_strips_modeline_before_parsing() {
        let tmp = TempDir::new().unwrap();
        let abs = tmp.path().join("with-modeline.yaml");
        fs::write(
            &abs,
            "# yaml-language-server: $schema=https://example.com/s.json\nkind: Service\n",
        )
        .unwrap();
        let docs = read_and_parse_yaml_docs(&abs, "with-modeline.yaml").unwrap();
        assert_eq!(docs.len(), 1);
    }

    #[test]
    fn read_and_parse_yaml_docs_strips_bom_before_parsing() {
        let tmp = TempDir::new().unwrap();
        let abs = tmp.path().join("bom.yaml");
        fs::write(&abs, "\u{FEFF}kind: Deployment\n").unwrap();
        let docs = read_and_parse_yaml_docs(&abs, "bom.yaml").unwrap();
        assert_eq!(docs.len(), 1);
        assert!(is_deployment_doc(&docs[0]));
    }

    #[test]
    fn read_and_parse_yaml_docs_missing_file_is_err() {
        let err =
            read_and_parse_yaml_docs(Path::new("/nonexistent/path.yaml"), "path.yaml").unwrap_err();
        assert!(err.starts_with("path.yaml: не вдалося прочитати"));
    }

    // --- rel_posix_or_self ---

    #[test]
    fn rel_posix_or_self_returns_relative_posix_path() {
        let root = Path::new("/repo");
        assert_eq!(
            rel_posix_or_self(root, Path::new("/repo/pkg/hc.yaml")),
            "pkg/hc.yaml"
        );
    }

    #[test]
    fn rel_posix_or_self_falls_back_to_self_when_equal_to_root() {
        let root = Path::new("/repo");
        assert_eq!(rel_posix_or_self(root, Path::new("/repo")), "/repo");
    }
}
