---
session: d0294f80-5a1c-42f7-98bb-df26b88de1e5
captured: 2026-06-06T11:36:20+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d0294f80-5a1c-42f7-98bb-df26b88de1e5.jsonl
---

## ADR Архітектура Dynamic Self-Modifying Recursive Compound DAG

## Context and Problem Statement
Потрібно описати та зафіксувати архітектуру системи оркестрації задач, де директорії містять проекти, проекти містять динамічні графи задач, а вузли графа можуть рекурсивно розкладатись у підграфи під час виконання.

## Considered Options
* Recursive Compound DAG з динамічним розкладом вузлів і data-flow edges
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Recursive Compound DAG з file-based state store, мета-рівневим engineer-агентом і time-boxed escalation", because в ході сесії послідовно уточнювались усі аспекти структури і кожне рішення підтверджувалось явно.

Ключові рішення, зафіксовані в transcript:

- **Тип графа:** орієнтований, ациклічний (DAG); без циклів.
- **Тип вузла:** або `Atomic` (виконує `fn(inputs) → outputs`), або `Compound` (містить власний підграф); рішення приймається динамічно під час виконання.
- **Data-flow edges:** outputs одного вузла є inputs наступного; вузол не запускається поки попередник не `resolved`.
- **Кілька exit-вузлів:** `CompoundNode` може мати декілька exit-вузлів у підграфі; їх outputs merge-яться в outputs батька.
- **Storage:** кожен вузол сам пише власні файли (`meta.json`, `inputs.json`, `outputs.json`, `error.json`, `repair_history.json`, `graph/`); файлова система є state store.
- **Self-repair:** `EngineerAgent` є мета-рівнем поза графом; може змінювати будь-який рівень ієрархії (вузол, батьківський граф, аж до root); модифікація `mutable with invalidation` — змінений вузол інвалідує всіх successors.
- **Memory вузла:** `repair_history.json` на кожному вузлі; engineer stateless, знання зберігаються у файлах вузла.
- **Convergence guard:** time budget (не кількість спроб); engineer має фіксований час (наприклад, 10 хвилин) з необмеженою кількістю спроб у межах бюджету; стратегія може адаптуватись до залишку часу.
- **Escalation:** при timeout вузол стає `unresolvable`; батько отримує власний свіжий time budget (не залишок); ланцюг піднімається до root; root timeout → `notify SeniorEngineer` з повним `senior_report.json`.

### Consequences
* Good, because transcript фіксує очікувану користь: абстракція через інтерфейс (батько бачить лише `state=resolved`, не знаючи реалізації) дає `substitutability` — атомарний вузол можна замінити compound без змін батьківського графа.
* Good, because transcript фіксує очікувану користь: file-based storage робить граф відновлюваним scan-ом файлів і природньо підтримує `MutationLog` через перезапис `meta.json` та `patches/`.
* Good, because transcript фіксує очікувану користь: time budget замість attempt limit усуває штучне обмеження кількості спроб, зберігаючи передбачуваний максимальний час до ескалації (`depth × budget`).
* Bad, because `mutable with invalidation` без меж доступу engineer-агента означає потенційний cascade invalidation по всьому дереву, що може скасувати велику кількість вже `resolved` вузлів.

## More Information
- Файл з зафіксованим дизайном: `думка.MD` (у робочій директорії `/Users/vitaliytv/www/nitra/cursor/`)
- Файлова структура вузла: `<nodeId>/meta.json`, `inputs.json`, `outputs.json`, `error.json`, `repair_history.json`, `graph/<childId>/...`
- Файл ескалації: `senior_report.json` з полями `failed_node`, `escalation_chain`, `current_graph_snapshot`, `suggested_next_steps`
- Близькі реалізації, згадані в transcript: Dask, Prefect dynamic tasks, LangGraph
