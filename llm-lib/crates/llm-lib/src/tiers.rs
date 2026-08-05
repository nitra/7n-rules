//! Тир-конфіг моделей — Rust-порт `model-tiers.mjs` з `@7n/llm-lib`.
//!
//! Єдина policy вибору моделі: caller задає стартову env-сходинку, а resolver
//! переходить лише до сильніших моделей, спочатку local, потім cloud.

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

/// Явна стартова сходинка універсальної model-policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ModelEnv {
    LocalMin,
    LocalAvg,
    LocalMax,
    CloudMin,
    CloudAvg,
    CloudMax,
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

/// Резолвить модель від явної env-сходинки, пропускаючи слабші рівні:
///
/// - `LocalMin`: local min → local avg → local max → cloud min → cloud avg → cloud max;
/// - `LocalAvg`: local avg → local max → cloud avg → cloud max;
/// - `LocalMax`: local max → cloud max;
/// - cloud-старти проходять лише відповідну й сильніші cloud-сходинки.
#[must_use]
pub fn resolve_model_from(start: ModelEnv) -> Option<String> {
    match start {
        ModelEnv::LocalMin => local_min()
            .or_else(local_avg)
            .or_else(local_max)
            .or_else(cloud_min)
            .or_else(cloud_avg)
            .or_else(cloud_max),
        ModelEnv::LocalAvg => local_avg()
            .or_else(local_max)
            .or_else(cloud_avg)
            .or_else(cloud_max),
        ModelEnv::LocalMax => local_max().or_else(cloud_max),
        ModelEnv::CloudMin => cloud_min().or_else(cloud_avg).or_else(cloud_max),
        ModelEnv::CloudAvg => cloud_avg().or_else(cloud_max),
        ModelEnv::CloudMax => cloud_max(),
    }
}

/// Backward-compatible tier facade: кожен tier починається з відповідної local-сходинки.
#[must_use]
pub fn resolve_model(tier: Tier) -> Option<String> {
    match tier {
        Tier::Min => resolve_model_from(ModelEnv::LocalMin),
        Tier::Avg => resolve_model_from(ModelEnv::LocalAvg),
        Tier::Max => resolve_model_from(ModelEnv::LocalMax),
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

/// Провайдери, що вважаються локальними за замовчуванням (без
/// `N_LLM_LOCAL_PROVIDERS`-override) — порт дефолту `LOCAL_PROVIDERS`
/// (`model-tiers.mjs:121`).
const DEFAULT_LOCAL_PROVIDERS: &str = "local-openai";

/// Провайдери, що вважаються локальними — точний порт `LOCAL_PROVIDERS`
/// (`model-tiers.mjs:120-125`). Читає `N_LLM_LOCAL_PROVIDERS` заново на
/// кожен виклик (той самий live-read, що й решта `tiers.rs`, без
/// module-level кешування — на відміну від JS, де `LOCAL_PROVIDERS` — це
/// `const`, обчислена один раз при завантаженні модуля; тут це не спостережна
/// різниця, бо env-змінна в межах одного процесу не змінюється в
/// production-використанні, лише в тестах, де live-read навіть точніший).
///
/// **Нюанс `??` проти "порожній рядок = не задано"**: на відміну від решти
/// `tiers.rs` (`env_var`, де порожній рядок трактується як відсутній), тут —
/// точна калька JS `env.N_LLM_LOCAL_PROVIDERS ?? 'local-openai'`: `??`
/// спрацьовує лише на `null`/`undefined`, тобто **порожній рядок означає
/// «явно порожній список»**, не «дефолт». `unwrap_or_else` тут — навмисно
/// (не `env_var()`-хелпер): він підставляє дефолт лише коли змінна взагалі
/// не задана (`Err` з `env::var`), а не коли вона задана порожнім рядком.
fn local_providers() -> Vec<String> {
    let raw =
        env::var("N_LLM_LOCAL_PROVIDERS").unwrap_or_else(|_| DEFAULT_LOCAL_PROVIDERS.to_string());
    raw.split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Чи `spec` вказує на локальну модель: збіг з одним із `LOCAL_*` тирів АБО
/// провайдер входить у `N_LLM_LOCAL_PROVIDERS` (дефолт `local-openai`) —
/// точний порт `isLocalModel` (`model-tiers.mjs:138-143`).
#[must_use]
pub fn is_local_model(spec: &str) -> bool {
    if spec.is_empty() {
        return false;
    }
    if Some(spec) == local_min().as_deref()
        || Some(spec) == local_avg().as_deref()
        || Some(spec) == local_max().as_deref()
    {
        return true;
    }
    let Ok((provider, _)) = parse_model_spec(spec) else {
        return false;
    };
    local_providers().iter().any(|p| p == provider)
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
        // is_local_model-специфічна: включена сюди, щоб with_env так само
        // клірила/відновлювала її під тим самим ENV_LOCK (запобігає flaky
        // паралельним тестам, що читають N_LLM_LOCAL_PROVIDERS).
        "N_LLM_LOCAL_PROVIDERS",
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
    fn min_cascades_through_all_stronger_models() {
        with_env(&[("N_LOCAL_AVG_MODEL", "omlx/avg")], || {
            assert_eq!(resolve_model(Tier::Min).as_deref(), Some("omlx/avg"));
        });
        with_env(&[("N_CLOUD_MIN_MODEL", "openai/mini")], || {
            assert_eq!(resolve_model(Tier::Min).as_deref(), Some("openai/mini"));
        });
        with_env(&[("N_CLOUD_MAX_MODEL", "openai/max")], || {
            assert_eq!(resolve_model(Tier::Min).as_deref(), Some("openai/max"));
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
        with_env(&[("N_CLOUD_MAX_MODEL", "openai/max")], || {
            assert_eq!(resolve_model(Tier::Avg).as_deref(), Some("openai/max"));
        });
    }

    #[test]
    fn cloud_selector_skips_all_local_models() {
        with_env(
            &[
                ("N_LOCAL_MAX_MODEL", "omlx/max"),
                ("N_CLOUD_AVG_MODEL", "openai/avg"),
            ],
            || {
                assert_eq!(
                    resolve_model_from(ModelEnv::CloudMin).as_deref(),
                    Some("openai/avg")
                );
            },
        );
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

    // --- is_local_model: дзеркало isLocalModel (model-tiers.mjs) ---

    #[test]
    fn is_local_model_empty_spec_is_false() {
        with_env(&[], || {
            assert!(!is_local_model(""));
        });
    }

    #[test]
    fn is_local_model_default_provider_is_local_openai_only() {
        with_env(&[], || {
            assert!(is_local_model("local-openai/whatever"));
            // omlx злито в generic local-openai слот (nitra/7n-rules#374,
            // свідомий breaking change) — голий "omlx/..." більше не local.
            assert!(!is_local_model("omlx/gemma-4-e4b-it-OptiQ-4bit"));
            // "openai" — реальний cloud-provider prefix (genai/AdapterKind::OpenAI),
            // не local-openai слот: не повинен колізувати з local-мапою.
            assert!(!is_local_model("openai/gpt-5.4-mini"));
        });
    }

    #[test]
    fn is_local_model_matches_configured_local_tier_verbatim() {
        // Навіть значення, що не парситься провайдером зі списку
        // LOCAL_PROVIDERS, вважається локальним, якщо буквально збігається
        // з одним із N_LOCAL_*_MODEL (model-tiers.mjs:140).
        with_env(&[("N_LOCAL_MIN_MODEL", "custom/exact-match")], || {
            assert!(is_local_model("custom/exact-match"));
            assert!(!is_local_model("custom/other"));
        });
    }

    #[test]
    fn is_local_model_override_via_env_replaces_default_list() {
        with_env(&[("N_LLM_LOCAL_PROVIDERS", "vllm,ollama")], || {
            assert!(is_local_model("vllm/foo"));
            assert!(is_local_model("ollama/bar"));
            // Дефолтний local-openai більше не в списку — override повністю заміняє.
            assert!(!is_local_model("local-openai/gemma"));
        });
    }

    #[test]
    fn is_local_model_empty_override_yields_empty_provider_list() {
        // `??` спрацьовує лише на null/undefined — порожній рядок env-змінної
        // НЕ підставляє дефолт (JS ?? семантика, doc-комент local_providers()).
        with_env(&[("N_LLM_LOCAL_PROVIDERS", "")], || {
            assert!(!is_local_model("omlx/gemma"));
            assert!(!is_local_model("local-openai/x"));
        });
    }

    #[test]
    fn is_local_model_malformed_spec_without_slash_is_false() {
        with_env(&[], || {
            assert!(!is_local_model("no-slash-here"));
        });
    }
}
