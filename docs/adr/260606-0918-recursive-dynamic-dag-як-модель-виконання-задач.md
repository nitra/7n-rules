---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T09:18:49+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Recursive Dynamic DAG як модель виконання задач

## Context and Problem Statement
Потрібно описати та формалізувати структуру виконання задач, де оркестратор розбиває задачі на динамічний граф, вузли якого самі можуть розбиватися на підграфи, а батьківський рівень бачить лише стан вузла (resolved/failed).

## Considered Options
* Recursive Compound DAG (rDAG) — орієнтований ациклічний граф де вузол або атомарний, або матеріалізує новий rDAG під час виконання
* Hierarchical Task Network (HTN) — статична декомпозиція відома до виконання
* 3D Graph — просторова метафора, не відповідає структурі зв'язків

## Decision Outcome
Chosen option: "Recursive Dynamic DAG (rDAG)", because декомпозиція вузла відбувається динамічно під час виконання (не відома наперед), а батько бачить лише інтерфейс `resolved | failed` незалежно від внутрішньої складності вузла — це відрізняє від HTN де граф статичний.

### Consequences
* Good, because transcript фіксує очікувану користь: атомарну задачу можна "розкрити" в підграф без змін у батьківському графі (substitutability); executor однаковий на всіх рівнях рекурсії.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Структура Node: `{ id, task: string, status: pending|running|resolved|failed, inputs, output, impl: Atomic | Compound(rDAG) }`. Структура Edge: `{ from, to, data: unknown }`. Failure mode: fail-parent cascade. Паралелізм: всі `ready`-вузли виконуються concurrent.

---

## ADR Зовнішній оркестратор матеріалізує граф

## Context and Problem Statement
LLM-агент як executor має обмежене контекстне вікно і не може тримати весь граф у контексті. Потрібно вирішити хто матеріалізує та зберігає структуру rDAG під час виконання.

## Considered Options
* Зовнішній orchestrator записує nodes/edges і передає LLM тільки поточний вузол
* LLM матеріалізує граф неявно (implicit через spawning, граф існує лише як execution trace)

## Decision Outcome
Chosen option: "Зовнішній orchestrator", because він зберігає граф як persistent data structure, що дозволяє зупинити/відновити виконання, інспектувати стан і виконувати retry; LLM залишається stateless процесором одного вузла.

### Consequences
* Good, because transcript фіксує очікувану користь: граф персистентний — можна зупинити/відновити, inspect, retry; LLM ніколи не бачить весь граф — тільки свій вузол + inputs.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
LLM contract: `input: { task, inputs }` → `output: { type: 'resolved', data } | { type: 'decomposed', nodes, edges, entry, exit }`. Orchestrator loop: `ready = nodes where all incoming edges have data` → execute concurrently → на `decomposed` розширює граф, вставляє subgraph на місце вузла.

---

## ADR Непрозорі дані edges, контракт — у task description

## Context and Problem Statement
Edges між вузлами rDAG передають дані від одного виконавця до іншого. Потрібно вирішити як типізувати ці дані: через схему на рівні графа або через описи задач.

## Considered Options
* Опис входів/виходів у task description (implicit schema) — orchestrator зберігає `edge.data: unknown`
* Явна типізація edges на рівні orchestrator (structured schema validation)

## Considered Options
* Непрозорі дані (`data: unknown`), схема implicit у task description
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Непрозорі дані, схема у task description", because orchestrator є data courier а не validator — він не розуміє дані, тільки граф-топологію; LLM знає з опису задачі що очікується на вході та виході.

### Consequences
* Good, because orchestrator спрощується — не потребує розуміння форматів даних; версіонування схем відбувається через зміну task description без зміни структури графа.
* Bad, because помилки стають semantic ("LLM не так зрозумів контракт"), а не структурними — складніше діагностувати на рівні orchestrator.

## More Information
`Edge.data: unknown` — orchestrator зберігає та маршрутизує без інтерпретації. `Node.task: string` — несе implicit input/output contract для LLM executor.

---

## ADR PostgreSQL + Redis як сховище для rDAG orchestrator

## Context and Problem Statement
rDAG orchestrator потребує як persistent зберігання структури графа (nodes, edges, sessions, workspaces), так і real-time координації виконання (черга готових вузлів, pub/sub подій, запобігання дублюванню). У монорепо доступні PostgreSQL та Redis.

## Considered Options
* PostgreSQL для persistent state + Redis для live coordination
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "PostgreSQL + Redis", because PostgreSQL підходить для персистентного зберігання структури графа з можливістю інспекції та відновлення; Redis підходить для роботи з чергою готових вузлів та pub/sub нотифікацій без блокування.

### Consequences
* Good, because transcript фіксує очікувану користь: граф persistent (можна зупинити/відновити), паралельне виконання координується через Redis черги та locks.
* Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information
PostgreSQL schema (draft): `workspaces(id, name, shared_state jsonb)`, `sessions(id, workspace_id, status, created_by)`, `nodes(id, session_id, parent_node_id, task, status, output jsonb)`, `edges(id, from_node_id, to_node_id, data jsonb)`. Redis: `queue:session:{id}` (ready node IDs), pub/sub (node completion events), `lock:node:{id}` (prevent double-execution). Монорепо: `/Users/vitaliytv/www/nitra/cursor`, пакет `@nitra/cursor` v3.25.0.

---

## ADR Workspace/Session топологія з shared state та cross-workspace spawning

## Context and Problem Statement
Потрібно визначити організаційну структуру: як workspace (проект/директорія), сесії та rDAG співвідносяться одне з одним, та хто може створювати нові сесії.

## Considered Options
* Workspace → concurrent sessions (кожна з власним rDAG) + shared state + workspace-level orchestrator; spawning від user або будь-якого агента (включно з іншого workspace)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Workspace з concurrent sessions та cross-workspace spawning", because workspace є scope-вузлом з власним оркестратором і shared state доступним для читання всіма сесіями; агент з будь-якого workspace може spawn нову сесію — це дозволяє крос-воркспейс оркестрацію.

### Consequences
* Good, because transcript фіксує очікувану користь: сесії ізольовані (кожна свій rDAG), але мають доступ до спільного контексту workspace; cross-workspace spawning дає гнучкість агентської оркестрації.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — питання консистентності shared state при concurrent writes не обговорювалося (сесії мають лише read-доступ).

## More Information
Топологія: `Root Directory → Workspace(shared_state, Orchestrator, Session[])`. Session created by: user або agent (з будь-якого workspace). Сесії мають read-only доступ до `workspace.shared_state`.
