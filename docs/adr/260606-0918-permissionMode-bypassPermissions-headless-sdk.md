# permissionMode: 'bypassPermissions' для headless SDK-воркера

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

`coverage --fix` запускає headless SDK-агента (`@anthropic-ai/claude-agent-sdk` `query()`) для ітеративного виправлення тестів. Без явного `permissionMode` агент обробляв запити й повертав відповіді, але жодного файлу не редагував: виклики `Edit`, `Write`, `Bash` ігнорувались без помилки — файл лишався `(missing)`.

## Considered Options

- `permissionMode: 'bypassPermissions'`
- `permissionMode: 'acceptEdits'`
- Залишити без `permissionMode` (SDK-дефолт)

## Decision Outcome

Chosen option: "`permissionMode: 'bypassPermissions'`", because функціональні проби підтвердили: без режиму — файл не створюється (`(missing)`); з `'bypassPermissions'` або `'acceptEdits'` — `WORKER_OK`. `bypassPermissions` обрано, оскільки `coverage --fix` також виконує `Bash` (запуск тестів), а `acceptEdits` може блокувати shell-команди в деяких конфігураціях.

### Consequences

- Good, because `coverage --fix` тепер реально редагує тести headless — до фіксу команда була функціонально неробочою.
- Bad, because `bypassPermissions` вимикає всі prompt-gates; підходить лише для CI/автономного прогону, де оператор свідомо запускає команду.

## More Information

- Змінений файл: `npm/scripts/coverage-fix.mjs` — додано `permissionMode: 'bypassPermissions'` в `options` до `query()`.
- Тест: `npm/scripts/tests/coverage-fix.test.mjs`, assertion `'передає cwd, maxTurns=20, allowedTools=[Read,Edit,Bash], permissionMode=bypassPermissions'` — 11/11.
- Change-файл: `npm/.changes/260606-0721.md`.
- Паралельний рефакторинг тієї ж сесії (38aa0305): CLI-екстрактори `n-cursor taze diff`, `n-cursor start-check scan|run`, `n-cursor fix --json` — детально в `260605-0719-детермінований-парсинг-у-cli-а-не-в-llm.md`.
- A/B/C hybrid-orchestrator benchmark для `n-fix` — детально в `260606-0804-n-fix-hybrid-script-orchestrator.md` та `260606-1124-orchestrator-vs-llm-skil-n-fix-bench-ta-local-first-ladder.md`.
