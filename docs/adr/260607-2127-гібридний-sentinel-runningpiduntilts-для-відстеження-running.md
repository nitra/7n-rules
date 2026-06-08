---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T21:27:41+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Гібридний sentinel `running_<pid>_until_<ts>` для відстеження `running`/`stalled`

## Context and Problem Statement
Вузол DAG потрапляє у стан `running` коли wrapper запускає агента і стартує worktree. Якщо процес вбивається аномально (`kill -9`, OOM, збій хоста), wrapper не встигає прибрати sentinel-файл, і вузол назавжди залишається у стані `stalled` без автоматичного відновлення.

## Considered Options
* Окремий `running_until_<ts>` sentinel (deadline без PID)
* Гібрид A+B: `running_<pid>_until_<ts>` + cleanup при старті нового run і в watch-loop
* PID-файл окремо від deadline-файлу

## Decision Outcome
Chosen option: "Гібридний sentinel `running_<pid>_until_<ts>` (A+B)", because об'єднання PID і deadline в одному filename дозволяє детектувати `running` vs `stalled` та живий/мертвий процес виключно через `ls` + `kill -0 <pid>` — без читання вмісту — і cleanup відбувається автоматично в двох точках: при старті нового run та при кожному скані watch.

### Consequences
* Good, because стан вузла (`running` vs `stalled` vs zombie) детектується без читання файлів — інваріант "стан з listing" зберігається.
* Good, because watch та wrapper мають чіткий алгоритм cleanup: `kill -0 <pid>` → якщо мертвий → видалити sentinel, записати `run_NNN.md(reason: crash)`, перейти у `failed`.
* Bad, because `budget_hard_sec: 0` (без hard kill) вимагає окремої конвенції для ts щоб уникнути sentinel із ts у минулому одразу після створення.

## More Information
Файли: `docs/думка.MD` — розділи "Стани вузла", "Wrapper-скрипт", "Watch daemon". Команди: `kill -0 <pid>` для перевірки живості процесу без вбивства. Формат: `tasks/<node>/running_<pid>_until_<unix-ts>` (git-ignored).

---

## ADR `human-pending` охоплює всі `h.md`-вузли незалежно від наявності плану

## Context and Problem Statement
Специфікація маппила `h.md` + `plan_*.md` + deps resolved на стан `waiting` — той самий стан що і для `a.md`-вузлів. Runner автоматично запускає `waiting`-вузли з `a.md`, але повністю ігнорує `waiting`-вузли з `h.md`. Зовнішній monitor або людина бачать два `waiting`-вузли і не можуть (без читання файлів) визначити що один ніколи не запуститься автоматично.

## Considered Options
* Залишити `waiting` для обох типів, додати суфікс у вивід (`waiting:agent` / `waiting:human`)
* Ввести окремий стан `ready-human` для `h.md` + plan
* Розширити `human-pending` на всі `h.md`-вузли (з планом і без)

## Decision Outcome
Chosen option: "Розширити `human-pending` на всі `h.md`-вузли", because стан вже однозначно закодований у присутності `h.md` — зайвий новий стан не потрібен; `human-pending` семантично точний: і без плану, і з планом вузол чекає дії від людини (відповідно `graph plan` або `graph run --actor human`). `waiting` стає виключно `a.md` + deps resolved.

### Consequences
* Good, because `waiting` = виключно агентський; runner не має ambiguity щодо того які вузли підхопити.
* Good, because контракт "стан з listing" зберігається: `h.md` є → `human-pending`; деталь (є план чи ні) — підказка у `graph status`, а не окремий стан машини.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `docs/думка.MD` — таблиця станів атомарного вузла, рядки пріоритетів. Відповідний рядок CLI: `graph run --auto` пропускає всі `human-pending` (h.md незалежно від плану). `graph status` може показувати підказку: `human-pending: plan є → graph run <path> --actor human`.

---

## ADR Інваріант: всі стани вузла визначаються виключно переліком файлів і директорій

## Context and Problem Statement
До формалізації інваріанту ряд станів (зокрема `human-pending` та `waiting`) вимагали читання frontmatter `task.md` для поля `mode:` та поля `deps:`. На великих графах це означало N reads при кожному скані оркестратора. Крім того, відсутність явного контракту дозволяла стан-детекцію "протікати" у читання вмісту без помітки в специфікації.

## Considered Options
* Зберегти `mode:` у frontmatter `task.md` (читання вмісту для `human-pending` vs `waiting`)
* Замінити `deps:` frontmatter на `deps/` директорію; `mode:` → окремі sentinel-файли `a.md`/`h.md`

## Decision Outcome
Chosen option: "Sentinel-файли `a.md`/`h.md` + директорія `deps/`", because це дозволяє встановити формальний інваріант: будь-який стан будь-якого вузла детектується виключно через `ls` (присутність файлів + парсинг filename) — без відкриття жодного файлу.

### Consequences
* Good, because watch-loop — O(file count), без I/O на читання; відновлення графу після збою — scan без парсингу.
* Good, because зовнішні інструменти (CI, dashboard, shell scripts) можуть читати граф без знання схеми frontmatter.
* Good, because transcript фіксує очікувану користь: мутабельні прапори `a.md`/`h.md` дозволяють перемикати mode без `git mv` і без втрати history `task.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `docs/думка.MD` — рядок 405 (формальний інваріант), схеми `a.md`, `h.md`, `deps/` (рядки 189–259). Мутабельні прапори: `a.md`, `h.md`, `invalidated`, `running_until_*`. Immutable: `task.md`, `plan_NNN.md`, `run_NNN.md`, `fact_NNN.md`, файли у `deps/`.
