//! Batch-виконавець builtin-native concern-ів (R2 зрізу 3 фази 7,
//! `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`): один прохід по
//! суцільному сегменту builtin-native items ОДНИМ native-викликом замість N
//! окремих `run_concern`-викликів через napi-межу — менше hops на гарячому
//! шляху `detectAll` (`npm/scripts/lib/lint-surface/run-detectors.mjs`,
//! `runNativeSegmentSync`).
//!
//! Тонкий batch-цикл над уже наявним [`super::run_concern`] — жодної нової
//! диспетчеризації, лише послідовний прохід + per-item колбек прогресу
//! ([`run_concerns_batch`]). Помилка одного item-а НЕ зупиняє батч — кожен
//! отримує власний `Result`, той самий поділ відповідальності, що
//! `run_concern` для одиночного виклику: rules-core виконує все, JS-бік
//! (`run-detectors.mjs`) вирішує, зупинятись на першій помилці чи ні
//! (`DetectorError`-семантика — рядок «detector ruleId/concernId: ...»
//! лишається виключно на JS-боці, тут — лише сирий `RulesError`).

use std::path::PathBuf;

use serde::Deserialize;

use super::run_concern;
use crate::diagnostics::ConcernReport;
use crate::RulesError;

/// Один item batch-запиту — `ruleId/concernId`-ключ (той самий формат, що
/// [`super::NATIVE_CONCERNS`]) + робочий каталог + опційний файловий набір
/// (дзеркало `LintContext.files`/[`super::run_concern`] — `None` означає
/// whole-repo, `Some([])` — явно порожній набір; той самий контракт, що
/// `ctx.files ?? null` на JS-боці).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItem {
    /// `ruleId/concernId`.
    pub key: String,
    /// Абсолютний корінь consumer-репо.
    pub cwd: PathBuf,
    /// Posix-relative файли для per-file concern-ів; `None` — whole-repo.
    #[serde(default)]
    pub files: Option<Vec<String>>,
}

/// Результат одного item-а батчу — той самий `Result`, що повернув би
/// одиночний [`super::run_concern`] для цього ключа, з ключем поряд (щоб
/// викликач міг зіставити результат назад із вхідним item-ом без окремого
/// індексування).
#[derive(Debug)]
pub struct BatchItemResult {
    pub key: String,
    pub result: Result<ConcernReport, RulesError>,
}

/// Виконує послідовний батч [`BatchItem`]-ів: для кожного — [`super::run_concern`],
/// одразу після — `on_item(key, &result)` (прогрес-колбек; той самий тригер,
/// що napi-бік (`crates/rules-napi/src/lib.rs::run_native_concerns_batch`)
/// прокидає у JS `onProgress` СИНХРОННО, без `ThreadsafeFunction` — виклик і
/// колбек живуть на одному потоці). Порядок результатів у поверненому
/// векторі — той самий, що й порядок `items`.
///
/// Помилка одного концерну НЕ зриває решту батчу — кожен item рахується
/// незалежно (fail-soft на цьому шарі); зупинку прогону на першій помилці
/// (якщо потрібна) реалізує викликач через `on_item`/пост-обробку
/// повернутого вектора, не ця функція.
pub fn run_concerns_batch(
    items: &[BatchItem],
    mut on_item: impl FnMut(&str, &Result<ConcernReport, RulesError>),
) -> Vec<BatchItemResult> {
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let result = run_concern(&item.key, &item.cwd, item.files.as_deref());
        on_item(&item.key, &result);
        out.push(BatchItemResult {
            key: item.key.clone(),
            result,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(key: &str, cwd: &std::path::Path) -> BatchItem {
        BatchItem {
            key: key.to_string(),
            cwd: cwd.to_path_buf(),
            files: None,
        }
    }

    #[test]
    fn run_concerns_batch_preserves_order() {
        let tmp = tempfile::TempDir::new().unwrap();
        let items = vec![
            item("text/forbidden-prettier", tmp.path()),
            item("security/sample_secret", tmp.path()),
            item("adr/hooks", tmp.path()),
        ];
        let results = run_concerns_batch(&items, |_, _| {});
        assert_eq!(
            results.iter().map(|r| r.key.as_str()).collect::<Vec<_>>(),
            vec![
                "text/forbidden-prettier",
                "security/sample_secret",
                "adr/hooks"
            ]
        );
        for r in &results {
            assert!(r.result.is_ok(), "{}: {:?}", r.key, r.result);
        }
    }

    #[test]
    fn run_concerns_batch_calls_on_item_once_per_entry_in_order() {
        let tmp = tempfile::TempDir::new().unwrap();
        let items = vec![
            item("text/forbidden-prettier", tmp.path()),
            item("security/sample_secret", tmp.path()),
        ];
        let mut seen = Vec::new();
        run_concerns_batch(&items, |key, result| {
            seen.push((key.to_string(), result.is_ok()));
        });
        assert_eq!(
            seen,
            vec![
                ("text/forbidden-prettier".to_string(), true),
                ("security/sample_secret".to_string(), true),
            ]
        );
    }

    /// Помилка одного item-а (невідомий ключ) не зупиняє батч — решта items
    /// усе одно рахуються (fail-soft, doc-комент функції).
    #[test]
    fn run_concerns_batch_continues_after_error_item() {
        let tmp = tempfile::TempDir::new().unwrap();
        let items = vec![
            item("k8s/unknown-concern", tmp.path()),
            item("text/forbidden-prettier", tmp.path()),
        ];
        let results = run_concerns_batch(&items, |_, _| {});
        assert!(matches!(results[0].result, Err(RulesError::Concern(_))));
        assert!(results[1].result.is_ok());
    }

    #[test]
    fn run_concerns_batch_empty_input_returns_empty_output() {
        let results = run_concerns_batch(&[], |_, _| {
            panic!("on_item не має викликатись для порожнього батчу");
        });
        assert!(results.is_empty());
    }
}
