---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:07:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Все збалансовано. Рухаємось до **B — рефакторинг `flow`**.

Нагадую scope B:
- Видалити: `flow init`, `flow spec`, `flow review`, `flow gate`, `flow run`, `flow resume`, `flow cancel`, `flow repair`, `flow release`
- Переосмислити: `flow plan` (Stage 1, з `plan_001.md`)
- Посилити: `flow verify` (читає `## Done when` + `outputs_NNN.md` + git diff)
- Оновити: `n-flow.mdc` (новий контракт)

Починаємо?
[user]
так
---
[/TRANSCRIPT]

---

Please generate the ADR(s) now based on the transcript above.

## ADR Аудит-черга через `pending-audit_NNN.md`

## Context and Problem Statement
Потрібно визначити механізм запуску аудитора після того, як агент завершує роботу над вузлом DAG. Існуючий дизайн передбачав синхронний запуск аудитора безпосередньо через wrapper-скрипт, але система мала перейти до нового контракту на основі файлів (`tasks/`).

## Considered Options
* Синхронний запуск аудитора wrapper-скриптом (старий підхід — `graph audit` → auditor у тому ж worktree одразу)
* Асинхронна черга через файл `pending-audit_NNN.md` (новий підхід — `graph audit` записує файл, `n-cursor watch` підхоплює)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Асинхронна черга через `pending-audit_NNN.md`", because аудит має бути обробленим чергою (як скан файлів), а не синхронно в wrapper-скрипті — це відповідає загальному принципу «стан = файли» і дає `n-cursor watch` єдину точку відповідальності за dispatch.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor watch` отримує єдину точку управління чергою аудиту та виконання вузлів — без синхронних блокувань у wrapper.
* Good, because NNN у `pending-audit_NNN.md` дорівнює NNN відповідного `outputs_NNN.md` — ім'я файлу саме по собі є посиланням, без потреби у явному полі `ref:`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `tasks/<node>/pending-audit_NNN.md` (numbered, immutable; NNN = NNN з `outputs_NNN.md`)
- Front-matter: `created_at`, `outputs_ref`, `actor`
- Варіант нумерації: B (numbered, не overwrite) — обраний явно в transcript
- При повторному аудиті після доробки: агент пише `outputs_002.md` → `pending-audit_002.md`
- `n-cursor watch` сканує вузли зі станом `pending-audit` і spawns auditor-агента
- Стан `pending-audit`: присутній `pending-audit_NNN.md` без відповідного `run_NNN.md` від auditor
- Ліміт циклів аудиту: 3 поспіль `actor: auditor, result: failed` → `n-cursor watch` репортить проблему людині
- Зафіксовано в `docs/думка.MD` (секції «Аудитор (асинхронна черга)» і «Файловий контракт вузла»)

---

## ADR Переосмислення `flow plan` як Stage 1 (spec + decompose)

## Context and Problem Statement
Існуючий `n-cursor flow` мав окремі команди `flow spec` (brainstorm, панель персон) і `flow plan` (декомпозиція → `.flow.json`). При переході до архітектури думка.MD потрібно було визначити, як ці команди живуть у новій двоетапній моделі виконання вузла.

## Considered Options
* Два кроки: `flow spec` (design) → `flow plan` (decompose) — людина може зупинитись між ними
* Один крок: `flow plan` поєднує spec і decompose разом

## Decision Outcome
Chosen option: "Один крок: `flow plan` поєднує spec і decompose", because підтримувати два окремі кроки надлишково — design і decomposition природно об'єднуються в один акт планування.

### Consequences
* Good, because transcript фіксує очікувану користь: спрощений протокол агента — один виклик замість двох.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `flow spec` — видалено, поглинуто в `flow plan`
- `flow plan` → вихід: `plan_001.md` (atomic path) або дочірні `task.md` (composite path)
- `plan_001.md` формат: YAML front-matter (`stage`, `created_at`, `path: atomic|composite`) + секції `## Аналіз`, `## Plan`, `## Sub-tasks`
- Режим визначається атрибутом `mode` у `task.md`: `human` (default, інтерактивний діалог) або `agent` (автономно)
- `mode: human` після Stage 1 → стан `plan-pending` (агент виходить, чекає людину)
- `mode: agent` → одразу Stage 2
- `flow plan` **не** викликає `graph spawn` автоматично — агент робить це явно (Варіант B)
- Зафіксовано в `docs/думка.MD` (секція «Інтеграція з `n-cursor flow`»)

---

## ADR Видалення Фасаду B (`flow run/resume/cancel/repair`) та інших застарілих команд

## Context and Problem Statement
Існуючий `n-cursor flow` мав Фасад B — повний автономний 5-фазний цикл (`flow run`, `flow resume`, `flow cancel`, `flow repair`) і ряд інших команд (`flow init`, `flow release`, `flow review`, `flow gate`). При переході до архітектури думка.MD потрібно було визначити долю кожної команди.

## Considered Options
* Зберегти Фасад B поряд з новою системою
* Видалити Фасад B повністю, замінивши на `graph`-команди

## Decision Outcome
Chosen option: "Видалити Фасад B повністю", because стан тепер зберігається у файлах (не в `.flow.json`), тому resume і repair стають зайвими; `graph run` і `graph kill` замінюють `flow run` і `flow cancel`; весь Фасад B стає дублюванням.

### Consequences
* Good, because transcript фіксує очікувану користь: усувається дублювання між Фасадом B і `graph`-командами; `.flow.json` і `docs/specs/`, `docs/plans/` зникають.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Повна таблиця видалених команд:

| Команда | Замінник |
|---|---|
| `flow init` | worktree створює `graph run` |
| `flow spec` | поглинуто в `flow plan` |
| `flow run` | `graph run` |
| `flow cancel` | `graph kill` |
| `flow resume` | не потрібно (state у файлах) |
| `flow repair` | не потрібно (state у файлах) |
| `flow review` | аудит-черга через `pending-audit_NNN.md` |
| `flow gate` | `flow verify` |
| `flow release` | `graph done` / `graph audit` / `graph failed` |

- Видалено також: `.flow.json`, `docs/specs/`, `docs/plans/`
- Зафіксовано в `docs/думка.MD` (секція «Команди `flow` (нова таблиця)»)

---

## ADR Контракт `flow verify`: вхідні дані — `outputs_NNN.md` + git diff

## Context and Problem Statement
Стара `flow verify` перевіряла кроки зі стану `.flow.json`. При переході до нової архітектури `.flow.json` зникає, і потрібно було визначити що саме перевіряє `flow verify` і які дані вона отримує на вхід.

## Considered Options
* Тільки `outputs_NNN.md` — агент описує результат у файлі, verify перевіряє лише опис
* Тільки git diff worktree — перевіряє реальні зміни в коді
* `outputs_NNN.md` + git diff worktree — комбінація обох

## Decision Outcome
Chosen option: "`outputs_NNN.md` + git diff worktree (Option C)", because комбінація дає і самоопис агента (що він зробив), і реальні зміни в коді — повніший контекст для перевірки.

### Consequences
* Good, because transcript фіксує очікувану користь: verify має як опис агента, так і факт змін — точніша перевірка `## Done when`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `flow verify` читає: `task.md ## Done when` + `outputs_NNN.md` + `git diff` worktree + `plan_001.md`
- Реалізація: окремий LLM-процес з інструментами `run_command(cmd)` і `flow_audit(criterion, files)`
- Записує: `verify_001.md` (numbered)
- Exit code: `0=PASS`, `1=FAIL`
- Після verify: виконавець-агент читає результат → `graph done | graph audit | graph failed`
- Зафіксовано в `docs/думка.MD` (секція `flow verify — повний контракт`)
