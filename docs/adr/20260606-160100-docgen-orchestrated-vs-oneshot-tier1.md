## ADR Orchestrated режим замість one-shot для Tier 1 локальних LLM

## Context and Problem Statement
При використанні gemma3:4b у one-shot режимі для складних файлів (overlay-paths, k8s-tree) модель генерувала документи з витоком implementation details, відсутністю `## Огляд` заголовків та generic гарантіями. Потрібно покращити якість без переходу на хмарну модель.

## Considered Options
* One-shot режим: один промпт із повним кодом та інструкціями для всього документа
* Orchestrated режим (секційно-мінімальний контекст v2): окремі промпти для кожної секції; вихідний код передається лише у секцію `behavior`

## Decision Outcome
Chosen option: "Orchestrated режим v2 з Stage-2 `stripSignatures` та негативними маркерами кешу", because бенчмарк на 3 abie-файлах зафіксував 92% якості (ORCH) проти 47% (ONE) при однаковому середньому часі ~52–53s/файл.

### Consequences
* Good, because k8s-tree — ключовий кейс: one-shot дав 17% (impl dump: walkDir кроки, `.ya?ml` regex, `Set dirs`), orchestrated — 83%.
* Good, because негативні маркери (`'Кешування: НЕМАЄ — не згадуй кеш у гарантіях'`) в `factsSummary` усунули cache-hallucination патерн без збільшення кількості токенів у generation-промпті.
* Good, because Stage-2 `stripSignatures` (0 токенів, детерміновано) видаляє витоки функціональних підписів як пост-обробка — застосовується до обох режимів.
* Bad, because для файлів з sym ≥ 4 orchestrated все одно деградує до <70% якості та займає 14+ хвилин — цей клас файлів вирішується hybrid routing (ADR `20260606-160000-docgen-hybrid-tier-routing-sym-threshold.md`), а не вибором режиму.

## More Information
Секційна оркестрація: `npm/skills/docgen/js/docgen-gen.mjs` → `generateOrchestrated()`, `sectionMessages()`. Промпти: `npm/skills/docgen/js/docgen-prompts.mjs`. Негативні маркери: `extractFacts()` у `docgen-extract.mjs`. Бенчмарк: `~/docgen-bench3/bench_final.mjs`; результати: `~/docgen-bench3/final/`. Commit: `45a7466c` (feat/docgen-orchestrator-pi → main, `5e9d3a7b`). Файли оцінені: `firebase_hosting.mjs`, `overlay-paths.mjs`, `k8s-tree.mjs` (3 abie-файли).

## Update 2026-06-06

Вартісний аналіз: повний хмарний прогін docgen на 1442 файлах — ~28–38 M токенів (~$300–770). Tier 1 (1042+ незалежних file-per-file задачі) → локальна Ollama → $0. Tier 2/3 (~2.6 M токенів, 16 модулів) → Claude (якість синтезу критична, коштує копійки порівняно з Tier 1). На 8 GB M2 Tier 1 з `concurrency=1` займає 14–42 год залежно від моделі — паралельний batch по 5 (хмарний патерн) зникає. Найдешевший важіль зменшення обсягу Tier 1 — `DOCGEN_IGNORE_GLOBS` у `docgen-ignore.mjs`. Вимога: Tier-1 промпт винести у `docgen-prompt.mjs` (спільний для Claude-субагентів і Ollama-CLI) щоб уникнути розходження.
