//! cspell:ignore Оркестраційні existuyucha funkciya драфтовий
//! Оркестраційні тести batch-хвиль `normalize_pipeline` — дзеркало
//! `npm/scripts/lib/adr/tests/normalize-pipeline-orchestration.test.mjs`
//! сценарій-у-сценарій: інжектований submit відповідає за префіксом
//! `customId` (`dd:`/`dc:`/`kind:`/`gen:`/`merge:`), рахує хвилі й items.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use llm_lib::attempt::BoxFuture;
use rules_adr::cascade::{SubmitBatchFn, WaveItem, WaveResult};
use rules_adr::pipeline::{normalize_pipeline, Draft, Operation, PipelineOpts};

/// Форми хвиль фейкового submit-а: (model, к-сть items).
type WaveShapes = Arc<Mutex<Vec<(String, usize)>>>;

/// Фейковий submit: (лічильник хвиль, форми хвиль, відповіді за префіксом).
fn fake_submit(
    respond: impl Fn(&str, &str) -> Result<String, String> + Send + Sync + 'static,
) -> (SubmitBatchFn, Arc<AtomicUsize>, WaveShapes) {
    let (submit, calls, waves, _) = fake_submit_observing_chain(respond);
    (submit, calls, waves)
}

/// Той самий фейк плюс `chainId`, який побачила КОЖНА хвиля — так тест
/// перевіряє наскрізність ланцюжка, не заглядаючи у файли trace.
fn fake_submit_observing_chain(
    respond: impl Fn(&str, &str) -> Result<String, String> + Send + Sync + 'static,
) -> (
    SubmitBatchFn,
    Arc<AtomicUsize>,
    WaveShapes,
    Arc<Mutex<Vec<String>>>,
) {
    let calls = Arc::new(AtomicUsize::new(0));
    let waves = Arc::new(Mutex::new(Vec::new()));
    let chain_ids = Arc::new(Mutex::new(Vec::new()));
    let (calls_out, waves_out) = (Arc::clone(&calls), Arc::clone(&waves));
    let chain_ids_out = Arc::clone(&chain_ids);
    let respond = Arc::new(respond);
    let submit: SubmitBatchFn = Arc::new(move |model: String, items: Vec<WaveItem>, chain| {
        calls.fetch_add(1, Ordering::SeqCst);
        waves.lock().unwrap().push((model.clone(), items.len()));
        let respond = Arc::clone(&respond);
        let chain_ids = Arc::clone(&chain_ids);
        let fut: BoxFuture<'static, Result<Vec<WaveResult>, String>> = Box::pin(async move {
            let id = chain.lock().await.id().to_string();
            chain_ids.lock().unwrap().push(id);
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
    (submit, calls_out, waves_out, chain_ids_out)
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

/// Trace-корінь тестового бінарника: `normalize_pipeline` пише підсумковий
/// рядок ланцюжка НА КОЖЕН прогін, тож без цього кожен тест забруднював би
/// `~/.n-llm-lib` користувача.
///
/// Один корінь на процес (не на тест) свідомо: `N_LLM_TRACE_DIR` —
/// ПРОЦЕСНА змінна, а тести бінарника йдуть паралельно, тож
/// per-тестовий каталог був би гонкою (той, хто виставив останнім, вирішує
/// за всіх). Замість ізоляції каталогом тести фільтрують рядки за власним
/// `chainId` — він унікальний за побудовою, і сусідній прогін у тому самому
/// файлі їм не заважає.
fn isolate_trace_dir() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("rules-adr-trace-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("тимчасовий trace-корінь створюється");
        std::env::set_var("N_LLM_TRACE_DIR", &dir);
        dir
    })
    .clone()
}

/// Рядки trace із коренем [`isolate_trace_dir`], що належать саме цьому
/// ланцюжку.
fn chain_rows(chain_id: &str) -> Vec<serde_json::Value> {
    let dir = isolate_trace_dir();
    let mut rows = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("trace-корінь читається") {
        let path = entry.expect("запис теки").path();
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let row: serde_json::Value = serde_json::from_str(line).expect("рядок trace — JSON");
            if row.get("chainId").and_then(serde_json::Value::as_str) == Some(chain_id) {
                rows.push(row);
            }
        }
    }
    rows
}

fn opts(submit: SubmitBatchFn, allow_cloud: bool) -> PipelineOpts {
    isolate_trace_dir();
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

// ── ланцюжок прогону (chain-API `n7n-llm-lib 0.4`) ──────────────────────────────

/// Головне, заради чого chain-API взагалі протягнуто в конвеєр: прогін із
/// кількох хвиль — ОДНА задача для аналітики, а не по задачі на хвилю.
/// Перевіряємо на боці виконавця хвилі (він і є той, хто передає ланцюжок у
/// `dispatch`), а не за файлом trace: фейковий submit нічого не диспатчить.
#[tokio::test]
async fn every_wave_of_a_run_sees_the_same_chain() {
    // Два драфти з підтвердженим ребром → kind + gen + merge-хвилі.
    let drafts = vec![
        draft("a.md", "Рішення А", DECIDED),
        draft("b.md", "Рішення А уточнення", DECIDED),
    ];
    let (submit, calls, _, chain_ids) = fake_submit_observing_chain(by_prefix(vec![
        ("dd", EDGE_SAME),
        ("kind", KIND_STANDALONE),
        ("gen", GEN_OK),
        ("merge", MERGE_OK),
    ]));

    normalize_pipeline(&drafts, &[], &opts(submit, false)).await;

    let ids = chain_ids.lock().unwrap().clone();
    assert!(
        ids.len() >= 2,
        "прогін мав кілька хвиль, було {}",
        ids.len()
    );
    assert_eq!(
        ids.len(),
        calls.load(Ordering::SeqCst),
        "ланцюжок бачить КОЖНА хвиля, не лише перша"
    );
    assert_eq!(
        ids.iter().collect::<std::collections::HashSet<_>>().len(),
        1,
        "усі хвилі прогону — під одним chainId, було: {ids:?}"
    );
    assert!(!ids[0].is_empty(), "chainId не порожній");
}

/// Підсумковий рядок — рівно ОДИН на прогін, із порт-у-порт JS-змістом
/// (`kind`/`unit`/`outcome`/`extra`). Два рядки на один `chainId`
/// порахувались би аналітикою як дві задачі.
#[tokio::test]
async fn a_successful_run_closes_the_chain_with_exactly_one_summary_row() {
    let drafts = vec![draft("a.md", "Рішення А", DECIDED)];
    let (submit, _, _, chain_ids) =
        fake_submit_observing_chain(by_prefix(vec![("kind", KIND_STANDALONE), ("gen", GEN_OK)]));

    let out = normalize_pipeline(&drafts, &[], &opts(submit, false)).await;

    let chain_id = chain_ids.lock().unwrap()[0].clone();
    let rows = chain_rows(&chain_id);
    let summaries: Vec<_> = rows
        .iter()
        .filter(|r| r["kind"] == "chain")
        .cloned()
        .collect();
    assert_eq!(summaries.len(), 1, "рівно один агрегатний рядок: {rows:?}");

    let row = &summaries[0];
    assert_eq!(row["chainKind"], "adr-normalize");
    assert_eq!(row["unit"], "batch:1", "одиниця роботи — розмір батчу");
    assert_eq!(row["outcome"], "success");
    assert_eq!(row["extra"]["drafts"], 1);
    assert_eq!(row["extra"]["ops"], out.operations.len());
    assert_eq!(
        row["extra"]["stats"]["madrInvalid"], 0,
        "лічильники в extra — камелкейсом JS, не snake_case"
    );
}

/// Провалені items (жоден тир не відповів) — це `partial`, не `fail`:
/// conservative fallback стадії все одно дав операції, задача зроблена
/// частково. Дослівне JS-правило.
#[tokio::test]
async fn a_run_with_failures_closes_the_chain_as_partial() {
    let drafts = vec![draft("a.md", "Рішення А", DECIDED)];
    // kind-хвиля відповідає, gen-хвиля — ні: gen-стадія провалює item.
    let (submit, _, _, chain_ids) =
        fake_submit_observing_chain(by_prefix(vec![("kind", KIND_STANDALONE)]));

    let out = normalize_pipeline(&drafts, &[], &opts(submit, false)).await;
    assert!(out.stats.failures > 0, "сценарій має дати провал item-а");

    let chain_id = chain_ids.lock().unwrap()[0].clone();
    let row = chain_rows(&chain_id)
        .into_iter()
        .find(|r| r["kind"] == "chain")
        .expect("агрегатний рядок написано і на частковому результаті");
    assert_eq!(row["outcome"], "partial");
    assert_eq!(row["extra"]["stats"]["failures"], out.stats.failures);
}
