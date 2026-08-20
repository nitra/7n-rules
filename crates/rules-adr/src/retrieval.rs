//! cspell:ignore яіїєґ Jaccard прийнят прийн зроблен слаг капчерний stopwords vibir servera капчера zovsim inshe vybir
//! Stage 0 — лексичний retrieval (без LLM): токенізація, Jaccard,
//! кандидати-ребра, заголовок драфта, no-decision гейт. Порт
//! `normalize-pipeline.mjs` (розділ «Stage 0: retrieval»).

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;

/// Стоп-слова токенізації — порт `STOP`.
const STOP: &[&str] = &[
    "adr",
    "та",
    "для",
    "через",
    "на",
    "в",
    "у",
    "з",
    "із",
    "до",
    "і",
    "й",
    "the",
    "a",
    "of",
    "md",
];

static RE_MD_EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.md$").expect("regex"));
static RE_TS_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{6,8}-\d{4,6}-").expect("regex"));
static RE_TOKEN_SPLIT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)[^a-zа-яіїєґ0-9]+").expect("regex"));
static RE_DRAFT_ADR_TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^#{1,2}\s+ADR\s+(.+)$").expect("regex"));
static RE_H1: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^#\s+(.+)$").expect("regex"));
static MADR_SECTION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(Context and Problem|Considered Options|Decision Outcome|Consequences|More Information|report|summary|Attempt|Reason|Update)\b").expect("regex")
});
static RE_DECISION_SECTION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)##\s*Decision Outcome\s*(.{0,500})").expect("regex"));
static RE_NO_DECISION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(не\s+обрано|не\s+прийнят|рішення\s+не\s+прийн|не\s+зроблен|no\s+decision|undecided)",
    )
    .expect("regex")
});

/// Назва clean-ADR → людський заголовок (без `.md` і timestamp-префікса) —
/// порт `stripAdrName`.
#[must_use]
pub fn strip_adr_name(s: &str) -> String {
    let no_ext = RE_MD_EXT.replace(s, "");
    RE_TS_PREFIX.replace(&no_ext, "").into_owned()
}

/// Токенізує назву/слаг у множину значущих токенів — порт `tokenize`.
#[must_use]
pub fn tokenize(s: &str) -> HashSet<String> {
    let lowered = s.to_lowercase();
    let no_ext = RE_MD_EXT.replace(&lowered, "");
    let cleaned = RE_TS_PREFIX.replace(&no_ext, "");
    RE_TOKEN_SPLIT
        .split(&cleaned)
        .filter(|t| t.chars().count() > 2 && !STOP.contains(t))
        .map(str::to_string)
        .collect()
}

/// Jaccard-схожість двох множин токенів — порт `jaccard`.
#[must_use]
pub fn jaccard(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.iter().filter(|t| b.contains(*t)).count();
    inter as f64 / (a.len() + b.len() - inter) as f64
}

/// Витягує заголовок драфта — порт `draftTitle`: рядок капчера `## ADR <title>`
/// у пріоритеті, fallback — перший h1, що не є MADR-секцією, інакше ''.
#[must_use]
pub fn draft_title(body: &str) -> String {
    if let Some(captures) = RE_DRAFT_ADR_TITLE.captures(body) {
        return captures[1].trim().to_string();
    }
    for captures in RE_H1.captures_iter(body) {
        let title = captures[1].trim();
        if !MADR_SECTION.is_match(title) {
            return title.to_string();
        }
    }
    String::new()
}

/// Детермінований no-decision гейт — порт `isNoDecision`: чернетка, де в
/// `Decision Outcome` рішення явно не прийняте, не варта окремого ADR.
#[must_use]
pub fn is_no_decision(body: &str) -> bool {
    let Some(captures) = RE_DECISION_SECTION.captures(body) else {
        return false;
    };
    RE_NO_DECISION.is_match(&captures[1])
}

/// Ребра-кандидати retrieval-у.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Edges {
    /// draft↔draft (пари індексів, i < j).
    pub dd: Vec<(usize, usize)>,
    /// draft↔clean (індекс драфта, basename clean-ADR).
    pub dc: Vec<(usize, String)>,
}

/// Порт `buildEdges` з дефолтами `simThreshold: 0.12`, `topKClean: 3`.
#[must_use]
pub fn build_edges(drafts: &[(String, String)], clean_list: &[String]) -> Edges {
    const SIM_THRESHOLD: f64 = 0.12;
    const TOP_K_CLEAN: usize = 3;

    let draft_tok: Vec<HashSet<String>> = drafts
        .iter()
        .map(|(file, body)| tokenize(&format!("{file} {}", draft_title(body))))
        .collect();
    let clean_tok: Vec<(&String, HashSet<String>)> =
        clean_list.iter().map(|c| (c, tokenize(c))).collect();

    let mut dd = Vec::new();
    for i in 0..drafts.len() {
        for j in (i + 1)..drafts.len() {
            if jaccard(&draft_tok[i], &draft_tok[j]) >= SIM_THRESHOLD {
                dd.push((i, j));
            }
        }
    }
    let mut dc = Vec::new();
    for (i, tokens) in draft_tok.iter().enumerate() {
        let mut scored: Vec<(&String, f64)> = clean_tok
            .iter()
            .filter_map(|(c, tok)| {
                let s = jaccard(tokens, tok);
                (s >= SIM_THRESHOLD).then_some((*c, s))
            })
            .collect();
        // Стабільне сортування за спаданням score — порт `sort((a,b)=>b[1]-a[1])`
        // (JS sort стабільний, рівні score лишаються у вхідному порядку).
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        for (c, _) in scored.into_iter().take(TOP_K_CLEAN) {
            dc.push((i, c.clone()));
        }
    }
    Edges { dd, dc }
}

/// `captured`-frontmatter-поле драфта — порт `captureField(body, 'captured')`.
#[must_use]
pub fn capture_field(body: &str, field: &str) -> Option<String> {
    let re = Regex::new(&format!(r"(?m)^{}:\s*(.+)$", regex::escape(field))).ok()?;
    re.captures(body)
        .map(|captures| captures[1].trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_strips_stopwords_short_tokens_and_prefixes() {
        let tokens = tokenize("260801-1200-vibir-omlx-servera.md");
        assert!(tokens.contains("vibir"));
        assert!(tokens.contains("omlx"));
        assert!(tokens.contains("servera"));
        assert!(!tokens.contains("md"), "стоп-слово");
        assert!(!tokens.iter().any(|t| t.chars().count() <= 2));
    }

    #[test]
    fn jaccard_boundaries() {
        let a = tokenize("omlx server vibir");
        let b = tokenize("omlx server vibir");
        assert!((jaccard(&a, &b) - 1.0).abs() < f64::EPSILON);
        assert!(jaccard(&a, &HashSet::new()).abs() < f64::EPSILON);
    }

    #[test]
    fn draft_title_prefers_adr_line_then_non_madr_h1() {
        assert_eq!(draft_title("## ADR Вибір сервера\nтекст"), "Вибір сервера");
        assert_eq!(
            draft_title("# Context and Problem\nx\n# Реальний заголовок\n"),
            "Реальний заголовок"
        );
        assert_eq!(draft_title("без заголовків"), "");
    }

    #[test]
    fn no_decision_gate_matches_ukrainian_phrases() {
        let body = "## Decision Outcome\nрішення не прийнято, transcript обірвався";
        assert!(is_no_decision(body));
        assert!(!is_no_decision("## Decision Outcome\nобрано варіант Б"));
        assert!(!is_no_decision("немає секції"));
    }

    #[test]
    fn edges_respect_threshold_and_top_k() {
        let drafts = vec![
            ("a-omlx-server.md".to_string(), String::new()),
            ("b-omlx-server.md".to_string(), String::new()),
            ("c-zovsim-inshe-pro-git.md".to_string(), String::new()),
        ];
        let clean = vec![
            "260101-1200-omlx-server-vybir.md".to_string(),
            "260102-1200-git-hooks.md".to_string(),
        ];
        let edges = build_edges(&drafts, &clean);
        assert!(edges.dd.contains(&(0, 1)), "{:?}", edges.dd);
        assert!(!edges.dd.contains(&(0, 2)));
        assert!(edges.dc.iter().any(|(i, c)| *i == 0 && c.contains("omlx")));
        assert!(edges.dc.iter().any(|(i, c)| *i == 2 && c.contains("git")));
    }

    #[test]
    fn capture_field_reads_frontmatter_line() {
        assert_eq!(
            capture_field("session: x\ncaptured: 2026-08-01T12:00:00Z\n", "captured").as_deref(),
            Some("2026-08-01T12:00:00Z")
        );
        assert!(capture_field("без поля", "captured").is_none());
    }
}
