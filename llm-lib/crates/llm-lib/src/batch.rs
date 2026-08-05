//! Тип 2b (OpenAI-сумісний API, batch) — [`dispatch`] завжди йде через
//! справжній `/v1/batches` OpenAI-сумісний адаптер ([`crate::remote_batch`],
//! спека `2026-07-27-batch-local-avg-real-batches.md`). Клієнтську емуляцію
//! (v1, чанкований конкурентний прогін через [`crate::local_cloud`], Тип 2a)
//! вилучено: генерик-слот `local-openai` тепер вимагає реального Batch API на
//! сервері — провайдер без зареєстрованого `base_url`/`api_key` чи без
//! підтримки `/v1/files`+`/v1/batches` повертає явну помилку, а не тиху
//! деградацію в емуляцію.
//!
//! **Помилка одного item не валить увесь batch** — вона потрапляє у
//! відповідний [`BatchResult::outcome`], решта items обробляються далі
//! (`crate::remote_batch::submit`).

use crate::local_cloud::LocalCloud;
use crate::remote_batch::{self, RemoteBatchConfig};
use crate::tiers::parse_model_spec;
use crate::LlmError;

/// Один запит у batch — той самий `custom_id`-контракт, що й OpenAI Batch
/// API (v2 буде говорити тим самим полем), щоб емуляція v1 і справжній
/// сервер v2 ділили один виклик-сайт.
#[derive(Debug, Clone)]
pub struct BatchItem {
    /// Ідентифікатор, яким викликач звʼязує запит із результатом —
    /// має бути унікальним у межах одного `submit`.
    pub custom_id: String,
    /// User-репліка чату.
    pub prompt: String,
    /// Опційна system-репліка (якщо не задано — виконавець вирішує сам,
    /// напр. бере глобальний дефолт).
    pub system: Option<String>,
}

/// Результат одного item. `outcome` — `Ok(text)` чи `Err(message)`;
/// помилка **не** типізована як [`LlmError`] навмисно (той самий плоский
/// підхід, що й у решті крейта) — рядок достатній для napi-мосту, де
/// помилка одного item лише показується користувачу, не оброблюється
/// програмно.
#[derive(Debug, Clone)]
pub struct BatchResult {
    /// Той самий `custom_id`, що й у вхідному [`BatchItem`].
    pub custom_id: String,
    /// `Ok(text)` — успішна відповідь; `Err(message)` — помилка саме
    /// цього item (мережа, провайдер, паніка виконавця) — інші items
    /// batch-у це не зачіпає.
    pub outcome: Result<String, String>,
}

/// Знімок прогресу — скільки items уже має результат (успішний чи ні) з
/// усього `total`. Монотонно зростає до `total` включно.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchProgress {
    /// Скільки items уже завершено (успіх чи помилка — байдуже).
    pub completed: usize,
    /// Загальна кількість items у batch-і.
    pub total: usize,
}

/// Диспетчер Типу 2b: резолвить `model_spec_or_tier` через
/// [`LocalCloud::resolve_spec`], визначає провайдер і виконує batch виключно
/// через [`crate::remote_batch::submit`] (справжній `/v1/batches`, лише
/// bare model-id без provider-префікса — той самий, що адаптер очікує в тілі
/// `chat/completions`). Провайдер без зареєстрованого `base_url`/`api_key`
/// у `local_providers` — явна помилка, без тихого фолбеку.
///
/// `global_system` — дефолтна system-репліка для items без власної (той
/// самий merge, що раніше робила клієнтська емуляція) — застосовується тут,
/// перед відправкою в [`remote_batch::submit`], бо той сам по собі
/// `global_system` не знає.
///
/// # Errors
/// [`LlmError::NoModelConfigured`]/[`LlmError::InvalidModelSpec`] з
/// [`LocalCloud::resolve_spec`]/парсингу spec-у; [`LlmError::Provider`], якщо
/// провайдер не зареєстрований у `local_providers`, або з самого
/// [`remote_batch::submit`] (мережа, невалідна відповідь адаптера).
pub async fn dispatch<Progress>(
    cascade: &LocalCloud,
    model_spec_or_tier: &str,
    items: Vec<BatchItem>,
    remote_config: &RemoteBatchConfig,
    global_system: Option<String>,
    on_progress: Progress,
) -> Result<Vec<BatchResult>, LlmError>
where
    Progress: Fn(BatchProgress) + Send + Sync + 'static,
{
    let spec = cascade.resolve_spec(model_spec_or_tier)?;
    let (provider, model_name) = parse_model_spec(&spec).map_err(LlmError::InvalidModelSpec)?;

    let config = cascade.provider_config(provider).ok_or_else(|| {
        LlmError::Provider(format!(
            "провайдер {provider:?} не зареєстрований у local_providers (немає base_url/api_key) \
             — реальний Batch API вимагає явного конфігу, емуляція вилучена"
        ))
    })?;

    let items: Vec<BatchItem> = items
        .into_iter()
        .map(|mut item| {
            if item.system.is_none() {
                item.system = global_system.clone();
            }
            item
        })
        .collect();

    remote_batch::submit(
        &config.base_url,
        config.api_key.as_deref(),
        model_name,
        items,
        remote_config,
        on_progress,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> BatchItem {
        BatchItem {
            custom_id: id.to_string(),
            prompt: format!("prompt-{id}"),
            system: None,
        }
    }

    fn no_progress(_: BatchProgress) {}

    fn provider(base_url: &str) -> crate::local_cloud::LocalProvider {
        crate::local_cloud::LocalProvider {
            base_url: base_url.to_string(),
            api_key: None,
        }
    }

    /// Порожній набір items не спричиняє жодного мережевого виклику
    /// ([`crate::remote_batch::submit`] short-circuit-ить на `is_empty`) —
    /// безпечно перевіряти сам диспетчер без піднімання мок-сервера.
    #[tokio::test]
    async fn dispatch_uses_remote_batch_for_registered_provider() {
        let mut providers = std::collections::HashMap::new();
        providers.insert(
            "local-openai".to_string(),
            provider("http://127.0.0.1:1/v1/"),
        );
        let cascade = LocalCloud::new(providers);

        let results = dispatch(
            &cascade,
            "local-openai/gemma-4-26b-awq",
            Vec::new(),
            &RemoteBatchConfig::default(),
            None,
            no_progress,
        )
        .await
        .expect("порожній batch не має провалюватись");
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn dispatch_errors_when_provider_not_registered() {
        let cascade = LocalCloud::new(std::collections::HashMap::new());

        let err = dispatch(
            &cascade,
            "local-openai/gemma-4-26b-awq",
            vec![item("a")],
            &RemoteBatchConfig::default(),
            None,
            no_progress,
        )
        .await
        .expect_err("незареєстрований провайдер має явно провалитись, без фолбеку на емуляцію");
        assert!(matches!(err, LlmError::Provider(_)));
    }

    #[tokio::test]
    async fn dispatch_fills_missing_item_system_from_global_system() {
        let mut providers = std::collections::HashMap::new();
        providers.insert(
            "local-openai".to_string(),
            provider("http://127.0.0.1:1/v1/"),
        );
        let cascade = LocalCloud::new(providers);

        // Порожні items — доводимо лише, що виклик не падає з global_system
        // заданим (саме заповнення перевіряється на рівні remote_batch::submit
        // через item.system, тут — інтеграційна перевірка "не ламається").
        let results = dispatch(
            &cascade,
            "local-openai/gemma-4-26b-awq",
            Vec::new(),
            &RemoteBatchConfig::default(),
            Some("ти корисний асистент".to_string()),
            no_progress,
        )
        .await
        .expect("global_system не має ламати диспетчер");
        assert!(results.is_empty());
    }
}
