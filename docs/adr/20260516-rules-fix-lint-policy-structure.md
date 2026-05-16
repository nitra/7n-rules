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

## Update 2026-05-15 — Результати Фази 2: переміщення 26 правил

Фаза 2 завершена. Усі 26 правил перенесено з `rules/<id>/js/` до нового формату:

| Категорія | Правила | Що перенесено |
|---|---|---|
| A — 18 правил | adr, bun, capacitor, changelog, graphql, hasura, image-avif, image-compress, js-bun-db, js-bun-redis, js-lint, js-mssql, js-run, nginx-default-tpl, npm-module, style-lint, tauri, vue | `js/<concern>/` → `fix/<concern>/` |
| B — 7 правил | ga, docker, php, rego, k8s, text, abie | `js/<concern>/` → `fix/<concern>/` та `js/lint.mjs`/`js/run.mjs` → `lint/lint.mjs` |
| ci4 | немає `js/` | нічого не переміщено |

Жодна директорія `js/` у `rules/` більше не існує. Виправлено 6 крос-модульних імпортів: `rules/abie/utils/k8s-tree.mjs`, `rules/ga/lint/lint.mjs`, `rules/docker/fix/lint/discover.test.mjs`, `rules/nginx-default-tpl/fix/template/check.mjs`, `rules/k8s/lint/run-roots.test.mjs`. Оновлено hardcoded шляхи у трьох тест-файлах (`check-empty-trees.test.mjs`, `check-rule-fixtures.test.mjs`, `integration-repo-checks.test.mjs`). Тест-сюїт: 688 тестів — 684 pass, 2 pre-existing fail у `check-js-run`.

## Update 2026-05-15 — Видалення lint-conftest.mjs та оновлення README

`npm/scripts/lint-conftest.mjs` видалено: скрипт дублював `discoverCheckableRules → runConftestBatch`, яку `npx @nitra/cursor check` вже виконує. Всі посилання на `bun run lint-conftest` у `.mdc`, `.rego` і кореневому `package.json` замінені на `npx @nitra/cursor check` або видалені.

`npm/README.md` оновлено: секція «Структура пакету» тепер документує ієрархію `rules/<id>/{fix,lint,policy}/` замість застарілої `mdc/`. Версію `npm/package.json` підвищено до `1.11.11`.
