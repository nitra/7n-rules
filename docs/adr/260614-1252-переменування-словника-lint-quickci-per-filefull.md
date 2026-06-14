---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T12:52:44+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

## ADR переменування словника lint: `quick|ci` → `per-file|full`

## Context and Problem Statement
У `npm/rules/*/meta.json` поле `lint` мало два значення-ідентифікатори: `"quick"` (per-file детект) і `"ci"` (whole-repo). Ці назви не відображали семантику осей, тому оркестратор та CLI розпізнавали їх через `parseRuleLintPhase`, що ускладнювало розширення.

## Considered Options
* Перейменувати `quick` → `per-file`, `ci` → `full`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перейменувати `quick` → `per-file`, `ci` → `full`", because це напряму відображає дві ортогональні осі (`scope` + `behavior`) і усуває неоднозначність між "швидким CI-прогоном" та "per-file детектом".

### Consequences
* Good, because transcript фіксує очікувану користь: API стає самодокументованим (`per-file` = дельта vs origin, `full` = весь репо); `parseRuleLintPhase` перейменовано на `parseRuleLintSpec`, що узгоджується з новою семантикою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/*/meta.json` (8 правил), `npm/scripts/lib/rule-meta.mjs` (`parseRuleLintSpec`), `npm/scripts/lib/tests/rule-meta.test.mjs`, `npm/scripts/tests/lint-cli.test.mjs`, `npm/rules/js-lint/js-lint.mdc`, `npm/rules/js-lint-ci/js-lint-ci.mdc`. Дзеркало `.cursor/rules/n-js-lint-ci.mdc` пересинкано через `expectedMirrorContent`. Коміт `3a0b0ec4`.

---

## ADR дві ортогональні осі lint: `scope` (per-file|full) × `behavior` (fix|--read-only)

## Context and Problem Statement
Оркестратор `lint` мав лише одну вісь (`quick` vs `ci`), не розрізняючи "які файли перевіряти" та "чи мутувати їх". Це не давало запускати детект без автофіксу або обмежувати сканування дельтою vs origin у незалежний спосіб.

## Considered Options
* Дві ортогональні осі: `--full` (scope) × `--read-only` (behavior)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Дві ортогональні осі: `--full` (scope) × `--read-only` (behavior)", because це дозволяє ComposE поведінки незалежно: CI = `--read-only --full`; PostToolUse = `--read-only` (per-file); звичайний `lint` = fix за дельтою.

### Consequences
* Good, because transcript фіксує очікувану користь: кожен `lint.mjs` отримав третій параметр `{ readOnly }`, `lint-ci` → `--read-only --full`; база порівняння — `resolveChangedBase()` (origin).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/scripts/lint-cli.mjs` (`runLint`, `selectLintRules`), `npm/bin/n-cursor.js` (bin dispatch), per-rule `lint.mjs` (js-lint, style-lint, text, run-shellcheck, run-dotenv-linter). `fix.mjs run()` у детект-only правилах залишається без змін. Коміт `3a0b0ec4`.

---

## ADR `lint --full` поглинає конформність (`fix`-рушій) як whole-repo фаза

## Context and Problem Statement
`lint` і `fix` були дві окремі команди: `lint` — лінтери; `fix` — конформність (config/file/workflow перевірки через `fix.mjs run()` + convergence-движок). Це дублювало точки входу і унеможливлювало один CI-виклик, що покривав би обидва типи перевірок.

## Considered Options
* Додати конформність-фазу в `lint --full` (адитивно)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати конформність-фазу в `lint --full` (адитивно)", because конформність — whole-repo за природою (аналізує конфіги/файли/workflow-ланцюжки), тому гейтується `--full`; лінтери залишаються per-file як раніше.

### Consequences
* Good, because transcript фіксує очікувану користь: `lint --full` стає функційною надмножиною `fix`; `fix` можна видалити без втрати поведінки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано в `npm/scripts/lint-cli.mjs` (конформність-фаза через `runOrchestratorCli` при `full && rules непорожньо`). Коміт `028d4bf0`.

---

## ADR фільтр правил `lint <rule>` і перепідключення hk `changelog`

## Context and Problem Statement
Pre-commit хук (`hk.pkl`) викликав `fix changelog` (конформність лише для правила `changelog`). Після видалення `fix` потрібен був спосіб прогнати конформність одного правила через `lint`.

## Considered Options
* Додати фільтр правил у `lint`: `n-cursor lint [--read-only] <rules…>`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати фільтр правил у `lint`", because це дає `hk.pkl` можливість замінити `fix changelog` на `lint changelog` без зміни семантики — конформність лише для вказаних правил, без лінтер-скану.

### Consequences
* Good, because transcript фіксує очікувану користь: live-перевірка (`N_CURSOR_CHANGELOG_AUTOFIX=1 node npm/bin/n-cursor.js lint changelog`) вийшла з кодом 0 і підтвердила, що hk-flow залишився зеленим.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/scripts/lint-cli.mjs`, `npm/bin/n-cursor.js`, `hk.pkl`. Коміт `91eab517` (на feature-гілці `claude/lint-fix-readonly-unification`).

---

## ADR видалення `fix`/`check` і переміщення движка конформності

## Context and Problem Statement
Після поглинання конформності в `lint --full` команди `fix`, `check`, `fix-run` стали дублікатами. Їх рушій (`orchestrator.mjs`, `t0.mjs`, `llm-worker.mjs`) фізично знаходився всередині скіл-каталогу `npm/skills/fix/js/`, що унеможливлювало видалення скіла без втрати рушія.

## Considered Options
* Перемістити рушій у `npm/scripts/lib/fix/`, видалити публічні команди `fix`/`check`/`fix-run`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перемістити рушій у `npm/scripts/lib/fix/`, видалити публічні команди", because переміщення зберігає глибину шляху (`../../../`-імпорти залишаються валідними), а `npm/skills/fix/` деградує до DEPRECATED-делегата на `/n-lint`.

### Consequences
* Good, because transcript фіксує очікувану користь: `2341` тестів зелені; `lint changelog` у hk-flow зеленим підтвердив коміт `185cbeab`.
* Bad, because `_fix-check` і `fix-t0` залишились внутрішніми фазами (не видалені), оскільки їх інлайн відкладено як follow-up.

## More Information
`git mv skills/fix/js/orchestrator.mjs → scripts/lib/fix/orchestrator.mjs` (аналогічно `t0.mjs`, `llm-worker.mjs`, docs, tests). Спрощений PostToolUse-хук (`npm/scripts/post-tool-use-fix.mjs`): прибрано `routeFilePathToRules`/`ROUTES`, один `_fix-check`-виклик усіх правил у read-only режимі. Коміт `185cbeab`.

---

## ADR релаксація заборони паралельного ESLint

## Context and Problem Statement
`CLAUDE.md` містила абсолютну заборону: «не запускати кілька ESLint паралельно». Проте `lint <rule>` по **диз'юнктних** наборах файлів (per-file `lint` на змінених vs origin) фізично не конфліктує і не перевантажує диск/CPU — заборона гальмувала агентів без підстав.

## Considered Options
* Релаксувати заборону: дозволити паралельний `lint` по диз'юнктних файлах; серіалізувати лише whole-tree прогони того самого корпусу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Релаксувати заборону: диз'юнктні набори — OK; whole-tree — серіалізувати", because `lint <rule>` per-file прогони на різних файлах не перетинаються між собою, а `bun run lint` / `n-cursor lint --full` по всьому репо — важкі й мають залишатись серіалізованими.

### Consequences
* Good, because transcript фіксує очікувану користь: агенти можуть паралелізувати per-file лінт на різних файлах без блокування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Джерело: `buildClaudeLintParallelismSectionLines()` у `npm/bin/n-cursor.js` (генерує секцію CLAUDE.md при `n-cursor sync`). Оновлено також `npm/skills/lint/SKILL.md`. Коміт `4ceb657e`.
