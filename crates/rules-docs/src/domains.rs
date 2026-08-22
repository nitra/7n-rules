//! Резолв документаційних доменів репозиторію — порт `domain-resolver.mjs`.
//!
//! Домен визначає МАНІФЕСТ, а не тека: ідентичність
//! `<ecosystem>:<canonical-name>` не залежить від шляху, тож переміщення
//! пакета не створює нового домену. Невалідний маніфест чи повторена
//! ідентичність лишаються ДІАГНОСТИКОЮ — fallback-ідентичності з шляху не
//! буває, бо вона тихо роздвоїла б знання про той самий пакет.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::deterministic::js_locale_cmp;
use crate::paths::to_posix;

/// Маніфести, що визначають домен, і їхні екосистеми.
const MANIFESTS: [(&str, &str); 4] = [
    ("package.json", "npm"),
    ("Cargo.toml", "cargo"),
    ("pyproject.toml", "python"),
    ("composer.json", "composer"),
];

/// Теки, які не обходяться: вони не містять джерел, що належать репозиторію.
const IGNORED_DIRECTORIES: [&str; 9] = [
    ".git",
    ".worktrees",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "coverage",
    ".venv",
    "venv",
];

/// Документаційний домен.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Domain {
    /// `<ecosystem>:<canonical-name>` — ідентичність, незалежна від шляху.
    pub id: String,
    pub ecosystem: String,
    pub name: String,
    /// Абсолютний корінь домену.
    pub root: PathBuf,
    /// POSIX-шлях маніфеста відносно кореня репозиторію.
    pub root_manifest: String,
    /// POSIX-шлях кореня домену (`.` для кореня репозиторію).
    pub source_root: String,
    pub source_roots: Vec<String>,
    /// Корені вкладених доменів, виключені з цього.
    pub excluded_source_roots: Vec<String>,
}

/// Блокувальна діагностика резолвера.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// Завжди `error`: усі діагностики резолвера блокують публікацію.
    pub severity: String,
    pub code: String,
    pub manifest: String,
    pub message: String,
    pub domain_id: Option<String>,
    pub manifests: Option<Vec<String>>,
}

/// Результат резолву.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedDomains {
    pub domains: Vec<Domain>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Шлях відносно кореня в POSIX-формі; порожній — це `.`.
fn to_posix_relative(path: &Path) -> String {
    let text = path.to_string_lossy();
    if text.is_empty() || text == "." {
        return ".".to_string();
    }
    to_posix(&text)
}

/// Канонічна назва пакета за правилами екосистеми — порт
/// `canonicalDomainName`.
///
/// Python нормалізується за PEP 503 (`._-` → `-`, нижній регістр), composer —
/// регістром; npm і cargo вже визначають канонічну ідентичність самі, тож їм
/// потрібне лише обрізання пробілів.
#[must_use]
pub fn canonical_domain_name(ecosystem: &str, name: Option<&str>) -> Option<String> {
    let trimmed = name?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(match ecosystem {
        "python" => {
            let lowered = trimmed.to_lowercase();
            let mut canonical = String::with_capacity(lowered.len());
            let mut previous_separator = false;
            for character in lowered.chars() {
                if matches!(character, '.' | '_' | '-') {
                    if !previous_separator {
                        canonical.push('-');
                    }
                    previous_separator = true;
                } else {
                    canonical.push(character);
                    previous_separator = false;
                }
            }
            canonical
        }
        "composer" => trimmed.to_lowercase(),
        _ => trimmed.to_string(),
    })
}

/// Наслідок читання маніфеста.
enum ManifestName {
    Named(String),
    /// Маніфест валідний, але домену не визначає (workspace-only `Cargo.toml`,
    /// `pyproject.toml` лише з конфігурацією інструментів).
    Skip,
    /// Назви немає там, де вона обовʼязкова.
    Missing,
    Failed(String),
}

/// Читає назву пакета з одного маніфеста — порт `readManifestName`.
///
/// Здогадок тут немає: якщо розбір упав або обовʼязкового поля немає, це
/// діагностика, а не привід вигадати ідентичність.
fn read_manifest_name(ecosystem: &str, manifest_path: &Path) -> ManifestName {
    let text = match std::fs::read_to_string(manifest_path) {
        Ok(text) => text,
        Err(error) => return ManifestName::Failed(error.to_string()),
    };
    let named = |value: Option<&str>| match canonical_domain_name(ecosystem, value) {
        Some(name) => ManifestName::Named(name),
        None => ManifestName::Missing,
    };

    if ecosystem == "npm" || ecosystem == "composer" {
        return match serde_json::from_str::<Value>(&text) {
            Ok(parsed) => named(
                parsed
                    .as_object()
                    .and_then(|object| object.get("name"))
                    .and_then(Value::as_str),
            ),
            Err(error) => ManifestName::Failed(error.to_string()),
        };
    }

    let parsed = match text.parse::<toml::Table>() {
        Ok(parsed) => parsed,
        Err(error) => return ManifestName::Failed(error.to_string()),
    };
    if ecosystem == "cargo" {
        let package = parsed.get("package").and_then(toml::Value::as_table);
        if package.is_none() && parsed.contains_key("workspace") {
            return ManifestName::Skip;
        }
        return named(
            package
                .and_then(|package| package.get("name"))
                .and_then(toml::Value::as_str),
        );
    }

    let project = parsed.get("project").and_then(toml::Value::as_table);
    let poetry = parsed
        .get("tool")
        .and_then(toml::Value::as_table)
        .and_then(|tool| tool.get("poetry"))
        .and_then(toml::Value::as_table);
    if project.is_none() && poetry.is_none() {
        return ManifestName::Skip;
    }
    let project_name = project
        .and_then(|project| project.get("name"))
        .and_then(toml::Value::as_str);
    let poetry_name = poetry
        .and_then(|poetry| poetry.get("name"))
        .and_then(toml::Value::as_str);
    named(project_name.or(poetry_name))
}

/// Маніфести під коренем у лексичному порядку — порт `listManifestPaths`.
///
/// Symlink-и і згенеровані дерева свідомо НЕ обходяться: вони не визначають
/// джерел, якими володіє цей репозиторій.
fn list_manifest_paths(directory: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut entries: Vec<std::fs::DirEntry> =
        std::fs::read_dir(directory)?.collect::<Result<_, _>>()?;
    entries.sort_by(|left, right| {
        js_locale_cmp(
            &left.file_name().to_string_lossy(),
            &right.file_name().to_string_lossy(),
        )
    });
    let mut paths = Vec::new();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_dir() {
            if !IGNORED_DIRECTORIES.contains(&name.as_str()) {
                paths.extend(list_manifest_paths(&path)?);
            }
            continue;
        }
        if kind.is_file() && MANIFESTS.iter().any(|(manifest, _)| *manifest == name) {
            paths.push(path);
        }
    }
    Ok(paths)
}

/// Строгий нащадок за СЕГМЕНТАМИ, а не за префіксом рядка: інакше `apps/a`
/// вважався б предком `apps/api`.
fn is_strict_descendant(candidate: &str, ancestor: &str) -> bool {
    if ancestor == "." {
        return candidate != ".";
    }
    candidate.starts_with(&format!("{ancestor}/"))
}

/// Резолвить усі маніфест-backed домени репозиторію — порт
/// `resolveDocumentationDomains`.
///
/// # Errors
/// Помилка обходу файлової системи; невалідні маніфести помилкою НЕ є — вони
/// стають діагностиками.
pub fn resolve_documentation_domains(cwd: &Path) -> std::io::Result<ResolvedDomains> {
    let repository_root = cwd.to_path_buf();
    let paths = list_manifest_paths(&repository_root)?;
    let mut domains: Vec<Domain> = Vec::new();
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    for manifest_path in paths {
        let file_name = manifest_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let Some((_, ecosystem)) = MANIFESTS
            .iter()
            .find(|(manifest, _)| *manifest == file_name)
        else {
            continue;
        };
        let relative = manifest_path
            .strip_prefix(&repository_root)
            .unwrap_or(&manifest_path);
        let root_manifest = to_posix_relative(relative);

        match read_manifest_name(ecosystem, &manifest_path) {
            ManifestName::Failed(error) => diagnostics.push(Diagnostic {
                severity: "error".to_string(),
                code: "manifest-parse-failed".to_string(),
                manifest: root_manifest.clone(),
                message: format!("Не вдалося розібрати {root_manifest}: {error}"),
                domain_id: None,
                manifests: None,
            }),
            ManifestName::Skip => {}
            ManifestName::Missing => diagnostics.push(Diagnostic {
                severity: "error".to_string(),
                code: "manifest-name-missing".to_string(),
                manifest: root_manifest.clone(),
                message: format!(
                    "{root_manifest} не містить канонічної назви package/crate/module"
                ),
                domain_id: None,
                manifests: None,
            }),
            ManifestName::Named(name) => {
                let root = manifest_path
                    .parent()
                    .unwrap_or(&repository_root)
                    .to_path_buf();
                let source_root =
                    to_posix_relative(root.strip_prefix(&repository_root).unwrap_or(&root));
                domains.push(Domain {
                    id: format!("{ecosystem}:{name}"),
                    ecosystem: (*ecosystem).to_string(),
                    name,
                    root,
                    root_manifest,
                    source_roots: vec![source_root.clone()],
                    source_root,
                    excluded_source_roots: Vec::new(),
                });
            }
        }
    }

    domains.sort_by(|left, right| {
        js_locale_cmp(&left.id, &right.id)
            .then_with(|| js_locale_cmp(&left.root_manifest, &right.root_manifest))
    });
    let source_roots: Vec<String> = domains
        .iter()
        .map(|domain| domain.source_root.clone())
        .collect();
    for domain in &mut domains {
        let mut excluded: Vec<String> = source_roots
            .iter()
            .filter(|candidate| is_strict_descendant(candidate, &domain.source_root))
            .cloned()
            .collect();
        excluded.sort_by(|left, right| js_locale_cmp(left, right));
        domain.excluded_source_roots = excluded;
    }

    let mut manifests_by_id: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for domain in &domains {
        manifests_by_id
            .entry(domain.id.clone())
            .or_default()
            .push(domain.root_manifest.clone());
    }
    for (domain_id, manifests) in manifests_by_id {
        if manifests.len() < 2 {
            continue;
        }
        let mut sorted = manifests;
        sorted.sort_by(|left, right| js_locale_cmp(left, right));
        diagnostics.push(Diagnostic {
            severity: "error".to_string(),
            code: "duplicate-domain-id".to_string(),
            manifest: sorted[0].clone(),
            message: format!(
                "Канонічна identity {domain_id} повторюється: {}",
                sorted.join(", ")
            ),
            domain_id: Some(domain_id),
            manifests: Some(sorted),
        });
    }
    diagnostics.sort_by(|left, right| {
        js_locale_cmp(&left.code, &right.code)
            .then_with(|| js_locale_cmp(&left.manifest, &right.manifest))
    });
    Ok(ResolvedDomains {
        domains,
        diagnostics,
    })
}

/// Домен-власник шляху — порт `resolveDomainForPath`.
///
/// Перемагає НАЙГЛИБШИЙ вкладений корінь: файл у вкладеному пакеті належить
/// саме йому, а не батьківському репозиторію.
#[must_use]
pub fn resolve_domain_for_path<'a>(
    domains: &'a [Domain],
    source_path: &Path,
    cwd: &Path,
) -> Option<&'a Domain> {
    let absolute = if source_path.is_absolute() {
        source_path.to_path_buf()
    } else {
        cwd.join(source_path)
    };
    let relative_path = match absolute.strip_prefix(cwd) {
        Ok(relative) => to_posix_relative(relative),
        Err(_) => return None,
    };
    if relative_path == ".." || relative_path.starts_with("../") {
        return None;
    }
    let mut candidates: Vec<&Domain> = domains
        .iter()
        .filter(|domain| {
            relative_path == domain.source_root
                || is_strict_descendant(&relative_path, &domain.source_root)
        })
        .collect();
    candidates.sort_by(|left, right| {
        let depth = |domain: &Domain| domain.source_root.split('/').count();
        depth(right)
            .cmp(&depth(left))
            .then_with(|| js_locale_cmp(&left.id, &right.id))
            .then_with(|| js_locale_cmp(&left.root_manifest, &right.root_manifest))
    });
    candidates.first().copied()
}
