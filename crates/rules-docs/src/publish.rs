//! Атомарна публікація артефактів — порт `publish.mjs`.
//!
//! Усі записи спершу лягають у СТЕЙДЖ на тому самому томі, і лише потім
//! відбувається обмін каталогів. Провалений валідатор, конфлікт захищеної
//! зони чи помилка запису лишають закомічені `docs/` і manifest недоторканими
//! — часткова публікація гірша за жодну:напів оновлена документація виглядає як
//! цілісна.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;

use regex::Regex;

use crate::deterministic::js_locale_cmp;

const DOCS_PREFIX: &str = "docs/";
const MANIFEST_PATH: &str = "docs/.docgen/manifest.json";

/// Канонічні маршрути згенерованих сторінок — усе інше під `docs/` вважається
/// авторським і ніколи не видаляється як застаріле.
static GENERATED_PAGE_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^docs/(?:index\.md|implementation-gaps\.md|explanation/architecture\.md|explanation/(?:capabilities|processes)/[a-f0-9]{24}\.md|reference/contracts/[a-f0-9]{24}\.md)$",
    )
    .expect("регулярка коректна")
});

/// Тематична сторінка: вид теки і токен теми.
static GENERATED_TOPIC_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^docs/(?:explanation/(capabilities|processes)|reference/(contracts))/([a-f0-9]{24})\.md$",
    )
    .expect("регулярка коректна")
});

/// Діагностика публікації.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub detail: String,
    pub path: Option<String>,
}

impl Diagnostic {
    fn new(code: &str, detail: &str) -> Self {
        Self {
            code: code.to_string(),
            detail: detail.to_string(),
            path: None,
        }
    }
}

/// Вердикт валідатора викликача.
///
/// Три стани, а не два: JS розрізняє «валідатор сказав ні» і «валідатор
/// упав», і коди діагностик у цих випадках різні — друге вказує на дефект
/// самого гейта, а не документації.
#[derive(Debug, Clone)]
pub enum ValidationOutcome {
    Passed,
    Failed(Vec<Diagnostic>),
    Threw(String),
}

/// Результат публікації.
#[derive(Debug, Clone)]
pub enum PublishOutcome {
    Published,
    Blocked(Vec<Diagnostic>),
}

fn blocked(code: &str, detail: &str) -> PublishOutcome {
    PublishOutcome::Blocked(vec![Diagnostic::new(code, detail)])
}

fn from_zone_diagnostics(diagnostics: Vec<crate::zones::Diagnostic>) -> PublishOutcome {
    PublishOutcome::Blocked(
        diagnostics
            .into_iter()
            .map(|item| Diagnostic {
                code: item.code,
                detail: item.detail,
                path: item.path,
            })
            .collect(),
    )
}

/// Чи шлях-кандидат лишається під `docs/` — порт `isSafeDocsPath`.
///
/// `..` всередині дозволено рівно доти, доки шлях не ВИХОДИТЬ за `docs/`:
/// саме так поводиться `path.relative` у JS, і звужувати це до «жодних `..`»
/// означало б відкидати валідні кандидати.
fn is_safe_docs_path(path: &str) -> bool {
    if !path.starts_with(DOCS_PREFIX) || Path::new(path).is_absolute() {
        return false;
    }
    let mut depth = 0i32;
    for component in Path::new(path).components() {
        match component {
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            Component::CurDir => {}
            _ => depth += 1,
        }
    }
    // Перший компонент — сам `docs`, тож усередині нього має лишитись
    // принаймні один рівень.
    depth >= 1
}

/// Чи закомічений manifest — це саме package-knowledge проєкція.
fn is_knowledge_manifest(content: &str) -> bool {
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(content) else {
        return false;
    };
    manifest.get("schemaVersion") == Some(&serde_json::json!(1))
        && manifest
            .get("domain")
            .and_then(|domain| domain.get("id"))
            .and_then(serde_json::Value::as_str)
            .is_some()
        && manifest
            .get("nodes")
            .is_some_and(serde_json::Value::is_array)
        && manifest
            .get("topics")
            .is_some_and(serde_json::Value::is_array)
}

/// Очікуваний AUTOGEN-ID для канонічного маршруту.
fn zone_id_for_generated_path(path: &str) -> Option<String> {
    match path {
        "docs/index.md" => return Some("package-index".to_string()),
        "docs/explanation/architecture.md" => return Some("package-architecture".to_string()),
        "docs/implementation-gaps.md" => return Some("implementation-gaps".to_string()),
        _ => {}
    }
    let captures = GENERATED_TOPIC_PATH.captures(path)?;
    let kind = match captures.get(1).map(|group| group.as_str()) {
        Some("capabilities") => "capability",
        Some("processes") => "process",
        _ => "contract",
    };
    Some(format!("{kind}-{}", captures.get(3)?.as_str()))
}

/// Усі Markdown-шляхи під `docs/`, у стабільному порядку.
fn list_markdown_paths(root: &Path, directory: &str) -> std::io::Result<Vec<String>> {
    let absolute = root.join(directory);
    let entries = match std::fs::read_dir(&absolute) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = format!("{directory}/{name}");
        let kind = entry.file_type()?;
        if kind.is_dir() {
            paths.extend(list_markdown_paths(root, &path)?);
        } else if kind.is_file() && path.ends_with(".md") {
            paths.push(path);
        }
    }
    paths.sort_by(|left, right| js_locale_cmp(left, right));
    Ok(paths)
}

/// Застарілі згенеровані сторінки — порт `staleGeneratedPages`.
///
/// Сторінка вважається НАШОЮ лише коли збігаються і канонічний маршрут, і
/// AUTOGEN-ID. Успадкована документація під `docs/` до цього набору не
/// потрапляє навіть тоді, коли лежить поруч.
fn stale_generated_pages(
    root: &Path,
    files: &BTreeMap<String, String>,
) -> std::io::Result<Result<Vec<String>, Vec<Diagnostic>>> {
    let previous_manifest = root.join(MANIFEST_PATH);
    let recognised = std::fs::read_to_string(&previous_manifest)
        .map(|content| is_knowledge_manifest(&content))
        .unwrap_or(false);
    if !recognised {
        return Ok(Ok(Vec::new()));
    }
    let candidates: BTreeSet<&String> = files.keys().collect();
    let mut paths = Vec::new();
    let mut diagnostics = Vec::new();
    for path in list_markdown_paths(root, "docs")? {
        if candidates.contains(&path) || !GENERATED_PAGE_PATH.is_match(&path) {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(root.join(&path)) else {
            continue;
        };
        let Ok(parsed) = crate::zones::parse_knowledge_zones(&content, Some(&path)) else {
            continue;
        };
        let Some(zone_id) = zone_id_for_generated_path(&path) else {
            continue;
        };
        let owned = parsed
            .zones
            .iter()
            .any(|zone| zone.kind == "AUTOGEN" && zone.id == zone_id);
        if !owned {
            continue;
        }
        let has_protected = parsed
            .zones
            .iter()
            .any(|zone| zone.kind == "MANUAL" || zone.kind == "EXPECTED");
        let has_implicit = parsed
            .implicit_manual
            .iter()
            .any(|content| !content.is_empty());
        if has_protected || has_implicit {
            // Авторський вміст у застарілій сторінці — привід ЗУПИНИТИСЬ, а
            // не видалити: людина писала це вручну.
            diagnostics.push(Diagnostic::new(
                "stale-generated-protected",
                &format!("Obsolete generated page {path} містить authored protected content."),
            ));
            continue;
        }
        paths.push(path);
    }
    Ok(if diagnostics.is_empty() {
        Ok(paths)
    } else {
        Err(diagnostics)
    })
}

/// Створює унікальний каталог поруч із коренем домену — аналог `mkdtemp`.
///
/// Саме поруч, а не в системному tmp: обмін каталогів наприкінці має бути
/// `rename` у межах ОДНОГО тому, інакше атомарності немає.
fn create_staging_dir(root: &Path, prefix: &str) -> std::io::Result<PathBuf> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let pid = std::process::id();
    for _ in 0..1024 {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = root.join(format!("{prefix}{pid}-{unique}"));
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "не вдалося створити унікальний staging-каталог",
    ))
}

/// Рекурсивна копія каталогу.
fn copy_dir_all(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Прибирання, що не має права затулити основну помилку публікації.
fn best_effort_remove(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}

/// Перевіряє кандидатів проти закомічених файлів — порт відповідного блоку
/// `publishKnowledgeArtifacts`.
fn check_candidates_against_committed(
    root: &Path,
    files: &BTreeMap<String, String>,
) -> Option<PublishOutcome> {
    for (path, candidate) in files {
        if !path.ends_with(".md") {
            continue;
        }
        let target = root.join(path);
        if !target.exists() {
            // Нова сторінка: перевіряємо лише коректність її власних
            // маркерів — зберігати тут ще нічого.
            if let Err(diagnostics) = crate::zones::parse_knowledge_zones(candidate, Some(path)) {
                return Some(from_zone_diagnostics(diagnostics));
            }
            continue;
        }
        let Ok(previous) = std::fs::read_to_string(&target) else {
            continue;
        };
        if let Err(diagnostics) =
            crate::zones::assert_protected_zones_preserved(&previous, candidate, Some(path))
        {
            return Some(from_zone_diagnostics(diagnostics));
        }
    }
    None
}

/// Транзакція обміну каталогів. Повертає помилку рядком — викликач
/// перетворює її на `publish-failed`.
fn swap_docs_tree(
    root: &Path,
    files: &BTreeMap<String, String>,
    stale: &[String],
) -> Result<(), String> {
    let docs_root = root.join("docs");
    let stage =
        create_staging_dir(root, ".package-knowledge-stage-").map_err(|error| error.to_string())?;
    let stage_docs = stage.join("docs");

    let result = (|| -> Result<(), String> {
        if docs_root.exists() {
            copy_dir_all(&docs_root, &stage_docs).map_err(|error| error.to_string())?;
        } else {
            std::fs::create_dir_all(&stage_docs).map_err(|error| error.to_string())?;
        }
        for (path, content) in files {
            let target = stage.join(path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::write(&target, content).map_err(|error| error.to_string())?;
        }
        for path in stale {
            let _ = std::fs::remove_file(stage.join(path));
        }

        // Каталог резервної копії створюється і одразу ж прибирається: далі
        // на його місце ПЕРЕЇЖДЖАЄ поточний `docs/`, і шлях має бути вільним.
        let backup = create_staging_dir(root, ".package-knowledge-backup-")
            .map_err(|error| error.to_string())?;
        best_effort_remove(&backup);
        let had_docs = docs_root.exists();
        if had_docs {
            std::fs::rename(&docs_root, &backup).map_err(|error| error.to_string())?;
        }
        match std::fs::rename(&stage_docs, &docs_root) {
            Ok(()) => {
                best_effort_remove(&backup);
                Ok(())
            }
            Err(error) => {
                // Відкат: повертаємо закомічений стан на місце, і саме
                // ПЕРВИННА помилка лишається тим, що бачить викликач.
                if had_docs && backup.exists() && !docs_root.exists() {
                    let _ = std::fs::rename(&backup, &docs_root);
                }
                best_effort_remove(&backup);
                Err(error.to_string())
            }
        }
    })();

    best_effort_remove(&stage);
    result
}

/// Атомарно публікує кандидатів, перевірених викликачем — порт
/// `publishKnowledgeArtifacts`.
///
/// `validate` викликається ДО будь-якого дотику до файлової системи: гейт,
/// що спрацював після часткового запису, вже нічого не гарантує.
#[must_use]
pub fn publish_knowledge_artifacts(
    domain_root: &Path,
    files: &BTreeMap<String, String>,
    validate: &dyn Fn(&BTreeMap<String, String>) -> ValidationOutcome,
) -> PublishOutcome {
    if !domain_root.is_absolute() {
        return blocked("invalid-domain-root", "domainRoot має бути absolute path.");
    }
    if !files.contains_key(MANIFEST_PATH) {
        return blocked(
            "missing-manifest",
            &format!("Candidate має містити {MANIFEST_PATH}."),
        );
    }
    // Шлях у повідомленні — лексикографічно перший невалідний (у JS це був
    // перший за порядком вставки); сам факт відмови від порядку не залежить.
    if let Some(path) = files.keys().find(|path| !is_safe_docs_path(path)) {
        return blocked(
            "invalid-candidate-file",
            &format!("Недійсний candidate file {path}."),
        );
    }

    match validate(files) {
        ValidationOutcome::Passed => {}
        ValidationOutcome::Failed(diagnostics) if diagnostics.is_empty() => {
            return blocked("caller-validation-failed", "Caller validation не пройшла.");
        }
        ValidationOutcome::Failed(diagnostics) => return PublishOutcome::Blocked(diagnostics),
        ValidationOutcome::Threw(message) => {
            return blocked("caller-validation-threw", &message);
        }
    }

    if let Some(outcome) = check_candidates_against_committed(domain_root, files) {
        return outcome;
    }
    let stale = match stale_generated_pages(domain_root, files) {
        Ok(Ok(paths)) => paths,
        Ok(Err(diagnostics)) => return PublishOutcome::Blocked(diagnostics),
        Err(error) => return blocked("publish-failed", &error.to_string()),
    };

    match swap_docs_tree(domain_root, files, &stale) {
        Ok(()) => PublishOutcome::Published,
        Err(message) => blocked("publish-failed", &message),
    }
}
