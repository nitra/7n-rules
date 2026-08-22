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
use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};

use crate::deterministic::js_locale_cmp;
use crate::gap_mappings::Mapping;
use crate::planner::{Chunk, EdgeEvidence, UnitSlice};
use crate::sources::SourceFile;
use crate::zones::{parse_knowledge_zones, Diagnostic as ZoneDiagnostic};

/// Provenance парсера одного екстрактора — частина ключів кешу.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParserProvenance {
    pub id: String,
    pub grammar_version: String,
    pub runtime_version: String,
}

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
