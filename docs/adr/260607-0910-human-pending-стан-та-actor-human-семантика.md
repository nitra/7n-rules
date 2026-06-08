## ADR `human-pending` — правильна дефініція стану та семантика `--actor human`

## Context and Problem Statement
Два пов'язані питання виявились у ході аналізу цілісності дизайну. (1) Стан `human-pending` у таблиці станів вузла був визначений як "є `plan_NNN.md`, немає `run_NNN.md`, mode: human", що суперечило семантиці оркестратора (вузол з `plan_NNN.md` вважається готовим до Stage 2 і запускається автоматично). (2) Команда `graph run --actor human` була перелічена у CLI але не мала специфікованої поведінки.

## Considered Options
**Для `human-pending`:**
* Стан = є план + немає run + mode: human (стара дефініція — хибна)
* Стан = mode: human + немає `plan_NNN.md` (виправлена дефініція)
* Прибрати стан, замінити `waiting` з підказкою

**Для `--actor human`:**
* Не підтримувати `--actor human` — видалити з CLI
* Wrapper створює worktree і виводить шлях — людина працює вручну
* Wrapper відкриває інтерактивний термінал

## Decision Outcome
`human-pending`: chosen option "mode: human + немає `plan_NNN.md`", because це єдиний стан де вузол семантично чекає на людину: без плану ні `--auto`, ні `n-cursor watch` не може стартувати Stage 2. Вузол з `plan_NNN.md` і mode: human — просто `waiting` і запускається автоматично як будь-який інший.

`--actor human`: chosen option "wrapper створює worktree і виводить шлях", because це дає людині ізольоване робоче середовище з усіма залежностями (як у агента), і людина самостійно викликає `graph done|audit|failed` після завершення.

### Consequences
* Good, because `human-pending` тепер точно відображає де система чекає участі людини — watch надсилає Telegram тільки для цих вузлів.
* Good, because `--actor human` дозволяє людині виконати вузол з тим самим ізольованим контекстом що і агент, без ручного `git worktree add`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
**Оновлена таблиця станів атомарного вузла:**

| Умова | Стан |
|---|---|
| mode: human + немає `plan_NNN.md` | `human-pending` |
| є `plan_NNN.md` (будь-який mode) або mode: agent без plan | `waiting` |
| активний worktree | `running` |
| є `pending-audit_NNN.md` без `audit-result_NNN.md` | `pending-audit` |
| є `fact_NNN.md` без `invalidated` | `resolved` |
| є `run_NNN.md` без `fact_NNN.md` і немає активного worktree | `failed` |
| є `invalidated` | `invalidated` |

**`--actor human` flow:**
```
graph run tasks/<node>/ --actor human
  → wrapper: git worktree add .worktrees/<node>-<epoch> main
  → виводить: "Worktree ready: .worktrees/<node>-<epoch>/"
  → людина відкриває директорію у редакторі, виконує роботу
  → людина викликає: graph done|audit|failed tasks/<node>/
```

**Moніторинг `human-pending`:** `n-cursor watch` надсилає Telegram якщо вузол у стані `human-pending` > `stale_worktree_min` хвилин без появи `plan_NNN.md`.

Зафіксовано у `docs/думка.MD` (таблиця «Стани вузла», секція «Список команд»).
