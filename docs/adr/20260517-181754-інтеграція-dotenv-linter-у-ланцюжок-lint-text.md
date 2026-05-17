---
session: 8f3ac9f0-4a51-40c0-bf84-287a0e1b6bca
captured: 2026-05-17T18:17:54+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8f3ac9f0-4a51-40c0-bf84-287a0e1b6bca.jsonl
---

## ADR Інтеграція dotenv-linter у ланцюжок `lint-text`

## Context and Problem Statement
Ланцюжок `lint-text` перевіряв правопис, shell-скрипти, markdown і JSON/YAML, але не перевіряв `.env`-файли. `.env`-файли в проєктах містять потенційні проблеми (дублювані ключі, нижній регістр, некоректні роздільники), які жоден наявний кроки ланцюжка не виявляв.

## Considered Options
* Додати `dotenv-linter` як новий крок у `lint-text` (вимагається лише в `PATH`, без `devDependencies`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `dotenv-linter` у `lint-text`", because користувач явно запросив інтеграцію, і інструмент уже відповідає паттерну shellcheck — зовнішній бінарний файл у `PATH`, не в `dependencies`.

### Consequences
* Good, because `.env`-файли тепер автоматично перевіряються і виправляються в рамках того самого `bun run lint-text`, без нових залежностей у `package.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/text/lint/run-dotenv-linter.mjs` — нова обгортка (fix + check)
- `npm/rules/text/lint/lint.mjs` — крок вставлений між shellcheck і markdownlint
- `npm/rules/text/text.mdc` + `.cursor/rules/n-text.mdc` — версія `1.27`, параграф `**dotenv-linter:**`
- Інсталяція: macOS `brew install dotenv-linter`; Linux `curl | sh` або `cargo install dotenv-linter`

---

## ADR Режим fix + check для dotenv-linter (аналогія з shellcheck)

## Context and Problem Statement
При додаванні dotenv-linter потрібно було вирішити, чи запускати лише `check` (тільки звітування про помилки), чи спочатку `fix --no-backup --quiet`, а потім `check` для фінальної перевірки, як це реалізовано для shellcheck.

## Considered Options
* `fix --no-backup --quiet` + `check` (як shellcheck)
* Лише `check`

## Decision Outcome
Chosen option: "`fix + check` (як shellcheck)", because користувач обрав цей варіант явно у відповіді на запитання, і він узгоджується з паттерном shellcheck в тому самому ланцюжку.

### Consequences
* Good, because transcript фіксує очікувану користь: дрібні помилки виправляються автоматично, людина бачить лише те, що неможливо виправити автоматично.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/text/lint/run-dotenv-linter.mjs`: `dotenv-linter fix -r --no-backup --quiet . --exclude node_modules --exclude .envrc`, далі `dotenv-linter check -r --quiet . --exclude node_modules --exclude .envrc`
- Аналог: `npm/rules/text/lint/run-shellcheck.mjs`

---

## ADR Виявлення .env*-файлів: рекурсивний режим dotenv-linter замість JS-глобу

## Context and Problem Statement
Для передачі файлів у dotenv-linter потрібно було вибрати між: ручний JS-обхід (`Bun.Glob`, `walkDir`) для формування списку файлів, або передача кореневого каталогу з прапорцем `-r` безпосередньо в `dotenv-linter`. Додатково: чи обмежуватись лише git-tracked файлами, чи сканувати весь ФС.

## Considered Options
* Рекурсивний режим `dotenv-linter -r .` з `--exclude node_modules --exclude .envrc`
* JS-глоб (`Bun.Glob` з `{ dot: true }`) для формування переліку файлів
* Лише git-tracked `.env*`-файли (аналог shellcheck)

## Decision Outcome
Chosen option: "Рекурсивний режим `dotenv-linter -r .`", because під час дослідження `Bun.Glob` не матчив dotfiles (потрібен `{ dot: true }` — нетиповий режим), а `dotenv-linter -r` з `--exclude` надійно вирішує задачу вбудованими засобами; користувач обрав «Усі `.env*` на ФС».

### Consequences
* Good, because реалізація залишилась мінімальною — без зайвого JS-коду для обходу файлової системи; виключення `node_modules` і `.envrc` передаються прапорцями самого інструменту.
* Bad, because на відміну від shellcheck, файли поза git (наприклад, локальні `.env.local`, що в `.gitignore`) також перевіряються — transcript фіксує цю різницю як навмисний вибір користувача.

## More Information
- Обґрунтування виключення `.envrc`: direnv-синтаксис (`source_url`, `export KEY=val`) дає хибні спрацьовування `IncorrectDelimiter`, `LowercaseKey` — перевірено в transcript інтерактивно.
- Команда: `dotenv-linter fix -r --no-backup --quiet . --exclude node_modules --exclude .envrc`
- Тест `npm/rules/text/lint/run-dotenv-linter.test.mjs` перевіряє: порожнє дерево, авто-фікс `LowercaseKey`, ігнор `node_modules`/`.envrc`.
