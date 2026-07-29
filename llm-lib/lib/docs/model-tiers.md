---
type: JS Module
title: model-tiers.mjs
resource: llm-lib/lib/model-tiers.mjs
docgen:
  crc: 1f021997
  model: openai-codex/gpt-5.4-mini
  score: 90
  issues: surzhik,judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`LOCAL_MIN`, `LOCAL_AVG` і `LOCAL_MAX` задають локальні рівні моделі, а `CLOUD_MIN`, `CLOUD_AVG` і `CLOUD_MAX` — відповідні хмарні рівні. `resolveModel` і `resolveLocalModel` вибирають модель для заданого tier, `thinkingLevelForTier` пов’язує tier із рівнем thinking, `parseModelId` розбирає `provider/model-id`, `formatModelSpec` формує цей запис назад, а `isLocalModel` перевіряє, чи належить модель до локальних.

## Поведінка

LOCAL_MIN, LOCAL_AVG, LOCAL_MAX, CLOUD_MIN, CLOUD_AVG і CLOUD_MAX задають єдину сходинку вибору моделі: від локальних tier до хмарних, з поступовим підняттям сили відповіді. Ця шкала є спільною основою для всіх резолверів у файлі: вона визначає, куди саме ескалює запит і який рівень reasoning очікується на виході.

resolveModel переводить абстрактний tier у фактичний `"provider/model-id"` і виступає верхнім входом для каскадного вибору. Якщо tier невідомий, помилка виникає тут, а не на рівні native-шару, щоб зберегти стабільний контракт для викликів із JavaScript. Результат або веде до конкретної моделі, або лишається порожнім значенням, коли спрацьовує по замовчуванню дефолт провайдера substrate.

resolveLocalModel працює лише в межах local-лінійки й використовує fallback у бік сильніших local tiers. Він не піднімається в cloud-діапазон: перехід у хмару очікується від викликачів, які будують власну ladder-політику. Це тримає локальну логіку відокремленою від рішень про escalation.

thinkingLevelForTier прив’язує rung-tier до дискретного рівня thinking, щоб downstream-логіка могла узгоджено інтерпретувати силу запиту. Тут intentionally присутній cloud-max як експериментальний рівень, але він не є частиною production ladder.

parseModelId і formatModelSpec утворюють пару для переходу між рядковим `"provider/model-id"` і структурованим представленням моделі. Перший розбирає специфікацію на provider та id, другий відновлює рядок із фактично резолвленої моделі, коли початковий modelSpec був порожній і вибір зробив сам pi. Це дозволяє передавати назву моделі далі по ланцюжку без втрати того, що саме було обрано.

isLocalModel використовує parseModelId, щоб віднести специфікацію до локальної чи ні, і тим самим підтримує рішення про local/cloud-агрегацію та chain-заголовки. Локальність визначається або через local tier, або через провайдера з дозволеного набору; при цьому "активність" провайдера не виводиться з наявності запису в мапі, а залежить від фактичного префікса model-spec.

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
- resolveLocalModel — Резолвить local model для звичайного (не batch) виклику від запитаного
`N_LOCAL_*` tier до сильніших local tiers. Наприклад, запит `MIN` бере
`MIN → AVG → MAX`, а запит `AVG` — `AVG → MAX`. Cloud tier навмисно не
входить до цього fallback: caller, який потребує cloud escalation, будує
її власною ladder-політикою.
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

## Сценарії використання

- `llm-lib/tests/model-tiers.test.mjs` (isLocalModel; parseModelId) — omlx-провайдер — локальний (дефолт N_LLM_LOCAL_PROVIDERS); litellm-провайдер — теж локальний за дефолтом (перемикач omlx/litellm через тир-env); порожній/malformed spec — не локальний; кастомний список провайдерів через env (ізольований re-import); звичайна пара; ще 12

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
