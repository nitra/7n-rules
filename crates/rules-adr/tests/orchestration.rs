//! cspell:ignore Оркестраційні existuyucha funkciya драфтовий
//! Оркестраційні тести batch-хвиль `normalize_pipeline` — дзеркало
//! `npm/scripts/lib/adr/tests/normalize-pipeline-orchestration.test.mjs`
//! сценарій-у-сценарій: інжектований submit відповідає за префіксом
//! `customId` (`dd:`/`dc:`/`kind:`/`gen:`/`merge:`), рахує хвилі й items.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use llm_lib::attempt::BoxFuture;
use rules_adr::cascade::{SubmitBatchFn, WaveItem, WaveResult};
use rules_adr::pipeline::{normalize_pipeline, Draft, Operation, PipelineOpts};

/// Форми хвиль фейкового submit-а: (model, к-сть items).
type WaveShapes = Arc<Mutex<Vec<(String, usize)>>>;

/// Фейковий submit: (лічильник хвиль, форми хвиль, відповіді за префіксом).
fn fake_submit(
    respond: impl Fn(&str, &str) -> Result<String, String> + Send + Sync + 'static,
) -> (SubmitBatchFn, Arc<AtomicUsize>, WaveShapes) {
    let calls = Arc::new(AtomicUsize::new(0));
    let waves = Arc::new(Mutex::new(Vec::new()));
    let (calls_out, waves_out) = (Arc::clone(&calls), Arc::clone(&waves));
    let respond = Arc::new(respond);
    let submit: SubmitBatchFn = Arc::new(move |model: String, items: Vec<WaveItem>| {
        calls.fetch_add(1, Ordering::SeqCst);
        waves.lock().unwrap().push((model.clone(), items.len()));
        let respond = Arc::clone(&respond);
        let fut: BoxFuture<'static, Result<Vec<WaveResult>, String>> = Box::pin(async move {
            Ok(items
                .into_iter()
                .map(|item| WaveResult {
                    outcome: respond(&model, &item.custom_id),
                    custom_id: item.custom_id,
                })
                .collect())
        });
        fut
    });
    (submit, calls_out, waves_out)
}

fn by_prefix(
    responders: Vec<(&'static str, &'static str)>,
) -> impl Fn(&str, &str) -> Result<String, String> + Send + Sync + 'static {
    move |_model, custom_id| {
        let prefix = custom_id.split(':').next().unwrap_or("");
        responders
            .iter()
            .find(|(p, _)| *p == prefix)
            .map(|(_, reply)| (*reply).to_string())
            .ok_or_else(|| format!("no responder for {custom_id}"))
    }
}

fn draft(file: &str, title: &str, body: &str) -> Draft {
    Draft {
        file: format!("260101-1200-{file}"),
        body: format!("## ADR {title}\n\n{body}"),
    }
}

fn opts(submit: SubmitBatchFn, allow_cloud: bool) -> PipelineOpts {
    PipelineOpts {
        allow_cloud,
        votes: 2,
        tier1: "x/tier1".to_string(),
        tier2: "x/tier2".to_string(),
        submit,
        on_progress: Box::new(|_| {}),
    }
}

const KIND_STANDALONE: &str = r#"{"kind":"standalone","reason":"real decision"}"#;
const GEN_OK: &str = r#"{"context":"Проблема X.","options":["A","B"],"chosen":"B","rationale":"простіше","good":["менше коду"],"bad":[],"more":"file.mjs"}"#;
const EDGE_SAME: &str = r#"{"same":true,"confidence":0.9,"reason":"дублікат"}"#;
const EDGE_DIFFERENT: &str = r#"{"same":false,"confidence":0.9,"reason":"різні теми"}"#;
const MERGE_OK: &str = "Додатковий контекст щодо Y.";
const DECIDED: &str = "## Decision Outcome\nChosen option: \"X\", because Y.";

#[tokio::test]
async fn lone_standalone_draft_uses_exactly_two_waves() {
    let drafts = vec![draft("a.md", "Рішення А", DECIDED)];
    let (submit, calls, _) =
        fake_submit(by_prefix(vec![("kind", KIND_STANDALONE), ("gen", GEN_OK)]));

    let out = normalize_pipeline(&drafts, &[], &opts(submit, false)).await;

    assert_eq!(calls.load(Ordering::SeqCst), 2, "kind-хвиля + gen-хвиля");
    assert_eq!(out.operations.len(), 1);
    match &out.operations[0] {
        Operation::Rewrite { file, content, .. } => {
            assert_eq!(file, &drafts[0].file);
            assert!(content.contains("Chosen option: \"B\", because простіше."));
        }
        other => panic!("очікували rewrite: {other:?}"),
    }
    assert_eq!(out.stats.failures, 0);
    assert_eq!(out.stats.madr_invalid, 0);
}

#[tokio::test]
async fn no_decision_gate_deletes_without_any_llm_call() {
    let drafts = vec![draft(
        "a.md",
        "Незавершене",
        "## Decision Outcome\nне обрано, сесія обірвалась.",
    )];
    let (submit, calls, _) = fake_submit(|_, _| Err("не мав викликатись".into()));

    let out = normalize_pipeline(&drafts, &[], &opts(submit, false)).await;

    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        out.operations,
        vec![Operation::Delete {
            file: drafts[0].file.clone(),
            reason: "рішення не прийняте (transcript обірвався)".to_string(),
        }]
    );
}

#[tokio::test]
async fn duplicate_drafts_cluster_longest_body_becomes_anchor() {
    let drafts = vec![
        draft("a.md", "Спільна тема одна", DECIDED),
        draft(
            "b.md",
            "Спільна тема одна доповнена ще довшим текстом",
            &format!("{DECIDED}\n\nдодатковий контекст для довшого тіла"),
        ),
    ];
    let (submit, _, _) = fake_submit(by_prefix(vec![
        ("dd", EDGE_SAME),
        ("gen", GEN_OK),
        ("merge", MERGE_OK),
    ]));

    let out = normalize_pipeline(&drafts, &[], &opts(submit, false)).await;

    let rewrite = out.operations.iter().find_map(|o| match o {
        Operation::Rewrite { file, .. } => Some(file.clone()),
        _ => None,
    });
    let merge = out.operations.iter().find_map(|o| match o {
        Operation::MergeInto {
            file, additions, ..
        } => Some((file.clone(), additions.clone())),
        _ => None,
    });
    assert_eq!(
        rewrite.as_deref(),
        Some(drafts[1].file.as_str()),
        "довший body — anchor"
    );
    let (merge_file, additions) = merge.expect("merge-into присутній");
    assert_eq!(merge_file, drafts[0].file);
    assert!(additions.contains(MERGE_OK));
}

#[tokio::test]
async fn different_drafts_stay_standalone() {
    let drafts = vec![
        draft("a.md", "Спільна тема одна", DECIDED),
        draft(
            "b.md",
            "Спільна тема одна варіант",
            &format!("{DECIDED}\n\nінший контент"),
        ),
    ];
    let (submit, _, _) = fake_submit(by_prefix(vec![
        ("dd", EDGE_DIFFERENT),
        ("kind", KIND_STANDALONE),
        ("gen", GEN_OK),
    ]));

    let out = normalize_pipeline(&drafts, &[], &opts(submit, false)).await;

    let rewrites = out
        .operations
        .iter()
        .filter(|o| matches!(o, Operation::Rewrite { .. }))
        .count();
    assert_eq!(rewrites, 2);
}

#[tokio::test]
async fn confirmed_clean_match_merges_into_existing_without_gen() {
    let drafts = vec![draft("a.md", "існуюча функція normalize", DECIDED)];
    let clean = vec!["260101-0000-existuyucha-funkciya-normalize.md".to_string()];
    let (submit, _, _) = fake_submit(by_prefix(vec![("dc", EDGE_SAME), ("merge", MERGE_OK)]));

    let out = normalize_pipeline(&drafts, &clean, &opts(submit, false)).await;

    assert_eq!(out.operations.len(), 1);
    match &out.operations[0] {
        Operation::MergeInto {
            file,
            target,
            additions,
        } => {
            assert_eq!(file, &drafts[0].file);
            assert_eq!(target, &clean[0]);
            assert!(additions.contains(MERGE_OK));
        }
        other => panic!("очікували merge-into: {other:?}"),
    }
}

#[tokio::test]
async fn tier1_failure_with_cloud_escalates_and_saves_the_verdict() {
    let drafts = vec![draft("a.md", "Рішення А", DECIDED)];
    let (submit, calls, waves) = fake_submit(|model, custom_id| {
        if model == "x/tier1" {
            return Err("tier1 down".into());
        }
        Ok(if custom_id.starts_with("kind") {
            KIND_STANDALONE.to_string()
        } else {
            GEN_OK.to_string()
        })
    });

    let out = normalize_pipeline(&drafts, &[], &opts(submit, true)).await;

    assert!(
        calls.load(Ordering::SeqCst) > 2,
        "kind: t1+t2, gen: t1+t2; хвилі: {:?}",
        waves.lock().unwrap()
    );
    assert_eq!(out.operations.len(), 1);
    assert!(matches!(out.operations[0], Operation::Rewrite { .. }));
    assert!(out.stats.escalations > 0);
}

#[tokio::test]
async fn without_cloud_opt_in_tier2_is_never_called() {
    let drafts = vec![draft("a.md", "Рішення А", DECIDED)];
    let (submit, _, waves) = fake_submit(|model, _| {
        assert_eq!(model, "x/tier1", "tier2 не мав викликатись");
        Err("tier1 down".into())
    });

    let out = normalize_pipeline(&drafts, &[], &opts(submit, false)).await;

    // kind fallback → standalone → rewrite; gen fallback → gen-failed → нуль ops.
    assert!(out.operations.is_empty());
    assert!(waves.lock().unwrap().iter().all(|(m, _)| m == "x/tier1"));
}

#[tokio::test]
async fn gen_failure_drops_the_draft_and_counts_invalid() {
    let drafts = vec![draft("a.md", "Рішення А", DECIDED)];
    let (submit, _, _) = fake_submit(|_, custom_id| {
        if custom_id.starts_with("kind") {
            Ok(KIND_STANDALONE.to_string())
        } else {
            Err("both tiers down".into())
        }
    });

    let out = normalize_pipeline(&drafts, &[], &opts(submit, false)).await;

    assert!(out.operations.is_empty());
    assert_eq!(out.stats.madr_invalid, 1);
}

#[tokio::test]
async fn merge_failure_falls_back_to_canonical_head() {
    let drafts = vec![draft("a.md", "existing normalize topic", DECIDED)];
    let clean = vec!["260101-0000-existing-normalize-topic.md".to_string()];
    let (submit, _, _) = fake_submit(|_, custom_id| {
        if custom_id.starts_with("dc") {
            Ok(EDGE_SAME.to_string())
        } else {
            Err("both tiers down".into())
        }
    });

    let out = normalize_pipeline(&drafts, &clean, &opts(submit, false)).await;

    match &out.operations[0] {
        Operation::MergeInto { additions, .. } => {
            assert!(additions.contains("доповнення з чернетки"));
            assert!(additions.starts_with("## Update 2026-01-01"));
        }
        other => panic!("очікували merge-into: {other:?}"),
    }
}

/// 5 незалежних драфтів — kind-хвиля і gen-хвиля РІВНО по одному виклику з
/// 5 items кожна (батчинг, не по-драфтовий цикл).
#[tokio::test]
async fn five_independent_drafts_batch_into_single_waves() {
    let topics = [
        "кавове обладнання перевірка",
        "мережевий протокол оновлення",
        "графічний рендер оптимізація",
        "файлова система міграція",
        "аудіо кодек стиснення",
    ];
    let drafts: Vec<Draft> = topics
        .iter()
        .enumerate()
        .map(|(i, topic)| draft(&format!("d{i}.md"), topic, DECIDED))
        .collect();
    let (submit, calls, waves) =
        fake_submit(by_prefix(vec![("kind", KIND_STANDALONE), ("gen", GEN_OK)]));

    let out = normalize_pipeline(&drafts, &[], &opts(submit, false)).await;

    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "{:?}",
        waves.lock().unwrap()
    );
    let shapes = waves.lock().unwrap().clone();
    assert_eq!(shapes[0].1, 5, "kind-хвиля: 5 items");
    assert_eq!(shapes[1].1, 5, "gen-хвиля: 5 items");
    assert_eq!(out.operations.len(), 5);
}

/// Контракт JSON операцій — поле в поле як у JS (`{"operations": [...]}`).
#[test]
fn operations_serialize_to_the_bash_contract() {
    let ops = vec![
        Operation::Rewrite {
            file: "a.md".into(),
            slug: "тема".into(),
            content: "…".into(),
        },
        Operation::Delete {
            file: "b.md".into(),
            reason: "чому".into(),
        },
        Operation::MergeInto {
            file: "c.md".into(),
            target: "t.md".into(),
            additions: "## Update…".into(),
        },
    ];
    let json = serde_json::to_value(&ops).unwrap();
    assert_eq!(
        json,
        serde_json::json!([
            {"op":"rewrite","file":"a.md","slug":"тема","content":"…"},
            {"op":"delete","file":"b.md","reason":"чому"},
            {"op":"merge-into","file":"c.md","target":"t.md","additions":"## Update…"}
        ])
    );
}
