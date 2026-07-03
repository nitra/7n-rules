---
type: ADR
title: ""
---

## ADR Сигнал складності sym ≥ 4 як детермінований tier-routing у docgen

## Context and Problem Statement
Двотировий docgen-конвеєр (gemma3:4b локально + Claude хмарно) потребував чіткого сигналу для автоматичного вибору tier без LLM-суддів і без ручної розмітки. Попередні підходи — LLM-суддя (Підхід B, зсув +25 пп) і детермінований скорер (Підхід A, зсув +35 пп після фіксів) — виявились ненадійними як якісний гейт для файлів з різною складністю.

## Considered Options
* `sym` (кількість внутрішніх символів із `extractFacts`) як єдиний пороговий сигнал
* `combo` (sym + exp*2 + imp) — зважена комбінація метрик
* Підхід B — LLM-суддя (Claude Haiku) як якісний рефері
* Підхід A — детермінований скорер на основі `facts` із Stage 0

## Decision Outcome
Chosen option: "`sym ≥ 4` → cloud, інакше local", because Pearson r = −0.651 між `sym` і якістю документації — найсильніша кореляція серед усіх метрик; `exp` (кількість публічних функцій) має позитивну кореляцію (+0.384) і розбавляла б `combo`; тест на 7 файлах показав чіткий розрив: local-група (sym < 4) avg 89%, cloud-група (sym ≥ 4) avg 65%. На 241 реальному файлі проєкту поріг дає 78% local (безкоштовно) / 22% cloud (~$1.5).

### Consequences
* Good, because transcript фіксує очікувану користь: 0 токенів на routing-рішення, детерміноване та відтворюване; на повному проєкті (58 нових файлів) cloud-tier отримав лише 6 файлів (sym=4–10), local — 52; min score серед local-файлів = 80, avg ≈ 94%.
* Bad, because `sym = 3` — найбільша сіра зона (51 файл у проєкті): `fix.mjs` із sym=3 показав якість 50% на бенчі, але залишається у local-тирі; фіксується як borderline для ручного рев'ю.

## More Information
* Реалізація: `const DEFAULT_SYM_THRESHOLD = 4` у `npm/skills/docgen/js/docgen-gen.mjs` (рядок 231); routing: `facts.internalSymbols.length >= symThreshold ? 'cloud' : 'local'`
* `extractFacts` — `npm/skills/docgen/js/docgen-extract.mjs`
* Виявлений і зафіксований побічний дефект: `npm/reports/**` (Stryker-сендбокси) і `npm/bin/**` додані до `DOCGEN_IGNORE_GLOBS` у `npm/skills/docgen/js/docgen-ignore.mjs`
* Бенч-скрипти: `~/docgen-bench3/tier_audit.mjs`, `score_a.mjs`, `complexity.mjs`
* Cloud vs local порівняння (git diff): `~/docgen-bench3/comparison/` — база cloud (Claude), diff local (gemma3:4b) на `commands.mjs` (sym=15) і `safety.mjs` (sym=17)
* Commit: `6436a901` — 58 нових docs-файлів у репозиторії

## Update 2026-06-06

- Для docgen зафіксовано routing за складністю: якщо `facts.internalSymbols.length >= 3`, файл краще спрямовувати в cloud tier.
- Локальний LLM-суддя відхилено: `gemma3:4b` завищував власний score приблизно на 25 п.п. і не ловив очевидні витоки implementation details.
- Чистий детермінований scoring теж недостатній для semantic defects: після виправлення false positives він завищував результат приблизно на 35 п.п.
- `sym >= 3` обрано як дешевий routing-сигнал: 0 токенів, <1 ms, Pearson −0.651 з якістю на bench-наборі.
- Відомий компроміс: threshold консервативний і може відправити в cloud файли з прийнятною локальною якістю, наприклад `k8s-tree`.
