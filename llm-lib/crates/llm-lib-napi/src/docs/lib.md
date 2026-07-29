---
type: Rust Module
title: lib.rs
resource: llm-lib/crates/llm-lib-napi/src/lib.rs
docgen:
  crc: 5c1e4d4a
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

napi-біндінги до `llm-lib` для `@7n/llm-lib`.  Тонкий шар: конвертація типів JS ⇄ Rust і мапінг помилок у `napi::Error`. Уся ACP/tiers/local_cloud-логіка живе в `llm-lib` — жодного повторного JSON-RPC чи каскадного коду тут. JS-обгортка — `llm-lib/lib/acp.mjs` + `llm-lib/lib/local-cloud.mjs` + `llm-lib/lib/model-tiers.mjs` (задача T5: остання делегує сюди `resolveModel`, більше не тримає власного каскаду).

## Поведінка

one\_shot\_acp виконує один виклик через ACP-агента, де `cwd` визначається як робочий каталог проєкту-викликача. Якщо заданий `tier`, він резолвиться до конфігурації через пресет агента без допоміжної JS-логіки. При відсутності тиру використовується стара поведінка, де модель визначається через персональний конфіг CLI.

get\_acp\_presets надає набір конфігурацій ACP-агентів, отримуючи дані виключно з Rust-пресетів, що гарантує узгодженість із ядром системи.

resolve\_model виконує каскадне розв'язання від явного селектора моделі до ідентифікатора `"provider/model-id"` без будь-яких мережевих операцій, використовуючи внутрішні політики.

one\_shot\_local\_cloud дозволяє синхронний виклик API, де `model_spec_or_tier` може бути явним ідентифікатором, абстрактним тиром або селектором, який інтерпретується за універсальною політикою.

BatchItemInput є представленням одного елемента вхідного пакету для обробки. BatchConfigInput визначає ліміти розбиття на чанки та конкурентності для емуляції або опитування справжнього Batch API.

submit\_batch координує виконання пакетних завдань, вибираючи між клієнтською емуляцією або реальним Batch API. Відмова одного елемента чи чанка не зупиняє весь процес, а помилка потрапляє в відповідне поле результату.

## Публічний API

- one_shot_acp — Один виклик через ACP-агента з особистою підпискою (`cursor`/`codex`/`pi`). `cwd` — робочий каталог проєкту-викликача (не process cwd). `tier` — опційний абстрактний тир (`min`/`avg`/`max`, задача T5, рішення И): якщо заданий, Rust сам резолвить tier→env/args/post-session-config з пресету агента ([`llm_lib::acp::one_shot_acp_with_tier`]) — жодного JS-хелпера "пресет→env" не потрібно. Без тиру — стара поведінка (модель = персональний конфіг CLI на машині).
- get_acp_presets — Пресети ACP-агентів (задача T5, рішення Б): для кожного `kind`-у — `command`/`label`, для кожного тиру — `label`/`env`/`args`/`postSessionConfig` (серіалізований [`llm_lib::acp::TierPreset`]). Джерело — виключно Rust-пресети `llm_lib::acp::presets`, жодного окремого JS-data-пакета (рішення Б).
- resolve_model — Каскадне розв'язання від явної `N_LOCAL_*_MODEL`/`N_CLOUD_*_MODEL` сходинки у `"provider/model-id"` — чиста функція, без мережевого виклику. Єдине джерело правди для `resolveModel` з `llm-lib/lib/model-tiers.mjs` (задача T5, рішення Е).
- OneShotLocalCloudOptions — Опції [`one_shot_local_cloud`]: конфіг локальних провайдерів (`omlx` тощо) і опційна system-репліка. Обидва опційні — без локальних провайдерів `modelSpecOrTier`, що резолвиться в них, просто провалиться помилкою "невідомий провайдер" глибше в `llm_lib::local_cloud`.
- one_shot_local_cloud — Один chat-виклик Типу 2a (OpenAI-сумісний API, sync) для Node. `model_spec_or_tier` — явний `"provider/model-id"`, абстрактний tier (`min`/`avg`/`max`) або `N_LOCAL_*_MODEL`/`N_CLOUD_*_MODEL` selector. Tier і selector резолвляться тією самою universal policy, що й [`resolve_model`] napi-експорт вище.
- BatchItemInput — Один item вхідного batch-у (Тип 2b, задача T6): дзеркалить [`llm_lib::batch::BatchItem`] у JS-обʼєкт.
- BatchConfigInput — Ліміти чанка/конкурентності емуляції та опитування справжнього Batch API для [`submit_batch`]. Незадане поле — дефолт [`llm_lib::batch::BatchConfig::default`] (чанк 35, конкурентність 2, рішення Р, бенч-калібрування — `docs/specs/2026-07-24-batch-emulation-bench.md`) чи [`llm_lib::remote_batch::RemoteBatchConfig::default`] (опитування кожні 2с, ліміт 20хв — спека `2026-07-27-batch-local-avg-real-batches.md`).
- BatchResultOutput — Результат одного item batch-у: рівно одне з `ok`/`error` заповнене — дзеркалить [`llm_lib::batch::BatchResult::outcome`] без `Result`-типу, якого немає в JS.
- submit_batch — Тип 2b (batch, задача T6, спека `2026-07-27-batch-local-avg-real-batches.md`): [`llm_lib::dispatch_batch`] обирає між клієнтською емуляцією (чанкований конкурентний прогін через [`llm_lib::LocalCloud`], той самий `model_spec_or_tier`/`options`-контракт, що й [`one_shot_local_cloud`]) і справжнім `/v1/batches` litellm batch-adapter-а — під тим самим інтерфейсом `submit → progress → results`. Помилка одного item чи одного чанка/усього batch-у, що впав до старту item-ів, не валить виклик — потрапляє в `error`-поле відповідного [`BatchResultOutput`].  `on_progress` — опційний JS-колбек `(completed, total) => void`, викликається napi `ThreadsafeFunction`-ом (рішення для T6: прогрес не акумулюється в Rust і не блокує event loop Node — кожне завершення item-у чи кожен poll публікується окремим non-blocking викликом у JS-потік).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
