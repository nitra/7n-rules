//! Тир-конфіг моделей — Rust-порт `model-tiers.mjs` з `@7n/llm-lib`.
//!
//! Тільки резолвінг env → `"provider/model-id"`. Жодного retry/каскаду тут:
//! як і JS-шар, ці primitives свідомо не повторюють виклик — драбину
//! (local-min → cloud-min → cloud-avg, чи з ACP-агентами) будує caller,
//! композуючи [`resolve_model`] і виклики з [`crate::local_cloud`]/[`crate::acp`].

use std::env;

/// Абстрактний тир якості моделі.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Tier {
    /// Швидка, дешева модель.
    Min,
    /// Середня модель.
    Avg,
    /// Найпотужніша модель.
    Max,
}

/// Читає env-змінну, порожній рядок трактує як відсутню (той самий `?? ''`,
/// що й у JS, але з явним `None` замість порожнього рядка-заглушки).
fn env_var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.is_empty())
}

/// `N_LOCAL_MIN_MODEL` — швидкий локальний inference. Напр. `omlx/gemma-4-e4b-it-OptiQ-4bit`.
pub fn local_min() -> Option<String> {
    env_var("N_LOCAL_MIN_MODEL")
}

/// `N_LOCAL_AVG_MODEL` — середній локальний.
pub fn local_avg() -> Option<String> {
    env_var("N_LOCAL_AVG_MODEL")
}

/// `N_LOCAL_MAX_MODEL` — максимальний локальний.
pub fn local_max() -> Option<String> {
    env_var("N_LOCAL_MAX_MODEL")
}

/// `N_CLOUD_MIN_MODEL` — мінімальний хмарний (потрібен ключ). Напр. `openai/gpt-5.4-mini`.
pub fn cloud_min() -> Option<String> {
    env_var("N_CLOUD_MIN_MODEL")
}

/// `N_CLOUD_AVG_MODEL` — середній хмарний.
pub fn cloud_avg() -> Option<String> {
    env_var("N_CLOUD_AVG_MODEL")
}

/// `N_CLOUD_MAX_MODEL` — максимальний хмарний.
pub fn cloud_max() -> Option<String> {
    env_var("N_CLOUD_MAX_MODEL")
}

/// Каскадне розв'язання абстрактного тиру в `"provider/model-id"` — той самий
/// порядок, що й `resolveModel` у `model-tiers.mjs`:
/// - `Min` → `LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN`
/// - `Avg` → `LOCAL_AVG → LOCAL_MAX → CLOUD_AVG`
/// - `Max` → `LOCAL_MAX → CLOUD_MAX`
///
/// `None`, якщо жодна відповідна env-змінна не задана.
#[must_use]
pub fn resolve_model(tier: Tier) -> Option<String> {
    match tier {
        Tier::Min => local_min()
            .or_else(local_avg)
            .or_else(local_max)
            .or_else(cloud_min),
        Tier::Avg => local_avg().or_else(local_max).or_else(cloud_avg),
        Tier::Max => local_max().or_else(cloud_max),
    }
}

/// Розбирає `"provider/model-id"` на частини (перший `/` — роздільник,
/// решта — частина model-id, бо в id самому можуть бути `/`).
///
/// # Errors
/// Повертає `Err` якщо рядок не містить `/` чи будь-яка частина порожня.
pub fn parse_model_spec(spec: &str) -> Result<(&str, &str), String> {
    let (provider, model) = spec.split_once('/').ok_or_else(|| {
        format!("невалідний model spec {spec:?}: очікується \"provider/model-id\"")
    })?;
    if provider.is_empty() || model.is_empty() {
        return Err(format!(
            "невалідний model spec {spec:?}: порожній provider чи model-id"
        ));
    }
    Ok((provider, model))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // env::set_var не потоково-безпечний між тестами одного процесу —
    // серіалізуємо через м'ютекс (як прийнято для тестів на env у Rust).
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    const ALL_VARS: &[&str] = &[
        "N_LOCAL_MIN_MODEL",
        "N_LOCAL_AVG_MODEL",
        "N_LOCAL_MAX_MODEL",
        "N_CLOUD_MIN_MODEL",
        "N_CLOUD_AVG_MODEL",
        "N_CLOUD_MAX_MODEL",
    ];

    fn with_env<T>(vars: &[(&str, &str)], f: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap();
        for name in ALL_VARS {
            unsafe { env::remove_var(name) };
        }
        for (name, value) in vars {
            unsafe { env::set_var(name, value) };
        }
        let result = f();
        for name in ALL_VARS {
            unsafe { env::remove_var(name) };
        }
        result
    }

    #[test]
    fn min_cascades_through_local_then_cloud_min() {
        with_env(&[("N_LOCAL_AVG_MODEL", "omlx/avg")], || {
            assert_eq!(resolve_model(Tier::Min).as_deref(), Some("omlx/avg"));
        });
        with_env(&[("N_CLOUD_MIN_MODEL", "openai/mini")], || {
            assert_eq!(resolve_model(Tier::Min).as_deref(), Some("openai/mini"));
        });
        with_env(&[], || {
            assert_eq!(resolve_model(Tier::Min), None);
        });
    }

    #[test]
    fn avg_never_falls_back_to_cloud_min() {
        with_env(&[("N_CLOUD_MIN_MODEL", "openai/mini")], || {
            assert_eq!(resolve_model(Tier::Avg), None);
        });
    }

    #[test]
    fn max_skips_avg_tiers_entirely() {
        with_env(
            &[
                ("N_LOCAL_AVG_MODEL", "omlx/avg"),
                ("N_CLOUD_MAX_MODEL", "openai/max"),
            ],
            || {
                assert_eq!(resolve_model(Tier::Max).as_deref(), Some("openai/max"));
            },
        );
    }

    #[test]
    fn local_wins_over_cloud_at_same_tier() {
        with_env(
            &[
                ("N_LOCAL_MIN_MODEL", "omlx/min"),
                ("N_CLOUD_MIN_MODEL", "openai/mini"),
            ],
            || {
                assert_eq!(resolve_model(Tier::Min).as_deref(), Some("omlx/min"));
            },
        );
    }

    #[test]
    fn empty_env_string_treated_as_unset() {
        with_env(&[("N_LOCAL_MIN_MODEL", "")], || {
            assert_eq!(resolve_model(Tier::Min), None);
        });
    }

    #[test]
    fn parses_provider_and_model() {
        assert_eq!(
            parse_model_spec("omlx/gemma-4-e4b-it-OptiQ-4bit"),
            Ok(("omlx", "gemma-4-e4b-it-OptiQ-4bit"))
        );
        assert_eq!(
            parse_model_spec("openai/gpt-5.4-mini"),
            Ok(("openai", "gpt-5.4-mini"))
        );
    }

    #[test]
    fn rejects_missing_or_empty_parts() {
        assert!(parse_model_spec("no-slash").is_err());
        assert!(parse_model_spec("/model").is_err());
        assert!(parse_model_spec("provider/").is_err());
    }
}
