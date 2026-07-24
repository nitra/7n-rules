---
type: Rust Module
title: lib.rs
resource: llm-lib/crates/llm-lib-napi/src/lib.rs
docgen:
  crc: 102b88b7
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Тонкий NAPI-шар між JS і `llm-lib` для `@7n/llm-lib`, що забезпечує публічні точки входу `one_shot_acp`, `get_acp_presets`, `resolve_model`, `OneShotLocalCloudOptions` і `one_shot_local_cloud`. Він слугує для конвертації типів JS ⇄ Rust, передає логіку до `llm-lib/lib/acp.mjs`, `llm-lib/lib/local-cloud.mjs` і `llm-lib/lib/model-tiers.mjs`, та мапить помилки в `napi::Error` без прориву внутрішніх збоїв назовні.

## Поведінка

one_shot_acp і resolve_model не виконують власної бізнес-логіки: вони лише передають запит у llm-lib, де вже живе вибір ACP-агента, розв’язання тиру та мапінг на помилки NAPI. one_shot_acp використовує або прямий ACP-виклик, або tier-based шлях, тому всі дані для виконання беруться з JS і робочого каталогу викликача, а результат повертається як готовий текст або fail-safe помилка. get_acp_presets віддає JS-стороні узгоджений з Rust набір пресетів агентів і тирів, щоб обгортка могла працювати без окремого data-джерела. OneShotLocalCloudOptions задає лише зовнішні вхідні дані для one_shot_local_cloud: карту локальних провайдерів і system-репліку; якщо провайдерів немає або JSON невалідний, виклик завершується помилкою раніше, ніж дійде до моделі. one_shot_local_cloud далі нормалізує вхід у LocalCloud, після чого або розв’язує абстрактний тир у конкретний spec, або використовує явний spec, і повертає один chat-відповідь без прориву внутрішніх помилок назовні.

## Публічний API

- one_shot_acp — Один виклик через ACP-агента з особистою підпискою (`cursor`/`codex`/`pi`). `cwd` — робочий каталог проєкту-викликача (не process cwd). `tier` — опційний абстрактний тир (`min`/`avg`/`max`, задача T5, рішення И): якщо заданий, Rust сам резолвить tier→env/args/post-session-config з пресету агента ([`llm_lib::acp::one_shot_acp_with_tier`]) — жодного JS-хелпера "пресет→env" не потрібно. Без тиру — стара поведінка (модель = персональний конфіг CLI на машині).
- get_acp_presets — Пресети ACP-агентів (задача T5, рішення Б): для кожного `kind`-у — `command`/`label`, для кожного тиру — `label`/`env`/`args`/`postSessionConfig` (серіалізований [`llm_lib::acp::TierPreset`]). Джерело — виключно Rust-пресети `llm_lib::acp::presets`, жодного окремого JS-data-пакета (рішення Б).
- resolve_model — Каскадне розв'язання абстрактного тиру (`min`/`avg`/`max`) у `"provider/model-id"` за `N_LOCAL_*`/`N_CLOUD_*` env — чиста функція, без мережевого виклику. Єдине джерело правди для `resolveModel` з `llm-lib/lib/model-tiers.mjs` (задача T5, рішення Е).
- OneShotLocalCloudOptions — Опції [`one_shot_local_cloud`]: конфіг локальних провайдерів (`omlx` тощо) і опційна system-репліка. Обидва опційні — без локальних провайдерів `modelSpecOrTier`, що резолвиться в них, просто провалиться помилкою "невідомий провайдер" глибше в `llm_lib::local_cloud`.
- one_shot_local_cloud — Один chat-виклик Типу 2a (OpenAI-сумісний API, sync) для Node. `model_spec_or_tier` — або явний `"provider/model-id"`, або абстрактний тир (`min`/`avg`/`max`), що резолвиться через [`llm_lib::resolve_model`] (та сама функція, що й [`resolve_model`] napi-експорт вище) — задача T5.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
