//! cspell:ignore текстово
//!
//! Лексичні операції над шляхами — Rust-відповідники `path.resolve` і
//! `path.relative` з Node, потрібні портам CLI-команд зрізу 2 фази 8
//! (`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`).
//!
//! «Лексичні» — без звертань до файлової системи (як і в Node): `..`
//! скорочується текстово, симлінки не резолвляться. Саме така семантика
//! потрібна для паритету, бо JS-бік нормалізує `--root=…` та ignore-шляхи
//! тим самим `path.resolve`, ще до будь-якого `stat`.

use std::path::{Component, Path, PathBuf};

/// Лексична нормалізація: прибирає `.`, скорочує `..`, схлопує дублі
/// роздільників (дзеркало нормалізації всередині `path.resolve`).
/// `..` над коренем ігнорується — як `/..` → `/` у Node.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if out.parent().is_some() {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// `path.resolve(base, target)`: абсолютний `target` перемагає, відносний —
/// розв'язується від `base`; результат нормалізовано.
pub fn resolve(base: &Path, target: &str) -> PathBuf {
    let raw = Path::new(target);
    if raw.is_absolute() {
        normalize(raw)
    } else {
        normalize(&base.join(raw))
    }
}

/// `path.relative(base, target)` у posix-формі (`/`-роздільники). Обидва
/// аргументи мають бути абсолютні; результат порожній для однакових шляхів
/// і починається з `..`, якщо `target` поза `base`.
pub fn relative_posix(base: &Path, target: &Path) -> String {
    let base_parts: Vec<_> = normalize(base)
        .components()
        .filter_map(normal_part)
        .collect();
    let target_parts: Vec<_> = normalize(target)
        .components()
        .filter_map(normal_part)
        .collect();

    let common = base_parts
        .iter()
        .zip(target_parts.iter())
        .take_while(|(a, b)| a == b)
        .count();

    let mut parts: Vec<String> = vec!["..".to_string(); base_parts.len() - common];
    parts.extend(target_parts[common..].iter().cloned());
    parts.join("/")
}

/// Значущий (не root/prefix) компонент шляху рядком.
fn normal_part(component: Component<'_>) -> Option<String> {
    match component {
        Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_mirrors_node_path_resolve() {
        let base = Path::new("/repo/pkg");
        assert_eq!(resolve(base, "sub/dir"), Path::new("/repo/pkg/sub/dir"));
        assert_eq!(
            resolve(base, "./sub/../other"),
            Path::new("/repo/pkg/other")
        );
        assert_eq!(resolve(base, "/abs/path"), Path::new("/abs/path"));
        assert_eq!(resolve(base, ".."), Path::new("/repo"));
        assert_eq!(resolve(base, "/.."), Path::new("/"));
    }

    #[test]
    fn relative_posix_mirrors_node_path_relative() {
        assert_eq!(
            relative_posix(Path::new("/repo"), Path::new("/repo/a/b")),
            "a/b"
        );
        assert_eq!(relative_posix(Path::new("/repo"), Path::new("/repo")), "");
        assert_eq!(
            relative_posix(Path::new("/repo/a"), Path::new("/repo/b")),
            "../b"
        );
        assert_eq!(
            relative_posix(Path::new("/repo/a/b"), Path::new("/other")),
            "../../../other"
        );
    }
}
