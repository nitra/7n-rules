---
session: bcdba371-cfb8-46ab-a284-8869588499a7
captured: 2026-05-23T15:01:21+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bcdba371-cfb8-46ab-a284-8869588499a7.jsonl
---

## ADR Перенесення single-rule сканерів і canonical-конфігів з `npm/scripts/utils/` у `npm/rules/<rule>/fix/<sub>/`

## Context and Problem Statement
У репо існувала конвенція — кожне правило тримає свої `check`/`template`/`policy`-файли у `npm/rules/<rule>/fix/<sub>/`. Проте 18 файлів (AST-сканери, canonical-конфіги) осіли в `npm/scripts/utils/` і мали єдиного консьюмера всередині конкретного правила. Це суперечило конвенції та призводило до громіздких відносних шляхів (`../../../../scripts/utils/…`).

## Considered Options
* Залишити поточне розміщення (`npm/scripts/utils/` як збірний майданчик для canonical-файлів)
* Перенести single-rule файли у директорію відповідного правила, залишити shared/multi-rule в `scripts/utils/`

## Decision Outcome
Chosen option: "Перенести single-rule файли у директорію відповідного правила", because кожен з 18 файлів мав **рівно одного** консьюмера всередині одного правила — аргумент «shared resource» для `knip-canonical.json` та сім'ї oxlint виявився слабким. Цей ADR замінює `20260523-112217-розміщення-canonical-конфігів-у-npm-scripts-utils.md`.

### Consequences
* Good, because відносні шляхи в `check.mjs`/`lint.mjs` стали локальними (`./bun-sql-scan.mjs` замість `../../../../scripts/utils/…`).
* Good, because кожне правило (`js-lint`, `js-run`, `docker`, `js-bun-db`, `js-mssql`, `changelog`, `vue`, `graphql`) стало самодостатнім — файли правила не розкидані між двома директоріями.
* Bad, because `npm/bin/n-cursor.js` імпортує три файли (`discover-check-rules-from-cursor.mjs`, `generated-markdown.mjs`, `inline-template-links.mjs`), які Explore-агент помилково класифікував як мертвий код; їх видалення було відкатано. Ці файли залишились у `scripts/utils/`.

## More Information
Переміщені файли (через `git mv`):
- `npm/scripts/utils/knip-canonical.json`, `oxlint-canonical.json`, `oxlint-canonical-skeleton.json`, `oxlint-rules.tsv`, `rebuild-oxlint-canonical.mjs` → `npm/rules/js-lint/fix/tooling/`
- `bunyan-imports.mjs`, `check-env-scan.mjs`, `conn-file-rules.mjs`, `conn-imports-scan.mjs`, `promise-settimeout-scan.mjs` (+тести) → `npm/rules/js-run/fix/runtime/`
- `docker-hadolint.mjs`, `docker-mirror.mjs` (+тести) → `npm/rules/docker/fix/lint/`
- `bun-sql-scan.mjs` → `npm/rules/js-bun-db/fix/safety/`
- `mssql-pool-scan.mjs` → `npm/rules/js-mssql/fix/deps/`
- `package-manifest.mjs` (+тест) → `npm/rules/changelog/fix/consistency/`
- `vue-forbidden-imports.mjs` (+тест) → `npm/rules/vue/fix/packages/`
- `graphql-gql-scan.mjs` → `npm/rules/graphql/fix/tooling/`

Залишились у `scripts/utils/` (shared/multi-rule або `bin`-споживачі): `ast-scan-utils.mjs`, `check-mdc-template-refs.mjs`, `check-reporter.mjs`, `discover-checkable-rules.mjs`, `discover-check-rules-from-cursor.mjs`, `generated-markdown.mjs`, `inline-template-links.mjs`, та інші infrastructure-утиліти. `auto-rules.mjs` — оновлено шлях до `bun-sql-scan.mjs`.

---

## ADR Дублювання екстрактора SFC замість cross-rule імпорту (graphql → vue)

## Context and Problem Statement
`graphql-gql-scan.mjs` потребує витягати вміст `<script>` / `<script setup>` з `.vue`-файлів (Vue SFC) для пошуку `gql\`…\`` шаблонів. Аналогічна логіка вже реалізована у `vue-forbidden-imports.mjs` (`contentForVueImportScan`, `extractVueScriptBlocks`). Після переміщення обох файлів у власні rule-директорії постало питання: імпортувати з `rules/vue/…` чи дублювати.

## Considered Options
* Cross-rule import: `graphql-gql-scan.mjs` імпортує `contentForVueImportScan` з `../../../vue/fix/packages/vue-forbidden-imports.mjs`
* Дублювати потрібні ~25 рядків локально у `graphql-gql-scan.mjs`

## Decision Outcome
Chosen option: "Дублювати потрібні ~25 рядків локально", because cross-rule import між правилами-сусідами (`graphql` → `vue`) порушує принцип самодостатності правила і створює приховану залежність між двома несполученими правилами.

### Consequences
* Good, because `rules/graphql` і `rules/vue` повністю незалежні — один можна змінити без ризику зламати інший.
* Good, because `bun test rules/graphql rules/vue` → 18 pass / 0 fail, `npx @nitra/cursor check graphql vue` → 2/2 OK після дублювання.
* Bad, because ~25 рядків логіки (SFC-екстрактор) тепер продубльовані у двох файлах. Якщо семантика `.vue`-парсингу зміниться, треба оновити обидва: `vue-forbidden-imports.mjs` і `graphql-gql-scan.mjs`.

## More Information
Дубльований код у `npm/rules/graphql/fix/tooling/graphql-gql-scan.mjs`: функції `extractVueScriptBlocks`, `contentForGqlScan` (аналог `contentForVueImportScan`), константа `SOURCE_FILE_RE`, власні реалізації `isGqlScanSourceFile` і `shouldSkipFileForGqlScan`. Docstring позначає це свідомим дублюванням: «паралельна реалізація; аналог у `vue-forbidden-imports.mjs` — модулі не діляться кодом».
