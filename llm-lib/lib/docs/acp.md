---
type: JS Module
title: acp.mjs
resource: llm-lib/lib/acp.mjs
docgen:
  crc: 587f1966
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Публічна точка входу `runAcpAgent` для запуску ACP-агента `cursor`, `codex` або `pi` через локально залогінений CLI без API-ключа. Це тонкий JS-міст до `llm_lib::acp` у `llm-lib/crates/llm-lib-napi`, без власної ACP JSON-RPC чи `ClientSideConnection` логіки; протокольна поведінка, `session/prompt`, `session/request_permission`, `tier→env/args/post-session-config` resolving і watchdog на мертвий або незапущений дочірній процес зосереджені в Rust. `AcpAgentKind` охоплює лише `cursor`/`codex`/`pi`; `claude` тут відсутній, а deprecated `claude`-runner лишається окремим JS-шимом у `@7n/rules` (`npm/scripts/lib/acp-runner.mjs`).

## Поведінка

1. `runAcpAgent` запускає один запит до ACP-агента з особистою підпискою для `cursor`, `codex` або `pi` у межах поточного робочого каталогу.
2. Якщо задано `tier`, передає цю абстракцію в нативний шар, щоб далі саме Rust визначив відповідні параметри сесії для вибраного агента.
3. Якщо `tier` не задано, використовує стандартну поведінку персонально залогіненого CLI без окремого вибору рівня.
4. Для виконання звертається до нативної реалізації в процесі, яка вже містить протокольну логіку, запуск сесії та обробку дозволів; цей файл не реалізує власний ACP-обмін і не працює з `claude`.
5. Повертає повний текст відповіді агента після завершення одного ходу.

## Публічний API

- runAcpAgent — Один виклик через ACP-агента з особистою підпискою. `tier` (задача T5,
рішення И) — опційний абстрактний тир (`min`/`avg`/`max`): якщо заданий,
Rust сам резолвить tier→env/args/post-session-config з пресету агента
(`one_shot_acp_with_tier`) — жодного JS-хелпера "пресет→env" тут немає.
Без `tier` — стара поведінка (модель = персональний конфіг CLI на машині).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
