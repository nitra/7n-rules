---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T17:15:15+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

Запис файлу очікує дозволу. Ось згенеровані ADR-блоки — вони готові до збереження у `docs/adr/260614-1942-уніфікація-lint-fix-дві-осі-поглинання-conformance-ci-read-only.md`:

---

## ADR Два осі lint: scope × behavior (--full, --read-only)

## Context and Problem Statement
Команда `lint` підтримувала лише один режим. З'явилася потреба розрізняти масштаб перевірки (delta-файли vs весь репо) та поведінку (авто-фікс vs тільки детект), щоб один інструмент міг обслуговувати як CI-середовище, так і локальні хуки.

## Considered Options
* Окремі команди для кожного режиму (`fix`, `check`, `lint`)
* Дві незалежні ознаки `--full` і `--read-only` на одній команді `lint`

## Decision Outcome
Chosen option: "Дві незалежні ознаки `--full` і `--read-only` на одній команді `lint`", because це дозволяє комбінувати масштаб і поведінку без множення команд, а `n-cursor lint [--full] [--read-only] [<rules...>]` покриває всі чотири квадранти матриці.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка входу замість `fix`/`check`/`lint-text` з несумісними семантиками.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/lint-cli.mjs`, `npm/bin/n-cursor.js`. Публічні команди `fix`, `check`, `fix-run` видалено з CLI; `_fix-check` і `fix-t0` залишено як внутрішні фази рушія.

---

## ADR lint --full поглинає conformance-фазу (раніше — fix)

## Context and Problem Statement
Раніше команда `fix` запускала conformance-рушій (convergence engine + LLM). Після видалення `fix` як публічної команди треба було зберегти conformance-перевірку в доступному місці.

## Considered Options
* Залишити `fix` як публічну команду паралельно з `lint`
* Включити conformance як фазу в `lint --full`

## Decision Outcome
Chosen option: "Включити conformance як фазу в `lint --full`", because `lint --full` вже охоплює весь репо, і додавання conformance робить його справжнім надмножиною `fix` без дублювання точок входу.

### Consequences
* Good, because transcript фіксує очікувану користь: `lint` стає єдиним супернабором для повної перевірки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/lint-cli.mjs`, `npm/bin/n-cursor.js`. Команди `fix`, `check`, `fix-run` видалено з `n-cursor` CLI.

---

## ADR lint приймає фільтр правил (колишній fix \<rules\>)

## Context and Problem Statement
Pre-commit хук `hk.pkl` викликав `fix changelog` для фільтрованої conformance. Після видалення `fix` треба перенести цю семантику.

## Considered Options
* Окрема команда `lint-rules <rules...>`
* Позиційні аргументи `n-cursor lint [--read-only] <rules...>`

## Decision Outcome
Chosen option: "Позиційні аргументи `n-cursor lint [--read-only] <rules...>`", because це мінімальна зміна поверхні API: `fix changelog` → `lint changelog` без нових підкоманд.

### Consequences
* Good, because transcript фіксує очікувану користь: `hk.pkl` оновлено одним рядком заміни.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл хука: `hk.pkl`. Зміна: `N_CURSOR_CHANGELOG_AUTOFIX=1 bun ./npm/bin/n-cursor.js fix changelog` → `N_CURSOR_CHANGELOG_AUTOFIX=1 bun ./npm/bin/n-cursor.js lint changelog`.

---

## ADR PostToolUse хук — read-only детект без маршрутизації файл→правила

## Context and Problem Statement
PostToolUse хук раніше містив таблицю маршрутизації `ROUTES`/`routeFilePathToRules`, що відображала змінений файл на набір правил conformance. Після переходу до read-only режиму доцільність цієї маршрутизації стала предметом питання з боку користувача.

## Considered Options
* Зберегти `ROUTES`/`routeFilePathToRules` для точкового запуску правил
* Видалити маршрутизацію, викликати один детект для всіх активованих правил

## Decision Outcome
Chosen option: "Видалити маршрутизацію, викликати один детект для всіх активованих правил", because маршрутизація була потрібна, коли `fix` був дорогим (convergence + LLM); у read-only режимі без автофіксу/LLM вартість єдиного виклику незначна і складність таблиці не виправдана.

### Consequences
* Good, because transcript фіксує очікувану користь: спрощення `post-tool-use-fix.mjs` і його тестів (з 211 до компактного файлу без `routeFilePathToRules`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/post-tool-use-fix.mjs`, `npm/scripts/tests/post-tool-use-fix.test.mjs`.

---

## ADR Переміщення conformance-рушія з npm/skills/fix/js/ до npm/scripts/lib/fix/

## Context and Problem Statement
Файли рушія (`orchestrator.mjs`, `t0.mjs`, `llm-worker.mjs`) фізично знаходилися в `npm/skills/fix/js/` — всередині директорії skill. Видалення skill-директорії знищило б рушій разом із нею.

## Considered Options
* Залишити рушій у `npm/skills/fix/js/` і не видаляти skill
* Перемістити рушій до `npm/scripts/lib/fix/` перед видаленням skill

## Decision Outcome
Chosen option: "Перемістити рушій до `npm/scripts/lib/fix/`", because `npm/scripts/lib/` — стандартне місце для спільних модулів, а переміщення дозволяє безпечно видалити `npm/skills/fix/` без втрати логіки.

### Consequences
* Good, because transcript фіксує очікувану користь: `npm/skills/fix/` видалено чисто, import-шляхи оновлено в `npm/bin/n-cursor.js` і `npm/scripts/lint-cli.mjs`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові шляхи: `npm/scripts/lib/fix/orchestrator.mjs`, `npm/scripts/lib/fix/t0.mjs`, `npm/scripts/lib/fix/llm-worker.mjs`. Імпорти оновлено в `npm/bin/n-cursor.js` і `npm/scripts/lint-cli.mjs`.

---

## ADR Гілка для рефакторингу: нова feature-branch замість main

## Context and Problem Statement
Рефакторинг lint/fix-підсистеми випадково виконувався на `main` замість feature-гілки. Паралельна гілка `claude/quirky-lederberg-4306d8` містила роботу з doc-файлами (3 коміти), яку не можна було суміщати з lint-рефакторингом.

## Considered Options
* Варіант A: лишити зміни на `main`, відгалузити quirky-lederberg від нового main
* Варіант B: створити нову гілку `claude/lint-fix-readonly-unification`, скинути `main` до `origin/main`, переключитися на feature-гілку

## Decision Outcome
Chosen option: "Варіант B: нова гілка `claude/lint-fix-readonly-unification` + скидання `main`", because quirky-lederberg мав незалежну (частково запушену) роботу з doc-файлами, яку не можна було змішувати; нова назва відображає фактичний зміст роботи.

### Consequences
* Good, because transcript фіксує очікувану користь: ізоляція двох незалежних напрямів роботи; `claude/quirky-lederberg-4306d8` лишився незайманим.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команди: `git branch claude/lint-fix-readonly-unification 91eab517`, `git reset --hard origin/main`, `git checkout claude/lint-fix-readonly-unification`. Фінально злито в `main` через fast-forward merge.

---

## ADR Паралельний ESLint: дозволено для диз'юнктних файлів, заборонено для whole-tree

## Context and Problem Statement
Попередня політика забороняла будь-який паралельний запуск ESLint, що надмірно обмежувало per-file lint на різних файлах.

## Considered Options
* Повна заборона будь-якого паралельного ESLint
* Дозволити паралельність лише для диз'юнктних наборів файлів, серіалізувати whole-tree прогони того самого корпусу

## Decision Outcome
Chosen option: "Дозволити паралельність лише для диз'юнктних наборів файлів, серіалізувати whole-tree прогони того самого корпусу", because диз'юнктні per-file набори не конфліктують і не перевантажують диск/CPU; дублювання важкого full-scan — реальна проблема лише для whole-tree.

### Consequences
* Good, because transcript фіксує очікувану користь: прискорення паралельних per-file lint без ризику конфліктів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Оновлено: `CLAUDE.md` (через `buildClaudeLintParallelismSectionLines` у `npm/bin/n-cursor.js`) і `npm/skills/lint/SKILL.md`.

---

## ADR CI lint-text і lint-style — read-only без авто-фіксу

## Context and Problem Statement
`lint-style.yml` викликав `npx stylelint --fix` (мутує файли в CI), `lint-text.yml` — `bun run lint-text` (також мутує). CI-середовище має лише детектувати порушення, не виправляти їх. Перша спроба змінити воркфлоу без оновлення канону зламала `checkText` (formatting.mjs вимагає конкретний рядок команди).

## Considered Options
* Залишити авто-фікс у CI як зручність
* Перейти на read-only режим у всіх CI lint-воркфлоу з синхронним оновленням канону

## Decision Outcome
Chosen option: "Перейти на read-only режим у всіх CI lint-воркфлоу з синхронним оновленням канону", because CI має бути детерміновано; правила enforcement (formatting.mjs + Rego) вимагають синхронного оновлення всіх точок.

### Consequences
* Good, because transcript фіксує очікувану користь: CI тепер лише детектує, не мутує репо під час перевірки; `n-cursor` — workspace-symlink на локальне джерело, тож `--read-only` доступний у CI без додаткової установки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `.github/workflows/lint-text.yml` (`bun run lint-text` → `n-cursor lint-text --read-only`), `.github/workflows/lint-style.yml` (видалено `--fix`). Синхронно оновлено: `npm/rules/text/js/formatting.mjs`, `npm/rules/text/policy/lint_text/lint_text_test.rego`, `npm/rules/text/policy/lint_text/template/lint-text.yml.snippet.yml`, `npm/rules/style-lint/policy/lint_style_yml/lint_style_yml_test.rego`, `npm/rules/style-lint/style-lint.mdc`, `.cursor/rules/n-text.mdc`.

---

## ADR Повне видалення скіла /n-fix

## Context and Problem Statement
Скіл `/n-fix` існував як тимчасовий делегат до `/n-lint` після першого рефакторингу. Рушій conformance переміщено до `npm/scripts/lib/fix/`, тобто каталог `npm/skills/fix/` вже не містив логіки.

## Considered Options
* Залишити `/n-fix` як alias для `/n-lint` для зворотної сумісності
* Повністю видалити `/n-fix`

## Decision Outcome
Chosen option: "Повністю видалити `/n-fix`", because делегат без логіки лише ускладнює навігацію; `/n-lint` є повноцінною заміною.

### Consequences
* Good, because transcript фіксує очікувану користь: `ALL_SKILLS` у `npm/scripts/tests/auto-skills.test.mjs` очищено від `'fix'`, три дзеркальні шляхи видалено.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені шляхи: `npm/skills/fix/SKILL.md`, `npm/skills/fix/meta.json`, `.cursor/skills/n-fix/SKILL.md`, `.claude/commands/n-fix.md`. Оновлено: `npm/scripts/tests/auto-skills.test.mjs` (фікстури `ALL_SKILLS` і очікувані масиви результатів).
