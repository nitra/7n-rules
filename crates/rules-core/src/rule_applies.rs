//! cspell:ignore picomatch
//!
//! Декларативний rule-level гейт `main.json:applies` — Rust-дзеркало
//! `npm/scripts/lib/rule-applies.mjs` (зріз 3 контракту плагінів v3.1,
//! `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, рішення Д).
//!
//! # Навіщо цей модуль існує
//!
//! Доки гейт був виконуваним модулем `<rule>/applies/main.mjs`, дискавері
//! правил вимагало JS-рантайму, і `rules-cli` делегував `ci plan` у node в
//! БУДЬ-ЯКОМУ репо з плагінами. Як дані той самий гейт читається однаково з
//! обох боків, тож дискавері знову стає читанням даних — його можна
//! кешувати, серіалізувати й порівнювати в parity-тестах.
//!
//! # Словник
//!
//! Виведений з інвентаризації всіх трьох гейтів репо, не вигаданий наперед:
//! `pathExists` (`python`, `npm-module`), `globMatches` (`rust`),
//! `jsonFieldContains` (`npm-module`) і комбінатор `any` (`npm-module`).
//! Кон'юнкції (`all`) немає — жоден чинний гейт її не потребує.
//!
//! # Помилка формату = делегація, не здогад
//!
//! Парсер повертає [`AppliesError`], а викликач (`rules-cli::ci_cmd`)
//! трактує помилку як «нативно не можна» і віддає команду в JS — там той
//! самий битий гейт кине рідне повідомлення з `AppliesSpecError`. Так
//! native-шлях ніколи не має власного тексту помилки, який довелося б
//! тримати byte-exact із JS.

use std::collections::BTreeSet;
use std::path::Path;

use serde_json::Value;

use crate::lint_plan::GlobMatcher;

/// Літерал аварійного клапана: гейт лишається виконуваним JS-модулем правила.
pub const APPLIES_DYNAMIC: &str = "dynamic";

/// Імена операторів словника — для тексту помилок.
pub const APPLIES_OPERATORS: [&str; 4] = ["pathExists", "globMatches", "jsonFieldContains", "any"];

/// Розбіжність значення `applies` зі схемою. Текст навмисно короткий і
/// НЕ дзеркалить JS: він ніколи не потрапляє користувачеві (доккомент модуля).
#[derive(Debug, thiserror::Error)]
#[error("applies: {0}")]
pub struct AppliesError(String);

/// Один вузол предиката.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppliesNode {
    /// `existsSync(cwd/<path>)` — будь-який тип запису (файл або каталог),
    /// рівно як `existsSync` у JS-каноні.
    PathExists(String),
    /// Обхід дерева від `cwd` із пропуском каталогів за ІМЕНЕМ; істина —
    /// щойно знайдено перший файл, чий posix-шлях відносно `cwd` збігся.
    GlobMatches {
        /// Патерни (той самий picomatch-канон, що `concern.json#lint.glob`).
        glob: Vec<String>,
        /// Імена каталогів, у які walker не заходить.
        ignore_dirs: BTreeSet<String>,
    },
    /// Поле JSON-файлу — масив, що містить рядок `value`.
    JsonFieldContains {
        /// Шлях файлу відносно кореня репо.
        file: String,
        /// Шлях поля через крапку (`"a.b"`).
        field: String,
        /// Шуканий елемент масиву.
        value: String,
    },
    /// Диз'юнкція: істина, якщо істинний хоч один дочірній вузол.
    Any(Vec<AppliesNode>),
}

/// Гейт правила після нормалізації.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppliesSpec {
    /// Гейта немає — правило застосовне завжди.
    Always,
    /// Гейт лишається виконуваним JS (аварійний клапан або legacy-правило).
    Dynamic,
    /// Декларативний предикат.
    Declarative(AppliesNode),
}

/// Нормалізує `glob` (рядок або масив рядків) у непорожній список патернів.
fn normalize_globs(raw: Option<&Value>, where_: &str) -> Result<Vec<String>, AppliesError> {
    let items: Vec<&Value> = match raw {
        Some(Value::Array(list)) => list.iter().collect(),
        Some(single) => vec![single],
        None => vec![],
    };
    let globs: Vec<String> = items
        .into_iter()
        .filter_map(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    if globs.is_empty() {
        return Err(AppliesError(format!(
            "{where_}: glob має бути непорожнім рядком або масивом рядків"
        )));
    }
    Ok(globs)
}

/// Дістає непорожній рядок із поля обʼєкта.
fn required_string(
    obj: &serde_json::Map<String, Value>,
    key: &str,
    where_: &str,
) -> Result<String, AppliesError> {
    obj.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AppliesError(format!("{where_}.{key}: очікується непорожній рядок")))
}

/// Валідує один вузол предиката. Вузол — обʼєкт РІВНО з одним ключем-оператором:
/// два оператори в одному вузлі неоднозначні, тож це помилка, а не здогад.
pub fn parse_applies_node(value: &Value, where_: &str) -> Result<AppliesNode, AppliesError> {
    let Some(obj) = value.as_object() else {
        return Err(AppliesError(format!(
            "{where_}: очікується обʼєкт-вузол з одним оператором ({})",
            APPLIES_OPERATORS.join(", ")
        )));
    };
    if obj.len() != 1 {
        return Err(AppliesError(format!(
            "{where_}: вузол має містити РІВНО один оператор, отримано {}",
            obj.len()
        )));
    }
    let (op, arg) = obj.iter().next().expect("len == 1 перевірено вище");

    match op.as_str() {
        "pathExists" => arg
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| AppliesNode::PathExists(s.to_owned()))
            .ok_or_else(|| {
                AppliesError(format!(
                    "{where_}.pathExists: очікується непорожній posix-шлях"
                ))
            }),

        "globMatches" => {
            let spec = arg.as_object().ok_or_else(|| {
                AppliesError(format!(
                    "{where_}.globMatches: очікується обʼєкт {{ glob, ignoreDirs }}"
                ))
            })?;
            let glob = normalize_globs(spec.get("glob"), &format!("{where_}.globMatches"))?;
            let ignore_dirs = match spec.get("ignoreDirs") {
                None | Some(Value::Null) => BTreeSet::new(),
                Some(Value::Array(list)) => {
                    let mut out = BTreeSet::new();
                    for item in list {
                        let name = item.as_str().ok_or_else(|| {
                            AppliesError(format!(
                                "{where_}.globMatches.ignoreDirs: очікується масив імен каталогів"
                            ))
                        })?;
                        out.insert(name.to_owned());
                    }
                    out
                }
                Some(_) => {
                    return Err(AppliesError(format!(
                        "{where_}.globMatches.ignoreDirs: очікується масив імен каталогів"
                    )))
                }
            };
            Ok(AppliesNode::GlobMatches { glob, ignore_dirs })
        }

        "jsonFieldContains" => {
            let where_op = format!("{where_}.jsonFieldContains");
            let spec = arg.as_object().ok_or_else(|| {
                AppliesError(format!(
                    "{where_op}: очікується обʼєкт {{ file, field, value }}"
                ))
            })?;
            Ok(AppliesNode::JsonFieldContains {
                file: required_string(spec, "file", &where_op)?,
                field: required_string(spec, "field", &where_op)?,
                value: spec
                    .get("value")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| AppliesError(format!("{where_op}.value: очікується рядок")))?,
            })
        }

        "any" => {
            let list = arg
                .as_array()
                .filter(|list| !list.is_empty())
                .ok_or_else(|| {
                    AppliesError(format!("{where_}.any: очікується непорожній масив вузлів"))
                })?;
            let children = list
                .iter()
                .enumerate()
                .map(|(index, child)| parse_applies_node(child, &format!("{where_}.any[{index}]")))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(AppliesNode::Any(children))
        }

        other => Err(AppliesError(format!(
            "{where_}: невідомий оператор \"{other}\" — словник: {}",
            APPLIES_OPERATORS.join(", ")
        ))),
    }
}

/// Нормалізує значення поля `applies` (`None` — поля немає).
pub fn parse_applies_spec(value: Option<&Value>) -> Result<AppliesSpec, AppliesError> {
    match value {
        None => Ok(AppliesSpec::Always),
        Some(Value::String(literal)) if literal == APPLIES_DYNAMIC => Ok(AppliesSpec::Dynamic),
        Some(node) => parse_applies_node(node, "applies").map(AppliesSpec::Declarative),
    }
}

/// Читає гейт правила з `<rule_dir>/main.json`.
///
/// Legacy-міст (дзеркало `readRuleApplies` у JS): поля немає, але поруч лежить
/// `<rule_dir>/applies/main.mjs` — правило ще на старому форматі, тож
/// [`AppliesSpec::Dynamic`].
/// Битий JSON `main.json` у JS дає `readRuleMetaRaw() === null`, тобто «поля
/// немає» — тут так само, без помилки.
pub fn read_rule_applies(rule_dir: &Path) -> Result<AppliesSpec, AppliesError> {
    let meta: Option<Value> = std::fs::read_to_string(rule_dir.join("main.json"))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .filter(Value::is_object);
    let spec = parse_applies_spec(meta.as_ref().and_then(|m| m.get("applies")))?;
    if spec == AppliesSpec::Always && rule_dir.join("applies").join("main.mjs").is_file() {
        return Ok(AppliesSpec::Dynamic);
    }
    Ok(spec)
}

/// Дістає значення поля за шляхом через крапку. Ключі з крапкою в імені не
/// адресуються — такому гейту потрібен `dynamic` (те саме обмеження в JS).
fn read_json_field<'a>(root: &'a Value, field: &str) -> Option<&'a Value> {
    let mut current = root;
    for segment in field.split('.') {
        current = current.as_object()?.get(segment)?;
    }
    Some(current)
}

/// Чи є в дереві `root` хоч один ФАЙЛ, чий posix-шлях відносно `root`
/// матчиться `matcher`. Каталоги з `ignore_dirs` не відвідуються; симлінки не
/// розгортаються (`file_type()` з `read_dir` — lstat, як `Dirent.isDirectory()`
/// у node), помилка читання каталогу = «тут нічого немає». Ранній вихід на
/// першій знахідці — гейт лежить на гарячому шляху `hook`.
fn walk_matches(
    root: &Path,
    prefix: &str,
    matcher: &GlobMatcher,
    ignore_dirs: &BTreeSet<String>,
) -> bool {
    let Ok(entries) = std::fs::read_dir(root) else {
        return false;
    };
    for entry in entries.filter_map(Result::ok) {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let relative = if prefix.is_empty() {
            name.to_owned()
        } else {
            format!("{prefix}/{name}")
        };
        if file_type.is_file() && matcher.is_match(&relative) {
            return true;
        }
        if file_type.is_dir()
            && !ignore_dirs.contains(name)
            && walk_matches(&entry.path(), &relative, matcher, ignore_dirs)
        {
            return true;
        }
    }
    false
}

/// Обчислює предикат для конкретного кореня репо.
pub fn evaluate_applies(node: &AppliesNode, cwd: &Path) -> bool {
    match node {
        AppliesNode::PathExists(path) => cwd.join(path).exists(),
        AppliesNode::GlobMatches { glob, ignore_dirs } => {
            walk_matches(cwd, "", &GlobMatcher::compile(glob), ignore_dirs)
        }
        AppliesNode::JsonFieldContains { file, field, value } => {
            let Ok(raw) = std::fs::read_to_string(cwd.join(file)) else {
                return false;
            };
            let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
                return false;
            };
            read_json_field(&parsed, field)
                .and_then(Value::as_array)
                .is_some_and(|list| {
                    list.iter()
                        .any(|item| item.as_str() == Some(value.as_str()))
                })
        }
        AppliesNode::Any(children) => children.iter().any(|child| evaluate_applies(child, cwd)),
    }
}

/// Чи застосовне правило з каталогу `rule_dir` у репо `cwd`.
///
/// `Ok(true)`/`Ok(false)` — гейт обчислено нативно; `Err` — правило вимагає
/// JS ([`AppliesSpec::Dynamic`] чи битий формат), тобто нативний шлях мусить
/// делегувати команду.
pub fn rule_applies(rule_dir: &Path, cwd: &Path) -> Result<bool, AppliesError> {
    match read_rule_applies(rule_dir)? {
        AppliesSpec::Always => Ok(true),
        AppliesSpec::Declarative(node) => Ok(evaluate_applies(&node, cwd)),
        AppliesSpec::Dynamic => Err(AppliesError(format!(
            "{}: гейт `dynamic` — обчислюється лише в JS",
            rule_dir.display()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    /// Гейт `rust` після міграції — дослівно те, що лежить у
    /// `plugins/lang-rust/rules/rust/main.json`.
    fn rust_gate() -> AppliesNode {
        AppliesNode::GlobMatches {
            glob: vec!["**/Cargo.toml".to_owned()],
            ignore_dirs: [
                "node_modules",
                ".git",
                "target",
                ".worktrees",
                "vendor",
                ".claude",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        }
    }

    fn touch(root: &Path, relative: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().expect("шлях із батьківським каталогом")).unwrap();
        std::fs::write(path, "").unwrap();
    }

    #[test]
    fn parses_every_operator_of_the_dictionary() {
        let spec = json!({
            "any": [
                { "pathExists": "npm" },
                { "globMatches": { "glob": ["**/Cargo.toml"], "ignoreDirs": ["target"] } },
                { "jsonFieldContains": { "file": "package.json", "field": "workspaces", "value": "npm" } }
            ]
        });
        let AppliesSpec::Declarative(AppliesNode::Any(children)) =
            parse_applies_spec(Some(&spec)).expect("валідний предикат")
        else {
            panic!("очікувався декларативний `any`");
        };
        assert_eq!(children.len(), 3);
        assert_eq!(children[0], AppliesNode::PathExists("npm".to_owned()));
    }

    #[test]
    fn rejects_node_with_two_operators() {
        let spec = json!({ "pathExists": "npm", "any": [{ "pathExists": "x" }] });
        assert!(parse_applies_spec(Some(&spec)).is_err());
    }

    #[test]
    fn rejects_unknown_operator() {
        let spec = json!({ "fileContains": "npm" });
        let error = parse_applies_spec(Some(&spec)).expect_err("невідомий оператор має падати");
        assert!(error.to_string().contains("fileContains"), "{error}");
    }

    #[test]
    fn rejects_empty_any_and_empty_glob() {
        assert!(parse_applies_spec(Some(&json!({ "any": [] }))).is_err());
        assert!(parse_applies_spec(Some(&json!({ "globMatches": { "glob": [] } }))).is_err());
    }

    #[test]
    fn dynamic_literal_and_absent_field() {
        assert_eq!(parse_applies_spec(None).unwrap(), AppliesSpec::Always);
        assert_eq!(
            parse_applies_spec(Some(&json!("dynamic"))).unwrap(),
            AppliesSpec::Dynamic
        );
    }

    #[test]
    fn path_exists_covers_files_and_directories() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("npm")).unwrap();
        touch(tmp.path(), "pyproject.toml");
        assert!(evaluate_applies(
            &AppliesNode::PathExists("npm".to_owned()),
            tmp.path()
        ));
        assert!(evaluate_applies(
            &AppliesNode::PathExists("pyproject.toml".to_owned()),
            tmp.path()
        ));
        assert!(!evaluate_applies(
            &AppliesNode::PathExists("Cargo.toml".to_owned()),
            tmp.path()
        ));
    }

    /// Ключова звірка глоб-канону: `**/Cargo.toml` мусить матчити файл У
    /// КОРЕНІ, інакше декларативний гейт `rust` тихо втратив би гілку
    /// `existsSync(cwd/Cargo.toml)` старого JS.
    #[test]
    fn glob_matches_root_level_file() {
        let tmp = TempDir::new().unwrap();
        touch(tmp.path(), "Cargo.toml");
        assert!(evaluate_applies(&rust_gate(), tmp.path()));
    }

    #[test]
    fn glob_matches_nested_file() {
        let tmp = TempDir::new().unwrap();
        touch(tmp.path(), "crates/rules-core/Cargo.toml");
        assert!(evaluate_applies(&rust_gate(), tmp.path()));
    }

    /// Ризик, названий у §5 мінідизайну: без ignore-списку правило `rust`
    /// вмикалося б у чужих worktree й `vendor/`.
    #[test]
    fn glob_skips_ignored_directories() {
        for ignored in [".worktrees", "node_modules", "target", "vendor", ".claude"] {
            let tmp = TempDir::new().unwrap();
            touch(tmp.path(), &format!("{ignored}/copy/Cargo.toml"));
            assert!(
                !evaluate_applies(&rust_gate(), tmp.path()),
                "каталог {ignored} мав бути пропущений"
            );
        }
    }

    #[test]
    fn glob_ignores_directory_named_like_the_pattern() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("Cargo.toml")).unwrap();
        assert!(
            !evaluate_applies(&rust_gate(), tmp.path()),
            "каталог з іменем Cargo.toml — не маніфест (дзеркало `entry.isFile()` у JS)"
        );
    }

    #[test]
    fn json_field_contains_matches_only_arrays_of_strings() {
        let tmp = TempDir::new().unwrap();
        let node = AppliesNode::JsonFieldContains {
            file: "package.json".to_owned(),
            field: "workspaces".to_owned(),
            value: "npm".to_owned(),
        };
        assert!(!evaluate_applies(&node, tmp.path()), "файлу немає → false");

        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"workspaces":["run/*"]}"#,
        )
        .unwrap();
        assert!(!evaluate_applies(&node, tmp.path()));

        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"workspaces":["run/*","npm"]}"#,
        )
        .unwrap();
        assert!(evaluate_applies(&node, tmp.path()));

        // Об'єктна форма workspaces (`{ packages: [...] }`) масивом не є —
        // JS-канон робив рівно ту саму перевірку `Array.isArray`.
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"workspaces":{"packages":["npm"]}}"#,
        )
        .unwrap();
        assert!(!evaluate_applies(&node, tmp.path()));

        std::fs::write(tmp.path().join("package.json"), "{ битий json").unwrap();
        assert!(
            !evaluate_applies(&node, tmp.path()),
            "битий JSON → false, не паніка"
        );
    }

    #[test]
    fn json_field_contains_walks_dotted_path() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("package.json"), r#"{"a":{"b":["x"]}}"#).unwrap();
        let node = AppliesNode::JsonFieldContains {
            file: "package.json".to_owned(),
            field: "a.b".to_owned(),
            value: "x".to_owned(),
        };
        assert!(evaluate_applies(&node, tmp.path()));
    }

    #[test]
    fn any_is_a_disjunction() {
        let tmp = TempDir::new().unwrap();
        touch(tmp.path(), ".github/workflows/npm-publish.yml");
        let node = AppliesNode::Any(vec![
            AppliesNode::PathExists("npm".to_owned()),
            AppliesNode::PathExists(".github/workflows/npm-publish.yml".to_owned()),
        ]);
        assert!(evaluate_applies(&node, tmp.path()));
    }

    #[test]
    fn read_rule_applies_treats_legacy_js_gate_as_dynamic() {
        let tmp = TempDir::new().unwrap();
        let rule = tmp.path().join("legacy");
        std::fs::create_dir_all(rule.join("applies")).unwrap();
        std::fs::write(
            rule.join("applies").join("main.mjs"),
            "export function applies() {}",
        )
        .unwrap();
        std::fs::write(rule.join("main.json"), r#"{ "auto": "завжди" }"#).unwrap();
        assert_eq!(read_rule_applies(&rule).unwrap(), AppliesSpec::Dynamic);
        assert!(
            rule_applies(&rule, tmp.path()).is_err(),
            "dynamic → делегація"
        );
    }

    #[test]
    fn read_rule_applies_without_gate_is_always() {
        let tmp = TempDir::new().unwrap();
        let rule = tmp.path().join("plain");
        std::fs::create_dir_all(&rule).unwrap();
        std::fs::write(rule.join("main.json"), r#"{ "auto": "завжди" }"#).unwrap();
        assert_eq!(read_rule_applies(&rule).unwrap(), AppliesSpec::Always);
        assert!(rule_applies(&rule, tmp.path()).unwrap());
    }

    #[test]
    fn read_rule_applies_reads_declarative_field() {
        let tmp = TempDir::new().unwrap();
        let rule = tmp.path().join("python");
        std::fs::create_dir_all(&rule).unwrap();
        std::fs::write(
            rule.join("main.json"),
            r#"{ "auto": { "glob": "**/pyproject.toml" }, "applies": { "pathExists": "pyproject.toml" } }"#,
        )
        .unwrap();
        assert!(!rule_applies(&rule, tmp.path()).unwrap());
        touch(tmp.path(), "pyproject.toml");
        assert!(rule_applies(&rule, tmp.path()).unwrap());
    }

    #[test]
    fn broken_applies_field_is_an_error_not_a_silent_skip() {
        let tmp = TempDir::new().unwrap();
        let rule = tmp.path().join("broken");
        std::fs::create_dir_all(&rule).unwrap();
        std::fs::write(rule.join("main.json"), r#"{ "applies": { "nope": 1 } }"#).unwrap();
        assert!(read_rule_applies(&rule).is_err());
    }
}
