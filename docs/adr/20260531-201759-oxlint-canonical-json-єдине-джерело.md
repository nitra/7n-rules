---
type: ADR
title: "`oxlint-canonical.json` як єдине джерело правил"
---

# `oxlint-canonical.json` як єдине джерело правил

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

У `npm/rules/js-lint` налаштування oxlint зберігалися у трьох файлах: `oxlint-rules.tsv` і `oxlint-canonical-skeleton.json` як джерела генерації та `oxlint-canonical.json` як згенерований артефакт через `rebuild-oxlint-canonical.mjs`. JSON і TSV містили ідентичні дані 1:1, що ставило під сумнів доцільність окремого пайплайну.

## Considered Options

* Залишити TSV + skeleton як source-of-truth, `oxlint-canonical.json` — артефакт генерації
* Зробити `oxlint-canonical.json` єдиним source-of-truth, видалити генераційний пайплайн

## Decision Outcome

Chosen option: "Зробити `oxlint-canonical.json` єдиним source-of-truth, видалити генераційний пайплайн", because дані в TSV і JSON були ідентичні 1:1, тому підтримка двох форматів не давала переваг.

### Consequences

* Good, because усунуто три артефакти; кількість файлів і точок редагування скоротилась.
* Good, because `tooling.test.mjs` лишився зеленим (12 pass, 0 fail).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Видалено через `git rm`: `npm/rules/js-lint/js/data/tooling/oxlint-rules.tsv`, `npm/rules/js-lint/js/data/tooling/oxlint-canonical-skeleton.json`, `npm/rules/js-lint/lib/rebuild-oxlint-canonical.mjs`. Прибрано entry з `knip.json`, оновлено `.v8rignore`. Обидва `.mdc` виправлено: застарілий шлях `js/tooling/` → `js/data/tooling/`, прибрано інструкцію rebuild. Change-файл: `npm/.changes/1780241234497-9b8327.md` (patch / Changed).
