---
session: bcdba371-cfb8-46ab-a284-8869588499a7
captured: 2026-05-23T16:35:02+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bcdba371-cfb8-46ab-a284-8869588499a7.jsonl
---

Коміт на твій вибір.

---
END OF TRANSCRIPT

## ADR Міграція `*.test.mjs` з sibling-розміщення у піддиректорію `tests/`

## Context and Problem Statement
У пакеті `@nitra/cursor` 76 JS-тестів (`*.test.mjs`) лежали поряд із джерельними файлами (sibling: `dir/check.mjs` + `dir/check.test.mjs`). Для `*_test.rego` ситуація була аналогічна. Відсутність конвенції ускладнювала навігацію та автоматичну перевірку розміщення тестів.

## Considered Options
* Перемістити всі тести (`*.test.mjs` та `*_test.rego`) у `tests/` піддиректорію поряд із файлом
* Перемістити лише `*.test.mjs` у `tests/`; `*_test.rego` залишити поряд із полісі (OPA/Conftest community convention)
* Залишити поточне sibling-розміщення

## Decision Outcome
Chosen option: "Перемістити лише `*.test.mjs` у `tests/`; `*_test.rego` залишити поряд із полісі", because для JS сесія ввела єдину конвенцію «`dir/tests/X.test.mjs`», а для Rego залишено OPA/Conftest dominant pattern (тести поряд із полісі у тому самому каталозі `policy/<concern>/`): `conftest verify -p <dir>` рекурсивний, тому `*_test.rego` поряд із `<name>.rego` є стандартним layout'ом в екосистемі.

### Consequences
* Good, because `npx @nitra/cursor check test` → «Всі 77 файлів `*.test.mjs` у каталозі `tests/`» — правило-канон програмно фіксує конвенцію.
* Good, because `*_test.rego` залишились сумісними з `conftest verify -p` без жодних змін конфігурації (підтверджено 7/7 pass для `style-lint/policy/vscode_settings`).
* Bad, because для Rego виник виняток з JS-конвенції «`tests/` всюди» — це свідоме відхилення заради OPA-ідіоми, зафіксоване у `test.mdc` окремою секцією.

## More Information
- Переміщено 76 `*.test.mjs`: 73 sibling-тести + rename `npm/tests/` → `npm/test/` → `npm/tests/`.
- Назва директорії змінено `test/` → `tests/` (28 директорій).
- Помилкове переміщення 69 `*_test.rego` у `policy/<concern>/tests/` відкочено через `git mv` назад.
- Нове правило: `npm/rules/test/fix/location/check.mjs` + `npm/rules/test/test.mdc` v1.1 + `npm/rules/test/auto.md`.
- `npm/rules/npm-module/fix/package_structure/check.mjs`: carve-out у `classifyPublishedFileAsTest` — ім'я правила `test` у шляху `rules/test/...` не трактується як test-style директорія.
- Версія `@nitra/cursor`: `1.13.80` → `1.13.81` → `1.13.82`; записи у `npm/CHANGELOG.md`.
- `.n-cursor.json`: додано `"test"` до `rules`, додано `"ignore": [".claude/worktrees"]`.

---

## ADR Перенесення single-rule сканерів і canonical-конфігів з `npm/scripts/utils/` у `npm/rules/<rule>/fix/<sub>/`

## Context and Problem Statement
Single-rule сканери (AST-парсери для однієї rule-id) та canonical-конфіги (`knip-canonical.json`, `oxlint-canonical.json` тощо) лежали у спільному `npm/scripts/utils/` поряд із справді shared-утилітами. Це суперечило конвенції `rules/<rule>/fix/<sub>/` і ускладнювало локалізацію правил.

## Considered Options
* Залишити поточне розміщення (`npm/scripts/utils/` як збірний майданчик)
* Перемістити single-rule файли у `rules/<rule>/fix/<sub>/` за конвенцією
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перемістити single-rule файли у `rules/<rule>/fix/<sub>/` за конвенцією", because кожен файл, що обслуговує лише одне правило, повинен жити поряд із ним — це узгоджено з наявною конвенцією `rules/<rule>/fix/<sub>/`, яку вже дотримуються інші правила.

### Consequences
* Good, because `scripts/utils/` тепер містить лише справді shared/multi-rule утиліти (`ast-scan-utils.mjs`, `check-reporter.mjs`, `discover-checkable-rules.mjs` тощо).
* Good, because cross-rule імпорт `graphql-gql-scan` → `vue-forbidden-imports` усунуто: функції `extractVueScriptBlocks`, `contentForGqlScan`, `SOURCE_FILE_RE` продубльовано локально в `rules/graphql/fix/tooling/graphql-gql-scan.mjs` (~25 рядків дублікату); обидва правила стали самодостатніми.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Переміщено `git mv`: `knip-canonical.json`, `oxlint-canonical.json`, `oxlint-canonical-skeleton.json`, `oxlint-rules.tsv`, `rebuild-oxlint-canonical.mjs` → `rules/js-lint/fix/tooling/`; `bun-sql-scan.mjs` → `rules/js-bun-db/fix/tooling/`; `mssql-pool-scan.mjs` → `rules/js-mssql/fix/tooling/`; `package-manifest.mjs` (+test) → `rules/changelog/fix/tooling/`; `vue-forbidden-imports.mjs` (+test) → `rules/vue/fix/packages/`; `graphql-gql-scan.mjs` → `rules/graphql/fix/tooling/`; 5 js-run сканерів → `rules/js-run/fix/runtime/`; docker-сканери → `rules/docker/fix/lint/`.
- Файли `discover-check-rules-from-cursor.mjs`, `generated-markdown.mjs`, `inline-template-links.mjs` НЕ видалено: виявилися активно імпортованими з `npm/bin/n-cursor.js` (рядки 74–85) — відкочено після помилкового видалення.
- `npm/scripts/auto-rules.mjs`: оновлено 3 шляхи імпортів після переміщення.
- Версія `@nitra/cursor`: `1.13.78` → `1.13.79`; запис у `npm/CHANGELOG.md`.
- ADR `20260523-112217-розміщення-canonical-конфігів-у-npm-scripts-utils.md` помічено `superseded_by`.
