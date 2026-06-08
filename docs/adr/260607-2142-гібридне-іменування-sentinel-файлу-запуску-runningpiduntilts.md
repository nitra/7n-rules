---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T21:42:38+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Гібридне іменування sentinel-файлу запуску: `running_<pid>_until_<ts>`

## Context and Problem Statement
Sentinel-файл `running_until_<ts>` у директорії вузла сигналізує про активне виконання. Якщо процес завершився аномально (`kill -9`, OOM, crash хоста), wrapper не встигає видалити файл — вузол залишається в стані `stalled` назавжди і не може бути перезапущений без ручного втручання.

## Considered Options
* Варіант A — cleanup як перший крок нового `graph run`: wrapper перевіряє `running_until_*` і прибирає stale sentinel перед стартом
* Варіант B — PID у назві файлу: `running_<pid>_until_<ts>`, щоб будь-хто міг перевірити `kill -0 <pid>` без читання вмісту
* Гібрид A+B — поєднати обидва: PID у назві + cleanup при старті та при кожному скані

## Decision Outcome
Chosen option: "Гібрид A+B: `running_<pid>_until_<ts>` + cleanup-on-start", because PID у назві файлу дозволяє детектувати живий/мертвий процес через `kill -0 <pid>` без читання вмісту (інваріант зберігається), а cleanup при старті нового `graph run` і при кожному тіку `n-cursor watch` забезпечує автоматичне відновлення після краша.

### Consequences
* Good, because стан `running` vs `stalled` vs "мертвий процес" визначається виключно з `ls` + `kill -0 <pid>` — без читання вмісту файлу, інваріант не порушується.
* Good, because transcript фіксує очікувану користь: автоматичний cleanup у двох точках входу (wrapper старт + watch скан) усуває ручне втручання.
* Bad, because `budget_hard_sec: 0` (вимкнено) створює `running_<pid>_until_<started_at>` з deadline у минулому — sentinel миттєво виглядає як `stalled`; обробка цього edge case у специфікації не описана.

## More Information
Sentinel-файл: `tasks/<node>/running_<pid>_until_<ts>` (git-ignored).
Перевірка живого процесу: `kill -0 <pid>` (тільки перевірка наявності, без сигналу).
Watch-логіка: при `ts ≤ now()` або `kill -0 <pid>` → ESRCH → cleanup sentinel + worktree, пише `run_NNN.md` з `result: failed (stalled-or-crash)`.

---

## ADR Стани `waiting-plan` і `waiting-run` замість `waiting`/`human-pending`/`needs-plan`

## Context and Problem Statement
Попередній дизайн мав стан `waiting` що покривав два семантично різні випадки: вузол чекає автоматичного запуску агентом, і вузол чекає ручної дії людини. Runner ігнорує `h.md`-вузли повністю, тому `waiting` з `h.md` ніколи не переходить у `running` автоматично — але назва вводить в оману зовнішні інструменти і людей. Також існував окремий стан `human-pending` для `h.md` без плану і `needs-plan` для агента без плану — два стани що виражали одне: "потрібен plan".

## Considered Options
* Розбити `waiting` на `waiting` (агент) і `ready-human` (людина)
* Зберегти `waiting` як назву, розширити `human-pending` на всі `h.md`-вузли
* `waiting-plan` / `waiting-run` — стани відображають "що потрібно зробити", а не "хто робить"

## Decision Outcome
Chosen option: "`waiting-plan` / `waiting-run`", because стан повинен відповідати на питання "що потрібно далі", а `a.md`/`h.md` вже відповідають на питання "хто виконує" — ці два виміри ортогональні і не повинні змішуватись в одному ідентифікаторі стану. Визначення хто виконує — відповідальність runner'а: він читає присутність `a.md` або `h.md` і діє відповідно.

### Consequences
* Good, because transcript фіксує очікувану користь: таблиця станів стає симетричною; `waiting-plan + a.md` → auto plan, `waiting-plan + h.md` → skip + notify; `waiting-run + a.md` → auto run, `waiting-run + h.md` → skip + notify.
* Good, because видаляються три старі стани (`waiting`, `human-pending`, `needs-plan`) і замінюються двома більш точними — зменшується когнітивне навантаження.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фінальна таблиця маппінгу (атомарний вузол):

| Файли | Стан |
|---|---|
| `task.md`, немає `a.md`/`h.md` | `unassigned` |
| `a.md` або `h.md`, немає `plan_*.md` | `waiting-plan` |
| `plan_*.md`, deps resolved, немає `running_*`, немає `fact_*` | `waiting-run` |
| `plan_*.md`, deps НЕ resolved | `blocked` |

Runner-логіка: `waiting-plan + a.md` → `graph plan --mode agent`; `waiting-plan + h.md` → skip+notify; `waiting-run + a.md` → `graph run`; `waiting-run + h.md` → skip+notify.
Файл специфікації: `docs/думка.MD`.

---

## ADR Вкладена структура `deps/` для міжрівневих залежностей

## Context and Problem Statement
Директорія `deps/` кодує залежності вузла: ім'я файлу = ідентифікатор dep-вузла. Але без шляху в імені файлу система може виражати тільки горизонтальні залежності (між siblings). Вузол на одній гілці дерева не може залежати від вузла на іншій гілці без штучної зміни топології графу.

## Considered Options
* Варіант A — ім'я файлу з `__` як роздільником рівнів (`deps/research__analyze.md`)
* Варіант B — шлях у вмісті файлу (`ref: ../../research/analyze`) — порушує інваріант читання
* Варіант C — `deps/` дзеркалює структуру `tasks/`: `deps/research/analyze.md` → `tasks/research/analyze/`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Варіант C — вкладена структура `deps/` що дзеркалює `tasks/`", because `ls -R deps/` дає повний шлях відносно `tasks/` без читання вмісту — інваріант зберігається; прості сусідні deps залишаються плоскими (`deps/collect-data.md`), крос-рівневі — вкладені (`deps/research/analyze.md`).

### Consequences
* Good, because deps satisfaction без читання вмісту: `ls -R deps/` → шлях → шукати `tasks/<path>/fact_*.md`.
* Good, because transcript фіксує очікувану користь: зворотна сумісність — прості deps не змінюються.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — вкладена структура в `deps/` ускладнює переміщення вузлів (потрібно оновити `deps/` у всіх залежних вузлах).

## More Information
Приклад: `tasks/reporting/generate-report/deps/research/analyze.md` → залежність від `tasks/research/analyze/`.
Deps satisfaction: `ls -R deps/` → для кожного шляху → перевірити наявність `tasks/<path>/fact_*.md`.
Файл специфікації: `docs/думка.MD`, секція `deps/`.

---

## ADR Явний `fact_NNN.md` для composite-вузлів, що пишеться `graph done` wrapper'ом

## Context and Problem Statement
Composite-вузол не виконує роботу сам — його стан `resolved` визначався як "всі діти resolved". Це вимагало рекурсивного обходу всіх нащадків при кожному скані, що давало O(глибина × кількість вузлів) перевірок. Крім того, стан composite і атомарного вузлів перевірялися по-різному — окрема логіка без уніфікації.

## Considered Options
* Варіант A — залишити implicit resolved, додати `.n-cursor/graph-index.json` для кешування
* Варіант B — явний `fact_NNN.md` для composite, що пишеться оркестратором автоматично
* Варіант C — `tasks/<parent>/.child-done/<child>` sentinel при переході дитини в `resolved`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Варіант B — явний `fact_NNN.md` для composite, написаний `graph done` wrapper'ом після merge останнього дочірнього вузла", because це уніфікує перевірку стану для всіх типів вузлів (scan стає O(n) замість O(n×depth)); trigger — merge дочірнього worktree — є природною точкою де wrapper вже має контекст і може рекурсивно перевіряти батька.

### Consequences
* Good, because стан composite визначається так само як атомарного: `fact_*.md` є → `resolved`; `ls` O(1) без рекурсії.
* Good, because transcript фіксує очікувану користь: один merge може закрити весь ланцюг composite-вузлів вгору за один рекурсивний прохід.
* Bad, because при інвалідації дитини потрібно cascade: `invalidated` sentinel у батька, потім при повторному resolve дитини — новий `fact_NNN.md` (NNN = count + 1); ця логіка каскадної інвалідації у transcript окреслена, але деталі не специфіковані.

## More Information
Trigger: `graph done <child-path>` після успішного merge worktree.
Логіка: перевірити всі siblings → якщо всі мають `fact_*.md` → write `tasks/<parent>/fact_NNN.md`; `## Summary` = агрегація `## Summary` дітей; рекурсивно перевірити `tasks/<grandparent>/`.
NNN для composite: `count(існуючих fact_*.md) + 1` (без `run_NNN.md`).
Файл специфікації: `docs/думка.MD`.
