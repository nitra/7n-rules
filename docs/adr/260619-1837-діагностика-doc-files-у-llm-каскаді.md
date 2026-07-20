---
type: ADR
title: Діагностика doc-files у LLM-каскаді
description: Для doc-files потрібно закрити import-crash, додати check export і збагачувати violation output шляхами та CRC.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

Правило `doc-files` систематично провалювалося у LLM-каскаді: локальні моделі повертали `no changes`, хмарні — що недостатньо контексту репозиторію. Transcript зафіксував глибшу причину: `docgen-judge-measure.mjs` лежить у `js/` директорії правила, де `listJsConcerns` підбирає `.mjs` файли як JS-concerns. При імпорті файл виконує `main()` без `isRunAsCli` guard, викликає `process.exit(2)`, і `fix.mjs` крашиться. Окремо `lint.mjs` не експортує `check()`, тому фактична детекція застарілих docs через `runRule` не виконується.

## Considered Options

- Додати `isRunAsCli` guard до `docgen-judge-measure.mjs`, `check()` до `lint.mjs` і збагатити violation output полями `docPath` та pre-computed CRC.
- Перенести `docgen-judge-measure.mjs` за межі `js/` або перейменувати з `_`-префіксом.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `isRunAsCli` guard, `check()` і збагачений violation output", because transcript фіксує два незалежні баги — import-crash і відсутність `check()` — а pre-computed CRC потрібен, бо LLM не може надійно обчислити CRC32 самостійно.

### Consequences

- Good, because `docgen-judge-measure.mjs` перестає завершувати процес під час import як JS-concern.
- Good, because `runRule` отримує `check()` для фактичної детекції застарілих docs.
- Good, because LLM отримує source, doc і pre-computed CRC для оновлення документації.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because transcript зазначає, що реалізація цієї фази була незавершена на момент фіксації діагнозу.

## More Information

- `npm/rules/doc-files/js/docgen-judge-measure.mjs` — відсутній `isRunAsCli` guard на виклику `main()`.
- `npm/rules/doc-files/js/lint.mjs` — відсутній `check()` export.
- `npm/scripts/lib/discover-checkable-rules.mjs` — `listJsConcerns` підбирає `.mjs` файли без `_`-префіксу.
- `npm/scripts/lib/run-rule.mjs` — `runRule` викликає `mod.check()` для JS-concerns.
- План з transcript: збагатити `reportStale` полями `docPath` і `new-crc`, обчисленим через `crc32(readFileSync(join(cwd, f.sourcePath)))`.
