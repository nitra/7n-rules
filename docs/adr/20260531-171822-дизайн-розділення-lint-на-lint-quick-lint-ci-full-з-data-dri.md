---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T17:18:22+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

I analyze a coding session transcript and produce durable decision documentation.

---

## ADR Дизайн розділення lint на `lint` (quick) / `lint-ci` (full) з data-driven конфігурацією через `meta.json`

## Context and Problem Statement
Монолітний `bun run lint` запускав усі lint-кроки (oxlint, eslint, jscpd, knip, stylelint, trufflehog та ін.) щоразу — і під час розробки, і в CI. Це надто повільно для локальних сесій агента, де потрібна швидка перевірка лише щойно змінених файлів. Виникла потреба розділити lint на швидкий `lint` (по змінених файлах) та повний `lint-ci` (по всьому проєкту).

## Considered Options
* **(F1) CLI-оркестратор у пакеті `@nitra/cursor`, поведінка визначається полем `meta.json.lint`** — `n-cursor lint`/`lint-ci` делегують; хардкод-ланцюг у `package.json` зникає
* **(F2) Генерація скриптів** — CLI під час sync генерує ланцюг у `package.json` з meta
* **(F3) Лишити ланцюг, додати лише фільтр** — мінімальна зміна без data-driven підходу
* **(E1) Одне поле `meta.json.lint: "quick"|"ci"`** — одне поле, семантика quick ⊆ ci
* **5-польова схема** (`lint`, `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd`) — паралельна сесія запропонувала data-as-config підхід, відхилений як надто складний
* **(H1) Обидва `lint` і `lint-ci` роблять `--fix`, падають на залишку** — симетрична fix-поведінка
* **(H2) quick фіксить, ci лише перевіряє (no-fix)** — класична CI-семантика

## Decision Outcome
Chosen option: "F1 + E1 + H1", because користувач явно обрав: CLI-оркестратор `n-cursor lint`/`lint-ci` у пакеті (F1), одне поле `meta.json.lint: "quick"|"ci"` (E1, quick ⊆ ci), однакова `--fix`-поведінка в обох командах (H1), база quick = working-tree vs HEAD + untracked. Scope — лише механіка в пакеті; кореневий `package.json` репо мігрує через sync.

### Consequences
* Good, because transcript фіксує очікувану користь: швидкий `lint` пропускає крос-файлові інструменти (`jscpd`, `knip`, `trufflehog`), запускає лише ті, що приймають список файлів (`oxlint`, `eslint`, `stylelint`, `oxfmt`), що значно прискорює локальну перевірку агента.
* Good, because архітектурно узгоджено з рештою системи: auto-rules data-driven, worktree CLI — однаковий підхід «`meta.json` керує».
* Bad, because 5-польова схема, закладена паралельною сесією, була переписана під E1 — це зафіксована точка конфлікту між одночасно працюючими сесіями.

## More Information
- Spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (переписано під E1, коміт `ac2b165`)
- Plan: `docs/superpowers/plans/2026-05-31-lint-quick-ci-e1.md` (коміт `a434653`)
- Squash-коміт реалізації: `ebe76db` «feat(lint): розділення на lint (quick) / lint-ci (full) через meta.json (Spec C, E1)»
- Реліз: `@nitra/cursor@1.40.0` (коміт `8ebd69e`)
- Нові файли: `npm/scripts/lint-cli.mjs`, `npm/scripts/lib/changed-files.mjs`, `npm/rules/js-lint-ci/` (jscpd+knip), `npm/rules/*/js/lint.mjs` для всіх lint-правил
- Класифікація кроків: `quick` — `js-lint` (oxlint+eslint), `style-lint`, `oxfmt`; `ci` — `js-lint-ci` (jscpd+knip), `ga`, `rego`, `text`, `security` (trufflehog)
- Тести: 111/111 passed по всіх фіча-файлах після squash-merge

---

## ADR База змінених файлів для quick-lint — working-tree vs HEAD включно з untracked

## Context and Problem Statement
CLI-оркестратор `n-cursor lint` (quick-режим) потребує визначити підмножину файлів для lint. Виникло питання: що вважати «зміненими» — лише staged/unstaged (vs HEAD), зміни всієї гілки (vs main), чи включати і нові файли (untracked).

## Considered Options
* **(G1) `git diff` проти HEAD** — незакомічені зміни (working tree + staged)
* **(G2) Проти merge-base з основною гілкою** — усі зміни гілки vs `main`
* **(G3 / G1+untracked) `git diff` проти HEAD + untracked файли** — як G1, але включає нові ще не додані файли

## Decision Outcome
Chosen option: "G3 — working-tree vs HEAD, включно з untracked", because сценарій «агент щойно змінив файли, ще не закомітив» — G1 не покрив би новостворені файли, хоча агент їх теж мав на увазі. G2 занадто широкий (весь branch vs main), ближчий до ролі `lint-ci`. Користувач явно погодився з пропозицією включити untracked.

### Consequences
* Good, because transcript фіксує очікувану користь: новостворені агентом файли теж проходять quick-lint, інакше «причесати свої зміни» пропустило б їх.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізовано у `npm/scripts/lib/changed-files.mjs` (коміт `9edd63e` на `feat/lint-quick-ci`, увійшов у squash `ebe76db`)
- Тести: 3 кейси — modified tracked + untracked повертають файли, чисте дерево → порожній список, поза git-репо → порожній список
