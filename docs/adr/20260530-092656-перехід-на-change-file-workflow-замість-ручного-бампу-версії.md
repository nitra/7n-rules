---
session: bb3047db-5332-4649-a713-3f1cde68927a
captured: 2026-05-30T09:26:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bb3047db-5332-4649-a713-3f1cde68927a.jsonl
---

## ADR Перехід на change-file workflow замість ручного бампу версії та CHANGELOG

## Context and Problem Statement
Автоматичний коміт `d1066aa` зробив ручний bump `npm/package.json#version` (1.33.0 → 1.33.1) і додав нову секцію в `npm/CHANGELOG.md` за legacy-підходом. Правило `n-changelog.mdc v3.0` вже встановило change-file workflow канонічним для feature-флоу у `npm/`; ручний bump у feature-гілці — джерело merge-конфліктів.

## Considered Options
* Залишити legacy-підхід (ручний bump + секція у `CHANGELOG.md`) без змін
* Перенести на change-file workflow: `npx @nitra/cursor change ...` → `npm/.changes/<timestamp>.md`, bump/CHANGELOG делегуються CI на `main`

## Decision Outcome
Chosen option: "change-file workflow", because `n-changelog.mdc v3.0` встановлює його канонічним, `npx @nitra/cursor fix changelog` приймає його без зауважень, а ручний bump — явне джерело merge-конфліктів у паралельних гілках.

### Consequences
* Good, because CI отримує повний контроль над version bump, git-тегом і агрегацією CHANGELOG: усувається клас merge-конфліктів і знімається ручна робота з агента/розробника.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Коміт `5c77b23` `refactor(npm): перенесення на change-file workflow`: revertує ручний bump (`1.33.1 → 1.33.0`) і створює `npm/.changes/1780116534790-9f47f9.md` (frontmatter `bump: patch`, `section: Added`).
- CLI: `npx @nitra/cursor change --bump patch --section Added --message "..."`.
- Валідація: `npx @nitra/cursor fix changelog` → `✅ npm: @nitra/cursor — нова локальна версія (1.32.0 → 1.33.1)`.
- Правило: `.cursor/rules/n-changelog.mdc` (version `3.0`).

---

## ADR ROI-класифікація тестових прогалин замість 100%-покриттєвого таргету

## Context and Problem Statement
Після генерації vitest v8-звіту виявлено 147 JS-файлів з aggregate lines 77.62%. Постало питання, куди вкладати нові тести: намагання наблизитися до 100% охоплює spawn-обгортки, 3-рядкові `fix.mjs`-стаби та CLI entrypoints — файли, де unit-тести не вловлюють реальних багів, бо поведінка вже покрита інтеграційними тестами або немає testable logic.

## Considered Options
* Добитися максимального покриття на всіх файлах, включно зі spawn-wrappers та CLI glue
* ROI-класифікація прогалин: категорія A (0% concern-функції) → B (lib-helpers) → C (часткові прогалини) → D (свідомо не покривати)

## Decision Outcome
Chosen option: "ROI-класифікація", because spawn-обгортки й CLI glue не додають mutation-signal при unit-моку (підтверджено прикладами `rules/docker/lint/lint.mjs` і `scripts/lib/run-lint-step.mjs`); 3-рядкові `fix.mjs`-стаби — однаковий паттерн без логіки; тоді як concern-функції (`abie/js/*.mjs`) і pure lib-helpers мають тестабельну логіку з чіткими pass/fail-сценаріями.

### Consequences
* Good, because 10 нових тест-файлів (108+ кейсів, усі зелені) підняли lines 77.62% → 78.80%, fn 84.47% → 86.13%; категорія D виключена свідомо і задокументовано.
* Bad, because `rules/docker/lint/lint.mjs` (32%) не зрушив — `runLintDockerSteps`/`runLintDocker` залежать від `process.cwd()` без DI-точки, тобто реальна прогалина залишилася.

## More Information
- **Категорія A** (0% → 82–100%): `rules/abie/js/tests/` — firebase_hosting, env_dns, hc_pairing, ua_node_selector, ua_http_route.
- **Категорія B** (11–12% → 100%): `rules/abie/lib/tests/hc-yaml.test.mjs`, `rules/abie/lib/tests/k8s-tree.test.mjs`, `rules/docker/lib/tests/docker-hadolint.test.mjs`.
- **Категорія C** (16–40% → 84–100%): `scripts/tests/coverage-fix.test.mjs`, `scripts/tests/upgrade-nitra-cursor-and-install.test.mjs`.
- **Категорія D** (не покривати): 31× `rules/*/fix.mjs`-стаби, `scripts/lib/run-rule-cli.mjs`, `scripts/lib/run-lint-step.mjs`, `rules/docker/lint/lint.mjs`.
- Обговорено, але не реалізовано: `@test-policy` JSDoc-маркер, `coverage-policy.yaml` з полем `expires`, LLM-класифікатор мутантів (`verdict: equivalent|defensive|glue|wrapper|worth-testing`, `confidence`, `reason`).
- Coverage виміряно: `bunx vitest run --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=/tmp/n-coverage`.
- Пов'язані файли: `npm/stryker.config.mjs`, `npm/vitest.config.js`, `npm/rules/test/coverage/coverage.mjs`.
