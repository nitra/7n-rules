---
type: JS Module
title: model-tiers.mjs
resource: llm-lib/lib/model-tiers.mjs
docgen:
  crc: 05c5eb6a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `CLOUD_MIN`, `CLOUD_AVG` і `CLOUD_MAX` задають спільні варіанти модельного рівня для локального та хмарного сценаріїв, щоб споживачі використовували однакові значення для вибору режиму роботи. `parseModelId` і `formatModelSpec` узгоджують подання модельного ідентифікатора між внутрішнім представленням і зовнішнім форматом, а `resolveModel` повертає уже погоджений варіант для подальшого використання. `thinkingLevelForTier` фіксує відповідність між tier і рівнем thinking, а `isLocalModel` дає змогу відрізнити локальні моделі від інших без дублювання цієї перевірки в різних місцях.

## Поведінка

LOCAL_MIN, LOCAL_AVG, LOCAL_MAX, CLOUD_MIN, CLOUD_AVG і CLOUD_MAX беруть значення з environment на старті модуля та задають єдину політику вибору моделі для локального й хмарного шарів. Ці значення далі слугують опорою для resolveModel, який повертає вже фактично обраний model spec у форматі provider/model-id або порожній рядок, якщо дефолт провайдера лишився substrate-рівню. Невідомий tier відсіюється на цьому рівні як помилка контракту.

thinkingLevelForTier переводить rung-tier у дискретний рівень thinking, щоб downstream-логіка могла узгоджено трактувати силу моделі без повторного аналізу spec. local-min і local-min-retry зводяться до найнижчого рівня, cloud-min, cloud-avg і cloud-max піднімають рівень відповідно до потужності хмарного вибору.

parseModelId і formatModelSpec утворюють парний обмін між рядковим model spec та об’єктом моделі: перший розбирає канонічний рядок на provider та id, другий збирає фактично резолвлену модель назад у той самий формат. Якщо spec або модель неповні, результатом є null, щоб не маскувати malformed або відсутній стан.

isLocalModel використовує ту саму політику, що й resolveModel: спочатку звіряє явні локальні тири, а потім визначає локальність за provider із model spec. Це дає спільне правило для агрегатів local/cloud і для рішень, де потрібно відрізнити локальний шлях від хмарного без дублювання логіки в consumers.

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

## Сценарії використання

- `llm-lib/tests/model-tiers.test.mjs` (isLocalModel; parseModelId) — omlx-провайдер — локальний (дефолт N_LLM_LOCAL_PROVIDERS); litellm-провайдер — теж локальний за дефолтом (перемикач omlx/litellm через тир-env); порожній/malformed spec — не локальний; кастомний список провайдерів через env (ізольований re-import); звичайна пара; ще 8

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
