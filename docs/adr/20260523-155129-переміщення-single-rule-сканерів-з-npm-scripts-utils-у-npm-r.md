---
session: bcdba371-cfb8-46ab-a284-8869588499a7
captured: 2026-05-23T15:51:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bcdba371-cfb8-46ab-a284-8869588499a7.jsonl
---

## ADR Переміщення single-rule сканерів з `npm/scripts/utils/` у `npm/rules/<rule>/fix/<sub>/`

## Context and Problem Statement
`npm/scripts/utils/` містив суміш shared-утиліт та scan-модулів, що належать конкретному правилу. Це порушувало вже наявну конвенцію `rules/<rule>/fix/<sub>/`, яку мав `rules/ga/` та `rules/docker/fix/lint/`, і ускладнювало навігацію: не було видно, яке правило «owns» той чи інший файл.

## Considered Options
* Залишити `npm/scripts/utils/` як збірний майданчик для всього.
* Перенести single-rule сканери/конфіги у `rules/<rule>/fix/<sub>/`, лишивши в `utils/` лише справді shared-код (`ast-scan-utils.mjs`, `check-reporter.mjs`, `workspaces.mjs`, `test-helpers.mjs` тощо).

## Decision Outcome
Chosen option: "Перенести у `rules/<rule>/fix/<sub>/`", because кожен сканер або canonical-конфіг обслуговує одне правило — він має лежати поряд із `check.mjs`, а не в загальному збірнику.

### Consequences
* Good, because transcript фіксує очікувану користь: структура стала самодокументованою — шлях `rules/js-bun-db/fix/safety/bun-sql-scan.mjs` одразу вказує власника.
* Bad, because transcript не містить підтверджених негативних наслідків; cross-rule імпорт `graphql→vue` що виник — усунуто окремим рішенням (дублювання).

## More Information
`git mv` зі збереженням history: `bunyan-imports`, `check-env-scan`, `conn-file-rules`, `conn-imports-scan`, `promise-settimeout-scan` → `rules/js-run/fix/runtime/`; `docker-hadolint`, `docker-mirror` → `rules/docker/fix/lint/`; `bun-sql-scan` → `rules/js-bun-db/fix/safety/`; `mssql-pool-scan` → `rules/js-mssql/fix/deps/`; `package-manifest` → `rules/changelog/fix/consistency/`; `vue-forbidden-imports` → `rules/vue/fix/packages/`; `graphql-gql-scan` → `rules/graphql/fix/tooling/`; knip + 4 oxlint-canonical → `rules/js-lint/fix/tooling/`. Споживачі оновлено (зокрема `npm/scripts/auto-rules.mjs`). Версія: `1.13.79`. ADR: `docs/adr/20260523-114913-перенесення-single-rule-сканерів-з-scripts-utils-у-rules-fix.md`.

---

## ADR Дублювання коду замість cross-rule імпорту (graphql ← vue)

## Context and Problem Statement
Після переміщення `graphql-gql-scan.mjs` у `rules/graphql/fix/tooling/` він імпортував `contentForVueImportScan`, `extractVueScriptBlocks`, та `SOURCE_FILE_RE` з `rules/vue/fix/packages/vue-forbidden-imports.mjs`. Виник cross-rule імпорт між двома незалежними правилами.

## Considered Options
* Залишити cross-rule імпорт як є (graphql → vue).
* Дублювати ~25 рядків у `graphql-gql-scan.mjs` локально.

## Decision Outcome
Chosen option: "Дублювати локально", because правила мають бути самодостатніми; cross-rule залежність між `graphql` та `vue` без спільного shared-модуля — порушення симетричної ізоляції.

### Consequences
* Good, because `rules/graphql/` та `rules/vue/` не залежать одне від одного; кожен модуль можна розуміти і тестувати ізольовано — 18 pass / 0 fail після змін.
* Bad, because ~25 рядків (`extractVueScriptBlocks`, `contentForGqlScan`, `SOURCE_FILE_RE`, `isGqlScanSourceFile`) дубльовані; зміна SFC-парсингу потребує ручної синхронізації в двох місцях.

## More Information
Файли: `npm/rules/graphql/fix/tooling/graphql-gql-scan.mjs` (локальні копії функцій), `npm/rules/vue/fix/packages/vue-forbidden-imports.mjs` (незмінений). Docstring graphql-gql-scan: «паралельна реалізація екстрактора; аналог у `rules/vue/fix/packages/vue-forbidden-imports.mjs` — модулі не діляться кодом, щоб уникати cross-rule залежностей». ADR: `docs/adr/20260523-114913-...` (оновлено Consequences).

---

## ADR Розміщення тестів у `test/` піддиректорії поряд із кодом

## Context and Problem Statement
73 test-файли (`*.test.mjs`) лежали sibling-ом поряд із файлами реалізації (наприклад, `check.mjs` + `check.test.mjs` в одній директорії). Це ускладнювало навігацію та не відповідало бажаній конвенції «тест — в окремій підпапці».

## Considered Options
* Перенести всі тести у `test/` піддиректорію (sibling → `<dir>/test/<file>.test.mjs`).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести у `test/` піддиректорію", because конвенція «тест лежить у `test/` поряд із батьківською директорією файлу реалізації» запропонована користувачем як єдина уніфікована норма для всього пакета.

### Consequences
* Good, because transcript фіксує очікувану користь: директорія реалізації не засмічена тестами; `discover-checkable-rules.mjs` фільтрує `*.test.mjs` за суфіксом, тому нова структура не впливає на discovery.
* Bad, because `npm/package.json` `files`-паттерн `!**/*.test.mjs` залишається валідним — publish не потребував змін. Єдиний негатив: sed-автоматизація помилково змінила fixture-рядки всередині backtick-літералів у `image-avif/fix/avif_generation/test/check.test.mjs` — виправлено вручну (`'../hero.png'` → `'./hero.png'`).

## More Information
Переміщено: 73 sibling-тести → `<dir>/test/`; `npm/tests/` → `npm/test/` (3 integration-тести). `npm/scripts/utils/__fixtures__` → `npm/scripts/utils/test/__fixtures__`. `nginx-default-tpl/fix/template/fixtures/` → `test/fixtures/`. Ручні фіксапи path-глибини: `sync-setup-bun-deps-action.test.mjs` (`.. → ../..`), `inline-template-links.test.mjs` (`SECURITY_RULE_DIR`), `adr/fix/hooks/test/check.test.mjs` (`BUNDLED_HOOKS_DIR` +1 рівень), `abie/utils/test/enabled.test.mjs` (`REPO_ROOT` +1 рівень). Підсумок тестів: 837 pass / 2 fail (pre-existing `with-lock`). Версія: `1.13.80`. ADR: `docs/adr/20260523-154806-розміщення-тестів-у-test-піддиректорії-поряд-із-кодом.md`.
