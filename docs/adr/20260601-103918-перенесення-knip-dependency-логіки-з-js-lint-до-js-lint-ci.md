---
type: ADR
title: ""
---

## ADR Перенесення knip/dependency-логіки з `js-lint` до `js-lint-ci`

## Context and Problem Statement
Правило `js-lint-ci` декларувало у `description`, що knip/jscpd — його зона відповідальності («lише у lint-ci, по всьому репо»), але повний розділ `## knip` (канон `knip-canonical.json`, `ignoreBinaries`/`ignoreDependencies`) і dependency-клаузи (`@e18e/eslint-plugin` окремо не додавай; oxlint/eslint/jscpd/knip не додавай без потреби) дублювалися в `js-lint`. Паралельно, `@nitra/as-integrations-fastify@3.0.2` — чистий republish upstream із застарілим peer `@apollo/server: "^4.0.0"` — генерував `bun i warn` на Apollo 5 і потребував заміни на upstream `@as-integrations/fastify@3.1.0` (peer `^4.0.0 || ^5.0.0`).

## Considered Options
* Перенести knip/dependency-логіку у `js-lint-ci`, додати там ban-секцію для `@nitra/as-integrations-fastify`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести knip/dependency-логіку у `js-lint-ci` і додати ban-секцію там само", because `js-lint-ci` вже є декларованою зоною крос-файлового аналізу («per-file режиму нема»); дублювання knip-розділу в `js-lint` суперечило цьому інваріанту; бан на deprecated пакет природно розміщується поруч із knip як частина dependency-policy CI-етапу.

### Consequences
* Good, because `js-lint` більше не дублює knip-розділ — один canonical source у `js-lint-ci`.
* Good, because бан `@nitra/as-integrations-fastify` та цільовий `@as-integrations/fastify ^3.1.0` зафіксовані в CI-правилі разом з іншими залежнісними перевірками.
* Good, because проза `ignoreBinaries`/`ignoreDependencies` синхронізована з `knip-canonical.json` (прибрано `depcheck`, додано `graphql`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/js-lint/js-lint.mdc` (`version: '1.28'` → `'1.29'`): розділ `## knip` замінено однорядковим посиланням «Knip-аналіз та dependency-policy — у правилі `js-lint-ci`»; dependency-клаузи з відкривного абзацу вирізано аналогічно.
- `npm/rules/js-lint-ci/js-lint-ci.mdc` (новий `version: '1.1'`): додано `## Залежнісна політика` (перенесені клаузи), `## knip` (повний блок з canonical-шляхом `../js-lint/js/data/tooling/knip-canonical.json`, `ignoreBinaries`, `ignoreDependencies`), `## Заборона @nitra/as-integrations-fastify` з before/after (`❌`/`✅`) для `import`, `vi.mock`, `await import`.
- `npm/rules/js-lint/js/data/tooling/knip-canonical.json` — `@nitra/as-integrations-fastify` відсутній у `ignoreDependencies`/`entry`, strip не потрібен.
- Перевірено: prose `ignoreBinaries` відповідає канону (`actionlint`, `cspell`, `eslint`, `git-ai`, `jscpd`, `markdownlint-cli2`, `oxfmt`, `oxlint`, `shellcheck`, `uvx`, `v8r`, `zizmor`); `ignoreDependencies` — `@nitra/cspell-dict`, `/@cspell\/dict-.+/`, `graphql`.
- change-файл `npm/.changes/1780299289655-5d2239.md`: `bump: minor`, `section: Changed`.
- Тести `npm/scripts/tests/lint-cli.test.mjs`, `npm/scripts/lib/tests/template.test.mjs` — 31/31 pass після змін.
