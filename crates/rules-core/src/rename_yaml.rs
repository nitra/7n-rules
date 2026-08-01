//! cspell:ignore регістронезалежно регістрозалежно Регістронезалежна
//!
//! Перейменування розширень YAML за домовленістю репозиторію — порт
//! `npm/scripts/rename-yaml-extensions.mjs` (зріз 2 фази 8,
//! `docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`). CLI-обгортка
//! (розбір аргументів, `[dry-run] `-префікс, вивід) лишається в `rules-cli`,
//! як і в JS, де `bin/rename-yaml-extensions.mjs` — тонка обгортка над цим
//! модулем.
//!
//! Правила (обидва — за СЕГМЕНТОМ шляху, не за префіксом):
//! - сегмент `k8s` + суфікс `.yml` → `.yaml` (маніфести k8s);
//! - сегмент `.github` + суфікс `.yaml` → `.yml` (workflows).
//!
//! Суфікс матчиться регістронезалежно (`/\.yml$/iu` у JS), сам сегмент —
//! регістрозалежно (`split('/').includes('k8s')`).
//!
//! Обхід — [`crate::scan::walk_dir`] (той самий рушій, що й у JS-боці, який
//! кличе його через napi): `.gitignore` поважається, `ALWAYS_IGNORE` теж;
//! додаткові ignore-глоби приходять від викликача вже нормалізованими
//! (конфіг-читання `.n-rules.json` — поза ядром, як і для `walk_dir`).
//!
//! Порядок операцій — спершу всі `k8s`, тоді всі `.github`, усередині групи
//! за `localeCompare` ([`crate::locale`]); дзеркало компаратора
//! `collectRenameOps`. Порядок видимий у stdout, тож гейтиться parity-тестом.
//!
//! **Межа порту.** Текст помилки самого `rename(2)` (третя гілка нижче)
//! у JS — це `error.message` Node (`"ENOENT: no such file or directory,
//! rename '…' -> '…'"`), тут — `Display` для [`std::io::Error`]. Гілка
//! недосяжна за нормального ходу (наявність джерела й відсутність цілі вже
//! перевірені безпосередньо перед нею) і лишається діагностичною.

use std::path::{Path, PathBuf};

use crate::locale::locale_compare;
use crate::scan::walk_dir;

/// Яке з двох правил дало операцію (визначає порядок у виводі).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenameKind {
    /// Сегмент `k8s`: `.yml` → `.yaml`.
    K8s,
    /// Сегмент `.github`: `.yaml` → `.yml`.
    Github,
}

/// Заплановане перейменування (шляхи — relative-posix від кореня обходу).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenameOp {
    /// Правило, що дало операцію.
    pub kind: RenameKind,
    /// Початковий відносний шлях.
    pub rel_from: String,
    /// Цільовий відносний шлях.
    pub rel_to: String,
}

/// Результат прогону: успішні перейменування і тексти помилок (дзеркало
/// `{ renamed, errors }` JS-версії).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct RenameOutcome {
    /// Пари `(звідки, куди)` у порядку виконання.
    pub renamed: Vec<(String, String)>,
    /// Тексти помилок у порядку виникнення (CLI друкує їх у stderr).
    pub errors: Vec<String>,
}

/// Чи шлях підпадає під k8s-правило (порт `pathMatchesK8sYml`).
fn matches_k8s_yml(rel: &str) -> bool {
    has_extension(rel, "yml") && rel.split('/').any(|segment| segment == "k8s")
}

/// Чи шлях підпадає під `.github`-правило (порт `pathMatchesGithubYaml`).
fn matches_github_yaml(rel: &str) -> bool {
    has_extension(rel, "yaml") && rel.split('/').any(|segment| segment == ".github")
}

/// Регістронезалежна перевірка суфікса `.<ext>` (дзеркало `/\.ext$/iu`).
fn has_extension(rel: &str, ext: &str) -> bool {
    let suffix = format!(".{ext}");
    rel.len() > ext.len() && rel[rel.len() - suffix.len()..].eq_ignore_ascii_case(&suffix)
}

/// Замінює останнє розширення на `new_ext` — порт `replaceExtension`
/// з його регексом `^(.+)(\.[^./\\]+)$`: жадібний `(.+)` означає ОСТАННЮ
/// крапку, після якої йде непорожній «хвіст» без `.`, `/`, `\`, і при цьому
/// до крапки лишається щонайменше один символ. Без збігу (наприклад, шлях
/// `.yml` цілком) JS просто дописує розширення — те саме тут.
fn replace_extension(rel: &str, new_ext: &str) -> String {
    let matched = rel.rfind('.').filter(|dot| *dot >= 1).filter(|dot| {
        let tail = &rel[dot + 1..];
        !tail.is_empty() && !tail.contains(['.', '/', '\\'])
    });
    match matched {
        Some(dot) => format!("{}{new_ext}", &rel[..dot]),
        None => format!("{rel}{new_ext}"),
    }
}

/// Збирає операції перейменування без запису на диск (порт
/// `collectRenameOps`): обхід → фільтр за правилами → сортування.
pub fn collect_rename_ops(root: &Path, extra_ignore_globs: &[String]) -> Vec<RenameOp> {
    let mut ops: Vec<RenameOp> = Vec::new();
    for rel in walk_dir(root, extra_ignore_globs) {
        // Порядок гілок — як у JS: k8s перевіряється першим і його `return`
        // не дає тому самому файлу потрапити в `.github`-гілку.
        let (kind, rel_to) = if matches_k8s_yml(&rel) {
            (RenameKind::K8s, replace_extension(&rel, ".yaml"))
        } else if matches_github_yaml(&rel) {
            (RenameKind::Github, replace_extension(&rel, ".yml"))
        } else {
            continue;
        };
        if rel_to == rel {
            continue;
        }
        ops.push(RenameOp {
            kind,
            rel_from: rel,
            rel_to,
        });
    }

    ops.sort_by(|a, b| {
        (a.kind == RenameKind::Github)
            .cmp(&(b.kind == RenameKind::Github))
            .then_with(|| locale_compare(&a.rel_from, &b.rel_from))
    });
    ops
}

/// Абсолютний шлях операції від кореня (дзеркало `resolve(rootAbs, rel)`).
fn abs(root: &Path, rel: &str) -> PathBuf {
    root.join(rel)
}

/// Виконує перейменування (порт `renameYamlExtensions`). `dry_run` рахує
/// операцію успішною без запису; на диск ідуть ЛИШЕ файли з операцій, тож
/// повторний прогін на вже перейменованому дереві не робить нічого.
pub fn rename_yaml_extensions(
    root: &Path,
    dry_run: bool,
    extra_ignore_globs: &[String],
) -> RenameOutcome {
    let mut outcome = RenameOutcome::default();
    for op in collect_rename_ops(root, extra_ignore_globs) {
        let from = abs(root, &op.rel_from);
        let to = abs(root, &op.rel_to);
        if !from.exists() {
            outcome
                .errors
                .push(format!("{}: файл зник перед перейменуванням", op.rel_from));
        } else if to.exists() {
            outcome.errors.push(format!(
                "{} → {}: цільовий файл уже існує, пропущено",
                op.rel_from, op.rel_to
            ));
        } else if dry_run {
            outcome.renamed.push((op.rel_from, op.rel_to));
        } else {
            match std::fs::rename(&from, &to) {
                Ok(()) => outcome.renamed.push((op.rel_from, op.rel_to)),
                Err(error) => outcome.errors.push(format!("{}: {error}", op.rel_from)),
            }
        }
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "kind: Test\n").unwrap();
    }

    fn ops(root: &Path) -> Vec<(String, String)> {
        collect_rename_ops(root, &[])
            .into_iter()
            .map(|op| (op.rel_from, op.rel_to))
            .collect()
    }

    #[test]
    fn replace_extension_mirrors_js_regex() {
        assert_eq!(replace_extension("k8s/app.yml", ".yaml"), "k8s/app.yaml");
        assert_eq!(replace_extension("k8s/.yml", ".yaml"), "k8s/.yaml");
        assert_eq!(replace_extension("k8s/a.b.yml", ".yaml"), "k8s/a.b.yaml");
        // Немає збігу з `^(.+)(\.[^./\\]+)$` → JS просто дописує розширення.
        assert_eq!(replace_extension(".yml", ".yaml"), ".yml.yaml");
    }

    #[test]
    fn matches_by_segment_not_by_substring() {
        assert!(matches_k8s_yml("infra/k8s/app.yml"));
        assert!(matches_k8s_yml("k8s/app.YML"));
        // `k8s-legacy` — інший сегмент, не збіг.
        assert!(!matches_k8s_yml("k8s-legacy/app.yml"));
        assert!(!matches_k8s_yml("K8S/app.yml"));
        assert!(matches_github_yaml(".github/workflows/ci.yaml"));
        assert!(!matches_github_yaml("github/ci.yaml"));
    }

    #[test]
    fn ops_ordered_k8s_first_then_github_by_locale() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, ".github/workflows/release.yaml");
        write(root, ".github/actions/build.yaml");
        write(root, "k8s/web.yml");
        write(root, "k8s/api_gateway.yml");
        write(root, "k8s/api-gateway.yml");
        // Не підпадає під жодне правило.
        write(root, "k8s/app.yaml");
        write(root, ".github/notes.md");

        assert_eq!(
            ops(root),
            vec![
                (
                    "k8s/api_gateway.yml".to_string(),
                    "k8s/api_gateway.yaml".to_string()
                ),
                (
                    "k8s/api-gateway.yml".to_string(),
                    "k8s/api-gateway.yaml".to_string()
                ),
                ("k8s/web.yml".to_string(), "k8s/web.yaml".to_string()),
                (
                    ".github/actions/build.yaml".to_string(),
                    ".github/actions/build.yml".to_string()
                ),
                (
                    ".github/workflows/release.yaml".to_string(),
                    ".github/workflows/release.yml".to_string()
                ),
            ]
        );
    }

    #[test]
    fn dry_run_does_not_touch_disk() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "k8s/app.yml");
        let outcome = rename_yaml_extensions(root, true, &[]);
        assert_eq!(
            outcome.renamed,
            vec![("k8s/app.yml".to_string(), "k8s/app.yaml".to_string())]
        );
        assert!(outcome.errors.is_empty());
        assert!(root.join("k8s/app.yml").exists());
        assert!(!root.join("k8s/app.yaml").exists());
    }

    #[test]
    fn rename_is_idempotent_and_reports_existing_target() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "k8s/app.yml");
        write(root, "k8s/dup.yml");
        write(root, "k8s/dup.yaml");

        let first = rename_yaml_extensions(root, false, &[]);
        assert_eq!(
            first.renamed,
            vec![("k8s/app.yml".to_string(), "k8s/app.yaml".to_string())]
        );
        assert_eq!(
            first.errors,
            vec!["k8s/dup.yml → k8s/dup.yaml: цільовий файл уже існує, пропущено".to_string()]
        );

        // Повторний прогін: та сама (єдина) помилка, нових перейменувань нема.
        let second = rename_yaml_extensions(root, false, &[]);
        assert!(second.renamed.is_empty());
        assert_eq!(second.errors, first.errors);
    }

    #[test]
    fn extra_ignore_globs_exclude_subtree() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "k8s/app.yml");
        write(root, "vendor/k8s/app.yml");
        let outcome = rename_yaml_extensions(root, true, &["vendor/**".to_string()]);
        assert_eq!(
            outcome.renamed,
            vec![("k8s/app.yml".to_string(), "k8s/app.yaml".to_string())]
        );
    }
}
