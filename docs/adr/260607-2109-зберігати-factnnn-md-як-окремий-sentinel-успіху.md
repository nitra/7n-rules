---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T21:09:26+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Зберігати `fact_NNN.md` як окремий sentinel успіху

## Context and Problem Statement
У дизайні `n-cursor graph` потрібно фіксувати результат виконання вузла. Виникло питання: чи може `run_NNN.md` із полем `status: done|failed` замінити окремий `fact_NNN.md`, щоб зменшити кількість типів файлів.

## Considered Options
* `run_NNN.md` з `status: done|failed` замінює і `fact_NNN.md`, і окремий fail-файл
* Зберегти `fact_NNN.md` як sentinel присутності + `run_NNN.md` для детального журналу

## Decision Outcome
Chosen option: "Зберегти `fact_NNN.md` як sentinel присутності", because визначення стану `resolved` через `glob('fact_*.md').length > 0` — O(1) без читання вмісту; якби `run_NNN.md` нести результат, оркестратор мав би читати кожен `run_*.md` (може бути N спроб на вузол) щоб знайти `status: done`, що порушує інваріант zero-content-read.

### Consequences
* Good, because `resolved` стан визначається присутністю файлу — O(1) directory listing.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `tasks/<node>/fact_NNN.md`, `tasks/<node>/run_NNN.md`. Правило: `run_NNN.md` без `fact_NNN.md` і без активного worktree → стан `failed`.

---

## ADR Інваріант: всі стани вузла визначаються без читання вмісту файлів

## Context and Problem Statement
Оркестратор (`n-cursor watch`, `graph run --auto`) сканує потенційно великий граф задач. Аудит показав, що окремі стани (`human-pending`, `waiting`) потребували читання `task.md` для поля `mode:`, а залежності — читання `deps:` списку з frontmatter. Це робило scan дорогим при масштабуванні.

## Considered Options
* Читати frontmatter `task.md` для визначення mode і deps (поточний підхід)
* Перекодувати всю стан-визначальну інформацію в імена файлів і присутність файлів/директорій

## Decision Outcome
Chosen option: "Перекодувати в імена файлів і присутність", because це формалізує інваріант: `ls` достатньо для визначення будь-якого з 10 станів вузла, що робить scan O(1) per-node без IO на вміст.

### Consequences
* Good, because transcript фіксує очікувану користь: scan без читання вмісту; можливість легкого масштабування до великих графів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Інваріант зафіксований у `docs/думка.MD` секція "Стани вузла": "Інваріант: всі стани визначаються виключно переліком файлів і директорій — без читання вмісту."

---

## ADR Стан `stalled` через `running_until_<ts>` sentinel у назві файлу

## Context and Problem Statement
Вузол у стані `running` (активний worktree) може зависнути — перевищити `budget_hard_sec`. Стан "завис" (`stalled`) не існував у попередньому дизайні, тому оркестратор не міг відрізнити активну роботу від зависання без читання конфігів і перевірки mtime worktree.

## Considered Options
* Implicit: watch сам вирішує kill → `failed`; окремого стану немає
* Sentinel-файл `stalled` (watch мутує стан при виявленні)
* Timestamp у `run_NNN.md` (watch дописує `stalled_at:`)
* `running_until_<ts>` — git-ignored файл у директорії вузла; deadline = `started_at + budget_hard_sec` закодований у назві

## Decision Outcome
Chosen option: "`running_until_<ts>` файл з deadline у назві", because назва файлу містить deadline — `ts > now()` → `running`, `ts ≤ now()` → `stalled`; визначення без читання вмісту, відповідає інваріанту.

### Consequences
* Good, because `stalled` визначається parse назви файлу — zero content reads; відповідає інваріанту zero-content-read.
* Good, because відсутність `running_until_*` + наявний worktree = orphan → treat as stalled (safe fallback).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `tasks/<node>/running_until_<unix-timestamp>` (git-ignored). Watch-логіка: якщо файл є і `ts ≤ now()` → `stalled` → kill → запис у `run_NNN.md(reason: timeout)`. Документ: `docs/думка.MD`.

---

## ADR `a.md`/`h.md` мутабельні sentinel-прапори замість перейменування `task.md`

## Context and Problem Statement
Потрібно розрізнити `human-pending` та `waiting` станів без читання вмісту (інваріант). Перший підхід — `task_h.md`/`task_a.md` (mode у назві основного файлу) — вирішував проблему, але `git mv task_h.md task_a.md` руйнує git history асоціацію при зміні виконавця. Виникло питання: як дозволити зміну mode без торкання основного файлу місії.

## Considered Options
* `task_h.md`/`task_a.md` — mode закодований у назві основного task-файлу
* `task.md` (стабільний) + окремі sentinel-файли `a.md`/`h.md`

## Decision Outcome
Chosen option: "`task.md` + `a.md`/`h.md` sentinel-прапори", because `task.md` залишається стабільним (git history не рвється); зміна mode = `rm h.md && touch a.md`; відсутність обох прапорів дає третій корисний стан `unassigned`/`setup` (mode ще не визначено).

### Consequences
* Good, because `task.md` зберігає повну git history; зміна mode — неруйнівна операція.
* Good, because transcript фіксує корисність стану `setup`/`unassigned` — вузол створений, але ще не призначений виконавцю.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`a.md` — frontmatter: `model_tier`, `skills`; `h.md` — frontmatter: `qualification`. Обидва — мутабельні (як `invalidated`). Стани: `a.md` є → `waiting`; `h.md` є + без `plan_*.md` → `human-pending`; жодного → `setup`/`unassigned`. Документ: `docs/думка.MD`.

---

## ADR `deps/` директорія замість `deps:` поля у frontmatter

## Context and Problem Statement
Залежності вузла (`deps:`) зберігались у frontmatter `task.md`. Щоб дізнатись список залежностей, оркестратор мав читати вміст файлу — порушення інваріанту zero-content-read. Також неможливо було передати контекст від dep-вузла агенту без додаткових механізмів.

## Considered Options
* `deps:` список у frontmatter `task.md` (поточний підхід)
* `deps/` директорія: кожен файл = один dep-вузол; вміст файлу = опціональний ref + контекст

## Decision Outcome
Chosen option: "`deps/` директорія", because `ls deps/` → список dep-ID без читання вмісту; файл `deps/<dep-id>.md` містить `ref:` і контекст — агент читає лише коли потрібно.

### Consequences
* Good, because "Які залежності?" → `ls deps/` — відповідає інваріанту zero-content-read.
* Good, because transcript фіксує очікувану користь: контекст від dep зберігається поруч з посиланням у `deps/<dep-id>.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Структура: `tasks/<node>/deps/<dep-node-id>.md`. Вміст (приклад): `ref: ../collect-data/fact_001.md#results\nВикористовувати лише перші 50 записів.` Перевірка виконання dep: `fact_*.md` у директорії відповідного dep-вузла. Документ: `docs/думка.MD`.
