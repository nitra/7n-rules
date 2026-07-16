---
type: Rust Module
title: cursor_live.rs
resource: llm-lib/crates/llm-cascade/examples/cursor_live.rs
docgen:
  crc: bec087e2
---

## Огляд

Живий смок-тест ACP-бекенда проти вже залогіненого Cursor CLI (`agent acp`). Не автотест — реальний виклик підписки, що коштує квоти. Запуск: `cargo run --example cursor_live`.

## Поведінка

Надсилає через `one_shot_acp(AcpAgentKind::Cursor, …)` промпт «Скажи рівно одне слово: працює». Успіх — друкує `OK: <відповідь>`; провал — `FAILED: <помилка>` у stderr і вихід з кодом 1.
