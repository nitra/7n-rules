//! Шаблон wasm-компонента `n-rules:plugin@3.0.0` (скіл `wasm-plugin`,
//! `npm/skills/wasm-plugin/SKILL.md`) — замінити перед реалізацією:
//! - `__WIT_PATH__` (нижче, у `wit_bindgen::generate!`) на реальний шлях до
//!   `wit/` пакета `n-rules:plugin` (first-party: `../rules-contract/wit`;
//!   сторонній репозиторій: vendored `wit/` у цьому ж крейті — деталі в
//!   SKILL.md);
//! - `__PLUGIN_ID__`/`__CONCERN_ID__`/`__CONCERN_REASON__` на реальні
//!   ідентифікатори;
//! - логіку [`detect_one_file`] на реальну перевірку концерну (тут — лише
//!   демонстраційний пошук забороненого маркера `__MARKER__`).
//!
//! # Host-імпорти абортують поза реальним хостом (знахідка пілота)
//!
//! `log`/`report-progress`/`run-tool` — host-функції (plugin → host, WIT
//! `import`). Викликати їх можна ЛИШЕ всередині реального wasmtime-`Store`
//! (`rules-plugin-host`) — виклик поза ним (напр. з host-таргет юніт-тесту,
//! що імпортує цей крейт напряму) АБОРТУЄ процес: нема кому відповісти на
//! імпортований виклик. Тому [`Guest::describe`]/[`Guest::detect`]/
//! [`Guest::fix`] — тонкі обгортки, які НІКОЛИ самі не містять перевіряльної
//! логіки; вся логіка живе в чистих helper-ах ([`build_manifest`],
//! [`detect_one_file`]), яких `#[cfg(test)]`-юніт-тести цього файлу
//! викликають напряму на host-таргеті (`cargo test -p __CRATE_NAME__`, без
//! wasm-збірки). Golden-тест через реальний `PluginHost` — окремий крок
//! скіла (крок 3 SKILL.md), там і лише там викликається `Guest`-поверхня.

wit_bindgen::generate!({
    path: "__WIT_PATH__",
    world: "plugin",
    generate_all,
});

/// Ключ contribution-у (`ruleId/concernId`) — те, що `Manifest::concerns`
/// заявляє і `DetectBatch::concern_id` очікує від хоста.
const CONCERN_KEY: &str = "__CONCERN_ID__";

/// `reason` кожної діагностики цього концерну — стабільний machine code,
/// не перекладається і не змінюється між релізами без причини (споживачі
/// можуть звірятись саме за ним).
const VIOLATION_REASON: &str = "__CONCERN_REASON__";

/// Демонстраційний маркер — заміни на реальну перевірку (regex/AST/просте
/// порівняння рядків залежно від концерну).
const MARKER: &str = "__MARKER__";

/// Чистий (без host-імпортів) конструктор маніфеста — окремо від
/// [`Guest::describe`], щоб host-таргет юніт-тести могли звірити форму
/// маніфеста, не викликаючи `log()` (доккомент модуля вище).
fn build_manifest() -> Manifest {
    Manifest {
        id: "__PLUGIN_ID__".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.0.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![ConcernContribution {
            key: CONCERN_KEY.to_string(),
            // per-file — типовий дефолт: виклик (JS-оркестрація чи повторний
            // виклик того самого шляху) сам передає підмножину файлів у
            // DetectBatch. Заміни на `ConcernScope::Full` + заповнений `glob`
            // (glob-патерни, за якими хост фільтрує whole-repo обхід), якщо
            // концерн — whole-repo/крос-файлова перевірка: тоді, коли виклик
            // не передав явний список файлів, хост будує batch сам
            // (`crates/rules-napi::run_wasm_concern`, доккомент
            // `wit/world.wit` `record concern-contribution`).
            scope: ConcernScope::PerFile,
            glob: vec![],
        }],
        ci_artifacts: vec![],
        capabilities: Capabilities {
            // Типовий концерн лишає порожнім — хост передає вміст файлів
            // inline у `detect-batch` (доккомент `wit/world.wit`).
            fs_read: vec![],
            network: false,
        },
        tools: vec![],
    }
}

/// Чиста перевірка ОДНОГО файлу — заміни тіло на реальну логіку концерну.
/// Якщо це порт чинного JS-концерну (`plugins/lang-js/...`) — дотримуйся
/// parity-дисципліни (SKILL.md крок 2): той самий `reason`, той самий текст
/// `message` (біт-у-біт, включно з пунктуацією), ті самі фікстури, що й
/// оригінал, звірені через golden-тест (крок 3).
fn detect_one_file(file: &SourceFile) -> Option<Diagnostic> {
    if !file.content.contains(MARKER) {
        return None;
    }
    Some(Diagnostic {
        reason: VIOLATION_REASON.to_string(),
        message: format!("{}: містить заборонений маркер '{MARKER}'", file.path),
        file: Some(file.path.clone()),
        severity: Severity::Error,
        data: None,
    })
}

/// Guest-реалізація world `plugin`.
struct GuestPlugin;

impl Guest for GuestPlugin {
    fn describe() -> Manifest {
        log(LogLevel::Info, "__PLUGIN_ID__: describe()");
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
            &format!("__PLUGIN_ID__: detect() опрацював {total} файл(ів)"),
        );
        diagnostics
    }

    /// v3.0-заглушка (без fix-контуру) — заміни, якщо концерн підтримує
    /// автофікс: `FixPlan::edits` як список `FileEdit::Write`/`FileEdit::Delete`
    /// за `request.diagnostics` (доккомент `rules_contract::fix`).
    fn fix(_request: FixRequest) -> FixPlan {
        FixPlan { edits: vec![] }
    }

    /// Заглушка доменів поза lint (рішення К спеки) — залиш `NotSupported`,
    /// якщо цей плагін не реалізує `ecosystem-outdated`/`docgen-render`;
    /// прибери відповідний домен із `describe()`, якщо він НЕ підтриманий
    /// (хост будує мапу «домен → підтримка» саме з `Manifest::domains` і не
    /// викликає незадекларовані експорти — ці заглушки тут лише
    /// belt-and-suspenders).
    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

export!(GuestPlugin);

#[cfg(test)]
mod tests {
    //! Юніт-тести на host-таргеті (`cargo test -p __CRATE_NAME__`, без
    //! wasm-збірки) — лише чисті helper-и ([`build_manifest`]/
    //! [`detect_one_file`]), НЕ `Guest::describe`/`Guest::detect` напряму
    //! (доккомент модуля: host-імпорти абортують поза реальним хостом).
    use super::*;

    #[test]
    fn build_manifest_declares_single_concern_with_empty_capabilities() {
        let manifest = build_manifest();
        assert_eq!(manifest.concerns.len(), 1);
        assert_eq!(manifest.concerns[0].key, CONCERN_KEY);
        assert_eq!(manifest.concerns[0].scope, ConcernScope::PerFile);
        assert!(manifest.capabilities.fs_read.is_empty());
        assert!(!manifest.capabilities.network);
        assert_eq!(manifest.domains, vec![Domain::Lint]);
    }

    #[test]
    fn detect_one_file_flags_marker() {
        let file = SourceFile {
            path: "a.txt".to_string(),
            content: format!("щось {MARKER} щось"),
        };
        let diagnostic = detect_one_file(&file).expect("мало знайти violation");
        assert_eq!(diagnostic.reason, VIOLATION_REASON);
        assert_eq!(diagnostic.file.as_deref(), Some("a.txt"));
        assert_eq!(diagnostic.severity, Severity::Error);
        assert!(diagnostic.data.is_none());
    }

    #[test]
    fn detect_one_file_passes_clean_file() {
        let file = SourceFile {
            path: "clean.txt".to_string(),
            content: "нічого забороненого тут немає".to_string(),
        };
        assert!(detect_one_file(&file).is_none());
    }
}
