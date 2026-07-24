---
type: JS Module
title: acp.mjs
resource: llm-lib/lib/acp.mjs
docgen:
  crc: 2363e95a
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`runAcpAgent` надає тонкий JavaScript-вхід до Rust-шару `llm_lib::acp` через napi FFI in-process у `llm-lib/crates/llm-lib-napi` для одноразового запуску `cursor` або `codex` у каталозі проєкту через локально залогінений CLI. Файл існує, щоб отримати відповідь агента через особисту підписку без API-ключа: тут немає власного ACP JSON-RPC чи `ClientSideConnection`, а spawn агента, `session/prompt`, автоапрув `session/request_permission` і watchdog для мертвого або незапущеного дочірнього процесу виконує Rust-шар; `claude` до цього шляху не входить.

## Поведінка

1. `runAcpAgent` приймає запит на одноразовий запуск ACP-агента для `cursor` або `codex` у робочому каталозі проєкту.

2. `runAcpAgent` передає виконання нативному ACP-шару, щоб використати локально залогінений CLI з особистою підпискою замість API-ключа.

3. `runAcpAgent` не реалізує власну ACP-взаємодію в JavaScript: запуск агента, надсилання промпта, підтвердження дозволів і watchdog-поведінка належать Rust-рівню.

4. `runAcpAgent` повертає повний текст відповіді агента після завершення ходу.

5. `runAcpAgent` не обробляє `claude`: цей провайдер лишається поза ACP-шляхом і підтримується окремим застарілим JS-раннером.

## Публічний API

- runAcpAgent — Один виклик через ACP-агента з особистою підпискою.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
