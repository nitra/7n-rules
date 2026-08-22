//! Дзеркальний набір публікації — сценарій-у-сценарій із
//! `tests/publish.test.mjs`.
//!
//! Тут перевіряється не стільки вихід функції, скільки СТАН ДЕРЕВА після
//! невдачі: кожен провальний шлях мусить лишити закомічені `docs/` і
//! manifest побайтово тими самими. Часткова публікація гірша за жодну —
//! напівоновлена документація виглядає як цілісна.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rules_docs::publish::{publish_knowledge_artifacts, PublishOutcome, ValidationOutcome};
use rules_docs::zones::zone_hash;

/// Тимчасовий корінь домену для одного сценарію.
fn temp_root(label: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "rules-docs-publish-{}-{label}-{unique}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("корінь створюється");
    root
}

fn auto(content: &str, id: &str) -> String {
    format!(
        "<!-- AUTOGEN:start id=\"{id}\" hash=\"{}\" -->{content}<!-- AUTOGEN:end id=\"{id}\" -->",
        zone_hash(content)
    )
}

fn knowledge_manifest() -> String {
    serde_json::json!({
        "schemaVersion": 1,
        "domain": {"id": "npm:@fixture/orders"},
        "nodes": [],
        "topics": []
    })
    .to_string()
}

fn write(root: &Path, relative: &str, content: &str) {
    let target = root.join(relative);
    std::fs::create_dir_all(target.parent().expect("є батьківська тека")).expect("тека");
    std::fs::write(target, content).expect("запис фікстури");
}

fn read(root: &Path, relative: &str) -> String {
    std::fs::read_to_string(root.join(relative)).expect("файл читається")
}

/// Закомічене дерево перед публікацією — той самий `seed`, що в JS.
fn seed(root: &Path) {
    write(
        root,
        "docs/index.md",
        &format!(
            "intro{}<!-- MANUAL:start id=\"note\" -->keep<!-- MANUAL:end id=\"note\" -->",
            auto("old", "summary")
        ),
    );
    write(root, "docs/.docgen/manifest.json", "{\"old\":true}\n");
}

fn passing() -> impl Fn(&BTreeMap<String, String>) -> ValidationOutcome {
    |_| ValidationOutcome::Passed
}

fn codes(outcome: PublishOutcome) -> Vec<String> {
    match outcome {
        PublishOutcome::Blocked(diagnostics) => {
            diagnostics.into_iter().map(|item| item.code).collect()
        }
        PublishOutcome::Published => panic!("очікувався блокер"),
    }
}

fn manifest_only(content: &str) -> BTreeMap<String, String> {
    BTreeMap::from([(
        "docs/.docgen/manifest.json".to_string(),
        content.to_string(),
    )])
}

#[test]
fn invalid_requests_are_rejected_before_touching_the_filesystem() {
    assert_eq!(
        codes(publish_knowledge_artifacts(
            Path::new("relative"),
            &manifest_only("{}"),
            &passing()
        )),
        vec!["invalid-domain-root".to_string()]
    );

    let root = temp_root("invalid");
    assert_eq!(
        codes(publish_knowledge_artifacts(
            &root,
            &BTreeMap::new(),
            &passing()
        )),
        vec!["missing-manifest".to_string()]
    );

    let mut escaping = manifest_only("{}");
    escaping.insert("../outside.md".to_string(), "no".to_string());
    assert_eq!(
        codes(publish_knowledge_artifacts(&root, &escaping, &passing())),
        vec!["invalid-candidate-file".to_string()],
        "шлях поза docs/ не публікується навіть із валідним manifest"
    );
    assert!(
        !root.join("docs").exists(),
        "жодна з відмов не створює дерева"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Валідатор, що впав, — це окремий код: він вказує на дефект ГЕЙТА, а не
/// документації.
#[test]
fn a_validator_exception_becomes_a_blocking_diagnostic() {
    let root = temp_root("threw");
    let outcome = publish_knowledge_artifacts(&root, &manifest_only("{}"), &|_| {
        ValidationOutcome::Threw("validator crash".to_string())
    });
    match outcome {
        PublishOutcome::Blocked(diagnostics) => {
            assert_eq!(diagnostics.len(), 1);
            assert_eq!(diagnostics[0].code, "caller-validation-threw");
            assert_eq!(diagnostics[0].detail, "validator crash");
        }
        PublishOutcome::Published => panic!("очікувався блокер"),
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_failed_validation_leaves_docs_and_manifest_byte_identical() {
    let root = temp_root("failed");
    seed(&root);
    let before = read(&root, "docs/index.md");

    let files = BTreeMap::from([
        (
            "docs/index.md".to_string(),
            format!(
                "intro{}<!-- MANUAL:start id=\"note\" -->keep<!-- MANUAL:end id=\"note\" -->",
                auto("new", "summary")
            ),
        ),
        (
            "docs/.docgen/manifest.json".to_string(),
            "{\"new\":true}\n".to_string(),
        ),
    ]);
    let outcome = publish_knowledge_artifacts(&root, &files, &|_| {
        ValidationOutcome::Failed(vec![rules_docs::publish::Diagnostic {
            code: "gate".to_string(),
            detail: "не пройшло".to_string(),
            path: None,
        }])
    });

    assert_eq!(codes(outcome), vec!["gate".to_string()]);
    assert_eq!(read(&root, "docs/index.md"), before);
    assert_eq!(
        read(&root, "docs/.docgen/manifest.json"),
        "{\"old\":true}\n"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn publication_goes_through_the_stage_and_preserves_protected_zones() {
    let root = temp_root("publish");
    seed(&root);
    let files = BTreeMap::from([
        (
            "docs/index.md".to_string(),
            format!(
                "intro{}<!-- MANUAL:start id=\"note\" -->keep<!-- MANUAL:end id=\"note\" -->",
                auto("new", "summary")
            ),
        ),
        (
            "docs/.docgen/manifest.json".to_string(),
            "{\"new\":true}\n".to_string(),
        ),
    ]);

    assert!(matches!(
        publish_knowledge_artifacts(&root, &files, &passing()),
        PublishOutcome::Published
    ));
    let index = read(&root, "docs/index.md");
    assert!(index.contains("new"));
    assert!(index.contains("keep"), "MANUAL пережив публікацію");
    assert_eq!(
        read(&root, "docs/.docgen/manifest.json"),
        "{\"new\":true}\n"
    );
    // Тимчасові каталоги не лишаються поруч із доменом.
    let leftovers: Vec<String> = std::fs::read_dir(&root)
        .expect("корінь читається")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(".package-knowledge-"))
        .collect();
    assert!(leftovers.is_empty(), "залишились: {leftovers:?}");
    let _ = std::fs::remove_dir_all(&root);
}

/// Конфлікт захищеної зони зупиняє публікацію ДО заміни дерева.
#[test]
fn a_protected_zone_conflict_aborts_before_replacing_committed_docs() {
    let root = temp_root("conflict");
    seed(&root);
    let files = BTreeMap::from([
        (
            "docs/index.md".to_string(),
            format!(
                "intro{}<!-- MANUAL:start id=\"note\" -->changed<!-- MANUAL:end id=\"note\" -->",
                auto("new", "summary")
            ),
        ),
        (
            "docs/.docgen/manifest.json".to_string(),
            "{\"new\":true}\n".to_string(),
        ),
    ]);

    assert_eq!(
        codes(publish_knowledge_artifacts(&root, &files, &passing())),
        vec!["protected-zone-modified".to_string()]
    );
    assert!(
        read(&root, "docs/index.md").contains("keep"),
        "закомічений MANUAL недоторканий"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn markers_of_a_brand_new_artifact_are_validated() {
    let root = temp_root("new-artifact");
    let broken = BTreeMap::from([
        (
            "docs/index.md".to_string(),
            "<!-- AUTOGEN:start id=\"summary\" -->broken".to_string(),
        ),
        ("docs/.docgen/manifest.json".to_string(), "{}".to_string()),
    ]);
    assert!(matches!(
        publish_knowledge_artifacts(&root, &broken, &passing()),
        PublishOutcome::Blocked(_)
    ));
    assert!(
        !root.join("docs").exists(),
        "зламаний кандидат не публікується"
    );

    let valid = BTreeMap::from([
        ("docs/index.md".to_string(), auto("new", "summary")),
        (
            "docs/.docgen/manifest.json".to_string(),
            "{\"new\":true}\n".to_string(),
        ),
    ]);
    assert!(matches!(
        publish_knowledge_artifacts(&root, &valid, &passing()),
        PublishOutcome::Published
    ));
    assert!(read(&root, "docs/index.md").contains("new"));
    let _ = std::fs::remove_dir_all(&root);
}

/// Застаріла НАША сторінка прибирається, успадкована документація — ні.
#[test]
fn stale_generated_pages_are_removed_while_legacy_docs_survive() {
    let root = temp_root("stale");
    write(&root, "docs/.docgen/manifest.json", &knowledge_manifest());
    write(
        &root,
        "docs/explanation/processes/aaaaaaaaaaaaaaaaaaaaaaaa.md",
        &auto("obsolete process", "process-aaaaaaaaaaaaaaaaaaaaaaaa"),
    );
    write(&root, "docs/legacy.md", "legacy file documentation\n");

    let files = BTreeMap::from([
        (
            "docs/.docgen/manifest.json".to_string(),
            knowledge_manifest(),
        ),
        ("docs/index.md".to_string(), auto("fresh", "package-index")),
    ]);
    assert!(matches!(
        publish_knowledge_artifacts(&root, &files, &passing()),
        PublishOutcome::Published
    ));
    assert!(
        !root
            .join("docs/explanation/processes/aaaaaaaaaaaaaaaaaaaaaaaa.md")
            .exists(),
        "застаріла згенерована сторінка прибрана"
    );
    assert_eq!(
        read(&root, "docs/legacy.md"),
        "legacy file documentation\n",
        "успадкована документація під docs/ не наша — і лишається"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Авторський вміст у застарілій сторінці — привід ЗУПИНИТИСЬ, а не
/// видалити.
#[test]
fn stale_removal_with_protected_content_blocks_and_leaves_the_tree_intact() {
    let root = temp_root("stale-protected");
    let stale_path = "docs/explanation/processes/bbbbbbbbbbbbbbbbbbbbbbbb.md";
    let stale = format!(
        "{}<!-- MANUAL:start id=\"migration\" -->keep<!-- MANUAL:end id=\"migration\" -->",
        auto("obsolete process", "process-bbbbbbbbbbbbbbbbbbbbbbbb")
    );
    write(&root, "docs/.docgen/manifest.json", &knowledge_manifest());
    write(&root, stale_path, &stale);

    let files = BTreeMap::from([
        (
            "docs/.docgen/manifest.json".to_string(),
            knowledge_manifest(),
        ),
        ("docs/index.md".to_string(), auto("fresh", "package-index")),
    ]);
    assert_eq!(
        codes(publish_knowledge_artifacts(&root, &files, &passing())),
        vec!["stale-generated-protected".to_string()]
    );
    assert_eq!(read(&root, stale_path), stale);
    assert_eq!(
        read(&root, "docs/.docgen/manifest.json"),
        knowledge_manifest()
    );
    assert!(
        !root.join("docs/index.md").exists(),
        "нова сторінка теж не зʼявилась — транзакція не почалась"
    );
    let _ = std::fs::remove_dir_all(&root);
}
