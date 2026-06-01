---
session: da76262d-0d25-44b7-a2ee-c5b8e1b76064
captured: 2026-06-01T10:36:00+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/da76262d-0d25-44b7-a2ee-c5b8e1b76064.jsonl
---

## ADR Перенесення knip/dependency-логіки з `js-lint` до `js-lint-ci`

## Context and Problem Statement
Правило `js-lint-ci` декларувало у `description`, що knip/jscpd — його зона відповідальності («lише у lint-ci, по всьому репо»), але повний розділ `## knip` (з каноном `knip-canonical.json`, `ignoreBinaries`/`ignoreDependencies`) і dependency-клаузи (`@e18e/eslint-plugin`, заборона додавати пакети без потреби) дублювалися в `js-lint`. Паралельно, `@nitra/as-integrations-fastify@3.0.2` — застряглий République пакет з вузьким peer `@apollo/server: "^4.0.0"` — генерував `bun i warn` на Apollo 5 і мав бути замінений upstream `@as-integrations/fastify@3.1.0`.

## Considered Options
* Перенести knip/dependency-логіку у `js-lint-ci` і додати ban-секцію там само
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести knip/dependency-логіку у `js-lint-ci` і додати ban-секцію там само", because `js-lint-ci` вже є декларованою зоною крос-файлового аналізу («per-file режиму нема»), а дублювання knip-розділу в `js-lint` суперечило цьому інваріанту; бан `@nitra/as-integrations-fastify` природно розміщується поруч із knip як dependency-policy CI-етапу.

### Consequences
* Good, because `js-lint` більше не дублює knip-розділ — один canonical source у `js-lint-ci`.
* Good, because бан `@nitra/as-integrations-fastify` та цільовий `@as-integrations/fastify ^3.1.0` зафіксовані в CI-правилі, де вони валідуються разом з іншими залежнісними перевірками.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/js-lint/js-lint.mdc` — розділ `## knip` замінено однорядковим посиланням «див. `js-lint-ci`»; `version` піднято `1.28` → `1.29`.
- `npm/rules/js-lint-ci/js-lint-ci.mdc` — додано `version: '1.1'`, перенесено knip-розділ (з `ignoreBinaries`/`ignoreDependencies` з `knip-canonical.json`), додано секцію заборони `@nitra/as-integrations-fastify` з before/after (`❌`/`✅`) для `import`, `vi.mock`, `await import`.
- `npm/rules/js-lint/js/data/tooling/knip-canonical.json` — `@nitra/as-integrations-fastify` відсутній у `ignoreDependencies`/`entry`, тому strip не потрібен.
- change-файл `npm/.changes/1780299289655-5d2239.md`: `bump: minor`, `section: Changed`.
- Тести `npm/scripts/tests/lint-cli.test.mjs`, `npm/scripts/lib/tests/template.test.mjs` — 31/31 pass після змін.

---

## ADR Виправлення frontmatter `js-lint-ci`: `alwaysApply: true` → glob як у `js-lint`

## Context and Problem Statement
Правило `js-lint-ci` мало `alwaysApply: true` з порожнім `globs:`, що суперечило власному `meta.json` цього ж правила (JS-glob присутній) і призводило до інжекції правила в **кожен** контекст незалежно від стека проєкту.

## Considered Options
* Встановити той самий glob, що у правилі-сіблінгу `js-lint` (`alwaysApply: false`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Встановити той самий glob, що у правилі-сіблінгу `js-lint`", because `js-lint` (quick) і `js-lint-ci` (ci) — сіблінги; їх природно показувати в одному контексті, а `alwaysApply: true` з порожнім `globs` суперечив `meta.json` правила та марно навантажував контексти без JS.

### Consequences
* Good, because правило тепер є Auto Attached і тригериться лише коли в контексті є JS-файли або конфіги лінтерів — поведінка консистентна з `meta.json` і `js-lint`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/js-lint-ci/js-lint-ci.mdc` frontmatter: `globs:` (порожній) + `alwaysApply: true` → `globs: "**/{.oxlintrc.json,eslint.config.js,.jscpd.json,knip.json,package.json},**/*.{js,mjs,cjs,jsx,ts,tsx}"` + `alwaysApply: false`.
- change-файл `npm/.changes/1780298875974-ae2d79.md`: `bump: patch`, `section: Changed`.
