//! Host-валідатор рядка тула (`Manifest::tools`) і запиту `exec-tool`
//! (зріз 5 контракту v3.1, рішення А/В спеки
//! `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`).
//!
//! # Що тут з'явилось і чому воно не існувало раніше
//!
//! До v3.1 рядок тула не мав валідатора взагалі: `Manifest::tools` — просто
//! `Vec<String>`, а `"eslint@>=8 <9"` мовчки ставав `"eslint"` (обрізання по
//! першому `@`, `ToolResolver::run`). Схеми резолву
//! (`pinned:`/`path:`/`npm:`) роблять цей рядок структурованим — а структура
//! без валідатора дрейфує в мовчазні «тул не знайдено», тож
//! [`parse_tool_ref`] стає єдиною точкою розбору для ОБОХ боків (host
//! `ToolResolver`, JS `ensureDeclaredTools`) і має дзеркальний JS-тест
//! конвенції.
//!
//! Схема впливає ЛИШЕ на те, хто й де шукає бінарник (JS-бік,
//! `ensureDeclaredTools`) — host-резолв (`ToolResolver::resolve`) однаковий
//! для всіх трьох: мапа «ім'я → абсолютний шлях» приходить уже готовою.
//!
//! # Запит `exec-tool` — недовірений вхід
//!
//! Гість може попросити хост записати файли на диск (`scratch-in`) і
//! прочитати їх назад (`scratch-out`) — тобто scratch-контур принципово
//! ширший за read-only `detect`. Тому [`validate_tool_request`] перевіряє те,
//! чого WIT-типізація не покриває:
//!
//! - `cwd` — безпечний repo-relative (та сама [`is_safe_repo_relative_path`],
//!   що вже охороняє `FixPlan`-шляхи й `targetPath` слоту `ci.artifact@1`),
//!   інакше `cwd: "../.."` вивів би спавнений процес за межі репо;
//! - `scratch-file.path` — безпечний ВІДНОСНО scratch-каталогу (та сама
//!   функція: `..` і ведучий `/` заборонені) — інакше матеріалізація
//!   `scratch-in` стала б записом у довільне місце ФС;
//! - ліміти кількості й розміру (`scratch-in`, `scratch-out`-глоби) — той
//!   самий мотив, що ліміти `validate_fix_plan`: зіпсований чи зловмисний
//!   гість не має змоги змусити хост писати на диск довільні обсяги.
//!
//! Помилки акумулюються в одному виклику (не early-return на першій) — той
//! самий контракт, що [`super::fix::validate_fix_plan`].

use crate::tool::ToolRequest;

use super::ci_artifact::is_safe_repo_relative_path;

/// Максимальна кількість файлів `scratch-in` одного виклику `exec-tool`.
/// Реальні споживачі кладуть одиниці файлів (`js-run/runtime` —
/// rego-політики conftest); сотні — ознака збою guest-логіки.
pub const MAX_SCRATCH_IN_FILES: usize = 64;

/// Максимальний розмір вмісту одного `scratch-in`-файлу (байти UTF-8).
pub const MAX_SCRATCH_FILE_BYTES: usize = 4 * 1024 * 1024;

/// Максимальний сумарний розмір усіх `scratch-in`-файлів одного виклику.
pub const MAX_SCRATCH_IN_TOTAL_BYTES: usize = 16 * 1024 * 1024;

/// Максимальна кількість `scratch-out`-глобів одного виклику.
pub const MAX_SCRATCH_OUT_GLOBS: usize = 32;

/// Схема резолву тула в рядку `Manifest::tools` (рішення В спеки).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolScheme {
    /// `pinned:` — дефолт за ВІДСУТНОСТІ схеми (чинні маніфести не
    /// змінюються): github-release-бінарник із закріпленою версією
    /// (`npm/scripts/lib/tool-pins.json`, реєстр `TOOLS` ensure-tool).
    Pinned,
    /// `path:` — резолв по `PATH` (`resolveCmd`): `bun`, `bunx` — тули, яких
    /// ensure-tool завантажити з GitHub не може й не має.
    Path,
    /// `npm:` — тул із `node_modules/.bin` консюмер-репо, фолбек `PATH`
    /// (зріз 6 контракту v3.1): `stylelint` — задекларована залежність
    /// npm-пакета плагіна, а не github-реліз і не глобальний бінарник.
    /// Порядок «локальний .bin → PATH» — дослівно `resolveStylelint`
    /// JS-канону `style/lint`.
    Npm,
}

/// Розібраний рядок `Manifest::tools`: схема резолву + ім'я тула БЕЗ
/// semver-суфікса декларації.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolRef<'a> {
    pub scheme: ToolScheme,
    /// Ім'я тула — ключ мапи «ім'я → шлях», яку будує ensure-tool контур і
    /// споживає `ToolResolver`.
    pub name: &'a str,
}

/// Розбирає рядок `Manifest::tools` у [`ToolRef`]: відрізає схему (якщо є),
/// потім semver-суфікс декларації.
///
/// Версійна політика лишається там, де була (доккомент
/// `crates/rules-plugin-host/src/tool_resolver.rs`): діапазон декларації
/// ігнорується, канонічну версію ставить ensure-tool контур — тут він лише
/// відрізається, не звіряється.
///
/// Невідома схема (`oci:` — вигадка) НЕ інтерпретується як частина імені:
/// [`validate_tool_ref`] відхиляє такий рядок, а цей розбір повертає
/// `Pinned` + повний залишок, щоб повідомлення про помилку показало людині
/// рівно те, що вона написала.
pub fn parse_tool_ref(declared: &str) -> ToolRef<'_> {
    let (scheme, rest) = match declared.split_once(':') {
        Some(("pinned", rest)) => (ToolScheme::Pinned, rest),
        Some(("path", rest)) => (ToolScheme::Path, rest),
        Some(("npm", rest)) => (ToolScheme::Npm, rest),
        _ => (ToolScheme::Pinned, declared),
    };
    ToolRef {
        scheme,
        name: rest.split('@').next().unwrap_or(rest),
    }
}

/// Перевіряє рядок `Manifest::tools` на форму. `Err` — людиночитне
/// пояснення; хост НЕ падає на невалідній декларації (маніфест — недовірений
/// вхід, skip-not-crash), а лише не резолвить цей тул, тож повідомлення
/// мусить бути самодостатнім.
pub fn validate_tool_ref(declared: &str) -> Result<ToolRef<'_>, String> {
    if let Some((prefix, _)) = declared.split_once(':') {
        if !matches!(prefix, "pinned" | "path" | "npm") {
            return Err(format!(
                "тул `{declared}`: невідома схема резолву `{prefix}:` — відомі \
                 `pinned:` (дефолт за відсутності схеми), `path:` і `npm:`"
            ));
        }
    }
    let parsed = parse_tool_ref(declared);
    if parsed.name.is_empty() {
        return Err(format!("тул `{declared}`: порожнє ім'я тула"));
    }
    if parsed.name.contains('/') || parsed.name.contains('\\') {
        return Err(format!(
            "тул `{declared}`: ім'я `{}` містить роздільник шляху — декларація \
             називає ТУЛ, а не шлях до бінарника (шлях резолвить хост)",
            parsed.name
        ));
    }
    Ok(parsed)
}

/// Валідує запит `exec-tool` від гостя (доккомент модуля). `Err` — список
/// УСІХ знайдених порушень; хост повертає їх гостю типізованою помилкою в
/// `tool-result` (`status: none`), не панікує і НЕ спавнить процес.
pub fn validate_tool_request(request: &ToolRequest) -> Result<(), Vec<String>> {
    let mut errors: Vec<String> = Vec::new();

    if let Err(err) = validate_tool_ref(&request.tool) {
        errors.push(err);
    }

    if let Some(cwd) = &request.cwd {
        if !is_safe_repo_relative_path(cwd) {
            errors.push(format!(
                "cwd `{cwd}` не є безпечним repo-relative шляхом (без абсолютних \
                 і \"..\" сегментів)"
            ));
        }
    }

    if request.scratch_in.len() > MAX_SCRATCH_IN_FILES {
        errors.push(format!(
            "scratch-in містить {} файлів — більше за ліміт {MAX_SCRATCH_IN_FILES}",
            request.scratch_in.len()
        ));
    }

    let mut total_bytes: usize = 0;
    for (index, file) in request.scratch_in.iter().enumerate() {
        if !is_safe_repo_relative_path(&file.path) {
            errors.push(format!(
                "scratch-in #{index}: шлях `{}` не є безпечним відносним шляхом \
                 усередині scratch-каталогу (без абсолютних і \"..\" сегментів)",
                file.path
            ));
        }
        if file.content.len() > MAX_SCRATCH_FILE_BYTES {
            errors.push(format!(
                "scratch-in #{index}: вміст `{}` займає {} байтів — більше за \
                 ліміт {MAX_SCRATCH_FILE_BYTES}",
                file.path,
                file.content.len()
            ));
        }
        total_bytes = total_bytes.saturating_add(file.content.len());
    }
    if total_bytes > MAX_SCRATCH_IN_TOTAL_BYTES {
        errors.push(format!(
            "сумарний вміст scratch-in займає {total_bytes} байтів — більше за \
             ліміт {MAX_SCRATCH_IN_TOTAL_BYTES}"
        ));
    }

    if request.scratch_out.len() > MAX_SCRATCH_OUT_GLOBS {
        errors.push(format!(
            "scratch-out містить {} глобів — більше за ліміт {MAX_SCRATCH_OUT_GLOBS}",
            request.scratch_out.len()
        ));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool::ScratchFile;

    fn request(tool: &str) -> ToolRequest {
        ToolRequest {
            tool: tool.to_string(),
            ..ToolRequest::default()
        }
    }

    #[test]
    fn missing_scheme_defaults_to_pinned_and_strips_semver() {
        let parsed = parse_tool_ref("shellcheck@^0.9");
        assert_eq!(parsed.scheme, ToolScheme::Pinned);
        assert_eq!(parsed.name, "shellcheck");
    }

    #[test]
    fn explicit_schemes_are_parsed() {
        assert_eq!(
            parse_tool_ref("pinned:conftest@^0.68").scheme,
            ToolScheme::Pinned
        );
        assert_eq!(parse_tool_ref("pinned:conftest@^0.68").name, "conftest");
        assert_eq!(parse_tool_ref("path:bun").scheme, ToolScheme::Path);
        assert_eq!(parse_tool_ref("path:bun").name, "bun");
        assert_eq!(parse_tool_ref("npm:stylelint").scheme, ToolScheme::Npm);
        assert_eq!(parse_tool_ref("npm:stylelint").name, "stylelint");
    }

    /// Дзеркало доккомента `ToolResolver` — semver-діапазон із пробілом теж
    /// обрізається по першому `@`, не ламає розбір схеми.
    #[test]
    fn semver_range_with_space_is_stripped_after_scheme() {
        let parsed = parse_tool_ref("path:eslint@>=8 <9");
        assert_eq!(parsed.scheme, ToolScheme::Path);
        assert_eq!(parsed.name, "eslint");
    }

    #[test]
    fn unknown_scheme_is_rejected_with_named_alternatives() {
        let err = validate_tool_ref("oci:whatever").unwrap_err();
        assert!(err.contains("oci:"), "{err}");
        assert!(err.contains("path:"), "{err}");
        assert!(err.contains("npm:"), "{err}");
    }

    /// Зріз 6 контракту v3.1: `npm:` перестала бути невідомою схемою —
    /// цей тест і є та сама перевірка, що раніше стояла на `npm:stylelint`
    /// у [`unknown_scheme_is_rejected_with_named_alternatives`].
    #[test]
    fn npm_scheme_is_accepted() {
        let parsed = validate_tool_ref("npm:stylelint").expect("npm: — відома схема зрізу 6");
        assert_eq!(parsed.scheme, ToolScheme::Npm);
        assert_eq!(parsed.name, "stylelint");
    }

    #[test]
    fn empty_name_and_path_separator_are_rejected() {
        assert!(validate_tool_ref("path:").is_err());
        assert!(validate_tool_ref("path:node_modules/.bin/stylelint").is_err());
    }

    #[test]
    fn plain_request_is_valid() {
        assert!(validate_tool_request(&request("path:bun")).is_ok());
    }

    #[test]
    fn escaping_cwd_is_rejected() {
        let mut req = request("path:bun");
        req.cwd = Some("../../etc".to_string());
        let errors = validate_tool_request(&req).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("cwd")));
    }

    #[test]
    fn escaping_scratch_in_path_is_rejected() {
        let mut req = request("path:bun");
        req.scratch_in = vec![ScratchFile {
            path: "../../etc/passwd".to_string(),
            content: "x".to_string(),
        }];
        let errors = validate_tool_request(&req).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("scratch-in #0")));
    }

    #[test]
    fn absolute_scratch_in_path_is_rejected() {
        let mut req = request("path:bun");
        req.scratch_in = vec![ScratchFile {
            path: "/etc/passwd".to_string(),
            content: "x".to_string(),
        }];
        assert!(validate_tool_request(&req).is_err());
    }

    #[test]
    fn oversized_scratch_in_total_is_rejected() {
        let chunk = "x".repeat(MAX_SCRATCH_FILE_BYTES);
        let mut req = request("path:bun");
        req.scratch_in = (0..5)
            .map(|i| ScratchFile {
                path: format!("chunk-{i}.txt"),
                content: chunk.clone(),
            })
            .collect();
        let errors = validate_tool_request(&req).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("сумарний")));
    }

    #[test]
    fn too_many_scratch_out_globs_is_rejected() {
        let mut req = request("path:bun");
        req.scratch_out = (0..=MAX_SCRATCH_OUT_GLOBS)
            .map(|i| format!("out-{i}/*.json"))
            .collect();
        assert!(validate_tool_request(&req).is_err());
    }

    /// Дзеркало контракту `validate_fix_plan`: помилки акумулюються в одному
    /// виклику, не early-return на першій.
    #[test]
    fn all_errors_accumulate_in_a_single_call() {
        let mut req = request("oci:whatever");
        req.cwd = Some("/abs".to_string());
        req.scratch_in = vec![ScratchFile {
            path: "../x".to_string(),
            content: String::new(),
        }];
        let errors = validate_tool_request(&req).unwrap_err();
        assert_eq!(errors.len(), 3);
    }
}
