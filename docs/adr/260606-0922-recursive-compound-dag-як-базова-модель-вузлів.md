---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T09:22:10+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Recursive Compound DAG як базова модель вузлів

## Context and Problem Statement
Потрібно описати структуру задач оркестратора, де вузли можуть або виконуватися безпосередньо, або динамічно розкриватися в підграфи. Батьківський рівень не повинен знати про внутрішню будову вузла.

## Considered Options
* Recursive Compound DAG: вузол — або `Atomic (fn)`, або `Compound (Graph)`, вирішується динамічно під час виконання
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Recursive Compound DAG", because вузол надає батькові єдиний інтерфейс (`state`, `inputs`, `outputs`) незалежно від внутрішньої реалізації; атомарний вузол можна "розкрити" в підграф без змін у батьківському графі.

### Consequences
* Good, because transcript фіксує очікувану користь: substitutability (атомарний ↔ compound без змін батька), однаковий `execute(node)` на всіх рівнях.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Граф орієнтований, без циклів (DAG). Edges несуть дані: `from: NodeId + portId → to: NodeId + portId`. Compound-вузол має `exits[]: { portId → Node }` (named ports). Entry-вузол підграфу отримує `inputs` батька через **ref** (не копію). Близькі реалізації: Dask, Prefect dynamic tasks, LangGraph.

---

## ADR Файлова система як розподілене state-сховище

## Context and Problem Statement
Потрібно зберігати стан кожного вузла так, щоб граф можна було відновити після збою, а кожен вузол писав свій стан самостійно без центрального координатора.

## Considered Options
* Файлова система: кожен вузол самостійно пише `meta.json`, `inputs.json`, `outputs/<portId>.json`, `error.json`, `graph/<childId>/`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Файлова система як state store", because граф з усіма атрибутами пишеться у файли кожним вузлом самостійно; структура графа відновлюється scan-ом директорій.

### Consequences
* Good, because transcript фіксує очікувану користь: граф відновлюється без центрального сховища; ієрархія `graph/<childId>/` дзеркалить вкладеність Compound-вузлів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Структура на диску:
```
tasks/<nodeId>/
meta.json          ← type, state, portId (якщо exit)
inputs.json        ← ref/symlink до батька або власні дані
outputs/<portId>.json
error.json
graph/<childId>/   ← лише для Compound
```

---

## ADR Ієрархічний Scheduler з fsevents і дочірніми процесами

## Context and Problem Statement
Потрібен механізм, який запускає наступні вузли після завершення попередніх і при цьому не перетинає scope чужих workflow, що можуть бути вузлами у тому ж файловому дереві.

## Considered Options
* inotify/fsevents-watching з ієрархічними Schedulers (один Scheduler на scope одного Compound-вузла)
* Polling файлів
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "inotify/fsevents з ієрархічними Schedulers", because подієвий підхід (не polling) реагує одразу на запис файлів; батьківський Scheduler spawn-ить ChildScheduler при виявленні Compound-вузла і завершує його після resolved усіх exit-вузлів.

### Consequences
* Good, because transcript фіксує очікувану користь: кожен Scheduler бачить лише свій scope (`tasks/<nodeId>/graph/`), не впливаючи на вузли батьківських workflow.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Lifecycle: ParentScheduler виявляє `type=compound` у `meta.json` → `spawn ChildScheduler(scope)` → ChildScheduler запускає entry-вузли → всі exits resolved → ChildScheduler пише `outputs/<portId>.json` → self-terminate → ParentScheduler (fsevents) підхоплює → Compound-вузол `state = resolved`.

---

## ADR EngineerAgent з повними правами мутації графа для відновлення після помилок

## Context and Problem Statement
При збої вузла потрібен механізм діагностики та виправлення, який може адаптувати план виконання, а не лише повторювати той самий запит.

## Considered Options
* LLM-агент (EngineerAgent) з правами повної мутації графа: може додавати/видаляти вузли, змінювати edges
* Retry без змін графа
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "EngineerAgent з повними правами мутації графа", because agent отримує контекст `{ error, node, subgraph }` і може переписати план виконання; лише retry без змін недостатній для складних збоїв.

### Consequences
* Good, because transcript фіксує очікувану користь: agent може перебудувати підграф і зробити retry з виправленим планом.
* Bad, because після мутації графа Scheduler зобов'язаний виконати cascade invalidation — без цього вже виконані вузли можуть мати сталі результати.

## More Information
EngineerAgent записує нові `meta.json` файли → Scheduler підхоплює через fsevents → cascade invalidation: `diff(old_graph, new_graph)` → `stale = affected ∪ transitive_dependents(affected)` → для кожного stale resolved: видалити `outputs/*.json`, `state → pending` → re-trigger.
