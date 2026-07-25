---
type: Rust Module
title: session.rs
resource: llm-lib/crates/llm-lib/src/acp/session.rs
docgen:
  crc: 32c76196
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 55
  issues: no-overview,short-behavior,best-of-2:retry-lost
---

## Публічний API

- PostSessionConfig — Опційний post-`session/new`-крок конфігурації (рішення З.1, потрібен Pi-тіру): один `session/set_config_option` **між** `session/new` і першим `session/prompt` — не env/args на спавні, як у Cursor/Codex. `configId: "model"`, `value: "provider/modelId"` (напр. `"openai-codex/gpt-5.6-terra"`) — точні значення несе тір-пресет (T3), цей тип лише виконує вже готову пару.
- new — Пара `configId`/`value` для `session/set_config_option`.
- PermissionMode — Хто відповідає на `session/request_permission` (рішення Л — два режими одного механізму, не два дизайни).
- SessionOptions — Опції створення сесії ([`create_session`]).
- SessionEvent — Подія, яку [`create_session`] публікує в канал подій.
- PermissionRequestEvent — Запит дозволу, що чекає на відповідь ззовні ([`PermissionMode::External`]).
- respond — Відповідає обраним варіантом (`option.option_id` з [`Self::options`]).  # Errors [`LlmError::Provider`] — з'єднання з агентом уже закрите.
- cancel — Відхиляє запит (агент отримує `RequestPermissionOutcome::Cancelled`).  # Errors [`LlmError::Provider`] — з'єднання з агентом уже закрите.
- SessionHandle — Ручка живої сесії — `prompt`/`cancel`. Клонування дешеве (`mpsc::UnboundedSender` всередині); фонова задача сесії завершується, коли останній клон дропається.
- prompt — Надсилає prompt і чекає на кінець ходу (`StopReason`). Контент самого ходу (текст/tool-calls/plan) приходить окремо через канал подій [`create_session`] — це повертає лише термінальний статус.  # Errors [`LlmError::Provider`] — фонова задача сесії вже завершилась (з'єднання розірване) або хід провалився ACP-помилкою/idle-timeout.
- cancel — Просить агента скасувати поточний хід (`session/prompt` завершиться зі `StopReason::Cancelled`) — сама команда не блокує на підтвердженні.  # Errors [`LlmError::Provider`] — фонова задача сесії вже завершена.
- create_session — Спавнить агента (`spec`), відкриває сесію в `cwd` і тримає її живою у фоновій `tokio`-задачі, доки живий хоч один [`SessionHandle`]. Повертається лише після успішного `initialize` → `session/new` → опційного `session/set_config_option` — так само, як `acp_spawn_agent` у плагіні чекає handshake, щоб перший `prompt` не гнався за гонкою і щоб реальна причина відмови (агент не залогінений, невалідний `configId` тощо) повернулась одразу, а не як загадкове "канал закритий" з першого [`SessionHandle::prompt`].  # Errors [`LlmError::Provider`] — спавн/handshake/config-крок провалились.
- drive_auto_approve — Готова [`PermissionMode::AutoApprove`]-стратегія, реалізована **поверх** [`PermissionMode::External`]-каналу (рішення Л: не окремий протокольний шлях, той самий механізм). Не потрібна тому викликачу, який створює сесію вже з `PermissionMode::AutoApprove` (той шлях відповідає всередині фонової задачі сесії, без проходу через канал подій) — придатна, якщо зовнішній код хоче явно приймати рішення по кожному запиту, окрім авто-approve, тобто для проміжних стратегій (напр. `AutoApprove` з логуванням) поверх `External`-каналу.  Читає `rx`, доки він не закриється (сесія завершилась), ігноруючи `SessionEvent::Update` — той хай читає власний код викликача з окремого каналу чи `tee`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
