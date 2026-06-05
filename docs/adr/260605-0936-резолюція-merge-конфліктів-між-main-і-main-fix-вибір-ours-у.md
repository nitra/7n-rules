---
session: 6fecd61e-de50-49c2-9f32-3ad090928942
captured: 2026-06-05T09:36:06+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6fecd61e-de50-49c2-9f32-3ad090928942.jsonl
---

## ADR Резолюція merge-конфліктів між `main` і `main-fix` — вибір OURS у всіх файлах

## Context and Problem Statement
Merge між гілками `main` (OURS) і `main-fix` (THEIRS) завершено комітом `f4f9a288`. У робочому дереві залишились `.orig`-бекапи з маркерами конфліктів у 8 файлах. Потрібно було верифікувати, чи резолюція кожного конфлікту правильна.

## Considered Options
* Взяти OURS (`main`) в усіх конфліктних блоках
* Взяти THEIRS (`main-fix`) в одному або кількох блоках
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Взяти OURS (`main`) в усіх конфліктних блоках", because паралельний аналіз агентів підтвердив правильність OURS у кожному файлі з незалежних причин: стилістична еквівалентність у `.n-cursor.json`, дотримання правила `unicorn/prefer-string-replace-all` у `worktree.mjs`, коректна видалена `resolveFlow`-describe-блок у `capability.test.mjs`, правильний `statePath`/`state`-scope у `commands.test.mjs`.

### Consequences
* Good, because transcript фіксує очікувану користь: усі верифіковані файли не містять конфліктних маркерів, lint-правила дотримано (зокрема `replaceAll` замість `.replace(/regex/gu)`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли з конфліктами (верифіковані через `.orig`-бекапи):
- `.n-cursor.json` — json-стиль, обидва боки семантично ідентичні
- `npm/scripts/dispatcher/lib/commands.mjs` — взято OURS; поточний файл ще відхиляється від HEAD на +6/-10 (незакомічені зміни)
- `npm/scripts/dispatcher/lib/tests/capability.test.mjs` — обидва боки видалили `resolveFlow`-блок; збігається з HEAD
- `npm/scripts/dispatcher/lib/tests/commands.test.mjs` — взято OURS; поточний файл +24/-4 від HEAD
- `npm/scripts/dispatcher/tests/trace.test.mjs` — взято OURS; поточний файл +9/-2 від HEAD
- `npm/scripts/lib/tests/changed-files.test.mjs` — взято OURS (sync `dir =>` замість `async dir =>`); поточний файл відхиляється від HEAD
- `npm/scripts/lib/worktree-notice.mjs` — взято OURS
- `npm/scripts/lib/worktree.mjs` — взято OURS (`replaceAll` vs `.replace(/regex/gu)`), бо `unicorn/prefer-string-replace-all: "deny"` активний

Команда, що використовувалась для первинного сканування: `grep -n "<<<<<<" <file>.orig`.
Merge-коміт: `f4f9a288 Merge remote-tracking branch 'origin/flow-level-complexity-guard'`.
