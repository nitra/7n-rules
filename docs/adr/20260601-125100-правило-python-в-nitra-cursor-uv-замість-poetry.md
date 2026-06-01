---
session: 883ec3b5-bffa-491a-bff5-d6e0a0c1fccc
captured: 2026-06-01T12:51:00+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/883ec3b5-bffa-491a-bff5-d6e0a0c1fccc.jsonl
---

## ADR Правило `python` в `@nitra/cursor`: uv замість Poetry

## Context and Problem Statement
Репозиторій `@nitra/cursor` отримав нове правило `python`, яке визначає стандарт для Python-проєктів команди. Потрібно обрати пакет-менеджер: традиційний Poetry або новий uv. Зрозумілою вимогою сесії є перехід на єдиний інструмент.

## Considered Options
* uv (astral-sh/uv) з PEP 621 `[project]`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "uv з PEP 621 `[project]`", because користувач явно сформулював це як центральну вимогу: замість Poetry лише uv, `uv.lock`, без `poetry.lock` / `[tool.poetry]`.

### Consequences
* Good, because transcript фіксує очікувану користь: `uv lock --check` + `uv sync --frozen` — детерміністичний lockfile-flow; `astral-sh/setup-uv@v8.0.0` у CI.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/python/meta.json`: `{ "auto": { "glob": "pyproject.toml" } }` — автоактивація правила.
- `npm/rules/python/js/tooling.mjs`: fail на `poetry.lock`, `poetry.toml`; вимога `uv.lock`.
- `npm/rules/python/policy/pyproject_toml/`: deny `[tool.poetry]` через `template/pyproject.toml.deny.toml`.
- `npm/rules/python/policy/lint_python_yml/template/lint-python.yml.snippet.yml`: канон CI з `astral-sh/setup-uv@v8.0.0`, без кроків `poetry install` / `snok/install-poetry`.
- Міграційний шлях зафіксовано в `python.mdc`: `uv init`, перенесення метаданих у `[project]`, `uv lock`, `uv add --dev`.

---

## ADR Rego-first розподіл між policy та JS у правилі `python`

## Context and Problem Statement
Правило `python` перевіряє три різних файли: `pyproject.toml`, `package.json` і `.github/workflows/lint-python.yml`. Потрібно вирішити, де розміщувати логіку перевірок — у Rego-policy чи в JS.

## Considered Options
* Rego-first: per-document перевірки у `policy/`, JS лише для FS-existence та spawn CLI
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Rego-first", because `conftest.mdc` явно забороняє дублювати в JS те, що покриває conftest; FS-перевірки (чи існує файл) і spawn CLI — єдине, що залишається в `js/tooling.mjs` та `lint/lint.mjs`.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun run lint-rego` — 538 conftest-тестів зелені, включно з 17 новими тестами для `python`-policy.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/python/js/tooling.mjs`: перевіряє лише FS-existence (`pyproject.toml`, `uv.lock`, `package.json`, `lint-python.yml`, `poetry.lock`, `poetry.toml`) — без аналізу вмісту.
- `npm/rules/python/policy/pyproject_toml/pyproject_toml.rego`: deny `tool.poetry`; вимога `project.name` + `project.version`.
- `npm/rules/python/policy/package_json/package_json.rego`: `scripts.lint-python` містить підрядок `bun`.
- `npm/rules/python/policy/lint_python_yml/lint_python_yml.rego`: перевірка `uses`-підмножини та `run`-підрядків — аналог rust-стилю з `lint_rust_yml.rego`.
- Канонічні літерали — у `policy/*/template/`; у `python.mdc` — лише markdown-лінки.

---

## ADR Ruff запускається з авто-фіксом через `uv run` як опційний інструмент

## Context and Problem Statement
`lint-python` запускає Python-інструменти. Ruff не входить до залежностей `@nitra/cursor` і може бути відсутнім у середовищі. Потрібно вирішити: чи вимагати ruff обов'язково, і чи застосовувати auto-fix.

## Considered Options
* `uv run ruff check --fix` + `uv run ruff format` — авто-fix, опційно (пропуск якщо ruff недоступний)
* `uv run ruff check .` без --fix (read-only перевірка)
* Інші варіанти в transcript не обговорювалися у початковому брифі; перехід до auto-fix зроблено за явним запитом користувача після першої реалізації.

## Decision Outcome
Chosen option: "`uv run ruff check --fix` + `uv run ruff format`, опційно", because користувач явно попросив «додай авто фікс руфом» після перегляду початкової реалізації.

### Consequences
* Good, because transcript фіксує очікувану користь: дзеркалить поведінку `lint-text` (`markdownlint-cli2 --fix`) та `lint-rust` (`clippy --fix`) — мутація робочого дерева в межах lint-сесії.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/python/lint/lint.mjs`: якщо `uv run --frozen ruff --version` → 0, запускає `uv run --frozen ruff check --fix .` → `uv run --frozen ruff format .`; інакше крок пропускається з pass-повідомленням.
- `uv run mypy .` — залишається read-only (авто-fix для mypy не застосовний).
- `uv`, `ruff`, `mypy` — не в `dependencies` / `devDependencies` пакета `@nitra/cursor`; CLI лише в PATH середовища споживача.
- Оновлено `python.mdc` і change-файл `npm/.changes/1780306777450-ca16ef.md`.

---

## ADR Відсутність `case 'lint-python'` у `n-cursor.js` — wire через `package.json#scripts`

## Context and Problem Statement
Інші правила-лінтери (`lint-docker`, `lint-k8s`, `lint-text`) мають власний `case` у `npm/bin/n-cursor.js` і вбудований `import`. Потрібно вирішити, чи додавати аналогічний case для `lint-python`.

## Considered Options
* Не додавати `case` у `n-cursor.js`; споживач wire через `package.json#scripts.lint-python → bun …/rules/python/lint/lint.mjs`
* Додати `case 'lint-python'` за зразком `lint-docker`

## Decision Outcome
Chosen option: "Не додавати `case` у `n-cursor.js`", because дзеркалить `php`-правило, яке теж не має субкоманди в `n-cursor.js`; крім того, редагування відстежуваних файлів (`n-cursor.js`, `build-agents-commands.mjs`) на нерозмерженому дереві активувало б `npm-module` dirty-bump check — конфлікт з `n-changelog.mdc`, який забороняє ручний bump.

### Consequences
* Good, because transcript фіксує очікувану користь: PR лишається суто адитивним (лише нові untracked файли); `integration-repo-checks` не активує dirty-bump перевірку для нових файлів правила.
* Bad, because `npx @nitra/cursor lint-python` не працює без додаткового wiring у споживача — треба явно прописати `scripts.lint-python` у `package.json`, що перевіряє `policy/package_json`.

## More Information
- Перевірку наявності `scripts.lint-python` із підрядком `bun` покладено на Rego: `npm/rules/python/policy/package_json/`.
- `npm/rules/python/policy/package_json/template/package.json.contains.json`: `{ "scripts": { "lint-python": ["bun"] } }`.
- Відкат `git checkout -- npm/bin/n-cursor.js npm/scripts/build-agents-commands.mjs` зроблено свідомо в рамках сесії.
