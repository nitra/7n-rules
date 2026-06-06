---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T11:34:49+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Recursive Compound DAG як структура задачного простору

## Context and Problem Statement
Потрібно описати систему де директорії містять проекти, оркестратор розбиває задачі на dynamic workflow, формуючи граф, де вузли самі можуть бути графами — і задачі можуть існувати на рівні кореневої директорії. Виникло питання чи це "3D граф" і яка правильна назва.

## Considered Options
* 3D-граф
* Recursive Compound DAG (рекурсивний складений орієнтований граф без циклів)

## Decision Outcome
Chosen option: "Recursive Compound DAG", because вузол або є атомарною задачею (`fn(inputs) → outputs`), або містить власний підграф (`Graph{nodes, edges}`), а батьківський рівень бачить лише єдиний інтерфейс — `state: resolved | failed` — незалежно від внутрішньої структури.

### Consequences
* Good, because transcript фіксує очікувану користь: атомарний вузол можна замінити compound-вузлом без змін у батьківському графі (substitutability), а executor однаковий на всіх рівнях рекурсії.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Виконання вузла: якщо `node.isAtomic` → `fn(inputs)`, інакше → `execute(node.graph)`, очікування всіх exit-вузлів. Compound-вузол може мати кілька exit-вузлів; їх outputs merge у `outputs` батька.

---

## ADR Data-flow edges: outputs одного вузла як inputs наступного

## Context and Problem Statement
При визначенні семантики edges у DAG постало питання — чи edges несуть лише залежності (порядок виконання), чи передають дані.

## Considered Options
* Edges як залежності (тільки порядок)
* Edges як data-flow (результат вузла → вхід наступного)

## Decision Outcome
Chosen option: "Edges як data-flow", because кожен вузол має `inputs: Map<portId, Value>` і `outputs: Map<portId, Value>`; значення "тече" ребром лише після того як `from.state = resolved`.

### Consequences
* Good, because transcript фіксує очікувану користь: підграф entry-вузла отримує inputs батька, exit-вузли виробляють outputs батька — контракт замкнений.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Структура: `Edge { from: NodeId + portId, to: NodeId + portId }`. Декомпозиція вузла динамічна (визначається під час виконання на основі `inputs`).

---

## ADR Файлова система як розподілене сховище стану графа

## Context and Problem Statement
Потрібно вирішити де зберігати граф і стан вузлів: централізований оркестратор чи кожен вузол окремо.

## Considered Options
* Централізований оркестратор зберігає граф
* Кожен вузол/задача пише свій файл

## Decision Outcome
Chosen option: "Кожен вузол/задача пише свій файл", because граф з усіма атрибутами пишеться у файли кожним вузлом самостійно, а структура графа implicit у вкладеності директорій.

### Consequences
* Good, because transcript фіксує очікувану користь: граф відновлюється scan-ом файлів, snapshot кожного стану персистентний, `MutationLog` природньо лягає як `patches/patch_001.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Схема директорій:
```
tasks/<nodeId>/
meta.json        (тип, state, edges)
inputs.json
outputs.json     (з'являється при resolved)
error.json       (з'являється при failed)
repair_history.json
graph/           (якщо Compound)
<childId>/...
```
При invalidation: `outputs.json` отримує `{ stale: true, reason: "patch_by_engineer" }`.

---

## ADR LLM-інженер як мета-рівневий supervisor поза графом з повним доступом

## Context and Problem Statement
При помилці вузла потрібен механізм recovery. Постало питання: чи інженер є вузлом у самому графі, чи існує поза ним як supervisor; та чи може він змінювати батьківські графи.

## Considered Options
* Інженер як вузол у графі
* Інженер як мета-рівень поза графом

## Decision Outcome
Chosen option: "Інженер як мета-рівень поза графом", because він має доступ до повного шляху від кореня до вузла що впав і може обрати на якому рівні ієрархії втрутитись — від локального патча до редизайну root-графа. Обмежень на scope змін немає.

### Consequences
* Good, because transcript фіксує очікувану користь: система self-modifying — інженер може `replace node`, `insert nodes`, `rewire edges`, `modify inputs`. Граф зберігає `MutationLog: [snapshot_v1, patch_1, snapshot_v2, ...]`.
* Bad, because transcript фіксує ризик: мутація батьківського вузла тригерить invalidation cascade вниз по successors — вже `resolved` вузли стають `stale`.

## More Information
`GraphPatch` містить: `replace node`, `insert nodes`, `rewire edges`, `modify inputs`. При зміні батька через помилку дочірнього: `child.repair_history` логує `triggered_parent_patch`, `parent.repair_history` — сам патч.

---

## ADR Time budget (не лічильник спроб) як convergence guard для інженера

## Context and Problem Statement
Без обмежень інженер може нескінченно циклити на одному вузлі. Потрібен convergence guard.

## Considered Options
* `max_attempts: N` (обмеження кількості спроб)
* Time budget (фіксований час, необмежена кількість спроб)

## Decision Outcome
Chosen option: "Time budget", because інженер отримує фіксований часовий бюджет (наприклад 10 хвилин) і необмежену кількість спроб у межах цього часу; після `deadline` — `state = "unresolvable"`, escalate вгору.

### Consequences
* Good, because transcript фіксує очікувану користь: при великому залишку часу інженер обирає складну стратегію, при малому — швидкий fix; відсутній штучний ліміт що обриває потенційно вдале рішення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
```
repair_context.json:
deadline: <timestamp>
started_at: <timestamp>
time_budget_sec: 600
attempts: [...]
```
Максимальний час до людини при глибині `D`: `D × budget`.

---

## ADR repair_history.json на вузлі як memory інженера

## Context and Problem Statement
Інженер stateless — він не пам'ятає попередніх спроб між викликами. Потрібен механізм що запобігає повторенню невдалих стратегій.

## Considered Options
* Інженер зберігає стан всередині себе (stateful agent)
* Memory зберігається на вузлі у файлі

## Decision Outcome
Chosen option: "Memory на вузлі у файлі (`repair_history.json`)", because знання про спроби живе разом з вузлом у файловій системі; інженер stateless і при кожному виклику читає history перед тим як обрати стратегію.

### Consequences
* Good, because transcript фіксує очікувану користь: кілька послідовних викликів інженера на один вузол спільно використовують один контекст; history автоматично потрапляє в `senior_report.json` при escalate.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Кожен запис у `repair_history.json`: `{ attempt, engineer_reasoning, patch_applied, result, failure_reason }`. Якщо інженер змінював батьківський вузол — memory пишеться на батька, дочірній логує `{ triggered_parent_patch: patch_id }`.

---

## ADR Ієрархічна escalation зі свіжим budget на кожному рівні; root → SeniorEngineer

## Context and Problem Statement
Після timeout інженера на певному рівні потрібно визначити що отримує батьківський рівень — залишок часу дочірнього чи власний свіжий бюджет; і що відбувається при timeout на root-рівні.

## Considered Options
* Батько успадковує залишок часу від дочірнього
* Батько отримує свіжий time budget; root timeout → notify SeniorEngineer

## Decision Outcome
Chosen option: "Свіжий budget на кожному рівні; root → SeniorEngineer", because кожен рівень ієрархії отримує власний незалежний time budget при escalate; при timeout на root — система надсилає `senior_report.json` старшому інженеру (людина або вищий агент).

### Consequences
* Good, because transcript фіксує очікувану користь: максимальний час до людини передбачуваний (`depth × budget`); `senior_report.json` містить повний `escalation_chain` з усіх рівнів та `suggested_next_steps` сформульованих інженером перед escalate.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`senior_report.json`: `failed_node` (path від root), `escalation_chain: [{level, attempts, time_spent}]`, `current_graph_snapshot`, `suggested_next_steps`.
