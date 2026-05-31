---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T16:52:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Розділення lint на `lint` (quick) / `lint-ci` (full) через meta.json

## Context and Problem Statement
Поточний `bun run lint` — монолітний послідовний ланцюг із шести lint-кроків (`lint-ga`, `lint-js`, `lint-rego`, `lint-security`, `lint-style`, `lint-text`) + `oxfmt`, який запускається повністю і під час розробки, і в CI. Потрібно розділити запуски: швидкий прогін по змінених файлах (`lint`) і повний для CI (`lint-ci`), де розподілення кроків між режимами визначається атрибутом у `meta.json` правила.

## Considered Options
* **E1** — одне поле `lint: "quick"|"ci"` у `meta.json` правила; семантика quick ⊆ ci; виконавець-оркестратор у CLI пакета.
* **5-польова data-as-config схема** (`lint`, `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd`) — запропонована паралельною сесією агентів, знайдена в spec-файлі на диску.
* **D1** — грубий атрибут на рівні правила без розщеплення `js-lint` (обговорювалось, відхилено через неможливість розрізнити quick/ci-інструменти всередині одного правила).

## Decision Outcome
Chosen option: "E1 з D3-розщепленням `js-lint`", because E1 є мінімально складним (одне поле, enum `quick`/`ci`) і покриває всі реальні випадки. `js-lint` — єдиний композитний крок із інструментами обох фаз, тому явно розщеплюється на `js-lint` (quick: oxlint+eslint) і новий концерн `js-lint-ci` (ci: jscpd+knip), натомість решта правил отримує один атрибут. Виконавець (`lint-cli.mjs`) читає `meta.json` правил і збирає набір кроків data-driven, без хардкоду (аналогічно `auto-rules.mjs` після Spec B). Кореневі npm-скрипти проєкту делегують до `n-cursor lint` / `n-cursor lint-ci`; самі скрипти не змінюються — міграція через sync.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun run lint` запускає лише ті кроки, що приймають список файлів (oxlint, eslint, stylelint, oxfmt, style-lint), по working-tree-змінах проти HEAD + untracked; важкі крос-файлові кроки (jscpd, knip, trufflehog) та CLI-кроки без file-scope (ga, rego, text, security) — тільки в `lint-ci`.
* Good, because повний тестовий сюїт після реалізації: **1987 passed, 0 failed**.
* Good, because атрибут `meta.json.lint` — той самий механізм, що вже використовується для `auto`; не вводить нової парадигми.
* Bad, because `.cursor/rules/n-*` дзеркало оновиться лише після релізу пакета з цими змінами (sync бере правила з опублікованого `@nitra/cursor`, не з локального `npm/rules`); проміжний стан без автосинку.

## More Information
- Spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (статус Approved)
- Plan: `docs/superpowers/plans/2026-05-31-lint-quick-ci-e1.md` (8 задач)
- Нові файли пакета: `npm/scripts/lib/changed-files.mjs`, `npm/scripts/lint-cli.mjs`, `npm/rules/js-lint-ci/` (meta.json + js-lint-ci.mdc + js/lint.mjs), `npm/rules/js-lint/js/lint.mjs`, `npm/rules/style-lint/js/lint.mjs`, `npm/rules/ga|rego|text|security/js/lint.mjs`
- Змінено: `npm/bin/n-cursor.js` — замінено `case 'lint'` (старий timing-оркестратор `runLintCli`) на нові `case 'lint'` / `case 'lint-ci'` через `runLint({ ci })` з `lint-cli.mjs`; видалено `npm/scripts/lib/run-lint-cli.mjs`
- `meta.json` правил: `js-lint`, `style-lint` → `lint: "quick"`; `ga`, `rego`, `text`, `security`, `js-lint-ci` → `lint: "ci"`
- Реалізація: гілка `feat/lint-quick-ci`, 8 комітів `78cedd6`..`c65142f`
- Change-файл: `npm/.changes/lint-quick-ci-split.md`
- Класифікація quick/ci для `ga/rego/text/security`: підтверджена дослідженням субагента — їхні CLI-функції (`runLintGaCli`, `runLintRego`, `runLintTextCli`, trufflehog) не приймають список файлів → `ci`.
