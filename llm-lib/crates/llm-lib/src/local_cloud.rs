//! One-shot виклики через [`genai`] — локальні тири (кастомний OpenAI-сумісний
//! ендпоінт, напр. omlx) і хмарні тири (стандартна автентифікація genai за
//! змінними середовища провайдера).
//!
//! Без retry: один HTTP-виклик на [`crate::one_shot_local_or_cloud`] — той
//! самий fail-fast принцип, що й у `runOneShot` з `@7n/llm-lib`.

use std::collections::HashMap;
use std::sync::Arc;

use genai::adapter::AdapterKind;
use genai::chat::{ChatMessage, ChatRequest};
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::Client;

use crate::tiers::{parse_model_spec, resolve_model, Tier};
use crate::LlmError;

/// Конфіг одного локального/кастомного OpenAI-сумісного провайдера.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProvider {
    /// Base URL ендпоінта **із завершальним слешем** (напр.
    /// `http://127.0.0.1:8000/v1/`) — `Url::join` семантика Rust трактує
    /// відсутність слеша як "файл" і зʼїдає останній сегмент шляху.
    pub base_url: String,
    /// Ключ авторизації, якщо сервер його перевіряє (деякі конфігурації omlx
    /// звіряють `Authorization: Bearer <key>` — `skip_api_key_verification`
    /// у `~/.omlx/settings.json`). `None` — заглушка-плейсхолдер.
    pub api_key: Option<String>,
}

/// Клієнт для local/cloud тирів. Локальні провайдери (напр. `omlx`) —
/// кастомний OpenAI-сумісний ендпоінт із `local_providers`; будь-який інший
/// provider-префікс трактується як відомий genai хмарний провайдер (модель
/// передається без префіксу — genai сам розпізнає адаптер за іменем моделі).
#[derive(Clone)]
pub struct LocalCloud {
    local_providers: Arc<HashMap<String, LocalProvider>>,
    local_client: Client,
    cloud_client: Client,
}

impl LocalCloud {
    /// `local_providers`: мапа `provider-префікс → конфіг`, напр.
    /// `{"omlx": LocalProvider { base_url: "http://127.0.0.1:8000/v1", api_key: Some(key) }}`.
    #[must_use]
    pub fn new(local_providers: HashMap<String, LocalProvider>) -> Self {
        let local_providers = Arc::new(local_providers);
        let providers_for_resolver = Arc::clone(&local_providers);

        let resolver =
            ServiceTargetResolver::from_resolver_fn(move |target: genai::ServiceTarget| {
                let genai::ServiceTarget { model, .. } = target;
                let (provider, model_name) =
                    parse_model_spec(&model.model_name).map_err(genai::resolver::Error::Custom)?;
                let config = providers_for_resolver.get(provider).ok_or_else(|| {
                    genai::resolver::Error::Custom(format!(
                        "невідомий локальний provider {provider:?}"
                    ))
                })?;
                let auth = config
                    .api_key
                    .clone()
                    .map(AuthData::from_single)
                    .unwrap_or_else(|| AuthData::from_single("local"));
                Ok(genai::ServiceTarget {
                    endpoint: Endpoint::from_owned(config.base_url.clone()),
                    auth,
                    model: genai::ModelIden::new(AdapterKind::OpenAI, model_name),
                })
            });

        Self {
            local_providers,
            local_client: Client::builder()
                .with_service_target_resolver(resolver)
                .build(),
            cloud_client: Client::default(),
        }
    }

    /// Один виклик чату для абстрактного тиру: резолвить `"provider/model-id"`
    /// через [`resolve_model`], б'є в local- чи cloud-клієнт залежно від того,
    /// чи `provider` є в `local_providers`.
    ///
    /// # Errors
    /// [`LlmError::NoModelConfigured`] якщо для тиру не задано жодної
    /// env-змінної; [`LlmError::Provider`] на помилку самого виклику.
    pub async fn one_shot(
        &self,
        tier: Tier,
        system: Option<&str>,
        user: &str,
    ) -> Result<String, LlmError> {
        let spec = resolve_model(tier).ok_or(LlmError::NoModelConfigured(tier))?;
        self.one_shot_with_spec(&spec, system, user).await
    }

    /// Той самий один виклик чату, що й [`Self::one_shot`], але з явним
    /// `"provider/model-id"` замість тиру (задача T5, napi `oneShotLocalCloud`:
    /// приймає або тір, або явний model-spec — тут другий шлях, без жодного
    /// звернення до [`resolve_model`]/env).
    ///
    /// # Errors
    /// [`LlmError::InvalidModelSpec`] якщо `spec` не парситься; [`LlmError::Provider`]
    /// на помилку самого виклику.
    pub async fn one_shot_with_spec(
        &self,
        spec: &str,
        system: Option<&str>,
        user: &str,
    ) -> Result<String, LlmError> {
        let (provider, model_name) = parse_model_spec(spec).map_err(LlmError::InvalidModelSpec)?;

        let mut req = ChatRequest::default();
        if let Some(sys) = system {
            req = req.with_system(sys);
        }
        req = req.append_message(ChatMessage::user(user));

        let (client, model_for_call): (&Client, &str) =
            if self.local_providers.contains_key(provider) {
                (&self.local_client, spec)
            } else {
                // Хмарний провайдер: без префіксу — genai сам розпізнає адаптер
                // за іменем моделі (AdapterKind::from_model) і власним дефолтним
                // ендпоінтом/env-ключем провайдера.
                (&self.cloud_client, model_name)
            };

        let res = client
            .exec_chat(model_for_call, req, None)
            .await
            .map_err(|e| LlmError::Provider(e.to_string()))?;

        res.first_text()
            .map(str::to_owned)
            .ok_or_else(|| LlmError::Provider("порожня відповідь моделі".to_string()))
    }
}
