# Інтеграція dotenv-linter у ланцюжок `lint-text`

**Status:** Accepted
**Date:** 2026-05-17

## Context and Problem Statement

Ланцюжок `lint-text` перевіряв правопис, shell-скрипти, markdown і JSON/YAML, але не перевіряв `.env`-файли, що можуть містити дублювані ключі, значення у нижньому регістрі, некоректні роздільники.

## Considered Options

- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `dotenv-linter` з режимом `fix + check` і рекурсивним `-r .`", because інструмент відповідає патерну shellcheck — зовнішній бінарний файл у `PATH`, не в `dependencies`; `-r .` з `--exclude` надійно вирішує задачу без зайвого JS-коду.

Три технічні рішення:
- **Режим fix + check**: `dotenv-linter fix --no-backup --quiet` + `dotenv-linter check`, аналогічно до shellcheck.
- **Рекурсивне сканування**: `-r .` замість JS-глобу (`Bun.Glob` не матчив dotfiles без `{ dot: true }`).
- **Виключення `.envrc`**: direnv-синтаксис (`source_url`, `export KEY=val`) дає хибні `IncorrectDelimiter` і `LowercaseKey` — підтверджено інтерактивно.

### Consequences

- Good, because `.env`-файли тепер перевіряються і виправляються в `bun run lint-text`; нових залежностей у `package.json` немає.
- Neutral, because git-untracked `.env.local` тощо також скануються — навмисний вибір, відмінний від shellcheck-патерну.
- Bad, because transcript не містить підтвердження негативних наслідків.

## More Information

Нові файли: `npm/rules/text/lint/run-dotenv-linter.mjs`.
Змінені: `npm/rules/text/lint/lint.mjs` (крок між shellcheck і markdownlint); `npm/rules/text/text.mdc` і `.cursor/rules/n-text.mdc` (версія `1.27`).
Тести: `npm/rules/text/lint/run-dotenv-linter.test.mjs` (порожнє дерево, авто-фікс `LowercaseKey`, ігнор `node_modules`/`.envrc`).
Команди: `dotenv-linter fix -r --no-backup --quiet . --exclude node_modules --exclude .envrc` + check аналогічно.
Інсталяція: macOS `brew install dotenv-linter`; Linux `curl | sh` або `cargo install dotenv-linter`.
