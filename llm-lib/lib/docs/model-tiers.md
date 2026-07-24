---
type: JS Module
title: model-tiers.mjs
resource: llm-lib/lib/model-tiers.mjs
docgen:
  crc: 13970c1f
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль централізує вибір і нормалізацію LLM-моделей для local та cloud tier значень. Він дає спільну точку для розбору і форматування model spec, визначення локальності моделі та зіставлення tier із рівнем thinking.

## Поведінка

Модуль задає спільну env-політику вибору моделей через LOCAL_MIN, LOCAL_AVG, LOCAL_MAX, CLOUD_MIN, CLOUD_AVG і CLOUD_MAX. Ці значення є вхідним станом для подальшого резолву та класифікації: порожнє значення означає, що відповідний tier не заданий явно.

resolveModel приймає абстрактний tier і повертає фактичний model spec у форматі pi. Вибір делегується нативному шару, щоб JavaScript-споживачі отримували той самий каскад, що й Rust-частина. Якщо каскад не знаходить явної моделі, результатом стає порожній рядок, який залишає вибір дефолтної моделі нижчому шару.

parseModelId і formatModelSpec підтримують єдиний формат обміну між конфігурацією, результатами resolveModel і pi-моделями. parseModelId відкидає некоректні або неповні model spec, а formatModelSpec перетворює фактично вибрану pi-модель назад у той самий текстовий формат для подальшого порівняння чи логування.

isLocalModel використовує спільні LOCAL_* значення та список локальних провайдерів з оточення, щоб визначити, чи фактично вибрана або явно задана модель є локальною. Для цього результат resolveModel або formatModelSpec може бути переданий у isLocalModel після нормалізації через спільний формат.

thinkingLevelForTier працює з rung-рівнями escalation-ланцюжка й повертає дискретний рівень thinking для виконання запиту. Це рішення незалежне від env-конфігурації моделей, але використовується поруч із resolveModel у потоках, де одночасно обираються модельний tier і інтенсивність міркування.

Файл не виконує власних операцій запису у ФС чи БД; результати передаються назовні як значення для споживачів LLM-шару. Імпортовані модулі не аналізувались.

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
АБО провайдер з `N_LLM_LOCAL_PROVIDERS` (дефолт `omlx`). Використовується
для local/cloud-агрегатів ланцюжків і рішення про chain-заголовки.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
