//! Спільний шар відкриття файлів k8s-кластера — native-порт хелперів
//! `npm/rules/k8s/manifests/main.mjs`, на які спирається кожен концерн
//! кластера.
//!
//! Обсяг навмисно рівно той, що потрібен уже портованим концернам кластера:
//! решта хелперів (`isForbiddenK8sDevPath`, `isK8sYamlUnderBaseDirectory`)
//! приїде разом із концерном, який їх реально викликає (`k8s/manifests`), а не
//! наперед — інакше це поверхня без споживача.
//!
//! Портовані функції (з посиланням на рядки JS-канону):
//!
//! | Rust | JS |
//! |---|---|
//! | [`path_has_k8s_segment`] | `pathHasK8sSegment` (`main.mjs:229-235`) |
//! | [`k8s_root_from_file`] | `k8sRootFromFile` (`main.mjs:6766-6775`) |
//! | [`find_k8s_roots`] | `findK8sRoots` (`main.mjs:6786-6801`) |
//! | [`find_k8s_yaml_files`] | `findK8sYamlFiles` (`main.mjs:1592-1612`) |
//!
//! # Обхід дерева
//!
//! JS-версії ходять через `walkDir` (`npm/scripts/utils/walkDir.mjs`), який
//! сам уже делегує в native [`crate::scan::walk_dir`] — тобто набір
//! кандидатів той самий, різниця лише в тому, що JS отримує абсолютні
//! шляхи, а [`crate::scan::walk_dir`] — posix-relative. Тут кандидати
//! фільтруються в relative-формі, а назовні (у спавн зовнішніх тулів)
//! віддаються абсолютні — як у JS.
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
fn path_has_k8s_segment(rel_posix: &str) -> bool {
    if rel_posix.is_empty() {
        return false;
    }
    rel_posix
        .split(['/', '\\'])
        .any(|component| component == "k8s")
}

/// Чи є шлях YAML-файлом саме з розширенням `.yaml` — порт
/// `FIND_K8S_ROOTS_YAML_EXT_RE` (`main.mjs:6778`). `.yml` тут НЕ підходить
/// (для нього в `k8s/manifests` окремий fail «перейменуй на .yaml»).
fn has_strict_yaml_extension(rel_posix: &str) -> bool {
    rel_posix.to_ascii_lowercase().ends_with(".yaml")
}

/// Найближчий предок-каталог з іменем `k8s` — порт `k8sRootFromFile`
/// (`main.mjs:6766-6775`). `None`, якщо такого предка немає.
fn k8s_root_from_file(abs_file: &Path) -> Option<PathBuf> {
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

/// Спільний прохід дерева: relative-кандидати під `k8s`, окрім `.github/`.
///
/// `.github/` виключається явно (JS-версії роблять це першим рядком
/// колбека) — там канон `.yml` і належить він правилу `ga.mdc`.
fn walk_k8s_candidates(root: &Path, ignore_paths: &[String]) -> Vec<String> {
    let extra_globs = to_relative_ignore_globs(root, ignore_paths);
    walk_dir(root, &extra_globs)
        .into_iter()
        .filter(|rel| !rel.starts_with(".github/"))
        .filter(|rel| path_has_k8s_segment(rel))
        .collect()
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

/// Чи є шлях YAML-файлом за `YAML_EXTENSION_RE` (`main.mjs:187`,
/// `/\.ya?ml$/iu`). На відміну від [`has_strict_yaml_extension`] тут `.yml`
/// теж проходить: `k8s/manifests` сам репортує «перейменуй на .yaml», тож
/// файл спершу треба знайти.
fn has_yaml_extension(rel_posix: &str) -> bool {
    let lower = rel_posix.to_ascii_lowercase();
    lower.ends_with(".yaml") || lower.ends_with(".yml")
}

/// Усі `*.yaml`/`*.yml` під каталогами `k8s` — порт `findK8sYamlFiles`
/// (`main.mjs:1592-1612`). Повертає **абсолютні** шляхи, відсортовані
/// `localeCompare` (як і `findK8sRoots`).
pub fn find_k8s_yaml_files(root: &Path, ignore_paths: &[String]) -> Vec<PathBuf> {
    let mut files: Vec<String> = walk_k8s_candidates(root, ignore_paths)
        .into_iter()
        .filter(|rel| has_yaml_extension(rel))
        .map(|rel| root.join(rel).to_string_lossy().into_owned())
        .collect();
    files.sort_by(|a, b| locale_compare(a, b));
    files.into_iter().map(PathBuf::from).collect()
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;
    use crate::concerns::test_support::write;

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
    fn find_k8s_roots_dedupes_and_ignores_yml() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "a/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(
            &tmp,
            "a/k8s/overlays/prod/kustomization.yaml",
            "bases: []\n",
        );
        write(&tmp, "b/k8s/base/svc.yml", "kind: Service\n");
        write(&tmp, "c/plain/config.yaml", "a: 1\n");

        // `b` містить лише `.yml` → не дає кореня (strict `.yaml` фільтр).
        assert_eq!(find_k8s_roots(root, &[]), vec![root.join("a/k8s")]);
    }

    /// `.github/` не дає кореня навіть із сегментом `k8s` у шляху — там
    /// канон `.yml` і власне правило `ga`.
    #[test]
    fn find_k8s_roots_skips_github_dir() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, ".github/k8s/workflow.yaml", "on: push\n");
        assert!(find_k8s_roots(tmp.path(), &[]).is_empty());
    }

    /// Порожнє дерево / неіснуючий корінь — порожній результат, без паніки
    /// (той самий fail-safe, що `walkDir` у JS).
    #[test]
    fn find_k8s_roots_on_missing_root_is_empty() {
        let tmp = TempDir::new().unwrap();
        assert!(find_k8s_roots(&tmp.path().join("nope"), &[]).is_empty());
    }

    /// `findK8sYamlFiles` бере і `.yaml`, і `.yml` (на відміну від
    /// `findK8sRoots`), лише під `k8s`, і сортує результат.
    #[test]
    fn find_k8s_yaml_files_takes_yaml_and_yml_under_k8s() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "svc/k8s/base/svc.yml", "kind: Service\n");
        write(&tmp, "svc/k8s/base/readme.md", "# no\n");
        write(&tmp, "svc/other/config.yaml", "a: 1\n");

        assert_eq!(
            find_k8s_yaml_files(root, &[]),
            vec![
                root.join("svc/k8s/base/deploy.yaml"),
                root.join("svc/k8s/base/svc.yml"),
            ]
        );
    }

    /// `.github/` не потрапляє у вибірку навіть із сегментом `k8s` — та сама
    /// гілка, що й у `findK8sRoots`, і `ignorePaths` так само діють.
    #[test]
    fn find_k8s_yaml_files_skips_github_and_ignored() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, ".github/k8s/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "vendor/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");

        let ignored = vec![root.join("vendor").to_string_lossy().into_owned()];
        assert_eq!(
            find_k8s_yaml_files(root, &ignored),
            vec![root.join("svc/k8s/base/deploy.yaml")]
        );
    }

    /// `ignorePaths` (з `.cursorignore`) виключають піддерево цілком.
    #[test]
    fn find_k8s_roots_honours_ignore_paths() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&tmp, "svc/k8s/base/deploy.yaml", "kind: Deployment\n");
        write(&tmp, "vendor/k8s/base/deploy.yaml", "kind: Deployment\n");

        let ignored = vec![root.join("vendor").to_string_lossy().into_owned()];
        assert_eq!(find_k8s_roots(root, &ignored), vec![root.join("svc/k8s")]);
    }
}
