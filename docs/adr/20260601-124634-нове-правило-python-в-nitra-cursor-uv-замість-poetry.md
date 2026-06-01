---
session: 883ec3b5-bffa-491a-bff5-d6e0a0c1fccc
captured: 2026-06-01T12:46:34+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/883ec3b5-bffa-491a-bff5-d6e0a0c1fccc.jsonl
---

## ADR Нове правило `python` в `@nitra/cursor`: uv замість Poetry

## Context and Problem Statement
Пакет `@nitra/cursor` не мав правила для Python-проєктів. Потрібно було додати правило, яке автоматично активується за наявності `pyproject.toml`, перевіряє структуру проєкту і запускає `lint-python` — за тим самим flat-concern-патерном, що й існуючі правила `php`, `rust` тощо.

## Considered Options
* `uv` (PEP 621 `[project]`, `uv.lock`) як єдиний дозволений пакет-менеджер
* Poetry (`[tool.poetry]`, `poetry.lock`) — явно заборонено

## Decision Outcome
Chosen option: "uv (PEP 621)", because замовник у брифі зафіксував це як центральну вимогу: «замість Poetry лише uv»; Poetry-артефакти (`poetry.lock`, `[tool.poetry]`) заборонено як на рівні Rego-deny, так і на рівні JS-tooling.

### Consequences
* Good, because transcript фіксує очікувану користь: всі 17 conftest-тестів пройшли, JS-tooling-тести (6/6) зелені, сценарій «fixture з `[tool.poetry]` → exit 1» і «fixture з PEP 621 + `uv.lock` → exit 0» підтверджені вручну.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Створені файли: `npm/rules/python/meta.json`, `fix.mjs`, `js/tooling.mjs`, `lint/lint.mjs`, `python.mdc`, `policy/pyproject_toml/`, `policy/package_json/`, `policy/lint_python_yml/` (включно з `template/lint-python.yml.snippet.yml`).
Канонічний `astral-sh/setup-uv@v8.0.0` узгоджено з `npm/rules/ga/policy/lint_ga/template/lint-ga.yml.snippet.yml:32`.
Rego-перевірки: `pyproject_toml.rego` deny-слот на `tool.poetry`; `package_json.rego` contains-слот на `scripts.lint-python` містить `bun`; `lint_python_yml.rego` перевіряє `uses`-підмножину + `run`-підрядки (патерн з `lint_rust_yml.rego`).
JS-tooling перевіряє лише FS-existence: `pyproject.toml`, `uv.lock`, `package.json`, `.github/workflows/lint-python.yml`; відсутність `poetry.lock` і `poetry.toml`.
Тест-каунт у `npm/tests/fix-mjs-contract.test.mjs` оновлено з 34 → 36 (35 каталогів вже існували в HEAD — один попередній без оновлення лічильника).
Change-файл: `npm/.changes/1780306777450-ca16ef.md` (bump minor, секція Added).

---

## ADR Rego-first розподіл: JS лише для FS, Rego — для вмісту документів

## Context and Problem Statement
При додаванні правила `python` потрібно було вирішити, де перевіряти різні аспекти: наявність файлів, вміст `pyproject.toml`, відповідність `package.json` і CI-workflow. `conftest.mdc` забороняє дублювати перевірки вмісту документів у JS.

## Considered Options
* Rego для всіх перевірок вмісту документів; JS лише для FS-existence та spawn CLI
* Перевіряти все в JS (уникнути Rego)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Rego для вмісту документів; JS лише FS + spawn", because `conftest.mdc` (alwaysApply: true) явно вимагає цього: «пер-документні перевірки — у policy/; JS лише FS і spawn CLI»; цей розподіл відтворює паттерн `php` і `rust`.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun run lint-rego` → 538 тестів, 0 порушень; `regal lint` → 158 файлів, 0 порушень.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли Rego: `policy/pyproject_toml/pyproject_toml.rego`, `policy/package_json/package_json.rego`, `policy/lint_python_yml/lint_python_yml.rego` + відповідні `*_test.rego`.
Шаблони у `template/` (`pyproject.toml.deny.toml`, `package.json.contains.json`, `lint-python.yml.snippet.yml`) — єдине джерело канонічних значень; `python.mdc` містить markdown-лінки на ці файли без дублювання fenced-блоків.
JS `js/tooling.mjs` перевіряє лише FS: наявність `pyproject.toml`, `uv.lock`, `package.json`, `.github/workflows/lint-python.yml`; відсутність `poetry.lock` і `poetry.toml`.

---

## ADR Відсутність `lint-python` у `n-cursor.js` subcommand: relay через `package.json#scripts`

## Context and Problem Statement
Деякі правила (`docker`, `k8s`, `text`) реєструють окремий `case 'lint-...'` у `npm/bin/n-cursor.js`. Для правила `python` потрібно було вирішити: додавати такий case чи ні.

## Considered Options
* Додати `case 'lint-python'` у `n-cursor.js` (як `lint-docker`)
* Обмежитися `package.json#scripts.lint-python → bun .../rules/python/lint/lint.mjs` без зміни `n-cursor.js`

## Decision Outcome
Chosen option: "Не додавати case у n-cursor.js", because зміна двох tracked-файлів (`n-cursor.js`, `build-agents-commands.mjs`) при наявності нових незакомічених файлів під `npm/` тригерує `integration-repo-checks` — dirty-bump перевірку, яка вимагає ручного підвищення версії, що суперечить `n-changelog.mdc` («не бампай version вручну, чекай commit»). Правило `php` як еталон теж не має власного CLI-case. Тому обидві опційні зміни відкачано через `git checkout`.

### Consequences
* Good, because transcript фіксує очікувану користь: `integration-repo-checks` падає лише на `fix-mjs-contract.test.mjs` (обов'язкова правка лічильника), а не через n-cursor.js.
* Bad, because `npx @nitra/cursor lint-python` не буде доступним до явного додавання в наступному PR; споживач запускає через `bun run lint-python`.

## More Information
Відкат: `git checkout -- npm/bin/n-cursor.js npm/scripts/build-agents-commands.mjs`.
Паттерн `php` (еталон): не має `case 'lint-php'` у `n-cursor.js` — підтверджує правомірність підходу.
Обмеження зафіксовано в пам'яті: `memory/npm-module-dirty-bump-vs-changelog.md`.
