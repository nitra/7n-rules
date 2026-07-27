---
type: JS Module
title: acp.mjs
resource: llm-lib/lib/acp.mjs
docgen:
  crc: 1ed416a1
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

ACP (Agent Client Protocol, Zed) — доступ до `cursor`/`codex`/`pi` через
особисту підписку (вже залогінений локально CLI), не API-ключ.

Тонкий JS-клієнт до Rust-крейта `llm_lib::acp` через napi FFI
in-process (`llm-lib/crates/llm-lib-napi`) — жодного власного
ACP JSON-RPC/`ClientSideConnection` тут; уся протокольна логіка (спавн
агента, `session/prompt`, автоапрув `session/request_permission`,
тір→env/args/post-session-config резолвінг) живе в Rust, разом з
watchdog-поведінкою на мертвий/незапущений дочірній процес.

`claude` тут немає — Rust-крейт моделює лише `cursor`/`codex`/`pi`
(`AcpAgentKind`); deprecated `claude`-раннер лишається окремим
JS-шимом у `@7n/rules` (`npm/scripts/lib/acp-runner.mjs`).

## Публічний API

- runAcpAgent — Один виклик через ACP-агента з особистою підпискою. `tier` (задача T5,
рішення И) — опційний абстрактний тир (`min`/`avg`/`max`): якщо заданий,
Rust сам резолвить tier→env/args/post-session-config з пресету агента
(`one_shot_acp_with_tier`) — жодного JS-хелпера "пресет→env" тут немає.
Без `tier` — стара поведінка (модель = персональний конфіг CLI на машині).

## Сценарії використання

- `llm-lib/tests/acp.test.mjs` (runAcpAgent; getAcpPresets (smoke через реально збудований napi-аддон)) — делегує kind/prompt/cwd у native.oneShotAcp і віддає його результат; без опцій (старий виклик без 4-го аргументу) — tier не заданий; tier прокидається в native.oneShotAcp четвертим аргументом; kind

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
