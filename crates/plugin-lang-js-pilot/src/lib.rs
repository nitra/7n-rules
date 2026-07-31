//! Пілотний wasm-компонент `n-rules:plugin@3.0.0` (задача K фази 6, спека
//! `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.5.2) — один
//! lint-концерн `vue/tfm-translations`, порт чинного
//! `plugins/lang-js/rules/vue/tfm-translations/main.mjs` 1:1 (три regex-и,
//! reason/message біт-у-біт). JS-реалізація лишається канонічною — цей
//! компонент лише доводить end-to-end конвеєр (JS parity-тест
//! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs` ганяє ОДНІ
//! фікстури через обидві реалізації).
//!
//! Capabilities порожні (`fs-read: []`, `network: false`) — хост уже передає
//! вміст файлів inline у `detect-batch` (та сама конвенція, що й типовий
//! концерн, доккомент `wit/world.wit`), guest не читає диск сам.

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

/// Ключ contribution-у (`ruleId/concernId`) — точний відповідник
/// `${ctx.ruleId}/${ctx.concernId}` у `runConcernDetector`
/// (`npm/scripts/lib/lint-surface/detect.mjs`), яким JS-dispatch резолвить
/// wasm-мапу.
const CONCERN_KEY: &str = "vue/tfm-translations";

/// Дефолтний `reason` violation-а — точний відповідник `ctx.concernId`
/// (`createViolationReporter`, `npm/scripts/lib/lint-surface/violation-reporter.mjs`:
/// `defaultReason = ctx?.concernId ?? 'violation'`), який `main.mjs` НІКОЛИ не
/// перекриває явним `reason` у `fail(msg, opts)` — тому тут це рядковий
/// літерал, не похідна від `CONCERN_KEY`/`batch.concern-id`.
const VIOLATION_REASON: &str = "tfm-translations";

/// Іменований імпорт з `@nitra/tfm` — захоплює список імен усередині `{ ... }`.
/// Точний порт `TFM_IMPORT_RE` (`main.mjs:5`).
const TFM_IMPORT_PATTERN: &str = r#"import\s*\{([^}]*)\}\s*from\s*['"]@nitra/tfm['"]"#;

/// Один запис іменованого імпорту `tf` (з опційним `as <alias>`). Точний
/// порт `TF_SPECIFIER_RE` (`main.mjs:8`).
const TF_SPECIFIER_PATTERN: &str = r"^tf(?:\s+as\s+\w+)?$";

/// Оголошення функції `getTr` — `function getTr(...)` або
/// `const/let/var getTr = (...)`. Точний порт `GET_TR_DECL_RE` (`main.mjs:11`).
const GET_TR_DECL_PATTERN: &str = r"(?:function\s+getTr\s*\(|(?:const|let|var)\s+getTr\s*=)";

/// Чи імпортує вміст файлу `tf` (можливо з `as <alias>`) саме з `@nitra/tfm`.
/// Точний порт `importsTfFromTfm` (`main.mjs:18-22`).
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
/// реальним wasmtime-хостом абортує процес — нема кому відповісти на виклик
/// імпортованої функції).
fn build_manifest() -> Manifest {
    Manifest {
        id: "lang-js-pilot/vue-tfm-translations".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.0.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![CONCERN_KEY.to_string()],
        ci_artifacts: vec![],
        capabilities: Capabilities {
            // Вміст файлів хост передає inline у `detect-batch` — плагін
            // не читає диск сам (доккомент модуля вище).
            fs_read: vec![],
            network: false,
        },
        tools: vec![],
    }
}

/// Точний порт тіла циклу `lint()` (`main.mjs:40-52`) для ОДНОГО файлу —
/// чиста функція (без host-імпортів, той самий мотив, що й
/// [`build_manifest`]), яку host-таргет unit-тести викликають напряму.
/// Хост уже відфільтрував/прочитав вміст (спека §3.2), тут лишається сама
/// перевірка — `.vue`-розширення (belt-and-suspenders, той самий, що й у
/// `main.mjs:41`, concern.json `glob: ["**/*.vue"]` теж це гарантує), імпорт
/// `tf` з `@nitra/tfm`, відсутність `getTr()`.
fn detect_one_file(file: &SourceFile) -> Option<Diagnostic> {
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
        reason: VIOLATION_REASON.to_string(),
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

/// Guest-реалізація world `plugin` — один концерн [`CONCERN_KEY`].
struct LangJsPilot;

impl Guest for LangJsPilot {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-lang-js-pilot: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        let total = batch.files.len() as u32;
        let mut diagnostics = Vec::new();
        for (index, file) in batch.files.iter().enumerate() {
            report_progress(index as u32 + 1, total);
            if let Some(diagnostic) = detect_one_file(file) {
                diagnostics.push(diagnostic);
            }
        }
        log(
            LogLevel::Info,
            &format!("plugin-lang-js-pilot: detect() опрацював {total} файл(ів)"),
        );
        diagnostics
    }

    /// v3.0-заглушка — `main.mjs` не має fix-контуру (лише detect), тож
    /// `FixPlan` завжди порожній (доккомент `rules_contract::fix`).
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

export!(LangJsPilot);

#[cfg(test)]
mod tests {
    //! Юніт-тести регекс-порту на host-таргеті (не потребують wasm-збірки) —
    //! `cargo test -p plugin-lang-js-pilot` компілює цей крейт для host-архітектури
    //! (доккомент кореневого `Cargo.toml`: wit-bindgen-glue гейтить wasm-специфічну
    //! ABI-обв'язку за `cfg(target_arch = "wasm32")`, сама логіка компілюється й
    //! тестується на host). Тести звертаються лише до чистих helper-ів
    //! ([`build_manifest`]/[`detect_one_file`]), НЕ до `Guest::describe`/`Guest::detect`
    //! напряму — останні кличуть host-import-и `log`/`report-progress`, які поза
    //! реальним wasmtime-хостом абортують процес (нема кому відповісти на
    //! імпортований виклик); повний end-to-end прогін через реальний
    //! `PluginHost` — `crates/rules-plugin-host/tests/plugin_lang_js_pilot.rs`.
    use super::*;

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
    fn detect_one_file_flags_file_importing_tf_without_get_tr() {
        let file = SourceFile {
            path: "Page.vue".to_string(),
            content: "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: {} })\n</script>\n".to_string(),
        };
        let diagnostic = detect_one_file(&file).expect("мало знайти violation");
        assert_eq!(diagnostic.reason, VIOLATION_REASON);
        assert!(diagnostic.message.contains("getTr"));
        assert_eq!(diagnostic.file.as_deref(), Some("Page.vue"));
        assert_eq!(diagnostic.severity, Severity::Error);
        assert!(diagnostic.data.is_none());
    }

    #[test]
    fn detect_one_file_passes_file_with_get_tr_declared() {
        let file = SourceFile {
            path: "Page.vue".to_string(),
            content: "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: getTr() })\nfunction getTr() { return {} }\n</script>\n".to_string(),
        };
        assert!(detect_one_file(&file).is_none());
    }

    #[test]
    fn detect_one_file_ignores_non_vue_files() {
        let file = SourceFile {
            path: "helper.mjs".to_string(),
            content: "import { tf } from '@nitra/tfm'\n".to_string(),
        };
        assert!(detect_one_file(&file).is_none());
    }

    #[test]
    fn build_manifest_declares_single_concern_with_empty_capabilities() {
        let manifest = build_manifest();
        assert_eq!(manifest.concerns, vec![CONCERN_KEY.to_string()]);
        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
        assert_eq!(manifest.domains, vec![Domain::Lint]);
    }
}
