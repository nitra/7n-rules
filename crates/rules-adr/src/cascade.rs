//! Спільний 2-хвильовий batch-каскад усіх LLM-стадій конвеєра — порт
//! `runWave`/`keyedCascade` (`runCascade` у JS — окремий випадок keyed без
//! використання customId у parse; тут одна функція обслуговує обидва).
//!
//! tier1-хвиля на ВСІ items → ті, чия відповідь не пройшла parse (мережа чи
//! невалідний вихід), ідуть у tier2-хвилю (лише за `allow_cloud` і наявного
//! tier2) → що лишилось — не потрапляє в результат, conservative fallback
//! застосовує викликач стадії.

use std::collections::HashMap;
use std::sync::Arc;

use llm_lib::attempt::BoxFuture;

/// Один item batch-хвилі (порт форми `submitBatch`-item-а).
#[derive(Debug, Clone)]
pub struct WaveItem {
    /// Унікальний у межах хвилі ідентифікатор для зіставлення результату.
    pub custom_id: String,
    /// User-репліка.
    pub prompt: String,
    /// System-репліка стадії.
    pub system: String,
}

/// Результат одного item хвилі: `Ok(text)` чи `Err(message)`.
#[derive(Debug, Clone)]
pub struct WaveResult {
    /// Той самий `custom_id`, що у вхідному item.
    pub custom_id: String,
    /// Текст відповіді або помилка item-а.
    pub outcome: Result<String, String>,
}

/// Інʼєкція виконавця хвилі: model-spec + items → результати. Бойова
/// реалізація — обгортка над `llm_lib::batch::dispatch`; тестова — фейк.
pub type SubmitBatchFn = Arc<
    dyn Fn(String, Vec<WaveItem>) -> BoxFuture<'static, Result<Vec<WaveResult>, String>>
        + Send
        + Sync,
>;

/// Лічильники прогону — порт `stats` (мутуються стадіями через каскад).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Stats {
    pub local_calls: usize,
    pub cloud_calls: usize,
    pub escalations: usize,
    pub failures: usize,
    pub madr_invalid: usize,
}

/// Конфіг каскаду однієї стадії.
pub struct CascadeCfg {
    /// Model-spec першої хвилі (порожній — хвиля пропускається).
    pub tier1: String,
    /// Model-spec хмарної хвилі.
    pub tier2: String,
    /// Чи дозволена хмарна ескалація.
    pub allow_cloud: bool,
    /// Виконавець хвилі.
    pub submit: SubmitBatchFn,
}

/// Одна хвиля — порт `runWave`: провал САМОГО виклику хвилі не кидає далі,
/// повертає порожню мапу (усі items тиру невдалі → наступний тир/fallback).
async fn run_wave(
    items: &[WaveItem],
    model: &str,
    cfg: &CascadeCfg,
) -> HashMap<String, Result<String, String>> {
    if items.is_empty() || model.is_empty() {
        return HashMap::new();
    }
    match (cfg.submit)(model.to_string(), items.to_vec()).await {
        Ok(results) => results
            .into_iter()
            .map(|r| (r.custom_id, r.outcome))
            .collect(),
        Err(_) => HashMap::new(),
    }
}

/// Порт `keyedCascade`: tier1 → parse → tier2 для невдалих → результат лише
/// для items, що пройшли якийсь тир. `parse` отримує сирий текст і
/// `custom_id` (стадіям gen-MADR/gen-merge валідація залежить від item-а).
pub async fn keyed_cascade<T>(
    items: &[WaveItem],
    parse: impl Fn(&str, &str) -> Result<T, String>,
    cfg: &CascadeCfg,
    stats: &mut Stats,
) -> HashMap<String, T> {
    let mut parsed = HashMap::new();
    if items.is_empty() {
        return parsed;
    }

    stats.local_calls += items.len();
    let tier1 = run_wave(items, &cfg.tier1, cfg).await;
    let mut failed: Vec<&WaveItem> = Vec::new();
    for item in items {
        if let Some(Ok(text)) = tier1.get(&item.custom_id) {
            if let Ok(value) = parse(text, &item.custom_id) {
                parsed.insert(item.custom_id.clone(), value);
                continue;
            }
        }
        failed.push(item);
    }

    if !failed.is_empty() && cfg.allow_cloud && !cfg.tier2.is_empty() {
        stats.cloud_calls += failed.len();
        stats.escalations += failed.len();
        let owned: Vec<WaveItem> = failed.iter().map(|i| (*i).clone()).collect();
        let tier2 = run_wave(&owned, &cfg.tier2, cfg).await;
        for item in failed {
            if let Some(Ok(text)) = tier2.get(&item.custom_id) {
                if let Ok(value) = parse(text, &item.custom_id) {
                    parsed.insert(item.custom_id.clone(), value);
                }
            }
        }
    }

    stats.failures += items.len() - parsed.len();
    parsed
}

/// Витяг першого JSON-обʼєкта з raw-тексту — порт `extractJson`.
pub fn extract_json(raw: &str) -> Result<serde_json::Value, String> {
    let start = raw.find('{').ok_or("no JSON object")?;
    let end = raw.rfind('}').ok_or("no JSON object")?;
    if end < start {
        return Err("no JSON object".to_string());
    }
    serde_json::from_str(&raw[start..=end]).map_err(|e| e.to_string())
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::collections::HashMap as Map;
    use std::sync::Mutex;

    /// Фейковий submit: відповіді за (model, custom_id); відсутній ключ —
    /// item-помилка. Рахує виклики хвиль на модель.
    pub fn scripted_submit(
        replies: Map<(String, String), String>,
    ) -> (SubmitBatchFn, Arc<Mutex<Vec<String>>>) {
        let waves = Arc::new(Mutex::new(Vec::new()));
        let waves_out = Arc::clone(&waves);
        let submit: SubmitBatchFn = Arc::new(move |model: String, items: Vec<WaveItem>| {
            waves.lock().unwrap().push(model.clone());
            let replies = replies.clone();
            let fut: BoxFuture<'static, Result<Vec<WaveResult>, String>> = Box::pin(async move {
                Ok(items
                    .into_iter()
                    .map(|item| WaveResult {
                        outcome: replies
                            .get(&(model.clone(), item.custom_id.clone()))
                            .cloned()
                            .ok_or_else(|| "нема відповіді".to_string()),
                        custom_id: item.custom_id,
                    })
                    .collect())
            });
            fut
        });
        (submit, waves_out)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::scripted_submit;
    use super::*;

    fn item(id: &str) -> WaveItem {
        WaveItem {
            custom_id: id.to_string(),
            prompt: "p".to_string(),
            system: "s".to_string(),
        }
    }

    #[tokio::test]
    async fn tier1_success_skips_tier2_and_counts() {
        let (submit, waves) =
            scripted_submit([(("t1".to_string(), "a".to_string()), "ok-a".to_string())].into());
        let cfg = CascadeCfg {
            tier1: "t1".into(),
            tier2: "t2".into(),
            allow_cloud: true,
            submit,
        };
        let mut stats = Stats::default();
        let out = keyed_cascade(
            &[item("a")],
            |raw, _| Ok::<_, String>(raw.to_string()),
            &cfg,
            &mut stats,
        )
        .await;
        assert_eq!(out.get("a").map(String::as_str), Some("ok-a"));
        assert_eq!(stats.local_calls, 1);
        assert_eq!(stats.cloud_calls, 0);
        assert_eq!(stats.failures, 0);
        assert_eq!(*waves.lock().unwrap(), vec!["t1".to_string()]);
    }

    /// Невалідний tier1-вихід іде в tier2; провал обох — failure без
    /// результату (conservative fallback за викликачем).
    #[tokio::test]
    async fn invalid_tier1_escalates_and_double_failure_counts() {
        let (submit, waves) = scripted_submit(
            [
                (("t1".to_string(), "a".to_string()), "сміття".to_string()),
                (("t2".to_string(), "a".to_string()), "ok-a".to_string()),
                (("t1".to_string(), "b".to_string()), "сміття".to_string()),
            ]
            .into(),
        );
        let cfg = CascadeCfg {
            tier1: "t1".into(),
            tier2: "t2".into(),
            allow_cloud: true,
            submit,
        };
        let mut stats = Stats::default();
        let parse = |raw: &str, _: &str| {
            if raw.starts_with("ok") {
                Ok(raw.to_string())
            } else {
                Err("invalid".to_string())
            }
        };
        let out = keyed_cascade(&[item("a"), item("b")], parse, &cfg, &mut stats).await;
        assert_eq!(out.get("a").map(String::as_str), Some("ok-a"));
        assert!(!out.contains_key("b"));
        assert_eq!(stats.escalations, 2);
        assert_eq!(stats.failures, 1);
        assert_eq!(
            *waves.lock().unwrap(),
            vec!["t1".to_string(), "t2".to_string()]
        );
    }

    /// Без allow_cloud tier2 не викликається взагалі — приватність opt-in.
    #[tokio::test]
    async fn cloud_wave_requires_opt_in() {
        let (submit, waves) = scripted_submit(HashMap::new());
        let cfg = CascadeCfg {
            tier1: "t1".into(),
            tier2: "t2".into(),
            allow_cloud: false,
            submit,
        };
        let mut stats = Stats::default();
        let out = keyed_cascade(
            &[item("a")],
            |raw, _| Ok::<_, String>(raw.to_string()),
            &cfg,
            &mut stats,
        )
        .await;
        assert!(out.is_empty());
        assert_eq!(stats.cloud_calls, 0);
        assert_eq!(*waves.lock().unwrap(), vec!["t1".to_string()]);
    }

    #[test]
    fn extract_json_cuts_prose() {
        let v = extract_json("Ось: {\"a\": 1} — кінець").unwrap();
        assert_eq!(v["a"], 1);
        assert!(extract_json("без обʼєкта").is_err());
        assert!(extract_json("} {").is_err());
    }
}
