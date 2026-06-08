# Скоуп coverage-гейту турнікета через `--changed` від `base_commit`

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

Турнікет `flow verify` проганяє `DEFAULT_GATES = [lint, coverage]`, де `coverage` запускає vitest і Stryker по **всьому** проєкту (всі workspace-и, всі файли `src`), незалежно від того, які файли фактично змінено в задачі. Це призводить до надмірних прогонів Stryker — навіть після дрібних правок і навіть кілька разів за TDD-цикл. Додатково: `stryker.config.baseline.mjs` містить `incremental: true`, але `reports/stryker/` є в `.gitignore` (правило `n-test.mdc:221`), тому у свіжому worktree `incremental.json` завжди відсутній — перший прогін завжди повний (cold-start примусовий).

## Considered Options

- Повне видалення `coverage` з `DEFAULT_GATES` (лишається тільки на `release`/ручний виклик)
- `coverage --changed`: coverage-гейт лишається у турнікеті, але аналізує лише файли, змінені від `base_commit` задачі; передає scope у vitest (`--changed <base>`) та Stryker (`--mutate <список js-файлів>`)
- Конфіг-кероване увімкнення через `.n-cursor.json#flow.gates` (дефолт `['lint']`, opt-in `coverage`)
- Перенесення `coverage`-гейту на `release`-only (не в per-step `flow verify`)

## Decision Outcome

Chosen option: "`coverage --changed`", because користувач явно підтвердив: весь турнікет переходить на `--changed` (повний coverage лишається лише на `release`/ручний виклик), і при цьому coverage-гейт зберігається у `DEFAULT_GATES` — але завжди через `coverage --changed`.

### Consequences

- Good, because турнікет більше не ганяє весь Stryker і весь vitest-suite після кожної дрібної правки: scope обмежено `git diff <base_commit>` проти робочого дерева (uncommitted + committed рівноцінно).
- Good, because усувається примусовий cold-start Stryker у свіжому worktree (де `incremental.json` завжди відсутній через `.gitignore`).
- Bad, because порожній scope (наприклад, лише non-JS зміни) потрібно явно обробляти як `pass (0)`, а не поточний `exit 1` «Жодного провайдера»; без цієї обробки турнікет падатиме на правках документації.
- Bad, because coverage більше не форситься автоматично для всього проєкту на кожному `verify`; мутаційне покриття поза зміненими файлами перевіряється лише явно (`/n-coverage-fix`, `bun run coverage`) або на `release`.

## More Information

- `DEFAULT_GATES` визначено у `npm/scripts/dispatcher/lib/reviewer.mjs:14`
- Coverage-гейт оркеструється через `npm/rules/test/coverage/coverage.mjs` (orchestrator) → `npm/rules/js-lint/coverage/coverage.mjs` (js-lint provider)
- `base_commit` для `git diff` береться зі стану flow (`.flow.json#metadata.base_commit`)
- `collectChangedFilesSince(base, cwd)` — новий helper у `npm/scripts/lib/changed-files.mjs` (поруч із наявним `collectChangedFiles`); об'єднує committed `git diff ${base}..HEAD`, uncommitted `git diff HEAD`, untracked `git ls-files --others`
- vitest 4.1.7 підтримує `--changed [since]`; Stryker 9 приймає `--mutate <файли>` (comma-separated)
- Fallback: якщо стан flow відсутній (ручний виклик поза flow), `coverage --changed` відступає до `collectChangedFiles` (working-tree від HEAD)
- `npm/scripts/dispatcher/lib/active.mjs:43` — `defaultVerify` → `runReview` (consumer без override)
- `npm/scripts/dispatcher/lib/commands.mjs:141` — `flow verify` (consumer)
- Тести `tests/reviewer.test.mjs` хардкодять `['lint','coverage']` — потребують оновлення при зміні `DEFAULT_GATES`

## Update 2026-06-01

Передісторія рішення: початковий аналіз розглядав повне видалення `coverage` з `DEFAULT_GATES`, перенесення на `release`-only та конфіг-кероване увімкнення через `.n-cursor.json#flow.gates` (дефолт `['lint']`, opt-in `coverage`). Аргумент проти видалення: `lint`-гейт вже задовольняє «лише змінені файли» (quick-режим + `changedFiles` з `changed-files.mjs`), тоді як `coverage` не має аналогічного режиму — вилучення без scoping лишало б coverage лише на `release`/ручний виклик без автоматичної гарантії.

Додатковий контекст cold-start: `stryker.config.baseline.mjs:16` містить `incremental: true`, але `reports/stryker/` є в `.gitignore` (n-test.mdc:221), тому у свіжому worktree `incremental.json` завжди відсутній незалежно від incremental-налаштування.
