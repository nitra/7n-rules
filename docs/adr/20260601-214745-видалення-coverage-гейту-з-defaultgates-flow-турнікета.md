---
session: 37e16d83-9fec-4e35-8975-e1f75f254fe3
captured: 2026-06-01T21:47:45+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/37e16d83-9fec-4e35-8975-e1f75f254fe3.jsonl
---

## ADR: Видалення `coverage`-гейту з `DEFAULT_GATES` flow-турнікета

## Context and Problem Statement
`DEFAULT_GATES` у `npm/scripts/dispatcher/lib/reviewer.mjs:14` містить два гейти — `lint` і `coverage`. `flow verify` виконується після кожного кроку TDD-циклу (`executor.mjs` → `defaultVerify` → `runReview`). `n-cursor coverage` запускає `bunx vitest run --coverage` на всьому suite і `npx @stryker-mutator/core run` на всіх src-файлах кожного JS-workspace монорепо, без жодного diff-scoping. Це суперечить вимозі: inside flow перевіряти лише змінені файли.

## Considered Options
* Видалити `coverage` з `DEFAULT_GATES` повністю (лишити тільки `lint`)
* Перенести `coverage`-гейт на `release`-only (не в per-step `flow verify`, а лише під час `flow release`)
* Конфіг-кероване увімкнення через `.n-cursor.json#flow.gates` (дефолт `['lint']`, opt-in `coverage`)

## Decision Outcome
Chosen option: "Видалити або перенести `coverage` з `DEFAULT_GATES`", because `lint`-гейт уже задовольняє вимогу «лише змінені файли» (`"lint": "quick"` у `npm/rules/js-lint/meta.json`, оркестратор `npm/scripts/lint-cli.mjs` передає `changedFiles` з `changed-files.mjs`), тоді як `coverage` не має аналогічного режиму і завжди сканує весь проєкт.

### Consequences
* Good, because transcript фіксує очікувану користь: усунення повного vitest-suite і Stryker-прогону на кожен крок TDD-циклу всередині `flow run`/`--autonomous`.
* Good, because `stryker.config.baseline.mjs:16` містить `incremental: true`, але `reports/stryker/` є в `.gitignore` (правило `n-test.mdc:221`), тому у свіжому worktree `incremental.json` завжди відсутній — перший прогон завжди повний; вилучення гейту усуває цей примусовий cold-start.
* Bad, because coverage більше не форситься автоматично на кожному `verify`; мутаційне тестування запускатиметься лише явно (`/n-coverage-fix`, `/n-fix-tests`, `bun run coverage`) або на `release`.

## More Information
- `npm/scripts/dispatcher/lib/reviewer.mjs:14` — `DEFAULT_GATES` (місце зміни)
- `npm/scripts/dispatcher/lib/active.mjs:43` — `defaultVerify` → `runReview` (consumer без override)
- `npm/scripts/dispatcher/lib/commands.mjs:141` — `flow verify` (consumer без override)
- `npm/scripts/lib/changed-files.mjs` — інфраструктура для diff-scoping (вже є у `lint`)
- `npm/scripts/lint-cli.mjs` — оркестратор `n-cursor lint`: quick-режим передає `changedFiles`
- `npm/rules/js-lint/meta.json` — `"lint": "quick"` (підтверджує changed-files режим lint-гейту)
- `npm/rules/test/coverage/coverage.mjs` — оркестратор `n-cursor coverage` (whole-project)
- `npm/rules/js-lint/coverage/coverage.mjs:220–243` — `bunx vitest run --coverage` + `npx @stryker-mutator/core run` (без diff-scoping)
- `npm/rules/test/js/data/stryker_config/stryker.config.baseline.mjs:16` — `incremental: true` (пом'якшує, але не вирішує проблему у свіжому worktree)
- Тести `tests/reviewer.test.mjs` хардкодять `['lint','coverage']` — потребують оновлення при зміні `DEFAULT_GATES`
