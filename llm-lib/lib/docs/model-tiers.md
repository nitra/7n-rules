---
type: JS Module
title: model-tiers.mjs
resource: llm-lib/lib/model-tiers.mjs
docgen:
  crc: a3487059
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл описує публічні правила вибору й нормалізації моделей: `resolveModel` визначає підсумкову модель, `parseModelId` розбирає ідентифікатор моделі, а `formatModelSpec` повертає узгоджене подання model spec. Також тут є `isLocalModel` для розрізнення local-моделей і `thinkingLevelForTier` для прив’язки thinking-рівня до tier. Це потрібно, щоб однаково інтерпретувати локальні та cloud-моделі в усьому коді та не змішувати їхні очікувані режими роботи.

## Поведінка

LOCAL_MIN, LOCAL_AVG, LOCAL_MAX, CLOUD_MIN, CLOUD_AVG і CLOUD_MAX формують єдину політику вибору моделі з env-налаштувань у форматі provider/model-id. Якщо значення не задане, відповідний тир лишається порожнім рядком, і далі це використовують як сигнал відсутності явної прив’язки.

resolveModel приймає абстрактний тир і повертає фактичний model-spec через канонічну реалізацію рівня native; якщо явного резолву немає, результат нормалізується до порожнього рядка. Невідомий тир відкидається одразу на цьому рівні, щоб зберегти передбачувану помилку без проміжного мапінгу.

thinkingLevelForTier переводить rung-тир у дискретний рівень “thinking”, спираючись на вже відомий тип моделі: локальні варіанти ведуть до нижчого рівня, cloud-лінійка підвищує його, а cloud-max дає найвищий режим.

parseModelId і formatModelSpec працюють як взаємна пара нормалізації: перший розкладає model-spec на provider та id, другий збирає їх назад у канонічний вигляд. Це дозволяє зберігати однаковий формат для подальшої маршрутизації, навіть коли джерело даних або споживач передає вже вибрану модель, а не початковий spec.

isLocalModel використовує спільну політику локальності: спершу звіряє з явними local-tiers, а потім — із переліком локальних провайдерів із env. Так він охоплює і прямі тири, і вже розібрані model-spec, що важливо для агрегатів ланцюжків і для рішень про local/cloud-поведінку.

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

## Сценарії використання

- `llm-lib/tests/model-tiers.test.mjs` (isLocalModel; parseModelId) — omlx-провайдер — локальний (дефолт N_LLM_LOCAL_PROVIDERS); порожній/malformed spec — не локальний; кастомний список провайдерів через env (ізольований re-import); звичайна пара; перший / роздільник — id може містити власні /; ще 7

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
