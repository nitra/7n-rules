//! Деталі оркестратора `docs build`, які мають ВЛАСНУ логіку — Rust-порт
//! самодостатньої частини `runner.mjs`.
//!
//! Сам конвеєр (`buildPackageKnowledge` і його чотири стадії) — окремий
//! зріз; тут зібрано те, що працює без інʼєкції половини світу і що можна
//! звірити з Node напряму: відбитки, приватний індекс evidence, адаптер
//! планера до контракту claims, злиття звʼязків прогалин, відновлення
//! захищених зон і три файлові операції.
//!
//! # Два місця, де точна форма JSON — контракт, а не деталь
//!
//! 1. **Відбиток джерел** (`fingerprint`) лягає у `domain.sourceFingerprint`,
//!    а звідти — в опублікований маніфест і в поле кожного вузла графа. JS
//!    хешує `JSON.stringify` У ПОРЯДКУ ВСТАВКИ (`path`, потім `content`), а
//!    не канонічний JSON, тож порядок ключів тут відтворено ЯВНО, а не
//!    покладено на фічу `preserve_order` чужого крейта (див. доккоментар
//!    [`crate::deterministic::canonical_json_pretty`]).
//! 2. **Промпт chunk-а** (`claimsChunks`) — теж `JSON.stringify` у порядку
//!    вставки, і він же частина ключа кешу. Дрейф порядку полів не зламав би
//!    нічого видимого — просто тихо знецінив би весь кеш тверджень.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};

use crate::candidate::KnowledgeExtractor;
use crate::deterministic::js_locale_cmp;
use crate::gap_mappings::Mapping;
use crate::planner::{Chunk, EdgeEvidence, UnitSlice};
use crate::sources::SourceFile;
use crate::wave::{ChainRef, SubmitBatchFn};
use crate::zones::{parse_knowledge_zones, Diagnostic as ZoneDiagnostic};

pub use crate::candidate::ParserProvenance;

/// `sha256:`-відбиток довільного тексту.
fn hash(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(text.as_bytes());
    let mut hex = String::with_capacity(64);
    for byte in digest.iter() {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("sha256:{hex}")
}

/// Рядок у формі `JSON.stringify(string)`.
fn json_string(text: &str) -> String {
    Value::String(text.to_string()).to_string()
}

/// Відбиток ідентичності домену — порт `fingerprint(domain.id)`.
///
/// Аргумент JS-функції тут завжди РЯДОК, тож `JSON.stringify` додає лапки;
/// хешувати сам `domain.id` без них означало б інший каталог кешу.
#[must_use]
pub fn domain_fingerprint(domain_id: &str) -> String {
    hash(&json_string(domain_id))
}

/// Відбиток набору джерел — порт
/// `fingerprint(sources.map(({path, content}) => …).toSorted(…))`.
///
/// Порядок ключів (`path`, `content`) і порядок елементів (за шляхом)
/// відтворено явно: значення йде в опубліковані артефакти.
#[must_use]
pub fn source_fingerprint(sources: &[SourceFile]) -> String {
    let mut sorted: Vec<&SourceFile> = sources.iter().collect();
    sorted.sort_by(|left, right| js_locale_cmp(&left.path, &right.path));
    let mut text = String::from("[");
    for (index, source) in sorted.iter().enumerate() {
        if index > 0 {
            text.push(',');
        }
        text.push_str(&format!(
            "{{\"path\":{},\"content\":{}}}",
            json_string(&source.path),
            json_string(&source.content)
        ));
    }
    text.push(']');
    hash(&text)
}

/// Точний UTF-8 зріз за половинно-відкритим байтовим span-ом.
///
/// `None` — якщо span невалідний АБО ріже посеред символу. JS доводить це
/// зворотним кодуванням (`Buffer.from(decoded).equals(slice)`), бо
/// `toString('utf8')` мовчки підставив би `U+FFFD`; у Rust ту саму умову
/// дає `str::from_utf8`.
fn utf8_byte_slice(content: &str, span: &Value) -> Option<String> {
    let start = span.get("startByte").and_then(Value::as_u64)?;
    let end = span.get("endByte").and_then(Value::as_u64)?;
    if end < start {
        return None;
    }
    let (start, end) = (usize::try_from(start).ok()?, usize::try_from(end).ok()?);
    let slice = content.as_bytes().get(start..end)?;
    std::str::from_utf8(slice).ok().map(str::to_string)
}

/// Індексує evidence графа текстом із розібраних джерел — порт
/// `sourceEvidenceContentById`.
///
/// Evidence без span бере файл цілком (так задумано: доказ рівня файла), а
/// evidence З невалідним span-ом лишається НЕІНДЕКСОВАНИМ — мовчазний
/// фолбек на весь файл підсунув би гейту entailment текст, якого доказ не
/// називав.
#[must_use]
pub fn source_evidence_content_by_id(
    graph: &Value,
    sources: &[SourceFile],
) -> BTreeMap<String, String> {
    let by_path: BTreeMap<&str, &str> = sources
        .iter()
        .map(|source| (source.path.as_str(), source.content.as_str()))
        .collect();
    let empty = Vec::new();
    let mut indexed = BTreeMap::new();
    for evidence in graph
        .get("evidence")
        .and_then(Value::as_array)
        .unwrap_or(&empty)
    {
        let (Some(id), Some(path)) = (
            evidence.get("id").and_then(Value::as_str),
            evidence.get("path").and_then(Value::as_str),
        ) else {
            continue;
        };
        let Some(content) = by_path.get(path) else {
            continue;
        };
        let value = match evidence.get("span").filter(|span| !span.is_null()) {
            None => Some((*content).to_string()),
            Some(span) => utf8_byte_slice(content, span),
        };
        if let Some(value) = value {
            indexed.insert(id.to_string(), value);
        }
    }
    indexed
}

/// Зводить ПРИВАТНИЙ індекс evidence для гейта entailment — порт
/// `entailmentEvidenceContentById`.
///
/// Порядок злиття значущий: джерела → структуровані артефакти →
/// очікування; за однакового ID виграє пізніший. Індекс не потрапляє ні в
/// граф, ні в результат збірки — сирий текст лишається локальним.
#[must_use]
pub fn entailment_evidence_content_by_id(
    graph: &Value,
    sources: &[SourceFile],
    structured_evidence_content_by_id: &BTreeMap<String, String>,
    expected_sources: &[(String, String)],
) -> BTreeMap<String, String> {
    let mut indexed = source_evidence_content_by_id(graph, sources);
    for (id, content) in structured_evidence_content_by_id {
        indexed.insert(id.clone(), content.clone());
    }
    for (id, content) in expected_sources {
        indexed.insert(id.clone(), content.clone());
    }
    indexed
}

/// Детермінована версія парсерів — порт `parserVersion`.
#[must_use]
pub fn parser_version(parsers: &[ParserProvenance]) -> String {
    let mut items: Vec<String> = parsers
        .iter()
        .map(|parser| {
            format!(
                "{}@{}/{}",
                parser.id, parser.grammar_version, parser.runtime_version
            )
        })
        .collect();
    items.sort_by(|left, right| js_locale_cmp(left, right));
    items.join(",")
}

/// Тіло промпта chunk-а — порядок полів дзеркальний до JS-літерала.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkPrompt<'a> {
    unit_slices: &'a [UnitSlice],
    edge_evidence: &'a [EdgeEvidence],
    evidence_refs: &'a [Value],
    depends_on_chunk_ids: &'a [String],
}

/// Чи ребро несе конкретне evidence — порт `edgeContainsEvidence`.
fn edge_contains_evidence(edge: &EdgeEvidence, evidence_id: &str) -> bool {
    edge.evidence.iter().any(|item| item.id == evidence_id)
}

/// Приводить зрізи планера до строгого контракту claims-map — порт
/// `claimsChunks`.
///
/// `allowedEvidenceIds` звужує те, ЧИМ модель має право підкріпити
/// твердження: evidence або належить вузлові chunk-а, або приходить із його
/// ребра. Ширший список зробив би посилання на чужий доказ легальним.
#[must_use]
pub fn claims_chunks(chunks: &[Chunk], graph: &Value) -> Vec<Value> {
    let empty = Vec::new();
    let evidence = graph
        .get("evidence")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    chunks
        .iter()
        .map(|chunk| {
            let refs: Vec<Value> = evidence
                .iter()
                .filter(|item| {
                    let symbol = item.get("symbolId").and_then(Value::as_str);
                    let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
                    symbol.is_some_and(|symbol| chunk.node_ids.iter().any(|node| node == symbol))
                        || chunk
                            .edge_evidence
                            .iter()
                            .any(|edge| edge_contains_evidence(edge, id))
                })
                .cloned()
                .collect();
            let mut allowed: Vec<String> = refs
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(str::to_string)
                .collect();
            allowed.sort_by(|left, right| js_locale_cmp(left, right));
            let prompt = serde_json::to_string(&ChunkPrompt {
                unit_slices: &chunk.unit_slices,
                edge_evidence: &chunk.edge_evidence,
                evidence_refs: &refs,
                depends_on_chunk_ids: &chunk.depends_on_chunk_ids,
            })
            .expect("зрізи планера серіалізуються");
            json!({
                "id": chunk.id,
                "requiredNodeIds": chunk.node_ids,
                "requiredEdgeIds": chunk.edge_ids,
                "allowedEvidenceIds": allowed,
                "dependsOnChunkIds": chunk.depends_on_chunk_ids,
                "wave": chunk.wave,
                "contentHash": chunk.cache_fingerprint,
                "prompt": prompt,
            })
        })
        .collect()
}

/// Діагностика злиття звʼязків — форма `{code, message}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
}

impl Diagnostic {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    fn sort_key(&self) -> String {
        format!("{}:{}", self.code, self.message)
    }
}

/// Зливає автоматичні звʼязки comparator-а з явними звʼязками викликача —
/// порт `mergeGapMappings`.
///
/// Пріоритету немає НІ в кого: повтор тієї самої пари — блокер, а не тихе
/// перевизначення. Різниця лише в коді діагностики — `duplicate-` для
/// дослівного повтору, `conflicting-` для розбіжного, — і саме вона показує
/// авторові, чи він продублював звʼязок, чи посперечався з comparator-ом.
///
/// Гілок JS-валідації форми (`invalid-gap-mappings`, `invalid-gap-mapping`)
/// у порті немає: її тримає тип [`Mapping`].
///
/// # Errors
/// Повтор або конфлікт; діагностики впорядковані `` `${code}:${message}` ``.
pub fn merge_gap_mappings(
    automatic: &[Mapping],
    explicit: &[Mapping],
) -> Result<Vec<Mapping>, Vec<Diagnostic>> {
    let mut by_identity: Vec<(String, &Mapping)> = Vec::new();
    let mut diagnostics = Vec::new();
    // Порівняння evidence — за ВІДСОРТОВАНИМИ списками: той самий набір
    // доказів у різному порядку лишається тим самим набором.
    let sorted = |ids: &[String]| {
        let mut ids = ids.to_vec();
        ids.sort();
        ids
    };
    for mapping in automatic.iter().chain(explicit.iter()) {
        let identity = format!(
            "{}\u{0}{}",
            mapping.expected_claim_id, mapping.implemented_claim_id
        );
        let prior = by_identity
            .iter()
            .find(|(key, _)| key == &identity)
            .map(|(_, prior)| *prior);
        let Some(prior) = prior else {
            by_identity.push((identity, mapping));
            continue;
        };
        let same = prior.relation == mapping.relation
            && sorted(&prior.evidence_ids) == sorted(&mapping.evidence_ids);
        diagnostics.push(Diagnostic::new(
            if same {
                "duplicate-gap-mapping"
            } else {
                "conflicting-gap-mapping"
            },
            &format!(
                "Gap mapping {} → {} задано більше одного разу.",
                mapping.expected_claim_id, mapping.implemented_claim_id
            ),
        ));
    }
    if !diagnostics.is_empty() {
        diagnostics.sort_by(|left, right| js_locale_cmp(&left.sort_key(), &right.sort_key()));
        return Err(diagnostics);
    }
    let key = |mapping: &Mapping| {
        format!(
            "{}:{}:{}",
            mapping.expected_claim_id, mapping.implemented_claim_id, mapping.relation
        )
    };
    let mut merged: Vec<Mapping> = by_identity
        .into_iter()
        .map(|(_, mapping)| mapping.clone())
        .collect();
    merged.sort_by(|left, right| js_locale_cmp(&key(left), &key(right)));
    Ok(merged)
}

/// Відновлює захищені зони тем із уже згенерованих сторінок — порт
/// `protectedZonesFromPages`.
///
/// Шлях сторінки будує [`crate::render::topic_page_path`] — ТА САМА
/// функція, якою його будує рендерер. У JS ця таблиця тек продубльована в
/// двох файлах, і розходження там тихо втратило б авторський текст: реєстр
/// просто не знайшов би сторінки й вирішив, що зон немає.
///
/// # Errors
/// Зламані маркери зон у наявній сторінці.
pub fn protected_zones_from_pages(
    files: &BTreeMap<String, String>,
    manifest: Option<&Value>,
) -> Result<BTreeMap<String, Vec<Value>>, Vec<ZoneDiagnostic>> {
    let empty = Vec::new();
    let topics = manifest
        .and_then(|manifest| manifest.get("topics"))
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let mut registry: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut diagnostics = Vec::new();
    for topic in topics {
        let Some(id) = topic.get("id").and_then(Value::as_str) else {
            continue;
        };
        let kind = topic
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(path) = crate::render::topic_page_path(kind, id) else {
            continue;
        };
        let Some(content) = files.get(&path) else {
            continue;
        };
        match parse_knowledge_zones(content, Some(&path)) {
            Err(own) => diagnostics.extend(own),
            Ok(parsed) => {
                let zones: Vec<Value> = parsed
                    .zones
                    .iter()
                    .filter(|zone| zone.kind == "MANUAL" || zone.kind == "EXPECTED")
                    .map(
                        |zone| json!({ "id": zone.id, "kind": zone.kind, "content": zone.content }),
                    )
                    .collect();
                if !zones.is_empty() {
                    registry.insert(id.to_string(), zones);
                }
            }
        }
    }
    if diagnostics.is_empty() {
        Ok(registry)
    } else {
        Err(diagnostics)
    }
}

/// Читає наявний Markdown домену — порт `readExistingMarkdown`.
///
/// Маніфест НЕ читається свідомо: згенерований кандидат завжди є повною
/// проєкцією графа, тож ці файли потрібні рівно для збереження авторських
/// зон. Відсутня тека `docs/` — не помилка, а перший прогін.
///
/// # Errors
/// Будь-яка помилка читання, крім відсутності самої теки.
pub fn read_existing_markdown(domain_root: &Path) -> io::Result<BTreeMap<String, String>> {
    let mut files = BTreeMap::new();
    read_markdown_into(&domain_root.join("docs"), domain_root, &mut files)?;
    Ok(files)
}

fn read_markdown_into(
    directory: &Path,
    domain_root: &Path,
    files: &mut BTreeMap<String, String>,
) -> io::Result<()> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            read_markdown_into(&path, domain_root, files)?;
        } else if path.extension().is_some_and(|extension| extension == "md") {
            let key = path
                .strip_prefix(domain_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            files.insert(key, fs::read_to_string(&path)?);
        }
    }
    Ok(())
}

/// Читає закомічений маніфест попереднього прогону — порт
/// `readPreviousManifest`.
///
/// Зламаний маніфест БЛОКУЄ, а не відкочується до «першого прогону»: тихий
/// фолбек означав би втрату міграції перейменувань і захищених зон саме
/// тоді, коли вони найпотрібніші.
///
/// # Errors
/// Маніфест є, але не читається чи не є JSON-обʼєктом. Відсутній файл —
/// `Ok(None)`.
pub fn read_previous_manifest(domain_root: &Path) -> Result<Option<Value>, Vec<Value>> {
    let path = domain_root.join("docs/.docgen/manifest.json");
    let display = path.to_string_lossy().to_string();
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(vec![json!({
                "code": "manifest-read-failed",
                "path": display,
                "detail": error.to_string(),
            })])
        }
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(manifest) if manifest.is_object() => Ok(Some(manifest)),
        Ok(_) => Err(vec![json!({ "code": "manifest-invalid", "path": display })]),
        Err(error) => Err(vec![json!({
            "code": "manifest-read-failed",
            "path": display,
            "detail": error.to_string(),
        })]),
    }
}

/// Записує перевіреного кандидата ПОЗА репозиторієм — порт
/// `writeShadowCandidate`.
///
/// Саме це робить типовий режим збірки безпечним: результат є де подивитись,
/// а закомічені доки лишаються недоторканими.
///
/// # Errors
/// Будь-яка помилка створення теки чи запису.
pub fn write_shadow_candidate(
    staging_path: &Path,
    files: &BTreeMap<String, String>,
) -> io::Result<()> {
    for (path, content) in files {
        let target = staging_path.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, content)?;
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────
// Конвеєр `docs build` — порт `buildPackageKnowledge` і його чотирьох стадій.
// ─────────────────────────────────────────────────────────────────────────

/// Режим збірки.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildMode {
    /// Кандидат перевірено й покладено ПОЗА репозиторієм.
    Shadow,
    /// Кандидат атомарно вкладено в `docs/` домену.
    Published,
}

/// Результат успішної збірки.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildReport {
    pub mode: BuildMode,
    pub domain_id: String,
    pub cache_path: PathBuf,
    pub staging_path: PathBuf,
    /// Шляхи артефактів кандидата, впорядковані.
    pub files: Vec<String>,
}

/// Результат збірки одного домену.
#[derive(Debug, Clone, PartialEq)]
pub enum BuildOutcome {
    Built(BuildReport),
    /// Стадія, на якій конвеєр зупинився, і її ВЛАСНІ діагностики.
    Blocked {
        stage: String,
        domain_id: String,
        diagnostics: Vec<Value>,
    },
}

/// Вхід збірки.
///
/// # Що приходить ззовні і чому
///
/// - **`extractors`** — у JS їх матеріалізує slot-шина плагінів
///   (`load-adapters.mjs`, заблокована, §5.0.15 реєстру). Порт лишає точку
///   підключення; те, що вони `Arc`, а не позички, — вимога
///   [`crate::expected_sources::ScenarioCollector`], який мусить пережити
///   виклик.
/// - **`submit`/`chain`** — batch-фасад і ланцюжок задачі. ОДИН ланцюжок на
///   всю збірку: чотири LLM-стадії мають лягти в одну трасу, а не в чотири.
/// - **`cache_root`** — заміна чотирьох окремих JS-шляхів кешу
///   (`cachePath`, `expectedCachePath`, `entailmentCachePath`,
///   `gapCachePath`): усі чотири в JS типово беруться від одного кореня, і
///   лише тести задавали їх нарізно.
pub struct BuildInput<'a> {
    pub repo_root: &'a Path,
    pub domain_id: &'a str,
    /// `false` — типовий SHADOW: закомічені доки лишаються недоторканими.
    pub publish: bool,
    pub extractors: &'a [Arc<dyn KnowledgeExtractor + Send + Sync>],
    /// Явний expected-шар викликача — `{claims, evidence}`.
    pub expected_overlay: &'a Value,
    /// Явні звʼязки прогалин викликача.
    pub gap_mappings: &'a [Mapping],
    /// Історичні ID тем — `{topicId: [alias]}`.
    pub aliases_by_topic_id: &'a Value,
    /// Корінь кешу; `None` — системний тимчасовий каталог, як у JS.
    pub cache_root: Option<&'a Path>,
    pub minimum_gap_confidence: f64,
    pub submit: SubmitBatchFn,
    pub chain: ChainRef,
}

/// Блокер стадії.
struct Blocked {
    stage: String,
    domain_id: String,
    diagnostics: Vec<Value>,
}

fn blocked(stage: &str, domain_id: &str, diagnostics: Vec<Value>) -> Blocked {
    Blocked {
        stage: stage.to_string(),
        domain_id: domain_id.to_string(),
        diagnostics,
    }
}

/// `{code, detail, path}` — форма діагностик файлових стадій.
fn detail_diagnostics<'a>(
    items: impl IntoIterator<Item = (&'a str, &'a str, Option<&'a str>)>,
) -> Vec<Value> {
    items
        .into_iter()
        .map(|(code, detail, path)| json!({ "code": code, "detail": detail, "path": path }))
        .collect()
}

/// Зібраний вхід усіх наступних стадій.
struct BuildContext {
    domain: crate::domains::Domain,
    existing_files: BTreeMap<String, String>,
    extensions: Vec<String>,
    sources: Vec<SourceFile>,
    structured: crate::structured_sources::LoadedSources,
    source_fingerprint: String,
    candidate: crate::candidate::Candidate,
    cache_root: PathBuf,
}

impl BuildContext {
    fn cache_path(&self) -> PathBuf {
        self.cache_root.join("claims.json")
    }
}

/// Резолвить домен і читає всі детерміновані входи наступних стадій — порт
/// `loadBuildContext`.
fn load_build_context(input: &BuildInput<'_>) -> Result<BuildContext, Blocked> {
    let domain_id = input.domain_id;
    let resolved =
        crate::domains::resolve_documentation_domains(input.repo_root).map_err(|error| {
            // Гілка, якої в JS немає: там резолвер віддає діагностики, а
            // помилку ФС ковтає обхід. Тут вона є типом — і мовчати про неї
            // означало б «домен не знайдено» замість «репозиторій не
            // читається».
            blocked(
                "domain-resolution",
                domain_id,
                detail_diagnostics([(
                    "domain-resolution-failed",
                    error.to_string().as_str(),
                    None,
                )]),
            )
        })?;
    if !resolved.diagnostics.is_empty() {
        let diagnostics = resolved
            .diagnostics
            .iter()
            .map(|diagnostic| {
                json!({
                    "severity": diagnostic.severity,
                    "code": diagnostic.code,
                    "manifest": diagnostic.manifest,
                    "message": diagnostic.message,
                    "domainId": diagnostic.domain_id,
                    "manifests": diagnostic.manifests,
                })
            })
            .collect();
        return Err(blocked("domain-resolution", domain_id, diagnostics));
    }
    let Some(domain) = resolved
        .domains
        .into_iter()
        .find(|candidate| candidate.id == domain_id)
    else {
        return Err(blocked(
            "domain-resolution",
            domain_id,
            vec![json!({ "code": "domain-not-found", "domainId": domain_id })],
        ));
    };

    let existing_files = read_existing_markdown(&domain.root).map_err(|error| {
        blocked(
            "existing-docs",
            &domain.id,
            detail_diagnostics([(
                "existing-docs-read-failed",
                error.to_string().as_str(),
                None,
            )]),
        )
    })?;
    let previous_manifest = read_previous_manifest(&domain.root)
        .map_err(|diagnostics| blocked("previous-manifest", &domain.id, diagnostics))?;
    let protected_zones = protected_zones_from_pages(&existing_files, previous_manifest.as_ref())
        .map_err(|diagnostics| {
        blocked(
            "protected-zones",
            &domain.id,
            diagnostics
                .iter()
                .map(|diagnostic| {
                    json!({
                        "code": diagnostic.code,
                        "detail": diagnostic.detail,
                        "path": diagnostic.path,
                    })
                })
                .collect(),
        )
    })?;

    let scope = crate::sources::DomainScope {
        root: &domain.root,
        source_root: &domain.source_root,
        excluded_source_roots: &domain.excluded_source_roots,
    };
    let extensions =
        crate::sources::discover_domain_code_extensions(&scope).map_err(|diagnostics| {
            blocked(
                "source-inventory",
                &domain.id,
                source_diagnostics(&diagnostics),
            )
        })?;
    // Порт стадії `adapters`. Перевірка покриття КОЖНОГО розширення лишилась
    // за кандидатом (`extractor-missing`): у JS її робить сам заблокований
    // loader, приймаючи `requiredExtensions`. Тут же ловиться те, що
    // кандидат не побачив би, — код без жодного екстрактора.
    if !extensions.is_empty() && input.extractors.is_empty() {
        return Err(blocked(
            "adapters",
            &domain.id,
            vec![json!({
                "code": "missing-extractors",
                "message": "Немає knowledge.extractor@1 adapters.",
            })],
        ));
    }

    // Пакет без коду проходить contract-only шляхом: ні джерел, ні LLM.
    let sources = if extensions.is_empty() {
        Vec::new()
    } else {
        crate::sources::load_domain_sources(&scope, &extensions).map_err(|diagnostics| {
            blocked("sources", &domain.id, source_diagnostics(&diagnostics))
        })?
    };
    let structured_scope = crate::structured_sources::DomainScope {
        id: &domain.id,
        root: &domain.root,
        root_manifest: &domain.root_manifest,
        source_root: &domain.source_root,
        excluded_source_roots: &domain.excluded_source_roots,
    };
    let structured = crate::structured_sources::load_structured_sources(&structured_scope)
        .map_err(|diagnostics| {
            blocked(
                "structured-sources",
                &domain.id,
                structured_diagnostics(&diagnostics),
            )
        })?;

    let source_fingerprint = source_fingerprint(&sources);
    let graph_domain = crate::graph::Domain {
        id: domain.id.clone(),
        ecosystem: Some(domain.ecosystem.clone()),
        name: Some(domain.name.clone()),
        root_manifest: Some(domain.root_manifest.clone()),
        source_fingerprint: Some(source_fingerprint.clone()),
    };
    let extractor_refs: Vec<&dyn KnowledgeExtractor> = input
        .extractors
        .iter()
        .map(|extractor| &**extractor as &dyn KnowledgeExtractor)
        .collect();
    let zones_value: Value = protected_zones
        .into_iter()
        .map(|(id, zones)| (id, Value::Array(zones)))
        .collect::<serde_json::Map<String, Value>>()
        .into();
    // Порожній overlay і порожні звʼязки — НЕ спрощення: JS теж будує
    // кандидата без них, бо expected-шар зʼявляється лише на третій стадії,
    // після того як у графі вже є implemented claims.
    let candidate =
        match crate::candidate::build_knowledge_candidate(crate::candidate::CandidateInput {
            domain: &graph_domain,
            sources: &sources,
            extractors: &extractor_refs,
            structured_fragments: &structured.fragments,
            expected_overlay: &json!({}),
            gap_mappings: &[],
            aliases_by_topic_id: input.aliases_by_topic_id,
            previous_manifest: previous_manifest.as_ref(),
            protected_zones_by_topic_id: Some(&zones_value),
            minimum_gap_confidence: input.minimum_gap_confidence,
        }) {
            crate::candidate::CandidateOutcome::Built(candidate) => *candidate,
            crate::candidate::CandidateOutcome::Blocked(diagnostics) => {
                return Err(blocked("candidate", &domain.id, diagnostics))
            }
        };

    let cache_root = input
        .cache_root
        .map_or_else(std::env::temp_dir, Path::to_path_buf)
        .join("n-rules-package-knowledge")
        .join(&domain_fingerprint(&domain.id)[7..]);
    Ok(BuildContext {
        domain,
        existing_files,
        extensions,
        sources,
        structured,
        source_fingerprint,
        candidate,
        cache_root,
    })
}

fn source_diagnostics(items: &[crate::sources::Diagnostic]) -> Vec<Value> {
    items
        .iter()
        .map(|item| json!({ "code": item.code, "detail": item.detail, "path": item.path }))
        .collect()
}

fn structured_diagnostics(items: &[crate::structured_sources::Diagnostic]) -> Vec<Value> {
    items
        .iter()
        .map(|item| json!({ "code": item.code, "detail": item.detail, "path": item.path }))
        .collect()
}

/// Додає implemented claims до детермінованого кандидата — порт
/// `addImplementedClaims`.
///
/// Пакет без коду повертає граф як є: контрактний домен документується
/// структурованими джерелами, і платити за нього викликами моделі нема за що.
async fn add_implemented_claims(
    input: &BuildInput<'_>,
    context: &BuildContext,
) -> Result<Value, Blocked> {
    if context.extensions.is_empty() {
        return Ok(context.candidate.graph.clone());
    }
    let parsers: Vec<ParserProvenance> = input
        .extractors
        .iter()
        .map(|extractor| extractor.parser())
        .collect();
    let parser = parser_version(&parsers);
    let sources: Vec<crate::planner::SourceText> = context
        .sources
        .iter()
        .map(|source| crate::planner::SourceText {
            path: source.path.clone(),
            content: source.content.clone(),
        })
        .collect();
    let plan = match crate::planner::plan_semantic_chunks(crate::planner::PlannerInput {
        graph: &context.candidate.graph,
        sources: &sources,
        max_tokens: crate::planner::DEFAULT_MAX_TOKENS,
        max_reduce_inputs: crate::planner::DEFAULT_REDUCE_INPUTS,
        required_node_ids: None,
        required_edge_ids: None,
        parser: json!({ "version": parser }),
        schema: json!({ "version": crate::claims::CLAIM_SCHEMA_VERSION }),
        prompt: json!({ "version": crate::claims::CLAIM_PROMPT_VERSION }),
        // Драбина йде в план ІМЕНАМИ тирів (вони ж у ключах кешу). Самі
        // імена вже розходяться з JS — це рішення драбини
        // (`wave::default_model_policy`), а не планера.
        model_policy: json!({
            "tiers": crate::wave::default_model_policy()
                .into_iter()
                .map(crate::wave::tier_name)
                .collect::<Vec<&str>>(),
        }),
    }) {
        crate::planner::PlanOutcome::Planned(plan) => *plan,
        crate::planner::PlanOutcome::Blocked(diagnostics) => return Err(blocked(
            "chunk-plan",
            &context.domain.id,
            diagnostics
                .iter()
                .map(|item| json!({ "code": item.code, "detail": item.detail, "path": item.path }))
                .collect(),
        )),
    };
    let chunks = claims_chunks(&plan.chunks, &context.candidate.graph);
    let cache_path = context.cache_path();
    let outcome = crate::claims::build_structured_claims(crate::claims::ClaimsInput {
        graph: &context.candidate.graph,
        chunks: &chunks,
        parser_version: parser,
        prompt_version: crate::claims::CLAIM_PROMPT_VERSION.to_string(),
        schema_version: crate::claims::CLAIM_SCHEMA_VERSION.to_string(),
        model_policy: crate::wave::default_model_policy(),
        reduce_fan_in: crate::planner::DEFAULT_REDUCE_INPUTS,
        cache: None,
        cache_path: Some(&cache_path),
        submit: Arc::clone(&input.submit),
        chain: Arc::clone(&input.chain),
    })
    .await
    .map_err(|error| {
        blocked(
            "claims",
            &context.domain.id,
            detail_diagnostics([("claims-failed", error.as_str(), None)]),
        )
    })?;
    let built = match outcome {
        crate::claims::ClaimsOutcome::Built { claims, .. } => claims,
        crate::claims::ClaimsOutcome::Blocked { blockers, .. } => {
            return Err(blocked(
                "claims",
                &context.domain.id,
                blockers
                    .iter()
                    .map(|blocker| {
                        json!({
                            "code": blocker.code,
                            "chunkId": blocker.chunk_id,
                            "detail": blocker.detail,
                        })
                    })
                    .collect(),
            ))
        }
    };
    let mut graph = context.candidate.graph.clone();
    let mut claims: Vec<Value> = graph
        .get("claims")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    claims.extend(built);
    claims.sort_by(|left, right| {
        js_locale_cmp(
            left.get("id").and_then(Value::as_str).unwrap_or_default(),
            right.get("id").and_then(Value::as_str).unwrap_or_default(),
        )
    });
    graph["claims"] = Value::Array(claims);
    Ok(graph)
}

/// Додає expected-шар, верифікує entailment і матеріалізує прогалини — порт
/// `addExpectedAndGaps`.
///
/// Порядок стадій тут не переставний так само, як у кандидаті: overlay
/// лягає на граф, у якому вже є implemented claims (інакше немає з чим
/// порівнювати), гейт entailment бачить обидва шари, а вердикти прогалин
/// рахуються після нього — тобто по вже перевіреному графу.
async fn add_expected_and_gaps(
    input: &BuildInput<'_>,
    context: &BuildContext,
    implemented_graph: Value,
) -> Result<Value, Blocked> {
    let domain_id = context.domain.id.as_str();
    let scope = crate::expected_sources::DomainScope {
        id: domain_id,
        root: &context.domain.root,
        excluded_source_roots: &context.domain.excluded_source_roots,
    };
    let extractors: Vec<crate::expected_sources::Extractor> = input
        .extractors
        .iter()
        .map(|extractor| {
            let owned = Arc::clone(extractor);
            crate::expected_sources::Extractor {
                extensions: extractor.extensions(),
                collect: Arc::new(move |file| owned.collect_test_scenarios(file)),
            }
        })
        .collect();
    let test_files: Vec<crate::expected_sources::TestFile> = context
        .sources
        .iter()
        .map(|source| crate::expected_sources::TestFile {
            path: source.path.clone(),
            content: source.content.clone(),
        })
        .collect();
    let discovered = crate::expected_sources::discover_expected_sources(
        input.repo_root,
        &scope,
        &extractors,
        &test_files,
    )
    .map_err(|diagnostics| {
        blocked(
            "expected-sources",
            domain_id,
            expected_diagnostics(&diagnostics),
        )
    })?;

    let mapped =
        crate::expected_sources::map_expected_sources(crate::expected_sources::MappingInput {
            graph: &implemented_graph,
            sources: &discovered,
            cache: None,
            cache_path: Some(&context.cache_root.join("expected.json")),
            model_policy: crate::wave::default_model_policy(),
            submit: Arc::clone(&input.submit),
            chain: Arc::clone(&input.chain),
        })
        .await
        .map_err(|error| {
            blocked(
                "expected-mapping",
                domain_id,
                detail_diagnostics([("expected-mapping-failed", error.as_str(), None)]),
            )
        })?;
    let overlay = match mapped {
        crate::expected_sources::MappingOutcome::Mapped { overlay, .. } => overlay,
        crate::expected_sources::MappingOutcome::Blocked { diagnostics, .. } => {
            return Err(blocked(
                "expected-mapping",
                domain_id,
                expected_diagnostics(&diagnostics),
            ))
        }
    };
    // Порядок конкатенації як у JS: спершу зіставлене, потім явне від
    // викликача.
    let mut overlay_claims = overlay.claims;
    overlay_claims.extend(array_field(input.expected_overlay, "claims"));
    let mut overlay_evidence = overlay.evidence;
    overlay_evidence.extend(array_field(input.expected_overlay, "evidence"));
    let merged_overlay = json!({ "claims": overlay_claims, "evidence": overlay_evidence });
    let overlaid =
        match crate::expected::apply_expected_overlay(&implemented_graph, &merged_overlay) {
            crate::expected::OverlayOutcome::Merged(graph) => *graph,
            crate::expected::OverlayOutcome::Blocked(diagnostics) => {
                return Err(blocked(
                    "expected-overlay",
                    domain_id,
                    diagnostics
                        .iter()
                        .map(|item| json!({ "code": item.code, "message": item.message }))
                        .collect(),
                ))
            }
        };

    let expected_contents: Vec<(String, String)> = discovered
        .iter()
        .map(|source| (source.evidence.id.clone(), source.content.clone()))
        .collect();
    let evidence_content = entailment_evidence_content_by_id(
        &overlaid,
        &context.sources,
        &context.structured.evidence_content_by_id,
        &expected_contents,
    );
    let entailment =
        crate::entailment::verify_evidence_entailment(crate::entailment::EntailmentInput {
            graph: &overlaid,
            evidence_content_by_id: &evidence_content,
            cache: None,
            cache_path: Some(&context.cache_root.join("entailment.json")),
            model_policy: crate::wave::default_model_policy(),
            prompt_version: crate::entailment::ENTAILMENT_PROMPT_VERSION.to_string(),
            schema_version: crate::entailment::ENTAILMENT_SCHEMA_VERSION.to_string(),
            submit: Arc::clone(&input.submit),
            chain: Arc::clone(&input.chain),
        })
        .await
        .map_err(|error| {
            blocked(
                "entailment",
                domain_id,
                detail_diagnostics([("entailment-failed", error.as_str(), None)]),
            )
        })?;
    if let crate::entailment::EntailmentOutcome::Blocked { diagnostics, .. } = entailment {
        return Err(blocked(
            "entailment",
            domain_id,
            diagnostics
                .iter()
                .map(|item| {
                    json!({ "code": item.code, "message": item.message, "claimId": item.claim_id })
                })
                .collect(),
        ));
    }

    let comparison =
        crate::gap_mappings::compare_claim_mappings(crate::gap_mappings::GapMappingInput {
            graph: &overlaid,
            cache: None,
            cache_path: Some(&context.cache_root.join("gap-mappings.json")),
            model_policy: crate::wave::default_model_policy(),
            prompt_version: crate::gap_mappings::GAP_MAPPING_PROMPT_VERSION.to_string(),
            schema_version: crate::gap_mappings::GAP_MAPPING_SCHEMA_VERSION.to_string(),
            submit: Arc::clone(&input.submit),
            chain: Arc::clone(&input.chain),
        })
        .await
        .map_err(|error| {
            blocked(
                "gap-mappings",
                domain_id,
                detail_diagnostics([("gap-mappings-failed", error.as_str(), None)]),
            )
        })?;
    let (mappings, unresolved) = match comparison {
        crate::gap_mappings::GapMappingOutcome::Compared {
            mappings,
            unresolved_expected_claim_ids,
            ..
        } => (mappings, unresolved_expected_claim_ids),
        crate::gap_mappings::GapMappingOutcome::Blocked { diagnostics, .. } => {
            return Err(blocked(
                "gap-mappings",
                domain_id,
                diagnostics
                    .iter()
                    .map(|item| {
                        json!({
                            "code": item.code,
                            "message": item.message,
                            "expectedClaimId": item.expected_claim_id,
                        })
                    })
                    .collect(),
            ))
        }
    };
    let merged = merge_gap_mappings(&mappings, input.gap_mappings).map_err(|diagnostics| {
        blocked(
            "gap-mappings",
            domain_id,
            diagnostics
                .iter()
                .map(|item| json!({ "code": item.code, "message": item.message }))
                .collect(),
        )
    })?;
    let gaps = match crate::gaps::evaluate_gaps(crate::gaps::GapInput {
        graph: &overlaid,
        mappings: &merged,
        unresolved_expected_claim_ids: &unresolved,
        validation: crate::gaps::Validation::default(),
        minimum_confidence: input.minimum_gap_confidence,
    }) {
        crate::gaps::GapOutcome::Evaluated(gaps) => gaps,
        crate::gaps::GapOutcome::Blocked(diagnostics) => {
            return Err(blocked(
                "gaps",
                domain_id,
                diagnostics
                    .iter()
                    .map(|item| json!({ "code": item.code, "message": item.message }))
                    .collect(),
            ))
        }
    };

    let mut graph = overlaid;
    graph["topics"] = context
        .candidate
        .graph
        .get("topics")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    graph["gaps"] = Value::Array(
        gaps.iter()
            .map(|gap| {
                json!({
                    "id": gap.id,
                    "status": gap.status,
                    "expectedClaimId": gap.expected_claim_id,
                    "implementedClaimIds": gap.implemented_claim_ids,
                    "evidenceIds": gap.evidence_ids,
                })
            })
            .collect(),
    );
    graph["protectedZonesByTopicId"] = context
        .candidate
        .protected_zones_by_topic_id
        .iter()
        .map(|(id, zones)| (id.clone(), Value::Array(zones.clone())))
        .collect::<serde_json::Map<String, Value>>()
        .into();
    Ok(graph)
}

fn expected_diagnostics(items: &[crate::expected_sources::Diagnostic]) -> Vec<Value> {
    items
        .iter()
        .map(|item| json!({ "code": item.code, "detail": item.detail, "path": item.path }))
        .collect()
}

/// Масив поля або порожній — `input.expectedOverlay?.claims ?? []`.
fn array_field(value: &Value, key: &str) -> Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// Рендерить, валідує і за потреби публікує повний шаруватий граф — порт
/// `materializeBuild`.
fn materialize_build(
    input: &BuildInput<'_>,
    context: &BuildContext,
    graph: &Value,
) -> Result<BuildReport, Blocked> {
    let domain_id = context.domain.id.as_str();
    let files = match crate::render::render_knowledge_artifacts(graph, &context.existing_files) {
        crate::render::RenderOutcome::Rendered(files) => files,
        crate::render::RenderOutcome::Blocked(diagnostics) => return Err(blocked(
            "render",
            domain_id,
            diagnostics
                .iter()
                .map(|item| json!({ "code": item.code, "detail": item.detail, "path": item.path }))
                .collect(),
        )),
    };
    // Людська проєкція — усе, що читатиме людина, склеєне докупи. Валідатор
    // шукає в ній витік приватних імен, тож дивитись мусить рівно на те, що
    // пішло б у публікацію.
    let human_projection = files
        .iter()
        .filter(|(path, _)| path.ends_with(".md"))
        .map(|(_, content)| content.as_str())
        .collect::<Vec<&str>>()
        .join("\n");
    let validate = || {
        crate::validator::validate_knowledge_graph(crate::validator::ValidationInput {
            graph,
            fragments: &context.candidate.fragments,
            expected_domain_id: Some(domain_id),
            human_projection: Some(&human_projection),
        })
    };
    let report = validate();
    if !report.ok {
        return Err(blocked(
            "validate",
            domain_id,
            validator_diagnostics(&report.diagnostics),
        ));
    }

    let staging_path = std::env::temp_dir()
        .join("n-rules-package-knowledge")
        .join(&domain_fingerprint(domain_id)[7..])
        .join(&context.source_fingerprint[7..]);
    write_shadow_candidate(&staging_path, &files).map_err(|error| {
        blocked(
            "shadow",
            domain_id,
            detail_diagnostics([("shadow-write-failed", error.to_string().as_str(), None)]),
        )
    })?;
    let report = BuildReport {
        mode: if input.publish {
            BuildMode::Published
        } else {
            BuildMode::Shadow
        },
        domain_id: domain_id.to_string(),
        cache_path: context.cache_path(),
        staging_path,
        files: files.keys().cloned().collect(),
    };
    if !input.publish {
        return Ok(report);
    }
    // Публікатор валідує ПОВТОРНО, вже після викладки у тимчасове дерево —
    // тому та сама перевірка передається йому замикачем. Аргумент `files`
    // тут не читається свідомо: валідується граф, а не його проєкція.
    let revalidate = |_: &BTreeMap<String, String>| {
        let report = validate();
        if report.ok {
            return crate::publish::ValidationOutcome::Passed;
        }
        // Форма діагностик публікатора не має слота під ID твердження, тож
        // тут він губиться. Гілка захисна: граф той самий, що вже пройшов
        // стадію `validate` вище, — щоб дійти сюди, валідація мусила б бути
        // недетермінованою.
        crate::publish::ValidationOutcome::Failed(
            report
                .diagnostics
                .iter()
                .map(|item| crate::publish::Diagnostic {
                    code: item.code.clone(),
                    detail: item.message.clone(),
                    path: None,
                })
                .collect(),
        )
    };
    match crate::publish::publish_knowledge_artifacts(&context.domain.root, &files, &revalidate) {
        crate::publish::PublishOutcome::Published => Ok(report),
        crate::publish::PublishOutcome::Blocked(diagnostics) => Err(blocked(
            "publish",
            domain_id,
            diagnostics
                .iter()
                .map(|item| json!({ "code": item.code, "detail": item.detail, "path": item.path }))
                .collect(),
        )),
    }
}

fn validator_diagnostics(items: &[crate::validator::Diagnostic]) -> Vec<Value> {
    items
        .iter()
        .map(|item| json!({ "code": item.code, "message": item.message, "id": item.id }))
        .collect()
}

/// Збирає один домен package knowledge — порт `buildPackageKnowledge`.
///
/// Типовий режим — SHADOW: кандидат валідується й матеріалізується під
/// системним кешем, НІКОЛИ під `docs/` домену. `publish: true` — єдиний
/// шлях, що кличе атомарний публікатор.
pub async fn build_package_knowledge(input: BuildInput<'_>) -> BuildOutcome {
    if input.domain_id.is_empty() {
        return BuildOutcome::Blocked {
            stage: "input".to_string(),
            domain_id: String::new(),
            diagnostics: vec![json!({
                "code": "domain-required",
                "message": "Потрібні repoRoot і --domain <id>.",
            })],
        };
    }
    let finish = |blocked: Blocked| BuildOutcome::Blocked {
        stage: blocked.stage,
        domain_id: blocked.domain_id,
        diagnostics: blocked.diagnostics,
    };
    let context = match load_build_context(&input) {
        Ok(context) => context,
        Err(error) => return finish(error),
    };
    let implemented = match add_implemented_claims(&input, &context).await {
        Ok(graph) => graph,
        Err(error) => return finish(error),
    };
    let layered = match add_expected_and_gaps(&input, &context, implemented).await {
        Ok(graph) => graph,
        Err(error) => return finish(error),
    };
    match materialize_build(&input, &context, &layered) {
        Ok(report) => BuildOutcome::Built(report),
        Err(error) => finish(error),
    }
}
