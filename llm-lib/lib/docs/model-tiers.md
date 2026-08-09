---
type: JS Module
title: model-tiers.mjs
resource: llm-lib/lib/model-tiers.mjs
docgen:
  crc: 390f09c0
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль визначає спільні правила для tier-орієнтованого вибору моделі: `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `CLOUD_MIN`, `CLOUD_AVG`, `CLOUD_MAX` задають доступні варіанти, `resolveModel` обирає модель для сценарію, `thinkingLevelForTier` узгоджує рівень thinking для tier, `parseModelId` і `formatModelSpec` працюють із поданням model spec, а `isLocalModel` відрізняє локальні моделі від cloud. Це потрібно, щоб вибір моделі, її формат і класифікація залишалися однаковими.

## Поведінка

LOCAL_MIN, LOCAL_AVG, LOCAL_MAX, CLOUD_MIN, CLOUD_AVG і CLOUD_MAX формують один набір tier-орієнтованих значень із env і задають спільну політику вибору моделі.

resolveModel бере вибір із цього tier-простору, нормалізує короткі alias-и min, avg і max до локальних стартових сходинок, а далі делегує фактичний вибір на substrate-резолвінг; якщо відповідь відсутня, результатом стає порожній рядок. Невідомий селектор не мовчить, а дає TypeError. Каскад починається з локальних тирових значень і може підніматися до cloud-сходинок за правилами, що задають один спільний маршрут.

parseModelId і formatModelSpec тримають один канон представлення: рядок у форматі provider/model-id розкладається на пару для внутрішньої роботи, а згодом збирається назад, коли потрібно відобразити фактично обрану модель. Якщо spec або модель неповні, результат відсутній, а не частково заповнений.

isLocalModel використовує той самий канон spec і той самий набір локальних провайдерів, щоб відрізняти локальні ланцюжки від cloud-ланцюжків. Для tier-значень пріоритет мають саме явні LOCAL_* значення; для інших spec рішення йде через provider, а не через наявність запису в конфігурації.

thinkingLevelForTier переводить rung-tier у дискретний рівень thinking без додаткових проміжних станів: локальні weak-paths лишаються нижче, cloud-шар підвищує рівень, а cloud-max займає окрему верхню позицію. Це дає єдине узгодження між вибраним tier і тим, скільки reasoning очікується від подальших consumers.

Усі функції працюють без власного запису стану: вони лише читають env, перетворюють model-spec і повертають похідні значення.

## Публічний API

- LOCAL_MIN — Швидкий локальний inference. Напр.: omlx/gemma-4-e4b-it-OptiQ-4bit
- LOCAL_AVG — Середній локальний.
- LOCAL_MAX — Максимальний локальний.
- CLOUD_MIN — Мінімальний хмарний (потрібен ключ у pi auth). Напр.: openai/gpt-5.4-mini
- CLOUD_AVG — Середній хмарний. Напр.: openai/gpt-5.4
- CLOUD_MAX — Максимальний хмарний. Напр.: openai/gpt-5.5
- resolveModel — Універсально резолвить модель від явної env-сходинки:
- LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN → CLOUD_AVG → CLOUD_MAX;
- LOCAL_AVG → LOCAL_MAX → CLOUD_AVG → CLOUD_MAX;
- LOCAL_MAX → CLOUD_MAX;
- cloud-старти проходять лише відповідну й сильніші cloud-сходинки.
`min`/`avg`/`max` лишаються alias-ами відповідних `N_LOCAL_*_MODEL`.
- thinkingLevelForTier — `thinkingLevel` за rung-тиром fix-драбини: слабка локальна — `low`,
cloud-min — `medium`, cloud-avg — `high`, cloud-max (experiment-only tier,
не в production ladder) — `xhigh`.
- parseModelId — Розбирає `"provider/model-id"` у пару. Перший `/` — роздільник (model-id може
містити власні `/`). Порожній провайдер чи id → `null` (malformed).
- formatModelSpec — Форматує pi `Model`-об'єкт (`{provider, id}`) назад у `"provider/model-id"`.
Інверсія {@link parseModelId} — застосовується до фактично резолвленої
pi-моделі (`session.model`), коли consumer лишив `modelSpec` порожнім і pi
сам вибрав дефолт.
- isLocalModel — Чи model-spec вказує на локальну модель: збіг з одним із LOCAL_* тирів
АБО провайдер з `N_LLM_LOCAL_PROVIDERS` (дефолт `local-openai`).
Провайдер може бути зареєстрований в `localProviders`-конфізі одночасно
(див. `local-providers.mjs`) — "активний" завжди рівно один, бо
`LocalCloud` викликає клієнта за провайдер-префіксом фактичного
model-spec, не за наявністю запису в мапі. Використовується
для local/cloud-агрегатів ланцюжків і рішення про chain-заголовки.

## Сценарії використання

- `llm-lib/tests/model-tiers.test.mjs` (isLocalModel; parseModelId) — local-openai-провайдер — локальний за дефолтом (generic-слот omlx/litellm/turbofieldfare/...); голий omlx-префікс більше не local — злито в local-openai (свідомий breaking change); порожній/malformed spec — не локальний; кастомний список провайдерів через env (ізольований re-import); звичайна пара; ще 9

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
