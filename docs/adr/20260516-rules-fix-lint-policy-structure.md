---
captured: 2026-05-16T00:00:00+03:00
---

## ADR: Структура директорій правила — `fix/`, `lint/`, `policy/`

**Контекст:** Директорія `rules/<id>/js/` змішувала два принципово різних типи JS-коду — check-модулі (живлять `npx @nitra/cursor check`) і lint-оркестратори (живлять `bun run lint-X`). Разом із цим rego-правила у `policy/` логічно використовуються тим самим `check`-каналом, що й JS-check-модулі, але написані іншою технологією. Потрібен принцип, що дозволяє однозначно визначити розташування нового файла.

**Рішення/Процедура/Факт:** **Технологія реалізації визначає директорію.** Структура одного правила:

```
npm/rules/<id>/
├── <id>.mdc               ← документація правила
├── fix/                   ← JS-код, що живить npx @nitra/cursor check
│   └── <concern>/
│       ├── check.mjs
│       ├── check.test.mjs
│       └── fixtures/
├── lint/                  ← JS-код, що живить bun run lint-<id> (CLI entry)
│   ├── lint.mjs
│   └── lint.test.mjs
└── policy/                ← Rego, що живить npx @nitra/cursor check
    └── <concern>/
        ├── <concern>.rego
        ├── <concern>_test.rego
        └── target.json
```

Міграція проведена у 3 фази (версії 1.11.9 → 1.11.12):
- Фаза 1 — dual-mode інфраструктура у `discover-checkable-rules.mjs` і `run-rule.mjs` (підтримка і `js/`, і `fix/` паралельно).
- Фаза 2 — 26 правил переїхали `git mv js/<concern> fix/<concern>` + 6 правил отримали `lint/lint.mjs`. Окремий коміт на кожне правило.
- Фаза 3 — прибрано legacy `js/`-сканування з інфраструктури; `discoverCheckableRules` і `runRule` тепер `fix/`-only.

Видалено `npm/scripts/lint-conftest.mjs` (1.11.11): скрипт дублював `npx @nitra/cursor check` для policy-концернів, але з окремим TARGETS-списком. Єдиний канал — `check`, `bun run lint-conftest` прибрано з `lint`-ланцюжка.

**Обґрунтування:** `fix/` і `policy/` обидва живлять `n-cursor check`, але runner-и різні (dynamic `import()` vs `runConftestBatch`), namespacing різний (camelCase JSDoc vs snake_case rego), і `target.json` — rego-специфічний артефакт. Плоска структура `fix/<concern>/<name>.rego` поруч із `fix/<concern>/check.mjs` змішувала б ці два світи. Тому `policy/` лишається сиблінгом `fix/` і `lint/`, а не вкладеним у `fix/`. Принцип «технологія → директорія» дає однозначну відповідь на питання «куди класти?» без знання семантики `check`-каналу.

**Розглянуті альтернативи:**
- `fix/policy/<concern>/` (policy під парасолею fix) — відхилено: rego-ecosystem не змішувати з JS-ecosystem, різні runner-и.
- `fix/<concern>/<name>.rego` плоско (policy розчиняється у fix) — відхилено: ризик колізій імен, порушення когезії rego-блоку.
- Big-bang міграція одним PR — відхилено: 3-фазовий підхід безпечніший (тести зелені на кожному кроці).

**Зачіпає:** `npm/scripts/utils/discover-checkable-rules.mjs`, `npm/scripts/utils/run-rule.mjs`, `npm/bin/n-cursor.js`, `knip.json`, `npm/README.md`, `.cursor/rules/scripts.mdc`, `.cursor/rules/conftest.mdc`, усі `npm/rules/*/js/` (видалені), `npm/scripts/lint-conftest.mjs` (видалено).
