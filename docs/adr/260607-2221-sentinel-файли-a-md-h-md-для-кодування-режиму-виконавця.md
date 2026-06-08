---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T22:21:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Sentinel-файли `a.md`/`h.md` для кодування режиму виконавця

## Context and Problem Statement
Специфікація `docs/думка.MD` кодувала режим виконавця (агент/людина) в назві файлу задачі: `task_h.md` або `task_a.md`. Зміна режиму вимагала перейменування основного файлу місії, що руйнувало git history і ускладнювало трансфер задачі між виконавцями. Також не існувало способу виразити стан "режим ще не визначено".

## Considered Options
* Зберігати режим у назві основного файлу (`task_h.md`/`task_a.md`)
* Зберігати `mode:` у frontmatter `task.md`
* Окремі sentinel-файли `h.md`/`a.md` поряд зі стабільним `task.md`

## Decision Outcome
Chosen option: "Окремі sentinel-файли `h.md`/`a.md`", because зміна режиму зводиться до `rm h.md && touch a.md` без торкання файлу місії; git history `task.md` не рветься; відсутність обох файлів природно виражає стан `unassigned` (режим не визначено).

### Consequences
* Good, because `task.md` залишається стабільним артефактом після `graph init`; перемикання режиму атомарне і не потребує міграції даних.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `docs/думка.MD`, `a.md` schema (fields: `model_tier`, `skills`), `h.md` schema (field: `qualification`). Три стани через присутність: `h.md` є → `human-*`; `a.md` є → agent-flow; жодного → `unassigned`.

---

## ADR Стани `waiting-plan`/`waiting-run` замість `waiting`/`human-pending`/`needs-plan`

## Context and Problem Statement
Стан `waiting` у специфікації покривав два семантично різних випадки: вузол з `a.md` де runner запускає агента автоматично, і вузол з `h.md` + планом де runner нічого не робить. Зовнішній monitor чи dashboard не міг розрізнити ці випадки без читання вмісту файлів, що порушувало інваріант "стан визначається лише listing файлів". Також `human-pending` і `needs-plan` змішували два ортогональних питання: "що потрібно зробити" і "хто це робить".

## Considered Options
* Один стан `waiting` з субполем `actor` у JSON-виводі
* Окремий стан `ready-human` поряд із `waiting`
* Стани `waiting-plan`/`waiting-run` де стан = "що потрібно", `a.md`/`h.md` = "хто робить"

## Decision Outcome
Chosen option: "Стани `waiting-plan`/`waiting-run`", because стан відповідає на питання "що потрібно далі" (план чи запуск), а `a.md`/`h.md` відповідає на "хто" — без дублювання. Runner завжди перевіряє обидва: стан визначає дію, sentinel визначає виконавця.

### Consequences
* Good, because таблиця станів стає симетричною: `waiting-plan + a.md` → auto-plan; `waiting-plan + h.md` → skip + notify; `waiting-run + a.md` → auto-run; `waiting-run + h.md` → skip + notify.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені стани: `human-pending`, `needs-plan`, `waiting`. Нова повна таблиця станів атомарного вузла у `docs/думка.MD`. Runner-логіка: два виміри (стан × sentinel) замість одного.

---

## ADR `running_<pid>_until_<ts>` — гібридний підхід для stalled detection

## Context and Problem Statement
Sentinel-файл `running_until_<ts>` кодував deadline у назві для O(1) визначення стану `running`/`stalled` без читання вмісту. Але при аварійному завершенні процесу (`kill -9`, OOM) wrapper не міг виконати cleanup — файл залишався і вузол застрягав у `stalled` назавжди. Також не існувало способу перевірити чи процес живий без читання вмісту окремого lock-файлу.

## Considered Options
* Cleanup як перший крок нового `graph run` (Варіант A)
* PID у назві файлу `running_<pid>_until_<ts>` для перевірки через `kill -0` (Варіант B)
* Гібрид A+B

## Decision Outcome
Chosen option: "Гібрид A+B", because PID у назві файлу дозволяє `kill -0 <pid>` без читання вмісту; wrapper при старті нового run і watch при кожному скані виконують однаковий cleanup: якщо процес мертвий → видалити sentinel → перевести у `failed`.

### Consequences
* Good, because стан `stalled` vs `running` детектується з `ls` (парсинг імені); cleanup автоматичний у двох точках без ручного втручання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Формат: `running_<pid>_until_<ts>` де `ts = started_at + budget_hard_sec`. Stalled condition: `ts + grace_period ≤ now()` (`grace_period: 60` у `.n-cursor.json` для clock skew). Файл git-ignored. Cleanup: `kill -0 <pid>` → якщо ESRCH → видалити sentinel → записати `run_NNN.md` з `result: failed (crash)`.

---

## ADR `deps/` директорія з вкладеною структурою для крос-рівневих залежностей

## Context and Problem Statement
Залежності між вузлами спочатку описувались через `deps:` frontmatter у `task.md` — що вимагало читання вмісту для визначення залежностей і порушувало інваріант "стан із listing". Перехід на `deps/` директорію (ім'я файлу = dep-id) вирішив інваріант, але підтримував тільки залежності між сусідніми вузлами (siblings). Реальні складні графи потребують крос-рівневих залежностей.

## Considered Options
* `deps/<dep-node-id>` без розширення — flat структура, тільки siblings
* `deps/<dep-node-id>.md` з `.md` — flat структура з конвенцією розширення
* Вкладена `deps/` де шлях файлу = шлях dep-вузла відносно `tasks/`

## Decision Outcome
Chosen option: "Вкладена `deps/` з `.md` розширенням", because `ls -R deps/` + strip `.md` суфікса дає повний відносний шлях dep-вузла; сусідні deps залишаються простими (`deps/collect-data.md`), крос-рівневі виражаються вкладенням (`deps/research/analyze.md`); інваріант без читання вмісту зберігається.

### Consequences
* Good, because deps satisfaction: `ls -R deps/` → strip `.md` → dep-id → перевірити `tasks/<dep-id>/fact_*.md`; жодного читання вмісту не потрібно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `deps/<path>.md` може містити опціональний `ref:` та контекст — але читається тільки агентом для збагачення контексту, не для визначення стану.

---

## ADR Явний `fact_NNN.md` для composite вузлів

## Context and Problem Statement
Composite вузол не мав власного `fact_NNN.md` — його стан `resolved` визначався рекурсивним обходом усіх нащадків. При глибокому дереві `graph scan` виконував O(глибина × вузли) `ls`-викликів. Зовнішній інструмент не міг перевірити стан composite вузла без обходу всього піддерева.

## Considered Options
* Залишити implicit resolved (рекурсивний обход)
* `fact_NNN.md` для composite — пише wrapper при merge останнього дочірнього
* Ліниве просування через sentinel `.child-done/<id>` у батьківській директорії

## Decision Outcome
Chosen option: "`fact_NNN.md` для composite", because уніфікує перевірку стану для всіх типів вузлів — `fact_*.md` є → `resolved`, незалежно від atomic чи composite; scan стає O(n) замість O(n×depth).

### Consequences
* Good, because transcript фіксує очікувану користь: `graph done` wrapper після merge останнього дочірнього перевіряє батька, пише `fact_NNN.md`, рекурсивно перевіряє вище — один merge може закрити весь ланцюг composite вузлів за один прохід.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
NNN для composite = `count(fact_*.md) + 1`. `## Summary` = агрегація `## Summary` всіх дочірніх. При cascade invalidation: батько отримує `invalidated` sentinel; після повторного resolve дочірніх — новий `fact_NNN.md`. Реалізація: `graph done` wrapper, файл `npm/scripts/graph/done.mjs` (або аналог).

---

## ADR Hash-based differential cascade при invalidation

## Context and Problem Statement
При інвалідації вузла весь downstream граф переходить у `invalidated` і потребує повного re-run. Якщо причина інвалідації зовнішня (зміна audit policy, уточнення вимог) але результат виконання вузла незмінний — downstream ре-ранується марно.

## Considered Options
* Full re-run (проста поведінка без оптимізацій)
* Hash у frontmatter `fact_NNN.md` — порівняння при re-run для вибіркового cascade

## Decision Outcome
Chosen option: "Hash у frontmatter `fact_NNN.md`", because якщо вузол після invalidation видав той самий результат (однаковий hash секції `## Result`) — downstream залишається `resolved` без жодного re-run; якщо різний — каскад продовжується стандартно.

### Consequences
* Good, because читання вмісту відбувається тільки один раз при `graph done`, не під час `watch` scans — інваріант "стан без читання" не порушується на рівні state detection.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поле у `fact_NNN.md` frontmatter: `hash: sha256:<hash секції ## Result>`. `graph done` порівнює hash нового і попереднього `fact_NNN.md`. Однаковий → видалити `invalidated` у залежних → вони повертаються у `resolved`. Різний → залежні залишаються `invalidated`.

---

## ADR "Prior attempts" резюме замість повних `run_NNN.md` у контексті агента

## Context and Problem Statement
Агент при запуску отримував повний список `run_NNN.md` файлів у контексті. Після багатьох невдалих спроб context window заповнювався — що само по собі ставало причиною наступного `failed`. Також успішно виконані частини попередніх спроб не були явно виділені, і агент міг повторювати вже зроблену роботу.

## Considered Options
* Передавати всі `run_NNN.md` у контекст
* Передавати тільки останні N `run_NNN.md` (фіксований ліміт)
* Адаптивний вибір на основі розміру context window
* Компактне резюме з обов'язкових секцій: `## Completed`, `## Blockers`, `## Next Attempt`

## Decision Outcome
Chosen option: "Компактне резюме з обов'язкових секцій", because розмір резюме фіксований (N рядків) незалежно від кількості спроб; агент отримує саме те що потрібно: що вже зроблено (не повторювати), чому провалилось (не повторювати), де починати.

### Consequences
* Good, because `## Completed` дозволяє наступному агенту пропустити вже виконану роботу; context overflow неможливий незалежно від кількості попередніх спроб.
* Bad, because `## Completed`, `## Blockers`, `## Next Attempt` стають обов'язковими при `result: failed` — агент при провалі зобов'язаний заповнити їх; без них резюме буде порожнім.

## More Information
Повні `run_NNN.md` залишаються у директорії вузла для людського аудиту та `graph status`. При `result: success` — обов'язкові `## Completed` + `## Summary` (для composite агрегації). Wrapper генерує резюме перед запуском агента без LLM-виклику — тільки парсинг секцій.

---

## ADR `audit-result_NNN.md` — deletable для повторного аудиту

## Context and Problem Statement
Специфікація описувала `audit-result_NNN.md` як immutable artifact. При провалі аудиту (аудитор помилився або критерії змінились) потрібен повторний аудит того самого `fact_NNN.md`. NNN вже зайнятий — не існувало механізму retry без створення нового `run_NNN.md` і нового `fact_NNN.md`.

## Considered Options
* Повторний аудит вимагає нового `run_NNN.md` → новий `fact_NNN.md` → новий NNN
* Sub-NNN (`pending-audit_003a.md`) для повторних аудитів
* `audit-result_NNN.md` — deletable; `graph audit-retry` видаляє файл для retry

## Decision Outcome
Chosen option: "`audit-result_NNN.md` — deletable", because видалення `audit-result_NNN.md` повертає вузол у стан `pending-audit`; watch автоматично перезапускає аудит того самого `fact_NNN.md`; audit trail зберігається через git history навіть після видалення.

### Consequences
* Good, because повторний аудит не вимагає нового виконання задачі якщо сам факт валідний; команда `graph audit-retry <path>` проста у реалізації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команда: `graph audit-retry <path>` — видаляє `audit-result_NNN.md` де NNN = pending без result. `pending-audit_NNN.md` залишається (immutable). Новий `run_NNN.md` потрібен тільки якщо аудитор відхилив сам факт як некоректний.
