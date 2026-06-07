---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:14:01+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Поглинання `flow` у `graph`: єдиний namespace для оркестрації вузлів

## Context and Problem Statement
Система `n-cursor flow` (Пасивний Турнікет) і нова архітектура `n-cursor graph` (думка.MD) частково дублювали одне одного: обидва управляли worktree-ізоляцією, мали окремі lifecycle-команди і зберігали стан у різних форматах (`.flow.json` vs `task.md`/`outputs_NNN.md`). Поєднання двох namespace'ів в одному проєкті вимагало узгодження або злиття.

## Considered Options
* Залишити `flow` і `graph` як два рівноправних namespace з чіткою межею
* Повністю поглинути `flow` у `graph` — єдиний namespace, `flow plan` → `graph plan`

## Decision Outcome
Chosen option: "Повністю поглинути `flow` у `graph`", because `flow` після видалення команд `init`, `spec`, `release`, `verify`, `review`, `gate`, `run`, `resume`, `cancel`, `repair` зводився до єдиної команди `flow plan`, що не виправдовує окремого namespace.

### Consequences
* Good, because один namespace для всієї оркестрації вузлів — агент знає лише `graph *` команди без переключення між `flow` і `graph`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені команди: `flow init`, `flow spec`, `flow verify`, `flow review`, `flow gate`, `flow run`, `flow resume`, `flow cancel`, `flow repair`. Видалені артефакти: `.flow.json`, `docs/specs/`, `docs/plans/`. Збережена команда перейменована: `flow plan` → `graph plan`.

---

## ADR Дворівнева модель виконання вузла: `graph plan` (Stage 1) і виконання (Stage 2)

## Context and Problem Statement
Кожен вузол DAG міг бути або атомарним (вирішується напряму), або складеним (потребує декомпозиції на дочірні вузли). Попередній `flow` не розрізняв ці два режими — агент одночасно планував і виконував без чіткого протоколу переходу між ними.

## Considered Options
* Єдиний крок: агент сам вирішує план і виконання без явного розподілу
* Два явних етапи: `graph plan` (Stage 1) → виконання / `graph spawn` (Stage 2)

## Decision Outcome
Chosen option: "Два явних етапи", because атомарний і складений шляхи потребують різних виходів: `plan_001.md` для атомарного та дочірні `task.md` + явний `graph spawn` для складеного — без розподілу ці шляхи не можна відрізнити зовні.

### Consequences
* Good, because оркестратор (watch/hook) чітко бачить стан вузла через файлову систему: наявність `plan_001.md` = Stage 1 завершено атомарно; наявність дочірніх `task.md` = composite spawn.
* Good, because `graph plan` об'єднує `flow spec` і `flow plan` в один крок — менше команд, менше артефактів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Stage 1: `graph plan` читає `task.md`, визначає шлях (composite/atomic), у режимі `mode: human` (default) залучає людину, у `mode: agent` — автономно. Stage 2: агент виконує роботу, пише `outputs_NNN.md`, викликає `graph done`, `graph audit`, або `graph failed`. Файл `plan_001.md` — numbered, immutable, поряд з іншими артефактами вузла.

---

## ADR `mode` в `task.md` контролює інтерактивність Stage 1

## Context and Problem Statement
Деякі вузли потребують залучення людини на етапі планування (наприклад, стратегічні рішення), інші можуть бути повністю автономними. Без явного атрибута агент не знає якого режиму дотримуватись і коли зупинитись для підтвердження.

## Considered Options
* Інтерактивність задається прапором при виклику `graph plan`
* Інтерактивність кодується як атрибут у `task.md`, дефолт `human`

## Decision Outcome
Chosen option: "Атрибут у `task.md` з дефолтом `human`", because поведінка вузла є властивістю самого вузла, а не способу його запуску — це дозволяє оркестратору знати режим без додаткових параметрів командного рядка.

### Consequences
* Good, because transcript фіксує очікувану користь: оркестратор і watch-демон можуть планувати чергу з урахуванням того, чи вузол вимагає присутності людини.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поле у front-matter `task.md`: `mode: human` (default) або `mode: agent`. Відповідає атрибуту `--actor` у `graph run`: `agent`, `engineer`, `human`, `auditor`.

---

## ADR Асинхронний аудит через чергу замість `flow verify`

## Context and Problem Statement
`flow verify` (самоперевірка виконавця-агента) і аудит через `pending-audit_NNN.md` (зовнішній перевіряльник з черги) виконували одне й те саме — перевірку `## Done when` у `task.md`. Паралельне існування обох механізмів дублює логіку і ускладнює протокол.

## Considered Options
* Залишити обидва: `flow verify` (самоперевірка) + аудит-черга (зовнішній)
* Залишити тільки аудит-чергу, `flow verify` видалити

## Decision Outcome
Chosen option: "Тільки аудит-черга", because самоперевірка та зовнішній аудит роблять те саме — семантична оцінка `## Done when` — і утримувати два механізми не виправдано.

### Consequences
* Good, because протокол агента спрощується: `outputs_NNN.md` → `graph done` (впевнений) або `graph audit` (хоче перевірку) — без проміжного кроку verify.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Audit-черга: агент пише `outputs_NNN.md` і викликає `graph audit <path>`, що створює `pending-audit_NNN.md`. `n-cursor watch` або post-merge hook сканує файли, знаходить `pending-audit_*` без відповідного `run_* (actor: auditor)` і ставить у чергу виконання. Auditor пише `run_NNN.md (actor: auditor, result: success|failed)`.

---

## ADR Схема нумерації `pending-audit_NNN.md` дзеркалює `outputs_NNN.md`

## Context and Problem Statement
При ітеративному виконанні вузла (агент → audit failed → агент доопрацьовує → повторний audit) потрібно однозначно зв'язати запит аудиту з конкретною версією виходу, особливо якщо між запитом і обробкою агент встигає написати нові файли.

## Considered Options
* `pending-audit_NNN.md` з власним лічильником + `ref: outputs_NNN.md` у front-matter
* NNN у `pending-audit_NNN.md` = NNN у відповідному `outputs_NNN.md`
* Єдиний файл `.pending-audit` (overwrite при кожному новому запиті)

## Decision Outcome
Chosen option: "NNN у `pending-audit_NNN.md` = NNN у `outputs_NNN.md`", because ім'я файлу саме по собі є посиланням — `pending-audit_003.md` однозначно вказує на `outputs_003.md` без додаткових полів у front-matter; схема зберігає immutability і не вимагає окремого лічильника.

### Consequences
* Good, because transcript фіксує очікувану користь: числа не губляться при ітераціях, аудитор одразу знає яку версію перевіряти по імені файлу.
* Good, because узгоджена нумерація між `run_NNN.md`, `outputs_NNN.md`, `pending-audit_NNN.md` робить стан вузла читабельним без парсингу вмісту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Схема лічильників: `run_NNN.md` — незалежний лічильник всіх акторів (agent, auditor, engineer). `outputs_NNN.md` і `pending-audit_NNN.md` — спільний ключ. Приклад послідовності: `outputs_001.md` → `pending-audit_001.md` → `run_001.md (actor: auditor, result: failed)` → `outputs_002.md` → `pending-audit_002.md` → `run_002.md (actor: auditor, result: success)` → merge.

---

## ADR `n-cursor watch` як демон і post-merge hook як тригер оркестратора

## Context and Problem Statement
Оркестратор черги задач потребує двох режимів запуску: реактивного (після merge вузла — є нові resolved deps, можна стартувати ready-вузли) і проактивного (моніторинг stale worktrees, audit-черги, бюджетів без постійного polling).

## Considered Options
* Тільки post-merge hook (реактивний, one-shot)
* Тільки демон (постійний процес, watch filesystem)
* Обидва: hook + демон

## Decision Outcome
Chosen option: "Обидва: hook + демон", because hook покриває основний сигнал (merge → scan → run ready nodes) без постійного ресурсного навантаження, а демон (`n-cursor watch`) покриває випадки що hook не бачить: stale worktrees, audit-черга, engineer-budget-exhausted.

### Consequences
* Good, because transcript фіксує очікувану користь: черга обробляється і реактивно і проактивно без потреби вручну запускати сканування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Post-merge hook запускає `graph run --auto` (one-shot: scan → find ready nodes → spawn up to `max_worktrees`). `n-cursor watch` — демон: audit-loop, перевірка `pending-audit_*`, engineer-budget-exhausted, stale worktrees. Конфіг у `.n-cursor.json`: поля `max_worktrees`, `stale_worktree_sec`.
