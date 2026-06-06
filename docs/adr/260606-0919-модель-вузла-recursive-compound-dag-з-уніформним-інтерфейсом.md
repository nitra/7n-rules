---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T09:19:06+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Модель вузла: Recursive Compound DAG з уніформним інтерфейсом

## Context and Problem Statement
Потрібно описати структуру системи де оркестратор розбиває задачі на динамічні workflow-графи, при цьому вузли самого графа можуть рекурсивно містити власні підграфи. Виникло питання як правильно назвати і формалізувати цю структуру.

## Considered Options
* 3D graph
* Recursive Compound DAG (Graph of Graphs)
* Multi-level Graph
* Hierarchical Task Network (HTN)

## Decision Outcome
Chosen option: "Recursive Compound DAG", because transcript підтверджує: граф орієнтований, без циклів, вузол або є атомарною задачею (leaf), або містить повноцінний підграф — і батьківський рівень бачить лише `state: resolved | failed`, не знаючи про внутрішню реалізацію.

### Consequences
* Good, because transcript фіксує очікувану користь: атомарну задачу можна "розкрити" в підграф без змін у батьківському графі (substitutability).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Структура вузла:
```
Node
├── inputs:  Map<portId, Value>
├── outputs: Map<portId, Value>
├── state: pending | running | resolved | failed | repairing
└── impl: Atomic | Compound{Graph{entry, exits[]}}
```
`Compound` — entry отримує inputs батька, `exits[]` (множина) → merge → outputs батька.

---

## ADR Динамічне розбиття вузла під час виконання

## Context and Problem Statement
Необхідно вирішити, коли визначається, чи вузол є атомарним або compound: статично (структура відома наперед) чи динамічно під час виконання.

## Considered Options
* Статичне визначення типу вузла (compile-time / design-time)
* Динамічне визначення під час виконання

## Decision Outcome
Chosen option: "Динамічне визначення під час виконання", because так вирішив користувач у transcript — вузол інспектує власні `inputs` при старті і сам вирішує розкластись у підграф або виконатись атомарно.

### Consequences
* Good, because transcript фіксує очікувану користь: граф адаптується до реальних даних; батьківський рівень залишається незмінним.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
```
при запуску вузла:
inspect(inputs) →
├── "простий випадок" → Atomic, виконую fn()
└── "складний"       → Compound, будую підграф,
делегую, чекаю exit-вузлів
```
Близькі реалізації зі transcript: Dask, Prefect dynamic tasks, LangGraph.

---

## ADR Self-describing зберігання: кожен вузол пише власний файл

## Context and Problem Statement
Потрібно визначити хто і де зберігає граф із усіма його атрибутами: централізований оркестратор чи самі вузли.

## Considered Options
* Централізоване зберігання (оркестратор тримає весь граф)
* Distributed self-describing (кожен вузол / task пише власний файл)

## Decision Outcome
Chosen option: "Distributed self-describing", because так вирішив користувач у transcript: "граф з усіма його атрибутами пишеться у файли, кожен таск/вузло пише свій сам".

### Consequences
* Good, because transcript фіксує очікувану користь: трасування вузла локальне; структура на диску відображає рекурсивну вкладеність графа.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файлова структура зі transcript:
```
/project/
graph.json
nodes/
node-a/
node.json        ← inputs, outputs, state, edges
nodes/           ← якщо Compound
...
node-b/
node.json
```

---

## ADR LLM-engineer як conditional executor у моделі тригерів

## Context and Problem Statement
Необхідно визначити механізм обробки помилок вузла: як інтегрувати LLM-engineer для діагностики та виправлення в уніформну модель вузлів, не роблячи його спеціальним випадком.

## Considered Options
* LLM-engineer як окремий зовнішній обробник помилок (поза графом)
* LLM-engineer як conditional executor в моделі тригерів вузла

## Decision Outcome
Chosen option: "LLM-engineer як conditional executor в моделі тригерів вузла", because transcript фіксує: "це буде executor що за певних умов виникає для ремонту але і сам результат може мати певний граф" — тобто LLM-engineer залишається уніформним вузлом, який може повернути Atomic result або Compound підграф.

### Consequences
* Good, because transcript фіксує очікувану користь: модель залишається уніформною — "ремонт" є вузлом зі своїм станом і файлом; граф стає self-healing.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
```
Node.triggers = [
{ condition: on_start,   executor: primary-task },
{ condition: on_failure, executor: llm-engineer }
]

Executor
├── type: task | llm-agent | orchestrator | ...
└── impl: (inputs) → outputs | Graph
```
LLM-engineer може повернути: patch → retry primary, або граф з кроків (diagnose → fix → verify).
