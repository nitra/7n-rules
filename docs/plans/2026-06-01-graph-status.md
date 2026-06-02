---
kind: nitra-plan
status: draft
spec: ../specs/2026-06-01-node-dag-state.md
flow: ../../.claude/worktrees/strange-kirch-a95b58.flow.json
implemented:
  state: false
  commits: []
  change: null
  verifiedAt: null
---

# graph status — план реалізації

> Перший зріз node-dag-state: read-only скан + derive + таблиця. Без claim/tick.
> TDD, ін'єкції FS (як trace.mjs). Канон — `npm/scripts/dispatcher/`.

**Goal:** `n-cursor graph status [<graph>]` — зі сканування `docs/graphs/<g>/nodes/`
вивести позицію DAG (done/in_progress/awaiting-human/ready/blocked/failed).

## Кроки

1. graph.mjs: classifyArtifact(name)→{stem,kind,qid} (plan/claim/fact/ask/ans) — acceptance: B01-schema.plan.md→{stem:B01-schema,kind:plan}; X.ask-q1.md→{kind:ask,qid:q1}; чуже→null
2. graph.mjs: scanGraph(root,graph,deps) групує файли по stem у вузли {id,slug,dependsOn,owner,hasClaim,hasFact,factStatus,asks[],answered[]} — acceptance: тест із fixture-файлами повертає вузли з полями
3. graph.mjs: deriveStatus(node,doneSet)→done|failed|awaiting-human|in_progress|ready|blocked — acceptance: fact done→done; claim+open ask→awaiting-human; claim→in_progress; deps done→ready; інакше blocked
4. graph.mjs: deriveGraph(nodes) рахує doneSet (fact done) і мапить статуси — acceptance: ланцюг B01 done→B02 ready; B02 без B01-done→blocked
5. graph.mjs: renderGraph(nodes)→текст таблиці (id·slug [status] owner) — acceptance: містить рядки вузлів і статуси
6. graph.mjs: runGraphCli(args,deps) — status[+graph], нема graphs→повідомлення — acceptance: status повертає 0 і друкує; невідома підкоманда→usage+1
7. bin: case 'graph' → runGraphCli — acceptance: маршрутизація (юніт на runGraphCli достатній)
8. тести graph.test.mjs зелені + eslint моїх файлів чистий — acceptance: vitest pass, eslint clean
