---
session: 6fe23dd0-c98a-4062-9d55-2dc4ce97b956
captured: 2026-06-02T09:33:42+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6fe23dd0-c98a-4062-9d55-2dc4ce97b956.jsonl
---

## ADR `flow init` як надмножина `worktree add` — ізоляція + flow-стан

## Context and Problem Statement
Команди `flow review`, `flow verify`, `flow release` потребують `.flow.json` зі станом (`base_commit`, `level`, `risk`). Виникло питання: чи `flow init` під капотом викликає той самий `worktree add`, і чи worktree, створений напряму через `worktree add`, матиме необхідний стан.

## Considered Options
* `flow init` = `worktree add` + запис стану (два кроки)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`flow init` = `worktree add` + `writeState()`", because `commands.mjs:99-117` першим кроком викликає `ensureWorktree` (який викликає `npx @nitra/cursor worktree add`), а другим — `writeState(statePath, {...})` зі станом. Голий `worktree add` є підмножиною без файлу стану.

### Consequences
* Good, because `ensureWorktree` виявляє `isLinkedWorktree(cwd)` і пропускає `worktree add`, якщо вже в worktree — це дозволяє recovery: запустити `flow init` з існуючого worktree, щоб лише дописати `.flow.json` без повторної ізоляції.
* Bad, because worktree, створений через `worktree add` або будь-який інший спосіб без `flow init`, залишається «сліпою плямою» для усього flow-турнікета — `flow review` поверне `exit 1` з повідомленням `review: стану нема — спершу \`flow init\``.

## More Information
- `commands.mjs:76-77` — детекція `isLinkedWorktree(cwd)`: пропуск `worktree add`, якщо вже в worktree.
- `commands.mjs:99-117` — два кроки `init`: `ensureWorktree` + `writeState`.
- `state-store.mjs:4-7` — стан лежить як sibling-файл: `.worktrees/<branch>.flow.json`, не всередині worktree-директорії.
- `review.mjs:116-121` — `readState(statePath)` → якщо `null`, exit 1.
- Команда recovery: `cd .worktrees/feat-coverage-changed-gate && npx @nitra/cursor flow init feat/coverage-changed-gate "<опис>"` → вивід: `flow: уже в worktree — не вкладаю новий; init: ... → .flow.json`.

---

## ADR `coverage --changed` — scoped coverage gate у `DEFAULT_GATES`

## Context and Problem Statement
`flow verify` ганяв coverage по всьому проєкту, що дорого. Потрібен режим, що перевіряє лише файли, змінені з `base_commit`, щоб турнікет залишався швидким під час інкрементальних ітерацій.

## Considered Options
* Новий прапор `--changed` + `changed-files.mjs` + `DEFAULT_GATES` викликає `coverage --changed`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`coverage --changed`", because `reviewer.mjs` додав `coverage --changed` до `DEFAULT_GATES`; новий `npm/scripts/lib/changed-files.mjs` збирає tracked-modified + staged + untracked (без видалених) через `git diff HEAD` і `git ls-files --others`; JS-провайдер запускає vitest `--changed <base>` та Stryker `--mutate` лише по production-файлах зі змін; Rust-провайдер пропускає, якщо `.rs`/`Cargo.*` не торкнуті; порожній scope = pass.

### Consequences
* Good, because `flow verify` перевіряє лише diff — сесія стає швидшою; roots без змін пропускаються повністю; empty-scope не фейлить безпричинно.
* Bad, because `flow review` (L1-рецензент) виявив: у `npm/rules/js-lint/coverage/coverage.mjs` (~рядок 335) повернений код `runStryker` ігнорується (`await runner.runStryker(...)` без перевірки exit) — це підриває заявлений контракт «змінений src без тестів має дати NoCoverage-мутанти й впасти»; на момент сесії баг не виправлено.

## More Information
- Новий файл: `npm/scripts/lib/changed-files.mjs` — `collectChangedFiles()`, fail-soft поза git-репо.
- Змінені провайдери: `npm/rules/js-lint/coverage/coverage.mjs` (+111 рядків), `npm/rules/rust/coverage/coverage.mjs`, `npm/rules/test/coverage/coverage.mjs`.
- `npm/bin/n-cursor.js` — `coverage` приймає `--changed`, прокидає у `runCoverageCli`.
- `npm/scripts/dispatcher/lib/reviewer.mjs` — `DEFAULT_GATES` додано `coverage --changed`.
- Документація: `test.mdc` описує scoped-режим (fail-closed на недосяжний `base`); повний coverage лишається за `bun run coverage` / `/n-coverage-fix`.
- TDD: `changed-files.test.mjs` (+68), `js-lint/coverage` tests (+140), `test/coverage` tests (+78), `rust/coverage` tests (+46), `reviewer.test.mjs` (+19).
- Баг зафіксований `flow review` (L1): `runStryker` exit code не перевіряється — треба окремий fix.
