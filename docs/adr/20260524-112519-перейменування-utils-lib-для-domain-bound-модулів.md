---
session: 5cd80b58-040a-422f-86a5-277586e67b7a
captured: 2026-05-24T11:25:20+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/5cd80b58-040a-422f-86a5-277586e67b7a.jsonl
---

Ось ADR за цією сесією.

---

## ADR Перейменування utils/ → lib/ для domain-bound модулів

## Context and Problem Statement

У монорепо `npm/rules/<rule>/utils/` і `npm/scripts/utils/` зберігалися два різних типи модулів: generic helpers (ті, що можна опублікувати окремим пакетом) і domain-bound модулі (читають конфіг проєкту, оркеструють правила, інтегрують зовнішні сервіси). Правило `js-lint.mdc` вже визначало семантику: `utils/` — generic, `lib/` — domain-bound, але каталоги не відповідали цій семантиці.

## Considered Options

* Перейменувати utils/ → lib/ лише в `rules/`; `scripts/` чіпати окремим PR
* Все одразу: 10 каталогів `rules/*/utils/` + спліт `scripts/utils/` + переміщення `redis-imports.mjs` у відповідне правило

## Decision Outcome

Chosen option: "Все одразу: rules + scripts split", because користувач явно обрав повний скоуп в одному PR.

### Consequences

* Good, because `utils/` тепер містить лише справді generic файли (9 файлів у `scripts/utils/`), а domain-логіка живе в `lib/` — відповідно до задекларованої семантики `js-lint.mdc`.
* Good, because `redis-imports.mjs` переміщено у `npm/rules/js-bun-redis/lib/`, симетрично до `bunyan-imports.mjs` та `vue-forbidden-imports.mjs`.
* Good, because доданий guard-концерн `npm/rules/js-lint/js/utils_imports.mjs` автоматично ловить майбутні порушення (relative `..`-імпорт з `utils/`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- 10 git mv: `npm/rules/{abie,changelog,docker,graphql,js-bun-db,js-lint,js-mssql,js-run,rust,vue}/utils/` → `.../lib/`
- 19 файлів `scripts/utils/` → `scripts/lib/`; 9 файлів залишилися в `utils/`
- ~220 рядків імпортів оновлено через `perl -i -pe`
- Попутно виявлено і виправлено flat-layout regression: `GA_POLICY_DIR` у `npm/rules/ga/js/workflows.mjs` і `BUNDLED_HOOKS_DIR` у `npm/rules/adr/js/hooks.mjs` мали зайвий рівень `..` після попередньої реструктуризації
- Коміти: `0397e19` (refactor), `2ef7d0f` (fix)
- Тести: 964 pass / 0 fail після обох комітів

---

## ADR Автоматична перевірка семантики utils/ через концерн js-lint

## Context and Problem Statement

Правило `js-lint.mdc` визначає семантику `utils/` vs `lib/`, але раніше не було автоматичної перевірки — порушення виявлялися лише під час code review або ручного аудиту.

## Considered Options

* Додати check-концерн у js-lint
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати check-концерн у js-lint", because користувач явно погодився на цей варіант при відповіді на питання про скоуп.

### Consequences

* Good, because transcript фіксує очікувану користь: концерн `utils_imports.mjs` виявляє relative `..`-імпорт з `utils/`-файлів у реальному часі через `bun run n-cursor fix js-lint`.
* Good, because js-lint.mdc доповнено абзацом про автоматичну перевірку поруч з описом семантики `utils/` vs `lib/`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Новий файл: `npm/rules/js-lint/js/utils_imports.mjs`
- Використовує oxc-parser (`parseAsync`) для аналізу static/dynamic imports і `require()`
- Охоплює всі `utils/`-каталоги у workspaces (крім `node_modules`); пропускає `tests/`
- Запускається як частина `bun run n-cursor fix js-lint`
