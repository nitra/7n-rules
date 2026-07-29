---
type: JS Module
title: model-tiers.mjs
resource: llm-lib/lib/model-tiers.mjs
docgen:
  crc: 1953f7a9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min-retry
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл відповідає за визначення та вибір моделі для виконання завдань. Він інтерпретує граничні значення, такі як `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX` для локальних моделей та `CLOUD_MIN`, `CLOUD_AVG`, `CLOUD_MAX` для хмарних моделей. На основі цих значень відбувається пошук відповідної моделі через функцію `resolveModel`. Після вибору моделі, відповідно до її типу, визначається відповідний рівень обробки за допомогою `thinkingLevelForTier`.

## Поведінка

Значення `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `CLOUD_MIN`, `CLOUD_AVG`, `CLOUD_MAX` визначаються через змінні середовища, використовуючи префікси, які можуть бути налаштовані для вказівки на конкретні моделі. Ці значення слугують стартовими точками для визначення моделі та її рівні у ланцюжку. Коли викликається `resolveModel` з певною стартовою сходинкою, ця сходинка використовується для каскадного пошуку моделі, починаючи з локальних мінімальних та переходячи до хмарних, якщо необхідна модель не знайдена локально. Результат `resolveModel` повертає ідентифікатор моделі у форматі `"provider/model-id"`. Цей ідентифікатор може бути перетворений на пару `provider` та `id` за допомогою `parseModelId` або знову відформатований назад у `"provider/model-id"` за допомогою `formatModelSpec`, що корисно при отриманні дефолтної моделі від системи. `isLocalModel` приймає специфікатор моделі та визначає, чи належить вона до локальних моделей, спираючись на визначені стартові тири або на налаштування провайдерів у змінній середовища. Якщо ідентифікатор моделі відомий, `thinkingLevelForTier` визначає відповідний рівень складності (від `low` до `xhigh`) на основі того, який із визначених тирів був обраний.

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
сам вибрав дефолт (локальний чи хмарний).
- isLocalModel — Чи model-spec вказує на локальну модель: збіг з одним із LOCAL_* тирів
АБО провайдер з `N_LLM_LOCAL_PROVIDERS` (дефолт `omlx,litellm`). Обидва
провайдери можуть бути зареєстровані в `localProviders`-конфізі одночасно
(див. `local-providers.mjs`) — "активний" завжди рівно один, бо
`LocalCloud` викликає клієнта за провайдер-префіксом фактичного
model-spec, не за наявністю запису в мапі. Використовується
для local/cloud-агрегатів ланцюжків і рішення про chain-заголовки.

## Сценарії використання

- `llm-lib/tests/model-tiers.test.mjs` (isLocalModel; parseModelId) — omlx-провайдер — локальний (дефолт N_LLM_LOCAL_PROVIDERS); litellm-провайдер — теж локальний за дефолтом (перемикач omlx/litellm через тир-env); порожній/malformed spec — не локальний; кастомний список провайдерів через env (ізольований re-import); звичайна пара; ще 9

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
