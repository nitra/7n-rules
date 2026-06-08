---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T22:16:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Всі зміни застосовано коректно:

- `graph kill` → завжди cascade + checkpoint commit, undo через `git revert`
- `audit-result_NNN.md` → позначено як **Deletable**
- `composite_NNN.md` → повністю видалено, composite resolved = `fact_NNN.md`
- Clock skew TODO → додано в секцію загроз

`docs/думка.MD` тепер відображає всі погоджені рішення з нашого розбору.

---

The transcript ends here.

---
</thinking>

## ADR Sentinel-файли режиму `a.md`/`h.md` замість `task_h.md`/`task_a.md`

## Context and Problem Statement
Архітектура `n-cursor graph` потребувала способу кодувати режим виконавця вузла (людина або агент) у структурі файлів. Перший підхід — режим у frontmatter `task.md`; другий — у назві основного файлу (`task_h.md`/`task_a.md`). Перейменування основного файлу при зміні режиму руйнує git history, а один файл без окремого прапора не підтримує стан "режим ще не визначено".

## Considered Options
* Поле `mode:` у frontmatter `task.md`
* Назва файлу `task_h.md` / `task_a.md` (режим кодується в імені)
* Окремі sentinel-файли `h.md` / `a.md` + стабільний `task.md`

## Decision Outcome
Chosen option: "Окремі sentinel-файли `h.md` / `a.md` + стабільний `task.md`", because зміна режиму — це `rm h.md && touch a.md` без торкання основного файлу місії; `task.md` залишається незмінним після `graph init`; відсутність обох файлів — природний третій стан `unassigned`/`setup`, коли режим ще не призначено.

### Consequences
* Good, because transcript фіксує очікувану користь: git history `task.md` не переривається при перемиканні режиму; операція зміни режиму атомарна на рівні файлової системи.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл специфікації: `docs/думка.MD`. Схеми `a.md` і `h.md` описано у секціях `#### a.md` і `#### h.md`. Пов'язане рішення про `unassigned` стан (відсутність обох sentinel) фіксується там само. Мutability обох прапорів явно зазначена: "Мутабельний прапор".

---

## ADR Таблиця станів вузла: `waiting-plan`/`waiting-run` і принцип "стан = що, файл = хто"

## Context and Problem Statement
Стан `waiting` у початковому дизайні покривав два семантично різні сценарії: вузол з `h.md` (runner ігнорує, чекає людини) та вузол з `a.md` (runner запускає агента автоматично). Однаковий стан при протилежній поведінці порушував читабельність статусу і унеможливлював однозначний зовнішній моніторинг.

## Considered Options
* Залишити один стан `waiting`, розрізняти через вміст файлів
* Два окремих стани: `ready-human` та `waiting`
* Принцип ортогональності: стан = що потрібно (план чи запуск), `a.md`/`h.md` = хто виконує

## Decision Outcome
Chosen option: "Принцип ортогональності: стан = що потрібно, `a.md`/`h.md` = хто виконує", because стан відповідає на питання "що потрібно зробити далі", а `a.md`/`h.md` — "хто це робить"; runner завжди дивиться на стан + файл виконавця і комбінує їх для вибору дії.

### Consequences
* Good, because transcript фіксує очікувану користь: усунення дублювання семантики; зовнішні інструменти отримують однозначний стан без читання вмісту файлів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фінальна таблиця станів у `docs/думка.MD`, секція "Стани вузла". Runner-логіка: `waiting` + `a.md` → auto plan/run; `pending` + `h.md` → skip + notify. Пріоритет: `invalidated` > `resolved` > `pending-audit` > `stalled` > `running` > `waiting`/`blocked` > `pending` > `unassigned` > `failed`.

---

## ADR `running_<pid>_until_<ts>` — гібридний sentinel для стану виконання

## Context and Problem Statement
Стан "вузол виконується" потрібно визначати без читання вмісту файлів (інваріант контракту). Водночас необхідно детектувати "завис" (stalled) коли процес вийшов аномально (`kill -9`, OOM) без очищення sentinel-файлу. Базовий `running_until_<ts>` не дає змоги перевірити, чи процес ще живий.

## Considered Options
* `running_until_<ts>` — тільки deadline у назві
* `running_<pid>_until_<ts>` — PID і deadline в назві (Варіант B)
* Cleanup як перший крок нового запуску (Варіант A)
* Гібрид A+B

## Decision Outcome
Chosen option: "Гібрид A+B", because PID у назві дозволяє `kill -0 <pid>` (без вбивства) щоб перевірити чи процес живий; cleanup відбувається автоматично при старті нового `graph run` і при кожному тіку `n-cursor watch`.

### Consequences
* Good, because transcript фіксує очікувану користь: граф не застрягає при аномальному завершенні; стан визначається з `ls` без читання вмісту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`, секція "Стани вузла", рядки `running_<pid>_until_<ts>`. Cleanup-логіка описана у секції "Wrapper-скрипт": `kill -0 <pid>` → якщо мертвий → видалити sentinel + orphan worktree. `budget_hard_sec: 0` заборонено — означає "використати global default".

---

## ADR Explicit `fact_NNN.md` для composite вузлів

## Context and Problem Statement
Composite вузол не виконує роботу сам — його стан `resolved` визначався агрегацією стану всіх нащадків. Це робило перевірку стану composite вузла операцією O(глибина×вузли) при кожному скані, і порушувало уніфікованість: атомарний resolved = `fact_*.md` є; composite resolved — implicit через рекурсію.

## Considered Options
* Залишити implicit aggregate (без окремого файлу)
* Окремий `composite_NNN.md` sentinel
* `fact_NNN.md` для composite (так само як атомарного)

## Decision Outcome
Chosen option: "`fact_NNN.md` для composite", because уніфікує перевірку resolved стану для всіх типів вузлів; scan стає плоским O(n); wrapper автоматично пише `fact_NNN.md` після merge останньої дитини через `graph done <last-child>`.

### Consequences
* Good, because transcript фіксує очікувану користь: `graph scan` O(n) замість O(n×depth); єдина умова resolved для атомарних і composite.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Тригер: `graph done <child>` перевіряє батька — якщо всі піддиректорії мають `fact_*.md` → wrapper пише `tasks/<parent>/fact_NNN.md`, рекурсивно вгору. NNN = count існуючих + 1. `## Summary` = агрегація дітей. Файл `docs/думка.MD`, секція composite вузла.

---

## ADR `deps/` — вкладена структура для крос-рівневих залежностей

## Context and Problem Statement
Початковий дизайн `deps/` дозволяв залежності лише між вузлами-сусідами: ім'я файлу = ID сусіда. Вузол на іншому рівні ієрархії (`tasks/reporting/generate-report` залежить від `tasks/research/analyze`) не міг бути виражений без зміни топології графу.

## Considered Options
* Абсолютні шляхи у назві файлу через `__` як роздільник
* Вміст файлу містить `ref:` шлях (читання вмісту)
* Вкладена структура `deps/` дзеркалює `tasks/`

## Decision Outcome
Chosen option: "Вкладена структура `deps/` дзеркалює `tasks/`", because `ls -R deps/` дає повний список залежностей без читання вмісту; сусідні deps залишаються простими (`deps/collect-data.md`), крос-рівневі виражаються через вкладеність (`deps/research/analyze.md`); інваріант контракту збережено.

### Consequences
* Good, because transcript фіксує очікувану користь: підтримка довільної топології графу без порушення принципу "стан з listing".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Deps satisfaction: `ls -R deps/` → отримати відносний шлях → обрізати `.md` → dep-id → перевірити `tasks/<dep-id>/fact_*.md`. Всі файли в `deps/` — `.md` розширення. Файл `docs/думка.MD`, секція `#### deps/`.

---

## ADR `graph kill` — завжди cascade + checkpoint git commit

## Context and Problem Statement
При інвалідації батьківського вузла дочірні вузли могли залишатися без `invalidated` sentinel, формуючи некоректний граф. Механізм відновлення (undo kill) був відсутній, крім ручних git-операцій. Початковий `graph kill` мав `--cascade` як опціональний прапор.

## Considered Options
* `graph kill` без флага + `--recursive` як opt-in
* `--only-self` флаг для виключення cascade
* Implicit ancestry check у `graph scan` (без запису файлів нащадкам)
* Завжди cascade + checkpoint commit; undo через `git revert`

## Decision Outcome
Chosen option: "Завжди cascade + checkpoint commit; undo через `git revert`", because задачі не мають частих оновлень — один commit per kill є прийнятним; `git revert <kill-commit>` повертає весь піддерево без окремої команди `graph reset`; `--only-self` виключено як такий, що може зламати консистентність графу.

### Consequences
* Good, because transcript фіксує очікувану користь: граф завжди консистентний після kill; повний audit trail через `git log --grep="graph: kill"`.
* Bad, because `graph kill` вимагає clean working tree — помилка при незакомічених змінах.

## More Information
Checkpoint commit: `git add tasks/<path>/**/invalidated && git commit -m "graph: kill tasks/<path>"`. Тільки `invalidated` файли, uncommitted changes не потрапляють. Файл `docs/думка.MD`, секція `graph kill`. Пов'язане рішення: `graph invalidate` команда видалена — covered by `graph kill`.
