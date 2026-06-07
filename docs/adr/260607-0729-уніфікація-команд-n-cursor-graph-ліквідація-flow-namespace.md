---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T07:29:36+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Зараз виводжу ADR-документ відповідно до контексту сесії.

## ADR Уніфікація команд `n-cursor graph` — ліквідація `flow` namespace

## Context and Problem Statement
Існував роздвоєний CLI: `n-cursor flow` реалізував протокол всередині вузла (plan, verify, done, audit, failed, spawn) з `.flow.json`/`.events.jsonl`-станом, а `n-cursor graph` — read-only перегляд DAG у форматі `docs/graphs/<g>/nodes/`. Нова архітектура вимагає єдиного оркестратора з файловим станом у `tasks/<node>/`, де стан деривується з наявності файлів, а не центрального JSON.

## Considered Options
* Залишити `flow` та `graph` як окремі namespace, доповнити новими командами
* Поглинути весь `flow` у `graph`, видалити `flow` namespace повністю
* Перейменувати `flow` → `graph`, зберегти внутрішню структуру

## Decision Outcome
Chosen option: "Поглинути весь `flow` у `graph`, видалити `flow` namespace повністю", because сесія зафіксувала що `flow plan` → `graph plan`, весь Фасад B (`flow run/resume/cancel/repair`) замінений `graph run`/`graph kill`, `flow verify` видалено на користь async-аудиту, а наявність окремого namespace `flow` без унікальних команд є надлишковою.

### Consequences
* Good, because єдина точка входу `n-cursor graph` знижує когнітивне навантаження — агент/людина знає один namespace.
* Good, because файловий стан у `tasks/<node>/` (`run_NNN.md`, `outputs_NNN.md`, `pending-audit_NNN.md`, `audit-result_NNN.md`) є crash-safe без окремого `state-store.mjs`.
* Bad, because `state-store.mjs`, `flow-verify.mjs`, `flow-resolve.mjs`, `executor.mjs`, та стара `dispatcher/graph.mjs` стають obsolete — потребують видалення або рефакторингу разом з тестами.

## More Information
Файли що адаптуються: `npm/scripts/dispatcher/lib/flow-plan.mjs` → `graph plan`; `npm/scripts/dispatcher/lib/flow-signals.mjs` → `graph done/audit/failed/spawn`. Файли що зникають: `state-store.mjs`, `events.mjs`, `flow-verify.mjs`, `flow-resolve.mjs`, `executor.mjs`, `dispatcher/graph.mjs`. Нові модулі: `graph run` (wrapper + worktree spawn), `graph kill`, `graph invalidate`, `graph scan`, `graph setup`, `graph init`, `n-cursor watch` daemon. Маршрутизація: `npm/bin/n-cursor.js` — `case 'flow'` → видалити, `case 'graph'` → замінити на новий `npm/scripts/graph/index.mjs`.

---

## ADR Файловий контракт вузла — `pending-audit_NNN.md` / `audit-result_NNN.md`

## Context and Problem Statement
Система аудиту потребувала механізму для: (1) сигналізації що конкретна версія `outputs_NNN.md` очікує аудиту, (2) фіксації результату аудитора, (3) детектування що `pending-audit_NNN.md` вже оброблено без timestamp-порівняння.

## Considered Options
* `pending-audit_NNN.md` + auditor пише `run_NNN.md` з `actor: auditor` (timestamp-based detection)
* `pending-audit_NNN.md` з полем `ref: outputs_NNN.md` + окремий лічильник для auditor
* `pending-audit_NNN.md` + `audit-result_NNN.md` з однаковим NNN (NNN = NNN відповідного `outputs_NNN.md`)
* Єдиний `.pending-audit` overwrite-файл

## Decision Outcome
Chosen option: "`pending-audit_NNN.md` + `audit-result_NNN.md` з однаковим NNN", because ім'я файлу саме по собі є посиланням (`pending-audit_003.md` → аудит `outputs_003.md`), детектування оброблення тривіальне (`audit-result_003.md` існує = consumed), і аудитор не потрапляє в лічильник `run_NNN.md` — чіткіше розділення між виконавцями та аудиторами.

### Consequences
* Good, because `pending-audit_NNN.md` consumed = `audit-result_NNN.md` exists — O(1) перевірка без timestamp-порівняння.
* Good, because `run_NNN.md` містить лише `actor: agent | engineer | human` — чистий контракт без аудиторів у виконавчій历史ії.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Формат `pending-audit_NNN.md`: front-matter `created_at`, `actor` — поле `ref:` видалено (NNN у назві є посиланням). Формат `audit-result_NNN.md`: front-matter `created_at`, `actor: auditor`, `result: success | failed` + обов'язкова секція `## Reasoning`. Після трьох `result: failed` підряд `n-cursor watch` ескалює через Telegram. Wrapper `graph run --actor auditor` виконує merge після `result: success`.

---

## ADR Composite вузол — implicit resolved через агрегацію дітей

## Context and Problem Statement
Composite вузол розкладається на підграф дочірніх вузлів і не виконує роботу безпосередньо. При цьому стан `resolved` у атомарних вузлів визначається наявністю `outputs_NNN.md`, якого composite вузол ніколи не пише. Потрібно було визначити як composite вузол досягає `resolved`.

## Considered Options
* Implicit aggregation: стан composite = агрегація стану всіх дітей, `outputs_NNN.md` не потрібен
* Roll-up агент: оркестратор запускає батьківський вузол після того як всі діти resolved, агент пише `outputs_NNN.md`
* Post-merge hook агрегує outputs дітей у `outputs_NNN.md` батька автоматично

## Decision Outcome
Chosen option: "Implicit aggregation", because стан composite вузла є природньою агрегацією підграфу — батько не виконує роботу, тому і результат є похідним, а не самостійним артефактом.

### Consequences
* Good, because оркестратор не потребує окремого кроку агрегації — стан деривується при скануванні знизу вверх по ієрархії.
* Good, because composite вузол можна замінити атомарним без змін у батьківському графі (інкапсуляція).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Правило деривації: якщо директорія містить хоча б одну дочірню директорію з `task.md` — вузол composite. Composite resolved = всі діти resolved. Composite running = є хоча б один `running` або `pending-audit`. Composite failed = є хоча б один `failed` без `running`. Composite waiting = є `waiting` без `failed`/`running`. Сканер виконує bottom-up обхід графу: спочатку деривує стани листових вузлів, потім composite вузлів знизу вверх.

---

## ADR Координація runners через atomic mkdir — worktree як lock

## Context and Problem Statement
Два процеси можуть одночасно сканувати граф і намагатись запустити той самий вузол: `graph run --auto` (one-shot з post-merge hook) та `n-cursor watch` (persistent daemon). Без координації виникає race condition — два worktree для одного вузла.

## Considered Options
* Lock-файл (`tasks/<node>/.lock` з PID + timestamp) з перевіркою живості процесу
* Єдиний оркестратор: тільки `n-cursor watch` spawns worktrees, `graph run --auto` — лише monitor
* Atomic mkdir: existence of `.worktrees/<node>-<hash>/` є природним lock; другий runner отримує `EEXIST` → skip

## Decision Outcome
Chosen option: "Atomic mkdir worktree як lock", because `mkdir` — атомарна FS-операція; перший runner виграє, другий отримує `EEXIST` і пропускає без додаткової логіки. Orphan worktree після краші обробляється як idempotent recovery при наступному `graph run --auto`.

### Consequences
* Good, because race condition виключений архітектурно — без lock-файлів, PID-перевірок, і централізованого координатора.
* Good, because orphan recovery тривіальний: `audit-result_NNN.md (result: success)` + orphan worktree → наступний `graph run --auto` бачить resolved + active worktree → merge + cleanup.
* Bad, because якщо worktree залишився після краші без audit-result — блокує вузол до ручного cleanup або `graph kill`.

## More Information
`graph kill <path>` видаляє worktree та каскадно інвалідує наступників у топологічному порядку. `n-cursor watch` надсилає Telegram alert якщо worktree застояв без змін більше `stale_worktree_min` хвилин (конфіг `.n-cursor.json`). `mode: human` вузли без `plan_001.md` пропускаються обома runners; watch надсилає Telegram нагадування якщо людина не запустила `graph plan <path>` вручну понад `stale_human_node_min`.
