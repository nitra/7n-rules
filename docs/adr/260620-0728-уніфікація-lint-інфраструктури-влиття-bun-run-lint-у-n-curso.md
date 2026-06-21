---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T07:28:47+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

## ADR Уніфікація lint-інфраструктури: влиття `bun run lint` у `n-cursor lint`

## Context and Problem Statement
У монорепо паралельно існували два механізми лінту: кореневий `bun run lint` (9-крокова послідовність `lint-*` скриптів у `package.json`) і `n-cursor lint` (оркестратор через `npm/rules/lint/js/orchestrate.mjs`). Логіка дублювалась, зростала розбіжність між двома точками входу.

## Considered Options
* Лишити обидва механізми (status quo)
* Влити всю логіку `bun run lint` у `n-cursor lint` і прибрати `bun run lint`

## Decision Outcome
Chosen option: "Влити логіку в `n-cursor lint` і прибрати `bun run lint`", because користувач явно визначив це як ціль сесії («влити bun run lint в n-cursor lint, і сам bun run lint прибрати»). Міграція відбувається в три кроки: (1) розширення orchestrate, (2) переведення CI на `n-cursor lint <rule>`, (3) видалення `package.json`-обгорток.

### Consequences
* Good, because transcript фіксує очікувану користь: одна точка входу для лінту, усунення дублювання логіки між `package.json` і `orchestrate.mjs`.
* Bad, because `lint-ga` і `lint-text` лишаються тимчасово через npx-silent-0 footgun (задокументований у `n-ga.mdc`); CI-воркфлоу мають бути оновлені окремим кроком.

## More Information
Файли: `npm/rules/lint/js/orchestrate.mjs`, `package.json`. Команди: `n-cursor lint --full`, `bun run lint`. Три кроки міграції зафіксовано в transcript явно.

---

## ADR Інтеграція oxfmt у `n-cursor lint` (fix-режим)

## Context and Problem Statement
`oxfmt .` існував як окремий `package.json`-скрипт і виконувався в кінці `bun run lint`. В `n-cursor lint` він був відсутній. Паралельно в репо була ADR-чернетка «Відокремлення oxfmt від lint-ланцюжка» зі статусом Accepted, яка рекомендувала протилежне.

## Considered Options
* Інтегрувати `oxfmt .` у `orchestrate.mjs` як fix-крок (не `--read-only`)
* Лишити `oxfmt` окремим скриптом (позиція видаленої ADR «Відокремлення oxfmt»)

## Decision Outcome
Chosen option: "Інтегрувати у `orchestrate.mjs`", because користувач явно підтвердив: «oxfmt потрібно щоб він викликався в n-cursor lint завжди коли не передано --read-only». ADR «Відокремлення oxfmt від lint-ланцюжка» видалено як таку, що суперечить цьому рішенню. Аргумент про «лінтер не мутує» відхилено — `n-cursor lint` у fix-режимі вже мутує файли (eslint --fix, stylelint --fix, ruff --fix тощо).

### Consequences
* Good, because `oxfmt` тепер частина єдиного lint-прогону, не окремий ручний крок.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/rules/lint/js/orchestrate.mjs`. `oxfmt .` не запускається при `--read-only` (CI/детект-режим). Функція `runOxfmt` додана до оркестратора; `spawnSync` з `oxfmt` та `'.'`.

---

## ADR Розширення scoped-режиму `n-cursor lint <rule>`: лінтер + конформність

## Context and Problem Statement
`n-cursor lint ga` (scoped виклик із rule-аргументом) виконував **тільки конформність** (`runConformance`), але не запускав лінтер-фазу (`js/lint.mjs` правила — actionlint, zizmor тощо). `bun run lint-ga` натомість запускав повний прогін. Потреба: зробити `n-cursor lint <rule>` еквівалентом `lint-<rule>`.

## Considered Options
* Залишити scoped-режим conformance-only (status quo)
* Зробити scoped-режим повноцінним: лінтер (`js/lint.mjs`) + конформність для названих правил

## Decision Outcome
Chosen option: "Повноцінний scoped-режим (лінтер + конформність)", because користувач запропонував аналіз і підтвердив: «робимо, а потім в CI переходимо на n-cursor команди а потім обгортки видаляємо». Це уніфікує ментальну модель і відкриває заміну CI-скриптів.

### Consequences
* Good, because `n-cursor lint ga` ≡ `bun run lint-ga`; `n-cursor lint changelog` (hk-шлях) зберігає зворотну сумісність — `linterIds` порожній, виконується тільки конформність.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Функція `runScopedRules` додана до `npm/rules/lint/js/orchestrate.mjs`. Guard `rulesDir === undefined` збережено для юніт-тестів (аналогічно до `--full`-гілки). Тест доданий у `npm/rules/lint/js/tests/orchestrate.test.mjs` (5/5 зелені). `hk.pkl` використовує `lint changelog` — зворотна сумісність підтверджена smoke-тестом.

---

## ADR Інтеграція Python-лінту в `n-cursor lint` через адаптер `js/lint.mjs`

## Context and Problem Statement
Правило `python` мало `lint/lint.mjs` з логікою запуску ruff/mypy, але оркестратор `n-cursor lint` шукає адаптер за шляхом `<rule>/js/lint.mjs`. Python був відсутній у lint-scope (`meta.json` містив лише `auto.glob`), тож `bun run lint-python` не мав еквіваленту в `n-cursor lint`.

## Considered Options
* Варіант A: Додати `"lint": "full"` у `python/meta.json` і адаптер `python/js/lint.mjs`, що делегує до наявного `lint/lint.mjs`
* Варіант B: Лишити python окремою підкомандою без інтеграції в оркестратор

## Decision Outcome
Chosen option: "Варіант A (адаптер + meta.json)", because користувач явно обрав «а 1 — Python А». Адаптер делегує до `runLintPython`, передає `readOnly` для CI-сумісності. `pyproject.toml` відсутній у цьому репо — крок буде no-op через glob-гейт, але інфраструктура готова для consumer-репо.

### Consequences
* Good, because transcript фіксує очікувану користь: python-лінт тепер частина `n-cursor lint --full` без окремої точки входу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/python/js/lint.mjs` (новий адаптер), `npm/rules/python/meta.json` (додано `"lint": "full"`), `npm/rules/python/lint/lint.mjs` (додано параметр `readOnly`), `npm/rules/python/js/docs/lint.md` (CRC `a0d17a44`). Патерн адаптера: аналогічний `npm/rules/ga/js/lint.mjs` і `npm/rules/security/js/lint.mjs`.
