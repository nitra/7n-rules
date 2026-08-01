//! Спільний шар відкриття файлів k8s-кластера — native-порт хелперів
//! `npm/rules/k8s/manifests/main.mjs`, на які спирається **кожен** концерн
//! кластера (`k8s/kubeconform`, `k8s/manifests`, `k8s/hasura_configmap`,
//! `k8s/hasura_httproute`).
//!
//! Портовані функції (з посиланням на рядки JS-канону):
//!
//! | Rust | JS |
//! |---|---|
//! | [`path_has_k8s_segment`] | `pathHasK8sSegment` (`main.mjs:229-235`) |
//! | [`k8s_root_from_file`] | `k8sRootFromFile` (`main.mjs:6766-6775`) |
//! | [`find_k8s_roots`] | `findK8sRoots` (`main.mjs:6786-6801`) |
//! | [`find_k8s_yaml_files`] | `findK8sYamlFiles` (`main.mjs:1592-1612`) |
//! | [`is_forbidden_k8s_dev_path`] | `isForbiddenK8sDevPath` (`main.mjs:242-245`) |
//! | [`is_k8s_yaml_under_base_directory`] | `isK8sYamlUnderBaseDirectory` (`main.mjs:30-36`) |
//!
//! # Обхід дерева
//!
//! JS-версії ходять через `walkDir` (`npm/scripts/utils/walkDir.mjs`), який
//! сам уже делегує в native [`crate::scan::walk_dir`] — тобто набір
//! кандидатів байт-у-байт той самий, різниця лише в тому, що JS отримує
//! абсолютні шляхи, а [`crate::scan::walk_dir`] — posix-relative. Тут
//! кандидати фільтруються в relative-формі, а назовні (у спавн зовнішніх
//! тулів) віддаються абсолютні — як у JS.
//!
//! # Сортування
//!
//! JS сортує результат через `localeCompare` (ICU-порядок), а не байтово,
//! тож порт використовує [`crate::locale::locale_compare`] — той самий
//! мотив, що в [`crate::lint_render`].

use std::path::{Path, PathBuf};

use crate::concerns::cursor_ignore::to_relative_ignore_globs;
use crate::locale::locale_compare;
use crate::scan::walk_dir;

/// Максимальна глибина підйому до `k8s`-предка — той самий бюджет ітерацій
/// (`for (let i = 0; i < 64; i++)`), що в `k8sRootFromFile` (`main.mjs:6768`).
const K8S_ROOT_LOOKUP_MAX_DEPTH: usize = 64;

/// Чи має шлях компонент-каталог рівно з іменем `k8s` — порт
/// `pathHasK8sSegment` (`main.mjs:229-235`) для **уже relative** шляху.
///
/// JS-версія приймає `root` і сама relativize-ує: без цього випадав
/// false-positive, коли корінь репо сам містить компонент `k8s`
/// (`/Users/…/abie/k8s/`). Тут вхід — результат [`crate::scan::walk_dir`],
/// тобто вже posix-relative від кореня, тож relativize зайвий; порожній шлях
/// (сам корінь) — `false`, як і в JS.
pub fn path_has_k8s_segment(rel_posix: &str) -> bool {
    if rel_posix.is_empty() {
        return false;
    }
    rel_posix
        .split(['/', '\\'])
        .any(|component| component == "k8s")
}

/// Чи є шлях YAML-файлом (`.yaml`/`.yml`, без урахування регістру) — порт
/// `YAML_EXTENSION_RE` (`main.mjs:187`).
fn has_yaml_extension(rel_posix: &str) -> bool {
    let lower = rel_posix.to_ascii_lowercase();
    lower.ends_with(".yaml") || lower.ends_with(".yml")
}

/// Чи є шлях YAML-файлом саме з розширенням `.yaml` — порт
/// `FIND_K8S_ROOTS_YAML_EXT_RE` (`main.mjs:6778`). `.yml` тут НЕ підходить
/// (для нього далі окремий fail «перейменуй на .yaml»).
fn has_strict_yaml_extension(rel_posix: &str) -> bool {
    rel_posix.to_ascii_lowercase().ends_with(".yaml")
}

/// Найближчий предок-каталог з іменем `k8s` — порт `k8sRootFromFile`
/// (`main.mjs:6766-6775`). `None`, якщо такого предка немає.
pub fn k8s_root_from_file(abs_file: &Path) -> Option<PathBuf> {
    let mut dir = abs_file.parent()?.to_path_buf();
    for _ in 0..K8S_ROOT_LOOKUP_MAX_DEPTH {
        if dir.file_name().is_some_and(|name| name == "k8s") {
            return Some(dir);
        }
        let parent = dir.parent()?.to_path_buf();
        if parent == dir {
            break;
        }
        dir = parent;
    }
    None
}

/// Чи заборонений шлях з окремим каталогом `dev` під `k8s` — порт
/// `isForbiddenK8sDevPath` (`main.mjs:242-245`).
pub fn is_forbidden_k8s_dev_path(rel: &str) -> bool {
    rel.replace('\\', "/").contains("/k8s/dev/")
}

/// Чи лежить relative-шлях під `…/k8s/…/base/…` — порт
/// `isK8sYamlUnderBaseDirectory` (`main.mjs:30-36`).
pub fn is_k8s_yaml_under_base_directory(rel_posix: &str) -> bool {
    let normalized = rel_posix.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').filter(|p| !p.is_empty()).collect();
    let Some(k) = parts.iter().position(|p| *p == "k8s") else {
        return false;
    };
    if parts.is_empty() {
        return false;
    }
    // `parts.slice(k + 1, -1)` — каталоги між `k8s` і самим файлом.
    parts
        .get(k + 1..parts.len().saturating_sub(1))
        .is_some_and(|dirs| dirs.contains(&"base"))
}

/// Спільний прохід дерева: relative-кандидати під `k8s`, окрім `.github/`.
///
/// `.github/` виключається явно (обидві JS-версії роблять це першим рядком
/// колбека) — там канон `.yml` і належить він правилу `ga.mdc`.
fn walk_k8s_candidates(root: &Path, ignore_paths: &[String]) -> Vec<String> {
    let extra_globs = to_relative_ignore_globs(root, ignore_paths);
    walk_dir(root, &extra_globs)
        .into_iter()
        .filter(|rel| !rel.starts_with(".github/"))
        .filter(|rel| path_has_k8s_segment(rel))
        .collect()
}

/// Усі `*.yaml`/`*.yml` під деревом, чий шлях містить сегмент `k8s` — порт
/// `findK8sYamlFiles` (`main.mjs:1592-1612`). Повертає **абсолютні** шляхи,
/// відсортовані `localeCompare` (як `toSorted` у JS).
pub fn find_k8s_yaml_files(root: &Path, ignore_paths: &[String]) -> Vec<PathBuf> {
    let mut out: Vec<String> = walk_k8s_candidates(root, ignore_paths)
        .into_iter()
        .filter(|rel| has_yaml_extension(rel))
        .map(|rel| root.join(rel).to_string_lossy().into_owned())
        .collect();
    out.sort_by(|a, b| locale_compare(a, b));
    out.into_iter().map(PathBuf::from).collect()
}

/// Унікальні `k8s`-корені з-під валідних `*.yaml` — порт `findK8sRoots`
/// (`main.mjs:6786-6801`). Повертає **абсолютні** шляхи, відсортовані
/// `localeCompare`.
pub fn find_k8s_roots(root: &Path, ignore_paths: &[String]) -> Vec<PathBuf> {
    let mut roots: Vec<String> = Vec::new();
    for rel in walk_k8s_candidates(root, ignore_paths) {
        if !has_strict_yaml_extension(&rel) {
            continue;
        }
        let Some(k8s_root) = k8s_root_from_file(&root.join(&rel)) else {
            continue;
        };
        let as_string = k8s_root.to_string_lossy().into_owned();
        // `Set` у JS — дедуп зі збереженням першої появи; тут порядок і так
        // перезаписується сортуванням нижче, тож достатньо лінійної перевірки
        // (кількість k8s-коренів у репо — одиниці).
        if !roots.contains(&as_string) {
            roots.push(as_string);
        }
    }
    roots.sort_by(|a, b| locale_compare(a, b));
    roots.into_iter().map(PathBuf::from).collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Створює файл разом із батьківськими каталогами.
    fn write(root: &Path, rel: &str, body: &str) {
        let abs = root.join(rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        fs::write(abs, body).unwrap();
    }

    #[test]
    fn path_has_k8s_segment_matches_only_exact_component() {
        assert!(path_has_k8s_segment("svc/k8s/base/deploy.yaml"));
        assert!(path_has_k8s_segment("k8s/base/deploy.yaml"));
        assert!(!path_has_k8s_segment("svc/k8s-extra/base/deploy.yaml"));
        assert!(!path_has_k8s_segment("svc/myk8s/deploy.yaml"));
        assert!(!path_has_k8s_segment(""));
    }

    #[test]
    fn k8s_root_from_file_returns_nearest_k8s_ancestor() {
        let abs = PathBuf::from("/repo/svc/k8s/overlays/prod/deploy.yaml");
        assert_eq!(
            k8s_root_from_file(&abs),
            Some(PathBuf::from("/repo/svc/k8s"))
        );
        assert_eq!(
            k8s_root_from_file(&PathBuf::from("/repo/svc/deploy.yaml")),
            None
        );
    }

    /// Найближчий (не найдальший) предок — при вкладених `k8s` береться той,
    /// що ближче до файла.
    #[test]
    fn k8s_root_from_file_prefers_nearest_ancestor() {
        let abs = PathBuf::from("/repo/k8s/apps/k8s/base/deploy.yaml");
        assert_eq!(
            k8s_root_from_file(&abs),
            Some(PathBuf::from("/repo/k8s/apps/k8s"))
        );
    }

    #[test]
    fn is_forbidden_k8s_dev_path_matches_dev_dir() {
        assert!(is_forbidden_k8s_dev_path("svc/k8s/dev/deploy.yaml"));
        assert!(is_forbidden_k8s_dev_path("svc\\k8s\\dev\\deploy.yaml"));
        assert!(!is_forbidden_k8s_dev_path("svc/k8s/base/deploy.yaml"));
        // Без ведучого слеша перед `k8s` — не збіг (як і в JS: шаблон містить `/k8s/dev/`).
        assert!(!is_forbidden_k8s_dev_path("k8s/dev/deploy.yaml"));
    }

    #[test]
    fn is_k8s_yaml_under_base_directory_needs_base_dir_after_k8s() {
        assert!(is_k8s_yaml_under_base_directory("svc/k8s/base/deploy.yaml"));
        assert!(is_k8s_yaml_under_base_directory(
            "svc/k8s/overlays/base/deploy.yaml"
        ));
        assert!(!is_k8s_yaml_under_base_directory("svc/k8s/deploy.yaml"));
        // `base` як ім'я самого файла — не каталог, отже не збіг.
        assert!(!is_k8s_yaml_under_base_directory("svc/k8s/base"));
        assert!(!is_k8s_yaml_under_base_directory("svc/base/deploy.yaml"));
    }

    #[test]
    fn find_k8s_yaml_files_collects_yaml_and_yml_under_k8s() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(root, "svc/k8s/base/svc.yml", "kind: Service\n");
        write(root, "svc/k8s/README.md", "# docs\n");
        write(root, "svc/other/config.yaml", "a: 1\n");
        write(root, ".github/k8s/workflow.yaml", "on: push\n");

        let found = find_k8s_yaml_files(root, &[]);
        assert_eq!(
            found,
            vec![
                root.join("svc/k8s/base/deploy.yaml"),
                root.join("svc/k8s/base/svc.yml"),
            ]
        );
    }

    #[test]
    fn find_k8s_roots_dedupes_and_ignores_yml() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "a/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(
            root,
            "a/k8s/overlays/prod/kustomization.yaml",
            "bases: []\n",
        );
        write(root, "b/k8s/base/svc.yml", "kind: Service\n");
        write(root, "c/plain/config.yaml", "a: 1\n");

        // `b` містить лише `.yml` → не дає кореня (strict `.yaml` фільтр).
        assert_eq!(find_k8s_roots(root, &[]), vec![root.join("a/k8s")]);
    }

    /// Порожнє дерево / неіснуючий корінь — порожній результат, без паніки
    /// (той самий fail-safe, що `walkDir` у JS).
    #[test]
    fn find_k8s_roots_on_missing_root_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(find_k8s_roots(&tmp.path().join("nope"), &[]).is_empty());
        assert!(find_k8s_yaml_files(&tmp.path().join("nope"), &[]).is_empty());
    }

    /// `ignorePaths` (з `.cursorignore`) виключають піддерево цілком.
    #[test]
    fn find_k8s_yaml_files_honours_ignore_paths() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(root, "vendor/k8s/base/deploy.yaml", "kind: Deployment\n");

        let ignored = vec![root.join("vendor").to_string_lossy().into_owned()];
        assert_eq!(
            find_k8s_yaml_files(root, &ignored),
            vec![root.join("svc/k8s/base/deploy.yaml")]
        );
    }
}
