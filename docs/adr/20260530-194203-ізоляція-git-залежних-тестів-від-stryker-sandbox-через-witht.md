---
session: 9b2ddf67-dce0-4298-88ca-c524605c3c76
captured: 2026-05-30T19:42:03+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b2ddf67-dce0-4298-88ca-c524605c3c76.jsonl
---

## ADR Ізоляція git-залежних тестів від Stryker sandbox через `withTmpDir + git init`

## Context and Problem Statement

`n-cursor coverage` запускає Stryker для мутаційного тестування. Stryker копіює вихідні файли у тимчасову sandbox-директорію (`npm/reports/stryker/.tmp/sandbox-XXXXX/`) без `.git/`. Тест `listShellScriptPaths` у `npm/rules/text/lint/tests/run-shellcheck.test.mjs` обчислював `NPM_ROOT` через `import.meta.url` — під Stryker цей шлях вказував у sandbox, а не в реальне git-дерево. Як наслідок, `git ls-files` повертав порожній результат, тест падав у dry-run, і Stryker не запускав мутаційний аналіз взагалі.

## Considered Options

* `test.skipIf(process.env.STRYKER_MUTATOR_WORKER)` — пропускати тест у sandbox (за наявним патерном у `npm/tests/integration-repo-checks.test.mjs`)
* `inPlace: true` у `npm/stryker.config.mjs` — не створювати sandbox, мутувати у живому дереві
* Переписати тест через `withTmpDir + git init` — ізольований тимчасовий git-репо без залежності від реального `NPM_ROOT`

## Decision Outcome

Chosen option: "Переписати тест через `withTmpDir + git init`", because користувач явно обрав цей варіант як «найгігієнічніший» — тест стає повністю незалежним від cwd і коректно покриває гілку `git ls-files` як під звичайним vitest, так і під Stryker sandbox.

### Consequences

* Good, because тест покриває логіку `git ls-files`-гілки у `listShellScriptPaths` незалежно від середовища запуску — sandbox, worktree чи CI.
* Bad, because тест тепер вимагає `execFileSync('git', ['init', ...])` у tmp-директорії; якщо `git` відсутній у PATH на деяких середовищах — тест падатиме (transcript не містить підтвердження цього ризику).

## More Information

* Змінений файл: `npm/rules/text/lint/tests/run-shellcheck.test.mjs` — замінено `NPM_ROOT` на `withTmpDir` з `git init -q --initial-branch=main` і `git add -A`
* Патерн `withTmpDir` узятий з наявного коду: `npm/rules/ga/js/tests/workflows.test.mjs`
* Аналогічна проблема вирішена через `skipIf` у `npm/tests/integration-repo-checks.test.mjs:49-54` — цей ADR фіксує вибір повної ізоляції замість `skipIf` для нових тестів
* Change-файл: `npm/.changes/1780159016890-dd4a30.md` (`bump: patch`, `section: Fixed`)
* Stryker config: `npm/stryker.config.mjs` (`tempDirName: 'reports/stryker/.tmp'`)
* Env-змінна, яку Stryker ставить у worker-процесах: `STRYKER_MUTATOR_WORKER`
