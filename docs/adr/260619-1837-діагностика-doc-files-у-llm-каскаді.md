---
type: ADR
title: Діагностика doc-files у LLM-каскаді
description: Відмови `doc-files` у LLM-каскаді повʼязані з import side effect, відсутнім `check()` і недостатньо збагаченим violation output.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

Правило `doc-files` систематично провалювалося у LLM-каскаді: локальні моделі повертали `no changes`, а хмарні повідомляли про недостатній контекст репозиторію. Transcript фіксує глибший діагноз: `docgen-judge-measure.mjs` лежав у `js/` директорії правила, підбирався як JS-concern і при import виконував `main()` без `isRunAsCli` guard, що могло завершувати процес через `process.exit(2)`. Також `lint.mjs` не експортував `check()`, тому фактична детекція застарілих docs через `runRule` не виконувалась.

## Considered Options

- Додати `isRunAsCli` guard до `docgen-judge-measure.mjs`, експортувати `check()` з `lint.mjs` і збагатити violation output полями `docPath` та pre-computed CRC.
- Перенести `docgen-judge-measure.mjs` за межі `js/` або сховати його від concern discovery.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `isRunAsCli` guard, `check()` і збагачений violation output", because transcript фіксує два незалежних баги — import side effect і відсутній `check()` — а pre-computed CRC потрібен, бо LLM не має самостійно обчислювати CRC32.

### Consequences

- Good, because після фіксів LLM отримає source, doc path і pre-computed CRC для оновлення документації.
- Good, because `docgen-judge-measure.mjs` не має завершувати процес при import як concern.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because реалізація Фази 2 у transcript позначена як незавершена на момент фіксації діагнозу.

## More Information

- `npm/rules/doc-files/js/docgen-judge-measure.mjs` — відсутній `isRunAsCli` guard на виклику `main()`.
- `npm/rules/doc-files/js/lint.mjs` — відсутній `check()` export.
- `npm/scripts/lib/discover-checkable-rules.mjs` — `listJsConcerns` підбирає `.mjs` файли без `_`-префіксу.
- `npm/scripts/lib/run-rule.mjs` — `runRule` викликає `mod.check()` для JS-concern-ів.
- План збагачення: `reportStale` має містити `docPath` і `new-crc`, обчислений через `crc32(readFileSync(join(cwd, f.sourcePath)))`.
