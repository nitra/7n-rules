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

use crate::tiers::Tier;

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
            AcpAgentKind::Pi => {
                let (label, model) = match tier {
                    Tier::Min => ("GPT-5.6 Luna", "openai-codex/gpt-5.6-luna"),
                    Tier::Avg => ("GPT-5.6 Terra", "openai-codex/gpt-5.6-terra"),
                    Tier::Max => ("GPT-5.6 Sol", "openai-codex/gpt-5.6-sol"),
                };
                TierPreset::post_session(label, "model", model.to_string())
            }
        }
    }
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
        assert_eq!(config.value, "openai-codex/gpt-5.6-luna");

        let avg = AcpAgentKind::Pi.tier_preset(Tier::Avg);
        assert_eq!(
            avg.post_session_config.unwrap().value,
            "openai-codex/gpt-5.6-terra"
        );

        let max = AcpAgentKind::Pi.tier_preset(Tier::Max);
        assert_eq!(
            max.post_session_config.unwrap().value,
            "openai-codex/gpt-5.6-sol"
        );
    }

    #[test]
    fn every_kind_and_tier_carries_a_non_empty_ui_label() {
        for kind in [AcpAgentKind::Cursor, AcpAgentKind::Codex, AcpAgentKind::Pi] {
            assert!(!kind.label().is_empty());
            for tier in [Tier::Min, Tier::Avg, Tier::Max] {
                assert!(!kind.tier_preset(tier).label.is_empty());
            }
        }
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
