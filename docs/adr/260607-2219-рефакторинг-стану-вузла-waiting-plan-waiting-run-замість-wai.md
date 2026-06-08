---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T22:19:38+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Хороше питання. Через `deps/` — це reverse lookup: "хто з вузлів залежить від мене?" Це O(весь граф), не O(1).

Є симетричніший варіант — `children/` директорія, аналогічна `deps/`:

**Варіант A — `children/` directory**

Коли `graph plan` spawns дітей → записує `children/` у батьківський вузол:

```
tasks/build-api/
task.md
plan_001.md
a.md
children/
design       ← sentinel: ця дитина офіційно "усиновлена"
implement
test
design/         task.md ...
implement/      task.md ...
test/           task.md ...
```

Orphan = `ls tasks/build-api/*/task.md` − `ls tasks/build-api/children/` → різниця.
Pure `ls`, без читання вмісту. Симетрично з `deps/`.

**Варіант B — Orphan неможливий за конструкцією**

При re-plan `graph spawn` атомарно: пише нових дітей + видаляє старих з `children/`. Якщо дитина є у `children/` → не orphan ніколи. Але небезпечний якщо стара дитина вже `running`.

**Варіант C — Не детектувати, перекласти на cascade**

Orphan виникає тільки якщо cascade не спрацював (баг або ручна операція). `graph status --integrity` для ручної перевірки.

**Яка ситуація тебе турбує найбільше** — LLM re-planned і породив нові дочірні, а старі залишились? Чи щось інше?
[user]
children це окрема директорія для вузла ? чи я правильно розумію ?  Ні, мені здається дизайн ускладнити , поки мені подобається варіант С

------
---

OK this is the end of the session transcript that we are analyzing.

Please produce one or more ADR blocks now.
[assistant]
## ADR Рефакторинг стану вузла: `waiting-plan` / `waiting-run` замість `waiting` / `human-pending` / `needs-plan`

## Context and Problem Statement
Стан `waiting` охоплював дві різні ситуації: вузол готовий до автоматичного запуску агентом і вузол, що очікує дії людини. Runner ігнорував `h.md`-вузли, але зовнішній monitor або dashboard не міг розрізнити ці випадки без читання вмісту файлів. Стан `human-pending` покривав лише відсутність плану, але не готовність до виконання людиною.

## Considered Options
* Зберегти `waiting`, додати суфікс `waiting:agent` / `waiting:human` у `--json` output
* Розбити `waiting` на `waiting` (агент) і `ready-human` (людина)
* Переосмислити семантику: стан відповідає на "що потрібно" (`waiting-plan` / `waiting-run`), а `a.md`/`h.md` відповідає на "хто"

## Decision Outcome
Chosen option: "`waiting-plan` / `waiting-run` як ортогональні до `a.md`/`h.md`", because стан повинен описувати лише наступний крок (потрібен план чи можна запускати), а виконавець вже закодований у файлах-прапорцях. Старі стани `human-pending`, `needs-plan`, `waiting` видаляються.

### Consequences
* Good, because runner і зовнішні інструменти отримують однозначну семантику: `waiting-plan` → потрібен план, `waiting-run` → готово до виконання; виконавець читається з `a.md`/`h.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Таблиця маппінгу:
```
task.md + no a.md/h.md                              → unassigned
a.md або h.md, немає plan_*.md                      → waiting-plan
plan_*.md, deps resolved, no running_*, no fact_*   → waiting-run
plan_*.md, deps NOT resolved                        → blocked
```
Runner: `waiting-plan + a.md` → auto `graph plan`; `waiting-plan + h.md` → skip + notify; `waiting-run + a.md` → auto run; `waiting-run + h.md` → skip + notify.

---

## ADR Sentinel-файл `running_<pid>_until_<ts>` з гібридним cleanup (A+B)

## Context and Problem Statement
Попередній дизайн використовував `running_until_<ts>` для детектування `stalled`-вузлів, але не містив механізму автоматичного cleanup після аварійного завершення процесу (`kill -9`, OOM). Файл залишався на диску, граф застрягав у стані `stalled` назавжди без способу відновлення.

## Considered Options
* Варіант A: cleanup як перший крок нового `graph run` (перевірка при старті)
* Варіант B: PID у назві файлу `running_<pid>_until_<ts>` для детектування живого процесу
* Гібрид A+B

## Decision Outcome
Chosen option: "Гібрид A+B", because PID у назві дозволяє перевіряти живість процесу через `kill -0 <pid>` без читання вмісту, а cleanup при старті нового `graph run` і при кожному скані `n-cursor watch` забезпечує автоматичне відновлення.

### Consequences
* Good, because детектування мертвого процесу (`kill -0`) і cleanup відбуваються автоматично в двох точках входу; інваріант "стан з listing" зберігається.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Назва файлу: `running_<pid>_until_<ts>` де `ts = started_at + budget_hard_sec`. Watch: при `stalled` або `running + dead pid` → видалити sentinel, записати `run_NNN.md (result: failed)`, залишити worktree для debug. Файл `docs/думка.MD`.

---

## ADR `deps/` як вкладена директорія з підтримкою крос-рівневих залежностей

## Context and Problem Statement
`deps/` директорія дозволяла тільки горизонтальні залежності між siblings — вузол міг залежати лише від сусідів у тій самій батьківській директорії. Реальні графи потребують крос-рівневих залежностей між вузлами на різних гілках дерева.

## Considered Options
* Абсолютний шлях у назві файлу (`deps/research__analyze.md` з `__` як роздільником)
* Вміст файлу містить `ref:` шлях (порушує інваріант "без читання вмісту")
* `deps/` може бути вкладеною, ім'я файлу = шлях відносно `tasks/`

## Decision Outcome
Chosen option: "Варіант C — вкладена `deps/` директорія", because зберігає інваріант детектування стану через `ls` без читання вмісту; `ls -R deps/` дає повний шлях dep-вузла відносно `tasks/`; сусідні deps залишаються простими (`deps/collect-data.md`), крос-рівневі — вкладеними (`deps/research/analyze.md`).

### Consequences
* Good, because усуває структурне обмеження "тільки siblings"; після обрізання `.md` суфіксу dep-id відповідає шляху відносно `tasks/`; симетрично з Варіантом C для Вади №3.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Deps satisfaction: `ls -R deps/` → `research/analyze.md` → обрізати `.md` → шукати `tasks/research/analyze/fact_*.md`. Розширення `.md` — стандарт для всіх файлів у `deps/` (узгоджено з іменуванням `task.md`, `a.md`, `h.md`). Файл `docs/думка.MD`.

---

## ADR `fact_NNN.md` для composite вузлів — явний resolved стан

## Context and Problem Statement
Composite вузол не мав власного `fact_NNN.md` — його стан `resolved` визначався агрегацією всіх нащадків. Для перевірки стану composite `graph scan` рекурсивно обходив весь піддерево (O(глибина × вузли)), без "швидкого шляху".

## Considered Options
* Залишити як є, додати `.n-cursor/graph-index.json` (порушує принцип відсутності центрального файлу стану)
* Явний `fact_NNN.md` для composite, що пишеться автоматично після resolve останньої дитини

## Decision Outcome
Chosen option: "Явний `fact_NNN.md` для composite", because уніфікує перевірку стану для всіх типів вузлів; scan стає O(n) замість O(n×depth).

### Consequences
* Good, because transcript фіксує очікувану користь: `graph scan` не потребує рекурсивного обходу для визначення resolved стану composite вузла.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Тригер: `graph done <child>` wrapper після успішного merge перевіряє батька — якщо всі siblings мають `fact_*.md`, пише `fact_NNN.md` у батька (NNN = count існуючих + 1, `## Summary` = агрегація summary дітей). Рекурсія вгору до кореня або до composite з нерозв'язаними дітьми. При інвалідації дитини → cascade `invalidated` у батька; після re-resolve → `fact_002.md`. Файл `docs/думка.MD`.

---

## ADR Резюме провалів замість повного контексту `run_NNN.md`

## Context and Problem Statement
Агент при запуску отримував усі `run_NNN.md` у контексті. Після 10+ невдалих спроб обсяг historical context міг перевищити context window, що само по собі ставало причиною провалу — не через складність задачі, а через переповнення контексту.

## Considered Options
* `context_runs: auto` — передавати всі якщо < 50% context window, інакше обрізати від старих
* Передавати тільки секції `## Blockers` і `## Next Attempt` з усіх failed `run_NNN.md` як компактне резюме

## Decision Outcome
Chosen option: "Компактне резюме провалів", because агенту потрібно знати що вже спробували і чому не спрацювало — повний вміст `run_NNN.md` для цього не потрібен. Розмір резюме фіксований (N рядків) незалежно від кількості та обсягу провалів.

### Consequences
* Good, because context overflow неможливий при будь-якій кількості спроб; всі провали враховуються, не тільки останні 2; повні `run_NNN.md` залишаються для людського аудиту.
* Bad, because `## Blockers` і `## Next Attempt` стають обов'язковими при `result: failed` — без них резюме буде порожнє.

## More Information
Wrapper перед запуском агента: витягує `## Blockers` і `## Next Attempt` з усіх failed `run_NNN.md` → склеює у секцію `## Prior attempts (N failed)`. Секції `## Blockers` і `## Next Attempt` змінюють статус з опціональних на обов'язкові при `result: failed`. Файл `docs/думка.MD`.

---

## ADR Агент призначає `a.md`/`h.md` для дочірніх вузлів під час планування

## Context and Problem Statement
`graph plan` у composite режимі породжував дочірні вузли через `graph spawn`, але не призначав виконавця. Всі діти залишались у стані `unassigned`. Runner пропускав `unassigned`-вузли — граф застрягав без жодного повідомлення.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Агент пише `a.md`/`h.md` для кожної дитини як частину planning output", because призначення виконавця є природною частиною декомпозиції задачі — агент визначає не тільки структуру підграфу, але й хто виконує кожне підзавдання і з яким `model_tier`.

### Consequences
* Good, because `unassigned` стає виключно станом кореневого вузла після `graph init`; composite children завжди мають виконавця після spawn.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`unassigned` залишається валідним для кореня (`graph init` без `--mode`). Людина може перевизначити після spawn: `graph mode human tasks/<node>/`. Файл `docs/думка.MD`.

---

## ADR Обмеження паралельності агентів через чергу (`agent_concurrency`)

## Context and Problem Statement
`graph run --auto` міг spawn необмежену кількість агентських worktrees паралельно. На MacBook це призводило до disk saturation і resource exhaustion. При цьому людські worktrees не потребують обмеження — людина свідомо керує своїм робочим простором.

## Considered Options
* `max_worktrees` — загальний ліміт з `max_worktree_age` і забороною `budget_hard_sec: 0`
* Черга агентів з `agent_concurrency`, без обмежень на людські worktrees

## Decision Outcome
Chosen option: "`agent_concurrency` у `.n-cursor.json`", because проблема — неконтрольований spawning агентів, а не worktrees як концепція. Живі worktrees недоторканні. Людина вирішує сама скільки worktrees відкрити.

### Consequences
* Good, because чітке розділення: агентська черга обмежена, людська робота — ні; `max_worktree_age` не потрібен і не ризикує вбити живий процес.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`agent_concurrency: 5` — default у `.n-cursor.json`. Watch перед spawn: якщо живих агентських worktrees ≥ `agent_concurrency` → queue, чекати `touch .n-cursor/wake`. Людські worktrees (`h.md` + `--actor human`) не рахуються. Файл `docs/думка.MD`.

---

## ADR `graph kill` — повний cascade з `--no-cascade` як escape hatch

## Context and Problem Statement
При інвалідації вузла downstream-вузли можуть залежати від змістовного результату upstream, а не тільки від структури. Недетермінізм LLM унеможливлює автоматичне розрізнення "змістовно залежить" vs "структурно незалежний". Orphan-вузли після re-plan не потребують auto-cleanup.

## Considered Options
* Differential cascade (перевіряти чи змінився вміст `fact_NNN.md` після re-run)
* Повний cascade завжди + `--no-cascade` тільки за явним рішенням інженера
* Orphan detection через `children/` directory (симетрично до `deps/`)
* Orphan detection через `graph status --integrity` без авто-cleanup (Варіант C)

## Decision Outcome
Chosen option: "Повний cascade + `--no-cascade` escape hatch + orphan через `--integrity`", because correctness важливіша за ефективність; інвалідація кореня — рідкісний сценарій; `children/` директорія ускладнює дизайн без суттєвої потреби на MVP.

### Consequences
* Good, because консистентність ланцюга гарантована без необхідності читати вміст файлів; git revert відновлює вузли після `graph kill`.
* Bad, because при інвалідації кореня весь downstream перевиконується повністю.

## More Information
`graph kill <path>` Фаза 1: пише `invalidated` у `<path>/` і всіх нащадках; якщо PID живий — wrapper при завершенні бачить `invalidated` → не мержить → `run_NNN.md (result: killed)` → cleanup worktree. Фаза 2: `git rm -r tasks/<path>/ + git commit`. Undo: `git revert <kill-commit>`. Orphan detection: `graph status --integrity` — manual, не авто-cleanup. Файл `docs/думка.MD`.
