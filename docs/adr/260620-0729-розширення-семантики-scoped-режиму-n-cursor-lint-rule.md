---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T07:29:04+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

## ADR Розширення семантики scoped-режиму `n-cursor lint <rule>`

## Context and Problem Statement
`n-cursor lint <rule>` виконував лише конформність (Rego-перевірку), пропускаючи лінтер-фазу (`js/lint.mjs`). При цьому `bun run lint-ga`, `bun run lint-text` та інші standalone-скрипти викликали саме лінтер. Існувала концептуальна інверсія: «scoped» виклик robив менше, ніж він мав би, і не міг замінити CI-обгортки.

## Considered Options
* Лишити scoped = conformance-only; CI-обгортки `lint-<rule>` лишаються безстрочними аліасами.
* Зробити `n-cursor lint <rule>` повноцінним — ганяє і `js/lint.mjs` лінтер, і конформність для кожного зазначеного правила (обраний варіант).

## Decision Outcome
Chosen option: "Scoped = лінтер + конформність", because це дозволяє замінити всі `bun run lint-*` обгортки одним `n-cursor lint <rule>` і усуває семантичну інверсію. `hk lint changelog` зберігає зворотну сумісність: правило `changelog` не має `js/lint.mjs` → `linterIds` порожній → виконується лише конформність.

### Consequences
* Good, because `n-cursor lint ga --read-only` стає функціональним еквівалентом `bun run lint-ga`, що відкриває шлях до видалення CI-обгорток.
* Bad, because transcript не містить підтверджених негативних наслідків; при правилах із вже вбудованим `check()` у лінтері (ga) конформність-фаза виконує `check()` вдруге — inherited поведінка `--full`, не нова регресія.

## More Information
Реалізовано у `npm/rules/lint/js/orchestrate.mjs` через нову функцію `runScopedRules`. Тести у `npm/rules/lint/js/tests/orchestrate.test.mjs` (5/5). Guard: `rulesDir !== undefined` у scoped-гілці дзеркалить guard у `--full` (тестовий кастомний `rulesDir` пропускає конформність). Команди smoke: `bun ./npm/bin/n-cursor.js lint changelog --read-only`, `bun ./npm/bin/n-cursor.js lint doc-files --read-only`.

---

## ADR Інтеграція python-правила в n-cursor lint оркестратор

## Context and Problem Statement
`python/meta.json` не мав `"lint"` scope, тому `n-cursor lint --full` не запускав ruff/mypy. `bun run lint-python` існував як окрема обгортка. При цьому лінтер-логіка вже була у `npm/rules/python/lint/lint.mjs`, але не був адаптований до інтерфейсу `js/lint.mjs`, що очікує оркестратор.

## Considered Options
* Варіант A: додати `"lint": "full"` у `meta.json` + адаптер `python/js/lint.mjs`, що делегує до `python/lint/lint.mjs`.
* Варіант B: лишити python окремою підкомандою, не інтегрувати в оркестратор.

## Decision Outcome
Chosen option: "Варіант A", because уніфікація: python стає повноцінним правилом оркестратора — `n-cursor lint --full` покриває й python без окремих обгорток.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor lint --full` тепер покриває всі 9 кроків старого `bun run lint`, включно з python.
* Bad, because якщо `pyproject.toml` у репо відсутній, `lint.mjs` повертає 0 без запуску інструментів (задокументована поведінка `python/lint/lint.mjs:6`). Тобто в поточному монорепо (без `pyproject.toml`) це no-op.

## More Information
Файли: `npm/rules/python/js/lint.mjs` (новий адаптер), `npm/rules/python/meta.json` (додано `"lint": "full"`), `npm/rules/python/lint/lint.mjs` (додано параметр `readOnly`), `npm/rules/python/js/docs/lint.md` (crc: `a0d17a44`), `npm/rules/python/js/docs/index.md` (оновлено таблицю). Параметр `readOnly` пробрасується у `ruff check`/`ruff format`/`mypy` як `--no-fix`/відмова від форматування — щоб CI не мутував файли.

---

## ADR Інтеграція oxfmt у fix-фазу `orchestrate.mjs`

## Context and Problem Statement
`oxfmt .` форматував JS/конфіги через окремий package.json-скрипт (`"oxfmt": "oxfmt ."`) і був завершальним кроком umbrella `"lint"`. У `n-cursor lint` oxfmt не викликався. У репо існувала чернетка ADR «Відокремлення oxfmt від lint-ланцюжка» зі статусом Accepted, яка рекомендувала лишити oxfmt окремим.

## Considered Options
* Інтегрувати oxfmt в `orchestrate.mjs` як fix-крок (always, якщо не `--read-only`).
* Лишити oxfmt окремим скриптом (позиція попереднього ADR: «лінтер не повинен мутувати»).

## Decision Outcome
Chosen option: "Інтегрувати oxfmt в orchestrate.mjs", because фіксувалося, що `n-cursor lint` у fix-режимі вже мутує (eslint --fix, stylelint --fix, ruff --fix, markdownlint --fix) — аргумент «лінтер не мутує» не консистентний з реальністю; oxfmt вписується в ту саму семантику. Попередній ADR «Відокремлення oxfmt» видалено як суперечливий.

### Consequences
* Good, because `n-cursor lint --full` (без `--read-only`) тепер форматує увесь репо разом з усіма fix-кроками — одна команда без залишків.
* Bad, because transcript не містить підтверджених негативних наслідків; oxfmt не викликається у `--read-only` і у scoped-режимі (лише `--full` без флагу).

## More Information
Реалізовано у `npm/rules/lint/js/orchestrate.mjs`: нова функція `runOxfmt` (викликає `oxfmt .` через `spawnSync`), викликається одразу після per-file фази у `runLint`, гард `if (!readOnly)`. Видалено файл `docs/adr/відокремлення-oxfmt-від-lint-ланцюжка.md`. Документацію `orchestrate.md` регенеровано через `fix-doc-files` (crc: `b0c7a4c2`).

---

## ADR Інвокація `n-cursor` у CI через прямий bin-шлях

## Context and Problem Statement
`bunx @nitra/cursor lint-ga` та `npx @nitra/cursor lint-ga` для скоупованого пакета з одним bin мовчки повертають 0 без виконання (задокументовано у `n-ga.mdc:282`). CI-кроки тому ходили через `bun run lint-ga` (package.json-обгортку), що надійно резолвить локальний bin. Задача — мігрувати CI на `n-cursor` команди безпосередньо, щоб прибрати обгортки.

## Considered Options
* B1: лишити `bun run lint-ga` (тонка обгортка, статус-кво).
* B2: `bun ./node_modules/.bin/n-cursor lint <rule> --read-only` — прямий шлях до bin, обходить silent-0 баг.
* B3: `bunx --bun n-cursor lint <rule> --read-only` — за bin-ім'ям (не перевірено у transcript).

## Decision Outcome
Chosen option: "B2 — прямий bin-шлях", because обходить npx/bunx silent-0 баг і не потребує package.json-обгортки; `node_modules/.bin/n-cursor` доступний у consumer-репо з published-пакета так само як і тут.

### Consequences
* Good, because transcript фіксує очікувану користь: відкриває шлях до видалення всіх `lint-*` обгорток у `package.json`.
* Bad, because потребує переписування workflow-Rego-політик (`lint_ga.rego:104` вимагає саме `run: bun run lint-ga`, аналогічно для text/js/style) та їх шаблонів і `.mdc`-правил — обсяг не реалізовано в цій сесії (заплановано як наступний крок).

## More Information
Конкретний патерн B2: `bun ./node_modules/.bin/n-cursor lint ga --read-only`. На момент закінчення transcript CI-міграція не реалізована — зафіксовано як наступний крок після реалізації розширення `orchestrate.mjs`. Політики, що потребують оновлення: `npm/rules/ga/policy/…lint_ga.rego`, `npm/rules/js-lint/policy/package_json/package_json.rego`, `npm/rules/style-lint/policy/…`, `npm/rules/bun/policy/package_json/package_json.rego` (вимога агрегатного `lint`-скрипту з `&& oxfmt .`).
