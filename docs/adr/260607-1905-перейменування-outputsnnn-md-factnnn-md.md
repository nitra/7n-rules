---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T19:05:54+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Перейменування `outputs_NNN.md` → `fact_NNN.md`

## Context and Problem Statement
Файл результату успішного виконання вузла називався `outputs_NNN.md`, що не відображало семантичну пару зі Stage 1 артефактом `plan_NNN.md`. Назва "outputs" не передає значення "те, що фактично відбулось" на противагу плану.

## Considered Options
* `fact_NNN.md` як пара до `plan_NNN.md`
* Залишити `outputs_NNN.md`

## Decision Outcome
Chosen option: "`fact_NNN.md`", because пара `plan/fact` інтуїтивно читається: `plan_NNN.md` — що збираємось зробити, `fact_NNN.md` — що фактично зроблено. Зміна перейменована по всьому `docs/думка.MD` через `replace_all`.

### Consequences
* Good, because transcript фіксує очікувану користь: семантична ясність для людини-оператора, чіткий контраст між наміром (plan) і результатом (fact).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `docs/думка.MD`. Замінені патерни: `outputs_NNN.md`, `outputs_*.md`, `outputs_001.md`, `outputs_(N+1).md`. Аудит-посилання `pending-audit_NNN.md` (де NNN = NNN `fact_NNN.md`) оновлено відповідно.

---

## ADR Поля оцінки виконавця у `task.md`

## Context and Problem Statement
У `task.md` не було зафіксовано хто виконує Stage 2 вузла (людина чи агент), яка модель потрібна і які інструменти. Без цього оркестратор не міг автоматично вибрати модель або перевірити доступність навичок.

## Considered Options
* Поля `executor`, `model_tier`, `skills`, `qualification` у `task.md` (базово), override у `plan_NNN.md`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "поля у `task.md` з override у `plan_NNN.md`", because `graph init` генерує базову оцінку, людина може уточнити до старту worktree; `plan_NNN.md` може перекрити аналогічно до `budget_sec`.

### Consequences
* Good, because transcript фіксує очікувану користь: автоматичний вибір моделі через `model_map` у конфізі (`MIM`→haiku, `AVG`→sonnet, `MAX`→opus); окрема вісь `executor` відрізняється від `mode` (хто планує Stage 1 vs хто виконує Stage 2).
* Bad, because `qualification` для `executor: human` — TODO; семантика `executor: human` в оркестраторі (пропускає як `human-pending`, TODO Telegram) ще не реалізована.

## More Information
Поля у `task.md` frontmatter: `executor: agent|human`, `model_tier: MIM|AVG|MAX`, `skills: [bash, write-files, ...]`, `qualification: ""` (TODO). Конфіг `.n-cursor.json` розширено полем `model_map`. Файл: `docs/думка.MD`.

---

## ADR Нумерація `plan_NNN.md`: продовження vs скидання

## Context and Problem Statement
При перезапуску вузла після `graph kill` або після успішного merge незрозуміло чи `plan_NNN.md` нумерується з `001` чи продовжується. Неправильна логіка порушить immutability або приховає еволюцію підходу.

## Considered Options
* Продовжувати якщо merged/active; скидати до `001` після `graph kill`
* Завжди продовжувати (без скидання)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "продовжувати якщо merged/active; скидати після `graph kill`", because `graph kill` є повним скиданням вузла — він видаляє `plan_*.md` з директорії, тому наступний старт законно починає з `001`. Merge/active worktree зберігає всі файли → нумерація продовжується (`002`, `003`...).

### Consequences
* Good, because transcript фіксує очікувану користь: `plan_002.md` поряд із `plan_001.md` відображає еволюцію підходу; агент бачить обидва і розуміє причину зміни.
* Bad, because `graph kill` видаляє `plan_*.md` — це виняток з immutability правила; прийнятний бо `graph kill` = повний reset вузла.

## More Information
`graph kill` CLI: додано крок 4 — "Видаляє `plan_*.md` з кожного killed вузла". Актуальний план = файл з найбільшим номером. Файл: `docs/думка.MD`.

---

## ADR `n-cursor watch` як periodic rescan замість persistent daemon

## Context and Problem Statement
Оригінальний дизайн описував `n-cursor watch` як persistent daemon з file-watching. Це ускладнює реалізацію (signal handling, PID management, inotify/kqueue) на початковому етапі.

## Considered Options
* Periodic rescan раз на 5 хвилин (cron або loop)
* Persistent daemon з file-watching (TODO)

## Decision Outcome
Chosen option: "periodic rescan раз на 5 хвилин", because на поточному етапі достатньо простого сканування; daemon + Telegram залишаються TODO.

### Consequences
* Good, because transcript фіксує очікувану користь: значно простіша реалізація; той самий `n-cursor graph scan` код використовується і в `--auto`, і у watch.
* Bad, because затримка до 5 хвилин перед виявленням `pending-audit`; якщо cron/loop не запущений — `pending-audit` висить необмежено.

## More Information
Bootstrap: `# cron: */5 * * * * n-cursor watch` або `while true; do n-cursor watch; sleep 300; done`. Daemon-специфіка (Telegram alerts, real-time dispatch) позначена як TODO у `docs/думка.MD`.

---

## ADR Стан "завис" залишається implicit (без окремого стану DAG)

## Context and Problem Statement
Вузол у стані `running` може зависнути (перевищено `budget_hard_sec` або `progress_timeout_sec`). Постало питання чи додавати явний стан `stalled` до таблиці станів DAG.

## Considered Options
* Implicit: watch kills → `failed`, без окремого стану (Variant A)
* Sentinel файл `stalled` у директорії вузла (Variant B)
* Timestamp `stalled_at:` у `run_NNN.md` (Variant C)

## Decision Outcome
Chosen option: "implicit (Variant A)", because "завис" = тимчасовий артефакт спостереження, а не стан DAG; watch при виявленні завису kills і пише `run_NNN.md` з `result: failed, reason: timeout`. Явний стан додає складності без великої користі поки watch простий.

### Consequences
* Good, because transcript фіксує очікувану користь: таблиця станів залишається мінімальною; логіка в одному місці (watch).
* Bad, because "завис" не видно в `graph status` — оператор бачить `running` аж до kill; Telegram TODO, тому без daemon сигналізації немає.

## More Information
Temporal condition для виявлення: читати `task.md`/`plan_NNN.md` → budget поля; mtime worktree файлів; порівняти з поточним часом. Файл: `docs/думка.MD`.
