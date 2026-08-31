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
//! # `manifest.worlds` (мажор `5.0.0`, спека
//! `docs/specs/2026-08-31-plugin-contract-v5.md` §8, §2.109 реєстру
//! відкритих питань)
//!
//! Три перевірки, окремі від `concerns`/`fix-only-concerns` вище, але той
//! самий принцип «хост не вгадує»:
//!
//! 1. **Форма рядка** — `namespace:package/world@version`
//!    ([`WORLD_REF_RE`]). Побитий рядок — гучна помилка з назвою поля й
//!    значенням, не тихий пропуск: список іде в custom section компонента
//!    ДО інстанціації (спека §8), і хост, що спробує лінкувати проти
//!    непарсованого world-а, впаде десь глибше й незрозуміліше, ніж тут.
//! 2. **Ядровий світ не перелічується.** `n-rules:plugin` (з версією чи
//!    без) у списку — помилка: `n-rules:plugin` реалізують усі гості за
//!    визначенням (це САМ world plugin, у якому визначений `describe()`,
//!    що повертає цей-таки маніфест), і згадка означає плутанину в намірі
//!    — плагін або переплутав `n-rules:plugin` із конкретним world-ом
//!    `caps`/`surfaces` (напр. хотів `n-rules:caps/tool-runner`, написав
//!    `n-rules:plugin`), або скопіював приклад із доккоменту буквально.
//! 3. **Дублікати** — помилка (той самий клас двозначності, що дублікат
//!    ключа `concerns`: два записи одного world-а не кажуть хосту нічого
//!    нового, і сама наявність дубліката — ознака, що маніфест побудований
//!    неакуратно).
//!
//! **Свідомо ВІДСУТНЯ** четверта перевірка — «чи взагалі відомий хосту
//! такий world» (напр. `n-rules:caps/nonexistent@1.0.0`, синтаксично
//! коректний, але не існує). Спека §9 явно кладе цю перевірку на хост при
//! побудові лінкера (крок 3 §12 — окрема, паралельна задача): перелік
//! відомих `caps`/`surfaces` world-ів росте незалежно від
//! `rules-contract` (окремі пакети, окремі цикли версіонування, спека §3),
//! і дублювати цей перелік ТУТ означало б синхронізувати дві копії одного
//! реєстру — джерело дрейфу, а не безпеки. Валідатор контракту перевіряє
//! ФОРМУ, а не ЧЛЕНСТВО.
//!
//! Помилки акумулюються в одному виклику — той самий контракт, що
//! [`super::fix::validate_fix_plan`].

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;

use crate::manifest::{ConcernContribution, Manifest};

/// Форма рядка `manifest.worlds`: `namespace:package/world@version`
/// (доккомент `wit/world.wit`, поле `manifest.worlds`) — напр.
/// `n-rules:caps/tool-runner@1.0.0`. Кожен сегмент —
/// lowercase-kebab-ідентифікатор (та сама форма, що вже пінує WIT-пакети
/// цього репозиторію: `n-rules`, `caps`, `tool-runner`); версія — простий
/// `major.minor.patch` (форма, якою й так пінуються всі WIT-пакети цього
/// репозиторію — `PLUGIN_WORLD_VERSION`, `SLOTS_PACKAGE_VERSION`; повний
/// semver із pre-release/build-метаданими тут свідомо не підтримується,
/// доки реальний консюмер його не попросить).
pub static WORLD_REF_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*/[a-z][a-z0-9-]*@\d+\.\d+\.\d+$")
        .expect("valid regex")
});

/// Namespace:package-префікс ядрового world-а (`package n-rules:plugin@…`,
/// `wit/world.wit`) — його реалізують УСІ гості за визначенням, тож він не
/// має права з'явитись у `manifest.worlds` (доккомент модуля, п.2).
const CORE_WORLD_PREFIX: &str = "n-rules:plugin";

/// Перевіряє один запис `manifest.worlds` на форму й на те, що це не
/// ядровий world. Дублікати перевіряються окремо (по всьому списку, не
/// по одному запису) — [`validate_manifest`].
fn validate_world_ref(declared: &str) -> Result<(), String> {
    // Ядровий world перевіряється ПЕРШИМ, до форми — «`n-rules:plugin` без
    // world-сегмента» (найочікуваніша описка: буквально скопійований з
    // доккоменту ідентифікатор) сама по собі НЕ проходить
    // `namespace:package/world@version`, і без цього кроку впала б під
    // generic «побитий рядок», ховаючи змістовнішу причину — це РІВНО той
    // world, чия згадка тут за визначенням зайва (доккомент модуля, п.2).
    // Префікс — усе до першого `/` чи `@`, залежно що трапиться раніше:
    // ловить усі три форми, якими можна написати ядровий world —
    // голий `n-rules:plugin`, `n-rules:plugin@5.0.0` (без world-сегмента)
    // і `n-rules:plugin/plugin@5.0.0` (повна форма).
    let prefix_end = declared.find(['/', '@']).unwrap_or(declared.len());
    if &declared[..prefix_end] == CORE_WORLD_PREFIX {
        return Err(format!(
            "`worlds`: запис `{declared}` називає ядровий world `{CORE_WORLD_PREFIX}` — його \
             реалізують УСІ гості за визначенням (це world, у якому визначений сам \
             `describe()`), перелічувати його зайве і є ознакою плутанини в намірі (мали на \
             увазі конкретний world `caps`/`surfaces`?)"
        ));
    }
    if !WORLD_REF_RE.is_match(declared) {
        return Err(format!(
            "`worlds`: запис `{declared}` не має форми `namespace:package/world@version` \
             (напр. `n-rules:caps/tool-runner@1.0.0`)"
        ));
    }
    Ok(())
}

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

    // `manifest.worlds` (мажор `5.0.0`, доккомент модуля): форма/ядровий
    // world на кожен запис окремо, дублікати — по всьому списку (той самий
    // порядок перевірок, що `concerns`/`fix-only-concerns` вище).
    for declared in &manifest.worlds {
        if let Err(err) = validate_world_ref(declared) {
            errors.push(err);
        }
    }
    let mut seen_worlds: BTreeSet<&str> = BTreeSet::new();
    let mut duplicate_worlds: BTreeSet<&str> = BTreeSet::new();
    for declared in &manifest.worlds {
        if !seen_worlds.insert(declared.as_str()) {
            duplicate_worlds.insert(declared.as_str());
        }
    }
    for duplicate in duplicate_worlds {
        errors.push(format!(
            "`worlds`: запис `{duplicate}` заявлений більше одного разу — дублікат нічого не \
             додає, і сама його наявність означає неакуратно зібраний маніфест"
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
            worlds: vec![],
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

    fn with_worlds(worlds: Vec<&str>) -> Manifest {
        Manifest {
            worlds: worlds.into_iter().map(str::to_string).collect(),
            ..manifest(vec![], vec![])
        }
    }

    #[test]
    fn well_formed_world_ref_is_valid() {
        let m = with_worlds(vec!["n-rules:caps/tool-runner@1.0.0"]);
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn multiple_distinct_world_refs_are_valid() {
        let m = with_worlds(vec![
            "n-rules:caps/tool-runner@1.0.0",
            "n-rules:caps/file-reader@1.0.0",
            "n-rules:surfaces/coverage-provider@1.0.0",
        ]);
        assert!(validate_manifest(&m).is_ok());
    }

    /// Форма рядка — гучна помилка з назвою поля й значенням (доккомент
    /// модуля, п.1), не тихий пропуск.
    #[test]
    fn malformed_world_ref_is_rejected_loudly() {
        for bad in [
            "tool-runner",
            "n-rules:caps",
            "n-rules:caps/tool-runner",
            "n-rules/caps/tool-runner@1.0.0",
            "n-rules:caps/tool-runner@1.0",
            "N-Rules:caps/tool-runner@1.0.0",
        ] {
            let m = with_worlds(vec![bad]);
            let errors = validate_manifest(&m).unwrap_err();
            assert_eq!(errors.len(), 1, "{bad}: {errors:?}");
            assert!(errors[0].contains(bad), "{bad}: {errors:?}");
            assert!(errors[0].contains("worlds"), "{bad}: {errors:?}");
        }
    }

    /// Ядровий world `n-rules:plugin` — помилка незалежно від того, чи
    /// нести версію/world-сегмент: усі три форми, якими його можна
    /// написати, ловляться (доккомент модуля, п.2).
    #[test]
    fn core_world_is_rejected_in_any_written_form() {
        for bad in [
            "n-rules:plugin",
            "n-rules:plugin@5.0.0",
            "n-rules:plugin/plugin@5.0.0",
        ] {
            let m = with_worlds(vec![bad]);
            let errors = validate_manifest(&m).unwrap_err();
            assert_eq!(errors.len(), 1, "{bad}: {errors:?}");
            assert!(errors[0].contains("ядровий"), "{bad}: {errors:?}");
        }
    }

    #[test]
    fn duplicate_world_ref_is_rejected() {
        let m = with_worlds(vec![
            "n-rules:caps/tool-runner@1.0.0",
            "n-rules:caps/tool-runner@1.0.0",
        ]);
        let errors = validate_manifest(&m).unwrap_err();
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert!(errors[0].contains("worlds"));
        assert!(errors[0].contains("tool-runner"));
    }

    /// `worlds`-помилки акумулюються поряд із `concerns`-помилками в
    /// ОДНОМУ виклику — той самий контракт, що решта валідатора.
    #[test]
    fn world_errors_accumulate_alongside_concern_errors() {
        let mut m = manifest(vec!["js/eslint", "js/check"], vec!["js/eslint"]);
        m.worlds = vec!["n-rules:plugin".to_string(), "garbage".to_string()];
        let errors = validate_manifest(&m).unwrap_err();
        assert_eq!(errors.len(), 3, "{errors:?}");
    }
}
