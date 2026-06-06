---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T11:30:18+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

[thinking]
Looking at this conversation, the user is designing a complex workflow system with the following key design decisions:

1. **Recursive Compound DAG** - nodes are either atomic or compound (containing their own sub-DAG), with the parent only seeing resolved/unresolved state
2. **Dynamic dataflow** - edges carry data between nodes, decomposition happens at runtime
3. **Multiple exit nodes** in compound nodes
4. **File-based distributed state storage** - each node writes its own files
5. **LLM Engineer as meta-level supervisor** - outside the graph, can modify any level
6. **Mutable graph with invalidation** - engineer can invalidate resolved nodes
7. **Node-local memory for repairs** - `repair_history.json` lives on the node, engineer is stateless

The user is asking me to produce ADR documentation from this transcript. Let me analyze what decisions were made:

1. **Graph structure**: Recursive Compound DAG where nodes are either atomic or compound
2. **Dynamic node decomposition**: nodes decide at runtime whether to be atomic or compound
3. **Multiple exit nodes**: compound nodes can have multiple exits
4. **File-based distributed state storage**: each node writes its own files, no central store
5. **LLM engineer as meta-level supervisor**: outside the graph (not a node), can modify any level including root
6. **Mutable graph with full invalidation**: engineer can invalidate resolved nodes, no constraints
7. **Node-local repair memory**: `repair_history.json` lives on the node, engineer is stateless

These are all meaningful design decisions that should be captured as ADRs. Let me write them up in Ukrainian following the MADR format.

I'll produce multiple ADRs for the major decisions:
1. Graph representation as Recursive Compound DAG with dynamic node decomposition
2. File-based distributed state storage
3. LLM engineer as unbounded meta-level supervisor with mutable graph
4. Node-local repair memory

Actually, looking at the transcript more carefully, I should focus on the most substantive decisions. Let me think about which are truly architectural decisions vs refinements:

1. **Recursive Compound DAG** - core structure decision
2. **Dynamic decomposition at runtime** - key behavioral decision
3. **File-based state** - storage architecture decision
4. **LLM engineer as meta-level with unlimited graph modification** - error handling decision
5. **Mutable graph with invalidation** - consistency model decision
6. **Node-local repair memory (stateless engineer)** - memory/learning architecture decision

I'll write ADRs for all significant ones.
</thinking>

## ADR Recursive Compound DAG як базова структура графу задач

## Context and Problem Statement
Потрібно описати та реалізувати структуру, де проекти містять задачі, що розбиваються оркестратором на dynamic workflow, де вузли можуть самі містити підграфи, і при цьому на кореневому рівні також можуть існувати задачі.

## Considered Options
* Recursive Compound DAG (вузол — атомарний або містить підграф)
* 3D-граф
* Multi-level Graph (фіксована кількість рівнів)

## Decision Outcome
Chosen option: "Recursive Compound DAG", because кожен вузол рекурсивно реалізує той самий інтерфейс (`state`, `inputs`, `outputs`) незалежно від того, чи він атомарний, чи містить підграф; батько чекає лише на `state = resolved` і не знає про внутрішню структуру.

### Consequences
* Good, because transcript фіксує очікувану користь: атомарний вузол можна замінити compound-вузлом без змін у батьківському графі (substitutability); executor однаковий на всіх рівнях.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Структура вузла (з transcript):
```
Node
├── state: pending | running | resolved | failed
└── impl:
├── Atomic   — fn(inputs) → outputs
└── Compound — Graph{ entry, nodes[], edges[], exits[] }
```
Граф — DAG (орієнтований, без циклів). Edges несуть дані: `from: NodeId+portId → to: NodeId+portId`.

---

## ADR Динамічна декомпозиція вузла під час виконання

## Context and Problem Statement
Вузли графу розбиваються на підграфи не статично (заздалегідь), а динамічно під час виконання залежно від `inputs`.

## Considered Options
* Динамічна декомпозиція (вузол вирішує при запуску)
* Статична декомпозиція (структура відома наперед)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Динамічна декомпозиція", because структура підграфу визначається при запуску вузла на основі його `inputs`, що дозволяє гнучко адаптувати workflow до конкретних даних.

### Consequences
* Good, because transcript фіксує очікувану користь: вузол самостійно вирішує "простий чи складний випадок" і будує підграф або виконується безпосередньо.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
```
при запуску вузла:
inspect(inputs) →
├── "простий випадок" → Atomic, виконую fn()
└── "складний"       → Compound, будую підграф, чекаю exits
```
Compound-вузол може мати **кілька exit-вузлів**; їх outputs зливаються в `outputs` батьківського вузла.

---

## ADR Файлова система як розподілене сховище стану графу

## Context and Problem Statement
Необхідно зберігати стан графу (вузли, edges, inputs, outputs, помилки) так, щоб кожен вузол міг керувати власним станом без центрального сховища.

## Considered Options
* Файлова система (кожен вузол пише власні файли)
* Централізований оркестратор-сховище
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Файлова система", because кожен таск/вузол пише свій стан сам; граф відновлюється scan-ом директорій — структура implicit у вкладеності.

### Consequences
* Good, because transcript фіксує очікувану користь: файлова структура природньо підтримує `MutationLog` і `patches/`; структура вкладених директорій відображає ієрархію графу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файлова структура вузла:
```
tasks/
<nodeId>/
meta.json        ← тип, state, edges (from/to)
inputs.json
outputs.json     ← з'являється при resolved
error.json       ← з'являється при failed
repair_history.json
graph/           ← якщо Compound
<childId>/
...
```
Патчі інженера: `patches/patch_001.json` — diff до структури; граф є послідовністю снапшотів `DAG_v1 → [EngineerPatch] → DAG_v2`.

---

## ADR LLM-інженер як необмежений мета-рівневий supervisor

## Context and Problem Statement
Потрібен механізм відновлення при помилках вузлів, здатний не лише перезапускати вузол, а й змінювати структуру графу на будь-якому рівні ієрархії.

## Considered Options
* Мета-рівень поза графом з необмеженим доступом (LLM-інженер як supervisor)
* Вузол у графі (рекурсивне самовідновлення)
* Локальний retry без зміни структури
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Мета-рівень поза графом з необмеженим доступом", because інженер бачить повний шлях від кореня до вузла, що впав, і вирішує на якому рівні втрутитись; він не є вузлом графу, тому не підпадає під правила DAG.

### Consequences
* Good, because transcript фіксує очікувану користь: інженер може замінити атомарний вузол на compound, додати проміжні кроки, перемаршрутувати edges або патчити root-логіку — залежно від діагнозу.
* Bad, because без обмежень можливий нескінченний цикл (`node fails → engineer patches → node fails → ...`); transcript фіксує потребу в `convergence guard`.

## More Information
```
EngineerAgent:
analyze(failure + full_path_from_root) →
├── patch node_failed
├── restructure parent workflow
├── redesign grandparent subgraph
└── patch root
```
`GraphPatch` включає: `replace node`, `insert nodes`, `rewire edges`, `modify inputs`. Інженер може інвалідувати вже `resolved` вузли (`outputs.json → { stale: true }`), що тригерить cascade invalidation до листів графу.

---

## ADR Mutable граф з cascade invalidation

## Context and Problem Statement
Після патчу інженером вузлів, що вже виконались (`resolved`), потрібно визначити модель консистентності: залишати старі результати чи інвалідувати їх.

## Considered Options
* Mutable з повною інвалідацією (stale-позначки + повторне виконання)
* Append-only (нові вузли, старі не чіпаємо)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Mutable з повною інвалідацією", because змінений вузол може мати інший контракт outputs; downstream вузли мають отримати оновлені дані.

### Consequences
* Good, because transcript фіксує очікувану користь: граф завжди відображає поточну актуальну логіку, а не нашарування старих і нових патчів.
* Bad, because cascade invalidation може призвести до повторного виконання великих частин графу; transcript фіксує ризик нескінченного циклу без `convergence guard`.

## More Information
Модель часового виміру: `Graph = DAG + MutationLog`. Файлово: `outputs.json` отримує `{ stale: true, reason: "patch_by_engineer" }` при інвалідації. Потрібен `Node.repair_history` як `convergence guard` із порогом `max_attempts`.

---

## ADR Node-local repair memory — інженер stateless

## Context and Problem Statement
LLM-інженер викликається повторно при кожній новій помилці вузла; без пам'яті попередніх спроб він повторюватиме невдалі патчі нескінченно.

## Considered Options
* Memory живе на вузлі (`repair_history.json`), інженер stateless
* Memory живе в інженері (stateful agent)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Memory живе на вузлі, інженер stateless", because знання про діагностику конкретного вузла має зберігатись разом із вузлом у файловій системі; інженер читає `repair_history` при кожному виклику і не повторює вже випробуваних стратегій.

### Consequences
* Good, because transcript фіксує очікувану користь: `repair_history.json` є діагностичним знанням вузла — контекст для майбутніх викликів інженера; якщо інженер змінив батьківський вузол через помилку дочірнього, memory пишеться на батька (де відбулась зміна).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Структура `repair_history.json`:
```json
[
{
"attempt": 1,
"engineer_reasoning": "...",
"patch_applied": {},
"result": "failed",
"failure_reason": "..."
}
]
```
Алгоритм завершення: якщо інженер вичерпав варіанти → `node.state = "unresolvable"` → escalate вгору. Питання про те, хто визначає `unresolvable` (сам інженер чи зовнішній `max_attempts`) — в transcript не вирішено.
