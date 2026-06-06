---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T16:15:28+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

Зафіксовано. `## Reasoning` — опціональна (явно в таблиці), `max_worktrees: 8` — в конфігу.

Документ тепер досить повний. Єдине що залишилось відкритим у Рівні 2: max глибина графу і max розмір файлу. Решта — зафіксована.

---

Ось транскрипт, по якому потрібно написати ADR.

## ADR Злиття `inputs.md` у `task.md`

## Context and Problem Statement
Під час проектування файлової структури вузла розглядалось два окремих файли: `task.md` (місія агента) і `inputs.md` (посилання на вхідні дані від батька). Виникло питання чи варто зберігати їх роздільно або об'єднати в один файл.

## Considered Options
* Два окремих файли: `task.md` + `inputs.md`
* Один файл `task.md` з секцією `## Inputs`

## Decision Outcome
Chosen option: "Один файл `task.md` з секцією `## Inputs`", because агент читає один файл замість двох, менше файлів при spawn, місія і вхідні дані завжди разом — контекст цілісний.

### Consequences
* Good, because агент отримує всі необхідні дані за один read без необхідності відслідковувати два файли.
* Good, because зменшується кількість файлів при spawn — батько пише один файл замість двох.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Редагування `task.md` (включаючи `## Inputs`) дозволено до створення git worktree. Після старту worktree — файл immutable. Для зміни inputs після старту: `graph kill` → редагувати вільно → перезапустити. Файл: `docs/думка.MD`.

---

## ADR Уніфікований `run_NNN.md` замість окремих `error.md` / `repair_history.md`

## Context and Problem Statement
Система мала три окремих файли для відстеження стану виконання: `error.md` (збої), `repair_history.md` (журнал інженера), `repair_context.md` (часовий бюджет). Виникло питання чи можна уніфікувати їх, оскільки і звичайний агент, і інженер — це "спроба вирішити вузол" з однаковою структурою: reasoning, результат, посилання на вихід.

## Considered Options
* Окремі файли: `error.md`, `repair_history.md` (append-only), `repair_context.md`
* Єдиний `run_NNN.md` на кожну спробу будь-якого актора

## Decision Outcome
Chosen option: "Єдиний `run_NNN.md`", because і агент, і інженер мають однакову структуру спроби; поле `actor: agent | engineer | human | auditor` розрізняє їх. Append-only файли прибрані — всі файли immutable після запису.

### Consequences
* Good, because жодних append-only файлів — всі файли immutable, що спрощує recovery-логіку.
* Good, because `budget_sec` переноситься у `task.md` — часовий бюджет стає частиною контракту вузла, а не окремим файлом.
* Good, because transcript фіксує: "і сам агент буде мати декілька підходів на вирішення і там також будуть задані часові обмеження на вузол" — уніфікація вирішує цей кейс.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Схема `run_NNN.md`: frontmatter `created_at`, `actor`, `result: success | failed`, опціональний `worktree` (тільки при failed); секції `## Reasoning` (опціональна — відсутня якщо агент впав до запису), `## Script` (wrapper, тільки при збої), `## Ref`. NNN генерується wrapper-скриптом: `ls run_*.md | wc -l + 1`. Файл: `docs/думка.MD`.

---

## ADR Іменування файлів і директорій — виключно англійська

## Context and Problem Statement
Початкова версія схеми використовувала українські назви файлів і директорій (`вхідні.md`, `вихідні.md`, `операції/`, `патчі/`, `підграф/`). Виникло питання мови іменування, оскільки файли обробляються скриптами.

## Considered Options
* Українські назви файлів і директорій
* Англійські назви файлів і директорій

## Decision Outcome
Chosen option: "Англійські назви", because файли обробляються скриптами — фіксується в контракт явно.

### Consequences
* Good, because скрипти і CLI не потребують обробки Unicode в іменах файлів.
* Good, because transcript фіксує: секції що парсить скрипт/оркестратор → англійські заголовки; секції з довільними даними → будь-яка мова.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Перейменовано: `вхідні.md` → частина `task.md`; `вихідні.md` → `outputs_NNN.md`; `операції/` → `ops/` (пізніше прибрано повністю); `патчі/` → `patches/` (пізніше прибрано повністю); `підграф/` → `subgraph/`. Файл: `docs/думка.MD`.

---

## ADR Append-only інваріант обмежений межею worktree

## Context and Problem Statement
Розглядався принцип "файли тільки створюються, ніколи не змінюються". Постало питання чи є цей інваріант абсолютним або він має умовну межу, оскільки до старту роботи жоден агент ще не читає файли вузла.

## Considered Options
* Абсолютна immutability — ніколи не змінювати жодного файлу вузла
* Immutability лише після створення git worktree для вузла

## Decision Outcome
Chosen option: "Immutability після створення worktree", because до створення worktree жоден агент ще не запущений і не читає файли; worktree — чітка і вже наявна в системі межа.

### Consequences
* Good, because файли вузла можна вільно редагувати або видаляти до старту — не потрібен `task-v2.md` або re-spawn.
* Good, because для зміни після старту: `graph kill` → редагувати вільно → перезапустити — одна атомарна операція.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зафіксовано в `docs/думка.MD` як "Інваріант незмінності": до створення worktree — файли вільно змінюються і видаляються; після — тільки нові файли, нічого не змінюється.

---

## ADR Видалення `patches/` і `ops/` — відмова від план/факт файлів

## Context and Problem Statement
Початкова архітектура містила `ops/spawn-plan-<ts>.md`, `ops/spawn-fact-<ts>.md`, `ops/kill-plan-<ts>.md`, `ops/kill-fact-<ts>.md` і `patches/NNN-plan.md`, `patches/NNN-fact.md` для реалізації WAL-патерну (Write-Ahead Log) і відновлення після збою при перерваних операціях.

## Considered Options
* Зберегти `ops/` і `patches/` для crash recovery
* Видалити обидві директорії, ігноруючи сценарії обриву на поточному етапі

## Decision Outcome
Chosen option: "Видалити `ops/` і `patches/`", because сценарій обриву при spawn в межах worktree практично неможливий — якщо агент не завершив spawn, весь worktree просто не мержиться і граф залишається чистим; crash recovery для patches — той самий сценарій.

### Consequences
* Good, because файлова структура вузла суттєво спрощується — нуль зайвих директорій.
* Good, because інформація про reasoning та зміни інженера переноситься в `run_NNN.md` (`## Reasoning`) — без дублювання.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — сценарій обриву не тестувався.

## More Information
`graph kill` каскадно інвалідує наступників без потреби у plan/fact файлах. `graph invalidate` доступна для ручного контролю. Файл: `docs/думка.MD`.

---

## ADR `graph run` як паралельний оркестратор-цикл

## Context and Problem Statement
Після ручного merge worktree в main потрібно визначити хто і як запускає наступні готові вузли графу. Варіанти — повністю ручний запуск кожного вузла або автоматичний оркестратор.

## Considered Options
* Людина вручну запускає кожен вузол через `graph run <path>`
* `graph run` без аргументів — автоматичний оркестратор-цикл

## Decision Outcome
Chosen option: "`graph run` без аргументів як оркестратор-цикл", because знаходить всі вузли з `deps=resolved`, запускає паралельно (топологічний порядок, довільно в межах рівня), після кожного merge повторює сканування поки черга не порожня.

### Consequences
* Good, because людина запускає одну команду — система сама доводить граф до кінця.
* Good, because незалежні вузли одного рівня запускаються паралельно — менший загальний час виконання.
* Bad, because паралельність обмежена `warn_worktrees_above: 4` і `max_worktrees: 8` — жорсткі ліміти для MacBook.

## More Information
Команди: `graph run [<path>]`, `graph kill <path>`, `graph invalidate <path> [--cascade]`, `graph done`, `graph failed`, `graph spawn`. Конфіг: `.n-cursor.json` з полями `warn_worktrees_above: 4`, `max_worktrees: 8`. Файл: `docs/думка.MD`.
