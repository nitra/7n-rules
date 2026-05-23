---
session: bcdba371-cfb8-46ab-a284-8869588499a7
captured: 2026-05-23T16:31:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bcdba371-cfb8-46ab-a284-8869588499a7.jsonl
---

Готово. Зміни мінімальні:

- **`test.mdc`** (v1.0 → v1.1): прибрано Rego з конвенції, додано явний блок «Виняток — Rego unit-тести (`*_test.rego`): лишаються поряд із полісі (OPA/Conftest community-патерн)».
- **`check.mjs`**: `isTestFile` тепер перевіряє лише `*.test.mjs`; `*_test.rego` ігноруються. Повідомлення pass оновлено відповідно.

`npx @nitra/cursor check test` → 77 `*.test.mjs` OK. 69 `*_test.rego` по-старому лежать поряд із полісі — ніхто їх не чіпав.

---

Виходячи з транскрипту, ось ADR для цієї сесії:

## ADR Розміщення single-rule сканерів у `rules/<rule>/fix/<sub>/` замість `scripts/utils/`

## Context and Problem Statement
У пакеті `@nitra/cursor` single-rule AST-сканери та canonical-конфіги (js-lint, js-run, docker, js-bun-db, js-mssql, changelog, vue, graphql) лежали у `npm/scripts/utils/` — спільному майданчику для всіх утиліт. Це порушувало ізоляцію правил: сканер мав жити поряд із `check.mjs` свого правила, а не у глобальному просторі. Виникла задача перенести ці файли у `rules/<rule>/fix/<sub>/` без розриву консьюмерів.

## Considered Options
* Залишити поточне розміщення (`scripts/utils/` як збірний майданчик для всіх утиліт, включно з single-rule)
* Перемістити single-rule сканери у `rules/<rule>/fix/<sub>/`, оновити всі import-шляхи; cross-rule залежності вирішити дублюванням (а не cross-rule імпортом)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перемістити single-rule сканери у `rules/<rule>/fix/<sub>/` з дублюванням коду замість cross-rule імпортів", because кожен rule-модуль має бути самодостатнім; cross-rule імпорт (graphql → vue) виник як проміжний стан і був усунений дублюванням ~25 рядків у `graphql-gql-scan.mjs`.

### Consequences
* Good, because кожне правило може еволюціонувати незалежно, без ризику зламати інші через зміну shared-утиліти у `scripts/utils/`.
* Bad, because `extractVueScriptBlocks`-логіка дубльована між `vue/fix/packages/vue-forbidden-imports.mjs` і `graphql/fix/tooling/graphql-gql-scan.mjs` — потребує синхронізації при змінах SFC-парсингу.

## More Information
Переміщено (git mv): js-lint canonical (knip + oxlint x4), js-run AST-сканери x5, docker (hadolint + mirror), bun-sql-scan, mssql-pool-scan, package-manifest, vue-forbidden-imports, graphql-gql-scan. Оновлено: `npm/scripts/auto-rules.mjs`, `npm/bin/n-cursor.js` (лише doc-refs). Тест-suite: 837 pass / 2 fail (pre-existing with-lock). `npx @nitra/cursor check` → 11/12 OK (pre-existing with-lock).

---

## ADR Розміщення JS-тестів у `tests/` піддиректорії поряд із кодом

## Context and Problem Statement
73 `*.test.mjs` файли у пакеті лежали **поряд із джерельним файлом** (`dir/check.mjs` + `dir/check.test.mjs` в одному каталозі). Це захаращувало каталоги; не було програмного канону для цієї конвенції. Ціль — запровадити єдиний layout і зафіксувати його правилом.

## Considered Options
* Залишити тести поряд із кодом (поточний стан)
* Перенести `*.test.mjs` у `tests/` піддиректорію поряд із відповідним файлом + правило `npm/rules/test/` як програмний канон

## Decision Outcome
Chosen option: "`tests/` піддиректорія + правило test", because каталог-з-кодом залишається чистим; `package.json#files` recursive globs (`!**/*.test.mjs`) продовжують коректно виключати тести з tarball незалежно від глибини.

### Consequences
* Good, because `npx @nitra/cursor check test` автоматично верифікує конвенцію при кожному запуску.
* Good, because `*_test.rego` (Rego unit-тести) явно виключені з правила — лишаються поряд із полісі відповідно до OPA/Conftest community-патерну.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/test/test.mdc` (v1.1), `npm/rules/test/fix/location/check.mjs`, `npm/rules/test/fix/location/tests/check.test.mjs`. Rename `npm/tests/` → `npm/test/` → `npm/tests/`. `.n-cursor.json`: додано `"test"` у `rules`, `"ignore": [".claude/worktrees"]`. Fix у `npm-module.package_structure`: carve-out для rule-name сегмента щоб `rules/test/...` не давав false positive. Верифікація: `bun test` → 844 pass / 1 fail (pre-existing with-lock); `npx @nitra/cursor check test` → 77/77 OK.
