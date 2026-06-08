---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T22:03:38+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

<adr_hook>
</thinking>

The transcript covers an iterative design review session for the `n-cursor graph` architecture documented in `docs/думка.MD`. Multiple design decisions were made and confirmed. I'll emit a separate ADR for each significant, independently addressable decision.

## ADR Гібридний sentinel запущеного вузла: `running_<pid>_until_<ts>`

## Context and Problem Statement
Файл `running_until_<ts>` фіксує що вузол виконується, але якщо процес впав аномально (`kill -9`, OOM), wrapper не має можливості прибрати sentinel. Вузол залишається у стані `stalled` назавжди без механізму автоматичного cleanup.

## Considered Options
* Варіант A: cleanup як перший крок нового запуску — wrapper перевіряє sentinel перед стартом
* Варіант B: PID у назві файлу (`running_<pid>_until_<ts>`) — будь-хто може перевірити `kill -0 <pid>`
* Гібрид A+B: PID і deadline в одному імені + cleanup при startup і при watch-скані

## Decision Outcome
Chosen option: "Гібрид A+B", because PID в імені файлу дозволяє детектувати живий/мертвий процес з `ls` без читання вмісту; wrapper при новому `graph run` і `n-cursor watch` виконують `kill -0 <pid>` — якщо мертвий, прибирають sentinel і worktree, переводять вузол у `failed`.

### Consequences
* Good, because стан залишається детермінованим з `ls` (інваріант збережено); cleanup автоматичний в обох точках входу без ручного втручання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `tasks/<node>/running_<pid>_until_<ts>` (git-ignored). Cleanup: `kill -0 <pid>` → ESRCH → видалити sentinel + orphan worktree → write `run_NNN.md` з `result: failed (crash)`.

---

## ADR Розподіл стану очікування: `waiting-plan` / `waiting-run`

## Context and Problem Statement
Специфікація давала стан `waiting` для двох принципово різних ситуацій: вузол без плану (потребує планування) і вузол з планом та розв'язаними залежностями (готовий до виконання). Крім того, `h.md`-вузли runner ніколи не обробляє автоматично, але вони теж потрапляли у `waiting`, що вводило в оману зовнішні інструменти й людей.

## Considered Options
* Залишити один `waiting` з суфіксом `:agent`/`:human` у виводі
* Розбити на `waiting` (агент) і `ready-human` (людина)
* Розбити за фазою (`waiting-plan` / `waiting-run`), де `a.md`/`h.md` визначають виконавця

## Decision Outcome
Chosen option: "розбити за фазою: `waiting-plan` / `waiting-run`", because стан описує що потрібно зробити далі, а `a.md`/`h.md` відповідає на питання хто це зробить — runner дивиться на стан + файл виконавця; старі `human-pending` і `needs-plan` зникають.

### Consequences
* Good, because зовнішні інструменти (`graph scan --json`, dashboard, CI) отримують однозначну семантику без читання файлів; runner ніколи не плутає `waiting-plan` з `waiting-run`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Runner-матриця: `waiting-plan + a.md` → auto `graph plan --mode agent`; `waiting-plan + h.md` → skip + notify; `waiting-run + a.md` → auto `graph run`; `waiting-run + h.md` → skip + notify. Видалені стани: `human-pending`, `needs-plan`, старий `waiting`.

---

## ADR Крос-рівневі залежності через вкладену структуру `deps/`

## Context and Problem Statement
Файл у `deps/` іменувався як ідентифікатор dep-вузла без шляху, що дозволяло залежати тільки від сусідів у тій самій батьківській директорії. Вузли на різних гілках дерева (`tasks/research/analyze/` і `tasks/reporting/generate-report/`) не могли мати залежність між собою.

## Considered Options
* Абсолютний шлях у назві файлу через `__` як роздільник (`research__analyze.md`)
* Вміст файлу містить `ref:` зі шляхом (порушує інваріант без читання вмісту)
* Вкладена структура в `deps/`, що дзеркалює `tasks/` (`deps/research/analyze.md`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "вкладена структура в `deps/`, що дзеркалює `tasks/`", because повністю зберігає інваріант (стан з `ls -R deps/`); сусідні deps залишаються простими (`deps/collect-data.md`), крос-рівневі стають вкладеними (`deps/research/analyze.md`); обрізання `.md` суфікса дає dep-id у вигляді відносного шляху від `tasks/`.

### Consequences
* Good, because deps satisfaction: `ls -R deps/` → обрізати `.md` → dep-id → шукати `tasks/<dep-id>/fact_*.md` без читання вмісту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Deps satisfaction для `deps/research/analyze.md`: dep-id = `research/analyze`, перевірити `tasks/research/analyze/fact_*.md`.

---

## ADR Явний `fact_NNN.md` для composite вузлів

## Context and Problem Statement
Composite вузол не мав власного `fact_NNN.md` — стан `resolved` визначався рекурсивним обходом усіх нащадків при кожному `graph scan`. При глибоких деревах це O(глибина × вузли) `ls`-викликів на кожен тік watch.

## Considered Options
* Залишити implicit resolved + додати `.n-cursor/graph-index.json` (порушує принцип без центрального файлу стану)
* Явний `fact_NNN.md` для composite, який пише оркестратор після merge останньої дитини
* Ліниве просування через `.child-done/` sentinels у батьківській директорії

## Decision Outcome
Chosen option: "явний `fact_NNN.md` для composite", because уніфікує перевірку стану для всіх типів вузлів; wrapper після `graph done <child>` перевіряє чи всі сусіди resolved — якщо так, пише `fact_NNN.md` у батька і рекурсивно йде вгору по дереву.

### Consequences
* Good, because scan стає O(n) замість O(n×depth); стан composite перевіряється так само як атомарного — один `ls` у директорії вузла.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
NNN для composite: `count(fact_*.md) + 1` (без `run_NNN.md`, composite не виконує роботу сам). Cascade вгору: один merge → потенційно закриває весь ланцюг composite вузлів до кореня. При інвалідації дитини → `invalidated` sentinel у батька → після повторного resolve → `fact_002.md`.

---

## ADR Розширення `.md` для файлів у `deps/`

## Context and Problem Statement
Специфікація `docs/думка.MD` містила суперечність у трьох місцях: рядок 74 (структура) показував `<dep-node-id>` без розширення, рядки 248 і 242 (таблиця і приклад) — `<dep-node-id>.md`. `graph scan` зчитує ім'я файлу як dep-id — непослідовність ламає parsing скрипта.

## Considered Options
* Без розширення: dep-id = ім'я файлу напряму, без обробки
* З `.md`: обрізати суфікс при зчитуванні, консистентно з рештою контракту

## Decision Outcome
Chosen option: "`.md` розширення у всіх файлах `deps/`", because консистентно з `task.md`, `a.md`, `h.md`; природно працює з вкладеною структурою — `deps/research/analyze.md` → обрізати `.md` → dep-id = `research/analyze`.

### Consequences
* Good, because єдиний стандарт у всіх місцях специфікації; parsing: `ls deps/` → strip `.md` → dep-id.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінити рядок 74 у `docs/думка.MD`: `<dep-node-id>` → `<dep-node-id>.md`.

---

## ADR Повторний аудит через видалення `audit-result_NNN.md`

## Context and Problem Statement
`audit-result_NNN.md` вважався immutable. Якщо аудитор помилився або критерії змінились і потрібно перевірити той самий `fact_NNN.md` повторно — NNN вже зайнятий, механізму retry не існувало.

## Considered Options
* Новий `run_NNN.md` + новий `fact_NNN.md` при будь-якому retry (audit fail = invalid fact)
* Sub-NNN схема: `pending-audit_003a.md`, `pending-audit_003b.md`
* Зробити `audit-result_NNN.md` deletable; `graph audit-retry` видаляє його, watch перезапускає аудит

## Decision Outcome
Chosen option: "`audit-result_NNN.md` deletable — `graph audit-retry`", because audit trail зберігається через git history; команда `graph audit-retry <path>` видаляє `audit-result_NNN.md` → watch бачить `pending-audit_003.md` без result → запускає новий аудит того самого факту; новий `run` потрібен тільки якщо сам факт невалідний.

### Consequences
* Good, because простий retry без нового run; git history зберігає запис про провал аудиту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Тільки `audit-result_NNN.md` — deletable. `pending-audit_NNN.md` і `fact_NNN.md` — immutable. Команда: `graph audit-retry <path>`.

---

## ADR Примусова міграція схеми при релізі нової версії

## Context and Problem Statement
При зміні схеми файлів (`task.md`, `a.md`, `plan_NNN.md`) старі вузли в git не мали механізму міграції. `graph scan` на суміші старих і нових файлів міг давати silently некоректні стани.

## Considered Options
* `schema_version:` у frontmatter кожного файлу + підтримка кількох версій одночасно
* Примусова одностороння міграція при релізі нової версії `n-cursor`

## Decision Outcome
Chosen option: "примусова міграція при релізі", because при upgrade `n-cursor` запускається `graph migrate` — всі файли приводяться до поточної схеми одразу; у будь-який момент часу всі файли на одній версії; `schema_version:` у файлах непотрібний.

### Consequences
* Good, because transcript фіксує очікувану користь: немає потреби підтримувати кілька версій схеми одночасно; `graph scan` завжди працює з однорідними файлами.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Версія схеми = версія інструменту `n-cursor`, не поле у файлі. При breaking change — `graph migrate` скрипт (разовий).
