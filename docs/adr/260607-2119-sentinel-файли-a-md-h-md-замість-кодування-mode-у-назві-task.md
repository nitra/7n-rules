---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T21:19:42+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Based on the transcript, I need to output ADR documentation for the design decisions made in this session.

## ADR Sentinel-файли `a.md`/`h.md` замість кодування mode у назві task-файлу

## Context and Problem Statement
Система потребувала розрізнення між "виконується агентом" та "виконується людиною" для кожного вузла графу. Перші варіанти кодували mode у назві основного файлу місії (`task_h.md`/`task_a.md`), що призводило до деструктивних rename-операцій при зміні mode і втрати git history.

## Considered Options
* Код у назві task-файлу: `task_h.md` / `task_a.md`
* Окремий sentinel-файл: `a.md` (agent) / `h.md` (human) / відсутність обох = unassigned/setup

## Decision Outcome
Chosen option: "Окремий sentinel-файл `a.md`/`h.md`", because зміна mode зводиться до `rm h.md && touch a.md` без торкання основного файлу місії, зберігається git history `task.md`, і з'являється третій стан `unassigned`/`setup` (жоден sentinel відсутній) без додаткової логіки.

### Consequences
* Good, because transcript фіксує очікувану користь: mode-switch = 2 shell-команди, `task.md` immutable, `unassigned` корисний для UI як "ці вузли потребують конфігурації".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `docs/думка.MD` (рядки 65–101, 189–232). Mutable-флаги: `a.md`, `h.md`, `invalidated`, `running_until_<pid>_<ts>`. Immutable: `task.md`, `plan_NNN.md`, `run_NNN.md`, `fact_NNN.md`, `deps/`.

---

## ADR Стан вузла визначається виключно через listing файлової системи (без читання вмісту)

## Context and Problem Statement
У попередньому дизайні стан `human-pending` вимагав читання фронтматеру `task.md` (поле `mode:`), а перевірка залежностей — читання `deps:` зі списку. При великих графах і частому watch-циклі це перетворювалося на N file-reads на кожен скан.

## Considered Options
* Зберігати явний стан у центральному файлі (state.json)
* Derived state з читанням фронтматеру кожного файлу
* Derived state виключно з переліку файлів і директорій (presence + filename parse)

## Decision Outcome
Chosen option: "Derived state виключно з переліку файлів і директорій", because presence-check = O(1) на вузол; будь-який зовнішній інструмент читає граф без знання протоколу; відновлення після збою тривіальне через `ls`.

### Consequences
* Good, because transcript фіксує очікувану користь: watch-loop = чистий O(file count), `running_until_<pid>_<ts>` у назві файлу дає deadline без читання, `a.md`/`h.md` дають mode без читання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `docs/думка.MD` рядок 405 (інваріант). Контракт: `invalidated` > `resolved` > `pending-audit` > `stalled` > `running` > `waiting`/`blocked` > `human-pending` > `unassigned` > `failed`. Стан `stalled`: `running_until_<pid>_<ts>` де `ts ≤ now()`.

---

## ADR Директорія `deps/` замість поля `deps:` у фронтматері

## Context and Problem Statement
Залежності між вузлами зберігались у полі `deps:` фронтматеру `task.md`. Це порушувало інваріант "стан з listing": перевірка залежностей вимагала читання і парсингу YAML.

## Considered Options
* `deps:` список у фронтматері `task.md`
* Директорія `deps/` де ім'я кожного файлу = ідентифікатор залежного вузла

## Decision Outcome
Chosen option: "Директорія `deps/` з файлами-залежностями", because `ls deps/` дає список залежностей без читання вмісту; файл в `deps/` може опціонально містити `ref:` та контекст, доступний агенту лише коли потрібен; наявність/відсутність `deps/` = відсутність залежностей.

### Consequences
* Good, because transcript фіксує очікувану користь: deps satisfaction = `ls deps/` + перевірка `fact_*.md` у кожному dep-вузлі; `task.md` спрощується (немає `mode:`, `executor:`, `deps:`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `docs/думка.MD` рядки 236–259. Формат: `deps/<dep-node-id>.md`. Приклад: `deps/collect-data.md` з `ref: ../collect-data/fact_001.md` + текст контексту.

---

## ADR Стан `stalled` через `running_until_<pid>_<ts>` у назві файлу

## Context and Problem Statement
У початковому дизайні не було явного стану "вузол завис" — тільки `running`. Watch не міг відрізнити живий процес від процесу що застряв або загинув без cleanup, без читання файлів або PID-перевірок.

## Considered Options
* Implicit: watch вбиває `running` вузол за таймаутом без окремого стану
* Sentinel файл `stalled` (watch пише при виявленні)
* Deadline у назві worktree директорії
* Deadline + PID у назві sentinel-файлу `running_until_<ts>`

## Decision Outcome
Chosen option: "Hybrid: `running_<pid>_until_<ts>` як sentinel + cleanup-on-start (wrapper перевіряє `kill -0 <pid>` при новому запуску)", because deadline кодується у назві файлу (детектується з `ls`), PID дозволяє перевіряти чи процес живий без читання вмісту, а cleanup-on-start гарантує відновлення після краша при наступному `graph run`.

### Consequences
* Good, because transcript фіксує очікувану користь: `stalled` = presence + filename parse, watch + wrapper обидва роблять cleanup, `budget_hard_sec: 0` потребує спеціальної обробки (deadline = минуле).
* Bad, because transcript фіксує відкрите питання: clock skew на distributed FS може зробити `ts ≤ now()` некоректним.

## More Information
Файли: `docs/думка.MD` рядки 407–460 (таблиця станів), рядки 682–750 (wrapper). Формат sentinel: `tasks/<node>/running_<pid>_until_<unix-ts>`. Перевірка: `kill -0 <pid>` (нульовий сигнал = тільки перевірка існування, без вбивства).

---

## ADR Стан `unassigned`/`setup` як явний третій стан mode

## Context and Problem Statement
Попередні варіанти кодування mode передбачали обов'язкове визначення mode при `graph init`. З появою sentinel-файлів `a.md`/`h.md` виникла можливість третього стану — коли жоден з них не присутній.

## Considered Options
* `graph init` без `--mode` забороняється (завжди обов'язковий)
* Відсутність сентинела = default (наприклад, human за замовчуванням)
* Відсутність обох сентинелів = окремий стан `unassigned`/`setup`

## Decision Outcome
Chosen option: "`unassigned`/`setup` як явний стан", because вузол може бути створений до прийняття рішення хто виконує; watch нагадує про неконфігуровані вузли; UI може виводити "ці вузли потребують конфігурації" без читання вмісту.

### Consequences
* Good, because transcript фіксує очікувану користь: корисний для UI, не блокує `graph init` без обов'язкових параметрів.
* Bad, because transcript фіксує ризик: у повністю автономному pipeline вузли у `unassigned` блокують виконання без механізму auto-assignment.

## More Information
Файли: `docs/думка.MD` рядок 20 (список станів), рядки 409–415 (таблиця станів). Поточний документ використовує `setup` у списку станів і `unassigned` у таблиці — неконсистентність потребує вирішення.
