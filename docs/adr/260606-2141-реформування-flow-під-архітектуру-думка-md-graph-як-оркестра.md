---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-06T21:41:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Реформування `flow` під архітектуру думка.MD: `graph` як оркестратор, `flow` як внутрішній протокол вузла

## Context and Problem Statement
Існують дві паралельні системи: `n-cursor flow` (пасивний турнікет: init/spec/plan/verify/release, стан у `.flow.json` і `docs/`) і нова архітектура `думка.MD` (автономний ОАГ: `tasks/<node>/task.md`, file-based state, git worktree + post-merge hook). Вони перекриваються у worktree-lifecicle та концепції «кроків виконання», але мають несумісні формати і різні рівні автономії. Потрібно поєднати їх в єдину систему.

## Considered Options
* `graph` як оркестратор ззовні, `flow` як протокол всередині вузла (обраний варіант)
* Повне злиття: `flow init` = `graph init`, `flow release` = merge + cascade
* Зберегти обидві системи паралельно без злиття
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`graph` як зовнішній оркестратор, `flow` як внутрішній протокол вузла", because `graph` управляє worktree-lifecycle, залежностями, merge і каскадом, а `flow` обслуговує логіку одного запуску зсередини worktree — межа відповідальності чітка і не дублюється.

### Consequences
* Good, because transcript фіксує очікувану користь: `flow` стає легшим (зникають `.flow.json`, `docs/specs/`, `docs/plans/`), `graph` отримує повний контроль над станом та паралелізмом.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли що зникають: `.flow.json`, `docs/specs/`, `docs/plans/`. Нові артефакти: `task.md`, `plan_001.md`, `outputs_NNN.md`. Команди `flow init` і `flow spec` видаляються; `flow release` замінюється на `graph done|audit|failed`.

---

## ADR Розподіл виконання вузла на дві стадії: Planning (Stage 1) і Execution (Stage 2)

## Context and Problem Statement
Виконання вузла поєднує в собі проектування (design, декомпозиція) і власне кодування/вирішення. Ці дві активності мають різний характер: перша — дослідницька з невизначеним виходом (атомарний або складений вузол), друга — детермінована (пишемо код, перевіряємо, виводимо результат). Змішання їх в одному кроці утруднює аудит і контроль людини.

## Considered Options
* Два окремих кроки: Stage 1 (`flow plan`) і Stage 2 (виконання)
* Один монолітний крок (агент сам вирішує коли планувати, а коли виконувати)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "два окремих кроки", because явна межа дозволяє людині або зовнішньому оркестратору зупинитись після planning і переглянути рішення (атомарний/складений) перед запуском execution; також спрощує retry — можна повторити лише Stage 2 без повторного планування.

### Consequences
* Good, because transcript фіксує очікувану користь: Stage 1 повертає або `plan_001.md` (атомарний шлях) або дочірні `task.md` + `graph spawn` (складений шлях) — два чіткі виходи без двозначності.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Stage 1 entry point: `flow plan` (всередині worktree після `graph run`). Stage 2: агент виконує роботу → `flow verify` (перевіряє критерії з `## Done when` у `task.md`) → пише `outputs_NNN.md` → сигналізує `graph done|audit|failed`.

---

## ADR Stage 1 `flow plan`: об'єднання design і decompose, режим через атрибут `mode:`

## Context and Problem Statement
Попередня система мала два окремі кроки: `flow spec` (brainstorm, панель персон, `docs/specs/*.md`) і `flow plan` (декомпозиція, `.flow.json`). Вони дублювали налаштування та вимагали двох команд для однієї логічної активності — «зрозуміти задачу і вирішити як її виконати». Також потрібно підтримувати як інтерактивний режим (людина бере участь), так і повністю автономний (агент сам).

## Considered Options
* Об'єднати `flow spec` і `flow plan` в один крок `flow plan` з атрибутом `mode:` в `task.md`
* Залишити два кроки: `flow spec` → design, `flow plan` → decompose, обидва пишуть у `plan_001.md`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "один крок `flow plan` з атрибутом `mode:`", because transcript: "спільний крок, поєднуємо їх" — окремий `flow spec` більше не існує; `plan_001.md` містить і обґрунтування, і декомпозицію/план в одному файлі.

### Consequences
* Good, because transcript фіксує очікувану користь: менше команд, менше перемикань, `plan_001.md` — єдиний артефакт Stage 1.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Атрибут `mode:` у frontmatter `task.md`: `human` (default) — агент веде інтерактивний діалог в терміналі; `agent` — автономно без участі людини. Preflight (перевірка що виконується в `.worktrees/`) переноситься з `flow init` в `flow plan`. Вихід `flow plan`: складений вузол → дочірні `task.md` + виклик `graph spawn`; атомарний вузол → `plan_001.md` у кореневій теці вузла.
