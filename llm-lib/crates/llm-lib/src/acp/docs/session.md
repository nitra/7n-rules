---
type: Rust Module
title: session.rs
resource: llm-lib/crates/llm-lib/src/acp/session.rs
docgen:
  crc: 19170628
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Публічний session-API крейта (задача T2, рішення В/В.1): довгоживуча ACP-сесія з відкритим потоком подій, зовнішнім permission-responder-ом і `cancel` — те, що сьогодні вміє лише `tauri-plugin-agent` (`tauri-plugin-agent/src/acp/mod.rs`), тут без жодної Tauri-залежності (`AppHandle`/`Emitter`/`State` — Tauri-emit лишається адаптеру-плагіну, T9). [`super::one_shot_acp`] лишається окремим тонким фасадом (один prompt + auto-approve + акумуляція тексту) над тим самим [`super::transport`]-шаром, поведінка якого не змінюється.  Архітектура — session builder ([`SessionOptions`]) → `create_session` спавнить фонову `tokio`-задачу, яка володіє ACP-з'єднанням (з'єднання живе рівно стільки, скільки триває `connect_with`-future — той самий патерн, що й у плагіні) і крутить mpsc-цикл команд (`prompt`/`cancel`); `create_session` не повертається, доки `initialize` → `session/new` → опційний `session/set_config_option` не завершаться (handshake-ready- синхронізація, як `acp_spawn_agent` у плагіні) — інакше перший [`SessionHandle::prompt`] або спливе незрозумілою помилкою "канал закритий", або зафіксує гонку з handshake.  Permission-семантики (рішення Л) — два режими одного механізму: [`PermissionMode::External`] пересилає кожен `session/request_permission` як [`SessionEvent::PermissionRequest`] у той самий канал подій, і викликач відповідає сам ([`PermissionRequestEvent::respond`]/ [`PermissionRequestEvent::cancel`]); [`PermissionMode::AutoApprove`] — готова стратегія **поверх того самого каналу**: [`drive_auto_approve`] читає ті самі `PermissionRequest`-події і одразу відповідає [`transport::pick_auto_permission_option`], без окремого протокольного шляху.

## Публічний API

- PostSessionConfig — Опційний post-`session/new`-крок конфігурації (рішення З.1, потрібен Pi-тіру): один `session/set_config_option` **між** `session/new` і першим `session/prompt` — не env/args на спавні, як у Cursor/Codex. `configId: "model"`, `value: "provider/modelId"` (напр. `"openai-codex/gpt-5.6-terra"`) — точні значення несе тір-пресет (T3), цей тип лише виконує вже готову пару.
- new — Пара `configId`/`value` для `session/set_config_option`.
- PermissionMode — Хто відповідає на `session/request_permission` (рішення Л — два режими одного механізму, не два дизайни).
- SessionOptions — Опції створення сесії ([`create_session`]).
- denies_tool_call — Чи tool-call містить заборонений command fragment.
- SessionEvent — Подія, яку [`create_session`] публікує в канал подій.
- PermissionRequestEvent — Запит дозволу, що чекає на відповідь ззовні ([`PermissionMode::External`]).
- respond — Відповідає обраним варіантом (`option.option_id` з [`Self::options`]).  # Errors [`LlmError::Provider`] — з'єднання з агентом уже закрите.
- cancel — Відхиляє запит (агент отримує `RequestPermissionOutcome::Cancelled`).  # Errors [`LlmError::Provider`] — з'єднання з агентом уже закрите.
- SessionHandle — Ручка живої сесії — `prompt`/`cancel`/`shutdown`. Клонування дешеве (`mpsc::UnboundedSender` + `AbortHandle` всередині); фонова задача сесії завершується graceful-шляхом, коли останній клон дропається, — або негайно через [`SessionHandle::shutdown`].
- prompt — Надсилає prompt і чекає на кінець ходу (`StopReason`). Контент самого ходу (текст/tool-calls/plan) приходить окремо через канал подій [`create_session`] — це повертає лише термінальний статус.  # Errors [`LlmError::Provider`] — фонова задача сесії вже завершилась (з'єднання розірване) або хід провалився ACP-помилкою/idle-timeout.
- cancel — Просить агента скасувати поточний хід (`session/prompt` завершиться зі `StopReason::Cancelled`) — сама команда не блокує на підтвердженні.  # Errors [`LlmError::Provider`] — фонова задача сесії вже завершена.
- shutdown — Гарантований teardown сесії незалежно від поведінки агента: абортить фонову задачу, що володіє ACP-з'єднанням, — падіння її future дропає transport, а `ChildGuard` крейта вбиває дочірній процес агента. Graceful-шлях (drop останнього клона ручки → вихід командного циклу) покладається на те, що агент закриє stdio, — Codex ACP після термінального ходу цього не робить, тож one-shot та інші споживачі викликають `shutdown` явно після кінця ходу/помилки. Ідемпотентний; після нього канал подій [`create_session`] закривається, дочитавши буферизовані події.
- create_session — Спавнить агента (`spec`), відкриває сесію в `cwd` і тримає її живою у фоновій `tokio`-задачі, доки живий хоч один [`SessionHandle`]. Повертається лише після успішного `initialize` → `session/new` → опційного `session/set_config_option` — так само, як `acp_spawn_agent` у плагіні чекає handshake, щоб перший `prompt` не гнався за гонкою і щоб реальна причина відмови (агент не залогінений, невалідний `configId` тощо) повернулась одразу, а не як загадкове "канал закритий" з першого [`SessionHandle::prompt`].  # Errors [`LlmError::Provider`] — спавн/handshake/config-крок провалились.
- drive_auto_approve — Готова [`PermissionMode::AutoApprove`]-стратегія, реалізована **поверх** [`PermissionMode::External`]-каналу (рішення Л: не окремий протокольний шлях, той самий механізм). Не потрібна тому викликачу, який створює сесію вже з `PermissionMode::AutoApprove` (той шлях відповідає всередині фонової задачі сесії, без проходу через канал подій) — придатна, якщо зовнішній код хоче явно приймати рішення по кожному запиту, окрім авто-approve, тобто для проміжних стратегій (напр. `AutoApprove` з логуванням) поверх `External`-каналу.  Читає `rx`, доки він не закриється (сесія завершилась), ігноруючи `SessionEvent::Update` — той хай читає власний код викликача з окремого каналу чи `tee`.

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
