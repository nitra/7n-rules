---
type: Rust Module
title: session.rs
resource: llm-lib/crates/llm-lib/src/acp/session.rs
docgen:
  crc: f39ad2ed
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 0
  issues: refusal-filler,best-of-2:retry-lost
---

## Огляд

Публічний session-API крейта для довгоживучої ACP-сесії з відкритим потоком подій, де `SessionOptions` через `create_session` запускає фонову `tokio`-задачу з власним ACP-з’єднанням і mpsc-циклом команд, а `create_session` не завершується, доки не пройдуть `initialize` → `session/new` → опційний `session/set_config_option`; це прибирає гонку на першому `SessionHandle::prompt` і робить сесію готовою до роботи одразу після створення. Контракт дає `prompt` і `cancel` без Tauri-залежностей, а `super::one_shot_acp` лишається окремим тонким фасадом над тим самим `super::transport`-шаром: один prompt, auto-approve і акумуляція тексту без зміни поведінки транспорту. Permission-поведінка побудована як двомодова робота одного механізму через той самий канал подій: `PermissionMode::External` пересилає `session/request_permission` як `SessionEvent::PermissionRequest`, а викликач відповідає через `PermissionRequestEvent::respond` або `PermissionRequestEvent::cancel`; `PermissionMode::AutoApprove` використовує той самий потік подій, де `drive_auto_approve` одразу обирає відповідь через `transport::pick_auto_permission_option`.

## Поведінка

PostSessionConfig і new задають один післястартовий крок конфігурації: після `session/new` у сесію передається готова пара `configId`/`value`, щоб агент стартував уже з потрібною моделлю без втручання в spawn-параметри.

PermissionMode визначає, чи запити дозволу йдуть назовні через події, чи автоматично закриваються всередині фонової сесії; це два режими одного каналу рішення, а не два різні протоколи.

SessionOptions збирає стартові умови для create_session і задає базову поведінку сесії, зокрема режим дозволів за замовчуванням.

create_session відкриває ACP-сесію, завершує handshake перед поверненням і тримає з’єднання живим у фоні, доки існує хоча б одна SessionHandle. Потік подій і команд розділений: prompt рухає хід, cancel просить його зупинити, а SessionEvent несе назовні все, що стається всередині сесії.

SessionEvent є спільним потоком сповіщень для зовнішнього коду: через нього приходять оновлення ходу та запити дозволу, які потребують окремої реакції.

PermissionRequestEvent переносить зовнішньому коду сам запит і варіанти реакції; respond і cancel завершують цей цикл, повертаючи вибір назад у сесію або відхиляючи запит.

SessionHandle — це жива ручка до вже відкритої сесії. prompt запускає новий хід і чекає лише на його термінальний результат, тоді як увесь проміжний вміст продовжує текти через SessionEvent. cancel не чекає підтвердження й лише просить агент зупинити поточний хід; обидві операції залежать від того, що фонова задача сесії ще жива.

drive_auto_approve читає той самий потік PermissionRequestEvent і одразу закриває кожен запит автоматично, не втручаючись у потік SessionEvent.Update. Це зручний шар для стратегій, які хочуть зберегти зовнішній контроль, але без ручного вибору кожного дозволу.

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
