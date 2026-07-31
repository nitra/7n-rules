//! Native-порт `doc-files/marksman_config`
//! (`npm/rules/doc-files/marksman_config/main.mjs`, 40 рядків) —
//! `.marksman.toml` має існувати у корені репозиторію (`doc-files.mdc`).
//!
//! # Чому баз-лайн-check не портовано
//!
//! JS-версія спершу перевіряє, чи існує canonical baseline-конфіг, який
//! постачається разом із `@7n/rules` (`MARKSMAN_BASELINE_PATH`, шлях
//! обчислюється відносно `main.mjs` через `import.meta.url` — `HERE/data/
//! marksman_config/marksman.baseline.toml`), і при його відсутності репортує
//! окреме порушення «перевстанови @7n/rules» замість «файл відсутній». Це
//! install-sanity-check package-layout-у npm-пакета, не властивість
//! `cwd`-репозиторію: native-бінар не знає, де на диску лежить `npm/rules/`
//! (він компілюється й публікується окремо), і не має відповідного тесту в JS
//! (`tests/marksman_config.test.mjs` цю гілку не покриває). Тут — лише
//! `target`-частина (`main.mjs:28-39`): чи лежить `.marksman.toml` у `cwd`.
//! Сам canonical baseline і T0-копіювання лишаються повністю в JS
//! (`fix-marksman_config.mjs`, який імпортує `MARKSMAN_BASELINE_PATH` з
//! `main.mjs` — НЕ чіпається цим портом) — фіксер матчиться по
//! `data.kind === 'marksman-config-missing'`, тож це поле збережене тут
//! біт-у-біт.

use std::path::Path;

use crate::diagnostics::{Severity, Violation};

/// Імʼя конфіг-файлу marksman, який має лежати в корені репозиторію — порт
/// `MARKSMAN_TARGET_FILENAME` (`main.mjs:12`).
const MARKSMAN_TARGET_FILENAME: &str = ".marksman.toml";

/// Явний `reason`, який JS-версія передає в `fail(msg, { reason, file, data })`
/// (`main.mjs:34-38`) — не дефолт `ctx.concernId`.
const REASON: &str = "marksman-config-missing";

/// Перевіряє наявність `.marksman.toml` у корені `cwd` — точний порт
/// target-гілки `lint(ctx)` (`main.mjs:28-39`; секція «Чому баз-лайн-check не
/// портовано» у doc-коменті модуля пояснює, чому baseline-гілку (`:23-26`)
/// тут немає).
pub fn marksman_config(cwd: &Path) -> Vec<Violation> {
    if cwd.join(MARKSMAN_TARGET_FILENAME).exists() {
        return Vec::new();
    }
    vec![Violation {
        reason: REASON.to_string(),
        message: format!(
            "{MARKSMAN_TARGET_FILENAME} відсутній — T0 скопіює canonical baseline (doc-files.mdc)"
        ),
        file: Some(MARKSMAN_TARGET_FILENAME.to_string()),
        severity: Severity::Error,
        data: Some(serde_json::json!({ "kind": REASON })),
    }]
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// «violation коли .marksman.toml відсутній» (`tests/marksman_config.test.mjs:22-28`)
    /// — включно з `data.kind`, на який матчиться `fix-marksman_config.mjs`.
    #[test]
    fn missing_target_is_violation_with_kind_data() {
        let tmp = TempDir::new().unwrap();
        let violations = marksman_config(tmp.path());
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, "marksman-config-missing");
        assert_eq!(violations[0].file.as_deref(), Some(".marksman.toml"));
        assert_eq!(
            violations[0].message,
            ".marksman.toml відсутній — T0 скопіює canonical baseline (doc-files.mdc)"
        );
        assert_eq!(
            violations[0].data,
            Some(serde_json::json!({ "kind": "marksman-config-missing" }))
        );
        assert_eq!(violations[0].severity, Severity::Error);
    }

    /// «чисто коли .marksman.toml існує» (`:30-36`).
    #[test]
    fn existing_target_is_clean() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join(".marksman.toml"), "# custom\n").unwrap();
        assert!(marksman_config(tmp.path()).is_empty());
    }
}
