//! wasm-компонент `n-rules:plugin@3.0.0` — `lang-js/wasm-concerns` (задача N2,
//! спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.5),
//! створений за флоу скіла `npm/skills/wasm-plugin/` (scaffold →
//! реалізація → golden-тести). Два концерни, порт чинних JS-оригіналів 1:1
//! (той самий `reason`/`message` біт-у-біт):
//!
//! - `vue/tfm-translations` (per-file) — перенесено з виведеного пілота
//!   `crates/plugin-lang-js-pilot` (задача K фази 6), порт
//!   `plugins/lang-js/rules/vue/tfm-translations/main.mjs`.
//! - `style/gap` (full-scope, whole-batch — НЕ per-file) — порт
//!   `plugins/lang-js/rules/style/gap/main.mjs`: крос-файлова перевірка
//!   usage↔definition, весь `detect-batch.files` аналізується разом, не
//!   файл-за-файлом.
//!
//! JS-реалізації лишаються канонічними (Plugin API v2, дистрибуція wasm —
//! окремий крок) — цей компонент лише переносить логіку в native/wasm шлях,
//! parity-тест `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs`
//! ганяє ОДНІ фікстури через обидві реалізації.
//!
//! # Два концерни в одному Guest — мотив із `test-plugin-guest`
//!
//! `Guest::detect` розгалужується за `batch.concern-id` (той самий патерн,
//! що вже встановлений `crates/test-plugin-guest/src/lib.rs` для трьох
//! тест-хуків) — один guest-крейт МОЖЕ нести кілька контрибуцій `describe()`.
//! `npm/skills/wasm-plugin/template/lib.rs.tpl` демонструє лише
//! форму з ОДНИМ концерном (`__CONCERN_ID__` — єдиний плейсхолдер) — SKILL.md
//! доповнено секцією про розширення на кілька концернів (крок 2, підрозділ
//! «Кілька концернів в одному крейті»).
//!
//! # `style/gap` — whole-batch, не per-file (нова форма понад шаблон)
//!
//! Шаблон скіла документує лише `detect_one_file(file) -> Option<Diagnostic>`
//! (одна перевірка, один файл, один можливий violation). `style/gap` —
//! крос-файлова перевірка (usage-суфікси з `.vue` мають бути визначені хоч
//! в одному `.scss`/`.css`/`.vue` з усього `detect-batch.files`), тож чиста
//! логіка тут — [`detect_gap`], що бере ВЕСЬ `&[SourceFile]`, не один файл.
//! SKILL.md доповнено підрозділом «Full-scope / whole-batch концерн» —
//! шаблон демонстрував лише per-file форму, це прогалина, яку задача N2
//! виявила й закрила.

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

use std::collections::BTreeSet;

/// Ключ контрибуції `vue/tfm-translations` — точний відповідник
/// `${ctx.ruleId}/${ctx.concernId}` (`runConcernDetector`,
/// `npm/scripts/lib/lint-surface/detect.mjs`).
const CONCERN_TFM: &str = "vue/tfm-translations";

/// Ключ контрибуції `style/gap`.
const CONCERN_GAP: &str = "style/gap";

/// Дефолтний `reason` violation-а `vue/tfm-translations` — точний
/// відповідник `ctx.concernId` (`createViolationReporter`, доккомент
/// `plugins/lang-js/rules/vue/tfm-translations/main.mjs`: `fail(msg, opts)`
/// цього концерну НІКОЛИ не перекриває явним `reason`).
const TFM_VIOLATION_REASON: &str = "tfm-translations";

/// `reason` violation-а `style/gap` — точний відповідник другого аргумента
/// `fail(msg, 'missing-gap-style')` (`plugins/lang-js/rules/style/gap/main.mjs`).
const GAP_VIOLATION_REASON: &str = "missing-gap-style";

/// Іменований імпорт з `@nitra/tfm` — захоплює список імен усередині
/// `{ ... }`. Точний порт `TFM_IMPORT_RE` (`main.mjs:5`, vue/tfm-translations).
const TFM_IMPORT_PATTERN: &str = r#"import\s*\{([^}]*)\}\s*from\s*['"]@nitra/tfm['"]"#;

/// Один запис іменованого імпорту `tf` (з опційним `as <alias>`). Точний
/// порт `TF_SPECIFIER_RE` (`main.mjs:8`).
const TF_SPECIFIER_PATTERN: &str = r"^tf(?:\s+as\s+\w+)?$";

/// Оголошення функції `getTr` — `function getTr(...)` або
/// `const/let/var getTr = (...)`. Точний порт `GET_TR_DECL_RE` (`main.mjs:11`).
const GET_TR_DECL_PATTERN: &str = r"(?:function\s+getTr\s*\(|(?:const|let|var)\s+getTr\s*=)";

/// Використання класу `n-gap-{xs,sm,md,lg}` у `.vue`. Точний порт
/// `USAGE_RE` (`plugins/lang-js/rules/style/gap/main.mjs:8`).
const GAP_USAGE_PATTERN: &str = r"\bn-gap-(xs|sm|md|lg)\b";

/// Визначення класу `.n-gap-{xs,sm,md,lg}` у `.vue`/`.scss`/`.css`. Точний
/// порт `DEFINITION_RE` (`main.mjs:9`).
const GAP_DEFINITION_PATTERN: &str = r"\.n-gap-(xs|sm|md|lg)\b";

/// Чи імпортує вміст файлу `tf` (можливо з `as <alias>`) саме з `@nitra/tfm`.
/// Точний порт `importsTfFromTfm` (`main.mjs:18-22`, vue/tfm-translations).
fn imports_tf_from_tfm(content: &str) -> bool {
    let import_re = regex::Regex::new(TFM_IMPORT_PATTERN).expect("TFM_IMPORT_PATTERN валідний");
    let Some(captures) = import_re.captures(content) else {
        return false;
    };
    let specifier_re =
        regex::Regex::new(TF_SPECIFIER_PATTERN).expect("TF_SPECIFIER_PATTERN валідний");
    captures[1]
        .split(',')
        .any(|entry| specifier_re.is_match(entry.trim()))
}

/// Чи оголошено `getTr` десь у файлі. Точний порт вживання `GET_TR_DECL_RE.test`
/// (`main.mjs:46`).
fn declares_get_tr(content: &str) -> bool {
    regex::Regex::new(GET_TR_DECL_PATTERN)
        .expect("GET_TR_DECL_PATTERN валідний")
        .is_match(content)
}

/// Чистий (без host-імпортів `log`/`report-progress`) конструктор маніфеста —
/// винесений з [`Guest::describe`] окремо, щоб host-таргет unit-тести могли
/// звірити форму маніфеста, не викликаючи `log()` (host-import, який поза
/// реальним wasmtime-хостом абортує процес — доккомент модуля, «Ключове
/// застереження» у SKILL.md крок 2).
fn build_manifest() -> Manifest {
    Manifest {
        id: "lang-js/wasm-concerns".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.0.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![
            ConcernContribution {
                key: CONCERN_TFM.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.vue".to_string()],
            },
            ConcernContribution {
                key: CONCERN_GAP.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "**/*.vue".to_string(),
                    "**/*.scss".to_string(),
                    "**/*.css".to_string(),
                ],
            },
        ],
        ci_artifacts: vec![],
        capabilities: Capabilities {
            // Вміст файлів хост передає inline (per-file чи host-побудований
            // full-scope batch, доккомент `wit/world.wit`) — плагін не читає
            // диск сам.
            fs_read: vec![],
            network: false,
        },
        tools: vec![],
    }
}

/// Точний порт тіла циклу `lint()` (`main.mjs:40-52` vue/tfm-translations)
/// для ОДНОГО файлу — чиста функція (без host-імпортів), яку host-таргет
/// unit-тести викликають напряму. Хост уже відфільтрував/прочитав вміст
/// (спека §3.2), тут лишається сама перевірка.
fn detect_one_file_tfm(file: &SourceFile) -> Option<Diagnostic> {
    if !file.path.ends_with(".vue") {
        return None;
    }
    if !imports_tf_from_tfm(&file.content) {
        return None;
    }
    if declares_get_tr(&file.content) {
        return None;
    }
    Some(Diagnostic {
        reason: TFM_VIOLATION_REASON.to_string(),
        message: format!(
            "{}: імпортує 'tf' з '@nitra/tfm', але не оголошує функцію getTr() з перекладами \
             (vue.mdc tfm-translations)",
            file.path
        ),
        file: Some(file.path.clone()),
        severity: Severity::Error,
        data: None,
    })
}

/// Точний порт `lint()` `style/gap` (`main.mjs:19-51`) — WHOLE-BATCH
/// перевірка (не per-file, доккомент модуля): кожен суфікс `n-gap-{xs,sm,md,lg}`,
/// використаний у `.vue`, має бути визначений хоч в одному `.scss`/`.css`/`.vue`
/// з УСЬОГО переданого `files` (хост уже зібрав whole-repo batch за
/// `ConcernContribution::glob`, спека §3.2 передумова full-scope мосту,
/// задача N2 п.2).
///
/// `used`/`defined` — `BTreeSet` (сортований), не порядок вставки, як
/// JS-`Set`: детермінізм отримуємо явно (алфавітний порядок суфіксів
/// `lg`/`md`/`sm`/`xs`), а не мімікруємо insertion-order, залежний від
/// порядку `detect-batch.files` (не гарантований контрактом як стабільний
/// між host-реалізаціями). Жодна наявна фікстура (JS чи parity-тест) не
/// покриває ОДНОЧАСНО кілька відсутніх суфіксів, тож ця відмінність від
/// JS insertion-order не порушує parity на реальних сценаріях.
fn detect_gap(files: &[SourceFile]) -> Vec<Diagnostic> {
    let usage_re = regex::Regex::new(GAP_USAGE_PATTERN).expect("GAP_USAGE_PATTERN валідний");
    let definition_re =
        regex::Regex::new(GAP_DEFINITION_PATTERN).expect("GAP_DEFINITION_PATTERN валідний");

    let mut used: BTreeSet<String> = BTreeSet::new();
    let mut defined: BTreeSet<String> = BTreeSet::new();
    for file in files {
        if file.path.ends_with(".vue") {
            for captures in usage_re.captures_iter(&file.content) {
                used.insert(captures[1].to_string());
            }
        }
        for captures in definition_re.captures_iter(&file.content) {
            defined.insert(captures[1].to_string());
        }
    }

    used.difference(&defined)
        .map(|suffix| Diagnostic {
            reason: GAP_VIOLATION_REASON.to_string(),
            message: format!(
                "Клас `.n-gap-{suffix}` використовується у `.vue`, але не визначений у жодному \
                 `.scss`/`.css` (guide: style/gap.mdc) — додай клас до app.scss"
            ),
            file: None,
            severity: Severity::Error,
            data: None,
        })
        .collect()
}

/// Guest-реалізація world `plugin` — дві контрибуції ([`CONCERN_TFM`],
/// [`CONCERN_GAP`]).
struct LangJs;

impl Guest for LangJs {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-lang-js: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        let total = batch.files.len() as u32;
        let diagnostics = if batch.concern_id == CONCERN_GAP {
            // Whole-batch (доккомент [`detect_gap`]) — один "крок" прогресу,
            // не per-file (весь batch аналізується разом).
            report_progress(total, total);
            detect_gap(&batch.files)
        } else {
            let mut diagnostics = Vec::new();
            for (index, file) in batch.files.iter().enumerate() {
                report_progress(index as u32 + 1, total);
                if let Some(diagnostic) = detect_one_file_tfm(file) {
                    diagnostics.push(diagnostic);
                }
            }
            diagnostics
        };
        log(
            LogLevel::Info,
            &format!(
                "plugin-lang-js: detect({}) опрацював {total} файл(ів)",
                batch.concern_id
            ),
        );
        diagnostics
    }

    /// v3.0-заглушка — жоден із двох JS-оригіналів не має fix-контуру (лише
    /// detect), тож `FixPlan` завжди порожній.
    fn fix(_request: FixRequest) -> FixPlan {
        FixPlan { edits: vec![] }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

export!(LangJs);

#[cfg(test)]
mod tests {
    //! Юніт-тести на host-таргеті (`cargo test -p plugin-lang-js`, без
    //! wasm-збірки) — лише чисті helper-и, НЕ `Guest::describe`/`Guest::detect`
    //! напряму (доккомент модуля: host-імпорти абортують поза реальним
    //! хостом). Golden-тест через реальний `PluginHost` —
    //! `crates/rules-plugin-host/tests/plugin_lang_js.rs`.
    use super::*;

    // --- vue/tfm-translations ---

    #[test]
    fn imports_tf_named_specifier_is_detected() {
        assert!(imports_tf_from_tfm(
            "import { lang, tf as tfm } from '@nitra/tfm'\n"
        ));
        assert!(imports_tf_from_tfm("import { tf } from '@nitra/tfm'\n"));
    }

    #[test]
    fn imports_only_other_named_specifiers_is_not_detected() {
        assert!(!imports_tf_from_tfm("import { lang } from '@nitra/tfm'\n"));
        assert!(!imports_tf_from_tfm("const x = 1\n"));
    }

    #[test]
    fn declares_get_tr_matches_function_and_const_forms() {
        assert!(declares_get_tr("function getTr() { return {} }"));
        assert!(declares_get_tr("const getTr = () => ({})"));
        assert!(!declares_get_tr("const other = () => ({})"));
    }

    #[test]
    fn detect_one_file_tfm_flags_file_importing_tf_without_get_tr() {
        let file = SourceFile {
            path: "Page.vue".to_string(),
            content: "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: {} })\n</script>\n".to_string(),
        };
        let diagnostic = detect_one_file_tfm(&file).expect("мало знайти violation");
        assert_eq!(diagnostic.reason, TFM_VIOLATION_REASON);
        assert!(diagnostic.message.contains("getTr"));
        assert_eq!(diagnostic.file.as_deref(), Some("Page.vue"));
        assert_eq!(diagnostic.severity, Severity::Error);
        assert!(diagnostic.data.is_none());
    }

    #[test]
    fn detect_one_file_tfm_passes_file_with_get_tr_declared() {
        let file = SourceFile {
            path: "Page.vue".to_string(),
            content: "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: getTr() })\nfunction getTr() { return {} }\n</script>\n".to_string(),
        };
        assert!(detect_one_file_tfm(&file).is_none());
    }

    #[test]
    fn detect_one_file_tfm_ignores_non_vue_files() {
        let file = SourceFile {
            path: "helper.mjs".to_string(),
            content: "import { tf } from '@nitra/tfm'\n".to_string(),
        };
        assert!(detect_one_file_tfm(&file).is_none());
    }

    // --- style/gap ---

    #[test]
    fn detect_gap_passes_when_used_suffix_is_defined() {
        let files = vec![
            SourceFile {
                path: "src/Row.vue".to_string(),
                content: "<template><div class=\"row n-gap-md\" /></template>\n".to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".n-gap-md {\n  gap: 16px;\n}\n".to_string(),
            },
        ];
        assert!(detect_gap(&files).is_empty());
    }

    #[test]
    fn detect_gap_passes_when_suffix_never_used() {
        let files = vec![SourceFile {
            path: "src/Row.vue".to_string(),
            content: "<template><div class=\"row q-gutter-md\" /></template>\n".to_string(),
        }];
        assert!(detect_gap(&files).is_empty());
    }

    #[test]
    fn detect_gap_flags_used_but_undefined_suffix() {
        let files = vec![
            SourceFile {
                path: "src/Row.vue".to_string(),
                content: "<template><div class=\"row n-gap-lg\" /></template>\n".to_string(),
            },
            SourceFile {
                path: "src/app.scss".to_string(),
                content: ".n-gap-sm {\n  gap: 8px;\n}\n".to_string(),
            },
        ];
        let diagnostics = detect_gap(&files);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].reason, GAP_VIOLATION_REASON);
        assert!(diagnostics[0].message.contains("n-gap-lg"));
        assert!(diagnostics[0].file.is_none());
    }

    // --- маніфест ---

    #[test]
    fn build_manifest_declares_both_concerns_with_expected_scopes() {
        let manifest = build_manifest();
        assert_eq!(manifest.concerns.len(), 2);
        let tfm = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_TFM)
            .expect("tfm contribution має бути в маніфесті");
        assert_eq!(tfm.scope, ConcernScope::PerFile);
        let gap = manifest
            .concerns
            .iter()
            .find(|c| c.key == CONCERN_GAP)
            .expect("gap contribution має бути в маніфесті");
        assert_eq!(gap.scope, ConcernScope::Full);
        assert!(!gap.glob.is_empty());
        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
        assert_eq!(manifest.domains, vec![Domain::Lint]);
    }
}
