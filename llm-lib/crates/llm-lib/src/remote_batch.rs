//! Тип 2b (batch) — справжній `/v1/batches` бекенд поверх OpenAI-сумісного
//! batch-adapter-а (`docs/specs/2026-07-27-batch-local-avg-real-batches.md`) —
//! єдиний бекенд [`crate::batch::dispatch`] (клієнтську емуляцію вилучено).
//!
//! Протокол: upload JSONL (`POST /v1/files`, `purpose=batch`) → `POST
//! /v1/batches` (`endpoint: /v1/chat/completions`) → poll `GET
//! /v1/batches/{id}` до термінального статусу → `GET
//! /v1/files/{output_file_id}/content` (JSONL) → `BatchResult` за
//! `custom_id`. Помилка ОДНОГО item-у (`error`-поле рядка виводу) не валить
//! решту; помилка/скасування/expiry всього batch-у (валідація вхідного
//! файлу впала до старту жодного item-у) мапиться в однакову помилку для
//! кожного вхідного `custom_id` — виклик-сайт (batch-оркестратори скілів)
//! класифікує помилки per-item.

use std::collections::HashMap;
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;

use crate::batch::{BatchItem, BatchProgress, BatchResult};
use crate::LlmError;

/// Інтервал опитування (`GET .../batches/{id}`) і м'який ліміт часу очікування завершення batch-у.
/// Дефолти — консервативний старт (KEDA cold-start литого GPU-пода може
/// тривати десятки секунд, повний batch — хвилини); калібрування за
/// експлуатаційним досвідом лишається відкритим питанням спеки.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemoteBatchConfig {
    /// Пауза між послідовними `GET /v1/batches/{id}`.
    pub poll_interval: Duration,
    /// Скільки сумарно чекати термінального статусу, перш ніж скасувати
    /// (best-effort `POST .../cancel`) і повернути timeout-помилку по items.
    pub poll_timeout: Duration,
}

impl Default for RemoteBatchConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(2),
            poll_timeout: Duration::from_secs(20 * 60),
        }
    }
}

#[derive(Deserialize)]
struct FileResource {
    id: String,
}

#[derive(Deserialize, Default, Clone, Copy)]
struct RequestCounts {
    #[serde(default)]
    completed: u64,
    #[serde(default)]
    total: u64,
}

#[derive(Deserialize)]
struct BatchResource {
    id: String,
    status: String,
    #[serde(default)]
    request_counts: RequestCounts,
    output_file_id: Option<String>,
    errors: Option<serde_json::Value>,
}

/// Один рядок JSONL-виводу адаптера (дзеркалить `batch-adapter/adapter.mjs`
/// `output.push(...)`).
#[derive(Deserialize)]
struct OutputLine {
    custom_id: String,
    response: Option<OutputResponse>,
    error: Option<OutputError>,
}

#[derive(Deserialize)]
struct OutputResponse {
    body: serde_json::Value,
}

#[derive(Deserialize)]
struct OutputError {
    message: String,
}

fn auth(builder: reqwest::RequestBuilder, api_key: Option<&str>) -> reqwest::RequestBuilder {
    match api_key {
        Some(key) => builder.bearer_auth(key),
        None => builder,
    }
}

/// Розгортає HTTP-помилку статусу в [`LlmError::Provider`] з тілом
/// відповіді (адаптер повертає OpenAI-подібний `{error:{message,type}}`).
async fn ensure_ok(resp: reqwest::Response) -> Result<reqwest::Response, LlmError> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    Err(LlmError::Provider(format!(
        "batch adapter: HTTP {status}: {text}"
    )))
}

/// Один рядок вхідного JSONL — той самий OpenAI Batch input-контракт,
/// що й `parseBatchLine` в `batch-adapter/adapter.mjs`.
fn input_line(model: &str, item: &BatchItem) -> String {
    let mut messages = Vec::with_capacity(2);
    if let Some(system) = &item.system {
        messages.push(json!({"role": "system", "content": system}));
    }
    messages.push(json!({"role": "user", "content": item.prompt}));
    json!({
        "custom_id": item.custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": { "model": model, "messages": messages }
    })
    .to_string()
}

/// Витягує текст першої відповіді з тіла `chat/completions` (`choices[0].message.content`).
fn extract_text(body: &serde_json::Value) -> Option<String> {
    body.get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()
        .map(str::to_owned)
}

/// Мапує термінальну помилку batch-у (адаптер провалив увесь job до старту
/// item-ів — напр. `invalid_batch_input`) в однакове повідомлення для
/// кожного вхідного `custom_id`.
fn batch_level_error(batch: &BatchResource) -> String {
    match &batch.errors {
        Some(errors) if !errors.is_null() => format!("batch {}: {errors}", batch.status),
        _ => format!("batch {}", batch.status),
    }
}

/// Розбирає вихідний JSONL у [`BatchResult`] за вхідним порядком `items`;
/// `custom_id`, відсутній у виводі, отримує явну помилку (а не панікує чи
/// мовчки випадає) — той самий принцип повноти, що й у [`crate::batch::submit`].
fn parse_output(content: &str, items: &[BatchItem]) -> Result<Vec<BatchResult>, LlmError> {
    let mut by_id: HashMap<String, Result<String, String>> = HashMap::new();
    for line in content.lines().filter(|l| !l.trim().is_empty()) {
        let parsed: OutputLine = serde_json::from_str(line)
            .map_err(|e| LlmError::Provider(format!("batch output: невалідний рядок: {e}")))?;
        let outcome = if let Some(err) = parsed.error {
            Err(err.message)
        } else if let Some(resp) = parsed.response {
            extract_text(&resp.body).ok_or_else(|| "порожня відповідь моделі".to_string())
        } else {
            Err("batch: рядок виводу без response/error".to_string())
        };
        by_id.insert(parsed.custom_id, outcome);
    }
    Ok(items
        .iter()
        .map(|item| {
            let outcome = by_id.remove(&item.custom_id).unwrap_or_else(|| {
                Err("batch: результат відсутній для цього custom_id".to_string())
            });
            BatchResult {
                custom_id: item.custom_id.clone(),
                outcome,
            }
        })
        .collect())
}

/// Submit одного batch-у через справжній `/v1/batches` litellm-адаптера.
/// `model` — bare model-id (без `provider/` префіксу — той самий, що
/// litellm очікує в тілі `chat/completions`). Порожній `items` повертає
/// порожній результат без жодного HTTP-виклику (той самий контракт, що й
/// [`crate::batch::submit`] і що використовує `nativeBatchAvailable`
/// проба з порожнім набором на боці JS).
///
/// # Errors
/// [`LlmError::Provider`] на мережеву помилку чи невалідну відповідь
/// адаптера (upload/create/poll/output-фаза). Помилка ОКРЕМОГО item-у
/// (в JSONL-виводі) не потрапляє сюди — вона в `BatchResult::outcome`.
pub async fn submit<Progress>(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    items: Vec<BatchItem>,
    config: &RemoteBatchConfig,
    on_progress: Progress,
) -> Result<Vec<BatchResult>, LlmError>
where
    Progress: Fn(BatchProgress) + Send + Sync + 'static,
{
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let total = items.len();
    let client = reqwest::Client::new();

    let body = items
        .iter()
        .map(|item| input_line(model, item))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";

    let part = reqwest::multipart::Part::text(body)
        .file_name("batch.jsonl")
        .mime_str("application/jsonl")
        .map_err(|e| LlmError::Provider(format!("batch upload: {e}")))?;
    let form = reqwest::multipart::Form::new()
        .text("purpose", "batch")
        .part("file", part);

    let file_resp = auth(client.post(format!("{base_url}files")), api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| LlmError::Provider(format!("batch upload: {e}")))?;
    let file: FileResource = ensure_ok(file_resp)
        .await?
        .json()
        .await
        .map_err(|e| LlmError::Provider(format!("batch upload: невалідна відповідь: {e}")))?;

    let create_resp = auth(client.post(format!("{base_url}batches")), api_key)
        .json(&json!({
            "input_file_id": file.id,
            "endpoint": "/v1/chat/completions",
            "completion_window": "24h"
        }))
        .send()
        .await
        .map_err(|e| LlmError::Provider(format!("batch create: {e}")))?;
    let mut batch: BatchResource = ensure_ok(create_resp)
        .await?
        .json()
        .await
        .map_err(|e| LlmError::Provider(format!("batch create: невалідна відповідь: {e}")))?;

    let deadline = tokio::time::Instant::now() + config.poll_timeout;
    loop {
        on_progress(BatchProgress {
            completed: batch.request_counts.completed as usize,
            total: total.max(batch.request_counts.total as usize),
        });
        match batch.status.as_str() {
            "completed" => break,
            "failed" | "cancelled" | "expired" => {
                let message = batch_level_error(&batch);
                return Ok(items
                    .into_iter()
                    .map(|item| BatchResult {
                        custom_id: item.custom_id,
                        outcome: Err(message.clone()),
                    })
                    .collect());
            }
            _ => {}
        }
        if tokio::time::Instant::now() >= deadline {
            // Best-effort — не валимо весь виклик, якщо саме cancel не пройшов.
            let _ = auth(
                client.post(format!("{base_url}batches/{}/cancel", batch.id)),
                api_key,
            )
            .send()
            .await;
            let message = "batch: перевищено ліміт часу очікування (poll_timeout)".to_string();
            return Ok(items
                .into_iter()
                .map(|item| BatchResult {
                    custom_id: item.custom_id,
                    outcome: Err(message.clone()),
                })
                .collect());
        }
        tokio::time::sleep(config.poll_interval).await;
        let poll_resp = auth(
            client.get(format!("{base_url}batches/{}", batch.id)),
            api_key,
        )
        .send()
        .await
        .map_err(|e| LlmError::Provider(format!("batch poll: {e}")))?;
        batch = ensure_ok(poll_resp)
            .await?
            .json()
            .await
            .map_err(|e| LlmError::Provider(format!("batch poll: невалідна відповідь: {e}")))?;
    }
    on_progress(BatchProgress {
        completed: total,
        total,
    });

    let output_file_id = batch
        .output_file_id
        .ok_or_else(|| LlmError::Provider("batch completed без output_file_id".to_string()))?;
    let content_resp = auth(
        client.get(format!("{base_url}files/{output_file_id}/content")),
        api_key,
    )
    .send()
    .await
    .map_err(|e| LlmError::Provider(format!("batch output: {e}")))?;
    let content = ensure_ok(content_resp)
        .await?
        .text()
        .await
        .map_err(|e| LlmError::Provider(format!("batch output: {e}")))?;

    parse_output(&content, &items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, prompt: &str) -> BatchItem {
        BatchItem {
            custom_id: id.to_string(),
            prompt: prompt.to_string(),
            system: None,
        }
    }

    fn no_progress(_: BatchProgress) {}

    #[test]
    fn parse_output_matches_results_to_custom_id_and_fills_missing() {
        let items = vec![item("a", "p1"), item("b", "p2"), item("c", "p3")];
        let content = [
            r#"{"custom_id":"b","response":{"body":{"choices":[{"message":{"content":"answer-b"}}]}},"error":null}"#,
            r#"{"custom_id":"a","response":null,"error":{"message":"upstream boom"}}"#,
        ]
        .join("\n");

        let results = parse_output(&content, &items).expect("parse ok");
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].custom_id, "a");
        assert_eq!(results[0].outcome.as_deref().unwrap_err(), "upstream boom");
        assert_eq!(results[1].custom_id, "b");
        assert_eq!(results[1].outcome.as_deref(), Ok("answer-b"));
        assert_eq!(results[2].custom_id, "c");
        assert!(
            results[2]
                .outcome
                .as_ref()
                .unwrap_err()
                .contains("відсутній"),
            "custom_id без рядка виводу має дати явну помилку, не панікувати"
        );
    }

    #[test]
    fn input_line_includes_system_only_when_present() {
        let with_system = BatchItem {
            custom_id: "x".to_string(),
            prompt: "hello".to_string(),
            system: Some("sys".to_string()),
        };
        let without_system = item("y", "hi");

        let line_with = input_line("gemma-4-26b-awq", &with_system);
        let line_without = input_line("gemma-4-26b-awq", &without_system);

        let parsed_with: serde_json::Value = serde_json::from_str(&line_with).unwrap();
        let parsed_without: serde_json::Value = serde_json::from_str(&line_without).unwrap();
        assert_eq!(parsed_with["body"]["messages"].as_array().unwrap().len(), 2);
        assert_eq!(
            parsed_without["body"]["messages"].as_array().unwrap().len(),
            1
        );
        assert_eq!(parsed_with["body"]["model"], "gemma-4-26b-awq");
        assert_eq!(parsed_with["custom_id"], "x");
    }

    #[tokio::test]
    async fn submit_returns_empty_without_any_http_call_for_empty_items() {
        let results = submit(
            "http://127.0.0.1:1/v1/",
            None,
            "gemma-4-26b-awq",
            Vec::new(),
            &RemoteBatchConfig::default(),
            no_progress,
        )
        .await
        .expect("порожній items не має бити в мережу взагалі");
        assert!(results.is_empty());
    }
}
