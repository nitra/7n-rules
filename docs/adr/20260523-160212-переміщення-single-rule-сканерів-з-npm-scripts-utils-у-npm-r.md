---
session: bcdba371-cfb8-46ab-a284-8869588499a7
captured: 2026-05-23T16:02:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bcdba371-cfb8-46ab-a284-8869588499a7.jsonl
---

## ADR Переміщення single-rule сканерів з `npm/scripts/utils/` у `npm/rules/<rule>/fix/<sub>/`

## Context and Problem Statement
У пакеті `@nitra/cursor` сканери та canonical-конфіги, специфічні для одного правила, зберігалися у спільній директорії `npm/scripts/utils/`. Це порушувало принцип cohesion: файли, що повністю належать конкретному правилу, знаходилися поза каталогом цього правила. Виникала потреба привести layout до конвенції `rules/<rule>/fix/<concern>/`.

## Considered Options
* Залишити поточне розміщення (`npm/scripts/utils/` як збірний майданчик для всього).
* Перемістити single-rule файли у `rules/<rule>/fix/<sub>/`; shared/multi-rule утиліти — залишити у `scripts/utils/`.
* Cross-rule import: перемістити файли та дозволити залежність між різними rule-директоріями.

## Decision Outcome
Chosen option: "Перемістити single-rule файли у `rules/<rule>/fix/<sub>/`; shared/multi-rule — залишити у `scripts/utils/`", because це максимізує cohesion: кожен rule-каталог самодостатній, `scripts/utils/` лишається тільки для справді спільного коду.

Для `graphql-gql-scan.mjs`, який використовував функції `vue-forbidden-imports.mjs`, cross-rule import було замінено на локальний дублікат (три функції + helper `extractVueScriptBlocks`) — обидва модулі повністю незалежні.

### Consequences
* Good, because кожне правило самодостатнє: усі його файли (check, scan, canonical-конфіг, тест) лежать в одному піддереві.
* Good, because `graphql` і `vue` не мають cross-rule залежностей; `bun test rules/graphql rules/vue` → 18 pass / 0 fail.
* Bad, because ~25 рядків коду дубльовано між `graphql-gql-scan.mjs` і `vue-forbidden-imports.mjs` (усвідомлений компроміс).

## More Information
Переміщені файли (`git mv`): `knip-canonical.json`, `oxlint-canonical*.json`, `oxlint-rules.tsv`, `rebuild-oxlint-canonical.mjs` → `rules/js-lint/fix/tooling/`; 5 AST-сканерів (bunyan, check-env, conn-file, conn-imports, promise-settimeout) → `rules/js-run/fix/runtime/`; docker-hadolint + docker-mirror → `rules/docker/fix/lint/`; `bun-sql-scan.mjs` → `rules/js-bun-db/fix/safety/`; `mssql-pool-scan.mjs` → `rules/js-mssql/fix/deps/`; `package-manifest.mjs` → `rules/changelog/fix/consistency/`; `vue-forbidden-imports.mjs` → `rules/vue/fix/packages/`; `graphql-gql-scan.mjs` → `rules/graphql/fix/tooling/`.
Виявлено та відкочено помилкове видалення: `discover-check-rules-from-cursor.mjs`, `generated-markdown.mjs`, `inline-template-links.mjs` активно імпортуються з `npm/bin/n-cursor.js` (рядки 74–85) — Explore-агент пропустив `bin/`.
ADR supersedes: `docs/adr/20260523-112217-розміщення-canonical-конфігів-у-npm-scripts-utils.md`.

---

## ADR Розміщення тестів у `tests/` піддиректорії поряд із кодом + правило `test` (канон)

## Context and Problem Statement
У пакеті `@nitra/cursor` тести (`*.test.mjs`) лежали поряд із джерельним файлом у тій самій директорії. Це ускладнювало навігацію та не давало можливості виключити тести з npm-публікації чи перевіряти конвенцію програмно. Потрібно було зафіксувати єдиний стандарт і закодити його перевіркою.

## Considered Options
* Залишити sibling-розміщення (тест поряд із файлом у тій самій директорії).
* Переміщення у піддиректорію `test/` (ім'я в однині).
* Переміщення у піддиректорію `tests/` (ім'я у множині) + програмне правило-канон.

## Decision Outcome
Chosen option: "Переміщення у піддиректорію `tests/` + програмне правило-канон", because множина (`tests/`) — прийнятіший стандарт у JS-екосистемі; програмне правило дозволяє автоматично верифікувати конвенцію у CI.

### Consequences
* Good, because конвенція перевіряється автоматично: `npx @nitra/cursor check test` → ✅ Всі 77 файлів `*.test.mjs` у каталозі `tests/`.
* Good, because `npm/package.json#files` виключає `**/*.test.mjs` та `**/tests/**` за glob — публікований артефакт не містить тестів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Переміщено 73 sibling-тести (`git mv` у порядку найглибших директорій спершу, щоб уникнути зсуву батьків) + rename `npm/tests/` (3 integration-тести) залишено без зміни depth.
`npm/rules/nginx-default-tpl/fix/template/fixtures/` переміщено у `tests/fixtures/`.
`npm/scripts/utils/__fixtures__/` переміщено у `tests/__fixtures__/`.
Ручні фіксапи path-depth у 4 тестах: `sync-setup-bun-deps-action.test.mjs`, `inline-template-links.test.mjs`, `rules/adr/fix/hooks/check.test.mjs`, `rules/abie/utils/enabled.test.mjs`.
Revert false-positives: sed помилково замінив `from './hero.png'` / `from './icon.svg'` / `from './imp.png'` всередині backtick template literals у `rules/image-avif/fix/avif_generation/tests/check.test.mjs`.
Нові файли: `npm/rules/test/test.mdc`, `npm/rules/test/fix/location/check.mjs`, `npm/rules/test/fix/location/tests/check.test.mjs`, `npm/rules/test/auto.md`.
Додатковий fix у `npm/rules/npm-module/fix/package_structure/check.mjs`: carve-out у `classifyPublishedFileAsTest` для rule-name сегментів у шляху `rules/<X>/...`.
`.n-cursor.json`: додано `"test"` у `rules`, `"ignore": [".claude/worktrees"]`.
