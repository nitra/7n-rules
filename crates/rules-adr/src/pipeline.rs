//! cspell:ignore madrs харденінг
//! Оркестратор конвеєра — порт `normalizePipelineCore` з чотирма
//! LLM-стадіями (edge-judge, kind-judge, gen-MADR, gen-merge) і чистою
//! JS-логікою між ними (retrieval, union-find кластеризація, вибір anchor,
//! призначення op). Принцип збережений дослівно: модель НІКОЛИ не приймає
//! глобальних рішень і не форматує — повертає лише вузький verifiable зміст.

use std::collections::HashMap;
use std::sync::Arc;

use crate::cascade::{extract_json, keyed_cascade, CascadeCfg, ChainRef, Stats, WaveItem};
use crate::madr::{assemble_madr, madr_date, normalize_sections, slugify, validate_madr};
use crate::retrieval::{build_edges, capture_field, draft_title, is_no_decision, strip_adr_name};

/// Одна чернетка на вході конвеєра.
#[derive(Debug, Clone)]
pub struct Draft {
    /// Basename файлу чернетки.
    pub file: String,
    /// Повне тіло.
    pub body: String,
}

/// Операція apply-контракту — той самий JSON, що друкував JS
/// (`{"operations": [...]}`, поля й імена op дослівно).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Operation {
    Rewrite {
        file: String,
        slug: String,
        content: String,
    },
    Delete {
        file: String,
        reason: String,
    },
    MergeInto {
        file: String,
        target: String,
        additions: String,
    },
}

/// Діагностичний trace прогону (порт `trace` — друкується у stderr CLI).
#[derive(Debug, Clone, serde::Serialize)]
pub struct Trace {
    pub titles: Vec<String>,
    pub clusters: Vec<Vec<String>>,
    pub clean_targets: Vec<(String, String)>,
    pub decisions: Vec<(String, String)>,
}

/// Підсумок конвеєра.
#[derive(Debug)]
pub struct PipelineOutput {
    pub operations: Vec<Operation>,
    pub stats: Stats,
    pub trace: Trace,
}

/// Опції прогону — порт `opts` (`tier1`/`tier2` обов'язкові тут: резолв від
/// env робить CLI-шар, конвеєр env не читає — тестованість без спільних env-локів).
pub struct PipelineOpts {
    pub allow_cloud: bool,
    pub votes: usize,
    pub tier1: String,
    pub tier2: String,
    pub submit: crate::cascade::SubmitBatchFn,
    pub on_progress: Box<dyn Fn(&str) + Send + Sync>,
}

// ── системні промпти стадій: побайтові порти EDGE_SYS/KIND_SYS/GEN_SYS/MERGE_SYS ──

const EDGE_SYS: &str = r#"Ти порівнюєш два короткі записи архітектурних рішень (ADR). Визнач, чи вони описують ОДНЕ І ТЕ САМЕ рішення (одну тему/механізм, де другий лише уточнює/доповнює/продовжує перший), чи це РІЗНІ незалежні рішення.

Поверни ЛИШЕ JSON, без markdown:
{ "same": true|false, "confidence": 0..1, "reason": "<коротко українською>" }

same=true ЛИШЕ якщо це по суті одне рішення (дублікат, уточнення, продовження тієї самої теми). Різні аспекти однієї підсистеми, але окремі рішення → same=false. Якщо сумніваєшся — false."#;

const KIND_SYS: &str = r#"Ти оцінюєш чернетку архітектурного рішення (ADR). Визнач:
- "standalone" — це самостійне рішення, варте збереження як decision record.
- "trivial" — порожня / тривіальна / косметична / без реального рішення, можна видалити.

Поверни ЛИШЕ JSON: { "kind": "standalone"|"trivial", "reason": "<коротко українською>" }
Якщо сумніваєшся — "standalone" (краще зберегти)."#;

const GEN_SYS: &str = r#"Ти витягуєш зміст архітектурного рішення з чернетки ADR у JSON. Нічого не вигадуй — бери лише те, що є в чернетці.

{
  "context": "<2-4 речення: проблема й контекст рішення>",
  "options": ["<розглянутий варіант>", "..."],
  "chosen": "<обраний варіант, коротко>",
  "rationale": "<чому обрано саме його>",
  "good": ["<позитивний наслідок>", "..."],
  "bad": ["<негативний наслідок>", "..."],
  "more": "<файли/команди/API; можна кілька рядків і bullets>"
}

ВАЖЛИВО про значення полів:
- Зберігай inline-форматування: backticks навколо `шляхів`, `назв.функцій()`, `команд` — це частина змісту, не прибирай їх.
- НЕ додавай markdown-ЗАГОЛОВКИ (рядки з ##) і не пиши сам каркас (Status, Date, назви секцій) — лише зміст.
- Якщо чогось нема в чернетці — порожній рядок "" або порожній масив [].

Поверни ЛИШЕ JSON, без code-fence, без передмови."#;

const MERGE_SYS: &str = "Ти готуєш короткий додаток до існуючого ADR. Напиши ЛИШЕ новий зміст (проза/bullets), якого ще НЕМА в цільовому ADR — уточнення/виправлення/продовження. Стисло, українською, без заголовків, без code-fence, без передмови.";

// ── валідація вузьких LLM-відповідей: порти zod-схем ───────────────────────────

/// Порт `EdgeSchema`: `{same: bool, confidence: 0..1, reason: 3..400}`.
fn parse_edge_vote(raw: &str) -> Result<(bool, f64), String> {
    let v = extract_json(raw)?;
    let same = v
        .get("same")
        .and_then(serde_json::Value::as_bool)
        .ok_or("same не bool")?;
    let confidence = v
        .get("confidence")
        .and_then(serde_json::Value::as_f64)
        .filter(|c| (0.0..=1.0).contains(c))
        .ok_or("confidence поза [0,1]")?;
    let reason_len = v
        .get("reason")
        .and_then(serde_json::Value::as_str)
        .map(|r| r.chars().count())
        .ok_or("reason не рядок")?;
    if !(3..=400).contains(&reason_len) {
        return Err("reason поза 3..400".to_string());
    }
    Ok((same, confidence))
}

/// Порт `KindSchema`: `{kind: standalone|trivial, reason: 3..400}`.
fn parse_kind(raw: &str) -> Result<(String, String), String> {
    let v = extract_json(raw)?;
    let kind = v
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .filter(|k| *k == "standalone" || *k == "trivial")
        .ok_or("kind поза enum")?
        .to_string();
    let reason = v
        .get("reason")
        .and_then(serde_json::Value::as_str)
        .filter(|r| (3..=400).contains(&r.chars().count()))
        .ok_or("reason поза 3..400")?
        .to_string();
    Ok((kind, reason))
}

/// Обрізка тіла до N символів — JS `.slice(0, n)` рахує UTF-16-одиниці;
/// для нашого контенту (BMP, без сурогатів) `chars().take(n)` еквівалентно.
fn clip(body: &str, n: usize) -> String {
    body.chars().take(n).collect()
}

/// Прибирає code-fence-обгортку з LLM-відповіді — порт `stripFence`.
fn strip_fence(raw: &str) -> String {
    let re_open = regex::Regex::new(r"(?i)^\s*```[a-z]*\s*\n?").expect("regex");
    let re_close = regex::Regex::new(r"(?i)\n?```\s*$").expect("regex");
    let opened = re_open.replace(raw, "");
    re_close.replace(&opened, "").trim().to_string()
}

// ── union-find ──────────────────────────────────────────────────────────────────

struct Dsu(Vec<usize>);

impl Dsu {
    fn new(n: usize) -> Self {
        Dsu((0..n).collect())
    }
    fn find(&mut self, x: usize) -> usize {
        if self.0[x] != x {
            let root = self.find(self.0[x]);
            self.0[x] = root;
        }
        self.0[x]
    }
    fn union(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        self.0[ra] = rb;
    }
}

// ── рішення по драфту між стадіями ─────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
enum Decision {
    Rewrite,
    MergeAnchor { anchor_idx: usize },
    MergeExisting { target: String },
    Delete { reason: String },
    Kind,
    GenFailed,
}

impl Decision {
    fn label(&self) -> &'static str {
        match self {
            Decision::Rewrite => "rewrite",
            Decision::MergeAnchor { .. } => "merge-anchor",
            Decision::MergeExisting { .. } => "merge-existing",
            Decision::Delete { .. } => "delete",
            Decision::Kind => "kind",
            Decision::GenFailed => "gen-failed",
        }
    }
}

/// `chainKind` прогону — дослівно як у JS (`kind: 'adr-normalize'`): за цим
/// рядком аналітика ланцюжків відрізняє задачу нормалізації ADR від решти
/// писемників, тож він контрактний, а не описовий.
const CHAIN_KIND: &str = "adr-normalize";

/// Головний конвеєр — порт обгортки `normalizePipeline`: заводить ланцюжок
/// прогону, віддає тіло [`normalize_pipeline_core`] і закриває ланцюжок
/// підсумковим рядком.
///
/// Один ланцюжок на ВЕСЬ прогін (не на хвилю): batch-хвилі не мають
/// per-item-гранулярності, а стадій чотири — розділені ланцюжки показували б
/// одну задачу як чотири незалежні. Це та сама свідома девіація реєстру
/// (§5.0.3), яку знімає chain-API `n7n-llm-lib 0.4`: тепер і per-item рядки
/// хвиль ідуть під цим самим `chainId` (через [`crate::cascade::ChainRef`] у
/// конфізі каскаду), чого JS-оригінал не вмів.
///
/// `outcome` — порт JS-правила дослівно: `partial`, якщо є провалені items
/// або невалідний MADR, інакше `success`. Третього стану JS досягав через
/// `catch` (виняток → `fail`); тут тіло конвеєра не повертає `Result` і не
/// має шляху виходу з помилкою — усі провали вже пораховані в `stats` і
/// закриті conservative fallback-ами стадій, тож `fail` недосяжний за
/// побудовою, а не забутий.
pub async fn normalize_pipeline(
    drafts: &[Draft],
    clean_list: &[String],
    opts: &PipelineOpts,
) -> PipelineOutput {
    let mut start = trace::ChainStart::new(CHAIN_KIND, format!("batch:{}", drafts.len()));
    if let Ok(cwd) = std::env::current_dir() {
        start = start.with_cwd(cwd.to_string_lossy().into_owned());
    }
    let chain: ChainRef = Arc::new(tokio::sync::Mutex::new(trace::ChainHandle::start(start)));

    let out = normalize_pipeline_core(drafts, clean_list, opts, &chain).await;

    let outcome = if out.stats.failures > 0 || out.stats.madr_invalid > 0 {
        trace::ChainOutcome::Partial
    } else {
        trace::ChainOutcome::Success
    };
    chain.lock().await.end(
        outcome,
        serde_json::json!({
            "drafts": drafts.len(),
            "ops": out.operations.len(),
            "stats": out.stats,
        }),
    );
    out
}

/// Тіло конвеєра — порт `normalizePipelineCore` (ланцюжок належить обгортці
/// [`normalize_pipeline`], сюди приходить уже заведеним).
async fn normalize_pipeline_core(
    drafts: &[Draft],
    clean_list: &[String],
    opts: &PipelineOpts,
    chain: &ChainRef,
) -> PipelineOutput {
    let log = &opts.on_progress;
    let mut stats = Stats::default();
    let cfg = CascadeCfg {
        tier1: opts.tier1.clone(),
        tier2: opts.tier2.clone(),
        allow_cloud: opts.allow_cloud,
        submit: Arc::clone(&opts.submit),
        chain: Arc::clone(chain),
    };

    let titles: Vec<String> = drafts
        .iter()
        .map(|d| {
            let t = draft_title(&d.body);
            if t.is_empty() {
                d.file.trim_end_matches(".md").to_string()
            } else {
                t
            }
        })
        .collect();
    let captured: Vec<Option<String>> = drafts
        .iter()
        .map(|d| capture_field(&d.body, "captured"))
        .collect();

    // Гейт-харденінг #1: детермінований no-decision гейт.
    let no_dec: Vec<bool> = drafts.iter().map(|d| is_no_decision(&d.body)).collect();
    if no_dec.iter().any(|&b| b) {
        log(&format!(
            "no-decision гейт: {} драфт(ів) → delete",
            no_dec.iter().filter(|&&b| b).count()
        ));
    }

    // Stage 0: retrieval (ребра, що торкаються no-decision драфтів, відкидаємо).
    let pairs: Vec<(String, String)> = drafts
        .iter()
        .map(|d| (d.file.clone(), d.body.clone()))
        .collect();
    let edges = build_edges(&pairs, clean_list);
    let dd: Vec<(usize, usize)> = edges
        .dd
        .into_iter()
        .filter(|&(i, j)| !no_dec[i] && !no_dec[j])
        .collect();
    let dc: Vec<(usize, String)> = edges.dc.into_iter().filter(|&(i, _)| !no_dec[i]).collect();
    log(&format!(
        "retrieval: {} draft-draft ребер, {} draft-clean кандидатів",
        dd.len(),
        dc.len()
    ));

    // Stage 1: одна хвиля на ВСІ ребра (усі self-consistency голоси разом).
    let (dd_same, clean_target) =
        judge_edges(&dd, &dc, drafts, &titles, opts.votes, &cfg, &mut stats).await;
    let mut dsu = Dsu::new(drafts.len());
    let mut confirmed_dd = 0;
    for &(i, j) in &dd {
        if dd_same
            .get(&format!("dd:{i}:{j}"))
            .copied()
            .unwrap_or(false)
        {
            dsu.union(i, j);
            confirmed_dd += 1;
        }
    }
    log(&format!(
        "edge-judge: {confirmed_dd}/{} draft-draft ребер підтверджено",
        dd.len()
    ));
    log(&format!(
        "clean-match: {} драфтів вже покриті clean-ADR",
        clean_target.iter().filter(|c| c.is_some()).count()
    ));

    // Cluster (JS-логіка): групування за DSU у порядку першої появи кореня.
    let mut clusters: Vec<(usize, Vec<usize>)> = Vec::new();
    let mut cluster_index: HashMap<usize, usize> = HashMap::new();
    for i in 0..drafts.len() {
        let root = dsu.find(i);
        match cluster_index.get(&root) {
            Some(&pos) => clusters[pos].1.push(i),
            None => {
                cluster_index.insert(root, clusters.len());
                clusters.push((root, vec![i]));
            }
        }
    }

    let mut decision: Vec<Option<Decision>> = vec![None; drafts.len()];
    let mut operations: Vec<Operation> = Vec::new();

    for (_, members) in &clusters {
        if members.len() > 1 {
            // anchor — лише серед non-noDec; найдовше тіло, при рівності —
            // перший зустрінутий (порт reduce-еквівалента).
            let live: Vec<usize> = members.iter().copied().filter(|&m| !no_dec[m]).collect();
            let candidates = if live.is_empty() {
                members.clone()
            } else {
                live
            };
            let mut anchor = candidates[0];
            for &k in &candidates[1..] {
                if drafts[k].body.len() > drafts[anchor].body.len() {
                    anchor = k;
                }
            }
            decision[anchor] = Some(Decision::Rewrite);
            for &m in members {
                if m == anchor {
                    continue;
                }
                decision[m] = Some(if no_dec[m] {
                    Decision::Delete {
                        reason: "рішення не прийняте (transcript обірвався)".to_string(),
                    }
                } else {
                    Decision::MergeAnchor { anchor_idx: anchor }
                });
            }
        } else {
            let i = members[0];
            decision[i] = Some(if no_dec[i] {
                Decision::Delete {
                    reason: "рішення не прийняте (transcript обірвався)".to_string(),
                }
            } else if let Some(target) = &clean_target[i] {
                Decision::MergeExisting {
                    target: target.clone(),
                }
            } else {
                Decision::Kind
            });
        }
    }

    // Stage 1b: kind-judge для одинаків без clean-target.
    let kind_idxs: Vec<usize> = (0..drafts.len())
        .filter(|&i| decision[i] == Some(Decision::Kind))
        .collect();
    if !kind_idxs.is_empty() {
        let kinds = judge_kinds(&kind_idxs, drafts, &titles, &cfg, &mut stats).await;
        for &i in &kind_idxs {
            let (kind, reason) = kinds.get(&i).cloned().unwrap_or_else(|| {
                (
                    "standalone".to_string(),
                    "judge failed → conservative standalone".to_string(),
                )
            });
            decision[i] = Some(if kind == "trivial" {
                Decision::Delete { reason }
            } else {
                Decision::Rewrite
            });
        }
    }

    // Stage 2: gen-MADR для всіх rewrite.
    let mut slug_by_idx: Vec<Option<String>> = vec![None; drafts.len()];
    let rewrite_idxs: Vec<usize> = (0..drafts.len())
        .filter(|&i| decision[i] == Some(Decision::Rewrite))
        .collect();
    if !rewrite_idxs.is_empty() {
        let gens = gen_madrs(&rewrite_idxs, drafts, &titles, &captured, &cfg, &mut stats).await;
        for &i in &rewrite_idxs {
            let slug = slugify(&titles[i]);
            slug_by_idx[i] = Some(slug.clone());
            match gens.get(&i) {
                Some(content) => operations.push(Operation::Rewrite {
                    file: drafts[i].file.clone(),
                    slug,
                    content: content.clone(),
                }),
                None => {
                    stats.madr_invalid += 1;
                    decision[i] = Some(Decision::GenFailed);
                    slug_by_idx[i] = None;
                    log(&format!(
                        "gen-MADR FAILED для {}: gen-MADR failed (both tiers)",
                        drafts[i].file
                    ));
                }
            }
        }
    }

    // Stage 3: gen-merge для merge-anchor/merge-existing; delete — одразу в ops.
    let mut merge_entries: Vec<(usize, String, String)> = Vec::new();
    for i in 0..drafts.len() {
        match decision[i].clone().expect("рішення призначене всім") {
            Decision::MergeAnchor { anchor_idx } => match &slug_by_idx[anchor_idx] {
                Some(slug) => {
                    merge_entries.push((i, titles[anchor_idx].clone(), format!("{slug}.md")))
                }
                None => log(&format!(
                    "merge-anchor {}: anchor gen failed → skip",
                    drafts[i].file
                )),
            },
            Decision::MergeExisting { target } => {
                merge_entries.push((i, strip_adr_name(&target), target));
            }
            Decision::Delete { reason } => operations.push(Operation::Delete {
                file: drafts[i].file.clone(),
                reason,
            }),
            _ => {}
        }
    }
    if !merge_entries.is_empty() {
        let merges = gen_merges(&merge_entries, drafts, &titles, &captured, &cfg, &mut stats).await;
        for (idx, _title, target_file) in &merge_entries {
            let head = format!(
                "## Update {}",
                madr_date(captured[*idx].as_deref(), &drafts[*idx].file)
            );
            let additions = merges.get(idx).cloned().unwrap_or_else(|| {
                format!("{head}\n\n(доповнення з чернетки \"{}\")", titles[*idx])
            });
            operations.push(Operation::MergeInto {
                file: drafts[*idx].file.clone(),
                target: target_file.clone(),
                additions,
            });
        }
    }

    let trace = Trace {
        titles: titles.clone(),
        clusters: clusters
            .iter()
            .map(|(_, m)| m.iter().map(|&i| drafts[i].file.clone()).collect())
            .collect(),
        clean_targets: clean_target
            .iter()
            .enumerate()
            .filter_map(|(i, c)| c.as_ref().map(|c| (drafts[i].file.clone(), c.clone())))
            .collect(),
        decisions: decision
            .iter()
            .enumerate()
            .map(|(i, d)| {
                (
                    drafts[i].file.clone(),
                    d.as_ref().expect("призначене").label().to_string(),
                )
            })
            .collect(),
    };

    PipelineOutput {
        operations,
        stats,
        trace,
    }
}

// ── Stage 1: edge-judge ─────────────────────────────────────────────────────────

struct EdgeSpec {
    id: String,
    is_dd: bool,
    prompt: String,
    votes: usize,
    min_conf: f64,
    draft_idx: usize,
    clean_name: Option<String>,
}

async fn judge_edges(
    dd: &[(usize, usize)],
    dc: &[(usize, String)],
    drafts: &[Draft],
    titles: &[String],
    votes: usize,
    cfg: &CascadeCfg,
    stats: &mut Stats,
) -> (HashMap<String, bool>, Vec<Option<String>>) {
    let mut specs: Vec<EdgeSpec> = Vec::new();
    for &(i, j) in dd {
        specs.push(EdgeSpec {
            id: format!("dd:{i}:{j}"),
            is_dd: true,
            prompt: edge_prompt(&titles[i], &drafts[i].body, &titles[j], &drafts[j].body),
            votes: 3,
            min_conf: 0.6,
            draft_idx: i,
            clean_name: None,
        });
    }
    for (i, c) in dc {
        let c_title = strip_adr_name(c);
        specs.push(EdgeSpec {
            id: format!("dc:{i}:{c}"),
            is_dd: false,
            prompt: edge_prompt(&titles[*i], &drafts[*i].body, &c_title, &c_title),
            votes,
            min_conf: 0.5,
            draft_idx: *i,
            clean_name: Some(c.clone()),
        });
    }

    let items: Vec<WaveItem> = specs
        .iter()
        .flat_map(|spec| {
            (0..spec.votes).map(|v| WaveItem {
                custom_id: format!("{}::v{v}", spec.id),
                prompt: spec.prompt.clone(),
                system: EDGE_SYS.to_string(),
            })
        })
        .collect();
    let parsed = keyed_cascade(&items, |raw, _| parse_edge_vote(raw), cfg, stats).await;

    let mut dd_same = HashMap::new();
    let mut clean_candidates: HashMap<usize, Vec<(String, bool)>> = HashMap::new();
    for spec in &specs {
        let mut same_count = 0;
        for v in 0..spec.votes {
            let (same, confidence) = parsed
                .get(&format!("{}::v{v}", spec.id))
                .copied()
                .unwrap_or((false, 0.0));
            if same && confidence >= spec.min_conf {
                same_count += 1;
            }
        }
        let same = same_count == spec.votes;
        if spec.is_dd {
            dd_same.insert(spec.id.clone(), same);
        } else {
            clean_candidates
                .entry(spec.draft_idx)
                .or_default()
                .push((spec.clean_name.clone().expect("dc має clean"), same));
        }
    }

    // Перший підтверджений кандидат у вхідному порядку.
    let mut clean_target: Vec<Option<String>> = vec![None; drafts.len()];
    for (draft_idx, candidates) in clean_candidates {
        if let Some((name, _)) = candidates.iter().find(|(_, same)| *same) {
            clean_target[draft_idx] = Some(name.clone());
        }
    }
    (dd_same, clean_target)
}

fn edge_prompt(a_title: &str, a_body: &str, b_title: &str, b_body: &str) -> String {
    format!(
        "Запис A — \"{a_title}\":\n{}\n\n---\n\nЗапис B — \"{b_title}\":\n{}\n\nЦе одне й те саме рішення?",
        clip(a_body, 1500),
        clip(b_body, 1500)
    )
}

// ── Stage 1b: kind-judge ────────────────────────────────────────────────────────

async fn judge_kinds(
    draft_idxs: &[usize],
    drafts: &[Draft],
    titles: &[String],
    cfg: &CascadeCfg,
    stats: &mut Stats,
) -> HashMap<usize, (String, String)> {
    let items: Vec<WaveItem> = draft_idxs
        .iter()
        .map(|&i| WaveItem {
            custom_id: format!("kind:{i}"),
            prompt: format!(
                "Чернетка — \"{}\":\n{}\n\nstandalone чи trivial?",
                titles[i],
                clip(&drafts[i].body, 2500)
            ),
            system: KIND_SYS.to_string(),
        })
        .collect();
    let parsed = keyed_cascade(&items, |raw, _| parse_kind(raw), cfg, stats).await;
    draft_idxs
        .iter()
        .filter_map(|&i| parsed.get(&format!("kind:{i}")).cloned().map(|v| (i, v)))
        .collect()
}

// ── Stage 2: gen-MADR ───────────────────────────────────────────────────────────

async fn gen_madrs(
    draft_idxs: &[usize],
    drafts: &[Draft],
    titles: &[String],
    captured: &[Option<String>],
    cfg: &CascadeCfg,
    stats: &mut Stats,
) -> HashMap<usize, String> {
    let items: Vec<WaveItem> = draft_idxs
        .iter()
        .map(|&i| WaveItem {
            custom_id: format!("gen:{i}"),
            prompt: format!(
                "Чернетка \"{}\":\n\n{}\n\nВитягни зміст рішення у JSON.",
                titles[i],
                clip(&drafts[i].body, 4000)
            ),
            system: GEN_SYS.to_string(),
        })
        .collect();
    let parse = |raw: &str, custom_id: &str| -> Result<String, String> {
        let i: usize = custom_id["gen:".len()..].parse().map_err(|_| "bad id")?;
        let sections = normalize_sections(&extract_json(raw)?);
        if sections.context.is_empty()
            && sections.chosen.is_empty()
            && sections.rationale.is_empty()
        {
            return Err("empty extraction (no context/decision)".to_string());
        }
        let content = assemble_madr(
            &titles[i],
            &madr_date(captured[i].as_deref(), &drafts[i].file),
            &sections,
        );
        let v = validate_madr(&content);
        if !v.ok {
            return Err(format!("MADR invalid: {}", v.errors.join("; ")));
        }
        Ok(content)
    };
    let parsed = keyed_cascade(&items, parse, cfg, stats).await;
    draft_idxs
        .iter()
        .filter_map(|&i| parsed.get(&format!("gen:{i}")).cloned().map(|c| (i, c)))
        .collect()
}

// ── Stage 3: gen-merge ──────────────────────────────────────────────────────────

async fn gen_merges(
    entries: &[(usize, String, String)],
    drafts: &[Draft],
    titles: &[String],
    captured: &[Option<String>],
    cfg: &CascadeCfg,
    stats: &mut Stats,
) -> HashMap<usize, String> {
    let heads: HashMap<usize, String> = entries
        .iter()
        .map(|(idx, _, _)| {
            (
                *idx,
                format!(
                    "## Update {}",
                    madr_date(captured[*idx].as_deref(), &drafts[*idx].file)
                ),
            )
        })
        .collect();
    let items: Vec<WaveItem> = entries
        .iter()
        .map(|(idx, target_title, _)| WaveItem {
            custom_id: format!("merge:{idx}"),
            prompt: format!(
                "Цільовий ADR: \"{target_title}\".\nЧернетка-доповнення \"{}\" ({}):\n{}\n\nЛише новий зміст, без заголовка.",
                titles[*idx],
                madr_date(captured[*idx].as_deref(), &drafts[*idx].file),
                clip(&drafts[*idx].body, 2500)
            ),
            system: MERGE_SYS.to_string(),
        })
        .collect();
    let re_update_head = regex::Regex::new(r"^##\s+Update").expect("regex");
    let re_update_head_line = regex::Regex::new(r"^##\s+Update[^\n]*\n+").expect("regex");
    let parse = |raw: &str, custom_id: &str| -> Result<String, String> {
        let idx: usize = custom_id["merge:".len()..].parse().map_err(|_| "bad id")?;
        let t = strip_fence(raw);
        let cleaned = if re_update_head.is_match(&t) {
            re_update_head_line.replace(&t, "").trim().to_string()
        } else {
            t
        };
        if cleaned.is_empty() {
            return Err("empty merge additions".to_string());
        }
        Ok(format!("{}\n\n{cleaned}", heads[&idx]))
    };
    let parsed = keyed_cascade(&items, parse, cfg, stats).await;
    entries
        .iter()
        .filter_map(|(idx, _, _)| {
            parsed
                .get(&format!("merge:{idx}"))
                .cloned()
                .map(|m| (*idx, m))
        })
        .collect()
}
