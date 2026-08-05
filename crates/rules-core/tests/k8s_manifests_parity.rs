//! Parity-гейт портованого зрізу концерну `k8s/manifests`: ті самі фікстури
//! проганяються **native**-функціями
//! ([`rules_core::concerns::k8s_manifests_cross_file`]) і **JS-каноном**
//! (`npm/rules/k8s/manifests/main.mjs` у дочірньому `node`), а списки
//! повідомлень звіряються посимвольно і в тому самому порядку.
//!
//! # Чому саме так, а не через registry
//!
//! `k8s/manifests` свідомо НЕ заведений у `NATIVE_CONCERNS` — концерн
//! неподільний для диспатчу, і зайде туди, коли портовані всі чотири шари його
//! `lint()`. Тому шлях `runConcernDetector` (яким користується
//! `hasura-native-parity.test.mjs`) для цього зрізу недоступний, і паритет
//! доводиться «навпаки»: Rust-тест сам кличе JS.
//!
//! Список YAML-файлів рахує **Rust** ([`find_k8s_yaml_files`]) і передає в
//! node готовим — щоб паритет міряв рівно `validate*`, а не вже портований
//! раніше обхід дерева (він має власні тести в `concerns::k8s_common`), і щоб
//! дочірній node не тягнув native-аддон.
//!
//! # Пропуск
//!
//! Без `node` у PATH або без `node_modules` у корені репо тест пропускається —
//! та сама умова, що в JS-тестах кластера (вони скіпаються без `conftest`).

use std::path::{Path, PathBuf};
use std::process::Command;

use rules_core::concerns::find_k8s_yaml_files;
use rules_core::concerns::k8s_manifests_cross_file::{
    assert_no_forbidden_k8s_dev_paths, validate_configmap_name_matches_deployment,
    validate_kustomization_includes_svc_hl_with_svc,
    validate_kustomization_path_refs_exist_on_disk, validate_svc_yaml_and_svc_hl_pairs,
};
use tempfile::TempDir;

/// Драйвер JS-боку: імпортує канон, проганяє ті самі пʼять перевірок у тому
/// самому порядку і друкує JSON-масив повідомлень.
const JS_DRIVER: &str = r#"import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [root, modulePath, filesJson] = process.argv.slice(2)
const canon = await import(pathToFileURL(modulePath).href)
const files = JSON.parse(await readFile(filesJson, 'utf8'))
const out = []
const fail = msg => {
  out.push(msg)
}
const pass = () => {}

canon.assertNoForbiddenK8sDevPaths(files, root, fail)
await canon.validateSvcYamlAndSvcHlPairs(root, files, fail)
await canon.validateKustomizationPathRefsExistOnDisk(root, files, fail)
await canon.validateKustomizationIncludesSvcHlWithSvc(root, files, fail)
await canon.validateConfigMapNameMatchesDeployment(root, files, fail, pass)

process.stdout.write(JSON.stringify(out))
"#;

/// Корінь репо: `<repo>/crates/rules-core` → два рівні вгору.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crates/rules-core лежить на два рівні під коренем репо")
        .to_path_buf()
}

/// Чи є все потрібне для JS-боку (інакше тест пропускається).
fn js_canon_available() -> bool {
    let root = repo_root();
    root.join("node_modules").is_dir()
        && root.join("npm/rules/k8s/manifests/main.mjs").is_file()
        && Command::new("node")
            .arg("--version")
            .output()
            .is_ok_and(|out| out.status.success())
}

/// Кладе файл із створенням батьківських каталогів.
fn write(tmp: &TempDir, rel: &str, content: &str) {
    let abs = tmp.path().join(rel);
    std::fs::create_dir_all(abs.parent().expect("шлях має батька")).expect("mkdir");
    std::fs::write(abs, content).expect("write");
}

/// Повідомлення native-боку — пʼять перевірок у порядку виклику з `lint()`.
fn native_messages(root: &Path, files: &[PathBuf]) -> Vec<String> {
    let mut out = Vec::new();
    out.extend(assert_no_forbidden_k8s_dev_paths(root, files));
    out.extend(validate_svc_yaml_and_svc_hl_pairs(root, files));
    out.extend(validate_kustomization_path_refs_exist_on_disk(root, files));
    out.extend(validate_kustomization_includes_svc_hl_with_svc(root, files));
    out.extend(validate_configmap_name_matches_deployment(root, files));
    out.into_iter().map(|v| v.message).collect()
}

/// Повідомлення JS-канону на тому самому дереві й тому самому списку файлів.
fn js_messages(tmp: &TempDir, files: &[PathBuf]) -> Vec<String> {
    let root = tmp.path();
    let driver = root.join(".parity-driver.mjs");
    std::fs::write(&driver, JS_DRIVER).expect("write driver");
    let files_json = root.join(".parity-files.json");
    let payload: Vec<String> = files
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    std::fs::write(
        &files_json,
        serde_json::to_string(&payload).expect("serialize"),
    )
    .expect("write files json");

    let canon = repo_root().join("npm/rules/k8s/manifests/main.mjs");
    let output = Command::new("node")
        .arg(&driver)
        .arg(root)
        .arg(&canon)
        .arg(&files_json)
        .output()
        .expect("спавн node");
    assert!(
        output.status.success(),
        "JS-канон впав: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "stdout драйвера не JSON ({error}): {}",
            String::from_utf8_lossy(&output.stdout)
        )
    })
}

/// Звіряє native і JS на дереві, зібраному `build`.
fn assert_parity(label: &str, build: impl Fn(&TempDir)) {
    if !js_canon_available() {
        eprintln!("k8s_manifests_parity[{label}]: пропуск — немає node/node_modules");
        return;
    }
    let tmp = TempDir::new().expect("tempdir");
    build(&tmp);
    // Драйвер і його вхід лежать у корені дерева, але `.mjs`/`.json` під `k8s`
    // не потрапляють, тож на вибірку не впливають.
    let files = find_k8s_yaml_files(tmp.path(), &[]);
    assert!(!files.is_empty(), "[{label}] фікстура без YAML під k8s");
    let native = native_messages(tmp.path(), &files);
    let js = js_messages(&tmp, &files);
    assert_eq!(native, js, "[{label}] розбіжність native ↔ JS");
    assert!(
        !native.is_empty() || label.starts_with("clean"),
        "[{label}] фікстура нічого не репортує — гейт був би порожній"
    );
}

/// Deployment із заданим ім'ям і переліком ConfigMap у `envFrom`.
fn deployment(name: &str, configmaps: &[&str]) -> String {
    let env_from = if configmaps.is_empty() {
        String::new()
    } else {
        let items: String = configmaps
            .iter()
            .map(|cm| format!("            - configMapRef:\n                name: {cm}\n"))
            .collect();
        format!("          envFrom:\n{items}")
    };
    format!(
        "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {name}\nspec:\n  template:\n    \
         spec:\n      containers:\n        - name: app\n          image: repo/app:1\n{env_from}"
    )
}

/// Чисте дерево: жодна з пʼяти перевірок не має що сказати — і обидві
/// реалізації мовчать однаково.
#[test]
fn clean_tree_is_silent_on_both_sides() {
    assert_parity("clean", |tmp| {
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            "kind: Kustomization\nnamespace: dev\nresources:\n  - deployment.yaml\n  - svc.yaml\n  \
             - svc-hl.yaml\n  - configmap.yaml\n",
        );
        write(
            tmp,
            "svc/k8s/base/deployment.yaml",
            &deployment("api", &["api"]),
        );
        write(
            tmp,
            "svc/k8s/base/svc.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: api-hl\n",
        );
        write(
            tmp,
            "svc/k8s/base/configmap.yaml",
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: api\n",
        );
    });
}

/// Заборонений `k8s/dev/` — найпростіша з пʼяти перевірок, але з нею у виводі
/// зʼявляється перший рядок, тож звіряється ще й порядок між перевірками.
#[test]
fn forbidden_dev_directory_matches() {
    assert_parity("dev-dir", |tmp| {
        write(tmp, "svc/k8s/dev/deployment.yaml", &deployment("api", &[]));
        write(tmp, "svc/k8s/base/deployment.yaml", &deployment("api", &[]));
    });
}

/// Усі гілки парності `svc.yaml`/`svc-hl.yaml` одразу: осиротілий `-hl`,
/// `svc.yaml` без пари, розбіжні імена та `-hl` без суфікса.
#[test]
fn svc_pair_branches_match() {
    assert_parity("svc-pairs", |tmp| {
        // осиротілий svc-hl.yaml
        write(
            tmp,
            "a/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: a-hl\n",
        );
        // svc.yaml без сусіда
        write(
            tmp,
            "b/k8s/base/svc.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: b\n",
        );
        // розбіжні імена
        write(
            tmp,
            "c/k8s/base/svc.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: c\n",
        );
        write(
            tmp,
            "c/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: c-x-hl\n",
        );
        // -hl без суфікса
        write(
            tmp,
            "d/k8s/base/svc.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: d\n",
        );
        write(
            tmp,
            "d/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: d\n",
        );
    });
}

/// `svc.yaml` без жодного Service і Service без `metadata.name` — дві гілки з
/// власними текстами (друга ще й із 1-based номером документа).
#[test]
fn svc_document_shape_branches_match() {
    assert_parity("svc-shape", |tmp| {
        write(
            tmp,
            "a/k8s/base/svc.yaml",
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n",
        );
        write(
            tmp,
            "a/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: a-hl\n",
        );
        write(
            tmp,
            "b/k8s/base/svc.yaml",
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: y\n---\napiVersion: v1\nkind: \
             Service\nmetadata:\n  namespace: dev\n",
        );
        write(
            tmp,
            "b/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: b-hl\n",
        );
    });
}

/// Посилання kustomization: неіснуючий ресурс, файл із чужим розширенням,
/// вихід за межі репо — і валідні (каталог, віддалений URL) поруч.
#[test]
fn kustomization_path_refs_match() {
    assert_parity("kustomization-refs", |tmp| {
        write(tmp, "svc/k8s/base/deployment.yaml", &deployment("api", &[]));
        write(tmp, "svc/k8s/base/notes.txt", "hi\n");
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            "kind: Kustomization\nnamespace: dev\nresources:\n  - deployment.yaml\n  - \
             missing.yaml\n  - notes.txt\n  - ../../../../outside.yaml\n  - \
             https://example.com/remote.yaml\n",
        );
        write(
            tmp,
            "svc/k8s/overlays/prod/kustomization.yaml",
            "kind: Kustomization\nresources:\n  - ../../base\n",
        );
    });
}

/// `svc.yaml` у ресурсах kustomization без парного `svc-hl.yaml`.
#[test]
fn kustomization_svc_hl_pairing_matches() {
    assert_parity("kustomization-svc-hl", |tmp| {
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            "kind: Kustomization\nnamespace: dev\nresources:\n  - svc.yaml\n",
        );
        write(
            tmp,
            "svc/k8s/base/svc.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/svc-hl.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: api-hl\n",
        );
    });
}

/// Розбіжність імен ConfigMap ↔ Deployment у `k8s/base/`.
#[test]
fn configmap_name_mismatch_matches() {
    assert_parity("configmap-mismatch", |tmp| {
        write(
            tmp,
            "svc/k8s/base/configmap.yaml",
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg\n",
        );
        write(
            tmp,
            "svc/k8s/base/deployment.yaml",
            &deployment("api", &["cfg"]),
        );
    });
}

/// **Полагоджений дефект канону.** Лексикографічно перший Deployment каталогу
/// (`a-worker.yaml`) не посилається на ConfigMap; JS-канон до цього PR на
/// ньому зупинявся і мовчки пропускав перевірку. Після фіксу обидві сторони
/// беруть Deployment із рефом — і обидві дають ту саму розбіжність імені.
#[test]
fn configmap_owner_is_picked_past_the_first_deployment() {
    assert_parity("configmap-owner-fix", |tmp| {
        write(
            tmp,
            "svc/k8s/base/configmap.yaml",
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg\n",
        );
        write(
            tmp,
            "svc/k8s/base/a-worker.yaml",
            &deployment("worker", &[]),
        );
        write(tmp, "svc/k8s/base/b-api.yaml", &deployment("api", &["cfg"]));
    });
}

/// Той самий каталог, але ConfigMap названий як Deployment-власник: після
/// фіксу перевірка знаходить збіг (і обидві сторони мовчать), тоді як до
/// фіксу вона взагалі не запускалась.
#[test]
fn configmap_owner_match_is_found_past_the_first_deployment() {
    assert_parity("clean-configmap-owner-fix", |tmp| {
        write(
            tmp,
            "svc/k8s/base/configmap.yaml",
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/a-worker.yaml",
            &deployment("worker", &[]),
        );
        write(tmp, "svc/k8s/base/b-api.yaml", &deployment("api", &["api"]));
    });
}

/// Змішане дерево: усі пʼять перевірок дають порушення одночасно — саме тут
/// звіряється наскрізний **порядок** повідомлень між перевірками.
#[test]
fn mixed_tree_preserves_cross_check_order() {
    assert_parity("mixed", |tmp| {
        write(tmp, "svc/k8s/dev/deployment.yaml", &deployment("api", &[]));
        write(
            tmp,
            "svc/k8s/base/svc.yaml",
            "apiVersion: v1\nkind: Service\nmetadata:\n  name: api\n",
        );
        write(
            tmp,
            "svc/k8s/base/kustomization.yaml",
            "kind: Kustomization\nnamespace: dev\nresources:\n  - svc.yaml\n  - missing.yaml\n",
        );
        write(
            tmp,
            "svc/k8s/base/configmap.yaml",
            "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg\n",
        );
        write(
            tmp,
            "svc/k8s/base/deployment.yaml",
            &deployment("api", &["cfg"]),
        );
    });
}
