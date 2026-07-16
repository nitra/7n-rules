---
type: JS Module
title: acp.mjs
resource: llm-lib/lib/acp.mjs
docgen:
  crc: 5c32e90c
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл надає тонкий JS-доступ до `cursor` або `codex` через публічну `runAcpAgent`, покладаючись на вже авторизовану локальну CLI-сесію без API-ключів. Уся ACP-логіка живе в нативному Rust-шарі `llm_cascade::acp`, який викликається in-process через `napi FFI` у `llm-lib/crates/llm-cascade-napi`; тут немає власного `ClientSideConnection` чи JSON-RPC. Саме Rust запускає агента, обробляє `session/prompt`, автоматично погоджує `session/request_permission` і стежить за живістю дочірнього процесу. Крейт підтримує лише `cursor`/`codex`; `claude`-runner лишається окремим JS-шимом у `@7n/rules` (`npm/scripts/lib/acp-runner.mjs`).

## Поведінка

1. `runAcpAgent` запускає один ACP-хід для `cursor` або `codex` через вже авторизовану локальну CLI-сесію, без API-ключів.
2. Вона звертається до нативного Rust-шару `llm_cascade::acp`, який бере на себе весь протокол взаємодії: старт агента, обмін `session/prompt`, автоапрув запитів на дозвіл і контроль живості дочірнього процесу.
3. Вона передає робочий каталог поточного проєкту як контекст сесії, щоб агент працював у межах каталогу викликача.
4. Вона повертає повний текст відповіді агента за один хід.
5. Вона не виконує власну протокольну логіку, не працює з `claude`, і не покладається на `ClientSideConnection`; підтримка `claude` живе окремо в JS-шимі `npm/scripts/lib/acp-runner.mjs`.

## Публічний API

- runAcpAgent — запускає один запит через ACP-агента з власною підпискою

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
