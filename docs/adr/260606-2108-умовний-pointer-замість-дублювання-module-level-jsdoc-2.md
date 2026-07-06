---
type: ADR
title: Умовний pointer замість дублювання module-level JSDoc
description: Якщо поряд зі скриптом є docs/<stem>.md, module-level JSDoc замінюється на однорядковий pointer, а без docs лишається джерелом контракту.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

`.mjs`-скрипти в `npm/rules/*/js/` та `npm/skills/*/js/` мали розлогі module-level JSDoc-заголовки, які дублювали поведінковий контракт із `docs/<stem>.md` поруч із файлом. Це створювало два джерела істини та ризик drift-у. Водночас для файлів без `docs/<stem>.md` такий JSDoc лишався єдиним зафіксованим контрактом.

Потрібно було закріпити інваріант механічно, а не лише прозою в `.mdc`, відповідно до підходу `mdc-check`: перевірювана логіка має жити у check-концерні.

## Considered Options

- Завжди замінювати module-level JSDoc на однорядковий pointer до `docs/<stem>.md` незалежно від наявності документації.
- Умовний pointer: якщо `docs/<stem>.md` існує, module-level JSDoc має бути однорядковим pointer; якщо docs немає, JSDoc-проза залишається.
- Описати правило лише текстом у `.mdc` і покластися на ревʼюера чи LLM.
- Реалізувати детермінований check-концерн, який провалює перевірку при порушенні.

## Decision Outcome

Chosen option: "Умовний pointer із детермінованим check-концерном", because якщо docs для файлу ще немає, JSDoc-проза є єдиним джерелом контракту і її видалення означало б втрату інформації; якщо docs існує, дублювання треба прибрати й механічно заборонити його повернення.

### Consequences

- Good, because контракт не зникає: він або у `docs/<stem>.md`, або у module-level JSDoc.
- Good, because `header_doc_pointer` check механічно не дозволяє повернути розлогий header для файлів із docs.
- Neutral, because transcript фіксує текстову перевірку regex до першого `import`/`export`, а не Oxc AST, оскільки аналізується текстова структура header-а.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Новий концерн: `npm/rules/npm-module/js/header_doc_pointer.mjs`.
- Перевірка сканує `.mjs` у `npm/rules/*/js/` та `npm/skills/*/js/`.
- Якщо поряд є `docs/<stem>.md`, module-level JSDoc має бути не довшим за один змістовний рядок, наприклад `/** @see ./docs/<stem>.md */`.
- Якщо docs немає, прозовий JSDoc залишається без цього обмеження.
- Тести: `npm/rules/npm-module/js/tests/header_doc_pointer.test.mjs` — 8/8 green.
- Документація концерну: `npm/rules/npm-module/js/docs/header_doc_pointer.md`.
- Правило задокументовано у `.cursor/rules/scripts.mdc` у секції `## Контракт: module-level JSDoc vs docs/`.
- Batch-cleanup замінив headers у 59 файлах на pointer-headers.
- Реальні порушення першого запуску включали `npm/rules/abie/js/applies.mjs`, `env_dns.mjs`, `firebase_hosting.mjs` та інші файли.

## Update 2026-06-06

Додатково transcript зафіксував фінальний стан після cleanup: 59 файлів отримали pointer-headers формату `/** @see ./docs/<stem>.md */`, нові файли без docs зберігають прозу як єдине джерело істини, а `header_doc_pointer` check тримає цей інваріант. Безпечна послідовність описана як Capture → Verify → Strip: спочатку docgen переносить контракт у docs, потім перевіряється покриття, після цього header замінюється на pointer.

## Update 2026-06-06

Transcript додатково зафіксував перевірку цілісності після batch-заміни: grep по ключових концептах, зокрема `N_CURSOR_CHANGELOG_AUTOFIX`, `resources.requests.cpu`, `EXPLICIT_K8S_SCHEMAS`, підтвердив присутність змісту у відповідних `docs/*.md`; `check(cwd())` повернув `exit: 0`.
