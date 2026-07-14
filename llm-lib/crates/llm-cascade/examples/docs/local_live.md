---
type: Rust Module
title: local_live.rs
resource: llm-lib/crates/llm-cascade/examples/local_live.rs
docgen:
  crc: 29341390
---

## Огляд

Живий смок-тест local-бекенда через genai проти omlx. Запуск: `N_LOCAL_MIN_MODEL=omlx/<model> cargo run --example local_live`.

## Поведінка

Створює `LocalCloud` з одним локальним провайдером `omlx` (`http://127.0.0.1:8000/v1/`, опційний ключ з `OMLX_API_KEY`) і робить один виклик `one_shot(Tier::Min, …)` з промптом «Скажи рівно одне слово: працює». Успіх — друкує `OK: <відповідь>`; провал — `FAILED: <помилка>` у stderr і вихід з кодом 1.
