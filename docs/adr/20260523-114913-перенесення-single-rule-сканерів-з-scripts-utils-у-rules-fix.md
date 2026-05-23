---
captured: 2026-05-23T11:49:13+03:00
supersedes: 20260523-112217-розміщення-canonical-конфігів-у-npm-scripts-utils.md
---

## ADR Перенесення single-rule сканерів і canonical-конфігів з `npm/scripts/utils/` у `npm/rules/<rule>/fix/...`

## Context and Problem Statement
У `npm/scripts/utils/` накопичилися ~40 файлів, серед яких частина — справжні shared-утиліти (`ast-scan-utils.mjs`, `check-reporter.mjs`, `walkDir.mjs`, `load-cursor-config.mjs`, `run-conftest-batch.mjs`, `template.mjs`, `test-helpers.mjs`, `workspaces.mjs` тощо), а частина — модулі з єдиним консьюмером у конкретному правилі (canonical-конфіги js-lint, AST-сканери js-run/js-bun-db/js-mssql/docker/vue/graphql/changelog). Конвенція проєкту, реалізована для правил `ga` (`rules/ga/fix/workflows/`), `nginx-default-tpl` (`rules/nginx-default-tpl/fix/template/`) та інших, — тримати темплейти, фікстури і допоміжні модулі правила безпосередньо в його теці. Попередній ADR `20260523-112217-розміщення-canonical-конфігів-у-npm-scripts-utils.md` визнав canonical-файли «спільним ресурсом» і залишив їх у `scripts/utils/`. Подальше read-only сканування показало, що в реальності consumers у єдиного правила; назва «shared resource» була неточною.

## Considered Options
* Залишити поточне розміщення (`npm/scripts/utils/` як збірний майданчик для всього, включно з canonical-файлами js-lint і AST-сканерами окремих правил) — рішення попереднього ADR `20260523-112217-...`.
* Перенести single-rule файли під відповідні `rules/<rule>/fix/<sub>/` поряд із їх check'ом; лишити в `scripts/utils/` лише справжні shared-утиліти. **Прийнятий варіант.**
* Для cross-rule залежності `graphql-gql-scan` ↔ `vue-forbidden-imports`: (а) дозволити cross-rule import `../../../vue/fix/packages/vue-forbidden-imports.mjs`, (б) виділити спільний ast-helper у `scripts/utils/`, (в) **дублювати** мінімальний набір функцій (extract `<script>`, source-file regex, skip-list) у graphql і зробити правила самодостатніми. **Прийнято варіант (в) — дублювання.**

## Decision Outcome
Chosen option: "Перенести single-rule файли під `rules/<rule>/fix/<sub>/` поряд із check.mjs їхнього правила", because (1) поточна конвенція репо вже застосована до кількох правил (`ga`, `nginx-default-tpl`), і канонічна сім'я js-lint порушує її без обґрунтування, (2) кожен переміщений файл має рівно одного rule-консьюмера (плюс — для трьох — `scripts/auto-rules.mjs`, що оновлено окремо), (3) шляхи у check.mjs скорочуються з 4-річневих `..` до прямих relative-імпортів у тій самій директорії.

Переміщено `git mv`'ом (з історією):

- **js-lint** (`rules/js-lint/fix/tooling/`): `knip-canonical.json`, `oxlint-canonical.json`, `oxlint-canonical-skeleton.json`, `oxlint-rules.tsv`, `rebuild-oxlint-canonical.mjs`.
- **js-run** (`rules/js-run/fix/runtime/`): `bunyan-imports.mjs`(+test), `check-env-scan.mjs`, `conn-file-rules.mjs`(+test), `conn-imports-scan.mjs`(+test), `promise-settimeout-scan.mjs`(+test).
- **docker** (`rules/docker/fix/lint/`): `docker-hadolint.mjs`(+test), `docker-mirror.mjs`.
- **js-bun-db** (`rules/js-bun-db/fix/safety/`): `bun-sql-scan.mjs`.
- **js-mssql** (`rules/js-mssql/fix/deps/`): `mssql-pool-scan.mjs`.
- **changelog** (`rules/changelog/fix/consistency/`): `package-manifest.mjs`(+test).
- **vue** (`rules/vue/fix/packages/`): `vue-forbidden-imports.mjs`(+test).
- **graphql** (`rules/graphql/fix/tooling/`): `graphql-gql-scan.mjs`.

Cross-rule імпорту немає: у `rules/graphql/fix/tooling/graphql-gql-scan.mjs` дубльовано три невеликі функції з vue (`extractVueScriptBlocks` + локалізована `contentForGqlScan`, плюс власні реалізації `isGqlScanSourceFile` / `shouldSkipFileForGqlScan` з власною source-regex і skip-list `.d.ts` / `auto-imports.d.ts` / `components.d.ts`). Це свідома **дублікація на користь самодостатності правил** — graphql і vue не діляться кодом і не імпортують один одного.

У `scripts/utils/` лишилися лише shared/multi-rule: `ast-scan-utils.mjs`, `check-mdc-template-refs.mjs`, `check-reporter.mjs`, `discover-check-rules-from-cursor.mjs`, `discover-checkable-rules.mjs`, `find-package-json-paths.mjs`, `generated-markdown.mjs`, `gha-workflow.mjs`, `inline-template-links.mjs`, `load-cursor-config.mjs`, `pass.mjs`, `redis-imports.mjs`, `resolve-cmd.mjs`, `resolve-target-files.mjs`, `run-conftest-batch.mjs`, `run-lint-step.mjs`, `run-rule.mjs`, `template.mjs`, `test-helpers.mjs`, `walkDir.mjs`, `with-lock.mjs`, `workspaces.mjs`, `worktree-fingerprint.mjs`. Усі залишені — справді shared infra (consumers — `scripts/run-rules.mjs`, `bin/n-cursor.js`, multi-rule check'и).

### Consequences
* Good, because конвенція тепер уніфікована: «допоміжний модуль правила живе у `rules/<rule>/fix/<sub>/`», без винятків для js-lint canonical.
* Good, because зникає 4-рівневий `'../../../../scripts/utils/X.mjs'` у check'ах правил для свого ж сканера/канону — імпорт стає `./X.mjs`.
* Good, because `npm/scripts/utils/` тепер містить лише справді спільні утиліти (споживачів 2+), що видно з прямого `grep`.
* Good, because правила залишаються самодостатніми: graphql не імпортує vue, vue не імпортує graphql; ціна — ~25 рядків продубльованого `extractVueScriptBlocks`/`SOURCE_FILE_RE`/skip-list у `graphql-gql-scan.mjs`, що значно менше, ніж винесення спільного модуля з його power-of-two консьюмерами.
* Bad, because при зміні логіки витягування `<script>` з SFC треба оновити дві локації; компенсується тим, що сам HTML-формат `<script>` стабільний десятиліттями.

## More Information
Файли, що підтверджують рішення:
- `npm/rules/js-lint/fix/tooling/{knip,oxlint}-*.json`, `rebuild-oxlint-canonical.mjs` — перенесена сім'я js-lint.
- `npm/rules/js-lint/fix/tooling/check.mjs` — константи `OXLINT_CANONICAL_JSON_PATH` / `KNIP_CANONICAL_JSON_PATH` тепер указують у поточну директорію.
- `npm/scripts/auto-rules.mjs` — оновлені імпорти `bun-sql-scan` / `graphql-gql-scan` / `vue-forbidden-imports` через `../rules/<rule>/fix/<sub>/`.
- `npm/scripts/utils/ast-scan-utils.mjs` — оновлений docstring зі списком нових локацій споживачів.
- Старий ADR `20260523-112217-розміщення-canonical-конфігів-у-npm-scripts-utils.md` помічений `superseded_by` цим документом.
