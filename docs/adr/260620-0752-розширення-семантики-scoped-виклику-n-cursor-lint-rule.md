---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T07:52:51+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

Продукую ADR-записи безпосередньо з аналізу transcript.

---

## ADR Розширення семантики scoped-виклику `n-cursor lint <rule>`

## Context and Problem Statement
До цієї сесії `n-cursor lint <rule>` запускав **лише конформність** (Rego-перевірку через `runConformance`), оминаючи лінтер-фазу (`js/lint.mjs`). Через це правила `lint-ga`, `lint-text`, `lint-style`, `lint-js` неможливо було замінити єдиним scoped-викликом — вони ганяли `actionlint`/`zizmor`/`stylelint`/`oxlint` напряму, повз оркестратор.

## Considered Options
* **Scoped = лінтер + конформність** — `n-cursor lint <rule…>` запускає `js/lint.mjs` + `runConformance` для кожного названого правила.
* **Конформність-only (статус-кво)** — rule-аргументи проходять лише через `runConformance`, лінтер не чіпається.

## Decision Outcome
Chosen option: "Scoped = лінтер + конформність", because це дозволяє замінити окремі `lint-<rule>` subcommands одним уніфікованим викликом через оркестратор, зберігаючи зворотну сумісність: правила без `js/lint.mjs` (наприклад, `changelog`, яке викликає `hk.pkl`) автоматично отримують лише конформність.

### Consequences
* Good, because `n-cursor lint ga` тепер еквівалентний `lint-ga` (actionlint + zizmor + conformance) — єдина точка входу.
* Good, because transcript фіксує очікувану користь: `hk.pkl lint changelog` залишається backward-compatible (changelog не має `js/lint.mjs`).
* Bad, because scoped-виклик тепер завжди запускає конформність, що потребує `conftest` у CI-оточеннях, де він раніше не був потрібний (авто-інсталюється через `ensureTool`).

## More Information
Реалізація: нова функція `runScopedRules()` у `npm/rules/lint/js/orchestrate.mjs`; тести: `npm/rules/lint/js/tests/orchestrate.test.mjs` (5/5 pass). Проби підтвердили семантику: `lint changelog --read-only` → conformance-only; `lint doc-files --read-only` → лінтер CRC + conformance.

---

## ADR Інтеграція `oxfmt` в оркестратор замість окремого скрипту

## Context and Problem Statement
`bun run lint` завершувався `&& oxfmt .`, але `n-cursor lint` не викликав `oxfmt`. Існувало Accepted ADR-рішення «відокремлення-oxfmt-від-lint-ланцюжка» з аргументом: «лінтер не повинен мутувати файли під час перевірки».

## Considered Options
* **Інтегрувати `oxfmt` в `orchestrate.mjs`** (fix-режим, пропускати при `--read-only`).
* **Лишити `oxfmt` окремим скриптом** (`"oxfmt": "oxfmt ."` у `package.json`), конформно до попереднього ADR.

## Decision Outcome
Chosen option: "Інтегрувати `oxfmt` в `orchestrate.mjs`", because `n-cursor lint` у fix-режимі вже мутує файли (`eslint --fix`, `stylelint --fix`, `ruff --fix`, `markdownlint --fix`), тому додавання `oxfmt` є консистентним, а попереднє ADR суперечить фактичній поведінці системи.

### Consequences
* Good, because `oxfmt .` тепер виконується автоматично у кожному `n-cursor lint` без `--read-only`, без окремого ланцюга в `package.json`.
* Good, because transcript фіксує очікувану користь: `oxfmt` не запускається в CI (`--read-only`), тобто CI не мутує файли.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалено: `docs/adr/відокремлення-oxfmt-від-lint-ланцюжка.md`. Зміни: `npm/rules/lint/js/orchestrate.mjs` — нова функція `runOxfmt()`, виклик перед per-file фазою за умови `!readOnly`. `"oxfmt": "oxfmt ."` у `package.json` позначено до видалення на кроці 3.

---

## ADR Канонічна форма CI-виклику `n-cursor lint <rule> --read-only`

## Context and Problem Statement
CI-воркфлоу використовували різнорідні прямі команди: `bun run lint-ga`, `bunx oxlint && bunx eslint .`, `npx stylelint`, `n-cursor lint-text --read-only` (text частково мігровано раніше). Необхідно стандартизувати форму виклику при переході CI на `n-cursor`.

## Considered Options
* **`bun ./node_modules/.bin/n-cursor lint <rule> --read-only`** (B2 — прямий шлях до bin).
* **`bun run lint-<rule>`** (B1 — залишити тонкі обгортки).
* **bare `n-cursor lint <rule> --read-only`** — `n-cursor` з `node_modules/.bin/`, що резолвиться локально.

## Decision Outcome
Chosen option: "bare `n-cursor lint <rule> --read-only`", because прецедент text-канону вже вживав bare `n-cursor`; форма чистіша, обходить `npx`-silent-0 баг (де `npx @nitra/cursor lint-ga` для скоупованого пакета мовчки повертає 0), і не потребує вказування повного шляху.

### Consequences
* Good, because єдина форма замість 4 різних: `bun run`, `bunx`, `npx`, bare-скрипт.
* Good, because transcript фіксує очікувану користь: `n-cursor` резолвиться з `node_modules/.bin/`, де встановлений опублікований пакет у consumer-репо.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено: `.github/workflows/lint-ga.yml`, `lint-text.yml`, `lint-js.yml`, `lint-style.yml`. Синхронізовано: `npm/rules/ga/policy/lint_ga/lint_ga.rego` (gate-підрядок), `npm/rules/ga/policy/lint_ga/template/lint-ga.yml.snippet.yml`, аналогічні template-и і `_test.rego` для `text`, `js-lint`, `style-lint`. Документація: `.cursor/rules/n-ga.mdc`, `n-text.mdc`, `n-js-lint.mdc`, `n-style-lint.mdc`. js-lint: `bunx oxlint && bunx eslint . && bunx jscpd . && bunx knip --no-config-hints` → `n-cursor lint js-lint js-lint-ci --read-only`. Rego-тести: 22 тести, всі pass (conftest verify).

---

## ADR Python-адаптер `js/lint.mjs` для інтеграції в оркестратор

## Context and Problem Statement
`npm/rules/python/meta.json` мав лише `{"auto":{"glob":"pyproject.toml"}}` без `lint`-scope. Оркестратор шукає `<rule>/js/lint.mjs`, а логіка лінтування жила у `python/lint/lint.mjs` — тому `n-cursor lint --full` ніколи не ганяв `ruff`/`mypy`.

## Considered Options
* **Варіант A — інтегрувати**: додати `"lint":"full"` у `meta.json` + адаптер `js/lint.mjs` + підтримка `readOnly` у `lint/lint.mjs`.
* **Варіант B — не чіпати оркестратор**: python-лінт лишається окремою підкомандою/кроком поза оркестратором.

## Decision Outcome
Chosen option: "Варіант A — інтегрувати", because це завершує уніфікацію: всі правила з `lint`-scope ганяються через `orchestrate.mjs`; python-glob-gate (`pyproject.toml` відсутній → exit 0) забезпечує no-op у монорепо без python-проєктів.

### Consequences
* Good, because `n-cursor lint --full` тепер охоплює python без окремого скрипту-обгортки.
* Good, because transcript фіксує очікувану користь: при відсутності `pyproject.toml` lint повертає 0 без запуску інструментів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено: `npm/rules/python/meta.json` (`lint:"full"` додано), `npm/rules/python/js/lint.mjs` (адаптер, що делегує до `runLintPython(readOnly)`), `npm/rules/python/lint/lint.mjs` (`runLintPythonSteps(cwd, readOnly)` — readOnly пропускає `--fix`/`format`), `npm/rules/python/js/docs/lint.md` (CRC `a0d17a44`), `npm/rules/python/js/docs/index.md`. Патерн адаптера: ідентичний `npm/rules/security/js/lint.mjs`.
