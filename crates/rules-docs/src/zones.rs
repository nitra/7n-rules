//! Зони згенерованого Markdown — порт `zones.mjs`.
//!
//! Строгі маркери, стабільні ID і хеші вмісту не дають генератору мовчки
//! переписати authored-текст чи явні очікування. Текст ПОЗА явними зонами —
//! теж захищений: він повертається окремо (`implicit_manual`), щоб публікатор
//! міг зберегти його побайтово.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use regex::Regex;

/// Маркер зони: вид, дія, стабільний id і (лише для AUTOGEN) хеш вмісту.
static MARKER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"<!--\s*(AUTOGEN|MANUAL|EXPECTED):(start|end)\s+id="([a-z][a-z0-9-]{0,127})"(?:\s+hash="(sha256:[a-f0-9]{64})")?\s*-->"#,
    )
    .expect("маркерна регулярка коректна")
});

/// Будь-що, СХОЖЕ на маркер зони. Потрібне окремо: маркер із поламаним id чи
/// невідомим видом мусить стати діагностикою, а не мовчки лишитись текстом.
static ZONE_LIKE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<!--\s*([A-Z]+):(start|end)\b").expect("регулярка коректна"));

/// Види зон, які підтримує формат.
const KINDS: [&str; 3] = ["AUTOGEN", "MANUAL", "EXPECTED"];

/// Діагностика зон.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub code: String,
    pub detail: String,
    pub path: Option<String>,
}

impl Diagnostic {
    fn new(code: &str, detail: &str, path: Option<&str>) -> Self {
        Self {
            code: code.to_string(),
            detail: detail.to_string(),
            path: path.map(str::to_string),
        }
    }
}

/// Розібрана зона.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Zone {
    pub kind: String,
    pub id: String,
    pub hash: Option<String>,
    pub content: String,
    /// Байтові межі ВСЬОГО блоку разом із маркерами.
    pub start: usize,
    pub end: usize,
    /// Байтові межі самого вмісту.
    pub content_start: usize,
    pub content_end: usize,
}

/// Результат розбору документа.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedZones {
    pub zones: Vec<Zone>,
    /// Текст поза явними зонами — рівно ті шматки, які публікатор мусить
    /// зберегти незмінними.
    pub implicit_manual: Vec<String>,
}

/// Стабільний хеш вмісту зони — порт `zoneHash`.
#[must_use]
pub fn zone_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(content.as_bytes());
    let mut hex = String::with_capacity(64);
    for byte in digest.iter() {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("sha256:{hex}")
}

/// Знайдений маркер.
struct Marker {
    kind: String,
    action: String,
    id: String,
    hash: Option<String>,
    start: usize,
    end: usize,
}

/// Розбирає строгі маркери зон і перевіряє парність, унікальність ID та хеші
/// AUTOGEN — порт `parseKnowledgeZones`.
///
/// # Errors
/// Будь-яке порушення формату; діагностики повертаються В ПОРЯДКУ ВИЯВЛЕННЯ
/// (як у JS), бо він відповідає порядку читання документа.
pub fn parse_knowledge_zones(
    markdown: &str,
    path: Option<&str>,
) -> Result<ParsedZones, Vec<Diagnostic>> {
    let mut diagnostics = Vec::new();
    let markers: Vec<Marker> = MARKER_RE
        .captures_iter(markdown)
        .map(|capture| {
            let whole = capture.get(0).expect("група 0 завжди є");
            Marker {
                kind: capture[1].to_string(),
                action: capture[2].to_string(),
                id: capture[3].to_string(),
                hash: capture.get(4).map(|hash| hash.as_str().to_string()),
                start: whole.start(),
                end: whole.end(),
            }
        })
        .collect();
    let valid_starts: Vec<usize> = markers.iter().map(|marker| marker.start).collect();

    for capture in ZONE_LIKE_RE.captures_iter(markdown) {
        let kind = &capture[1];
        let start = capture.get(0).expect("група 0 завжди є").start();
        if !KINDS.contains(&kind) {
            diagnostics.push(Diagnostic::new(
                "unsupported-zone-kind",
                &format!("Zone kind {kind} не підтримується."),
                path,
            ));
        } else if !valid_starts.contains(&start) {
            diagnostics.push(Diagnostic::new(
                "invalid-zone-marker",
                &format!(
                    "Marker {}:{} має невалідний stable id або attributes.",
                    kind, &capture[2]
                ),
                path,
            ));
        }
    }

    let mut zones = Vec::new();
    let mut implicit_manual = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    let mut cursor = 0usize;
    let mut open: Option<&Marker> = None;

    for marker in &markers {
        if marker.action == "start" {
            if let Some(open_marker) = open {
                diagnostics.push(Diagnostic::new(
                    "nested-zone",
                    &format!(
                        "Zone {}:{} вкладена в {}:{}.",
                        marker.kind, marker.id, open_marker.kind, open_marker.id
                    ),
                    path,
                ));
                continue;
            }
            if ids.contains(&marker.id) {
                diagnostics.push(Diagnostic::new(
                    "duplicate-zone-id",
                    &format!("Zone id \"{}\" не є stable unique.", marker.id),
                    path,
                ));
            }
            ids.push(marker.id.clone());
            if marker.kind == "AUTOGEN" && marker.hash.is_none() {
                diagnostics.push(Diagnostic::new(
                    "missing-zone-hash",
                    &format!("AUTOGEN {} не має hash.", marker.id),
                    path,
                ));
            }
            if marker.kind != "AUTOGEN" && marker.hash.is_some() {
                diagnostics.push(Diagnostic::new(
                    "protected-zone-hash",
                    &format!("{} {} не може мати generated hash.", marker.kind, marker.id),
                    path,
                ));
            }
            implicit_manual.push(markdown[cursor..marker.start].to_string());
            open = Some(marker);
            continue;
        }

        if marker.hash.is_some() {
            diagnostics.push(Diagnostic::new(
                "end-zone-hash",
                &format!("End marker {} не може мати hash.", marker.id),
                path,
            ));
        }
        let Some(open_marker) = open else {
            diagnostics.push(Diagnostic::new(
                "orphan-zone-end",
                &format!("End marker {}:{} не має start.", marker.kind, marker.id),
                path,
            ));
            continue;
        };
        if open_marker.kind != marker.kind || open_marker.id != marker.id {
            diagnostics.push(Diagnostic::new(
                "mismatched-zone-end",
                &format!(
                    "Start {}:{} не збігається з end {}:{}.",
                    open_marker.kind, open_marker.id, marker.kind, marker.id
                ),
                path,
            ));
            open = None;
            continue;
        }
        let content = markdown[open_marker.end..marker.start].to_string();
        if open_marker.kind == "AUTOGEN"
            && open_marker.hash.as_deref() != Some(&zone_hash(&content))
        {
            diagnostics.push(Diagnostic::new(
                "zone-hash-mismatch",
                &format!("AUTOGEN {} має змінений content або hash.", open_marker.id),
                path,
            ));
        }
        zones.push(Zone {
            kind: open_marker.kind.clone(),
            id: open_marker.id.clone(),
            hash: open_marker.hash.clone(),
            content,
            start: open_marker.start,
            end: marker.end,
            content_start: open_marker.end,
            content_end: marker.start,
        });
        cursor = marker.end;
        open = None;
    }

    if let Some(open_marker) = open {
        diagnostics.push(Diagnostic::new(
            "unclosed-zone",
            &format!(
                "Zone {}:{} не має end marker.",
                open_marker.kind, open_marker.id
            ),
            path,
        ));
    }
    implicit_manual.push(markdown[cursor..].to_string());

    if diagnostics.is_empty() {
        Ok(ParsedZones {
            zones,
            implicit_manual,
        })
    } else {
        Err(diagnostics)
    }
}

/// Записує вміст ЛИШЕ в оголошені AUTOGEN-зони й перераховує їхні хеші —
/// порт `applyAutogenUpdates`.
///
/// Захищений і неявний manual-текст ніколи не стає ціллю запису: спроба
/// писати в `MANUAL`/`EXPECTED` — діагностика, а не тиха відмова.
///
/// Значення оновлень — `String`: JS додатково перевіряв `typeof !== 'string'`
/// (`invalid-generated-content`), у Rust цей стан нерепрезентовний.
///
/// # Errors
/// Невідомий id зони, спроба писати в захищену зону або будь-яка помилка
/// розбору документа.
pub fn apply_autogen_updates(
    markdown: &str,
    updates: &BTreeMap<String, String>,
    path: Option<&str>,
) -> Result<String, Vec<Diagnostic>> {
    let parsed = parse_knowledge_zones(markdown, path)?;
    let mut diagnostics = Vec::new();
    for id in updates.keys() {
        match parsed.zones.iter().find(|zone| &zone.id == id) {
            None => diagnostics.push(Diagnostic::new(
                "unknown-zone-id",
                &format!("AUTOGEN {id} не знайдено."),
                path,
            )),
            Some(zone) if zone.kind != "AUTOGEN" => diagnostics.push(Diagnostic::new(
                "protected-zone-write",
                &format!("Не можна generated content записати в {} {id}.", zone.kind),
                path,
            )),
            Some(_) => {}
        }
    }
    if !diagnostics.is_empty() {
        return Err(diagnostics);
    }

    // Заміна йде З КІНЦЯ документа: інакше кожна вставка зсувала б байтові
    // межі наступних зон.
    let mut result = markdown.to_string();
    for zone in parsed
        .zones
        .iter()
        .filter(|zone| updates.contains_key(&zone.id))
        .rev()
    {
        let content = &updates[&zone.id];
        let start = format!(
            "<!-- AUTOGEN:start id=\"{}\" hash=\"{}\" -->",
            zone.id,
            zone_hash(content)
        );
        let end = format!("<!-- AUTOGEN:end id=\"{}\" -->", zone.id);
        result = format!(
            "{}{start}{content}{end}{}",
            &result[..zone.start],
            &result[zone.end..]
        );
    }
    Ok(result)
}

/// Перевіряє, що кандидат зберіг КОЖЕН захищений і неявний manual-байт —
/// порт `assertProtectedZonesPreserved`.
///
/// # Errors
/// Змінена/видалена захищена зона або будь-яка зміна тексту поза явними
/// зонами.
pub fn assert_protected_zones_preserved(
    previous: &str,
    candidate: &str,
    path: Option<&str>,
) -> Result<(), Vec<Diagnostic>> {
    let left = parse_knowledge_zones(previous, path)?;
    let right = parse_knowledge_zones(candidate, path)?;
    let mut diagnostics = Vec::new();
    let next_protected: Vec<&Zone> = right
        .zones
        .iter()
        .filter(|zone| zone.kind != "AUTOGEN")
        .collect();
    for zone in left.zones.iter().filter(|zone| zone.kind != "AUTOGEN") {
        let next = next_protected
            .iter()
            .find(|candidate| candidate.id == zone.id);
        let preserved =
            next.is_some_and(|next| next.kind == zone.kind && next.content == zone.content);
        if !preserved {
            diagnostics.push(Diagnostic::new(
                "protected-zone-modified",
                &format!(
                    "{} {} змінено або видалено generated candidate-ом.",
                    zone.kind, zone.id
                ),
                path,
            ));
        }
    }
    if left.implicit_manual != right.implicit_manual {
        diagnostics.push(Diagnostic::new(
            "implicit-manual-modified",
            "Generated candidate змінив текст поза explicit zones.",
            path,
        ));
    }
    if diagnostics.is_empty() {
        Ok(())
    } else {
        Err(diagnostics)
    }
}
