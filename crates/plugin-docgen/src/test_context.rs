//! Порт `npm/rules/doc-files/docgen-test-context/main.mjs` (212 рядків) —
//! індекс test-evidence (які тести покривають джерело).
//!
//! # Рішення: диск чи параметр
//! JS-оригінал сам обходить дерево (`collectTestFiles` → `readdirSync`) і
//! читає вміст кожного test/spec-файлу (`readFileSync`). Той самий мотив, що
//! `crate::crc` (доккомент там): жодного консюмера, який реально покликав би
//! `n-rules:caps/file-reader@1.0.0` для цього ще нема (`docgen-stage`
//! диспетчер — майбутня робота), тож підключати world заради непідключеного
//! коду суперечило б принципу «не вигадувати потребу». [`build_test_evidence_index`]
//! тому приймає вже прочитані `(relPath, content)`-пари ЯК ПАРАМЕТР — обхід
//! дерева й читання лишаються обов'язком викликача (майбутній консюмер
//! підставить сюди результат `file-reader::list-files` + `read-file-bytes`
//! без переписування самого індексування).
//!
//! `resolveRelativeReference` (`main.mjs:65-81`) у JS теж чіпає диск
//! (`existsSync`/`statSync`) для вибору, який із кандидатних шляхів
//! (з розширенням, без розширення, `index.*`) реально існує. Порт розділяє
//! це на дві частини: [`candidate_paths_for_reference`] — чиста генерація
//! списку кандидатів (порт `resolveRelativeReference` без файлового I/O), і
//! [`resolve_relative_reference`] — вибір ПЕРШОГО кандидата, що є у
//! наборі `existing` (параметр — той самий набір «уже відомих файлів», що
//! викликач мав би отримати від `file-reader::list-files`).

use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

fn js_test_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\.(?:test|spec)\.(?:[cm]?[jt]sx?)$").expect("JS_TEST_RE"))
}

fn relative_literal_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(['"])(\.{1,2}/[^'"\n]+)['"]"#).expect("RELATIVE_LITERAL_RE"))
}

fn scenario_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"\b(describe|test|it)\s*\(\s*['"`]([^'"`\n]{1,200})['"`]"#)
            .expect("SCENARIO_RE")
    })
}

/// Джерельні розширення, які можуть бути referenced-файлом — порт
/// `SOURCE_EXTENSIONS` (`main.mjs:13`).
const SOURCE_EXTENSIONS: &[&str] = &[
    ".mjs", ".cjs", ".js", ".jsx", ".ts", ".tsx", ".vue", ".py", ".rs",
];

/// Чи шлях має форму окремого test/spec-файлу — порт `isDocgenTestFile`
/// (`main.mjs:22-25`).
pub fn is_docgen_test_file(file_name: &str) -> bool {
    let python_test = file_name.ends_with(".py")
        && (file_name.starts_with("test_") || file_name.ends_with("_test.py"));
    js_test_re().is_match(file_name) || python_test
}

fn extname(path: &str) -> &str {
    match path
        .rsplit_once('/')
        .map(|(_, f)| f)
        .unwrap_or(path)
        .rfind('.')
    {
        Some(i) => {
            let base = path.rsplit_once('/').map(|(_, f)| f).unwrap_or(path);
            &base[i..]
        }
        None => "",
    }
}

fn basename_no_ext(path: &str) -> &str {
    let base = path.rsplit_once('/').map(|(_, f)| f).unwrap_or(path);
    match base.rfind('.') {
        Some(i) if i > 0 => &base[..i],
        _ => base,
    }
}

fn dirname(path: &str) -> &str {
    match path.rsplit_once('/') {
        Some((d, _)) => d,
        None => "",
    }
}

/// Резолвить `posix`-абсолютний-подібний шлях зі сегментів `.`/`..` —
/// достатньо для repo-relative шляхів (немає drive letters/symlinks у
/// цьому контексті).
fn normalize_posix(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => continue,
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    out.join("/")
}

/// Резолвить relative specifier відносно директорії тесту у repo-relative
/// шлях — та сама `resolve(dirname(testAbs), clean)` операція
/// (`main.mjs:67`), тут над repo-relative шляхами замість абсолютних.
fn resolve_relative(test_rel: &str, specifier: &str) -> String {
    let dir = dirname(test_rel);
    let joined = if dir.is_empty() {
        specifier.to_string()
    } else {
        format!("{dir}/{specifier}")
    };
    normalize_posix(&joined)
}

/// Кандидатні repo-relative шляхи для relative specifier-а з test-файлу —
/// чиста частина `resolveRelativeReference` (доккомент модуля): explicit
/// extension, import без розширення (перебір [`SOURCE_EXTENSIONS`]),
/// directory index (`index.*`).
pub fn candidate_paths_for_reference(test_rel_path: &str, specifier: &str) -> Vec<String> {
    let clean = specifier.split(['?', '#']).next().unwrap_or(specifier);
    let base = resolve_relative(test_rel_path, clean);
    let mut candidates = vec![base.clone()];
    if extname(&base).is_empty() {
        for ext in SOURCE_EXTENSIONS {
            candidates.push(format!("{base}{ext}"));
        }
        for ext in SOURCE_EXTENSIONS {
            candidates.push(format!("{base}/index{ext}"));
        }
    }
    candidates
}

/// Перший кандидат, наявний у `existing` — порт вибору `existsSync`+`statSync`
/// у `resolveRelativeReference` (`main.mjs:73-79`), тут над параметром-набором
/// (доккомент модуля).
pub fn resolve_relative_reference(
    test_rel_path: &str,
    specifier: &str,
    existing: &HashSet<String>,
) -> Option<String> {
    candidate_paths_for_reference(test_rel_path, specifier)
        .into_iter()
        .find(|c| existing.contains(c))
}

/// Referenced-файли з relative string literal-ів test-файлу — порт
/// `referencedFiles` (`main.mjs:91-98`).
pub fn referenced_files(
    test_rel_path: &str,
    content: &str,
    existing: &HashSet<String>,
) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for caps in relative_literal_re().captures_iter(content) {
        let specifier = caps.get(2).expect("group 2").as_str();
        if let Some(r) = resolve_relative_reference(test_rel_path, specifier, existing) {
            if seen.insert(r.clone()) {
                out.push(r);
            }
        }
    }
    out
}

/// Відсіює helper imports — порт `isLikelyTestSubject` (`main.mjs:108-116`).
pub fn is_likely_test_subject(test_rel_path: &str, source_rel_path: &str) -> bool {
    let test_stem = basename_no_ext(test_rel_path);
    let test_stem = test_stem
        .strip_suffix(".test")
        .or_else(|| test_stem.strip_suffix(".spec"))
        .unwrap_or(test_stem);
    let source_stem = basename_no_ext(source_rel_path);
    if test_stem == source_stem {
        return true;
    }
    if source_stem != "main" && source_stem != "index" {
        return false;
    }
    let source_dir = dirname(source_rel_path);
    let source_dir_base = source_dir.rsplit('/').next().unwrap_or(source_dir);
    let test_rel = pseudo_relative(source_dir, test_rel_path);
    test_stem == source_dir_base || test_rel.starts_with("tests/")
}

/// Спрощений `path.relative(from, to)` над repo-relative posix-шляхами —
/// достатній для перевірки префікса `tests/` (`main.mjs:114-115`).
fn pseudo_relative(from_dir: &str, to_path: &str) -> String {
    let from_segs: Vec<&str> = from_dir.split('/').filter(|s| !s.is_empty()).collect();
    let to_segs: Vec<&str> = to_path.split('/').filter(|s| !s.is_empty()).collect();
    let mut i = 0;
    while i < from_segs.len() && i < to_segs.len() && from_segs[i] == to_segs[i] {
        i += 1;
    }
    let ups = from_segs.len() - i;
    let mut parts: Vec<String> = std::iter::repeat_n("..".to_string(), ups).collect();
    parts.extend(to_segs[i..].iter().map(|s| s.to_string()));
    parts.join("/")
}

/// Один test-файл з уже прочитаним вмістом — вхід [`build_test_evidence_index`]
/// (доккомент модуля: "дані приходять параметром").
#[derive(Debug, Clone)]
pub struct TestFileInput {
    pub rel_path: String,
    pub content: String,
}

/// Один пов'язаний test-файл у `bySource` — структурний відповідник елемента
/// масиву JS `bySource.get(...)` (`main.mjs:140`).
#[derive(Debug, Clone)]
pub struct LinkedTest {
    pub rel_path: String,
    pub content: String,
}

/// Source↔tests index — структурний відповідник обʼєкта `buildTestEvidenceIndex`
/// (`main.mjs:124-145`), без `root`/`absPath` (repo-relative шляхи достатні
/// поза Node `fs`-контекстом).
#[derive(Debug, Clone, Default)]
pub struct TestEvidenceIndex {
    pub by_source: HashMap<String, Vec<LinkedTest>>,
    pub by_test: HashMap<String, Vec<String>>,
}

/// Будує source↔tests index — порт `buildTestEvidenceIndex` (`main.mjs:124-145`),
/// над параметром `tests` замість обходу диска (доккомент модуля).
/// `existing` — повний набір repo-relative шляхів, що реально існують
/// (для резолву relative literal-ів на реальні файли).
pub fn build_test_evidence_index(
    tests: &[TestFileInput],
    existing: &HashSet<String>,
) -> TestEvidenceIndex {
    let mut by_source: HashMap<String, Vec<LinkedTest>> = HashMap::new();
    let mut by_test: HashMap<String, Vec<String>> = HashMap::new();
    for t in tests {
        let sources: Vec<String> = referenced_files(&t.rel_path, &t.content, existing)
            .into_iter()
            .filter(|s| is_likely_test_subject(&t.rel_path, s))
            .collect();
        by_test.insert(t.rel_path.clone(), sources.clone());
        for source in sources {
            by_source.entry(source).or_default().push(LinkedTest {
                rel_path: t.rel_path.clone(),
                content: t.content.clone(),
            });
        }
    }
    TestEvidenceIndex { by_source, by_test }
}

/// Назви `describe`/`test`/`it` — порт `scenarioNames` (`main.mjs:154-164`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScenarioNames {
    pub groups: Vec<String>,
    pub scenarios: Vec<String>,
}

fn dedup_preserve_order(items: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|x| seen.insert(x.clone()))
        .collect()
}

pub fn scenario_names(content: &str) -> ScenarioNames {
    let mut groups = Vec::new();
    let mut scenarios = Vec::new();
    for caps in scenario_re().captures_iter(content) {
        let kind = caps.get(1).expect("group 1").as_str();
        let title = caps.get(2).expect("group 2").as_str().trim();
        if title.is_empty() {
            continue;
        }
        if kind == "describe" {
            groups.push(title.to_string());
        } else {
            scenarios.push(title.to_string());
        }
    }
    ScenarioNames {
        groups: dedup_preserve_order(groups),
        scenarios: dedup_preserve_order(scenarios),
    }
}

/// Дані для рендеру сценаріїв і детермінований CRC-payload — структурний
/// відповідник `testEvidenceForSource` (`main.mjs:173-180`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TestFileScenarios {
    pub path: String,
    pub groups: Vec<String>,
    pub scenarios: Vec<String>,
}

/// Формує дані для рендеру сценаріїв і CRC payload — порт `testEvidenceForSource`
/// (`main.mjs:173-180`).
pub fn test_evidence_for_source(
    source_rel_path: &str,
    index: &TestEvidenceIndex,
) -> (Vec<TestFileScenarios>, String) {
    let Some(tests) = index.by_source.get(source_rel_path) else {
        return (Vec::new(), String::new());
    };
    if tests.is_empty() {
        return (Vec::new(), String::new());
    }
    let files: Vec<TestFileScenarios> = tests
        .iter()
        .map(|t| {
            let sc = scenario_names(&t.content);
            TestFileScenarios {
                path: t.rel_path.clone(),
                groups: sc.groups,
                scenarios: sc.scenarios,
            }
        })
        .collect();
    let crc_payload: String = tests
        .iter()
        .map(|t| format!("\0{}\0{}", t.rel_path, t.content))
        .collect();
    (files, crc_payload)
}

/// Детерміновано рендерить підтверджені тестами сценарії у Markdown —
/// порт `renderTestScenarios` (`main.mjs:190-202`).
pub fn render_test_scenarios(files: &[TestFileScenarios]) -> String {
    files
        .iter()
        .filter(|t| !t.scenarios.is_empty())
        .map(|t| {
            let groups = t
                .groups
                .iter()
                .take(2)
                .cloned()
                .collect::<Vec<_>>()
                .join("; ");
            let examples = t
                .scenarios
                .iter()
                .take(5)
                .cloned()
                .collect::<Vec<_>>()
                .join("; ");
            let rest = t.scenarios.len() as i64 - 5;
            let scope = if groups.is_empty() {
                String::new()
            } else {
                format!(" ({groups})")
            };
            let more = if rest > 0 {
                format!("; ще {rest}")
            } else {
                String::new()
            };
            format!("- `{}`{scope} — {examples}{more}", t.path)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Source-файли, на які посилається конкретний test-файл — порт
/// `sourceFilesForTest` (`main.mjs:210-212`).
pub fn source_files_for_test(test_rel_path: &str, index: &TestEvidenceIndex) -> Vec<String> {
    index
        .by_test
        .get(test_rel_path)
        .cloned()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_docgen_test_file_matches_js_and_python() {
        assert!(is_docgen_test_file("main.test.mjs"));
        assert!(is_docgen_test_file("foo.spec.ts"));
        assert!(is_docgen_test_file("test_bar.py"));
        assert!(is_docgen_test_file("bar_test.py"));
        assert!(!is_docgen_test_file("main.mjs"));
        assert!(!is_docgen_test_file("bar.py"));
    }

    #[test]
    fn candidate_paths_include_extensions_and_index() {
        let candidates =
            candidate_paths_for_reference("docgen-scan/tests/main.test.mjs", "../main");
        assert!(candidates.contains(&"docgen-scan/main.mjs".to_string()));
        assert!(candidates.contains(&"docgen-scan/main/index.mjs".to_string()));
    }

    #[test]
    fn resolve_relative_reference_picks_first_existing_candidate() {
        let existing: HashSet<String> = ["docgen-scan/main.mjs".to_string()].into_iter().collect();
        let resolved =
            resolve_relative_reference("docgen-scan/tests/main.test.mjs", "../main", &existing);
        assert_eq!(resolved, Some("docgen-scan/main.mjs".to_string()));
    }

    #[test]
    fn resolve_relative_reference_none_when_nothing_exists() {
        let existing: HashSet<String> = HashSet::new();
        assert_eq!(
            resolve_relative_reference("a/tests/x.test.mjs", "../missing", &existing),
            None
        );
    }

    #[test]
    fn is_likely_test_subject_matches_by_stem() {
        assert!(is_likely_test_subject(
            "docgen-scan/tests/main.test.mjs",
            "docgen-scan/main.mjs"
        ));
        assert!(!is_likely_test_subject(
            "docgen-scan/tests/main.test.mjs",
            "docgen-scan/other.mjs"
        ));
    }

    #[test]
    fn is_likely_test_subject_allows_index_via_dir_name_or_tests_prefix() {
        assert!(is_likely_test_subject(
            "docgen-scan/tests/docgen-scan.test.mjs",
            "docgen-scan/main.mjs"
        ));
    }

    #[test]
    fn build_test_evidence_index_links_referenced_source() {
        let existing: HashSet<String> = ["docgen-scan/main.mjs".to_string()].into_iter().collect();
        let tests = vec![TestFileInput {
            rel_path: "docgen-scan/tests/main.test.mjs".to_string(),
            content:
                "import { scanForDocFiles } from '../main.mjs'\ntest('finds files', () => {})\n"
                    .to_string(),
        }];
        let index = build_test_evidence_index(&tests, &existing);
        assert!(index.by_source.contains_key("docgen-scan/main.mjs"));
        let (files, payload) = test_evidence_for_source("docgen-scan/main.mjs", &index);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].scenarios, vec!["finds files".to_string()]);
        assert!(!payload.is_empty());
    }

    #[test]
    fn test_evidence_for_source_empty_when_unreferenced() {
        let index = TestEvidenceIndex::default();
        let (files, payload) = test_evidence_for_source("nope.mjs", &index);
        assert!(files.is_empty());
        assert_eq!(payload, "");
    }

    #[test]
    fn scenario_names_splits_groups_and_scenarios() {
        let content = "describe('group A', () => {\n  test('does x', () => {})\n  it('does y', () => {})\n})\n";
        let sc = scenario_names(content);
        assert_eq!(sc.groups, vec!["group A".to_string()]);
        assert_eq!(
            sc.scenarios,
            vec!["does x".to_string(), "does y".to_string()]
        );
    }

    #[test]
    fn render_test_scenarios_shows_up_to_five_and_counts_rest() {
        let files = vec![TestFileScenarios {
            path: "a.test.mjs".to_string(),
            groups: vec!["G".to_string()],
            scenarios: (1..=7).map(|i| format!("case {i}")).collect(),
        }];
        let out = render_test_scenarios(&files);
        assert!(out.contains("case 1"));
        assert!(out.contains("case 5"));
        assert!(!out.contains("case 6"));
        assert!(out.contains("ще 2"));
    }

    #[test]
    fn render_test_scenarios_skips_files_without_scenarios() {
        let files = vec![TestFileScenarios {
            path: "a.test.mjs".to_string(),
            groups: vec![],
            scenarios: vec![],
        }];
        assert_eq!(render_test_scenarios(&files), "");
    }
}
