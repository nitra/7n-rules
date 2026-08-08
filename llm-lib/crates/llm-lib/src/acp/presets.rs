//! Тір-пресети ACP-агентів (задача T3, рішення Б/Ж/З/З.1/К): для кожного
//! [`super::AcpAgentKind`] визначає, як абстрактний `Tier::Min/Avg/Max`
//! (рішення К — єдиний `Tier`-enum для всіх типів викликів, не лише ACP)
//! перекладається у конкретний спосіб резолвінгу моделі — env (Codex),
//! extra-arg (Cursor) чи post-session протокольний виклик
//! (Pi, рішення З.1) — плюс людинозрозумілий UI-лейбл (рішення Д: лейбли
//! живуть тут, у Rust-пресетах, не в JS).
//!
//! [`TierPreset`] — одна структура для всіх трьох способів застосування,
//! щоб `one_shot_acp`/session-API і майбутній napi-міст (задача T5:
//! `oneShotAcp` з `{tier}`) могли застосовувати результат резолвінгу
//! одноманітно, не розгалужуючись по kind-у вдруге: викликач зливає
//! `env`/`extra_args` у [`super::session::SessionOptions`] і передає
//! `post_session_config` як є — байдуже, який зі способів насправді
//! непорожній для конкретного kind-у.

use std::collections::HashMap;

use crate::tiers::{is_local_model, parse_model_spec, resolve_model, Tier};

use super::session::PostSessionConfig;
use super::AcpAgentKind;

/// Результат резолвінгу `AcpAgentKind × Tier`.
#[derive(Debug, Clone)]
pub struct TierPreset {
    /// Людинозрозумілий лейбл для UI-пікера (рішення Д), напр. `"GPT-5.6 Terra"`.
    pub label: &'static str,
    /// Extra env для спавну (Codex: `CODEX_CONFIG`). Порожньо для kind-ів,
    /// що резолвлять тір інакше.
    pub env: HashMap<String, String>,
    /// Extra args для спавну (Cursor: `--model <id>`). Порожньо для
    /// kind-ів, що резолвлять тір інакше.
    pub extra_args: Vec<String>,
    /// Опційний post-`session/new`-крок (Pi, рішення З.1) — `None` для
    /// kind-ів, що резолвлять тір через env/args на спавні.
    pub post_session_config: Option<PostSessionConfig>,
}

impl TierPreset {
    fn env_only(label: &'static str, key: &str, value: String) -> Self {
        let mut env = HashMap::new();
        env.insert(key.to_string(), value);
        Self {
            label,
            env,
            extra_args: Vec::new(),
            post_session_config: None,
        }
    }

    fn args_only(label: &'static str, args: Vec<String>) -> Self {
        Self {
            label,
            env: HashMap::new(),
            extra_args: args,
            post_session_config: None,
        }
    }

    fn post_session(label: &'static str, config_id: &str, value: String) -> Self {
        Self {
            label,
            env: HashMap::new(),
            extra_args: Vec::new(),
            post_session_config: Some(PostSessionConfig::new(config_id, value)),
        }
    }

    /// Кілька env-пар одразу (goose: `GOOSE_PROVIDER`/`GOOSE_MODEL` і
    /// опційно `OPENAI_HOST`/`OPENAI_API_KEY` для локального endpoint-а) —
    /// [`Self::env_only`] несе рівно одну пару, тут потрібно кілька.
    fn env_pairs(label: &'static str, env: HashMap<String, String>) -> Self {
        Self {
            label,
            env,
            extra_args: Vec::new(),
            post_session_config: None,
        }
    }
}

/// `CODEX_CONFIG`-значення для codex model id — той самий формат, що й
/// `codexModelEnv()` у `tauri-components:npm/src/core/acp-agent-presets.js`
/// (READ-ONLY референс, файл сам НЕ читається в рантаймі — див. паритет-тест
/// нижче): `JSON.stringify({ model })`, без пробілів між токенами.
fn codex_config_value(model: &str) -> String {
    format!(r#"{{"model":"{model}"}}"#)
}

impl AcpAgentKind {
    /// Людинозрозумілий лейбл самого агента (рішення Д), незалежний від тіру.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            AcpAgentKind::Cursor => "Cursor CLI",
            AcpAgentKind::Codex => "OpenAI Codex",
            AcpAgentKind::Pi => "Pi",
            AcpAgentKind::Goose => "Goose",
        }
    }

    /// Резолвить `tier` у [`TierPreset`] для цього kind-у (рішення Б/Ж/З/З.1).
    #[must_use]
    pub fn tier_preset(self, tier: Tier) -> TierPreset {
        match self {
            AcpAgentKind::Codex => {
                let (label, model) = match tier {
                    Tier::Min => ("GPT-5.6 Luna", "gpt-5.6-luna"),
                    Tier::Avg => ("GPT-5.6 Terra", "gpt-5.6-terra"),
                    Tier::Max => ("GPT-5.6 Sol", "gpt-5.6-sol"),
                };
                TierPreset::env_only(label, "CODEX_CONFIG", codex_config_value(model))
            }
            AcpAgentKind::Cursor => {
                let (label, model_id) = match tier {
                    Tier::Min => ("GPT-5.6 Luna (low)", "gpt-5.6-luna-low"),
                    Tier::Avg => ("Grok 4.5 (medium)", "cursor-grok-4.5-medium"),
                    Tier::Max => ("GPT-5.6 Sol (max)", "gpt-5.6-sol-max"),
                };
                TierPreset::args_only(label, vec!["--model".to_string(), model_id.to_string()])
            }
            // Pi-тіри (оновлене рішення З.1, 2026-07-27): min/avg — локальні
            // моделі (безкоштовні), max — підписка codex. Передумова на
            // машині: провайдери `omlx`/`litellm` описані в pi
            // (`~/.pi/agent/models.json`; litellm — https://llm.7n.ai/v1/ з
            // ключем) — інакше `session/set_config_option` на спавні
            // провалиться. Деталі litellm-провайдера — PR nitra/7n-rules#249.
            AcpAgentKind::Pi => {
                let (label, model) = match tier {
                    Tier::Min => ("Gemma 4 E4B (omlx)", "omlx/gemma-4-e4b-it-OptiQ-4bit"),
                    Tier::Avg => ("Gemma 4 26B (LiteLLM)", "litellm/gemma-4-26b-awq"),
                    Tier::Max => ("GPT-5.6 Sol", "openai-codex/gpt-5.6-sol"),
                };
                TierPreset::post_session(label, "model", model.to_string())
            }
            // Goose-тір (рішення З специфікації
            // `2026-08-08-llm-lib-acp-only-rust-goose.md`): жодних нових
            // env-ключів — джерело істини лишається наявний `N_*_MODEL`-
            // контракт `crate::tiers` (та сама "лише сильніші, спочатку
            // local, потім cloud" каскадна семантика, що й
            // `LocalCloud`/`resolve_model`). На відміну від Codex/Cursor/Pi
            // вище (захардкоджені конкретні моделі за тір), тут конкретна
            // модель невідома на момент компіляції — резолвиться з env на
            // кожен виклик [`AcpAgentKind::tier_preset`], тому лейбл
            // навмисно описує ДЖЕРЕЛО тіру (`"Goose (N_LOCAL_MIN_MODEL)"`),
            // а не саму модель: тип `TierPreset::label` — `&'static str`,
            // конкретне резолвлене значення в нього просто не влізе.
            AcpAgentKind::Goose => TierPreset::env_pairs(goose_tier_label(tier), goose_env(tier)),
        }
    }
}

/// Лейбл goose-тіру — джерело (стартова env-сходинка [`resolve_model`]), не
/// сама модель: та резолвиться лише в рантаймі, а лейбл — `&'static str`
/// (див. коментар у [`AcpAgentKind::tier_preset`]).
fn goose_tier_label(tier: Tier) -> &'static str {
    match tier {
        Tier::Min => "Goose (N_LOCAL_MIN_MODEL)",
        Tier::Avg => "Goose (N_LOCAL_AVG_MODEL)",
        Tier::Max => "Goose (N_LOCAL_MAX_MODEL)",
    }
}

/// Розкладає `"provider/model-id"`, резолвлений [`resolve_model`] для
/// `tier`, у env для goose (специфікація §3.2): `GOOSE_PROVIDER`/`GOOSE_MODEL`
/// завжди, і додатково `OPENAI_HOST`/`OPENAI_API_KEY` — коли модель локальна
/// ([`is_local_model`]), бо тоді goose мусить піти на кастомний OpenAI-
/// сумісний endpoint (omlx тощо), а не на публічний. Host/ключ — з того
/// самого джерела, що й решта local-cloud-контуру крейта:
/// [`crate::local_cloud::default_local_openai_provider`], жодного нового
/// env-джерела. Тір без сконфігурованої моделі (жодна `N_*_MODEL`-сходинка
/// не задана) дає порожній env — goose тоді спавниться зі своїм власним
/// дефолтним провайдером/конфігом (той самий fail-soft, що й у
/// `one_shot_local_cloud`, де відсутність моделі — помилка лише в точці
/// виклику, не тут).
fn goose_env(tier: Tier) -> HashMap<String, String> {
    let mut env = HashMap::new();
    let Some(spec) = resolve_model(tier) else {
        return env;
    };
    let Ok((provider, model)) = parse_model_spec(&spec) else {
        // `resolve_model` завжди повертає значення прямо з env, яке сам
        // викликач і виставив — малоймовірний шлях, але без валідного
        // "provider/model-id" goose однаково не спавнити коректно.
        return env;
    };

    if is_local_model(&spec) {
        let local = crate::local_cloud::default_local_openai_provider();
        env.insert("GOOSE_PROVIDER".to_string(), "openai".to_string());
        env.insert("GOOSE_MODEL".to_string(), model.to_string());
        env.insert("OPENAI_HOST".to_string(), local.base_url);
        env.insert(
            "OPENAI_API_KEY".to_string(),
            local.api_key.unwrap_or_else(|| "local".to_string()),
        );
    } else {
        // Хмарний провайдер: без host/key-override — goose (як і
        // `local_cloud::LocalCloud`, див. `one_shot_with_spec`) бере
        // стандартну автентифікацію провайдера з env самостійно.
        env.insert("GOOSE_PROVIDER".to_string(), provider.to_string());
        env.insert("GOOSE_MODEL".to_string(), model.to_string());
    }

    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_tiers_use_codex_config_env_luna_terra_sol() {
        let min = AcpAgentKind::Codex.tier_preset(Tier::Min);
        assert_eq!(
            min.env.get("CODEX_CONFIG"),
            Some(&codex_config_value("gpt-5.6-luna"))
        );
        assert!(min.extra_args.is_empty());
        assert!(min.post_session_config.is_none());

        let avg = AcpAgentKind::Codex.tier_preset(Tier::Avg);
        assert_eq!(
            avg.env.get("CODEX_CONFIG"),
            Some(&codex_config_value("gpt-5.6-terra"))
        );

        let max = AcpAgentKind::Codex.tier_preset(Tier::Max);
        assert_eq!(
            max.env.get("CODEX_CONFIG"),
            Some(&codex_config_value("gpt-5.6-sol"))
        );
    }

    #[test]
    fn cursor_tiers_use_model_extra_arg_with_effort_suffixes() {
        let min = AcpAgentKind::Cursor.tier_preset(Tier::Min);
        assert_eq!(
            min.extra_args,
            vec!["--model".to_string(), "gpt-5.6-luna-low".to_string()]
        );
        assert!(min.env.is_empty());
        assert!(min.post_session_config.is_none());

        let avg = AcpAgentKind::Cursor.tier_preset(Tier::Avg);
        assert_eq!(
            avg.extra_args,
            vec!["--model".to_string(), "cursor-grok-4.5-medium".to_string()]
        );

        let max = AcpAgentKind::Cursor.tier_preset(Tier::Max);
        assert_eq!(
            max.extra_args,
            vec!["--model".to_string(), "gpt-5.6-sol-max".to_string()]
        );
    }

    #[test]
    fn pi_tiers_use_post_session_config_not_env_or_args() {
        let min = AcpAgentKind::Pi.tier_preset(Tier::Min);
        assert!(min.env.is_empty(), "pi не бере тір через env на спавні");
        assert!(
            min.extra_args.is_empty(),
            "pi не бере тір через extra-args на спавні"
        );
        let config = min.post_session_config.expect("pi несе post-session-крок");
        assert_eq!(config.config_id, "model");
        assert_eq!(config.value, "omlx/gemma-4-e4b-it-OptiQ-4bit");

        let avg = AcpAgentKind::Pi.tier_preset(Tier::Avg);
        assert_eq!(
            avg.post_session_config.unwrap().value,
            "litellm/gemma-4-26b-awq"
        );

        let max = AcpAgentKind::Pi.tier_preset(Tier::Max);
        assert_eq!(
            max.post_session_config.unwrap().value,
            "openai-codex/gpt-5.6-sol"
        );
    }

    /// Goose (рішення З специфікації
    /// `2026-08-08-llm-lib-acp-only-rust-goose.md`) — єдиний kind, чий
    /// [`AcpAgentKind::tier_preset`] читає env, тож серіалізовано через
    /// спільний [`crate::tiers::test_env::with_env`] (той самий м'ютекс,
    /// що й `tiers::tests`/`local_cloud`-тести на ті самі env-змінні —
    /// без нього паралельний прогін `cargo test` гнав би флейкі-гонку за
    /// глобальний env).
    #[test]
    fn goose_local_tier_maps_local_openai_model_into_goose_and_openai_env() {
        crate::tiers::test_env::with_env(
            &[
                (
                    "N_LOCAL_MIN_MODEL",
                    "local-openai/gemma-4-e4b-it-OptiQ-4bit",
                ),
                ("N_LOCAL_OPENAI_BASE_URL", "http://127.0.0.1:8000/v1/"),
                ("N_LOCAL_OPENAI_API_KEY", "local-secret"),
            ],
            || {
                let preset = AcpAgentKind::Goose.tier_preset(Tier::Min);
                assert_eq!(
                    preset.env.get("GOOSE_PROVIDER").map(String::as_str),
                    Some("openai")
                );
                assert_eq!(
                    preset.env.get("GOOSE_MODEL").map(String::as_str),
                    Some("gemma-4-e4b-it-OptiQ-4bit")
                );
                assert_eq!(
                    preset.env.get("OPENAI_HOST").map(String::as_str),
                    Some("http://127.0.0.1:8000/v1/")
                );
                assert_eq!(
                    preset.env.get("OPENAI_API_KEY").map(String::as_str),
                    Some("local-secret")
                );
                assert!(
                    preset.extra_args.is_empty(),
                    "goose не бере тір через extra-args на спавні"
                );
                assert!(
                    preset.post_session_config.is_none(),
                    "goose не бере тір через post-session-крок"
                );
            },
        );
    }

    #[test]
    fn goose_local_tier_without_configured_api_key_falls_back_to_placeholder() {
        crate::tiers::test_env::with_env(&[("N_LOCAL_MIN_MODEL", "local-openai/gemma")], || {
            let preset = AcpAgentKind::Goose.tier_preset(Tier::Min);
            assert_eq!(
                    preset.env.get("OPENAI_API_KEY").map(String::as_str),
                    Some("local"),
                    "без сконфігурованого N_LOCAL_OPENAI_API_KEY — плейсхолдер, як і в local_cloud::LocalCloud"
                );
        });
    }

    #[test]
    fn goose_cloud_tier_maps_provider_and_model_without_openai_host_override() {
        crate::tiers::test_env::with_env(&[("N_CLOUD_MAX_MODEL", "openai/gpt-5.4-mini")], || {
            let preset = AcpAgentKind::Goose.tier_preset(Tier::Max);
            assert_eq!(
                preset.env.get("GOOSE_PROVIDER").map(String::as_str),
                Some("openai")
            );
            assert_eq!(
                preset.env.get("GOOSE_MODEL").map(String::as_str),
                Some("gpt-5.4-mini")
            );
            assert!(
                !preset.env.contains_key("OPENAI_HOST"),
                "хмарний тір не має перекривати host — goose бере стандартну автентифікацію сам"
            );
            assert!(preset.extra_args.is_empty());
            assert!(preset.post_session_config.is_none());
        });
    }

    #[test]
    fn goose_tier_without_configured_model_yields_empty_env() {
        crate::tiers::test_env::with_env(&[], || {
            let preset = AcpAgentKind::Goose.tier_preset(Tier::Avg);
            assert!(
                preset.env.is_empty(),
                "без жодної N_*_MODEL-сходинки goose спавниться зі своїм дефолтним конфігом"
            );
        });
    }

    #[test]
    fn goose_command_is_the_stdio_acp_subcommand() {
        assert_eq!(AcpAgentKind::Goose.command(), "goose acp");
    }

    #[test]
    fn goose_tier_labels_describe_the_env_source_not_the_resolved_model() {
        crate::tiers::test_env::with_env(&[], || {
            assert_eq!(
                AcpAgentKind::Goose.tier_preset(Tier::Min).label,
                "Goose (N_LOCAL_MIN_MODEL)"
            );
            assert_eq!(
                AcpAgentKind::Goose.tier_preset(Tier::Avg).label,
                "Goose (N_LOCAL_AVG_MODEL)"
            );
            assert_eq!(
                AcpAgentKind::Goose.tier_preset(Tier::Max).label,
                "Goose (N_LOCAL_MAX_MODEL)"
            );
        });
    }

    #[test]
    fn every_kind_and_tier_carries_a_non_empty_ui_label() {
        crate::tiers::test_env::with_env(&[], || {
            for kind in [
                AcpAgentKind::Cursor,
                AcpAgentKind::Codex,
                AcpAgentKind::Pi,
                AcpAgentKind::Goose,
            ] {
                assert!(!kind.label().is_empty());
                for tier in [Tier::Min, Tier::Avg, Tier::Max] {
                    assert!(!kind.tier_preset(tier).label.is_empty());
                }
            }
        });
    }

    /// Паритет із JS-пресетом
    /// `tauri-components:npm/src/core/acp-agent-presets.js` (READ-ONLY
    /// референс — файл сам НЕ читається в рантаймі цього тесту, значення
    /// захардкоджені як текстова копія на момент задачі T3):
    ///
    /// ```js
    /// function codexModelEnv(model) {
    ///   return { CODEX_CONFIG: JSON.stringify({ model }) }
    /// }
    /// export const CODEX_ACP_AGENT_PRESET = {
    ///   tiers: {
    ///     MIN: { label: 'GPT-5.6 Luna', env: codexModelEnv('gpt-5.6-luna') },
    ///     AVG: { label: 'GPT-5.6 Terra', env: codexModelEnv('gpt-5.6-terra') },
    ///     MAX: { label: 'GPT-5.6 Sol', env: codexModelEnv('gpt-5.6-sol') }
    ///   }
    /// }
    /// ```
    ///
    /// `JSON.stringify({ model: 'gpt-5.6-luna' })` дає рядок
    /// `{"model":"gpt-5.6-luna"}` — без пробілів, подвійні лапки — саме той
    /// формат, що й [`codex_config_value`].
    #[test]
    fn codex_config_value_matches_js_preset_json_stringify_format() {
        assert_eq!(
            codex_config_value("gpt-5.6-luna"),
            r#"{"model":"gpt-5.6-luna"}"#
        );
        assert_eq!(
            codex_config_value("gpt-5.6-terra"),
            r#"{"model":"gpt-5.6-terra"}"#
        );
        assert_eq!(
            codex_config_value("gpt-5.6-sol"),
            r#"{"model":"gpt-5.6-sol"}"#
        );
    }
}
