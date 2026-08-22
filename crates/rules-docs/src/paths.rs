//! Спільні path-інваріанти виявлення джерел — порт `domain-paths.mjs`.

use std::path::{Component, Path};

/// Платформний шлях у стабільній POSIX-формі.
#[must_use]
pub fn to_posix(path: &str) -> String {
    path.replace(std::path::MAIN_SEPARATOR, "/")
}

/// Строге входження шляху в корінь — порт `isWithin`.
///
/// Саме строге: рівність кореню теж рахується входженням, а от вихід за нього
/// (`..`) чи абсолютний шлях — ні. Це остання перевірка перед читанням файла,
/// і саме вона ловить symlink-втечу.
#[must_use]
pub fn is_within(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    !relative
        .components()
        .any(|component| matches!(component, Component::ParentDir))
}

/// Шлях `to` відносно `from` у POSIX-формі — порт `path.relative`.
///
/// Саме повний `relative`, а не зрізання префікса: на `from == to` він дає
/// ПОРОЖНІЙ рядок, і без цього домен отримав би ignore-патерн на власний
/// корінь, тобто виключив би сам себе.
fn relative_posix(from: &str, to: &str) -> String {
    let split = |path: &str| -> Vec<String> {
        path.split('/')
            .filter(|segment| !segment.is_empty() && *segment != ".")
            .map(str::to_string)
            .collect()
    };
    let (from, to) = (split(from), split(to));
    let common = from
        .iter()
        .zip(to.iter())
        .take_while(|(left, right)| left == right)
        .count();
    let mut parts: Vec<String> = vec!["..".to_string(); from.len() - common];
    parts.extend(to[common..].iter().cloned());
    parts.join("/")
}

/// Ignore-патерни для вкладених доменів — порт `nestedDomainIgnores`.
///
/// Вкладений домен документує СЕБЕ: якби батьківський домен теж читав його
/// джерела, той самий код отримав би дві різні проєкції знання.
#[must_use]
pub fn nested_domain_ignores(source_root: &str, excluded: &[String]) -> Vec<String> {
    let base = if source_root == "." { "" } else { source_root };
    let mut patterns: Vec<String> = excluded
        .iter()
        .map(|path| to_posix(&relative_posix(base, path)))
        .filter(|path| !path.is_empty() && path != "." && !path.starts_with("../"))
        .flat_map(|path| [path.clone(), format!("{path}/**")])
        .collect();
    patterns.sort();
    patterns
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Containment — остання перевірка перед читанням файла, тож її межі
    /// перевіряються прямо, а не лише через завантажувач.
    #[test]
    fn containment_accepts_the_root_itself_and_rejects_escapes() {
        let root = Path::new("/repo/domain");
        assert!(is_within(root, Path::new("/repo/domain")));
        assert!(is_within(root, Path::new("/repo/domain/src/a.mjs")));
        assert!(!is_within(root, Path::new("/repo/other/a.mjs")));
        assert!(
            !is_within(root, Path::new("/repo/domain-sibling/a.mjs")),
            "префікс рядка не є входженням: сусід із схожою назвою — не всередині"
        );
    }

    /// Виключення вкладеного домену задаються ВІДНОСНО кореня батька, і
    /// кожне дає дві форми: сама тека і все під нею.
    #[test]
    fn nested_ignores_are_relative_to_the_parent_root() {
        assert_eq!(
            nested_domain_ignores(".", &["packages/web".to_string()]),
            vec!["packages/web".to_string(), "packages/web/**".to_string()]
        );
        assert_eq!(
            nested_domain_ignores("apps", &["apps/api".to_string()]),
            vec!["api".to_string(), "api/**".to_string()]
        );
    }

    /// Сам корінь виключенням не стає: інакше домен виключив би себе.
    #[test]
    fn the_root_itself_is_never_an_ignore_pattern() {
        assert!(nested_domain_ignores("apps", &["apps".to_string()]).is_empty());
        assert!(nested_domain_ignores(".", &[".".to_string()]).is_empty());
    }
}
