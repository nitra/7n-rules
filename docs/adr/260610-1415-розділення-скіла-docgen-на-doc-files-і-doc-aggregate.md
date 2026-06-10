---
session: 1690e3a1-2584-4296-ba8a-06744b7c2f1a
captured: 2026-06-10T14:15:56+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1690e3a1-2584-4296-ba8a-06744b7c2f1a.jsonl
---

## ADR Розділення скіла docgen на doc-files і doc-aggregate

## Context and Problem Statement
Скіл `n-docgen` (`npm/skills/docgen/`) поєднує два різні режими роботи: генерацію документації для кожного окремого скрипту та агрегацію всієї документації. Ці режими мають різну частоту виклику та різну роль у workflow — перший логічно є обов'язковим супутником кожної задачі (як `lint`), тоді як другий потрібен лише за потреби.

## Considered Options
* Розділити `docgen` на два окремі скіли: `doc-files` (per-file, обов'язковий) і `doc-aggregate` (агрегація, on-demand)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розділити `docgen` на `doc-files` і `doc-aggregate`", because частина, що генерує документацію для кожного файлу окремо, має стати обов'язковим кроком кожної задачі (за аналогією до `lint`), а агрегуюча частина — залишитись on-demand операцією.

### Consequences
* Good, because `doc-files` як обов'язковий крок гарантує актуальну per-file документацію після кожного коміту, що відповідає моделі `lint`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поточний скіл знаходиться в `npm/skills/docgen/` і `cursor/.cursor/skills/n-docgen/SKILL.md`; CLI-точка входу — `npx @nitra/cursor docgen scan` (визначена в `npm/bin/n-cursor.js`). Скіл наразі має `"worktree": true` у `meta.json`. Transcript зафіксував намір написати специфікацію (Spec-first підхід), але сама специфікація ще не написана — сесія завершилась на етапі дослідження кодової бази.
