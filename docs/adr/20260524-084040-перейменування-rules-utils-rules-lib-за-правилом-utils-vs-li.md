---
session: 5cd80b58-040a-422f-86a5-277586e67b7a
captured: 2026-05-24T08:40:40+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/5cd80b58-040a-422f-86a5-277586e67b7a.jsonl
---

## ADR Перейменування `rules/*/utils/` → `rules/*/lib/` за правилом `utils/` vs `lib/`

## Context and Problem Statement
В репо існувало 10 каталогів `npm/rules/<rule>/utils/`, кожен з яких містив domain-специфічні модулі (k8s-tree, kustomization-patches, docker-hadolint, bunyan-imports тощо). Правило `n-js-lint.mdc` § «Структура спільних модулів» визначає: `utils/` — виключно generic helpers без бізнес-логіки; `lib/` — внутрішні підсистеми, що знають про домен. Усі ці каталоги порушували правило.

## Considered Options
* Перейменувати `utils/` → `lib/` для всіх 10 правил
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перейменувати `utils/` → `lib/` для всіх 10 правил", because всі файли у цих каталогах (`k8s-tree.mjs`, `docker-hadolint.mjs`, `vue-forbidden-imports.mjs` тощо) залежать від домену правил, мають side effects або інтегрують зовнішні бінарі — це `lib/` за визначенням `n-js-lint.mdc`.

### Consequences
* Good, because transcript фіксує очікувану користь: структура репо відповідає канонічному правилу `utils/` vs `lib/`; `git mv` зберігає git-історію файлів.
* Bad, because ~26 внутрішніх імпортів та 3 зовнішніх (`auto-rules.mjs`) потребували механічного оновлення шляхів.

## More Information
Перейменування: `git mv npm/rules/{abie,changelog,docker,graphql,js-bun-db,js-lint,js-mssql,js-run,rust,vue}/utils → lib`. Зовнішні виправлення: `npm/scripts/auto-rules.mjs` (рядки 19, 24–25). Тести всередині `rules/*/js/tests/` виправлено `perl -pi -e 's|/utils/|/lib/|g'`. Правило: `npm/rules/js-lint/js-lint.mdc` §82–97.

---

## ADR Розщеплення `npm/scripts/utils/` на `utils/` (generic) та `lib/` (domain)

## Context and Problem Statement
Каталог `npm/scripts/utils/` містив 28+ файлів змішаного типу: поруч лежали справжні generic helpers (`walkDir`, `with-lock`, `worktree-fingerprint`) та domain-підсистеми (`run-standard-rule`, `load-cursor-config`, `workspaces`, `discover-checkable-rules`), що читають `.n-cursor.json`, оркеструють правила та інтегрують монорепо. Це суперечило тому ж правилу `n-js-lint.mdc`.

## Considered Options
* Розщепити `scripts/utils/`: domain-файли → `scripts/lib/`, generic — залишити у `scripts/utils/`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розщепити `scripts/utils/`", because 19 файлів (оркестратори правил, rule-discovery, MDC/template-обробники, конфіг-рідери) тримають domain-state або читають `.n-cursor.json`/`package.json` монорепо; 9 файлів (`ast-scan-utils`, `find-package-json-paths`, `pass`, `resolve-cmd`, `test-helpers`, `walk-cache`, `walkDir`, `with-lock`, `worktree-fingerprint`) є generic і залишилися у `utils/`.

### Consequences
* Good, because transcript фіксує очікувану користь: `scripts/utils/` тепер містить лише файли, прийнятні для окремого npm-пакету; domain-логіка зосереджена у `scripts/lib/`.
* Bad, because ~220 імпортів `scripts/utils/<lib-file>` по всьому `npm/` потребували глобальної заміни через `grep -rl | xargs perl -pi`.

## More Information
Переміщено до `npm/scripts/lib/`: `check-mdc-template-refs.mjs`, `check-reporter.mjs`, `discover-check-rules-from-cursor.mjs`, `discover-checkable-rules.mjs`, `generated-markdown.mjs`, `gha-workflow.mjs`, `inline-template-links.mjs`, `list-rule-ids.mjs`, `load-cursor-config.mjs`, `read-n-cursor-config-lite.mjs`, `resolve-target-files.mjs`, `run-conftest-batch.mjs`, `run-lint-step.mjs`, `run-rule-cli.mjs`, `run-rule.mjs`, `run-standard-lint.mjs`, `run-standard-rule.mjs`, `template.mjs`, `workspaces.mjs`. Тести і `__fixtures__/` переїхали в `scripts/lib/tests/`. `npm/scripts/rename-yaml-extensions.mjs:17` окремо виправлено вручну.

---

## ADR Переміщення `redis-imports.mjs` з `scripts/utils/` до `rules/js-bun-redis/lib/`

## Context and Problem Statement
`npm/scripts/utils/redis-imports.mjs` — сканер імпортів `ioredis`/`node-redis`, що знає про `js-bun-redis.mdc` і потрібен лише правилу `js-bun-redis`. Знаходитися у `scripts/utils/` йому немає підстав: це domain-модуль конкретного правила.

## Considered Options
* Перемістити до `rules/js-bun-redis/lib/redis-imports.mjs` за аналогією з `bunyan-imports`, `vue-forbidden-imports`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перемістити до `rules/js-bun-redis/lib/`", because transcript явно вказує аналогію: `bunyan-imports.mjs` живе у `rules/js-run/lib/`, `vue-forbidden-imports.mjs` — у `rules/vue/lib/`; принцип co-location з правилом.

### Consequences
* Good, because transcript фіксує очікувану користь: кожне правило містить усі свої domain-модулі поруч; `scripts/utils/` не містить rule-специфічного коду.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
Файл: `npm/rules/js-bun-redis/lib/redis-imports.mjs`. Імпорт `ast-scan-utils`: `'../../../scripts/utils/ast-scan-utils.mjs'` (generic — залишається у `scripts/utils/`). Споживач у правилі: `npm/rules/js-bun-redis/js/imports.mjs:23`. Тест: `npm/rules/js-bun-redis/lib/tests/redis-imports.test.mjs`.

---

## ADR Автоматична перевірка `utils/`-каталогів через концерн `utils_imports.mjs`

## Context and Problem Statement
Після масового рефакторингу нічого не заважало у майбутньому знову додати domain-файли до `utils/`. Потрібна автоматична перевірка, що ловитиме такі порушення при кожному прогоні `npx @nitra/cursor fix js-lint`.

## Considered Options
* Додати js-концерн `utils_imports.mjs` у `npm/rules/js-lint/js/`
* Не додавати (тільки документаційне правило у `.mdc`)

## Decision Outcome
Chosen option: "Додати js-концерн `utils_imports.mjs`", because користувач явно відповів «Так, додати check-концерн» на питання у transcript.

### Consequences
* Good, because transcript фіксує очікувану користь: концерн обходить усі `utils/` каталоги, парсить через `oxc-parser`, падає на будь-якому відносному імпорті з `..` у не-тестовому файлі — порушення виявляється автоматично.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
Файл: `npm/rules/js-lint/js/utils_imports.mjs`. Логіка: `walkDir` по workspace-каталогах → знайти `utils/`-каталоги → для кожного `.mjs`/`.js` не з `tests/` парсити через `oxc-parser`, зібрати static/dynamic imports → перевірити `source.startsWith('..')`. `oxlint` на файлі: `Found 0 warnings and 0 errors`. `.mdc` доповнено абзацом: «Ця вимога перевіряється автоматично концерном `utils_imports` при `fix js-lint`».
