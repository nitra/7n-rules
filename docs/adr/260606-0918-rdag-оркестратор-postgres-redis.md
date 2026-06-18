# rDAG-оркестратор: зовнішній граф, PostgreSQL/Redis, топологія workspace

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

LLM-агент як executor має обмежене контекстне вікно і не може тримати весь граф задач у контексті. Для оркестратора на базі Recursive Dynamic DAG (rDAG) потрібно: персистентне сховище структури графа з можливістю інспекції та відновлення, механізм live-координації виконання вузлів і чітке розмежування між workspace, сесіями та вузлами.

## Considered Options

- PostgreSQL для persistent state + Redis для live coordination (зовнішній orchestrator)
- LLM матеріалізує граф неявно (implicit через spawning — граф існує лише як execution trace)
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "PostgreSQL + Redis із зовнішнім orchestrator", because PostgreSQL підходить для персистентного зберігання структури графа; Redis — для черги готових вузлів, pub/sub нотифікацій та lock-запобігання дублюванню; зовнішній orchestrator зберігає граф як persistent data structure, залишаючи LLM stateless-процесором одного вузла — LLM ніколи не бачить весь граф, тільки свій вузол + inputs.

### Consequences

- Good, because граф persistent — можна зупинити/відновити, inspect, retry; паралельне виконання координується через Redis без блокування.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because консистентність shared_state при concurrent writes сесій у transcript не обговорювалась — сесії мають лише read-доступ до `workspace.shared_state`.

## More Information

**PostgreSQL schema (draft):**
- `workspaces(id, name, shared_state jsonb)`
- `sessions(id, workspace_id, status, created_by)`
- `nodes(id, session_id, parent_node_id, task, status, output jsonb)`
- `edges(id, from_node_id, to_node_id, data jsonb)`

**Redis:**
- `queue:session:{id}` — ready node IDs
- pub/sub — node completion events
- `lock:node:{id}` — запобігання double-execution

**Node contract:** `{ id, task: string, status: pending|running|resolved|failed, inputs, output, impl: Atomic | Compound(rDAG) }`

**Edge data:** `unknown` — orchestrator є data courier, не validator; схема implicit у task description. Помилки стають semantic (LLM не так зрозумів контракт), а не структурними — складніше діагностувати на рівні orchestrator.

**LLM contract:** `input: { task, inputs }` → `output: { type: 'resolved', data } | { type: 'decomposed', nodes, edges, entry, exit }`. На `decomposed` orchestrator розширює граф, вставляє subgraph на місце вузла.

**Orchestrator loop:** `ready = nodes where all incoming edges have data` → execute concurrently → на `decomposed` розширює граф.

**Workspace/Session топологія:** Workspace → concurrent sessions (кожна з власним rDAG) + `shared_state` (read-only для сесій); агент з будь-якого workspace може spawn нову сесію (cross-workspace orchestration). Session created by: user або agent.

Пов'язані ADR: `рекурсивний-складений-ОАГ-динамічний-розклад.md`, `260606-1200-append-only-файлова-система-для-стану-графу.md`, `260607-2218-n-cursor-graph-дизайн-вади-та-рішення.md`.
