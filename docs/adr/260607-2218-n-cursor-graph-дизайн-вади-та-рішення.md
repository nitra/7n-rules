---
type: ADR
title: "тільки при result: failed:"
---

**Status:** Accepted
**Date:** 2026-06-07

## ADR n-cursor graph — виправлення вад дизайну та архітектурні рішення

## Context and Problem Statement

Специфікація `docs/думка.MD` описує рекурсивний складений ОАГ задач з файловим сховищем стану. Після детального ітеративного розбору виявлено 10 вад дизайну і 4 ризики масштабування. Кожна вада розібрана окремо з погодженим варіантом рішення. Цей ADR фіксує фінальні рішення по всіх пунктах.

## Considered Options

По кожній ваді/ризику розглядались 2–3 варіанти (описані нижче у Decision Outcome). Інші архітектурні альтернативи (централізований state store, EventSourcing, БД) у transcript не обговорювались — файловий підхід зафіксований як основа у попередніх ADR.

## Decision Outcome

### Вада 1 — Sentinel `running_<pid>_until_<ts>` без cleanup після краша

**Обраний варіант: гібрид A+B**

- Ім'я файлу: `running_<pid>_until_<ts>` — PID і deadline в одній назві, детектується через `ls` без читання вмісту.
- Wrapper при старті нового `graph run <path>` перевіряє `kill -0 <pid>`: якщо процес мертвий — cleanup sentinel + orphan worktree → продовжити запуск.
- `n-cursor watch` при кожному скані виконує ту саму перевірку: `kill -0 <pid>`; якщо мертвий → cleanup + transition у `failed`.

Варіант A (cleanup при старті) і B (PID у назві) обрані разом, оскільки доповнюють одне одного: B дає детекцію без читання, A забезпечує автоматичне відновлення в двох точках входу.

---

### Вада 2 — Стан `waiting` неоднозначний (агент vs людина)

**Обраний варіант: два нових стани + `a.md`/`h.md` як "хто", стан як "що"**

Ортогональне розділення:
- **Стан** = що потрібно зробити (`waiting-plan`, `waiting-run`, `blocked`, …)
- **`a.md`/`h.md`** = хто виконує (агент або людина)

Нова таблиця станів атомарного вузла:

| Файли | Стан |
|---|---|
| `task.md`, немає `a.md`/`h.md` | `unassigned` |
| `a.md` або `h.md`, немає `plan_*.md` | `waiting-plan` |
| `plan_*.md`, deps resolved, без `running_*`, без `fact_*` | `waiting-run` |
| `plan_*.md`, deps НЕ resolved | `blocked` |
| `running_<pid>_until_<ts>`, `ts > now()` | `running` |
| `running_<pid>_until_<ts>`, `ts ≤ now()` | `stalled` |
| `pending-audit_N`, без `audit-result_N` | `pending-audit` |
| `fact_*.md`, без `invalidated` | `resolved` |
| `run_*.md`, без `fact_*`, без `running_*` | `failed` |
| `invalidated` є | `invalidated` |

Runner завжди читає стан + `a.md`/`h.md`:
```
waiting-plan + a.md  → auto: graph plan --mode agent
waiting-plan + h.md  → skip + notify
waiting-run  + a.md  → auto: graph run
waiting-run  + h.md  → skip + notify
```

Видалені старі стани: `human-pending`, `needs-plan`. Стан `waiting` замінений на `waiting-plan`/`waiting-run`.

---

### Вада 3 — `deps/` тільки для siblings

**Обраний варіант: вкладена структура `deps/`**

`deps/` може містити піддиректорії — структура дзеркалює `tasks/`:

```
deps/
  collect-data.md          ← сусід (tasks/<parent>/collect-data/)
  research/
    analyze.md             ← крос-рівень (tasks/research/analyze/)
```

`ls -R deps/` → `research/analyze.md` → обрізати `.md` → dep-id = `research/analyze`. Повний шлях відносно `tasks/`. Без читання вмісту.

---

### Вада 4 — Composite `resolved` implicit і дорогий

**Обраний варіант: явний `fact_NNN.md` для composite вузла**

Коли `graph done <child>` виконує merge останньої дитини:
1. Перевіряє батька: всі дочірні директорії мають `fact_*.md`?
2. Якщо так → пише `tasks/<parent>/fact_NNN.md` (NNN = count існуючих + 1) зі `## Summary` = агрегація `## Summary` дітей.
3. Рекурсивно перевіряє батька батька (cascade вгору по одному проходу).

Composite `fact_NNN.md` пише оркестратор автоматично, не агент. `graph scan` стає O(n) замість O(n×depth).

---

### Вада 5 — Суперечність у іменуванні файлів `deps/`

**Рішення: завжди `.md`**

Всі файли у `deps/` мають розширення `.md`. Скрипт обрізає `.md` щоб отримати dep-id. Консистентно з `task.md`, `a.md`, `h.md`.

---

### Вада 6 — Повторний аудит того самого `fact_NNN.md`

**Рішення: `audit-result_NNN.md` deletable**

- `audit-result_NNN.md` — не immutable, можна видалити при retry.
- `graph audit-retry <path>` видаляє `audit-result_NNN.md`. Watch бачить `pending-audit_N` без `audit-result_N` → перезапускає аудит.
- Audit trail зберігається через `git log` (видалення фіксується).
- Новий `run` потрібен тільки якщо сам `fact_NNN.md` невалідний (аудитор відхилив факт, не process).

---

### Вада 7 — Версійність схеми

**Рішення: `graph migrate` при релізі нової версії**

При релізі нової версії `n-cursor` — обов'язковий `graph migrate` приводить всі існуючі файли до нової схеми. Змішаних версій у директорії ніколи не існує. `schema_version:` у файлах не потрібен — версія = версія інструменту.

---

### Вада 8 — `plan_NNN.md` дублює `mode:`

**Рішення: видалити `mode:` з `plan_NNN.md`**

`mode:` видаляється з frontmatter `plan_NNN.md`. Актуальний mode завжди визначається `a.md`/`h.md`. Plan описує що робити, не хто і як.

---

### Вада 9 — Context агента зростає без bounds

**Рішення: frontmatter summary у `run_NNN.md`**

`run_NNN.md` frontmatter:
```yaml
---
created_at: ISO8601
result: done | failed
summary: "одноречення — що намагались зробити"
# тільки при result: failed:
blockers:
  - "конкретна причина провалу"
next_attempt: "рекомендація для наступного агента"
---
```

Wrapper парсить тільки frontmatter (зупиняється на `---`) — body не читається. Для наступного агента будується компактний `prior_attempts` блок з усіх failed runs:

```yaml
prior_attempts:
  - run: 001
    summary: "..."
    blockers: [...]
    next_attempt: "..."
```

`blockers` і `next_attempt` — обов'язкові поля при `result: failed`. Без них summary порожній. Body `run_NNN.md` — необмежений, тільки для людського аудиту.

---

### Вада 10 — `unassigned` без auto-assignment

**Рішення: агент пише `a.md`/`h.md` під час `graph plan`**

При `graph plan <composite> --mode agent` агент визначає декомпозицію і для кожного дочірнього вузла пише `a.md` або `h.md` як частину planning output. Composite children завжди мають sentinel після spawn. `unassigned` залишається валідним тільки для кореневого вузла (після `graph init` без `--mode`).

---

### Ризик 1 — Disk saturation від паралельних worktrees агентів

**Рішення: `agent_concurrency` — черга агентів**

- `agent_concurrency: N` у `.n-cursor.json` — максимум N агентських процесів одночасно.
- Watch перед spawn перевіряє: живих агентських worktrees < N → spawn; інакше — queue, чекати звільнення.
- Людські worktrees (`h.md` + `--actor human`) не рахуються і не обмежуються.
- Живі worktrees — недоторканні завжди. Orphan cleanup — через Ваду 1 (PID check).

---

### Ризик 2 — Каскадна інвалідація кореня

**Рішення: git checkpoint tags + diff-based cascade**

- `graph done <path>` перед merge пише git tag: `checkpoint/tasks/<path>/fact_NNN`.
- Після re-run → новий tag `checkpoint/tasks/<path>/fact_NNN+1`.
- `git diff <tag-old> <tag-new>` → список змінених файлів.
- Для кожного downstream: чи `deps/<path>.md → ref:` входить у diff? Так → `invalidated`; Ні → залишається `resolved`.
- Без `ref:` у dep-файлі → conservative cascade.
- `graph invalidate` виконує diff ПЕРЕД записом `invalidated` у downstream.

---

### Ризик 3 — LLM non-determinism у composite re-plan

**Рішення: post-plan orphan detection**

- `graph kill <composite>` → видаляє `plan_NNN.md` + cascade `invalidated` у всіх прямих нащадках (директорії не видаляє).
- `graph plan <composite>` → агент пише новий `plan_NNN+1.md` + створює нові дочірні директорії.
- Post-hook порівнює: існує у новому плані → залишаємо; тільки у старому → видаляємо директорію (після `kill -0 <pid>` перевірки).
- Cleanup відбувається ПІСЛЯ нового плану. Перетинаючі діти → перевиконуються з diff-based cascade (Ризик 2).

---

### Ризик 4 — Clock skew на distributed FS

**Рішення: MVP won't fix; `grace_period_sec` на майбутнє**

Single-machine + local git — base scope. NTP — відповідальність OS. Якщо знадобиться multi-host: `grace_period_sec: 30` у `.n-cursor.json` — Watch вважає `stalled` тільки якщо `ts + grace_period_sec ≤ now()`.

## More Information

- Специфікація: `docs/думка.MD` — потребує оновлення відповідно до цих рішень.
- Memory: `/Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/memory/project_graph_design_review.md`
- Попередні ADR: `рекурсивний-складений-ОАГ-динамічний-розклад.md`, `файловий-стан-append-only-план-факт.md`

## Update 2026-06-06

Зафіксовано додаткові правила дизайну динамічного графу задач:

- EngineerAgent є мета-рівнем поза графом, а не вузлом усередині графу. Він отримує повний path від root до failed-вузла і може патчити вузол, батька або root.
- Граф мутабельний через каскадну інвалідацію: patch вузла інвалідує його successors до листів.
- Памʼять repair належить вузлу, а не інженеру: `repair_history.md` є append-only журналом, який читає кожен наступний виклик інженера.
- Convergence guard інженера — часовий бюджет, а не `max_attempts`; кожен батьківський рівень ескалації отримує свіжий budget.
- Worktree є межею атомарності: successors стартують лише після merge worktree.
- `plan → action → fact` використовується як write-ahead log для spawn, kill і patch.
- Топологія підграфу розподілена: `deps:` у `task.md` кожного child-вузла, без центрального `graph.md`.
- Inputs merged у `task.md`; `context.md` генерується resolver-ом як аудит того, що бачив агент.
- Агент отримує повні `outputs.md` deps і семантично інтерпретує їх; typed ports не вводяться.

## Update 2026-06-06

Сформовано узагальнений контракт динамічного самомодифікованого графу задач:

- Вузол може бути атомарним або compound; compound динамічно створює `subgraph/`.
- Батьківський вузол не знає внутрішню структуру child-підграфу і чекає лише resolved/failed state.
- EngineerAgent може перепроєктувати підграф: замінити, додати або прибрати вузли.
- File-system state store є авторитетним джерелом стану; БД або центральний runtime state не вводяться.
- Git worktree merge є точкою прийняття результату.
- Конфлікт merge трактується як нова задача для медіатора.
- Ескалація repair має часовий бюджет на кожному рівні; root timeout повідомляє SeniorEngineer.
- `docs/думка.MD` отримав роль контракту файлів: схеми `task.md`, `outputs.md`, `error.md`, `repair_context.md`, `repair_history.md`, `ops/*`, `patches/*`.

## Update 2026-06-06

- Топологія графу зберігається розподілено: кожен дочірній вузол описує попередників у `deps:` власного `task.md`, центральний `graph.md` не використовується.
- `inputs.md` злито в `task.md` як секцію `## Inputs`, щоб агент читав один стартовий контракт.
- Для всіх спроб виконання використовується `run_NNN.md` з `actor: agent|engineer|human|auditor` і `result: success|failed`; `outputs_NNN.md` містить продукт успішної спроби.
- Append-only/immutability починається після `git worktree add`; до цього файли вузла можна редагувати.
- Назви файлів і директорій у машинно-оброблюваному graph-state мають бути англійською: `ops/`, `patches/`, `subgraph/`, `task.md`, `outputs_NNN.md`.
- `budget_sec` є властивістю задачі й живе у frontmatter `task.md`, а не в окремому `repair_context.md`.

## Update 2026-06-06

Фінальний контракт файлів динамічного графу задач:

- Формат файлів: Markdown + YAML frontmatter.
- Атрибути frontmatter: англійські, `snake_case`; перше поле завжди `created_at` у ISO 8601.
- Заголовки секцій, які парсить script/orchestrator, — англійські; секції з довільними даними можуть бути будь-якою мовою.
- Імена файлів і директорій — англійські.
- Файли immutable після створення worktree; до `git worktree add` дозволене редагування й видалення.
- `task.md` є єдиним файлом визначення вузла: frontmatter містить `created_at`, обовʼязковий `budget_sec`, опційний `parent`, опційний `deps`; тіло містить `## Task`, `## Done when`, опційний `## Inputs`.
- `id` вузла не дублюється у frontmatter: він читається з назви директорії вузла.
- `deps` містить лише sibling node id; `ref:` використовується для посилання на конкретні дані.
- `outputs_NNN.md` створюється на успішний запуск; актуальним є файл із найбільшим номером.
- `run_NNN.md` — один immutable файл на одну спробу будь-якого актора з frontmatter `created_at`, `actor: agent | engineer | human | auditor`, `result: success | failed`; секції: обовʼязкова `## Reasoning`, опційна `## Script`, опційна `## Ref`.
- `error.md`, `repair_history.md`, `repair_context.md`, `ops/` і `patches/` видалені як окремі структури; зміни інженера описуються у `## Reasoning` відповідного `run_NNN.md`.
- `invalidated` — порожній sentinel-файл; наявність означає invalidated state.
- Стан вузла визначається файлами: тільки `task.md` → `waiting`; активний worktree → `running`; є `outputs_*.md` і немає `invalidated` → `resolved`; є `run_*.md`, але немає `outputs_*.md` → `failed`; є `invalidated` → `invalidated`.

## Update 2026-06-06

Уточнено файловий контракт вузла динамічного графу задач:

- `inputs.md` не створюється окремо; inputs живуть у секції `## Inputs` всередині `task.md`.
- `run_NNN.md` уніфікує спроби всіх акторів через `actor: agent | engineer | human | auditor` і замінює окремі `error.md`, `repair_history.md`, `repair_context.md`.
- `budget_sec` перенесено у frontmatter `task.md`.
- Імена файлів і директорій мають бути англійською, бо їх обробляють скрипти; секції, які парсить оркестратор, також мають англійські заголовки.
- Append-only/immutability починається після створення git worktree; до цього файли вузла можна редагувати або видаляти.
- `ops/` і `patches/` видалено як передчасний WAL-патерн для spawn/kill/patch recovery.
- `graph run` без аргументів працює як оркестратор-цикл: сканує готові вузли з resolved deps, запускає незалежні вузли паралельно, після merge повторює сканування.
- Конфіг `.n-cursor.json`: `warn_worktrees_above: 4`, `max_worktrees: 8`.

Команди, зафіксовані transcript: `graph run [<path>]`, `graph kill <path>`, `graph invalidate <path> [--cascade]`, `graph done`, `graph failed`, `graph spawn`.

## Update 2026-06-06

Фіналізовано файловий контракт вузла динамічного графу задач:

- Основна структура вузла: `task.md`, `run_NNN.md`, `outputs_NNN.md`, дочірні директорії та тимчасовий `running.lock`.
- `task.md` містить місію, `## Inputs`, `budget_sec`, `deps`, `parent`; immutable після створення worktree.
- `run_NNN.md` містить `created_at`, `actor`, `result`, optional `worktree`, секції `## Reasoning`, `## Script`, `## Ref`.
- `outputs_NNN.md` містить `## Summary` і named-порти для наступників.
- `created_at` є першим полем у frontmatter усіх файлів.
- `running.lock` з PID — єдиний тимчасовий файл активного виконання.
- `graph kill` читає PID, зупиняє процес і каскадно інвалідує наступників.
- NNN нумерація генерується wrapper-скриптом через підрахунок `run_*.md`.
- `artifacts/` є фіксованою субдиректорією вузла.

Відкритими в transcript лишались лише max depth графу і max file size; решта питань файлового контракту закрита.

## Update 2026-06-06

- Додано роль аудитора як опціональний read-only крок після успіху агента.
- `audit: true` у frontmatter `task.md` вмикає аудит конкретного вузла; дефолт — без аудиту.
- Wrapper після `result: success` агента запускає аудитора без worktree; аудитор пише `run_(NNN+1).md` з `actor: auditor` і `result: success | failed`.
- Якщо аудитор повертає `result: failed`, вузол не мержиться і агент має бути перезапущений з feedback.
- Конфіг `.n-cursor.json` може містити `audit_model` для вибору дешевшої моделі аудитора.

## Update 2026-06-06

- Для вузлів додано опційний аудит: `audit: false` за замовчуванням у `task.md`, людина явно ставить `audit: true`.
- Після `result: success` wrapper запускає окрему спробу з `actor: auditor`, якщо аудит увімкнено.
- Аудитор читає `outputs_NNN.md` і `task.md#Done when`, пише лише власний `run_NNN.md` з `actor: auditor` і `result: success | failed`; граф і `task.md` він не змінює.
- Провал аудиту переводить вузол у failed-сценарій, який підхоплює той самий механізм інженера.

## Update 2026-06-06

- `run_NNN.md` замінює розрізнені `repair_history.md`, `error.md`, `outputs.md` як один immutable файл на спробу будь-якого актора.
- Явне поле `actor` у frontmatter дозволяє orchestration/observability-скриптам відрізняти `agent`, `engineer`, `human` без парсингу markdown-тіла.
- `budget_sec` зберігається у `task.md`, а не в `repair_context.md`, бо це частина специфікації вузла.
- `patches/` і `ops/` прибрано; crash recovery для spawn/kill відкладено, а зміни інженера описуються в `## Reasoning`.
- Нумерація `run_NNN.md` і `outputs_NNN.md` виконується через підрахунок наявних файлів із zero-padding до 3 цифр; race condition при паралельних спробах одного вузла прийнято як компроміс.
- `graph kill <path>` обʼєднує kill процесів worktree, `git worktree remove` і каскадне створення `invalidated` для наступників.
- Після merge worktree git `post-merge` hook запускає `graph run --auto` для продовження графа.

## Update 2026-06-06

Transcript зафіксував проміжну реалізацію `n-cursor graph`, яку після сесії відкочено для переходу до ітеративного проєктування.

Деталі, які варто зберегти як матеріал для наступного дизайну:

- Стан вузла DAG пропонувався як файловий стан у `tasks/<node>/`: `task.md`, `run_NNN.md`, `outputs_NNN.md`, sentinel `invalidated`.
- Деривація станів: `waiting` — лише `task.md`; `running` — активний worktree; `resolved` — існує `outputs_NNN.md`; `failed` — є `run_NNN.md` без `outputs_NNN.md`; `invalidated` — sentinel `invalidated`.
- Було створено `npm/scripts/graph/state.mjs` із функціями `deriveNodeState`, `latestNumbered`, `nextNumbered`, `sanitizePathToWorktreePrefix`; тести `npm/scripts/graph/tests/state.test.mjs` проходили.
- Нова система пропонувалась як паралельний модуль `npm/scripts/graph/`, тоді як legacy `scripts/dispatcher/graph.mjs` лишався доступним через routing `graph-dag`.
- Для комунікації агент → wrapper пропонувався sentinel `.ncursor-signal` із типами `done`, `audit`, `failed`, `spawn`.
- Реалізацію відкочено командами `git checkout -- npm/bin/n-cursor.js`, `rm -rf npm/scripts/graph/`, `rm -f .changes/260606-2107.md`; попередні зміни сесії залишились недоторканими.
- Причина відкату: перейти до ітеративної дискусії перед наступною імплементацією.

## Update 2026-06-06

Transcript зафіксував варіант інтеграції `flow` із новою архітектурою `думка.MD`: `graph` має бути зовнішнім оркестратором, який керує worktree lifecycle, залежностями, merge і cascade, а `flow` — внутрішнім протоколом одного вузла всередині worktree.

За цим дизайном:

- `.flow.json`, `docs/specs/`, `docs/plans/`, `flow init` і `flow spec` зникають.
- Нові артефакти вузла: `task.md`, `plan_001.md`, `outputs_NNN.md`.
- `flow release` замінюється сигналами `graph done|audit|failed`.
- Виконання вузла ділиться на Stage 1 Planning і Stage 2 Execution.
- Stage 1 запускається як `flow plan` і обʼєднує design та decompose.
- `mode:` у frontmatter `task.md` керує режимом: `human` для інтерактивного діалогу, `agent` для автономної роботи.
- Вихід Stage 1: або `plan_001.md` для атомарного вузла, або дочірні `task.md` і `graph spawn` для складеного вузла.
- Stage 2 виконує роботу, запускає `flow verify` за критеріями `## Done when`, пише `outputs_NNN.md` і сигналізує `graph done|audit|failed`.

## Update 2026-06-07

- Зафіксовано межу відповідальності: `graph` оркеструє DAG, merge і worktrees; `flow` стає execution engine/protocol всередині одного graph-вузла.
- `docs/думка.MD` лишається living spec і джерелом правди; `.n-cursor/system-prompt.md`, `.n-cursor/engineer-prompt.md`, `.n-cursor/actors.md` деривуються з нього для runtime-агентів.
- Додано модель файлової черги аудиту: `pending-audit_NNN.md`, де `NNN` відповідає `outputs_NNN.md`; `n-cursor watch` сканує вузли зі станом `pending-audit` і запускає `flow verify`.
- Додано capability manifest `.n-cursor/actors.md` і поле `actors:` у `task.md`; `graph run --actor X` має перевіряти дозволені actor-и перед стартом.
- Новий набір станів вузла включає `waiting`, `plan-pending`, `running`, `pending-audit`, `resolved`, `failed`, `invalidated`.

## Update 2026-06-07

- Для аудиту обрано окремий файл `audit-result_NNN.md` замість запису auditor-результату в `run_NNN.md`.
- `pending-audit_NNN.md` вважається consumed, якщо існує `audit-result_NNN.md` з тим самим `NNN`; це прибирає потребу порівнювати timestamps або парсити `audit_ref`.
- Composite-вузол вважається `resolved` через implicit aggregation дітей: усі діти `resolved` → батько `resolved`; `fact_NNN.md` у composite-вузлі не потрібен.
- `graph run --auto` і `n-cursor watch` координуються через worktree-директорію як atomic FS lock: `mkdir .worktrees/<node>-<hash>/`; конкурент отримує `EEXIST` і пропускає spawn.
- `graph run --actor auditor` є wrapper: запускає auditor subprocess, читає `audit-result_NNN.md`, при `result: success` виконує merge і видаляє worktree.
- `mode: human` вузли без `plan_001.md` пропускаються `--auto`; людина запускає `graph plan <path>` вручну, а `graph status` показує явний `human-pending` стан.
- Transcript фіксує ризики: orphan worktree після crash має прибиратися idempotent наступним `--auto` тiком; Telegram-нагадування для human-pending залишено TODO.

## Update 2026-06-07

- Файл результату виконання вузла перейменовано з `outputs_NNN.md` на `fact_NNN.md`, щоб утворити семантичну пару `plan_NNN.md` / `fact_NNN.md`.
- У `task.md` додано поля оцінки виконавця: `executor: agent|human`, `model_tier: MIM|AVG|MAX`, `skills: [...]`, `qualification: ""`; `plan_NNN.md` може override ці значення аналогічно до budget-полів.
- Нумерація `plan_NNN.md` продовжується для merged або active вузлів, але після `graph kill` скидається до `001`, бо `graph kill` видаляє `plan_*.md` як повний reset вузла.
- `n-cursor watch` на початковому етапі визначено як periodic rescan раз на 5 хвилин, а не persistent daemon з file-watching.
- У цій чернетці також було зафіксовано рішення залишити stall implicit, але воно пізніше в цьому ж батчі замінене рішенням про `running_until_<ts>` sentinel-файл.
- Файл, у якому вносилися зміни дизайну: `docs/думка.MD`.

## Update 2026-06-07

- Стан `stalled` зроблено явним через sentinel-файл `running_until_<unix_ts>` у директорії task-вузла.
- `running` визначається як наявність `running_until_<ts>` з `ts > now()`, а `stalled` — як наявність такого файлу з `ts ≤ now()`.
- Deadline кодується в імені файлу, тому `n-cursor watch` може визначати `running`/`stalled` через filename parse без читання вмісту task/worktree файлів.
- Wrapper пише sentinel після `git worktree add`, видаляє його при success, failed cleanup і `graph kill`.
- Це оновлення замінює попередній варіант, де stall залишався implicit через аналіз mtime worktree та budget-полів.

## Update 2026-06-07

Драфт фіксує пакет рішень для `n-cursor graph` після аналізу вад і ризиків:

- стан вузла має визначатися через file listing: presence файлів, директорій і parse filename, без читання вмісту;
- `a.md`/`h.md` лишають `task.md` стабільним і кодують виконавця як mutable sentinel;
- `deps/` замінює `deps:` frontmatter, щоб список залежностей отримувався через `ls deps/`;
- `fact_NNN.md` лишається окремим sentinel успіху, зокрема для composite-вузлів, щоб `resolved` визначався O(1);
- `running_<pid>_until_<ts>` кодує running/stalled deadline і PID у назві файлу;
- audit FAIL переходить у `invalidated` і запускає новий цикл з новим NNN;
- context агента обмежується `max_context_runs`, щоб не завалювати prompt історією невдалих запусків;
- `max_worktrees: 4` + FIFO queue обмежує паралельні worktrees;
- `graph invalidate --cascade` лишається explicit manual-командою для каскадної інвалідації;
- `graph pin` стабілізує composite-топологію після першого planning;
- distributed multi-machine clock skew не входить у scope, але `stale_grace_sec: 60` може бути safety buffer для NTP jitter.

Transcript явно фіксує trade-off: більше sentinel-файлів і явних CLI-команд, зате scan, recovery і зовнішній monitoring працюють без YAML parsing і без прихованої БД стану.

## Update 2026-06-07

Драфт уточнює фінальну модель станів graph-вузла:

- `running_<pid>_until_<ts>` є git-ignored sentinel для `running`/`stalled`;
- wrapper і `n-cursor watch` виконують `kill -0 <pid>`; якщо процес мертвий — прибирають sentinel і orphan worktree та пишуть `run_NNN.md` з failure reason;
- `budget_hard_sec: 0` потребує спеціальної конвенції: не створювати deadline у минулому або трактувати `0` як `без ліміту`;
- `a.md`/`h.md` лишаються mutable mode-sentinels, а `deps/` — listing-based залежностями;
- попередні стани `waiting`, `human-pending` і `needs-plan` замінюються ортогональною парою `waiting-plan` / `waiting-run`: стан відповідає на питання `що потрібно далі`, а `a.md`/`h.md` — `хто виконує`.

Нова таблиця станів з transcript: `unassigned`, `waiting-plan`, `waiting-run`, `blocked`, `running`, `stalled`, `pending-audit`, `resolved`, `failed`, `invalidated`. Runner-логіка: `waiting-plan + a.md` → auto plan, `waiting-plan + h.md` → notify/skip, `waiting-run + a.md` → auto run, `waiting-run + h.md` → notify/skip.
