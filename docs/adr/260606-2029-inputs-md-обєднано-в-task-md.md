---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T20:29:06+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR `inputs.md` об'єднано в `task.md`

## Context and Problem Statement
Система передбачала два окремі файли на вузол: `task.md` (місія) і `inputs.md` (посилання на вхідні дані). Обидва писалися батьком при spawn і були immutable після старту ворктрі — тобто мали однаковий lifecycle і одного автора.

## Considered Options
* Зберегти `inputs.md` як окремий файл
* Об'єднати `inputs.md` в `task.md` як секцію `## Inputs`

## Decision Outcome
Chosen option: "Об'єднати `inputs.md` в `task.md` як секцію `## Inputs`", because агент читає один файл замість двох, lifecycle і автор однакові, а зміна після kill ворктрі однакова для обох — редагуй вільно.

### Consequences
* Good, because transcript фіксує очікувану користь: "агент читає один файл замість двох, менше файлів при spawn, task і дані завжди разом — контекст цілісний."
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Секція `## Inputs` містить підсекції `### name` з `ref:` або inline-текстом. `ref:` обов'язковий якщо дані є у файлі; inline — лише якщо даних немає деінде. Інваріант зміни: немає ворктрі → редагуй `task.md` вільно; є ворктрі → `graph kill` → редагуй → restart.

---

## ADR Уніфікований `run_NNN.md` замість `error.md`, `outputs.md`, `repair_history.md`

## Context and Problem Statement
Початковий дизайн мав окремі файли для кожного типу виконання: `outputs.md` (append-only результати), `error.md` (append-only помилки), `repair_history.md` (append-only журнал інженера). Всі три мали різні схеми, але спільну природу — фіксують спробу щось зробити на вузлі.

## Considered Options
* Тримати `outputs.md`, `error.md`, `repair_history.md` як окремі append-only файли
* Уніфікувати в `run_NNN.md` — один immutable файл на спробу з полем `actor`

## Decision Outcome
Chosen option: "Уніфікований `run_NNN.md`", because і звичайний агент, і інженер — це "спроба вирішити вузол"; вони мають спільний lifecycle, часовий ліміт, reasoning і result; поле `actor: agent | engineer | human | auditor` розрізняє виконавця.

### Consequences
* Good, because transcript фіксує очікувану користь: усуває три окремі схеми, дає можливість задати часовий ліміт (`budget_sec`) однаково для всіх акторів, робить всі файли immutable.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Схема `run_NNN.md` (frontmatter): `created_at`, `actor`, `result: success | failed`, опціонально `worktree`. Секції: `## Reasoning` (обов'язкова — агент і інженер пишуть що робили і що змінили), `## Script` (wrapper пише `exit_code` + `stderr`, тільки якщо failed), `## Ref` (ref на `outputs_NNN.md` або будь-який файл результату, відсутня якщо нічого не продукував). NNN = `count(run_*.md) + 1`, zero-padded до 3 цифр.

---

## ADR Immutable numbered файли замість append-only

## Context and Problem Statement
Система потребувала зберігати кілька результатів/спроб на вузол. Початковий підхід — append-only файли (дописувати нові секції до існуючого `outputs.md`, `error.md`, `repair_history.md`). Але базовий принцип архітектури — "файли тільки створюються, ніколи не змінюються" після старту ворктрі.

## Considered Options
* Append-only файли (`outputs.md`, `error.md`, `repair_history.md`)
* Numbered immutable файли (`run_001.md`, `run_002.md`, `outputs_001.md`, …)

## Decision Outcome
Chosen option: "Numbered immutable файли", because принцип "всі файли в процесі роботи immutable" консистентно застосовується до всіх файлів системи; кожна спроба — окремий атомарний документ; не потрібен append-механізм.

### Consequences
* Good, because transcript фіксує очікувану користь: "жодних append-only файлів взагалі" — консистентна модель, простіший recovery.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Правило нумерації: wrapper рахує існуючі `run_*.md` перед стартом (`count + 1`), zero-padded до 3 цифр (`001`, `002`, …). Аналогічно для `outputs_NNN.md`. Стан вузла виводиться з наявності файлів: є `outputs_*.md` і немає `invalidated` → `resolved`; є `run_*.md` без `outputs_*.md` → `failed`.

---

## ADR Видалення `ops/` та `patches/` директорій

## Context and Problem Statement
Початковий дизайн мав `ops/spawn-plan-<ts>.md / spawn-fact-<ts>.md` і `ops/kill-plan-<ts>.md / kill-fact-<ts>.md` для WAL-відновлення після збою при spawn/kill, та `patches/NNN-plan.md / NNN-fact.md` для фіксації намірів інженера.

## Considered Options
* Зберегти `ops/` і `patches/` для crash recovery та аудиту
* Видалити обидві директорії

## Decision Outcome
Chosen option: "Видалити `ops/` і `patches/`", because сценарій збою при spawn вирішується worktree-boundary (spawn відбувається у ворктрі, незавершений ворктрі просто не мержиться); інформація про патчі інженера достатньо відображається в `## Reasoning` файлу `run_NNN.md`.

### Consequences
* Good, because transcript фіксує очікувану користь: мінімальна файлова структура вузла, жодних зайвих директорій.
* Bad, because transcript фіксує свідоме обмеження: сценарій "обрив посеред spawn у main-гілці" ігнорується на поточному етапі.

## More Information
Файлова структура вузла після рішення: `task.md`, `invalidated` (sentinel), `run_NNN.md`, `outputs_NNN.md`, дочірні вузли як субдиректорії.

---

## ADR Git `post-merge` hook як тригер наступників

## Context and Problem Statement
Після завершення агента і злиття ворктрі потрібно автоматично запустити наступні розблоковані вузли. Без механізму тригера система вимагала б ручного виклику `graph run` після кожного злиття.

## Considered Options
* Людина вручну запускає `graph run` після кожного merge
* `graph run` сам є "живим" демоном — після merge сканує і запускає наступників
* wrapper авто-мержить → git `post-merge` hook → `graph run --auto`

## Decision Outcome
Chosen option: "wrapper авто-мержить → git `post-merge` hook → `graph run --auto`", because кожен компонент робить одне: `graph run` — одноразовий, wrapper — авто-мержить після успіху, git hook — тригерить наступний цикл; людина запускає лише кореневий вузол.

### Consequences
* Good, because transcript фіксує очікувану користь: "система сама до кінця (або до `failed`)" — повна автоматизація після першого запуску.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Ланцюг: агент завершує → wrapper пише `run_NNN.md` → wrapper `git merge` ворктрі → git `post-merge` hook → `graph run --auto` сканує граф і запускає всіх розблокованих наступників. Зафіксовано в `docs/думка.MD`, секція "Wrapper-скрипт".

---

## ADR `budget_sec` в `task.md` замість `repair_context.md`

## Context and Problem Statement
Система потребувала зберігати часовий бюджет (deadline, budget_sec) для обмеження тривалості роботи агента/інженера на вузлі. Початково планувався окремий `repair_context.md` для інженерського часового бюджету.

## Considered Options
* Окремий `repair_context.md` для кожного вузла де є відновлення
* `budget_sec` як поле у frontmatter `task.md`

## Decision Outcome
Chosen option: "`budget_sec` у `task.md`", because часовий бюджет однаковою мірою застосовується до звичайного агента і до інженера — це атрибут вузла, а не тільки відновлення; зменшує кількість файлів.

### Consequences
* Good, because transcript фіксує очікувану користь: уніфікація — один `task.md` містить всю конфігурацію вузла; `repair_context.md` не потрібен.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`budget_sec` — обов'язкове поле у frontmatter `task.md`. Wrapper-скрипт читає його і кілить процес після вичерпання. Зафіксовано в `docs/думка.MD`, схема `task.md`.
