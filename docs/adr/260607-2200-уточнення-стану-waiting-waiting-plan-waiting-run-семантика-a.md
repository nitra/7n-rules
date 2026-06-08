---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T22:00:33+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Всі 10 вад і 4 ризики розібрані та зафіксовані.

**Підсумок погоджених змін** (ще не внесені в `docs/думка.MD`):

| # | Зміна |
|---|---|
| Вада 1 | `running_<pid>_until_<ts>` — PID у sentinel; cleanup при старті і в watch |
| Вада 2 | `waiting-plan` / `waiting-run` замість `waiting`/`human-pending`/`needs-plan` |
| Вада 3 | `deps/` вкладена структура для крос-рівневих залежностей |
| Вада 4 | `fact_NNN.md` для composite — пише wrapper після merge останньої дитини, cascade вгору |
| Вада 5 | `.md` розширення у `deps/` — стандарт по всьому документу |
| Вада 6 | `audit-result_NNN.md` deletable; `graph audit-retry` для retry без нового run |
| Вада 7 | Закрита — семантика у структурі файлів |
| Вада 8 | Видалити `mode:` з `plan_NNN.md` |
| Вада 9 | Перший запуск — без run history; retry — останні 2 runs; `max_context_runs` у `a.md` |
| Вада 10 | Агент завжди пише `a.md`/`h.md` при `graph plan`; людина може перевизначити |
| Ризик 1 | `max_worktree_age`; `budget_hard_sec: 0` заборонено (= global default) |
| Ризик 2+3 | `graph kill --recursive`; `--keep-resolved`; orphan detection у `graph scan` |
| Ризик 4 | `grace_period: 120` у `.n-cursor.json` |

Хочеш щоб я вніс всі ці зміни в `docs/думка.MD`?

---

*Це той фрагмент розмови для якого запитував ADR:*

---

## ADR Уточнення стану `waiting` → `waiting-plan` / `waiting-run` + семантика `a.md`/`h.md`

## Context and Problem Statement
Стан `waiting` використовувався для двох принципово різних ситуацій: коли вузол потребує створення плану, і коли вузол готовий до виконання. Крім того, `human-pending` дублював частину семантики `waiting`. Потрібно було чітко розділити "що потрібно зробити" (стан) і "хто це робить" (`a.md`/`h.md`).

## Considered Options
* Залишити один стан `waiting`, додати `ready-human` як окремий стан
* Розбити відповідальність: стан = фаза роботи; `a.md`/`h.md` = виконавець
* Переіменувати `waiting` без розбиття

## Decision Outcome
Chosen option: "Розбити відповідальність: стан = фаза; sentinel = виконавець", because це усуває семантичну двозначність без введення надмірних станів. `waiting-plan` означає "потрібен план" незалежно від того хто планує; `waiting-run` означає "план є, залежності resolved". Runner перевіряє `a.md`/`h.md` щоб вирішити чи діяти автоматично або чекати людину.

### Consequences
* Good, because таблиця станів однозначна: зовнішній monitor або CI badge завжди розуміє що потрібно без читання вмісту файлів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`. Нова таблиця станів зафіксована у `/Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/memory/project_graph_design_review.md` (вада №2). Runner-логіка: `waiting-plan + a.md` → auto plan; `waiting-plan + h.md` → skip + notify; `waiting-run + a.md` → auto run; `waiting-run + h.md` → skip + notify.

---

## ADR `running_<pid>_until_<ts>` — гібридний sentinel для stalled detection і cleanup

## Context and Problem Statement
Sentinel файл `running_until_<ts>` не мав механізму cleanup при аварійному завершенні процесу (`kill -9`, OOM). Після краша файл залишався, вузол вічно залишався у стані `stalled`, і новий запуск був неможливий без ручного втручання.

## Considered Options
* Cleanup як перший крок нового запуску (перевірка при старті)
* PID у назві sentinel файлу (`running_<pid>_until_<ts>`)
* Окремий cleanup daemon

## Decision Outcome
Chosen option: "Гібрид A+B — PID у назві + cleanup при старті і в watch", because PID у назві дозволяє детектувати живість процесу через `kill -0 <pid>` без читання вмісту (інваріант збережено). Cleanup відбувається в двох точках: wrapper при старті нового `graph run` і `n-cursor watch` при кожному скані.

### Consequences
* Good, because transcript фіксує очікувану користь: автоматичний cleanup без ручного втручання, збереження інваріанту "стан з listing".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/думка.MD`. Нова назва sentinel: `running_<pid>_until_<ts>`. Watch: `kill -0 <pid>` → якщо мертвий → cleanup + `run_NNN.md (result: failed, crash)`. Зафіксовано у `memory/project_graph_design_review.md` (вада №1).
