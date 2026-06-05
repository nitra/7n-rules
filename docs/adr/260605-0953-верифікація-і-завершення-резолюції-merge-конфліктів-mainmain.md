---
session: 6fecd61e-de50-49c2-9f32-3ad090928942
captured: 2026-06-05T09:53:33+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6fecd61e-de50-49c2-9f32-3ad090928942.jsonl
---

## ADR Верифікація і завершення резолюції merge-конфліктів main↔main-fix

## Context and Problem Statement
Після merge `origin/flow-level-complexity-guard` та `main-fix` у робочому дереві лишилися 8 `.orig`-файлів із конфліктними маркерами і 4 файли з незакоміченими reflow-правками. Потрібно було визначити, чи правильно зрезолвлено кожен конфлікт, і вирішити, що саме комітити.

## Considered Options
* Перевірити кожен конфліктний файл окремо (агент на кожен `.orig`) і лише тоді комітити
* Прийняти поточний стан без перевірки і просто видалити `.orig`

## Decision Outcome
Chosen option: "Перевірити кожен конфліктний файл окремо", because резолюція зачіпала семантичні зміни (нові тести, lint-правила, рефакторинг), а `.orig` містили маркери конфліктів — ризик прийняти неправильну сторону без перевірки був реальним.

### Consequences
* Good, because transcript підтверджує: у всіх 8 файлах поточна резолюція взяла правильну сторону (`main`/ours) — семантику; `.orig` можна видалити без втрат.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Конфлікти між `<<<<<<< поточна (main)` (ours) і `>>>>>>> джерело (main-fix)` (theirs): у всіх випадках `main` ніс семантичні зміни (рефакторинги, нові тести, lint-сумісний `.replaceAll`), `main-fix` — переважно форматування.
- Критичні приклади: `commands.mjs` — theirs переобчислював `const statePath` повторно, що було б синтаксичною помилкою; `worktree.mjs` — theirs використовував `.replace(/…/g)`, що порушує `unicorn/prefer-string-replace-all`; `capability.test.mjs` — theirs тестував `resolveFlow`, яка більше не експортується.
- Перед комітом виправлено дрібний огріх: `withTmpDir( dir` → `withTmpDir(dir` у `npm/scripts/lib/tests/changed-files.test.mjs`.
- Закомічено лише 4 файли з незакоміченими reflow-правками (`commands.mjs`, `commands.test.mjs`, `trace.test.mjs`, `changed-files.test.mjs`); решта модифікованих файлів робочого дерева (CLAUDE.md, COVERAGE.md, docs тощо) до merge-резолюції не належали й залишені поза комітом.
- Команда: `bun test npm/scripts/dispatcher/lib/tests/commands.test.mjs npm/scripts/dispatcher/tests/trace.test.mjs npm/scripts/lib/tests/changed-files.test.mjs` — результат 50/50 до коміту.
- Видалено: `.n-cursor.json.orig`, `worktree-notice.mjs.orig`, `worktree.mjs.orig`, `changed-files.test.mjs.orig`, `trace.test.mjs.orig`, `commands.mjs.orig`, `commands.test.mjs.orig`, `capability.test.mjs.orig`.
- Коміт: `36717f88 style(dispatcher): завершити merge main/main-fix — reflow форматування`.
