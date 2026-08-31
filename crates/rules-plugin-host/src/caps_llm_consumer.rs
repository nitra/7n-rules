//! Автогенеровані Component Model біндінги `n-rules:caps/llm-consumer@1.0.0`
//! (`wasmtime::component::bindgen!` на `crates/rules-contract/wit`, крок 4.1
//! спеки `docs/specs/2026-08-31-plugin-contract-v5.md` §12.1, застосований
//! ДРУГИЙ раз — той самий прийом, що [`crate::caps_file_reader`]: окремий
//! приватний модуль, незалежний `Host`-трейт (`LlmConsumerImports`), власна
//! `add_to_linker_imports`).
//!
//! # Головне рішення — виклик робить ХОСТ
//!
//! `llm-consumer.wit` каже це прямо в доккоменті світу: гість передає
//! `prompt`, хост вирішує, ЯКОЮ моделлю і ЧИ ВЗАГАЛІ відповісти. Ключі
//! (`N_LOCAL_OPENAI_API_KEY`/хмарні `*_API_KEY`, які читає `genai`
//! транзитивно) НЕ покидають хост — той самий прецедент, що `run-tool`:
//! гість просить, хост виконує і повертає лише результат.
//!
//! # Три властивості, вирішені ЯВНО (спека не фіксує форму рішення)
//!
//! ## 1. Недетермінованість
//!
//! Увесь fix-контур (`harness::pipeline`, `n7n-llm-lib::fix::runner`)
//! побудований навколо інваріанта «повторний детект — чистий»: рунг ladder
//! вирішує успіх canonічним re-detect, не відповіддю моделі саму по собі.
//! `llm-call` цього інваріанта **не гарантує** — відповідь моделі
//! недетермінована за визначенням, і WIT-контракт цього світу не дає
//! способу її зафіксувати (немає seed/temperature=0 полів, доккомент
//! [`crate::caps_llm_consumer`] нижче пояснює чому).
//!
//! Хост НЕ забороняє гостю викликати `llm-call` усередині `fix` — світи
//! перевіряються на рівні типу (чи гість МОЖЕ), а не на рівні того, ЩО
//! конкретний export із нею робить (та сама межа, що спека §9 «що
//! лишається від `capabilities`»: рівень світу відповідає «чи взагалі
//! може», не «як саме користується»). Єдиний СЬОГОДНІ заявлений споживач
//! цього world-а — `docgen` (спека §10, таблиця міграції) — генерує
//! документацію, а не бере участь у `detect`/`fix`-драбині, тож
//! властивість не проявляється на жодному наявному гості. Але майбутній
//! гість, що поєднає `llm-consumer` із `fix`, ламає re-detect-чистоту
//! мовчки, якщо про це не попереджено — тому попередження тут, а не
//! мовчазне замовчування.
//!
//! ## 2. Ціна виклику
//!
//! `run-tool` коштує CPU процесу хоста; `llm-call` (хмарний тир) коштує
//! **гроші власника ключа**, і жоден бюджетний контур цього кроку не
//! існує (спека §11 не згадує квоти для `caps`-світів узагалі). Рішення
//! цього кроку: [`RealLlmCaller`] жорстко фіксує [`llm_lib::Tier::Local`] —
//! гість НЕ обирає тир (WIT-форма й не дає йому такого поля, доккомент
//! `llm-consumer.wit`), і хост НЕ підіймає виклик у хмару автоматично.
//! Це той самий клас гейту, що `capabilities.network == false` за
//! замовчуванням (рішення Е спеки): нова, потенційно дорога поверхня
//! отримує НАЙБЕЗПЕЧНІШИЙ дефолт (нульова маржинальна вартість — локальна
//! модель), а не «найпотужніший». Розширення до хмарних тирів — майбутня
//! робота, і вона вимагає власного бюджетного механізму (ліміт
//! викликів/токенів на прогін), не додається тут «про всяк випадок».
//!
//! ## 3. Відсутність ключа/моделі
//!
//! `n7n-llm-lib` розрізняє це вже на рівні свого власного `LlmError` (не
//! винахід цього модуля):
//!
//! - **Модель не налаштована** (`N_LOCAL_MODEL` не задано) —
//!   `LlmError::NoModelConfigured` → [`DomainError::NotSupported`]: цей
//!   хост сьогодні НЕ має LLM-можливості взагалі, гість дізнається про це
//!   типізовано, а не отримує тиху порожню відповідь.
//! - **Виклик стався, але відмовив** (мережа, HTTP 401 за відсутності чи
//!   недійсності ключа, порожня відповідь моделі — `LocalCloud::one_shot`
//!   САМ трактує порожній текст як помилку, не як успіх із порожнім
//!   рядком, `n7n-llm-lib::local_cloud::one_shot_with_spec`) →
//!   `LlmError::Provider(String)` → [`DomainError::Failed`] із текстом
//!   провайдера всередині.
//!
//! Тобто «модель не налаштована» і «виклик відмовив (зокрема через
//! відсутній/недійсний ключ)» — ДВІ РІЗНІ гілки `domain-error`, а не одна
//! змазана. Третього WIT-варіанта для «саме ключа нема» не додано: різниця
//! між «нема ключа» і «сервер відмовив з іншої причини» видима гостю в
//! тексті `failed(string)`, а не в окремому тегу — заводити варіант під
//! кожен HTTP-статус означало б дублювати номенклатуру провайдера в WIT.
//! Локальний провайдер (`omlx` типово) API-ключ узагалі не ВИМАГАЄ
//! (`skip_api_key_verification` — конфіг сервера, не контракту), тож
//! «немає ключа» для локального тиру найчастіше не помилка — рівно тому
//! `Tier::Local` (п.2 вище) — ще й найбезпечніший вибір щодо цієї
//! властивості: типовий шлях не вимагає секрету взагалі.
//!
//! # Чому форма `llm-request`/`llm-response` НЕ розширена цим кроком
//!
//! Спека прямо дозволяє розширення (§6.3, doc-коментар `llm-consumer.wit`),
//! якщо реальний виклик покаже брак поля. Мінімальна форма (`prompt`→
//! `text`) досить, щоб `RealLlmCaller` зробив реальний one-shot виклик:
//! немає потреби в `system`-промпті (`LocalCloud::one_shot` бере
//! `Option<&str>`, тут завжди `None` — гість формує весь контекст у
//! `prompt`, той самий контракт, що `resolve-spec`/`one-shot` без
//! системного повідомлення в наявних споживачах `n7n-llm-lib` цього
//! репозиторію, напр. `crates/rules-fix/src/workers.rs`), тиру (п.2 вище —
//! тир НЕ поле гостя, а рішення хоста) чи стрімінгу (жоден наявний виклик
//! `LocalCloud::one_shot` цього репозиторію не стрімить — порт `docgen`,
//! коли дійде, покаже, чи стрімінг реально потрібен). Додавати їх зараз —
//! вигадувати потребу, а не відповідати на неї (та сама дисципліна, що
//! `caps_file_reader.rs`: «жоден наявний споживач цього не показав»).
wasmtime::component::bindgen!({
    path: "../rules-contract/wit",
    world: "n-rules:caps/llm-consumer@1.0.0",
    imports: { default: async },
});

use std::future::Future;
use std::pin::Pin;

use llm_lib::local_cloud::{default_local_openai_provider, LocalCloud};
use llm_lib::tiers::{parse_model_spec, resolve_model};
use llm_lib::{LlmError, Tier};

/// `Future`, вироблений [`LlmCaller::call`] — той самий алiас-патерн, що
/// `llm_lib::attempt::BoxFuture`/`ClassifyFn` (`crates/rules-fix/src/workers.rs`):
/// trait-об'єкт не може повернути `impl Future` напряму, тож `Pin<Box<dyn
/// Future>>` — стандартний спосіб зробити метод трейта async-подібним без
/// `async-trait`-макроса (цей крейт його ніде не підключає).
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Ін'єктована точка виклику моделі — той самий мотив DI, що
/// `ClassifyFn` у `crates/rules-fix/src/workers.rs`: сам LLM-виклик єдина
/// недетермінована/мережева ланка, тож він винесений за trait-межу, а не
/// вшитий напряму в `Host`-реалізацію [`crate::host_state::HostState`].
///
/// # Навіщо саме `trait`, а не просто `Arc<dyn Fn(...)>`
///
/// [`RealLlmCaller`] нижче — стан-less (кожен виклик читає env і будує
/// клієнта заново, точно як `default_classify_fn` у `workers.rs`), тож
/// функціонального типу вистачило б. Trait лишає той самий простір, що
/// `ToolResolver`, для СТАНОВОГО тестового двійника
/// (`tests/caps_llm_consumer_gate.rs`) без замикання на конкретну
/// сигнатуру `Fn`.
///
/// # Навіщо `pub`, а не `pub(crate)`
///
/// Правило проєкту для гейт-тестів цього кроку (доккомент
/// `crates/rules-plugin-host/tests/caps_file_reader_gate.rs`): наскрізний
/// доказ живе в `tests/`, окремому крейті, а завдання прямо забороняє
/// реальний мережевий виклик моделі в тестах («мокай на рівні хоста»).
/// [`PluginHost::new_with_llm_caller`](crate::host::PluginHost::new_with_llm_caller)
/// — точка ін'єкції: гейт-тест підмінює [`RealLlmCaller`] власним
/// детермінованим двійником, а `PluginHost::new` і далі лишається
/// незмінним публічним конструктором для всіх наявних викликачів
/// (`rules-cli`/`rules-napi`) — жоден із них не зобов'язаний знати про
/// цей trait.
pub trait LlmCaller: Send + Sync {
    /// Повертає ГОТОВИЙ `domain-error`, а не проміжний `LlmError` —
    /// таксономія помилок цього world-а визначається РІВНО в одному місці
    /// (доккомент модуля, пункт 3), і `Host`-реалізація нижче лише
    /// пересилає його гостю, не перевідображає вдруге.
    fn call(&self, prompt: String) -> BoxFuture<'static, Result<String, DomainError>>;
}

/// Бойова реалізація [`LlmCaller`] — `n7n-llm-lib::local_cloud::LocalCloud`,
/// зафіксована на [`Tier::Local`] (доккомент модуля, пункт 2: ціна
/// виклику). Стан-less за конструкцією — мапа локальних провайдерів
/// читається з env НА КОЖЕН виклик (`default_local_openai_provider`,
/// той самий live-read, що й `n7n-llm-lib::tiers` узагалі), тож зміна
/// `N_LOCAL_MODEL`/`N_LOCAL_OPENAI_BASE_URL`/`N_LOCAL_OPENAI_API_KEY` між
/// двома викликами (типово — між тестами) підхоплюється без перезапуску
/// хоста, як і в `crates/rules-fix/src/workers.rs::default_classify_fn`.
pub(crate) struct RealLlmCaller;

impl LlmCaller for RealLlmCaller {
    fn call(&self, prompt: String) -> BoxFuture<'static, Result<String, DomainError>> {
        Box::pin(async move {
            // `resolve_model` ДО побудови клієнта — «модель не
            // налаштована» відрізняється від «модель налаштована, виклик
            // відмовив» (доккомент модуля, пункт 3) саме тут: без цієї
            // перевірки обидві гілки злилися б у той самий `Provider`-текст
            // із `LocalCloud::one_shot`.
            let Some(spec) = resolve_model(Tier::Local) else {
                return Err(DomainError::NotSupported);
            };
            let Ok((prefix, _)) = parse_model_spec(&spec) else {
                // `N_LOCAL_MODEL` заданий, але не проходить власний парсинг
                // `n7n-llm-lib` («provider/model-id») — це вже СТАЛАСЯ
                // спроба з невалідною конфігурацією, не «нема моделі»,
                // тож `Failed`, не `NotSupported`.
                return Err(DomainError::Failed(format!(
                    "N_LOCAL_MODEL={spec:?} не проходить парсинг \"provider/model-id\""
                )));
            };
            let mut providers = std::collections::HashMap::new();
            providers.insert(prefix.to_string(), default_local_openai_provider());
            let client = LocalCloud::new(providers);
            client
                .one_shot(Tier::Local, None, &prompt)
                .await
                .map_err(|err| match err {
                    LlmError::NoModelConfigured(_) => DomainError::NotSupported,
                    LlmError::InvalidModelSpec(msg) => DomainError::Failed(msg),
                    LlmError::Provider(msg) => DomainError::Failed(msg),
                })
        })
    }
}
