---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T07:06:45+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Зафіксовано і перевірено. Документація в `docs/думка.MD` і memory file оновлені відповідно до всіх 5 рішень.

---

## ADR Унікація `n-cursor flow` → `n-cursor graph`

## Context and Problem Statement
Архітектура мала два паралельних механізми: `n-cursor flow` (Dual-Mode Dispatcher із `.flow.json`, `flow init/spec/plan/verify/release`) та `n-cursor graph` (динамічний ОАГ із `tasks/<node>/task.md`). Команда вирішила об'єднати їх у єдину систему, усунути `flow` namespace повністю й переосмислити команди під файлову модель стану.

## Considered Options
* Залишити `flow` і `graph` як два окремих namespace з інтеграційним контрактом
* Повне злиття: `flow` зникає, всі команди входять у `graph`

## Decision Outcome
Chosen option: "Повне злиття: `flow` зникає, всі команди входять у `graph`", because `flow` як namespace надлишковий — `flow plan` природньо стає `graph plan`, а всі інші команди або поглинаються `graph`, або зникають повністю.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина команда `n-cursor graph` покриває весь lifecycle від ініціалізації до аудиту без дублювання абстракцій.
* Bad, because `npm/scripts/dispatcher/` потребує повного рефакторингу; `n-cursor flow` видаляється як breaking change.

## More Information
Видалені команди: `flow init`, `flow spec`, `flow release`, `flow review`, `flow gate`, `flow run`, `flow resume`, `flow cancel`, `flow repair`, `flow verify`. Файли що зникають: `.flow.json`, `docs/specs/`, `docs/plans/`. Нові команди: `graph setup`, `graph init`, `graph plan`, `graph status`, `graph scan`, `graph run [--auto] [--actor auditor]`, `graph kill`, `graph invalidate`, `graph done`, `graph audit`, `graph failed`, `graph spawn`. Змінено: `docs/думка.MD`, `/Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/memory/project_graph_flow_design.md`.

---

## ADR Двоетапний протокол виконання вузла: `graph plan` + автономне виконання

## Context and Problem Statement
Потрібно чітко визначити що робить агент всередині worktree: чи одразу пише код, чи спочатку планує декомпозицію. Стара система `flow` не розрізняла ці два кроки.

## Considered Options
* `flow plan` (spec окремо) + `flow verify` (Step 2) — дві окремі команди
* Один крок `graph plan` (spec + decompose разом) + автономне виконання без verify

## Decision Outcome
Chosen option: "Один крок `graph plan` + автономне виконання", because spec і decompose логічно пов'язані: агент одночасно розуміє задачу і вирішує атомарна вона чи ні. `flow verify` зникає — якісний гейт замінено async аудитом.

### Consequences
* Good, because transcript фіксує очікувану користь: менше команд, чіткіше розділення між плануванням і виконанням.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`graph plan` записує `plan_001.md` (numbered, immutable) для атомарного вузла, або дочірні `task.md` файли для composite — агент потім явно викликає `graph spawn`. `task.md` містить атрибут `mode: human` (default, інтерактивний діалог) або `mode: agent` (автономно). `graph run --auto` пропускає `mode: human` вузли; `n-cursor watch` надсилає Telegram-нагадування якщо вузол завис.

---

## ADR Файловий контракт аудиту: `pending-audit_NNN.md` + `audit-result_NNN.md`

## Context and Problem Statement
`flow review` і `flow gate` (синхронний adversarial review) замінено асинхронним аудитом через чергу. Потрібно визначити як фіксувати запит аудиту і відповідь аудитора без центрального стану, та як оркестратор визначає що аудит вже оброблено.

## Considered Options
* Timestamp-порівняння між `pending-audit_NNN.md` і `run_NNN.md (actor: auditor)`
* Окремий файл `audit-result_NNN.md` з тим самим NNN, що і `pending-audit_NNN.md`
* `audit_ref` поле у `run_NNN.md` аудитора

## Decision Outcome
Chosen option: "`audit-result_NNN.md` з matching NNN", because ім'я файлу саме по собі є посиланням — `pending-audit_002.md` + `audit-result_002.md` означає що аудит оброблено; детектування тривіальне без порівняння дат.

### Consequences
* Good, because transcript фіксує очікувану користь: детерміноване визначення стану без timestamp-хаосу; аудитор не пише до `run_NNN.md` — execution і audit треки розділені.
* Bad, because додається новий тип файлу (`audit-result_NNN.md`); оркестратор має знати два паралельних лічильника (NNN runs vs NNN audit-pairs).

## More Information
NNN у `pending-audit_NNN.md` = NNN відповідного `outputs_NNN.md`. NNN у `audit-result_NNN.md` = NNN відповідного `pending-audit_NNN.md`. Актори `run_NNN.md`: тільки `agent | engineer | human`. Аудитор пише виключно `audit-result_NNN.md`. `graph run --actor auditor` — wrapper: запускає auditor subprocess → чекає → читає `audit-result_NNN.md` → `success` → git merge + видаляє worktree.

---

## ADR Composite вузол: implicit resolved через агрегацію дітей

## Context and Problem Statement
Composite вузол спавнить дітей і завершує роботу — він ніколи не пише `outputs_NNN.md`. Але стан `resolved` у файловій моделі визначається через наявність цього файлу. Потрібно визначити як composite вузол досягає `resolved` стану.

## Considered Options
* Implicit: оркестратор деривує стан батька з агрегації станів дітей
* Roll-up агент: при вирішенні всіх дітей запускається агент що пише `outputs_NNN.md` батька
* Останній merge тригерить автоматичний запис `outputs_NNN.md`

## Decision Outcome
Chosen option: "Implicit агрегація", because composite вузол принципово відрізняється від атомарного — його стан є станом підграфу, не окремого виконання.

### Consequences
* Good, because transcript фіксує очікувану користь: composite вузол не потребує додаткового агента чи файлу; оркестратор обходить граф знизу вверх.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Правило агрегації: composite `resolved` = всі прямі діти `resolved`; `running` = є хоча б один `running` або `pending-audit`; `failed` = є `failed`, немає `running`; `waiting` = є `waiting`, немає `failed`/`running`. Sentinel `invalidated` у батьку каскадує вниз незалежно від стану дітей. Composite вузол визначається за наявністю хоча б однієї дочірньої директорії з `task.md`.

---

## ADR Race condition між runners: worktree `mkdir` як атомарний lock

## Context and Problem Statement
Два незалежних runners — `graph run --auto` (one-shot, post-merge hook) і `n-cursor watch` (persistent daemon) — можуть одночасно побачити той самий waiting вузол і спробувати запустити його. Потрібен механізм координації без центрального lock-сервісу.

## Considered Options
* Lock-файл `.lock` із PID і timestamp у директорії вузла
* Єдиний запускальник: тільки `graph run --auto` spawns worktrees; `n-cursor watch` = тільки монітор
* Worktree `mkdir` як атомарна FS-операція — перший runner виграє, другий отримує `EEXIST`

## Decision Outcome
Chosen option: "Worktree `mkdir` як атомарний lock", because FS `mkdir` є атомарною операцією — не потрібен окремий lock-файл; worktree directory вже є природним індикатором `running` стану.

### Consequences
* Good, because transcript фіксує очікувану користь: race condition виключено без додаткових механізмів; orphan worktree після краші обробляється idempotently наступним `--auto` тіком.
* Bad, because orphan worktree може блокувати вузол якщо cleanup не спрацював; потрібна логіка детектування stale worktrees у `n-cursor watch`.

## More Information
Обидва runners (`graph run --auto` і `n-cursor watch`) намагаються `mkdir .worktrees/<node>-<hash>/`; `EEXIST` → skip. Stale worktree (процес впав) — `n-cursor watch` детектує за відсутністю живого PID → cleanup + retry. Orphan merge: `graph run --auto` при наступному тіку бачить `resolved` + активний worktree → merge + cleanup як idempotent відновлення.
