---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T08:36:17+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

Продукую ADR-документацію безпосередньо з транскрипту.

---

## ADR Вісь поведінки `fix`/`--read-only` в lint-оркестраторі

## Context and Problem Statement
Lint-оркестратор `lint-cli.mjs` мав лише вісь scope (`quick`/`ci`) і **завжди** застосовував автофікс (oxlint `--fix`, eslint `--fix` тощо). Окремий `n-cursor fix`-скіл (convergence-loop + check-gate + LLM) є ортогональним двигуном, але закриває ту саму семантичну потребу — виправлення порушень. CI-середовище не може мутувати дерево, тому необхідний режим «лише детект».

## Considered Options
* Ввести прапор `--read-only` (аліас `--check`): fix за замовчуванням, read-only за потреби
* Окремі підкоманди (`lint detect` / `lint fix`)

## Decision Outcome
Chosen option: "Прапор `--read-only`", because це точно відповідає формулюванню користувача та не потребує зміни всіх точок виклику.

### Consequences
* Good, because `--read-only` повертає exit 1 на будь-якій знахідці і не мутує жодного файлу — інваріант підтверджується тестом `git diff` байт-у-байт.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
Файл специфікації: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`. Exit-code семантика: fix-режим — exit 1 лише на невиправному залишку; read-only — exit 1 на будь-якій знахідці; обидва режими виводять лише «що не так».

---

## ADR Поглинання `n-cursor fix` lint-оркестратором без аліасу

## Context and Problem Statement
Існували два паралельні виконавчі шляхи: `lint-cli.mjs` для зовнішніх тулів (oxlint, eslint, cspell…) і `skills/fix/js/orchestrator.mjs` з convergence-loop (Tier0 детермінований → check-gate → Tier1+ LLM haiku→sonnet). Дублювання ускладнювало підтримку й розмивало семантику «виправлення».

## Considered Options
* Поглинути `fix`-двигун у lint як fix-режим, видалити `fix` без аліасу
* Залишити `fix` як делегувальний аліас до наступного major
* Зберегти обидва незалежно

## Decision Outcome
Chosen option: "Поглинути `fix`-двигун у lint як fix-режим, видалити `fix` без аліасу", because зворотна сумісність не потрібна; аліас — зайвий шар без цінності (рішення користувача).

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка входу, convergence-loop + check-gate + LLM-ескалація стають fix-режимом lint; `fix.mjs` + `check()` + Rego policy стають concern-ами під контрактом `lint(files, cwd, { readOnly })`.
* Bad, because Усі поточні виклики `n-cursor fix` (хуки, CI, скрипти) ламаються без переходу.

## More Information
Мапа переходу: `fix` → `lint` (fix-режим); `fix-t0` → Tier 0; `_fix-check --json` → `lint --read-only --json`; `fix.mjs` + `check()` + policy → concern-и. Per-tool LLM-фіксери для detect-only тулів **відкладені** як задача-наступник після реалізації основної специфікації.

---

## ADR Видалення прапора `--ci` — CI = `--read-only --full`

## Context and Problem Statement
Існував окремий прапор `--ci` та хелпер `effectiveCi(rule)`, що змішував вісь scope і вісь поведінки в одному полі `meta.json:lint.ci`. Через нову двовісну модель (scope × behavior) `--ci` став надлишковим.

## Considered Options
* Залишити `--ci` як аліас для `--read-only --full`
* Видалити `--ci` і `effectiveCi`; CI використовує `--read-only --full`

## Decision Outcome
Chosen option: "Видалити `--ci` і `effectiveCi`; CI використовує `--read-only --full`", because спрощує модель до двох незалежних прапорів без додаткового шару абстракції; аліас не потрібен (рішення користувача).

### Consequences
* Good, because `meta.json:lint.ci`-поле видаляється; `effectiveCi`-хелпер видаляється; модель стає чистою: `lint [--full] [--read-only]`.
* Bad, because Всі GA workflow та скрипти, що використовують `--ci`, потребують оновлення на `--read-only --full`.

## More Information
Зміни внесено в `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` (amendment O-1). GA CI workflow: `n-cursor lint --read-only --full`.

---

## ADR Заміна scope-осі `quick/ci` на diff-vs-origin / `--full`

## Context and Problem Statement
Стара вісь scope розрізняла `quick` (лише змінені файли) і `ci` (весь репо), але термінологія прив'язувала поведінку до середовища виконання, а не до наміру.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "default = дельта vs origin; `--full` = весь репо", because узгоджується з канонічною специфікацією `2026-06-14-lint-rule-consolidation.md`; явний `--full` замість неявного «я в CI».

### Consequences
* Good, because Дві незалежні осі (`--full` і `--read-only`) комбінуються вільно: `lint` (дельта+fix), `lint --read-only` (дельта+detect, pre-commit), `lint --full` (весь+fix), `lint --read-only --full` (весь+detect, CI).
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
Канонічна специфікація scope: `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`. Важкі тули (jscpd, knip) отримують `scope:"full"` і запускаються лише при `--full`.

---

## ADR LLM-ескалація через omlx замість хмарних моделей

## Context and Problem Statement
Поточний `fix`-скіл використовував хмарний LLM (haiku→sonnet) для Tier1+ ескалації. Detect-only тули (jscpd, knip, cspell, trufflehog тощо) потребують стратегії автофіксу в новому fix-режимі lint; хмарні виклики повільні й залежать від мережі.

## Considered Options
* Використовувати хмарні Claude-моделі (haiku→sonnet) напряму
* Використовувати omlx (локальний MLX-сервер) або mimo code; хмара лише як фолбек

## Decision Outcome
Chosen option: "omlx або mimo code; хмара лише як фолбек через `resolveModel()`", because локальні моделі швидші й не залежать від мережі; `npm/lib/llm.mjs` вже маршрутизує `omlx/<model>` → прямий HTTP (`callOmlx`), хмара залишається в каскаді.

### Consequences
* Good, because Tier1+ LLM-ескалація через `lib/llm.mjs`/`resolveModel()` з локальним omlx-сервером; env `N_LOCAL_MIN_MODEL=omlx/…` вже задокументовано.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
`npm/lib/models.mjs`, `npm/lib/llm.mjs` (`callOmlx`), `resolveModel(tier)`. Per-tool LLM-фіксери для кожного detect-only тула **відкладені** як окрема задача після реалізації основної специфікації.

---

## ADR Скасування заборони паралельного запуску eslint/oxlint

## Context and Problem Statement
`CLAUDE.md` та `scripts.mdc` забороняли паралельний запуск eslint/oxlint у будь-якому контексті через побоювання перевантаження диску/CPU. Нова архітектура оркестратора з sharding по файлах робить заборону надмірною.

## Considered Options
* Залишити заборону незмінною
* Зняти заборону для паралельних запусків по диз'юнктних shard-ах файлів

## Decision Outcome
Chosen option: "Зняти заборону для паралельних запусків по диз'юнктних shard-ах", because паралельний eslint/oxlint по різних файлах не конкурує за одні й ті самі ресурси (рішення користувача).

### Consequences
* Good, because Оркестратор може паралелізувати прогін по shard-ах, прискорюючи lint великих наборів файлів.
* Bad, because `CLAUDE.md` і `scripts.mdc` потребують оновлення відповідних секцій — вписано як крок 6 плану реалізації у специфікації.

## More Information
Файли до оновлення: `CLAUDE.md` (секція «Лінт і ESLint»), `.cursor/rules/scripts.mdc`. Специфікація: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`, крок 6 плану.

---

## ADR Обов'язковий lint для всіх правил, включно з раніше непокритими

## Context and Problem Statement
Частина правил (`n-adr`, `n-bun`, `n-changelog`, `n-feedback`, `n-vue`, `n-worktree`) не мала lint-фази. Інтерфейс виклику був неуніфікованим: частина через оркестратор, частина — прямими командами.

## Considered Options
* Уніфікувати контракт лише для правил, що вже мають lint (без розширення покриття)
* Всі checkable-правила отримують lint-реалізацію; єдина точка входу через оркестратор

## Decision Outcome
Chosen option: "Всі checkable-правила отримують lint-реалізацію; єдина точка входу через оркестратор", because повна уніфікація усуває клас «правило є, але lint немає» і дозволяє оркестратору покривати весь проєкт.

### Consequences
* Good, because transcript фіксує очікувану користь: усі правила беруть участь у lint; контракт `lint(files, cwd, { readOnly })` однаковий для всіх; індивідуальні `lint-<x>`-скрипти в кореневому ланцюжку прибираються.
* Bad, because Потрібна реалізація lint-фази для шести раніше непокритих правил.

## More Information
Правила без lint-фази на момент сесії: `n-adr`, `n-bun`, `n-changelog`, `n-feedback`, `n-vue`, `n-worktree`. Concern-модель: `external-tool` / `check` / `policy` — уніфікує колишній розрив між lint- і fix-світами.
