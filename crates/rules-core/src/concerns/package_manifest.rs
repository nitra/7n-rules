//! Native-порт `npm/rules/changelog/lib/package-manifest.mjs` —
//! [`get_monorepo_project_root_dirs`], [`manifest_file_path`],
//! [`parse_pyproject_fields`], [`read_package_manifest`]: усі чотири функції
//! потрібні `changelog/presence` (перша) і `changelog/consistency` (усі
//! чотири, `crate::concerns::changelog_consistency`). Поле `maxBump`
//! маніфесту (typedef `PackageManifest` у JS, `package-manifest.mjs:27`) НЕ
//! портоване — єдиний консюмер `release.maxBump` це `n-rules release`
//! (лишається в JS), `changelog/consistency` його не читає (звірено самим
//! `main.mjs` каналу і тестом `package-manifest.test.mjs`, який лишається
//! незайманим на JS-боці — саме він і покриває `maxBump`).
//!
//! Сам JS-файл `package-manifest.mjs` НЕ видаляється: `readPackageManifest`
//! і `parsePyprojectFields` мають живих JS-консюмерів поза
//! `changelog/consistency` — `npm/rules/release/release.mjs` і
//! `npm/scripts/lib/workspaces.mjs` (перевірено через grep перед портом) — тож
//! ці дві копії (Rust тут, JS там) свідомо співіснують, а не дублюють одна
//! одну випадково.
//!
//! Перетин із [`crate::concerns::workspaces`]: `getMonorepoProjectRootDirs`
//! обгортає `getMonorepoPackageRootDirs` (npm-пакети) і додає ще Python
//! `pyproject.toml`-каталоги без сусіднього `package.json` — той самий
//! композиційний підхід, що й JS-версія, тому тут окремий файл, не
//! розширення `workspaces.rs` (він лишається чистим npm-портом
//! `workspaces.mjs`, без домішки Python-специфіки).

use std::collections::HashSet;
use std::path::Path;

use crate::concerns::glob_compat::scan_glob;
use crate::concerns::workspaces::{
    get_monorepo_package_root_dirs, is_ignored_workspace_root, sorted_workspace_roots,
};

/// Тип маніфесту пакета — порт typedef `PackageKind`
/// (`package-manifest.mjs:15`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackageKind {
    Npm,
    Python,
}

/// Уніфікований маніфест пакета для перевірок changelog — порт typedef
/// `PackageManifest` (`package-manifest.mjs:18-28`), без поля `maxBump`
/// (доккомент модуля вище).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageManifest {
    pub kind: PackageKind,
    /// Відносний шлях воркспейсу (`"."` для кореня).
    pub ws: String,
    /// `"package.json"` | `"pyproject.toml"`.
    pub manifest_rel: String,
    pub name: Option<String>,
    pub version: Option<String>,
    /// Чи застосовується режим порівняння з реєстром (npm view / PyPI).
    pub registry_publishable: bool,
    /// Лише npm: `files` із `package.json`.
    pub npm_files: Option<Vec<String>>,
}

/// Витягнуті поля `pyproject.toml` — порт повернення `parsePyprojectFields`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PyprojectFields {
    pub name: Option<String>,
    pub version: Option<String>,
}

/// Непорожній рядок чи `None` — JS-truthy перевірка рядкових полів
/// (`Boolean(fields.name && fields.version)` тощо трактує `""` як falsy).
fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|s| !s.is_empty())
}

/// PEP 621 `[project]` або Poetry `[tool.poetry]` — точний порт
/// `projectFieldsFromPyprojectDoc` (`package-manifest.mjs:49-74`).
fn project_fields_from_pyproject_doc(doc: &toml::Table) -> PyprojectFields {
    if let Some(project) = doc.get("project").and_then(|v| v.as_table()) {
        return PyprojectFields {
            name: project
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            version: project
                .get("version")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        };
    }
    if let Some(poetry) = doc
        .get("tool")
        .and_then(|v| v.as_table())
        .and_then(|tool| tool.get("poetry"))
        .and_then(|v| v.as_table())
    {
        return PyprojectFields {
            name: poetry
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            version: poetry
                .get("version")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        };
    }
    PyprojectFields::default()
}

/// Парсить `name`/`version` із вмісту `pyproject.toml` — точний порт
/// `parsePyprojectFields` (`package-manifest.mjs:80-86`). Невалідний TOML →
/// обидва поля `None` (той самий `catch` → `{ name: null, version: null }`).
pub fn parse_pyproject_fields(text: &str) -> PyprojectFields {
    toml::from_str::<toml::Table>(text)
        .map(|doc| project_fields_from_pyproject_doc(&doc))
        .unwrap_or_default()
}

/// Читає маніфест воркспейсу (`package.json` пріоритетний, інакше
/// `pyproject.toml`) — точний порт `readPackageManifest`
/// (`package-manifest.mjs:93-135`).
///
/// `package.json`-гілка не падає на жодній помилці (відсутній файл вже
/// відсічений `.exists()`, невалідний JSON / не-обʼєкт / помилка читання —
/// усі звужуються до `None` через `?` по аналогії з JS `try { … } catch {
/// return null }`) — і на цьому функція ЗУПИНЯЄТЬСЯ: побитий `package.json`
/// не веде до fallback на `pyproject.toml` (той самий early-return, що в
/// JS — гілка `pyproject` виконується лише коли `package.json` ВІДСУТНІЙ).
pub fn read_package_manifest(ws: &str, cwd: &Path) -> Option<PackageManifest> {
    let pkg_path = cwd.join(ws).join("package.json");
    if pkg_path.exists() {
        return read_npm_manifest(ws, &pkg_path);
    }

    let py_path = cwd.join(ws).join("pyproject.toml");
    if !py_path.exists() {
        return None;
    }
    let text = std::fs::read_to_string(&py_path).ok()?;
    let fields = parse_pyproject_fields(&text);
    let registry_publishable =
        non_empty(fields.name.clone()).is_some() && non_empty(fields.version.clone()).is_some();
    Some(PackageManifest {
        kind: PackageKind::Python,
        ws: ws.to_string(),
        manifest_rel: "pyproject.toml".to_string(),
        name: fields.name,
        version: fields.version,
        registry_publishable,
        npm_files: None,
    })
}

/// `package.json`-гілка [`read_package_manifest`] — winner-takes-null: будь-
/// яка проблема з файлом (читання, JSON, форма) дає `None`, без fallback.
fn read_npm_manifest(ws: &str, pkg_path: &Path) -> Option<PackageManifest> {
    let text = std::fs::read_to_string(pkg_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&text).ok()?;
    let obj = parsed.as_object()?;

    let name = obj.get("name").and_then(|v| v.as_str()).map(str::to_string);
    let version = obj
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let private = obj
        .get("private")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let files_value = obj.get("files");
    let npm_files = files_value.and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|x| x.as_str().map(str::to_string))
            .collect::<Vec<_>>()
    });
    let registry_publishable = non_empty(name.clone()).is_some()
        && !private
        && files_value.map(|v| v.is_array()).unwrap_or(false);

    Some(PackageManifest {
        kind: PackageKind::Npm,
        ws: ws.to_string(),
        manifest_rel: "package.json".to_string(),
        name,
        version,
        registry_publishable,
        npm_files,
    })
}

/// Шлях до файлу маніфесту воркспейсу — точний порт `manifestFilePath`
/// (`package-manifest.mjs:173-175`, `join(ws, manifest.manifestRel)`: node
/// нормалізує ведучий `./`, тому `ws == "."` дає голий `manifestRel`).
pub fn manifest_file_path(ws: &str, manifest: &PackageManifest) -> String {
    if ws == "." {
        manifest.manifest_rel.clone()
    } else {
        format!("{ws}/{}", manifest.manifest_rel)
    }
}

/// Posix-dirname з фолбеком на `"."` для файлів у корені — точний порт
/// комбінації `dirname(join(repoRoot, relPy))` + `relative(repoRoot, ...)`
/// (`package-manifest.mjs:150-152`), спрощений до прямої роботи з
/// relative-posix рядком, бо `repoRoot`-префікс і так скорочується назад.
fn dirname_or_dot(rel_posix: &str) -> String {
    match rel_posix.rfind('/') {
        Some(idx) => rel_posix[..idx].to_string(),
        None => ".".to_string(),
    }
}

/// Каталоги пакетів: npm (`package.json`/workspaces) + Python
/// (`pyproject.toml` без сусіднього `package.json`) — точний порт
/// `getMonorepoProjectRootDirs` (`package-manifest.mjs:142-165`).
pub fn get_monorepo_project_root_dirs(repo_root: &Path) -> Vec<String> {
    let mut roots: HashSet<String> = get_monorepo_package_root_dirs(repo_root)
        .into_iter()
        .collect();

    let has_pyproject = repo_root.join("pyproject.toml").exists();
    let has_package_json = repo_root.join("package.json").exists();
    if has_pyproject && !has_package_json {
        roots.insert(".".to_string());
    }

    for rel_py in scan_glob("**/pyproject.toml", repo_root) {
        let ws = dirname_or_dot(&rel_py);
        if !is_ignored_workspace_root(&ws) && !repo_root.join(&ws).join("package.json").exists() {
            roots.insert(ws);
        }
    }

    sorted_workspace_roots(roots)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    use crate::concerns::test_support::write;

    #[test]
    fn no_manifests_yields_only_dot() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec!["."]);
    }

    #[test]
    fn npm_workspaces_are_included() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["npm"]}"#);
        write(&tmp, "npm/package.json", r#"{"name":"npm"}"#);
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec![".", "npm"]);
    }

    #[test]
    fn root_pyproject_without_package_json_adds_dot() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pyproject.toml", "[project]\nname=\"r\"\n");
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec!["."]);
    }

    #[test]
    fn nested_pyproject_without_package_json_is_a_root() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", r#"{"name":"app"}"#);
        write(&tmp, "svc/pyproject.toml", "[project]\nname=\"svc\"\n");
        assert_eq!(
            get_monorepo_project_root_dirs(tmp.path()),
            vec![".", "app", "svc"]
        );
    }

    #[test]
    fn nested_pyproject_with_sibling_package_json_is_skipped() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", r#"{"name":"app"}"#);
        write(&tmp, "app/pyproject.toml", "[project]\nname=\"app-py\"\n");
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec![".", "app"]);
    }

    #[test]
    fn pyproject_under_node_modules_is_ignored() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", r#"{"workspaces":["app"]}"#);
        write(&tmp, "app/package.json", r#"{"name":"app"}"#);
        write(
            &tmp,
            "node_modules/dep/pyproject.toml",
            "[project]\nname=\"dep\"\n",
        );
        assert_eq!(get_monorepo_project_root_dirs(tmp.path()), vec![".", "app"]);
    }

    #[test]
    fn parse_pyproject_fields_pep621() {
        let fields = parse_pyproject_fields("[project]\nname = \"x\"\nversion = \"1.2.3\"\n");
        assert_eq!(fields.name.as_deref(), Some("x"));
        assert_eq!(fields.version.as_deref(), Some("1.2.3"));
    }

    #[test]
    fn parse_pyproject_fields_poetry_fallback() {
        let fields =
            parse_pyproject_fields("[tool.poetry]\nname = \"poetry-pkg\"\nversion = \"0.9.0\"\n");
        assert_eq!(fields.name.as_deref(), Some("poetry-pkg"));
        assert_eq!(fields.version.as_deref(), Some("0.9.0"));
    }

    #[test]
    fn parse_pyproject_fields_invalid_toml_yields_none() {
        let fields = parse_pyproject_fields("NOT VALID = = = TOML");
        assert_eq!(fields, PyprojectFields::default());
    }

    #[test]
    fn parse_pyproject_fields_without_project_or_poetry_yields_none() {
        let fields = parse_pyproject_fields("[other]\nfoo = \"bar\"\n");
        assert_eq!(fields, PyprojectFields::default());
    }

    #[test]
    fn read_package_manifest_python_without_package_json() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "pyproject.toml", "[project]\nversion = \"1.0.0\"\n");
        let m = read_package_manifest(".", tmp.path()).unwrap();
        assert_eq!(m.kind, PackageKind::Python);
        assert_eq!(m.version.as_deref(), Some("1.0.0"));
        assert!(!m.registry_publishable);
    }

    #[test]
    fn read_package_manifest_npm_has_priority_over_pyproject() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "package.json",
            r#"{"name":"a","version":"2.0.0","private":true}"#,
        );
        write(
            &tmp,
            "pyproject.toml",
            "[project]\nname = \"py\"\nversion = \"9.0.0\"\n",
        );
        let m = read_package_manifest(".", tmp.path()).unwrap();
        assert_eq!(m.kind, PackageKind::Npm);
        assert_eq!(m.version.as_deref(), Some("2.0.0"));
    }

    #[test]
    fn read_package_manifest_array_package_json_is_none() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "[]");
        assert!(read_package_manifest(".", tmp.path()).is_none());
    }

    #[test]
    fn read_package_manifest_invalid_json_is_none() {
        let tmp = TempDir::new().unwrap();
        write(&tmp, "package.json", "NOT JSON");
        assert!(read_package_manifest(".", tmp.path()).is_none());
    }

    #[test]
    fn read_package_manifest_missing_files_is_none() {
        let tmp = TempDir::new().unwrap();
        assert!(read_package_manifest(".", tmp.path()).is_none());
    }

    #[test]
    fn read_package_manifest_npm_registry_publishable_requires_files_array() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "package.json",
            r#"{"name":"@x/lib","version":"1.0.0","files":["lib"]}"#,
        );
        let m = read_package_manifest(".", tmp.path()).unwrap();
        assert!(m.registry_publishable);
        assert_eq!(m.npm_files, Some(vec!["lib".to_string()]));
    }

    #[test]
    fn read_package_manifest_npm_private_is_not_publishable() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "package.json",
            r#"{"name":"a","version":"1.0.0","private":true,"files":["lib"]}"#,
        );
        let m = read_package_manifest(".", tmp.path()).unwrap();
        assert!(!m.registry_publishable);
    }

    #[test]
    fn read_package_manifest_python_registry_publishable_needs_name_and_version() {
        let tmp = TempDir::new().unwrap();
        write(
            &tmp,
            "pyproject.toml",
            "[project]\nname = \"my-lib\"\nversion = \"2.0.1\"\n",
        );
        let m = read_package_manifest(".", tmp.path()).unwrap();
        assert!(m.registry_publishable);
    }

    #[test]
    fn manifest_file_path_root_workspace_has_no_prefix() {
        let m = read_npm_manifest_fixture();
        assert_eq!(manifest_file_path(".", &m), "package.json");
    }

    #[test]
    fn manifest_file_path_sub_workspace_is_prefixed() {
        let m = read_npm_manifest_fixture();
        assert_eq!(manifest_file_path("app", &m), "app/package.json");
    }

    fn read_npm_manifest_fixture() -> PackageManifest {
        PackageManifest {
            kind: PackageKind::Npm,
            ws: ".".to_string(),
            manifest_rel: "package.json".to_string(),
            name: Some("x".to_string()),
            version: Some("1.0.0".to_string()),
            registry_publishable: true,
            npm_files: None,
        }
    }
}
