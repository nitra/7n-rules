---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T08:33:34+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

Напишу ADR-и безпосередньо на основі аналізу transcript.

---

## ADR Інтеграція python-правила в n-cursor lint через адаптер js/lint.mjs

## Context and Problem Statement
Правило `python` мало lint-логіку в `npm/rules/python/lint/lint.mjs`, але оркестратор `n-cursor lint` шукає `js/lint.mjs` і `meta.json` з полем `lint`. Через відсутність цих файлів python-лінт не запускався через `n-cursor lint --full`, хоча виконувався окремим скриптом `bun run lint-python`.

## Considered Options
* Варіант A: додати `"lint": "full"` у `python/meta.json` + створити адаптер `js/lint.mjs`, що делегує в наявний `lint/lint.mjs`.
* Варіант B: лишити python окремою підкомандою, не інтегрувати в оркестратор.

## Decision Outcome
Chosen option: "Варіант A", because адаптер дозволяє оркестратору підхопити python без переписування самої lint-логіки, і python-крок автоматично потрапляє в `n-cursor lint --full`.

### Consequences
* Good, because transcript фіксує очікувану користь: python-лінт виконується через єдину точку входу без дублювання логіки.
* Bad, because якщо `pyproject.toml` відсутній (як у цьому репо), крок — no-op; glob-gate у `meta.json` (`auto.glob: pyproject.toml`) пропускає його, що є очікуваною поведінкою, зафіксованою в коді.

## More Information
Змінені файли: `npm/rules/python/js/lint.mjs` (новий адаптер), `npm/rules/python/meta.json` (`"lint": "full"` додано або вже існувало паралельним агентом), `npm/rules/python/lint/lint.mjs` (доданий параметр `readOnly`). Адаптер використовує той самий патерн, що і `npm/rules/security/js/lint.mjs` (ignored `_files`, делегат у `runLintPython`). Документ-файл `npm/rules/python/js/docs/lint.md` створено з детермінованим CRC через `node:zlib crc32`.

---

## ADR Інтеграція oxfmt у n-cursor lint (fix-режим, без --read-only)

## Context and Problem Statement
`oxfmt .` запускався лише як окремий скрипт `"oxfmt": "oxfmt ."` у кореневому `package.json` і як суфікс umbrella-ланцюга `bun run lint`. В `n-cursor lint` він не викликався. Існувала ADR-чернетка «відокремлення-oxfmt-від-lint-ланцюжка» з аргументом «лінтер не має мутувати файли». Паралельно, `n-cursor lint` у fix-режимі вже мутував файли через `eslint --fix`, `stylelint --fix`, `ruff --fix`, `markdownlint --fix`.

## Considered Options
* Інтегрувати oxfmt в оркестратор `orchestrate.mjs` як whole-tree крок у fix-режимі (не `--read-only`).
* Лишити oxfmt окремим скриптом (відповідно до існуючої ADR-чернетки).

## Decision Outcome
Chosen option: "Інтегрувати oxfmt в оркестратор", because аргумент «лінтер не мутує» суперечив наявній поведінці (eslint --fix, ruff --fix вже мутують), і інтеграція дає єдину точку запуску. Існуюча ADR-чернетка «відокремлення-oxfmt» була видалена.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor lint` стає повною заміною `bun run lint` для fix-режиму без окремого oxfmt-кроку.
* Bad, because oxfmt не запускається в scoped-режимі (`n-cursor lint <rule>`) — тільки в `--full` і delta-прогонах; transcript це фіксує як свідоме обмеження.

## More Information
Реалізовано в `npm/rules/lint/js/orchestrate.mjs` — новий блок `runOxfmt()` перед per-file і full фазами, умова `!readOnly`. Старий ADR-файл `docs/adr/відокремлення-oxfmt-від-lint-ланцюжка.md` видалено.

---

## ADR Розширення семантики scoped lint \<rule\> — лінтер і конформність

## Context and Problem Statement
Команда `n-cursor lint <rule>` виконувала **лише конформність** (Rego-перевірку) вказаного правила. Натомість standalone-підкоманди `n-cursor lint-ga`, `lint-text` тощо виконували **тільки лінтер** (`js/lint.mjs`: actionlint, zizmor, cspell тощо) без конформності. Для замінюваності обгорток `bun run lint-*` через `n-cursor lint <rule>` потрібен повний еквівалент.

## Considered Options
* Змінити `n-cursor lint <rule>` на повний прогін: лінтер (`js/lint.mjs`) + конформність.
* Залишити conformance-only, додати окремий режим `--linter-only`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Повний прогін — лінтер + конформність", because це робить `n-cursor lint <rule>` функціонально еквівалентом `bun run lint-<rule>` і дозволяє повністю замінити обгортки.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor lint ga` ≡ `bun run lint-ga`; `hk.pkl` використовує `lint changelog` (правило без `js/lint.mjs`) — зворотна сумісність збережена через guard `existsSync(js/lint.mjs)`.
* Bad, because правило з `fix.mjs::check()` у лінтер-фазі (як `ga`) тепер може виконувати `check()` двічі: у лінтерній і конформнісній фазах. Transcript фіксує це як успадковану поведінку `--full`, яка передує даній зміні.

## More Information
Реалізовано через нову функцію `runScopedRules(rules, ctx)` в `npm/rules/lint/js/orchestrate.mjs`. Guard: `rulesDir === undefined` пропускає конформність (аналогічно full-шляху — для юніт-тестів). Тест доданий у `npm/rules/lint/js/tests/orchestrate.test.mjs` (probe-правило з і без `js/lint.mjs`). Усього 5/5 тестів зелені після зміни.

---

## ADR CI-воркфлоу: перехід на bare n-cursor lint \<rule\> --read-only з повним прогоном (лінтер + конформність)

## Context and Problem Statement
CI-воркфлоу (`lint-ga.yml`, `lint-text.yml`, `lint-js.yml`, `lint-style.yml`) викликали або `bun run lint-<rule>` (package.json-обгортку), або пряму бінарну команду (`bunx oxlint`, `npx stylelint`). Задокументований footgun: `npx @nitra/cursor lint-ga` для скоупованого пакета з одним bin мовчки повертає 0 без виконання (`n-ga.mdc:282`). `bun run lint-<rule>` надійно резолвить локальний bin, але прив'язує CI до наявності обгортки в `package.json`.

## Considered Options
* B1: лишити `bun run lint-<rule>` (status quo).
* B2: `bun ./node_modules/.bin/n-cursor lint <rule> --read-only` (прямий bin-шлях).
* Bare `n-cursor lint <rule> --read-only` (bin-ім'я без явного шляху) — обрано для стандартизації, відповідає наявному прецеденту в `text`-каноні.
* Варіант 2-full (конформність у CI): scoped CI-виклик запускає лінтер + конформність (не лише лінтер).
* Варіант 2-linter: CI запускає лише лінтер-фазу.

## Decision Outcome
Chosen option: "bare `n-cursor lint <rule> --read-only` + варіант 2-full", because bare bin-ім'я обходить npx-silent-0 і відповідає наявному прецеденту в `text`-каноні; варіант 2-full дає максимальне покриття (package.json/config drift виявляється в CI).

### Consequences
* Good, because transcript фіксує очікувану користь: CI-воркфлоу більше не залежать від package.json-обгорток; conformance drift виявляється при кожному CI-запуску.
* Good, because `conftest` авто-встановлюється через `ensureTool('conftest')` — окремі install-кроки не додавались у 3 воркфлоу.
* Bad, because `lint text` — нова subcommand-форма через orchestrate, а не `lint-text` standalone. Регресія в `npm/rules/ga/js/tests/workflows.test.mjs` (фікстура з `bun run lint-ga`) виявлена і потребує виправлення у наступному коміті.

## More Information
Змінені файли: `.github/workflows/lint-ga.yml`, `lint-text.yml`, `lint-js.yml`, `lint-style.yml`; Rego-політики `npm/rules/ga/policy/lint_ga/lint_ga.rego` (хардкод-gate), template-snippets і `_test.rego` для всіх 4 правил; workflow-приклади в `.cursor/rules/n-ga.mdc`, `n-js-lint.mdc`, `n-style-lint.mdc`, `n-text.mdc`. Conftest: 22/22 тести зелені після змін. Нові CI-команди: `n-cursor lint ga --read-only`, `n-cursor lint text --read-only`, `n-cursor lint js-lint js-lint-ci --read-only`, `n-cursor lint style-lint --read-only`.

---

## ADR Видалення umbrella "lint" з package.json та повна чистка lint-обгорток

## Context and Problem Statement
Кореневий `package.json` містив 9-крокову umbrella-команду `"lint"` і окремі обгортки `lint-js`, `lint-ga`, `lint-text`, `lint-style`, `lint-security`, `lint-doc-files`, `lint-python`, `lint-rego`, `oxfmt`. Після уніфікації оркестрації ці обгортки стали дублюванням логіки `n-cursor lint --full`. Конформність `bun.package_json.rego` (рядки 48–67) примусово вимагала саме цей umbrella-патерн (агрегат, що викликає кожен `lint-*` через `bun run` і завершується `&& oxfmt .`). Package_json-політики правил `ga`, `js-lint`, `style-lint` вимагали наявності відповідних скриптів.

## Considered Options
* Варіант A: прибрати `"lint"` повністю, єдина точка — `n-cursor lint --full`.
* Варіант B: лишити тонкий аліас `"lint": "n-cursor lint --full"`.
* Мінімальна чистка: лишити 3 mandated-обгортки (`lint-js/style/ga`), прибрати решту.
* Повна чистка: прибрати ВСІ обгортки (потребує переписування 4 package_json-політик та mdc).

## Decision Outcome
Chosen option: "Варіант A + Повна чистка", because `bun run lint` має зникнути зовсім, а не делегувати; всі обгортки — дублювання, після повної міграції CI на `n-cursor` вони стають зайвими.

### Consequences
* Good, because transcript фіксує очікувану користь: `package.json` scripts зводяться до `start, test, coverage`; конформність bun-агрегату спрощується.
* Bad, because потребує переписування `bun.package_json.rego` + тести + `n-bun.mdc`, а також package_json-політик для `ga`, `js-lint`, `style-lint` + їх тести/template/mdc. Transcript фіксує, що ця робота **не була реалізована** в сесії — заплановано як Крок 3 після стабілізації Кроків 1–2.

## More Information
На момент закінчення сесії HEAD `package.json` знаходився у неконсистентному стані (попередній паралельний агент закомітив проміжний результат: `lint="bun run lint-security"`, відсутній `lint-style`). Rego-файли, що потребують зміни в Кроці 3: `npm/rules/bun/policy/package_json/package_json.rego` (рядки 48–67 — aggregate lint deny), `npm/rules/ga/policy/package_json/package_json.rego`, `npm/rules/js-lint/policy/package_json/package_json.rego`, `npm/rules/style-lint/policy/package_json/package_json.rego`. Поточний коміт сесії: `9ba26f57` на гілці `lint-orchestrate-unification`.
