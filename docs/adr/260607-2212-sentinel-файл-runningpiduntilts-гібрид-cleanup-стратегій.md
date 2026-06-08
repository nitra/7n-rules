---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T22:12:44+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Sentinel-файл `running_<pid>_until_<ts>` — гібрид cleanup стратегій

## Context and Problem Statement
Дизайн використовував `running_until_<ts>` як sentinel для активного виконання. При аномальному завершенні процесу (`kill -9`, OOM) файл не видалявся, вузол застрягав у стані `stalled` без механізму автоматичного відновлення.

## Considered Options
* Варіант A — cleanup як перший крок нового запуску (wrapper перевіряє sentinel при старті)
* Варіант B — PID у назві файлу: `running_<pid>_until_<ts>`
* Гібрид A+B — обидва механізми одночасно

## Decision Outcome
Chosen option: "Гібрид A+B", because PID у назві дозволяє будь-кому перевірити `kill -0 <pid>` без читання вмісту (зберігає інваріант "стан = listing"), а cleanup-on-startup в wrapper гарантує відновлення при наступному `graph run` навіть якщо watch не встиг.

### Consequences
* Good, because `stalled` стає автоматично відновлюваним у двох точках: watch при кожному скані та wrapper при старті нового run. Детектується з `ls` без читання вмісту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`, секція "Стани вузла".
Команда перевірки живого процесу: `kill -0 <pid>` (0-сигнал — не вбиває, лише перевіряє існування).
Мутабельні sentinel-файли: `a.md`, `h.md`, `invalidated`, `running_<pid>_until_<ts>`.

---

## ADR Таблиця станів: `waiting-plan` і `waiting-run` замість `waiting` / `human-pending`

## Context and Problem Statement
Стан `waiting` охоплював два семантично різних випадки: вузол без плану і вузол з планом готовий до виконання. Водночас вузли з `h.md` runner ігнорував повністю — але назва `waiting` не давала цього зрозуміти зовнішньому спостерігачеві. Виявлено, що стан `human-pending` так само надлишковий: runner ніколи не діє на `h.md`-вузли незалежно від наявності плану.

## Considered Options
* Зберегти `waiting`, додати `ready-human` як окремий стан для `h.md` + plan
* Розширити `human-pending` на всі `h.md`-вузли (з планом і без)
* Розбити `waiting` на `waiting-plan` (немає плану) і `waiting-run` (план є, deps resolved)

## Decision Outcome
Chosen option: "Розбити на `waiting-plan` / `waiting-run`", because стан відповідає на питання "що потрібно далі" (план чи виконання), а `a.md`/`h.md` відповідає на питання "хто". Runner комбінує обидва: `waiting-plan + a.md → auto plan`, `waiting-plan + h.md → skip + notify`.

### Consequences
* Good, because симетрична таблиця станів; видалені `human-pending` і `needs-plan`; runner-логіка стає декларативною і однозначною для зовнішніх інструментів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`, секція "Стани вузла".
Видалені стани: `human-pending`, `needs-plan`, `waiting`.
Нові стани: `waiting-plan`, `waiting-run`.
Runner завжди читає пару (стан + наявність `a.md`/`h.md`) для визначення дії.

---

## ADR `deps/` — вкладена структура для крос-рівневих залежностей

## Context and Problem Statement
`deps/` директорія підтримувала лише сусідні вузли: ім'я файлу = dep-id без шляху. Вузли на різних рівнях ієрархії (наприклад `tasks/reporting/generate-report/` залежить від `tasks/research/analyze/`) не мали способу виразити залежність без порушення логічної структури графу.

## Considered Options
* Абсолютний шлях у назві файлу з `__` як роздільником рівнів
* Вміст файлу `deps/*.md` містить `ref:` зі шляхом (порушує інваріант без читання)
* Вкладена структура `deps/` дзеркалює структуру `tasks/`

## Decision Outcome
Chosen option: "Вкладена структура `deps/`", because `ls -R deps/` дає повний шлях відносно `tasks/` без читання вмісту, зберігає інваріант. Сусідні deps залишаються простими (`deps/collect-data.md`), крос-рівневі — вкладені (`deps/research/analyze.md`).

### Consequences
* Good, because крос-рівневі залежності тепер виразимі; інваріант "стан = listing" збережено; зворотна сумісність для сусідніх deps.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`, секція `deps/`.
Алгоритм: `ls -R deps/` → `research/analyze.md` → обрізати `.md` → dep-id = `research/analyze` → шукати `tasks/research/analyze/fact_*.md`.
Всі файли у `deps/` мають розширення `.md` (узгоджено одночасно з Вадою №5).

---

## ADR Явний `fact_NNN.md` для composite вузлів

## Context and Problem Statement
Composite вузли не мали власного `fact_NNN.md`. Стан `resolved` визначався рекурсивним обходом усіх нащадків — O(глибина × вузли) при кожному `graph scan`. Не існувало "швидкого шляху" для перевірки стану кореня без повного обходу дерева.

## Considered Options
* Залишити implicit resolved, додати індекс у `.n-cursor/graph-index.json`
* Явний `fact_NNN.md` для composite, який пишеться оркестратором автоматично
* Ліниве просування стану через sentinel у батьківській директорії

## Decision Outcome
Chosen option: "Явний `fact_NNN.md` для composite", because уніфікує перевірку стану для всіх типів вузлів: `resolved` = `fact_*.md` є. Scan стає O(n) замість O(n×depth).

### Consequences
* Good, because перевірка `resolved` для composite — O(1) `ls`; `graph done` wrapper автоматично закриває ланцюг composite вузлів вгору при merge останнього дочірнього вузла, рекурсивно до кореня.
* Bad, because потрібен додатковий крок в оркестраторі: wrapper після merge дитини перевіряє всіх siblings і пише `fact_NNN.md` у батька якщо всі resolved. Cascade рекурсивно вгору.

## More Information
Файл: `docs/думка.MD`, секції "Стани вузла", "Wrapper-скрипт".
Тригер: `graph done <child>` → `ls <parent>/*/fact_*.md` → якщо всі resolved → write `<parent>/fact_NNN.md`.
NNN для composite = `count(fact_*.md) + 1` (без `run_NNN.md`, бо composite не виконує роботу сам).

---

## ADR `audit-result_NNN.md` — deletable при retry аудиту

## Context and Problem Statement
Всі артефакти вузла вважалися immutable. При провалі аудиту і потребі повторної перевірки того самого `fact_NNN.md` — NNN вже зайнятий `audit-result_NNN.md`. Специфікація не описувала цей сценарій.

## Considered Options
* Новий run + новий `fact_NNN.md` при кожному повторному аудиті
* Sub-NNN нумерація (`pending-audit_003a.md`)
* `audit-result_NNN.md` deletable; `pending-audit_NNN.md` залишається

## Decision Outcome
Chosen option: "`audit-result_NNN.md` deletable", because `graph audit-retry <path>` видаляє лише result; watch бачить `pending-audit_NNN.md` без відповідного `audit-result_NNN.md` → запускає новий аудит того самого `fact_NNN.md`. Audit trail зберігається у git history.

### Consequences
* Good, because простий retry без нового run; NNN не конфліктує; git history зберігає видалені результати.
* Bad, because `audit-result_NNN.md` — єдиний артефакт-файл вузла який є deletable, що порушує загальний принцип immutability артефактів.

## More Information
Файл: `docs/думка.MD`, секції `pending-audit_NNN.md`, `audit-result_NNN.md`.
Команда: `graph audit-retry <path>` → `rm audit-result_NNN.md` де NNN = останній pending без result.
Оновлений список mutable файлів: `a.md`, `h.md`, `invalidated`, `running_<pid>_until_<ts>`, `audit-result_NNN.md` (deletable only).

---

## ADR Примусова міграція схеми при релізі `n-cursor`

## Context and Problem Statement
Відсутність `schema_version:` у файлах створювала ризик silently некоректних станів при змішаній версії файлів після оновлення `n-cursor`. Тривалі графи (тижні роботи) неминуче містили б файли різних версій.

## Considered Options
* `schema_version:` у frontmatter кожного файлу
* Принцип "семантика у структурі файлів" без версійності
* Примусова міграція (`graph migrate`) при кожному major upgrade

## Decision Outcome
Chosen option: "Примусова міграція при релізі", because `graph migrate` при upgrade приводить всі файли до поточної схеми одразу. Змішаних версій у директорії ніколи не існує. `schema_version:` у файлах не потрібен.

### Consequences
* Good, because завжди одна версія схеми; немає conditional logic у `scan`/`status`/`run`.
* Bad, because `graph migrate` — обов'язковий крок при major upgrade. CLI потребує guard: якщо виявлено файли старої схеми → вимагати `graph migrate` перед продовженням.

## More Information
Файл: `docs/думка.MD`.
Команда: `graph migrate` — обходить усі `task.md`, оновлює структуру до поточної схеми.

---

## ADR `plan_NNN.md` не містить поля `mode:`

## Context and Problem Statement
`plan_NNN.md` frontmatter містив `mode: human | agent`. Після введення `a.md`/`h.md` як єдиного джерела правди для mode — поле стало дублюванням. Перемикання mode після створення плану (видалили `h.md`, створили `a.md`) лишало в плані застарілу `mode: human`, що суперечило поточному стану.

## Considered Options
* Залишити `mode:` у плані як snapshot mode на момент планування
* Видалити `mode:` з `plan_NNN.md`

## Decision Outcome
Chosen option: "Видалити `mode:` з `plan_NNN.md`", because план описує "що робити", не "хто і як". Агент завжди читає `a.md`/`h.md` для актуального mode. Одне джерело правди для mode.

### Consequences
* Good, because усунуто ризик суперечності між планом і поточним mode; `plan_NNN.md` симетричний до `task.md` — обидва без `mode:`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`, секція `plan_NNN.md`.

---

## ADR Summary невдалих спроб замість повного контексту `run_NNN.md`

## Context and Problem Statement
Агент при запуску отримував всі `run_NNN.md` у context. Після 10+ невдалих спроб розмір context міг перевищити window моделі, що само по собі ставало причиною наступного `failed`. Навіть на моделях з великим вікном старі спроби створювали шум, а не цінність.

## Considered Options
* Передавати останні N `run_NNN.md` (N=2 як default)
* `context_runs: auto` — передавати всі якщо сума < 50% context window
* Wrapper витягує `## Blockers` і `## Next Attempt` з кожного failed run → компактне summary

## Decision Outcome
Chosen option: "Summary невдалих спроб", because агенту потрібно знати "що не треба робити", а не повний reasoning. Розмір summary — O(N рядків) незалежно від кількості і розміру оригінальних файлів. Покриває всю глибину провалів.

### Consequences
* Good, because context фіксованого розміру; повні `run_NNN.md` залишаються для людського аудиту; охоплює всі провали, не тільки останні N.
* Bad, because `## Blockers` і `## Next Attempt` стають обов'язковими при `result: failed`. Агент що не заповнив ці секції ламає ланцюг знань для наступної спроби.

## More Information
Файл: `docs/думка.MD`, секції "Wrapper-скрипт", схема `run_NNN.md`.
`## Blockers` і `## Next Attempt` — змінено статус з опціональних на обов'язкові при `result: failed`.

---

## ADR Composite planning призначає `a.md`/`h.md` дочірнім вузлам

## Context and Problem Statement
`graph init` без `--mode` створює `task.md` без `a.md`/`h.md` → стан `unassigned`. При composite decomposition агент породжував дочірні `task.md` без sentinel файлів → всі діти залишались `unassigned` → runner пропускав → граф стояв без жодного сигналу.

## Considered Options
* Агент пише `a.md`/`h.md` для кожної дитини як частину planning output
* `graph spawn` автоматично додає `a.md` всім дітям якщо не вказано

## Decision Outcome
Chosen option: "Агент пише `a.md`/`h.md` при плануванні", because планування = визначення декомпозиції + призначення виконавця. Агент визначає `model_tier` і `skills` для кожного підзавдання. `unassigned` залишається валідним тільки для кореневих вузлів де людина явно призначає виконавця.

### Consequences
* Good, because після `graph spawn` всі дочірні вузли одразу у `waiting-plan` → runner підхоплює без ручного втручання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`, секції "graph plan", "Декомпозиція composite".
Перевизначення після планування: `graph mode human <path>` або ручне заміщення `a.md` → `h.md`.
