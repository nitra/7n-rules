---
session: 37e16d83-9fec-4e35-8975-e1f75f254fe3
captured: 2026-06-01T22:00:27+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/37e16d83-9fec-4e35-8975-e1f75f254fe3.jsonl
---

## ADR Scoped coverage у турнікеті flow: `--changed` від base_commit

## Context and Problem Statement
Турнікет `flow verify` проганяє `DEFAULT_GATES = [lint, coverage]` де `coverage` запускає vitest і Stryker по **всьому** проєкту (усі workspace-и, всі файли `src`), незалежно від того, які файли фактично змінено в задачі. Це призводить до надмірних прогонів Stryker — навіть після дрібних правок, і навіть кілька разів за TDD-цикл.

## Considered Options
* Повне видалення `coverage` з `DEFAULT_GATES` (лишається тільки на `release`/ручний виклик)
* `coverage --changed`: coverage-гейт лишається у турнікеті, але аналізує лише файли, змінені від `base_commit` задачі (covered uncommitted + committed однаково), і передає scope у vitest (`--changed <base>`) та Stryker (`--mutate <список js-файлів>`)

## Decision Outcome
Chosen option: "`coverage --changed`", because користувач явно підтвердив: весь турнікет переходить на `--changed` (повний coverage лишається лише на `release`/ручний), і при цьому coverage-гейт зберігається у `DEFAULT_GATES` — але завжди через `coverage --changed`.

### Consequences
* Good, because turniket більше не ганяє весь Stryker і весь vitest-suite після кожної дрібної правки: scope обмежено `git diff <base_commit>` проти робочого дерева (uncommitted + committed рівноцінно).
* Bad, because порожній scope (наприклад, лише non-JS зміни) потрібно явно обробляти як `pass (0)`, а не поточний `exit 1` «Жодного провайдера»; без цієї обробки турнікет падатиме на правках документації.

## More Information
- `DEFAULT_GATES` визначено у `npm/scripts/dispatcher/lib/reviewer.mjs:14`
- Coverage-гейт оркеструється через `npm/rules/test/coverage/coverage.mjs` (orchestrator) → `npm/rules/js-lint/coverage/coverage.mjs` (js-lint provider)
- `base_commit` для `git diff` береться зі стану flow (`.flow.json#metadata.base_commit`), як уже використовує `npm/scripts/dispatcher/lib/review.mjs`
- `collectChangedFilesSince(base, cwd)` — новий helper у `npm/scripts/lib/changed-files.mjs` (поруч із вже наявним `collectChangedFiles`)
- vitest 4.1.7 підтримує `--changed [since]`; Stryker 9 приймає `--mutate <файли>` (comma-separated)
- Fallback: якщо стан flow відсутній (ручний виклик поза flow), `coverage --changed` відступає до `collectChangedFiles` (working-tree від HEAD)
