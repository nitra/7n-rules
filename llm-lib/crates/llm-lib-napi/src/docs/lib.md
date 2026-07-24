---
type: Rust Module
title: lib.rs
resource: llm-lib/crates/llm-lib-napi/src/lib.rs
docgen:
  crc: 8f0d13e0
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл надає JS-пакету `@7n/llm-lib` доступ до Rust-ядра `llm-lib` через napi: перетворює значення між Node і Rust, делегує ACP, local/cloud, tier resolution і batch-виклики в ядро та повертає JS-сумісні результати. Він існує як тонкий bridge для `llm-lib/lib/acp.mjs`, `llm-lib/lib/local-cloud.mjs` і `llm-lib/lib/model-tiers.mjs`, щоб не дублювати в Node ACP, tiers і local_cloud-логіку.

Помилки Rust-рівня мапляться у `napi::Error`; опційні результати повертаються відповідно до контрактів Rust-функцій.

## Поведінка

Цей файл є тонким napi-шаром між JS-пакетом `@7n/llm-lib` і Rust-ядром `llm-lib`: приймає JS-значення, приводить їх до Rust-представлень, делегує виконання в `llm-lib` і повертає результат назад у Node у формі, зручній для JS.

Для ACP-сценаріїв `one_shot_acp` отримує вибір агента й за потреби абстрактний tier, після чого передає роботу Rust-логіці ACP. `get_acp_presets` віддає JS-стороні ті самі Rust-пресети агентів, щоб JS-обгортки не мали власної копії даних і не дублювали логіку вибору command, env, args чи post-session config.

Для local/cloud-сценаріїв `resolve_model` є спільною точкою розв’язання tier у конкретний model spec за змінними середовища. `one_shot_local_cloud` використовує той самий контракт model spec або tier і опції `OneShotLocalCloudOptions`, після чого делегує одиночний chat-виклик у Rust local/cloud-шар. Якщо локальні провайдери не передані, файл не підміняє це власною логікою: помилка невідомого провайдера формується глибше в `llm-lib`.

Batch-потік використовує ті самі правила вибору моделі й local/cloud-конфігурації, що й одиночний виклик. `submit_batch` приймає набір `BatchItemInput`, застосовує ліміти з `BatchConfigInput` або дефолти Rust-ядра, запускає chunked concurrent обробку через `llm-lib` і повертає результати як `BatchResultOutput`. Помилки окремих елементів або чанків не зупиняють весь batch: вони потрапляють у результат відповідного item, а прогрес передається в JS-потік окремими non-blocking повідомленнями.

Усі публічні входи працюють як bridge, а не як джерело бізнес-логіки: ACP, tiers, local/cloud і batch-поведінка залишаються в `llm-lib`. Помилки Rust-рівня мапляться у napi-помилки або JS-сумісні поля результату; опційні результати зберігають семантику відповідних Rust-контрактів. Файл не зберігає спільний стан і не виконує власних операцій запису.

## Публічний API

- one_shot_acp — Один виклик через ACP-агента з особистою підпискою (`cursor`/`codex`/`pi`). `cwd` — робочий каталог проєкту-викликача (не process cwd). `tier` — опційний абстрактний тир (`min`/`avg`/`max`, задача T5, рішення И): якщо заданий, Rust сам резолвить tier→env/args/post-session-config з пресету агента ([`llm_lib::acp::one_shot_acp_with_tier`]) — жодного JS-хелпера "пресет→env" не потрібно. Без тиру — стара поведінка (модель = персональний конфіг CLI на машині).
- get_acp_presets — Пресети ACP-агентів (задача T5, рішення Б): для кожного `kind`-у — `command`/`label`, для кожного тиру — `label`/`env`/`args`/`postSessionConfig` (серіалізований [`llm_lib::acp::TierPreset`]). Джерело — виключно Rust-пресети `llm_lib::acp::presets`, жодного окремого JS-data-пакета (рішення Б).
- resolve_model — Каскадне розв'язання абстрактного тиру (`min`/`avg`/`max`) у `"provider/model-id"` за `N_LOCAL_*`/`N_CLOUD_*` env — чиста функція, без мережевого виклику, з опційним результатом або помилкою за Rust-контрактом. Єдине джерело правди для `resolveModel` з `llm-lib/lib/model-tiers.mjs` (задача T5, рішення Е).
- OneShotLocalCloudOptions — Опції [`one_shot_local_cloud`]: конфіг локальних провайдерів (`omlx` тощо) і опційна system-репліка. Обидва опційні — без локальних провайдерів `modelSpecOrTier`, що резолвиться в них, просто провалиться помилкою "невідомий провайдер" глибше в `llm_lib::local_cloud`.
- one_shot_local_cloud — Один chat-виклик Типу 2a (OpenAI-сумісний API) для Node. `model_spec_or_tier` — або явний `"provider/model-id"`, або абстрактний тир (`min`/`avg`/`max`), що резолвиться через [`llm_lib::resolve_model`] (та сама функція, що й [`resolve_model`] napi-експорт вище) — задача T5.
- BatchItemInput — Один item вхідного batch-у (Тип 2b, задача T6): дзеркалить [`llm_lib::batch::BatchItem`] у JS-обʼєкт.
- BatchConfigInput — Ліміти чанка/конкурентності для [`submit_batch`]. Незадане поле — дефолт [`llm_lib::batch::BatchConfig::default`] (чанк 35, конкурентність 2, рішення Р, бенч-калібрування — `docs/specs/2026-07-24-batch-emulation-bench.md`).
- BatchResultOutput — Результат одного item batch-у: рівно одне з `ok`/`error` заповнене — дзеркалить [`llm_lib::batch::BatchResult::outcome`] без `Result`-типу, якого немає в JS.
- submit_batch — Емуляція Типу 2b (batch, рішення Р спеки, задача T6): чанкований конкурентний прогін `items` через [`llm_lib::LocalCloud`] (той самий `model_spec_or_tier`/`options`-контракт, що й [`one_shot_local_cloud`]), під інтерфейсом `submit → progress → results`. Помилка одного item чи одного чанка не валить весь batch — потрапляє в `error`-поле саме цього [`BatchResultOutput`].  `on_progress` — опційний JS-колбек `(completed, total) => void`, викликається napi `ThreadsafeFunction`-ом (рішення для T6: прогрес не акумулюється в Rust і не блокує event loop Node — кожне завершення item-у публікується окремим non-blocking викликом у JS-потік).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Помилки Rust-рівня передаються назовні як napi-помилки або JS-сумісні поля результату.
- Опційні результати повертаються відповідно до контрактів Rust-функцій.
