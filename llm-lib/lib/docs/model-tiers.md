---
type: JS Module
title: model-tiers.mjs
resource: llm-lib/lib/model-tiers.mjs
docgen:
  crc: 16df44f1
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Публічний шар модуля зосереджений на виборі та нормалізації моделей: `resolveModel`, `parseModelId`, `formatModelSpec`, `isLocalModel`, `thinkingLevelForTier` і константах `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `CLOUD_MIN`, `CLOUD_AVG`, `CLOUD_MAX`.

Він узгоджує представлення моделі між tier і форматом `"provider/model-id"`, дає змогу відрізняти локальні моделі від хмарних і окремо пов’язує tier із рівнем thinking.

## Поведінка

LOCAL_MIN, LOCAL_AVG, LOCAL_MAX, CLOUD_MIN, CLOUD_AVG і CLOUD_MAX — це джерело політики вибору моделі: значення беруться з env і далі використовуються як канонічні тири для розв’язання model-spec та класифікації локальної чи хмарної моделі. Якщо відповідний env не заданий, значення лишається порожнім рядком, тож наступні кроки можуть повернути порожній результат замість конкретної моделі.

resolveModel — центральна точка для отримання фактичного `"provider/model-id"` за абстрактним тиром. Вона спирається на канон тиру з native-шару, а невідомий тир відсікає одразу тут, щоб зберегти TypeError на рівні цього модуля. Результат або повертає готовий model-spec, або порожній рядок, якщо дефолт не визначений.

parseModelId і formatModelSpec утворюють парну нормалізацію між рядковим spec та об’єктом моделі: перша розкладає зовнішній `"provider/model-id"` на складники, друга збирає фактично резолвлену модель назад у той самий формат. Це дозволяє пропускати через модуль як сирі spec-рядки, так і вже вибрані pi-моделі без втрати форми.

isLocalModel використовує спільні тири LOCAL_MIN, LOCAL_AVG і LOCAL_MAX як найвищий пріоритет, а для решти spec опирається на провайдера з `N_LLM_LOCAL_PROVIDERS`. Так модуль узгоджує явні локальні політики з провайдерною ознакою й дає один бінарний сигнал для ланцюжків, що відрізняють local від cloud.

thinkingLevelForTier не бере участі в резолві моделі, але працює поруч із тирами як окрема проєкція: перетворює rung-рівні на дискретний thinkingLevel для downstream-логіки. Це тримає вибір моделі та рівень міркування синхронними, але розділеними по відповідальності.

## Публічний API

- LOCAL_MIN — Швидкий локальний inference. Напр.: omlx/gemma-4-e4b-it-OptiQ-4bit
- LOCAL_AVG — Середній локальний.
- LOCAL_MAX — Максимальний локальний.
- CLOUD_MIN — Мінімальний хмарний (потрібен ключ у pi auth). Напр.: openai/gpt-5.4-mini
- CLOUD_AVG — Середній хмарний. Напр.: openai/gpt-5.4
- CLOUD_MAX — Максимальний хмарний. Напр.: openai/gpt-5.5
- resolveModel — Каскадне розв'язання абстрактного тиру в `"provider/model-id"` —
napi-делегація в `llm_lib::resolve_model` (задача T5, рішення Е): та сама
логіка, що й Rust-каскад у `tiers.rs`:
  'min' → LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN
  'avg' → LOCAL_AVG → LOCAL_MAX → CLOUD_AVG
  'max' → LOCAL_MAX → CLOUD_MAX
Тир валідується тут (не в Rust) — щоб зберегти контракт `TypeError` для
невідомого тиру без потреби мапити помилку з napi-боку.
- thinkingLevelForTier — `thinkingLevel` за rung-тиром fix-драбини: слабка локальна — `low`,
cloud-min — `medium`, cloud-avg — `high`, cloud-max (experiment-only tier,
не в production ladder) — `xhigh`.
- parseModelId — Розбирає `"provider/model-id"` у пару. Перший `/` — роздільник (model-id може
містити власні `/`). Порожній провайдер чи id → `null` (malformed).
- formatModelSpec — Форматує pi `Model`-об'єкт (`{provider, id}`) назад у `"provider/model-id"`.
Інверсія {@link parseModelId} — застосовується до фактично резолвленої
pi-моделі (`session.model`), коли consumer лишив `modelSpec` порожнім і pi
сам вибрав дефолт (локальний чи хмарний).
- isLocalModel — Чи model-spec вказує на локальну модель: збіг з одним із LOCAL_* тирів
АБО провайдер з `N_LLM_LOCAL_PROVIDERS` (дефолт `omlx,litellm`). Обидва
провайдери можуть бути зареєстровані в `localProviders`-конфізі одночасно
(див. `local-providers.mjs`) — "активний" завжди рівно один, бо
`LocalCloud` викликає клієнта за провайдер-префіксом фактичного
model-spec, не за наявністю запису в мапі. Використовується
для local/cloud-агрегатів ланцюжків і рішення про chain-заголовки.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
