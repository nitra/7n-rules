---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T17:11:29+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR розділення lint на `lint` (quick) і `lint-ci` (full) через `meta.json`

## Context and Problem Statement

Поточний `bun run lint` у репо `@nitra/cursor` запускає монолітний ланцюг із шести lint-кроків (`lint-ga`, `lint-js`, `lint-rego`, `lint-security`, `lint-style`, `lint-text`) та `oxfmt` щоразу — і під час розробки, і в CI. Це надмірно повільно для локальної перевірки поточних змін, де достатньо запустити лише швидкі інструменти по змінених файлах.

## Considered Options

* **C/F1** — CLI-оркестратор у пакеті; кореневі скрипти делегують (`n-cursor lint` / `n-cursor lint-ci`)
* **F2** — генерація скриптів у `package.json` із `meta.json` під час sync
* **F3** — лишити ланцюг, додати лише фільтр на змінені файли
* **E1** — одне поле `lint: "quick"|"ci"` у `meta.json` правила
* **E2** — обʼєкт `lint: { phase, scope }` у `meta.json`
* **E3** — два булеві прапорці `lintQuick`/`lintCi`
* **D1** — атрибут на правилі, грубо (ціле правило `quick` або `ci`)
* **D3** — атрибут на правилі + свідоме розщеплення `js-lint` на два кроки

## Decision Outcome

Chosen option: **"C/F1 + E1 + D3"**, because:
- CLI-оркестратор (F1) — єдиний, що реалізує data-driven ідею (оркестратор читає `meta.json.lint` і будує набір кроків); дзеркалить наявний патерн `lint-ga`/`lint-text` (CLI-виконавець + тонкий скрипт-делегат).
- Одне поле `lint` з enum `"quick"|"ci"` (E1) — мінімальна схема; семантика **quick ⊆ ci** (quick-кроки входять в обидва набори, ci-кроки — лише в `lint-ci`); scope виводиться з фази, окремо кодувати не треба.
- D3 (атрибут на правилі + розщеплення `js-lint`) — `oxlint`/`eslint` приймають список файлів → `quick`; `jscpd`/`knip` крос-файлові → виносяться в окремий крок `js-lint-ci` з `"lint": "ci"`.
- База quick = working-tree зміни проти HEAD + untracked (git diff HEAD + нові файли).
- Поведінка fix (H1): обидва набори (`lint` і `lint-ci`) роблять `--fix`, падають на залишку.
- Scope: лише механіка в пакеті `@nitra/cursor`; кореневий `package.json` репо мігрує через sync.

### Consequences

* Good, because transcript фіксує очікувану користь: `n-cursor lint` по змінених файлах дає швидку перевірку поточних правок; `n-cursor lint-ci` ганяє повний набір, включно з `jscpd`, `knip`, `trufflehog`.
* Good, because transcript фіксує очікувану користь: `meta.json.lint` керує складом наборів — додавання нового правила з полем `"lint": "quick"` автоматично включає його в обидва набори без змін в оркестраторі.
* Good, because transcript фіксує очікувану користь: повний сюїт **1987 passed, 0 failed** після реалізації; реліз `@nitra/cursor@1.40.0` опублікований CI.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (переписаний під E1, коміт `ac2b165`)
- Plan: `docs/superpowers/plans/2026-05-31-lint-quick-ci-e1.md` (8 задач, коміт `a434653`)
- Squash-коміт реалізації: `ebe76db` «feat(lint): розділення на lint (quick) / lint-ci (full) через meta.json (Spec C, E1)»
- Реліз: `@nitra/cursor@1.40.0` (коміт `8ebd69e`)
- Нові файли у пакеті: `npm/scripts/lint-cli.mjs`, `npm/scripts/lib/changed-files.mjs`, `npm/rules/js-lint-ci/` (новий концерн), `npm/rules/*/js/lint.mjs` (делегати для `style-lint`, `ga`, `rego`, `text`, `security`)
- CLI-кейси: `case 'lint'` / `case 'lint-ci'` у `npm/bin/n-cursor.js` (рядок ~1466); старий `run-lint-cli.mjs` (timing-оркестратор) видалено
- Класифікація кроків: `style-lint`, `js-lint` → `quick`; `js-lint-ci`, `ga`, `rego`, `text`, `security` → `ci` (підтверджено фактом: їхні CLI не приймають список файлів)
- Поле `meta.json` (`"lint": "quick"|"ci"`) провалідовано схемою `rule-meta.json` + `rule_meta.mjs`
- Кроки у worktree `feat/lint-quick-ci` виконувались послідовними субагентами (tasks T1–T8), завершено squash-merge
