//! Обхід k8s-дерева abie — порт `npm/rules/abie/lib/k8s-tree.mjs` (110
//! рядків): `find_k8s_yaml_files` (yaml/yml під сегментом `k8s/`) і
//! `collect_deployment_dirs` (каталоги, де знайдено `kind: Deployment`).
//!
//! # `path_has_k8s_segment` — портована лише сама функція
//!
//! JS-версія імпортує `pathHasK8sSegment` з `npm/rules/k8s/manifests/main.mjs`
//! (7000+ рядків, увесь k8s-концерн) — порт сюди стосується **лише** цієї
//! однієї pure-функції (`main.mjs:229-235`, разом із `PATH_SPLIT_RE =
//! /[/\\]/u`, `main.mjs:186`), не решти файлу. Тут вона спрощена до одного
//! рядка: [`crate::scan::walk_dir`] уже повертає POSIX-relative шляхи (`/`-
//! роздільник, без `\\`), тож не потрібен ні сам виклик `relative(root,
//! filePath)`, ні заміна `\\` на `/` — обидва вже властивість вхідних даних.
//!
//! # Без module-level кешу
//!
//! JS-версія кешує `findK8sYamlFiles`/`collectDeploymentDirs` за ключем
//! `(root, ignorePaths)`/`(root, yamlAbs)` на час одного lint-прогону —
//! оптимізація, що уникає повторного обхід/парсинг, коли кілька concern-ів
//! (`hc_pairing`, `ua_node_selector`, `ua_http_route`) звертаються до тих
//! самих даних у межах одного виклику `n-rules lint`. Кожен native-виклик тут
//! — окрема pure-функція без спільного стану між викликами `run_concern`
//! (`mod.rs`); кеш не впливає на видиму поведінку (лише на швидкість
//! повторних прогонів), тож свідомо не портований.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use super::abie_yaml::{is_deployment_doc, read_and_parse_yaml_docs, rel_posix_or_self};
use super::cursor_ignore::to_relative_ignore_globs;
use crate::scan::walk_dir;

/// Розширення yaml/yml — точний порт `YAML_EXTENSION_RE` (`k8s-tree.mjs:15`).
static YAML_EXTENSION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\.ya?ml$").expect("valid regex"));

/// Чи relative-posix шлях містить сегмент `k8s` — точний порт `pathHasK8sSegment`
/// (`k8s/manifests/main.mjs:229-235`) для вже-відносних POSIX-шляхів
/// (докладніше — doc-комент модуля, секція «портована лише сама функція»).
fn path_has_k8s_segment(rel_posix: &str) -> bool {
    if rel_posix.is_empty() {
        return false;
    }
    rel_posix.split('/').any(|seg| seg == "k8s")
}

/// Збирає абсолютні шляхи до `.yaml`/`.yml` під деревом, де є сегмент `k8s/`,
/// відсортовані байтово-лексикографічно (та сама парність з `localeCompare`
/// для ASCII-імен, що й в інших native-abie-concern-ах). Каталог `.github/`
/// свідомо пропускається (належить `ga.mdc`) — точний порт `findK8sYamlFiles`
/// (`k8s-tree.mjs:39-61`), без module-level кешу (doc-комент модуля).
pub(crate) fn find_k8s_yaml_files(root: &Path, ignore_paths: &[String]) -> Vec<PathBuf> {
    let extra_globs = to_relative_ignore_globs(root, ignore_paths);
    walk_dir(root, &extra_globs)
        .into_iter()
        .filter(|rel| !rel.starts_with(".github/"))
        .filter(|rel| path_has_k8s_segment(rel))
        .filter(|rel| YAML_EXTENSION_RE.is_match(rel))
        .map(|rel| root.join(rel))
        .collect()
}

/// Знаходить унікальні каталоги, що містять Deployment-маніфести серед
/// переданих YAML-файлів — точний порт `collectDeploymentDirs`
/// (`k8s-tree.mjs:88-110`), без module-level кешу (doc-комент модуля).
/// `fail` — репортер помилок читання (аналог `fail`-колбека JS-версії,
/// дефолт там — `silentFail`; тут викликач сам вирішує, чи передати no-op).
/// Повертає `BTreeSet` абсолютних шляхів директорій — детермінований порядок
/// (аналог `[...deploymentDirs].toSorted(localeCompare)`, який `hc_pairing`
/// робить над JS `Set` перед ітерацією).
pub(crate) fn collect_deployment_dirs(
    root: &Path,
    yaml_abs: &[PathBuf],
    mut fail: impl FnMut(String),
) -> BTreeSet<String> {
    let mut dirs = BTreeSet::new();
    for abs in yaml_abs {
        let rel = rel_posix_or_self(root, abs);
        match read_and_parse_yaml_docs(abs, &rel) {
            Ok(docs) => {
                for doc in docs {
                    if is_deployment_doc(&doc) {
                        if let Some(parent) = abs.parent() {
                            dirs.insert(parent.to_string_lossy().into_owned());
                        }
                    }
                }
            }
            Err(msg) => fail(msg),
        }
    }
    dirs
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    const DEPLOY_YAML: &str = "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: api }\nspec: { template: { spec: { containers: [{ name: c, image: x }] } } }\n";
    const SVC_YAML: &str = "apiVersion: v1\nkind: Service\nmetadata: { name: svc }\nspec: { selector: { app: x }, ports: [{ port: 80 }] }\n";

    fn write(tmp: &TempDir, rel: &str, content: &str) {
        let path = tmp.path().join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    // --- find_k8s_yaml_files: дзеркало lib/tests/k8s-tree.test.mjs:28-123 ---

    #[test]
    fn no_k8s_segment_returns_empty() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/foo.yaml", SVC_YAML);
        assert!(find_k8s_yaml_files(tmp.path(), &[]).is_empty());
    }

    #[test]
    fn finds_yaml_and_yml_under_k8s_segment() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/a.yaml", SVC_YAML);
        write(&tmp, "pkg/k8s/b.yml", SVC_YAML);
        let result = find_k8s_yaml_files(tmp.path(), &[]);
        let mut names: Vec<_> = result
            .iter()
            .map(|p| {
                p.strip_prefix(tmp.path())
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        assert_eq!(names, vec!["pkg/k8s/a.yaml", "pkg/k8s/b.yml"]);
    }

    #[test]
    fn ignores_non_yaml_files_under_k8s() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/a.yaml", SVC_YAML);
        write(&tmp, "pkg/k8s/README.md", "# README\n");
        write(&tmp, "pkg/k8s/config.json", "{}\n");
        let result = find_k8s_yaml_files(tmp.path(), &[]);
        assert_eq!(result.len(), 1);
        assert!(result[0].ends_with("a.yaml"));
    }

    #[test]
    fn skips_github_tree() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".github/k8s/workflow.yaml", SVC_YAML);
        assert!(find_k8s_yaml_files(tmp.path(), &[]).is_empty());
    }

    #[test]
    fn returns_sorted_result() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/z.yaml", SVC_YAML);
        write(&tmp, "pkg/k8s/a.yaml", SVC_YAML);
        write(&tmp, "pkg/k8s/m.yaml", SVC_YAML);
        let result = find_k8s_yaml_files(tmp.path(), &[]);
        let names: Vec<_> = result
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["a.yaml", "m.yaml", "z.yaml"]);
    }

    #[test]
    fn ignore_paths_exclude_matching_subtree() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg-a/k8s/a.yaml", SVC_YAML);
        write(&tmp, "pkg-b/k8s/b.yaml", SVC_YAML);
        let ignore = vec![tmp.path().join("pkg-b").to_string_lossy().into_owned()];
        let result = find_k8s_yaml_files(tmp.path(), &ignore);
        assert_eq!(result.len(), 1);
        assert!(result[0].ends_with("a.yaml"));
    }

    // --- collect_deployment_dirs: дзеркало lib/tests/k8s-tree.test.mjs:125-191 ---

    #[test]
    fn empty_set_when_no_deployment() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/svc.yaml", SVC_YAML);
        let yamls = find_k8s_yaml_files(tmp.path(), &[]);
        let dirs = collect_deployment_dirs(tmp.path(), &yamls, |_| {});
        assert!(dirs.is_empty());
    }

    #[test]
    fn returns_dir_of_deployment_yaml() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pkg/k8s/deploy.yaml", DEPLOY_YAML);
        let yamls = find_k8s_yaml_files(tmp.path(), &[]);
        let dirs = collect_deployment_dirs(tmp.path(), &yamls, |_| {});
        assert_eq!(dirs.len(), 1);
        assert!(dirs.iter().next().unwrap().ends_with("pkg/k8s"));
    }

    #[test]
    fn multi_doc_yaml_finds_deployment_alongside_service() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pkg/k8s/mix.yaml",
            &format!("{DEPLOY_YAML}---\n{SVC_YAML}"),
        );
        let yamls = find_k8s_yaml_files(tmp.path(), &[]);
        let dirs = collect_deployment_dirs(tmp.path(), &yamls, |_| {});
        assert_eq!(dirs.len(), 1);
    }

    #[test]
    fn read_error_invokes_fail_callback() {
        let tmp = TempDir::new().unwrap();
        let ghost = tmp.path().join("pkg/k8s/ghost.yaml");
        let yamls = vec![ghost];
        let mut errors = Vec::new();
        let dirs = collect_deployment_dirs(tmp.path(), &yamls, |msg| errors.push(msg));
        assert!(dirs.is_empty());
        assert_eq!(errors.len(), 1);
    }
}
