---
session: 05c3d8d1-330e-4532-9b71-fbc087139714
captured: 2026-05-30T16:10:02+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/05c3d8d1-330e-4532-9b71-fbc087139714.jsonl
---

## ADR Заборона ручного/агентського bump `version` — лише CI через change-файли

## Context and Problem Statement
Субагенти (n-fix, n-coverage-fix тощо) самостійно вирішували бампнути `version` у `package.json`, оскільки правило `n-changelog.mdc` v3.0 явно дозволяло це як «Legacy / hotfix»-шлях, а перевірка `consistency.mjs` зараховувала такий bump як `pass`. Паралельні гілки конфліктували на полі `version` у release-коміті.

## Considered Options
* **Підхід 1 — лише документація**: прибрати legacy-рядок з правила, але не чіпати перевірку; `consistency.mjs` і далі зеленить ручний bump.
* **Підхід 2 — документація + перевірка активно відхиляє ручний bump**: будь-яка зміна `version` поза CI (drift від бази або від опублікованої) → `fail` на будь-якій гілці; єдиний `pass` — наявність change-файлу `.changes/*.md`.
* **Підхід 3 — окремий write-time блок (hook/guard)**: новий механізм, що падає при зміні `version` поза release-комітом.

## Decision Outcome
Chosen option: "Підхід 2 — документація + перевірка активно відхиляє ручний bump", because наявний pre-commit hook `npm-changelog` вже запускає `check changelog`, тому новий `fail` у `consistency.mjs` автоматично блокує коміт без окремого механізму; Підхід 1 залишав би тихий false-pass; Підхід 3 — надлишкова дуба. Заборона однорідна для **всіх** гілок (жодного main-винятку): жоден CI-workflow не запускає `check changelog` на push, тому release-коміт не гейтиться перевіркою.

### Consequences
* Good, because transcript фіксує очікувану користь: агент, що бампнув `version`, негайно бачить `fail` з інструкцією відкотити та покласти change-файл; паралельні гілки більше не конфліктують на полі `version`.
* Good, because прибрано `checkDirtyNpmRequiresVersionBump` у `npm/rules/npm-module/js/package_structure.mjs` — перевірка, що активно форсувала ручний bump при незакоммічених змінах у `npm/`; без цього нова політика суперечила б старій перевірці.
* Bad, because у worktree з «брудною» базою (concurrent `n-cursor release` підняв локальну версію до 1.36.0 при опублікованій 1.34.1) `fix changelog` виходить з помилкою — це побічний ефект того самого механізму enforcement; реальна логіка підтверджена 110 green unit-тестами.

## More Information
Змінені файли:
- `npm/rules/changelog/js/consistency.mjs` — переписані `checkLocalOnlyChangedWorkspace`, `checkPublishedWorkspace`, `checkPublishedWorkspacePendingGitChanges`; version-drift перевіряється **до** check-файлу; прибрано `verifyChangelogEntry`.
- `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs` — bump→pass кейси переведені на fail; додані явні «ручний bump → fail» сценарії.
- `npm/rules/changelog/changelog.mdc` + `.cursor/rules/n-changelog.mdc` — прибрано legacy-лазівку, STOP категоричний, `version: '3.0' → '3.1'`.
- `npm/rules/npm-module/js/package_structure.mjs` — видалено `checkDirtyNpmRequiresVersionBump` і всі допоміжні git-функції; `npm/rules/npm-module/npm-module.mdc` + дзеркало — секція «Build версія» переписана на change-файл-флоу, `version: '1.13' → '1.14'`.
- `.cursor/rules/scripts.mdc` — STOP-блок секції «Завершення задачі» переписано: `version → нова секція CHANGELOG` замінено на `n-cursor change …`; `version: '1.11' → '1.12'`.
- `npm/skills/llm-patch/SKILL.md` + `.cursor/skills/n-llm-patch/SKILL.md` — зразковий output «bump version (minor)» замінено на `npx @nitra/cursor change …`.
- Change-файл: `npm/.changes/1780200000000-cibump.md`.
- Специфікація: `docs/superpowers/specs/2026-05-30-ci-only-version-bump-design.md`.
- План: `docs/superpowers/plans/2026-05-30-ci-only-version-bump.md`.
- Гілка реалізації: `feat/ci-only-version-bump-2` (worktree `/Users/vitaliytv/www/nitra/cursor-ci-bump`).
