---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T11:31:29+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

Згенерую ADR документацію безпосередньо з аналізу транскрипту:

## ADR Уніфікація словника lint: `quick|ci` → `per-file|full`

## Context and Problem Statement
Поле `meta.json:lint` у правилах репо мало значення `"quick"` і `"ci"`, які не відбивали семантику декомпозиції (чи правило вміє аналізувати subset файлів). Паралельно з'явилась нова вісь поведінки (`fix` vs `--read-only`), і стара двочленна фаза зливалась з CI-контекстом, породжуючи хелпер `effectiveCi` і поле `{scope, ci}`.

## Considered Options
* Залишити `quick|ci` і додати окреме поле `ci` в `meta.json` (об'єктний формат `{scope, ci}`)
* Замінити на `per-file|full` — чистий рядок, що описує лише здатність до декомпозиції

## Decision Outcome
Chosen option: "замінити на `per-file|full`", because CI завжди запускає `--full`, тому поле `ci`-override стає зайвим; рядковий формат простіший і не дублює вісь поведінки.

### Consequences
* Good, because transcript фіксує очікувану користь: `effectiveCi`, хелпер і поле `{scope, ci}` прибрані, валідатор `checkLintField` спрощено до одного рядкового set `{'per-file','full'}`.
* Bad, because hard rename вимагає оновлення 8 `meta.json`-файлів і міграція не зворотно-сумісна (major bump).

## More Information
Файли: `npm/rules/{doc-files,js-lint,style-lint,security,text}/meta.json` → `"per-file"`; `npm/rules/{ga,js-lint-ci,rego}/meta.json` → `"full"`. Функція `parseRuleLintPhase` перейменована на `parseRuleLintSpec` у `npm/scripts/lib/rule-meta.mjs`. Дзеркало `.cursor/rules/n-js-lint-ci.mdc` пересинковано. Коміт `3a0b0ec4`.

---

## ADR Дві ортогональні осі lint: scope × behavior

## Context and Problem Statement
Оркестратор `n-cursor lint` мав єдиний прапор `--ci` (весь репо, детект), і не було засобу запустити весь репо з автофіксом або дельту з детект-only. Це робило неможливим pre-commit read-only режим і CI-режим без окремого субкоманду `lint-ci`.

## Considered Options
* Зберегти `lint` (quick+fix) і `lint-ci` (full+detect) як два незалежні субкоманди
* Дві ортогональні осі: `--full` (scope) × `--read-only` (behavior), чотири комбінації одним субкомандом

## Decision Outcome
Chosen option: "дві ортогональні осі `--full` × `--read-only`", because кожна вісь незалежна (можна run весь репо з фіксом, або дельту read-only), і підкоманда `lint-ci` зникає на користь `lint --read-only --full`.

### Consequences
* Good, because transcript фіксує очікувану користь: pre-commit = `lint --read-only`; CI = `lint --read-only --full`; агент = `lint`; `lint-ci` субкоманда прибирається.
* Bad, because контракт кожного `js/lint.mjs` розширюється з `lint(files, cwd)` до `lint(files, cwd, { readOnly })` — breaking change для зовнішніх споживачів правил.

## More Information
Файли: `npm/scripts/lint-cli.mjs` (`runLint({ full, readOnly })`), `npm/bin/n-cursor.js` (парсинг `--full`/`--read-only` з `args`). Rules з автофіксом, де `readOnly` реально гейтить `--fix`: `npm/rules/js-lint/js/lint.mjs`, `npm/rules/style-lint/js/lint.mjs`, `npm/rules/text/lint/{lint,run-shellcheck,run-dotenv-linter}.mjs`. Коміт `3a0b0ec4`.

---

## ADR `lint --full` поглинає конформність (надмножина `n-cursor fix`)

## Context and Problem Statement
`n-cursor fix` запускав convergence-loop (Tier0 → check-gate → LLM-ескалація) по всіх правилах окремо від `lint`. Це означало дублювання workflow: розробник мав знати про два субкоманди з перекривною функціональністю.

## Considered Options
* Залишити `fix` як окремий субкоманд поряд з `lint`
* Зробити `lint --full` надмножиною: після лінтер-скану — фаза конформності (per-rule `fix.mjs run()` або convergence-loop)

## Decision Outcome
Chosen option: "`lint --full` поглинає конформність", because єдина точка входу `lint` охоплює і зовнішні тули (oxlint, eslint, stylelint…), і конформність конфігів/файлів/workflow — без потреби знати про `fix`.

### Consequences
* Good, because transcript фіксує очікувану користь: `lint --full` (fix) = лінтери + convergence; `lint --read-only --full` = детект усього без мутацій.
* Bad, because `n-cursor fix` вилучається без аліасу — усі прямі CLI-виклики `fix` у зовнішніх скриптах ламаються.

## More Information
Файл: `npm/scripts/lint-cli.mjs` (функція `runConformancePhase`). Pre-commit хук у `hk.pkl:18` перепідключено: `fix changelog` → `lint changelog`. Коміт `028d4bf0`.

---

## ADR Видалення `n-cursor fix` без аліасу зворотної сумісності

## Context and Problem Statement
При поглинанні `fix` у `lint` постало питання, чи лишати делегувальний аліас `fix → lint` для плавної міграції до наступного major-релізу.

## Considered Options
* Лишити `fix` як делегувальний аліас (deprecated wrapper) до наступного major
* Видалити `fix` повністю без аліасу

## Decision Outcome
Chosen option: "видалити без аліасу", because user: «Старий fix лишається делегувальним аліасом до наступного major. не потрібен цей аліас» — backward-compat шим не потрібен, зміна вже є major.

### Consequences
* Good, because transcript фіксує очікувану користь: кодова база не обтяжується deprecated wrapper-ами; явний розрив мотивує споживачів мігрувати одразу.
* Bad, because усі зовнішні виклики `npx @nitra/cursor fix` ламаються без попередження; потрібне оновлення хуків, CI-скриптів і скіла `/n-fix`.

## More Information
PostToolUse-хук у `.claude/settings.json` перепідключається з `post-tool-use-fix` (маршрутизація file→rules + `fix <rules>`) на `lint --read-only` (одиночний виклик, усі активовані правила). Скіл `/n-fix` видаляється, його функцію виконує `/n-lint`. Коміт `91eab517` (фільтр `lint <rule>`).

---

## ADR PostToolUse-хук: один виклик `lint --read-only` замість маршрутизації

## Context and Problem Statement
Старий `post-tool-use-fix.mjs` містив таблицю `ROUTES` (file extension → набір правил) і викликав `fix <rules>` лише для релевантних правил зміненого файлу — оптимізація для дорогого convergence+LLM автофіксу.

## Considered Options
* Зберегти маршрутизацію file→rules, але замінити `fix` на `lint --read-only <rules>`
* Один виклик `lint --read-only` для всіх активованих правил без будь-якої маршрутизації

## Decision Outcome
Chosen option: "один виклик без маршрутизації", because user: «навіщо фільтр правил/файлів, чому не можна одним викликом всі які активовані в `.n-cursor.json`?» — detect-only (read-only) дешевий, оптимізація була потрібна лише для дорогого fix+LLM.

### Consequences
* Good, because transcript фіксує очікувану користь: хук спрощується (прибирається таблиця `ROUTES`), підтримка не потрібна при додаванні нових правил.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
Файл: `npm/scripts/post-tool-use-fix.mjs`. Файл `.claude/settings.json` (рядок з `"command": "npx --no @nitra/cursor post-tool-use-fix"`). Активовані правила визначаються через `.n-cursor.json` runtime-детект.

---

## ADR omlx замість хмарних моделей для Tier1+ LLM-ескалації

## Context and Problem Statement
Поточний convergence-loop у `skills/fix/js/` ескалює до хмарних LLM (haiku→sonnet через `pi` CLI) при невиправних знахідках. Для локального запуску це дорого і потребує мережі.

## Considered Options
* Залишити хмарні моделі (haiku→sonnet) через `pi` CLI
* omlx (локальний MLX-сервер) або `mimo code` як основний Tier1+, хмара лише фолбек

## Decision Outcome
Chosen option: "omlx як Tier1+, хмара — фолбек каскаду", because user: «замість хмарних використовуємо omlx (або прямі виклики або mimo code)» — `npm/lib/llm.mjs` вже маршрутизує `omlx/<model>` → прямий HTTP (`callOmlx`); `resolveModel(tier)` має каскад local→cloud.

### Consequences
* Good, because transcript фіксує очікувану користь: Tier1+ не потребує мережі та хмарного білінгу в нормальному локальному flow.
* Bad, because Neutral, because transcript не містить підтвердження наслідку (latency/якість omlx-моделей не верифіковані в сесії).

## More Information
Файли: `npm/lib/llm.mjs` (`callOmlx`, прямий HTTP), `npm/lib/models.mjs` (`resolveModel`, каскад через env `N_LOCAL_MIN_MODEL`/`N_LOCAL_AVG_MODEL`), `npm/skills/fix/js/llm-worker.mjs`. Env-змінні задаються у `~/.zshenv` (пам'ять: `N_LOCAL_MIN_MODEL=omlx/gemma-4-e2b-it-4bit`).

---

## ADR Зняття заборони паралельного eslint/oxlint

## Context and Problem Statement
`CLAUDE.md` і `.cursor/rules/scripts.mdc` містили явну заборону запускати кілька екземплярів `eslint`/`oxlint` одночасно (ризик перевантаження диску/CPU при повному прогоні). Нова архітектура (`lint --full` з `per-file`-шардингом) припускає паралельні запуски по дизʼюнктних наборах файлів.

## Considered Options
* Залишити заборону (серіалізувати всі eslint-запуски)
* Зняти заборону для паралельних запусків по різних файлах

## Decision Outcome
Chosen option: "зняти заборону для паралельних запусків по різних файлах", because user: «заборону паралельного eslint/oxlint знімаємо це обмеження (бо на паралельні запуски по різним файлам це ок)».

### Consequences
* Good, because transcript фіксує очікувану користь: `lint --full` зможе шардувати файли і запускати eslint паралельно, прискорюючи full-прогін.
* Bad, because `CLAUDE.md` і `scripts.mdc` потребують явного оновлення — це обов'язкова частина major (крок 6 плану міграції в специфікації).

## More Information
Файли для оновлення: `CLAUDE.md` (секція «Лінт і ESLint»), `.cursor/rules/scripts.mdc`. Обмеження лишається лише для запуску **різних повних прогонів** (не по дизʼюнктних shards).

---

## ADR Всі конформність-concern-и автофіксуються (немає manual-only винятків)

## Context and Problem Statement
У чернетці специфікації R-1 ставив питання: які concern-и ніколи не автофіксяться навіть у fix-режимі (мінімум — trufflehog/security). Потрібно було визначити перелік `manual`-residue.

## Considered Options
* Виділити `manual`-категорію (trufflehog/security ніколи не автофіксуються, завжди залишаються як residue)
* Фіксувати все автоматично, включно з trufflehog

## Decision Outcome
Chosen option: "фіксувати все", because user: «R-1. все фіксимо» — не було зазначено жодного винятку.

### Consequences
* Good, because Neutral, because transcript не містить підтвердження наслідку (механіка автофіксу trufflehog-знахідок не реалізована в сесії).
* Bad, because Neutral, because transcript не містить підтверджених негативних наслідків.

## More Information
Класифікація стратегії автофіксу per-tool зафіксована у специфікації `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md` (таблиця Tier0/Tier1+/never). Follow-up задача: конкретні per-tool omlx-фіксери для knip/jscpd/cspell/actionlint/zizmor/v8r/regal/trufflehog.
