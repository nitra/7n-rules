---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T16:54:01+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Based on the full transcript I received, here are the key design decisions captured as ADRs:

## ADR Детермінований sym-поріг як tier-routing сигнал у docgen

## Context and Problem Statement
Під час бенч-сесії `docgen` виникла потреба визначити, коли варто надсилати файл до хмарної LLM (Claude), а коли достатньо локальної (gemma3:4b). Два кандидати якісного gate — LLM-суддя (Підхід B) і детермінований скорер (Підхід A) — обидва показали систематичний зсув ≥+25 пп і не могли виявити семантичні помилки.

## Considered Options
* LLM-суддя (Підхід B): gemma3:4b оцінює власний вивід за 4 критеріями (behavioral, no_leaks, structure, accuracy)
* Детермінований скорер (Підхід A): перевірка заголовків, витоків внутрішніх імен, cache-галюцинацій
* Складність файлу (`sym = facts.internalSymbols.length`) як routing сигнал без скорингу

## Decision Outcome
Chosen option: "Складність файлу (`sym ≥ 4`) як routing сигнал", because Pearson r = −0.651 між `sym` і ручними оцінками якості — найсильніша кореляція серед усіх метрик; обидва scoring-підходи показали вищий bias (+25 пп і +35 пп відповідно) і не детектують семантичні помилки (тавтологічні Гарантії, перевернута логіка, галюциновані інваріанти).

### Consequences
* Good, because transcript фіксує очікувану користь: 78% файлів (189/241) залишаються локальними (безкоштовно), 22% (52/241) маршрутуються до cloud; конкретні приклади sym=6 і sym=7 підтвердили критичні помилки при локальній генерації.
* Bad, because sym=4 (k8s-tree.mjs) показав локальний score=90 і некритичні відхилення — частина файлів буде надмірно відправлена в cloud; transcript не містить підтверджених негативних наслідків щодо cost overrun.

## More Information
- `DEFAULT_SYM_THRESHOLD = 4` у `npm/skills/docgen/js/docgen-gen.mjs:231`
- `extractFacts()` повертає `facts.internalSymbols[]` на Stage 0 (0 токенів)
- Tier routing: `facts.internalSymbols.length >= symThreshold ? 'cloud' : 'local'`
- Benchmark files: `~/docgen-bench3/complexity.mjs`, `~/docgen-bench3/tier_audit.mjs`
- Аудит реального проєкту: 241 файл (без `npm/reports/**`, `npm/bin/**`), розподіл sym: 0→81, 1→40, 2→17, 3→51, 4→44

---

## ADR Виключення Stryker-сендбоксів і бандлів із docgen ignore-листа

## Context and Problem Statement
Запуск `tier_audit.mjs` виявив, що `docgen-ignore.mjs` не виключав `npm/reports/stryker/.tmp/sandbox-*/` і `npm/bin/**`, через що scanner повертав 938 файлів замість реальних 241 — Stryker дублює кожен вихідний файл у 4 копії у тимчасових сендбоксах, а `npm/bin/n-cursor.js` є зібраним бандлом з `sym=34`.

## Considered Options
* Додати `npm/reports/**` і `npm/bin/**` до `DOCGEN_IGNORE_GLOBS` у `docgen-ignore.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `npm/reports/**` і `npm/bin/**` до `DOCGEN_IGNORE_GLOBS`", because Stryker-сендбокси є артефактами mutation-тестування, а не вихідним кодом; `npm/bin/**` — зібраний бандл, документувати який безглуздо.

### Consequences
* Good, because transcript фіксує очікувану користь: кількість файлів зменшилась з 938 до 241 після фільтрації при аудиті; sym-розподіл і tier-routing стали достовірними.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/skills/docgen/js/docgen-ignore.mjs` — додано рядок `'npm/bin/**'`; `'npm/reports/**'` вже було присутнє на момент виправлення
- `DOCGEN_IGNORE_GLOBS` — масив picomatch-патернів відносно кореня проєкту
- `tier_audit.mjs` використовує `SKIP_PATH_PREFIXES = ['npm/reports', 'npm/bin']` як окрему фільтрацію (поза ignore-листом docgen)
