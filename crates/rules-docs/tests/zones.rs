//! Дзеркальний набір зон — сценарій-у-сценарій із `tests/zones.test.mjs`,
//! плюс звірка розбору та запису з живим JS (`fixtures/js-topics.json`).

use std::collections::BTreeMap;

use rules_docs::zones::{
    apply_autogen_updates, assert_protected_zones_preserved, parse_knowledge_zones, zone_hash,
};
use serde_json::Value;

const FIXTURES: &str = include_str!("fixtures/js-topics.json");

fn generated(content: &str) -> String {
    format!(
        "<!-- AUTOGEN:start id=\"summary\" hash=\"{}\" -->{content}<!-- AUTOGEN:end id=\"summary\" -->",
        zone_hash(content)
    )
}

fn codes(diagnostics: Vec<rules_docs::zones::Diagnostic>) -> Vec<String> {
    diagnostics.into_iter().map(|item| item.code).collect()
}

#[test]
fn paired_markers_parse_and_the_autogen_hash_is_verified() {
    let doc = format!(
        "# Title\n{}\n<!-- EXPECTED:start id=\"expect-save\" -->must save<!-- EXPECTED:end id=\"expect-save\" -->",
        generated("old")
    );
    let parsed = parse_knowledge_zones(&doc, Some("docs/index.md")).expect("документ валідний");
    assert_eq!(parsed.zones.len(), 2);

    // Правка всередині AUTOGEN без перерахунку хеша — саме те, що хеш і
    // мусить ловити.
    let edited = doc.replace("old", "edited");
    assert_eq!(
        codes(
            parse_knowledge_zones(&edited, Some("docs/index.md")).expect_err("хеш не збігається")
        ),
        vec!["zone-hash-mismatch".to_string()]
    );
}

#[test]
fn unpaired_markers_and_duplicate_ids_are_rejected() {
    assert_eq!(
        codes(
            parse_knowledge_zones("<!-- MANUAL:start id=\"same\" -->x", Some("docs/x.md"))
                .expect_err("зона не закрита")
        ),
        vec!["unclosed-zone".to_string()]
    );
    let duplicated = "<!-- MANUAL:start id=\"same\" -->x<!-- MANUAL:end id=\"same\" --><!-- EXPECTED:start id=\"same\" -->y<!-- EXPECTED:end id=\"same\" -->";
    assert_eq!(
        codes(parse_knowledge_zones(duplicated, None).expect_err("id повторився")),
        vec!["duplicate-zone-id".to_string()]
    );
}

/// Маркер із поламаним id і маркер невідомого виду мусять СТАТИ помилкою, а
/// не мовчки лишитись коментарем: інакше зона просто зникла б із захисту.
#[test]
fn malformed_and_unsupported_markers_fail_closed() {
    assert_eq!(
        codes(
            parse_knowledge_zones("<!-- AUTOGEN:start id=\"Not-Stable\" -->", None)
                .expect_err("id не стабільний")
        ),
        vec!["invalid-zone-marker".to_string()]
    );
    assert_eq!(
        codes(
            parse_knowledge_zones("<!-- MERGED:start id=\"legacy\" -->", None)
                .expect_err("вид не підтримується")
        ),
        vec!["unsupported-zone-kind".to_string()]
    );
}

#[test]
fn only_autogen_content_is_written_and_protected_zones_survive() {
    let doc = format!(
        "{}<!-- MANUAL:start id=\"note\" -->keep<!-- MANUAL:end id=\"note\" -->",
        generated("old")
    );
    let updates = BTreeMap::from([("summary".to_string(), "new".to_string())]);
    let updated = apply_autogen_updates(&doc, &updates, None).expect("AUTOGEN записується");
    assert!(updated.contains("keep"), "MANUAL лишається недоторканим");
    assert!(updated.contains("new"));
    assert_eq!(
        updated,
        FIXTURES_UPDATED.with(|value| value.clone()),
        "результат запису збігається з JS побайтово"
    );

    let into_protected = BTreeMap::from([("note".to_string(), "replace".to_string())]);
    assert_eq!(
        codes(apply_autogen_updates(&doc, &into_protected, None).expect_err("MANUAL не пишеться")),
        vec!["protected-zone-write".to_string()]
    );
}

thread_local! {
    /// Очікуваний документ після запису — з фікстури живого JS.
    static FIXTURES_UPDATED: String = {
        let fixtures: Value = serde_json::from_str(FIXTURES).expect("фікстура — JSON");
        fixtures["zones"]["updated"]["markdown"]
            .as_str()
            .expect("markdown у фікстурі")
            .to_string()
    };
}

/// Зміни поза явними зонами так само блокують, як зміни в захищеній зоні:
/// авторський текст між зонами нічим не гірший за текст усередині.
#[test]
fn manual_and_implicit_manual_modifications_are_detected() {
    let previous = format!(
        "prefix{}<!-- EXPECTED:start id=\"e\" -->expected<!-- EXPECTED:end id=\"e\" -->suffix",
        generated("old")
    );
    let candidate = format!(
        "changed{}<!-- EXPECTED:start id=\"e\" -->changed<!-- EXPECTED:end id=\"e\" -->suffix",
        generated("new")
    );
    let reported = codes(
        assert_protected_zones_preserved(&previous, &candidate, None)
            .expect_err("кандидат зачепив захищене"),
    );
    for code in ["protected-zone-modified", "implicit-manual-modified"] {
        assert!(
            reported.iter().any(|item| item == code),
            "очікувався код {code}, було: {reported:?}"
        );
    }
}

/// Звірка розбору з живим JS: види, id, хеші та вміст зон, а також текст
/// поза зонами.
#[test]
fn the_parsed_document_matches_the_js_parser() {
    let fixtures: Value = serde_json::from_str(FIXTURES).expect("фікстура — JSON");
    let expected = &fixtures["zones"]["parsed"];
    let doc = format!(
        "# Title\n{}\n<!-- EXPECTED:start id=\"expect-save\" -->must save<!-- EXPECTED:end id=\"expect-save\" -->",
        generated("old")
    );
    let parsed = parse_knowledge_zones(&doc, Some("docs/index.md")).expect("документ валідний");

    let expected_zones = expected["zones"].as_array().expect("зони у фікстурі");
    assert_eq!(parsed.zones.len(), expected_zones.len());
    for (zone, reference) in parsed.zones.iter().zip(expected_zones) {
        assert_eq!(zone.kind, reference["kind"].as_str().unwrap_or_default());
        assert_eq!(zone.id, reference["id"].as_str().unwrap_or_default());
        assert_eq!(
            zone.content,
            reference["content"].as_str().unwrap_or_default()
        );
        assert_eq!(
            zone.hash.as_deref(),
            reference["hash"].as_str(),
            "хеш зони {} розійшовся",
            zone.id
        );
    }
    let expected_manual: Vec<&str> = expected["implicitManual"]
        .as_array()
        .expect("implicitManual у фікстурі")
        .iter()
        .map(|item| item.as_str().unwrap_or_default())
        .collect();
    assert_eq!(parsed.implicit_manual, expected_manual);
}
