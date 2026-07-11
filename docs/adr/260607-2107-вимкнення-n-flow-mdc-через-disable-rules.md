---
type: ADR
title: Вимкнення правила n-flow.mdc через disable-rules
description: Застаріле правило n-flow.mdc потрібно вимикати через disable-rules, щоб sync не матеріалізував його повторно з bundled пакету.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Правило `n-flow.mdc` з `alwaysApply: true` описувало застарілий контракт `n-cursor flow`. Після переходу на нову `graph` архітектуру `n-cursor flow` було видалено, але `n-flow.mdc` продовжувало автоматично матеріалізуватися з bundled пакету `@nitra/cursor` під час `npx @nitra/cursor` sync.

## Considered Options

- Видалити лише `.cursor/rules/n-flow.mdc` вручну.
- Додати `"flow"` до `disable-rules` у `.n-cursor.json`.

## Decision Outcome

Chosen option: "Додати `flow` до `disable-rules` у `.n-cursor.json`", because ручне видалення файлу недостатнє: `npx @nitra/cursor` відновлює bundled правило при наступному sync, якщо воно не вимкнене конфігом.

### Consequences

- Good, because `npx @nitra/cursor` більше не матеріалізує `.cursor/rules/n-flow.mdc`.
- Good, because sync підтвердив видалення `n-flow.mdc` як файлу поза списком.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінено `.n-cursor.json`: `"flow"` видалено з `rules[]` і додано до `disable-rules[]`.
- Видалено `.cursor/rules/n-flow.mdc`.
- Sync-команда: `npx @nitra/cursor`.
- Bundled джерело в transcript: `@nitra/cursor@4.1.0`.

## Update 2026-06-07

Драфт уточнює, що правило `n-flow.mdc` не лише вимкнено через `disable-rules`, а й прибрано з bundled-пакета:

- `npm/rules/flow/` видалено з пакета;
- `.cursor/rules/n-flow.mdc` не матеріалізується після `npx @nitra/cursor` sync;
- `CLAUDE.md` не містить посилання на `n-flow.mdc`;
- запис `"flow"` у `disable-rules` тимчасово лишався як запобіжник, щоб правило не синхронізувалося автоматично, якщо колись повернеться у bundled пакет.

Transcript також фіксує, що dispatcher-модулі з `flow` у назві не слід плутати з новим graph-протоколом, якщо вони ще використовуються новою архітектурою.

## Update 2026-06-07

Драфт розширює рішення з правила `n-flow.mdc` на dispatcher-код старої flow-архітектури:

- видалено `dispatcher/lib/flow-plan.mjs`, `dispatcher/lib/flow-signals.mjs`, `dispatcher/lib/flow-resolve.mjs`, `dispatcher/lib/flow-verify.mjs`;
- видалено відповідні тести `lib/tests/flow-*.test.mjs`;
- видалено застарілі docs `dispatcher/lib/docs/flow-lock.md` і `dispatcher/lib/docs/flow-resolve.md`;
- `flow-verify.mjs` перенесено в graph-архітектуру як `dispatcher/graph/lib/cmd-verify.mjs` зі схемою `fact_NNN.md` замість `outputs_NNN.md`;
- `dispatcher/index.mjs` оновлено на імпорти з `graph/lib/cmd-plan.mjs`, `graph/lib/cmd-verify.mjs`, `graph/lib/cmd-signals.mjs`;
- `bun test scripts/dispatcher` проходив з 61 тестом після змін.

Причина: `cmd-plan.mjs` і `cmd-signals.mjs` вже покривали функціонал старих flow-модулів у новій graph-схемі, а `flow-resolve.mjs` стосувався мертвої `.flow.json`-архітектури.
