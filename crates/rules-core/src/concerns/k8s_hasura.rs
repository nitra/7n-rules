//! Спільний шар розпізнавання Hasura-маніфестів — native-порт хелперів
//! `npm/rules/k8s/manifests/main.mjs`, на які спираються обидва gated-детектори
//! кластера (`k8s/hasura_configmap`, `k8s/hasura_httproute`).
//!
//! Обидва концерни — **JS-gating + rego-валідація**: тут живе тільки gating
//! (який файл узагалі варто віддавати в `conftest`), а пер-документний канон
//! лишається в rego-пакетах `k8s.hasura_configmap`/`k8s.hasura_httproute`
//! (мотив — доккомент [`crate::conftest`]).
//!
//! Портовані функції (з посиланням на рядки JS-канону):
//!
//! | Rust | JS |
//! |---|---|
//! | [`parse_k8s_yaml_docs`] | `indexOneK8sYamlForHasuraCanon` (`main.mjs:3125-3145`, частина «читання+парсинг») |
//! | [`is_hasura_deployment_manifest`] | `isHasuraDeploymentManifest` (`main.mjs:2258-2271`) |
//! | [`manifest_metadata_name`] | `manifestMetadataName` (`main.mjs:3718-3726`) |
//! | [`dir_has_hasura_deployment`] | заміна `findDeploymentDocInDir` у гейті ConfigMap — див. секцію «Полагоджений дефект канону» |
//!
//! # Полагоджений дефект канону: гейт ConfigMap брав ПЕРШИЙ Deployment
//!
//! JS-гейт `validateHasuraConfigMapRemoteSchemaPermissions` (`main.mjs:3613-3620`)
//! питав `findDeploymentDocInDir(dir)` — «перший документ `kind: Deployment`
//! серед YAML-файлів каталогу» — і лише його перевіряв на Hasura-образ. Два
//! наслідки, обидва помилкові:
//!
//! 1. **False negative на каталозі з кількома Deployment.** Якщо поруч із
//!    Hasura-Deployment лежить іще один (допоміжний застосунок, міграції), і саме
//!    він трапився першим — гейт закривався, і ConfigMap Hasura взагалі **не**
//!    доходив до перевірки. Обов'язкові `HASURA_GRAPHQL_*` env мовчки зникали
//!    з перевірки.
//! 2. **Недетермінізм.** «Перший» визначався порядком `readdir`, тобто
//!    порядком файлової системи: APFS віддає імена впорядковано, ext4 — у
//!    hash-порядку. Той самий репозиторій міг давати різний вислід на macOS і
//!    на Linux-раннері CI.
//!
//! Сусідній концерн `k8s/hasura_httproute` той самий гейт робить **правильно**:
//! `collectHasuraDeploymentsAndHttpRoutes` (`main.mjs:3099-3115`) індексує
//! **всі** Hasura-Deployment каталогу, а не перший-ліпший Deployment. Тобто це
//! не задум, а розходження двох реалізацій одного гейта.
//!
//! Порт лагодить дефект, а не копіює його (Р11 спеки
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`): [`dir_has_hasura_deployment`]
//! питає «чи є в каталозі **хоч один** документ `kind: Deployment` з
//! Hasura-образом», обходячи файли у **відсортованому** порядку. Напрямок
//! зміни — fail-closed: під валідацію потрапляє строго більше ConfigMap, ніж
//! раніше, жоден не випадає.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use crate::concerns::abie_yaml::strip_bom_and_modeline;

/// Префікс `apiVersion` Gateway API — порт `GATEWAY_API_GROUP_PREFIX`
/// (`main.mjs:183`).
pub const GATEWAY_API_GROUP_PREFIX: &str = "gateway.networking.k8s.io/";

/// Чи рядок `image` вказує на репозиторій `hasura/graphql-engine` — порт
/// `HASURA_GRAPHQL_ENGINE_RE` (`main.mjs:197`,
/// `/(^|\/)hasura\/graphql-engine(?::|$)/u`) поверх `stripImageDigest`
/// (`main.mjs:2219-2222`). Реалізовано без `regex`: три альтернативи
/// вироджуються у пару `strip_suffix`/`ends_with`, і так видно, що саме
/// перевіряється.
fn is_hasura_graphql_engine_image_ref(image: &str) -> bool {
    let without_digest = match image.find('@') {
        Some(at) => &image[..at],
        None => image,
    }
    .trim();
    // `(?::|$)` — або кінець рядка, або двокрапка перед тегом.
    let repo = match without_digest.find(':') {
        Some(colon) => &without_digest[..colon],
        None => without_digest,
    };
    // `(^|\/)` — репозиторій або весь рядок, або хвіст після `/`.
    repo == "hasura/graphql-engine" || repo.ends_with("/hasura/graphql-engine")
}

/// Чи серед контейнерів є хоч один з Hasura-образом — порт
/// `containerListHasHasuraImage` (`main.mjs:2240-2250`).
fn container_list_has_hasura_image(containers: Option<&Value>) -> bool {
    containers.and_then(Value::as_array).is_some_and(|items| {
        items.iter().any(|c| {
            c.as_object()
                .and_then(|obj| obj.get("image"))
                .and_then(Value::as_str)
                .is_some_and(|image| !image.is_empty() && is_hasura_graphql_engine_image_ref(image))
        })
    })
}

/// Чи документ — `kind: Deployment` з Hasura-образом у `containers` або
/// `initContainers` — порт `isHasuraDeploymentManifest` (`main.mjs:2258-2271`).
pub fn is_hasura_deployment_manifest(manifest: &Value) -> bool {
    let Some(rec) = manifest.as_object() else {
        return false;
    };
    if rec.get("kind").and_then(Value::as_str) != Some("Deployment") {
        return false;
    }
    let Some(pod_spec) = rec
        .get("spec")
        .and_then(Value::as_object)
        .and_then(|spec| spec.get("template"))
        .and_then(Value::as_object)
        .and_then(|template| template.get("spec"))
        .and_then(Value::as_object)
    else {
        return false;
    };
    container_list_has_hasura_image(pod_spec.get("containers"))
        || container_list_has_hasura_image(pod_spec.get("initContainers"))
}

/// Непорожній `metadata.name` документа — порт `manifestMetadataName`
/// (`main.mjs:3718-3726`) у тій формі, у якій його вживають обидва гейти
/// (порожній рядок трактується як відсутність імені).
pub fn manifest_metadata_name(manifest: &Value) -> Option<&str> {
    manifest
        .as_object()
        .and_then(|rec| rec.get("metadata"))
        .and_then(Value::as_object)
        .and_then(|meta| meta.get("name"))
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
}

/// Читає YAML-файл і повертає успішно розпарсені документи — порт блоку
/// «читання + `parseAllDocuments`» з `indexOneK8sYamlForHasuraCanon`
/// (`main.mjs:3125-3145`), включно зі зрізанням modeline
/// `# yaml-language-server: $schema=…` першим рядком.
///
/// Помилка читання чи повністю нерозбірний потік → порожній вектор (JS так
/// само мовчки `return`), окремий биті документ у мультидокументному потоці
/// пропускається (еквівалент `doc.errors.length !== 0 → continue`).
pub fn parse_k8s_yaml_docs(abs: &Path) -> Vec<Value> {
    let Ok(raw) = std::fs::read_to_string(abs) else {
        return Vec::new();
    };
    let body = strip_bom_and_modeline(&raw);
    serde_yaml::Deserializer::from_str(&body)
        .filter_map(|doc| serde_yaml::Value::deserialize(doc).ok())
        .filter_map(|v| serde_json::to_value(v).ok())
        .collect()
}

/// Чи є шлях YAML-файлом за `K8S_YAML_EXT_RE` (`main.mjs:2301`, `/\.ya?ml$/iu`).
fn has_yaml_extension(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".yaml") || lower.ends_with(".yml")
}

/// Відсортовані імена файлів каталогу (помилка читання → порожньо) — порт
/// `tryReaddir` (`main.mjs:2380-2386`) з доданим сортуванням, без якого гейт
/// залежав би від порядку файлової системи (секція «Полагоджений дефект
/// канону» у доккоменті модуля).
fn sorted_dir_entries(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    names.sort();
    names
}

/// Чи є в каталозі **хоч один** документ `kind: Deployment` з Hasura-образом.
///
/// Свідомо ширше за `findDeploymentDocInDir` + `isHasuraDeploymentManifest`
/// JS-канону («перший Deployment каталогу — Hasura?») — обґрунтування й
/// напрямок зміни в секції «Полагоджений дефект канону» доккоменту модуля.
pub fn dir_has_hasura_deployment(dir: &Path) -> bool {
    sorted_dir_entries(dir)
        .into_iter()
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(has_yaml_extension)
        })
        .any(|path| {
            parse_k8s_yaml_docs(&path)
                .iter()
                .any(is_hasura_deployment_manifest)
        })
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

    /// Мінімальний Hasura-Deployment із заданим `metadata.name` і образом.
    fn hasura_deployment(name: &str, image: &str) -> String {
        format!(
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {name}\nspec:\n  \
             template:\n    spec:\n      containers:\n        - name: h\n          image: {image}\n"
        )
    }

    /// Кожна форма посилання на образ Hasura з JS-регексу — і з тегом, і без,
    /// і з registry-префіксом, і з digest.
    #[test]
    fn hasura_image_ref_matches_all_canonical_forms() {
        assert!(is_hasura_graphql_engine_image_ref("hasura/graphql-engine"));
        assert!(is_hasura_graphql_engine_image_ref(
            "hasura/graphql-engine:v2.49.0"
        ));
        assert!(is_hasura_graphql_engine_image_ref(
            "eu.gcr.io/proj/hasura/graphql-engine:v2"
        ));
        assert!(is_hasura_graphql_engine_image_ref(
            "hasura/graphql-engine@sha256:abc"
        ));
        // Не збіг: інший репозиторій із схожим хвостом і чужий образ.
        assert!(!is_hasura_graphql_engine_image_ref(
            "other-org/graphql-engine"
        ));
        assert!(!is_hasura_graphql_engine_image_ref("postgres:16"));
    }

    /// `initContainers` рахуються нарівні з `containers`, а не-Deployment
    /// `kind` відкидається одразу.
    #[test]
    fn hasura_deployment_detection_covers_init_containers() {
        let with_init: Value = serde_yaml::from_str(
            "kind: Deployment\nspec:\n  template:\n    spec:\n      initContainers:\n        \
             - image: hasura/graphql-engine:v2\n",
        )
        .and_then(|v: serde_yaml::Value| serde_json::to_value(v).map_err(serde::de::Error::custom))
        .unwrap();
        assert!(is_hasura_deployment_manifest(&with_init));

        let stateful_set: Value = serde_yaml::from_str(
            "kind: StatefulSet\nspec:\n  template:\n    spec:\n      containers:\n        \
             - image: hasura/graphql-engine:v2\n",
        )
        .and_then(|v: serde_yaml::Value| serde_json::to_value(v).map_err(serde::de::Error::custom))
        .unwrap();
        assert!(!is_hasura_deployment_manifest(&stateful_set));
    }

    /// Modeline `# yaml-language-server: $schema=…` не заважає розбору, а
    /// мультидокументний файл дає всі документи.
    #[test]
    fn parse_k8s_yaml_docs_handles_modeline_and_multidoc() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/all.yaml",
            "# yaml-language-server: $schema=https://example.com/s.json\nkind: ConfigMap\n---\nkind: Service\n",
        );
        let docs = parse_k8s_yaml_docs(&tmp.path().join("k8s/base/all.yaml"));
        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0]["kind"], "ConfigMap");
        assert_eq!(docs[1]["kind"], "Service");
    }

    /// Неіснуючий файл → порожньо, без паніки (JS-гілка `catch { return }`).
    #[test]
    fn parse_k8s_yaml_docs_on_missing_file_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(parse_k8s_yaml_docs(&tmp.path().join("nope.yaml")).is_empty());
    }

    /// Гейт бачить Hasura-Deployment у каталозі.
    #[test]
    fn dir_has_hasura_deployment_finds_single_deployment() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/deployment.yaml",
            &hasura_deployment("db-h", "hasura/graphql-engine:v2.49.0"),
        );
        assert!(dir_has_hasura_deployment(&tmp.path().join("k8s/base")));
    }

    /// **Фальсифікація полагодженого дефекту**: у каталозі два Deployment —
    /// не-Hasura `a-worker.yaml` (лексикографічно перший, тобто саме той, який
    /// узяв би `findDeploymentDocInDir`) і Hasura `z-hasura.yaml`. JS-канон тут
    /// закривав гейт і ConfigMap НЕ перевірявся; порт бачить Hasura-Deployment.
    #[test]
    fn dir_has_hasura_deployment_sees_hasura_behind_another_deployment() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/a-worker.yaml",
            &hasura_deployment("worker", "myrepo/worker:1.0.0"),
        );
        write(
            &tmp,
            "k8s/base/z-hasura.yaml",
            &hasura_deployment("db-h", "hasura/graphql-engine:v2.49.0"),
        );
        assert!(dir_has_hasura_deployment(&tmp.path().join("k8s/base")));
    }

    /// Каталог без жодного Hasura-Deployment (CronJob + звичайний Deployment)
    /// гейт не відкриває — інакше native-порт був би fail-open ширшим за
    /// потрібне.
    #[test]
    fn dir_without_hasura_keeps_gate_closed() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "k8s/base/deployment.yaml",
            &hasura_deployment("worker", "myrepo/worker:1.0.0"),
        );
        write(&tmp, "k8s/base/cronjob.yaml", "kind: CronJob\n");
        write(&tmp, "k8s/base/notes.md", "не yaml\n");
        assert!(!dir_has_hasura_deployment(&tmp.path().join("k8s/base")));
    }

    /// Неіснуючий каталог → гейт закритий, без паніки.
    #[test]
    fn dir_has_hasura_deployment_on_missing_dir_is_false() {
        let tmp = TempDir::new().unwrap();
        assert!(!dir_has_hasura_deployment(&tmp.path().join("nope")));
    }

    /// Порожнє `metadata.name` — те саме, що відсутнє (обидва гейти вимагають
    /// саме непорожнє ім'я).
    #[test]
    fn metadata_name_treats_empty_as_absent() {
        let named: Value = serde_json::json!({ "metadata": { "name": "db-h" } });
        let empty: Value = serde_json::json!({ "metadata": { "name": "" } });
        let none: Value = serde_json::json!({ "metadata": {} });
        assert_eq!(manifest_metadata_name(&named), Some("db-h"));
        assert_eq!(manifest_metadata_name(&empty), None);
        assert_eq!(manifest_metadata_name(&none), None);
    }
}
