//! Завантаження джерел рівно одного домену — порт `source-loader.mjs`.
//!
//! Loader поважає межу маніфеста, виключення вкладених доменів і `.gitignore`,
//! і НЕ переходить через symlink-и. Кожен знайдений файл додатково
//! перечитується через той самий containment-гейт: race, нечитабельний файл
//! чи symlink-втеча блокують вибір адаптерів ДО того, як щось потрапить у
//! конвеєр.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;

use crate::deterministic::js_locale_cmp;
use crate::paths::{is_within, nested_domain_ignores, to_posix};

/// Дерева, які ніколи не є джерелами домену.
const DEFAULT_IGNORES: [&str; 9] = [
    "**/.git/**",
    "**/.worktrees/**",
    "**/node_modules/**",
    "**/vendor/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.venv/**",
    "**/venv/**",
];

/// Розширення, які взагалі можуть бути кодом домену.
const SUPPORTED_CODE_EXTENSIONS: [&str; 10] = [
    ".cjs", ".js", ".jsx", ".mjs", ".php", ".py", ".rs", ".ts", ".tsx", ".vue",
];

/// Блокувальна діагностика завантажувача.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub detail: String,
    pub path: Option<String>,
}

impl Diagnostic {
    fn new(code: &str, detail: &str, path: Option<&str>) -> Self {
        Self {
            code: code.to_string(),
            detail: detail.to_string(),
            path: path.map(str::to_string),
        }
    }
}

/// Один файл-джерело.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFile {
    /// POSIX-шлях відносно кореня домену.
    pub path: String,
    pub content: String,
}

/// Домен у тій частині, яка потрібна завантажувачу.
pub struct DomainScope<'a> {
    pub root: &'a Path,
    pub source_root: &'a str,
    pub excluded_source_roots: &'a [String],
}

/// Нормалізує розширення адаптерів — порт `normalizeExtensions`.
fn normalize_extensions(extensions: &[String]) -> Result<Vec<String>, Vec<Diagnostic>> {
    let valid = |extension: &String| {
        let mut characters = extension.chars();
        characters.next() == Some('.')
            && extension.len() > 1
            && characters.all(|character| character.is_ascii_alphanumeric())
    };
    if extensions.is_empty() || !extensions.iter().all(valid) {
        return Err(vec![Diagnostic::new(
            "invalid-source-extensions",
            "extensions має містити розширення на кшталт .mjs.",
            None,
        )]);
    }
    let unique: BTreeSet<String> = extensions
        .iter()
        .map(|extension| extension.to_lowercase())
        .collect();
    Ok(unique.into_iter().collect())
}

/// Канонічний корінь домену.
fn real_root(root: &Path) -> Result<PathBuf, Vec<Diagnostic>> {
    if !root.is_absolute() {
        return Err(vec![Diagnostic::new(
            "invalid-domain-root",
            "Resolved domain мусить мати absolute root.",
            None,
        )]);
    }
    std::fs::canonicalize(root).map_err(|error| {
        vec![Diagnostic::new(
            "domain-root-unavailable",
            &error.to_string(),
            root.to_str(),
        )]
    })
}

/// Обхід джерел домену з повагою до `.gitignore` і без переходу за symlink-и.
///
/// `require_git(false)` навмисно: JS-`globby` застосовує `.gitignore`
/// незалежно від того, чи тека є git-репозиторієм, і тестові фікстури ними не
/// є — без цього прапорця порт мовчки читав би те, що JS відкидає.
fn walk_sources(root: &Path, scope: &DomainScope<'_>) -> Result<Vec<String>, Vec<Diagnostic>> {
    let mut overrides = OverrideBuilder::new(root);
    let ignores = DEFAULT_IGNORES
        .iter()
        .map(|pattern| (*pattern).to_string())
        .chain(nested_domain_ignores(
            scope.source_root,
            scope.excluded_source_roots,
        ));
    for pattern in ignores {
        // У `OverrideBuilder` голий glob — це whitelist, а `!glob` — ignore.
        if overrides.add(&format!("!{pattern}")).is_err() {
            return Err(vec![Diagnostic::new(
                "invalid-source-extensions",
                &format!("Невалідний ignore-патерн {pattern}."),
                None,
            )]);
        }
    }
    let overrides = overrides.build().map_err(|error| {
        vec![Diagnostic::new(
            "invalid-source-extensions",
            &error.to_string(),
            None,
        )]
    })?;

    let mut paths = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .follow_links(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .overrides(overrides)
        .build();
    for entry in walker {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        paths.push(to_posix(&relative.to_string_lossy()));
    }
    paths.sort_by(|left, right| js_locale_cmp(left, right));
    Ok(paths)
}

/// Розширення файла в нижньому регістрі, разом із крапкою.
fn extension_of(path: &str) -> Option<String> {
    let name = path.rsplit('/').next()?;
    let index = name.rfind('.')?;
    (index > 0).then(|| name[index..].to_lowercase())
}

/// Читає один файл і ПОВТОРНО перевіряє containment за канонічним шляхом —
/// порт `readDomainSource`.
fn read_domain_source(root: &Path, path: &str) -> Result<SourceFile, Diagnostic> {
    let absolute = root.join(path);
    let real = std::fs::canonicalize(&absolute).map_err(|error| {
        Diagnostic::new(
            "source-read-failed",
            &error.to_string(),
            Some(&to_posix(path)),
        )
    })?;
    if !is_within(root, &real) {
        return Err(Diagnostic::new(
            "source-outside-domain",
            &format!("Source {path} виходить за domain boundary."),
            Some(path),
        ));
    }
    let content = std::fs::read_to_string(&real).map_err(|error| {
        Diagnostic::new(
            "source-read-failed",
            &error.to_string(),
            Some(&to_posix(path)),
        )
    })?;
    Ok(SourceFile {
        path: to_posix(path),
        content,
    })
}

/// Виявляє наявні підтримувані розширення — порт
/// `discoverDomainCodeExtensions`.
///
/// Кожен розпізнаний файл перечитується тим самим гейтом, тому symlink-втеча
/// блокує вибір адаптерів ЩЕ ДО конвеєра — а не після того, як його джерела
/// потраплять у граф.
///
/// # Errors
/// Недоступний корінь, нечитабельний файл або вихід за межу домену.
pub fn discover_domain_code_extensions(
    scope: &DomainScope<'_>,
) -> Result<Vec<String>, Vec<Diagnostic>> {
    let root = real_root(scope.root)?;
    let supported: BTreeSet<&str> = SUPPORTED_CODE_EXTENSIONS.iter().copied().collect();
    let paths: Vec<String> = walk_sources(&root, scope)?
        .into_iter()
        .filter(|path| {
            extension_of(path).is_some_and(|extension| supported.contains(extension.as_str()))
        })
        .collect();

    let mut diagnostics = Vec::new();
    let mut extensions: BTreeSet<String> = BTreeSet::new();
    for path in paths {
        match read_domain_source(&root, &path) {
            Ok(source) => {
                if let Some(extension) = extension_of(&source.path) {
                    extensions.insert(extension);
                }
            }
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }
    if diagnostics.is_empty() {
        Ok(extensions.into_iter().collect())
    } else {
        Err(diagnostics)
    }
}

/// Завантажує всі джерела домену, без джерел вкладених пакетів — порт
/// `loadDomainSources`.
///
/// # Errors
/// Невалідні розширення, недоступний корінь, нечитабельний файл або вихід за
/// межу домену.
pub fn load_domain_sources(
    scope: &DomainScope<'_>,
    extensions: &[String],
) -> Result<Vec<SourceFile>, Vec<Diagnostic>> {
    let root = real_root(scope.root)?;
    let normalized = normalize_extensions(extensions)?;
    let wanted: BTreeSet<&str> = normalized.iter().map(String::as_str).collect();
    let paths: Vec<String> = walk_sources(&root, scope)?
        .into_iter()
        .filter(|path| {
            extension_of(path).is_some_and(|extension| wanted.contains(extension.as_str()))
        })
        .collect();

    let mut sources = Vec::new();
    let mut diagnostics = Vec::new();
    for path in paths {
        match read_domain_source(&root, &path) {
            Ok(source) => sources.push(source),
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }
    if diagnostics.is_empty() {
        Ok(sources)
    } else {
        Err(diagnostics)
    }
}
