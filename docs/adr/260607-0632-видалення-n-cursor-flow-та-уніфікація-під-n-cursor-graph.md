---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:32:06+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Зафіксовано. думка.MD і memory оновлені з усіма рішеннями.

**Підсумок 5 gap-ів:**

| Gap | Рішення |
|---|---|
| Composite resolved | Roll-up run батька (per `mode`); `children-resolved` = derived |
| pending-audit lifecycle | Derived: оброблено якщо є auditor run з `created_at >` pending-audit |
| mode: human headless | `n-cursor watch` пропускає; людина запускає вручну з IDE |
| Merge після аудиту | `n-cursor watch` є wrapper — читає `.ncursor-signal`, merge on success |
| Race condition | Єдиний оркестратор `n-cursor watch`; `graph run --auto` видалено |

Архітектура логічно закрита. Рухаємось до реалізації?

---

*Transcript ends here.*

---

## ADR Видалення `n-cursor flow` та уніфікація під `n-cursor graph`

## Context and Problem Statement
В існуючій кодовій базі `n-cursor flow` виконував роль «Пасивного Турнікету» (init/spec/plan/verify/release) і «Активного Раннера» (run/resume/cancel/repair) навколо `.flow.json`. Паралельно розвивалась архітектура автономного DAG-оркестратора (`docs/думка.MD`), заснована на файловій системі (`tasks/<node>/task.md`). Два протоколи дублювали відповідальності і мали несумісні контракти стану.

## Considered Options
* Зберегти `flow` як протокол всередині вузла, `graph` — як зовнішній оркестратор (два шари)
* Видалити `flow` повністю, всі команди перевести під `graph` (уніфікація)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити `flow` повністю, всі команди перевести під `graph`", because `flow` як namespace виявився надлишковим — `flow plan` стає `graph plan`, а всі інші `flow`-команди або видаляються, або поглинаються еквівалентами у `graph`.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка входу `n-cursor graph`, відсутність дублювання стану між `.flow.json` і `task.md`-файлами, спрощений mental model для агентів і розробників.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені команди: `flow init`, `flow spec`, `flow plan`, `flow verify`, `flow gate`, `flow review`, `flow run`, `flow resume`, `flow cancel`, `flow repair`, `flow release`. Файл-диспетчер: `npm/scripts/dispatcher/index.mjs`. Правило: `.cursor/rules/n-flow.mdc`. Нова точка входу: `npm/scripts/graph/index.mjs` (ще не реалізовано — сесія завершена до впровадження після gap-аналізу).

---

## ADR `graph plan` — Stage 1: об'єднання spec і decompose

## Context and Problem Statement
Старий `flow` мав окремі команди `flow spec` (brainstorm, панель персон) і `flow plan` (декомпозиція на кроки). Це змушувало агента і людину виконувати два послідовних кроки з різними артефактами (`docs/specs/*.md` і `.flow.json`). У новій архітектурі ці артефакти зникають на користь `task.md` / `outputs_NNN.md`.

## Considered Options
* Два окремі кроки: `graph spec` → `graph plan` (зберегти розмежування дизайн/декомпозиція)
* Один крок: `graph plan` (поєднати spec і decompose)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Один крок: `graph plan`", because людина може зупинитись між spec і plan тільки якщо процес це допускає, але спільний крок простіший і достатній — різниця між дизайном і декомпозицією вирішується всередині одного виклику.

### Consequences
* Good, because transcript фіксує очікувану користь: менше команд, один артефакт `plan_001.md` замість двох файлів у різних директоріях.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Артефакт `plan_001.md` — front-matter: `type: atomic|composite`, `created_at`, `mode`. Секції: `## Context`, `## Approach`, `## Risks`. Composite path: агент після `graph plan` явно викликає `graph spawn` (не автоматично). Atomic path: агент переходить до Stage 2 — пише `outputs_NNN.md`, потім `graph done | graph audit | graph failed`.

---

## ADR `pending-audit_NNN.md` — нумерація і lifecycle

## Context and Problem Statement
Потрібен механізм асинхронного аудиту: агент сигналізує що хоче зовнішню перевірку, оркестратор пізніше dispatches аудитора. При повторних спробах (агент доробив і знову просить аудит) файли не повинні перезаписуватись, щоб зберегти immutability. Оркестратор повинен знати чи вже оброблено конкретний запит аудиту.

## Considered Options
* Один файл `.pending-audit` (перезаписується) — Варіант A
* Numbered `pending-audit_NNN.md` де NNN = NNN відповідного `outputs_NNN.md` — Варіант B
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Numbered `pending-audit_NNN.md`, NNN = NNN outputs", because ім'я файлу саме по собі є посиланням на конкретну версію outputs — окремий `ref:` не потрібен. Нумерація не губиться між спробами.

### Consequences
* Good, because transcript фіксує очікувану користь: immutability зберігається, ланцюжок `outputs_003.md → pending-audit_003.md → run_004.md (auditor)` читається з файлів без зовнішнього стану.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Lifecycle: `pending-audit_NNN.md` вважається обробленим (derived) якщо існує `run_M.md` де `actor: auditor` і `created_at > pending-audit_NNN.created_at` (Варіант C з gap-аналізу). Front-matter формат: `created_at: ISO8601`, `actor: agent | human`. Ліміт: до 3 failed-audit-циклів → ескалація.

---

## ADR `n-cursor watch` — єдиний оркестратор

## Context and Problem Statement
В початковому дизайні думка.MD існував `graph run --auto` (one-shot після merge) і `n-cursor watch` (демон). Якщо обидва запускаються одночасно, виникає race condition: два процеси можуть запустити той самий вузол у два worktrees.

## Considered Options
* `graph run --auto` (post-merge) + `n-cursor watch` (демон) паралельно — Варіант A
* Єдиний оркестратор `n-cursor watch`; post-merge hook тільки будить watch — Варіант B
* Idempotent check через `git worktree add` атомарно — Варіант C
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`n-cursor watch` як єдиний оркестратор (Варіант B)", because усуває race condition архітектурно — один процес управляє чергою, `graph run --auto` видалено.

### Consequences
* Good, because transcript фіксує очікувану користь: відсутність race condition, `n-cursor watch` покриває і execution, і audit queue, і стале worktrees.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Post-merge hook: тільки `kill -USR1 <watch-pid>` або подібний сигнал (конкретна реалізація не зафіксована в transcript). `n-cursor watch` dispatches аудиторів через `graph run --actor auditor <path>` — той самий wrapper-механізм що і для execution агентів. Файл конфігу: `.n-cursor.json` (поле `max_worktrees`).

---

## ADR Composite вузол: derived `children-resolved` і roll-up run

## Context and Problem Statement
Composite вузол (розкладений `graph plan` у дочірній граф) ніколи не пише власний `outputs_NNN.md`. Але стан `resolved` визначається наявністю `outputs_NNN.md`. Без додаткового механізму composite вузол залишився б у `waiting` назавжди після того як усі його діти стали `resolved`.

## Considered Options
* Implicit: composite автоматично `resolved` коли всі діти `resolved` (без `outputs_NNN.md`) — Варіант A
* Roll-up run: оркестратор запускає батьківський вузол знову (actor за `mode` батька), агент пише `outputs_NNN.md` — Варіант B
* Останній merge дитини автоматично пише `outputs_NNN.md` батька — Варіант C
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Roll-up run (Варіант B), actor за `mode` батька", because roll-up дає семантичний сенс агрегації — батько може мати власне meaning (не просто сума дітей), і людина (`mode: human`) або агент (`mode: agent`) контролює цей крок.

### Consequences
* Good, because transcript фіксує очікувану користь: батьківський вузол завжди має власний `outputs_NNN.md`, однорідний протокол resolved-стану для всіх типів вузлів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`children-resolved` — derived state (без sentinel-файлу). Composite визначається по `plan_001.md` front-matter `type: composite`. При `children-resolved` `n-cursor watch` ставить батька у чергу як звичайний `waiting` вузол (з урахуванням `mode`). Реалізація в `npm/scripts/graph/scan.mjs` (планується).
