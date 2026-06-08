---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T09:04:14+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Memory file оновлено. Але уточни — ти мав на увазі саме це, чи є конкретний текст "Prototype auditor system (wait for agent to request, then run, then merge)" в якомусь файлі якого я не знайшов?

---

Окремо: оскільки в `docs/думка.MD` система аудиту вже повністю задизайнована (не prototype), я можу додати її до **Сильних сторін** у SWOT. Хочеш?

## ADR Аудитор виконує окремий файл audit-result замість run

## Context and Problem Statement
При проєктуванні файлового контракту вузла виникло питання: як оркестратор відрізняє "аудит іще в процесі" від "аудит вже оброблено" якщо `pending-audit_NNN.md` immutable і залишається назавжди?

## Considered Options
* **Variant A (timestamp):** `pending-audit_NNN.md` оброблено, якщо є `run_*.md (actor: auditor)` із `created_at` пізніше за `pending-audit_NNN.md`
* **Variant B (audit_ref поле):** аудитор пише `run_NNN.md` з полем `audit_ref: pending-audit_NNN.md`
* **Variant C (окремий файл):** аудитор пише `audit-result_NNN.md` (NNN = NNN відповідного `pending-audit_NNN.md`)

## Decision Outcome
Chosen option: "Variant C (окремий файл)", because NNN у назві файлу є прямою 1:1 відповідністю — оркестратору достатньо перевірити `audit-result_NNN.md exists`, без порівняння дат або парсингу метаданих.

### Consequences
* Good, because детектування тривіальне: `pending-audit_002.md` consumed = `audit-result_002.md` exists; auditor-трек повністю відокремлений від executor-треку (`run_NNN.md` містить лише `actor: agent|engineer|human`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `audit-result_NNN.md` містить обов'язковий `## Reasoning` при `result: failed` (actionable feedback агенту). Аудитор НЕ пише `run_NNN.md`. Зафіксовано в `docs/думка.MD` та `memory/project_graph_flow_design.md`.

---

## ADR Composite вузол resolved через агрегацію дітей

## Context and Problem Statement
Composite вузол спавнить дітей і більше нічого не виконує — він ніколи не пише `fact_NNN.md`. Але стан `resolved` у атомарному вузлі визначається наявністю `fact_NNN.md`. Виникла суперечність: як composite вузол досягає стану `resolved`?

## Considered Options
* **Variant A (implicit aggregation):** composite resolved = всі діти resolved; `fact_NNN.md` у батька не потрібен — стан деривується знизу вгору
* **Variant B (roll-up агент):** оркестратор перезапускає батьківський вузол після завершення дітей; агент пише `fact_NNN.md` батька з агрегованим результатом
* **Variant C (last-merge trigger):** post-merge hook останньої дитини автоматично пише `fact_NNN.md` батька

## Decision Outcome
Chosen option: "Variant A (implicit aggregation)", because composite вузол за визначенням є контейнером підграфу — його стан є агрегацією дітей, що не потребує додаткового файлу чи додаткового запуску агента.

### Consequences
* Good, because оркестратор деривує стани знизу вверх (спочатку листові, потім composite) — логіка єдина і передбачувана; composite не потребує окремого executor-запуску лише для запису агрегованого файлу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Стан composite: `всі діти resolved → resolved`, `є running/pending-audit → running`, `є failed без running → failed`, `є waiting без failed/running → waiting`. Зафіксовано в `docs/думка.MD` (State tables) та `memory/project_graph_flow_design.md`.

---

## ADR `graph run --auto` та `n-cursor watch` координуються через mkdir-lock

## Context and Problem Statement
Два актори можуть одночасно бачити waiting-вузол і намагатись запустити його: `graph run --auto` (one-shot, тригерується post-merge hook) і `n-cursor watch` (persistent daemon). Це призводило б до створення двох worktree для одного вузла.

## Considered Options
* **Variant A (lock-файл):** перед spawn — створити `tasks/<node>/.lock` з PID; конкурент бачить файл → skip; потрібна логіка stale-lock
* **Variant B (єдиний оркестратор):** тільки `graph run --auto` spawns worktrees; `n-cursor watch` — лише моніторинг
* **Variant C (worktree як lock):** `mkdir .worktrees/<node>-<hash>/` — атомарна FS-операція; другий runner отримує `EEXIST` → skip

## Decision Outcome
Chosen option: "Variant C (worktree як lock)", because worktree-директорія вже є природним індикатором "вузол зайнятий" — окремий lock-файл і його cleanup не потрібні; атомарність гарантована FS.

### Consequences
* Good, because race condition виключено без додаткового механізму; orphan worktree після краші обробляється idempotent — наступний тік бачить `resolved + orphan worktree → merge + cleanup`.
* Bad, because orphan worktree (після краші процесу) блокує вузол до наступного тіку scan; потрібна логіка orphan-detection.

## More Information
Orphan recovery: наступний `graph run --auto` або watch тік, бачить `resolved` + активна директорія worktree → idempotent merge + cleanup. Зафіксовано в `docs/думка.MD` (Оркестрація) та `memory/project_graph_flow_design.md`.

---

## ADR Аудитор запускається через `graph run --actor auditor` як wrapper

## Context and Problem Statement
Після появи `audit-result_NNN.md (result: success)` залишений worktree потрібно злити в `main` і видалити. Питання: хто відповідальний за цей merge — `n-cursor watch`, `graph run --auto` при наступному тіку, чи wrapper самого auditor-запуску?

## Considered Options
* **Variant A (`graph run --actor auditor` є wrapper):** запускає auditor subprocess, чекає, читає `audit-result_NNN.md` → `success` → merge + delete worktree
* **Variant B (`n-cursor watch` мержить):** watch бачить `audit-result_NNN.md (result: success)` → самостійно merge + cleanup
* **Variant C (`graph run --auto` наступний тік):** наступний one-shot pass бачить `resolved + orphan worktree` → merge

## Decision Outcome
Chosen option: "Variant A (`graph run --actor auditor` є wrapper)", because merge і аудит є однією атомарною операцією під контролем одного процесу; watch не повинен виконувати git-операції.

### Consequences
* Good, because чітка відповідальність: аудит + merge — один wrapper-процес; watch залишається чистим моніторингом.
* Bad, because якщо wrapper падає між аудитом і merge — orphan worktree; Neutral, оскільки transcript фіксує очікувану користь: orphan обробляється idempotent через наступний `--auto` тік (бачить `resolved + orphan → merge + cleanup`).

## More Information
`graph run --actor auditor tasks/<path>`: читає `pending-audit_NNN.md`, spawns auditor subprocess у read-only worktree, чекає виходу, читає `audit-result_NNN.md`, при `result: success` → `git merge + delete .worktrees/<node>/`. Зафіксовано в `docs/думка.MD` (Wrapper-скрипт).

---

## ADR `mode: human` вузли пропускаються `--auto` оркестратором

## Context and Problem Statement
`graph run --auto` запускає агентів як headless subprocess без терміналу. Але `task.md` з `mode: human` вимагає живого IDE-діалогу для Stage 1 (`graph plan`). Потрібно було вирішити як автоматичний оркестратор обробляє такі вузли.

## Considered Options
* **Variant A (skip):** `--auto` повністю пропускає `mode: human` вузли без `plan_001.md`; людина запускає `graph plan <path>` вручну; watch надсилає Telegram якщо вузол завис
* **Variant B (notify+wait):** `--auto` надсилає Telegram і продовжує з незалежними вузлами; при появі `plan_001.md` підхоплює на наступному тіку
* **Variant C (mode зникає):** `mode` задається не в `task.md`, а через те хто першим викличе `graph plan`

## Decision Outcome
Chosen option: "Variant A (skip)", because чітке розділення відповідальності: `--auto` ніколи не блокується і не чекає; людина має явний контроль через `graph plan`.

### Consequences
* Good, because `graph run --auto` детерміністично — ніколи не зависає очікуючи людину; `graph status` показує `human-pending` як явний стан для observability.
* Bad, because якщо людина забуде запустити `graph plan` — граф стоїть мовчки (частково вирішено Telegram-нагадуванням через watch, позначено TODO).

## More Information
Стан `human-pending`: `mode: human` + відсутній `plan_001.md`. При появі `plan_001.md` → перехід у `waiting`. CLI: `graph plan tasks/<path>/` запускає IDE-діалог вручну; `graph plan tasks/<path>/ --mode agent` — CLI override для автономного планування. Зафіксовано в `docs/думка.MD`.
