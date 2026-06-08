## ADR Бюджетна система вузла: м'який/жорсткий ліміт, progress watchdog та ENV-змінні

## Context and Problem Statement
Вузол DAG має `budget_sec` як часовий ліміт виконання. Виникло кілька проблем: (1) деякі задачі мають незмінні зовнішні залежності і завжди перевищуватимуть будь-який бюджет (скрапінг, повільні API); (2) агент у headless процесі не знає скільки часу залишилось і не може підготуватись до зупинки; (3) `budget_sec` задається людиною при створенні задачі, але реалістичну оцінку можна зробити лише після аналізу (Stage 1).

## Considered Options
* SIGTERM агенту при перевищенні — агент не знає про ліміт до SIGTERM
* ENV-змінні при старті + агент сам перевіряє залишок
* Два поля: `budget_sec` (м'який, агент моніторить) + `budget_hard_sec` (жорсткий kill)
* `budget_hard_sec: 0` = без kill для структурно повільних задач
* `progress_timeout_sec` — kill якщо немає змін у worktree N секунд (watchdog)
* Stage 1 уточнює бюджет у `plan_NNN.md` перед виконанням

## Decision Outcome
Chosen option: "ENV-змінні + soft/hard + progress watchdog + Stage 1 refinement", because:
- агент знає ліміт з першої секунди і може підготуватись до зупинки (`NCURSOR_BUDGET_SEC`, `NCURSOR_STARTED_AT`)
- `budget_hard_sec: 0` дає спосіб вимкнути kill для повільних але активних задач
- `progress_timeout_sec` ловить справжні зависання (не зайнятість) — агент що активно працює постійно оновлює файли
- Stage 1 (`graph plan`) аналізує задачу і може виставити реалістичний бюджет у `plan_NNN.md`

### Consequences
* Good, because агент сам керує своїм часом — може писати checkpoint у `run_NNN.md` при нестачі часу замість несподіваного kill.
* Good, because `budget_hard_sec: 0` + `progress_timeout_sec` дає безпечну комбінацію для повільних задач — без зависань при нескінченному run.
* Good, because Stage 1 уточнення усуває класичну проблему "бюджет виставлений без знання задачі".
* Bad, because агент може ігнорувати ENV-змінні і не готуватись до зупинки — wrapper все одно кілить.

## More Information
**Пріоритет budget-полів:** `plan_NNN.md` > `.n-cursor-override.json` > `task.md` > `.n-cursor.json`

**ENV-змінні при старті агента:**
```bash
NCURSOR_BUDGET_SEC=7200        # м'який ліміт (сек)
NCURSOR_HARD_BUDGET_SEC=14400  # жорсткий kill (0 = вимкнено)
NCURSOR_STARTED_AT=1749290400  # Unix timestamp старту
```
Агент обчислює: `remaining = started_at + budget_sec - now()`

**Wrapper-логіка:**
- поллінг `mtime` worktree кожні 5 сек
- якщо немає змін > `progress_timeout_sec` → SIGKILL + `result: progress-timeout`
- якщо elapsed > `budget_hard_sec` (> 0) → SIGKILL + `result: budget-exceeded`

**`plan_NNN.md` front-matter:**
```yaml
budget_sec: 3600          # уточнений бюджет (перекриває task.md)
budget_hard_sec: 10800    # уточнений hard limit (0 = без kill)
progress_timeout_sec: 600 # per-task override
```

**`.n-cursor.json` дефолти:**
```json
{
  "default_budget_sec": 1800,
  "budget_hard_sec_multiplier": 3,
  "progress_timeout_sec": 300
}
```

Зафіксовано у `docs/думка.MD` (схеми `task.md`, `plan_NNN.md`, «Wrapper-скрипт», «Конфіг»).
