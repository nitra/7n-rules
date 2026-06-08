---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T22:13:21+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Всі зміни застосовані. Документ `docs/думка.MD` тепер відображає всі 10 погоджених вад і 4 ризики:

- Стани оновлені: `unassigned | waiting-plan | waiting-run | blocked | ...`
- `running_<pid>_until_<ts>` + startup cleanup
- `run-summary.md` у структурі і context агента
- Composite `fact_NNN.md` при merge останнього дочірнього
- `deps/` вкладена структура для cross-level deps
- `audit-result_NNN.md` deletable + `graph audit-retry`
- `graph migrate` + `graph_schema` у `.n-cursor.json`
- `mode:` видалено з `plan_NNN.md`
- Runner таблиця: `waiting-plan/waiting-run × a.md/h.md`
- `stale_grace_period_sec`, `default_mode`, `max_worktrees` у конфізі

---

The session that just ended documented a multi-hour design review of the `n-cursor graph` architecture spec in `docs/думка.MD`. Here's the ADR output:

---

## ADR Заміна `running_until_<ts>` на `running_<pid>_until_<ts>` з cleanup при старті

## Context and Problem Statement
Sentinel-файл `running_until_<ts>` у директорії вузла не дає змоги визначити чи процес-виконавець ще живий без читання вмісту. При аварійному завершенні процесу (`kill -9`, OOM) файл залишається й вузол застряє у стані `stalled` назавжди — без автоматичного відновлення.

## Considered Options
* Варіант A — cleanup як перший крок нового `graph run` (перевірка при старті)
* Варіант B — PID у назві файлу: `running_<pid>_until_<ts>`
* Гібрид A+B — обидва механізми одночасно

## Decision Outcome
Chosen option: "Гібрид A+B", because PID у назві дозволяє `kill -0 <pid>` для перевірки живості процесу без читання вмісту (інваріант збережено), а cleanup при старті нового `graph run` забезпечує автоматичне відновлення після краша на тому ж хості.

### Consequences
* Good, because transcript фіксує очікувану користь: стан `stalled` тепер автоматично вирішується — wrapper при старті або watch при скані видаляють orphan sentinel якщо `kill -0 <pid>` повертає "no such process".
* Bad, because на distributed FS PID не унікальний між хостами — `kill -0` не застосовується. Вирішується через `stale_grace_period_sec` (Ризик №4).

## More Information
Файл: `docs/думка.MD`, секція "Стани вузла" та "Wrapper-скрипт". Конфіг: `stale_grace_period_sec: 30` у `.n-cursor.json`. Команда перевірки: `kill -0 <pid>` (0-сигнал, не вбиває).

---

## ADR Розбиття стану `waiting` на `waiting-plan` і `waiting-run`

## Context and Problem Statement
Стан `waiting` позначав два принципово різних сценарії: вузол без плану (потрібне планування) і вузол з планом готовий до виконання. Runner поводився по-різному залежно від `a.md`/`h.md`, але зовнішній monitor або dashboard не міг розрізнити ці випадки без читання файлів.

## Considered Options
* Залишити `waiting`, додати `ready-human` як окремий стан
* Перейменувати `waiting` на `waiting-run`, додати `waiting-plan`
* Використовувати `waiting:agent` / `waiting:human` як суфікси в machine-readable виводі

## Decision Outcome
Chosen option: "Перейменувати `waiting` на `waiting-run`, додати `waiting-plan`", because стан відповідає на питання "що потрібно зробити далі" (plan чи run), а `a.md`/`h.md` відповідають на "хто це робить" — ортогональні виміри не повинні змішуватись в одному стані.

### Consequences
* Good, because transcript фіксує очікувану користь: `graph status` виводить однозначний стан; runner-логіка стає симетричною таблицею `waiting-plan/waiting-run × a.md/h.md`; видалено `human-pending` і `needs-plan` як окремі стани.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Таблиця runner-поведінки (`docs/думка.MD`, секція "Оркестрація"): `waiting-plan + a.md → auto plan`, `waiting-plan + h.md → skip + notify`, `waiting-run + a.md → auto run`, `waiting-run + h.md → skip + notify`.

---

## ADR Вкладена структура `deps/` для крос-рівневих залежностей

## Context and Problem Statement
`deps/` директорія вузла містила плоский список файлів де ім'я = id сусіднього вузла. Це обмежувало топологію: вузол міг залежати лише від прямих сусідів у тому ж батьківському вузлі. Залежності між вузлами на різних рівнях ієрархії були неможливі без зміни логічної структури графу.

## Considered Options
* Варіант A — абсолютний шлях у назві файлу через `__` роздільник
* Варіант B — шлях у вмісті файлу (порушує інваріант "без читання вмісту")
* Варіант C — `deps/` може бути вкладеною; шлях у `deps/` дзеркалює шлях у `tasks/`

## Decision Outcome
Chosen option: "Варіант C", because зберігає інваріант "всі стани з `ls`": `ls -R deps/` → обрізати `.md` → dep-id = відносний шлях від `tasks/`. Сусідні deps залишаються простими (`deps/collect-data.md`), крос-рівневі стають вкладеними (`deps/research/analyze.md`).

### Consequences
* Good, because transcript фіксує очікувану користь: інваріант збережено, топологія необмежена, `.md` розширення консистентне з рештою файлів вузла.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`, секція "`deps/`". Deps satisfaction check: `ls -R deps/ → strip .md → tasks/<dep-id>/fact_*.md`.

---

## ADR Явний `fact_NNN.md` для composite вузлів

## Context and Problem Statement
Composite вузол не мав власного `fact_NNN.md` — його стан `resolved` визначався рекурсивним обходом усіх нащадків. При глибоких деревах `graph scan` ставав O(глибина × кількість вузлів). Зовнішній інструмент не міг перевірити стан кореня без обходу всього графу.

## Considered Options
* Залишити implicit resolved + додати `.n-cursor/graph-index.json` індекс
* Явний `fact_NNN.md` для composite, що пишеться автоматично при merge останнього дочірнього
* Ліниве просування стану вгору через `.child-done/` sentinel у батьківській директорії

## Decision Outcome
Chosen option: "Явний `fact_NNN.md` для composite", because уніфікує перевірку стану для всіх типів вузлів — scan стає O(n) замість O(n×depth). `graph done <last-child>` wrapper пише `fact_NNN.md` у батька автоматично і рекурсивно перевіряє батька батька.

### Consequences
* Good, because transcript фіксує очікувану користь: `graph scan` плоский; composite resolved перевіряється так само як атомарний — O(1) `ls`.
* Bad, because wrapper потребує логіки "перевірити чи всі діти resolved" після кожного merge. При cascade-resolved довгого ланцюга — один merge може тригерити запис `fact_NNN.md` для N батьків.

## More Information
Файл: `docs/думка.MD`, секція "Складений вузол". NNN для composite = `count(fact_*.md) + 1`. При інвалідації дочірнього — cascade `invalidated` sentinel у батька, новий `fact_NNN.md` після повторного resolve.

---

## ADR `audit-result_NNN.md` як deletable файл з командою `graph audit-retry`

## Context and Problem Statement
Специфікація позначала всі `*_NNN.md` файли як immutable artifacts. При failed audit (аудитор помилився або критерії змінились) не існувало механізму повторного аудиту того самого `fact_NNN.md` без створення нового run.

## Considered Options
* Повторний аудит = завжди новий `run_NNN.md` → новий `fact_NNN.md` (Варіант A)
* `audit-result_NNN.md` deletable; `graph audit-retry` видаляє файл → watch підхоплює

## Decision Outcome
Chosen option: "`audit-result_NNN.md` deletable", because дозволяє розрізнити два сценарії: аудитор помилився → `audit-retry` без нового run; факт справді неправильний → новий run → новий fact. Audit trail зберігається через git history.

### Consequences
* Good, because transcript фіксує очікувану користь: `graph audit-retry <path>` — одна команда; watch підхоплює автоматично без додаткових змін протоколу.
* Bad, because `audit-result_NNN.md` виходить з immutable-гарантії — потребує окремого пояснення в специфікації.

## More Information
Файл: `docs/думка.MD`, секція "CLI" — команда `graph audit-retry <path>`. Відрізняється від `graph invalidate` (який скидає сам факт).

---

## ADR `run-summary.md` — LLM-генерований summary попередніх failed спроб у context агента

## Context and Problem Statement
Агент отримував у context всі попередні `run_NNN.md` файли. Після багатьох failed спроб накопичений контекст міг перевищити context window, що само по собі ставало причиною нових збоїв.

## Considered Options
* Передавати тільки останні 2 `run_NNN.md` (truncation)
* Генерувати LLM-summary попередніх спроб через дешеву модель перед кожним запуском

## Decision Outcome
Chosen option: "LLM-generated `run-summary.md`", because summary виявляє патерни ("tried approach X three times, consistently fails at step Y") що є ціннішою інформацією ніж просто 2 останніх логи. Context залишається O(1) незалежно від кількості спроб.

### Consequences
* Good, because transcript фіксує очікувану користь: context завжди bounded; агент отримує дистильовану інформацію про попередні помилки.
* Bad, because кожен запуск агента при 2+ failed спробах потребує додаткового LLM-виклику (audit_model tier).

## More Information
Файл: `docs/думка.MD`, секція "Запуск агента". `run-summary.md` — mutable файл, видаляється при `graph kill`. Конфіг: `audit_model` у `.n-cursor.json`.

---

## ADR Версійність схеми через `graph_schema` у `.n-cursor.json` з `graph migrate` chain

## Context and Problem Statement
Файли вузлів не мали версійних полів. При зміні специфікації старі вузли не мали механізму виявлення чи міграції.

## Considered Options
* `schema_version:` у кожному файлі вузла
* Один `graph_schema` у `.n-cursor.json` + примусова міграція при новому релізі

## Decision Outcome
Chosen option: "Один `graph_schema` у `.n-cursor.json`", because примусова міграція при кожному релізі усуває необхідність підтримки кількох версій одночасно. `graph migrate` читає поточну версію і застосовує chain: `migrate_v1_to_v2.mjs → migrate_v2_to_v3.mjs`.

### Consequences
* Good, because transcript фіксує очікувану користь: файли вузлів без version поля — простіше; один `graph migrate` скрипт на релізі.
* Bad, because примусова міграція блокує оновлення n-cursor до виконання `graph migrate`.

## More Information
Файл: `docs/думка.MD`, секція "CLI" — команда `graph migrate`. Конфіг: `graph_schema: 1` у `.n-cursor.json` (автооновлюється після міграції).

---

## ADR Диференціальна інвалідація через зворотний dep-ланцюг

## Context and Problem Statement
Інвалідація вузла потенційно робила stale весь граф включно з незалежними гілками. При великих графах це означало повний re-run навіть для вузлів що не залежать від інвалідованого.

## Considered Options
* Повний re-run (простіше)
* Differential re-run через зворотний обхід dep-ланцюга

## Decision Outcome
Chosen option: "Differential re-run", because `deps/` дизайн вже підтримує це природньо: `graph invalidate <path>` шукає `ls tasks/**/deps/<node-id>*` (зворотний dep-граф) і ставить `invalidated` тільки на залежних вузлах. Незалежні гілки залишаються `resolved`.

### Consequences
* Good, because transcript фіксує очікувану користь: незалежні частини графу не перераховуються — економія бюджету і часу при точковій інвалідації.
* Bad, because зворотний dep-ланцюг потребує повного сканування `tasks/**/deps/` при кожній інвалідації.

## More Information
Файл: `docs/думка.MD`, секція "CLI" — команда `graph invalidate <path>`.

---

## ADR Throttling watch через підрахунок активних worktrees + critical path sort

## Context and Problem Statement
`graph run --auto` міг спавнити необмежену кількість worktrees якщо watch не рахував поточні активні процеси. `max_worktrees` у конфізі згадувався але без механізму enforcement.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Watch рахує активні `running_<pid>_until_*` перед spawn", because це природній throttle без черги: `count(running_<pid>_until_<ts> де ts + grace_period > now())` ≥ `max_worktrees` → skip до наступного тіку. `--auto` сортує `waiting-run` вузли за critical path.

### Consequences
* Good, because transcript фіксує очікувану користь: `max_worktrees` дійсно дотримується; критичні вузли виконуються першими при обмеженому паралелізмі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`, секція "Watch". Конфіг: `max_worktrees: 5`, `stale_grace_period_sec: 30` у `.n-cursor.json`.

---

## ADR `stale_grace_period_sec` для захисту від clock skew при stalled detection

## Context and Problem Statement
`ts ≤ now()` для визначення stalled стану може бути некоректним на distributed FS де різні хости мають різний системний час. Хибне `stalled` алертування для живих процесів.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`stale_grace_period_sec` + NTP requirement", because 30-секундний буфер поглинає більшість практичних clock skew. NTP типово забезпечує точність < 1s — разом це достатньо для реальних умов без додаткової інфраструктури.

### Consequences
* Good, because transcript фіксує очікувану користь: хибні stalled alarm усуваються при типовому clock skew.
* Bad, because `kill -0 <pid>` не застосовується на distributed FS (PID не унікальний між хостами) — покладаємось виключно на timestamp + grace period.

## More Information
Конфіг: `stale_grace_period_sec: 30` у `.n-cursor.json`. Файл: `docs/думка.MD`, секція "Wrapper-скрипт — Startup cleanup".
