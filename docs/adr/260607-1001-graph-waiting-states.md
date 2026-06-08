## ADR Семантика станів очікування у graph: waiting-plan / waiting-run

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Стан `waiting` у початковому дизайні покривав три різних сценарії: `h.md` без плану (людина має створити план), `a.md` без плану (агент має автоматично згенерувати план), `h.md`/`a.md` + `plan_*.md` + deps resolved (готово до виконання). Водночас runner ніколи не діє на `h.md`-вузли — лише на `a.md`. Зовнішній monitor або CI, бачачи `waiting`, не міг без читання файлів зрозуміти чи щось відбудеться автоматично. Стан `human-pending` частково вирішував проблему, але лише для `h.md` без плану.

## Considered Options

* Залишити `waiting`, додати поле `actor` у `--json` виводі
* Окремий стан `ready-human` для `h.md` + `plan_*.md` + deps resolved
* Розділити за фазою: `waiting-plan` (потрібен план) / `waiting-run` (план є, готово до виконання); `a.md`/`h.md` — ортогональний вимір "хто виконує"

## Decision Outcome

Chosen option: "`waiting-plan` / `waiting-run` з `a.md`/`h.md` як ортогональним виміром", because стан відповідає на питання "що потрібно далі" (plan або run), а `a.md`/`h.md` — "хто це робить". Усуває дублювання між станом і файлом-прапором. Видалені стани: `waiting`, `human-pending`, `needs-plan`.

### Consequences

* Good, because таблиця станів симетрична і повністю детермінована через `ls`: `waiting-plan` = є `a.md` або `h.md`, немає `plan_*.md`; `waiting-run` = є `plan_*.md`, deps resolved, немає `running_*`, немає `fact_*`.
* Good, because runner та watch отримують однозначний контракт: перевірити стан → перевірити `a.md`/`h.md` → вирішити дію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Повна таблиця нових станів (атомарний вузол):

| Умова (file presence) | Стан |
|---|---|
| `task.md`, немає `a.md`/`h.md` | `unassigned` |
| `a.md` або `h.md`, немає `plan_*.md` | `waiting-plan` |
| `plan_*.md`, deps resolved, немає `running_*`, немає `fact_*` | `waiting-run` |
| `plan_*.md`, deps НЕ resolved | `blocked` |
| `running_<pid>_until_<ts>`, `ts > now()` | `running` |
| `running_<pid>_until_<ts>`, `ts ≤ now()` | `stalled` |
| `pending-audit_N`, немає `audit-result_N` | `pending-audit` |
| `fact_*.md`, немає `invalidated` | `resolved` |
| `run_*.md`, немає `fact_*`, немає `running_*` | `failed` |
| `invalidated` є | `invalidated` |

Runner-логіка (перевіряє стан + `a.md`/`h.md`):
```
waiting-plan + a.md  →  auto: graph plan --mode agent
waiting-plan + h.md  →  skip + notify людину
waiting-run  + a.md  →  auto: graph run
waiting-run  + h.md  →  skip + notify людину
```

Spec: `docs/думка.MD`, секція "Стани вузла".
