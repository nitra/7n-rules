---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T21:34:01+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Детектування `stalled` вузла через `running_<pid>_until_<ts>`

## Context and Problem Statement
У дизайні `n-cursor graph` (`docs/думка.MD`) стан `stalled` (процес завис або впав) мав бути відрізнений від `running` без читання вмісту файлів. Додатково: якщо процес завершується аномально (`kill -9`, OOM), sentinel-файл залишається на диску й блокує будь-який повторний запуск вузла.

## Considered Options
* **Варіант A** — cleanup-on-startup: wrapper перевіряє sentinel при старті нового run і прибирає orphan
* **Варіант B** — PID у назві файлу: `running_<pid>_until_<ts>` для перевірки `kill -0 <pid>` з `ls`
* **Варіант C** — окремий cleanup daemon

## Decision Outcome
Chosen option: "Гібрид A+B", because PID у назві файлу дозволяє детектувати живість процесу через `kill -0 <pid>` без читання вмісту, а cleanup-on-startup у wrapper і в `n-cursor watch` гарантує прибирання orphan-sentinel після аномального завершення в обох точках входу.

### Consequences
* Good, because transcript фіксує очікувану користь: стан `running` vs `stalled` визначається з `ls` без читання вмісту; orphan-sentinel після краша прибирається автоматично без ручного втручання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл sentinel: `tasks/<node>/running_<pid>_until_<ts>` (git-ignored). Cleanup-логіка: wrapper і `n-cursor watch` виконують `kill -0 <pid>`; якщо процес мертвий — видаляють sentinel і orphan worktree, пишуть `run_NNN.md` з `result: failed (crash)`. Поле `budget_hard_sec: 0` потребує окремої обробки: `ts = started_at + 0` означає deadline у минулому — sentinel не повинен створюватись або `0` треба трактувати як "без ліміту".

---

## ADR Інваріант: всі стани вузла — виключно з file listing

## Context and Problem Statement
Аудит дизайну `docs/думка.MD` показав: декілька станів (`waiting`, `blocked`, визначення `deps`) вимагали читання вмісту файлів (frontmatter `deps:`, поле `mode:`), що унеможливлювало O(1) скан стану без парсингу YAML.

## Considered Options
* Залишити часткове читання вмісту для окремих станів
* Ввести формальний інваріант і перепроектувати всі стани під нього

## Decision Outcome
Chosen option: "Формальний інваріант без читання вмісту", because детермінований стан з `ls` дає безкоштовне відновлення після збоїв, сумісність будь-якого зовнішнього інструменту (IDE, CI, shell script) без знання протоколу, і O(file count) складність watch-loop.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor watch`, `graph scan`, зовнішні monitors отримують повний граф станів через `ls` без парсингу.
* Bad, because інваріант накладає обмеження на майбутні розширення: будь-яка нова метадана яка повинна впливати на стан — мусить кодуватись у присутності або назві файлу, а не у вмісті.

## More Information
Інваріант зафіксований у `docs/думка.MD` рядок 405: "Інваріант: всі стани визначаються виключно переліком файлів і директорій — без читання вмісту." Реалізується через: `a.md`/`h.md` для mode, `running_<pid>_until_<ts>` для deadline, `deps/` directory для залежностей, numbered chains (`fact_NNN.md`, `run_NNN.md`) для результатів.

---

## ADR Mutable sentinel-файли `a.md`/`h.md` для mode вузла

## Context and Problem Statement
Потрібно було кодувати mode виконання вузла (agent або human) у спосіб що: 1) читається з `ls` без парсингу; 2) дозволяє зміну mode без руйнування git-history `task.md`; 3) підтримує стан "mode ще не визначено" для щойно створених вузлів.

## Considered Options
* `task_h.md` / `task_a.md` — mode у назві основного task-файлу
* Один sentinel `agent` (відсутність = human за замовчуванням)
* Dual sentinel `a.md` / `h.md` з третім станом "ні один не присутній"

## Decision Outcome
Chosen option: "Dual sentinel `a.md`/`h.md`", because зміна mode = `rm h.md && touch a.md` без торкання `task.md`; git-history місії зберігається; відсутність обох файлів дає корисний стан `unassigned`/`setup` (вузол існує, але ще не сконфігурований).

### Consequences
* Good, because transcript фіксує очікувану користь: `task.md` стабільний (immutable після `graph init`); перемикання mode — атомарна файлова операція; `unassigned` стан видимий у `graph status` без читання вмісту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`a.md` schema: frontmatter з `model_tier` (MIM|AVG|MAX) і `skills[]`. `h.md` schema: frontmatter з `qualification`. Обидва — mutable прапори (на відміну від immutable `task.md`, `plan_NNN.md`). Стан `unassigned` = `task.md` є, `a.md` і `h.md` відсутні. Зафіксовано у `docs/думка.MD` рядки 189–232.

---

## ADR Директорія `deps/` замість поля `deps:` у frontmatter

## Context and Problem Statement
Список залежностей вузла у форматі `deps:` у frontmatter `task.md` вимагав читання і парсингу YAML для отримання dep-переліку — порушення інваріанту file-listing. Також зміна deps після `graph init` вимагала редагування immutable файлу.

## Considered Options
* `deps:` поле у frontmatter `task.md`
* `deps/` директорія де ім'я файлу = dep-node-id

## Decision Outcome
Chosen option: "`deps/` директорія", because `ls deps/` = повний список залежностей без читання вмісту; deps satisfaction = перевірити `fact_*.md` у відповідній node-директорії; `deps/` відсутня або порожня = немає залежностей.

### Consequences
* Good, because transcript фіксує очікувану користь: deps-список з `ls`; файл `deps/<dep-id>.md` може опціонально містити `ref:` і контекст для агента (але це не впливає на стан).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`deps/collect-data.md` приклад: `ref: ../collect-data/fact_001.md` + опціональний контекст. Deps satisfaction (рядок 252 `docs/думка.MD`): `ls deps/` → для кожного dep-id → перевірити `fact_*.md` у `tasks/<dep-id>/`. Файли у `deps/` — immutable після worktree. Залишилось відкрите питання про cross-sibling deps (Вада №3 у розборі): Варіант C (вкладена `deps/` структура) ще не підтверджений.

---

## ADR Стани `waiting-plan` і `waiting-run` замість `waiting`/`human-pending`/`needs-plan`

## Context and Problem Statement
Стан `waiting` у попередній таблиці покривав два семантично різних випадки: `a.md` + deps resolved (runner запускає автоматично) і `h.md` + plan + deps resolved (runner ігнорує, чекає людину). Зовнішній monitor не міг розрізнити ці випадки без читання файлів. Крім того, `human-pending` і `needs-plan` дублювали різницю між "агент без плану" і "людина без плану" — хоча обидва стани означають одне: потрібен план.

## Considered Options
* Залишити `waiting` + окремий `ready-human` стан
* Перейменувати `waiting` на `ready`, залишити `human-pending` для всіх `h.md`
* `waiting-plan` / `waiting-run` де стан кодує "що потрібно", а `a.md`/`h.md` кодують "хто робить"

## Decision Outcome
Chosen option: "`waiting-plan` / `waiting-run`", because стани відповідають на питання "що потрібно далі" (план або запуск), а `a.md`/`h.md` відповідають на питання "хто це робить" — два ортогональних виміри не змішуються в одному стані. `human-pending` і `needs-plan` зникають як окремі стани.

### Consequences
* Good, because transcript фіксує очікувану користь: runner читає стан (що робити) + файл mode (хто робить) — однозначна логіка без спеціальних випадків; `graph status` показує однакову семантику для людських і агентських вузлів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нова таблиця станів (погоджена у transcript): `unassigned` (`task.md` без `a.md`/`h.md`), `waiting-plan` (`a.md` або `h.md` без `plan_*.md`), `waiting-run` (`plan_*.md` + deps resolved), `blocked` (`plan_*.md` + deps не resolved), `running`, `stalled`, `pending-audit`, `resolved`, `failed`, `invalidated`. Runner-логіка: `waiting-plan + a.md` → auto `graph plan --mode agent`; `waiting-plan + h.md` → skip + notify; `waiting-run + a.md` → auto `graph run`; `waiting-run + h.md` → skip + notify. Зміни ще не внесені у `docs/думка.MD` — pending оновлення специфікації.
