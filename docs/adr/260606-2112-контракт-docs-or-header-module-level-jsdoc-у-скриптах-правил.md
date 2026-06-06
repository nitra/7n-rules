---
session: 166067f9-58c4-48c2-afaa-547b28eb33db
captured: 2026-06-06T21:12:48+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/166067f9-58c4-48c2-afaa-547b28eb33db.jsonl
---

8/8 зелені. Все готово:

- 59 файлів мають pointer-headers (`/** @see ./docs/<stem>.md */`)
- Нові файли без docs зберігають прозу як раніше
- `header_doc_pointer` check тримає цей інваріант назавжди

---

TRANSCRIPT END

## ADR Контракт «docs-or-header»: module-level JSDoc у скриптах правил і скілів

## Context and Problem Statement

У проєкті існували два джерела істини для одного контракту: module-level JSDoc у `.mjs`-скриптах (`npm/rules/*/js/*.mjs`, `npm/skills/*/js/*.mjs`) і відповідні `docs/<stem>.md`-файли поруч із ними. Дублювання наративу між цими двома місцями порушувало принцип «один home для канону», закріплений у `scripts.mdc`, і ускладнювало підтримку актуальності документації.

## Considered Options

* Умовний pointer: якщо `docs/<stem>.md` існує → module JSDoc замінюється на однорядковий pointer; якщо docs немає → JSDoc залишається як єдине джерело істини.
* Фіксований pointer для всіх файлів незалежно від наявності docs (відкинутий неявно — може призвести до втрати контракту якщо docs ще не написано).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Умовний pointer", because якщо `docs/<stem>.md` існує поряд із `.mjs`-файлом, module-level JSDoc (перший блок до першого `import`/`export`) має бути ≤1 рядок (pointer-формат, наприклад `/** @see ./docs/<stem>.md */`); якщо docs немає — прозовий JSDoc лишається і є єдиним джерелом істини.

### Consequences

* Good, because transcript фіксує очікувану користь: усунуто дублювання між JSDoc і docs для 59 наявних файлів, інваріант тепер механічно перевіряється `header_doc_pointer` concern — дрейф неможливий.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Новий concern: `npm/rules/npm-module/js/header_doc_pointer.mjs`
- Тести: `npm/rules/npm-module/js/tests/header_doc_pointer.test.mjs` (8/8 зелені)
- Docs для концерну: `npm/rules/npm-module/js/docs/header_doc_pointer.md`
- Секція «Контракт: module-level JSDoc vs docs/» додана до `.cursor/rules/scripts.mdc`
- Batch-cleanup: inline `node --input-type=module` скрипт замінив headers у 59 файлах; фінальний `check()` повернув `exit: 0`
- Безпечна послідовність: Capture (docgen переносить контракт у docs) → Verify (docs ⊇ header) → Strip (замінити на pointer); нові файли без docs зберігають прозу без обмежень
