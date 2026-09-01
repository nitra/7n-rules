//! Хелпери для policy-concern detector-а — точний порт
//! `npm/scripts/lib/lint-surface/codegen-opa-wrapper.mjs` (клас **A**,
//! `docs/plans/2026-08-31-full-rust-migration-plan.md` крок 4).
//!
//! `main.mjs` для чисто policy-concern-ів (rego/template) не потрібен:
//! `detect.mjs` викликає `evaluatePolicyConcern` напряму з `concern.json`.
//! Ручний (не-`@generated`) `main.mjs` лишається escape-hatch-ом для
//! custom-detector-ів — [`is_generated_file`] дозволяє відрізнити старий
//! codegen-артефакт від ручного файлу.
//!
//! # Без Rust-споживача — свідомо
//!
//! Єдиний консюмер обох функцій у JS — `detect.mjs`, класу **B**
//! (`docs/specs/2026-08-31-recon-lint-surface.md` §2.4): диспатч концернів
//! лишається JS-оркестрованим, доки не портовано резолв плагінів. Порт цих
//! 30 рядків тут — підготовка до майбутнього порту `detect.mjs`, не
//! самостійна поверхня: немає нового host-каналу і немає потреби вигадувати
//! Rust-виклик заради виклику.

/// Маркер застарілого codegen-артефакту — точний порт `GENERATED_MARK`.
const GENERATED_MARK: &str = "// @generated — do not edit";

/// Чи це (застарілий) згенерований, а не ручний `main.mjs` — точний порт
/// `isGeneratedFile`.
pub fn is_generated_file(content: &str) -> bool {
    content.starts_with(GENERATED_MARK)
}

/// Мінімальний DTO поля `concern.policy.files` — лише те, що читає
/// [`has_resolvable_files`] (порт неявної форми `files` у JS: `{ single?:
/// string, walkGlob?: unknown }`).
#[derive(Debug, Default)]
pub struct PolicyFiles {
    pub single: Option<String>,
    pub has_walk_glob: bool,
}

/// Чи `policy.files` резолвиться у конкретні таргети (`single` або
/// `walkGlob`) — точний порт `hasResolvableFiles`. Концерни без цього — або
/// orchestrated parent-концерном (rego-бібліотека), або incomplete; напряму
/// (без parent-оркестратора) оцінити такий concern не можна.
pub fn has_resolvable_files(files: Option<&PolicyFiles>) -> bool {
    match files {
        None => false,
        Some(f) => f.single.is_some() || f.has_walk_glob,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_generated_file_matches_exact_marker_prefix() {
        assert!(is_generated_file("// @generated — do not edit\nrest"));
        assert!(!is_generated_file("// hand-written\n"));
        assert!(!is_generated_file(""));
    }

    #[test]
    fn has_resolvable_files_requires_single_or_walk_glob() {
        assert!(!has_resolvable_files(None));
        assert!(!has_resolvable_files(Some(&PolicyFiles::default())));
        assert!(has_resolvable_files(Some(&PolicyFiles {
            single: Some("a.rego".to_string()),
            has_walk_glob: false,
        })));
        assert!(has_resolvable_files(Some(&PolicyFiles {
            single: None,
            has_walk_glob: true,
        })));
    }
}
