//! Host-валідатор [`Manifest`]-ів wasm-плагінів (мажор `4.0.0`, §2.84
//! реєстру відкритих питань `docs/plans/2026-08-05-open-questions-register.md`)
//! — семантика, яку WIT-типізація не покриває, той самий мотив, що
//! [`super::fix`] і [`super::ci_artifact`].
//!
//! # Що саме перевіряється
//!
//! Мажор `4.0.0` додав `manifest.fix-only-concerns` — другий список
//! контрибуцій поряд із `manifest.concerns`. Два списки типізовано
//! ідентичні, тож WIT НЕ може заборонити плагіну назвати ОДИН ключ в
//! обох — а це стан, у якому плагін заявляє водночас «я заміняю детект
//! цього концерну» (`concerns`, detect-шедоуїнг у
//! `npm/scripts/lib/lint-surface/detect.mjs`) і «я НЕ заміняю детект, лише
//! фікшу» (`fix-only-concerns`). Наміру тут два, взаємно виключних, і
//! жоден із них не є «очевиднішим»:
//!
//! - взяти `concerns` — плагін, що просив fix-only, мовчки вимкнув би
//!   чинний `main.mjs`/policy-детект концерну (рівно та вада, заради якої
//!   `fix-only-concerns` і з\'явилось);
//! - взяти `fix-only-concerns` — плагін, що просив повний порт, мовчки
//!   лишився б без свого детекту, і концерн звітував би за старою
//!   реалізацією.
//!
//! Тому хост не вгадує, а відхиляє маніфест ГУЧНО (принцип проекту:
//! сигналізувати яскраво, не ховати). Дублікати ВСЕРЕДИНІ одного списку —
//! той самий клас двозначності (яка з двох контрибуцій дає glob?), і
//! перевіряються так само.
//!
//! Помилки акумулюються в одному виклику — той самий контракт, що
//! [`super::fix::validate_fix_plan`].

use std::collections::BTreeSet;

use crate::manifest::{ConcernContribution, Manifest};

/// Ключі, що зустрічаються у списку більш ніж один раз — детерміновано
/// відсортовані (повідомлення помилки не має залежати від порядку обходу).
fn duplicate_keys(contributions: &[ConcernContribution]) -> Vec<&str> {
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    let mut duplicated: BTreeSet<&str> = BTreeSet::new();
    for contribution in contributions {
        if !seen.insert(contribution.key.as_str()) {
            duplicated.insert(contribution.key.as_str());
        }
    }
    duplicated.into_iter().collect()
}

/// Валідує [`Manifest`], повернений `describe()` недовіреного плагіна
/// (доккомент модуля). `Err` — список УСІХ знайдених порушень; хост
/// загортає його в типізовану помилку і плагін НЕ завантажує.
pub fn validate_manifest(manifest: &Manifest) -> Result<(), Vec<String>> {
    let mut errors: Vec<String> = Vec::new();

    for duplicate in duplicate_keys(&manifest.concerns) {
        errors.push(format!(
            "концерн `{duplicate}` заявлений у `concerns` більше одного разу — хост не може \
             вибрати, чий `scope`/`glob` брати"
        ));
    }
    for duplicate in duplicate_keys(&manifest.fix_only_concerns) {
        errors.push(format!(
            "концерн `{duplicate}` заявлений у `fix-only-concerns` більше одного разу — хост не \
             може вибрати, чий `scope`/`glob` брати"
        ));
    }

    // Перетин рахується по МНОЖИНАХ ключів, не по парах контрибуцій:
    // ключ, продубльований усередині списку, вже має власну помилку вище —
    // друга, майже дослівна копія того самого рядка лише зашумила б вивід.
    let detect_keys: BTreeSet<&str> = manifest.concerns.iter().map(|c| c.key.as_str()).collect();
    let fix_only_keys: BTreeSet<&str> = manifest
        .fix_only_concerns
        .iter()
        .map(|c| c.key.as_str())
        .collect();
    for key in detect_keys.intersection(&fix_only_keys) {
        errors.push(format!(
            "концерн `{key}` заявлений І в `concerns`, І в `fix-only-concerns` — це два взаємно \
             виключних наміри (заміняю детект / не заміняю детект). Хост не вгадує: лишіть \
             ключ РІВНО в одному списку — у `concerns`, якщо плагін портує й детект, у \
             `fix-only-concerns`, якщо детект лишається за `main.mjs`/policy"
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
    use crate::manifest::{Capabilities, ConcernScope, Domain};

    fn contribution(key: &str) -> ConcernContribution {
        ConcernContribution {
            key: key.to_string(),
            scope: ConcernScope::PerFile,
            glob: vec!["**/*.mjs".to_string()],
            fix_glob: vec![],
        }
    }

    fn manifest(concerns: Vec<&str>, fix_only: Vec<&str>) -> Manifest {
        Manifest {
            id: "sample/plugin".to_string(),
            version: "0.1.0".to_string(),
            world_version: crate::version::PLUGIN_WORLD_VERSION.to_string(),
            domains: vec![Domain::Lint],
            concerns: concerns.into_iter().map(contribution).collect(),
            fix_only_concerns: fix_only.into_iter().map(contribution).collect(),
            ci_artifacts: vec![],
            capabilities: Capabilities::default(),
            tools: vec![],
        }
    }

    #[test]
    fn disjoint_lists_are_valid() {
        let m = manifest(vec!["js/doc_comments"], vec!["js/eslint"]);
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn empty_manifest_is_valid() {
        assert!(validate_manifest(&manifest(vec![], vec![])).is_ok());
    }

    /// Ключ в обох списках — два взаємно виключних наміри; хост не вгадує
    /// (доккомент модуля).
    #[test]
    fn key_in_both_lists_is_rejected_loudly() {
        let m = manifest(vec!["js/eslint", "js/check"], vec!["js/eslint"]);
        let errors = validate_manifest(&m).unwrap_err();
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("js/eslint"));
        assert!(errors[0].contains("fix-only-concerns"));
    }

    #[test]
    fn duplicate_key_inside_one_list_is_rejected() {
        let m = manifest(vec!["js/check", "js/check"], vec![]);
        let errors = validate_manifest(&m).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("js/check")));
    }

    /// Помилки акумулюються в одному виклику, не early-return на першій —
    /// той самий контракт, що `validate_fix_plan`.
    #[test]
    fn all_errors_accumulate_in_a_single_call() {
        let m = manifest(vec!["a/b", "a/b", "c/d"], vec!["c/d", "c/d"]);
        let errors = validate_manifest(&m).unwrap_err();
        assert_eq!(errors.len(), 3, "{errors:?}");
    }
}
