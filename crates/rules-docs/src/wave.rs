//! Спільний транспорт обох семантичних гейтів: одна batch-хвиля на тир
//! драбини — порт `submitWave` (він у JS дослівно однаковий в
//! `entailment.mjs` і `gap-mappings.mjs`).

use std::collections::HashMap;
use std::sync::Arc;

use llm_lib::attempt::BoxFuture;
use llm_lib::batch::{dispatch, BatchItem, DispatchConfig};
use llm_lib::budget::EgressPolicy;
use llm_lib::local_cloud::{default_local_openai_provider, LocalCloud};
use llm_lib::remote_batch::RemoteBatchConfig;
use llm_lib::tiers::{parse_model_spec, resolve_model, Tier};

/// Ідентифікатор застосунку-писемника для рядків trace.
const CALLER: &str = "rules-docs";

/// Спільний handle ланцюжка задачі — той самий мотив, що в
/// `rules_adr::cascade::ChainRef`: [`SubmitBatchFn`] повертає
/// `BoxFuture<'static, _>`, тож `&mut ChainHandle` туди не передати, а guard
/// живе через `.await` самого `dispatch` — отже `tokio::sync::Mutex`, не
/// `std` (його guard не `Send`).
pub type ChainRef = Arc<tokio::sync::Mutex<trace::ChainHandle>>;

/// Один item хвилі — порт форми `submitBatch`-item-а (`{customId, prompt}`).
#[derive(Debug, Clone)]
pub struct WaveItem {
    pub custom_id: String,
    pub prompt: String,
}

/// Відповідь на один item: `Ok(text)` — дзеркало JS-поля `ok`, `Err(message)`
/// — поля `error`. Розрізняти їх обовʼязково: гейти пишуть різні коди
/// діагностик для «модель відповіла сміттям» і «виклик не відбувся».
#[derive(Debug, Clone)]
pub struct WaveResult {
    pub custom_id: String,
    pub outcome: Result<String, String>,
}

/// Інʼєкція транспорту: тир + items + ланцюжок → відповіді. Бойова
/// реалізація — [`native_submit_batch`], тестова — фейк.
pub type SubmitBatchFn = Arc<
    dyn Fn(Tier, Vec<WaveItem>, ChainRef) -> BoxFuture<'static, Result<Vec<WaveResult>, String>>
        + Send
        + Sync,
>;

/// Універсальна драбина обох гейтів — порт `['min', 'avg', 'max']`.
///
/// # Чому саме ці три тири
///
/// JS-константа писалась у світі, де `min`/`avg`/`max` каскадували
/// `LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_*`. Рішення Б спеки harness
/// прибрало локальні тири: локальна модель тепер ОДНА (`N_LOCAL_MODEL`).
/// Порт зберігає не імена, а ВЛАСТИВІСТЬ драбини — три сходинки з
/// ескалацією вгору: локальна → хмарна мінімальна → хмарна середня. Три
/// сходинки, а не чотири, саме тому, що їх було три: бюджет ескалації —
/// частина контракту, і `CloudMax` тут свідомо не з'являється (додати його
/// — один рядок, коли з'явиться замір, що це потрібно).
#[must_use]
pub fn default_model_policy() -> Vec<Tier> {
    vec![Tier::Local, Tier::CloudMin, Tier::CloudAvg]
}

/// Стабільне імʼя тиру для cache-ключа.
///
/// Кеш ключується в тому числі драбиною — і це правильно, що імена НЕ
/// збігаються з JS-івськими `min|avg|max`: драбина стала іншою (рішення Б),
/// тож вердикт, отриманий старою, не має мовчки зараховуватись новій.
/// Записи JS-ери цим і знецінюються — свідомо, не через недогляд.
#[must_use]
pub fn tier_name(tier: Tier) -> &'static str {
    match tier {
        Tier::Local => "local",
        Tier::CloudMin => "cloud-min",
        Tier::CloudAvg => "cloud-avg",
        Tier::CloudMax => "cloud-max",
    }
}

/// Бойовий транспорт — обгортка над `llm_lib::batch::dispatch`.
///
/// Нерезолвлений тир (немає відповідної `N_*_MODEL`) — це `Err`, а не паніка
/// і не порожній результат: гейт трактує його як промах усієї хвилі й
/// переходить на наступну сходинку. Рівно та сама поведінка, що в JS, де
/// `submitBatch` кидав, а `submitWave` ловив.
#[must_use]
pub fn native_submit_batch() -> SubmitBatchFn {
    Arc::new(|tier: Tier, items: Vec<WaveItem>, chain: ChainRef| {
        let fut: BoxFuture<'static, Result<Vec<WaveResult>, String>> = Box::pin(async move {
            let model = resolve_model(tier)
                .ok_or_else(|| format!("тир {} не резолвиться в модель", tier_name(tier)))?;
            let mut providers = HashMap::new();
            if let Ok((prefix, _)) = parse_model_spec(&model) {
                providers.insert(prefix.to_string(), default_local_openai_provider());
            }
            let cascade = LocalCloud::new(providers);
            let batch_items: Vec<BatchItem> = items
                .into_iter()
                .map(|item| BatchItem {
                    custom_id: item.custom_id,
                    prompt: item.prompt,
                    system: None,
                })
                .collect();
            let remote_config = RemoteBatchConfig::default();
            let config = DispatchConfig {
                cascade: &cascade,
                model_spec_or_tier: &model,
                remote_config: &remote_config,
                global_system: None,
                acp_config: None,
                // Приватність вирішує драбина (див. `default_model_policy`),
                // а не заборона на рівні транспорту: хмарні сходинки в ній
                // є за побудовою.
                egress: EgressPolicy::AllowCloud,
                caller: CALLER,
            };
            let mut chain = chain.lock().await;
            let results = dispatch(&config, batch_items, |_progress| {}, Some(&mut chain))
                .await
                .map_err(|error| error.to_string())?;
            Ok(results
                .into_iter()
                .map(|result| WaveResult {
                    custom_id: result.custom_id,
                    outcome: result.outcome.map(|text| strip_code_fence(&text)),
                })
                .collect())
        });
        fut
    })
}

/// Знімає ```-обгортку з відповіді моделі — та сама нормалізація, що
/// `stripFence` у JS-конвеєрі `adr-normalize` (тут без `regex`: робота надто
/// вузька, щоб тягнути залежність).
///
/// # Чому саме в ТРАНСПОРТІ, а не в парсері гейта
///
/// Гейти навмисно строгі: `JSON.parse` без поблажливості — частина їхнього
/// контракту, і послаблювати його означало б розійтися з JS у ВЕРДИКТАХ.
/// Але code-fence — не властивість вердикту, а звичка конкретної моделі:
/// виміряно живцем (2026-08-22, `gemma-4-26b-a4b-it`), що локальний рунг
/// повертає РІВНО правильний JSON, обгорнутий у ```json — тобто без цієї
/// нормалізації перша сходинка драбини гарантовано марна на будь-якій
/// моделі з такою звичкою. JS цієї проблеми не мав: його драбина локального
/// рунга не мала взагалі.
///
/// Фейкові транспорти тестів сюди не заходять — гейти лишаються перевіреними
/// на строгому вході, дзеркально до JS-набору.
fn strip_code_fence(raw: &str) -> String {
    let trimmed = raw.trim();
    let Some(after_open) = trimmed.strip_prefix("```") else {
        return raw.to_string();
    };
    // Після відкривної огорожі йде необовʼязкова мова (```json) до кінця рядка.
    let body = after_open
        .split_once('\n')
        .map_or("", |(_language, rest)| rest);
    body.trim_end()
        .strip_suffix("```")
        .unwrap_or(body)
        .trim()
        .to_string()
}

/// Одна хвиля одного тиру — порт `submitWave`: провал САМОГО виклику не
/// кидається далі, а стає порожньою мапою (усі items тиру — промахи).
pub(crate) async fn submit_wave(
    items: Vec<WaveItem>,
    tier: Tier,
    submit: &SubmitBatchFn,
    chain: &ChainRef,
) -> HashMap<String, WaveResult> {
    match submit(tier, items, Arc::clone(chain)).await {
        Ok(results) => results
            .into_iter()
            .map(|result| (result.custom_id.clone(), result))
            .collect(),
        Err(_) => HashMap::new(),
    }
}

/// Заводить ланцюжок задачі для гейта, що виконується поза портованим
/// конвеєром `docs build`.
///
/// Тимчасова зручність із чесною межею: коли runner переїде в Rust, ОДИН
/// його ланцюжок має накривати весь build (claims → entailment → mappings →
/// render), інакше повернеться рівно та вада, яку зняв chain-API — одна
/// задача, розсипана на кілька незалежних для аналітики.
#[must_use]
pub fn new_chain(kind: &str, unit: &str) -> ChainRef {
    let mut start = trace::ChainStart::new(kind, unit);
    if let Ok(cwd) = std::env::current_dir() {
        start = start.with_cwd(cwd.to_string_lossy().into_owned());
    }
    Arc::new(tokio::sync::Mutex::new(trace::ChainHandle::start(start)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Саме та форма, яку віддала локальна модель у живому прогоні.
    #[test]
    fn a_fenced_verdict_becomes_plain_json() {
        let fenced = "```json\n{\"claimId\":\"c1\",\"entails\":true,\"unsupportedFields\":[]}\n```";
        assert_eq!(
            strip_code_fence(fenced),
            "{\"claimId\":\"c1\",\"entails\":true,\"unsupportedFields\":[]}"
        );
    }

    #[test]
    fn plain_json_passes_through_untouched() {
        let plain = "{\"claimId\":\"c1\"}";
        assert_eq!(strip_code_fence(plain), plain);
    }

    /// Сміття лишається сміттям: нормалізація знімає обгортку, а не рятує
    /// невалідну відповідь — інакше вона підміняла б собою гейт.
    #[test]
    fn garbage_is_not_repaired() {
        assert_eq!(strip_code_fence("{not json"), "{not json");
        assert_eq!(strip_code_fence("```\n{not json\n```"), "{not json");
    }
}
