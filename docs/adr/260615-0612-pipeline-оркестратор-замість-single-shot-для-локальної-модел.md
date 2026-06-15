---
session: fcae811c-3bfd-41bb-8f03-01b3e0c66990
captured: 2026-06-15T06:12:52+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/fcae811c-3bfd-41bb-8f03-01b3e0c66990.jsonl
---

## ADR Pipeline-оркестратор замість single-shot для локальної моделі нормалізації ADR

## Context and Problem Statement
Поточний `.claude/hooks/normalize-decisions.sh` надсилає єдиний ~32k-токенний промпт (10 чернеток + 294 clean-файли) до LLM і очікує одну велику JSON-відповідь. На хмарній моделі це займає ~13 хвилин; на локальній gemma-4b сервер закриває з'єднання (`omlx curl exit 18`) або зависає понад 5 хвилин, роблячи arm непрацездатним.

## Considered Options
* Naive-local: той самий single-shot промпт → `omlx/gemma-4-e4b-it-OptiQ-4bit`
* Cloud-gold: той самий single-shot промпт → sonnet (еталон)
* New-local: per-draft конвеєр із вузькими LLM-мікрозадачами → `omlx/gemma-4-e4b-it-OptiQ-4bit`

## Decision Outcome
Chosen option: "New-local: per-draft конвеєр", because A/B-експеримент у worktree `main-adr-exp` підтвердив: `naive-local` аварійно завершується на infra-рівні (32k-промпт переповнює omlx-сервер), `cloud-gold` завершує успішно, але потребує хмари й 811 секунд; `new-local` (37 серійних локальних викликів) завершує 10 чернеток із покриттям `each-once=true`, `madrInvalid=0` (7/7), `cloudCalls=0`, `escalations=0`.

### Consequences
* Good, because transcript фіксує очікувану користь: нульова залежність від хмари, 100% infra-надійність на gemma-4b, структурна валідність MADR на рівні хмарного еталона.
* Bad, because 37 серійних inference-викликів на omlx-сервері замість 1 — реальні хвилини для батчу 10 чернеток; для Stop-hook прийнятно, але для інтерактивного `/n-adr-normalize` потрібен per-draft progress-лог.

## More Information
Файли експерименту: `experiments/adr-exp/run.mjs`, `experiments/adr-exp/lib/single-shot.mjs`, `experiments/adr-exp/score.mjs`, `experiments/adr-exp/RESULTS.md`.
Ядро конвеєра: `npm/scripts/lib/adr/normalize-pipeline.mjs`.
Arm results: `experiments/adr-exp/out/{cloud-gold,naive-local,new-local}/summary.json`.
Модель: `omlx/gemma-4-e4b-it-OptiQ-4bit` (env `N_LOCAL_MIN_MODEL`).

---

## ADR Інверсія керування в ADR-оркестраторі: JS тримає глобальний стан, LLM вирішує мікрозадачі

## Context and Problem Statement
Локальна модель (gemma-4b) провалює cross-document reasoning: глобальний дедуп, класифікація і генерація MADR в одному промпті призводять до галюцинацій слагів, втрати файлів і зламаного JSON. Потрібна декомпозиція на компоненти, де мала модель справляється.

## Considered Options
* Глобальне рішення одним промптом (підхід `normalize-decisions.sh`)
* Інверсія керування: JS оркеструє, LLM відповідає лише на вузькі verifiable-питання
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Інверсія керування: JS оркеструє", because мала модель сильна в класифікації на 3 класи й constrained-reformat одного документа, але слабка в глобальному міркуванні через 10–30 файлів. Детермінований JS тримає union-find кластери, coverage-гейт «кожен файл рівно один раз», унікалізацію слагів і MADR structural lint. LLM отримує лише бінарний edge-judge (пара — те саме рішення? так/ні + confidence), kind-judge (rewrite/merge/delete для одного драфта), gen-MADR (constrained reformat одного файлу).

### Consequences
* Good, because transcript фіксує очікувану користь: `madrInvalid=0`, `escalations=0`, усі глобальні інваріанти (coverage, slug-uniqueness) гарантовані кодом, а не моделлю; prose-якість gemma на standalone-reformat порівнянна з sonnet.
* Bad, because зафіксована одна регресія: kind-judge не розпізнав «no-decision» draft — gold=`delete`, new-local=`rewrite`; gemma написала «Chosen option: не обрано, because transcript завершився» з `Status: Accepted`. Потребує детермінованого гейту «не обрано → delete».

## More Information
Патерн взятий з `npm/scripts/lib/fix/orchestrator.mjs` і `npm/scripts/coverage-classify/index.mjs` (tier-каскад `resolveModel`, `classifyOmlxError`, cache за contenthash).
Детермінований retrieval: лексична схожість слагів → top-K кандидати → бінарний edge-judge без повного clean-списку у промпті.
Стадії конвеєра в `npm/scripts/lib/adr/normalize-pipeline.mjs`: classify-edge → union-find кластери → kind-judge → gen-MADR / merge-additions → validation gate.
Wire-trace активності: `.n-cursor/llm-trace.jsonl` (caller-prefix `adr-pipe:kind`, `adr-pipe:gen`).
