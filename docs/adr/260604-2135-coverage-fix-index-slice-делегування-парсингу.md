# Делегування важкого парсингу скрипту: патерн `index|slice` для скілів

**Status:** Accepted
**Date:** 2026-06-04

## Context and Problem Statement

`COVERAGE.md` у проєкті важить ~2.76 МБ (~700K токенів). Скіл `n-coverage-fix` у попередній версії змушував оркестратора (LLM-агента) читати весь файл, щоб дістати 122 групи survived-мутантів — це в 3.4× більше ліміту контексту Sonnet 4.6 (200K токенів) і дуже висока LLM-вартість. Проблема є загальною: будь-який скіл, що ітерує по великому артефакту (звіт, список файлів), потенційно вичерпує контекст агента.

## Considered Options

- Агент читає `COVERAGE.md` цілком (попередня поведінка)
- Скрипт парсить, агент отримує лише порцію: `n-cursor coverage-fix index` → компактний JSON-індекс (~7.4 КБ); `n-cursor coverage-fix slice --file <path>` → готовий промпт для конкретного файлу (~10 КБ)
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Скрипт парсить, агент отримує лише порцію (`index|slice`)", because 2.76 МБ `COVERAGE.md` не вміщується в контекст разом із context-baseline (~60K токенів правил/інструкцій); JS-парсинг коштує 0 LLM-токенів, а «порція» для субагента — ~10 КБ (~3K токенів).

### Consequences

- Good, because `coverage-fix index` повертає 7.4 КБ (~2K токенів) замість 2.76 МБ (~700K токенів) — ≈350× менше для оркестратора; субагент для одного файлу отримує ~10 КБ готового промпту.
- Good, because патерн узагальнюється на інші скіли (`n-docgen` тощо): CLI-скрипт → детерміністичний структурований зріз → субагент отримує рівно потрібну «когнітивну порцію».
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Реалізація:
- `npm/scripts/coverage-fix-extract.mjs` — `parseSurvivedBlock` (≥3-бектикова огорожа), `readSurvived`, `buildIndex`, `runCoverageFixCli`
- `npm/bin/n-cursor.js` — новий `case 'coverage-fix'` (read-only, без root-guard)
- `npm/skills/coverage-fix/SKILL.md` — Кроки 2–3 і 5 переписані: `n-cursor coverage-fix index` в оркестраторі; `n-cursor coverage-fix slice --file` у кожному субагенті
- Тести: `npm/scripts/tests/coverage-fix-extract.test.mjs` — 16 тестів; загалом 130 тестів проходять після змін

Додаткова інформація: контекст про вартість (~$50 за повний прогін без фільтрації) і `coverage-classify` як попередній фільтр зафіксовано в аналітичній нотатці тієї ж сесії (не є окремим рішенням).
