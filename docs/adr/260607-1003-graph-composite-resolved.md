## ADR Явний fact_NNN.md для composite-вузлів

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Composite вузол не мав власного `fact_NNN.md` — його стан `resolved` визначався рекурсивною агрегацією: якщо всі дочірні вузли resolved, батько resolved. Це означає що для кожного composite вузла `graph scan` рекурсивно обходить усіх нащадків (O(глибина × вузли)), а зовнішній інструмент не може перевірити стан кореня без обходу всього дерева. Також логіка перевірки стану відрізнялась між атомарними і composite вузлами.

## Considered Options

* Залишити implicit resolved + додати `.n-cursor/graph-index.json` як кеш (порушує принцип відсутності центрального файлу стану)
* Варіант B — явний `fact_NNN.md` для composite: оркестратор пише `fact_NNN.md` автоматично коли всі діти resolved
* Варіант C — ліниве просування стану через `.child-done/<id>` sentinel у батьківській директорії

## Decision Outcome

Chosen option: "Варіант B — явний `fact_NNN.md` для composite", because уніфікує перевірку стану для всіх типів вузлів (O(1) `ls` в обох випадках), усуває рекурсивний scan для визначення resolved, зберігає інваріант "стан з listing".

### Consequences

* Good, because `graph scan` стає O(n) замість O(n×depth) — кожен вузол перевіряється ізольовано.
* Good, because атомарні і composite вузли мають однакову семантику resolved: `fact_*.md` є.
* Good, because `fact_NNN.md` composite містить агрегований `## Summary` дітей — корисний контекст для батьківського агента або аудитора.
* Bad, because оркестратор отримує додатковий крок: після merge останнього дочірнього вузла — перевірити чи всі сусіди resolved → якщо так, написати `fact_NNN.md` у батька.

## More Information

`fact_NNN.md` composite (пише оркестратор, не агент):
```markdown
---
created_at: ISO8601
type: composite-summary
children_resolved: [analyze, collect-data, fetch-sources]
---
## Summary
<агрегація summary з fact_*.md кожного дочірнього вузла>
```

Тригер запису: `graph run --auto` або watch після merge worktree перевіряє:
```
якщо всі tasks/<node>/*/fact_*.md існують (ls, без читання)
  і tasks/<node>/fact_*.md не існує
    → пише tasks/<node>/fact_NNN.md (NNN = наступний по порядку)
```

NNN для composite — незалежна нумерація від дочірніх. `001` при першому composite-resolved.

Spec: `docs/думка.MD`, секція "Composite вузол".
