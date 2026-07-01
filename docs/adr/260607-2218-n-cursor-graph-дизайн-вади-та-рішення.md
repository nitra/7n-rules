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
