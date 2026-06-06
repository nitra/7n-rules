---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T15:45:14+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

Чисто. `ops/` директорія повністю прибрана. Тепер переходимо до `patches/NNN-plan.md` / `NNN-fact.md` — ітеративно.

Поточна схема в документі:

```markdown
---
created_at: 2026-06-06T10:00:00Z
target_node: collect-data
---
## Reason
Чому потрібен патч.

## Changes
Що буде змінено.
```

```markdown
---
created_at: 2026-06-06T10:02:00Z
result: success | failure
---
## Applied changes
Що фактично змінено.
```

Питання:

**`target_node`** — це завжди вузол де лежить цей файл (в `patches/` цього ж вузла), чи може патч цілити в іншого? Якщо завжди той самий — поле зайве.

**`## Changes`** і **`## Applied changes`** — розрізнення потрібне? Чи достатньо одного `## Reasoning` як у `run_NNN.md`?

---
---

## ADR: прибрати `ops/` директорію та уніфікований `run_NNN.md` з `actor`

## Context and Problem Statement
Архітектура системи передбачала окрему директорію `ops/` з `spawn-plan/fact` та `kill-plan/fact` файлами для WAL-відновлення після перерваного spawn або kill. Також існували окремі файли `error.md`, `repair/NNN.md` і `repair_context.md` для різних типів запусків і відновлення.

## Considered Options
* Залишити `ops/` з plan/fact файлами для crash recovery при spawn і kill
* Прибрати `ops/` — ігнорувати цей сценарій збою (spawn відбувається в ворктрі, обрив = ворктрі не замерджений = граф чистий)
* Уніфікувати `error.md` + `repair/NNN.md` в один `run_NNN.md` з полем `actor`

## Decision Outcome
Chosen option: "Прибрати `ops/`, уніфікований `run_NNN.md`", because сценарій обриву spawn ігнорується на поточному етапі (MacBook, людина-оркестратор), а уніфікація зменшує кількість типів файлів і дає єдиний формат для всіх акторів.

### Consequences
* Good, because transcript фіксує очікувану користь: простіша файлова структура, один формат для agent/engineer/human/auditor, `actor` поле достатньо для розрізнення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `run_NNN.md` frontmatter: `created_at`, `actor: agent|engineer|human|auditor`, `result: success|failed`
- Секції: `## Reasoning` (агент), `## Script` (wrapper: exit_code, stderr), `## Ref` (ref на outputs або patch)
- `outputs_NNN.md` — окремий immutable файл на кожен успішний запуск
- `repair_context.md` прибрано — `budget_sec` переїхав у `task.md`
- Файл: `/Users/vitaliytv/www/nitra/cursor/docs/думка.MD` (розділ "Схеми файлів")
