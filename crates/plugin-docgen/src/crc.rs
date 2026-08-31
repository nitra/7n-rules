//! Порт `npm/rules/doc-files/docgen-crc/main.mjs` (219 рядків) — CRC32 джерела,
//! парсинг frontmatter доки, `staleness()`.
//!
//! # Рішення: диск чи параметр (задача фази 2)
//! JS-оригінал читає диск НАПРЯМУ у трьох функціях: `documentationCrc`
//! (`readFileSync(sourceAbsPath)`), `readDocCrc`/`readDocQuality`/`readDocModel`/
//! `readDocTier` (`existsSync`+`readFileSync(docAbsPath)`). Жоден консюмер цього
//! кроку (`docgen-stage` слот-диспетчер — майбутня робота, §5.4
//! `docs/specs/2026-08-31-recon-docgen-surface.md`) ще не існує, тож підключати
//! `n-rules:caps/file-reader@1.0.0` до `docgen-guest.wit` заради непідключеного
//! коду суперечило б власному принципу проєкту «не вигадувати потребу, а
//! відповісти на неї» (той самий принцип, застосований до `llm-consumer`,
//! реєстр §2.124, і повторений розвідкою §5.1). Тому порт МІНЯЄ форму функцій:
//! замість `sourceAbsPath: string` / `docAbsPath: string` (шлях, який функція
//! сама читає) — параметри вже прочитаного вмісту (`&[u8]` / `Option<&str>`,
//! де `None` означає «доки немає», дзеркало `existsSync`-гілки). Коли
//! `docgen-stage` матеріалізується як реальний консюмер, ці сигнатури
//! підключаються до `file-reader` без переписування самої логіки.
//!
//! `pluginDocFilesExtensions` (динамічний slot-граф плагінів, `.n-rules.json`,
//! потенційний `import()` JS-екстракторів) не має Rust-еквіваленту в гості —
//! [`build_doc_frontmatter`]/[`stamp_doc`] тому приймають вже вирішений
//! `type_label: &str` параметром замість резолву `typeForSource` зсередини.
//!
//! `QUALITY_THRESHOLD` (env `N_CURSOR_DOC_FILES_THRESHOLD`) — гість не має
//! host-каналу для env (те саме обмеження, що вже задокументоване для
//! `JUDGE_CONFIDENCE`, `crates/plugin-docgen/src/lib.rs`); [`QUALITY_THRESHOLD`]
//! тут — константа з тим самим дефолтом (70), що JS БЕЗ env-перевизначення.

use regex::Regex;
use std::sync::OnceLock;

/// Поріг degraded: дока зі `score` нижче вважається неякісною. Дефолт JS
/// БЕЗ env-перевизначення (доккомент модуля).
pub const QUALITY_THRESHOLD: u32 = 70;

/// CRC-32/ISO-HDLC (той самий алгоритм, що `node:zlib.crc32`): поліном
/// 0xEDB88320 (reflected), init 0xFFFFFFFF, final XOR 0xFFFFFFFF. Таблична
/// реалізація замість нового Cargo-dep (`dev-dep.mdc`: не розширювати
/// поверхню залежностей без причини) — алгоритм фіксований і компактний.
fn crc32_table() -> &'static [u32; 256] {
    static TABLE: OnceLock<[u32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0u32; 256];
        let mut i = 0u32;
        while i < 256 {
            let mut c = i;
            let mut k = 0;
            while k < 8 {
                c = if c & 1 != 0 {
                    0xEDB8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
                k += 1;
            }
            table[i as usize] = c;
            i += 1;
        }
        table
    })
}

/// CRC32 вмісту у hex (8 символів, з провідними нулями) — порт `crc32`
/// (`main.mjs:18-21`), делегує у `node:zlib.crc32` там; тут — власна
/// таблична реалізація (доккомент [`crc32_table`]).
pub fn crc32(input: &[u8]) -> String {
    let table = crc32_table();
    let mut c: u32 = 0xFFFF_FFFF;
    for &byte in input {
        c = table[((c ^ byte as u32) & 0xFF) as usize] ^ (c >> 8);
    }
    format!("{:08x}", c ^ 0xFFFF_FFFF)
}

/// CRC повного evidence для файлової доки — порт `documentationCrc`
/// (`main.mjs:31-36`). `source` — вже прочитаний вміст source-файлу (не шлях,
/// доккомент модуля); `crc_payload` — `testEvidenceForSource(...).crcPayload`
/// з `crate::test_context`, порожній рядок або `None` — без пов'язаних тестів.
pub fn documentation_crc(source: &[u8], crc_payload: Option<&str>) -> String {
    match crc_payload {
        Some(payload) if !payload.is_empty() => {
            let mut buf = source.to_vec();
            buf.extend_from_slice(payload.as_bytes());
            crc32(&buf)
        }
        _ => crc32(source),
    }
}

/// Провідний YAML-frontmatter-блок `---\n…\n---`.
fn frontmatter_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)^---\n(.*?)\n---\n?").expect("FRONTMATTER_RE"))
}

fn field_re(name: &str) -> Regex {
    Regex::new(&format!(r"(?m)^[ \t]{{0,8}}{name}:[ \t]{{0,8}}(.+)$")).expect("field regex")
}

fn resource_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)^resource:[ \t]+(\S.*)$").expect("RESOURCE_RE"))
}

/// Метадані frontmatter доки — структурний відповідник обʼєкта `data` у
/// `parseDocFrontmatter` (`main.mjs:57-81`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DocFrontmatter {
    pub source: Option<String>,
    pub crc: Option<String>,
    pub model: Option<String>,
    pub tier: Option<String>,
    pub score: Option<u32>,
    pub issues: Vec<String>,
    pub judge_model: Option<String>,
}

/// Парсить frontmatter файлової доки — порт `parseDocFrontmatter`
/// (`main.mjs:57-81`). Без блоку — `(None, md)`, `body` дорівнює входу.
pub fn parse_doc_frontmatter(md: &str) -> (Option<DocFrontmatter>, String) {
    let Some(m) = frontmatter_re().captures(md) else {
        return (None, md.to_string());
    };
    let whole = m.get(0).expect("group 0 завжди присутня");
    let block = m.get(1).map(|g| g.as_str()).unwrap_or_default();

    let score = field_re("score")
        .captures(block)
        .and_then(|c| c.get(1))
        .and_then(|v| v.as_str().trim().parse::<u32>().ok());
    let issues_raw = field_re("issues")
        .captures(block)
        .and_then(|c| c.get(1))
        .map(|v| v.as_str().trim().to_string());
    let source = resource_re()
        .captures(block)
        .and_then(|c| c.get(1))
        .map(|v| v.as_str().trim().to_string());

    let data = DocFrontmatter {
        source,
        crc: field_re("crc")
            .captures(block)
            .and_then(|c| c.get(1))
            .map(|v| v.as_str().trim().to_string()),
        model: field_re("model")
            .captures(block)
            .and_then(|c| c.get(1))
            .map(|v| v.as_str().trim().to_string()),
        tier: field_re("tier")
            .captures(block)
            .and_then(|c| c.get(1))
            .map(|v| v.as_str().trim().to_string()),
        score,
        issues: issues_raw
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
        judge_model: field_re("judgeModel")
            .captures(block)
            .and_then(|c| c.get(1))
            .map(|v| v.as_str().trim().to_string()),
    };
    (Some(data), md[whole.end()..].to_string())
}

/// Максимум кодів issues у frontmatter — той самий ліміт, що JS `MAX_ISSUE_CODES`.
const MAX_ISSUE_CODES: usize = 8;

/// Нормалізує issues до YAML-безпечних кодів — порт `issueCodes`
/// (`main.mjs:106-111`).
fn issue_codes(issues: &[String]) -> Vec<String> {
    issues
        .iter()
        .map(|i| {
            let head = i.split(' ').next().unwrap_or("");
            head.trim_end_matches([',', ':']).to_string()
        })
        .filter(|s| !s.is_empty())
        .take(MAX_ISSUE_CODES)
        .collect()
}

/// Det-оцінка доки для frontmatter — структурний відповідник `quality`
/// (`main.mjs::buildDocFrontmatter`).
#[derive(Debug, Clone, Default)]
pub struct DocQualityInput<'a> {
    pub score: u32,
    pub issues: &'a [String],
    pub judge_model: Option<&'a str>,
}

/// Будує OKF-сумісний frontmatter-блок — порт `buildDocFrontmatter`
/// (`main.mjs:124-139`). `type_label` — вже вирішений `typeForSource(...)`
/// результат (доккомент модуля: гість не резолвить plugin slot graph сам).
pub fn build_doc_frontmatter(
    source: &str,
    crc: &str,
    quality: Option<&DocQualityInput>,
    model: Option<&str>,
    tier: Option<&str>,
    type_label: &str,
) -> String {
    let basename = source.rsplit('/').next().unwrap_or(source);
    let okf_lines = [
        format!("type: {type_label}"),
        format!("title: {basename}"),
        format!("resource: {source}"),
    ];

    let mut docgen_lines = vec![format!("crc: {crc}")];
    if let Some(m) = model {
        docgen_lines.push(format!("model: {m}"));
    }
    if let Some(t) = tier {
        docgen_lines.push(format!("tier: {t}"));
    }
    if let Some(q) = quality {
        docgen_lines.push(format!("score: {}", q.score));
        let codes = issue_codes(q.issues);
        if !codes.is_empty() {
            docgen_lines.push(format!("issues: {}", codes.join(",")));
        }
        if let Some(jm) = q.judge_model {
            docgen_lines.push(format!("judgeModel: {jm}"));
        }
    }
    let indented = docgen_lines
        .iter()
        .map(|l| format!("  {l}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "---\n{}\ndocgen:\n{}\n---\n",
        okf_lines.join("\n"),
        indented
    )
}

fn leading_newlines_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\n+").expect("LEADING_NEWLINES_RE"))
}

fn leading_h1_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^# [^\n]*\n+").expect("LEADING_H1_RE"))
}

/// (Пере)штампує frontmatter у md-доку — порт `stampDoc` (`main.mjs:153-157`).
pub fn stamp_doc(
    md: &str,
    source: &str,
    crc: &str,
    quality: Option<&DocQualityInput>,
    model: Option<&str>,
    tier: Option<&str>,
    type_label: &str,
) -> String {
    let (_, body) = parse_doc_frontmatter(md);
    let clean_body = leading_h1_re()
        .replace(&leading_newlines_re().replace(&body, ""), "")
        .to_string();
    format!(
        "{}\n{clean_body}",
        build_doc_frontmatter(source, crc, quality, model, tier, type_label)
    )
}

/// CRC, збережений у frontmatter доки — порт `readDocCrc` (`main.mjs:164-167`),
/// параметр `doc_content: None` дзеркалить `!existsSync(docAbsPath)` (доккомент
/// модуля: диск читає викликач, не ця функція).
pub fn read_doc_crc(doc_content: Option<&str>) -> Option<String> {
    doc_content
        .and_then(|md| parse_doc_frontmatter(md).0)
        .and_then(|d| d.crc)
}

/// Якість, збережена у frontmatter доки — порт `readDocQuality`
/// (`main.mjs:174-182`).
pub fn read_doc_quality(doc_content: Option<&str>) -> (Option<u32>, Vec<String>, Option<String>) {
    match doc_content.and_then(|md| parse_doc_frontmatter(md).0) {
        Some(d) => (d.score, d.issues, d.judge_model),
        None => (None, Vec::new(), None),
    }
}

/// Модель-генератор зі frontmatter доки — порт `readDocModel` (`main.mjs:190-193`).
pub fn read_doc_model(doc_content: Option<&str>) -> Option<String> {
    doc_content
        .and_then(|md| parse_doc_frontmatter(md).0)
        .and_then(|d| d.model)
}

/// Tier моделі-генератора зі frontmatter доки — порт `readDocTier`
/// (`main.mjs:200-203`).
pub fn read_doc_tier(doc_content: Option<&str>) -> Option<String> {
    doc_content
        .and_then(|md| parse_doc_frontmatter(md).0)
        .and_then(|d| d.tier)
}

/// Причина застарілості — дзеркало JS `'missing'|'crc-mismatch'|null`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StalenessReason {
    Missing,
    CrcMismatch,
}

/// Стан застарілості доки відносно evidence — порт `staleness`
/// (`main.mjs:213-219`). `doc_content: None` — доки немає (`missing`);
/// `source` + `crc_payload` — вже прочитаний вміст source-файлу і
/// `testEvidenceForSource(...).crcPayload` (доккомент модуля).
pub fn staleness(
    doc_content: Option<&str>,
    source: &[u8],
    crc_payload: Option<&str>,
) -> (bool, Option<StalenessReason>) {
    let Some(doc_crc) = read_doc_crc(doc_content) else {
        return (true, Some(StalenessReason::Missing));
    };
    let src_crc = documentation_crc(source, crc_payload);
    if src_crc != doc_crc {
        return (true, Some(StalenessReason::CrcMismatch));
    }
    (false, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_matches_known_test_vector() {
        // Класичний CRC-32/ISO-HDLC вектор — той самий, що
        // `npm/rules/doc-files/docgen-crc/tests/docgen-crc.test.mjs:34`.
        assert_eq!(crc32(b"123456789"), "cbf43926");
    }

    #[test]
    fn crc32_deterministic_and_sensitive_to_content() {
        assert_eq!(
            crc32(b"export const a = 1\n"),
            crc32(b"export const a = 1\n")
        );
        assert_ne!(crc32(b"a"), crc32(b"b"));
    }

    #[test]
    fn parse_doc_frontmatter_roundtrip() {
        let md = "---\ntype: JS Module\ntitle: main.mjs\nresource: src/main.mjs\ndocgen:\n  crc: abcd1234\n  model: local-min\n  score: 85\n  issues: R1,R2:\n---\n\nбоді\n";
        let (data, body) = parse_doc_frontmatter(md);
        let data = data.expect("frontmatter must parse");
        assert_eq!(data.source.as_deref(), Some("src/main.mjs"));
        assert_eq!(data.crc.as_deref(), Some("abcd1234"));
        assert_eq!(data.model.as_deref(), Some("local-min"));
        assert_eq!(data.score, Some(85));
        // `parseDocFrontmatter` НЕ зрізає хвости (`main.mjs:71-76`) — те
        // саме робить лише `issueCodes` на боці `buildDocFrontmatter`
        // (`main.mjs:106-111`), тому "R2:" лишається як є тут.
        assert_eq!(data.issues, vec!["R1".to_string(), "R2:".to_string()]);
        assert_eq!(body, "\nбоді\n");
    }

    #[test]
    fn parse_doc_frontmatter_missing_block_returns_none_data() {
        let (data, body) = parse_doc_frontmatter("# Заголовок\nтекст\n");
        assert!(data.is_none());
        assert_eq!(body, "# Заголовок\nтекст\n");
    }

    #[test]
    fn build_and_parse_doc_frontmatter_are_inverse_on_crc() {
        let quality = DocQualityInput {
            score: 90,
            issues: &[],
            judge_model: None,
        };
        let fm = build_doc_frontmatter(
            "src/foo.rs",
            "deadbeef",
            Some(&quality),
            Some("local-min"),
            Some("local"),
            "Rust Module",
        );
        let (data, _) = parse_doc_frontmatter(&fm);
        let data = data.expect("must parse own output");
        assert_eq!(data.crc.as_deref(), Some("deadbeef"));
        assert_eq!(data.score, Some(90));
        assert_eq!(data.source.as_deref(), Some("src/foo.rs"));
    }

    #[test]
    fn stamp_doc_strips_old_frontmatter_and_leading_h1() {
        let old = "---\nresource: a\ndocgen:\n  crc: old\n---\n# Old Title\n\nтекст\n";
        let out = stamp_doc(old, "a", "new1234", None, None, None, "Source File");
        assert!(out.starts_with("---\n"));
        assert!(!out.contains("# Old Title"));
        assert!(out.contains("текст"));
        assert!(out.contains("crc: new1234"));
    }

    #[test]
    fn read_doc_crc_none_when_content_absent() {
        assert_eq!(read_doc_crc(None), None);
    }

    #[test]
    fn staleness_missing_when_doc_absent() {
        let (stale, reason) = staleness(None, b"src", None);
        assert!(stale);
        assert_eq!(reason, Some(StalenessReason::Missing));
    }

    #[test]
    fn staleness_crc_mismatch_when_source_changed() {
        let stale_crc = crc32(b"old source");
        let doc = format!("---\nresource: a\ndocgen:\n  crc: {stale_crc}\n---\n");
        let (stale, reason) = staleness(Some(&doc), b"new source", None);
        assert!(stale);
        assert_eq!(reason, Some(StalenessReason::CrcMismatch));
    }

    #[test]
    fn staleness_fresh_when_crc_matches() {
        let src = b"same source";
        let crc = crc32(src);
        let doc = format!("---\nresource: a\ndocgen:\n  crc: {crc}\n---\n");
        let (stale, reason) = staleness(Some(&doc), src, None);
        assert!(!stale);
        assert_eq!(reason, None);
    }

    #[test]
    fn staleness_includes_test_payload_in_crc() {
        let src = b"same source";
        let payload = "\0tests/a.test.mjs\0content";
        let combined_crc = documentation_crc(src, Some(payload));
        let doc = format!("---\nresource: a\ndocgen:\n  crc: {combined_crc}\n---\n");
        let (stale, _) = staleness(Some(&doc), src, Some(payload));
        assert!(!stale);
        // Без payload той самий source дає інший CRC — доводить, що тести реально враховані.
        assert_ne!(combined_crc, crc32(src));
    }
}
