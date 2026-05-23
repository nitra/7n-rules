---
session: bcdba371-cfb8-46ab-a284-8869588499a7
captured: 2026-05-23T11:55:42+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bcdba371-cfb8-46ab-a284-8869588499a7.jsonl
---

## ADR Перенесення single-rule сканерів з `npm/scripts/utils/` у `npm/rules/<rule>/fix/<sub>/`

## Context and Problem Statement

`npm/scripts/utils/` накопичив файли двох типів: справді shared утиліти (multi-rule) і AST-сканери/canonical-конфіги, що мають єдиного консьюмера — конкретне правило в `npm/rules/<rule>/fix/<sub>/`. Зокрема, `knip-canonical.json` та родина `oxlint-canonical.*` посилалися на них із `check.mjs` через чотири рівні `../../../../scripts/utils/`, що суперечить конвенції «templeyt/канон живе поряд із check'ом».

## Considered Options

* Залишити всі canonical/scanner-файли в `npm/scripts/utils/` (обґрунтування попереднього ADR 20260523-112217: «директорія `templates/` не існує; файли — спільний ресурс»)
* Перемістити single-rule файли в `npm/rules/<rule>/fix/<sub>/`; cross-rule залежність вирішити через direct import із правила-власника; справді shared (multi-rule) залишити в `scripts/utils/`

## Decision Outcome

Chosen option: "Перемістити single-rule файли в `npm/rules/<rule>/fix/<sub>/`", because аналіз споживачів показав, що кожен з переміщуваних файлів має рівно одного консьюмера серед check'ів правил, тобто аргумент «shared resource» не виправдовується; посилання через `../../../../scripts/utils/` порушує принцип коло-замкненості правила.

Переміщено 15 файлів (+ їхні `*.test.mjs`):

| Файл | Куди |
|---|---|
| `knip-canonical.json`, `oxlint-canonical.json`, `oxlint-canonical-skeleton.json`, `oxlint-rules.tsv`, `rebuild-oxlint-canonical.mjs` | `rules/js-lint/fix/tooling/` |
| `bunyan-imports.mjs`, `check-env-scan.mjs`, `conn-file-rules.mjs`, `conn-imports-scan.mjs`, `promise-settimeout-scan.mjs` | `rules/js-run/fix/runtime/` |
| `docker-hadolint.mjs`, `docker-mirror.mjs` | `rules/docker/fix/lint/` |
| `bun-sql-scan.mjs` | `rules/js-bun-db/fix/safety/` |
| `mssql-pool-scan.mjs` | `rules/js-mssql/fix/deps/` |
| `package-manifest.mjs` | `rules/changelog/fix/consistency/` |
| `vue-forbidden-imports.mjs` | `rules/vue/fix/packages/` |
| `graphql-gql-scan.mjs` | `rules/graphql/fix/tooling/` |

Cross-rule залежність: `graphql-gql-scan.mjs` імпортує `contentForVueImportScan` з `../../../vue/fix/packages/vue-forbidden-imports.mjs`. У `scripts/utils/` залишено лише multi-rule shared утиліти: `ast-scan-utils.mjs`, `check-reporter.mjs`, `workspaces.mjs`, `test-helpers.mjs`, та інфра-скрипти (`with-lock.mjs`, `worktree-fingerprint.mjs`, `gha-workflow.mjs` тощо). Файли `discover-check-rules-from-cursor.mjs`, `generated-markdown.mjs`, `inline-template-links.mjs` початково класифіковано як мертвий код і видалено, але відновлено після виявлення активних імпортів у `npm/bin/n-cursor.js`.

### Consequences

* Good, because transcript фіксує очікувану користь: `check.mjs` кожного правила тепер посилається на сусідні файли (`./bun-sql-scan.mjs`, `./docker-mirror.mjs` тощо) замість `../../../../scripts/utils/…`; структура `npm/rules/<rule>/fix/<sub>/` є самодостатньою.
* Bad, because `graphql-gql-scan.mjs` тепер містить cross-rule import із `../../../vue/fix/packages/vue-forbidden-imports.mjs` — правило graphql залежить від vue; transcript не містить підтверджених негативних наслідків від цього вибору.

## More Information

- Файли: `npm/rules/js-lint/fix/tooling/`, `npm/rules/js-run/fix/runtime/`, `npm/rules/docker/fix/lint/`, `npm/rules/js-bun-db/fix/safety/`, `npm/rules/js-mssql/fix/deps/`, `npm/rules/changelog/fix/consistency/`, `npm/rules/vue/fix/packages/`, `npm/rules/graphql/fix/tooling/`
- Посилання в `.mdc` оновлено: `npm/rules/js-lint/js-lint.mdc`, `npm/rules/docker/docker.mdc`, `npm/rules/vue/vue.mdc`, `.cursor/rules/n-js-lint.mdc`, `.cursor/rules/n-vue.mdc`
- `npm/scripts/auto-rules.mjs` оновлено: `textHasBunSqlImport` — з `../rules/js-bun-db/fix/safety/bun-sql-scan.mjs`; graphql/vue імпорти — на нові шляхи
- Supersedes: `docs/adr/20260523-112217-розміщення-canonical-конфігів-у-npm-scripts-utils.md`
- Версія пакета: `1.13.78` → `1.13.79`; запис у `npm/CHANGELOG.md`
